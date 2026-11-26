create function public.scalency_move_pending(p_owner uuid, p_account text, p_entries jsonb, p_end timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare
  today date := (now() at time zone 'Europe/Paris')::date;
  target_day date := (p_end at time zone 'Europe/Paris')::date;
  n integer := jsonb_array_length(p_entries);
  matched integer := 0;
  incoming integer := 0;
  row_data record;
begin
  if n is null or n not between 1 and 100 or target_day is null or target_day not between today and today+30
    or (select count(distinct x.id) from jsonb_to_recordset(p_entries) as x(id uuid)) <> n
    or exists (select from jsonb_to_recordset(p_entries) as x(at timestamptz)
      where x.at is null or x.at <= now() or x.at >= p_end or (x.at at time zone 'Europe/Paris')::date <> target_day)
  then raise exception 'lot_window'; end if;

  perform pg_advisory_xact_lock(hashtextextended('cadence:' || p_account, 0));
  for row_data in
    select d.scheduled_at from jsonb_to_recordset(p_entries) as x(id uuid,version integer,previous timestamptz)
    join public.listing_drafts d on d.id=x.id and d.version=x.version
    join public.scalency_lot_entries e on e.draft_id=d.id and e.reviewed_version=d.version-1
    join public.scalency_publication_lots l on l.id=e.lot_id
    where d.owner_id=p_owner and l.owner_id=p_owner and l.account=p_account and d.fields->>'account_id'=p_account
      and d.state='preparing' and d.payload->>'scalency_job_id' is null and e.status='pending' and e.job_id is null
      and e.scheduled_for is not distinct from x.previous
    order by e.id for update of e,d
  loop
    matched := matched+1;
    if greatest(today, (row_data.scheduled_at at time zone 'Europe/Paris')::date) <> target_day then incoming := incoming+1; end if;
  end loop;
  if matched <> n then raise exception 'lot_changed'; end if;
  perform public.scalency_check_capacity(p_account, incoming, target_day);

  update public.scalency_lot_entries e set scheduled_for=x.at, next_attempt=x.at, window_end=p_end, message=null
    from jsonb_to_recordset(p_entries) as x(id uuid,version integer,at timestamptz)
    where e.draft_id=x.id and e.reviewed_version=x.version-1;
  update public.listing_drafts d set scheduled_at=x.at, updated_at=now()
    from jsonb_to_recordset(p_entries) as x(id uuid,at timestamptz) where d.id=x.id;
end;
$$;
revoke all on function public.scalency_move_pending(uuid,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.scalency_move_pending(uuid,text,jsonb,timestamptz) to service_role;
