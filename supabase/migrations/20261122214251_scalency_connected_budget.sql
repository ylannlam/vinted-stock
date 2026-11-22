create function public.scalency_budget_income() returns jsonb language sql stable security invoker set search_path='' as $$
with sale_lines as (
  select s.id,s.title,s.sold_at,s.login,s.order_key,
    s.price-coalesce(x.fees_amount,0)-coalesce(x.refund_amount,0) as net,
    coalesce(x.id,s.id) as line_id
  from public.scalency_catalog_sales s
  left join public.scalency_order_entries e on s.order_key=e.order_id and s.login=e.login
    and s.id='scalency/'||e.login||'/'||e.order_id||'/'||e.line_id
  left join public.sales_lines x on x.id=coalesce(e.archive_line,s.id)
  where s.price is not null and s.currency='EUR'
), missing_lines as (
  select 'scalency-order/'||r.account||'/'||r.remote_id as id,r.payload->>'title' as title,r.sort_at as sold_at,r.account as login,r.remote_id as order_key,
    (r.payload->>'subtotal')::numeric as net,'scalency-order/'||r.account||'/'||r.remote_id as line_id
  from public.scalency_records r where kind='orders' and r.sort_at >= (select starts_at from public.dotb_tracking_period limit 1)
    and jsonb_array_length(r.payload->'items')=0 and r.payload->>'currency'='EUR' and r.payload->>'subtotal' ~ '^[0-9]+([.][0-9]+)?$'
    and r.payload->>'normalized_status' in ('completed','label_sent','shipped','payment_received','ready_for_pickup','delivered','packed')
    and coalesce(r.payload->>'state','') not in ('expired','cancelled','returning','suspended')
    and not exists(select 1 from public.sales_orders o join public.sales_lines l on l.order_id=o.id
      where o.transaction_id=r.payload->>'vinted_transaction_id' and lower(o.account_login)=lower(r.account) and l.source_active)
), all_sales as (select * from sale_lines union all select * from missing_lines)
select coalesce(jsonb_agg(jsonb_build_object('id','vinted-'||s.id,'line_id',s.line_id,'order_key',s.order_key,'account',s.login,
  'date',to_char(s.sold_at at time zone 'Europe/Paris','YYYY-MM-DD'),'type',case when s.net<0 then 'out' else 'in' end,
  'cat','Ventes Vinted','label',coalesce(s.title,'Article sans titre')||' · '||s.login,'amount',abs(s.net),'source','vinted')
  order by s.sold_at desc,s.id),'[]'::jsonb) from all_sales s;
$$;
revoke all on function public.scalency_budget_income() from public,anon,authenticated;
grant execute on function public.scalency_budget_income() to service_role;
CREATE OR REPLACE FUNCTION public.scalency_known_reference(p_sku text, p_supplier_id text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select (case when nullif(btrim(p_sku),'') is not null then
    exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(btrim(p_sku)))
  else exists(
    select 1 from public.catalog_products p where p.supplier_id=p_supplier_id and (
      exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(p.supplier_sku))
      or exists(select 1 from public.catalog_sku_links l join public.catalog_sales_by_sku s on s.sku=l.sku where l.product_id=p.id)))
  end)
  or (nullif(btrim(p_sku),'') is not null and (
    exists(select 1 from public.catalog_library b where lower(b.sku)=lower(btrim(p_sku)))
    or exists(select 1 from public.catalog_dotb_items d where d.present and lower(d.sku)=lower(btrim(p_sku)))))
  or (p_supplier_id is not null and (
    exists(select 1 from public.catalog_library b where b.supplier_id=p_supplier_id)
    or exists(select 1 from public.catalog_library b join public.catalog_products p on lower(p.supplier_sku)=lower(b.sku) where p.supplier_id=p_supplier_id)))
  or (nullif(trim(p_sku),'') is not null and exists(select 1 from public.scalency_sales_by_sku where lower(sku)=lower(trim(p_sku))))
  or (p_supplier_id is not null and exists(select 1 from public.scalency_physical_catalog where supplier_id=p_supplier_id))
$function$;
CREATE OR REPLACE FUNCTION public.scalency_link_catalog_sku(p_sku text, p_product uuid, p_updated timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_sku,1));
  if not public.scalency_known_reference(p_sku,null) then raise exception 'sku_missing'; end if;
  select updated_at into previous from public.catalog_sku_links where sku=p_sku for update;
  if previous is distinct from p_updated then raise exception 'link_conflict'; end if;
  insert into public.catalog_sku_links(sku,product_id) values(p_sku,p_product)
    on conflict(sku) do update set product_id=excluded.product_id,updated_at=clock_timestamp();
end; $function$;

CREATE OR REPLACE FUNCTION public.scalency_create_catalog_product_for_sku(p_sku text, p_supplier_id text, p_supplier_url text, p_updated timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare product_uuid uuid; source_item record;
begin
  if p_supplier_id !~ '^[0-9]{1,20}$' then raise exception 'supplier_invalid'; end if;
  select * into source_item from public.scalency_catalog_sales where lower(sku)=lower(p_sku) order by sold_at desc,id limit 1;
  if not found then raise exception 'sku_missing'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_supplier_id,0));
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku,photo_url)
    values(p_supplier_id,p_supplier_url,coalesce(nullif(source_item.title,''),'Produit Shein '||p_sku),p_sku,source_item.photo_url)
    on conflict(supplier_id) do nothing;
  select id into product_uuid from public.catalog_products where supplier_id=p_supplier_id;
  perform public.scalency_link_catalog_sku(p_sku,product_uuid,p_updated);
  perform public.queue_sales_sources();
  return product_uuid;
end; $function$;

revoke all on function public.scalency_known_reference(text,text),public.scalency_link_catalog_sku(text,uuid,timestamptz),public.scalency_create_catalog_product_for_sku(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.scalency_known_reference(text,text),public.scalency_link_catalog_sku(text,uuid,timestamptz),public.scalency_create_catalog_product_for_sku(text,text,text,timestamptz) to service_role;
