begin;
-- Replace the unused allocation feature with supplier-observed final amounts.
drop trigger apply_confirmed_shein_cost on public.shein_order_links;
drop function app_private.apply_confirmed_shein_cost();
drop function public.save_shein_cost(text,timestamptz,jsonb,uuid);
alter table public.shein_orders add column payment jsonb;
alter table public.shein_order_items add column paid_amounts jsonb not null default '[]';
create or replace function public.import_shein_order_v2(p_order jsonb,p_device uuid) returns void language plpgsql security invoker set search_path='' as $$
declare old_at timestamptz; entry jsonb;
begin
 perform app_private.shein_lock_sales();
 select observed_at into old_at from public.shein_orders where ref=p_order->>'ref';
 if old_at >= (p_order->>'observed_at')::timestamptz then return;end if;
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
 update public.shein_orders set payment=p_order->'payment' where ref=p_order->>'ref' and jsonb_typeof(p_order->'payment')='object';
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

create or replace function app_private.shein_attach(p_item text,p_line text,p_origin text,p_user uuid) returns void language plpgsql set search_path='' as $$
declare i public.shein_order_items; l public.sales_lines; before_value jsonb; new_stage text;
begin
 select * into i from public.shein_order_items where id=p_item;
 select * into l from public.sales_lines where id=p_line;
 if i.id is null or l.id is null or not i.present or i.status not in('processing','shipped','delivered') then raise exception 'shein_item_unavailable';end if;
 if exists(select 1 from public.shein_order_links where line_id=p_line) then raise exception 'shein_already_linked';end if;
 if (select count(*) from public.shein_order_links where item_id=p_item)>=i.quantity then raise exception 'shein_quantity_used';end if;
 if not exists(select 1 from public.workspace_sales w where w.id=p_line and not w.is_blocked and w.effective_stage in('to_order','ordered','in_transit')
   and lower(w.resolved_sku)=lower(i.sku)) then raise exception 'shein_sale_mismatch';end if;
 if nullif(l.supplier_order_ref,'') is not null and l.supplier_order_ref<>i.order_ref then raise exception 'shein_already_ordered';end if;
 before_value:=app_private.shein_line_state(l);
 new_stage:=case when l.stage='in_transit' or i.status in('shipped','delivered') then 'in_transit' else 'ordered' end;
 update public.sales_lines set stage=new_stage,supplier_order_ref=i.order_ref,supplier_size=i.size,supplier_color=i.color,
  actual_cost=coalesce(actual_cost,case when exists(select 1 from public.sales_orders so where so.id=l.order_id and so.currency='EUR') then i.unit_price end),ordered_at=coalesce(ordered_at,now()),updated_at=clock_timestamp(),updated_by=p_user where id=p_line;
 select * into l from public.sales_lines where id=p_line;
 insert into public.shein_order_links(line_id,item_id,origin,before_state,managed_state) values(p_line,p_item,p_origin,before_value,app_private.shein_line_state(l));
end $$;


-- Aggregate in PostgreSQL so the Data API row limit cannot silently omit expenses.
create function public.shein_budget_expenses() returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id','shein-'||o.ref,'date',o.order_date,'type','out','cat','Stock Shein',
  'label','Commande Shein '||o.ref,'amount',(o.payment->>'paid_total')::numeric,'source','shein','order_ref',o.ref)
  order by o.order_date desc,o.ref),'[]'::jsonb)
 from public.shein_orders o where o.payment->>'currency'='EUR' and o.payment->>'source'='order_summary'
  and (o.payment->>'paid_total')::numeric>=0;
$$;
revoke all on function public.shein_budget_expenses() from public,anon,authenticated;
grant execute on function public.shein_budget_expenses() to service_role;
commit;
