# YlaVint — l'extension maison qui remplace Dotb (novembre 2026)

## En deux mots
- **Extension YlaVint** (`extensions/ylavint/`, MV3, v3.0.0) installée dans les profils AdsPower : gros bouton **YlaVint** dans le popup (allume / coupe le Bridge du profil), badge = messages non lus, liens vers le site.
- **Onglet YlaVint** du site (`#ylavint/<rubrique>`) : Tableau de bord · Messagerie · Agent IA · Dressing · Ventes · Publication · Réglages · Journal. Admin seulement.
- Le site pilote, l'extension exécute : file `vinted_agent_tasks`, une tâche à la fois par compte, plafonds, plage horaire, pause automatique (captcha, 401/403/429, bandeau Vinted). Rien n'est actif tant qu'un compte n'est pas activé.

## Fonctions
| Fonction | Tâches | Recettes |
|---|---|---|
| Messagerie centralisée | `sync_inbox` toutes les 5 min (réglable) → `ylavint_conversations` / `ylavint_messages` | Lecture par défaut (`/api/v2/inbox`, `/api/v2/conversations/{id}`) |
| Réponse depuis le site / téléphone | `reply_message` (file prioritaire, plafond et écart à part, part même hors plage si écrite à la main) | `message_send` à apprendre |
| Agent IA | Brouillon Gemini à chaque nouveau message d'acheteur (un par passage de l'extension) ; mode « proposer » ou « répondre seul » avec délai ; mots sensibles → à traiter soi-même ; jamais de lien / contact / paiement hors Vinted | — |
| Ventes → onglet Ventes | `sync_orders` → `upsert_sales_snapshot` avec identifiant déduit de la transaction (`ylavintUuid`) ; SKU repris de la fiche publiée ; une vente déjà reçue de Dotb n'est jamais dupliquée (et inversement : `withoutYlavintOwned` dans le webhook et l'import Dotb) | Lecture par défaut (`/api/v2/my_orders`) ; `order_detail` facultatif |
| Bordereaux | `fetch_label` → stockage `agent-labels/…` → `sales_orders.label_url = ylavint:…` → impression 100 × 150 de l'onglet Ventes | `order_label` à apprendre |
| Dressing | `scan_wardrobe` toutes les 2 h → `vinted_agent_listings` + `publication_items` (suivi « jour après jour ») | Lecture par défaut |
| Démasquage / prix | auto (réglages) ou à la main depuis la rubrique Dressing | `item_form`, `item_edit`, `photo_upload` |
| Publication | Rubrique Publication, ou bouton **Publier avec YlaVint** dans l'atelier d'annonces | `photo_upload`, `item_create` |
| Messages aux likes | `scan_likes` → `like_message` ; `{article}` et `{prix}` remplacés ; la conversation rejoint la messagerie | `conversation_create`, `message_send` |

## Base
- Migration `supabase/migrations/20261107190000_ylavint.sql` : types `sync_inbox` / `reply_message`, colonne `priority`, `vinted_agent_settings.messaging`, liaisons ventes (`sales_order_id`, `shipment_id`, `conversation_id`), `ylavint_config` (agent IA), `ylavint_conversations`, `ylavint_messages`, nouvelle version de `claim_vinted_agent_task`, `ai_usage.feature` accepte `ylavint_reply`. Rien de supprimé.

## Fichiers
- Serveur : `server/vinted-agent.js` (file, poll, résultats), `server/vinted-agent-config.js` (catalogue des tâches, réglages), `server/ylavint.js` (messagerie, IA, ventes, dressing, atelier, vues du site).
- Branchements : `server/sales-automation.js`, `api/sales.js` (pas de doublon avec Dotb), `server/shipping-labels.js` (bordereau YlaVint), `server/listing-studio.js` (`ylavint_publish`, `ylavint_cancel`), `server/vinted-watch.js` (zip `ylavint.zip` avec icônes).
- Site : `src/components/YlaVintTab.jsx`, `YlaVintInbox.jsx`, `YlaVintAi.jsx`, `YlaVintWardrobe.jsx`, `YlaVintSales.jsx`, `ListingSession.jsx` ; démo `preview.html#ylavint/messagerie`.
- Tests : `server/ylavint.test.js`, `server/vinted-agent.test.js`, `server/vinted-agent-extension.test.js`.

## À confirmer en conditions réelles
Formats exacts de la messagerie Vinted (lecture souple dans `page.js` : `messageRow`, `conversationRow`), statuts des ventes, champ « masqué du catalogue », corps de création / modification d'annonce.

## Assistant PC 1.2.0 — pilote favoris et messagerie

Le connecteur existant ouvre deux onglets dans le profil AdsPower choisi : lecture des tâches et formulaire visible. Les messages passent par le champ Vinted avec une frappe progressive. Les réglages de favoris, réduction, relance, IA, plage horaire et plafonds restent ceux du site. Les clics ne sont pas considérés comme des confirmations : l'assistant attend la réponse Vinted correspondant à la conversation et au texte.

L'exécuteur est opt-in par compte (`messaging.executor`, `extension` par défaut). La migration `20261114160000_ylavint_desktop.sql` garde le verrou par compte, réserve les cinq types de tâches pris en charge et laisse les autres dans la file. L'ancien RPC ne peut pas prendre les tâches d'un compte en mode PC. Les clés de jumelage sont hachées en base et limitées au compte, au profil et aux actions poll/result ; le PC ne reçoit pas la session administrateur.

Avant toute activation : appliquer la migration, déployer le site, générer l'archive avec `tools/package-adspower.ps1`, puis remplacer les fichiers du connecteur arrêté en conservant `.data`. L'archive contient une copie générée de `extensions/ylavint/page.js` et `read.js`, pas de données locales ni de clés. Le bouton de vérification ne réclame aucune tâche et n'envoie rien. Aucun compte n'est activé par la migration.

Les envois possèdent un journal local durable. Au redémarrage, seuls leurs comptes rendus sont renvoyés au site. Un envoi partiel ou incertain met le compte en pause, sans réessai automatique. Un brouillon manuel, un changement de compte, un nouveau message acheteur ou un prix modifié empêchent la soumission. Les onglets créés par l'assistant sont fermés à l'arrêt ; les onglets de l'utilisateur et le profil restent ouverts.

Vérification locale : tests de la migration avec un vrai moteur Postgres PGlite, des clés limitées au compte, de la file et des plafonds, des favoris/relances/IA, de la frappe, des confirmations et de l'annulation. La démo `preview.html#ylavint/assistant-pc` utilise un connecteur fictif et ne contacte ni AdsPower ni Vinted.

Validation réelle encore nécessaire avant généralisation : confirmation d'un envoi complet sur un compte réservé et compatibilité avec l'ancienne messagerie. L'inspection du profil 42 a confirmé le champ `composer-input` et le bouton sans nom dans `composer`. Celle du profil 76 a confirmé `offer-modal`, `offer-price-field--input` (vide, prix actuel en placeholder) et `offer-submit-button`. Aucun texte, montant, message ni offre n'a été soumis. Les tests simulés ne prouvent pas la compatibilité de toutes les variantes Vinted. Ne pas présenter cette version comme validée en production tant que le pilote réel reste incomplet.
