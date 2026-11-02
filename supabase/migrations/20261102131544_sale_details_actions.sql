begin;

alter table public.sales_lines
 add column supplier_size text check(length(supplier_size)<=80),
 add column supplier_color text check(length(supplier_color)<=80);

create or replace view public.workspace_sales with(security_invoker=true) as
 select l.*,raw.fees_amount,raw.refund_amount,raw.finance_confirmed,
 trim(coalesce(l.sku_override,l.source->>'sku','')) as resolved_sku,
 coalesce(l."order"->>'account_login','') as account_login,
 (l."order"->>'order_date')::timestamptz as sale_date,
 (l."order"->>'deadline')::timestamptz as deadline_at,
 coalesce(l."order"->>'status','') as order_status,
 coalesce(l."order"->>'currency','') as currency,
 (l."order"->>'status' is null or l."order"->>'status' in ('cancelled','returning','suspended')) as is_blocked,
 case when l."order"->>'status' in ('shipped','ready_for_pickup','delivered','completed') then 'shipped' else l.stage end as effective_stage,
 raw.supplier_size,raw.supplier_color
 from public.sales_lines_in_period l join public.sales_lines raw on raw.id=l.id where l.source_active;

create function public.save_sale_details(p_id text,p_version timestamptz,p_edit jsonb,p_product jsonb,p_fees numeric,p_refund numeric,p_confirmed boolean,p_variant jsonb,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_variant) is distinct from 'object' or length(coalesce(p_variant->>'size',''))>80 or length(coalesce(p_variant->>'color',''))>80 then raise exception 'invalid_variant'; end if;
 perform public.save_sales_workspace(p_id,p_version,p_edit,p_product,p_fees,p_refund,p_confirmed,p_user);
 update public.sales_lines set supplier_size=nullif(trim(p_variant->>'size'),''),supplier_color=nullif(trim(p_variant->>'color'),''),updated_at=clock_timestamp() where id=p_id;
end $$;
revoke all on function public.save_sale_details(text,timestamptz,jsonb,jsonb,numeric,numeric,boolean,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_sale_details(text,timestamptz,jsonb,jsonb,numeric,numeric,boolean,jsonb,uuid) to service_role;

create view public.workspace_sale_actions with(security_invoker=true) as
 select s.id,s.source->>'title' as title,s.source->>'thumbnail_url' as photo_url,s.account_login,
 s.deadline_at,s.sale_date,s.effective_stage,s.order_status,s.resolved_sku as sku,
 d.retrieval_status,d.retrieval_message,
 case when s.is_blocked then 'review'
 when s.effective_stage='prepared' then 'ship'
 when s.effective_stage='received' then 'prepare'
 when s.effective_stage in ('ordered','in_transit') then 'receive'
 when s.resolved_sku='' then 'missing_sku'
 when d.price is null or d.retrieval_status in ('failed','blocked') then 'shein'
 else 'purchase' end as action
 from public.workspace_sales s left join public.sales_supplier_details d on d.sku=s.resolved_sku
 where s.order_status<>'cancelled' and (s.effective_stage<>'shipped' or s.is_blocked);
revoke all on public.workspace_sale_actions from public,anon,authenticated;
grant select on public.workspace_sale_actions to service_role;

create function public.workspace_actions(p_category text default 'all',p_page int default 0) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_category is null or p_category not in ('all','missing_sku','shein','purchase','receive','prepare','ship','review') or p_page is null or p_page<0 or p_page>20000 then raise exception 'invalid_filter'; end if;
 with matched as materialized(select * from public.workspace_sale_actions where p_category='all' or action=p_category),
 paged as (select * from matched order by deadline_at asc nulls last,sale_date desc,id limit 20 offset p_page*20)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'),
 'count',(select count(*) from matched),'page',p_page,'page_size',20,
 'counts',jsonb_build_object('all',(select count(*) from public.workspace_sale_actions))||coalesce((select jsonb_object_agg(action,n) from (select action,count(*) n from public.workspace_sale_actions group by action) c),'{}')) into result;
 return result;
end $$;
revoke all on function public.workspace_actions(text,int) from public,anon,authenticated;
grant execute on function public.workspace_actions(text,int) to service_role;

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
 sum(actual_cost) as purchase_cost,count(actual_cost) as cost_count,coalesce(sum(fees_amount),0) as fees,coalesce(sum(refund_amount),0) as refunds
 from rows group by currency
 )
 select jsonb_build_object('totals',coalesce((select jsonb_agg(to_jsonb(t)) from totals t),'[]'),
 'rows',coalesce((select jsonb_agg(to_jsonb(p)) from (select * from rows order by sale_date desc,id limit 50 offset greatest(p_page,0)*50) p),'[]'),
 'count',(select count(*) from rows),'page',p_page,'page_size',50,
 'leaders',coalesce((select jsonb_agg(to_jsonb(b)) from (
 select sku,currency,min(title) as title,count(*) as quantity,
 count(*) filter(where finance_confirmed and actual_cost is not null and revenue is not null) as verified_count,
 sum(revenue-refund_amount-fees_amount-actual_cost) filter(where finance_confirmed and actual_cost is not null and revenue is not null) as confirmed_margin
 from rows where sku<>'' and order_status<>'returning' group by sku,currency
 order by currency,confirmed_margin desc nulls last,quantity desc,sku limit 10
 ) b),'[]'))
