begin;
do $$ declare u uuid:=gen_random_uuid(); begin
 insert into auth.users(id,email) values(u,u||'@shein-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(u,u||'@shein-test.invalid','Test assistant','admin');
 perform set_config('test.shein_user',u::text,true);
 if has_table_privilege('anon','public.shein_sync_runs','select') or has_function_privilege('authenticated','public.shein_budget_expenses()','execute') then raise exception 'private assistant exposed';end if;
end $$;
set local role service_role;
do $$
declare u uuid:=current_setting('test.shein_user')::uuid; dev uuid:=gen_random_uuid();o uuid:=gen_random_uuid(); run uuid:=gen_random_uuid();
 ref text:='GTEST'||upper(replace(gen_random_uuid()::text,'-',''));item text;sku text:='TEST-'||gen_random_uuid();
 a text:='test-a-'||gen_random_uuid();b text:='test-b-'||gen_random_uuid();c text:='test-c-'||gen_random_uuid();
 payload jsonb;summary jsonb;v timestamptz;previous_sync timestamptz;reply jsonb;
begin
 item:=ref||':variant';
 insert into public.catalog_collectors(id,name,token_hash,created_by) values(dev,'Test assistant',repeat('0',64),u);
 insert into public.sales_orders(id,account_login,status,currency,order_date) values(o,'TEST-SHEIN','payment_received','EUR','2099-01-01');
 insert into public.sales_lines(id,order_id,dotb_item_id,source,supplier_size,supplier_color) values
 (a,o,gen_random_uuid(),jsonb_build_object('title','Test A','sku',sku),'M','Noir'),
 (b,o,gen_random_uuid(),jsonb_build_object('title','Test B','sku',sku),'M','Noir'),
 (c,o,gen_random_uuid(),jsonb_build_object('title','Test C','sku',sku),'M','Noir');
 payload:=jsonb_build_object('ref',ref,'order_date','2099-01-02','observed_at',now(),'items',jsonb_build_array(jsonb_build_object('id',item,'sku',sku,'supplier_id','123','product_url','https://fr.shein.com/Test-p-123.html','title','Test','size','M','color','Noir','quantity',3,'unit_price',8,'paid_amounts',jsonb_build_array(8,8,8),'status','processing','status_text','Emballage')),'parcels',jsonb_build_array(jsonb_build_object('tracking_number','TEST123456','carrier','GOFO','skus',jsonb_build_array(sku),'observed_at',now())));
 payload:=payload||jsonb_build_object('payment',jsonb_build_object('paid_total',27.90,'shipping',3.90,'currency','EUR','source','order_summary'));
 perform public.import_shein_order_v2(payload,dev);perform public.reconcile_shein_orders(u);
 if (select status_text from public.shein_order_items where id=item)<>'Emballage' then raise exception 'original status lost';end if;
 if jsonb_array_length((select shipment_observations from public.shein_orders so where so.ref=payload->>'ref'))<>1 then raise exception 'parcel missing';end if;
 -- Exact observed prices refresh managed costs, without touching manual costs.
 update public.sales_lines set actual_cost=11,updated_at=clock_timestamp() where id=a;
 payload:=jsonb_set(payload,'{observed_at}',to_jsonb(now()+interval '1 second'));
 payload:=jsonb_set(payload,'{items,0,unit_price}','7.50');
 perform public.import_shein_order_v2(payload,dev);
 if (select actual_cost from public.sales_lines where id=a)<>11 then raise exception 'manual cost overwritten';end if;
 if (select actual_cost from public.sales_lines where id=b)<>7.50 then raise exception 'actual price not updated';end if;
 select count(*) into reply from jsonb_array_elements(public.shein_budget_expenses()) e where e->>'order_ref'=ref;
 if reply<>'1'::jsonb then raise exception 'budget duplicate';end if;
 if not exists(select 1 from jsonb_array_elements(public.shein_budget_expenses()) e where e->>'order_ref'=ref and (e->>'amount')::numeric=27.90) then raise exception 'budget total incorrect';end if;
 -- Stale snapshots cannot replace the recorded total or its unit price.
 perform public.import_shein_order_v2(jsonb_set(payload,'{payment,paid_total}','999'),dev);
 if (select (payment->>'paid_total')::numeric from public.shein_orders so where so.ref=payload->>'ref')<>27.90 then raise exception 'stale total replaced';end if;
 -- Differently priced identical units stay unknown for an individual sale, never averaged.
 payload:=jsonb_set(payload,'{observed_at}',to_jsonb(now()+interval '2 second'));
 payload:=jsonb_set(payload,'{items,0,unit_price}','null');
 payload:=jsonb_set(payload,'{items,0,paid_amounts}','[7,8,9]');
 perform public.import_shein_order_v2(payload,dev);
 if (select actual_cost from public.sales_lines where id=b) is not null then raise exception 'ambiguous cost retained';end if;
 if (select actual_cost from public.sales_lines where id=a)<>11 then raise exception 'manual cost cleared';end if;
 -- Partial reads never claim a complete global synchronization.
 select last_completed_at into previous_sync from public.shein_sync_state where id;
 insert into public.shein_sync_runs(id,collector_id,mode,from_date,to_date) values(run,dev,'full','2099-01-01','2099-01-02');
 perform public.finish_shein_sync_v2(dev,run,1,2,jsonb_build_array(jsonb_build_object('ref','GTESTMISSING','code','unreadable')),false);
 if (select last_completed_at from public.shein_sync_state where id) is distinct from previous_sync then raise exception 'partial scan marked complete';end if;
 if (select state from public.shein_sync_runs where id=run)<>'partial' then raise exception 'partial scan missing';end if;
 if public.finish_shein_sync_v2(dev,run,1,2,'[]',true)<>0 then raise exception 'finish replayed';end if;
end $$;
rollback;

