begin;

-- Roles are checked in PostgreSQL, including when the UI is bypassed.
create or replace function public.get_my_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;
revoke all on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated, service_role;

drop policy if exists "Authenticated users full access" on public.items;
drop policy if exists items_select_employe on public.items;
drop policy if exists items_stock_admin on public.items;
drop policy if exists commandes_all on public.commandes;
create policy items_read on public.items for select to authenticated
  using ((select public.get_my_role()) in ('admin','stock'));
create policy items_insert on public.items for insert to authenticated
  with check ((select public.get_my_role()) in ('admin','stock'));
create policy items_update on public.items for update to authenticated
  using ((select public.get_my_role()) in ('admin','stock'))
  with check ((select public.get_my_role()) in ('admin','stock'));
create policy commandes_read on public.commandes for select to authenticated
  using ((select public.get_my_role()) in ('admin','stock'));
create policy commandes_insert on public.commandes for insert to authenticated
  with check ((select public.get_my_role()) in ('admin','stock'));
create policy commandes_update on public.commandes for update to authenticated
  using ((select public.get_my_role()) in ('admin','stock'))
  with check ((select public.get_my_role()) in ('admin','stock'));
revoke all on public.items,public.commandes from anon,authenticated;
grant select,insert,update on public.items,public.commandes to authenticated;
revoke delete,truncate,references,trigger on public.vinted_accounts from authenticated;
revoke all on public.vinted_accounts from anon;
drop policy if exists profiles_read_authenticated on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id=(select auth.uid()) or (select public.get_my_role())='admin');

alter table public.items add column deleted_at timestamptz, add column trash_batch uuid;
alter table public.commandes add column deleted_at timestamptz, add column trash_batch uuid;
alter table public.vinted_accounts add column deleted_at timestamptz;
alter table public.sales_lines
  add column fees_amount numeric(12,2) not null default 0 check(fees_amount>=0),
  add column refund_amount numeric(12,2) not null default 0 check(refund_amount>=0),
  add column finance_confirmed boolean not null default false;
create index items_commande_idx on public.items(commande_id);
create index items_active_status_idx on public.items(status,created_at desc,id) where deleted_at is null;
create index commandes_active_idx on public.commandes(status,created_at desc,id) where deleted_at is null;
create index sales_lines_updated_by_idx on public.sales_lines(updated_by);
create index sales_orders_account_date_idx on public.sales_orders(account_login,order_date desc);
create index vinted_accounts_active_idx on public.vinted_accounts(created_at desc,id) where deleted_at is null;

