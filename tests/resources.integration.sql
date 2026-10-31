begin;
do $$
declare resource uuid:=gen_random_uuid(); n integer;
begin
  if has_table_privilege('anon','public.creative_resources','SELECT') or has_table_privilege('authenticated','public.creative_resources','SELECT')
    or has_table_privilege('authenticated','public.creative_resources','INSERT') then raise exception 'Resources exposed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.creative_resources'::regclass) then raise exception 'RLS disabled'; end if;
  if not has_table_privilege('service_role','public.creative_resources','INSERT') then raise exception 'Server cannot save'; end if;
  insert into public.creative_resources(id,kind,title,content) values(resource,'prompt','ROLLBACK',E'  Article\nsur fond  ');
  if (select content from public.creative_resources where id=resource)<>E'  Article\nsur fond  ' then raise exception 'Prompt formatting lost'; end if;
  update public.creative_resources set content='Revised',version=2 where id=resource and version=1;
  update public.creative_resources set content='Stale write' where id=resource and version=1;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Stale update accepted'; end if;
  update public.creative_resources set archived_at=now() where id=resource;
  update public.creative_resources set archived_at=null where id=resource;
  if (select content from public.creative_resources where id=resource)<>'Revised' then raise exception 'Archive erased content'; end if;
  begin
    insert into public.creative_resources(kind,title) values('background','Missing image');
    raise exception 'Background without image accepted';
  exception when check_violation then null; end;
  if exists(select 1 from public.fonds f where f.image_url like 'https://xnclywhkqpdulogykvoy.supabase.co/storage/v1/object/public/fonds/%'
    and not exists(select 1 from public.creative_resources r where r.legacy_fond_id=f.id)) then raise exception 'Legacy background missing'; end if;
end $$;
rollback;
select 'Resource access, persistence, version conflicts, archive and legacy backgrounds verified; fixtures rolled back' as result;
