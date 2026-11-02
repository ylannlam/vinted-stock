begin;

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
 coalesce(raw.supplier_size,nullif(l.source->>'size','')) as supplier_size,raw.supplier_color,
 (raw.supplier_size is not null) as supplier_size_manual
 from public.sales_lines_in_period l join public.sales_lines raw on raw.id=l.id where l.source_active;

create or replace function public.save_sale_details(p_id text,p_version timestamptz,p_edit jsonb,p_product jsonb,p_fees numeric,p_refund numeric,p_confirmed boolean,p_variant jsonb,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_variant) is distinct from 'object' or length(coalesce(p_variant->>'size',''))>80 or length(coalesce(p_variant->>'color',''))>80 then raise exception 'invalid_variant'; end if;
 perform public.save_sales_workspace(p_id,p_version,p_edit,p_product,p_fees,p_refund,p_confirmed,p_user);
 update public.sales_lines set supplier_size=case when trim(p_variant->>'size')=source->>'size' then null else nullif(trim(p_variant->>'size'),'') end,supplier_color=nullif(trim(p_variant->>'color'),''),updated_at=clock_timestamp() where id=p_id;
end $$;
revoke all on function public.save_sale_details(text,timestamptz,jsonb,jsonb,numeric,numeric,boolean,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_sale_details(text,timestamptz,jsonb,jsonb,numeric,numeric,boolean,jsonb,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.upsert_sales_snapshot(p_orders jsonb, p_lines jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.sales_orders; accepted uuid;
begin
  for o in select * from jsonb_populate_recordset(null::public.sales_orders,p_orders) order by id loop
    accepted:=null;
    insert into public.sales_orders values(o.*)
      on conflict(id) do update set account_id=excluded.account_id,account_login=excluded.account_login,
        transaction_id=excluded.transaction_id,status=excluded.status,currency=excluded.currency,
        order_date=excluded.order_date,deadline=excluded.deadline,label_url=excluded.label_url,
        tracking_code=excluded.tracking_code,synced_at=excluded.synced_at
      where sales_orders.synced_at<=excluded.synced_at returning id into accepted;
    if accepted is null then continue; end if;
    update public.sales_lines set source_active=false where order_id=o.id;
    insert into public.sales_lines(id,order_id,dotb_item_id,source)
      select x.id,x.order_id,x.dotb_item_id,x.source from jsonb_to_recordset(p_lines) x(id text,order_id uuid,dotb_item_id uuid,source jsonb)
      where x.order_id=o.id
      on conflict(id) do update set source=case when sales_lines.source->>'size_origin'='dotb' and excluded.source->>'size_origin' is distinct from 'dotb'
        and sales_lines.source->>'dotb_listing_id'=excluded.source->>'dotb_listing_id'
        then excluded.source || jsonb_build_object('size',sales_lines.source->'size','size_label',sales_lines.source->'size_label','size_origin','dotb','size_id',sales_lines.source->'size_id','catalog_id',sales_lines.source->'catalog_id') else excluded.source end,source_active=true,
        updated_at=case when sales_lines.source is distinct from excluded.source then clock_timestamp() else sales_lines.updated_at end;
  end loop;
end; $function$;

-- Existing sales receive only explicitly stated sizes; manual overrides remain untouched.
with sizes as (
 select id,(regexp_match(source->>'title','\mtaille\s*:?\s*(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|[0-9]{2}|unique)\s*[.!]?\s*$','i'))[1] as size
 from public.sales_lines where nullif(source->>'size','') is null
 and coalesce(source->>'title','') !~* 'tour\s+de\s+taille'
)
update public.sales_lines l set source=l.source||jsonb_build_object('size',case when lower(s.size)='unique' then 'Taille unique' else upper(s.size) end,'size_label',s.size,'size_origin','title'),updated_at=clock_timestamp()
from sizes s where s.id=l.id and s.size is not null;

create table public.supplier_shipments (
 id uuid primary key default gen_random_uuid(),
 carrier text not null check(carrier in ('gofo','other')),
 tracking_number text not null check(tracking_number ~ '^[A-Z0-9][A-Z0-9-]{4,59}$'),
 order_ref text check(length(order_ref)<=200), eta text check(length(eta)<=100),
 manual_status text check(manual_status in ('pending','processing','in_transit','delivered','exception','returned')),
 status text not null default 'pending' check(status in ('pending','processing','in_transit','delivered','exception','returned')),
 events jsonb not null default '[]' check(jsonb_typeof(events)='array'),
 observed_at timestamptz,checked_at timestamptz,last_error text,
 refresh_after timestamptz not null default '-infinity',lease uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default clock_timestamp(),
 updated_by uuid references public.profiles(id),unique(carrier,tracking_number)
);
create table public.supplier_shipment_lines (
 shipment_id uuid not null references public.supplier_shipments(id),
 line_id text not null references public.sales_lines(id),
 primary key(shipment_id,line_id)
);
create index supplier_shipment_lines_line on public.supplier_shipment_lines(line_id);
create index supplier_shipments_created on public.supplier_shipments(created_at desc,id);
create index supplier_shipments_actor on public.supplier_shipments(updated_by);
alter table public.supplier_shipments enable row level security;
alter table public.supplier_shipment_lines enable row level security;
revoke all on public.supplier_shipments,public.supplier_shipment_lines from anon,authenticated;
grant all on public.supplier_shipments,public.supplier_shipment_lines to service_role;

create view public.workspace_supplier_shipments with(security_invoker=true) as
 select s.id,s.carrier,s.tracking_number,s.order_ref,s.eta,s.manual_status,s.status,s.events,s.observed_at,s.checked_at,s.last_error,s.refresh_after,s.created_at,s.updated_at,
 array_agg(l.id order by l.id) as line_ids,
 jsonb_agg(jsonb_build_object('id',l.id,'title',l.source->>'title','size',l.supplier_size,'account',l.account_login,'photo',l.source->>'thumbnail_url','updated_at',l.updated_at) order by l.id) as lines
 from public.supplier_shipments s join public.supplier_shipment_lines j on j.shipment_id=s.id
 join public.workspace_sales l on l.id=j.line_id group by s.id;
revoke all on public.workspace_supplier_shipments from public,anon,authenticated;
grant select on public.workspace_supplier_shipments to service_role;

create function public.save_supplier_shipment(p_id uuid,p_version timestamptz,p_fields jsonb,p_lines jsonb,p_user uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare parcel public.supplier_shipments; entry jsonb; row_line public.sales_lines; parcel_id uuid;
begin
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines)>100 or (p_id is null and jsonb_array_length(p_lines)=0) then raise exception 'invalid_batch';end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'invalid_batch';end if;
 perform set_config('app.actor_id',p_user::text,true);
 -- Match the lock order used by sale edits and imports.
 perform 1 from public.sales_orders where id in(select order_id from public.sales_lines where id in(select value->>'id' from jsonb_array_elements(p_lines))) order by id for update;
 for entry in select value from jsonb_array_elements(p_lines) order by value->>'id' loop
   select * into row_line from public.sales_lines where id=entry->>'id' for update;
   if not found or not exists(select 1 from public.workspace_sales where id=row_line.id) then raise exception 'line_not_found';end if;
   if row_line.updated_at is distinct from (entry->>'updated_at')::timestamptz then raise exception 'stale_version';end if;
 end loop;
 if p_id is null then
   insert into public.supplier_shipments(carrier,tracking_number,order_ref,eta,manual_status,updated_by)
   values(p_fields->>'carrier',p_fields->>'tracking_number',p_fields->>'order_ref',p_fields->>'eta',p_fields->>'manual_status',p_user)
   on conflict(carrier,tracking_number) do nothing returning id into parcel_id;
   if parcel_id is null then select id into parcel_id from public.supplier_shipments where carrier=p_fields->>'carrier' and tracking_number=p_fields->>'tracking_number' for update;end if;
 else
   select * into parcel from public.supplier_shipments where id=p_id for update;
   if not found then raise exception 'line_not_found';end if;
   if parcel.updated_at is distinct from p_version then raise exception 'stale_version';end if;
   -- The identity is immutable; a corrected number is attached as a new parcel.
   if parcel.carrier<>p_fields->>'carrier' or parcel.tracking_number<>p_fields->>'tracking_number' then raise exception 'invalid_tracking';end if;
   update public.supplier_shipments set order_ref=p_fields->>'order_ref',eta=p_fields->>'eta',manual_status=p_fields->>'manual_status',updated_by=p_user,updated_at=clock_timestamp() where id=p_id;
   parcel_id:=p_id;
 end if;
 insert into public.supplier_shipment_lines(shipment_id,line_id) select parcel_id,value->>'id' from jsonb_array_elements(p_lines) on conflict do nothing;
 update public.sales_lines set updated_at=clock_timestamp(),updated_by=p_user where id in(select value->>'id' from jsonb_array_elements(p_lines));
 return parcel_id;
end $$;
revoke all on function public.save_supplier_shipment(uuid,timestamptz,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.save_supplier_shipment(uuid,timestamptz,jsonb,jsonb,uuid) to service_role;

create function public.unlink_supplier_shipment(p_id uuid,p_line text,p_version timestamptz,p_user uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare v timestamptz;
begin
 perform 1 from public.sales_orders where id=(select order_id from public.sales_lines where id=p_line) for update;
 select updated_at into v from public.sales_lines where id=p_line for update;
 if v is null or v is distinct from p_version then raise exception 'stale_version';end if;
 delete from public.supplier_shipment_lines where shipment_id=p_id and line_id=p_line;
 update public.sales_lines set updated_at=clock_timestamp(),updated_by=p_user where id=p_line;
end $$;
revoke all on function public.unlink_supplier_shipment(uuid,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.unlink_supplier_shipment(uuid,text,timestamptz,uuid) to service_role;

commit;


