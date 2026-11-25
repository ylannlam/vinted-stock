alter table public.scalency_lot_entries
  add column scheduled_for timestamptz,
  add column window_end timestamptz,
  add constraint scalency_lot_window_valid check (
    (scheduled_for is null and window_end is null) or
    (scheduled_for is not null and window_end is not null and scheduled_for < window_end)
  );

create or replace function public.scalency_accept_limited_lot(p_lot text,p_owner uuid,p_account text,p_entries jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare
  first_at timestamptz := (p_entries->0->>'at')::timestamptz;
  end_at timestamptz := (p_entries->0->>'until')::timestamptz;
  target_day date := (coalesce(first_at,now()) at time zone 'Europe/Paris')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('cadence:'||p_account,0));
  if exists(select from public.scalency_publication_lots where id=p_lot and owner_id=p_owner and account=p_account) then
    return public.scalency_accept_lot(p_lot,p_owner,p_account,p_entries);
  end if;
  if exists (
    select from jsonb_to_recordset(p_entries) as x(at timestamptz,until timestamptz)
    where (x.at is null)<>(first_at is null) or (x.at is null)<>(x.until is null)
      or x.until is distinct from end_at or x.at<=now() or x.at>=x.until
      or (x.at at time zone 'Europe/Paris')::date<>target_day
      or (x.until at time zone 'Europe/Paris')::date<>target_day
      or target_day>((now() at time zone 'Europe/Paris')::date+30)
  ) then raise exception 'lot_window'; end if;
  perform public.scalency_check_capacity(p_account,jsonb_array_length(p_entries),target_day);
  perform public.scalency_accept_lot(p_lot,p_owner,p_account,p_entries);
  if first_at is not null then
    update public.scalency_lot_entries e set scheduled_for=x.at,window_end=x.until,next_attempt=x.at
      from jsonb_to_recordset(p_entries) as x(id uuid,at timestamptz,until timestamptz)
      where e.lot_id=p_lot and e.draft_id=x.id;
  end if;
  update public.listing_drafts d set scheduled_at=e.scheduled_for
    from public.scalency_lot_entries e where e.lot_id=p_lot and d.id=e.draft_id;
  return p_lot;
end;
$$;
