begin;
create table public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  supplier_id text not null unique check (supplier_id ~ '^[0-9]{1,20}$'),
  supplier_url text not null,
  title text not null check (length(title) between 1 and 500),
  supplier_sku text, photo_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp()
);
create table public.catalog_observations (
  id uuid primary key, product_id uuid not null references public.catalog_products(id),
  price numeric(10,2) check (price > 0 and price < 100000), currency text not null check (currency='EUR'),
  size text not null default '' check (length(size)<=80), color text not null default '' check (length(color)<=100),
  availability text not null check (availability in ('unknown','available','unavailable')),
  source text not null check (source in ('manual','extension_reviewed')),
  observed_at timestamptz not null, note text check (length(note)<=500),
  created_at timestamptz not null default clock_timestamp(), created_by uuid references auth.users(id),
  check (availability='unknown' or (size<>'' and color<>''))
);
create index catalog_observations_latest on public.catalog_observations(product_id, observed_at desc, created_at desc);
create index catalog_observations_variant on public.catalog_observations(product_id, lower(size), lower(color), observed_at desc) where price is not null;
create index catalog_observations_author on public.catalog_observations(created_by);
create table public.catalog_dotb_items (
  id uuid primary key, sku text, title text, account_id uuid, status text,
  supplier_url text, supplier_id text, supplier_canonical_url text,
  price numeric(12,2), currency text, photo_url text, synced_at timestamptz not null
);
create index catalog_dotb_items_sku on public.catalog_dotb_items(sku) where sku is not null;
create table public.catalog_sku_links (
  sku text primary key check (length(sku) between 1 and 200 and sku=btrim(sku)),
  product_id uuid references public.catalog_products(id),
  updated_at timestamptz not null default clock_timestamp()
);
create index catalog_sku_links_product on public.catalog_sku_links(product_id);
create table public.catalog_sync_state (
  id boolean primary key default true check (id), cursor text, processed integer not null default 0,
  last_completed_at timestamptz, lease uuid, locked_until timestamptz not null default '-infinity',
  next_allowed_at timestamptz not null default '-infinity'
);
insert into public.catalog_sync_state(id) values(true);

alter table public.catalog_products enable row level security;
alter table public.catalog_observations enable row level security;
alter table public.catalog_dotb_items enable row level security;
alter table public.catalog_sku_links enable row level security;
alter table public.catalog_sync_state enable row level security;
revoke all on public.catalog_products,public.catalog_observations,public.catalog_dotb_items,public.catalog_sku_links,public.catalog_sync_state from public,anon,authenticated;
grant select on public.catalog_products,public.catalog_observations,public.catalog_dotb_items,public.catalog_sku_links to authenticated;
grant all on public.catalog_products,public.catalog_observations,public.catalog_dotb_items,public.catalog_sku_links,public.catalog_sync_state to service_role;
create policy catalog_products_read on public.catalog_products for select to authenticated using
  (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','stock')));
create policy catalog_observations_read on public.catalog_observations for select to authenticated using
  (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','stock')));
create policy catalog_dotb_items_read on public.catalog_dotb_items for select to authenticated using
  (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','stock')));
create policy catalog_sku_links_read on public.catalog_sku_links for select to authenticated using
  (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role in ('admin','stock')));

create view public.catalog_product_summary with (security_invoker=true) as
select p.*, o.price,o.currency,o.size,o.color,o.availability,o.observed_at,o.source,
  prev.price as previous_price, prev.observed_at as previous_observed_at,
  (select count(*) from public.catalog_sku_links l where l.product_id=p.id) as linked_skus
from public.catalog_products p
left join lateral (select * from public.catalog_observations obs where obs.product_id=p.id
  order by obs.observed_at desc,obs.created_at desc,obs.id desc limit 1) o on true
left join lateral (select obs.price,obs.observed_at from public.catalog_observations obs
  where obs.product_id=p.id and obs.price is not null and obs.currency=o.currency
  and lower(obs.size)=lower(o.size) and lower(obs.color)=lower(o.color)
  and (obs.observed_at,obs.created_at,obs.id)<(o.observed_at,o.created_at,o.id)
  order by obs.observed_at desc,obs.created_at desc,obs.id desc limit 1) prev on true;
revoke all on public.catalog_product_summary from public,anon,authenticated;
grant select on public.catalog_product_summary to authenticated,service_role;

create function public.record_catalog_observation(p_product jsonb,p_observation jsonb,p_user uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare product_uuid uuid; existing_product uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product->>'supplier_id',0));
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku,photo_url)
    values(p_product->>'supplier_id',p_product->>'supplier_url',p_product->>'title',p_product->>'supplier_sku',p_product->>'photo_url')
    on conflict(supplier_id) do update set supplier_sku=coalesce(catalog_products.supplier_sku,excluded.supplier_sku),
      photo_url=coalesce(catalog_products.photo_url,excluded.photo_url);
  select id into product_uuid from public.catalog_products where supplier_id=p_product->>'supplier_id';
  select product_id into existing_product from public.catalog_observations where id=(p_observation->>'id')::uuid;
  if found then
    if existing_product<>product_uuid then raise exception 'capture_conflict'; end if;
    return product_uuid;
  end if;
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at,note,created_by)
    values((p_observation->>'id')::uuid,product_uuid,(p_observation->>'price')::numeric,p_observation->>'currency',
      p_observation->>'size',p_observation->>'color',p_observation->>'availability',p_observation->>'source',
      (p_observation->>'observed_at')::timestamptz,p_observation->>'note',p_user);
  return product_uuid;
