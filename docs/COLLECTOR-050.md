# Refonte de l’assistant Shein 0.5.0

Le menu de secours devient un tableau de bord : état de connexion, pause/reprise, étapes de récupération, compteurs et 12 résultats récents avec photos, tailles et champs facultatifs manquants. L’interface utilise les informations réellement persistées par le collecteur, sans pourcentage d’avancement inventé. Un diagnostic téléchargeable ne contient ni association, ni bail, ni référence ou titre d’article.

Le moteur conserve un délai de reprise réseau de 30 puis 60 secondes entre les échecs consécutifs, même après suspension du service worker. La réponse d’un enregistrement perdue est renvoyée avec le même bail et le même contenu : un seul succès et une seule ligne d’historique. Les réponses 400/404 suspendent la récupération plutôt que boucler ; 401/403 demandent une nouvelle association ; 409 arrête la demande périmée. Les contrôles SKU, couleur, taille sélectionnée et vérification humaine restent en place.

Le catalogue affiche les compteurs, la dernière communication et la version. La mise à jour reste accessible lorsque l’ancienne extension est déjà détectée. Aucun changement de base de données, de domaine autorisé ou de permission navigateur.

## Vérification

48 tests automatisés : moteur, reprise réseau persistante, limite d’historique, enregistrement idempotent, limites d’accès, lecteur DOM, liaison au site, adaptation Chrome et états de l’interface. Compilation de production réussie. Tableau de bord vérifié dans le navigateur avec données fictives : état actif, pause/reprise, vérification humaine et première connexion. Catalogue vérifié en démo : connexion et téléchargement de la nouvelle version depuis une ancienne version détectée. Ceci ne remplace pas un import réel par la version installée dans le navigateur de l’utilisateur.

## Possibilités suivantes, non livrées en 0.5.0

- Photos : aperçu plein format, sélection des vues avant/arrière, téléchargement par article, suppression des doublons, classement et renommage par SKU.
- Variantes : couleurs liées, disponibilité par taille, prix propre à la taille vendue, distinction explicite du prix de fiche et des coupons.
- Fiches : contrôles de complétude détaillés, nouvelle lecture ciblée des champs absents, suivi des différences entre deux relevés.
- File : priorités par date d’expédition, recherche, pagination au-delà des 100 demandes récentes, exclusions et historique complet consultable.
- Alertes : baisse/hausse de prix, rupture, retour en stock, import arrêté, association bientôt expirée ; choix des seuils et du canal.
- Vente : marge estimée avec frais, alerte lorsque la marge devient insuffisante, aide au regroupement des achats.
- DA par compte : choix d’un compte autorisé, fond et prompts avant/arrière hérités de sa DA, dossier de préparation par article. La génération d’images nécessite un service et un budget explicites.
- Interface : panneau latéral persistant, aperçu produit, raccourcis et notifications navigateur facultatives.
- Distribution : publication Chrome Web Store / Microsoft Edge Add-ons, mises à jour simplifiées, journal des versions et possibilité de revenir à une version connue.
- Robustesse : tests de plusieurs présentations réelles Shein, suivi des changements de page, alertes sur les lecteurs devenus incomplets.

Les variantes et disponibilités doivent être confirmées dans une session Shein réelle. Le navigateur doit rester disponible pour la récupération actuelle ; un fonctionnement PC éteint demande un service distinct. Une vérification humaine peut toujours interrompre le parcours. Le flux réservé aux ventes doit rester inchangé sauf demande explicite de collecte de produits non vendus.

Documentation primaire :
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions
