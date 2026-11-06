begin;
-- Onglet Publication : une fiche peut être programmée à une heure choisie (planning sur plusieurs jours).
-- Sans heure choisie, le comportement reste celui de l'envoi immédiat : à la suite des annonces du compte.
-- Avec une heure choisie, le créneau ne glisse que s'il touche une autre annonce du même compte (écart du
-- compte) ou le même SKU sur n'importe quel compte (30 minutes).
drop function public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer);
create function public.reserve_listing_slot(p_id uuid,p_owner uuid,p_version integer,p_payload jsonb,p_spacing integer,p_not_before timestamptz default null)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare account text; item_sku text; last_at timestamptz; sku_at timestamptz; slot timestamptz; hit timestamptz; turns integer:=0; note text;
begin
 if p_spacing is null or p_spacing<0 or p_spacing>720 then raise exception 'Invalid publication spacing';end if;
 if p_not_before is not null and p_not_before>now()+interval '32 days' then raise exception 'Invalid publication date';end if;
 select fields->>'account_id',lower(nullif(btrim(fields->>'sku'),'')) into account,item_sku from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='draft';
 if account is null then return;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('listing-publish:'||account,0));
 if item_sku is not null then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('listing-sku:'||item_sku,0));end if;
 if p_not_before is null then
  select max(greatest(planned_at,scheduled_at,published_at)) into last_at from public.listing_drafts
  where fields->>'account_id'=account and planned_at is not null and state in ('preparing','scheduled','published','vinted_draft');
  if item_sku is not null then
   select max(greatest(planned_at,scheduled_at,published_at)) into sku_at from public.listing_drafts
   where lower(btrim(fields->>'sku'))=item_sku and fields->>'account_id'<>account and id<>p_id
     and planned_at is not null and state in ('preparing','scheduled','published','vinted_draft');
  end if;
  slot:=greatest(now(),case when p_spacing=0 then now() else last_at+make_interval(mins=>p_spacing) end,sku_at+interval '30 minutes');
  note:=case when sku_at is not null and slot=sku_at+interval '30 minutes' and slot>now()+interval '1 minute'
   then 'Même SKU sur un autre compte : envoi décalé de 30 minutes après lui.' else 'Préparation de l’envoi vers le compte choisi…' end;
 else
  slot:=greatest(now(),p_not_before);
  loop
   turns:=turns+1;exit when turns>200;
   select max(t) into hit from (select greatest(planned_at,scheduled_at,published_at) t from public.listing_drafts
     where fields->>'account_id'=account and id<>p_id and planned_at is not null and state in ('preparing','scheduled','published','vinted_draft')) x
     where p_spacing>0 and t>slot-make_interval(mins=>p_spacing) and t<slot+make_interval(mins=>p_spacing);
   if hit is not null then slot:=hit+make_interval(mins=>p_spacing);continue;end if;
   if item_sku is not null then
    select max(t) into hit from (select greatest(planned_at,scheduled_at,published_at) t from public.listing_drafts
      where lower(btrim(fields->>'sku'))=item_sku and id<>p_id and planned_at is not null and state in ('preparing','scheduled','published','vinted_draft')) x
      where t>slot-interval '30 minutes' and t<slot+interval '30 minutes';
    if hit is not null then slot:=hit+interval '30 minutes';continue;end if;
   end if;
   exit;
  end loop;
  note:='Programmée pour le '||to_char(slot at time zone 'Europe/Paris','DD/MM à HH24:MI')||
   case when slot>greatest(now(),p_not_before)+interval '1 minute' then ' (décalée : une autre annonce du compte ou du même SKU était trop proche)' else '' end||'. Envoi à Dotb…';
 end if;
 return query update public.listing_drafts set state='preparing',payload=p_payload,planned_at=slot,
  inflight=case when dotb_item_id is null then null else 'update' end,lease=null,lease_until=null,last_error=null,
  message=note,version=version+1,updated_at=now()
 where id=p_id and owner_id=p_owner and version=p_version and state='draft' returning *;
end $$;
revoke all on function public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.reserve_listing_slot(uuid,uuid,integer,jsonb,integer,timestamptz) to service_role;

-- Dépenses IA : chaque rédaction d'annonce enregistre ses jetons ; le coût est calculé avec les tarifs ci-dessous.
create table public.ai_usage (
 id bigint generated always as identity primary key,
 created_at timestamptz not null default now(),
 feature text not null check (feature in ('listing_text')),
 model text not null check (length(model) between 1 and 100),
 input_tokens integer not null check (input_tokens between 0 and 10000000),
 output_tokens integer not null check (output_tokens between 0 and 10000000),
 listing_id uuid,
 account_id uuid,
 user_id uuid references public.profiles(id) on delete set null
);
create index ai_usage_created on public.ai_usage(created_at desc);
create table public.ai_prices (
 model text primary key check (length(model) between 1 and 100),
 input_per_million numeric(10,4) not null check (input_per_million>=0 and input_per_million<1000),
 output_per_million numeric(10,4) not null check (output_per_million>=0 and output_per_million<1000),
 updated_at timestamptz not null default now()
);
-- Tarifs publics de Google (en dollars, par million de jetons) relevés en novembre 2026 ; modifiables dans l'onglet.
insert into public.ai_prices(model,input_per_million,output_per_million) values
 ('gemini-3.5-flash-lite',0.30,2.50),('gemini-3.5-flash',1.50,9.00);
alter table public.ai_usage enable row level security;
alter table public.ai_prices enable row level security;
revoke all on public.ai_usage,public.ai_prices from public,anon,authenticated;
grant all on public.ai_usage,public.ai_prices to service_role;
commit;
