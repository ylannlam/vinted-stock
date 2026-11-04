#!/usr/bin/env bash
set -euo pipefail
umask 077
in=${1:?fichier de sauvegarde manquant}
dest=${2:?dossier de destination manquant}
[ ! -e "$dest" ] || { echo 'Choisis un nouveau dossier de destination.' >&2; exit 1; }
tmp=$(mktemp -d); trap 'rm -rf -- "$tmp"' EXIT
mkdir "$tmp/gnupg"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  ok=0; printf '%s' "$BACKUP_PASSPHRASE" | gpg --homedir "$tmp/gnupg" --batch --quiet \
    --pinentry-mode loopback --passphrase-fd 0 --decrypt --output "$tmp/backup.tar.gz" "$in" 2>/dev/null || ok=$?
else
  ok=0; gpg --homedir "$tmp/gnupg" --quiet --decrypt --output "$tmp/backup.tar.gz" "$in" || ok=$?
fi
if [ "$ok" -ne 0 ]; then echo 'Mot de passe incorrect ou sauvegarde abîmée. Rien extrait.' >&2; exit 1; fi
# Validate all entries before extracting: no paths, links or unexpected files.
"${PYTHON:-python3}" - "$tmp/backup.tar.gz" "$dest" <<'PY'
import pathlib, sys, tarfile
required = {'roles.sql', 'schema.sql', 'data.sql'}
allowed = required | {'migrations-schema.sql', 'migrations-data.sql', 'policies.sql'}
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    entries = archive.getmembers()
    names = [entry.name for entry in entries]
    if not required.issubset(names) or len(names) != len(set(names)) or any(not e.isfile() or e.name not in allowed for e in entries):
        raise SystemExit('Contenu de sauvegarde invalide. Rien extrait.')
    dest = pathlib.Path(sys.argv[2])
    dest.mkdir(mode=0o700)
    for entry in entries:
        with dest.joinpath(entry.name).open('xb') as output:
            output.write(archive.extractfile(entry).read())
PY
echo 'Sauvegarde déchiffrée dans le nouveau dossier.'
