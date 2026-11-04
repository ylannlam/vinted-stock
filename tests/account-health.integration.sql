begin;
insert into public.publication_accounts(id,login) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','test.account');
do $$
declare tab text;
begin
 foreach tab in array array['account_health_reports','account_health_alerts','account_health_sync'] loop
  if not (select relrowsecurity from pg_class where oid=('public.'||tab)::regclass) then raise exception 'RLS missing %',tab;end if;
  if has_table_privilege('anon','public.'||tab,'SELECT') or has_table_privilege('authenticated','public.'||tab,'UPDATE') then raise exception 'Client access granted %',tab;end if;
  if not has_table_privilege('service_role','public.'||tab,'SELECT,INSERT,UPDATE') then raise exception 'Server access missing %',tab;end if;
 end loop;
end $$;
set local role service_role;
insert into public.account_health_reports(account_id,status,until_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','temporary',now()+interval '24 hours');
do $$ begin
 begin
  update public.account_health_reports set status='ok';
  raise exception 'A non-temporary status accepted a deadline';
 exception when check_violation then null;end;
 if not exists(select 1 from public.account_health_reports where status='temporary') then raise exception 'Report was lost';end if;
end $$;
update public.account_health_reports set status='restricted' where version=1;
insert into public.account_health_alerts(id,account_id,status,title,body,resolved,created_at,observed_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','restricted','Compte restreint','Messages limités',false,now(),now());
do $$ begin
 if not exists(select 1 from public.account_health_reports where status='restricted' and until_at is not null) then raise exception 'Restriction deadline lost';end if;
end $$;
update public.account_health_reports set until_at=null,until_date='2026-11-05';
do $$ begin
 if not exists(select 1 from public.account_health_reports where status='restricted' and until_date='2026-11-05' and until_at is null) then raise exception 'Date precision lost';end if;
 begin
  update public.account_health_reports set until_at=now();
  raise exception 'Mixed date precision accepted';
 exception when check_violation then null;end;
end $$;
update public.account_health_reports set status='ok',until_at=null,until_date=null,version=version+1 where version=1;
do $$ begin
 if not exists(select 1 from public.account_health_reports where status='ok' and version=2) then raise exception 'Confirmation failed';end if;
 if (select count(*) from public.account_health_sync)<>1 then raise exception 'Refresh state missing';end if;
end $$;
rollback;
