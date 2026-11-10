-- Run after the real agent schema, the test columns below, and the latest claim migration.
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%', message; end if; end $$;

do $$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  task_id uuid;
  next_id uuid;
  r jsonb;
  used integer;
  v_day timestamptz := date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris';
begin
  insert into public.publication_accounts(id) values(a),(b);
  insert into public.vinted_agent_settings(account_id,enabled,limits,messaging) values
    (a,true,'{"like_message_per_day":2,"from_hour":0,"to_hour":0}', '{"reply_unlimited":true,"action_gap_min":5,"action_gap_max":5}'),
    (b,true,'{"like_message_per_day":2,"from_hour":0,"to_hour":0}', '{}');

  -- A limit of two permits zero/one previous start, but blocks at/above two.
  -- A failed attempt still consumes quota; successful-only counting would reopen the floodgate.
  for used in 0..3 loop
    delete from public.vinted_agent_tasks where account_id=a;
    insert into public.vinted_agent_tasks(account_id,kind,writes,state,started_at)
      select a,'like_message',true,case when n=1 then 'failed' else 'done' end,now()-interval '10 seconds'
      from generate_series(1,used) n;
    insert into public.vinted_agent_tasks(account_id,kind,writes) values(a,'like_message',true) returning id into task_id;
    r := public.claim_vinted_agent_task(a);
    perform pg_temp.assert_true((r->>'state')=case when used<2 then 'task' else 'idle' end, 'daily boundary: '||used);
    if used>=2 then
      perform pg_temp.assert_true((select state='queued' and attempts=0 and started_at is null from public.vinted_agent_tasks where id=task_id), 'quota must leave queued task untouched');
    else
      perform pg_temp.assert_true(r->'task'->>'id'=task_id::text, 'claim expected task');
    end if;
  end loop;

  -- Follow-up and manual flags do not bypass the daily cap. Reads still run at the cap.
  update public.vinted_agent_tasks set payload='{"followup":true,"manual":true}',priority=100 where id=task_id;
  insert into public.vinted_agent_tasks(account_id,kind,writes) values(a,'scan_likes',false) returning id into next_id;
  r := public.claim_vinted_agent_task(a);
  perform pg_temp.assert_true(r->'task'->>'id'=next_id::text, 'a capped high-priority like must not block reads');
  update public.vinted_agent_tasks set state='done',lease=null,lease_until=null where id=next_id;
  perform pg_temp.assert_true((select enabled and not paused from public.vinted_agent_settings where account_id=a), 'Bridge/account remains enabled');

  -- Replies and order messages remain independently eligible.
  insert into public.vinted_agent_tasks(account_id,kind,writes) values(a,'reply_message',true) returning id into next_id;
  r := public.claim_vinted_agent_task(a);
  perform pg_temp.assert_true(r->'task'->>'id'=next_id::text, 'like quota must not block a reply');
  update public.vinted_agent_tasks set state='done',lease=null,lease_until=null,started_at=now()-interval '10 seconds' where id=next_id;
  insert into public.vinted_agent_tasks(account_id,kind,writes) values(a,'order_message',true) returning id into next_id;
  r := public.claim_vinted_agent_task(a);
  perform pg_temp.assert_true(r->'task'->>'id'=next_id::text, 'like quota must not block an order message');
  update public.vinted_agent_tasks set state='done',lease=null,lease_until=null where id=next_id;

  insert into public.vinted_agent_tasks(account_id,kind,writes) values(b,'like_message',true) returning id into next_id;
  r := public.claim_vinted_agent_task(b);
  perform pg_temp.assert_true(r->'task'->>'id'=next_id::text, 'quota is per account');

  -- Zero blocks even the first task, while a missing setting defaults to ten.
  delete from public.vinted_agent_tasks where account_id=a;
  update public.vinted_agent_settings set limits='{"like_message_per_day":0,"from_hour":0,"to_hour":0}' where account_id=a;
  insert into public.vinted_agent_tasks(account_id,kind,writes) values(a,'like_message',true) returning id into task_id;
  perform pg_temp.assert_true(public.claim_vinted_agent_task(a)->>'state'='idle', 'zero means no likes');
  update public.vinted_agent_settings set limits='{"from_hour":0,"to_hour":0}' where account_id=a;
  insert into public.vinted_agent_tasks(account_id,kind,writes,state,started_at)
    select a,'like_message',true,'done',now()-interval '10 seconds' from generate_series(1,10);
  perform pg_temp.assert_true(public.claim_vinted_agent_task(a)->>'state'='idle', 'missing setting defaults to ten');

  -- Yesterday's starts no longer consume today's quota (Paris midnight, not UTC).
  update public.vinted_agent_tasks set started_at=v_day-interval '1 second' where account_id=a and state='done';
  r := public.claim_vinted_agent_task(a);
  perform pg_temp.assert_true(r->'task'->>'id'=task_id::text, 'next Paris day resets quota');

  -- A follow-up that has started consumes a slot just like a first contact.
  delete from public.vinted_agent_tasks where account_id=a;
  update public.vinted_agent_settings set limits='{"like_message_per_day":1,"from_hour":0,"to_hour":0}' where account_id=a;
  insert into public.vinted_agent_tasks(account_id,kind,writes,state,started_at,payload)
    values(a,'like_message',true,'done',now()-interval '10 seconds','{"followup":true}');
  insert into public.vinted_agent_tasks(account_id,kind,writes) values(a,'like_message',true);
  perform pg_temp.assert_true(public.claim_vinted_agent_task(a)->>'state'='idle', 'follow-up consumes quota');

  -- Preserve manual pause and disabled states.
  update public.vinted_agent_settings set paused=true,pause_reason='mise en pause depuis le site' where account_id=a;
  perform pg_temp.assert_true(public.claim_vinted_agent_task(a)->>'state'='paused', 'manual pause preserved');
  update public.vinted_agent_settings set enabled=false where account_id=a;
  perform pg_temp.assert_true(public.claim_vinted_agent_task(a)->>'state'='disabled', 'disabled state preserved');
end $$;

select pg_temp.assert_true(not has_function_privilege('anon','public.claim_vinted_agent_task(uuid)','execute'), 'anon cannot claim tasks');
select pg_temp.assert_true(not has_function_privilege('authenticated','public.claim_vinted_agent_task(uuid)','execute'), 'authenticated cannot claim tasks');
select pg_temp.assert_true(has_function_privilege('service_role','public.claim_vinted_agent_task(uuid)','execute'), 'server can claim tasks');
rollback;
