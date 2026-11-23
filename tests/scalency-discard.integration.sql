begin;
do $$
declare
  seller uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid();
  fields jsonb:='{"account_id":"vt-test"}';
  selection jsonb:=jsonb_build_array(jsonb_build_object('id',a,'version',1),jsonb_build_object('id',b,'version',1));
begin
  if has_function_privilege('authenticated','public.scalency_discard_ready_drafts(uuid,text,jsonb)','execute')
    or has_function_privilege('anon','public.scalency_create_batch_draft(uuid,uuid,jsonb,jsonb)','execute') then
    raise exception 'RPC exposée';
  end if;
  insert into auth.users(id) values(seller);
  insert into public.profiles(id,pseudo,email,role) values(seller,'qa-'||left(seller::text,8),seller::text||'@example.invalid','admin') on conflict(id) do nothing;
  perform public.scalency_create_batch_draft(seller,a,fields,'[]');
  perform public.scalency_create_batch_draft(seller,b,fields,'[]');
  update public.listing_drafts set payload='{"batch":{"status":"ready"}}' where id in (a,b);
  update public.listing_drafts set state='scheduled' where id=b;
  begin
    perform public.scalency_discard_ready_drafts(seller,'vt-test',selection);
    raise exception 'Une ligne déjà transmise a été retirée';
  exception when raise_exception then
    if sqlerrm<>'ready_draft_changed' then raise;end if;
  end;
  if (select count(*) from public.listing_drafts where id in(a,b))<>2 then raise exception 'Lot supprimé en partie';end if;
  update public.listing_drafts set state='draft' where id=b;
  begin
    perform public.scalency_discard_ready_drafts(gen_random_uuid(),'vt-test',selection);
    raise exception 'Suppression pour un autre propriétaire';
  exception when raise_exception then
    if sqlerrm<>'ready_draft_changed' then raise;end if;
  end;
  begin
    perform public.scalency_discard_ready_drafts(seller,'autre',selection);
    raise exception 'Suppression pour un autre compte';
  exception when raise_exception then
    if sqlerrm<>'ready_draft_changed' then raise;end if;
  end;
  begin
    perform public.scalency_discard_ready_drafts(seller,'vt-test',jsonb_build_array(jsonb_build_object('id',a,'version',9)));
    raise exception 'Suppression avec une ancienne version';
  exception when raise_exception then
    if sqlerrm<>'ready_draft_changed' then raise;end if;
  end;
  update public.listing_drafts set payload='{"batch":{"status":"running"}}' where id=a;
  begin
    perform public.scalency_discard_ready_drafts(seller,'vt-test',selection);
    raise exception 'Une génération en cours a été supprimée';
  exception when raise_exception then
    if sqlerrm<>'ready_draft_changed' then raise;end if;
  end;
  update public.listing_drafts set payload='{}' where id=a;
  insert into public.scalency_commands(request_id,owner_id,action)
    values('publish-'||encode(sha256(convert_to(a::text,'UTF8')),'hex'),seller,'publish');
  begin
    perform public.scalency_discard_ready_drafts(seller,'vt-test',selection);
    raise exception 'Un envoi en cours a été supprimé';
  exception when raise_exception then
    if sqlerrm<>'ready_draft_changed' then raise;end if;
  end;
  delete from public.scalency_commands where owner_id=seller and action='publish';
  if public.scalency_discard_ready_drafts(seller,'vt-test',selection)<>2 then raise exception 'Lot brouillon simple et annonce prête incomplet';end if;
  if public.scalency_discard_ready_drafts(seller,'vt-test',selection)<>2 then raise exception 'Reprise de suppression invalide';end if;
  perform public.scalency_create_batch_draft(seller,a,fields,'[]');
  if exists(select 1 from public.listing_drafts where id in(a,b)) then raise exception 'Brouillon recréé';end if;
end;
$$;
rollback;
