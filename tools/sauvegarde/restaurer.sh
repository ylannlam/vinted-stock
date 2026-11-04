#!/usr/bin/env bash
# A local empty database is required by default. Production is always refused.
set -euo pipefail
umask 077
src=${1:?dossier manquant}
export PGDATABASE=${2:?adresse de la base cible manquante}
"${PYTHON:-python3}" - <<'PY'
import os, urllib.parse
target = os.environ['PGDATABASE']
url = urllib.parse.urlparse(target)
if 'xnclywhkqpdulogykvoy' in urllib.parse.unquote(target).lower():
    raise SystemExit('Restauration refusée sur le projet de production.')
if url.scheme not in ('postgres', 'postgresql') or not url.hostname:
    raise SystemExit('Adresse PostgreSQL invalide.')
if url.hostname not in ('localhost', '127.0.0.1', '::1') and os.environ.get('ALLOW_REMOTE_RESTORE') != 'new-empty-project':
    raise SystemExit('Une restauration distante exige ALLOW_REMOTE_RESTORE=new-empty-project et une base vide.')
PY
for f in roles.sql schema.sql data.sql; do
  [ -s "$src/$f" ] || { echo "Fichier manquant ou vide : $f" >&2; exit 1; }
done
if { [ -f "$src/migrations-schema.sql" ] && [ ! -f "$src/migrations-data.sql" ]; } || { [ ! -f "$src/migrations-schema.sql" ] && [ -f "$src/migrations-data.sql" ]; }; then
  echo 'Historique des migrations incomplet.' >&2; exit 1
fi
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
# SQL/COPY errors can contain private rows. Never print them in public CI logs.
if ! count=$(psql --dbname "$PGDATABASE" -X -At --no-password --set ON_ERROR_STOP=1 --command "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','app_private') AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e');" 2>"$tmp/error.log"); then
  echo 'Connexion ou contrôle de la base cible impossible.' >&2; exit 1
fi
[ "$count" = 0 ] || { echo 'Restauration refusée : la base contient déjà des tables applicatives.' >&2; exit 1; }
if ! psql --dbname "$PGDATABASE" -X --quiet --no-password --set ON_ERROR_STOP=1 >"$tmp/check.log" 2>"$tmp/error.log" <<'SQL'
DO $$ DECLARE target text; occupied boolean; BEGIN
  FOREACH target IN ARRAY ARRAY['auth.users','storage.objects','storage.buckets'] LOOP
    IF to_regclass(target) IS NOT NULL THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s)', target) INTO occupied;
      IF occupied THEN RAISE EXCEPTION 'Target not empty'; END IF;
    END IF;
  END LOOP;
END $$;
SQL
then echo 'Restauration refusée : la cible doit être vide et accessible.' >&2; exit 1; fi
args=(--file "$src/roles.sql"
  --command 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated'
  --file "$src/schema.sql" --command 'SET session_replication_role = replica' --file "$src/data.sql")
if [ -f "$src/migrations-schema.sql" ] && [ -f "$src/migrations-data.sql" ]; then
  args+=(--file "$src/migrations-schema.sql" --file "$src/migrations-data.sql")
fi
if [ -f "$src/policies.sql" ]; then args+=(--file "$src/policies.sql"); fi
if ! psql --dbname "$PGDATABASE" -X --quiet --no-password --single-transaction --set ON_ERROR_STOP=1 "${args[@]}" >"$tmp/restore.log" 2>"$tmp/error.log"; then
  echo 'Restauration échouée et annulée. Vérifier les versions, extensions et fichiers dans un environnement privé.' >&2; exit 1
fi
echo 'Restauration terminée en une transaction.'
