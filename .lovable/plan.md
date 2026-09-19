# Agrandir Shadowing et rendre l’historique temporaire

## Résultat visé

- Élargir l’espace Shadowing jusqu’à environ 1 840 px afin que le lecteur puisse atteindre environ 1 450 px sur les grands écrans, tout en conservant l’empilement actuel sur les écrans étroits.
- Réduire légèrement la marge interne propre à cette page, sans coller le contenu aux bords.
- Supprimer définitivement la rangée d’historique sous le lecteur pour consacrer toute la hauteur disponible à la vidéo.

## Historique à la demande

- Ajouter un bouton compact `History (nombre)` au niveau des commandes du lecteur, également accessible quand aucun flux n’est chargé.
- Afficher l’historique dans un tiroir vitré qui recouvre uniquement la colonne des notes sur ordinateur ; le lecteur ne sera ni réduit ni masqué.
- Sur mobile, garder le même principe : le tiroir reste contenu dans la zone sous le lecteur et remplace temporairement les notes, sans devenir une fenêtre plein écran.
- Conserver les miniatures, titres, état actif, suppression et lien vers l’historique complet.
- Fermer le tiroir avec la croix, le bouton History, la touche Échap, un clic extérieur, ou après le chargement d’une vidéo.
- Utiliser une transition latérale discrète, automatiquement neutralisée lorsque les animations réduites sont activées.

## Vérification

- Vérifier l’absence de rangée permanente et la taille accrue du lecteur sur écran large.
- Tester ouverture, fermeture, sélection et suppression dans le tiroir.
- Tester les dispositions ordinateur et mobile, ainsi que les commandes vidéo, notes et aperçus existants.
- Lancer la vérification TypeScript demandée et distinguer clairement toute erreur préexistante d’une nouvelle erreur liée au changement.