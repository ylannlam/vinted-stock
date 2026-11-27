-- Check every affected Paris day under the same account lock before accepting a lot.
create or replace function public.scalency_accept_limited_lot(p_lot text,p_owner uuid,p_account text,p_entries jsonb)
returns text language plpgsql security invoker set search_path='' as $$
declare
  first_at timestamptz := (p_entries->0->>'at')::timestamptz;
  today date := (now() at time zone 'Europe/Paris')::date;
  slice record;
begin
  perform pg_advisory_xact_lock(hashtextextended('cadence:'||p_account,0));
  if exists(select from public.scalency_publication_lots where id=p_lot and owner_id=p_owner and account=p_account) then
    return public.scalency_accept_lot(p_lot,p_owner,p_account,p_entries);
  end if;
  if exists (
    select from jsonb_to_recordset(p_entries) as x(at timestamptz,until timestamptz)
    where (x.at is null)<>(first_at is null) or (x.at is null)<>(x.until is null)
      or x.at<=now() or x.at>=x.until
      or (x.until at time zone 'Europe/Paris')::date<>(x.at at time zone 'Europe/Paris')::date
      or (x.at at time zone 'Europe/Paris')::date>today+30
  ) then raise exception 'lot_window'; end if;
  for slice in
    select coalesce((x.at at time zone 'Europe/Paris')::date,today) as day,
      count(*)::integer as quantity, count(distinct x.until) as endings
    from jsonb_to_recordset(p_entries) as x(at timestamptz,until timestamptz)
    group by 1 order by 1
  loop
    if slice.endings>1 then raise exception 'lot_window'; end if;
    perform public.scalency_check_capacity(p_account,slice.quantity,slice.day);
  end loop;
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

create function public.scalency_publication_planning(p_owner uuid,p_day date,p_filter text,p_account text,p_page integer)
returns jsonb language sql stable security invoker set search_path='' as $$
with accounts as (
  select remote_id as account,payload->>'login' as login
  from public.scalency_records where kind='accounts' and payload->>'linked'='true'
    and (p_account is null or remote_id=p_account)
), local_entries as (
  select l.account,l.id as lot,l.created_at,e.id,e.title,e.sku,e.scheduled_for,e.status,e.job_id,e.draft_id
  from public.scalency_publication_lots l join accounts using(account)
  join public.scalency_lot_entries e on e.lot_id=l.id where l.owner_id=p_owner
), jobs as (
  select r.account,r.remote_id,r.payload as j from public.scalency_records r join accounts using(account)
  where r.kind='jobs' and r.payload->>'type'='publish'
), events as (
  select coalesce(l.account,j.account) as account,l.lot,coalesce(l.id::text,'job-'||j.remote_id) as id,
    coalesce(l.title,j.j->>'title') as title,coalesce(l.sku,j.j#>>'{refs,sku}') as sku,
    coalesce(l.created_at,nullif(j.j->>'created_at','')::timestamptz) as added,
    coalesce(nullif(j.j->>'not_before','')::timestamptz,l.scheduled_for) as due,
    coalesce(j.remote_id,l.job_id) as job_id,l.status as local_status,
    j.j->>'status' as job_status,j.j->>'new_item_id' as item_id
  from local_entries l full join jobs j on j.account=l.account and j.remote_id=l.job_id
), ready as (
  select d.fields->>'account_id' as account,count(*) as n from public.listing_drafts d
  join accounts a on a.account=d.fields->>'account_id'
  where d.owner_id=p_owner and d.state='draft' and d.payload#>>'{batch,status}'='ready'
    and d.payload->>'scalency_job_id' is null and d.published_at is null and d.vinted_id is null
    and d.publication_task_id is null and d.inflight is null and d.dotb_item_id is null
  group by 1
), queued as (
  select account,count(*) as n from events
  where job_status in ('queued','pending','waiting','scheduled','planned','running','sent','retry')
     or (job_status is null and local_status='queued' and job_id is not null)
  group by account
), published as (
  select summary.account,summary.total
  from jsonb_to_recordset(public.scalency_publications_on_day(p_day)->'accounts') summary(account text,total integer)
), cards as (
  select a.*,coalesce(p.total,0) as posted,coalesce(r.n,0) as ready,coalesce(q.n,0) as queued,
    public.scalency_daily_capacity(a.account,p_day) as capacity
  from accounts a left join ready r using(account) left join queued q using(account) left join published p using(account)
), dated as (
  select e.*,case when p_filter='added' then added else due end as event_time from events e
), matching as (
  select * from dated where event_time >= (p_day::timestamp at time zone 'Europe/Paris')
    and event_time < ((p_day+1)::timestamp at time zone 'Europe/Paris')
), page as (
  select * from matching order by event_time,account,id limit 40 offset greatest(p_page,0)*40
)
select jsonb_build_object(
  'accounts',coalesce((select jsonb_agg(to_jsonb(cards) order by ready desc,login,account) from cards),'[]'::jsonb),
  'rows',coalesce((select jsonb_agg(to_jsonb(page) order by event_time,account,id) from page),'[]'::jsonb),
  'total',(select count(*) from matching),'pageSize',40)
$$;
revoke all on function public.scalency_publication_planning(uuid,date,text,text,integer) from public,anon,authenticated;
grant execute on function public.scalency_publication_planning(uuid,date,text,text,integer) to service_role;
