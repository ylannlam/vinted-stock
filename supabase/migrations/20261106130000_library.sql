begin;
-- Bibliothèque : les articles vendus, les articles postés sur Dotb (pas encore vendus) et ceux
-- ajoutés à la main par SKU ou lien Shein. Tout passe par l'API administrateur (service_role).

-- 1. Références ajoutées à la main (« Coller des SKU / liens ») ou depuis la création d'annonce.
create table public.catalog_library (
 id uuid primary key default gen_random_uuid(),
 sku text check (sku ~ '^[A-Za-z0-9_-]{1,200}$'),
 supplier_id text check (supplier_id ~ '^[0-9]{1,20}$'),
 input text not null check (length(input) between 1 and 2000),
 source text not null default 'manual' check (source in ('manual','listing')),
 added_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now(),
 check (sku is not null or supplier_id is not null)
);
create unique index catalog_library_sku on public.catalog_library(lower(sku)) where sku is not null;
create unique index catalog_library_supplier on public.catalog_library(supplier_id) where supplier_id is not null;

-- 2. Catégorie et prix de vente choisis pour un produit (sinon : catégorie devinée, prix de la grille).
create table public.catalog_product_meta (
 product_id uuid primary key references public.catalog_products(id) on delete cascade,
 category text check (category in ('robe','jupe','top','chemise','pull','veste','pantalon','jean','short','combinaison','ensemble','body','maillot','autre')),
 sale_price numeric(10,2) check (sale_price > 0 and sale_price < 100000),
 updated_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default now()
);

-- 3. Grille tarifaire : prix de vente conseillé selon le prix Shein.
create table public.catalog_settings (
 id boolean primary key default true check (id),
 pricing jsonb not null default '{"tiers":[],"above":null}' check (jsonb_typeof(pricing)='object' and pg_column_size(pricing)<8000),
 updated_by uuid references public.profiles(id) on delete set null,
 updated_at timestamptz not null default now()
);
insert into public.catalog_settings(id) values(true);

-- 4. Articles Dotb (avec SKU) : « présent » = vu au dernier relevé complet.
alter table public.catalog_dotb_items add column present boolean not null default true;
alter table public.catalog_sync_state add column cycle_started_at timestamptz;
update public.catalog_sync_state set cursor=null,lease=null,locked_until='-infinity' where id;

alter table public.catalog_library enable row level security;
alter table public.catalog_product_meta enable row level security;
alter table public.catalog_settings enable row level security;
revoke all on public.catalog_library,public.catalog_product_meta,public.catalog_settings from public,anon,authenticated;
grant all on public.catalog_library,public.catalog_product_meta,public.catalog_settings to service_role;

-- 5. Une référence suivie = vendue, ajoutée à la bibliothèque ou postée sur Dotb.
--    Les fonctions de collecte existantes (file, récupération, association) utilisent toutes ce test.
create or replace function public.is_sold_catalog_reference(p_sku text,p_supplier_id text default null)
returns boolean language sql stable security invoker set search_path='' as $$
  select (case when nullif(btrim(p_sku),'') is not null then
    exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(btrim(p_sku)))
  else exists(
    select 1 from public.catalog_products p where p.supplier_id=p_supplier_id and (
      exists(select 1 from public.catalog_sales_by_sku s where lower(s.sku)=lower(p.supplier_sku))
      or exists(select 1 from public.catalog_sku_links l join public.catalog_sales_by_sku s on s.sku=l.sku where l.product_id=p.id)))
  end)
  or (nullif(btrim(p_sku),'') is not null and (
    exists(select 1 from public.catalog_library b where lower(b.sku)=lower(btrim(p_sku)))
    or exists(select 1 from public.catalog_dotb_items d where d.present and lower(d.sku)=lower(btrim(p_sku)))))
  or (p_supplier_id is not null and (
    exists(select 1 from public.catalog_library b where b.supplier_id=p_supplier_id)
    or exists(select 1 from public.catalog_library b join public.catalog_products p on lower(p.supplier_sku)=lower(b.sku) where p.supplier_id=p_supplier_id)));
