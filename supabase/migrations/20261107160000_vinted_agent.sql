-- Agent Vinted maison (remplace Dotb fonction par fonction).
-- L'extension « Stock Vinted Agent » installée dans les profils AdsPower prend ses tâches ici, une à la fois par compte,
-- dans les plafonds du compte, et s'arrête dès que le compte reçoit une alerte Vinted.
-- Aucune table existante n'est modifiée ni supprimée.

-- 1. Réglages par compte (fonctions actives, plafonds, pause).
create table if not exists public.vinted_agent_settings (
  account_id uuid primary key references public.publication_accounts(id) on delete cascade,
  enabled boolean not null default false,
  paused boolean not null default false,
  pause_reason text,
  paused_at timestamptz,
  features jsonb not null default '{}'::jsonb,
  limits jsonb not null default '{}'::jsonb,
  unmask jsonb not null default '{}'::jsonb,
  pricing jsonb not null default '{}'::jsonb,
  likes jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  extension_version text,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- 2. File de tâches. « writes » = l'action modifie quelque chose sur Vinted (comptée dans les plafonds).
create table if not exists public.vinted_agent_tasks (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.publication_accounts(id) on delete cascade,
  kind text not null check (kind in ('scan_wardrobe','sync_orders','fetch_label','scan_likes','unmask_item','reprice_item','publish_item','like_message')),
  writes boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text check (dedupe_key is null or length(dedupe_key) <= 200),
  state text not null default 'queued' check (state in ('queued','running','done','failed','cancelled')),
  not_before timestamptz not null default now(),
  lease uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_by uuid
);
create unique index if not exists vinted_agent_tasks_dedupe on public.vinted_agent_tasks(dedupe_key)
  where dedupe_key is not null and state in ('queued','running');
create index if not exists vinted_agent_tasks_queue on public.vinted_agent_tasks(account_id, state, not_before);
create index if not exists vinted_agent_tasks_done on public.vinted_agent_tasks(account_id, kind, started_at desc);

-- 3. Journal (affiché dans l'onglet Agent).
create table if not exists public.vinted_agent_log (
  id bigint generated always as identity primary key,
  account_id uuid references public.publication_accounts(id) on delete set null,
  task_id uuid,
  level text not null default 'info' check (level in ('info','warn','error')),
  event text not null check (length(event) <= 60),
  message text not null check (length(message) <= 500),
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists vinted_agent_log_recent on public.vinted_agent_log(created_at desc);
create index if not exists vinted_agent_log_account on public.vinted_agent_log(account_id, created_at desc);

-- 4. « Recettes » : forme exacte des requêtes que le site Vinted fait lui-même, relevée en mode apprentissage.
-- Les actions qui modifient Vinted ne partent jamais sans recette relevée.
create table if not exists public.vinted_agent_recipes (
  kind text primary key check (kind ~ '^[a-z_]{3,40}$'),
  recipe jsonb not null,
  learned_at timestamptz not null default now(),
  learned_login text,
  samples integer not null default 1
);

-- 5. Annonces suivies (démasquage, cycle de prix).
create table if not exists public.vinted_agent_listings (
  account_id uuid not null references public.publication_accounts(id) on delete cascade,
  item_id text not null check (item_id ~ '^[1-9][0-9]{0,17}$'),
  title text,
  price numeric(10,2),
  currency text,
  photo_url text,
  state text not null default 'visible' check (state in ('visible','hidden','repairing','sold','closed','draft','gone')),
  hidden_since timestamptz,
  original_price numeric(10,2),
  total_drop numeric(10,2) not null default 0,
  repairs integer not null default 0,
  last_repair_at timestamptz,
  last_price_drop_at timestamptz,
  listed_at timestamptz,
  last_error text,
  first_seen_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  primary key (account_id, item_id)
);
create index if not exists vinted_agent_listings_state on public.vinted_agent_listings(state, account_id);

-- 6. Ventes lues directement sur Vinted (sans données de l'acheteur), en parallèle de Dotb pendant la transition.
create table if not exists public.vinted_agent_orders (
  transaction_id text primary key check (transaction_id ~ '^[1-9][0-9]{0,17}$'),
  account_id uuid not null references public.publication_accounts(id) on delete cascade,
  status text,
  title text,
  price numeric(10,2),
  currency text,
  item_ids text[] not null default '{}',
  order_date timestamptz,
  label_path text,
  label_fetched_at timestamptz,
  first_seen_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
create index if not exists vinted_agent_orders_recent on public.vinted_agent_orders(account_id, order_date desc);

-- 7. Personnes déjà contactées après un like (jamais deux messages pour le même article).
create table if not exists public.vinted_agent_contacts (
  account_id uuid not null references public.publication_accounts(id) on delete cascade,
  item_id text not null check (item_id ~ '^[1-9][0-9]{0,17}$'),
  user_id text not null check (user_id ~ '^[1-9][0-9]{0,17}$'),
  state text not null default 'queued' check (state in ('queued','sent','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  primary key (account_id, item_id, user_id)
);

-- Prise de la tâche suivante d'un compte : une seule à la fois, plafonds du jour (heure de Paris),
-- plage horaire et écart minimal entre deux modifications. Une modification interrompue n'est jamais rejouée.
create or replace function public.claim_vinted_agent_task(p_account uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  s public.vinted_agent_settings;
  t public.vinted_agent_tasks;
  v_day timestamptz := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
  v_hour integer := extract(hour from now() at time zone 'Europe/Paris')::integer;
  v_from integer; v_to integer; v_in_window boolean;
  v_writes integer; v_last timestamptz; v_cap integer; v_kind_count integer;
begin
  select * into s from public.vinted_agent_settings where account_id=p_account for update;
  if not found or not s.enabled then return jsonb_build_object('state','disabled','task',null); end if;
  update public.vinted_agent_settings set last_seen_at=now() where account_id=p_account;

  update public.vinted_agent_tasks set
      state=case when writes then 'failed' else 'queued' end,
      error=case when writes then 'Résultat inconnu : le profil s''est fermé pendant l''action. Vérifie sur Vinted avant de relancer.' else error end,
      finished_at=case when writes then now() else null end,
      lease=null, lease_until=null
    where account_id=p_account and state='running' and lease_until<now();
  update public.vinted_agent_tasks set state='failed', error='Trois essais sans succès.', finished_at=now()
    where account_id=p_account and state='queued' and attempts>=3;

  if s.paused then return jsonb_build_object('state','paused','reason',s.pause_reason,'task',null); end if;
  if exists(select 1 from public.vinted_agent_tasks where account_id=p_account and state='running') then
    return jsonb_build_object('state','busy','task',null);
  end if;

  v_from := coalesce((s.limits->>'from_hour')::integer, 9);
  v_to := coalesce((s.limits->>'to_hour')::integer, 22);
  v_in_window := case when v_from=v_to then true when v_from<v_to then v_hour>=v_from and v_hour<v_to else v_hour>=v_from or v_hour<v_to end;
  select count(*) into v_writes from public.vinted_agent_tasks where account_id=p_account and writes and started_at>=v_day;
  select max(started_at) into v_last from public.vinted_agent_tasks where account_id=p_account and writes and started_at is not null;

  for t in select * from public.vinted_agent_tasks
      where account_id=p_account and state='queued' and not_before<=now()
      order by writes, not_before, created_at
      for update skip locked
  loop
    if t.writes then
      if not v_in_window then continue; end if;
      if v_writes >= coalesce((s.limits->>'writes_per_day')::integer, 15) then continue; end if;
      if v_last is not null and v_last > now() - make_interval(mins => coalesce((s.limits->>'min_gap_minutes')::integer, 12)) then continue; end if;
      v_cap := coalesce((s.limits->>(t.kind||'_per_day'))::integer, 5);
      select count(*) into v_kind_count from public.vinted_agent_tasks where account_id=p_account and kind=t.kind and started_at>=v_day;
      if v_kind_count >= v_cap then continue; end if;
    end if;
    update public.vinted_agent_tasks set state='running', attempts=attempts+1, lease=gen_random_uuid(),
        lease_until=now()+interval '4 minutes', started_at=now(), error=null
      where id=t.id returning * into t;
    return jsonb_build_object('state','task','task',to_jsonb(t));
  end loop;
  return jsonb_build_object('state','idle','task',null);
end; $$;

create or replace function public.finish_vinted_agent_task(p_task uuid, p_lease uuid, p_state text, p_result jsonb, p_error text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.vinted_agent_tasks;
begin
  if p_state not in ('done','failed','queued') then raise exception 'agent_bad_state'; end if;
  update public.vinted_agent_tasks set
      state=p_state, result=p_result, error=left(p_error,500), lease=null, lease_until=null,
      finished_at=case when p_state='queued' then null else now() end,
      not_before=case when p_state='queued' then now()+interval '10 minutes' else not_before end
    where id=p_task and lease=p_lease and state='running'
    returning * into t;
  if not found then raise exception 'agent_lease_expired'; end if;
  return to_jsonb(t);
end; $$;

alter table public.vinted_agent_settings enable row level security;
alter table public.vinted_agent_tasks enable row level security;
alter table public.vinted_agent_log enable row level security;
alter table public.vinted_agent_recipes enable row level security;
alter table public.vinted_agent_listings enable row level security;
alter table public.vinted_agent_orders enable row level security;
alter table public.vinted_agent_contacts enable row level security;
revoke all on public.vinted_agent_settings, public.vinted_agent_tasks, public.vinted_agent_log, public.vinted_agent_recipes,
  public.vinted_agent_listings, public.vinted_agent_orders, public.vinted_agent_contacts from public, anon, authenticated;
grant all on public.vinted_agent_settings, public.vinted_agent_tasks, public.vinted_agent_log, public.vinted_agent_recipes,
  public.vinted_agent_listings, public.vinted_agent_orders, public.vinted_agent_contacts to service_role;
revoke all on function public.claim_vinted_agent_task(uuid) from public, anon, authenticated;
revoke all on function public.finish_vinted_agent_task(uuid,uuid,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.claim_vinted_agent_task(uuid) to service_role;
grant execute on function public.finish_vinted_agent_task(uuid,uuid,text,jsonb,text) to service_role;
