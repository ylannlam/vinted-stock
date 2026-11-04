begin;
-- Fixtures and their collection jobs are rolled back, never sent to Dotb or Shein.
do $$
declare u uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u||'@sale-details-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(u,u||'@sale-details-test.invalid','Test fiche','admin');
 perform set_config('test.sale_user',u::text,true);
 if has_function_privilege('anon','public.workspace_actions(text,int)','execute') or has_function_privilege('authenticated','public.save_sale_details(text,timestamptz,jsonb,jsonb,numeric,numeric,boolean,jsonb,uuid)','execute') then raise exception 'server function exposed';end if;
 if has_table_privilege('authenticated','public.workspace_sale_actions','select') then raise exception 'server view exposed';end if;
end $$;
set local role service_role;
do $$
declare o uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();id_a text;id_b text;v timestamptz;edit jsonb;result jsonb;u uuid:=current_setting('test.sale_user')::uuid;login text:='DETAILS-'||gen_random_uuid();
begin
 id_a:=o||':'||a;id_b:=o||':'||b;
 insert into public.sales_orders(id,account_login,status,currency,order_date,deadline) values(o,login,'payment_received','EUR','2099-12-01',now()-interval '1 day');
 insert into public.sales_lines(id,order_id,dotb_item_id,source) values
 (id_a,o,a,jsonb_build_object('title','Même titre','selling_price','30','sku','TEST-SALE-DETAILS')),
 (id_b,o,b,jsonb_build_object('title','Même titre','selling_price','20','sku','TEST-SALE-DETAILS'));
 select updated_at into v from public.sales_lines where id=id_a;
 edit:=jsonb_build_object('sku_override','TEST-SALE-DETAILS','actual_cost','12');
 perform public.save_sale_details(id_a,v,edit,null,2,3,true,'{"size":"M","color":"Noir"}',u);
 if (select supplier_size from public.workspace_sales where id=id_a)<>'M' then raise exception 'size not readable from sales view';end if;
 if (select supplier_color from public.sales_lines where id=id_b) is not null then raise exception 'variant leaked to another sale';end if;
 begin
  perform public.save_sale_details(id_a,v,edit,null,0,0,false,'{"size":"XL","color":"Rouge"}',u);
  raise exception 'stale version accepted';
 exception when raise_exception then if sqlerrm<>'stale_version' then raise;end if;end;
 if (select supplier_color from public.sales_lines where id=id_a)<>'Noir' then raise exception 'stale variant saved';end if;
 select updated_at into v from public.sales_lines where id=id_b;
 perform public.save_sale_details(id_b,v,jsonb_build_object('sku_override','TEST-SALE-DETAILS'),null,0,0,false,'{"size":"L","color":"Beige"}',u);
 result:=public.sales_workspace_page(jsonb_build_object('account',login,'stage','all','page',0),null);
 if (result->>'count')::int<>2 or not exists(select 1 from jsonb_array_elements(result->'lines') r where r->>'id'=id_a and r->>'supplier_size'='M') then raise exception 'detail missing from paginated sales';end if;
 if (select action from public.workspace_sale_actions where id=id_a)<>'shein' then raise exception 'missing fiche not actionable';end if;
 update public.sales_lines set stage='prepared' where id=id_a;
 if (select action from public.workspace_sale_actions where id=id_a)<>'ship' then raise exception 'shipping blocked by old missing fiche';end if;
 result:=public.workspace_actions('ship',0);
 if not exists(select 1 from jsonb_array_elements(result->'rows') r where r->>'id'=id_a) then raise exception 'urgent shipping missing';end if;
 result:=public.workspace_finance('2099-12',0);
 if (result#>>'{totals,0,confirmed_margin}')::numeric<>13 or (result#>>'{totals,0,confirmed_count}')::int<>1 then raise exception 'confirmed costs incorrect';end if;
 if (result#>>'{leaders,0,verified_count}')::int<>1 or (result#>>'{leaders,0,quantity}')::int<>2 then raise exception 'profit coverage missing';end if;
 -- Resale coefficient: only the sale with a real paid cost counts (30 - 3 refund - 2 fees = 25 for 12 paid).
 if (result#>>'{totals,0,coef_revenue}')::numeric is distinct from 25 or (result#>>'{totals,0,coef_cost}')::numeric is distinct from 12 or (result#>>'{totals,0,coef_count}')::int is distinct from 1 then raise exception 'coefficient totals incorrect';end if;
 if (result#>>'{leaders,0,coef_revenue}')::numeric is distinct from 25 or (result#>>'{leaders,0,coef_cost}')::numeric is distinct from 12 or (result#>>'{leaders,0,coef_count}')::int is distinct from 1 then raise exception 'product coefficient incorrect';end if;
 if (result#>>'{totals,0,purchase_cost}')::numeric is distinct from 12 or (result#>>'{totals,0,quantity}')::int is distinct from 2 then raise exception 'existing finance fields changed';end if;
 update public.sales_lines set actual_cost=null,finance_confirmed=false where id=id_a;
 result:=public.workspace_finance('2099-12',0);
 if result#>>'{totals,0,confirmed_margin}' is not null or result#>>'{totals,0,purchase_cost}' is not null then raise exception 'unknown cost shown as zero';end if;
 if (result#>>'{totals,0,coef_count}')::int is distinct from 0 or result#>>'{totals,0,coef_cost}' is not null then raise exception 'coefficient invented without a paid cost';end if;
 update public.sales_orders set status='completed' where id=o;
 if exists(select 1 from public.workspace_sale_actions where id in(id_a,id_b)) then raise exception 'completed sale remains actionable';end if;
 update public.sales_orders set status='cancelled' where id=o;
 if exists(select 1 from public.workspace_sale_actions where id in(id_a,id_b)) then raise exception 'cancelled sale remains actionable';end if;
 update public.sales_orders set status='returning' where id=o;
 if (select count(*) from public.workspace_sale_actions where id in(id_a,id_b) and action='review')<>2 then raise exception 'returns hidden';end if;
end $$;
rollback;
