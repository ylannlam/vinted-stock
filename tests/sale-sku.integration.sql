-- All fixtures and jobs are rolled back; no real sale is edited.
begin;
set local role service_role;
do $$
declare sale uuid:=gen_random_uuid(); item uuid:=gen_random_uuid(); user_id uuid;
  line_id text; version timestamptz; test_sku text:='POSTSALE_'||replace(gen_random_uuid()::text,'-','');
begin
  line_id:=sale::text||':'||item::text;
  select id into user_id from public.profiles where role='admin' limit 1;
  insert into public.sales_orders(id,status,currency,order_date,synced_at) values(sale,'payment_received','EUR',now(),now());
  insert into public.sales_lines(id,order_id,dotb_item_id,source,stage,notes,location,actual_cost,supplier_order_ref,supplier_tracking)
    values(line_id,sale,item,jsonb_build_object('title','Sale without Dotb SKU','selling_price','39.90'),'in_transit','Keep these notes','A-12',11.25,'ORDER-123','TRACK-123');
  select updated_at into version from public.sales_lines where id=line_id;
  perform public.save_sales_sku(line_id,version,'  '||test_sku||'  ',user_id);
  assert (select sku_override=test_sku and source->>'sku' is null and stage='in_transit' and notes='Keep these notes' and location='A-12'
    and actual_cost=11.25 and supplier_order_ref='ORDER-123' and supplier_tracking='TRACK-123' from public.sales_lines where id=line_id),
    'SKU-only save must preserve purchase details and source';
  assert (select count(*) from public.catalog_collection_jobs where expected_sku=test_sku and status='queued')=1,'Missing SKU must queue Shein automatically';
  assert exists(select 1 from public.catalog_sales_items where id=line_id and catalog_sales_items.sku=test_sku),'Sale must now appear in sold references';
  begin
    perform public.save_sales_sku(line_id,version,'OTHER',user_id);
    raise exception 'Stale save accepted';
  exception when others then if sqlerrm<>'stale_version' then raise; end if; end;
  select updated_at into version from public.sales_lines where id=line_id;
  perform public.save_sales_sku(line_id,version,test_sku,user_id);
  assert (select count(*) from public.catalog_collection_jobs where expected_sku=test_sku)=1,'Same SKU must not duplicate the job';
  perform public.upsert_sales_snapshot(
    jsonb_build_array(jsonb_build_object('id',sale,'status','label_sent','currency','EUR','order_date',now(),'synced_at',clock_timestamp())),
    jsonb_build_array(jsonb_build_object('id',line_id,'order_id',sale,'dotb_item_id',item,'source',jsonb_build_object('title','New Dotb event','sku',null))));
  assert (select sku_override=test_sku and notes='Keep these notes' and actual_cost=11.25 from public.sales_lines where id=line_id),'Later Dotb import must preserve the local SKU';
  update public.sales_lines set source=source||jsonb_build_object('sku','OLD-SKU','shein_url','https://fr.shein.com/Old-p-12345.html','shein_id','12345') where id=line_id;
  select updated_at into version from public.sales_lines where id=line_id;
  perform public.save_sales_sku(line_id,version,test_sku||'_CORRECTED',user_id);
  assert exists(select 1 from public.catalog_collection_jobs where expected_sku=test_sku||'_CORRECTED' and input=test_sku||'_CORRECTED' and expected_supplier_id is null),
    'Correcting a SKU must search its new reference, not the old supplier page';
  assert not has_function_privilege('authenticated','public.save_sales_sku(text,timestamptz,text,uuid)','execute'),'Direct client write must stay forbidden';
end $$;
rollback;
select 'SKU-after-sale: queue, preservation, stale edit and reimport checks passed; rolled back' as result;
