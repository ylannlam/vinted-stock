create or replace view public.scalency_order_entries with(security_invoker=true) as
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
        (nullif(line->>'vinted_id','') is null and ((lower(coalesce(l.sku_override,l.source->>'sku'))=lower(line->>'sku') and (select count(*) from jsonb_array_elements(r.payload->'items') z where lower(z->>'sku')=lower(line->>'sku'))=1) or
         (jsonb_array_length(r.payload->'items')=1 and (select count(*) from public.sales_lines sl where sl.order_id=oh.order_id)=1))))
  having count(*)=1
) match on true
left join public.sales_lines old on old.id=match.id
where r.kind='orders';

create or replace view public.scalency_catalog_inventory with(security_invoker=true) as
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
select f.*,p.id as product_id,p.title as product_title,p.supplier_url as catalog_url,
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
left join public.catalog_products p on p.id=chosen.product_id and (public.scalency_supplier_id(f.source_url) is null or p.supplier_id=public.scalency_supplier_id(f.source_url));


create view public.scalency_order_products with(security_invoker=true) as
select e.*,p.id as product_id from public.scalency_order_entries e
left join public.scalency_product_keys k on k.sku=lower(trim(e.sku))
left join public.catalog_products u on u.supplier_id=public.scalency_supplier_id(e.supplier_url)
left join public.catalog_products p on p.id=coalesce(k.product_id,u.id)
  and (k.product_id is null or u.id is null or k.product_id=u.id)
  and (public.scalency_supplier_id(e.supplier_url) is null or p.supplier_id=public.scalency_supplier_id(e.supplier_url));
create view public.scalency_physical_catalog with(security_invoker=true) as
select i.id,i.category,i.size,i.emplacement,i.status,i.photo_url,i.shein_url,
       public.scalency_supplier_id(i.shein_url) as supplier_id,p.id as product_id
from public.items i left join public.catalog_products p on p.supplier_id=public.scalency_supplier_id(i.shein_url)
where i.deleted_at is null;
revoke all on public.scalency_order_products,public.scalency_physical_catalog from public,anon,authenticated;
grant select on public.scalency_order_products,public.scalency_physical_catalog to service_role;

create function public.scalency_set_piece(p_account text,p_listing text,p_item uuid,p_previous uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare existing uuid;
begin
  perform 1 from public.scalency_records where kind='items' and account=p_account and remote_id=p_listing for update;
  if not found then raise exception 'listing_missing'; end if;
  select item_id into existing from public.scalency_links where account=p_account and listing=p_listing for update;
  if existing is not distinct from p_item then return; end if;
  if existing is distinct from p_previous then raise exception 'link_changed'; end if;
  if p_item is null then
    insert into public.scalency_link_blocks values(p_account,p_listing) on conflict do nothing;
    delete from public.scalency_links where account=p_account and listing=p_listing;
  else
    if not exists(select 1 from public.items where id=p_item and deleted_at is null) then raise exception 'piece_missing'; end if;
    insert into public.scalency_links(account,listing,item_id,origin) values(p_account,p_listing,p_item,'manual')
    on conflict(account,listing) do update set item_id=excluded.item_id,origin='manual';
    delete from public.scalency_link_blocks where account=p_account and listing=p_listing;
  end if;
end $$;
revoke all on function public.scalency_set_piece(text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.scalency_set_piece(text,text,uuid,uuid) to service_role;

create function public.scalency_attach_published_draft() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.stock_item_id is not null and new.vinted_id is not null and nullif(new.fields->>'account_id','') is not null then
    insert into public.scalency_links(account,listing,item_id,origin)
    select new.fields->>'account_id',new.vinted_id,new.stock_item_id,'draft'
    where not exists(select 1 from public.scalency_link_blocks where account=new.fields->>'account_id' and listing=new.vinted_id)
    on conflict(account,listing) do nothing;
  end if;
  return new;
end $$;
create trigger scalency_attach_draft after insert or update of vinted_id,stock_item_id on public.listing_drafts
for each row when(new.vinted_id is not null and new.stock_item_id is not null) execute function public.scalency_attach_published_draft();

create function public.scalency_keep_latest() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.seen_at<old.seen_at then return old; end if;
  if new.kind in ('items','jobs') and new.sort_at<old.sort_at then return old; end if;
  return new;
end $$;
create trigger scalency_keep_latest before update on public.scalency_records for each row execute function public.scalency_keep_latest();
create index if not exists scalency_physical_product on public.items(public.scalency_supplier_id(shein_url)) where deleted_at is null;
create index if not exists scalency_legacy_transaction on public.sales_orders(transaction_id,lower(account_login));
