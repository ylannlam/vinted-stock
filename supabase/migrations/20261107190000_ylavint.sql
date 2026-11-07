-- YlaVint : l'extension maison devient complète (messagerie centralisée, agent IA, ventes vers l'onglet Ventes).
-- Rien n'est supprimé : ajout de deux types de tâches, d'une file prioritaire pour les réponses aux acheteurs,
-- de trois tables (conversations, messages, réglages généraux) et de colonnes de liaison.

-- 1. Nouveaux types de tâches : lecture de la messagerie, réponse dans une conversation.
alter table public.vinted_agent_tasks drop constraint if exists vinted_agent_tasks_kind_check;
alter table public.vinted_agent_tasks add constraint vinted_agent_tasks_kind_check check (kind in (
  'scan_wardrobe','sync_orders','fetch_label','scan_likes','unmask_item','reprice_item','publish_item','like_message',
  'sync_inbox','reply_message'));
alter table public.vinted_agent_tasks add column if not exists priority integer not null default 0;
create index if not exists vinted_agent_tasks_reply on public.vinted_agent_tasks(account_id, kind, started_at desc) where kind='reply_message';

-- 2. Réglages de messagerie par compte (lecture, plafond et écart des réponses).
alter table public.vinted_agent_settings add column if not exists messaging jsonb not null default '{}'::jsonb;

-- 3. Ventes lues par YlaVint : liaison avec l'onglet Ventes et données utiles au bordereau.
alter table public.vinted_agent_orders add column if not exists sales_order_id uuid;
alter table public.vinted_agent_orders add column if not exists shipment_id text;
alter table public.vinted_agent_orders add column if not exists conversation_id text;

-- 3 bis. Coût des réponses de l'agent IA, suivi avec les rédactions d'annonces.
do $$ begin
  if to_regclass('public.ai_usage') is not null then
    alter table public.ai_usage drop constraint if exists ai_usage_feature_check;
    alter table public.ai_usage add constraint ai_usage_feature_check check (feature in ('listing_text','ylavint_reply'));
  end if;
end $$;

-- 4. Réglages généraux de YlaVint (agent IA…), une ligne par clé.
create table if not exists public.ylavint_config (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  value jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- 5. Messagerie centralisée : une ligne par conversation Vinted et par compte.
create table if not exists public.ylavint_conversations (
  account_id uuid not null references public.publication_accounts(id) on delete cascade,
  conversation_id text not null check (conversation_id ~ '^[1-9][0-9]{0,17}$'),
  other_id text,
  other_login text,
  other_photo text,
  item_id text,
  item_title text,
  item_photo text,
  item_price numeric(10,2),
  transaction_id text,
  transaction_status text,
  last_message text,
  last_message_at timestamptz,
  last_from_me boolean not null default false,
  unread boolean not null default false,
  site_read_at timestamptz,
  allow_reply boolean not null default true,
  needs_human boolean not null default false,
  ai_state text not null default 'none' check (ai_state in ('none','pending','drafting','drafted','queued','sent','human','skipped','error')),
  ai_draft text,
  ai_reason text,
  ai_handled_message_id text,
  ai_replies integer not null default 0,
  vinted_updated_at text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, conversation_id)
);
create index if not exists ylavint_conversations_recent on public.ylavint_conversations(last_message_at desc nulls last);
create index if not exists ylavint_conversations_ai on public.ylavint_conversations(account_id, ai_state) where ai_state='pending';

-- 6. Messages. Un message écrit sur le site a d'abord un identifiant local (« local:… ») jusqu'à son envoi.
create table if not exists public.ylavint_messages (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  conversation_id text not null,
  message_id text not null check (length(message_id) <= 80),
  from_me boolean not null default false,
  body text check (body is null or length(body) <= 4000),
  kind text not null default 'message' check (kind in ('message','offer','action','status','photo')),
  sent_at timestamptz,
  state text not null default 'vinted' check (state in ('vinted','queued','sent','failed','cancelled')),
  source text not null default 'vinted' check (source in ('vinted','site','ai','likes')),
  task_id uuid,
  error text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (account_id, conversation_id, message_id),
  foreign key (account_id, conversation_id) references public.ylavint_conversations(account_id, conversation_id) on delete cascade
);
create index if not exists ylavint_messages_thread on public.ylavint_messages(account_id, conversation_id, sent_at);

-- Prise de la tâche suivante d'un compte. Les réponses aux acheteurs ont leur propre file (plafond et écart à part),
-- passent en premier, et une réponse écrite à la main part même hors de la plage horaire.
create or replace function public.claim_vinted_agent_task(p_account uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  s public.vinted_agent_settings;
  t public.vinted_agent_tasks;
  v_day timestamptz := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
  v_hour integer := extract(hour from now() at time zone 'Europe/Paris')::integer;
  v_from integer; v_to integer; v_in_window boolean;
  v_writes integer; v_last timestamptz; v_cap integer; v_kind_count integer;
  v_replies integer; v_last_reply timestamptz;
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
  select count(*) into v_writes from public.vinted_agent_tasks where account_id=p_account and writes and kind<>'reply_message' and started_at>=v_day;
  select max(started_at) into v_last from public.vinted_agent_tasks where account_id=p_account and writes and kind<>'reply_message' and started_at is not null;
  select count(*) into v_replies from public.vinted_agent_tasks where account_id=p_account and kind='reply_message' and started_at>=v_day;
  select max(started_at) into v_last_reply from public.vinted_agent_tasks where account_id=p_account and kind='reply_message' and started_at is not null;

  for t in select * from public.vinted_agent_tasks
      where account_id=p_account and state='queued' and not_before<=now()
      order by priority desc, writes, not_before, created_at
      for update skip locked
  loop
    if t.kind='reply_message' then
      if not coalesce((t.payload->>'manual')::boolean, false) and not v_in_window then continue; end if;
      if v_replies >= coalesce((s.messaging->>'reply_per_day')::integer, 80) then continue; end if;
      if v_last_reply is not null and v_last_reply > now() - make_interval(secs => coalesce((s.messaging->>'reply_gap_seconds')::integer, 40)) then continue; end if;
    elsif t.writes then
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

alter table public.ylavint_config enable row level security;
alter table public.ylavint_conversations enable row level security;
alter table public.ylavint_messages enable row level security;
revoke all on public.ylavint_config, public.ylavint_conversations, public.ylavint_messages from public, anon, authenticated;
grant all on public.ylavint_config, public.ylavint_conversations, public.ylavint_messages to service_role;
revoke all on function public.claim_vinted_agent_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_vinted_agent_task(uuid) to service_role;
