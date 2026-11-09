-- Commandes Vinted lues par YlaVint : miniature de l'article (comme Dotb).
alter table public.vinted_agent_orders add column if not exists photo_url text;
