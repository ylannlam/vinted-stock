# Catalogue Shein et SKU Dotb

Première livraison : import **manuel** du catalogue Dotb, liaison par SKU, relevés Shein vérifiés et historique par taille/couleur.

## Utilisation

1. Dans Dotb, enregistrer le SKU affiché sur Shein et le lien complet du produit. Plusieurs tailles peuvent partager ce SKU.
2. Dans **Catalogue**, cliquer **Importer les articles Dotb**. L’import lit des pages de 100 articles, avec pause et reprise. Il ne modifie pas les annonces Dotb.
3. Les groupes de SKU dont tous les liens désignent le même produit Shein sont associés automatiquement à la fin de l’import. Les liens absents, liens courts et groupes ambigus restent à associer manuellement dans **SKU Dotb**. Une association manuelle existante est conservée.
4. Ouvrir le produit Shein, vérifier le prix et la variante, puis ajouter un **Relevé Shein**, ou utiliser l’extension téléchargeable dans l’onglet du même nom.

La référence SKU est conservée telle quelle (espaces périphériques retirés). La taille et la couleur appartiennent au relevé, pas au SKU. Les comparaisons exigent la même taille, la même couleur et la même devise. Les prix inconnus restent vides. Un relevé de plus de 24 h est signalé comme ancien. Les coupons et réductions personnalisées du panier ne sont pas calculés.

## Extension

Sources : `extensions/shein/`. ZIP distribué : `public/downloads/shein-catalogue.zip`.

Chrome / Edge, Manifest V3, `activeTab` et `scripting` uniquement. L’utilisateur déclenche la lecture ; l’extension ne lit ni cookies ni clés. Les données structurées de la fiche alimentent un brouillon transmis au site dans le fragment d’URL. La session habituelle du site est nécessaire pour enregistrer. Aucun produit n’est enregistré sans confirmation du formulaire. Prix ambigus et variantes non lisibles sont laissés à vérifier.

## Périmètre et limites

- Pas de récupération Shein en arrière-plan, ni d’intervalle de six heures.
- Pas de modification automatique des prix Dotb ou des publications Vinted.
- Pas de rapprochement des ventes anciennes dépourvues de SKU par titre ou ressemblance de photo.
- Les articles Dotb déjà importés restent consultables même si l’API ne les renvoie plus ; ils ne sont pas supprimés automatiquement. La date du dernier import est affichée.
- Historique conservé intégralement en base ; la fiche affiche les 200 relevés les plus récents.
- Administrateurs : import, relevés et associations. Rôle stock : lecture. Autres rôles et visiteurs : aucun accès.

## Vérification

`node --test server/*.test.js` puis `npm run build`.
`tests/catalog.integration.sql` vérifie les fonctions, comparaisons, associations et restrictions d’accès dans une transaction annulée.
`/preview.html#catalogue` utilise uniquement des données fictives et permet de tester l’interface sans écrire dans la base réelle.

Une collecte sur une fiche Shein réelle doit être validée dans un navigateur où cette fiche est accessible. Une vérification humaine demandée par Shein n’est pas contournée.