$$;
revoke all on function public.workspace_finance(text,int) from public,anon,authenticated;
grant execute on function public.workspace_finance(text,int) to service_role;

create or replace function app_private.workspace_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_row jsonb := case when tg_op='INSERT' then '{}' else to_jsonb(old) end;
 after_row jsonb := case when tg_op='DELETE' then '{}' else to_jsonb(new) end;
 fields text[]; k text; delta jsonb := '{}'; actor uuid; who text; title text; verb text;
begin
 fields := case tg_table_name
 when 'items' then array['status','size','emplacement','commande_id','deleted_at']
 when 'commandes' then array['status','deleted_at']
 when 'sales_lines' then array['supplier_size','supplier_color','stage','sku_override','supplier_order_ref','supplier_tracking','location','actual_cost','fees_amount','refund_amount','finance_confirmed']
 when 'creative_accounts' then array['enabled','background_id']
 when 'vinted_accounts' then array['statut','is_ready','is_shadowbanned','creation_stage','deleted_at']
 else array[]::text[] end;
 foreach k in array fields loop
   if before_row->k is distinct from after_row->k then
     delta := delta || jsonb_build_object(k,jsonb_build_object('before',before_row->k,'after',after_row->k));
   end if;
 end loop;
 if tg_op='UPDATE' and delta='{}'::jsonb then return new; end if;
 actor := coalesce(auth.uid(),nullif(current_setting('app.actor_id',true),'')::uuid,case when tg_table_name='sales_lines' then nullif(after_row->>'updated_by','')::uuid end);
 select pseudo into who from public.profiles where id=actor;
 title := case tg_table_name when 'items' then concat('Article ',coalesce(after_row->>'size',before_row->>'size'),' · ',coalesce(after_row->>'emplacement',before_row->>'emplacement','sans emplacement'))
 when 'commandes' then 'Commande de stock'
 when 'sales_lines' then coalesce(after_row#>>'{source,title}',before_row#>>'{source,title}','Vente')
 when 'creative_accounts' then coalesce(after_row->>'login',before_row->>'login','Compte Dotb')
 when 'vinted_accounts' then coalesce(after_row->>'pseudo',before_row->>'pseudo','Compte') end;
 verb := case when tg_op='INSERT' then 'created' when tg_op='DELETE' then 'deleted'
 when before_row->>'deleted_at' is null and after_row->>'deleted_at' is not null then 'trashed'
 when before_row->>'deleted_at' is not null and after_row->>'deleted_at' is null then 'restored' else 'updated' end;
 insert into public.workspace_events(entity,entity_id,label,action,actor_id,actor_name,changes)
 values(tg_table_name,coalesce(after_row->>'id',before_row->>'id'),left(title,300),verb,actor,coalesce(who,'Synchronisation'),delta);
 return coalesce(new,old);
end $$;

create or replace function public.workspace_overview() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'sales',jsonb_build_object('to_order',(select count(*) from public.workspace_sales where not is_blocked and effective_stage='to_order'),
 'to_ship',(select count(*) from public.workspace_sales where not is_blocked and effective_stage='prepared'),
 'urgent',(select count(*) from public.workspace_sales where not is_blocked and effective_stage<>'shipped' and deadline_at<now()+interval '48 hours'),
 'missing_sku',(select count(*) from public.workspace_sales where not is_blocked and resolved_sku=''),
 'review',(select count(*) from public.workspace_sales where is_blocked)),
 'stock',jsonb_build_object('available',(select count(*) from public.items where deleted_at is null and status='en_stock'),
 'to_ship',(select count(*) from public.items where deleted_at is null and status='vendu'),
 'receiving',(select count(*) from public.commandes where deleted_at is null and status='en_attente')),
 'urgent_lines',coalesce((select jsonb_agg(to_jsonb(q)) from (select id,source->>'title' title,account_login,deadline_at,effective_stage from public.workspace_sales where not is_blocked and effective_stage<>'shipped' and deadline_at<now()+interval '48 hours' order by deadline_at,id limit 8) q),'[]'),
 'collector',jsonb_build_object('pending',(select count(*) from public.sales_supplier_details d where d.retrieval_status in ('queued','running') and exists(select 1 from public.workspace_sales s where s.resolved_sku=d.sku and not s.is_blocked and s.effective_stage<>'shipped')),
 'review',(select count(*) from public.sales_supplier_details d where d.retrieval_status in ('blocked','failed') and exists(select 1 from public.workspace_sales s where s.resolved_sku=d.sku and not s.is_blocked and s.effective_stage<>'shipped'))),
 'directions',jsonb_build_object('selected',(select count(*) from public.creative_accounts where enabled),
 'incomplete',(select count(*) from public.creative_accounts a left join public.creative_resources r on r.id=a.background_id where a.enabled and (r.id is null or r.archived_at is not null or trim(coalesce(a.prompt_front,r.content,''))='' or trim(coalesce(a.prompt_back,r.content_back,''))='')))
 )
$$;
revoke all on function public.workspace_overview() from public,anon,authenticated;
grant execute on function public.workspace_overview() to service_role;


commit;
