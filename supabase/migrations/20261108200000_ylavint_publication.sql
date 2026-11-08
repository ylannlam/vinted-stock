begin;
alter table public.listing_drafts add column publish_provider text check (publish_provider in ('dotb','ylavint','manual'));
alter table public.listing_drafts add column publication_task_id uuid references public.vinted_agent_tasks(id);
update public.listing_drafts set publish_provider='dotb' where dotb_item_id is not null;

-- La réservation de créneau et la tâche sont une seule transaction : jamais deux prestataires pour la même fiche.
create function public.queue_ylavint_listing(p_id uuid,p_owner uuid,p_version integer,p_payload jsonb,p_spacing integer,p_not_before timestamptz,p_live boolean)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare d public.listing_drafts; t uuid; s public.vinted_agent_settings;
begin
 if p_live is null then raise exception 'Publication mode required';end if;
 select * into d from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='draft' and dotb_item_id is null and publication_task_id is null;
 if not found then return;end if;
 select * into s from public.vinted_agent_settings where account_id=(d.fields->>'account_id')::uuid;
 if not found or not s.enabled or not coalesce((s.features->>'publish')::boolean,false) then raise exception 'Publication YlaVint non activée';end if;
 if p_payload->'fields'->>'account_id' is distinct from d.fields->>'account_id' or jsonb_array_length(p_payload->'photos') not between 1 and 20 then raise exception 'Invalid listing snapshot';end if;
 select * into d from public.reserve_listing_slot(p_id,p_owner,p_version,p_payload,p_spacing,p_not_before);
 if not found then return;end if;
 insert into public.vinted_agent_tasks(account_id,kind,writes,payload,dedupe_key,not_before,priority,created_by)
 values((d.fields->>'account_id')::uuid,'publish_item',true,jsonb_build_object('draft_id',d.id,'live',p_live,'listing',p_payload),'publish:'||d.id||':'||d.version,d.planned_at,2,p_owner) returning id into t;
 return query update public.listing_drafts set publish_provider='ylavint',publication_task_id=t,state='scheduled',dotb_publish=p_live,scheduled_at=planned_at,
 message=case when p_live then 'Publication' else 'Brouillon Vinted' end||' confié à YlaVint pour le '||to_char(planned_at at time zone 'Europe/Paris','DD/MM à HH24:MI')||'. Garde le profil AdsPower et le Bridge YlaVint ouverts. Les horaires et plafonds du compte restent applicables.'
 where id=d.id returning *;
