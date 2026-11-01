begin;
set local role service_role;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); bg uuid:=gen_random_uuid();
begin
 if has_table_privilege('anon','public.creative_accounts','SELECT') or has_table_privilege('authenticated','public.creative_accounts','UPDATE') then raise exception 'Client access exposed'; end if;
 if has_function_privilege('authenticated','public.sync_creative_accounts(jsonb)','EXECUTE') then raise exception 'Sync exposed'; end if;
 if not (select relrowsecurity from pg_class where oid='public.creative_accounts'::regclass) then raise exception 'RLS missing'; end if;
 perform public.sync_creative_accounts(jsonb_build_array(jsonb_build_object('id',a,'login','Test A'),jsonb_build_object('id',b,'login','Test B')));
 if (select enabled from public.creative_accounts where id=a) then raise exception 'New account automatically selected'; end if;
 perform public.select_creative_accounts(jsonb_build_array(jsonb_build_object('id',a,'version',1,'enabled',true)));
 insert into public.creative_resources(id,kind,title,content,content_back,image_bucket,image_path) values(bg,'background','Test DA','Front','Rear','fonds','test-only.png');
 update public.creative_accounts set background_id=bg,prompt_back=E'Custom\nrear',notes='Keep',version=3 where id=a;
 perform public.sync_creative_accounts(jsonb_build_array(jsonb_build_object('id',a,'login','Renamed A')));
 if not (select enabled and background_id=bg and prompt_back=E'Custom\nrear' and notes='Keep' and version=3 and login='Renamed A' from public.creative_accounts where id=a) then raise exception 'Sync overwrote DA'; end if;
 if (select source_present from public.creative_accounts where id=b) then raise exception 'Missing account not identified'; end if;
 begin
  perform public.select_creative_accounts(jsonb_build_array(jsonb_build_object('id',a,'version',3,'enabled',false),jsonb_build_object('id',b,'version',999,'enabled',true)));
  raise exception 'Stale selection accepted';
 exception when raise_exception then if sqlerrm<>'stale_account' then raise; end if; end;
 if not (select enabled from public.creative_accounts where id=a) then raise exception 'Partial selection applied'; end if;
 perform public.select_creative_accounts(jsonb_build_array(jsonb_build_object('id',a,'version',3,'enabled',false)));
 if (select prompt_back from public.creative_accounts where id=a)<>E'Custom\nrear' then raise exception 'Deselection erased DA'; end if;
 delete from public.creative_resources where id=bg;
 if (select background_id from public.creative_accounts where id=a) is not null then raise exception 'Deleted background reference remains'; end if;
 if (select prompt_back from public.creative_accounts where id=a)<>E'Custom\nrear' then raise exception 'Deleted background erased override'; end if;
end $$;
rollback;
select 'Account sync, selection persistence, atomic conflicts, DA preservation, deleted backgrounds and access verified; fixtures rolled back' as result;
