begin;
-- 1. A newer reading can never make previously recorded units disappear.
--    import_shein_order() marks every item of the order absent, then restores only
--    the items it receives. If one parcel/group was not read (unknown tab label,
--    page change), its units would silently stop being linkable to sales.
--    Any previously present item that is missing, or read with a lower quantity,
--    rejects the whole reading: the previous snapshot is kept untouched and the
--    extension reports the order as "à vérifier".
-- 2. A total observed on an order containing cancelled/refunded items is kept for
--    review only (source 'order_summary_review'). It never enters the Budget and
--    never replaces a total already confirmed by an earlier complete reading.
create or replace function public.import_shein_order_v2(p_order jsonb,p_device uuid) returns void language plpgsql security invoker set search_path='' as $$
declare old_at timestamptz; entry jsonb;
begin
 perform app_private.shein_lock_sales();
 select observed_at into old_at from public.shein_orders where ref=p_order->>'ref';
 if old_at >= (p_order->>'observed_at')::timestamptz then return;end if;
 if exists(
  select 1 from public.shein_order_items i
  where i.order_ref=p_order->>'ref' and i.present
   and coalesce((select sum((e->>'quantity')::int) from jsonb_array_elements(coalesce(p_order->'items','[]')) e where e->>'id'=i.id),0)<i.quantity
 ) then raise exception 'shein_items_missing';end if;
 perform public.import_shein_order(p_order,p_device);
 for entry in select value from jsonb_array_elements(p_order->'items') loop
  update public.shein_order_items set status_text=coalesce(entry->>'status_text',''),paid_amounts=coalesce(entry->'paid_amounts','[]') where id=entry->>'id';
 end loop;
 if jsonb_array_length(coalesce(p_order->'parcels','[]'))>0 then
  update public.shein_orders set shipment_observations=(
   select coalesce(jsonb_agg(v),'[]') from (
    select distinct on (value->>'tracking_number') value as v from jsonb_array_elements(coalesce(p_order->'parcels','[]')||shipment_observations)
    order by value->>'tracking_number',(value->>'observed_at')::timestamptz desc
   ) latest
  ) where ref=p_order->>'ref';
 end if;
 update public.shein_orders set payment=case
  when p_order->'payment'->>'source'='order_summary_review' and payment->>'source'='order_summary'
   then payment||jsonb_build_object('review',p_order->'payment')
  else p_order->'payment' end
 where ref=p_order->>'ref' and jsonb_typeof(p_order->'payment')='object';
 -- Only previously managed costs may follow a newer exact price. Manual values survive.
 with changes as (
  update public.sales_lines l set actual_cost=i.unit_price,finance_confirmed=false,updated_at=clock_timestamp()
  from public.shein_order_links a join public.shein_order_items i on i.id=a.item_id
  where l.id=a.line_id and i.order_ref=p_order->>'ref' and i.present and i.status in('processing','shipped','delivered')
    and exists(select 1 from public.sales_orders so where so.id=l.order_id and so.currency='EUR')
    and a.before_state->>'actual_cost' is null
    and l.actual_cost is not distinct from (a.managed_state->>'actual_cost')::numeric
    and l.actual_cost is distinct from i.unit_price
  returning l.id,l.actual_cost
 ) update public.shein_order_links a set managed_state=jsonb_set(a.managed_state,'{actual_cost}',coalesce(to_jsonb(c.actual_cost),'null'::jsonb)),updated_at=clock_timestamp()
 from changes c where a.line_id=c.id;
end $$;
revoke all on function public.import_shein_order_v2(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.import_shein_order_v2(jsonb,uuid) to service_role;
-- Keep the original recorded expense while surfacing a possible refund.
create or replace function public.shein_budget_expenses() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id','shein-'||o.ref,'date',o.order_date,'type','out','cat','Stock Shein',
  'label','Commande Shein '||o.ref,'amount',(o.payment->>'paid_total')::numeric,'source','shein','order_ref',o.ref,
  'review_required',o.payment ? 'review' or exists(select 1 from public.shein_order_items i where i.order_ref=o.ref and i.present and i.status='exception'))
  order by o.order_date desc,o.ref),'[]'::jsonb)
 from public.shein_orders o where o.payment->>'currency'='EUR' and o.payment->>'source'='order_summary'
  and (o.payment->>'paid_total')::numeric>=0;
$$;
revoke all on function public.shein_budget_expenses() from public,anon,authenticated;
grant execute on function public.shein_budget_expenses() to service_role;
commit;
