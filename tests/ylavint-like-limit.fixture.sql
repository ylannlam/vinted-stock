-- Disposable test database only. Load the real agent tables/migration after this bootstrap.
create role anon;
create role authenticated;
create role service_role bypassrls;
create table public.publication_accounts(id uuid primary key);
