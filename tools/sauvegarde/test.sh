#!/usr/bin/env bash
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
mkdir "$tmp/source"
printf '%s\n' '-- synthetic roles' > "$tmp/source/roles.sql"
printf '%s\n' 'CREATE TABLE public.backup_fixture(id integer primary key, label text);' > "$tmp/source/schema.sql"
printf '%s\n' "INSERT INTO public.backup_fixture VALUES (1, 'Essai français €');" > "$tmp/source/data.sql"
printf '%s\n' '-- synthetic policies' > "$tmp/source/policies.sql"
export BACKUP_PASSPHRASE='test-only-not-a-real-secret-123456789'
reject() { if "$@" >"$tmp/rejected.log" 2>&1; then echo 'FAIL: action should have been refused' >&2; exit 1; fi; }
bash "$root/chiffrer.sh" "$tmp/source" "$tmp/backup.gpg"
bash "$root/dechiffrer.sh" "$tmp/backup.gpg" "$tmp/restored"
for f in roles.sql schema.sql data.sql policies.sql; do cmp "$tmp/source/$f" "$tmp/restored/$f"; done
reject bash "$root/chiffrer.sh" "$tmp/source" "$tmp/backup.gpg"
reject bash "$root/dechiffrer.sh" "$tmp/backup.gpg" "$tmp/restored"
reject env BACKUP_PASSPHRASE=wrong-password bash "$root/dechiffrer.sh" "$tmp/backup.gpg" "$tmp/wrong"
[ ! -e "$tmp/wrong" ]
head -c 40 "$tmp/backup.gpg" > "$tmp/truncated.gpg"
reject bash "$root/dechiffrer.sh" "$tmp/truncated.gpg" "$tmp/damaged"
[ ! -e "$tmp/damaged" ]
reject bash "$root/chiffrer.sh" "$tmp/missing" "$tmp/missing.gpg"
[ ! -e "$tmp/missing.gpg" ]
reject bash "$root/restaurer.sh" "$tmp/restored" 'postgresql://postgres:fake@db.xnclywhkqpdulogykvoy.supabase.co/postgres'
reject bash "$root/restaurer.sh" "$tmp/restored" 'postgresql://postgres:fake@other.example/postgres'
echo 'PASS: encryption round-trip, wrong password, damaged file, missing files, overwrite and destination guards.'

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  # This variable must point to a disposable database created by the CI service.
  export PGDATABASE="$TEST_DATABASE_URL"
  psql -X -q --set ON_ERROR_STOP=1 --command 'CREATE ROLE anon; CREATE ROLE authenticated;'
  # Model a managed storage table and a policy calling an application function.
  # Its exported expression must still resolve after pg_dump empties search_path.
  psql -X -q --set ON_ERROR_STOP=1 <<'SQL'
CREATE SCHEMA storage;
CREATE TABLE storage.objects(id integer, bucket_id text);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION public.backup_allowed(text) RETURNS boolean LANGUAGE sql AS 'SELECT $1 = ''fixture''';
CREATE POLICY fixture_policy ON storage.objects FOR SELECT TO authenticated USING (public.backup_allowed(bucket_id));
SQL
  psql -X -qAt --set ON_ERROR_STOP=1 --file "$root/policies.sql" > "$tmp/source/policies.sql"
  psql -X -q --set ON_ERROR_STOP=1 --command 'DROP FUNCTION public.backup_allowed(text) CASCADE;'
  cat >> "$tmp/source/schema.sql" <<'SQL'
CREATE FUNCTION public.backup_allowed(text) RETURNS boolean LANGUAGE sql AS 'SELECT $1 = ''fixture''';
SET search_path = '';
SQL
  echo "INSERT INTO storage.objects VALUES (1, 'fixture');" >> "$tmp/source/data.sql"
  echo 'CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text);' > "$tmp/source/migrations-schema.sql"
  echo "INSERT INTO supabase_migrations.schema_migrations VALUES ('test-only');" > "$tmp/source/migrations-data.sql"
  # A failure halfway through must roll back the preceding CREATE and INSERT.
  cp "$tmp/source/data.sql" "$tmp/data-good.sql"
  echo 'INSERT INTO table_that_does_not_exist VALUES (1);' >> "$tmp/source/data.sql"
  reject bash "$root/restaurer.sh" "$tmp/source" "$TEST_DATABASE_URL"
  [ "$(psql -X -At --command "SELECT to_regclass('public.backup_fixture') IS NULL;")" = t ]
  cp "$tmp/data-good.sql" "$tmp/source/data.sql"
  bash "$root/restaurer.sh" "$tmp/source" "$TEST_DATABASE_URL"
  [ "$(psql -X -At --command 'SELECT count(*) FROM public.backup_fixture;')" = 1 ]
  [ "$(psql -X -At --command "SELECT has_table_privilege('anon','public.backup_fixture','SELECT');")" = f ]
  [ "$(psql -X -At --command 'SELECT count(*) FROM supabase_migrations.schema_migrations;')" = 1 ]
  [ "$(psql -X -At --command "SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND policyname='fixture_policy';")" = 1 ]
  reject bash "$root/restaurer.sh" "$tmp/source" "$TEST_DATABASE_URL"
  [ "$(psql -X -At --command 'SELECT count(*) FROM public.backup_fixture;')" = 1 ]
  echo 'PASS: PostgreSQL restore, rollback, grants, migrations, managed-schema policies and refusal of nonempty targets.'
else
  echo 'SKIP: PostgreSQL restore tests require TEST_DATABASE_URL (provided in CI).'
fi
