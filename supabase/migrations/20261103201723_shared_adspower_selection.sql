begin;
create table public.adspower_preferences (
 owner_id uuid primary key references public.profiles(id),
 version integer not null default 1 check(version>0),
 profiles jsonb not null default '[]' check(jsonb_typeof(profiles)='array' and jsonb_array_length(profiles)<=1000),
 updated_at timestamptz not null default now()
);
alter table public.adspower_preferences enable row level security;
revoke all on public.adspower_preferences from public,anon,authenticated;
grant all on public.adspower_preferences to service_role;
comment on table public.adspower_preferences is 'Owner-scoped selected AdsPower profiles. API checks administrator and owner; version comparisons protect concurrent edits.';
commit;
