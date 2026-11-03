begin;
-- Repeated purchases are interchangeable only within the exact SKU/size/color.
-- Explicit order references are reserved first, then oldest sales consume the
-- oldest compatible purchase, one unit at a time. Existing links stay intact.
create or replace function public.reconcile_shein_orders(p_user uuid default null) returns integer language plpgsql security invoker set search_path='' as $$
declare r record; candidate text; n integer:=0; l public.sales_lines;
begin
 perform app_private.shein_lock_sales();
 for r in select w.id,w.resolved_sku,w.supplier_size,
   coalesce(nullif(w.supplier_color,''),c.color) as color,w.supplier_order_ref,w.sale_date
  from public.workspace_sales w left join public.sales_supplier_details c on c.sku=w.resolved_sku
  where not w.is_blocked and w.effective_stage in('to_order','ordered','in_transit')
   and not exists(select 1 from public.shein_order_links a where a.line_id=w.id)
  order by (nullif(w.supplier_order_ref,'') is not null) desc,w.sale_date,w.id loop
  candidate:=null;
  select i.id into candidate from public.shein_order_items i join public.shein_orders o on o.ref=i.order_ref
  where i.present and i.status in('processing','shipped','delivered') and i.size<>'' and i.color<>''
   and lower(i.sku)=lower(r.resolved_sku)
   and app_private.shein_size(i.size)=app_private.shein_size(r.supplier_size)
   and app_private.shein_norm(i.color)=app_private.shein_norm(r.color)
   and (r.sale_date at time zone 'Europe/Paris')::date<=o.order_date
   and (nullif(r.supplier_order_ref,'') is null or i.order_ref=r.supplier_order_ref)
   and not exists(select 1 from public.shein_order_exclusions e where e.line_id=r.id and e.item_id=i.id)
   and i.quantity>(select count(*) from public.shein_order_links a where a.item_id=i.id)
  order by o.order_date,i.id limit 1;
  if candidate is not null then
   perform app_private.shein_attach(candidate,r.id,'auto',p_user);n:=n+1;
  end if;
 end loop;
 -- Progress only when the entire identical-variant group is shipped; delivery still needs a physical receipt confirmation.
 for r in select a.*,i.status,i.present,i.quantity,i.sku,i.order_ref from public.shein_order_links a join public.shein_order_items i on i.id=a.item_id loop
  select * into l from public.sales_lines where id=r.line_id;
  if r.present and r.status in('shipped','delivered') and l.stage='ordered' and l.supplier_order_ref=r.order_ref
   and lower(coalesce(l.sku_override,l.source->>'sku'))=lower(r.sku)
   and exists(select 1 from public.workspace_sales w where w.id=l.id and not w.is_blocked and w.effective_stage='ordered')
   and r.quantity>=(select count(*) from public.shein_order_links where item_id=r.item_id) then
   update public.sales_lines set stage='in_transit',updated_at=clock_timestamp(),updated_by=p_user where id=l.id;
   select * into l from public.sales_lines where id=r.line_id;
   update public.shein_order_links set managed_state=jsonb_set(managed_state,'{stage}','"in_transit"'::jsonb),updated_at=clock_timestamp() where line_id=l.id;
  end if;
 end loop;
 return n;
end $$;


-- All valid sales, aggregated server-side to avoid the Data API row limit.
-- Net proceeds are dated by the sale in Paris, not a presumed payout date.
create function public.sales_budget_income() returns jsonb language sql stable security invoker set search_path='' as $$
 with sales as (
  select w.id,w.sale_date,w.account_login,w.source->>'title' title,
   (w.source->>'selling_price')::numeric-w.refund_amount-w.fees_amount as net
  from public.workspace_sales w
  where w.currency='EUR' and not w.is_blocked and w.order_status<>''
   and (w.source->>'selling_price') ~ '^\d+(\.\d+)?$'
 )
 select coalesce(jsonb_agg(jsonb_build_object('id','vinted-'||s.id,'line_id',s.id,
  'date',to_char(s.sale_date at time zone 'Europe/Paris','YYYY-MM-DD'),
  'type',case when s.net<0 then 'out' else 'in' end,'cat','Ventes Vinted',
  'label',coalesce(s.title,'Article sans titre')||' · '||s.account_login,
  'amount',abs(s.net),'source','vinted') order by s.sale_date desc,s.id),'[]'::jsonb)
 from sales s;
$$;
revoke all on function public.sales_budget_income() from public,anon,authenticated;
grant execute on function public.sales_budget_income() to service_role;
commit;
