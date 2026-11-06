-- Toutes les alertes Dotb sur les comptes (Vinted, Dotb, captchas, agent) : reçues en direct par webhook
-- ou relues périodiquement. Elles servent à détecter automatiquement un compte restreint ou banni,
-- et à vérifier ce que Dotb envoie réellement quand une détection manque.
create table if not exists public.dotb_notifications (
  id uuid primary key,
  account_id uuid,
  grp text not null,
  kind text not null default '',
  severity text not null default 'info',
  title text not null default '',
  body text not null default '',
  params jsonb not null default '{}'::jsonb,
  resolved boolean not null default false,
  created_at timestamptz not null,
  observed_at timestamptz not null default now()
);
create index if not exists dotb_notifications_recent on public.dotb_notifications(created_at desc);
create index if not exists dotb_notifications_account on public.dotb_notifications(account_id, created_at desc);
alter table public.dotb_notifications enable row level security;
revoke all on public.dotb_notifications from public, anon, authenticated;
grant all on public.dotb_notifications to service_role;

alter table public.account_health_alerts add column if not exists kind text not null default '';

-- Version des événements suivis par la connexion Dotb (2 = ventes + alertes de compte).
alter table public.dotb_sales_automation add column if not exists events_version integer not null default 1;
