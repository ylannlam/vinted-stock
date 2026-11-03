begin;
create or replace function public.publication_save_page(p_account uuid,p_lease uuid,p_items jsonb,p_total_pages integer) returns void language plpgsql security invoker set search_path='' as $$
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
 next_scan_at=now()+case when a.scan_page>=p_total_pages then interval '1 hour' else interval '10 seconds' end
 where id=p_account;
end $$;

-- Move completed, healthy scans to the new cadence; retain partial scans and retries.
update public.publication_accounts set next_scan_at=last_complete_at+interval '1 hour'
where scan_page=1 and last_error is null and last_complete_at is not null
and next_scan_at<last_complete_at+interval '1 hour';
commit;
