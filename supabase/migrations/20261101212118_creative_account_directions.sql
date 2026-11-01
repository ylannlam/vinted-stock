begin;
create table public.creative_accounts (
  id uuid primary key,
  login text not null check(length(login) between 1 and 200),
  country text check(length(country)<=20),
  source_present boolean not null default true,
  synced_at timestamptz not null default now(),
  enabled boolean not null default false,
  background_id uuid references public.creative_resources(id) on delete set null,
  prompt_front text check(length(prompt_front)<=50000),
  prompt_back text check(length(prompt_back)<=50000),
  notes text not null default '' check(length(notes)<=3000),
  version integer not null default 1 check(version>0),
  updated_at timestamptz not null default now()
);
alter table public.creative_accounts enable row level security;
revoke all on public.creative_accounts from public,anon,authenticated;
grant all on public.creative_accounts to service_role;
create index creative_accounts_background on public.creative_accounts(background_id);

-- Refresh only Dotb metadata. Selection and custom prompts never get reset by a sync.
create function public.sync_creative_accounts(p_accounts jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_accounts) is distinct from 'array' then raise exception 'invalid_accounts'; end if;
  perform pg_advisory_xact_lock(61212118);
  update public.creative_accounts set source_present=false;
  insert into public.creative_accounts(id,login,country,source_present,synced_at)
    select a.id,a.login,a.country,true,now()
    from jsonb_to_recordset(p_accounts) as a(id uuid,login text,country text)
    on conflict(id) do update set login=excluded.login,country=excluded.country,source_present=true,synced_at=excluded.synced_at;
end $$;

-- Apply only changed checkboxes, atomically, so a filtered list cannot erase hidden choices.
create function public.select_creative_accounts(p_changes jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c record; n integer;
begin
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'invalid_selection'; end if;
  for c in select * from jsonb_to_recordset(p_changes) as x(id uuid,version integer,enabled boolean) order by id loop
    update public.creative_accounts set enabled=c.enabled,version=version+1,updated_at=clock_timestamp()
      where id=c.id and version=c.version;
    get diagnostics n=row_count;
    if n<>1 then raise exception 'stale_account'; end if;
  end loop;
end $$;
revoke all on function public.sync_creative_accounts(jsonb),public.select_creative_accounts(jsonb) from public,anon,authenticated;
grant execute on function public.sync_creative_accounts(jsonb),public.select_creative_accounts(jsonb) to service_role;
commit;
