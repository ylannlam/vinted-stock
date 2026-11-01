begin;

create or replace function app_private.workspace_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare before_row jsonb := case when tg_op='INSERT' then '{}' else to_jsonb(old) end;
 after_row jsonb := case when tg_op='DELETE' then '{}' else to_jsonb(new) end;
 fields text[]; k text; delta jsonb := '{}'; actor uuid; who text; title text; verb text;
begin
 fields := case tg_table_name
 when 'items' then array['status','size','emplacement','commande_id','deleted_at']
 when 'commandes' then array['status','deleted_at']
 when 'sales_lines' then array['stage','sku_override','supplier_order_ref','supplier_tracking','location','actual_cost','fees_amount','refund_amount','finance_confirmed']
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

create or replace function public.sales_workspace_page(p_filters jsonb,p_known_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; rev text; page_no int := coalesce((p_filters->>'page')::int,0);
begin
 if page_no<0 or page_no>20000 then raise exception 'invalid_page'; end if;
 select version::text||':'||md5(p_filters::text)||':'||floor(extract(epoch from now())/60)::text into rev from public.workspace_revision where id=true;
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
 select * from matched order by case when not is_blocked and effective_stage<>'shipped' then deadline_at end asc nulls last,sale_date desc,id limit 50 offset page_no*50
 )
 select jsonb_build_object(
 'lines',coalesce((select jsonb_agg(to_jsonb(p)) from paged p),'[]'),
 'catalog',coalesce((select jsonb_agg(to_jsonb(d)) from public.sales_supplier_details d where d.sku in(select resolved_sku from paged)),'[]'),
 'count',(select count(*) from matched),'page_size',50,'page',page_no,'revision',rev,
 'counts',jsonb_build_object('all',(select count(*) from filtered),'review',(select count(*) from filtered where is_blocked),'missing_sku',(select count(*) from filtered where not is_blocked and resolved_sku=''))||
 coalesce((select jsonb_object_agg(effective_stage,n) from (select effective_stage,count(*) n from filtered where not is_blocked group by effective_stage) q),'{}'),
 'accounts',coalesce((select jsonb_agg(account_login order by account_login) from (select distinct account_login from public.workspace_sales where account_login<>'') a),'[]')
 ) into result;
 return result;
end $$;

commit;
