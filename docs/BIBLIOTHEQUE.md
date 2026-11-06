# Bibliothèque, fiche Shein des annonces, écart par SKU

## Bibliothèque (onglet « Bibliothèque », ex « Produits Shein »)
- **Vendus** : produits liés à une vente suivie (vues `catalog_tracked_*`, inchangées).
- **Postés** : articles Dotb avec SKU, présents au dernier relevé (`catalog_dotb_items.present`), regroupés par SKU, sans les SKU vendus. Relevé par « Actualiser Dotb » (`library-sync`, pages de 100, bail `catalog_sync_state`, reprise au curseur après 45 s).
- **À poster** : références ajoutées par SKU ou lien Shein (`catalog_library`, source `manual` ou `listing`), ni vendues ni postées.
- Catégorie devinée depuis le titre (`src/lib/library.js`, premier mot-clé trouvé) ou choisie (`catalog_product_meta.category`).
- Prix de vente : choisi (`catalog_product_meta.sale_price`) sinon grille (`catalog_settings.pricing` : paliers « jusqu'à X € Shein → Y € », puis coefficient facultatif). Jamais de prix inventé hors grille.
- `is_sold_catalog_reference` accepte désormais aussi les références de la bibliothèque et les SKU postés : toute la collecte existante (file, PC, association) fonctionne pour eux. `queue_library_sources` relève la bibliothèque toutes les 24 h (20 par passage) ; un SKU d'annonce introuvable n'est pas relancé automatiquement.
- Sans la migration `20261106130000_library.sql`, l'API renvoie l'ancien catalogue (`library_ready:false`) et l'interface affiche un bandeau.

## Fiche Shein dans l'atelier d'annonces
- Sous le SKU : action `shein` de `/api/resources?scope=listings` (`lookupListingSku`). Trouvé → mesures de la taille saisie (guide des tailles lu par le PC dans `details` : lignes « FR · Taille · Tour de poitrine · … »), prix conseillé, nombre de caractéristiques. Inconnu → ajout `listing` à la bibliothèque et recherche par le PC (vérification toutes les 8 s pendant 4 min).
- Rédaction : l'IA reçoit `fiche_fournisseur.caracteristiques` ; elle n'écrit aucune mesure. `withMeasures` ajoute « Mesures (taille X) : – … » avant la ligne « Mots-clés ».

## Écart par SKU
`reserve_listing_slot` (migration `20261106140000_listing_sku_spacing.sql`) : un même SKU (insensible à la casse) n'est jamais programmé à moins de 30 minutes d'une autre annonce de ce SKU sur un autre compte.

## Vérification
`node --test server/*.test.js` ; tests SQL `tests/library.integration.sql`, `tests/listing-sku-spacing.integration.sql` (annulés en fin de transaction).
