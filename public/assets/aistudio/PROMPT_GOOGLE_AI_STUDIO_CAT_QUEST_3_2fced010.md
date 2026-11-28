# Prompt de modification — Cat Quest 3

Tu as déjà accès à l’ensemble des fichiers du projet Cat Quest 3 dans l’environnement de travail. **Travaille directement dans ces fichiers** : ne demande pas à l’utilisateur de renvoyer le dépôt, le code ou les ressources déjà disponibles. Lis le code et les ressources concernés pour comprendre l’implémentation existante avant de la modifier.

Tu es autorisé à **modifier les fichiers existants et à créer tous les nouveaux fichiers, modules, ressources, sons, images, animations et tests nécessaires**, puis à les relier correctement au jeu, à la configuration de Vite et au système de chargement d’assets. Conserve les changements déjà présents dans le projet et évite d’écraser ou de supprimer des travaux sans raison technique démontrée.

## Objectif et niveau de qualité

Réalise toutes les améliorations ci-dessous avec une finition digne d’un jeu d’action-aventure commercial de grande qualité (« AAA ») : animations lisibles et expressives, effets cohérents avec l’univers, audio bien synchronisé, commandes réactives, interfaces soignées et performances stables. « AAA » décrit ici le niveau de finition visé : adapte les solutions à ce jeu web 2.5D et à ses moyens réels, plutôt que d’ajouter des technologies lourdes ou incompatibles.

Le projet utilise actuellement TypeScript, Vite et Three.js, avec une architecture de jeu, de rendu, d’audio et d’interface déjà existante, des personnages en sprites et des animations segmentées. **Privilégie les systèmes et conventions déjà présents**, notamment les moteurs audio, les renderers, les types d’état du jeu et le chargement d’assets. N’ajoute une dépendance que si elle apporte un bénéfice concret et s’intègre proprement. N’introduis pas de service distant obligatoire pour que le jeu fonctionne.

## Méthode de travail

1. Inspecte les fichiers et ressources directement concernés et repère les systèmes existants à étendre. Ne te contente pas de produire des recommandations : implémente les modifications dans le projet.
2. Réalise l’ensemble des demandes des sections suivantes. Si plusieurs changements dépendent les uns des autres, implémente-les de façon cohérente à travers la simulation, le rendu, l’audio, l’interface et les données nécessaires.
3. Pour les ressources audio ou visuelles obtenues sur Internet, conserve localement les fichiers nécessaires au jeu et note leur URL/source et, si disponible, leur auteur et leur licence dans un manifeste d’assets. Pour ce projet personnel, ne filtre pas les sons uniquement parce qu’ils ne sont pas libres de droits. Ne contourne toutefois pas de contrôle d’accès, ne prétends pas qu’un contenu protégé est libre ou autorisé et ne supprime pas ses informations d’attribution.
4. Si une ressource précise est introuvable ou inaccessible, cherche une alternative adaptée. Si aucune alternative ne convient, utilise une solution de repli cohérente et indique brièvement la limite dans le micro-rapport final.
5. Évite les régressions : conserve les commandes, la sauvegarde, la progression, les quêtes et les fonctionnalités existantes. Fais attention aux changements d’état, aux interruptions d’animation, aux transitions entre intérieur et extérieur, ainsi qu’aux changements de météo et de combat.
6. Vérifie le résultat avec les scripts déjà disponibles dans le projet (tests, compilation et/ou vérifications statiques adaptées). Corrige les erreurs introduites par tes modifications. N’affirme pas avoir vérifié visuellement le jeu si tu ne l’as pas réellement lancé et observé.

## 1. Sons et musique

Intègre des sons enregistrés trouvés sur Internet, pertinents pour leur source à l’écran et synchronisés avec les événements du jeu. Le son doit aider le joueur à comprendre et ressentir l’action, pas seulement être décoratif.

Créer ou remplacer les sons correspondants pour :

- les dégâts reçus, en distinguant si utile les impacts, les dégâts du héros et ceux des ennemis ;
- la montée de niveau ;
- l’ouverture des coffres et les interactions spéciales ;
- les coups d’épée, avec une variation selon l’arme ;
- chaque sort, avec une identité sonore distincte ;
- l’ouverture et la fermeture des menus ;
- la musique du menu principal ;
- les prises de parole des PNJ ;
- les interactions usuelles ;
- le dash ;
- l’ouverture de la carte ;
- les attaques des boss, avec des sons adaptés à leur créature, leur attaque et leur univers.

