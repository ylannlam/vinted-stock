create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Wake only confirmed work. The callback credential is single-use, bound to one entry,
-- and cannot authorize a different account, SKU or publication.
create function public.scalency_dispatch_lot_entry() returns void
language plpgsql security invoker set search_path='' as $$
declare
  entry public.scalency_lot_entries%rowtype;
  ticket uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('scalency-lot-dispatch',0)) then return; end if;
  for entry in select * from public.scalency_lot_entries where status='sending' and lease_until<now() for update skip locked loop
    perform public.scalency_finish_lot_entry(entry.id,entry.token,'uncertain',
      'Réponse de publication inconnue. Vérifie la file Scalency avant de renvoyer cette annonce.');
  end loop;
  if exists(select from public.scalency_lot_entries where status in ('dispatched','working','sending') and lease_until>=now()) then return; end if;
  select e.* into entry from public.scalency_lot_entries e join public.scalency_publication_lots l on l.id=e.lot_id
    where (e.status='pending' and e.next_attempt<=now()) or (e.status in ('working','dispatched') and e.lease_until<now())
    order by l.created_at,e.position for update of e skip locked limit 1;
  if not found then return; end if;
  ticket:=gen_random_uuid();
  update public.scalency_lot_entries set token=ticket,status='dispatched',lease_until=now()+interval '150 seconds' where id=entry.id;
  perform net.http_post(
    url:='https://vinted-stock.vercel.app/api/sales?scope=scalency-lot-worker',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:=jsonb_build_object('id',entry.id,'ticket',ticket),timeout_milliseconds:=115000);
end;
$$;
revoke all on function public.scalency_dispatch_lot_entry() from public,anon,authenticated,service_role;
select cron.schedule('stock-vinted-scalency-publication-lots','20 seconds','select public.scalency_dispatch_lot_entry()');
