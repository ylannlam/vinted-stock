-- Bootstrap only for the disposable CI database: minimal copies of the Supabase objects
-- the AdsPower profile factory relies on (roles, auth.uid, profiles, proxies, vinted_accounts).
do $$ begin create role anon;exception when duplicate_object then null;end $$;
do $$ begin create role authenticated;exception when duplicate_object then null;end $$;
do $$ begin create role service_role bypassrls;exception when duplicate_object then null;end $$;
create schema auth;
grant usage on schema auth to authenticated,service_role;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
grant execute on function auth.uid() to authenticated,service_role;
grant usage on schema public to authenticated,service_role;
create table public.profiles(id uuid primary key references auth.users(id),email text,pseudo text,role text);
create or replace function public.get_my_role() returns text
language sql stable security definer set search_path = '' as $$
 select p.role from public.profiles p where p.id = (select auth.uid())
$$;
revoke all on function public.get_my_role() from public, anon;
grant execute on function public.get_my_role() to authenticated, service_role;
create table public.proxies(
 id uuid primary key default gen_random_uuid(),nom text,adresse text not null,port integer not null,
 username text not null,password text not null,fournisseur text,notes text,created_at timestamptz default now());
create table public.vinted_accounts(
 id uuid primary key default gen_random_uuid(),pseudo text not null,ads_power_num text,
 proxy_id uuid references public.proxies(id) on delete set null,statut text,creation_stage text,
 is_ready boolean,is_shadowbanned boolean not null default false,deleted_at timestamptz,created_at timestamptz default now());
alter table public.proxies enable row level security;
alter table public.vinted_accounts enable row level security;
create policy proxies_admin on public.proxies for all using (public.get_my_role()='admin');
create policy vinted_accounts_admin on public.vinted_accounts for all using (public.get_my_role()='admin');
grant select,insert,update,delete on public.proxies,public.vinted_accounts,public.profiles to authenticated;
grant all on public.proxies,public.vinted_accounts,public.profiles to service_role;