end $$;
revoke all on function public.queue_ylavint_listing(uuid,uuid,integer,jsonb,integer,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.queue_ylavint_listing(uuid,uuid,integer,jsonb,integer,timestamptz,boolean) to service_role;

-- Même ordre de verrous que le moteur : tâche puis fiche. Une annulation gagne avant le départ, ou échoue sans rien changer.
create function public.cancel_ylavint_listing(p_id uuid,p_owner uuid,p_version integer)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare tid uuid;
begin
 select publication_task_id into tid from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='scheduled' and publish_provider='ylavint';
 if tid is null then return;end if;
 update public.vinted_agent_tasks set state='cancelled',finished_at=now() where id=tid and state='queued' and started_at is null;
 if not found then return;end if;
 -- Le déclencheur ci-dessous remet la fiche en brouillon dans cette même transaction.
 return query select * from public.listing_drafts where id=p_id and owner_id=p_owner and state='draft';
end $$;
revoke all on function public.cancel_ylavint_listing(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.cancel_ylavint_listing(uuid,uuid,integer) to service_role;

-- Le suivi ne dépend pas de l'onglet du site : arrêt du profil, expiration et résultat mettent la fiche à jour atomiquement.
create function public.track_ylavint_listing() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.kind<>'publish_item' or new.state=old.state then return new;end if;
 if new.state='running' then
  update public.listing_drafts set state='preparing',version=version+1,updated_at=now(),message='YlaVint envoie les photos puis crée l’annonce sur le compte choisi…' where publication_task_id=new.id and state='scheduled';
 elsif new.state='cancelled' and old.state='queued' and old.started_at is null then
  update public.listing_drafts set state='draft',publication_task_id=null,publish_provider=null,payload=null,planned_at=null,scheduled_at=null,version=version+1,updated_at=now(),message='Envoi YlaVint annulé avant son départ. La fiche reste prête.' where publication_task_id=new.id and state='scheduled';
 elsif new.state='failed' then
  update public.listing_drafts set state='attention',version=version+1,updated_at=now(),last_error=new.error,message=coalesce(new.error,'Envoi interrompu.')||' Vérifie le dressing et les brouillons Vinted. Aucun renvoi automatique.' where publication_task_id=new.id and state in ('scheduled','preparing');
 elsif new.state='done' then
  if not coalesce((new.result->>'vinted_id')~'^[1-9][0-9]{0,17}$',false) or (new.result->>'draft')::boolean is distinct from not (new.payload->>'live')::boolean then raise exception 'Invalid publication result';end if;
  update public.listing_drafts set state=case when (new.result->>'draft')::boolean then 'vinted_draft' else 'published' end,vinted_id=new.result->>'vinted_id',
   published_at=case when (new.result->>'draft')::boolean then null else now() end,uploaded=jsonb_array_length(photos),last_error=null,message=new.result->>'message',version=version+1,updated_at=now(),checked_at=now()
   where publication_task_id=new.id and state in ('scheduled','preparing');
 end if;
 return new;
end $$;
create trigger ylavint_listing_task_state after update of state on public.vinted_agent_tasks for each row execute function public.track_ylavint_listing();
revoke all on function public.track_ylavint_listing() from public,anon,authenticated;

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
  v_msg_kinds text[] := array['reply_message','like_message','order_message','accept_offer'];
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
    if t.kind='publish_item' then
      if not coalesce((s.features->>'publish')::boolean,false) or coalesce(s.extension_version,'') !~ '^[0-9]+[.][0-9]+[.][0-9]+$' then continue;end if;
      if (split_part(s.extension_version,'.',1)::integer,split_part(s.extension_version,'.',2)::integer)<(3,7) then continue;end if;
      if not exists(select 1 from public.listing_drafts d where d.publication_task_id=t.id and d.publish_provider='ylavint' and d.state='scheduled' and d.owner_id=t.created_by and d.fields->>'account_id'=p_account::text) then
        update public.vinted_agent_tasks set state='failed',finished_at=now(),error='La fiche ne correspond plus à cette tâche.' where id=t.id;continue;
      end if;
    end if;
    if t.kind='accept_offer' then
      if not coalesce((s.messaging->'offers'->>'enabled')::boolean,false) then continue; end if;
      select count(*) into v_kind_count from public.vinted_agent_tasks
        where account_id=p_account and kind='accept_offer' and started_at >= now()-make_interval(days=>coalesce((s.messaging->'offers'->>'period_days')::integer,1))
          and payload->'offer'->>'buyer_id'=t.payload->'offer'->>'buyer_id';
      if v_kind_count >= coalesce((s.messaging->'offers'->>'max_per_buyer')::integer,5) then continue; end if;
    end if;
    if t.kind = any(v_msg_kinds) then
      if not coalesce((t.payload->>'manual')::boolean, false) and not v_in_window then continue; end if;
      if t.kind='reply_message' and not coalesce((s.messaging->>'reply_unlimited')::boolean,false) and v_replies >= coalesce((s.messaging->>'reply_per_day')::integer, 80) then continue; end if;
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
        lease_until=now()+case when t.kind='publish_item' then interval '10 minutes' else interval '4 minutes' end, started_at=now(), error=null
      where id=t.id returning * into t;
    return jsonb_build_object('state','task','task',to_jsonb(t));
  end loop;
  return jsonb_build_object('state','idle','task',null);
end; $$;
revoke all on function public.claim_vinted_agent_task(uuid) from public, anon, authenticated;
grant execute on function public.claim_vinted_agent_task(uuid) to service_role;

commit;
