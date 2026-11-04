begin;
-- Réglages des annonces, partagés par l'équipe : une ligne « default » pour tous les comptes,
-- puis une ligne par compte Vinted (identifiant du compte Dotb) pour ses exceptions
-- et son interrupteur « Publier via Dotb » (coupé tant qu'il n'est pas allumé).
create table public.listing_settings (
 scope text primary key check(scope='default' or scope ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 settings jsonb not null default '{}' check(jsonb_typeof(settings)='object' and pg_column_size(settings)<16000),
 version integer not null default 1 check(version > 0),
 updated_by uuid references public.profiles(id),
 updated_at timestamptz not null default now()
);
alter table public.listing_settings enable row level security;
revoke all on public.listing_settings from public,anon,authenticated;
grant all on public.listing_settings to service_role;
comment on table public.listing_settings is 'Listing presets. Administrator API validates every field; Dotb publishing also requires LISTING_DOTB_PUBLISH_ENABLED on the server.';

-- Heure prévue de publication par Dotb, pour espacer les annonces d'un même compte.
alter table public.listing_drafts add column planned_at timestamptz;
create index listing_drafts_account_planned on public.listing_drafts((fields->>'account_id'),planned_at desc) where state in ('preparing','scheduled');

-- Titres réellement vendus, pour que la rédaction reprenne le style qui fonctionne.
-- Calculé ici pour ne lire que quelques lignes, quelle que soit la taille de l'historique.
create function public.listing_title_examples(p_account text) returns jsonb language sql stable security invoker set search_path='' as $$
 with sold as (
  select l.source->>'title' as title,lower(o.account_id) as account_id,max(o.order_date) as at
  from public.sales_lines l join public.sales_orders o on o.id=l.order_id
  where char_length(l.source->>'title') between 20 and 100 and o.order_date > now()-interval '120 days'
  group by 1,2
 )
 select jsonb_build_object(
  'own',coalesce((select jsonb_agg(title order by at desc) from (select title,at from sold where account_id=lower(p_account) order by at desc limit 8) own),'[]'::jsonb),
  'others',coalesce((select jsonb_agg(title order by at desc) from (select title,max(at) as at from sold where account_id is distinct from lower(p_account) group by title order by 2 desc limit 8) others),'[]'::jsonb))
$$;
revoke all on function public.listing_title_examples(text) from public,anon,authenticated;
grant execute on function public.listing_title_examples(text) to service_role;

-- Une seule réservation à la fois par compte, tous utilisateurs et onglets confondus.
create function public.reserve_listing_slot(p_id uuid,p_owner uuid,p_version integer,p_payload jsonb,p_spacing integer)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare account text; last_at timestamptz; slot timestamptz;
begin
 if p_spacing is null or p_spacing<0 or p_spacing>720 then raise exception 'Invalid publication spacing';end if;
 select fields->>'account_id' into account from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='draft';
 if account is null then return;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('listing-publish:'||account,0));
 select max(greatest(planned_at,scheduled_at,published_at)) into last_at from public.listing_drafts
 where fields->>'account_id'=account and planned_at is not null and state in ('preparing','scheduled','published');
 slot:=case when p_spacing=0 then now() else greatest(now(),last_at+make_interval(mins=>p_spacing)) end;
 return query update public.listing_drafts set state='preparing',payload=p_payload,planned_at=slot,
  inflight=case when dotb_item_id is null then null else 'update' end,lease=null,lease_until=null,last_error=null,
  message='Préparation de l’envoi vers le compte choisi…',version=version+1,updated_at=now()
 where id=p_id and owner_id=p_owner and version=p_version and state='draft' returning *;
end $$;
revoke all on function public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer) from public,anon,authenticated;
grant execute on function public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer) to service_role;
commit;
