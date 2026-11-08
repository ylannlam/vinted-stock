begin;
-- Préparation demandée par un clic humain ; aucune création directe d'annonce.
create or replace function public.queue_ylavint_listing(p_id uuid,p_owner uuid,p_version integer,p_payload jsonb,p_spacing integer,p_not_before timestamptz,p_live boolean)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare d public.listing_drafts; s public.vinted_agent_settings; t uuid;
begin
 if p_not_before is not null or p_payload->>'assisted' is distinct from 'true' then raise exception 'Form preparation requires an explicit immediate request';end if;
 select * into d from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='draft' and dotb_item_id is null and publication_task_id is null;
 if not found then return;end if;
 select * into s from public.vinted_agent_settings where account_id=(d.fields->>'account_id')::uuid for update;
 if not found or not s.enabled or s.paused or not coalesce((s.features->>'publish')::boolean,false) then raise exception 'Compte en pause ou préparation non activée';end if;
 if coalesce(s.extension_version,'') !~ '^[0-9]+[.][0-9]+[.][0-9]+$' then raise exception 'YlaVint 3.8 requis';end if;
 if (split_part(s.extension_version,'.',1)::integer,split_part(s.extension_version,'.',2)::integer)<(3,8) then raise exception 'YlaVint 3.8 requis';end if;
 if p_payload->'fields'->>'account_id' is distinct from d.fields->>'account_id' or jsonb_typeof(p_payload->'photos') is distinct from 'array' or jsonb_array_length(p_payload->'photos') not between 1 and 20 then raise exception 'Invalid form snapshot';end if;
 if exists(select 1 from public.vinted_agent_tasks where account_id=s.account_id and kind='publish_item' and state in ('queued','running')) then raise exception 'Un formulaire attend déjà sur ce compte. Termine sa préparation avant le suivant.';end if;
 update public.listing_drafts set state='scheduled',payload=p_payload,publish_provider='ylavint',planned_at=now(),scheduled_at=now(),dotb_publish=false,version=version+1,updated_at=now(),last_error=null,message='Ouverture du formulaire Vinted demandée. Garde le profil et son Bridge ouverts ; tu valideras toi-même.'
 where id=p_id and owner_id=p_owner and version=p_version and state='draft' and publication_task_id is null returning * into d;
 if not found then return;end if;
 insert into public.vinted_agent_tasks(account_id,kind,writes,payload,dedupe_key,not_before,priority,created_by)
 values(s.account_id,'publish_item',true,jsonb_build_object('draft_id',d.id,'live',false,'listing',p_payload),'form:'||d.id||':'||d.version,now(),2,p_owner) returning id into t;
 return query update public.listing_drafts set publication_task_id=t where id=d.id returning *;
end $$;

create or replace function public.track_ylavint_listing() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.kind<>'publish_item' or new.state=old.state then return new;end if;
 if new.state='running' then
  update public.listing_drafts set state='preparing',version=version+1,updated_at=now(),message='YlaVint ouvre le formulaire dans le profil choisi. La validation finale reste manuelle.' where publication_task_id=new.id and state='scheduled';
 elsif new.state='cancelled' and old.state='queued' and old.started_at is null then
  update public.listing_drafts set state='draft',publication_task_id=null,publish_provider=null,payload=null,planned_at=null,scheduled_at=null,version=version+1,updated_at=now(),message='Préparation annulée avant son départ.' where publication_task_id=new.id and state='scheduled';
 elsif new.state='failed' then
  update public.listing_drafts set state='attention',version=version+1,updated_at=now(),last_error=new.error,message=coalesce(new.error,'Préparation interrompue.')||' Vérifie l’onglet Vinted. Aucun nouvel essai automatique.' where publication_task_id=new.id and state in ('scheduled','preparing');
 elsif new.state='done' and new.payload->'listing'->>'assisted'='true' then
  if new.result->>'prepared' is distinct from 'true' or new.result ? 'vinted_id' then raise exception 'Invalid assisted result';end if;
  update public.listing_drafts set state='attention',last_error=null,message=new.result->>'message',version=version+1,updated_at=now(),checked_at=now(),payload=jsonb_set(payload,'{form_ready}','true'::jsonb),inflight=null where publication_task_id=new.id and state in ('scheduled','preparing');
 elsif new.state='done' then
  raise exception 'Direct publication is disabled';
 end if;
 return new;
