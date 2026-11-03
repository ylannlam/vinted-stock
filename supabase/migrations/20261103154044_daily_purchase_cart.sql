begin;

-- One consistent read, including every sale of the Paris calendar day. The
-- returned JSON is not truncated by the Data API's row pagination limit.
create function public.daily_purchase_context(p_day date) returns jsonb
language sql stable security invoker set search_path='' as $$
 with day_lines as materialized (
  select w.*,a.item_id as shein_item_id from public.workspace_sales w
  left join public.shein_order_links a on a.line_id=w.id
  where w.sale_date >= (p_day::timestamp at time zone 'Europe/Paris')
    and w.sale_date < ((p_day+1)::timestamp at time zone 'Europe/Paris')
 ), skus as (select distinct lower(resolved_sku) as sku from day_lines where resolved_sku<>''),
 unallocated as (
  select i.sku,i.size,i.color,i.status,i.order_ref,o.order_date,
    i.quantity-(select count(*) from public.shein_order_links l where l.item_id=i.id) as remaining
  from public.shein_order_items i join public.shein_orders o on o.ref=i.order_ref
  where i.present and i.status in ('processing','shipped','delivered') and lower(i.sku) in(select sku from skus)
 ), earlier as (
  select count(*) as count,min((w.sale_date at time zone 'Europe/Paris')::date) as oldest_day
  from public.workspace_sales w where w.sale_date < (p_day::timestamp at time zone 'Europe/Paris')
   and not w.is_blocked and w.effective_stage='to_order' and nullif(btrim(w.supplier_order_ref),'') is null
   and not exists(select 1 from public.shein_order_links a where a.line_id=w.id)
 )
 select jsonb_build_object('day',p_day,'time_zone','Europe/Paris','generated_at',now(),
  'lines',coalesce((select jsonb_agg(jsonb_build_object(
   'id',l.id,'updated_at',l.updated_at,'source',jsonb_build_object('title',l.source->>'title','thumbnail_url',l.source->>'thumbnail_url'),
   'resolved_sku',l.resolved_sku,'sale_date',l.sale_date,'account_login',l.account_login,
   'is_blocked',l.is_blocked,'effective_stage',l.effective_stage,'supplier_order_ref',l.supplier_order_ref,
   'supplier_size',l.supplier_size,'supplier_color',l.supplier_color,'shein_item_id',l.shein_item_id,
   'listing_photo_url',l.listing_photo_url) order by l.sale_date,l.id) from day_lines l),'[]'::jsonb),
  'catalog',coalesce((select jsonb_agg(to_jsonb(c)) from public.sales_supplier_details c where lower(c.sku) in(select sku from skus)),'[]'::jsonb),
  'unallocated',coalesce((select jsonb_agg(to_jsonb(u)) from unallocated u where remaining>0),'[]'::jsonb),
  'earlier_pending',(select to_jsonb(e) from earlier e),
  'orders_synced_at',(select last_completed_at from public.shein_sync_state where id),
  'sales_synced_at',(select last_completed_at from public.dotb_sync_state where id)
 );
$$;
revoke all on function public.daily_purchase_context(date) from public,anon,authenticated;
grant execute on function public.daily_purchase_context(date) to service_role;

commit;