end; $$;

create function public.link_catalog_sku(p_sku text,p_product uuid,p_updated timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare previous timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_sku,1));
  if not exists(select 1 from public.catalog_dotb_items where sku=p_sku) then raise exception 'sku_missing'; end if;
  select updated_at into previous from public.catalog_sku_links where sku=p_sku for update;
  if previous is distinct from p_updated then raise exception 'link_conflict'; end if;
  insert into public.catalog_sku_links(sku,product_id) values(p_sku,p_product)
    on conflict(sku) do update set product_id=excluded.product_id,updated_at=clock_timestamp();
end; $$;

create function public.import_catalog_dotb_page(p_items jsonb,p_cursor text,p_lease uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.catalog_sync_state where id and lease=p_lease and locked_until>now() for update;
  if not found then raise exception 'sync_lease_expired'; end if;
  insert into public.catalog_dotb_items(id,sku,title,account_id,status,supplier_url,supplier_id,supplier_canonical_url,price,currency,photo_url,synced_at)
    select x.id,x.sku,x.title,x.account_id,x.status,x.supplier_url,x.supplier_id,x.supplier_canonical_url,x.price,x.currency,x.photo_url,x.synced_at
    from jsonb_to_recordset(p_items) as x(id uuid,sku text,title text,account_id uuid,status text,supplier_url text,supplier_id text,supplier_canonical_url text,price numeric,currency text,photo_url text,synced_at timestamptz)
    on conflict(id) do update set sku=excluded.sku,title=excluded.title,account_id=excluded.account_id,status=excluded.status,
      supplier_url=excluded.supplier_url,supplier_id=excluded.supplier_id,supplier_canonical_url=excluded.supplier_canonical_url,
      price=excluded.price,currency=excluded.currency,photo_url=excluded.photo_url,synced_at=excluded.synced_at;
  -- Only link unambiguous, complete SKU groups after every page has been imported.
  -- Never infer a supplier price from the Dotb selling price, or overwrite a manual link.
  if p_cursor is null then
    insert into public.catalog_products(supplier_id,supplier_url,title,photo_url)
      select distinct on (d.supplier_id) d.supplier_id,d.supplier_canonical_url,coalesce(nullif(d.title,''),'Produit Shein '||d.supplier_id),d.photo_url
      from public.catalog_dotb_items d where d.sku is not null and d.supplier_id is not null
      order by d.supplier_id,d.synced_at desc,d.id
      on conflict(supplier_id) do nothing;
    insert into public.catalog_sku_links(sku,product_id)
      select g.sku,p.id from (
        select sku,min(supplier_id) as supplier_id from public.catalog_dotb_items where sku is not null
        group by sku having count(distinct supplier_id)=1 and count(*)=count(supplier_id)
      ) g join public.catalog_products p on p.supplier_id=g.supplier_id
      on conflict(sku) do nothing;
  end if;
  update public.catalog_sync_state set cursor=p_cursor,processed=processed+jsonb_array_length(p_items),
    last_completed_at=case when p_cursor is null then now() else last_completed_at end,
    locked_until='-infinity',lease=null,next_allowed_at=now()+interval '1.5 seconds' where id;
end; $$;
revoke all on function public.record_catalog_observation(jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.import_catalog_dotb_page(jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.link_catalog_sku(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.record_catalog_observation(jsonb,jsonb,uuid) to service_role;
grant execute on function public.import_catalog_dotb_page(jsonb,text,uuid) to service_role;
grant execute on function public.link_catalog_sku(text,uuid,timestamptz) to service_role;
commit;
