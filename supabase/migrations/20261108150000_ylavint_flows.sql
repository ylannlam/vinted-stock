-- YlaVint : réglages façon Dotb pour les likes (3 messages, offre, relance, filtres) et le flux de commande
-- (expédition, délai, retrait, finalisation). Rien n'est supprimé : ajout de types de tâches et de colonnes.

-- 1. Nouveaux types de tâches : message dans une vente, demande de délai, annulation, évaluation, suppression d'annonce.
alter table public.vinted_agent_tasks drop constraint if exists vinted_agent_tasks_kind_check;
alter table public.vinted_agent_tasks add constraint vinted_agent_tasks_kind_check check (kind in (
  'scan_wardrobe','sync_orders','fetch_label','scan_likes','unmask_item','reprice_item','publish_item','like_message',
  'sync_inbox','reply_message','order_message','order_extension','order_cancel','order_review','item_delete'));

-- 2. Réglages du flux de commande, par compte.
alter table public.vinted_agent_settings add column if not exists order_flow jsonb not null default '{}'::jsonb;

-- 3. Likes : quel message de la rotation a été envoyé, conversation ouverte, relance.
alter table public.vinted_agent_contacts add column if not exists step smallint;
alter table public.vinted_agent_contacts add column if not exists login text;
alter table public.vinted_agent_contacts add column if not exists conversation_id text;
alter table public.vinted_agent_contacts add column if not exists followup_state text
  check (followup_state is null or followup_state in ('queued','sent','skipped','failed'));
create index if not exists vinted_agent_contacts_user on public.vinted_agent_contacts(account_id, user_id, sent_at desc);

-- 4. Ventes : étape suivie (payée, expédiée, au point de retrait, terminée, annulée), date limite d'envoi,
--    acheteur et étapes déjà faites du flux (horodatées).
alter table public.vinted_agent_orders add column if not exists stage text
  check (stage is null or stage in ('paid','shipped','pickup','completed','cancelled','other'));
alter table public.vinted_agent_orders add column if not exists stage_at timestamptz;
alter table public.vinted_agent_orders add column if not exists ship_deadline timestamptz;
alter table public.vinted_agent_orders add column if not exists buyer_id text;
alter table public.vinted_agent_orders add column if not exists carrier text;
alter table public.vinted_agent_orders add column if not exists flow jsonb not null default '{}'::jsonb;

-- 5. Un like peut être écarté (membre ignoré, déjà contacté récemment, limite par article…).
alter table public.vinted_agent_contacts drop constraint if exists vinted_agent_contacts_state_check;
alter table public.vinted_agent_contacts add constraint vinted_agent_contacts_state_check check (state in ('queued','sent','failed','skipped'));

-- 6. Messages envoyés par le flux de commande, visibles dans la messagerie centralisée.
alter table public.ylavint_messages drop constraint if exists ylavint_messages_source_check;
alter table public.ylavint_messages add constraint ylavint_messages_source_check check (source in ('vinted','site','ai','likes','flow'));
