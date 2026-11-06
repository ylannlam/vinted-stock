-- Extension « veille des comptes » installée dans les profils AdsPower : une clé par téléchargement.
create table if not exists public.vinted_watch_keys (
  id uuid primary key,
  token_hash text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_login text,
  revoked_at timestamptz
);
alter table public.vinted_watch_keys enable row level security;
revoke all on public.vinted_watch_keys from public, anon, authenticated;
grant all on public.vinted_watch_keys to service_role;
