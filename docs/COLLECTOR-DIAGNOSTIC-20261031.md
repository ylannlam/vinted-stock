# Diagnostic après les essais utilisateur — 31 octobre 2026

Version publiée au début du diagnostic : 0.3.0, commit 91f944c. Ne pas remplacer le ZIP distribué par des fichiers non vérifiés.

## Faits observés
- L’appareil « Mon navigateur » a effectivement terminé cinq récupérations entre 18 h 40 et 18 h 42 (heure de Paris).
- Deux demandes SKU, sz260328152096782289359 et sz2410092319181622, sont ensuite passées en statut blocked avec « La couleur de la fiche est illisible ».
- Une demande supplémentaire reste queued sans tentative. Le moteur 0.3.0 arrête toute la file après chaque donnée illisible, même sans CAPTCHA.
- Le lecteur ne cherchait la couleur que dans le groupe radio nommé « Color options ». Il ne couvrait pas le titre visible d’une fiche sans choix de couleurs.
- L’inspection des deux recherches dans le navigateur de vérification a rencontré /risk/challenge. Aucun CAPTCHA résolu ou contourné. L’ancienne détection ne reconnaissait pas ce chemin si le texte de vérification n’avait pas encore chargé.
- Les logs Vercel sur 30 minutes n’ont fourni aucune entrée liée au collecteur. Les statuts des demandes constituent la preuve de panne disponible.

## Corrections préparées localement, non publiées
- Couleur : groupe radio explicitement sélectionné, ou titre visible et non ambigu « Couleur… ». Pas de déduction depuis une description, une recommandation ou des données cachées.
- Couleur, photos, prix, taille ou SKU invalides : demande conservée à vérifier, puis traitement automatique de la suivante. Aucun relevé invalide envoyé.
- Vérification humaine et page inaccessible : pause globale conservée. Le chemin /risk/challenge est détecté immédiatement par les deux lecteurs.
- Tests couvrant deux articles successifs (premier sans couleur, second enregistré), titre de couleur visible/masqué/ambigu, CAPTCHA avant chargement du texte, et régressions du collecteur.

## Travail restant
- Confirmer la présentation exacte des deux fiches dans une session Shein qui permet de les lire ; la panne de couleur n’est pas encore reproduite sur leur DOM réel.
- Valider un parcours installé complet avant de distribuer une nouvelle extension. Une mise à jour du site ne modifie pas une extension déjà chargée sur le PC.
- Simplifier les commandes entre site et extension : le besoin utilisateur est un parcours géré depuis le catalogue. La correction technique ci-dessus ne résout pas encore cet objectif d’ergonomie.
- La question adressée à l’utilisateur sur son dernier essai reste sans réponse au moment de ce diagnostic.
