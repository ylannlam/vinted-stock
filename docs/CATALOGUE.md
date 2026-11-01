# Catalogue Shein et SKU Dotb

## Utilisation

Le suivi des ventes commence le **31 octobre 2026 à 00 h, Europe/Paris** (`2026-10-30T23:00:00Z`), avec une date fixe. Les imports de commandes, les statistiques et la récupération des fiches de vente utilisent cette borne. Les ventes plus anciennes restent conservées en base mais ne sont pas comptabilisées.

Toutes les ventes depuis cette date sont suivies sans classement manuel des articles, même pour une annonce ancienne ou absente du catalogue. Les annulations, retours et suspensions ne comptent pas dans le chiffre d'affaires. Le catalogue affiche uniquement les références vendues pendant cette période ; leur ancienne classification n'intervient plus.

1. La réception automatique Dotb enregistre les ventes depuis le 31 octobre à minuit, Paris.
2. Chaque vente avec SKU prépare sa recherche Shein dans la même transaction. Le navigateur connecté vérifie aussi les ventes en attente à chaque passage, sans import manuel des annonces.
3. Le catalogue et les fluctuations ne concernent que les références vendues pendant cette période. Les lignes annulées, retournées ou suspendues sont écartées. Les commandes déjà expédiées alimentent aussi le catalogue et les statistiques.
4. Le navigateur avec l'extension 0.4.0 reste nécessaire. Il consulte la file toutes les 30 secondes, même si le site est fermé. Un PC éteint ou un navigateur fermé laisse les demandes en attente ; une vérification humaine bloque la récupération sans être contournée.
5. Une vente sans SKU reste visible et signalée. Dans **Ventes & achats → Sans SKU**, le bouton **Ajouter le SKU Shein** sous l'article ouvre un seul champ. Enregistrer la référence après la vente lance immédiatement la recherche, sans nouvel import ni préparation du SKU dans Dotb. Cette saisie ne modifie que le SKU local et conserve les informations de commande ; les futurs imports Dotb ne l'écrasent pas. **Modifier le SKU** permet de corriger la référence. Aucun rapprochement par photo ou titre n'est inventé.
6. Les références non vendues ne peuvent plus être ajoutées par les anciens imports d'annonces, ni par la file de récupération. L'ajout libre a été retiré de l'interface. Les corrections et relevés manuels d'une référence vendue restent disponibles.
7. Les réussites se relient au SKU même sans annonce Dotb importée. Les relevés de moins de six heures sont réutilisés. Une demande en cours n'est pas dupliquée ; les erreurs à vérifier ne tournent pas en boucle. Après correction et réussite, un ancien échec n'empêche pas les vérifications futures.

## Exactitude et limites

- Le prix automatique est celui affiché sur la fiche pour la couleur sélectionnée, en EUR, avant sélection de taille et hors coupons du panier. Ce n'est pas un prix garanti au paiement. Aucune disponibilité globale n'est déduite d'une taille.
- L'historique compare la même couleur, devise et portée de prix. Les relevés manuels d'une taille précise restent séparés. La fiche affiche les 200 relevés les plus récents ; le reste demeure en base.
- SKU divergents, pages non reconnues, prix ambigus et résultats trop anciens sont refusés. Les anciennes données sont conservées en cas d'échec. Description et mesures restent vides si elles ne sont pas lisibles.
- Les ventes sans SKU ne sont pas attribuées par titre ou photo. Annulations, retours en cours et ventes suspendues sont exclus. Les montants incomplets sont signalés. Dotb transmet les nouvelles ventes automatiquement ; l'import de commandes reste disponible pour rattraper un historique manquant.
- La fiche associée alimente aussi le lien fournisseur du suivi des ventes. Un lien fournisseur renseigné manuellement reste prioritaire.
- Aucune modification automatique des prix Dotb, commande Shein ou publication Vinted. L'API publique Dotb ne fournit pas le même contrôle sur une annonce déjà publiée que sur un brouillon.

## Architecture et accès

`api/collector.js` expose une association de PC limitée à la collecte. Le PC ne reçoit ni la clé Dotb ni la clé d'administration de la base. Le serveur conserve uniquement le hachage de son code aléatoire, révocable et valable 90 jours. Son créateur doit rester administrateur. Le code et le profil du navigateur sont conservés dans `.data`, exclu de Git et de l'archive distribuée. Ne pas partager ce dossier.

Les tâches ont une réservation de trois minutes, prolongée toutes les 30 secondes. Une réservation perdue est retentée au plus trois fois. Un résultat renvoyé après une coupure ne crée pas un second relevé. Un fichier local conserve les résultats en attente d'envoi ; les résultats expirés sont refusés et nécessitent une nouvelle collecte.

Administrateurs : import, association du PC, demandes, saisies et associations. Rôle stock : lecture. Visiteurs : aucun accès aux données. Les tables techniques sont accessibles au serveur uniquement.

Sources : `tools/shein-collector/`. Archive : `public/downloads/shein-collector.zip`, construite avec `tools/package-collector.ps1`. L'extension de secours est dans `extensions/shein/`, empaquetée par `tools/package-extension.ps1` dans `public/downloads/shein-catalogue.zip`.

## Vérification

`node --test server/*.test.js` puis `npm run build`.
Les tests SQL `tests/catalog.integration.sql`, `tests/collector.integration.sql`, `tests/tracking.integration.sql`, `tests/automatic-sales.integration.sql` et `tests/sold-catalog.integration.sql` vérifient la base dans des transactions annulées.
`/preview.html#catalogue` utilise exclusivement des données fictives, y compris l'association du PC. Aucun code de cette démonstration n'autorise une vraie collecte.

Les tests et la démonstration ne prouvent pas qu'une fiche réelle reste accessible sans vérification humaine. La validation complète exige un PC associé et une récupération réelle réussie.
