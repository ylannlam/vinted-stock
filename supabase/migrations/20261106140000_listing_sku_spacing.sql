begin;
-- Jamais le même SKU sur deux comptes différents à moins de 30 minutes d'écart : le créneau d'une
-- annonce respecte l'écart du compte ET passe 30 minutes après toute autre annonce du même SKU
-- (prévue, programmée ou publiée) sur un autre compte.
create or replace function public.reserve_listing_slot(p_id uuid,p_owner uuid,p_version integer,p_payload jsonb,p_spacing integer)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare account text; item_sku text; last_at timestamptz; sku_at timestamptz; slot timestamptz;
begin
 if p_spacing is null or p_spacing<0 or p_spacing>720 then raise exception 'Invalid publication spacing';end if;
 select fields->>'account_id',lower(nullif(btrim(fields->>'sku'),'')) into account,item_sku from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='draft';
 if account is null then return;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('listing-publish:'||account,0));
 if item_sku is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('listing-sku:'||item_sku,0));end if;
 select max(greatest(planned_at,scheduled_at,published_at)) into last_at from public.listing_drafts
 where fields->>'account_id'=account and planned_at is not null and state in ('preparing','scheduled','published','vinted_draft');
 if item_sku is not null then
  select max(greatest(planned_at,scheduled_at,published_at)) into sku_at from public.listing_drafts
  where lower(btrim(fields->>'sku'))=item_sku and fields->>'account_id'<>account and id<>p_id
    and planned_at is not null and state in ('preparing','scheduled','published','vinted_draft');
 end if;
 slot:=greatest(now(),case when p_spacing=0 then now() else last_at+make_interval(mins=>p_spacing) end,sku_at+interval '30 minutes');
 return query update public.listing_drafts set state='preparing',payload=p_payload,planned_at=slot,
  inflight=case when dotb_item_id is null then null else 'update' end,lease=null,lease_until=null,last_error=null,
  message=case when sku_at is not null and slot=sku_at+interval '30 minutes' and slot>now()+interval '1 minute'
   then 'Même SKU sur un autre compte : envoi décalé de 30 minutes après lui.' else 'Préparation de l’envoi vers le compte choisi…' end,
  version=version+1,updated_at=now()
 where id=p_id and owner_id=p_owner and version=p_version and state='draft' returning *;
end $$;
commit;
