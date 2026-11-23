create or replace function public.scalency_discard_ready_drafts(p_owner uuid,p_account text,p_drafts jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  item record;
  receipt text;
  count_removed integer := 0;
begin
  -- Take locks in the same order for overlapping selections. A conflict rolls back the whole lot.
  for item in select * from jsonb_to_recordset(p_drafts) as d(id uuid,version integer) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(item.id::text,0));
    receipt := 'discard-draft-'||item.id::text;
    delete from public.listing_drafts d
      where d.id=item.id and d.owner_id=p_owner and d.version=item.version
      and d.fields->>'account_id'=p_account and d.state='draft'
      and coalesce(d.payload->'batch'->>'status','draft') in ('draft','ready','review','error')
      and not exists (select 1 from public.scalency_commands c
        where c.request_id='publish-'||encode(sha256(convert_to(d.id::text,'UTF8')),'hex'))
      and d.payload->>'scalency_job_id' is null and d.publication_task_id is null
      and d.vinted_id is null and d.dotb_item_id is null and d.inflight is null and d.published_at is null;
    if found then
      insert into public.scalency_commands(request_id,owner_id,action,result)
        values(receipt,p_owner,'discard-draft',jsonb_build_object('account',p_account,'version',item.version));
    elsif not exists (select 1 from public.scalency_commands c where c.request_id=receipt and c.owner_id=p_owner
      and c.result=jsonb_build_object('account',p_account,'version',item.version)) then
      raise exception using message='ready_draft_changed',errcode='P0001';
    end if;
    count_removed := count_removed+1;
  end loop;
  return count_removed;
end;
$$;
