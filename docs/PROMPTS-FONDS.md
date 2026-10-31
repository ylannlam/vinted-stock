# Prompts & fonds

Bibliothèque intégrée au site, réservée aux administrateurs. Les fonds sont des images existantes ; les prompts expliquent comment placer l'article sur ces fonds. Cet espace conserve les ressources, il ne génère pas les photos.

- **Ajouter un fond** : image JPG, PNG ou WebP jusqu'à 10 Mo, titre, catégorie, prompt associé et notes facultatives.
- **Nouveau prompt** : texte libre conservé avec sa mise en forme, image de référence facultative.
- Recherche dans les titres, catégories, prompts et notes, sans distinction d'accents. Filtres Fonds / Prompts / Favoris, tri et pagination visuelle.
- Fiche détaillée : copier le prompt, télécharger le fond, modifier, mettre en favori, archiver ou restaurer. Les archives conservent les images et textes.
- Les deux fonds de l'ancien module sont repris avec leurs fichiers existants ; leurs associations aux comptes ne sont pas modifiées.

Les métadonnées sont dans `creative_resources`, inaccessible directement aux rôles `anon` et `authenticated`. L'API `/api/resources` vérifie la session et le rôle administrateur avant toute opération. Une version par ressource empêche l'écrasement silencieux d'une modification concurrente. Une création répétée avec le même identifiant et le même contenu est idempotente.

Les nouvelles images sont stockées dans le bucket privé `creative-assets`, créé via l'API Storage au premier envoi. Limites de type et de taille appliquées par l'interface, l'API et le bucket. Le transfert utilise une autorisation temporaire signée et n'envoie jamais la clé serveur au navigateur. Les chemins appartiennent à l'administrateur ayant envoyé le fichier ; leur contenu et leur taille sont revérifiés avant la sauvegarde. Les images des anciennes fiches restent dans `fonds` avec leur accès existant.

Les aperçus sont signés pour une heure, les téléchargements pour cinq minutes. **Actualiser** renouvelle les aperçus. L'archivage et le remplacement ne suppriment pas de fichier. Un envoi réussi suivi d'une sauvegarde échouée reste réutilisable tant que le formulaire reste ouvert. Fermer ce formulaire peut laisser un fichier non référencé ; aucune suppression automatique n'est effectuée au risque d'effacer un envoi encore en cours de sauvegarde.

Vérifications : `node --test server/*.test.js`, `npm run build`, `tests/resources.integration.sql` (transaction annulée). La démonstration `/preview.html#ressources` utilise des données fictives et n'enregistre rien dans la base réelle.
