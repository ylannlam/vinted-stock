begin;
set local role service_role;
do $$
declare
  sale uuid:=gen_random_uuid(); listing uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
  sku text:='TEST_'||replace(gen_random_uuid()::text,'-',''); line_id text;
  orders jsonb; lines jsonb; notification jsonb; changed boolean; product uuid; result record;
begin
  line_id:=sale::text||':'||item::text;
  insert into public.catalog_dotb_items(id,sku,title,synced_at,tracking_status) values(listing,sku,'Test',now(),'unclassified');
  orders:=jsonb_build_array(jsonb_build_object('id',sale,'status','label_sent','currency','EUR','order_date',now(),'synced_at',now()));
  lines:=jsonb_build_array(jsonb_build_object('id',line_id,'order_id',sale,'dotb_item_id',item,'source',jsonb_build_object('title','Test','sku',sku,'selling_price','35.00','dotb_listing_id',listing)));
  notification:=jsonb_build_object('id',event,'type','order.created','order_id',sale,'created_at',now());
  changed:=public.receive_dotb_order_event(notification,orders,lines);
  assert changed,'first event must import';
  assert (select count(*) from public.catalog_collection_jobs where expected_sku=sku)=1,'one collection must be queued';
  assert not public.receive_dotb_order_event(notification,orders,lines),'repeat delivery must be idempotent';
  assert (select count(*) from public.sales_lines where order_id=sale)=1,'no duplicate sale';
  update public.sales_lines set actual_cost=12.50,notes='keep me',supplier_order_ref='purchase-1',stage='ordered' where id=line_id;
  notification:=jsonb_set(notification,'{id}',to_jsonb(gen_random_uuid()));
  orders:=jsonb_set(jsonb_set(orders,'{0,status}','"cancelled"'),'{0,synced_at}',to_jsonb(now()+interval '2 seconds'));
  perform public.receive_dotb_order_event(notification,orders,lines);
  assert (select notes='keep me' and actual_cost=12.50 and stage='ordered' from public.sales_lines where id=line_id),'local purchase data must survive';
  orders:=jsonb_set(jsonb_set(orders,'{0,status}','"label_sent"'),'{0,synced_at}',to_jsonb(now()-interval '2 seconds'));
  perform public.upsert_sales_snapshot(orders,lines);
  assert (select status='cancelled' from public.sales_orders where id=sale),'stale fetch cannot revert a cancellation';
  update public.catalog_dotb_items set tracking_status='unclassified' where id=listing;
  update public.sales_orders set status='label_sent' where id=sale;
  update public.sales_lines set stage='to_order' where id=line_id;
  update public.catalog_collection_jobs set status='excluded',created_at=now()-interval '2 hours' where expected_sku=sku;
  assert public.queue_sales_sources(array[sale])=1,'unclassified listing must not block a recent sale';
  update public.catalog_collection_jobs set status='excluded',created_at=now()-interval '2 hours' where expected_sku=sku;
  update public.catalog_dotb_items set tracking_status='excluded' where id=listing;
  assert public.queue_sales_sources(array[sale])=1,'legacy excluded listing must not block a recent sale';
  update public.catalog_collection_jobs set status='excluded',created_at=now()-interval '2 hours' where expected_sku=sku;
  update public.catalog_dotb_items set tracking_status='included' where id=listing;
  update public.sales_orders set order_date=(select starts_at-interval '1 millisecond' from public.dotb_tracking_period) where id=sale;
  assert public.queue_sales_sources(array[sale])=0,'older sales must not be collected';
  insert into public.catalog_products(supplier_id,supplier_url,title,supplier_sku)
    values('999'||floor(random()*1000000000000)::bigint::text,'https://fr.shein.com/Test-p-999999999999.html','Test',sku) returning id into product;
  insert into public.catalog_sku_links(sku,product_id) values(sku,product);
  insert into public.catalog_observations(id,product_id,price,currency,size,color,availability,source,observed_at,price_scope)
    values(gen_random_uuid(),product,15.50,'EUR','','Beige','unknown','pc_collector',now(),'product');
  select d.* into result from public.sales_supplier_details d where d.product_id=product;
  assert result.price=15.50 and result.product_id=product,'completed collection must fill the sale supplier view';
  assert (select actual_cost=12.50 from public.sales_lines where id=line_id),'observed price must not replace actual cost';
  assert not has_table_privilege('authenticated','public.dotb_sales_automation','SELECT'),'signing secret must stay private';
  assert not has_function_privilege('authenticated','public.receive_dotb_order_event(jsonb,jsonb,jsonb)','EXECUTE'),'webhook import is server only';
end $$;
rollback;
