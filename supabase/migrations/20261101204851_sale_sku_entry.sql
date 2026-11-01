begin;

-- Change only the sold line's local reference, never its purchase details or Dotb source.
create function public.save_sales_sku(p_id text,p_version timestamptz,p_sku text,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare l public.sales_lines; sale_id uuid; sku text:=btrim(p_sku);
begin
  if sku is null or sku !~ '^[A-Za-z0-9_-]{1,200}$' then raise exception 'invalid_sku'; end if;
  -- Same lock order as Dotb imports; stale screens cannot overwrite a newer correction.
  select id into sale_id from public.sales_orders
    where id=(select order_id from public.sales_lines where id=p_id) for update;
  if not found then raise exception 'line_not_found'; end if;
  select * into l from public.sales_lines where id=p_id for update;
  if not found or not l.source_active then raise exception 'line_not_found'; end if;
  if p_version is null or l.updated_at is distinct from p_version then raise exception 'stale_version'; end if;
  update public.sales_lines set sku_override=sku,updated_at=clock_timestamp(),updated_by=p_user where id=p_id;
  perform public.queue_sales_sources(array[sale_id]);
end;
$$;
revoke all on function public.save_sales_sku(text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.save_sales_sku(text,timestamptz,text,uuid) to service_role;

-- A corrected/local SKU must not reuse a supplier URL belonging to the old Dotb SKU.
create or replace function public.queue_sales_sources(p_order_ids uuid[] default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare refs jsonb;
begin
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select distinct on (lower(btrim(coalesce(l.sku_override,l.source->>'sku'))))
      'sku:'||lower(btrim(coalesce(l.sku_override,l.source->>'sku'))) as reference_key,
      coalesce(p.supplier_url,case when l.sku_override is null or l.sku_override=l.source->>'sku' then l.source->>'shein_url' end,btrim(coalesce(l.sku_override,l.source->>'sku'))) as input,
      btrim(coalesce(l.sku_override,l.source->>'sku')) as expected_sku,
      coalesce((select supplier_id from public.catalog_products where id=p.product_id),case when l.sku_override is null or l.sku_override=l.source->>'sku' then l.source->>'shein_id' end) as expected_supplier_id
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

commit;
