begin;
-- All access goes through the existing administrator API; the browser has no direct grants.
create table public.publication_accounts (
 id uuid primary key, login text not null, vinted_id text, source_present boolean not null default true,
 bridge_connected boolean not null default false, directory_checked_at timestamptz,
 last_checked_at timestamptz, last_complete_at timestamptz, next_scan_at timestamptz,
 scan_page integer not null default 1, total_pages integer, cycle_started_at timestamptz,
 lease uuid, lease_until timestamptz, last_error text
);
create table public.publication_items (
 account_id uuid not null references public.publication_accounts(id), item_id text not null,
 title text not null, photo_url text, url text not null, price text, currency text,
 status text not null check(status in ('active','reserved','sold','hidden','draft','verification','processing')),
 estimated_at timestamptz, published boolean not null default false,
 first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
 present boolean not null default true, primary key(account_id,item_id)
);
create index publication_items_date on public.publication_items(account_id,estimated_at desc,item_id) where published;
create table public.publication_profile_links (
 owner_id uuid not null references public.profiles(id), profile_id text not null check(length(profile_id) between 1 and 100),
 account_id uuid not null references public.publication_accounts(id), primary key(owner_id,profile_id)
);
create table public.publication_gate (
 id boolean primary key default true check(id), directory_lease uuid, directory_until timestamptz,
 directory_checked_at timestamptz, scan_after timestamptz
);
insert into public.publication_gate(id) values(true);
alter table public.publication_accounts enable row level security;
alter table public.publication_items enable row level security;
alter table public.publication_profile_links enable row level security;
alter table public.publication_gate enable row level security;
revoke all on public.publication_accounts,public.publication_items,public.publication_profile_links,public.publication_gate from public,anon,authenticated;
grant all on public.publication_accounts,public.publication_items,public.publication_profile_links,public.publication_gate to service_role;

create function public.publication_claim_directory(p_lease uuid) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.publication_gate set directory_lease=p_lease,directory_until=now()+interval '40 seconds'
 where id and coalesce(directory_until,'epoch'::timestamptz)<=now()
 and coalesce(directory_checked_at,'epoch'::timestamptz)<=now()-interval '60 seconds';
 return found;
