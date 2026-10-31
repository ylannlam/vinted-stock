-- All fixtures and changes rolled back.
begin;
do $$
declare device uuid:=gen_random_uuid(); owner_id uuid; j jsonb; replay jsonb; p uuid; n integer;
  supplier text:='98765432109876543219'; fixture_sku text:='COLLECTOR-ROLLBACK'; payload jsonb;
  fixture_order uuid:=gen_random_uuid(); cancelled_id uuid:=gen_random_uuid(); old_version timestamptz;
begin
  if exists(select 1 from public.catalog_products where supplier_id=supplier)
    or exists(select 1 from public.catalog_dotb_items where sku='COLLECTOR-ROLLBACK') then raise exception 'Fixture collision'; end if;
  select id into owner_id from public.profiles where role='admin' limit 1;
  if owner_id is null then raise exception 'No administrator'; end if;
  insert into public.catalog_collectors(id,name,token_hash,created_by) values(device,'ROLLBACK test',repeat('a',64),owner_id);
  insert into public.catalog_dotb_items(id,sku,title,synced_at,tracking_status) values(gen_random_uuid(),fixture_sku,'ROLLBACK',now(),'included');
  n:=public.enqueue_catalog_collection(jsonb_build_array(jsonb_build_object('reference_key','sku:'||fixture_sku,'input',fixture_sku,'expected_sku',fixture_sku)));
  if n<>1 then raise exception 'Job not queued'; end if;
  n:=public.enqueue_catalog_collection(jsonb_build_array(jsonb_build_object('reference_key','sku:'||fixture_sku,'input',fixture_sku,'expected_sku',fixture_sku)));
  if n<>0 then raise exception 'Duplicate queued'; end if;
  update public.catalog_collection_jobs set created_at='2000-01-01' where reference_key='sku:'||fixture_sku;
  j:=public.claim_catalog_collection(device)->'job';
  if j->>'expected_sku'<>fixture_sku then raise exception 'Wrong job claimed'; end if;
  replay:=public.claim_catalog_collection(device)->'job';
  if replay->>'lease'<>j->>'lease' then raise exception 'Lost claim response changed lease'; end if;
  payload:=jsonb_build_object('supplier_id',supplier,'supplier_url','https://fr.shein.com/Test-p-'||supplier||'.html',
    'supplier_sku',fixture_sku,'title','ROLLBACK','price',20,'color','Nude','photos','[]'::jsonb,'sizes','[]'::jsonb,
    'details','[]'::jsonb,'description','','observed_at',now(),'note','Fixture');
  begin
    perform public.finish_catalog_collection((j->>'id')::uuid,device,(j->>'lease')::uuid,payload||'{"supplier_sku":"wrong"}');
    raise exception 'Mismatch accepted';
  exception when others then if sqlerrm not like '%collection_product_mismatch%' then raise; end if; end;
  p:=public.finish_catalog_collection((j->>'id')::uuid,device,(j->>'lease')::uuid,payload);
  perform public.finish_catalog_collection((j->>'id')::uuid,device,(j->>'lease')::uuid,payload);
  if (select count(*) from public.catalog_observations where product_id=p)<>1 then raise exception 'Duplicate observation'; end if;
  if not exists(select 1 from public.catalog_products where id=p and collection_status='completed' and next_check_at>=now()+interval '5 hours 59 minutes') then raise exception 'Refresh not scheduled'; end if;
  if not exists(select 1 from public.catalog_sku_links l where l.sku='COLLECTOR-ROLLBACK' and l.product_id=p) then raise exception 'SKU not linked'; end if;
  perform public.queue_catalog_sources();
  if exists(select 1 from public.catalog_collection_jobs where product_id=p and status='queued') then raise exception 'Fresh product queued early'; end if;
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at,price_scope)
    values(gen_random_uuid(),p,18,'EUR','','Nude','unknown','pc_collector',now()-interval '1 hour','product'),
    (gen_random_uuid(),p,99,'EUR','M','Nude','available','manual',now()-interval '30 minutes','variant');
  if not exists(select 1 from public.catalog_product_summary where id=p and price=20 and previous_price=18) then raise exception 'Different price scopes compared'; end if;
  if not exists(select 1 from public.sales_catalog_resolved r where r.sku='COLLECTOR-ROLLBACK' and r.supplier_url=payload->>'supplier_url') then raise exception 'Supplier not available to sales'; end if;
  insert into public.sales_orders(id,status,currency,order_date) values(fixture_order,'label_sent','EUR',now()),(cancelled_id,'cancelled','EUR',now());
  insert into public.sales_lines(id,order_id,dotb_item_id,source,supplier_order_ref) values
    ('COLLECTOR-TEST-'||fixture_order,fixture_order,gen_random_uuid(),jsonb_build_object('sku',fixture_sku,'selling_price','40.00'),'TEST'),
    ('COLLECTOR-TEST-'||cancelled_id,cancelled_id,gen_random_uuid(),jsonb_build_object('sku',fixture_sku,'selling_price','80.00'),null);
  if not exists(select 1 from public.catalog_sales_by_sku s where s.sku='COLLECTOR-ROLLBACK' and quantity=1 and revenue=40) then raise exception 'Sales aggregation or cancelled exclusion wrong'; end if;
  select updated_at into old_version from public.sales_lines where id='COLLECTOR-TEST-'||fixture_order;
  perform public.save_sales_line('COLLECTOR-TEST-'||fixture_order,old_version,null,null,'ordered',owner_id);
  if (select stage from public.sales_lines where id='COLLECTOR-TEST-'||fixture_order)<>'ordered' then raise exception 'Unified supplier did not allow order stage'; end if;
  insert into public.sales_catalog(sku,supplier_url) values(fixture_sku,'https://fr.shein.com/Manual-p-1234.html');
  if not exists(select 1 from public.sales_catalog_resolved r where r.sku='COLLECTOR-ROLLBACK' and r.supplier_url like '%1234.html') then raise exception 'Manual supplier overwritten'; end if;
  n:=public.enqueue_catalog_collection(jsonb_build_array(jsonb_build_object('reference_key','product:'||supplier,'input',payload->>'supplier_url','expected_supplier_id',supplier)));
  update public.catalog_collection_jobs set created_at='1999-01-01' where reference_key='product:'||supplier;
  j:=public.claim_catalog_collection(device)->'job';
  if j->>'expected_sku'<>fixture_sku then raise exception 'Existing SKU not inherited'; end if;
  perform public.finish_catalog_collection((j->>'id')::uuid,device,(j->>'lease')::uuid,null,'blocked','Human check');
  if not exists(select 1 from public.catalog_products where id=p and collection_status='blocked' and next_check_at is null) then raise exception 'Blocked refresh still scheduled'; end if;
  if (select price from public.catalog_product_summary where id=p)<>20 then raise exception 'Failed collection erased last price'; end if;
  update public.catalog_collectors set revoked_at=now() where id=device;
  begin perform public.claim_catalog_collection(device);raise exception 'Revoked device accepted';
  exception when others then if sqlerrm not like '%device_revoked%' then raise; end if; end;
  if has_function_privilege('authenticated','public.claim_catalog_collection(uuid)','EXECUTE')
    or has_table_privilege('anon','public.catalog_collectors','SELECT')
    or has_table_privilege('authenticated','public.catalog_collectors','SELECT') then raise exception 'Credentials or privileged operations exposed'; end if;
end $$;
rollback;
select 'Collector, leases, SKU links, prices, sales and access checks passed; fixtures rolled back' as result;
