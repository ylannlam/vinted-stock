create table public.scalency_records (
  kind text not null check (kind in ('accounts','items','orders','jobs','conversations')),
  account text not null default '',
  remote_id text not null,
  payload jsonb not null,
  sort_at timestamptz,
  seen_at timestamptz not null default now(),
  primary key (kind, account, remote_id)
);
create index scalency_recent on public.scalency_records(kind, sort_at desc nulls last,remote_id);
create index scalency_item_id on public.scalency_records(kind, remote_id);
create table public.scalency_links (
  account text not null,
  listing text not null,
  item_id uuid not null references public.items(id),
  primary key(account,listing)
);
create index scalency_links_stock on public.scalency_links(item_id);
create table public.scalency_commands (
  request_id text primary key,
  owner_id uuid not null,
  action text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create table public.scalency_sync (
  kind text primary key,
  cursor_value text,
  updated_at timestamptz not null default now(),
  complete boolean not null default false
);
create table public.scalency_settings (id text primary key, value jsonb not null);
alter table public.scalency_records enable row level security;
alter table public.scalency_links enable row level security;
alter table public.scalency_commands enable row level security;
alter table public.scalency_sync enable row level security;
alter table public.scalency_settings enable row level security;
revoke all on public.scalency_records,public.scalency_links,public.scalency_commands,public.scalency_sync,public.scalency_settings from public,anon,authenticated;
grant all on public.scalency_records,public.scalency_links,public.scalency_commands,public.scalency_sync,public.scalency_settings to service_role;

create view public.scalency_inventory with (security_invoker=true) as
select r.*, l.item_id, i.category, i.size, i.emplacement, i.status as physical_status,
       coalesce(i.photo_url,r.payload->>'photo_url') as photo,
       coalesce(nullif(r.payload->>'supplier_link',''),i.shein_url) as supplier_url,
       exists (
         select 1 from public.scalency_links sibling
         join public.scalency_records sale on sale.kind='items' and sale.account=sibling.account and sale.remote_id=sibling.listing
         where sibling.item_id=l.item_id and sale.payload->>'sold'='true'
       ) as linked_sale
from public.scalency_records r
left join public.scalency_links l on l.account=r.account and l.listing=r.remote_id
left join public.items i on i.id=l.item_id and i.deleted_at is null
where r.kind='items';
revoke all on public.scalency_inventory from public,anon,authenticated;
grant select on public.scalency_inventory to service_role;
