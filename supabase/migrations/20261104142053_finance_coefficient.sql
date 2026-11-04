begin;
-- Coefficient de revente (« je revends fois combien ») : total rapporté ÷ total payé.
-- Uniquement les ventes dont le coût payé réel est connu (> 0) ; jamais le prix catalogue,
-- et la livraison Shein n'est pas répartie par article. Les retours sont exclus.
-- Ajoute coef_revenue, coef_cost et coef_count aux totaux et au classement des produits ;
-- les autres champs sont inchangés.
create or replace function public.workspace_finance(p_month text default '',p_page int default 0) returns jsonb
language sql stable security invoker set search_path='' as $$
 with rows as materialized (
 select s.id,s.resolved_sku as sku,s.source->>'title' title,s.account_login,s.sale_date,s.order_status,s.currency,s.actual_cost,s.fees_amount,s.refund_amount,s.finance_confirmed,
 case when (s.source->>'selling_price') ~ '^\d+(\.\d+)?$' then (s.source->>'selling_price')::numeric end as revenue,
 case when s.actual_cost is not null then s.actual_cost when d.currency=s.currency then d.price end as estimated_cost
 from public.workspace_sales s left join public.sales_supplier_details d on d.sku=s.resolved_sku
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
$$;
revoke all on function public.workspace_finance(text,int) from public,anon,authenticated;
grant execute on function public.workspace_finance(text,int) to service_role;
commit;
