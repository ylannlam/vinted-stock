# Activation du suivi Dotb

Cette branche ajoute un espace Ventes & achats, distinct du stock existant. La connexion Dotb lit seulement les commandes ; elle ne publie pas, ne commande pas chez Shein et ne modifie pas Vinted.

1. Tester `/preview.html` : démo fictive indépendante de Supabase.
2. Examiner puis exécuter `supabase/migrations/20261029174512_dotb_fulfillment.sql` dans une base de test. Le fichier crée quatre tables et deux fonctions réservées au serveur. Aucune table existante n'est supprimée.
3. Configurer côté serveur `DOTB_API_TOKEN` avec le droit de lecture des commandes et `SUPABASE_SERVICE_ROLE_KEY`. Les variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` doivent désigner la même base. Ne jamais utiliser le préfixe VITE pour les secrets.
4. Se connecter avec un profil admin et lancer Synchroniser Dotb. Les rôles stock peuvent consulter et préparer les articles ; les employés ne peuvent pas accéder au module.
5. Vérifier des ventes simples, des lots, des annulations et une deuxième synchronisation avant toute mise en production.

Chaque page d'import et son curseur sont enregistrés dans une transaction. Les champs locaux de préparation sont conservés. Les changements de statut nécessitent la version courante de l'article. Les lots doivent être préparés en entier avant confirmation du dépôt. Le catalogue relie un SKU exact à un lien fournisseur partagé.

La synchronisation est manuelle et parcourt l'historique disponible dans Dotb. Aucun historique de prix Shein, import automatique en arrière-plan ou statistique financière exhaustive n'est activé. La démo ne valide pas la connexion réelle.
