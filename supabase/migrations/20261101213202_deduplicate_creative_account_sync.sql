-- Normalize identities at the SQL boundary as well, including mixed-case UUID strings.
create or replace function public.sync_creative_accounts(p_accounts jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_accounts) is distinct from 'array' then raise exception 'invalid_accounts'; end if;
  perform pg_advisory_xact_lock(61212118);
  update public.creative_accounts set source_present=false;
  insert into public.creative_accounts(id,login,country,source_present,synced_at)
    select distinct on (a.id) a.id,a.login,a.country,true,now()
    from jsonb_array_elements(p_accounts) with ordinality as entry(value,position)
    cross join lateral jsonb_to_record(entry.value) as a(id uuid,login text,country text)
    order by a.id,entry.position
    on conflict(id) do update set login=excluded.login,country=excluded.country,source_present=true,synced_at=excluded.synced_at;
end $$;
