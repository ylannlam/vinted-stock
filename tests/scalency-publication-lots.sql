begin;
do $$
declare
  seller uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid();
  nonce uuid:=gen_random_uuid();
  testlot text:='qa-'||seller::text;
  selection jsonb:=jsonb_build_array(jsonb_build_object('id',a,'version',1),jsonb_build_object('id',b,'version',1));
  slot uuid;
begin
  if has_function_privilege('authenticated','public.scalency_accept_lot(text,uuid,text,jsonb)','execute')
    or has_table_privilege('anon','public.scalency_lot_entries','select') then raise exception 'lot_access'; end if;
  insert into auth.users(id) values(seller);
  insert into public.profiles(id,pseudo,email,role) values(seller,'qa-'||left(seller::text,8),seller::text||'@example.invalid','admin')
    on conflict(id) do update set role='admin';
  insert into public.listing_drafts(id,owner_id,fields,payload) select id,seller,
    jsonb_build_object('account_id','test-lot','sku',id::text,'title','Test'),'{"batch":{"status":"ready"}}'::jsonb from unnest(array[a,b]) id;
  update public.listing_drafts set version=2 where id=b;
  begin
    perform public.scalency_accept_lot(testlot,seller,'test-lot',selection);
    raise exception 'lot_not_atomic';
  exception when raise_exception then if sqlerrm<>'lot_changed' then raise; end if;end;
  if exists(select from public.scalency_publication_lots where id=testlot) then raise exception 'partial_lot';end if;
  update public.listing_drafts set version=1 where id=b;
  perform public.scalency_accept_lot(testlot,seller,'test-lot',selection);
  perform public.scalency_accept_lot(testlot,seller,'test-lot',selection);
  if (select count(*) from public.scalency_lot_entries where lot_id=testlot)<>2 then raise exception 'duplicate_entries';end if;
  if (select count(*) from public.listing_drafts where id in(a,b) and state='preparing' and version=2)<>2 then raise exception 'unreserved';end if;
  update public.scalency_lot_entries set token=nonce,status='sending' where draft_id=a returning id into slot;
  perform public.scalency_finish_lot_entry(slot,nonce,'queued',null,0,'123-test');
  if public.scalency_finish_lot_entry(slot,nonce,'failed','stale callback') then raise exception 'reused_ticket';end if;
  if not exists(select from public.listing_drafts where id=a and state='scheduled' and payload->>'scalency_job_id'='123-test') then raise exception 'missing_receipt';end if;
  update public.scalency_lot_entries set token=nonce,status='working' where draft_id=b returning id into slot;
  perform public.scalency_finish_lot_entry(slot,nonce,'pending','quota',42);
  if not exists(select from public.scalency_lot_entries where id=slot and next_attempt>=now()+interval '42 seconds' and token is null) then raise exception 'lost_delay';end if;
  update public.scalency_lot_entries set token=nonce,status='working' where id=slot;
  perform public.scalency_finish_lot_entry(slot,nonce,'failed','Taille manquante');
  if not exists(select from public.listing_drafts where id=b and state='draft' and version=3) then raise exception 'cannot_correct';end if;
end;
$$;
rollback;
