begin;
create view public.dotb_tracking_period with(security_invoker=true) as
select '2026-10-30 00:00:00 Europe/Paris'::timestamptz as starts_at,'Europe/Paris'::text as time_zone;
revoke all on public.dotb_tracking_period from public,anon,authenticated;
grant select on public.dotb_tracking_period to authenticated,service_role;

-- Dotb's item API has no creation timestamp. Classification is explicit, never inferred from synced_at.
alter table public.catalog_dotb_items add column tracking_status text not null default 'unclassified'
  check(tracking_status in ('unclassified','included','excluded'));
alter table public.catalog_dotb_items add column tracking_reviewed_at timestamptz;
create index catalog_dotb_tracking on public.catalog_dotb_items(tracking_status,sku);
create view public.catalog_tracked_items with(security_invoker=true) as
select * from public.catalog_dotb_items where tracking_status='included';
create view public.catalog_tracked_links with(security_invoker=true) as
select l.* from public.catalog_sku_links l where exists(select 1 from public.catalog_tracked_items i where i.sku=l.sku);
create view public.catalog_tracked_products with(security_invoker=true) as
select p.* from public.catalog_product_summary p
where exists(select 1 from public.catalog_tracked_links l where l.product_id=p.id)
  or not exists(select 1 from public.catalog_sku_links l where l.product_id=p.id);

create view public.sales_line_tracking with(security_invoker=true) as
select l.id,case
  when nullif(l.source->>'dotb_listing_id','') is not null then
    coalesce((select i.tracking_status from public.catalog_dotb_items i where i.id::text=l.source->>'dotb_listing_id'),'unclassified')
  when exists(select 1 from public.catalog_dotb_items i where i.sku=coalesce(l.sku_override,l.source->>'sku'))
    and not exists(select 1 from public.catalog_dotb_items i where i.sku=coalesce(l.sku_override,l.source->>'sku') and i.tracking_status<>'included') then 'included'
  when exists(select 1 from public.catalog_dotb_items i where i.sku=coalesce(l.sku_override,l.source->>'sku'))
    and not exists(select 1 from public.catalog_dotb_items i where i.sku=coalesce(l.sku_override,l.source->>'sku') and i.tracking_status<>'excluded') then 'excluded'
  else 'unclassified' end as tracking_status
from public.sales_lines l;
create view public.sales_lines_in_period with(security_invoker=true) as
select l.*,to_jsonb(o) as "order",t.tracking_status
from public.sales_lines l join public.sales_orders o on o.id=l.order_id join public.sales_line_tracking t on t.id=l.id
where o.order_date>=(select starts_at from public.dotb_tracking_period);
create or replace view public.catalog_sales_by_sku with(security_invoker=true) as
select btrim(coalesce(l.sku_override,l.source->>'sku','')) as sku,o.currency,
  count(*) as quantity,count(nullif(l.source->>'selling_price','')) as known_prices,
  sum(nullif(l.source->>'selling_price','')::numeric) as revenue,max(o.order_date) as last_sale
from public.sales_lines l join public.sales_orders o on o.id=l.order_id join public.sales_line_tracking t on t.id=l.id
where l.source_active and t.tracking_status='included'
  and o.order_date>=(select starts_at from public.dotb_tracking_period)
  and o.status is not null and o.status not in ('cancelled','returning','suspended')
  and btrim(coalesce(l.sku_override,l.source->>'sku',''))<>''
group by btrim(coalesce(l.sku_override,l.source->>'sku','')),o.currency;
revoke all on public.catalog_tracked_items,public.catalog_tracked_links,public.catalog_tracked_products,public.sales_line_tracking,public.sales_lines_in_period from public,anon,authenticated;
grant select on public.catalog_tracked_items,public.catalog_tracked_links,public.catalog_tracked_products,public.sales_line_tracking,public.sales_lines_in_period to authenticated,service_role;

alter table public.catalog_collection_jobs drop constraint catalog_collection_jobs_status_check;
alter table public.catalog_collection_jobs add constraint catalog_collection_jobs_status_check check(status in ('queued','running','completed','blocked','failed','excluded'));

create or replace function public.queue_catalog_sources() returns integer
language plpgsql security invoker set search_path='' as $$
declare refs jsonb; added integer:=0; n integer;
begin
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select 'product:'||p.supplier_id as reference_key,p.supplier_url as input,p.supplier_id as expected_supplier_id,
      coalesce(p.supplier_sku,(select min(l.sku) from public.catalog_tracked_links l where l.product_id=p.id having count(*)=1)) as expected_sku
    from public.catalog_tracked_products p where p.auto_collect and p.next_check_at<=now()
      and not exists(select 1 from public.catalog_collection_jobs j where j.reference_key='product:'||p.supplier_id and j.status in ('queued','running'))
    order by p.next_check_at,p.id limit 100
  ) x;
  added:=public.enqueue_catalog_collection(refs);
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select distinct 'sku:'||d.sku as reference_key,d.sku as input,d.sku as expected_sku,null::text as expected_supplier_id
    from public.catalog_tracked_items d where d.sku ~ '^[A-Za-z0-9_-]{1,200}$'
      and not exists(select 1 from public.catalog_sku_links l where l.sku=d.sku and l.product_id is not null)
      and not exists(select 1 from public.catalog_collection_jobs j where j.reference_key='sku:'||d.sku and j.status<>'excluded')
    order by input limit 100
  ) x;
  n:=public.enqueue_catalog_collection(refs);
  return added+n;
end; $$;

create function public.classify_catalog_items(p_ids uuid[],p_status text) returns integer
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
  if coalesce(cardinality(p_ids),0) not between 1 and 100 or p_status not in ('included','excluded','unclassified') then raise exception 'invalid_classification'; end if;
  if exists(select 1 from unnest(p_ids) input_id where not exists(select 1 from public.catalog_dotb_items i where i.id=input_id)) then raise exception 'item_not_found'; end if;
  update public.catalog_dotb_items set tracking_status=p_status,tracking_reviewed_at=now() where id=any(p_ids);
  get diagnostics changed=row_count;
  update public.catalog_collection_jobs j set status='excluded',finished_at=now(),message='Article exclu ou en attente de classement.'
    where j.status in ('queued','running') and (
      (j.product_id is not null and not exists(select 1 from public.catalog_tracked_products p where p.id=j.product_id))
      or (j.expected_sku is not null and exists(select 1 from public.catalog_dotb_items i where i.sku=j.expected_sku)
        and not exists(select 1 from public.catalog_tracked_items i where i.sku=j.expected_sku)));
  perform public.queue_catalog_sources();
  return changed;
end; $$;
revoke all on function public.classify_catalog_items(uuid[],text) from public,anon,authenticated;
grant execute on function public.classify_catalog_items(uuid[],text) to service_role;

-- Suspend previously queued Dotb products until their inclusion has been confirmed.
update public.catalog_collection_jobs j set status='excluded',finished_at=now(),message='Article en attente de classement.'
where j.status in ('queued','running') and j.product_id is not null
  and not exists(select 1 from public.catalog_tracked_products p where p.id=j.product_id);
-- The next orders import starts at the new lower bound, without deleting history.
update public.dotb_sync_state set cursor=null,processed=0,last_completed_at=null,lease=null,locked_until='-infinity',next_allowed_at=now() where id;
commit;