$$;

-- 6. Ajout de références : enregistrées dans la bibliothèque puis mises en file pour le PC.
create function public.library_add_references(p_refs jsonb,p_source text,p_user uuid) returns integer
language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_refs)<>'array' or jsonb_array_length(p_refs)>100 or p_source not in ('manual','listing') then raise exception 'invalid_references'; end if;
  insert into public.catalog_library(sku,supplier_id,input,source,added_by)
    select nullif(btrim(r.expected_sku),''),r.expected_supplier_id,left(r.input,2000),p_source,p_user
    from jsonb_to_recordset(p_refs) r(input text,expected_sku text,expected_supplier_id text)
    on conflict do nothing;
  return public.enqueue_catalog_collection(p_refs);
end; $$;

-- 7. Relevé automatique des références de la bibliothèque : 24 h entre deux relevés,
--    20 au plus par passage, pas de nouvel essai avant 24 h après un échec.
create function public.queue_library_sources() returns integer
language plpgsql security invoker set search_path='' as $$
declare refs jsonb;
begin
  select coalesce(jsonb_agg(x),'[]') into refs from (
    select case when b.sku is not null then 'sku:'||lower(b.sku) else 'product:'||b.supplier_id end as reference_key,
      coalesce(p.supplier_url,b.input) as input,b.sku as expected_sku,coalesce(b.supplier_id,p.supplier_id) as expected_supplier_id
    from public.catalog_library b
    left join lateral (select s.id,s.supplier_id,s.supplier_url,s.observed_at from public.catalog_product_summary s
      where s.supplier_id=b.supplier_id or (b.sku is not null and lower(s.supplier_sku)=lower(b.sku)) order by s.updated_at desc limit 1) p on true
    left join lateral (select job.status,job.created_at from public.catalog_collection_jobs job
      where (b.sku is not null and lower(job.expected_sku)=lower(b.sku)) or job.expected_supplier_id=coalesce(b.supplier_id,p.supplier_id) or job.product_id=p.id
      order by job.created_at desc,job.id desc limit 1) latest on true
    where (p.id is null or p.observed_at is null or p.observed_at<now()-interval '24 hours')
      and (latest.status is null or latest.status not in ('queued','running'))
      -- Après un échec : nouvel essai au bout de 24 h pour un ajout manuel ; un SKU saisi dans une annonce
      -- et introuvable n'est plus relancé tout seul (une faute de frappe ne tourne pas en boucle).
      and (latest.status is null or latest.status not in ('blocked','failed')
        or (latest.created_at<now()-interval '24 hours' and (b.source='manual' or latest.status='blocked')))
      and (latest.created_at is null or latest.created_at<=now()-interval '1 hour')
    order by b.created_at desc limit 20
  ) x;
  return public.enqueue_catalog_collection(refs);
end; $$;
create or replace function public.queue_catalog_sources() returns integer
language sql security invoker set search_path='' as $$ select public.queue_sales_sources()+public.queue_library_sources(); $$;

