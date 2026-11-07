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
