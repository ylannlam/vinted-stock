# Agent Vinted maison (remplace Dotb) — novembre 2026

## Principe
- Une seule extension « Stock Vinted — agent » (`extensions/vinted-agent/`, MV3) installée dans les profils AdsPower. Elle remplace l'ancienne extension de veille : même téléchargement (onglet Agent ou AdsPower), même clé `svwk_`.
- Le site pilote, l'extension exécute : file `vinted_agent_tasks`, une tâche à la fois par compte, prise par `claim_vinted_agent_task` (plafonds du jour heure de Paris, plage horaire, écart minimal entre deux modifications, plafond par type).
- Arrêt automatique du compte (`vinted_agent_settings.paused`) : bandeau Vinted relevé par la veille, captcha, 401, 403, 429. Reprise manuelle depuis l'onglet Agent.
- Une modification interrompue (profil fermé, délai dépassé) n'est jamais rejouée : elle passe en échec « résultat inconnu ».

## Recettes (mode apprentissage)
- Les actions qui modifient Vinted ne partent qu'avec une recette relevée sur le vrai site : méthode, chemin (`{id}`), en-têtes non secrets, forme du corps. Jamais de cookie, de jeton CSRF ni d'`anon_id` stockés (`sanitizeRecipe`). Le CSRF et l'`anon_id` sont relus dans la page au moment de l'action.
- Popup de l'extension → « Mode apprentissage » → faire le geste une fois à la main. Les requêtes reconnues sont apprises toutes seules ; sinon, « Requêtes vues » → Attribuer.
- Les enveloppes `fetch` / `XMLHttpRequest` ne sont posées qu'en mode apprentissage.
- Le dressing a une lecture par défaut (`/api/v2/wardrobe/{id}/items`). Tout le reste attend sa recette.

## Fonctions
| Fonction | Tâches | Recettes nécessaires |
|---|---|---|
| Ventes | `sync_orders` toutes les 30 min | Liste des ventes |
| Bordereaux | `fetch_label` (PDF stocké dans `creative-assets/agent-labels/`) | Bordereau |
| Démasquage | `scan_wardrobe` toutes les 2 h → `unmask_item` : mêmes photos renvoyées, un point dans la description, −1 € (2 € max, jamais sous 2 €) | Ouverture, Enregistrement, Envoi de photo |
| Prix & cycle de vie | `reprice_item` après X jours, puis tous les Y jours, plancher et baisse max | Ouverture, Enregistrement |
| Publication | `publish_item` depuis les fiches prêtes (onglet Agent) | Envoi de photo, Création d'annonce |
| Messages aux likes | `scan_likes` toutes les 20 min → `like_message` (une seule fois par personne et par article) | Likes, Ouverture de conversation, Envoi de message |

## Valeurs par défaut (prudentes)
15 modifications/jour, 12 min minimum entre deux, 9 h–22 h, 5 démasquages, 5 baisses de prix, 5 publications, 10 messages aux likes par jour et par compte. Agent coupé par défaut sur chaque compte.

## À confirmer en conditions réelles
- Le champ exact qui signale une annonce « masquée du catalogue » dans le dressing (`hiddenFlag` dans `page.js`).
- Les formats des ventes, du bordereau et des notifications (lecture souple dans `page.js`, colonnes de réponse visibles dans `vinted_agent_recipes.recipe.response`).
- Les corps d'enregistrement / de création d'annonce remplis depuis le modèle relevé (`fillItem`).

## Fichiers
- Migration : `supabase/migrations/20261107160000_vinted_agent.sql` (7 tables, 2 fonctions, rien de supprimé).
- Serveur : `server/vinted-agent.js` ; routes : `api/collector.js` (`agent_poll`, `agent_result`, `agent_learn`), `api/resources.js?scope=agent`.
- Site : `src/components/AgentTab.jsx` (`#agent`), démo `preview.html#agent`.
- Tests : `server/vinted-agent.test.js`, `server/vinted-agent-extension.test.js`.