-- 8. Relevé des articles Dotb, page par page, avec un bail pour éviter deux relevés simultanés.
create function public.library_claim_dotb_sync(p_lease uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare state public.catalog_sync_state;
begin
  update public.catalog_sync_state set lease=p_lease,locked_until=now()+interval '90 seconds',
    cycle_started_at=case when cursor is null then now() else cycle_started_at end
    where id and (lease is null or locked_until<now()) returning * into state;
  if not found then raise exception 'sync_running'; end if;
  return jsonb_build_object('cursor',state.cursor,'cycle_started_at',state.cycle_started_at);
end; $$;
create function public.library_import_dotb_page(p_items jsonb,p_cursor text,p_lease uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare started timestamptz;
begin
  select cycle_started_at into started from public.catalog_sync_state where id and lease=p_lease and locked_until>now() for update;
  if not found then raise exception 'sync_lease_expired'; end if;
  insert into public.catalog_dotb_items(id,sku,title,account_id,status,supplier_url,supplier_id,supplier_canonical_url,supplier_link_status,price,currency,photo_url,synced_at,present)
    select x.id,x.sku,x.title,x.account_id,x.status,x.supplier_url,x.supplier_id,x.supplier_canonical_url,x.supplier_link_status,x.price,x.currency,x.photo_url,now(),true
    from jsonb_to_recordset(p_items) as x(id uuid,sku text,title text,account_id uuid,status text,supplier_url text,supplier_id text,supplier_canonical_url text,supplier_link_status text,price numeric,currency text,photo_url text)
    on conflict(id) do update set sku=excluded.sku,title=excluded.title,account_id=excluded.account_id,status=excluded.status,
      supplier_url=excluded.supplier_url,supplier_id=excluded.supplier_id,supplier_canonical_url=excluded.supplier_canonical_url,
      supplier_link_status=excluded.supplier_link_status,price=excluded.price,currency=excluded.currency,photo_url=excluded.photo_url,
      synced_at=now(),present=true;
  if p_cursor is null then
    update public.catalog_dotb_items set present=false where present and synced_at<started;
    update public.catalog_sync_state set cursor=null,lease=null,locked_until='-infinity',last_completed_at=now(),
      processed=processed+jsonb_array_length(p_items) where id;
  else
    update public.catalog_sync_state set cursor=p_cursor,locked_until=now()+interval '90 seconds',
      processed=processed+jsonb_array_length(p_items) where id;
  end if;
end; $$;
create function public.library_release_dotb_sync(p_lease uuid) returns void
language sql security invoker set search_path='' as $$
  update public.catalog_sync_state set lease=null,locked_until='-infinity' where id and lease=p_lease;
$$;

-- 9. Produits de la bibliothèque : vendus, ajoutés ou postés, avec catégorie et prix choisis.
create view public.catalog_library_products with(security_invoker=true) as
select p.*,m.category,m.sale_price,
  exists(select 1 from public.catalog_tracked_products t where t.id=p.id) as sold,
  (select min(b.created_at) from public.catalog_library b where b.supplier_id=p.supplier_id or lower(b.sku)=lower(p.supplier_sku)
    or exists(select 1 from public.catalog_sku_links k where k.product_id=p.id and lower(k.sku)=lower(b.sku))) as added_at
from public.catalog_product_summary p left join public.catalog_product_meta m on m.product_id=p.id
where exists(select 1 from public.catalog_tracked_products t where t.id=p.id)
  or exists(select 1 from public.catalog_library b where b.supplier_id=p.supplier_id or lower(b.sku)=lower(p.supplier_sku)
    or exists(select 1 from public.catalog_sku_links k where k.product_id=p.id and lower(k.sku)=lower(b.sku)))
  or exists(select 1 from public.catalog_dotb_items d where d.present and d.sku is not null and (lower(d.sku)=lower(p.supplier_sku)
    or exists(select 1 from public.catalog_sku_links k where k.product_id=p.id and lower(k.sku)=lower(d.sku))));
create view public.catalog_library_posted with(security_invoker=true) as
select d.id,d.sku,d.title,d.account_id,a.login as account_login,d.status,d.supplier_url,d.supplier_id,d.price,d.currency,d.photo_url,d.synced_at
from public.catalog_dotb_items d left join public.publication_accounts a on a.id=d.account_id
where d.present and d.sku is not null;

revoke all on function public.library_add_references(jsonb,text,uuid),public.queue_library_sources(),public.library_claim_dotb_sync(uuid),
  public.library_import_dotb_page(jsonb,text,uuid),public.library_release_dotb_sync(uuid) from public,anon,authenticated;
grant execute on function public.library_add_references(jsonb,text,uuid),public.queue_library_sources(),public.library_claim_dotb_sync(uuid),
  public.library_import_dotb_page(jsonb,text,uuid),public.library_release_dotb_sync(uuid) to service_role;
revoke all on public.catalog_library_products,public.catalog_library_posted from public,anon,authenticated;
grant select on public.catalog_library_products,public.catalog_library_posted to service_role;
commit;
