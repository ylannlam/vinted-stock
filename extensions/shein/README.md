# Assistant Shein — 0.6.0

Les fiches se pilotent dans **Catalogue**, et les achats dans **Ventes → Mes commandes Shein**, sur https://vinted-stock.vercel.app. L’extension utilise ses propres onglets.

## Commandes Shein
- Dans **Ventes → Mes commandes Shein**, clique sur **Activer la synchronisation**. L’extension lit les commandes récentes depuis le début du suivi, puis leurs lignes détaillées, toutes les 10 minutes lorsque le navigateur reste ouvert.
- SKU, lien, photo, taille, couleur, quantité, montant et état affichés sont enregistrés. Les adresses, moyens de paiement et cookies ne sont pas récupérés.
- L’association automatique exige un SKU exact, une taille et une couleur concordantes, assez d’exemplaires et aucune commande concurrente. Les autres cas se choisissent avec **Associer une vente**.
- Une commande en préparation passe la vente à **Commandé**. Les articles expédiés passent à **En transit**. Un article livré nécessite **J’ai reçu cet article** ; aucune réception n’est confirmée sur Shein.
- Les prix unitaires ne sont repris que lorsqu’ils sont connus et que le coût de la vente n’a pas été renseigné. Les frais de livraison ne sont pas répartis automatiquement.
- Une annulation, un retour, une disparition d’article ou une baisse de quantité reste visible à vérifier. **Dissocier** restaure les informations d’avant association seulement si elles n’ont pas été modifiées depuis.
- Le numéro de suivi et l’affectation à des colis séparés restent disponibles dans **Mes colis Shein** ; leur récupération automatique depuis Shein n’est pas encore activée.
- La lecture s’arrête en cas de connexion ou vérification Shein requise. **Ouvrir Shein**, puis **Reprendre** permet de continuer. Aucun achat, retour ou annulation n’est déclenché par l’extension.

## Installation unique
1. Décompresse le dossier et conserve-le sur le PC.
2. Dans `edge://extensions` ou `chrome://extensions`, active le mode développeur et charge ce dossier comme extension non empaquetée.
3. Actualise le catalogue puis clique sur **Connecter et démarrer**. Aucun code à copier.

Déjà associé en 0.3.0, 0.4.0 ou 0.5.0 ? Mets les imports en pause, remplace les fichiers dans le même dossier, recharge l’extension puis la page du catalogue. Reprends les imports. L’association existante est conservée. L’extension ne demande aucun domaine ou type de permission supplémentaire.

## Nouveau tableau de bord
- État distinct : connecté, en pause, en cours, reconnexion ou intervention Shein.
- Étapes de la fiche : recherche, lecture, contrôle, ajout.
- Compteurs des fiches ajoutées et laissées à vérifier depuis l’association du navigateur.
- Historique local des 12 dernières fiches, avec nombre de photos, tailles et champs facultatifs manquants. L’historique commence avec cette version ; les anciens compteurs restent conservés.
- En cas de coupure réseau : tentative après 30 secondes, puis 60 secondes pour les échecs consécutifs. L’attente et le résultat à envoyer sont conservés après la suspension du navigateur. Une demande dont le bail a expiré doit être relancée depuis le catalogue.
- Dans Aide et connexion : heure du dernier contact, diagnostic exportable sans identifiants ni données d’articles et connexion manuelle de secours.
- Dans le catalogue : compteurs, version installée et accès permanent à la mise à jour.

## Utilisation
- Les ventes suivies dans Stock Vinted préparent automatiquement leur recherche Shein. Renseigne le SKU d’une vente s’il manque. Le parcours actuel est limité aux articles vendus ; l’extension ne crée pas un catalogue de produits non vendus.
- Suis **En cours / À vérifier / Ajoutés** dans le catalogue. Une fiche sans couleur ou avec un prix illisible reste à vérifier ; les suivantes continuent. Les informations manquantes sont indiquées sur la fiche.
- En cas de vérification Shein, utilise **Ouvrir Shein**, termine-la toi-même et clique sur **J’ai vérifié · reprendre** dans le catalogue. La vérification n’est ni résolue ni contournée automatiquement.
- La récupération tente aussi d’ouvrir Description et Tailles & Mesures pour lire leur contenu affiché. Les informations absentes ne sont pas inventées.
- **Mettre en pause / Reprendre les imports** se pilote sur le site. Le menu de l’extension reste un secours.
- Garde le navigateur ouvert et le PC éveillé. Après redémarrage, une récupération active reprend ; une pause volontaire ou une vérification humaine reste en pause. Un bail expiré peut nécessiter une relance depuis le catalogue.
- Les prix sont revérifiés après 6 heures lorsque le navigateur est disponible. L’import Dotb se déclenche encore depuis le site ; les exclusions choisies restent appliquées.

Pas de run.bat ni de Node.js. Arrête l’ancien programme si tu utilises l’extension.

## Accès
Chrome ou Edge 120+. Seuls fr.shein.com, www.shein.com et vinted-stock.vercel.app sont autorisés. Un script de liaison fonctionne uniquement sur ton site et transmet des commandes limitées au collecteur. Il ne reçoit jamais le code d’association stocké ni les baux de récupération. Les commandes d’autres sites ou de sous-cadres sont refusées.

Le code d’association reste dans le stockage local protégé de l’extension, expire après 90 jours et peut être révoqué depuis le catalogue. Les requêtes authentifiées vont uniquement au point d’accès fixe `/api/collector` de ton site, sans redirection ni cookies. Aucun mot de passe, clé Dotb, historique de navigation ou cookie n’est lu. Aucun achat ni changement d’annonce n’est effectué.

L’accès à Shein dépend de ta session et des contrôles du fournisseur. Une connexion réussie ne garantit pas que toutes les fiches seront accessibles.
