begin;
alter table public.catalog_products
  add column photos jsonb not null default '[]',
  add column description text,
  add column details jsonb not null default '[]',
  add column sizes jsonb not null default '[]',
  add column last_checked_at timestamptz,
  add column next_check_at timestamptz default now(),
  add column collection_status text not null default 'queued' check(collection_status in ('queued','running','completed','blocked','failed')),
  add column collection_message text,
  add column auto_collect boolean not null default true;
alter table public.catalog_observations drop constraint catalog_observations_source_check;
alter table public.catalog_observations add constraint catalog_observations_source_check check(source in ('manual','extension_reviewed','pc_collector'));
alter table public.catalog_observations add column price_scope text not null default 'variant' check(price_scope in ('variant','product'));

create table public.catalog_collectors (
  id uuid primary key, name text not null check(length(name) between 1 and 80),
  token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '90 days',
  last_seen_at timestamptz, enabled boolean not null default true, revoked_at timestamptz
);
create index catalog_collectors_owner on public.catalog_collectors(created_by);
create table public.catalog_collection_jobs (
  id uuid primary key default gen_random_uuid(), reference_key text not null check(length(reference_key)<=240),
  input text not null check(length(input)<=2000), expected_sku text, expected_supplier_id text,
  product_id uuid references public.catalog_products(id),
  status text not null default 'queued' check(status in ('queued','running','completed','blocked','failed')),
  attempts integer not null default 0, collector_id uuid references public.catalog_collectors(id),
  lease uuid, lease_expires_at timestamptz, created_at timestamptz not null default now(),
  started_at timestamptz, finished_at timestamptz, message text
);
create unique index catalog_collection_active_reference on public.catalog_collection_jobs(reference_key) where status in ('queued','running');
create index catalog_collection_queue on public.catalog_collection_jobs(created_at,id) where status='queued';
create index catalog_collection_product on public.catalog_collection_jobs(product_id);
create index catalog_collection_device on public.catalog_collection_jobs(collector_id);
create index catalog_collection_recent on public.catalog_collection_jobs(created_at desc);
create index catalog_collection_reference on public.catalog_collection_jobs(reference_key);
create index catalog_products_due on public.catalog_products(next_check_at) where auto_collect;
alter table public.catalog_collectors enable row level security;
alter table public.catalog_collection_jobs enable row level security;
revoke all on public.catalog_collectors,public.catalog_collection_jobs from public,anon,authenticated;
grant all on public.catalog_collectors,public.catalog_collection_jobs to service_role;

create function public.enqueue_catalog_collection(p_refs jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare added integer;
begin
  if jsonb_typeof(p_refs)<>'array' or jsonb_array_length(p_refs)>100 then raise exception 'invalid_references'; end if;
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
end; $$;

-- Called on import and by the PC's poll: due work survives closed tabs and PC restarts.
create function public.queue_catalog_sources() returns integer
language plpgsql security invoker set search_path='' as $$
declare refs jsonb; added integer:=0; n integer;
begin
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select 'product:'||p.supplier_id as reference_key,p.supplier_url as input,p.supplier_id as expected_supplier_id,
      coalesce(p.supplier_sku,(select min(l.sku) from public.catalog_sku_links l where l.product_id=p.id having count(*)=1)) as expected_sku
    from public.catalog_products p where p.auto_collect and p.next_check_at<=now()
      and not exists(select 1 from public.catalog_collection_jobs j where j.reference_key='product:'||p.supplier_id and j.status in ('queued','running'))
    order by p.next_check_at,p.id limit 100
  ) x;
  added:=public.enqueue_catalog_collection(refs);
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select distinct 'sku:'||d.sku as reference_key,d.sku as input,d.sku as expected_sku,null::text as expected_supplier_id
    from public.catalog_dotb_items d where d.sku ~ '^[A-Za-z0-9_-]{1,200}$'
      and not exists(select 1 from public.catalog_sku_links l where l.sku=d.sku and l.product_id is not null)
      and not exists(select 1 from public.catalog_collection_jobs j where j.reference_key='sku:'||d.sku)
    order by input limit 100
  ) x;
  n:=public.enqueue_catalog_collection(refs);
  return added+n;
end; $$;

