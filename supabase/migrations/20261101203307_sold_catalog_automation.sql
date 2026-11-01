begin;
create function public.is_sold_catalog_reference(p_sku text,p_supplier_id text default null)
returns boolean language sql stable security invoker set search_path='' as $$
  select case when nullif(btrim(p_sku),'') is not null then
    exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(btrim(p_sku)))
  else exists(
    select 1 from public.catalog_products p where p.supplier_id=p_supplier_id and (
      exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(p.supplier_sku))
      or exists(select 1 from public.catalog_sku_links l join public.catalog_sales_by_sku s on s.sku=l.sku where l.product_id=p.id)))
  end;
$$;
revoke all on function public.is_sold_catalog_reference(text,text) from public,anon,authenticated;
grant execute on function public.is_sold_catalog_reference(text,text) to service_role;
create view public.catalog_sales_items with(security_invoker=true) as
select l.id,btrim(coalesce(l.sku_override,l.source->>'sku')) as sku,l.source->>'title' as title,
  coalesce(p.supplier_url,l.source->>'shein_url') as supplier_url,
  coalesce((select supplier_id from public.catalog_products where id=p.product_id),l.source->>'shein_id') as supplier_id,
  coalesce(p.supplier_url,l.source->>'shein_url') as supplier_canonical_url,
  case when coalesce(p.supplier_url,l.source->>'shein_url') is not null then 'valid' else 'missing' end as supplier_link_status,
  l.source->>'thumbnail_url' as photo_url,(nullif(l.source->>'selling_price',''))::numeric as price,
  l."order"->>'currency' as currency,'Vendu'::text as status,
  (l."order"->>'order_date')::timestamptz as sold_at
from public.sales_lines_in_period l left join public.sales_supplier_details p on p.sku=btrim(coalesce(l.sku_override,l.source->>'sku'))
where l.source_active and l."order"->>'status' is not null and l."order"->>'status' not in ('cancelled','returning','suspended');
revoke all on public.catalog_sales_items from public,anon,authenticated;
grant select on public.catalog_sales_items to service_role;

create or replace view public.catalog_tracked_items with(security_invoker=true) as
select i.* from public.catalog_dotb_items i where exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(i.sku));
create or replace view public.catalog_tracked_links with(security_invoker=true) as
select l.* from public.catalog_sku_links l where exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(l.sku));
create or replace view public.catalog_tracked_products with(security_invoker=true) as
select p.* from public.catalog_product_summary p where
  exists(select 1 from public.catalog_tracked_links l where l.product_id=p.id)
  or (exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(p.supplier_sku))
      and not exists(select 1 from public.catalog_sku_links l where lower(l.sku)=lower(p.supplier_sku)));

