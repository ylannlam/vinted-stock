begin;
create or replace function public.publication_save_directory(p_lease uuid,p_accounts jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.publication_gate where id and directory_lease=p_lease for update;
 if not found then raise exception 'stale_directory'; end if;
 if jsonb_typeof(p_accounts) is distinct from 'array' then raise exception 'invalid_directory'; end if;
 -- Only accounts missing from the successful source response become unavailable.
 -- The Data API loads safeupdate, which rejects the previous unfiltered UPDATE.
 update public.publication_accounts a set source_present=false,bridge_connected=false
 where (a.source_present or a.bridge_connected)
 and not exists (select 1 from jsonb_to_recordset(p_accounts) x(id uuid) where x.id=a.id);
 insert into public.publication_accounts(id,login,vinted_id,bridge_connected,directory_checked_at)
 select x.id,x.login,x.vinted_id,x.bridge_connected,now()
 from jsonb_to_recordset(p_accounts) x(id uuid,login text,vinted_id text,bridge_connected boolean)
 on conflict(id) do update set login=excluded.login,vinted_id=excluded.vinted_id,bridge_connected=excluded.bridge_connected,directory_checked_at=now(),source_present=true;
 update public.publication_gate set directory_lease=null,directory_until=null,directory_checked_at=now() where id;
end $$;
commit;
