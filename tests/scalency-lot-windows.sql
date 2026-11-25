begin;
do $$
declare
  owner_id uuid; account_id text:='test-window-'||gen_random_uuid();
  first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid(); third_id uuid:=gen_random_uuid();
  tomorrow date:=(now() at time zone 'Europe/Paris')::date+1;
  slot timestamptz:=(tomorrow+time '08:00') at time zone 'Europe/Paris';
  deadline timestamptz:=(tomorrow+time '20:00') at time zone 'Europe/Paris';
  receipt text:=gen_random_uuid()::text; entries jsonb;
begin
  select id into strict owner_id from public.profiles where role='admin' limit 1;
  insert into public.scalency_records(kind,account,remote_id,payload) values('accounts','',account_id,'{"linked":true}');
  perform public.scalency_set_cadence(account_id,'normal',2,2);
  insert into public.listing_drafts(id,owner_id,fields,payload) select item,owner_id,
    jsonb_build_object('account_id',account_id,'sku',item::text,'title','Test'), '{"batch":{"status":"ready"}}'
    from unnest(array[first_id,second_id,third_id]) item;
  entries:=jsonb_build_array(jsonb_build_object('id',first_id,'version',1,'at',slot,'until',deadline),
    jsonb_build_object('id',second_id,'version',1,'at',slot+interval '1 hour','until',deadline));
  perform public.scalency_accept_limited_lot(receipt,owner_id,account_id,entries);
  perform public.scalency_accept_limited_lot(receipt,owner_id,account_id,entries);
  if (select count(*) from public.scalency_lot_entries where lot_id=receipt and next_attempt=scheduled_for
      and scheduled_for>=slot and window_end=deadline and status='pending')<>2 then raise exception 'invalid_dispatch'; end if;
  if (public.scalency_daily_capacity(account_id,tomorrow)->>'remaining')::int<>0
    or (public.scalency_daily_capacity(account_id)->>'reserved')::int<>0 then raise exception 'wrong_day'; end if;
  begin
    perform public.scalency_accept_limited_lot('over-'||receipt,owner_id,account_id,
      jsonb_build_array(jsonb_build_object('id',third_id,'version',1,'at',slot,'until',deadline)));
    raise exception 'overbooked';
  exception when raise_exception then if sqlerrm<>'daily_capacity' then raise; end if; end;
  if not public.scalency_stop_lot_entry(owner_id,first_id,2) then raise exception 'cannot_cancel'; end if;
  perform public.scalency_accept_limited_lot('now-'||receipt,owner_id,account_id,
    jsonb_build_array(jsonb_build_object('id',first_id,'version',3)));
  if (public.scalency_daily_capacity(account_id,tomorrow)->>'remaining')::int<>1
    or (public.scalency_daily_capacity(account_id)->>'reserved')::int<>1 then raise exception 'wrong_reservation'; end if;
end $$;
rollback;
