create or replace function public.scalency_record_profile_event(
  p_account text, p_event text, p_observed_at timestamptz, p_until timestamptz default null
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  setting_id text;
  new_status text;
  written integer;
begin
  if p_account is null or p_account !~ '^[A-Za-z0-9_-]{1,150}$'
     or p_event is null or p_event not in ('ban','restriction','unban','unrestrict')
     or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at > now() + interval '5 minutes'
     or (p_until is not null and (p_event <> 'restriction' or not isfinite(p_until) or p_until <= p_observed_at))
  then raise exception 'Invalid Scalency account observation'; end if;
  setting_id := case when p_event in ('ban','unban') then 'profile-ban:' else 'profile-restriction:' end || p_account;
  new_status := case p_event when 'ban' then 'banned' when 'restriction' then 'restricted' else 'cleared' end;
  insert into public.scalency_settings as stored(id,value)
  values (setting_id,jsonb_strip_nulls(jsonb_build_object('status',new_status,'checked_at',p_observed_at,'until',p_until,'source','scalency_journal')))
  on conflict (id) do update set value=excluded.value
  where (stored.value->>'checked_at')::timestamptz < p_observed_at;
  get diagnostics written = row_count;
  return written = 1;
end $$;
revoke all on function public.scalency_record_profile_event(text,text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.scalency_record_profile_event(text,text,timestamptz,timestamptz) to service_role;
