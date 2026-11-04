begin;
create table public.account_health_reports (
 account_id uuid primary key references public.publication_accounts(id),
 status text not null check(status in ('ok','temporary','permanent','blocked','review')),
 reason text not null default '' check(length(reason)<=1000),until_at timestamptz,
 version integer not null default 1 check(version>0),checked_at timestamptz not null default now(),
 updated_by uuid references public.profiles(id),check(until_at is null or status='temporary')
);
create table public.account_health_alerts (
 id uuid primary key,account_id uuid not null,status text not null check(status in ('temporary','permanent','blocked','verification','review')),
 title text not null,body text not null,resolved boolean not null,created_at timestamptz not null,observed_at timestamptz not null
);
create index account_health_open_alerts on public.account_health_alerts(account_id,created_at desc) where not resolved;
create table public.account_health_sync (
 id boolean primary key default true check(id),last_attempt_at timestamptz,last_completed_at timestamptz,
 next_allowed_at timestamptz not null default '-infinity',error text,partial boolean not null default false
);
insert into public.account_health_sync(id) values(true);
alter table public.account_health_reports enable row level security;
alter table public.account_health_alerts enable row level security;
alter table public.account_health_sync enable row level security;
revoke all on public.account_health_reports,public.account_health_alerts,public.account_health_sync from public,anon,authenticated;
grant all on public.account_health_reports,public.account_health_alerts,public.account_health_sync to service_role;
commit;
