alter table public.listing_drafts
  add column stock_item_id uuid references public.items(id) on delete set null,
  add column catalog_product_id uuid references public.catalog_products(id) on delete set null;
alter table public.scalency_links add column origin text not null default 'manual';
create table public.scalency_link_blocks (
  account text not null, listing text not null, primary key(account,listing)
);
create table public.scalency_thread_items (
  account text not null, thread text not null, listing text not null, primary key(account,thread)
);
alter table public.scalency_thread_items enable row level security;
alter table public.scalency_link_blocks enable row level security;
revoke all on public.scalency_thread_items,public.scalency_link_blocks from public,anon,authenticated;
grant all on public.scalency_thread_items,public.scalency_link_blocks to service_role;
create index scalency_thread_listing on public.scalency_thread_items(account,listing);
create index scalency_draft_listing on public.listing_drafts((fields->>'account_id'),vinted_id) where vinted_id is not null;
create index scalency_login on public.scalency_records(lower(payload->>'login')) where kind='accounts';

create function public.scalency_supplier_id(link text) returns text
language sql immutable strict parallel safe set search_path='' as $$
  select (regexp_match(split_part(split_part(lower(trim(link)),'?',1),'#',1),
    '^https?://([a-z0-9-]+[.])*shein[.]com/[^?#]*-p-([0-9]+)([.]html)?/?$'))[2]
$$;
create view public.scalency_product_keys with(security_invoker=true) as
select sku,min(product_id::text)::uuid as product_id from (
  select lower(trim(supplier_sku)) as sku,id as product_id from public.catalog_products
  union all select lower(trim(sku)),product_id from public.catalog_sku_links
) refs where sku<>'' and product_id is not null group by sku having count(distinct product_id)=1;

create view public.scalency_order_entries with(security_invoker=true) as
select r.remote_id as order_id,r.account as login,a.account_id,r.payload->>'title' as order_title,
       r.payload->>'normalized_status' as order_status,r.sort_at as order_date,
       line->>'id' as line_id,coalesce(nullif(line->>'vinted_id',''),old.source->>'vinted_id') as listing,
       coalesce(nullif(old.sku_override,''),nullif(line->>'sku',''),old.source->>'sku') as sku,
       coalesce(nullif(line->>'supplier_link',''),old.source->>'supplier_link',old.source->>'shein_url') as supplier_url,
       coalesce(nullif(old.supplier_size,''),old.source->>'size_label') as size_text,
       old.id as archive_line
from public.scalency_records r
cross join lateral jsonb_array_elements(coalesce(r.payload->'items','[]')) line
left join lateral (
  select min(x.remote_id) as account_id from public.scalency_records x
  where x.kind='accounts' and (x.remote_id=r.account or lower(x.payload->>'login')=lower(r.account))
  having count(*)=1
) a on true
left join lateral (
  select min(o.id::text)::uuid as order_id from public.sales_orders o
  where o.transaction_id=r.payload->>'vinted_transaction_id' and lower(o.account_login)=lower(r.account)
  having count(*)=1
) oh on true
left join lateral (
  select min(l.id) as id from public.sales_lines l where l.order_id=oh.order_id
    and (l.source->>'vinted_id'=line->>'vinted_id' or
        (nullif(line->>'vinted_id','') is null and (lower(coalesce(l.sku_override,l.source->>'sku'))=lower(line->>'sku') or
         (jsonb_array_length(r.payload->'items')=1 and (select count(*) from public.sales_lines sl where sl.order_id=oh.order_id)=1))))
  having count(*)=1
) match on true
left join public.sales_lines old on old.id=match.id
where r.kind='orders';

