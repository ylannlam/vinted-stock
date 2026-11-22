create function public.scalency_import_references() returns integer
language plpgsql security invoker set search_path='' as $$
declare inserted integer;
begin
  with refs as (
    select shein_url url, null::text sku, category title, photo_url photo from public.items where deleted_at is null and status='en_stock'
    union all select payload->>'supplier_link', payload->>'sku',payload->>'title',payload->>'photo_url'
      from public.scalency_records where kind='items'
    union all select l->>'supplier_link',l->>'sku',l->>'title',l->>'thumbnail'
      from public.scalency_records r cross join lateral jsonb_array_elements(r.payload->'items') l where kind='orders'
  ), canonical as (
    select public.scalency_supplier_id(url) supplier_id, nullif(trim(sku),'') sku,title,photo from refs
  ), grouped as (
    select supplier_id,case when count(distinct lower(sku))=1 then min(sku) end sku,
      coalesce((array_agg(nullif(trim(title),'') order by length(title) desc nulls last) filter(where nullif(trim(title),'') is not null))[1],'Article fournisseur '||supplier_id) title,
      min(photo) filter(where photo ~ '^https://') photo
    from canonical where supplier_id is not null and length(supplier_id)<=20 group by supplier_id
  )
  insert into public.catalog_products(supplier_id,supplier_url,supplier_sku,title,photo_url,auto_collect,next_check_at)
  select supplier_id,'https://fr.shein.com/product-p-'||supplier_id||'.html',sku,left(title,500),photo,false,null from grouped
  on conflict(supplier_id) do nothing;
  get diagnostics inserted=row_count;
  update public.listing_drafts d set catalog_product_id=k.product_id
  from public.scalency_product_keys k
  where d.catalog_product_id is null and lower(trim(d.fields->>'sku'))=k.sku and d.stock_item_id is null;
  return inserted;
end $$;
revoke all on function public.scalency_import_references() from public,anon,authenticated;
grant execute on function public.scalency_import_references() to service_role;

create view public.scalency_catalog_sales with(security_invoker=true) as
with current_sales as (
  select r.remote_id,r.account,r.payload,r.sort_at from public.scalency_records r
  where kind='orders' and sort_at >= (select starts_at from public.dotb_tracking_period limit 1)
), live as (
  select 'scalency/'||r.account||'/'||r.remote_id||'/'||(l->>'id') id,
    coalesce(nullif(trim(e.sku),''),inv.resolved_sku) sku,l->>'title' title,
    coalesce(p.supplier_url,e.supplier_url,inv.source_url) supplier_url,
    coalesce(p.supplier_id,public.scalency_supplier_id(e.supplier_url),inv.supplier_id) supplier_id,
    l->>'thumbnail' photo_url,case when l->>'selling_price' ~ '^[0-9]+([.][0-9]+)?$' then (l->>'selling_price')::numeric end price,
    coalesce(r.payload->>'currency','EUR') currency,r.sort_at sold_at,r.remote_id order_key,r.account login,
    coalesce(cost.actual_cost,h.actual_cost) actual_cost
  from current_sales r cross join lateral jsonb_array_elements(r.payload->'items') l
  left join public.scalency_order_products e on e.order_id=r.remote_id and e.login=r.account and e.line_id=l->>'id'
  left join public.scalency_catalog_inventory inv on inv.account=e.account_id and inv.remote_id=e.listing
  left join public.catalog_products p on p.id=coalesce(e.product_id,inv.product_id)
  left join public.scalency_sale_costs cost on cost.order_id=r.remote_id and cost.line_id=l->>'id'
  left join public.sales_lines h on h.id=e.archive_line
  where r.payload->>'normalized_status' in ('completed','label_sent','shipped','payment_received','ready_for_pickup','delivered','packed')
    and coalesce(r.payload->>'state','') not in ('expired','cancelled','returning','suspended')
), unmatched_history as (
  select h.*,l.actual_cost,o.account_login login from public.catalog_sales_items h join public.sales_lines l on l.id=h.id
  join public.sales_orders o on o.id=l.order_id
  where not exists(select 1 from current_sales r where o.transaction_id=r.payload->>'vinted_transaction_id'
    and lower(r.account)=lower(o.account_login)
    and (jsonb_array_length(r.payload->'items')>0 or r.payload->>'normalized_status' in ('cancelled','returning','suspended') or r.payload->>'state'='expired'))
)
select id,sku,title,supplier_url,supplier_id,supplier_url as supplier_canonical_url,
  case when supplier_url is null then 'missing' else 'valid' end as supplier_link_status,
  photo_url,price,currency,'Vendu'::text status,sold_at,order_key,login,actual_cost from live
union all
select id,sku,title,supplier_url,supplier_id,supplier_canonical_url,supplier_link_status,
  photo_url,price,currency,status,sold_at,null::text,login,actual_cost from unmatched_history;
create view public.scalency_sales_by_sku with(security_invoker=true) as
  select sku,currency,count(*) quantity,count(price) known_prices,sum(price) revenue,max(sold_at) last_sale
  from public.scalency_catalog_sales where nullif(trim(sku),'') is not null group by sku,currency;
create view public.scalency_posted_catalog with(security_invoker=true) as
select i.remote_id id,i.account account_id,ac.payload->>'login' account_login,i.resolved_sku sku,
  i.payload->>'title' title,i.payload->>'status' status,i.payload->>'photo_url' photo_url,
  case when i.payload->>'price' ~ '^[0-9]+([.][0-9]+)?$' then (i.payload->>'price')::numeric end price,
  coalesce(i.catalog_url,i.source_url) supplier_url,i.sort_at synced_at,i.product_id
from public.scalency_catalog_inventory i left join public.scalency_records ac on ac.kind='accounts' and ac.remote_id=i.account
where i.payload->>'status'='active' and i.payload->>'sold'='false';
create view public.scalency_product_library with(security_invoker=true) as
select p.*,m.category,m.sale_price,
  (exists(select 1 from public.scalency_order_products o where o.product_id=p.id and o.order_status not in ('cancelled','returning','suspended')) or coalesce(h.sold,false)) sold,
  h.added_at from public.catalog_product_summary p left join public.catalog_product_meta m on m.product_id=p.id left join public.catalog_library_products h on h.id=p.id;
revoke all on public.scalency_catalog_sales,public.scalency_sales_by_sku,public.scalency_posted_catalog,public.scalency_product_library from public,anon,authenticated;
grant select on public.scalency_catalog_sales,public.scalency_sales_by_sku,public.scalency_posted_catalog,public.scalency_product_library to service_role;
