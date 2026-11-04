# Sauvegarde de la base

Le mécanisme est préparé. Il ne devient une sauvegarde opérationnelle qu'après configuration des secrets, une première exécution réussie et activation du planning.

## Ce que conserve la copie

- Rôles sans leurs mots de passe, structure et données applicatives (ventes, commandes Shein, Budget, Atelier…).
- Données d'authentification, dont les adresses e-mail et les empreintes de mots de passe.
- Historique des migrations et règles d'accès personnalisées des schémas auth/storage.
- Archive chiffrée en AES-256, conservée 30 jours dans GitHub Actions. Le dépôt est public : aucun SQL en clair n'est publié dans les artifacts ou les journaux.
- Chaque copie est déchiffrée puis chargée dans une base de test jetable. L'archive chiffrée est déjà conservée si le test de restauration échoue. Dans ce cas, elle reste **non validée** : il faut examiner l'échec.

**Ne sont pas inclus : les fichiers du stockage** (photos, fonds, bordereaux), les réglages du projet (SMTP, OAuth, clés API), les mots de passe des rôles PostgreSQL et les éventuels ajouts manuels de fonctions/triggers dans les schémas gérés auth/storage. Les fichiers doivent disposer d'une sauvegarde distincte ; leurs emplacements dans la base ne suffisent pas à les récupérer. Les extensions utilisées doivent être disponibles dans la base cible.

## Activation, une seule fois

1. Ouvrir [les secrets GitHub du dépôt](https://github.com/ylannlam/vinted-stock/settings/secrets/actions), connecté au compte propriétaire.
2. Ajouter **SUPABASE_DB_URL** : dans [Supabase](https://supabase.com/dashboard/project/xnclywhkqpdulogykvoy), ouvrir Connect, choisir Session pooler et copier la connexion PostgreSQL. Remplacer le mot de passe fictif par celui de la base, en encodant ses caractères spéciaux dans l'URI. Ne pas utiliser la clé anon ou service_role à sa place. Ne jamais coller cette valeur dans un chat.
3. Ajouter **BACKUP_PASSPHRASE** : mot de passe unique et long, au moins 16 caractères, idéalement généré et conservé dans un gestionnaire de mots de passe. Sa perte rend les anciennes copies illisibles. Le conserver indépendamment de GitHub.
4. Dans [Actions](https://github.com/ylannlam/vinted-stock/actions/workflows/sauvegarde-base.yml), choisir **Run workflow**. Attendre que l'export, le chiffrement et la restauration soient tous verts.
5. Dans Settings → Secrets and variables → Actions → **Variables**, créer **BACKUPS_ENABLED** avec la valeur **true**. Le planning quotidien est alors activé à 03:17 UTC, soit 04:17 en hiver ou 05:17 en été à Paris. GitHub peut retarder les exécutions planifiées.

Si le mot de passe de la base est inconnu, ne pas le réinitialiser à l'aveugle : vérifier d'abord les connexions existantes. Les secrets GitHub enregistrés ne sont pas relisibles ; seul leur nom et leur date de modification sont visibles.

## Contrôles

Le workflow **Tests de sauvegarde** teste avec des données fictives le chiffrement, le déchiffrement, les mots de passe erronés, les fichiers abîmés, la restauration PostgreSQL, l'annulation d'une restauration échouée et le refus des bases non vides. Il n'utilise aucun secret réel.

Le workflow **Sauvegarde de la base** est le seul à copier la base réelle. Une réussite des tests fictifs ne signifie pas qu'une sauvegarde réelle existe.

Vérifier régulièrement ses exécutions et la présence des artifacts. Les notifications d'échec par e-mail dépendent des préférences GitHub ; elles ne sont pas garanties par le script. Une copie datée doit rester disponible hors de ce dépôt pour couvrir aussi une perte d'accès à GitHub. Les quotas de stockage et de durée GitHub Actions dépendent du compte.

## Restaurer

Prévoir Bash, GnuPG, Python 3 et psql, ainsi qu'une base Supabase **neuve et vide**, compatible avec PostgreSQL 17 et les extensions du projet. Faire cette opération avec Codex.

1. Télécharger l'artifact GitHub puis extraire son fichier backup.tar.gz.gpg.
2. Déchiffrer dans un nouveau dossier local privé : `bash tools/sauvegarde/dechiffrer.sh backup.tar.gz.gpg backup-private/restauration`. GnuPG demande le mot de passe. Le dossier parent doit exister.
3. Charger dans une base locale vide : `bash tools/sauvegarde/restaurer.sh backup-private/restauration "<connexion PostgreSQL locale>"`.
4. Une cible distante neuve exige en plus `ALLOW_REMOTE_RESTORE=new-empty-project`. Le projet de production actuel est toujours refusé. Les bases contenant des tables applicatives, utilisateurs ou fichiers enregistrés sont refusées.
5. Vérifier les comptes, ventes, commandes, Budget, règles d'accès et fichiers avant de décider d'une bascule du site.

La restauration est transactionnelle : une erreur annule les changements de cette tentative. Les diagnostics SQL bruts ne sont pas publiés, car ils peuvent contenir des données privées. Ne jamais contourner un échec en ignorant des lignes de données.

Références : [guide Supabase de sauvegarde/restauration](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [commande db dump](https://supabase.com/docs/reference/cli/supabase-db-dump).
