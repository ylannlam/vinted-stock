begin;
-- Envoi par Dotb : « en ligne directement » (comme avant) ou « en brouillon Vinted ».
-- Un brouillon créé sur Vinted n'est pas une publication : il a son propre état.
alter table public.listing_drafts add column dotb_publish boolean not null default true;
alter table public.listing_drafts drop constraint listing_drafts_state_check;
alter table public.listing_drafts add constraint listing_drafts_state_check check(state in ('draft','preparing','scheduled','published','attention','vinted_draft'));
-- Les brouillons Vinted créés par Dotb comptent aussi dans l'espacement des envois d'un compte.
-- Une seule réservation à la fois par compte, tous utilisateurs et onglets confondus.
create or replace function public.reserve_listing_slot(p_id uuid,p_owner uuid,p_version integer,p_payload jsonb,p_spacing integer)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare account text; last_at timestamptz; slot timestamptz;
begin
 if p_spacing is null or p_spacing<0 or p_spacing>720 then raise exception 'Invalid publication spacing';end if;
 select fields->>'account_id' into account from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='draft';
 if account is null then return;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('listing-publish:'||account,0));
 select max(greatest(planned_at,scheduled_at,published_at)) into last_at from public.listing_drafts
 where fields->>'account_id'=account and planned_at is not null and state in ('preparing','scheduled','published','vinted_draft');
 slot:=case when p_spacing=0 then now() else greatest(now(),last_at+make_interval(mins=>p_spacing)) end;
 return query update public.listing_drafts set state='preparing',payload=p_payload,planned_at=slot,
  inflight=case when dotb_item_id is null then null else 'update' end,lease=null,lease_until=null,last_error=null,
  message='Préparation de l’envoi vers le compte choisi…',version=version+1,updated_at=now()
 where id=p_id and owner_id=p_owner and version=p_version and state='draft' returning *;
end $$;
revoke all on function public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer) from public,anon,authenticated;
grant execute on function public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer) to service_role;
-- Onglet Alicia : un brouillon Vinted créé par Dotb puis publié à la main compte comme publication.
create or replace function public.team_board_counts(p_day date) returns jsonb language sql stable security invoker set search_path='' as $$
 with manual as materialized (
  select (d.fields->>'account_id')::uuid as account_id,d.vinted_id as item_id,d.published_at as at,d.owner_id,d.id,
   left(coalesce(d.fields->>'title',''),120) as title
  from public.listing_drafts d
  where d.state='published' and (d.dotb_item_id is null or not d.dotb_publish) and d.published_at is not null and d.vinted_id ~ '^\d{1,18}$'
   and d.fields->>'account_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 ), seen as (
  select account_id,item_id,estimated_at as at from public.publication_items where published and estimated_at is not null
  union all select account_id,item_id,at from manual
 ), dedup as (
  select account_id,item_id,min(at) as at from seen group by account_id,item_id
 ), stats as (
  select account_id,
   count(*) filter(where (at at time zone 'Europe/Paris')::date=p_day) as today,
   count(*) filter(where (at at time zone 'Europe/Paris')::date between p_day-6 and p_day) as week,
   max(at) as last_at
  from dedup group by account_id
 ), drafts as (
  select fields->>'account_id' as account_id,count(*) as drafts
  from public.listing_drafts where state='draft' and dotb_item_id is null and coalesce(fields->>'account_id','')<>'' group by 1
 ), ranked as (
  select m.*,row_number() over(partition by m.account_id order by m.at desc,m.id) as rn from manual m
 ), recent as (
  select account_id,jsonb_agg(jsonb_build_object('id',id,'title',title,'vinted_id',item_id,'published_at',at,'owner_id',owner_id) order by at desc,id) as items
  from ranked where rn<=5 group by account_id
 )
 select jsonb_build_object(
  'stats',coalesce((select jsonb_agg(to_jsonb(s)) from stats s),'[]'::jsonb),
  'drafts',coalesce((select jsonb_agg(to_jsonb(d)) from drafts d),'[]'::jsonb),
  'recent',coalesce((select jsonb_agg(to_jsonb(r)) from recent r),'[]'::jsonb))
$$;
commit;
