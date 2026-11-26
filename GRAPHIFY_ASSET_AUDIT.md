# GRAPHIFY & STATIC ASSET AUDIT — Les Chroniques de Félingard

- **Dépôt source** : `https://github.com/adultehugo-dotcom/cat-quest-3`
- **Base Git** : `origin/main` (`2131eb2cb00878d65dfd5ab3963f76fdbc7be1b1`, après fusion PR #1 & PR #2)
- **Branche de travail** : `assets/ai-overhaul-resume`
- **Date d'audit** : 25 novembre 2026

## 1. Conditions d'exécution & limites d'environnement (transparence)

1. **Checkout local Windows (`C:\Users\hugos\.gemini\antigravity\scratch\cat-quest-proto`)** : inaccessible depuis cet environnement Linux isolé (`/app/applet`). Aucun fichier local non poussé depuis ce poste n'a pu être lu ni modifié ; la reprise repart proprement du `main` distant le plus récent (`2131eb2`).
2. **CLI Graphify** : binaire `graphify` absent du conteneur. L'inventaire complet a été établi par **recoupement statique exhaustif** sur tous les modules TypeScript (`src/art/`, `src/data/`, `src/render/`, `src/ui/`, `src/game/`) et sur l'arborescence disque (`public/assets/`, `asset-library/`).
3. **Publication GitHub** : `gh` absent et aucune authentification GitHub configurée dans ce conteneur ; aucun push ni ouverture de PR automatique possible sans connexion GitHub de l'utilisateur.

---

## 2. Inventaire disque vérifié dans `origin/main` (`2131eb2`)

Total dans `public/assets/` : **135 fichiers** (hors pièces jointes d'environnement exclues via `.git/info/exclude`).

| Dossier | Nb fichiers | Détail vérifié | Statut périmètre |
|---|---:|---|---|
| `public/assets/characters/` | 24 | 5 poses héros (`512×512`), 1 `hero_portrait.png` (`256×256`), 4 PNJ (`512×512`), 7 ennemis statiques (`512×512`), 7 spritesheets ennemis (`1024×256`, 4×1) | Mixte (actifs + doublons/inactifs listés §4) |
| `public/assets/equipment/` | 28 | 27 équipements actifs (`256×256`) + 1 orphelin `dagger_fang.png` (`256×256`) | 27 actifs / 1 exclu (`dagger_fang.png`) |
| `public/assets/icons/` | 37 | 28 `equip/*.png` (`128×128`), 4 `spells/*.png` (`128×128`), 5 `ui/*.png` (`96×96`) | Voir note §3.5 (`0` appelant UI actuel) |
| `public/assets/props/` | 19 | 14 props/bâtiments `512×512`, 5 props `256×256` | 18 actifs / 1 inactif (`prop_fence.png`) |
| `public/assets/textures/` | 18 | 6 surfaces PBR × 3 canaux (`albedo`, `normal`, `roughness`, `1024×1024`) | **STRICTEMENT EXCLU (sol PBR)** |
| `public/assets/audio/` | 9 | Musiques & ambiances météo | **STRICTEMENT EXCLU (audio)** |
| `asset-library/` | 1 | Dépôt distant contient uniquement un sous-dossier `Textures` (les 2 343 fichiers locaux évoqués en §16 ne sont pas suivis dans `main`) | **STRICTEMENT EXCLU (réserve)** |

---

## 3. Recoupement statique des registres, chargeurs, renderers & données

### 3.1 Héros & équipements modulaires (`src/art/hdAssets.ts`, `src/art/spriteHero.ts`, `src/render/entityRenderer.ts`, `src/render/capePhysics.ts`)
- **Clips déclarés (`HERO_ANIM_CLIPS`) à `TARGET_ANIMATION_FPS = 30`** :
  - États dédiés : `idle` (cible `6×5 = 30f`, legacy `1f`), `walk` (cible `6×5 = 30f`, legacy séquence 2 poses `hero_base_walk1` + `hero_base_walk2`), `attack` (cible `5×3 = 15f`, one-shot, legacy `1f`), `roll` (cible `5×3 = 15f`, one-shot, legacy `1f`).
  - États partagés explicitement documentés (`sharedFrom`) : `hurt` (`15f`, partage `idle` + flash HDR), `death` (`30f`, partage `roll` dernière frame), `deck_idle` (`30f`, partage `idle` sur pont), `jump` (`15f`, partage `walk` en embarquement/débarquement).
- **Directions** : `lateralFlipOnly: true` (orientation gauche/droite par `flipScaleX`). Aucune direction supplémentaire à inventer.
- **Équipement indépendant (`src/data/equipmentData.ts`)** : exactement **27 objets** répartis sur **8 emplacements indépendants** (`weapon` ×4, `shield` ×2, `helmet` ×4, `armor` ×4, `boots` ×4, `gloves` ×4, `cape` ×4, `trinket` ×1).
  - **Zéro arme secondaire** (`secondary_weapon` et `dagger_fang` explicitement ignorés dans `src/game/saveSystem.ts:320`).
  - **Cape séparée** : `HERO_BODY_EQUIP_SLOTS` exclut `cape` du cache corps 3D ; `CapeClothMesh` simule un maillage Verlet `11×13` (`143` sommets) avec support optionnel de texture tissu plane via `HD_CAPE_FABRIC_FILES` (`uCapeFabricMap`).

### 3.2 PNJ & Compagnon (`src/data/worldData.ts`, `src/data/questsData.ts`, `src/art/hdAssets.ts`)
- **Actifs et atteignables en jeu** :
  - `miaou_sprit` : compagnon flottant 3D (`EntityRenderer`) + portrait dialogue (`questsData.ts`), états `idle` (30f), `move` (24f, partagé `idle`), `talk` (30f, partagé `idle`).
  - `mayor_moustache` : PNJ 3D stationnaire à Miaou-bourg (`worldData.ts:264`) + portrait dialogue (`questsData.ts`), état `idle` (30f) & `talk` (30f, partagé `idle`).
- **Inactifs / 0 spawn 3D & 0 ligne de dialogue dans `main`** :
  - `kit_chat.png` et `innkeeper.png` : chargés dans `HD_CHARACTER_FILES` et pré-rendus dans `main.ts:55-58` mais `0` instance NPC dans `worldData.ts`/`worldIslands.ts`/`dungeonsData.ts` et `0` ligne de dialogue dans `questsData.ts` (interactifs via bâtiments Forge/Auberge). Conservés sans suppression pour ne pas casser `HD_CHARACTER_FILES`, mais classés hors priorité visuelle tant qu'ils ne sont pas affichés.

### 3.3 Ennemis, Boss & Phases (`src/data/enemiesData.ts`, `src/art/hdAssets.ts`, `src/art/textureRegistry.ts`)
- **7 archétypes actifs vérifiés** :
  1. `slime_yarn` (standard)
  2. `mouse_goblin` (standard)
  3. `thorn_wolf` (standard)
  4. `fishbone_skeleton` (standard)
  5. `frost_golem` (standard)
  6. `boss_rat_king` (boss — Grotte Fantôme)
  7. `boss_dragon_claw` (boss 2 phases — Antre du Dragon-Griffe ; Phase 2 gérée via `HD_ENEMY_PHASE2_SHEET_FILES` ou fallback composite `drawBossDragonPhase2SheetCanvas`)
- **Vérification insectes / arthropodes** : **0 ennemi insecte ou arthropode actif** dans `src/data/enemiesData.ts` (`slime_yarn`, `mouse_goblin`, `thorn_wolf`, `fishbone_skeleton`, `frost_golem`, `boss_rat_king`, `boss_dragon_claw`). Strictement exclu.
- **Planches chargées en priorité** : `HD_ENEMY_SHEET_FILES` (`*_sheet.png`, actuellement `1024×256` 4×1 : `idle=0`, `move=1`, `windup=2`, `attack=3`). Les 6 PNG statiques `512×512` correspondants (`slime_yarn.png`..`boss_rat_king.png`) ne servent qu'en fallback si `*_sheet.png` échoue ; `boss_dragon_claw.png` reste également doublon de la spritesheet active.

### 3.4 Bâtiments, objets interactifs, végétation & props (`src/data/worldData.ts`, `src/data/worldIslands.ts`, `src/data/dungeonsData.ts`, `src/render/worldRenderer.ts`)
- **Bâtiments Miaou-bourg actifs** : `house_village` (2 maisons), `building_inn` (Auberge), `building_forge` (Forge), `prop_quest_board` (Panneau de quêtes) -> **4/4 régénérés par IA, inspectés, intégrés et vérifiés dans cette passe**.
- **Coffres actifs** : `chest_closed`, `chest_open` (réutilisés pour les 4 paliers `wood`/`rare`/`epic`/`golden` et l'état `locked` via `drawChestHdCanvas` dans `spriteProps.ts`) -> **2/2 régénérés par IA, inspectés, intégrés et vérifiés dans cette passe**.
- **Autres props actifs** : `tree_oak` (19 refs), `tree_dark` (16 refs), `tree_pine_snow` (13 refs), `prop_rock` (7 refs), `prop_rock_snow` (7 refs), `prop_flower_patch` (10 refs), `prop_mushroom` (8 refs), `prop_signpost` (3 refs), `portal_dungeon` (entrées Grotte Fantôme & Antre Dragon-Griffe), `prop_torch`, `prop_pillar`, `prop_crystal` (donjons).
- **Éléments 100 % procéduraux encore sans PNG dédié** : portail de sortie donjon (`drawDungeonExitPortalCanvas`), lampadaires 3D/billboard des `16` points `OVERWORLD_LAMP_LIGHTS`.
- **Inactif vérifié** : `prop_fence.png` (`0` occurrence de `'fence'` dans `worldData.ts`, `worldIslands.ts` et `dungeonsData.ts`).

### 3.5 Icônes UI & VFX (`src/art/hdAssets.ts`, `src/ui/hudController.ts`, `src/ui/modalsController.ts`, `src/render/effectsRenderer.ts`)
- **Constat statique vérifié** : `getEquipmentIconUrl`, `getSpellIconUrl` et `getHudIconUrl` dans `src/art/hdAssets.ts:1071-1083` ont actuellement **0 appelant** dans `src/ui/`. Les icônes affichées dans le HUD (`hudController.ts`) et les modales (`modalsController.ts`) sont des SVG/emojis inline (dont les 7 sorts : `flamepurr`, `lightnyan`, `freezepaw`, `healing_paw`, `aegis_purr`, `pounce_dash`, `meteor_paw`).
- **PNG manquants si l'UI bascule vers `public/assets/icons/spells/`** : `aegis_purr.png`, `pounce_dash.png`, `meteor_paw.png`.
- **VFX particules (`src/art/textureRegistry.ts:172-189`)** : `drawParticleCanvas` (`particle_orb`, `64×64`) et `drawStarParticleCanvas` (`particle_star`, `64×64`) générés en Canvas2D au démarrage ; les sorts/télégraphes/slashs utilisent des shaders GLSL dédiés (`spellShaders.ts`, `telegraphShader.ts`) à préserver.

---

## 4. Vérification des chiffres annoncés (107 assets / 1 021 frames)

Le rapport §16 annonçait **107 assets** et **1 021 frames** cibles. Recoupement exact sur `origin/main` (`2131eb2`) :

| Catégorie | Nb entrées cibles | Frames cibles (30 FPS) | Remarque vérifiée dans le code |
|---|---:|---:|---|
| Héros (`idle`, `walk`, `attack`, `roll` + `hurt`/`death`) | 6 | 135 | 4 clips actifs dédiés (`30+30+15+15 = 90f`) + 2 optionnels (`15+30 = 45f`) |
| Équipements modulaires actifs (23 corps + 4 textures tissu cape) | 27 | 27 | `dagger_fang` exclu (`0` arme secondaire) |
| PNJ & Compagnon actifs (`miaou_sprit`, `mayor_moustache`) | 2 | 60 | `kit_chat` & `innkeeper` à `0` spawn 3D et `0` dialogue |
| Ennemis standards (5 × `30+24+15+15` ou atlas 90c) | 5 | 420 | `slime_yarn`, `mouse_goblin`, `thorn_wolf`, `fishbone_skeleton`, `frost_golem` |
| Boss (2 × `45+30+30+30` + Phase 2 `boss_dragon_claw`) | 3 | 405 | `boss_rat_king`, `boss_dragon_claw` P1, `boss_dragon_claw` P2 (ou `270f` si P2 partage la grille) |
| Bâtiments, Coffres, Végétation & Props actifs | 18 (+2 futurs) | 18 (+45 anim) | 18 PNG actifs dans `props/` (`prop_fence` exclu) ; `prop_torch` (15f) + `portal_exit` (30f) si animés |
| Icônes UI/Sorts/Équipement (si branchées en PNG) | 42 | 42 | 27 équipements + 7 sorts + 8 HUD (actuellement `0` appelant dans `src/ui/`, rendus en SVG inline) |
| VFX particules sprites | 2 | 2 | `particle_orb`, `particle_star` |

**Conclusion d'audit** :
- Le périmètre **strictement actif et actuellement rendu par le moteur 3D** représente **61 assets actifs** (dont **6 régénérés, inspectés, intégrés et vérifiés dans cette passe** : `house_village`, `building_inn`, `building_forge`, `prop_quest_board`, `chest_closed`, `chest_open`).
- En incluant les **42 icônes PNG** (à brancher dans `src/ui/`), les **2 VFX particules** et les **2 props additionnels** (`portal_exit_sheet`, `prop_lamppost`), on retrouve l'enveloppe globale de **107 entrées cibles** (`~1 021` à `1 154` frames selon que `hurt`/`death` héros et `Phase 2` dragon soient produits en planches séparées ou partagées).

---

## 5. Exclusions strictes vérifiées (`0` modification)

- **Sol & PBR (`public/assets/textures/**`, `src/art/mapTexture.ts`)** : intact (`0` fichier modifié).
- **Bateau (`src/render/shipRenderer.ts`, `src/render/shaders/shipShaders.ts`, `src/game/shipPhysics.ts`, `src/game/shorelineNavigation.ts`)** : intact (`0` fichier modifié).
- **Eau (`src/render/shaders/waterShader.ts`)** : intact (`0` fichier modifié).
- **Audio (`public/assets/audio/**`, `src/audio/**`)** : intact (`0` fichier modifié).
- **Inutilisés / doublons / réserve** : `dagger_fang.png`, `icons/equip/dagger_fang.png`, `prop_fence.png`, `hero_portrait.png`, `kit_chat.png`, `innkeeper.png`, les 7 `<enemy>.png` statiques redondants et `asset-library/**` n'ont pas été régénérés ni copiés comme substituts.
