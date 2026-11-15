begin;
-- Queueing does not start the worker or override a pause. Claim guards remain unchanged.
create or replace function public.queue_ylavint_listing(p_id uuid,p_owner uuid,p_version integer,p_payload jsonb,p_spacing integer,p_not_before timestamptz,p_live boolean)
returns setof public.listing_drafts language plpgsql security invoker set search_path='' as $$
declare d public.listing_drafts; s public.vinted_agent_settings; t uuid;
begin
 if p_not_before is not null or p_payload->>'assisted' is distinct from 'true' then raise exception 'Form preparation requires an explicit immediate request';end if;
 select * into d from public.listing_drafts where id=p_id and owner_id=p_owner and version=p_version and state='draft' and dotb_item_id is null and publication_task_id is null;
 if not found then return;end if;
 select * into s from public.vinted_agent_settings where account_id=(d.fields->>'account_id')::uuid for update;
 if not found or not s.enabled or not coalesce((s.features->>'publish')::boolean,false) then raise exception 'Publication non activée sur ce compte';end if;
 if coalesce(s.messaging->>'executor','extension') is distinct from coalesce(p_payload->>'execution','extension') then raise exception 'Le mode du compte a changé';end if;
 if p_payload->>'execution'='desktop' then
  if jsonb_typeof(p_payload->'submit') is distinct from 'boolean' then raise exception 'Choisis publier ou préparer';end if;
 else
 if s.paused then raise exception 'Compte en pause';end if;
 if coalesce(s.extension_version,'') !~ '^[0-9]+[.][0-9]+[.][0-9]+$' then raise exception 'YlaVint 3.8 requis';end if;
 if (split_part(s.extension_version,'.',1)::integer,split_part(s.extension_version,'.',2)::integer)<(3,8) then raise exception 'YlaVint 3.8 requis';end if;
 end if;
 if p_payload->'fields'->>'account_id' is distinct from d.fields->>'account_id' or jsonb_typeof(p_payload->'photos') is distinct from 'array' or jsonb_array_length(p_payload->'photos') not between 1 and 20 then raise exception 'Invalid form snapshot';end if;
 if p_payload->>'execution' is distinct from 'desktop' and exists(select 1 from public.vinted_agent_tasks where account_id=s.account_id and kind='publish_item' and state in ('queued','running')) then raise exception 'Un formulaire attend déjà sur ce compte. Termine sa préparation avant le suivant.';end if;
 update public.listing_drafts set state='scheduled',payload=p_payload,publish_provider='ylavint',planned_at=now(),scheduled_at=now(),dotb_publish=false,version=version+1,updated_at=now(),last_error=null,message=case when p_payload->>'execution'='desktop' then 'Annonce dans la file de l’Assistant PC. Démarre cet assistant pour la traiter ; ses pauses, horaires et plafonds restent respectés.' else 'Formulaire demandé. Garde le Bridge ouvert ; tu valideras sur Vinted.' end
 where id=p_id and owner_id=p_owner and version=p_version and state='draft' and publication_task_id is null returning * into d;
 if not found then return;end if;
 insert into public.vinted_agent_tasks(account_id,kind,writes,payload,dedupe_key,not_before,priority,created_by)
 values(s.account_id,'publish_item',true,jsonb_build_object('draft_id',d.id,'live',coalesce(p_payload->>'execution'='desktop' and p_payload->>'submit'='true',false),'listing',p_payload),'form:'||d.id||':'||d.version,now(),2,p_owner) returning id into t;
 return query update public.listing_drafts set publication_task_id=t where id=d.id returning *;
end $$;
revoke all on function public.queue_ylavint_listing(uuid,uuid,integer,jsonb,integer,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.queue_ylavint_listing(uuid,uuid,integer,jsonb,integer,timestamptz,boolean) to service_role;
commit;
