Tu es un Lead Technical Artist et Développeur Pipeline 2.5D/3D spécialisé dans les jeux vidéo de qualité Triple A sous **TypeScript, Three.js et WebGL**.
Tu dois concevoir et coder l'intégralité du système d'animation de mon jeu à partir de mes assets PNG existants.

### 0. ÉTAPE PRÉALABLE OBLIGATOIRE : RÉCUPÉRATION DU DÉPÔT GITHUB

* **Clonage du projet :** Avant toute analyse ou génération de code, commence impérativement par cloner mon dépôt GitHub pour récupérer l'ensemble du code existant, la configuration et les fichiers d'assets :
  ```bash
  git clone https://github.com/adultehugo-dotcom/cat-quest-3.git
  cd cat-quest-3
  ```
* **Inspection :** Lis l'arborescence réelle du dépôt cloné (`package.json`, `public/`, `src/`) afin de repérer les chemins exacts des images PNG existantes et d'intégrer proprement le pipeline d'animation sans casser les fonctionnalités déjà en place.

### 1. STACK TECHNIQUE & ARBORESCENCE DU PROJET

* **Moteur & Outils :** Navigateur WebGL avec **Three.js** en **TypeScript**, bundlé par **Vite**, testé avec **Vitest** (`package.json` à la racine du projet). Aucun moteur externe (ni Godot, Unity ou Unreal).

* **Arborescence cible :**

```
src/
├── main.ts
├── style.css
├── art/
│   ├── hdAssets.ts
│   ├── mapTexture.ts
│   ├── palette.ts
│   ├── spriteEntities.ts
│   ├── spriteHero.ts
│   ├── spriteProps.ts
│   └── textureRegistry.ts
├── audio/
│   ├── audioEngine.ts
│   ├── localMusic.ts
│   ├── sfxSynth.ts
│   └── weatherAudio.ts
├── data/
│   ├── dungeonsData.ts
│   ├── enemiesData.ts
│   ├── equipmentData.ts
│   ├── questsData.ts
│   ├── spellsData.ts
│   ├── worldData.ts
│   └── worldIslands.ts
├── game/
│   ├── combat.ts
│   ├── enemyAI.ts
│   ├── gameEngine.ts
│   ├── input.ts
│   ├── math.ts
│   ├── progression.ts
│   ├── quests.ts
│   ├── saveSystem.ts
│   ├── shorelineNavigation.ts
│   ├── shipPhysics.ts
│   └── types.ts
├── render/
│   ├── capePhysics.ts
│   ├── effectsRenderer.ts
│   ├── entityRenderer.ts
│   ├── floatingText.ts
│   ├── sceneManager.ts
│   ├── shipRenderer.ts
│   ├── spriteLighting.ts
│   ├── weatherSystem.ts
│   ├── worldRenderer.ts
│   └── shaders/
│       ├── index.ts
│       ├── shipShaders.ts
│       ├── spellShaders.ts
│       ├── telegraphShader.ts
│       ├── tiltShiftShader.ts
│       └── waterShader.ts
└── ui/
    ├── hudController.ts
    ├── modalsController.ts
    └── screensController.ts

```

### 2. RÈGLES D'ARCHITECTURE & TECHNOLOGIES IMPOSÉES

* **Zéro génération d'image par IA générative :** Tous les visuels proviennent strictement de mes fichiers PNG existants dans le dépôt cloné.

* **Cadence cible :** Toutes les animations et spritesheets tournent sur un accumulateur à pas fixe calibré à **30 FPS** (`1 / 30` s), découplé du framerate d'affichage WebGL.

