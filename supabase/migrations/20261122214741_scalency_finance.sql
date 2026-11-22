alter table public.scalency_sale_costs add column fees_amount numeric check(fees_amount>=0), add column refund_amount numeric check(refund_amount>=0), add column finance_confirmed boolean not null default false;

create function public.scalency_import_stock_product() returns trigger language plpgsql security definer set search_path='' as $$
declare ref text;
begin
  ref:=public.scalency_supplier_id(new.shein_url);
  if new.status='en_stock' and new.deleted_at is null and ref is not null and length(ref)<=20 then
    insert into public.catalog_products(supplier_id,supplier_url,title,photo_url,auto_collect,next_check_at)
    values(ref,'https://fr.shein.com/product-p-'||ref||'.html',coalesce(nullif(trim(new.category),''),'Article fournisseur '||ref),new.photo_url,false,null)
    on conflict(supplier_id) do nothing;
  end if;
  return new;
end $$;
revoke all on function public.scalency_import_stock_product() from public,anon,authenticated;
create trigger scalency_import_stock_product after insert or update of shein_url,status,deleted_at on public.items for each row execute function public.scalency_import_stock_product();

create view public.scalency_finance_lines with(security_invoker=true) as
select coalesce(e.archive_line,s.id) id,s.sku,s.title,s.login account_login,s.sold_at sale_date,'completed'::text order_status,s.currency,
  case when c.line_id is null then s.actual_cost else c.actual_cost end as actual_cost,coalesce(c.fees_amount,h.fees_amount,0) fees_amount,
  coalesce(c.refund_amount,h.refund_amount,0) refund_amount,case when c.line_id is null then coalesce(h.finance_confirmed,false) else c.finance_confirmed end finance_confirmed,
  s.price revenue,coalesce(case when c.line_id is null then s.actual_cost else c.actual_cost end,case when p.currency=s.currency then p.price end) estimated_cost,
  s.order_key as "order",s.login as account
from public.scalency_catalog_sales s
left join public.scalency_order_products e on e.order_id=s.order_key and e.login=s.login and s.id='scalency/'||e.login||'/'||e.order_id||'/'||e.line_id
left join public.scalency_sale_costs c on c.order_id=e.order_id and c.line_id=e.line_id
left join public.sales_lines h on h.id=coalesce(e.archive_line,s.id)
left join public.catalog_product_summary p on p.supplier_id=s.supplier_id;
revoke all on public.scalency_finance_lines from public,anon,authenticated;
grant select on public.scalency_finance_lines to service_role;

CREATE OR REPLACE FUNCTION public.scalency_finance(p_month text DEFAULT ''::text, p_page integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with rows as materialized (
 select * from public.scalency_finance_lines s
 where (p_month='' or to_char(s.sale_date at time zone 'Europe/Paris','YYYY-MM')=p_month)
 and s.order_status not in ('cancelled','suspended','')
 ), totals as (
 select currency,count(*) as quantity,count(*) filter(where order_status='returning') as returns,
 coalesce(sum(revenue-refund_amount),0) as net_revenue,
 count(*) filter(where revenue is null) as missing_revenue,
 sum(revenue-refund_amount-fees_amount-estimated_cost) filter(where estimated_cost is not null and revenue is not null and order_status<>'returning') as estimated_margin,
 count(*) filter(where estimated_cost is not null and revenue is not null and order_status<>'returning') as estimated_count,
 sum(revenue-refund_amount-fees_amount-actual_cost) filter(where finance_confirmed and actual_cost is not null and revenue is not null) as confirmed_margin,
 count(*) filter(where finance_confirmed and actual_cost is not null and revenue is not null) as confirmed_count,
 sum(revenue-refund_amount-fees_amount) filter(where actual_cost>0 and revenue is not null and order_status<>'returning') as coef_revenue,
 sum(actual_cost) filter(where actual_cost>0 and revenue is not null and order_status<>'returning') as coef_cost,
 count(*) filter(where actual_cost>0 and revenue is not null and order_status<>'returning') as coef_count,
 sum(actual_cost) as purchase_cost,count(actual_cost) as cost_count,coalesce(sum(fees_amount),0) as fees,coalesce(sum(refund_amount),0) as refunds
 from rows group by currency
 )
 select jsonb_build_object('totals',coalesce((select jsonb_agg(to_jsonb(t)) from totals t),'[]'),
 'rows',coalesce((select jsonb_agg(to_jsonb(p)) from (select * from rows order by sale_date desc,id limit 50 offset greatest(p_page,0)*50) p),'[]'),
 'count',(select count(*) from rows),'page',p_page,'page_size',50,
 'leaders',coalesce((select jsonb_agg(to_jsonb(b)) from (
 select sku,currency,min(title) as title,count(*) as quantity,
 count(*) filter(where finance_confirmed and actual_cost is not null and revenue is not null) as verified_count,
 sum(revenue-refund_amount-fees_amount-actual_cost) filter(where finance_confirmed and actual_cost is not null and revenue is not null) as confirmed_margin,
 sum(revenue-refund_amount-fees_amount) filter(where actual_cost>0 and revenue is not null) as coef_revenue,
 sum(actual_cost) filter(where actual_cost>0 and revenue is not null) as coef_cost,
 count(*) filter(where actual_cost>0 and revenue is not null) as coef_count
 from rows where sku<>'' and order_status<>'returning' group by sku,currency
 order by currency,confirmed_margin desc nulls last,quantity desc,sku limit 10
 ) b),'[]'))
$function$
;
revoke all on function public.scalency_finance(text,integer) from public,anon,authenticated;
grant execute on function public.scalency_finance(text,integer) to service_role;

CREATE OR REPLACE FUNCTION public.scalency_budget_income()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with sale_lines as (
  select s.id,s.title,s.sold_at,s.login,s.order_key,
    s.price-coalesce(c.fees_amount,x.fees_amount,0)-coalesce(c.refund_amount,x.refund_amount,0) as net,
    coalesce(x.id,s.id) as line_id
  from public.scalency_catalog_sales s
  left join public.scalency_order_entries e on s.order_key=e.order_id and s.login=e.login
    and s.id='scalency/'||e.login||'/'||e.order_id||'/'||e.line_id
  left join public.scalency_sale_costs c on c.order_id=e.order_id and c.line_id=e.line_id
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
$function$
;
