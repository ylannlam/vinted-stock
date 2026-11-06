-- Fluctuations : le prix précédent n'était jamais trouvé pour les prix de fiche (taille vide = NULL,
-- et NULL = NULL est faux). On compare désormais tailles et couleurs sans tenir compte des NULL,
-- et le « prix précédent » est le dernier prix différent du prix actuel (dernier vrai changement).
create or replace view public.catalog_product_summary with (security_invoker=true) as
 select p.id, p.supplier_id, p.supplier_url, p.title, p.supplier_sku, p.photo_url, p.created_at, p.updated_at,
    o.price, o.currency, o.size, o.color, o.availability, o.observed_at, o.source,
    prev.price as previous_price, prev.observed_at as previous_observed_at,
    (select count(*) from public.catalog_sku_links l where l.product_id = p.id) as linked_skus,
    p.photos, p.description, p.details, p.sizes, p.last_checked_at, p.next_check_at,
    p.collection_status, p.collection_message, p.auto_collect, o.price_scope
   from public.catalog_products p
     left join lateral (
       select obs.* from public.catalog_observations obs
        where obs.product_id = p.id
        order by obs.observed_at desc, obs.created_at desc, obs.id desc
        limit 1) o on true
     left join lateral (
       select obs.price, obs.observed_at from public.catalog_observations obs
        where obs.product_id = p.id and obs.price is not null and o.price is not null
          and obs.price <> o.price
          and obs.currency = o.currency and obs.price_scope = o.price_scope
          and lower(coalesce(obs.size,'')) = lower(coalesce(o.size,''))
          and lower(coalesce(obs.color,'')) = lower(coalesce(o.color,''))
          and coalesce(o.color,'') <> ''
          and (o.price_scope = 'product' or coalesce(o.size,'') <> '')
          and row(obs.observed_at, obs.created_at, obs.id) < row(o.observed_at, o.created_at, o.id)
        order by obs.observed_at desc, obs.created_at desc, obs.id desc
        limit 1) prev on true;