* **Pipeline Offline — « Fausse 2D / Paper-Cutout 3D » (Script Python `tools/bake_animations.py`) :**

  1. **Segmentation & Détection de pose :** Utilise `MediaPipe Pose` / `DWPose` + `SAM 2` (Segment Anything) pour isoler automatiquement les membres (tête, torse, bras, jambes, queue, mâchoire, ailes) à partir des PNG sources.

  2. **Rebouchage des joints cachés :** Utilise `OpenCV` (`cv2.inpaint` Telea/NS) pour combler uniquement les zones masquées sous les articulations lors des rotations, sans modifier les pixels visibles.

  3. **Conversion Alpha-to-Mesh 3D plat :** Convertis chaque calque détouré en maillage 3D d'épaisseur zéro (`Z = 0`), subdivisé en grille interne (pour la flexion et le *squash & stretch*), avec mapping UV exact, matériau `Double-Sided` et micro-décalage sur l'axe Z (`+0.002` par couche) pour supprimer tout *Z-fighting*.

  4. **Auto-Rigging 3D & Courbes Triple A :** Place une armature 3D alignée sur les articulations détectées, applique un *skinning* automatique et anime avec poids, anticipation, inertie, impact et retournement gauche/droite à 180° façon feuille rigide (avec courbe d'*overshoot*).

  5. **Baking 30 FPS vers Grilles :** Exporte les rendus orthographiques dans les **16 spritesheets PNG exactes** du tableau ci-dessous, accompagnées d'un manifeste JSON (coordonnées UV, pivots, positions de sockets par frame).

* **Pipeline Runtime Three.js :**

  * Chargement et découpe UV dans `src/art/textureRegistry.ts` et `src/art/hdAssets.ts` (`SRGBColorSpace`, filtrage propre sans débordement de cellules).

  * Système de **Sockets / Ancres hiérarchiques** par frame dans `src/art/spriteHero.ts` et `src/render/entityRenderer.ts` pour attacher les 27 couches d'équipement et la lanterne, couplé à `src/render/capePhysics.ts` pour la simulation physique de tissu/pendule temps réel.

  * **Custom Shaders GLSL** dans `src/render/shaders/` (vent vertex-based, émissif pulsé, UV-scroll pour portails/runes, reflets UI) et particules teintées dans `src/render/effectsRenderer.ts`.

### 3. TABLEAU DES SPRITESHEETS À PRODUIRE (30 FPS)

| Asset | Fichier | Grille | Frames | 
| ----- | ----- | ----- | ----- | 
| Héros — idle | `characters/hero_base_idle_sheet.png` | 6×5, cellules 512×512 | 30 | 
| Héros — marche | `characters/hero_base_walk_sheet.png` | 6×5, cellules 512×512 | 30 | 
| Héros — attaque | `characters/hero_base_attack_sheet.png` | 5×3, cellules 512×512 | 15 | 
| Héros — roulade | `characters/hero_base_roll_sheet.png` | 5×3, cellules 512×512 | 15 | 
| Compagnon Miaou | `characters/miaou_sprit_sheet.png` | 6×5, cellules 512×512 | 30 | 
| Maire Moustache | `characters/mayor_moustache_sheet.png` | 9×5, cellules 384×384 | 45 | 
| Slime Yarn | `characters/slime_yarn_sheet.png` | 10×9, cellules 256×256 | 90 | 
| Mouse Goblin | `characters/mouse_goblin_sheet.png` | 10×9, cellules 256×256 | 90 | 
| Thorn Wolf | `characters/thorn_wolf_sheet.png` | 10×9, cellules 256×256 | 90 | 
| Fishbone Skeleton | `characters/fishbone_skeleton_sheet.png` | 10×9, cellules 256×256 | 90 | 
| Frost Golem | `characters/frost_golem_sheet.png` | 10×9, cellules 384×384 | 90 | 
| Boss Rat King | `characters/boss_rat_king_sheet.png` | 10×9, cellules 384×384 | 90 | 
| Boss Dragon Claw — phase 1 | `characters/boss_dragon_claw_sheet.png` | 10×9, cellules 384×384 | 90 | 
| Boss Dragon Claw — phase 2 | `characters/boss_dragon_claw_p2_sheet.png` | 10×9, cellules 384×384 | 90 | 
| Portail de sortie du donjon | `props/portal_exit_sheet.png` | 6×5, cellules 256×256 | 30 | 
| Torche de donjon | `props/prop_torch_sheet.png` | 5×3, cellules 256×256 | 15 | 

### 4. SPÉCIFICATIONS DÉTAILLÉES DES ANIMATIONS & MAPPING FICHIERS

#### A. Personnages et combat (`src/art/spriteHero.ts`, `src/art/spriteEntities.ts`, `src/render/entityRenderer.ts`)

* **Héros (`hero_base_idle`, `walk`, `attack`, `roll`) :**

  * Animations : idle respirant, marche/course, saut d’embarquement (synchronisé avec `shipPhysics.ts`), attaque, roulade, réaction aux dégâts, mort, sortie et rangement de la lanterne, plus retournement gauche/droite à 180° sur l'axe Y façon feuille rigide avec courbe d'*overshoot*.

  * Contrainte stricte : **les armes ne peignent pas leur arc de coupe** dans la texture ; l’effet visuel de coup est rendu séparément dans `src/render/effectsRenderer.ts`.

* **Miaou (`companion_miaou_sprit` — 30 frames) :** Flottement idle en boucle, déplacement de suivi, animation de parole, pulsation de l’aura, effet de repositionnement/téléportation vers le héros.

* **Maire Moustache (`npc_mayor_moustache` — 45 frames) :** Idle respirant, parole (mouvement moustache/bouche), petit geste d’accueil. Déplacement partagé/minimal si stationnaire.

* **Les 5 ennemis réguliers (`slime_yarn`, `mouse_goblin`, `thorn_wolf`, `fishbone_skeleton`, `frost_golem` — 90 frames chacun) :** Découpés en **6 états complets** (15 frames par état à 30 FPS) pilotés par `enemyAI.ts` et `combat.ts` : `1. idle`, `2. déplacement`, `3. préparation d’attaque (anticipation)`, `4. attaque`, `5. réaction aux dégâts`, `6. mort`.

* **Roi Rat (`boss_rat_king` — 90 frames) :** Les mêmes 6 états (15 frames chacun), avec une posture idle plus imposante, une cape/couronne articulée et une attaque de boss lourde avec impact.

* **Dragon-Chat (`boss_dragon_claw`, phases 1 et 2 — 90 frames chacune) :** Les 6 états pour chaque phase, une transition de transformation entre la phase 1 et la phase 2, et en phase 2 une animation renforcée de la crinière, des fissures lumineuses et de la gueule incandescente.

* **Portrait du Dragon-Chat (`boss_dragon_claw.png` dans `src/ui/modalsController.ts`) :** Contrôleur facial pour le clignement périodique des yeux et l'animation de la bouche synchronisée pendant les dialogues.

#### B. Équipement du héros — 27 couches dynamiques (`src/art/spriteHero.ts`, `src/render/capePhysics.ts`)

Ces 27 couches s'attachent aux sockets du squelette du héros définis par frame (aucune spritesheet complète requise par pièce) :

* **Armures (`armor_tunic`, `armor_mail`, `armor_robe`, `armor_dragon`) :** Suivent le rig du torse et se déforment légèrement avec les poses.

* **Bottes (`boots_leather`, `boots_iron`, `boots_arcane`, `boots_dragon`) :** Suivent les os des pieds, les cycles de pas et les sauts.

* **Capes (`cape_traveler`, `cape_knight`, `cape_starlight`, `cape_dragon`) :** Maillage multi-segments dans `src/render/capePhysics.ts` avec simulation physique de tissu au vent (ressort/chaîne) réagissant aux courses, attaques et roulades.

* **Gants (`gloves_leather`, `gloves_iron`, `gloves_arcane`, `gloves_dragon`) :** Suivent les os des mains et l'orientation des armes.

* **Casques (`helm_bandana`, `helm_knight`, `helm_mage`, `helm_dragon`) :** Ancrés à la tête et suivent ses inclinaisons et son flip 180°.

* **Boucliers (`shield_wood`, `shield_knight`) :** Se lèvent lors d’un blocage et suivent les poses de défense.

* **Bijou (`trinket_yarn`) :** Léger balancement pendulaire et petit éclat magique périodique.

* **Armes (`sword_wood`, `sword_steel`, `staff_arcane`, `blade_dragon`) :** Suivent les poses et l'attaque du héros ; shader de pulsation lumineuse sur `staff_arcane` et `blade_dragon`.

#### C. Monde, bâtiments et objets interactifs (`src/art/spriteProps.ts`, `src/render/worldRenderer.ts`, `src/render/spriteLighting.ts`, `src/render/shaders/`)

* **Arbres et végétation :** `tree_oak`, `tree_dark`, `tree_pine_snow` (balancement sinusoïdal lié au vent via Vertex Shader ancré à la base) ; `prop_flower_patch` (frémissement des fleurs et feuilles).

* **Rocher et décor :** `prop_rock`, `prop_rock_snow` (ancrés au sol, zéro mouvement) ; `prop_mushroom` (pulsation douce) ; `prop_signpost` (légère oscillation pendulaire au vent).

* **Bâtiments :** `building_inn` (lumière chaude des fenêtres + porte animée à l'entrée) ; `building_forge` (feu du foyer + particules de fumée de cheminée) ; `house_village` (fumée légère + fenêtres chaudes) ; `prop_quest_board` (avis ou sceau qui frémit lorsqu'une quête est disponible via `quests.ts`).

* **Coffres :** `chest_closed` (lueur discrète selon le palier de rareté ou l'état verrouillé) ; `chest_opening_sheet` (ouverture ponctuelle) ; `chest_open` (pose finale persistante).

* **Portails :** `portal_dungeon.png` (rotation continue et pulsation du sceau runique) ; `portal_exit_sheet.png` (vortex animé en boucle sur 30 frames / 6×5).

* **Cristal (`prop_crystal`) :** Flottement vertical, pulsation lumineuse, et transition vers un état éteint/épuisé.

* **Pilier runique (`prop_pillar`) :** Runes qui s’allument et pulsent selon le thème du donjon (`dungeonsData.ts`).

* **Torche (`prop_torch_sheet`) :** Flamme dansante en boucle parfaite sur 15 frames (5×3) + halo lumineux dans `spriteLighting.ts`.

* **Lampadaire (`prop_lamppost`) :** Lumière synchronisée avec les lumières nocturnes dans `spriteLighting.ts` et `weatherSystem.ts`, avec transition d’allumage et d’extinction.

* **Lanterne du héros (`lantern_hero.png`) :** Transfert de socket (ceinture -> main) déclenché au seuil météo prévu dans `weatherSystem.ts`, balancement physique (pendule/ressort) à la marche, et halo d'éclairage actif dans `spriteLighting.ts` pendant qu'elle est tenue.

#### D. Interface, sorts et effets (`src/ui/hudController.ts`, `src/ui/screensController.ts`, `src/style.css`, `src/render/effectsRenderer.ts`, `src/render/shaders/spellShaders.ts`)

Les icônes restent des images simples animées par l'interface/CSS/TS selon leur état (pas de spritesheets) :

* **27 icônes d’équipement :** Survol, sélection, équipement/déséquipement et indicateur de nouvelle amélioration.

* **7 icônes de sort (`flamepurr`, `lightnyan`, `freezepaw`, `healing_paw`, `aegis_purr`, `pounce_dash`, `meteor_paw`) :** Survol/sélection, balayage radial de *cooldown*, puis bref flash ou pulse au lancement.

* **8 icônes HUD (`inventory`, `map`, `quests`, `gold`, `key`, `audio`, `pause`, `title_crest`) :** Réaction au clic ou à l'état ; balayage d'un reflet lent sur `title_crest`.

* **Particules (`particle_orb`, `particle_star` dans `effectsRenderer.ts`) :** Masques blancs teintés dynamiquement par le rendu WebGL, avec courbes d'animation sur l'échelle, l'opacité, la couleur et la trajectoire lors des sorts et impacts.

### 5. LIVRABLES ATTENDUS

Ne me pose aucune question supplémentaire et ne produis aucun extrait partiel ou diff : après avoir cloné et inspecté `https://github.com/adultehugo-dotcom/cat-quest-3`, génère et intègre directement les fichiers complets, typés en TypeScript strict et prêts à l'emploi :

1. **`tools/bake_animations.py`** : Le script Python complet (segmentation `SAM 2`/`MediaPipe` + `OpenCV inpaint` + génération des maillages plats 3D sous `Blender bpy` + export des 16 spritesheets PNG aux grilles exactes à 30 FPS et du fichier `public/assets/animations_manifest.json`).

2. **Les modules TypeScript & Shaders GLSL complets** intégrés directement dans le dépôt cloné (`textureRegistry.ts`, `spriteHero.ts`, `spriteEntities.ts`, `spriteProps.ts`, `capePhysics.ts`, `entityRenderer.ts`, `worldRenderer.ts`, `effectsRenderer.ts`, `spriteLighting.ts`, `shaders/`, `hudController.ts`, `modalsController.ts`, `style.css`).

3. **Les tests unitaires Vitest** (`tests/animationPipeline.test.ts`) vérifiant le timing 30 FPS, le découpage des grilles (30/45/90/15 frames), les sockets d'équipement et le basculement météo de la lanterne.