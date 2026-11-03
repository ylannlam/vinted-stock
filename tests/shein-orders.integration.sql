begin;
do $$
declare u uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u||'@shein-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(u,u||'@shein-test.invalid','Test commandes','admin');
 perform set_config('test.shein_user',u::text,true);
 if has_table_privilege('authenticated','public.shein_orders','select') or has_function_privilege('anon','public.import_shein_order(jsonb,uuid)','execute') then raise exception 'private orders exposed';end if;
end $$;
set local role service_role;
do $$
declare u uuid:=current_setting('test.shein_user')::uuid;dev uuid:=gen_random_uuid();o uuid:=gen_random_uuid();
 ref text:='GTEST'||upper(replace(gen_random_uuid()::text,'-',''));item text;sku text:='TEST-'||gen_random_uuid();
 a text:='test-a-'||gen_random_uuid();b text:='test-b-'||gen_random_uuid();c text:='test-c-'||gen_random_uuid();
 payload jsonb; v timestamptz; n int; before_count bigint;
begin
 item:=ref||':variant';
 insert into public.catalog_collectors(id,name,token_hash,created_by) values(dev,'Test commandes',repeat('0',64),u);
 insert into public.sales_orders(id,account_login,status,currency,order_date) values(o,'TEST-SHEIN','payment_received','EUR','2099-01-01');
 insert into public.sales_lines(id,order_id,dotb_item_id,source,supplier_size,supplier_color) values
 (a,o,gen_random_uuid(),jsonb_build_object('title','Test A','sku',sku),'M','Noir'),
 (b,o,gen_random_uuid(),jsonb_build_object('title','Test B','sku',sku),'38(M)','Noir'),
 (c,o,gen_random_uuid(),jsonb_build_object('title','Test C','sku',sku),'M','Noir');
 payload:=jsonb_build_object('ref',ref,'order_date','2099-01-02','observed_at',now(),'items',jsonb_build_array(jsonb_build_object('id',item,'sku',sku,'supplier_id','123','product_url','https://fr.shein.com/Test-p-123.html','title','Test','size','M','color','Noir','quantity',2,'unit_price',8.57,'status','processing')));
 perform public.import_shein_order(payload,dev);
 n:=public.reconcile_shein_orders(u);
 if (select count(*) from public.shein_order_links where item_id=item)<>2 then raise exception 'available units not allocated to oldest sales';end if;
 if exists(select 1 from public.shein_order_links where line_id=c) then raise exception 'newest sale consumed stock before older sales';end if;
 payload:=jsonb_set(jsonb_set(payload,'{items,0,quantity}','3'),'{observed_at}',to_jsonb(now()+interval '1 second'));
 perform public.import_shein_order(payload,dev);perform public.reconcile_shein_orders(u);
 if (select count(*) from public.shein_order_links where item_id=item)<>3 then raise exception 'exact variant group not matched';end if;
 if exists(select 1 from public.sales_lines where id in(a,b,c) and (stage<>'ordered' or actual_cost<>8.57 or supplier_order_ref<>ref)) then raise exception 'purchase fields missing';end if;
 select updated_at into v from public.sales_lines where id=a;
 perform public.import_shein_order(payload,dev);perform public.reconcile_shein_orders(u);
 if (select updated_at from public.sales_lines where id=a)<>v then raise exception 'repeat import changed a sale';end if;
 -- A fourth manual association cannot exceed purchased quantity.
 begin
  perform public.review_shein_order('link',item,a,v,u);raise exception 'duplicate allocation accepted';
 exception when raise_exception then if sqlerrm<>'shein_already_linked' then raise;end if;end;
 perform public.review_shein_order('unlink',item,a,v,u);
 if (select stage from public.sales_lines where id=a)<>'to_order' or (select actual_cost from public.sales_lines where id=a) is not null then raise exception 'unlink did not restore prior state';end if;
 perform public.reconcile_shein_orders(u);
 if exists(select 1 from public.shein_order_links where line_id=a) then raise exception 'manual correction immediately undone';end if;
 select updated_at into v from public.sales_lines where id=a;
 perform public.review_shein_order('link',item,a,v,u);
 -- Ship only known paid items, preserving manual cost edits.
 update public.sales_lines set actual_cost=11,updated_at=clock_timestamp() where id=a;
 payload:=jsonb_set(jsonb_set(payload,'{items,0,status}','"shipped"'),'{observed_at}',to_jsonb(now()+interval '2 seconds'));
 perform public.import_shein_order(payload,dev);perform public.reconcile_shein_orders(u);
 if exists(select 1 from public.sales_lines where id in(a,b,c) and stage<>'in_transit') then raise exception 'shipped state not progressed';end if;
 if (select actual_cost from public.sales_lines where id=a)<>11 then raise exception 'manual cost overwritten';end if;
 select updated_at into v from public.sales_lines where id=a;
 begin
  perform public.review_shein_order('unlink',item,a,v,u);raise exception 'manual edit restored away';
 exception when raise_exception then if sqlerrm<>'shein_link_changed' then raise;end if;end;
 -- Delivery does not claim physical receipt automatically.
 payload:=jsonb_set(jsonb_set(payload,'{items,0,status}','"delivered"'),'{observed_at}',to_jsonb(now()+interval '3 seconds'));
 perform public.import_shein_order(payload,dev);perform public.reconcile_shein_orders(u);
 if (select stage from public.sales_lines where id=b)<>'in_transit' then raise exception 'delivery falsely confirmed receipt';end if;
 select updated_at into v from public.sales_lines where id=b;
 perform public.review_shein_order('confirm_received',item,b,v,u);
 if (select stage from public.sales_lines where id=b)<>'received' then raise exception 'receipt confirmation not saved';end if;
 -- Cancellation/quantity reduction is flagged, never rolls back prepared/shipped work.
 payload:=jsonb_set(jsonb_set(jsonb_set(payload,'{items,0,status}','"exception"'),'{items,0,quantity}','1'),'{observed_at}',to_jsonb(now()+interval '4 seconds'));
 perform public.import_shein_order(payload,dev);perform public.reconcile_shein_orders(u);
 if (select stage from public.sales_lines where id=b)<>'received' then raise exception 'cancel rolled back received sale';end if;
 if (select count(*) from public.shein_order_links where item_id=item)<>3 then raise exception 'cancel silently removed links';end if;
 -- A stale observation cannot resurrect cancelled quantities.
 perform public.import_shein_order(jsonb_set(payload,'{observed_at}',to_jsonb(now())),dev);
 if (select quantity from public.shein_order_items where id=item)<>1 then raise exception 'stale observation overwrote order';end if;
 if jsonb_array_length(public.shein_sale_choices(array[lower(sku)]))<>3 then raise exception 'review choices missing';end if;
end $$;
rollback;