Fais varier l’ambiance musicale de manière fluide selon trois états du jeu : menu, monde maritime et zone à terre, avec une transition de combat lorsque le joueur entre en combat ou en sort. Évite les coupures brutales, les superpositions involontaires et les redémarrages continus de la même piste. Utilise le moteur audio existant et ses mécanismes de volume/ambiance ; adapte l’audio à l’état et à l’intensité des événements, sans créer une nouvelle lecture à chaque frame.

Lors d’une tempête, supprime les sons d’oiseaux incompatibles avec cette météo. Vérifie que les ambiances de météo, de mer et de combat ne se masquent pas mutuellement de façon gênante.

## 2. Animations du héros, interactions et équipements

Améliore les animations avec un **rig 2D segmenté par parties** (par exemple corps, tête, oreilles, membres, vêtements, chapeau et accessoires), dans la mesure où les sprites et outils du projet le permettent. Réutilise les spritesheets et mécanismes existants lorsque c’est pertinent ; crée les frames, masques, découpes ou ressources manquantes si nécessaire. Préserve l’orientation, l’alignement et la lisibilité des équipements dans toutes les directions.

- Donne à chaque épée une animation d’attaque visuellement distincte et une portée de frappe qui correspond réellement à son animation et à sa logique de collision.
- Ralentis et diversifie les mouvements d’oreilles dans les animations statiques et d’attente ; évite les mouvements répétitifs ou nerveux.
- Ralentis et synchronise le cycle des jambes avec la vitesse de déplacement réelle, en tenant compte des accélérations, arrêts et changements de direction.
- Améliore l’ajustement des habits au corps : réduis les écarts visibles, glissements et superpositions incorrectes pendant les mouvements et changements d’équipement.
- Gère correctement l’occlusion du chapeau : les parties situées derrière la tête doivent être masquées par celle-ci, tandis que les parties devant restent visibles. Les oreilles mobiles doivent apparaître ou être occultées de façon crédible selon leur position et le chapeau porté.
- Enlève l’animation de tremblement des arbres provoquée par le vent. Garde les animations segmentées déjà réalisées pour les éléments concernés.
- Quand le joueur déclenche une interaction avec un objet ou un personnage, fais-le se déplacer jusqu’à une position d’interaction praticable et orientée vers la cible avant de commencer l’interaction. Gère l’annulation si la cible devient inaccessible ou si le joueur interrompt l’action.
- Rends l’ouverture du coffre plus lente et synchronise l’attribution de son contenu avec la fin de l’animation. Ne donne pas la récompense prématurément et évite de l’attribuer plusieurs fois si l’animation est interrompue ou rejouée.
- Pour entrer dans ou sortir d’un lieu, anime le déplacement du personnage vers la porte ou le portail, le franchissement, puis son déplacement visible après la transition. Évite la téléportation visuellement abrupte tout en gardant une transition robuste si la scène ou le personnage est bloqué.
- À l’entrée d’un lieu sombre, laisse la lanterne éteinte au départ puis allume-la progressivement sur **2 secondes**. En lieu lumineux, range-la avec une animation et rends-la invisible une fois rangée ; en lieu sombre, fais-la ressortir avec une animation et rends-la visible. Synchronise l’objet porté et sa lumière afin qu’ils ne se désaccordent pas.
- Remplace le traitement de mort actuel du héros par une animation de mort élaborée et lisible, avec une transition vers l’état de défaite et le retour prévu au jeu. Évite le simple écran qui renvoie instantanément à la grange. Respecte la progression, l’état du monde et la sauvegarde existants.

## 3. Combat et gameplay

- Fais varier les attaques de boss. Chaque attaque doit avoir un type, une portée, des dégâts, une vitesse ou durée et un comportement lisibles et adaptés au boss. Les variations doivent modifier réellement le gameplay, pas seulement l’apparence.
- Associe les paramètres et les animations des attaques aux phases du boss et à des signaux visuels/sonores compréhensibles, afin que le joueur puisse anticiper et esquiver.
- Fais dépendre les attaques du héros de l’arme équipée : animation, effets, vitesse d’attaque, portée et dégâts doivent être cohérents avec les caractéristiques de l’arme. Assure-toi que les zones de frappe correspondent à la portée visuelle annoncée et que les changements d’arme mettent à jour le comportement immédiatement.
- Allonge la durée de la chute d’étoile. Vise l’emplacement actuel du curseur au déclenchement, dans les limites d’une portée maximale cohérente. Gère proprement une cible hors portée, un curseur absent ou une cible qui change pendant l’incantation ; la visée verrouillée au lancement ne doit pas dériver de façon imprévisible.
- Corrige les petits ralentissements intermittents. Identifie les causes mesurables avant d’optimiser : allocations répétées dans la boucle de rendu, créations/destructions fréquentes d’objets Three.js, chargements ou décodages synchrones, trop de particules, recalculs inutiles, ou gestion audio coûteuse. Réutilise les objets et ressources, limite et nettoie les effets temporaires, et garde une fréquence d’image stable sans altérer la simulation.

