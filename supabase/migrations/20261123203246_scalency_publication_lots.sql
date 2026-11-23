create table public.scalency_publication_lots (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  account text not null,
  created_at timestamptz not null default now()
);
create index scalency_lots_owner_time on public.scalency_publication_lots(owner_id,created_at desc);

create table public.scalency_lot_entries (
  id uuid primary key default gen_random_uuid(),
  lot_id text not null references public.scalency_publication_lots(id) on delete cascade,
  position integer not null,
  draft_id uuid not null,
  reviewed_version integer not null,
  sku text not null,
  title text not null,
  size_text text,
  cover_path text,
  status text not null default 'pending' check (status in ('pending','dispatched','working','sending','queued','failed','uncertain')),
  job_id text,
  message text,
  next_attempt timestamptz not null default now(),
  token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  unique(draft_id,reviewed_version),
  unique(lot_id,position)
);
create index scalency_lot_pending on public.scalency_lot_entries(next_attempt) where status='pending';
alter table public.scalency_publication_lots enable row level security;
alter table public.scalency_lot_entries enable row level security;
revoke all on public.scalency_publication_lots,public.scalency_lot_entries from public,anon,authenticated;
grant select,insert,update,delete on public.scalency_publication_lots,public.scalency_lot_entries to service_role;

create function public.scalency_accept_lot(p_lot text,p_owner uuid,p_account text,p_entries jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare
  n integer;
begin
  if not exists (select 1 from public.profiles where id=p_owner and role='admin') then
    raise exception 'lot_forbidden';
  end if;
  n:=jsonb_array_length(p_entries);
  if n not between 1 and 100 or (select count(distinct x->>'id') from jsonb_array_elements(p_entries) x)<>n then
    raise exception 'lot_invalid';
  end if;
  insert into public.scalency_publication_lots(id,owner_id,account) values(p_lot,p_owner,p_account) on conflict do nothing;
  if not found then
    if exists(select from public.scalency_publication_lots where id=p_lot and owner_id=p_owner and account=p_account)
       and (select count(*) from jsonb_to_recordset(p_entries) x(id uuid,version integer)
         join public.scalency_lot_entries e on e.draft_id=x.id and e.reviewed_version=x.version and e.lot_id=p_lot)=n then
      return p_lot;
    end if;
    raise exception 'lot_conflict';
  end if;
  -- Lock the whole reviewed selection before recording or transmitting any part of it.
  perform d.id from public.listing_drafts d join jsonb_to_recordset(p_entries) x(id uuid,version integer) on d.id=x.id
    where d.owner_id=p_owner order by d.id for update of d;
  insert into public.scalency_lot_entries(lot_id,position,draft_id,reviewed_version,sku,title,size_text,cover_path)
    select p_lot,x.pos,d.id,d.version,d.fields->>'sku',d.fields->>'title',d.fields->>'size_text',d.photos->0->>'path'
    from jsonb_array_elements(p_entries) with ordinality x(item,pos)
    join public.listing_drafts d on d.id=(x.item->>'id')::uuid and d.version=(x.item->>'version')::integer
    where d.owner_id=p_owner and d.fields->>'account_id'=p_account and d.state='draft'
      and d.payload->'batch'->>'status'='ready' and d.payload->>'scalency_job_id' is null and d.published_at is null
      and d.vinted_id is null and d.publication_task_id is null and d.inflight is null and d.dotb_item_id is null
      and not exists(select from public.scalency_commands c where c.request_id='publish-'||encode(sha256(convert_to(d.id::text,'UTF8')),'hex'));
  if (select count(*) from public.scalency_lot_entries where lot_id=p_lot)<>n then raise exception 'lot_changed'; end if;
  update public.listing_drafts d set state='preparing',version=d.version+1,updated_at=now(),message='Lot enregistré sur Stock Vinted'
    from public.scalency_lot_entries e where e.lot_id=p_lot and e.draft_id=d.id;
  return p_lot;
end;
$$;

create function public.scalency_finish_lot_entry(p_id uuid,p_token uuid,p_status text,p_message text default null,
  p_delay integer default 60,p_job text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare
  entry public.scalency_lot_entries%rowtype;
begin
  select * into entry from public.scalency_lot_entries where id=p_id and token=p_token and status in ('working','sending') for update;
  if not found then return false; end if;
  if p_status not in ('pending','queued','failed','uncertain') or (p_status='queued' and (entry.status<>'sending' or nullif(p_job,'') is null)) then
    raise exception 'lot_invalid';
  end if;
  update public.scalency_lot_entries set status=p_status,message=left(p_message,1000),job_id=p_job,
    token=null,lease_until=null,next_attempt=now()+make_interval(secs=>greatest(1,p_delay)) where id=p_id;
  if p_status='pending' then return true; end if;
  update public.listing_drafts d set state=case p_status when 'queued' then 'scheduled' when 'failed' then 'draft' else 'attention' end,
    version=d.version+1,updated_at=now(),
    payload=case when p_status='queued' then d.payload||jsonb_build_object('scalency_job_id',p_job) else d.payload end,
    scheduled_at=case when p_status='queued' then now() else d.scheduled_at end,
    message=case when p_status='queued' then 'En file Scalency' else left(p_message,1000) end
    where d.id=entry.draft_id and d.state='preparing' and d.version=entry.reviewed_version+1;
  if not found then raise exception 'lot_changed'; end if;
  return true;
end;
$$;
revoke all on function public.scalency_accept_lot(text,uuid,text,jsonb),public.scalency_finish_lot_entry(uuid,uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.scalency_accept_lot(text,uuid,text,jsonb),public.scalency_finish_lot_entry(uuid,uuid,text,text,integer,text) to service_role;
