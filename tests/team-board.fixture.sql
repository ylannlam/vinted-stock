-- Bootstrap only for the disposable CI database; application tables come from real migrations.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create table auth.users(id uuid primary key,email text);
create table public.profiles(id uuid primary key references auth.users(id),email text,pseudo text,role text);
grant usage on schema public to service_role;