CREATE OR REPLACE FUNCTION public.enqueue_catalog_collection(p_refs jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare added integer;
begin
  if jsonb_typeof(p_refs)<>'array' or jsonb_array_length(p_refs)>100 then raise exception 'invalid_references'; end if;
  if exists(select 1 from jsonb_to_recordset(p_refs) r(expected_sku text,expected_supplier_id text)
    where not public.is_sold_catalog_reference(r.expected_sku,r.expected_supplier_id)) then raise exception 'unsold_reference'; end if;
  with inserted as (
    insert into public.catalog_collection_jobs(reference_key,input,expected_sku,expected_supplier_id,product_id)
    select r.reference_key,r.input,coalesce(r.expected_sku,p.supplier_sku),r.expected_supplier_id,p.id
    from jsonb_to_recordset(p_refs) r(reference_key text,input text,expected_sku text,expected_supplier_id text)
    left join public.catalog_products p on p.supplier_id=r.expected_supplier_id
    on conflict(reference_key) where status in ('queued','running') do nothing returning product_id
  ), changed as (
    update public.catalog_products set collection_status='queued',collection_message=null
    where id in (select product_id from inserted) returning id
  ) select count(*) into added from inserted;
  return added;
end; $function$;

create or replace function public.queue_sales_sources(p_order_ids uuid[] default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare refs jsonb;
begin
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select distinct on (lower(btrim(coalesce(l.sku_override,l.source->>'sku'))))
      'sku:'||lower(btrim(coalesce(l.sku_override,l.source->>'sku'))) as reference_key,
      coalesce(p.supplier_url,l.source->>'shein_url',btrim(coalesce(l.sku_override,l.source->>'sku'))) as input,
      btrim(coalesce(l.sku_override,l.source->>'sku')) as expected_sku,
      coalesce((select supplier_id from public.catalog_products where id=p.product_id),l.source->>'shein_id') as expected_supplier_id
    from public.sales_lines_in_period l
    left join public.sales_supplier_details p on p.sku=btrim(coalesce(l.sku_override,l.source->>'sku'))
    left join lateral (
      select job.status,job.created_at from public.catalog_collection_jobs job
      where lower(job.expected_sku)=lower(btrim(coalesce(l.sku_override,l.source->>'sku'))) or job.product_id=p.product_id
      order by job.created_at desc,job.id desc limit 1
    ) latest on true
    where l.source_active and l."order"->>'status' is not null
      and l."order"->>'status' not in ('cancelled','returning','suspended')
      and (p_order_ids is null or l.order_id=any(p_order_ids))
      and btrim(coalesce(l.sku_override,l.source->>'sku')) ~ '^[A-Za-z0-9_-]{1,200}$'
      and (p.observed_at is null or p.observed_at<now()-interval '6 hours')
      and not exists(select 1 from public.catalog_collection_jobs job
        where (lower(job.expected_sku)=lower(btrim(coalesce(l.sku_override,l.source->>'sku'))) or job.product_id=p.product_id)
          and job.status in ('queued','running'))
      and (latest.status is null or latest.status not in ('blocked','failed'))
      and (latest.created_at is null or latest.created_at<=now()-interval '1 hour')
    order by lower(btrim(coalesce(l.sku_override,l.source->>'sku'))),l."order"->>'order_date' desc,l.id
    limit 100
  ) x;
  return public.enqueue_catalog_collection(refs);
end; $$;
-- Every collector poll catches up sold SKUs, even after a reset, restart or missing listing ID.
create or replace function public.queue_catalog_sources() returns integer
language sql security invoker set search_path='' as $$ select public.queue_sales_sources(); $$;

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
      on conflict(id) do update set source=excluded.source,source_active=true,
        updated_at=case when sales_lines.source is distinct from excluded.source then clock_timestamp() else sales_lines.updated_at end;
  end loop;
end; $function$;

CREATE OR REPLACE FUNCTION public.finish_catalog_collection(p_job uuid, p_device uuid, p_lease uuid, p_result jsonb, p_failure text DEFAULT NULL::text, p_message text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.catalog_collection_jobs; product_uuid uuid; source_sku text;
begin
  if not exists(select 1 from public.catalog_collectors c join public.profiles u on u.id=c.created_by
    where c.id=p_device and c.revoked_at is null and c.expires_at>now() and u.role='admin') then raise exception 'device_revoked'; end if;
  select * into j from public.catalog_collection_jobs where id=p_job for update;
  if not found or j.collector_id is distinct from p_device or j.lease is distinct from p_lease then raise exception 'collection_lease_expired'; end if;
  -- Idempotent network retries never add a second price observation.
  if j.status='completed' then return j.product_id; end if;
  if j.status in ('blocked','failed') and p_failure=j.status then return j.product_id; end if;
  if j.status<>'running' or j.lease_expires_at<=now() then raise exception 'collection_lease_expired'; end if;
  if not public.is_sold_catalog_reference(j.expected_sku,j.expected_supplier_id) then
    update public.catalog_collection_jobs set status='excluded',finished_at=now(),message='La vente a été retirée du suivi.' where id=p_job;
    return null;
  end if;
  if p_failure is not null then
    if p_failure not in ('blocked','failed') then raise exception 'invalid_failure'; end if;
    update public.catalog_collection_jobs set status=p_failure,finished_at=now(),message=left(p_message,500) where id=p_job;
    update public.catalog_products set collection_status=p_failure,collection_message=left(p_message,500),next_check_at=null where id=j.product_id;
    return j.product_id;
  end if;
  if p_result->>'supplier_id' !~ '^[0-9]{1,20}$' or nullif(p_result->>'supplier_sku','') is null
    or (j.expected_supplier_id is not null and j.expected_supplier_id<>p_result->>'supplier_id')
    or (j.expected_sku is not null and lower(j.expected_sku)<>lower(p_result->>'supplier_sku'))
    or (p_result->>'price')::numeric<=0 then raise exception 'collection_product_mismatch'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_result->>'supplier_id',0));
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku,photo_url,photos,description,details,sizes,last_checked_at,next_check_at,collection_status)
    values(p_result->>'supplier_id',p_result->>'supplier_url',p_result->>'title',p_result->>'supplier_sku',p_result->'photos'->>0,
      p_result->'photos',p_result->>'description',p_result->'details',p_result->'sizes',(p_result->>'observed_at')::timestamptz,now()+interval '6 hours','completed')
    on conflict(supplier_id) do update set supplier_url=excluded.supplier_url,title=excluded.title,supplier_sku=excluded.supplier_sku,
      photo_url=coalesce(excluded.photo_url,catalog_products.photo_url),
      photos=case when jsonb_array_length(excluded.photos)>0 then excluded.photos else catalog_products.photos end,
      description=coalesce(nullif(excluded.description,''),catalog_products.description),details=excluded.details,sizes=excluded.sizes,
      last_checked_at=excluded.last_checked_at,next_check_at=excluded.next_check_at,collection_status='completed',collection_message=null,updated_at=clock_timestamp()
    returning id into product_uuid;
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at,note,price_scope)
    values(p_job,product_uuid,(p_result->>'price')::numeric,'EUR','',p_result->>'color','unknown','pc_collector',
      (p_result->>'observed_at')::timestamptz,p_result->>'note','product');
  source_sku:=coalesce(j.expected_sku,p_result->>'supplier_sku');
  if public.is_sold_catalog_reference(source_sku,p_result->>'supplier_id') then
    insert into public.catalog_sku_links(sku,product_id) values(source_sku,product_uuid) on conflict(sku) do nothing;
  end if;
  update public.catalog_collection_jobs set status='completed',product_id=product_uuid,finished_at=now(),message=null where id=p_job;
  return product_uuid;
