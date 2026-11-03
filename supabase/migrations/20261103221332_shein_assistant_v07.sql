begin;
create table public.shein_sync_runs (
 id uuid primary key, collector_id uuid not null references public.catalog_collectors(id),
 mode text not null check(mode in ('full','incremental','targeted','range')),
 from_date date not null, to_date date not null, reference text,
 state text not null default 'running' check(state in('running','blocked','partial','completed')),
 discovered integer not null default 0 check(discovered between 0 and 2000),
 read_count integer not null default 0 check(read_count between 0 and 2000),
 errors jsonb not null default '[]' check(jsonb_typeof(errors)='array' and jsonb_array_length(errors)<=200),
 started_at timestamptz not null default now(), updated_at timestamptz not null default now(), finished_at timestamptz
);
create index shein_sync_runs_recent on public.shein_sync_runs(started_at desc);
create index shein_sync_runs_collector on public.shein_sync_runs(collector_id);
alter table public.shein_sync_runs enable row level security;
revoke all on public.shein_sync_runs from public,anon,authenticated;
grant all on public.shein_sync_runs to service_role;
alter table public.shein_orders add column shipment_observations jsonb not null default '[]', add column cost_summary jsonb;
alter table public.shein_order_items add column status_text text not null default '';
alter table public.shein_order_links add column cost_unit_index integer check(cost_unit_index>=0);
create unique index shein_order_cost_unit_unique on public.shein_order_links(item_id,cost_unit_index) where cost_unit_index is not null;

create function public.import_shein_order_v2(p_order jsonb,p_device uuid) returns void language plpgsql security invoker set search_path='' as $$
declare old_at timestamptz; entry jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('stock-vinted-shein-orders',0));
 select observed_at into old_at from public.shein_orders where ref=p_order->>'ref';
 if old_at >= (p_order->>'observed_at')::timestamptz then return;end if;
 perform public.import_shein_order(p_order,p_device);
 for entry in select value from jsonb_array_elements(p_order->'items') loop
  update public.shein_order_items set status_text=coalesce(entry->>'status_text','') where id=entry->>'id';
 end loop;
 if jsonb_array_length(coalesce(p_order->'parcels','[]'))>0 then
  update public.shein_orders set shipment_observations=(
   select coalesce(jsonb_agg(v),'[]') from (
    select distinct on (value->>'tracking_number') value as v from jsonb_array_elements(coalesce(p_order->'parcels','[]')||shipment_observations)
    order by value->>'tracking_number',(value->>'observed_at')::timestamptz desc
   ) latest
  ) where ref=p_order->>'ref';
 end if;
end $$;

create function public.finish_shein_sync_v2(p_device uuid,p_run uuid,p_count integer,p_discovered integer,p_errors jsonb,p_complete boolean) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; owner uuid; run public.shein_sync_runs;
begin
 select created_by into owner from public.catalog_collectors where id=p_device and enabled and revoked_at is null and expires_at>now();
 if owner is null then raise exception 'device_revoked';end if;
 select * into run from public.shein_sync_runs where id=p_run and collector_id=p_device for update;
 if run.id is null then raise exception 'sync_run_missing';end if;
 if run.finished_at is not null then return 0;end if;
 n:=public.reconcile_shein_orders(owner);
 update public.shein_sync_runs set state=case when p_complete and jsonb_array_length(p_errors)=0 then 'completed' else 'partial' end,
  read_count=p_count,discovered=p_discovered,errors=p_errors,finished_at=now(),updated_at=now() where id=p_run;
 if p_complete and jsonb_array_length(p_errors)=0 and run.mode<>'targeted' then
  update public.shein_sync_state set last_completed_at=now(),orders_read=p_count,linked_count=n where id;
 end if;
 return n;
end $$;

