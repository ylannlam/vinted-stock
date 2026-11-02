begin;
set local role service_role;
do $$
declare login text:='ORDER-QA-'||gen_random_uuid();o uuid;i uuid;n int;page0 jsonb;page1 jsonb;before_count jsonb;after_count jsonb;ref text:='progress-qa-'||gen_random_uuid();
begin
  -- More than one page, with deadlines in the opposite order from sale dates.
  for n in 1..55 loop
    o:=gen_random_uuid();i:=gen_random_uuid();
    insert into public.sales_orders(id,account_login,status,currency,order_date,deadline)
      values(o,login,'payment_received','EUR','2099-01-01'::timestamptz+n*interval '1 hour','2099-02-01'::timestamptz+n*interval '1 hour');
    insert into public.sales_lines(id,order_id,dotb_item_id,source)
      values(o||':'||i,o,i,jsonb_build_object('title','Order test '||n));
  end loop;
  page0:=public.sales_workspace_page(jsonb_build_object('account',login,'page',0),null);
  page1:=public.sales_workspace_page(jsonb_build_object('account',login,'page',1),null);
  if jsonb_array_length(page0->'lines')<>50 or jsonb_array_length(page1->'lines')<>5 then raise exception 'wrong page sizes';end if;
  if page0#>>'{lines,0,source,title}'<>'Order test 55' or page0#>>'{lines,49,source,title}'<>'Order test 6' or page1#>>'{lines,0,source,title}'<>'Order test 5' or page1#>>'{lines,4,source,title}'<>'Order test 1' then raise exception 'wrong date order';end if;
  if not (public.sales_workspace_page(jsonb_build_object('account',login,'page',0),page0->>'revision')->>'unchanged')::boolean then raise exception 'revision cache broken';end if;
  before_count:=public.catalog_collection_progress();
  insert into public.catalog_collection_jobs(reference_key,input,expected_sku,status,created_at) values
    (ref,ref,ref,'failed',now()-interval '1 hour'),(ref,ref,ref,'completed',now()),
    (ref||'-2',ref||'-2',ref||'-2','queued',now()),(ref||'-3',ref||'-3',ref||'-3','blocked',now()),
    (ref||'-4',ref||'-4',ref||'-4','completed',now()-interval '1 hour'),(ref||'-4',ref||'-4',ref||'-4','excluded',now());
  after_count:=public.catalog_collection_progress();
  if (after_count->>'total')::int-(before_count->>'total')::int<>3 or (after_count->>'completed')::int-(before_count->>'completed')::int<>1 or (after_count->>'queued')::int-(before_count->>'queued')::int<>1 or (after_count->>'review')::int-(before_count->>'review')::int<>1 then raise exception 'wrong progress counts: % / %',before_count,after_count;end if;
  if has_function_privilege('anon','public.catalog_collection_progress()','execute') or has_function_privilege('authenticated','public.catalog_collection_progress()','execute') then raise exception 'progress function exposed';end if;
end $$;
rollback;
