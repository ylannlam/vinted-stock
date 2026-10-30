begin;
create table public.drop_tracker (
  id boolean primary key default true check(id),
  payload jsonb not null default '{"accounts":[],"expenses":[],"settings":{"budget":0}}',
  revision integer not null default 0 check(revision >= 0),
  updated_at timestamptz not null default now()
);
alter table public.drop_tracker enable row level security;
revoke all on public.drop_tracker from public, anon, authenticated;
grant all on public.drop_tracker to service_role;
insert into public.drop_tracker(id) values(true);
commit;
