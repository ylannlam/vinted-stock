-- Run against the configured project through execute_sql. Everything is rolled back.
begin;
do $$
declare p uuid; capture uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); lease_id uuid:=gen_random_uuid();
  supplier text:='98765432109876543210'; payload jsonb; version timestamptz; admin_id uuid; rows_count integer;
begin
  if exists(select 1 from public.catalog_products where supplier_id in (supplier,'98765432109876543211','98765432109876543212')) or
    exists(select 1 from public.catalog_dotb_items where sku in ('ROLLBACK-SKU','ROLLBACK-LINK-ONLY','ROLLBACK-KNOWN-SKU')) then raise exception 'Test identifier already used'; end if;
  payload:=jsonb_build_object('id',capture,'price',18,'currency','EUR','size','M','color','Nude','availability','available','source','manual','observed_at',now()-interval '3 hours');
  p:=public.record_catalog_observation(jsonb_build_object('supplier_id',supplier,'supplier_url','https://fr.shein.com/Test-p-'||supplier||'.html','title','ROLLBACK TEST'),payload,null);
  perform public.record_catalog_observation(jsonb_build_object('supplier_id',supplier,'supplier_url','https://fr.shein.com/Test-p-'||supplier||'.html','title','ROLLBACK TEST'),payload,null);
  if (select count(*) from public.catalog_observations where product_id=p)<>1 then raise exception 'Capture replay created a duplicate'; end if;
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at)
    values(gen_random_uuid(),p,99,'EUR','S','Nude','available','manual',now()-interval '2 hours'),
    (gen_random_uuid(),p,20,'EUR','M','nude','available','manual',now()-interval '1 hour');
  if not exists(select 1 from public.catalog_product_summary where id=p and price=20 and previous_price=18) then raise exception 'Compared different variants'; end if;
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at)
    values(gen_random_uuid(),p,null,'EUR','M','Nude','unknown','manual',now());
  if not exists(select 1 from public.catalog_product_summary where id=p and price is null and previous_price=20) then raise exception 'Missing price was replaced'; end if;
  update public.catalog_sync_state set lease=lease_id,locked_until=now()+interval '1 minute' where id;
  perform public.import_catalog_dotb_page(jsonb_build_array(jsonb_build_object('id',item,'sku','ROLLBACK-SKU','title','Test','supplier_id',supplier,'supplier_canonical_url','https://fr.shein.com/Test-p-'||supplier||'.html','price',92,'currency','EUR','synced_at',now())),null,lease_id);
  if not exists(select 1 from public.catalog_sku_links where sku='ROLLBACK-SKU' and product_id=p) then raise exception 'SKU was not linked'; end if;
  if (select price from public.catalog_product_summary where id=p) is not null then raise exception 'Selling price became supplier price'; end if;
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at)
    values(gen_random_uuid(),p,12,'EUR','','','unknown','manual',now()+interval '1 minute'),
    (gen_random_uuid(),p,14,'EUR','','','unknown','manual',now()+interval '2 minutes');
  if (select previous_price from public.catalog_product_summary where id=p) is not null then raise exception 'Unspecified variants were compared'; end if;
  select updated_at into version from public.catalog_sku_links where sku='ROLLBACK-SKU';
  perform public.link_catalog_sku('ROLLBACK-SKU',null,version);
  begin perform public.link_catalog_sku('ROLLBACK-SKU',p,version); raise exception 'Conflict was ignored';
  exception when raise_exception then if sqlerrm<>'link_conflict' then raise; end if; end;
  update public.catalog_sync_state set lease=lease_id,locked_until=now()+interval '1 minute' where id;
  perform public.import_catalog_dotb_page('[]'::jsonb,null,lease_id);
  if exists(select 1 from public.catalog_sku_links where sku='ROLLBACK-SKU' and product_id is not null) then raise exception 'Manual unlink overwritten'; end if;
  insert into public.catalog_dotb_items(id,sku,title,synced_at,supplier_link_status) values(gen_random_uuid(),'ROLLBACK-LINK-ONLY','Test missing supplier',now(),'missing');
  p:=public.create_catalog_product_for_sku('ROLLBACK-LINK-ONLY','98765432109876543211','https://fr.shein.com/Test-p-98765432109876543211.html',null);
  if not exists(select 1 from public.catalog_sku_links where sku='ROLLBACK-LINK-ONLY' and product_id=p) then raise exception 'Link-only creation failed'; end if;
  if exists(select 1 from public.catalog_observations where product_id=p) then raise exception 'Product creation invented an observation'; end if;
  insert into public.catalog_dotb_items(id,sku,title,synced_at,supplier_link_status) values(gen_random_uuid(),'ROLLBACK-KNOWN-SKU','Test known SKU',now(),'missing');
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku) values('98765432109876543212','https://fr.shein.com/Test-p-98765432109876543212.html','Test known product','ROLLBACK-KNOWN-SKU') returning id into p;
  update public.catalog_sync_state set lease=lease_id,locked_until=now()+interval '1 minute' where id;
  perform public.import_catalog_dotb_page('[]'::jsonb,null,lease_id);
  if not exists(select 1 from public.catalog_sku_links where sku='ROLLBACK-KNOWN-SKU' and product_id=p) then raise exception 'Known SKU lookup failed'; end if;
  if has_function_privilege('authenticated','public.create_catalog_product_for_sku(text,text,text,timestamptz)','execute') then raise exception 'Public supplier write access'; end if;
  if has_table_privilege('anon','public.catalog_products','select') or has_function_privilege('authenticated','public.record_catalog_observation(jsonb,jsonb,uuid)','execute') then raise exception 'Unexpected public grant'; end if;
  select id into admin_id from public.profiles where role='admin' limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  set local role authenticated;
  select count(*) into rows_count from public.catalog_product_summary where id=p;
  reset role;
  if rows_count<>1 then raise exception 'Admin cannot see product'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  set local role authenticated;
  select count(*) into rows_count from public.catalog_product_summary where id=p;
  reset role;
  if rows_count<>0 then raise exception 'Unknown user can see product'; end if;
end $$;
rollback;
select 'Catalogue integration assertions passed; test writes rolled back' as result;
