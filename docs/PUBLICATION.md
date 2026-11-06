# Publication, atelier et meilleures ventes (novembre 2026)

## Onglet Publication
- Liste les fiches **prêtes** de l'onglet Annonces (état `draft`, sans champ manquant) et les répartit sur plusieurs jours :
  articles par jour et par compte, plage horaire (heure de Paris), nombre de jours, aujourd'hui ou demain, écart minimal
  entre deux articles d'un compte, mode « en ligne » ou « brouillon Vinted ».
- Calcul côté navigateur : `src/lib/publicationPlan.js` (`planPublications`, revérifié par `planConflicts`).
  Les annonces déjà prévues ou publiées depuis 2 jours comptent dans le total du jour et gardent leur distance.
  Jamais le même SKU à moins de 30 minutes, tous comptes confondus.
- Envoi : `POST /api/resources?scope=listings` `action=plan` (25 fiches maximum par appel) réserve chaque créneau avec
  `reserve_listing_slot(..., p_not_before)`. La base revérifie l'écart du compte et la règle du SKU et ne fait glisser
  le créneau que si nécessaire. Le navigateur pousse ensuite chaque fiche vers Dotb (`action=step` : création, photos,
  programmation à l'heure prévue), une étape toutes les 1,8 s pour rester sous la limite Dotb de 60 appels par minute.
- Le Bridge du compte doit être ouvert au moment de la programmation et à l'heure de publication. Sinon la fiche reste
  dans « En cours d'envoi » avec son message ; « Continuer l'envoi » reprend.
- « Déjà programmées » : annulation possible jusqu'à 2 minutes avant l'heure (`action=unschedule`, `DELETE items/{id}/schedule`).
  La fiche redevient prête.
- Lecture : `action=planner` (`server/publication-planner.js`).

## Atelier photo
- Quatre parties : **Comptes Vinted** (grille compacte : état du compte, fond, DA prête ou non, postés aujourd'hui,
  en cours, copie des prompts avant / arrière), **Prompts** (prompts des fonds puis prompts libres groupés par catégorie),
  **Fonds**, **Dépenses IA**.
- Dépenses IA : chaque rédaction d'annonce enregistre ses jetons dans `ai_usage` ; le coût est calculé avec `ai_prices`
  (dollars par million de jetons, modifiables dans l'onglet). Lecture `action=ai_usage&days=7|30|90`, tarif `action=ai_price`.

## Bibliothèque
- « Meilleures ventes » : grille avec photo, rang, nombre de ventes, chiffre d'affaires connu, prix Shein, dernière vente,
  bouton « Reposter » (ouvre Annonces avec le SKU). Périodes 7, 30, 90 jours ou depuis le début.
- Filtre « Best-sellers du moment » dans les vues produits : au moins 2 ventes sur 30 jours.

## Base
- Migration `20261106160000_publication_planning_ai_usage.sql` ; test `tests/publication-planning.integration.sql`.
