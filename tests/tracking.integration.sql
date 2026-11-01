begin;
do $$
declare
  old_listing uuid:=gen_random_uuid(); unknown_listing uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); e uuid:=gen_random_uuid();
  absent uuid:=gen_random_uuid(); old_order uuid:=gen_random_uuid(); old_item uuid:=gen_random_uuid();
  cutoff timestamptz; fixture_sku text:='DATE_'||replace(gen_random_uuid()::text,'-','');
begin
  select starts_at into cutoff from public.dotb_tracking_period;
  assert cutoff='2026-10-30 23:00:00+00'::timestamptz,'Start must be 31 October midnight in Paris';
  insert into public.catalog_dotb_items(id,sku,title,synced_at,tracking_status) values
    (old_listing,fixture_sku,'Legacy excluded listing',now(),'excluded'),
    (unknown_listing,fixture_sku,'Legacy unclassified listing',now(),'unclassified');
  assert (select count(*) from public.catalog_tracked_items where id in (old_listing,unknown_listing))=2,'Catalogue must not require classification';
  insert into public.sales_orders(id,status,currency,order_date) values
    (a,'completed','EUR',cutoff-interval '1 millisecond'),(b,'completed','EUR',cutoff),
    (c,'completed','EUR',cutoff+interval '1 hour'),(d,'paid','EUR',cutoff+interval '1 hour'),
    (e,'cancelled','EUR',cutoff+interval '1 hour');
  insert into public.sales_lines(id,order_id,dotb_item_id,source) values
    ('DATE-'||a,a,gen_random_uuid(),jsonb_build_object('sku',fixture_sku,'selling_price','10','dotb_listing_id',old_listing)),
    ('DATE-'||b,b,gen_random_uuid(),jsonb_build_object('sku',fixture_sku,'selling_price','20','dotb_listing_id',old_listing)),
    ('DATE-'||c,c,gen_random_uuid(),jsonb_build_object('sku',fixture_sku,'selling_price','30','dotb_listing_id',unknown_listing)),
    ('DATE-'||d,d,gen_random_uuid(),jsonb_build_object('sku',fixture_sku,'selling_price','40')),
    ('DATE-'||e,e,gen_random_uuid(),jsonb_build_object('sku',fixture_sku,'selling_price','100'));
  assert not exists(select 1 from public.sales_lines_in_period where order_id=a),'Pre-cutoff sale must remain out';
  assert (select count(*) from public.sales_lines_in_period where order_id in (b,c,d) and tracking_status='included')=3,'Recent sales must be included regardless of listing age or classification';
  assert exists(select 1 from public.catalog_sales_by_sku s where s.sku=fixture_sku and quantity=3 and revenue=90),'Stats must include all recent valid sales, excluding history and cancellations';
  update public.sales_lines set source_active=false where order_id=c;
  assert exists(select 1 from public.catalog_sales_by_sku s where s.sku=fixture_sku and quantity=2 and revenue=60),'Inactive lines must not count';
  assert exists(select 1 from public.sales_orders where id=a),'Old orders must remain stored';
  perform public.upsert_sales_snapshot(
    jsonb_build_array(jsonb_build_object('id',old_order,'status','paid','currency','EUR','order_date',cutoff-interval '1 second','synced_at',now())),
    jsonb_build_array(jsonb_build_object('id',old_order::text||':'||old_item::text,'order_id',old_order,'dotb_item_id',old_item,'source',jsonb_build_object('sku',fixture_sku,'dotb_listing_id',absent))));
  assert not exists(select 1 from public.catalog_dotb_items where id=absent),'Historical webhook must not repopulate catalogue';
  assert not has_function_privilege('authenticated','public.queue_sales_sources(uuid[])','EXECUTE'),'Queue must remain server only';
  assert not has_function_privilege('service_role','public.classify_catalog_items(uuid[],text)','EXECUTE'),'Obsolete classification must not cancel retrievals';
end $$;
rollback;
