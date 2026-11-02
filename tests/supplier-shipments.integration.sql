begin;
do $$ declare u uuid:=gen_random_uuid();begin
 insert into auth.users(id,email) values(u,u||'@parcel-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(u,u||'@parcel-test.invalid','Test colis','admin');
 perform set_config('test.parcel_user',u::text,true);
 if has_function_privilege('authenticated','public.save_supplier_shipment(uuid,timestamptz,jsonb,jsonb,uuid)','execute') or has_table_privilege('anon','public.workspace_supplier_shipments','select') then raise exception 'tracking exposed';end if;
end $$;
set local role service_role;
do $$
declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();ida text;idb text;v timestamptz;w timestamptz;p uuid;p2 uuid;u uuid:=current_setting('test.parcel_user')::uuid;fields jsonb;src jsonb;orders jsonb;
begin
 ida:=o||':'||a;idb:=o||':'||b;
 insert into public.sales_orders(id,status,currency,order_date) values(o,'payment_received','EUR','2099-01-01');
 src:=jsonb_build_object('title','Robe taille M','size','M','size_label','M / 38 / 10','size_origin','dotb','dotb_listing_id',a);
 insert into public.sales_lines(id,order_id,dotb_item_id,source) values(ida,o,a,src),(idb,o,b,'{"title":"Autre robe","size":"S","size_origin":"title"}');
 if (select supplier_size from public.workspace_sales where id=ida)<>'M' then raise exception 'automatic size missing';end if;
 select updated_at into v from public.sales_lines where id=ida;
 perform public.save_sale_details(ida,v,'{}',null,0,0,false,'{"size":"M"}',u);
 if (select supplier_size from public.sales_lines where id=ida) is not null then raise exception 'automatic value became manual';end if;
 select updated_at into v from public.sales_lines where id=ida;
 perform public.save_sale_details(ida,v,'{}',null,0,0,false,'{"size":"XL"}',u);
 select jsonb_build_array(to_jsonb(s)||jsonb_build_object('synced_at',clock_timestamp()+interval '1 second')) into orders from public.sales_orders s where id=o;
 perform public.upsert_sales_snapshot(orders,jsonb_build_array(jsonb_build_object('id',ida,'order_id',o,'dotb_item_id',a,'source',src||'{"size":"S","size_origin":"title"}'),jsonb_build_object('id',idb,'order_id',o,'dotb_item_id',b,'source','{"size":"S","size_origin":"title"}'::jsonb)));
 if (select source->>'size' from public.sales_lines where id=ida)<>'M' or (select supplier_size from public.workspace_sales where id=ida)<>'XL' then raise exception 'reimport lost verified/manual size';end if;
 select updated_at into v from public.sales_lines where id=ida;
 perform public.save_sale_details(ida,v,'{}',null,0,0,false,'{"size":""}',u);
 if (select supplier_size from public.workspace_sales where id=ida)<>'M' then raise exception 'automatic size not restored';end if;
 select updated_at into v from public.sales_lines where id=ida;select updated_at into w from public.sales_lines where id=idb;
 fields:=jsonb_build_object('carrier','gofo','tracking_number','TEST'||upper(replace(gen_random_uuid()::text,'-','')),'manual_status','in_transit','eta','6 au 12 novembre');
 p:=public.save_supplier_shipment(null,null,fields,jsonb_build_array(jsonb_build_object('id',ida,'updated_at',v),jsonb_build_object('id',idb,'updated_at',w)),u);
 if (select jsonb_array_length(lines) from public.workspace_supplier_shipments where id=p)<>2 then raise exception 'shared parcel lost article';end if;
 begin
 perform public.save_supplier_shipment(null,null,fields,jsonb_build_array(jsonb_build_object('id',ida,'updated_at',v)),u);raise exception 'stale association accepted';
 exception when raise_exception then if sqlerrm<>'stale_version' then raise;end if;end;
 select updated_at into v from public.sales_lines where id=ida;
 p2:=public.save_supplier_shipment(null,null,fields,jsonb_build_array(jsonb_build_object('id',ida,'updated_at',v)),u);
 if p<>p2 then raise exception 'duplicate parcel created';end if;
 select updated_at into v from public.sales_lines where id=ida;
 p2:=public.save_supplier_shipment(null,null,fields||jsonb_build_object('tracking_number','SECOND'||upper(replace(gen_random_uuid()::text,'-',''))),jsonb_build_array(jsonb_build_object('id',ida,'updated_at',v)),u);
 if (select count(*) from public.supplier_shipment_lines where line_id=ida)<>2 then raise exception 'split shipment not supported';end if;
 update public.supplier_shipments set status='delivered',manual_status=null where id=p;
 if (select stage from public.sales_lines where id=ida)<>'to_order' then raise exception 'carrier changed customer shipment';end if;
 select updated_at into v from public.sales_lines where id=ida;
 perform public.unlink_supplier_shipment(p,ida,v,u);
 if (select jsonb_array_length(lines) from public.workspace_supplier_shipments where id=p)<>1 then raise exception 'unlink affected another sale';end if;
 if not exists(select 1 from public.sales_lines where id=ida) then raise exception 'unlink deleted sale';end if;
end $$;
rollback;
