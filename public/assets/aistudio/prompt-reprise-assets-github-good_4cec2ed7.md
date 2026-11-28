# Prompt de reprise — Assets du jeu et PR GitHub

```text
# Objectif

Termine la refonte des assets visuels du jeu « Les Chroniques de Félingard » et propose les changements dans une nouvelle pull request GitHub que je pourrai examiner et fusionner.

Dépôt public :
https://github.com/adultehugo-dotcom/cat-quest-3

La PR #1 a été fusionnée. Pars du `main` distant le plus récent; ne te base pas sur un état antérieur de GitHub.

# Préserver le travail existant

Commence par examiner l’état Git, les branches, les remotes, l’historique et les fichiers modifiés. Le checkout local connu est :

`C:\Users\hugos\.gemini\antigravity\scratch\cat-quest-proto`

Il peut contenir du travail non poussé. Inspecte-le sans le nettoyer ni l’écraser; compare-le au `main` distant et ne reporte que les changements utiles à cette tâche. Ne lance pas `git reset --hard`, `git clean`, de restauration globale, de suppression générale ou de `git add .`. Préserve les changements sans rapport.

Travaille sur une branche distincte créée depuis le `main` distant actuel. Vérifie que son nom est libre avant de l’utiliser. Ne pousse jamais directement sur `main`.

# Audit et inventaire

Lis et vérifie dans le checkout local, s’ils existent :

- `GRAPHIFY_ASSET_AUDIT.md`
- `ASSET_PRODUCTION_MATRIX.md`
- `ASSET_INTEGRATION_MANIFEST.md`
- `MARITIME_OVERHAUL_REPORT.md`

Utilise Graphify avant toute production visuelle. Recoupe son graphe par des recherches statiques dans les registres, chargeurs, renderers et références du code. Repère aussi les usages indirects, les chemins dynamiques, les états d’animation et les phases de boss.

Établis une matrice asset par asset des visuels réellement utilisés et atteignables. Pour chaque asset, indique son chemin actuel, son usage vérifié, son chemin cible, ses dimensions, ses directions et animations réelles, ainsi que son statut : à produire, produit, inspecté, intégré, vérifié ou bloqué.

Les rapports précédents évoquent 107 assets et 1 021 frames à produire. Vérifie ces nombres dans l’état actuel du code avant de les reprendre.

# Périmètre visuel

Refais avec l’IA les visuels actifs et atteignables, notamment le héros, les équipements visibles, les PNJ, le compagnon, les ennemis et boss, les objets interactifs, bâtiments, végétation, props, icônes réellement affichées et effets visuels chargés.

Exclus strictement :

- le sol et ses textures ou matériaux;
- le bateau et ses modèles ou textures;
- l’eau et ses textures ou matériaux;
- la musique et les effets sonores;
- les assets inutilisés, inatteignables, doublons, orphelins ou réservés.

Ne copie aucun asset de réserve comme substitut. Vérifie dans le code si les insectes ou arthropodes sont réellement actifs avant de les inclure.

# Génération et animations

Garde une direction artistique cohérente de fantasy féline colorée en 2D/2.5D. Utilise les visuels exclus uniquement comme références de cadrage, d’échelle et de palette.

Génère les remplacements avec un outil d’image IA autorisé et disponible. N’utilise pas d’images Web, d’assets de réserve ni de dessins procéduraux comme remplacement. Examine chaque résultat avant intégration. Si le générateur est indisponible ou bloqué par quota, consigne l’erreur et les assets bloqués; ne multiplie pas les essais, ne change pas de modèle pour contourner le blocage et ne prétends pas que les visuels sont terminés.

Les animations doivent utiliser de vraies frames distinctes. Vise 30 FPS selon la durée réelle des animations et les directions utilisées par le jeu. Documente les grilles, cellules, pivots, lignes de sol, directions, durées et modes boucle/one-shot. N’invente pas de directions ou d’états; ne duplique pas les frames et ne simule pas le mouvement en faisant osciller un sprite fixe.

Garde l’équipement indépendant, l’arme principale, le bouclier et la cape en couche séparée. Ne réintroduis pas d’arme secondaire. Préserve la physique, les plis et l’ancrage actuels de la cape.

# Intégration

Le projet utilise TypeScript, Vite, Three.js, Vitest, Playwright et Graphify. Inspecte les registres et interfaces avant de modifier le code. Examine notamment, s’ils sont présents :

- `src/art/hdAssets.ts`
- `src/art/textureRegistry.ts`
- `src/art/spriteHero.ts`
- `src/art/spriteEntities.ts`
- `src/render/entityRenderer.ts`
- `src/render/capePhysics.ts`

Réutilise le runtime, les registres et les chargeurs existants s’ils conviennent. N’introduis aucun chemin cassé, fichier manquant, 404 ou asset orphelin. Évite les allocations inutiles par frame.

Préserve le gameplay, les collisions, les hitboxes, la navigation, la physique, la météo, les shaders, l’éclairage, le sol, le bateau, l’eau et l’audio. Ne modifie ces systèmes que si une nécessité est démontrée; dans ce cas, explique précisément pourquoi et vérifie qu’aucune exclusion n’est altérée.

# Vérifications et documentation

Exécute réellement les vérifications adaptées, dont :

- `npx tsc --noEmit`
- `npm test -- --run`
- `npm run build`
- les parcours E2E pertinents sur ordinateur et mobile.

Inspecte les captures si l’environnement le permet. Vérifie les erreurs de console, WebGL/GLSL, réseau et 404, ainsi que les animations, phases de boss, équipement et cape.

Mets à jour les rapports d’audit, la matrice et le manifeste d’intégration, ainsi que `MARITIME_OVERHAUL_REPORT.md` s’il est présent. Sépare ce qui a été généré, intégré et vérifié de ce qui reste bloqué. Ne rapporte que les vérifications réellement exécutées.

# Publication

Je t’autorise à pousser les changements pertinents sur une nouvelle branche et à créer une pull request vers `main`. Je déciderai si je les accepte en fusionnant la PR.

Avant publication, vérifie le diff et exclue les secrets, clés API, données locales, fichiers temporaires et changements sans rapport. Utilise uniquement l’authentification GitHub déjà disponible; ne me demande jamais de coller un mot de passe ou un token dans le chat ou dans un fichier. Si une connexion officielle doit être effectuée par moi, demande-moi de la terminer puis reprends.

Committe uniquement les changements vérifiés, pousse la branche et ouvre une nouvelle PR avec une description factuelle des changements, tests et blocages. Ne fusionne pas la PR et ne déploie pas le jeu.
```

Hypothèse retenue : l’agent qui recevra ce prompt pourra accéder à un checkout local, exécuter des commandes et pousser une branche GitHub.