end $$;
create function public.publication_save_directory(p_lease uuid,p_accounts jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.publication_gate where id and directory_lease=p_lease for update;
 if not found then raise exception 'stale_directory'; end if;
 update public.publication_accounts set source_present=false,bridge_connected=false;
 insert into public.publication_accounts(id,login,vinted_id,bridge_connected,directory_checked_at)
 select x.id,x.login,x.vinted_id,x.bridge_connected,now()
 from jsonb_to_recordset(p_accounts) x(id uuid,login text,vinted_id text,bridge_connected boolean)
 on conflict(id) do update set login=excluded.login,vinted_id=excluded.vinted_id,bridge_connected=excluded.bridge_connected,directory_checked_at=now(),source_present=true;
 update public.publication_gate set directory_lease=null,directory_until=null,directory_checked_at=now() where id;
end $$;
create function public.publication_fail_directory(p_lease uuid) returns void language sql security invoker set search_path='' as $$
 update public.publication_gate set directory_lease=null,directory_until=now()+interval '60 seconds' where id and directory_lease=p_lease;
$$;

create function public.publication_claim_scan(p_account uuid,p_lease uuid,p_force boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.publication_accounts; g public.publication_gate;
begin
 select * into g from public.publication_gate where id for update;
 if coalesce(g.scan_after,'epoch'::timestamptz)>now() then return null; end if;
 select * into a from public.publication_accounts where id=p_account for update;
 if not found or not a.source_present then return null; end if;
 if coalesce(a.lease_until,'epoch'::timestamptz)>now() then return null; end if;
 if not p_force and coalesce(a.next_scan_at,'epoch'::timestamptz)>now() then return null; end if;
 if p_force and coalesce(a.last_checked_at,'epoch'::timestamptz)>now()-interval '30 seconds' then return null; end if;
 -- A paused multi-page scan resumes; the original cycle timestamp is retained.
 update public.publication_accounts set lease=p_lease,lease_until=now()+interval '40 seconds',
 cycle_started_at=case when scan_page=1 then now() else cycle_started_at end where id=p_account;
 update public.publication_gate set scan_after=now()+interval '10 seconds' where id;
 return jsonb_build_object('page',a.scan_page);
end $$;

create function public.publication_save_page(p_account uuid,p_lease uuid,p_items jsonb,p_total_pages integer) returns void language plpgsql security invoker set search_path='' as $$
declare a public.publication_accounts;
begin
 select * into a from public.publication_accounts where id=p_account and lease=p_lease for update;
 if not found then raise exception 'stale_scan'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>100 then raise exception 'invalid_items'; end if;
 insert into public.publication_items(account_id,item_id,title,status,estimated_at,photo_url,url,price,currency,published,last_seen_at,present)
 select p_account,x.item_id,x.title,x.status,x.estimated_at,x.photo_url,x.url,x.price,x.currency,x.published,now(),true
 from jsonb_to_recordset(p_items) x(item_id text,title text,status text,estimated_at timestamptz,photo_url text,url text,price text,currency text,published boolean)
 on conflict(account_id,item_id) do update set title=excluded.title,status=excluded.status,
 estimated_at=coalesce(public.publication_items.estimated_at,excluded.estimated_at),
 photo_url=coalesce(excluded.photo_url,public.publication_items.photo_url),url=excluded.url,price=excluded.price,currency=excluded.currency,
 published=public.publication_items.published or excluded.published,last_seen_at=now(),present=true;
 if a.scan_page>=p_total_pages then
   -- Absence never deletes publication history and is only recorded after a complete scan.
   update public.publication_items set present=false where account_id=p_account and last_seen_at<a.cycle_started_at;
 end if;
 update public.publication_accounts set last_checked_at=now(),last_error=null,lease=null,lease_until=null,
 bridge_connected=true,total_pages=p_total_pages,
 last_complete_at=case when a.scan_page>=p_total_pages then now() else last_complete_at end,
 scan_page=case when a.scan_page>=p_total_pages then 1 else a.scan_page+1 end,
 next_scan_at=now()+case when a.scan_page>=p_total_pages then interval '5 minutes' else interval '10 seconds' end
 where id=p_account;
end $$;
create function public.publication_fail_scan(p_account uuid,p_lease uuid,p_message text,p_retry integer default 60) returns void language sql security invoker set search_path='' as $$
 update public.publication_accounts set lease=null,lease_until=null,last_error=left(p_message,500),
 next_scan_at=now()+make_interval(secs=>greatest(60,least(p_retry,3600))) where id=p_account and lease=p_lease;
$$;

create function public.publication_snapshot(p_owner uuid,p_day date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('date',p_day,'timezone','Europe/Paris','accounts',coalesce((
 select jsonb_agg(to_jsonb(s) order by s.login) from (
   select a.id,a.login,a.source_present,a.bridge_connected,a.directory_checked_at,a.last_checked_at,a.last_complete_at,
   a.next_scan_at,a.scan_page,a.total_pages,a.last_error,
   count(i.item_id) filter(where i.published and (i.estimated_at at time zone 'Europe/Paris')::date=p_day) as day_count,
   count(i.item_id) filter(where i.published and (i.estimated_at at time zone 'Europe/Paris')::date=p_day-1) as yesterday_count,
   count(i.item_id) filter(where i.published and (i.estimated_at at time zone 'Europe/Paris')::date between p_day-6 and p_day) as week_count,
   count(i.item_id) filter(where i.published and i.estimated_at is null) as undated_count,
   count(i.item_id) filter(where i.published) as history_count,
   count(i.item_id) filter(where i.present and i.status='active') as active_count,
   max(i.estimated_at) filter(where i.published) as latest_at
   from public.publication_accounts a left join public.publication_items i on i.account_id=a.id group by a.id
 ) s),'[]'::jsonb),'links',coalesce((select jsonb_agg(jsonb_build_object('profile_id',profile_id,'account_id',account_id)) from public.publication_profile_links where owner_id=p_owner),'[]'::jsonb),
 'directory_checked_at',(select directory_checked_at from public.publication_gate where id));
$$;
create function public.publication_details(p_account uuid,p_day text default 'all',p_offset integer default 0) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_offset<0 or p_offset>100000 then raise exception 'invalid_page'; end if;
 with filtered as materialized (
 select item_id,title,photo_url,url,price,currency,status,estimated_at,first_seen_at,last_seen_at,present
 from public.publication_items where account_id=p_account and published
 and case when p_day='all' then true when p_day='undated' then estimated_at is null else (estimated_at at time zone 'Europe/Paris')::date=p_day::date end
 ), paged as (select * from filtered order by estimated_at desc nulls last,item_id desc offset p_offset limit 40)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb),
 'count',(select count(*) from filtered),'page_size',40) into result;
 return result;
end $$;

revoke all on function public.publication_claim_directory(uuid),public.publication_save_directory(uuid,jsonb),public.publication_fail_directory(uuid),
public.publication_claim_scan(uuid,uuid,boolean),public.publication_save_page(uuid,uuid,jsonb,integer),public.publication_fail_scan(uuid,uuid,text,integer),
public.publication_snapshot(uuid,date),public.publication_details(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.publication_claim_directory(uuid),public.publication_save_directory(uuid,jsonb),public.publication_fail_directory(uuid),
public.publication_claim_scan(uuid,uuid,boolean),public.publication_save_page(uuid,uuid,jsonb,integer),public.publication_fail_scan(uuid,uuid,text,integer),
public.publication_snapshot(uuid,date),public.publication_details(uuid,text,integer) to service_role;
commit;
