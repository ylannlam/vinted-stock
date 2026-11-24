begin;
insert into public.scalency_records(kind,account,remote_id,payload) values('accounts','','quota-test-transaction','{"linked":true,"login":"test"}');
do $$
declare a text:='quota-test-transaction'; r jsonb; local_day date:=(now() at time zone 'Europe/Paris')::date;
begin
  r:=public.scalency_daily_capacity(a);
  if r->>'mode'<>'starter' or (r->>'remaining')::int<>4 or r->>'starter_day' is not null then raise exception 'new account'; end if;
  perform public.scalency_set_cadence(a,'starter',17,40);
  insert into public.scalency_records(kind,account,remote_id,payload) values
    ('jobs',a,'test-posted',jsonb_build_object('type','publish','status','done','new_item_id','1','done_at',now())),
    ('jobs',a,'test-pending','{"type":"publish","status":"queued"}'),
    ('jobs',a,'test-future',jsonb_build_object('type','publish','status','scheduled','not_before',(local_day+1)::timestamp at time zone 'Europe/Paris'));
  r:=public.scalency_daily_capacity(a);
  if (r->>'remaining')::int<>15 or (r->>'starter_day')::int<>1 then raise exception 'accounting'; end if;
  if (public.scalency_daily_capacity(a,local_day+1)->>'reserved')::int<>1 then raise exception 'future schedule'; end if;
  begin
    perform public.scalency_check_capacity(a,16,local_day);
    raise exception 'capacity should refuse';
  exception when raise_exception then if sqlerrm<>'daily_capacity' then raise; end if; end;
  update public.scalency_records set payload=payload||'{"status":"cancelled"}' where kind='jobs' and account=a and remote_id='test-pending';
  if (public.scalency_daily_capacity(a)->>'remaining')::int<>16 then raise exception 'release'; end if;
  r:=public.scalency_set_cadence(a,'normal',17,0);
  if (r->>'remaining')::int<>0 then raise exception 'pause'; end if;
  if (public.scalency_daily_capacity(a,local_day+3)->>'starter_day')::int<>4 then raise exception 'day four'; end if;
end $$;
do $$
declare a text:='quota-test-transaction'; owner_id uuid; first_id uuid:=gen_random_uuid(); second_id uuid:=gen_random_uuid();
  entries jsonb; receipt text:=gen_random_uuid()::text;
begin
  select id into strict owner_id from public.profiles where role='admin' limit 1;
  perform public.scalency_set_cadence(a,'normal',17,2);
  insert into public.listing_drafts(id,owner_id,fields,payload) select x,owner_id,jsonb_build_object('account_id',a,'title','Test'), '{"batch":{"status":"ready"}}'
    from unnest(array[first_id,second_id]) x;
  entries:=jsonb_build_array(jsonb_build_object('id',first_id,'version',1));
  perform public.scalency_accept_limited_lot(receipt,owner_id,a,entries);
  perform public.scalency_accept_limited_lot(receipt,owner_id,a,entries);
  if (public.scalency_daily_capacity(a)->>'remaining')::int<>0 then raise exception 'double click'; end if;
  begin
    perform public.scalency_reserve_single(a,owner_id,second_id,1,jsonb_build_object('account_id',a),null);
    raise exception 'expected single to refuse';
  exception when raise_exception then if sqlerrm<>'daily_capacity' then raise; end if; end;
  if (select state from public.listing_drafts where id=second_id)<>'draft' then raise exception 'draft lost'; end if;
  perform public.scalency_stop_lot_entry(owner_id,first_id,2);
  if not public.scalency_reserve_single(a,owner_id,second_id,1,jsonb_build_object('account_id',a),null) then raise exception 'single refused after cancellation'; end if;
end $$;
rollback;
