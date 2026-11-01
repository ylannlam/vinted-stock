# Ventes automatiques

Le site reçoit les événements signés `order.created`, `order.status_changed` et `order.claim_opened` de Dotb à `https://vinted-stock.vercel.app/api/dotb-webhook`. Dotb doit d'abord avoir synchronisé la vente depuis Vinted : le site n'observe pas directement Vinted. Les événements de création de Dotb concernent les commandes de moins de deux jours.

À l'ouverture de Ventes & achats par l'administrateur, le site configure cette connexion avec la clé Dotb déjà présente sur le serveur. La clé doit disposer de `orders_read`, `webhooks_read` et `webhooks_write`. Une erreur de portée ou la limite des trois endpoints est affichée ; le bouton de réactivation permet de réessayer. Aucun secret n'est envoyé au navigateur. Le secret de signature est stocké dans une table privée, inaccessible aux rôles anon et authenticated.

Chaque notification est vérifiée sur son corps brut, sa signature et un horodatage de moins de cinq minutes. Le serveur relit la commande actuelle via l'API Dotb, puis enregistre la vente, l'identifiant de l'événement et la demande Shein dans une même transaction. Les doublons sont ignorés et une réponse plus ancienne ne remplace pas un état récent. Les champs saisis par l'utilisateur (coût payé, commande fournisseur, notes, préparation) sont conservés. Une panne retourne une erreur afin que Dotb retente la livraison selon ses délais officiels.

Le suivi commence le 31 octobre 2026 à 00 h, Europe/Paris (`2026-10-30T23:00:00Z`). Toutes les ventes de cette période sont suivies automatiquement, quelle que soit la date de création de l'annonce ou son ancien classement. L'interface ne demande plus de classement. Les ventes antérieures restent conservées mais hors statistiques et récupération déclenchée par une vente. Les annulations, retours et suspensions restent exclus du chiffre d'affaires.

Pour toute vente valide de la période, même déjà expédiée, le SKU et le lien Shein alimentent la file de récupération existante. Un relevé de moins de six heures est réutilisé. Une demande récente ou déjà en cours n'est pas dupliquée. La page se rafraîchit toutes les quinze secondes lorsqu'elle est visible, hors saisie ou traitement. Le prix relevé, sa date, la couleur, le lien et la photo disponibles sont reliés automatiquement à la vente. Le prix fournisseur reste un relevé et ne devient jamais le coût réellement payé.

Le catalogue se limite aux SKU vendus. Un passage du navigateur remet aussi en file les ventes existantes qui n'ont pas encore leur fiche, sans dépendre d'un import d'annonces. Le SKU peut être corrigé dans Ventes & achats : son enregistrement prépare immédiatement la recherche. Une fiche terminée est liée à la vente même si Dotb ne fournit pas d'identifiant d'annonce. Les imports de toutes les annonces et l'ajout de références non vendues sont désactivés.

Le navigateur avec l'extension Shein associée doit être actif pour récupérer les fiches. Une vérification humaine suspend la collecte ; les ventes restent reçues sur le serveur. Une taille vendue, un numéro de commande fournisseur ou un coût payé absent ne sont pas inventés. Aucune commande ni modification d'annonce n'est effectuée sur Vinted, Dotb ou Shein.

Vérification : `node --test server/*.test.js`, `npm run build`, puis `tests/automatic-sales.integration.sql` (transaction annulée). Les tests couvrent signature, horodatage, doublons, annulations, concurrence d'import, conservation des saisies, exclusions et remplissage de la vente après un relevé.

Référence officielle vérifiée : https://dotb.io/api/public/v1/llms.txt (Webhooks et Events).
