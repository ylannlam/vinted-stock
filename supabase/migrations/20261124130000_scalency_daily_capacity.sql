create table public.scalency_account_cadence (
  account text primary key,
  mode text not null check (mode in ('starter','normal')),
  starter_limit integer not null check (starter_limit >= 0),
  normal_limit integer not null check (normal_limit >= 0)
);
alter table public.scalency_account_cadence enable row level security;
revoke all on public.scalency_account_cadence from public, anon, authenticated;
grant select,insert,update on public.scalency_account_cadence to service_role;

-- The provider job supersedes its local receipt. Until a receipt exists, the draft
-- represents the reservation, including an ambiguous transmission.
create function public.scalency_daily_capacity(p_account text, p_day date default (now() at time zone 'Europe/Paris')::date)
returns jsonb language sql stable security invoker set search_path='' as $$
with jobs as (
  select remote_id,payload->>'status' as status,
    case when payload->>'status'='done' and nullif(payload->>'new_item_id','') is not null
      then coalesce(nullif(payload->>'done_at',''),nullif(payload->>'updated_at',''))::timestamptz end as published,
    nullif(payload->>'not_before','')::timestamptz as due
  from public.scalency_records where kind='jobs' and account=p_account and payload->>'type'='publish'
), activity as (
  select published, due, status not in ('failed','cancelled','skipped') and published is null as pending from jobs
  union all
  select d.published_at,d.scheduled_at,d.published_at is null
  from public.listing_drafts d
  where d.fields->>'account_id'=p_account and (d.state in ('preparing','scheduled','published') or
    (d.state='attention' and (d.payload->>'cadence_reserved'='true' or d.message like 'Vérifie la file Scalency%' or exists (
      select from public.scalency_lot_entries e where e.draft_id=d.id and e.status='uncertain'))))
    and not exists(select from jobs j where j.remote_id=d.payload->>'scalency_job_id')
), stats as (
  select min((published at time zone 'Europe/Paris')::date) as first_day,
    count(*) filter(where (published at time zone 'Europe/Paris')::date=p_day) as posted,
    count(*) filter(where pending and greatest(coalesce((due at time zone 'Europe/Paris')::date,(now() at time zone 'Europe/Paris')::date),
      (now() at time zone 'Europe/Paris')::date)=p_day) as reserved from activity
), settings as (
  select coalesce(c.mode,'starter') as mode,coalesce(c.starter_limit,4) as starter_limit,
         coalesce(c.normal_limit,10) as normal_limit from (values(1)) dummy(n)
    left join public.scalency_account_cadence c on c.account=p_account
), report as (
  select settings.*,stats.*,case when mode='starter' then starter_limit else normal_limit end as day_limit
  from settings cross join stats
)
select to_jsonb(report)||jsonb_build_object('day',p_day,'starter_day',case when first_day is not null then greatest(1,p_day-first_day+1) end,
  'remaining',greatest(0,day_limit-posted-reserved)) from report;
$$;

-- Preserve normal cadence for already established accounts at rollout only.
insert into public.scalency_account_cadence(account,mode,starter_limit,normal_limit)
select remote_id,'normal',4,10 from public.scalency_records a where kind='accounts' and payload->>'linked'='true'
  and (public.scalency_daily_capacity(a.remote_id)->>'starter_day')::integer > 3;

create function public.scalency_set_cadence(p_account text,p_mode text,p_starter integer,p_normal integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cadence:'||p_account,0));
  if not exists(select from public.scalency_records where kind='accounts' and remote_id=p_account and payload->>'linked'='true') then
    raise exception 'cadence_unlinked'; end if;
  insert into public.scalency_account_cadence values(p_account,p_mode,p_starter,p_normal)
  on conflict(account) do update set mode=excluded.mode,starter_limit=excluded.starter_limit,normal_limit=excluded.normal_limit;
  return public.scalency_daily_capacity(p_account);
end; $$;

create function public.scalency_check_capacity(p_account text,p_count integer,p_day date)
returns void language plpgsql security invoker set search_path='' as $$
declare free integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('cadence:'||p_account,0));
  free:=(public.scalency_daily_capacity(p_account,p_day)->>'remaining')::integer;
  if p_count>free then raise exception 'daily_capacity' using detail=free::text; end if;
end; $$;

create function public.scalency_accept_limited_lot(p_lot text,p_owner uuid,p_account text,p_entries jsonb)
returns text language plpgsql security invoker set search_path='' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cadence:'||p_account,0));
  if not exists(select from public.scalency_publication_lots where id=p_lot and owner_id=p_owner and account=p_account) then
    perform public.scalency_check_capacity(p_account,jsonb_array_length(p_entries),(now() at time zone 'Europe/Paris')::date);
  end if;
  return public.scalency_accept_lot(p_lot,p_owner,p_account,p_entries);
end; $$;

create function public.scalency_reserve_single(p_account text,p_owner uuid,p_draft uuid,p_version integer,p_fields jsonb,p_due timestamptz)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  perform public.scalency_check_capacity(p_account,1,(coalesce(p_due,now()) at time zone 'Europe/Paris')::date);
  update public.listing_drafts set state='preparing',fields=p_fields,scheduled_at=p_due,
    payload=coalesce(payload,'{}'::jsonb)||'{"cadence_reserved":true}'::jsonb,message='Transmission à Scalency'
    where id=p_draft and owner_id=p_owner and state='draft' and version=p_version and fields->>'account_id'=p_account;
  return found;
end; $$;
revoke all on function public.scalency_daily_capacity(text,date),public.scalency_set_cadence(text,text,integer,integer),
  public.scalency_check_capacity(text,integer,date),public.scalency_accept_limited_lot(text,uuid,text,jsonb),
  public.scalency_reserve_single(text,uuid,uuid,integer,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.scalency_daily_capacity(text,date),public.scalency_set_cadence(text,text,integer,integer),
  public.scalency_check_capacity(text,integer,date),public.scalency_accept_limited_lot(text,uuid,text,jsonb),
  public.scalency_reserve_single(text,uuid,uuid,integer,jsonb,timestamptz) to service_role;
