-- Additional prerequisites for the original sales migration, in disposable CI only.
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create view public.dotb_tracking_period as select '2026-10-30T00:00:00+01:00'::timestamptz as starts_at;
grant select on public.dotb_tracking_period to service_role;
