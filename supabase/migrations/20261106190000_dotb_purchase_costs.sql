-- Prix d'achat Shein recopié dans Dotb (prix d'achat de chaque article de commande, pour son calcul de bénéfice).
-- Le coût payé connu sur le site (relevé de la commande Shein ou saisi à la main) est la référence ;
-- source.purchase_price garde la dernière valeur connue côté Dotb.
alter table public.sales_lines
  add column if not exists dotb_cost_error text,
  add column if not exists dotb_cost_attempt_at timestamptz;

-- Articles de la période suivie dont le coût du site n'est pas celui de Dotb.
-- Un échec sur un article attend 6 heures avant un nouvel essai.
create or replace function public.pending_dotb_costs(p_limit integer default 15)
returns table(id text, order_id uuid, dotb_item_id uuid, cost text)
language sql stable security definer set search_path = public as $$
  select l.id, l.order_id, l.dotb_item_id, to_char(round(l.actual_cost, 2), 'FM9999990.00')
  from public.sales_lines l
  join public.sales_orders o on o.id = l.order_id
  where l.actual_cost is not null and l.actual_cost > 0 and l.actual_cost < 100000
    and l.dotb_item_id is not null
    and o.order_date >= coalesce((select starts_at from public.dotb_tracking_period limit 1), now() - interval '60 days')
    and (l.source->>'purchase_price') is distinct from to_char(round(l.actual_cost, 2), 'FM9999990.00')
    and (l.dotb_cost_error is null or l.dotb_cost_attempt_at < now() - interval '6 hours')
  order by o.order_date desc, l.id
  limit least(greatest(coalesce(p_limit, 15), 1), 50)
$$;

create or replace function public.count_pending_dotb_costs()
returns table(pending integer, failed integer)
language sql stable security definer set search_path = public as $$
  select count(*) filter (where l.dotb_cost_error is null or l.dotb_cost_attempt_at < now() - interval '6 hours')::integer,
         count(*) filter (where l.dotb_cost_error is not null and l.dotb_cost_attempt_at >= now() - interval '6 hours')::integer
  from public.sales_lines l
  join public.sales_orders o on o.id = l.order_id
  where l.actual_cost is not null and l.actual_cost > 0 and l.actual_cost < 100000 and l.dotb_item_id is not null
    and o.order_date >= coalesce((select starts_at from public.dotb_tracking_period limit 1), now() - interval '60 days')
    and (l.source->>'purchase_price') is distinct from to_char(round(l.actual_cost, 2), 'FM9999990.00')
$$;

-- Résultat d'un envoi : la valeur acceptée par Dotb, ou l'erreur. Le coût du site n'est jamais modifié ici.
create or replace function public.record_dotb_cost(p_id text, p_cost text, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_error is null and (p_cost is null or p_cost !~ '^\d{1,7}\.\d{2}$') then raise exception 'Invalid cost'; end if;
  update public.sales_lines
     set source = case when p_error is null then jsonb_set(coalesce(source, '{}'::jsonb), '{purchase_price}', to_jsonb(p_cost)) else source end,
         dotb_cost_error = left(p_error, 300),
         dotb_cost_attempt_at = now()
   where id = p_id;
end;
$$;

revoke all on function public.pending_dotb_costs(integer), public.count_pending_dotb_costs(), public.record_dotb_cost(text, text, text) from public, anon, authenticated;
grant execute on function public.pending_dotb_costs(integer), public.count_pending_dotb_costs(), public.record_dotb_cost(text, text, text) to service_role;
