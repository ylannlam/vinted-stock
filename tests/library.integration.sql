-- Bibliothèque (articles ajoutés, postés sur Dotb, vendus). Tout est annulé à la fin.
begin;
set local role service_role;
do $$
declare
  added text:='LIB_'||replace(gen_random_uuid()::text,'-','');
  posted text:='POST_'||replace(gen_random_uuid()::text,'-','');
  gone text:='GONE_'||replace(gen_random_uuid()::text,'-','');
  supplier text:='77'||floor(random()*1000000000000)::bigint::text;
  device uuid:=gen_random_uuid(); user_id uuid; job_id uuid; product uuid; my_lease uuid:=gen_random_uuid();
  old_item uuid:=gen_random_uuid(); new_item uuid:=gen_random_uuid(); state jsonb;
begin
  select id into user_id from public.profiles where role='admin' limit 1;
  assert not public.is_sold_catalog_reference(added,null),'An unknown SKU is not tracked';

  -- Ajout manuel d'un SKU : enregistré une seule fois et mis en file pour le PC.
  assert public.library_add_references(jsonb_build_array(jsonb_build_object('reference_key','sku:'||lower(added),'input',added,'expected_sku',added)),'manual',user_id)=1,'A new SKU is queued';
  assert public.library_add_references(jsonb_build_array(jsonb_build_object('reference_key','sku:'||lower(added),'input',added,'expected_sku',added)),'manual',user_id)=0,'A queued SKU is not queued twice';
  assert (select count(*) from public.catalog_library where lower(sku)=lower(added))=1,'The library keeps one row per SKU';
  assert public.is_sold_catalog_reference(added,null),'A library SKU is tracked';
  assert (select count(*) from public.catalog_collection_jobs where expected_sku=added and status='queued')=1,'One queued job';

  -- Ajout par lien : le PC renvoie la fiche, le produit entre dans la bibliothèque (non vendu).
  perform public.library_add_references(jsonb_build_array(jsonb_build_object('reference_key','product:'||supplier,'input','https://fr.shein.com/Robe-p-'||supplier||'.html','expected_supplier_id',supplier)),'listing',user_id);
  insert into public.catalog_collectors(id,name,token_hash,created_by) values(device,'Test bibliothèque',repeat('c',64),user_id);
  select id into job_id from public.catalog_collection_jobs where expected_supplier_id=supplier and status='queued';
  update public.catalog_collection_jobs set status='running',collector_id=device,lease=my_lease,lease_expires_at=now()+interval '3 minutes' where id=job_id;
  product:=public.finish_catalog_collection(job_id,device,my_lease,jsonb_build_object('supplier_id',supplier,'supplier_url','https://fr.shein.com/Robe-p-'||supplier||'.html',
    'supplier_sku','SZLINK'||supplier,'title','Robe longue fleurie','price','12.50','photos','[]'::jsonb,'description','Longueur : 120 cm','details','[{"name":"Longueur","value":"120 cm"}]'::jsonb,
    'sizes','[{"size":"S","availability":"available"}]'::jsonb,'color','Rose','observed_at',now()));
  assert product is not null,'A library link result creates its product';
  assert exists(select 1 from public.catalog_sku_links where sku='SZLINK'||supplier and product_id=product),'The SKU found on Shein is linked';
  assert exists(select 1 from public.catalog_library_products where id=product and not sold and added_at is not null),'Library product is listed, not sold';
  assert not exists(select 1 from public.catalog_tracked_products where id=product),'Sold-only views are unchanged';

  -- Relevé automatique : pas avant 24 h, pas après un échec récent.
  assert not exists(select 1 from public.catalog_collection_jobs where expected_supplier_id=supplier and status='queued'),'Completed job is not queued';
  perform public.queue_library_sources();
  assert not exists(select 1 from public.catalog_collection_jobs where expected_supplier_id=supplier and status='queued'),'A fresh product is not refreshed';
  update public.catalog_observations set observed_at=now()-interval '25 hours' where product_id=product;
  update public.catalog_collection_jobs set created_at=now()-interval '25 hours' where expected_supplier_id=supplier;
  perform public.queue_catalog_sources();
  assert exists(select 1 from public.catalog_collection_jobs where expected_supplier_id=supplier and status='queued'),'A product older than 24 h is refreshed by the poll';

  -- Catégorie et prix choisis.
  insert into public.catalog_product_meta(product_id,category,sale_price,updated_by) values(product,'robe',39,user_id);
  assert (select category='robe' and sale_price=39 from public.catalog_library_products where id=product),'Meta is exposed';
  begin
    update public.catalog_product_meta set category='chaussure' where product_id=product;
    raise exception 'Unknown category accepted';
  exception when check_violation then null; end;

  -- Relevé Dotb : bail exclusif, articles absents du relevé complet marqués « non présents ».
  insert into public.catalog_dotb_items(id,sku,title,synced_at,present) values(old_item,gone,'Ancienne annonce',now()-interval '2 days',true);
  update public.catalog_sync_state set cursor=null,lease=null,locked_until='-infinity' where id;
  state:=public.library_claim_dotb_sync(my_lease);
  assert state->>'cursor' is null,'A new cycle starts from the first page';
  begin
    perform public.library_claim_dotb_sync(gen_random_uuid());
    raise exception 'Two syncs accepted';
  exception when others then if sqlerrm not like '%sync_running%' then raise; end if; end;
  perform public.library_import_dotb_page(jsonb_build_array(jsonb_build_object('id',new_item,'sku',posted,'title','Robe postée','status','published','price','39','currency','EUR')),'next-page',my_lease);
  assert (select cursor='next-page' from public.catalog_sync_state where id),'Cursor saved between pages';
  perform public.library_import_dotb_page('[]'::jsonb,null,my_lease);
  assert (select not present from public.catalog_dotb_items where id=old_item),'Missing item is no longer present';
  assert (select present from public.catalog_dotb_items where id=new_item),'Seen item stays present';
  assert (select lease is null and last_completed_at is not null from public.catalog_sync_state where id),'Lease released at the end';
  assert exists(select 1 from public.catalog_library_posted where sku=posted),'Posted view lists present items';
  assert not exists(select 1 from public.catalog_library_posted where sku=gone),'Posted view hides removed items';
  assert public.is_sold_catalog_reference(posted,null),'A posted SKU can be collected';
  assert not public.is_sold_catalog_reference(gone,null),'A removed listing is not tracked';
  begin
    perform public.library_import_dotb_page('[]'::jsonb,null,my_lease);
    raise exception 'Expired lease accepted';
  exception when others then if sqlerrm not like '%sync_lease_expired%' then raise; end if; end;

  -- Un SKU d'annonce introuvable n'est pas relancé tout seul ; un ajout manuel l'est au bout de 24 h.
  insert into public.catalog_library(sku,input,source) values('TYPO_'||substr(added,5,20),'typo','listing'),('MANU_'||substr(added,5,20),'manu','manual');
  insert into public.catalog_collection_jobs(reference_key,input,expected_sku,status,created_at) values
    ('sku:'||lower('TYPO_'||substr(added,5,20)),'typo','TYPO_'||substr(added,5,20),'failed',now()-interval '25 hours'),
    ('sku:'||lower('MANU_'||substr(added,5,20)),'manu','MANU_'||substr(added,5,20),'failed',now()-interval '25 hours');
  perform public.queue_library_sources();
  assert not exists(select 1 from public.catalog_collection_jobs where expected_sku='TYPO_'||substr(added,5,20) and status='queued'),'A failed listing SKU is not retried automatically';
  assert exists(select 1 from public.catalog_collection_jobs where expected_sku='MANU_'||substr(added,5,20) and status='queued'),'A failed manual SKU is retried after 24 h';

  assert not has_table_privilege('authenticated','public.catalog_library','SELECT'),'Library stays server-only';
  assert not has_table_privilege('authenticated','public.catalog_library_products','SELECT'),'Library view stays server-only';
  assert not has_function_privilege('authenticated','public.library_add_references(jsonb,text,uuid)','EXECUTE'),'Library writes stay server-only';
end $$;
rollback;
