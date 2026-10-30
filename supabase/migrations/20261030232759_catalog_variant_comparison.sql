create or replace view public.catalog_product_summary with (security_invoker=true) as
select p.*, o.price,o.currency,o.size,o.color,o.availability,o.observed_at,o.source,
  prev.price as previous_price, prev.observed_at as previous_observed_at,
  (select count(*) from public.catalog_sku_links l where l.product_id=p.id) as linked_skus
from public.catalog_products p
left join lateral (select * from public.catalog_observations obs where obs.product_id=p.id
  order by obs.observed_at desc,obs.created_at desc,obs.id desc limit 1) o on true
left join lateral (select obs.price,obs.observed_at from public.catalog_observations obs
  where obs.product_id=p.id and obs.price is not null and obs.currency=o.currency
  and o.size<>'' and o.color<>''
  and lower(obs.size)=lower(o.size) and lower(obs.color)=lower(o.color)
  and (obs.observed_at,obs.created_at,obs.id)<(o.observed_at,o.created_at,o.id)
  order by obs.observed_at desc,obs.created_at desc,obs.id desc limit 1) prev on true;
