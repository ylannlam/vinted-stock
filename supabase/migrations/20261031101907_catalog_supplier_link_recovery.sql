begin;
alter table public.catalog_dotb_items add column supplier_link_status text
  check(supplier_link_status in ('missing','invalid','unrecognized','recognized'));

create function public.create_catalog_product_for_sku(p_sku text,p_supplier_id text,p_supplier_url text,p_updated timestamptz)
returns uuid language plpgsql security invoker set search_path='' as $$
declare product_uuid uuid; source_item public.catalog_dotb_items;
begin
  if p_supplier_id !~ '^[0-9]{1,20}$' then raise exception 'supplier_invalid'; end if;
  select * into source_item from public.catalog_dotb_items where sku=p_sku order by synced_at desc,id limit 1;
  if not found then raise exception 'sku_missing'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_supplier_id,0));
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku,photo_url)
    values(p_supplier_id,p_supplier_url,coalesce(nullif(source_item.title,''),'Produit Shein '||p_sku),p_sku,source_item.photo_url)
    on conflict(supplier_id) do nothing;
  select id into product_uuid from public.catalog_products where supplier_id=p_supplier_id;
  perform public.link_catalog_sku(p_sku,product_uuid,p_updated);
  return product_uuid;
end; $$;
revoke all on function public.create_catalog_product_for_sku(text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.create_catalog_product_for_sku(text,text,text,timestamptz) to service_role;

create or replace function public.import_catalog_dotb_page(p_items jsonb,p_cursor text,p_lease uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.catalog_sync_state where id and lease=p_lease and locked_until>now() for update;
  if not found then raise exception 'sync_lease_expired'; end if;
  insert into public.catalog_dotb_items(id,sku,title,account_id,status,supplier_url,supplier_id,supplier_canonical_url,supplier_link_status,price,currency,photo_url,synced_at)
    select x.id,x.sku,x.title,x.account_id,x.status,x.supplier_url,x.supplier_id,x.supplier_canonical_url,x.supplier_link_status,x.price,x.currency,x.photo_url,x.synced_at
    from jsonb_to_recordset(p_items) as x(id uuid,sku text,title text,account_id uuid,status text,supplier_url text,supplier_id text,supplier_canonical_url text,supplier_link_status text,price numeric,currency text,photo_url text,synced_at timestamptz)
    on conflict(id) do update set sku=excluded.sku,title=excluded.title,account_id=excluded.account_id,status=excluded.status,
      supplier_url=excluded.supplier_url,supplier_id=excluded.supplier_id,supplier_canonical_url=excluded.supplier_canonical_url,supplier_link_status=excluded.supplier_link_status,
      price=excluded.price,currency=excluded.currency,photo_url=excluded.photo_url,synced_at=excluded.synced_at;
  -- Only link unambiguous, complete SKU groups after every page has been imported.
  -- Never infer a supplier price from the Dotb selling price, or overwrite a manual link.
  if p_cursor is null then
    insert into public.catalog_products(supplier_id,supplier_url,title,photo_url)
      select distinct on (d.supplier_id) d.supplier_id,d.supplier_canonical_url,coalesce(nullif(d.title,''),'Produit Shein '||d.supplier_id),d.photo_url
      from public.catalog_dotb_items d where d.sku is not null and d.supplier_id is not null
      order by d.supplier_id,d.synced_at desc,d.id
      on conflict(supplier_id) do nothing;
    insert into public.catalog_sku_links(sku,product_id)
      select g.sku,p.id from (
        select sku,min(supplier_id) as supplier_id from public.catalog_dotb_items where sku is not null
        group by sku having count(distinct supplier_id)=1 and count(*)=count(supplier_id)
      ) g join public.catalog_products p on p.supplier_id=g.supplier_id
      on conflict(sku) do nothing;
    -- A previously verified Shein SKU can also identify its one known product.
    insert into public.catalog_sku_links(sku,product_id)
      select d.sku,min(p.id::text)::uuid from (select distinct sku from public.catalog_dotb_items where sku is not null) d
      join public.catalog_products p on p.supplier_sku=d.sku
      where not exists(select 1 from public.catalog_dotb_items i where i.sku=d.sku and i.supplier_id is not null)
      group by d.sku having count(*)=1
      on conflict(sku) do nothing;
  end if;
  update public.catalog_sync_state set cursor=p_cursor,processed=processed+jsonb_array_length(p_items),
    last_completed_at=case when p_cursor is null then now() else last_completed_at end,
    locked_until='-infinity',lease=null,next_allowed_at=now()+interval '1.5 seconds' where id;
end; $$;
commit;

