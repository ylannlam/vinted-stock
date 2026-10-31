# Bibliothèque Shein — extension 0.3.0

Colle un lien produit Shein ou un SKU dans le catalogue Stock Vinted, clique sur **Ajouter à ma bibliothèque**. L’extension associée prend les demandes en attente, ouvre la fiche dans ton navigateur habituel, vérifie son SKU, puis enregistre photos, prix, couleur et tailles lisibles. Les prix réussis sont revérifiés après 6 heures quand le navigateur fonctionne.

## Installation (Edge ou Chrome 120+)
1. Décompresse ce dossier et conserve-le sur ton PC.
2. Dans `edge://extensions` ou `chrome://extensions`, active le mode développeur, choisis **Charger l’extension non empaquetée** puis ce dossier.
3. Sur ton site, **Catalogue → Récupération → Créer le code d’association**. Copie ce code dans l’extension, puis clique sur **Associer ce navigateur** et **Démarrer**.
4. Colle tes liens ou SKU dans la bibliothèque. Les fiches apparaissent après leur récupération. Le site affiche les demandes en attente et les erreurs.

Pour remplacer 0.2.0, remplace les fichiers dans son dossier, recharge l’extension dans la page des extensions et accepte les nouvelles permissions si le navigateur les demande. L’ancienne version était manuelle ; cette version traite une file et a besoin de l’accès aux deux domaines Shein et à ton site.

Pas de Node.js ni de run.bat pour cette extension. Arrête l’ancien programme si tu utilises l’extension.

## En cas de pause
- Garde le navigateur ouvert et le PC éveillé. La fenêtre de l’extension peut se fermer.
- L’extension utilise un seul onglet qu’elle a créé. Elle ne prend pas le contrôle de tes autres onglets.
- Si Shein affiche une vérification, l’extension ne la résout pas et ne recharge pas la page. **Ouvrir l’onglet Shein**, termine la vérification, puis **Reprendre la fiche ouverte**. Si nécessaire, ouvre le produit demandé dans ce même onglet.
- Un mauvais SKU, un prix illisible, des photos absentes ou une taille sélectionnée suspendent la fiche. Aucun ancien prix n’est remplacé par zéro.
- Après redémarrage du navigateur, clique sur **Démarrer**. Une demande expirée peut nécessiter **Réessayer** dans la file du site.
- L’accès à Shein dépend du site et de ta session : l’installation ne garantit pas que Shein acceptera toutes les consultations.

## Données et permissions
Le code d’association, limité à ces récupérations, reste dans le stockage local de l’extension. Il expire après 90 jours et peut être révoqué depuis le site. Les requêtes authentifiées vont uniquement à `https://vinted-stock.vercel.app/api/collector`, sans redirection. Ni cookies, ni mots de passe, ni clé Dotb ne sont lus. Aucun achat, message ou changement de prix Dotb n’est effectué. Les scripts lisent le contenu affiché sur Shein ; aucune API privée ni contournement de vérification.

L’import Dotb reste déclenché depuis le site. Les articles Dotb exclus ou non classés restent soumis aux règles de suivi du catalogue. Les fiches ajoutées directement avec un lien sont des références autonomes.
