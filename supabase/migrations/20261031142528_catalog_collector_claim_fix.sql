create or replace function public.claim_catalog_collection(p_device uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.catalog_collection_jobs; d public.catalog_collectors;
begin
  select * into d from public.catalog_collectors where id=p_device and revoked_at is null and expires_at>now() for update;
  if not found then raise exception 'device_revoked'; end if;
  update public.catalog_collectors set last_seen_at=now() where id=p_device;
  if not d.enabled then return jsonb_build_object('paused',true,'job',null); end if;
  update public.catalog_collection_jobs set status=case when attempts>=3 then 'failed' else 'queued' end,
    message='La connexion au PC a été interrompue.',lease=null,lease_expires_at=null
    where status='running' and lease_expires_at<now();
  update public.catalog_products p set collection_status='failed',collection_message='La connexion au PC a été interrompue. Relancez la récupération.',next_check_at=null
    where p.collection_status='running' and exists(select 1 from public.catalog_collection_jobs task where task.product_id=p.id and task.status='failed')
    and not exists(select 1 from public.catalog_collection_jobs task where task.product_id=p.id and task.status in ('queued','running'));
  perform public.queue_catalog_sources();
  -- A collector processes exactly one job at a time, even if a claim response is lost.
  select * into j from public.catalog_collection_jobs where collector_id=p_device and status='running' and lease_expires_at>now() order by created_at limit 1;
  if found then return jsonb_build_object('paused',false,'job',to_jsonb(j)); end if;
  select * into j from public.catalog_collection_jobs where status='queued' order by created_at,id for update skip locked limit 1;
  if not found then return jsonb_build_object('paused',false,'job',null); end if;
  update public.catalog_collection_jobs set status='running',attempts=attempts+1,collector_id=p_device,
    lease=gen_random_uuid(),lease_expires_at=now()+interval '3 minutes',started_at=now(),message=null where id=j.id returning * into j;
  update public.catalog_products set collection_status='running',collection_message=null where id=j.product_id;
  return jsonb_build_object('paused',false,'job',to_jsonb(j));
end; $$;