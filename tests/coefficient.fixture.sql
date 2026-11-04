-- Only for the disposable CI database. Minimal contract of the production view.
create role anon;
create role authenticated;
create role service_role;
grant usage on schema public to service_role;
create table public.workspace_sales (
 id text primary key, resolved_sku text, source jsonb, account_login text,
 sale_date timestamptz, order_status text, currency text, actual_cost numeric,
 fees_amount numeric not null default 0, refund_amount numeric not null default 0,
 finance_confirmed boolean not null default false
);
create table public.sales_supplier_details(sku text primary key,currency text,price numeric);
grant select on public.workspace_sales,public.sales_supplier_details to service_role;
insert into public.sales_supplier_details values('SKU-A','EUR',99);
insert into public.workspace_sales(id,resolved_sku,source,account_login,sale_date,order_status,currency,actual_cost,fees_amount,refund_amount,finance_confirmed) values
 ('1','SKU-A','{"title":"A","selling_price":"40"}','test','2099-11-30 23:30:00+00','completed','EUR',10,0,0,true),
 ('2','SKU-A','{"title":"A","selling_price":"30"}','test','2099-12-02','payment_received','EUR',30,0,0,false),
 ('3','SKU-B','{"title":"B","selling_price":"20"}','test','2099-12-02','completed','EUR',8,2,25,false),
 ('4','SKU-A','{"title":"A","selling_price":"99"}','test','2099-12-02','returning','EUR',50,0,0,false),
 ('5','SKU-A','{"title":"A","selling_price":"99"}','test','2099-12-02','cancelled','EUR',50,0,0,false),
 ('6','SKU-A','{"title":"A","selling_price":"99"}','test','2099-12-02','suspended','EUR',50,0,0,false),
 ('7','SKU-A','{"title":"A","selling_price":"10"}','test','2099-12-02','completed','EUR',null,0,0,false),
 ('8','SKU-A','{"title":"A","selling_price":"10"}','test','2099-12-02','completed','EUR',0,0,0,false),
 ('9','SKU-A','{"title":"A"}','test','2099-12-02','completed','EUR',4,0,0,false),
 ('10','SKU-USD','{"title":"USD","selling_price":"100"}','test','2099-12-02','completed','USD',10,0,0,false),
 ('11','SKU-A','{"title":"A","selling_price":"12"}','test','2099-10-02','completed','EUR',4,0,0,false),
 ('12','SKU-ZERO','{"title":"Zero","selling_price":"12"}','test','2099-12-02','completed','EUR',6,0,12,false);
