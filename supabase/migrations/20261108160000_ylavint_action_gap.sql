-- YlaVint : messages (réponses, messages après un like, messages de commande) sans plafond par jour pour les likes
-- et les commandes, avec un écart aléatoire réglable entre deux envois (messaging.action_gap_min / action_gap_max, en secondes).
-- Les autres modifications (démasquage, prix, publication, annulation…) gardent leurs plafonds.
create or replace function public.claim_vinted_agent_task(p_account uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare
  s public.vinted_agent_settings;
  t public.vinted_agent_tasks;
  v_day timestamptz := (date_trunc('day', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
  v_hour integer := extract(hour from now() at time zone 'Europe/Paris')::integer;
  v_from integer; v_to integer; v_in_window boolean;
  v_writes integer; v_last timestamptz; v_cap integer; v_kind_count integer;
  v_replies integer; v_last_msg timestamptz; v_gap_min numeric; v_gap_max numeric; v_gap numeric;
  v_msg_kinds text[] := array['reply_message','like_message','order_message'];
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
  select count(*) into v_writes from public.vinted_agent_tasks where account_id=p_account and writes and not (kind = any(v_msg_kinds)) and started_at>=v_day;
  select max(started_at) into v_last from public.vinted_agent_tasks where account_id=p_account and writes and not (kind = any(v_msg_kinds)) and started_at is not null;
  select count(*) into v_replies from public.vinted_agent_tasks where account_id=p_account and kind='reply_message' and started_at>=v_day;
  select max(started_at) into v_last_msg from public.vinted_agent_tasks where account_id=p_account and kind = any(v_msg_kinds) and started_at is not null;
  -- Écart entre deux messages : tiré au hasard entre le minimum et le maximum réglés (30 à 45 s par défaut).
  v_gap_min := greatest(5, coalesce((s.messaging->>'action_gap_min')::numeric, 30));
  v_gap_max := greatest(v_gap_min, coalesce((s.messaging->>'action_gap_max')::numeric, 45));
  v_gap := v_gap_min + random() * (v_gap_max - v_gap_min);

  for t in select * from public.vinted_agent_tasks
      where account_id=p_account and state='queued' and not_before<=now()
      order by priority desc, writes, not_before, created_at
      for update skip locked
  loop
    if t.kind = any(v_msg_kinds) then
      if not coalesce((t.payload->>'manual')::boolean, false) and not v_in_window then continue; end if;
      if t.kind='reply_message' and v_replies >= coalesce((s.messaging->>'reply_per_day')::integer, 80) then continue; end if;
      if v_last_msg is not null and v_last_msg > now() - make_interval(secs => v_gap) then continue; end if;
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
revoke all on function public.claim_vinted_agent_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_vinted_agent_task(uuid) to service_role;
