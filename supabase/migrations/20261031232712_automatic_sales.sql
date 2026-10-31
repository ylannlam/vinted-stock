begin;
create table public.dotb_sales_automation (
  id boolean primary key default true check(id), endpoint_id uuid, signing_secret text,
  enabled boolean not null default false, last_received_at timestamptz, last_error text,
  lease uuid, locked_until timestamptz not null default '-infinity'
);
insert into public.dotb_sales_automation(id) values(true);
create table public.dotb_received_events (
  id uuid primary key, type text not null, order_id uuid, created_at timestamptz not null,
  received_at timestamptz not null default now()
);
alter table public.dotb_sales_automation enable row level security;
alter table public.dotb_received_events enable row level security;
revoke all on public.dotb_sales_automation,public.dotb_received_events from public,anon,authenticated;
grant all on public.dotb_sales_automation,public.dotb_received_events to service_role;

-- One shared writer for manual imports and signed events. Keep local purchase/preparation fields.
create function public.upsert_sales_snapshot(p_orders jsonb,p_lines jsonb) returns void
language plpgsql security invoker set search_path='' as $$
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
      on conflict(id) do update set source=excluded.source,source_active=true,
        updated_at=case when sales_lines.source is distinct from excluded.source then clock_timestamp() else sales_lines.updated_at end;
    -- The listing ID is authoritative. A missing listing is offered for classification, never presumed recent.
    insert into public.catalog_dotb_items(id,sku,title,account_id,status,photo_url,synced_at)
      select distinct on (l.source->>'dotb_listing_id') (l.source->>'dotb_listing_id')::uuid,
        nullif(btrim(l.source->>'sku'),''),l.source->>'title',null,'imported',l.source->>'thumbnail_url',o.synced_at
      from public.sales_lines l where l.order_id=o.id and l.source_active and nullif(l.source->>'dotb_listing_id','') is not null
      on conflict(id) do nothing;
  end loop;
end; $$;

-- Include verified supplier information on a sale without turning a displayed price into a purchase cost.
create view public.sales_supplier_details with(security_invoker=true) as
with skus as (
  select sku from public.sales_catalog_resolved
  union select nullif(btrim(coalesce(sku_override,source->>'sku')),'') from public.sales_lines where source_active
)
select s.sku,coalesce(m.supplier_url,p.supplier_url) as supplier_url,m.variant,p.id as product_id,
  p.photo_url,p.price,p.currency,p.color,p.sizes,p.observed_at,p.collection_status,p.collection_message,
  p.description,p.details,p.photos,
  j.status as retrieval_status,j.message as retrieval_message
from skus s left join public.sales_catalog_resolved m on m.sku=s.sku
left join public.catalog_sku_links link on link.sku=s.sku
left join lateral (
  select summary.* from public.catalog_product_summary summary
  where (summary.id=link.product_id or (link.sku is null and lower(summary.supplier_sku)=lower(s.sku)
      and (select count(*) from public.catalog_products same where lower(same.supplier_sku)=lower(s.sku))=1))
    and (m.supplier_url is null or m.supplier_url=summary.supplier_url)
  limit 1
) p on true
left join lateral (
  select status,message from public.catalog_collection_jobs job
  where lower(job.expected_sku)=lower(s.sku) or job.product_id=p.id
  order by job.created_at desc,job.id desc limit 1
) j on true where s.sku is not null;
revoke all on public.sales_supplier_details from public,anon,authenticated;
grant select on public.sales_supplier_details to service_role;

create function public.queue_sales_sources(p_order_ids uuid[] default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare refs jsonb;
begin
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select distinct 'sku:'||btrim(coalesce(l.sku_override,l.source->>'sku')) as reference_key,
      coalesce(p.supplier_url,l.source->>'shein_url',d.supplier_canonical_url,btrim(coalesce(l.sku_override,l.source->>'sku'))) as input,
      btrim(coalesce(l.sku_override,l.source->>'sku')) as expected_sku,
      coalesce((select supplier_id from public.catalog_products where id=p.product_id),l.source->>'shein_id',d.supplier_id) as expected_supplier_id
    from public.sales_lines_in_period l
    left join public.sales_supplier_details p on p.sku=btrim(coalesce(l.sku_override,l.source->>'sku'))
    left join public.catalog_dotb_items d on d.id::text=l.source->>'dotb_listing_id'
    where l.source_active and l.tracking_status='included' and l."order"->>'status' is not null
      and l."order"->>'status' not in ('cancelled','returning','suspended','shipped','ready_for_pickup','delivered','completed')
      and l.stage='to_order' and (p_order_ids is null or l.order_id=any(p_order_ids))
      and btrim(coalesce(l.sku_override,l.source->>'sku')) ~ '^[A-Za-z0-9_-]{1,200}$'
      and (p.observed_at is null or p.observed_at<now()-interval '6 hours')
      and not exists(select 1 from public.catalog_collection_jobs job
        where (lower(job.expected_sku)=lower(btrim(coalesce(l.sku_override,l.source->>'sku'))) or job.product_id=p.product_id)
          and (job.status in ('queued','running') or job.created_at>now()-interval '1 hour'))
    limit 100
  ) x;
  return public.enqueue_catalog_collection(refs);
end; $$;

create function public.receive_dotb_order_event(p_event jsonb,p_orders jsonb,p_lines jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  -- Same lock as imports; a duplicate or out-of-order notification cannot overwrite newer data.
  perform 1 from public.dotb_sync_state where id for update;
  insert into public.dotb_received_events(id,type,order_id,created_at)
    values((p_event->>'id')::uuid,p_event->>'type',(p_event->>'order_id')::uuid,(p_event->>'created_at')::timestamptz)
    on conflict(id) do nothing;
  if not found then return false; end if;
  perform public.upsert_sales_snapshot(p_orders,p_lines);
  perform public.queue_sales_sources(array(select (value->>'id')::uuid from jsonb_array_elements(p_orders)));
  update public.dotb_sales_automation set last_received_at=now(),last_error=null where id;
  return true;
end; $$;

create or replace function public.import_dotb_page(p_orders jsonb,p_lines jsonb,p_cursor text,p_lease uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.dotb_sync_state where id and lease=p_lease and locked_until>now() for update;
  if not found then raise exception 'sync_lease_expired'; end if;
  perform public.upsert_sales_snapshot(p_orders,p_lines);
  perform public.queue_sales_sources(array(select (value->>'id')::uuid from jsonb_array_elements(p_orders)));
  update public.dotb_sync_state set cursor=p_cursor,processed=processed+jsonb_array_length(p_orders),
    last_completed_at=case when p_cursor is null then now() else last_completed_at end,
    locked_until='-infinity',lease=null,next_allowed_at=now()+interval '1.2 seconds' where id;
end; $$;
revoke all on function public.upsert_sales_snapshot(jsonb,jsonb),public.queue_sales_sources(uuid[]),public.receive_dotb_order_event(jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.upsert_sales_snapshot(jsonb,jsonb),public.queue_sales_sources(uuid[]),public.receive_dotb_order_event(jsonb,jsonb,jsonb) to service_role;
commit;
