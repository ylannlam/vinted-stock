alter table public.scalency_lot_entries alter column sku drop not null;
alter table public.scalency_lot_entries drop constraint scalency_lot_entries_status_check;
alter table public.scalency_lot_entries add constraint scalency_lot_entries_status_check
  check(status in ('pending','dispatched','working','sending','queued','failed','uncertain','stopped'));

create function public.scalency_stop_lot_entry(p_owner uuid,p_draft uuid,p_version integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare entry public.scalency_lot_entries%rowtype;
begin
  select e.* into entry from public.scalency_lot_entries e join public.scalency_publication_lots l on l.id=e.lot_id
  where l.owner_id=p_owner and e.draft_id=p_draft and e.reviewed_version=p_version-1 for update of e;
  if not found then return false; end if;
  if entry.status='stopped' then return true; end if;
  if entry.status not in ('pending','dispatched','working') then return false; end if;
  update public.listing_drafts set state='draft',version=version+1,updated_at=now(),message='Mise en ligne arrêtée'
    where id=p_draft and owner_id=p_owner and state='preparing' and version=p_version and payload->>'scalency_job_id' is null;
  if not found then return false; end if;
  update public.scalency_lot_entries set status='stopped',message='Mise en ligne arrêtée. Le brouillon est conservé.',
    token=null,lease_until=null where id=entry.id;
  return true;
end;
$$;
revoke all on function public.scalency_stop_lot_entry(uuid,uuid,integer) from public, anon, authenticated;
grant execute on function public.scalency_stop_lot_entry(uuid,uuid,integer) to service_role;

CREATE OR REPLACE FUNCTION public.scalency_discard_ready_drafts(p_owner uuid, p_account text, p_drafts jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
      and d.fields->>'account_id'=p_account and d.state='draft' and coalesce(d.payload->'batch'->>'status','draft') in ('draft','ready','review','error','running')
      and not exists(select from public.scalency_commands c where c.request_id='publish-'||encode(sha256(convert_to(d.id::text,'UTF8')),'hex'))
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
$function$;
