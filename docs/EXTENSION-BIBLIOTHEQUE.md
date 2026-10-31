# Import dans la bibliothèque — extension 0.3.0

Parcours : champ du catalogue → POST collector/enqueue → file persistante → extension associée → onglet Shein créé par l’extension → lecteur du DOM → contrôle du produit et de la fraîcheur du prix par le serveur → finish_catalog_collection → catalogue et historique. Le catalogue se rafraîchit à la fin de la demande.

## Fonctionnement
- Traitement séquentiel, réveil toutes les 30 secondes et lors du chargement de l’onglet. Relevés suivants après 6 heures via la file existante.
- URL produit directe ou recherche du SKU, cinq candidats au maximum, égalité stricte du SKU et de l’identifiant attendu avant enregistrement.
- Un seul onglet possédé, identifié aussi dans storage.session pour ne pas prendre un onglet restauré au redémarrage. Les autres onglets ne sont ni lus ni modifiés.
- État et résultat à envoyer persistés avant navigation/envoi. Réponse d’enregistrement perdue : répétition idempotente avec le même job et le même bail. Expiration ou exclusion : arrêt, jamais de réaffectation d’un ancien résultat.
- CAPTCHA : arrêt de toute navigation automatique, pas de rechargement. Reprise explicite qui relit la page ouverte et renouvelle le bail. Un résultat incorrect peut être laissé à vérifier pour continuer la file ; une vérification humaine ne peut pas être sautée ainsi.
- Redémarrage du navigateur : arrêt local, Démarrer requis. Si le bail a expiré, relance depuis le site. Les navigateurs doivent rester ouverts et les ordinateurs éveillés.

## Accès
Manifest V3, Chrome/Edge 120+. Permissions storage/alarms/scripting et seulement fr.shein.com, www.shein.com, vinted-stock.vercel.app. Le code d’association est limité aux actions du collecteur ; la clé Dotb n’entre jamais dans l’extension. Stockage local restreint aux contextes de confiance. Le service worker n’accepte les commandes que de son propre popup. API fixe, redirections refusées, cookies omis. Aucun script distant, aucune API privée Shein ni mécanisme de contournement de vérification.

Le collecteur réutilise les règles de sélection des articles Dotb et les contrôles de rôle/bail existants. Aucune migration n’est nécessaire. L’import Dotb reste manuel depuis le site. Le champ de recherche de la bibliothèque reste un filtre ; le champ d’ajout est distinct et toujours visible.

## Vérifications
- Tests Node : lien et recherche SKU, mauvais produit, CAPTCHA et reprise sans rechargement, réponse perdue et redémarrage du worker, bail expiré, révocation, fermeture/redirection d’onglet, prix/couleur/photos illisibles, taille sélectionnée, pause locale et serveur, restrictions d’origine.
- Archive à liste fermée de huit fichiers ; le lecteur extract.mjs est copié depuis le programme PC par le script de paquetage, et son identité est vérifiée par test.
- Interface testée en aperçu avec données fictives ; recherche du SKU vérifiée sur Shein, résultat exact en tête. Extraction contrôlée en lecture seule sur la vraie fiche 90176146 : SKU attendu, prix 32,64 EUR dans cette session, couleur Nude, cinq photos, quatre tailles. Le résultat passe la validation serveur. Cette vérification de lecture n’enregistre aucun relevé de production et ne valide pas à elle seule une extension installée.
- À valider après installation dans le navigateur utilisateur : association puis ajout réel d’un SKU/lien jusqu’à apparition dans la bibliothèque. Les vérifications de Shein restent susceptibles d’interrompre ce parcours.

Documentation primaire utilisée : https://developer.chrome.com/docs/extensions/reference/api/storage ; https://developer.chrome.com/docs/extensions/reference/api/alarms ; https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