create view public.scalency_catalog_inventory with(security_invoker=true) as
with sales as (
  select account_id,listing,
    case when count(distinct lower(trim(sku)))=1 then min(sku) end as sku,
    case when count(distinct public.scalency_supplier_id(supplier_url))=1 then min(supplier_url) filter(where public.scalency_supplier_id(supplier_url) is not null) end as supplier_url,
    case when count(distinct lower(trim(size_text)))=1 then min(size_text) end as size_text
  from public.scalency_order_entries
  where listing is not null and account_id is not null group by account_id,listing
), facts as (
  select i.*,d.id as draft_id,d.catalog_product_id,
    coalesce(nullif(trim(i.payload->>'sku'),''),nullif(d.fields->>'sku',''),s.sku) as resolved_sku,
    coalesce(nullif(d.fields->>'size_text',''),s.size_text) as listed_size,
    coalesce(nullif(i.supplier_url,''),s.supplier_url) as source_url
  from public.scalency_inventory i
  left join lateral (
    select min(id::text)::uuid id from public.listing_drafts
    where vinted_id=i.remote_id and fields->>'account_id'=i.account having count(*)=1
  ) one on true
  left join public.listing_drafts d on d.id=one.id
  left join sales s on s.account_id=i.account and s.listing=i.remote_id
)
select f.*,chosen.product_id,p.title as product_title,p.supplier_url as catalog_url,
       coalesce(public.scalency_supplier_id(f.source_url),p.supplier_id) as supplier_id
from facts f
left join public.scalency_product_keys k on k.sku=lower(trim(f.resolved_sku))
left join lateral (
  select min(id::text)::uuid as id from public.catalog_products where supplier_id=public.scalency_supplier_id(f.source_url) having count(*)=1
) by_url on true
left join lateral (
  select min(x::text)::uuid as product_id from unnest(array[k.product_id,by_url.id,f.catalog_product_id]) x
  where x is not null having count(distinct x)=1
) chosen on true
left join public.catalog_products p on p.id=chosen.product_id;

create function public.scalency_connect_pieces() returns integer
language plpgsql security invoker set search_path='' as $$
declare result integer; matched integer;
begin
  insert into public.scalency_links(account,listing,item_id,origin)
  select d.fields->>'account_id',d.vinted_id,min(d.stock_item_id::text)::uuid,'draft'
  from public.listing_drafts d where d.vinted_id is not null and d.stock_item_id is not null and nullif(d.fields->>'account_id','') is not null
    and not exists(select 1 from public.scalency_link_blocks b where b.account=d.fields->>'account_id' and b.listing=d.vinted_id)
  group by d.fields->>'account_id',d.vinted_id having count(distinct d.stock_item_id)=1
  on conflict(account,listing) do nothing;
  get diagnostics result=row_count;
  insert into public.scalency_links(account,listing,item_id,origin)
  select a.account,a.remote_id,min(i.id::text)::uuid,'supplier_size_location'
  from public.scalency_catalog_inventory a join public.items i
    on public.scalency_supplier_id(i.shein_url)=a.supplier_id
   and lower(trim(i.size))=lower(trim(a.listed_size))
   and lower(trim(i.emplacement))=lower(trim(a.payload->>'location'))
  where a.item_id is null and a.payload->>'status'='active' and a.payload->>'sold'='false'
    and i.deleted_at is null and i.status='en_stock' and nullif(trim(a.listed_size),'') is not null
    and nullif(trim(i.emplacement),'') is not null
    and not exists(select 1 from public.scalency_link_blocks b where b.account=a.account and b.listing=a.remote_id)
  group by a.account,a.remote_id having count(*)=1 on conflict(account,listing) do nothing;
  get diagnostics matched=row_count;
  return result+matched;
end $$;

revoke all on public.scalency_product_keys,public.scalency_order_entries,public.scalency_catalog_inventory from public,anon,authenticated;
grant select on public.scalency_product_keys,public.scalency_order_entries,public.scalency_catalog_inventory to service_role;
revoke all on function public.scalency_connect_pieces() from public,anon,authenticated;
grant execute on function public.scalency_connect_pieces() to service_role;
