begin;
do $$ declare u uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) values(u,u||'@shein-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(u,u||'@shein-test.invalid','Repeated sales test','admin');
 perform set_config('test.shein_user',u::text,true);
 if has_function_privilege('anon','public.sales_budget_income()','execute') or has_function_privilege('authenticated','public.sales_budget_income()','execute') then raise exception 'budget income exposed';end if;
end $$;
set local role service_role;
do $$
declare u uuid:=current_setting('test.shein_user')::uuid;dev uuid:=gen_random_uuid();
 prefix text:='repeat-'||gen_random_uuid();sku text:='TEST-'||gen_random_uuid();o uuid;day int;
 ref_a text:='GTEST'||upper(replace(gen_random_uuid()::text,'-',''));
 ref_b text:='GTEST'||upper(replace(gen_random_uuid()::text,'-','')); item_a text;item_b text;payload jsonb;v timestamptz;result jsonb;
begin
 item_a:=ref_a||':variant';item_b:=ref_b||':variant';
 insert into public.catalog_collectors(id,name,token_hash,created_by) values(dev,'Repeated sales test',repeat('0',64),u);
 for day in 1..4 loop
  o:=gen_random_uuid();
  insert into public.sales_orders(id,account_login,status,currency,order_date) values(o,'TEST','payment_received','EUR',('2099-01-0'||day||'T12:00:00Z')::timestamptz);
  insert into public.sales_lines(id,order_id,dotb_item_id,source,supplier_size,supplier_color)
   values(prefix||day,o,gen_random_uuid(),jsonb_build_object('title','Same body','sku',sku,'selling_price',30),'M','Noir');
 end loop;
 payload:=jsonb_build_object('ref',ref_a,'order_date','2099-01-04','observed_at',now(),'items',jsonb_build_array(jsonb_build_object('id',item_a,'sku',sku,'supplier_id','123','product_url','https://fr.shein.com/Test-p-123.html','title','Test','size','38(M)','color','Noir','quantity',2,'unit_price',8.57,'status','shipped')));
 perform public.import_shein_order(payload,dev);
 payload:=payload||jsonb_build_object('ref',ref_b,'order_date','2099-01-05','items',jsonb_build_array((payload->'items'->0)||jsonb_build_object('id',item_b,'quantity',1)));
 perform public.import_shein_order(payload,dev);
 perform public.reconcile_shein_orders(u);
 if (select count(*) from public.shein_order_links where item_id in(item_a,item_b))<>3 then raise exception 'two orders did not cover three sales';end if;
 if exists(select 1 from public.shein_order_links where line_id=prefix||'4') then raise exception 'fourth sale consumed unavailable unit';end if;
 if (select count(*) from public.sales_lines where id in(prefix||'1',prefix||'2',prefix||'3') and stage='in_transit' and actual_cost=8.57)<>3 then raise exception 'status or exact unit cost not applied';end if;
 select updated_at into v from public.sales_lines where id=prefix||'1';
 perform public.reconcile_shein_orders(u);
 if (select updated_at from public.sales_lines where id=prefix||'1')<>v then raise exception 'reconciliation is not idempotent';end if;
 -- Manual exclusion remains respected even when another sale can use the unit.
 perform public.review_shein_order('unlink',item_a,prefix||'1',v,u);
 perform public.reconcile_shein_orders(u);
 if exists(select 1 from public.shein_order_links where line_id=prefix||'1') then raise exception 'manual exclusion ignored';end if;
 if not exists(select 1 from public.shein_order_links where line_id=prefix||'4' and item_id=item_a) then raise exception 'remaining sale not covered';end if;
 -- No cross-size match, and local midnight must not match the previous day.
 update public.sales_lines set supplier_size='L' where id=prefix||'1';
 update public.shein_order_items set quantity=3 where id=item_b;
 perform public.reconcile_shein_orders(u);
 if exists(select 1 from public.shein_order_links where line_id=prefix||'1') then raise exception 'different size matched';end if;
 update public.sales_lines set supplier_size='M' where id=prefix||'1';
 update public.sales_orders set order_date='2099-01-05T23:30:00Z' where id=(select order_id from public.sales_lines where id=prefix||'1');
 perform public.reconcile_shein_orders(u);
 if exists(select 1 from public.shein_order_links where line_id=prefix||'1') then raise exception 'Paris date boundary ignored';end if;
 -- Exact references are reserved before unrestricted sales.
 update public.sales_orders set order_date='2099-01-01' where id=(select order_id from public.sales_lines where id=prefix||'1');
 update public.sales_lines set supplier_order_ref=ref_b where id=prefix||'1';
 perform public.reconcile_shein_orders(u);
 if not exists(select 1 from public.shein_order_links where line_id=prefix||'1' and item_id=item_b) then raise exception 'explicit reference ignored';end if;
 -- Revenue is per sale, net of entered fees/refunds, never per SKU or purchase.
 update public.sales_lines set fees_amount=2,refund_amount=5 where id=prefix||'1';
 result:=public.sales_budget_income();
 if (select count(*) from jsonb_array_elements(result)e where e->>'line_id' like prefix||'%')<>4 then raise exception 'repeated-sale revenues collapsed';end if;
 if not exists(select 1 from jsonb_array_elements(result)e where e->>'line_id'=prefix||'1' and (e->>'amount')::numeric=23) then raise exception 'net revenue incorrect';end if;
 update public.sales_orders set status='cancelled' where id=(select order_id from public.sales_lines where id=prefix||'2');
 update public.sales_orders set currency='GBP' where id=(select order_id from public.sales_lines where id=prefix||'3');
 update public.sales_lines set source_active=false where id=prefix||'4';
 result:=public.sales_budget_income();
 if (select count(*) from jsonb_array_elements(result)e where e->>'line_id' like prefix||'%')<>1 then raise exception 'cancelled, inactive or non-EUR sale included';end if;
 update public.sales_orders set order_date='2099-01-31T23:30:00Z',status='completed' where id=(select order_id from public.sales_lines where id=prefix||'1');
 if not exists(select 1 from jsonb_array_elements(public.sales_budget_income())e where e->>'line_id'=prefix||'1' and e->>'date'='2099-02-01') then raise exception 'sale period not based on Paris date or completed sale omitted';end if;
 update public.sales_orders set status='returning' where id=(select order_id from public.sales_lines where id=prefix||'1');
 if exists(select 1 from jsonb_array_elements(public.sales_budget_income())e where e->>'line_id' like prefix||'%') then raise exception 'pending return included';end if;
end $$;
rollback;