create schema if not exists app_private;
revoke all on schema app_private from public,anon,authenticated;
create table public.workspace_events (
 id bigint generated always as identity primary key,
 entity text not null, entity_id text not null, label text not null,
 action text not null, actor_id uuid, actor_name text not null,
 changes jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.workspace_events enable row level security;
revoke all on public.workspace_events from anon,authenticated;
grant all on public.workspace_events to service_role;
grant usage,select on sequence public.workspace_events_id_seq to service_role;
create index workspace_events_recent_idx on public.workspace_events(created_at desc,id desc);
create index workspace_events_entity_idx on public.workspace_events(entity,entity_id,id desc);

-- The log deliberately excludes passwords, tokens, URLs, personal contacts and prompt text.
create function app_private.workspace_audit() returns trigger
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
 actor := coalesce(auth.uid(),nullif(current_setting('app.actor_id',true),'')::uuid);
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
revoke all on function app_private.workspace_audit() from public,anon,authenticated;
create trigger workspace_audit after insert or update or delete on public.items for each row execute function app_private.workspace_audit();
create trigger workspace_audit after insert or update or delete on public.commandes for each row execute function app_private.workspace_audit();
create trigger workspace_audit after insert or update or delete on public.sales_lines for each row execute function app_private.workspace_audit();
create trigger workspace_audit after insert or update or delete on public.vinted_accounts for each row execute function app_private.workspace_audit();
create trigger workspace_audit after update on public.creative_accounts for each row execute function app_private.workspace_audit();

-- A recoverable deletion never removes photos or labels from storage.
create function public.set_stock_trash(p_kind text,p_id uuid,p_restore boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare batch uuid; moved int; released int := 0;
begin
 if coalesce(public.get_my_role(),'') not in ('admin','stock') then raise exception 'forbidden' using errcode='42501'; end if;
 if p_kind='items' then
   perform 1 from public.items where id=p_id for update;
   if not found then raise exception 'not_found'; end if;
   if p_restore then
     if exists(select 1 from public.items i join public.commandes c on c.id=i.commande_id where i.id=p_id and c.deleted_at is not null) then raise exception 'restore_parent_first'; end if;
     update public.items i set emplacement=null where i.id=p_id and i.deleted_at is not null and i.emplacement is not null
       and exists(select 1 from public.items other where other.id<>i.id and other.deleted_at is null and other.status<>'envoye' and lower(trim(other.emplacement))=lower(trim(i.emplacement)));
     get diagnostics released=row_count;
     update public.items set deleted_at=null,trash_batch=null where id=p_id and deleted_at is not null;
   else
     update public.items set deleted_at=now(),trash_batch=gen_random_uuid() where id=p_id and deleted_at is null;
   end if;
 elsif p_kind='commandes' then
   select trash_batch into batch from public.commandes where id=p_id for update;
   if not found then raise exception 'not_found'; end if;
   if p_restore then
     update public.commandes set deleted_at=null,trash_batch=null where id=p_id and deleted_at is not null;
     update public.items i set emplacement=null where i.commande_id=p_id and i.trash_batch=batch and i.deleted_at is not null
       and exists(select 1 from public.items other where other.id<>i.id and other.deleted_at is null and other.status<>'envoye' and lower(trim(other.emplacement))=lower(trim(i.emplacement)));
     get diagnostics released=row_count;
     update public.items set deleted_at=null,trash_batch=null where commande_id=p_id and trash_batch=batch;
   else
     batch:=gen_random_uuid();
     update public.commandes set deleted_at=now(),trash_batch=batch where id=p_id and deleted_at is null;
     if found then update public.items set deleted_at=now(),trash_batch=batch where commande_id=p_id and deleted_at is null; end if;
   end if;
 else raise exception 'invalid_kind'; end if;
 get diagnostics moved=row_count;
 return jsonb_build_object('changed',moved,'locations_released',released);
end $$;
revoke all on function public.set_stock_trash(text,uuid,boolean) from public,anon;
grant execute on function public.set_stock_trash(text,uuid,boolean) to authenticated,service_role;

-- Receiving an order is all-or-nothing, including its slots and final status.
create function public.receive_stock_order(p_id uuid,p_slots jsonb)
returns setof public.items language plpgsql security invoker set search_path='' as $$
declare row_item public.items; slot text; expected int;
begin
 if coalesce(public.get_my_role(),'') not in ('admin','stock') then raise exception 'forbidden' using errcode='42501'; end if;
 perform 1 from public.commandes where id=p_id and deleted_at is null and status='en_attente' for update;
 if not found then raise exception 'order_changed'; end if;
 if jsonb_typeof(p_slots)<>'object' or p_slots='{}'::jsonb then raise exception 'invalid_slots'; end if;
 select count(*) into expected from public.items where commande_id=p_id and status='a_recevoir' and deleted_at is null;
 if expected<>(select count(*) from jsonb_object_keys(p_slots)) then raise exception 'order_changed'; end if;
 if exists(select 1 from jsonb_each_text(p_slots) group by lower(trim(value)) having count(*)>1) then raise exception 'slot_occupied'; end if;
 -- Serialize slot allocation between simultaneous receptions/restores.
 perform pg_advisory_xact_lock(721985);
 for row_item in select * from public.items where commande_id=p_id and status='a_recevoir' and deleted_at is null order by id for update loop
   slot:=trim(p_slots->>row_item.id::text);
   if slot is null or length(slot)<1 or length(slot)>40 then raise exception 'invalid_slots'; end if;
   if exists(select 1 from public.items where id<>row_item.id and deleted_at is null and status<>'envoye' and lower(trim(emplacement))=lower(slot)) then raise exception 'slot_occupied'; end if;
   update public.items set status='en_stock',emplacement=slot where id=row_item.id;
 end loop;
 update public.commandes set status='recue' where id=p_id;
 return query select * from public.items where commande_id=p_id and deleted_at is null;
end $$;
revoke all on function public.receive_stock_order(uuid,jsonb) from public,anon;
grant execute on function public.receive_stock_order(uuid,jsonb) to authenticated,service_role;

-- Internal version invalidates paged sales only when persisted data changes.
create table public.workspace_revision(id boolean primary key default true check(id),version bigint not null default 1);
insert into public.workspace_revision(id) values(true);
alter table public.workspace_revision enable row level security;
revoke all on public.workspace_revision from public,anon,authenticated;
grant all on public.workspace_revision to service_role;
create function app_private.workspace_bump() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.workspace_revision set version=version+1 where id=true; return null; end $$;
revoke all on function app_private.workspace_bump() from public,anon,authenticated;
create trigger workspace_bump after insert or update or delete on public.sales_lines for each statement execute function app_private.workspace_bump();
create trigger workspace_bump after insert or update or delete on public.sales_orders for each statement execute function app_private.workspace_bump();
create trigger workspace_bump after insert or update or delete on public.sales_catalog for each statement execute function app_private.workspace_bump();
create trigger workspace_bump after insert or update or delete on public.catalog_observations for each statement execute function app_private.workspace_bump();
create trigger workspace_bump after insert or update or delete on public.catalog_products for each statement execute function app_private.workspace_bump();
create trigger workspace_bump after insert or update or delete on public.catalog_sku_links for each statement execute function app_private.workspace_bump();
create trigger workspace_bump after insert or update or delete on public.catalog_collection_jobs for each statement execute function app_private.workspace_bump();

create view public.workspace_sales with(security_invoker=true) as
 select l.*,raw.fees_amount,raw.refund_amount,raw.finance_confirmed,
 trim(coalesce(l.sku_override,l.source->>'sku','')) as resolved_sku,
 coalesce(l."order"->>'account_login','') as account_login,
 (l."order"->>'order_date')::timestamptz as sale_date,
 (l."order"->>'deadline')::timestamptz as deadline_at,
 coalesce(l."order"->>'status','') as order_status,
 coalesce(l."order"->>'currency','') as currency,
 (l."order"->>'status' is null or l."order"->>'status' in ('cancelled','returning','suspended')) as is_blocked,
 case when l."order"->>'status' in ('shipped','ready_for_pickup','delivered','completed') then 'shipped' else l.stage end as effective_stage
 from public.sales_lines_in_period l join public.sales_lines raw on raw.id=l.id where l.source_active;
revoke all on public.workspace_sales from anon,authenticated;
grant select on public.workspace_sales to service_role;

create function public.sales_workspace_page(p_filters jsonb,p_known_revision text default null)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb; rev text; page_no int := coalesce((p_filters->>'page')::int,0);
begin
 if page_no<0 or page_no>20000 then raise exception 'invalid_page'; end if;
 select version::text||':'||md5(p_filters::text) into rev from public.workspace_revision where id=true;
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
revoke all on function public.sales_workspace_page(jsonb,text) from public,anon,authenticated;
grant execute on function public.sales_workspace_page(jsonb,text) to service_role;

create function public.save_sales_workspace(p_id text,p_version timestamptz,p_edit jsonb,p_product jsonb,p_fees numeric,p_refund numeric,p_confirmed boolean,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_fees is null or p_refund is null or p_fees<0 or p_refund<0 or p_fees>1000000 or p_refund>1000000 then raise exception 'invalid_finance'; end if;
 if p_confirmed and p_edit->>'actual_cost' is null then raise exception 'cost_required'; end if;
 perform set_config('app.actor_id',p_user::text,true);
 perform public.save_sales_line(p_id,p_version,p_edit,p_product,null,p_user);
 update public.sales_lines set fees_amount=p_fees,refund_amount=p_refund,finance_confirmed=coalesce(p_confirmed,false),updated_at=clock_timestamp() where id=p_id;
end $$;
revoke all on function public.save_sales_workspace(text,timestamptz,jsonb,jsonb,numeric,numeric,boolean,uuid) from public,anon,authenticated;
grant execute on function public.save_sales_workspace(text,timestamptz,jsonb,jsonb,numeric,numeric,boolean,uuid) to service_role;

create function public.save_sales_batch(p_lines jsonb,p_action text,p_value text,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare entry jsonb; row_line public.sales_lines; parent public.sales_orders;
begin
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then raise exception 'invalid_batch'; end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'invalid_batch'; end if;
 if p_action not in ('order_ref','advance') then raise exception 'invalid_batch'; end if;
 if p_action='order_ref' and (length(trim(p_value)) not between 1 and 200 or p_value is null) then raise exception 'invalid_batch'; end if;
 perform set_config('app.actor_id',p_user::text,true);
 perform 1 from public.sales_orders where id in(select order_id from public.sales_lines where id in(select value->>'id' from jsonb_array_elements(p_lines))) order by id for update;
 for entry in select value from jsonb_array_elements(p_lines) order by value->>'id' loop
   select * into row_line from public.sales_lines where id=entry->>'id' for update;
   if not found then raise exception 'line_not_found'; end if;
   if row_line.updated_at is distinct from (entry->>'updated_at')::timestamptz then raise exception 'stale_version'; end if;
   select * into parent from public.sales_orders where id=row_line.order_id;
   if not row_line.source_active or parent.status is null or parent.status in ('cancelled','returning','suspended','shipped','ready_for_pickup','delivered','completed') then raise exception 'order_blocked'; end if;
   if p_action='advance' then
     perform public.save_sales_line(row_line.id,row_line.updated_at,null,null,p_value,p_user);
   else
     update public.sales_lines set supplier_order_ref=trim(p_value),updated_by=p_user,updated_at=clock_timestamp() where id=row_line.id;
   end if;
 end loop;
end $$;
revoke all on function public.save_sales_batch(jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.save_sales_batch(jsonb,text,text,uuid) to service_role;

create function public.workspace_overview() returns jsonb language sql stable security invoker set search_path='' as $$
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
 'collector',jsonb_build_object('pending',(select count(*) from public.catalog_collection_jobs where status in ('queued','running')),
 'review',(select count(*) from public.catalog_collection_jobs where status in ('blocked','failed'))),
 'directions',jsonb_build_object('selected',(select count(*) from public.creative_accounts where enabled),
 'incomplete',(select count(*) from public.creative_accounts a left join public.creative_resources r on r.id=a.background_id where a.enabled and (r.id is null or r.archived_at is not null or trim(coalesce(a.prompt_front,r.content,''))='' or trim(coalesce(a.prompt_back,r.content_back,''))='')))
 )
$$;
revoke all on function public.workspace_overview() from public,anon,authenticated;
grant execute on function public.workspace_overview() to service_role;

create function public.workspace_finance(p_month text default '',p_page int default 0) returns jsonb
language sql stable security invoker set search_path='' as $$
 with rows as materialized (
 select s.id,s.source->>'title' title,s.account_login,s.sale_date,s.order_status,s.currency,s.actual_cost,s.fees_amount,s.refund_amount,s.finance_confirmed,
 case when (s.source->>'selling_price') ~ '^\d+(\.\d+)?$' then (s.source->>'selling_price')::numeric end as revenue,
 case when s.actual_cost is not null then s.actual_cost when d.currency=s.currency then d.price end as estimated_cost
 from public.workspace_sales s left join public.sales_supplier_details d on d.sku=s.resolved_sku
 where (p_month='' or to_char(s.sale_date at time zone 'Europe/Paris','YYYY-MM')=p_month)
 and s.order_status not in ('cancelled','suspended','')
 ), totals as (
 select currency,count(*) as quantity,count(*) filter(where order_status='returning') as returns,
 coalesce(sum(revenue-refund_amount),0) as net_revenue,
 count(*) filter(where revenue is null) as missing_revenue,
 coalesce(sum(revenue-refund_amount-fees_amount-estimated_cost) filter(where estimated_cost is not null and revenue is not null and order_status<>'returning'),0) as estimated_margin,
 count(*) filter(where estimated_cost is not null and revenue is not null and order_status<>'returning') as estimated_count,
 coalesce(sum(revenue-refund_amount-fees_amount-actual_cost) filter(where finance_confirmed and actual_cost is not null and revenue is not null),0) as confirmed_margin,
 count(*) filter(where finance_confirmed and actual_cost is not null and revenue is not null) as confirmed_count,
 coalesce(sum(actual_cost),0) as purchase_cost,coalesce(sum(fees_amount),0) as fees,coalesce(sum(refund_amount),0) as refunds
 from rows group by currency
 )
 select jsonb_build_object('totals',coalesce((select jsonb_agg(to_jsonb(t)) from totals t),'[]'),
 'rows',coalesce((select jsonb_agg(to_jsonb(p)) from (select * from rows order by sale_date desc,id limit 50 offset greatest(p_page,0)*50) p),'[]'),
 'count',(select count(*) from rows),'page',p_page,'page_size',50)
$$;
revoke all on function public.workspace_finance(text,int) from public,anon,authenticated;
grant execute on function public.workspace_finance(text,int) to service_role;

commit;
