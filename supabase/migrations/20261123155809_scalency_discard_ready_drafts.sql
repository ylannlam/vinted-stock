-- A retired client-side ID cannot recreate a draft after a delayed upload retry.
create or replace function public.scalency_create_batch_draft(p_owner uuid,p_id uuid,p_fields jsonb,p_photos jsonb)
returns setof public.listing_drafts language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
  if exists (select 1 from public.scalency_commands where request_id='discard-draft-'||p_id::text) then
    return;
  end if;
  insert into public.listing_drafts(id,owner_id,fields,photos,payload)
    values(p_id,p_owner,p_fields,p_photos,'{"scalency_source":"stock-vinted"}'::jsonb)
    on conflict(id) do nothing;
  return query select d.* from public.listing_drafts d where d.id=p_id and d.owner_id=p_owner;
end;
$$;

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
      and d.fields->>'account_id'=p_account and d.state='draft' and d.payload->'batch'->>'status'='ready'
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
revoke all on function public.scalency_create_batch_draft(uuid,uuid,jsonb,jsonb),
  public.scalency_discard_ready_drafts(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.scalency_create_batch_draft(uuid,uuid,jsonb,jsonb),
  public.scalency_discard_ready_drafts(uuid,text,jsonb) to service_role;
