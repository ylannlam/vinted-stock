begin;
-- All fixtures, audit events and revision increments are rolled back.
do $$
declare a uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); i uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); occupied uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(a,a||'@workspace-test.invalid'),(s,s||'@workspace-test.invalid'),(e,e||'@workspace-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(a,a||'@workspace-test.invalid','Test admin','admin'),(s,s||'@workspace-test.invalid','Test stock','stock'),(e,e||'@workspace-test.invalid','Test employee','employe');
 insert into public.commandes(id,tracking_number) values(c,'WORKSPACE-ROLLBACK');
 insert into public.items(id,size,status,commande_id) values(i,'M','a_recevoir',c),(j,'L','a_recevoir',c);
 insert into public.items(id,size,status,emplacement) values(occupied,'S','en_stock','WORKSPACE-OCCUPIED');
 perform set_config('test.admin',a::text,true);perform set_config('test.stock',s::text,true);perform set_config('test.employee',e::text,true);
 perform set_config('test.order',c::text,true);perform set_config('test.item',i::text,true);perform set_config('test.second',j::text,true);
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.employee'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare n int;
begin
 if public.get_my_role()<>'employe' then raise exception 'employee role failed'; end if;
 select count(*) into n from public.items where id=current_setting('test.item')::uuid;
 if n<>0 then raise exception 'employee reads stock'; end if;
 select count(*) into n from public.commandes where id=current_setting('test.order')::uuid;
 if n<>0 then raise exception 'employee reads orders'; end if;
 update public.items set size='XS' where id=current_setting('test.item')::uuid;
 get diagnostics n=row_count;if n<>0 then raise exception 'employee updates stock'; end if;
 begin
  insert into public.items(size) values('M');raise exception 'employee inserts stock';
 exception when insufficient_privilege then null;end;
 begin
  perform public.set_stock_trash('items',current_setting('test.item')::uuid,false);raise exception 'employee trashes stock';
 exception when insufficient_privilege then null;end;
 begin
  delete from public.items where id=current_setting('test.item')::uuid;raise exception 'hard deletion exposed';
 exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.stock'),'role','authenticated')::text,true);
set local role authenticated;
do $$
declare i uuid:=current_setting('test.item')::uuid;j uuid:=current_setting('test.second')::uuid;c uuid:=current_setting('test.order')::uuid;n int;
begin
 if public.get_my_role()<>'stock' then raise exception 'stock role failed';end if;
 update public.items set size='XL' where id=i;get diagnostics n=row_count;if n<>1 then raise exception 'stock cannot edit';end if;
 begin
  perform public.receive_stock_order(c,jsonb_build_object(i,'WORKSPACE-FREE',j,'WORKSPACE-OCCUPIED'));
  raise exception 'occupied slot accepted';
 exception when raise_exception then if sqlerrm<>'slot_occupied' then raise;end if;end;
 if exists(select 1 from public.items where id in(i,j) and status<>'a_recevoir') then raise exception 'partial receipt committed';end if;
 perform public.receive_stock_order(c,jsonb_build_object(i,'WORKSPACE-FREE-1',j,'WORKSPACE-FREE-2'));
 if (select count(*) from public.items where id in(i,j) and status='en_stock')<>2 then raise exception 'receipt failed';end if;
 if (select status from public.commandes where id=c)<>'recue' then raise exception 'order status failed';end if;
 perform public.set_stock_trash('items',i,false);
 perform public.set_stock_trash('commandes',c,false);
 begin perform public.set_stock_trash('items',j,true);raise exception 'restored without parent';exception when raise_exception then if sqlerrm<>'restore_parent_first' then raise;end if;end;
 perform public.set_stock_trash('commandes',c,true);
 if (select deleted_at from public.items where id=i) is null then raise exception 'restored unrelated trash batch';end if;
 if (select deleted_at from public.items where id=j) is not null then raise exception 'child not restored';end if;
 insert into public.items(size,emplacement) values('S','WORKSPACE-FREE-1');
 perform public.set_stock_trash('items',i,true);
 if (select emplacement from public.items where id=i) is not null then raise exception 'restored into occupied slot';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$begin
 if (select count(*) from public.items where id=current_setting('test.item')::uuid)<>1 then raise exception 'admin cannot read';end if;
 if has_table_privilege('authenticated','public.workspace_events','INSERT') then raise exception 'audit forgery exposed';end if;
 if has_function_privilege('authenticated','public.save_sales_batch(jsonb,text,text,uuid)','EXECUTE') then raise exception 'server batch exposed';end if;
end $$;
reset role;
set local role anon;
do $$begin
 begin perform 1 from public.items limit 1;raise exception 'anon reads stock';exception when insufficient_privilege then null;end;
 begin perform public.get_my_role();raise exception 'role lookup exposed to anon';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role service_role;
do $$
declare order_id uuid:=gen_random_uuid();item_a uuid:=gen_random_uuid();item_b uuid:=gen_random_uuid();a text;b text;v timestamptz;v2 timestamptz;result jsonb;month text:='2100-01';login text:='WORKSPACE-'||gen_random_uuid();
begin
 a:=order_id||':'||item_a;b:=order_id||':'||item_b;
 insert into public.sales_orders(id,account_login,status,currency,order_date,deadline) values(order_id,login,'payment_received','EUR','2100-01-15','2100-01-20');
 insert into public.sales_lines(id,order_id,dotb_item_id,source) values
 (a,order_id,item_a,jsonb_build_object('title','Rollback blouse','selling_price','30.00','sku','TEST-WORKSPACE')),
 (b,order_id,item_b,jsonb_build_object('title','Rollback dress','selling_price','20.00','sku','TEST-WORKSPACE'));
 select updated_at into v from public.sales_lines where id=a;select updated_at into v2 from public.sales_lines where id=b;
 begin
  perform public.save_sales_batch(jsonb_build_array(jsonb_build_object('id',a,'updated_at',v),jsonb_build_object('id',b,'updated_at','2000-01-01')),'order_ref','TEST-ORDER',current_setting('test.admin')::uuid);
  raise exception 'stale batch accepted';
 exception when raise_exception then if sqlerrm<>'stale_version' then raise;end if;end;
 if exists(select 1 from public.sales_lines where id in(a,b) and supplier_order_ref is not null) then raise exception 'partial batch committed';end if;
 perform public.save_sales_batch(jsonb_build_array(jsonb_build_object('id',a,'updated_at',v),jsonb_build_object('id',b,'updated_at',v2)),'order_ref','TEST-ORDER',current_setting('test.admin')::uuid);
 if (select count(*) from public.sales_lines where id in(a,b) and supplier_order_ref='TEST-ORDER')<>2 then raise exception 'batch not applied';end if;
 select updated_at into v from public.sales_lines where id=a;
 perform public.save_sales_workspace(a,v,jsonb_build_object('actual_cost','12.00','supplier_order_ref','TEST-ORDER'),null,2,3,true,current_setting('test.admin')::uuid);
 result:=public.workspace_finance(month,0);
 if (result#>>'{totals,0,confirmed_margin}')::numeric<>13 then raise exception 'incorrect confirmed margin: %',result;end if;
 if (result#>>'{totals,0,confirmed_count}')::int<>1 then raise exception 'unknown cost counted as confirmed';end if;
 result:=public.sales_workspace_page(jsonb_build_object('account',login,'stage','all','page',0),null);
 if (result->>'count')::int<>2 or jsonb_array_length(result->'lines')<>2 then raise exception 'filtered pagination failed: %',result;end if;
 if not (public.sales_workspace_page(jsonb_build_object('account',login,'stage','all','page',0),result->>'revision')->>'unchanged')::boolean then raise exception 'conditional refresh failed';end if;
 result:=public.sales_workspace_page(jsonb_build_object('account',login,'stage','all','page',1),null);
 if jsonb_array_length(result->'lines')<>0 or (result->>'count')::int<>2 then raise exception 'empty page failed';end if;
 if not exists(select 1 from public.workspace_events where entity_id=a and actor_name='Test admin') then raise exception 'actor missing from audit';end if;
 if exists(select 1 from public.workspace_events where changes ?| array['password','email','token','source','photo_url','bordereau_url']) then raise exception 'secrets included in audit';end if;
end $$;
rollback;
select 'Permissions, atomic receipt, recoverable deletion, restoration conflicts, batch concurrency, financial totals, pagination and audit passed; all fixtures rolled back.' as result;
