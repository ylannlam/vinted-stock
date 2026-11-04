begin;
-- Also protects against two requests recording the same item at the same time.
create unique index listing_drafts_vinted_unique on public.listing_drafts(vinted_id) where vinted_id is not null;
-- Onglet « Alicia » : compteurs par compte Vinted (compte Dotb), calculés dans PostgreSQL
-- pour que la limite de lignes de l'API ne puisse rien omettre.
-- Une annonce compte une seule fois, qu'elle vienne d'un relevé (publication_items) ou
-- d'un lien Vinted collé à la main sur une fiche (listing_drafts publiée sans Dotb).
create function public.team_board_counts(p_day date) returns jsonb language sql stable security invoker set search_path='' as $$
 with manual as materialized (
  select (d.fields->>'account_id')::uuid as account_id,d.vinted_id as item_id,d.published_at as at,d.owner_id,d.id,
   left(coalesce(d.fields->>'title',''),120) as title
  from public.listing_drafts d
  where d.state='published' and d.dotb_item_id is null and d.published_at is not null and d.vinted_id ~ '^\d{1,18}$'
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
revoke all on function public.team_board_counts(date) from public,anon,authenticated;
grant execute on function public.team_board_counts(date) to service_role;
commit;
