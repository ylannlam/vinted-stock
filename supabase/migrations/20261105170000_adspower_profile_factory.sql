begin;
-- Création de profils AdsPower depuis le site (onglet AdsPower → « Profils et proxys »).
-- Le connecteur du PC crée ou modifie le profil dans AdsPower ; la base garde le lien
-- compte ↔ proxy ↔ profil et l'historique des empreintes. Aucun mot de passe n'est copié ici.

-- 1. Un même proxy (adresse, port, identifiant) n'est enregistré qu'une fois.
--    Decodo : même identifiant, un port par IP. Oxylabs ISP dédié : même port 8001, un identifiant par IP.
update public.proxies set adresse=lower(btrim(adresse)) where adresse is distinct from lower(btrim(adresse));
alter table public.proxies add constraint proxies_endpoint_check
 check(adresse=lower(adresse) and char_length(adresse) between 1 and 253 and port between 1 and 65535 and char_length(username) between 1 and 200);
create unique index proxies_endpoint_key on public.proxies(adresse,port,username);

-- 2. Historique des empreintes : une ligne par création ou remplacement d'empreinte.
create table public.adspower_fingerprint_log (
 id uuid primary key default gen_random_uuid(),
 profile_id text not null check(profile_id ~ '^[A-Za-z0-9_-]{1,80}$'),
 profile_no text check(profile_no ~ '^[0-9]{1,12}$'),
 account_id uuid references public.vinted_accounts(id) on delete set null,
 proxy_id uuid references public.proxies(id) on delete set null,
 action text not null check(action in ('create','update')),
 resolution text not null check(resolution ~ '^[0-9]{3,4}_[0-9]{3,4}$'),
 threads smallint not null check(threads between 1 and 64),
 gpu text not null check(char_length(gpu) between 3 and 80),
 chrome_major smallint check(chrome_major between 90 and 999),
 created_by uuid not null default auth.uid() references public.profiles(id),
 created_at timestamptz not null default now()
);
create index adspower_fingerprint_log_profile_idx on public.adspower_fingerprint_log(profile_id,created_at desc);
create unique index adspower_fingerprint_log_create_key on public.adspower_fingerprint_log(profile_id) where action='create';
alter table public.adspower_fingerprint_log enable row level security;
revoke all on public.adspower_fingerprint_log from public,anon,authenticated;
grant select,insert on public.adspower_fingerprint_log to authenticated;
grant all on public.adspower_fingerprint_log to service_role;
create policy adspower_fingerprint_log_read on public.adspower_fingerprint_log for select to authenticated
 using ((select public.get_my_role())='admin');
create policy adspower_fingerprint_log_insert on public.adspower_fingerprint_log for insert to authenticated
 with check ((select public.get_my_role())='admin' and created_by=(select auth.uid()));
comment on table public.adspower_fingerprint_log is 'Append-only history of AdsPower fingerprints created or replaced from Stock Vinted. Admin only.';

-- 3. Relier un profil créé à un compte et à son proxy, en une seule transaction.
--    Sans p_profile_id : vérification seule, appelée AVANT de créer le profil dans AdsPower.
--    Avec p_profile_id : enregistre le lien et l'empreinte. Rejouable sans doublon.
create or replace function public.link_adspower_profile(
 p_account uuid,p_proxy uuid,p_profile_id text default null,p_profile_no text default null,
 p_resolution text default null,p_threads integer default null,p_gpu text default null,p_chrome integer default null)
returns public.vinted_accounts language plpgsql security invoker set search_path='' as $$
declare acc public.vinted_accounts;
begin
 if (select public.get_my_role()) is distinct from 'admin' then raise exception 'Action réservée aux administrateurs.' using errcode='42501';end if;
 if p_account is null or p_proxy is null then raise exception 'Choisis un compte et un proxy.' using errcode='22023';end if;
 -- Toujours le proxy puis le compte : deux créations simultanées ne peuvent pas se bloquer.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adspower-proxy:'||p_proxy::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adspower-account:'||p_account::text,0));
 select * into acc from public.vinted_accounts where id=p_account and deleted_at is null for update;
 if not found then raise exception 'Ce compte est introuvable ou à la corbeille.' using errcode='P0002';end if;
 if acc.is_shadowbanned then raise exception 'Ce compte est rangé dans Shadowban.' using errcode='22023';end if;
 if not exists(select 1 from public.proxies where id=p_proxy) then raise exception 'Ce proxy est introuvable.' using errcode='P0002';end if;
 if exists(select 1 from public.vinted_accounts where proxy_id=p_proxy and id<>p_account and deleted_at is null) then
  raise exception 'Ce proxy est déjà utilisé par un autre compte.' using errcode='23505';end if;
 if acc.proxy_id is not null and acc.proxy_id<>p_proxy then
  raise exception 'Ce compte utilise déjà un autre proxy.' using errcode='23505';end if;
 if p_profile_id is null then
  if coalesce(acc.ads_power_num,'')<>'' then raise exception 'Ce compte a déjà le profil AdsPower n° %.',acc.ads_power_num using errcode='23505';end if;
  return acc;
 end if;
 if p_profile_id !~ '^[A-Za-z0-9_-]{1,80}$' or coalesce(p_profile_no,'') !~ '^[0-9]{1,12}$' then
  raise exception 'Profil AdsPower invalide.' using errcode='22023';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adspower-profile:'||p_profile_id,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('adspower-number:'||p_profile_no,0));
 if exists(select 1 from public.adspower_fingerprint_log where profile_id=p_profile_id and action='create'
   and (account_id is distinct from p_account or proxy_id is distinct from p_proxy or profile_no is distinct from p_profile_no)) then
  raise exception 'Ce profil AdsPower est déjà relié à un autre compte ou proxy.' using errcode='23505';end if;
 if coalesce(acc.ads_power_num,'') not in ('',p_profile_no) then
  raise exception 'Ce compte a déjà le profil AdsPower n° %.',acc.ads_power_num using errcode='23505';end if;
 if exists(select 1 from public.vinted_accounts where ads_power_num=p_profile_no and id<>p_account and deleted_at is null) then
  raise exception 'Le profil AdsPower n° % est déjà relié à un autre compte.',p_profile_no using errcode='23505';end if;
 insert into public.adspower_fingerprint_log(profile_id,profile_no,account_id,proxy_id,action,resolution,threads,gpu,chrome_major)
  values(p_profile_id,p_profile_no,p_account,p_proxy,'create',p_resolution,p_threads,p_gpu,p_chrome)
  on conflict (profile_id) where action='create' do nothing;
 update public.vinted_accounts set ads_power_num=p_profile_no,proxy_id=p_proxy where id=p_account returning * into acc;
 return acc;
end $$;
revoke all on function public.link_adspower_profile(uuid,uuid,text,text,text,integer,text,integer) from public,anon;
grant execute on function public.link_adspower_profile(uuid,uuid,text,text,text,integer,text,integer) to authenticated,service_role;
commit;