end; $function$;

CREATE OR REPLACE FUNCTION public.save_sales_line(p_id text, p_version timestamp with time zone, p_edit jsonb, p_product jsonb, p_stage text, p_user uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.sales_lines; o public.sales_orders; target text; current_sku text; supplier text;
begin
  -- Lock the parent first, as imports do; serialize changes within a bundle.
  select * into o from public.sales_orders where id=(select order_id from public.sales_lines where id=p_id) for update;
  if not found then raise exception 'line_not_found'; end if;
  select * into l from public.sales_lines where id=p_id for update;
  if not found then raise exception 'line_not_found'; end if;
  if l.updated_at <> p_version then raise exception 'stale_version'; end if;
  if p_stage is not null then
    if not l.source_active or o.status is null or o.status in ('cancelled','returning','suspended','shipped','ready_for_pickup','delivered','completed') then raise exception 'order_blocked'; end if;
    target := case l.stage when 'to_order' then 'ordered' when 'ordered' then 'in_transit' when 'in_transit' then 'received' when 'received' then 'prepared' when 'prepared' then 'shipped' end;
    if p_stage is distinct from target then raise exception 'invalid_transition'; end if;
    current_sku := coalesce(l.sku_override, l.source->>'sku');
    select supplier_url into supplier from public.sales_catalog_resolved where sku=current_sku;
    supplier := coalesce(supplier,l.source->>'supplier_link');
    if p_stage='ordered' and (coalesce(trim(current_sku),'')='' or coalesce(supplier,'')='' or coalesce(trim(l.supplier_order_ref),'')='') then raise exception 'purchase_details_required'; end if;
    -- Bundles must be prepared completely before any line is marked deposited.
    if p_stage='shipped' and exists(select 1 from public.sales_lines where order_id=l.order_id and source_active and stage not in ('prepared','shipped')) then raise exception 'bundle_not_ready'; end if;
    update public.sales_lines set stage=p_stage,
      ordered_at=case when p_stage='ordered' then now() else ordered_at end,
      received_at=case when p_stage='received' then now() else received_at end,
      shipped_at=case when p_stage='shipped' then now() else shipped_at end,
      updated_at=clock_timestamp(), updated_by=p_user where id=p_id;
  else
    if p_product is not null then
      insert into public.sales_catalog(sku,supplier_url,variant)
        values(p_product->>'sku',p_product->>'supplier_url',p_product->>'variant')
        on conflict(sku) do update set supplier_url=excluded.supplier_url,variant=excluded.variant,updated_at=clock_timestamp();
    end if;
    update public.sales_lines set sku_override=p_edit->>'sku_override', supplier_order_ref=p_edit->>'supplier_order_ref',
      supplier_tracking=p_edit->>'supplier_tracking', location=p_edit->>'location', notes=p_edit->>'notes',
      actual_cost=(p_edit->>'actual_cost')::numeric, updated_at=clock_timestamp(), updated_by=p_user where id=p_id;
  end if;
  perform public.queue_sales_sources(array[l.order_id]);
end; $function$;

CREATE OR REPLACE FUNCTION public.link_catalog_sku(p_sku text, p_product uuid, p_updated timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare previous timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_sku,1));
  if not public.is_sold_catalog_reference(p_sku,null) then raise exception 'sku_missing'; end if;
  select updated_at into previous from public.catalog_sku_links where sku=p_sku for update;
  if previous is distinct from p_updated then raise exception 'link_conflict'; end if;
  insert into public.catalog_sku_links(sku,product_id) values(p_sku,p_product)
    on conflict(sku) do update set product_id=excluded.product_id,updated_at=clock_timestamp();
end; $function$;

