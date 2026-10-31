begin;
do $$
declare newer uuid:=gen_random_uuid(); older uuid:=gen_random_uuid(); pending uuid:=gen_random_uuid();
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); d uuid:=gen_random_uuid();
  cutoff timestamptz; sku text:='TRACKING-ROLLBACK';
begin
  select starts_at into cutoff from public.dotb_tracking_period;
  if cutoff is distinct from '2026-10-29 23:00:00+00'::timestamptz then raise exception 'Incorrect Paris midnight'; end if;
  if exists(select 1 from public.catalog_dotb_items i where i.sku='TRACKING-ROLLBACK') then raise exception 'Fixture collision'; end if;
  insert into public.catalog_dotb_items(id,sku,title,synced_at) values(newer,sku,'New',now()),(older,sku,'Old',now()),(pending,'TRACKING-UNKNOWN','Unknown',now());
  perform public.classify_catalog_items(array[newer],'included');
  perform public.classify_catalog_items(array[older],'excluded');
  if exists(select 1 from public.catalog_tracked_items where id in (older,pending)) then raise exception 'Excluded or unknown item included'; end if;
  insert into public.sales_orders(id,status,currency,order_date) values
    (a,'completed','EUR',cutoff-interval '1 millisecond'),(b,'completed','EUR',cutoff),
    (c,'completed','EUR',cutoff+interval '1 hour'),(d,'completed','EUR',cutoff+interval '1 hour');
  insert into public.sales_lines(id,order_id,dotb_item_id,source) values
    ('TRACKING-'||a,a,gen_random_uuid(),jsonb_build_object('sku',sku,'selling_price','10','dotb_listing_id',newer)),
    ('TRACKING-'||b,b,gen_random_uuid(),jsonb_build_object('sku',sku,'selling_price','20','dotb_listing_id',newer)),
    ('TRACKING-'||c,c,gen_random_uuid(),jsonb_build_object('sku',sku,'selling_price','30','dotb_listing_id',older)),
    ('TRACKING-'||d,d,gen_random_uuid(),jsonb_build_object('sku',sku,'selling_price','40'));
  if exists(select 1 from public.sales_lines_in_period where order_id=a) then raise exception 'Pre-cutoff sale included'; end if;
  if not exists(select 1 from public.sales_lines_in_period where order_id=b and tracking_status='included') then raise exception 'Boundary sale missing'; end if;
  if not exists(select 1 from public.sales_lines_in_period where order_id=c and tracking_status='excluded') then raise exception 'Old listing counted because SKU reused'; end if;
  if not exists(select 1 from public.sales_lines_in_period where order_id=d and tracking_status='unclassified') then raise exception 'Ambiguous SKU attribution guessed'; end if;
  if not exists(select 1 from public.catalog_sales_by_sku s where s.sku='TRACKING-ROLLBACK' and quantity=1 and revenue=20) then raise exception 'Stats include history or excluded articles'; end if;
  perform public.classify_catalog_items(array[newer],'excluded');
  if exists(select 1 from public.catalog_sales_by_sku s where s.sku='TRACKING-ROLLBACK') then raise exception 'Stats ignore classification change'; end if;
  if not exists(select 1 from public.sales_orders where id=a) then raise exception 'History removed'; end if;
  if has_function_privilege('authenticated','public.classify_catalog_items(uuid[],text)','EXECUTE') then raise exception 'Classification exposed directly'; end if;
end $$;
rollback;
select 'Fixed Paris boundary, article classification, SKU reuse and preserved history verified' as result;