create function public.save_shein_cost(p_ref text,p_version timestamptz,p_summary jsonb,p_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.shein_orders; i jsonb; link record; amount numeric; ordinal integer; changed integer:=0; kept integer:=0;
begin
 perform app_private.shein_lock_sales();
 select * into o from public.shein_orders where ref=p_ref for update;
 if o.ref is null or o.updated_at is distinct from p_version then raise exception 'stale_version';end if;
 for i in select value from jsonb_array_elements(p_summary->'items') loop
  if not exists(select 1 from public.shein_order_items where id=i->>'id' and order_ref=p_ref and present and quantity=(i->>'quantity')::int and status in('processing','shipped','delivered')) then raise exception 'stale_version';end if;
  update public.shein_order_links set cost_unit_index=null where item_id=i->>'id';
  ordinal:=0;
  for link in select a.line_id,a.before_state,a.managed_state,l.actual_cost from public.shein_order_links a join public.sales_lines l on l.id=a.line_id where a.item_id=i->>'id' order by a.created_at,a.line_id loop
   amount:=(i->'amounts'->>ordinal)::numeric;ordinal:=ordinal+1;
   if amount is null then raise exception 'shein_quantity_used';end if;
   if link.actual_cost is null or (link.before_state->>'actual_cost' is null and link.actual_cost is not distinct from (link.managed_state->>'actual_cost')::numeric) then
    update public.sales_lines set actual_cost=amount,finance_confirmed=false,updated_at=clock_timestamp(),updated_by=p_user where id=link.line_id;
    update public.shein_order_links set cost_unit_index=ordinal-1,managed_state=jsonb_set(managed_state,'{actual_cost}',to_jsonb(amount)),updated_at=clock_timestamp() where line_id=link.line_id;
    changed:=changed+1;
   else update public.shein_order_links set cost_unit_index=ordinal-1 where line_id=link.line_id;kept:=kept+1;end if;
  end loop;
 end loop;
 update public.shein_orders set cost_summary=p_summary||jsonb_build_object('confirmed_at',now(),'applied',changed,'preserved',kept),updated_at=clock_timestamp() where ref=p_ref;
 return jsonb_build_object('saved',true,'applied',changed,'preserved',kept);
end $$;
revoke all on function public.import_shein_order_v2(jsonb,uuid),public.finish_shein_sync_v2(uuid,uuid,integer,integer,jsonb,boolean),public.save_shein_cost(text,timestamptz,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.import_shein_order_v2(jsonb,uuid),public.finish_shein_sync_v2(uuid,uuid,integer,integer,jsonb,boolean),public.save_shein_cost(text,timestamptz,jsonb,uuid) to service_role;
create function public.daily_purchase_context_v2(p_day date,p_include_earlier boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
 with day_lines as materialized (
  select w.*,a.item_id as shein_item_id from public.workspace_sales w
  left join public.shein_order_links a on a.line_id=w.id
  where (p_include_earlier or w.sale_date >= (p_day::timestamp at time zone 'Europe/Paris'))
    and w.sale_date < ((p_day+1)::timestamp at time zone 'Europe/Paris')
 ), skus as (select distinct lower(resolved_sku) as sku from day_lines where resolved_sku<>''),
 unallocated as (
  select i.sku,i.size,i.color,i.status,i.order_ref,o.order_date,
    i.quantity-(select count(*) from public.shein_order_links l where l.item_id=i.id) as remaining
  from public.shein_order_items i join public.shein_orders o on o.ref=i.order_ref
  where i.present and i.status in ('processing','shipped','delivered') and lower(i.sku) in(select sku from skus)
 ), earlier as (
  select count(*) as count,min((w.sale_date at time zone 'Europe/Paris')::date) as oldest_day
  from public.workspace_sales w where w.sale_date < (p_day::timestamp at time zone 'Europe/Paris')
   and not w.is_blocked and w.effective_stage='to_order' and nullif(btrim(w.supplier_order_ref),'') is null
   and not exists(select 1 from public.shein_order_links a where a.line_id=w.id)
 )
 select jsonb_build_object('include_earlier',p_include_earlier,'day',p_day,'time_zone','Europe/Paris','generated_at',now(),
  'lines',coalesce((select jsonb_agg(jsonb_build_object(
   'id',l.id,'updated_at',l.updated_at,'source',jsonb_build_object('title',l.source->>'title','thumbnail_url',l.source->>'thumbnail_url'),
   'deadline_at',l.deadline_at,'resolved_sku',l.resolved_sku,'sale_date',l.sale_date,'account_login',l.account_login,
   'is_blocked',l.is_blocked,'effective_stage',l.effective_stage,'supplier_order_ref',l.supplier_order_ref,
   'supplier_size',l.supplier_size,'supplier_color',l.supplier_color,'shein_item_id',l.shein_item_id,
   'listing_photo_url',l.listing_photo_url) order by l.sale_date,l.id) from day_lines l),'[]'::jsonb),
  'catalog',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('previous_price',(
   select obs.price from public.catalog_observations obs where obs.product_id=c.product_id and obs.price_scope='product'
    and obs.currency=c.currency and lower(obs.color)=lower(c.color) and obs.observed_at<c.observed_at
   order by obs.observed_at desc,obs.created_at desc,obs.id desc limit 1
  ))) from public.sales_supplier_details c where lower(c.sku) in(select sku from skus)),'[]'::jsonb),
  'unallocated',coalesce((select jsonb_agg(to_jsonb(u)) from unallocated u where remaining>0),'[]'::jsonb),
  'earlier_pending',(select to_jsonb(e) from earlier e),
  'last_order_run',(select jsonb_build_object('state',state,'updated_at',updated_at) from public.shein_sync_runs order by started_at desc limit 1),'orders_synced_at',(select last_completed_at from public.shein_sync_state where id),
  'sales_synced_at',(select last_completed_at from public.dotb_sync_state where id)
 );
$$;
revoke all on function public.daily_purchase_context_v2(date,boolean) from public,anon,authenticated;
grant execute on function public.daily_purchase_context_v2(date,boolean) to service_role;


create function app_private.apply_confirmed_shein_cost() returns trigger language plpgsql security invoker set search_path='' as $$
declare summary jsonb; entry jsonb; quantity_now integer; used integer; amount numeric;
begin
 if new.before_state->>'actual_cost' is not null then return new;end if;
 select o.cost_summary,i.quantity into summary,quantity_now from public.shein_order_items i join public.shein_orders o on o.ref=i.order_ref where i.id=new.item_id;
 if summary is null then return new;end if;
 select value into entry from jsonb_array_elements(summary->'items') where value->>'id'=new.item_id;
 if entry is null or (entry->>'quantity')::int<>quantity_now then return new;end if;
 select index into used from generate_series(0,quantity_now-1) as index where not exists(select 1 from public.shein_order_links where item_id=new.item_id and cost_unit_index=index) order by index limit 1;
 amount:=(entry->'amounts'->>used)::numeric;
 if amount is null then return new;end if;
 update public.sales_lines set actual_cost=amount,finance_confirmed=false,updated_at=clock_timestamp() where id=new.line_id;
 update public.shein_order_links set cost_unit_index=used,managed_state=jsonb_set(managed_state,'{actual_cost}',to_jsonb(amount)) where line_id=new.line_id;
 return new;
end $$;
revoke all on function app_private.apply_confirmed_shein_cost() from public,anon,authenticated;
grant execute on function app_private.apply_confirmed_shein_cost() to service_role;
create trigger apply_confirmed_shein_cost after insert on public.shein_order_links for each row execute function app_private.apply_confirmed_shein_cost();
commit;
