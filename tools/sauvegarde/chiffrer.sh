#!/usr/bin/env bash
set -euo pipefail
umask 077
src=${1:?dossier des dumps manquant}
out=${2:?fichier de sortie manquant}
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE manquant}"
if [ "${#BACKUP_PASSPHRASE}" -lt 16 ]; then echo 'Mot de passe trop court (16 caractères minimum).' >&2; exit 1; fi
[ ! -e "$out" ] || { echo 'Le fichier de sortie existe déjà.' >&2; exit 1; }
files=(roles.sql schema.sql data.sql)
for f in "${files[@]}"; do
  [ -s "$src/$f" ] || { echo "Fichier manquant ou vide : $f" >&2; exit 1; }
done
for f in migrations-schema.sql migrations-data.sql policies.sql; do
  if [ -f "$src/$f" ]; then files+=("$f"); fi
done
if { [ -f "$src/migrations-schema.sql" ] && [ ! -f "$src/migrations-data.sql" ]; } || { [ ! -f "$src/migrations-schema.sql" ] && [ -f "$src/migrations-data.sql" ]; }; then
  echo 'Historique des migrations incomplet.' >&2; exit 1
fi
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
tar -C "$src" -czf "$tmp/backup.tar.gz" "${files[@]}"
# A private keyring avoids changing the user's GnuPG configuration.
mkdir "$tmp/gnupg"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --homedir "$tmp/gnupg" --batch --quiet \
  --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 \
  --s2k-digest-algo SHA512 --s2k-count 65011712 --output "$tmp/backup.gpg" "$tmp/backup.tar.gz"
printf '%s' "$BACKUP_PASSPHRASE" | gpg --homedir "$tmp/gnupg" --batch --quiet \
  --pinentry-mode loopback --passphrase-fd 0 --decrypt "$tmp/backup.gpg" | tar -tzf - >/dev/null
(set -o noclobber; cat "$tmp/backup.gpg" > "$out")
echo 'Archive chiffrée créée et relue avec succès.'