## 4. Carte et minimap

- Rends la carte du monde plus grande, plus jolie et plus détaillée, tout en conservant une bonne lisibilité des lieux, îles, zones explorées, marqueurs et destination utile au joueur.
- Ajoute une minimap fixe en bas à droite du HUD. Elle doit refléter la position et l’orientation du joueur ainsi que les éléments pertinents à proximité, respecter les limites de l’interface et rester lisible sur les résolutions prises en charge.
- Gère proprement l’ouverture et la fermeture de la grande carte, son son d’ouverture, le redimensionnement de l’écran et les états où la minimap ne doit pas apparaître ou doit être adaptée (par exemple menu ou intérieur).
- Évite de recalculer ou reconstruire la carte entière à chaque frame si seule la position du joueur a changé.

## 5. Effets visuels et météo

- Rend les effets d’attaque des ennemis plus sophistiqués et lisibles, avec un accent particulier sur les boss. Les signaux d’attaque doivent permettre d’anticiper les impacts et rester compréhensibles au milieu des autres effets.
- Augmente nettement l’impression d’obscurité pendant une tempête, avec une atmosphère cohérente. Préserve suffisamment de visibilité pour jouer et distinguer les menaces, les interactions et les repères utiles.
- Pour la chute d’étoile, crée un effet plus spectaculaire où les étoiles semblent réellement tomber du ciel jusqu’au point d’impact : trajectoires, vitesse, profondeur, lumière et impact doivent être synchronisés avec la zone de dégâts et le son.
- Différencie et enrichis les effets d’attaque du héros selon l’arme équipée. Fais correspondre précisément l’effet à la trajectoire, à la portée, au moment de contact et au type de dégâts.
- Différencie et enrichis les attaques des boss selon leur élément, silhouette et univers. Exemples à développer avec imagination : dragon de feu avec flammes, souffle, chaleur et mouvements aériens ; roi des rats avec fromage, déchets et attaques adaptées à son repaire. Ces exemples ne limitent pas la créativité : invente des variations cohérentes pour chaque boss présent dans le projet.
- Utilise les systèmes de rendu et shaders Three.js existants lorsque possible. Maîtrise le nombre de particules, les matériaux, la durée de vie des effets et le nettoyage des ressources pour préserver les performances.

## 6. Placement des objets

- Déplace la lanterne pour qu’elle soit portée à la ceinture du héros. Son point d’attache, son orientation, son animation de rangement/sortie et sa lumière doivent suivre correctement le personnage et ses animations.
- Dispose les fleurs au sol couchées, comme des fleurs qui poussent depuis le sol, plutôt que droites. Si l’action de jeu doit les redresser pour permettre l’interaction ou la cueillette, anime cette remise en position au moment approprié ; ne les représente pas comme des tiges verticales par défaut.

## 7. Qualité, intégration et vérification

- Intègre tous les nouveaux assets au chargement et au registre approprié. Évite les chemins cassés, doublons inutiles, sons qui continuent après un changement d’état et ressources Three.js non libérées.
- Préserve le fonctionnement en cas d’asset optionnel absent : utilise un repli cohérent et n’empêche pas le jeu de démarrer.
- Vérifie notamment les combats contre chaque boss, l’équipement de plusieurs armes, la chute d’étoile à portée et hors portée, les interactions et coffres, les entrées/sorties de lieux, les zones claires/sombres, les tempêtes, le passage terre/mer, l’ouverture de la carte et de la minimap, et les résolutions d’écran courantes.
- Lance les tests et commandes de build déjà définis dans le projet et corrige les erreurs causées par tes changements. Si un scénario nécessite un lancement manuel et que tu ne peux pas l’observer, indique-le honnêtement.

## Rapport final obligatoire

Quand les modifications et vérifications sont terminées, réponds avec un **micro-rapport très concis**, de trois puces maximum :

- Modifications principales réalisées.
- Vérifications exécutées et leur résultat.
- Éventuels éléments non réalisés ou limites restantes.

Ne fournis pas un long résumé, ne répète pas la demande et ne déclare pas terminée une vérification qui n’a pas été exécutée.
