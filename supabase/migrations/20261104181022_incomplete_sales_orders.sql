begin;
-- Keep real orders visible without manufacturing item IDs, quantities or amounts.
create view public.sales_orders_without_items with(security_invoker=true) as
select o.id,o.account_login,o.transaction_id,o.status,o.order_date,o.deadline,o.synced_at
from public.sales_orders o
where (o.order_date >= (select starts_at from public.dotb_tracking_period) or o.order_date is null)
and not exists(select 1 from public.sales_lines l where l.order_id=o.id and l.source_active);
revoke all on public.sales_orders_without_items from public,anon,authenticated;
grant select on public.sales_orders_without_items to service_role;
commit;
