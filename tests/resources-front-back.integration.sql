begin;
set local role service_role;
do $$
declare resource uuid:=gen_random_uuid(); n integer;
begin
  insert into public.creative_resources(id,kind,title,content,image_bucket,image_path)
    values(resource,'background','Temporary test',E'  Avant\nOriginal  ','fonds','test-only.png');
  if (select content_back from public.creative_resources where id=resource)<>'' then raise exception 'Missing default'; end if;
  update public.creative_resources set content_back=E'  Arrière\nDos  ',version=2 where id=resource and version=1;
  update public.creative_resources set content='Avant modifié',version=3 where id=resource and version=2;
  if (select content_back from public.creative_resources where id=resource)<>E'  Arrière\nDos  ' then raise exception 'Rear text lost'; end if;
  begin
    update public.creative_resources set content_back=repeat('x',50001) where id=resource;
    raise exception 'Oversized rear text accepted';
  exception when check_violation then null; end;
  delete from public.creative_resources where id=resource and version=2;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'Stale deletion accepted'; end if;
  update public.creative_resources set content_back='' where id=resource;
  if (select content from public.creative_resources where id=resource)<>'Avant modifié' then raise exception 'Clearing rear erased front'; end if;
  delete from public.creative_resources where id=resource and version=3;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'Delete failed'; end if;
  if has_table_privilege('anon','public.creative_resources','DELETE') or has_table_privilege('authenticated','public.creative_resources','DELETE') then raise exception 'Direct client delete exposed'; end if;
end $$;
rollback;
select 'Independent front/rear text, length limit, stale deletion and access verified; test data rolled back' as result;
