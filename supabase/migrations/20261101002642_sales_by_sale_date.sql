begin;
-- Fixed business start: 31 October at midnight in Paris, not a rolling "yesterday".
create or replace view public.dotb_tracking_period with(security_invoker=true) as
select '2026-10-31 00:00:00 Europe/Paris'::timestamptz as starts_at,'Europe/Paris'::text as time_zone;

-- Legacy classification columns remain for compatibility but no longer filter catalogue data.
alter table public.catalog_dotb_items alter column tracking_status set default 'included';
create or replace view public.catalog_tracked_items with(security_invoker=true) as
select * from public.catalog_dotb_items;
create or replace view public.catalog_tracked_links with(security_invoker=true) as
select * from public.catalog_sku_links;
create or replace view public.catalog_tracked_products with(security_invoker=true) as
select * from public.catalog_product_summary;

-- Preserve the view's shape for older clients; only the sale date determines inclusion.
create or replace view public.sales_line_tracking with(security_invoker=true) as
select l.id,case when o.order_date >= (select starts_at from public.dotb_tracking_period)
  then 'included' else 'excluded' end::text as tracking_status
from public.sales_lines l join public.sales_orders o on o.id=l.order_id;

create or replace view public.catalog_sales_by_sku with(security_invoker=true) as
select btrim(coalesce(l.sku_override,l.source->>'sku','')) as sku,o.currency,
  count(*) as quantity,count(nullif(l.source->>'selling_price','')) as known_prices,
  sum(nullif(l.source->>'selling_price','')::numeric) as revenue,max(o.order_date) as last_sale
from public.sales_lines l join public.sales_orders o on o.id=l.order_id
where l.source_active and o.order_date>=(select starts_at from public.dotb_tracking_period)
  and o.status is not null and o.status not in ('cancelled','returning','suspended')
  and btrim(coalesce(l.sku_override,l.source->>'sku',''))<>''
group by btrim(coalesce(l.sku_override,l.source->>'sku','')),o.currency;

create or replace function public.upsert_sales_snapshot(p_orders jsonb,p_lines jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.sales_orders; accepted uuid;
begin
  for o in select * from jsonb_populate_recordset(null::public.sales_orders,p_orders) order by id loop
    accepted:=null;
    insert into public.sales_orders values(o.*)
      on conflict(id) do update set account_id=excluded.account_id,account_login=excluded.account_login,
        transaction_id=excluded.transaction_id,status=excluded.status,currency=excluded.currency,
        order_date=excluded.order_date,deadline=excluded.deadline,label_url=excluded.label_url,
        tracking_code=excluded.tracking_code,synced_at=excluded.synced_at
      where sales_orders.synced_at<=excluded.synced_at returning id into accepted;
    if accepted is null then continue; end if;
    update public.sales_lines set source_active=false where order_id=o.id;
    insert into public.sales_lines(id,order_id,dotb_item_id,source)
      select x.id,x.order_id,x.dotb_item_id,x.source from jsonb_to_recordset(p_lines) x(id text,order_id uuid,dotb_item_id uuid,source jsonb)
      where x.order_id=o.id
      on conflict(id) do update set source=excluded.source,source_active=true,
        updated_at=case when sales_lines.source is distinct from excluded.source then clock_timestamp() else sales_lines.updated_at end;
    -- Only a sale in the tracked period can introduce a listing into the catalogue.
    if o.order_date >= (select starts_at from public.dotb_tracking_period) then
    insert into public.catalog_dotb_items(id,sku,title,account_id,status,photo_url,synced_at)
      select distinct on (l.source->>'dotb_listing_id') (l.source->>'dotb_listing_id')::uuid,
        nullif(btrim(l.source->>'sku'),''),l.source->>'title',null,'imported',l.source->>'thumbnail_url',o.synced_at
      from public.sales_lines l where l.order_id=o.id and l.source_active and nullif(l.source->>'dotb_listing_id','') is not null
      on conflict(id) do nothing;
    end if;
  end loop;
end; $$;


create or replace function public.queue_sales_sources(p_order_ids uuid[] default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare refs jsonb;
begin
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select distinct 'sku:'||btrim(coalesce(l.sku_override,l.source->>'sku')) as reference_key,
      coalesce(p.supplier_url,l.source->>'shein_url',d.supplier_canonical_url,btrim(coalesce(l.sku_override,l.source->>'sku'))) as input,
      btrim(coalesce(l.sku_override,l.source->>'sku')) as expected_sku,
      coalesce((select supplier_id from public.catalog_products where id=p.product_id),l.source->>'shein_id',d.supplier_id) as expected_supplier_id
    from public.sales_lines_in_period l
    left join public.sales_supplier_details p on p.sku=btrim(coalesce(l.sku_override,l.source->>'sku'))
    left join public.catalog_dotb_items d on d.id::text=l.source->>'dotb_listing_id'
    where l.source_active and l."order"->>'status' is not null
      and l."order"->>'status' not in ('cancelled','returning','suspended','shipped','ready_for_pickup','delivered','completed')
      and l.stage='to_order' and (p_order_ids is null or l.order_id=any(p_order_ids))
      and btrim(coalesce(l.sku_override,l.source->>'sku')) ~ '^[A-Za-z0-9_-]{1,200}$'
      and (p.observed_at is null or p.observed_at<now()-interval '6 hours')
      and not exists(select 1 from public.catalog_collection_jobs job
        where (lower(job.expected_sku)=lower(btrim(coalesce(l.sku_override,l.source->>'sku'))) or job.product_id=p.product_id)
          and (job.status in ('queued','running') or job.created_at>now()-interval '1 hour'))
    limit 100
  ) x;
  return public.enqueue_catalog_collection(refs);
end; $$;

-- Retire the old classification endpoint without dropping compatibility columns.
revoke execute on function public.classify_catalog_items(uuid[],text) from service_role;
-- A cursor created with an earlier cutoff must not carry over.
update public.dotb_sync_state set cursor=null,processed=0,last_completed_at=null,lease=null,
  locked_until='-infinity',next_allowed_at='-infinity' where id;
commit;
