begin;

-- Sort before pagination, and preserve the same order in the JSON response.
CREATE OR REPLACE FUNCTION public.sales_workspace_page(p_filters jsonb, p_known_revision text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb; rev text; page_no int := coalesce((p_filters->>'page')::int,0);
begin
 if page_no<0 or page_no>20000 then raise exception 'invalid_page'; end if;
 select 'sale-date-v1:'||version::text||':'||md5(p_filters::text)||':'||floor(extract(epoch from now())/60)::text into rev from public.workspace_revision where id=true;
 if rev=p_known_revision then return jsonb_build_object('unchanged',true,'revision',rev); end if;
 with filtered as materialized (
 select * from public.workspace_sales s where
 (coalesce(p_filters->>'account','')='' or s.account_login=p_filters->>'account')
 and (coalesce(p_filters->>'from','')='' or s.sale_date>=((p_filters->>'from')::date::timestamp at time zone 'Europe/Paris'))
 and (coalesce(p_filters->>'to','')='' or s.sale_date<(((p_filters->>'to')::date+1)::timestamp at time zone 'Europe/Paris'))
 and (coalesce(p_filters->>'search','')='' or strpos(lower(concat_ws(' ',s.source->>'title',s.resolved_sku,s.account_login,s.supplier_order_ref)),lower(p_filters->>'search'))>0)
 and (coalesce((p_filters->>'urgent')::boolean,false)=false or (not s.is_blocked and s.effective_stage<>'shipped' and s.deadline_at<now()+interval '48 hours'))
 ), matched as materialized (
 select * from filtered s where coalesce(p_filters->>'stage','all')='all'
 or (p_filters->>'stage'='review' and s.is_blocked)
 or (p_filters->>'stage'='missing_sku' and not s.is_blocked and s.resolved_sku='')
 or (not s.is_blocked and s.effective_stage=p_filters->>'stage')
 ), paged as materialized (
 select * from matched order by sale_date desc nulls last,id desc limit 50 offset page_no*50
 )
 select jsonb_build_object(
 'lines',coalesce((select jsonb_agg(to_jsonb(p) order by p.sale_date desc nulls last,p.id desc) from paged p),'[]'),
 'catalog',coalesce((select jsonb_agg(to_jsonb(d)) from public.sales_supplier_details d where d.sku in(select resolved_sku from paged)),'[]'),
 'count',(select count(*) from matched),'page_size',50,'page',page_no,'revision',rev,
 'counts',jsonb_build_object('all',(select count(*) from filtered),'review',(select count(*) from filtered where is_blocked),'missing_sku',(select count(*) from filtered where not is_blocked and resolved_sku=''))||
 coalesce((select jsonb_object_agg(effective_stage,n) from (select effective_stage,count(*) n from filtered where not is_blocked group by effective_stage) q),'{}'),
 'accounts',coalesce((select jsonb_agg(account_login order by account_login) from (select distinct account_login from public.workspace_sales where account_login<>'') a),'[]')
 ) into result;
 return result;
end $function$
;

-- Count every reference's latest attempt, without the 100-row history limit.
create or replace function public.catalog_collection_progress()
returns jsonb language sql stable security invoker set search_path='' as $$
  with latest as (
    select distinct on (reference_key) status
    from public.catalog_collection_jobs
    order by reference_key,created_at desc,id desc
  )
  select jsonb_build_object(
    'total',count(*),
    'completed',count(*) filter (where status='completed'),
    'queued',count(*) filter (where status='queued'),
    'running',count(*) filter (where status='running'),
    'review',count(*) filter (where status in ('blocked','failed'))
  ) from latest where status<>'excluded';
$$;
revoke all on function public.catalog_collection_progress() from public,anon,authenticated;
grant execute on function public.catalog_collection_progress() to service_role;

commit;