CREATE OR REPLACE FUNCTION public.create_catalog_product_for_sku(p_sku text, p_supplier_id text, p_supplier_url text, p_updated timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare product_uuid uuid; source_item record;
begin
  if p_supplier_id !~ '^[0-9]{1,20}$' then raise exception 'supplier_invalid'; end if;
  select * into source_item from public.catalog_sales_items where sku=p_sku order by sold_at desc,id limit 1;
  if not found then raise exception 'sku_missing'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_supplier_id,0));
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku,photo_url)
    values(p_supplier_id,p_supplier_url,coalesce(nullif(source_item.title,''),'Produit Shein '||p_sku),p_sku,source_item.photo_url)
    on conflict(supplier_id) do nothing;
  select id into product_uuid from public.catalog_products where supplier_id=p_supplier_id;
  perform public.link_catalog_sku(p_sku,product_uuid,p_updated);
  perform public.queue_sales_sources();
  return product_uuid;
end; $function$;

CREATE OR REPLACE FUNCTION public.record_catalog_observation(p_product jsonb, p_observation jsonb, p_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare product_uuid uuid; existing_product uuid;
begin
  if not public.is_sold_catalog_reference(p_product->>'supplier_sku',p_product->>'supplier_id') then raise exception 'unsold_reference'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_product->>'supplier_id',0));
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku,photo_url)
    values(p_product->>'supplier_id',p_product->>'supplier_url',p_product->>'title',p_product->>'supplier_sku',p_product->>'photo_url')
    on conflict(supplier_id) do update set supplier_sku=coalesce(catalog_products.supplier_sku,excluded.supplier_sku),
      photo_url=coalesce(catalog_products.photo_url,excluded.photo_url);
  select id into product_uuid from public.catalog_products where supplier_id=p_product->>'supplier_id';
  select product_id into existing_product from public.catalog_observations where id=(p_observation->>'id')::uuid;
  if found then
    if existing_product<>product_uuid then raise exception 'capture_conflict'; end if;
    return product_uuid;
  end if;
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at,note,created_by)
    values((p_observation->>'id')::uuid,product_uuid,(p_observation->>'price')::numeric,p_observation->>'currency',
      p_observation->>'size',p_observation->>'color',p_observation->>'availability',p_observation->>'source',
      (p_observation->>'observed_at')::timestamptz,p_observation->>'note',p_user);
  return product_uuid;
end; $function$;

CREATE OR REPLACE FUNCTION public.claim_catalog_collection(p_device uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.catalog_collection_jobs; d public.catalog_collectors;
begin
  select * into d from public.catalog_collectors where id=p_device and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'device_revoked'; end if;
  update public.catalog_collectors set last_seen_at=now() where id=p_device;
  if not d.enabled then return jsonb_build_object('paused',true,'job',null); end if;
  update public.catalog_collection_jobs set status=case when attempts>=3 then 'failed' else 'queued' end,
    message='La connexion au PC a �t� interrompue.',lease=null,lease_expires_at=null
    where status='running' and lease_expires_at<now();
  update public.catalog_products p set collection_status='failed',collection_message='La connexion au PC a �t� interrompue. Relancez la r�cup�ration.',next_check_at=null
    where p.collection_status='running' and exists(select 1 from public.catalog_collection_jobs task where task.product_id=p.id and task.status='failed')
    and not exists(select 1 from public.catalog_collection_jobs task where task.product_id=p.id and task.status in ('queued','running'));
  update public.catalog_collection_jobs q set status='excluded',finished_at=now(),message='Aucune vente à suivre pour cette référence.'
    where q.status='queued' and not public.is_sold_catalog_reference(q.expected_sku,q.expected_supplier_id);
  perform public.queue_catalog_sources();
  -- A collector processes exactly one job at a time, even if a claim response is lost.
  select * into j from public.catalog_collection_jobs where collector_id=p_device and status='running' and lease_expires_at>now() order by created_at limit 1;
  if found then return jsonb_build_object('paused',false,'job',to_jsonb(j)); end if;
  select * into j from public.catalog_collection_jobs where status='queued' order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('paused',false,'job',null); end if;
  update public.catalog_collection_jobs set status='running',attempts=attempts+1,collector_id=p_device,
    lease=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',started_at=now(),message=null where id=j.id returning * into j;
  update public.catalog_products set collection_status='running',collection_message=null where id=j.product_id;
  return jsonb_build_object('paused',false,'job',to_jsonb(j));
end; $function$;

-- The catalogue is fed by sales only; retire bulk listing imports.
revoke execute on function public.import_catalog_dotb_page(jsonb,text,uuid) from service_role;
-- Queue current sold references once. Later arrivals enqueue in the webhook transaction.
select public.queue_sales_sources();
commit;
