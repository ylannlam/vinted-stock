-- One-time data transition after deploying the PC-only API gate.
-- Keeps activation, pauses, templates, features and all history unchanged.
with previous as materialized (
  select account_id, messaging, enabled, paused, likes, features
  from public.vinted_agent_settings
  where coalesce(messaging->>'executor','extension') <> 'desktop'
), changed as (
  update public.vinted_agent_settings s
  set messaging=coalesce(s.messaging,'{}'::jsonb)||'{"executor":"desktop"}'::jsonb,
      version=coalesce(s.version,0)+1, updated_at=now()
  from previous p where s.account_id=p.account_id
  returning s.account_id,s.messaging,s.enabled,s.paused,s.likes,s.features
)
select count(*) as migrated,
 count(*) filter(where c.enabled is not distinct from p.enabled and c.paused is not distinct from p.paused
  and c.likes is not distinct from p.likes and c.features is not distinct from p.features
  and (c.messaging-'executor') is not distinct from (coalesce(p.messaging,'{}'::jsonb)-'executor')) as preserved
from changed c join previous p using(account_id);
