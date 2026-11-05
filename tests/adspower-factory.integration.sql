begin;
do $$ declare a uuid:=gen_random_uuid();e uuid:=gen_random_uuid();begin
 insert into auth.users(id,email) values(a,a||'@factory-test.invalid'),(e,e||'@factory-test.invalid');
 insert into public.profiles(id,email,pseudo,role) values(a,a||'@factory-test.invalid','Admin test','admin'),(e,e||'@factory-test.invalid','Employé test','employe');
 perform set_config('test.admin',a::text,true);perform set_config('test.employee',e::text,true);
 perform set_config('request.jwt.claim.sub',a::text,true);
end $$;
set local role authenticated;

do $$ declare p1 uuid;p2 uuid;p3 uuid;acc1 uuid;acc2 uuid;acc3 uuid;shadow uuid;gone uuid;r public.vinted_accounts;n integer;begin
 insert into public.proxies(adresse,port,username,password,fournisseur) values('disp.oxylabs.io',8001,'user-disp_aaaa1111','x','Oxylabs') returning id into p1;
 -- Oxylabs : même port, identifiant différent = autre IP, donc autorisé.
 insert into public.proxies(adresse,port,username,password,fournisseur) values('disp.oxylabs.io',8001,'user-disp_bbbb2222','x','Oxylabs') returning id into p2;
 -- Decodo : même identifiant, port différent = autre IP, donc autorisé.
 insert into public.proxies(adresse,port,username,password,fournisseur) values('isp.decodo.com',10001,'spuser','x','Decodo') returning id into p3;
 begin insert into public.proxies(adresse,port,username,password) values('disp.oxylabs.io',8001,'user-disp_aaaa1111','y');raise exception 'duplicate proxy accepted';exception when unique_violation then null;end;
 begin insert into public.proxies(adresse,port,username,password) values('Disp.Oxylabs.io',8001,'user-disp_cccc','y');raise exception 'uppercase host accepted';exception when check_violation then null;end;

 insert into public.vinted_accounts(pseudo,statut,creation_stage) values('TEST-un','actif','ready') returning id into acc1;
 insert into public.vinted_accounts(pseudo,statut,creation_stage) values('TEST-deux','actif','ready') returning id into acc2;
 insert into public.vinted_accounts(pseudo,statut,creation_stage,ads_power_num) values('TEST-trois','actif','ready','40') returning id into acc3;
 insert into public.vinted_accounts(pseudo,statut,is_shadowbanned) values('TEST-shadow','actif',true) returning id into shadow;
 insert into public.vinted_accounts(pseudo,statut,deleted_at) values('TEST-gone','actif',now()) returning id into gone;

 -- Vérification seule : aucune écriture.
 r:=public.link_adspower_profile(acc1,p1);
 if r.ads_power_num is not null or r.proxy_id is not null then raise exception 'precheck wrote data';end if;
 if exists(select 1 from public.adspower_fingerprint_log) then raise exception 'precheck logged';end if;

 -- Liaison réelle puis rejeu (réessai après une coupure) : une seule ligne d'historique.
 r:=public.link_adspower_profile(acc1,p1,'k1abc','41','1920_1080',16,'NVIDIA GeForce RTX 4060',141);
 if r.ads_power_num<>'41' or r.proxy_id<>p1 then raise exception 'link not saved';end if;
 r:=public.link_adspower_profile(acc1,p1,'k1abc','41','1920_1080',16,'NVIDIA GeForce RTX 4060',141);
 select count(*) into n from public.adspower_fingerprint_log where profile_id='k1abc';
 if n<>1 then raise exception 'replay duplicated history: %',n;end if;
 if (select created_by from public.adspower_fingerprint_log where profile_id='k1abc')<>current_setting('test.admin')::uuid then raise exception 'author not recorded';end if;

 -- Refus : proxy déjà pris, compte déjà équipé, numéro déjà pris, shadowban, corbeille, autre proxy.
 begin perform public.link_adspower_profile(acc2,p2,'k1abc','44','1920_1080',8,'NVIDIA GeForce RTX 3060',null);raise exception 'profile id reused with another number';exception when unique_violation then null;end;
 begin perform public.link_adspower_profile(acc2,p1);raise exception 'shared proxy accepted';exception when unique_violation then null;end;
 begin perform public.link_adspower_profile(acc1,p1);raise exception 'second profile precheck accepted';exception when unique_violation then null;end;
 begin perform public.link_adspower_profile(acc3,p2,'k3abc','42','1920_1080',8,'NVIDIA GeForce RTX 3060',null);raise exception 'renumbered account';exception when unique_violation then null;end;
 begin perform public.link_adspower_profile(acc2,p2,'k2abc','41','1920_1080',8,'NVIDIA GeForce RTX 3060',null);raise exception 'number reused';exception when unique_violation then null;end;
 begin perform public.link_adspower_profile(acc1,p2,'k1bis','41','1920_1080',8,'NVIDIA GeForce RTX 3060',null);raise exception 'proxy swapped';exception when unique_violation then null;end;
 begin perform public.link_adspower_profile(shadow,p2);raise exception 'shadowban accepted';exception when invalid_parameter_value then null;end;
 begin perform public.link_adspower_profile(gone,p2);raise exception 'deleted account accepted';exception when no_data_found then null;end;
 begin perform public.link_adspower_profile(acc2,p2,'bad id!','43','1920_1080',8,'NVIDIA GeForce RTX 3060',null);raise exception 'invalid profile accepted';exception when invalid_parameter_value then null;end;
 if exists(select 1 from public.adspower_fingerprint_log where profile_id<>'k1abc') then raise exception 'refused call logged';end if;

 -- Decodo et le second proxy Oxylabs restent utilisables pour d'autres comptes.
 r:=public.link_adspower_profile(acc2,p3,'k2abc','43','2560_1440',16,'NVIDIA GeForce RTX 4070',null);
 if r.proxy_id<>p3 then raise exception 'decodo link failed';end if;

 -- Changement d'empreinte d'un profil existant : écrit directement par le site.
 insert into public.adspower_fingerprint_log(profile_id,profile_no,account_id,proxy_id,action,resolution,threads,gpu,chrome_major)
  values('k1abc','41',acc1,p1,'update','2560_1440',16,'NVIDIA GeForce RTX 4070',141);
 begin insert into public.adspower_fingerprint_log(profile_id,action,resolution,threads,gpu,created_by)
  values('k1abc','update','1920_1080',8,'NVIDIA GeForce RTX 3060',current_setting('test.employee')::uuid);raise exception 'forged author accepted';exception when insufficient_privilege then null;end;
 begin update public.adspower_fingerprint_log set gpu='x';raise exception 'history edited';exception when insufficient_privilege then null;end;
 begin delete from public.adspower_fingerprint_log;raise exception 'history deleted';exception when insufficient_privilege then null;end;
end $$;

-- Un employé ne peut ni relier un profil ni lire l'historique.
do $$ begin perform set_config('request.jwt.claim.sub',current_setting('test.employee'),true);end $$;
do $$ declare acc uuid;n integer;begin
 select count(*) into n from public.adspower_fingerprint_log;
 if n<>0 then raise exception 'employee reads history';end if;
 begin perform public.link_adspower_profile(gen_random_uuid(),gen_random_uuid());raise exception 'employee linked a profile';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$ begin
 if (select count(*) from public.adspower_fingerprint_log)<>3 then raise exception 'unexpected history size';end if;
 if has_table_privilege('anon','public.adspower_fingerprint_log','select') then raise exception 'anon can read history';end if;
 if has_function_privilege('anon','public.link_adspower_profile(uuid,uuid,text,text,text,integer,text,integer)','execute') then raise exception 'anon can link';end if;
end $$;
rollback;
select 'adspower factory integration: ok';
