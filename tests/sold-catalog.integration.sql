-- Production-safe integration check: every fixture is rolled back.
begin;
do $$
declare
  sale uuid:=gen_random_uuid(); unknown_sale uuid:=gen_random_uuid(); cancelled uuid:=gen_random_uuid();
  sku text:='AUTO_'||replace(gen_random_uuid()::text,'-',''); unsold text:='UNSOLD_'||replace(gen_random_uuid()::text,'-','');
  repaired text:='FIXED_'||replace(gen_random_uuid()::text,'-','');
  item uuid:=gen_random_uuid(); user_id uuid; version timestamptz; job_id uuid; device uuid; product uuid; result jsonb;
begin
  select id into user_id from public.profiles where role='admin' limit 1;
  insert into public.catalog_dotb_items(id,sku,title,synced_at) values(gen_random_uuid(),unsold,'Never sold',now());
  insert into public.catalog_products(supplier_id,supplier_url,supplier_sku,title,auto_collect,next_check_at)
    values('876'||floor(random()*1000000000000)::bigint::text,'https://fr.shein.com/Unsold-p-87654321.html',unsold,'Never sold',true,now()-interval '1 hour');
  insert into public.sales_orders(id,status,currency,order_date) values(sale,'completed','EUR',now()),(unknown_sale,'payment_received','EUR',now()),(cancelled,'cancelled','EUR',now());
  insert into public.sales_lines(id,order_id,dotb_item_id,source,stage) values
    ('AUTO-'||sale,sale,item,jsonb_build_object('sku',sku,'title','Completed sale','selling_price','30'),'shipped'),
    ('AUTO-'||unknown_sale,unknown_sale,gen_random_uuid(),'{}','to_order'),
    ('AUTO-'||cancelled,cancelled,gen_random_uuid(),jsonb_build_object('sku',unsold),'to_order');
  perform public.queue_catalog_sources();
  assert (select count(*) from public.catalog_collection_jobs where expected_sku=sku and status='queued')=1,'Background poll must recover sold SKU with no imported listing, even after shipping';
  assert not exists(select 1 from public.catalog_collection_jobs where expected_sku=unsold),'Unsold/cancelled articles must never auto-queue';
  assert not exists(select 1 from public.catalog_tracked_products where supplier_sku=unsold),'Unsold products must stay outside library';
  assert exists(select 1 from public.catalog_sales_items where id='AUTO-'||sale),'Sale itself must supply catalogue metadata';
  perform public.queue_catalog_sources();
  assert (select count(*) from public.catalog_collection_jobs where expected_sku=sku)=1,'Repeated polling must deduplicate';

  begin
    perform public.enqueue_catalog_collection(jsonb_build_array(jsonb_build_object('reference_key','sku:'||unsold,'input',unsold,'expected_sku',unsold)));
    raise exception 'Unsold reference accepted';
  exception when others then if sqlerrm not like '%unsold_reference%' then raise; end if; end;

  select updated_at into version from public.sales_lines where id='AUTO-'||unknown_sale;
  perform public.save_sales_line('AUTO-'||unknown_sale,version,jsonb_build_object('sku_override',repaired),null,null,user_id);
  assert exists(select 1 from public.catalog_collection_jobs where expected_sku=repaired and status='queued'),'Saving a missing SKU must immediately queue without reimport';

  -- An old failure must not block refresh after a later successful attempt.
  update public.catalog_collection_jobs set status='completed',created_at=now()-interval '2 hours' where expected_sku=sku;
  insert into public.catalog_collection_jobs(reference_key,input,expected_sku,status,created_at)
    values('sku:'||sku,sku,sku,'failed',now()-interval '3 hours');
  perform public.queue_catalog_sources();
  assert (select count(*) from public.catalog_collection_jobs where expected_sku=sku and status='queued')=1,'Recovered failures must not suppress later automatic refresh';

  -- A cancelled sale cannot recreate a product from a late browser response.
  insert into public.catalog_collectors(id,name,token_hash,created_by) values(gen_random_uuid(),'Test sold-only',repeat('b',64),user_id) returning id into device;
  select id into job_id from public.catalog_collection_jobs where expected_sku=repaired and status='queued';
  update public.catalog_collection_jobs set status='running',collector_id=device,lease=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes' where id=job_id;
  update public.sales_orders set status='cancelled' where id=unknown_sale;
  perform public.finish_catalog_collection(job_id,device,(select lease from public.catalog_collection_jobs where id=job_id),jsonb_build_object('supplier_id','987123456789','supplier_sku',repaired));
  assert (select status='excluded' from public.catalog_collection_jobs where id=job_id),'Cancelled late result must be discarded';
  assert not exists(select 1 from public.catalog_products where supplier_sku=repaired),'Cancelled sale must not create a new product';
  assert not has_function_privilege('authenticated','public.is_sold_catalog_reference(text,text)','EXECUTE'),'Private queue helper must remain server-only';
end $$;
rollback;
