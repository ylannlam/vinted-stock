-- The published Vinted ID survives sales, removals and duplicate confirmations.
create function public.scalency_publications_on_day(p_day date)
returns jsonb language sql stable security invoker set search_path='' as $$
with receipts as (
  select account, payload->>'new_item_id' as listing, payload->>'type' = 'relist' as repost,
    nullif(payload->>'done_at','')::timestamptz as confirmed_at,
    nullif(payload->>'updated_at','')::timestamptz as fallback_at, 0 as priority
  from public.scalency_records
  where kind='jobs' and payload->>'type' in ('publish','relist') and payload->>'status'='done'
    and nullif(payload->>'new_item_id','') is not null
  union all
  select d.fields->>'account_id', d.vinted_id, false, d.published_at, null::timestamptz, 1
  from public.listing_drafts d
  where d.published_at is not null and nullif(d.vinted_id,'') is not null
), listings as (
  select listing, (array_agg(account order by priority, account) filter(where nullif(account,'') is not null))[1] as account,
    bool_or(repost) as repost, coalesce(min(confirmed_at),min(fallback_at)) as published_at,
    min(confirmed_at) is null as estimated
  from receipts group by listing
), by_account as (
  select l.account, coalesce(a.payload->>'login',l.account,'Compte non renseigné') as login,
    count(*) as total, count(*) filter(where repost) as reposts, count(*) filter(where estimated) as estimated
  from listings l left join public.scalency_records a on a.kind='accounts' and a.remote_id=l.account
  where l.published_at >= (p_day::timestamp at time zone 'Europe/Paris')
    and l.published_at < ((p_day+1)::timestamp at time zone 'Europe/Paris')
  group by l.account, a.payload->>'login'
)
select jsonb_build_object('day',p_day,'total',coalesce(sum(total),0),'reposts',coalesce(sum(reposts),0),
  'estimated',coalesce(sum(estimated),0),'accounts',coalesce(jsonb_agg(to_jsonb(by_account) order by total desc,login),'[]'::jsonb))
from by_account;
$$;
revoke all on function public.scalency_publications_on_day(date) from public,anon,authenticated;
grant execute on function public.scalency_publications_on_day(date) to service_role;

-- Only an invalidation is broadcast. Counts are read through the existing admin API.
create policy "admins receive publication counter updates" on realtime.messages for select to authenticated
using (extension='broadcast' and (select realtime.topic())='stock-vinted:publications'
  and exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin'));

create function public.notify_scalency_publication_counter()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform realtime.send('{}'::jsonb,'changed','stock-vinted:publications',true);
  return null;
end $$;
revoke all on function public.notify_scalency_publication_counter() from public,anon,authenticated;

create trigger publication_counter_job_insert after insert on public.scalency_records for each row
when (new.kind='jobs' and new.payload->>'type' in ('publish','relist') and new.payload->>'status'='done' and nullif(new.payload->>'new_item_id','') is not null)
execute function public.notify_scalency_publication_counter();
create trigger publication_counter_job_update after update of payload on public.scalency_records for each row
when (new.kind='jobs' and (new.payload->>'type' in ('publish','relist') or old.payload->>'type' in ('publish','relist'))
  and (new.payload->>'status'='done' or old.payload->>'status'='done')
  and row(new.payload->>'status',new.payload->>'type',new.payload->>'new_item_id',new.payload->>'done_at',new.payload->>'updated_at')
      is distinct from row(old.payload->>'status',old.payload->>'type',old.payload->>'new_item_id',old.payload->>'done_at',old.payload->>'updated_at'))
execute function public.notify_scalency_publication_counter();

create trigger publication_counter_draft_insert after insert on public.listing_drafts for each row
when (new.published_at is not null and nullif(new.vinted_id,'') is not null)
execute function public.notify_scalency_publication_counter();
create trigger publication_counter_draft_update after update of published_at,vinted_id,fields on public.listing_drafts for each row
when ((new.published_at is not null or old.published_at is not null) and
  row(new.published_at,new.vinted_id,new.fields->>'account_id') is distinct from row(old.published_at,old.vinted_id,old.fields->>'account_id'))
execute function public.notify_scalency_publication_counter();
