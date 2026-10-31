# Catalogue Shein et SKU Dotb

## Utilisation

1. Dans Dotb, enregistrer le véritable SKU Shein et, si disponible, le lien complet du produit. Plusieurs annonces et tailles peuvent partager ce SKU.
2. Dans Catalogue, cliquer **Importer les articles Dotb**. L'import conserve les associations manuelles, reprend après interruption et prépare les fiches à récupérer. Il ne modifie pas les annonces Dotb.
3. Dans **Récupération**, télécharger le programme Windows, décompresser le dossier puis **Associer mon PC**. Lancer `run.bat` et coller le code. Edge ou Chrome et Node.js 20+ sont nécessaires. Les dépendances sont installées depuis le fichier verrouillé au premier lancement.
4. Garder ce programme ouvert et le PC éveillé. Il traite les demandes une par une dans un navigateur dédié. Une fiche avec lien est ouverte directement ; un SKU sans lien est recherché puis vérifié exactement sur la fiche trouvée. Chaque collecte réussie prévoit une nouvelle vérification six heures plus tard.
5. **Importer des SKU ou liens** accepte aussi 50 références, une par ligne, indépendamment de Dotb. Les demandes sont conservées sur le serveur quand le PC est hors ligne.
6. La **Bibliothèque** réunit photos, prix, tailles de la couleur sélectionnée, description et mesures lorsqu'elles sont lisibles, annonces Dotb et ventes par SKU. **Fluctuations** compare deux relevés comparables ; **Best sellers** classe les ventes importées ayant un SKU.

Une vérification humaine demandée par Shein met le travail en attente. La terminer soi-même dans la fenêtre du programme puis appuyer sur Entrée. Le programme ne la contourne pas. **Réessayer** relance aussi depuis le site. Une fiche bloquée ne se relance pas toutes les six heures avant cette intervention.

## Exactitude et limites

- Le prix automatique est celui affiché sur la fiche pour la couleur sélectionnée, en EUR, avant sélection de taille et hors coupons du panier. Ce n'est pas un prix garanti au paiement. Aucune disponibilité globale n'est déduite d'une taille.
- L'historique compare la même couleur, devise et portée de prix. Les relevés manuels d'une taille précise restent séparés. La fiche affiche les 200 relevés les plus récents ; le reste demeure en base.
- SKU divergents, pages non reconnues, prix ambigus et résultats trop anciens sont refusés. Les anciennes données sont conservées en cas d'échec. Description et mesures restent vides si elles ne sont pas lisibles.
- Les ventes sans SKU ne sont pas attribuées par titre ou photo. Annulations, retours en cours et ventes suspendues sont exclus. Les montants incomplets sont signalés. Les imports Dotb restent déclenchés depuis le site.
- La fiche associée alimente aussi le lien fournisseur du suivi des ventes. Un lien fournisseur renseigné manuellement reste prioritaire.
- Aucune modification automatique des prix Dotb, commande Shein ou publication Vinted. L'API publique Dotb ne fournit pas le même contrôle sur une annonce déjà publiée que sur un brouillon.

## Architecture et accès

`api/collector.js` expose une association de PC limitée à la collecte. Le PC ne reçoit ni la clé Dotb ni la clé d'administration de la base. Le serveur conserve uniquement le hachage de son code aléatoire, révocable et valable 90 jours. Son créateur doit rester administrateur. Le code et le profil du navigateur sont conservés dans `.data`, exclu de Git et de l'archive distribuée. Ne pas partager ce dossier.

Les tâches ont une réservation de trois minutes, prolongée toutes les 30 secondes. Une réservation perdue est retentée au plus trois fois. Un résultat renvoyé après une coupure ne crée pas un second relevé. Un fichier local conserve les résultats en attente d'envoi ; les résultats expirés sont refusés et nécessitent une nouvelle collecte.

Administrateurs : import, association du PC, demandes, saisies et associations. Rôle stock : lecture. Visiteurs : aucun accès aux données. Les tables techniques sont accessibles au serveur uniquement.

Sources : `tools/shein-collector/`. Archive : `public/downloads/shein-collector.zip`, construite avec `tools/package-collector.ps1`. L'ancienne extension reste dans les sources mais n'est pas nécessaire à ce parcours.

## Vérification

`node --test server/*.test.js` puis `npm run build`.
Les tests SQL `tests/catalog.integration.sql` et `tests/collector.integration.sql` vérifient la base dans des transactions annulées.
`/preview.html#catalogue` utilise exclusivement des données fictives, y compris l'association du PC. Aucun code de cette démonstration n'autorise une vraie collecte.

Les tests et la démonstration ne prouvent pas qu'une fiche réelle reste accessible sans vérification humaine. La validation complète exige un PC associé et une récupération réelle réussie.
