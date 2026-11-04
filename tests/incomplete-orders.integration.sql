begin;
insert into public.sales_orders(id,account_login,order_date,status) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','empty','2026-11-04','payment_received'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','complete','2026-11-04','label_sent'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','old','2026-10-28','completed'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4','unknown-date',null,'payment_received'),
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','inactive-lines','2026-11-04','cancelled');
insert into public.sales_lines(id,order_id,dotb_item_id,source_active) values
 ('complete:1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',true),
 ('inactive:1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',false);
do $$ begin
 if has_table_privilege('anon','public.sales_orders_without_items','SELECT') or has_table_privilege('authenticated','public.sales_orders_without_items','SELECT') then raise exception 'Direct client access granted';end if;
 if not (select reloptions @> array['security_invoker=true'] from pg_class where oid='public.sales_orders_without_items'::regclass) then raise exception 'View must respect underlying RLS';end if;
end $$;
set local role service_role;
do $$ begin
 if (select count(*) from public.sales_orders_without_items)<>3 then raise exception 'Missing or extra incomplete order';end if;
 if exists(select 1 from public.sales_orders_without_items where account_login in ('old','complete')) then raise exception 'Complete or out-of-period order leaked';end if;
 if (select count(*) from public.sales_lines)<>2 then raise exception 'Fake article created';end if;
end $$;
insert into public.sales_lines(id,order_id,dotb_item_id) values ('recovered:1','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3');
do $$ begin
 if exists(select 1 from public.sales_orders_without_items where account_login='empty') then raise exception 'Recovered order still listed twice';end if;
end $$;
rollback;
