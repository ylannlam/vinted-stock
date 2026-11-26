begin;
do $$
declare
  owner uuid; acct text:='test-move-'||gen_random_uuid(); ids uuid[]:=array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  day1 date:=(now() at time zone 'Europe/Paris')::date+1; day2 date:=day1+1;
  start1 timestamptz:=(day1+time '08:00') at time zone 'Europe/Paris';
  start2 timestamptz:=(day2+time '09:00') at time zone 'Europe/Paris';
  move jsonb;
begin
  select id into strict owner from public.profiles where role='admin' limit 1;
  insert into public.scalency_records(kind,account,remote_id,payload) values('accounts','',acct,'{"linked":true}');
  perform public.scalency_set_cadence(acct,'normal',2,2);
  insert into public.listing_drafts(id,owner_id,fields,payload) select id,owner,jsonb_build_object('account_id',acct,'title','Test'), '{"batch":{"status":"ready"}}' from unnest(ids) id;
  perform public.scalency_accept_limited_lot(acct,owner,acct,(select jsonb_agg(jsonb_build_object('id',id,'version',1,'at',start1,'until',start1+interval '2 hours')) from unnest(ids[1:2]) id));
  perform public.scalency_accept_limited_lot(acct||'-2',owner,acct,jsonb_build_array(jsonb_build_object('id',ids[3],'version',1,'at',start2,'until',start2+interval '2 hours')));
  select jsonb_agg(jsonb_build_object('id',id,'version',2,'previous',start1,'at',start2)) into move from unnest(ids[1:2]) id;
  begin
    perform public.scalency_move_pending(owner,acct,move,start2+interval '3 hours');
    raise exception 'overbooked';
  exception when raise_exception then if sqlerrm<>'daily_capacity' then raise; end if; end;
  if (select count(*) from public.scalency_lot_entries where lot_id=acct and scheduled_for=start1)<>2 then raise exception 'partial_move'; end if;
  perform public.scalency_move_pending(owner,acct,jsonb_build_array(move->0),start2+interval '3 hours');
  if (public.scalency_daily_capacity(acct,day1)->>'remaining')::int<>1 or (public.scalency_daily_capacity(acct,day2)->>'remaining')::int<>0 then raise exception 'wrong_day_capacity'; end if;
  begin
    perform public.scalency_move_pending(owner,acct,jsonb_build_array(move->0),start2+interval '3 hours');
    raise exception 'stale_accepted';
  exception when raise_exception then if sqlerrm<>'lot_changed' then raise; end if; end;
  update public.scalency_lot_entries set status='sending' where draft_id=ids[2];
  begin
    perform public.scalency_move_pending(owner,acct,jsonb_build_array(move->1),start2+interval '3 hours');
    raise exception 'already_handed_off';
  exception when raise_exception then if sqlerrm<>'lot_changed' then raise; end if; end;
  if has_function_privilege('authenticated','public.scalency_move_pending(uuid,text,jsonb,timestamptz)','execute') then raise exception 'wrong_grant'; end if;
end $$;
rollback;