end $$;
create or replace function public.claim_vinted_agent_task(p_account uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  s public.vinted_agent_settings;
  t public.vinted_agent_tasks;
  v_day timestamptz := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
  v_hour integer := extract(hour from now() at time zone 'Europe/Paris')::integer;
  v_from integer; v_to integer; v_in_window boolean;
  v_writes integer; v_last timestamptz; v_cap integer; v_kind_count integer;
  v_replies integer; v_last_msg timestamptz; v_gap_min numeric; v_gap_max numeric; v_gap numeric;
  v_msg_kinds text[] := array['reply_message','like_message','order_message','accept_offer'];
begin
  select * into s from public.vinted_agent_settings where account_id=p_account for update;
  if not found or not s.enabled then return jsonb_build_object('state','disabled','task',null); end if;
  update public.vinted_agent_settings set last_seen_at=now() where account_id=p_account;

  update public.vinted_agent_tasks set
      state=case when writes then 'failed' else 'queued' end,
      error=case when writes then 'Résultat inconnu : le profil s''est fermé pendant l''action. Vérifie sur Vinted avant de relancer.' else error end,
      finished_at=case when writes then now() else null end,
      lease=null, lease_until=null
    where account_id=p_account and state='running' and lease_until<now();
  update public.vinted_agent_tasks set state='failed', error='Trois essais sans succès.', finished_at=now()
    where account_id=p_account and state='queued' and attempts>=3;

  update public.vinted_agent_tasks set state='failed',finished_at=now(),error='Ancien envoi direct arrêté. Prépare le formulaire depuis le site.'
    where account_id=p_account and kind='publish_item' and state='queued' and payload->'listing'->>'assisted' is distinct from 'true';
  if s.paused then return jsonb_build_object('state','paused','reason',s.pause_reason,'task',null); end if;
  if exists(select 1 from public.vinted_agent_tasks where account_id=p_account and state='running') then
    return jsonb_build_object('state','busy','task',null);
  end if;

  v_from := coalesce((s.limits->>'from_hour')::integer, 9);
  v_to := coalesce((s.limits->>'to_hour')::integer, 22);
  v_in_window := case when v_from=v_to then true when v_from<v_to then v_hour>=v_from and v_hour<v_to else v_hour>=v_from or v_hour<v_to end;
  select count(*) into v_writes from public.vinted_agent_tasks where account_id=p_account and writes and not (kind = any(v_msg_kinds)) and started_at>=v_day;
  select max(started_at) into v_last from public.vinted_agent_tasks where account_id=p_account and writes and not (kind = any(v_msg_kinds)) and started_at is not null;
  select count(*) into v_replies from public.vinted_agent_tasks where account_id=p_account and kind='reply_message' and started_at>=v_day;
  select max(started_at) into v_last_msg from public.vinted_agent_tasks where account_id=p_account and kind = any(v_msg_kinds) and started_at is not null;
  -- Écart entre deux messages : tiré au hasard entre le minimum et le maximum réglés (30 à 45 s par défaut).
  v_gap_min := greatest(5, coalesce((s.messaging->>'action_gap_min')::numeric, 30));
  v_gap_max := greatest(v_gap_min, coalesce((s.messaging->>'action_gap_max')::numeric, 45));
  v_gap := v_gap_min + random() * (v_gap_max - v_gap_min);

  for t in select * from public.vinted_agent_tasks
      where account_id=p_account and state='queued' and not_before<=now()
      order by priority desc, writes, not_before, created_at
      for update skip locked
  loop
    if t.kind='publish_item' then
      if t.payload->'listing'->>'assisted' is distinct from 'true' then
        update public.vinted_agent_tasks set state='failed',finished_at=now(),error='Ancien envoi direct arrêté. Prépare le formulaire depuis le site.' where id=t.id;continue;
      end if;
      if not coalesce((s.features->>'publish')::boolean,false) or coalesce(s.extension_version,'') !~ '^[0-9]+[.][0-9]+[.][0-9]+$' then continue;end if;
      if (split_part(s.extension_version,'.',1)::integer,split_part(s.extension_version,'.',2)::integer)<(3,8) then continue;end if;
      if not exists(select 1 from public.listing_drafts d where d.publication_task_id=t.id and d.publish_provider='ylavint' and d.state='scheduled' and d.owner_id=t.created_by and d.fields->>'account_id'=p_account::text) then
        update public.vinted_agent_tasks set state='failed',finished_at=now(),error='La fiche ne correspond plus à cette tâche.' where id=t.id;continue;
      end if;
    end if;
    if t.kind='accept_offer' then
      if not coalesce((s.messaging->'offers'->>'enabled')::boolean,false) then continue; end if;
      select count(*) into v_kind_count from public.vinted_agent_tasks
        where account_id=p_account and kind='accept_offer' and started_at >= now()-make_interval(days=>coalesce((s.messaging->'offers'->>'period_days')::integer,1))
          and payload->'offer'->>'buyer_id'=t.payload->'offer'->>'buyer_id';
      if v_kind_count >= coalesce((s.messaging->'offers'->>'max_per_buyer')::integer,5) then continue; end if;
    end if;
    if t.kind = any(v_msg_kinds) then
      if not coalesce((t.payload->>'manual')::boolean, false) and not v_in_window then continue; end if;
      if t.kind='reply_message' and not coalesce((s.messaging->>'reply_unlimited')::boolean,false) and v_replies >= coalesce((s.messaging->>'reply_per_day')::integer, 80) then continue; end if;
      if v_last_msg is not null and v_last_msg > now() - make_interval(secs => v_gap) then continue; end if;
    elsif t.writes and t.kind<>'publish_item' then
      if not v_in_window then continue; end if;
      if v_writes >= coalesce((s.limits->>'writes_per_day')::integer, 15) then continue; end if;
      if v_last is not null and v_last > now() - make_interval(mins => coalesce((s.limits->>'min_gap_minutes')::integer, 12)) then continue; end if;
      v_cap := coalesce((s.limits->>(t.kind||'_per_day'))::integer, 5);
      select count(*) into v_kind_count from public.vinted_agent_tasks where account_id=p_account and kind=t.kind and started_at>=v_day;
      if v_kind_count >= v_cap then continue; end if;
    end if;
    update public.vinted_agent_tasks set state='running', attempts=attempts+1, lease=gen_random_uuid(),
        lease_until=now()+case when t.kind='publish_item' then interval '10 minutes' else interval '4 minutes' end, started_at=now(), error=null
      where id=t.id returning * into t;
    return jsonb_build_object('state','task','task',to_jsonb(t));
  end loop;
  return jsonb_build_object('state','idle','task',null);
end; $$;
revoke all on function public.claim_vinted_agent_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_vinted_agent_task(uuid) to service_role;


commit;