create function public.claim_catalog_collection(p_device uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.catalog_collection_jobs; d public.catalog_collectors;
begin
  select * into d from public.catalog_collectors where id=p_device and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'device_revoked'; end if;
  update public.catalog_collectors set last_seen_at=now() where id=p_device;
  if not d.enabled then return jsonb_build_object('paused',true,'job',null); end if;
  update public.catalog_collection_jobs set status=case when attempts>=3 then 'failed' else 'queued' end,
    message='La connexion au PC a été interrompue.',lease=null,lease_expires_at=null
    where status='running' and lease_expires_at<now();
  update public.catalog_products p set collection_status='failed',collection_message='La connexion au PC a été interrompue. Relancez la récupération.',next_check_at=null
    where p.collection_status='running' and exists(select 1 from public.catalog_collection_jobs j where j.product_id=p.id and j.status='failed')
    and not exists(select 1 from public.catalog_collection_jobs j where j.product_id=p.id and j.status in ('queued','running'));
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
end; $$;

create function public.finish_catalog_collection(p_job uuid,p_device uuid,p_lease uuid,p_result jsonb,p_failure text default null,p_message text default null) returns uuid
language plpgsql security invoker set search_path='' as $$
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
  if exists(select 1 from public.catalog_dotb_items where sku=source_sku)
    and not exists(select 1 from public.catalog_dotb_items where sku=source_sku and supplier_id is not null and supplier_id<>p_result->>'supplier_id') then
    insert into public.catalog_sku_links(sku,product_id) values(source_sku,product_uuid) on conflict(sku) do nothing;
  end if;
  update public.catalog_collection_jobs set status='completed',product_id=product_uuid,finished_at=now(),message=null where id=p_job;
  return product_uuid;
end; $$;

revoke all on function public.enqueue_catalog_collection(jsonb),public.queue_catalog_sources(),public.claim_catalog_collection(uuid),public.finish_catalog_collection(uuid,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.enqueue_catalog_collection(jsonb),public.queue_catalog_sources(),public.claim_catalog_collection(uuid),public.finish_catalog_collection(uuid,uuid,uuid,jsonb,text,text) to service_role;

-- Preserve the old columns and append new ones so dependent clients remain compatible.
create or replace view public.catalog_product_summary with(security_invoker=true) as
select p.id,p.supplier_id,p.supplier_url,p.title,p.supplier_sku,p.photo_url,p.created_at,p.updated_at,
  o.price,o.currency,o.size,o.color,o.availability,o.observed_at,o.source,
  prev.price as previous_price,prev.observed_at as previous_observed_at,
  (select count(*) from public.catalog_sku_links l where l.product_id=p.id) as linked_skus,
  p.photos,p.description,p.details,p.sizes,p.last_checked_at,p.next_check_at,p.collection_status,p.collection_message,p.auto_collect,o.price_scope
from public.catalog_products p
left join lateral(select * from public.catalog_observations obs where obs.product_id=p.id order by obs.observed_at desc,obs.created_at desc,obs.id desc limit 1)o on true
left join lateral(select obs.price,obs.observed_at from public.catalog_observations obs
  where obs.product_id=p.id and obs.price is not null and obs.currency=o.currency and obs.price_scope=o.price_scope
  and lower(obs.size)=lower(o.size) and lower(obs.color)=lower(o.color) and o.color<>''
  and (o.price_scope='product' or o.size<>'')
  and (obs.observed_at,obs.created_at,obs.id)<(o.observed_at,o.created_at,o.id)
  order by obs.observed_at desc,obs.created_at desc,obs.id desc limit 1)prev on true;

create view public.catalog_sales_by_sku with(security_invoker=true) as
select btrim(coalesce(l.sku_override,l.source->>'sku','')) as sku,o.currency,
  count(*) as quantity,count(nullif(l.source->>'selling_price','')) as known_prices,
  sum(nullif(l.source->>'selling_price','')::numeric) as revenue,max(o.order_date) as last_sale
from public.sales_lines l join public.sales_orders o on o.id=l.order_id
where l.source_active and o.status is not null and o.status not in ('cancelled','returning','suspended')
  and btrim(coalesce(l.sku_override,l.source->>'sku',''))<>''
group by btrim(coalesce(l.sku_override,l.source->>'sku','')),o.currency;
create view public.sales_catalog_resolved with(security_invoker=true) as
select coalesce(m.sku,l.sku) as sku,coalesce(m.supplier_url,p.supplier_url) as supplier_url,m.variant
from public.sales_catalog m full join public.catalog_sku_links l on l.sku=m.sku
left join public.catalog_products p on p.id=l.product_id;
revoke all on public.catalog_sales_by_sku,public.sales_catalog_resolved from public,anon,authenticated;
grant select on public.catalog_sales_by_sku,public.sales_catalog_resolved to authenticated,service_role;
create or replace function public.save_sales_line(p_id text, p_version timestamptz, p_edit jsonb, p_product jsonb, p_stage text, p_user uuid)
returns void language plpgsql security invoker set search_path = '' as $$
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
end; $$;
commit;
