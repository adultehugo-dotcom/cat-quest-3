# ASSET PRODUCTION MATRIX — Les Chroniques de Félingard

Matrice exhaustive asset par asset vérifiée sur `origin/main` (`2131eb2`, branche `assets/ai-overhaul-resume`).

**Légende des statuts** :
- `vérifié` : généré par IA (`generate_image`), détouré via `scripts/process_characters.mjs` (chroma `#FF00FF`, despill, `0 %` frange), inspecté sur planche QA, intégré dans `public/assets/`, compilé, testé (`tsc` + `vitest` + `vite build`) et vérifié visuellement en jeu (Playwright desktop & mobile, `0` 404, `0` erreur console/WebGL).
- `à produire` : actif et atteignable dans le jeu, non encore remplacé dans cette passe (budget de génération par session / planches multi-frames 30 FPS nécessitant une génération frame par frame dédiée sans duplication).
- `exclu` : hors périmètre strict (sol PBR, bateau, eau, audio, orphelins, doublons, réserve ou `0` appelant actif).

---

## 1. Bâtiments, Coffres, Végétation & Props actifs (`public/assets/props/`)

| Asset | Chemin actuel | Usage vérifié dans le code | Chemin cible | Dimensions | Dir. & Anim. réelles | Statut |
|---|---|---|---|---|---|---|
| Maison village | `public/assets/props/house_village.png` | `worldData.ts:241,251` (`building_house_west/east`), `worldRenderer.ts` | `public/assets/props/house_village.png` | `512×512` (1f) | Statique 3/4 face | **vérifié** |
| Auberge | `public/assets/props/building_inn.png` | `worldData.ts:205` (`building_inn`), `worldRenderer.ts` | `public/assets/props/building_inn.png` | `512×512` (1f) | Statique 3/4 face | **vérifié** |
| Forge Kit-Chat | `public/assets/props/building_forge.png` | `worldData.ts:229` (`building_forge`), `worldRenderer.ts` | `public/assets/props/building_forge.png` | `512×512` (1f) | Statique 3/4 face | **vérifié** |
| Panneau quêtes | `public/assets/props/prop_quest_board.png` | `worldData.ts:217` (`building_quest_board`), `worldRenderer.ts` | `public/assets/props/prop_quest_board.png` | `512×512` (1f) | Statique 3/4 face | **vérifié** |
| Coffre fermé | `public/assets/props/chest_closed.png` | `worldData.ts:430-467`, `worldIslands.ts:82`, `dungeonsData.ts`, `drawChestHdCanvas` | `public/assets/props/chest_closed.png` | `512×512` (1f) | Statique (4 paliers + locked) | **vérifié** |
| Coffre ouvert | `public/assets/props/chest_open.png` | `worldData.ts`, `worldIslands.ts`, `dungeonsData.ts`, `drawChestHdCanvas` | `public/assets/props/chest_open.png` | `512×512` (1f) | Statique (4 paliers) | **vérifié** |
| Chêne plaines | `public/assets/props/tree_oak.png` | `worldData.ts`, `worldIslands.ts` (19 refs `oak_tree`) | `public/assets/props/tree_oak.png` | `512×512` (1f) | Statique (balancement shader) | à produire |
| Arbre sombre | `public/assets/props/tree_dark.png` | `worldData.ts`, `worldIslands.ts` (16 refs `twisted_tree`) | `public/assets/props/tree_dark.png` | `512×512` (1f) | Statique | à produire |
| Sapin neige | `public/assets/props/tree_pine_snow.png` | `worldData.ts`, `worldIslands.ts` (13 refs `snow_pine`) | `public/assets/props/tree_pine_snow.png` | `512×512` (1f) | Statique | à produire |
| Rocher | `public/assets/props/prop_rock.png` | `worldData.ts`, `worldIslands.ts` (7 refs `rock`) | `public/assets/props/prop_rock.png` | `512×512` (1f) | Statique | à produire |
| Rocher enneigé | `public/assets/props/prop_rock_snow.png` | `worldData.ts`, `worldIslands.ts` (7 refs `snow_rock`) | `public/assets/props/prop_rock_snow.png` | `512×512` (1f) | Statique | à produire |
| Parterre fleurs | `public/assets/props/prop_flower_patch.png` | `worldData.ts`, `worldIslands.ts` (10 refs `flower_patch`) | `public/assets/props/prop_flower_patch.png` | `256×256` (1f) | Statique | à produire |
| Champignons | `public/assets/props/prop_mushroom.png` | `worldData.ts`, `worldIslands.ts` (8 refs `mushroom`) | `public/assets/props/prop_mushroom.png` | `256×256` (1f) | Statique | à produire |
| Panneau direction | `public/assets/props/prop_signpost.png` | `worldData.ts` (3 refs `signpost`) | `public/assets/props/prop_signpost.png` | `256×256` (1f) | Statique | à produire |
| Arche donjon | `public/assets/props/portal_dungeon.png` | `worldData.ts` (Grotte Fantôme, Antre Dragon-Griffe), `drawDungeonEntranceHdCanvas` | `public/assets/props/portal_dungeon.png` | `512×512` (1f) | Statique (thèmes + badge + sceau) | à produire |
| Torche donjon | `public/assets/props/prop_torch.png` | `dungeonsData.ts`, `worldRenderer.ts`, `drawTorchHdCanvas` | `public/assets/props/prop_torch.png` (ou sheet 15f) | `256×256` (cible 15f @ 30 FPS) | Loop 0.5s (15f) | à produire |
| Pilier donjon | `public/assets/props/prop_pillar.png` | `dungeonsData.ts`, `drawPillarHdCanvas` | `public/assets/props/prop_pillar.png` | `512×512` (1f) | Statique | à produire |
| Cristal soin | `public/assets/props/prop_crystal.png` | `dungeonsData.ts`, `drawHealingCrystalHdCanvas` | `public/assets/props/prop_crystal.png` | `256×256` (1f) | Statique (actif / utilisé) | à produire |
| Portail sortie donjon | Canvas2D (`drawDungeonExitPortalCanvas`) | `dungeonsData.ts`, `worldRenderer.ts` | `public/assets/props/portal_exit_sheet.png` | `512×512`/cell (6×5 = 30f) | Loop 1.0s @ 30 FPS | à produire |
| Lampadaire overworld | Procedural 3D (`OVERWORLD_LAMP_LIGHTS`, 16 pts) | `worldRenderer.ts:49-66` | `public/assets/props/prop_lamppost.png` | `512×512` (1f) | Statique | à produire |

---

## 2. Héros Chat-valier (`public/assets/characters/` — `lateralFlipOnly: true`, 30 FPS)

| État | Chemin actuel | Usage vérifié | Chemin cible | Grille / Dimensions cible | Mode & Durée | Statut |
|---|---|---|---|---|---|---|
| `idle` (aussi partagé `deck_idle`) | `hero_base_idle.png` (`512×512`) | `HERO_ANIM_CLIPS.idle`, `entityRenderer.ts` | `assets/characters/hero_base_idle_sheet.png` | `6×5 = 30f` (`3072×2560`, cell `512×512`) | Loop 1.0s @ 30 FPS | à produire |
| `walk` (aussi partagé `jump`) | `hero_base_walk1.png`, `hero_base_walk2.png` (`512×512`) | `HERO_ANIM_CLIPS.walk`, `entityRenderer.ts` | `assets/characters/hero_base_walk_sheet.png` | `6×5 = 30f` (`3072×2560`, cell `512×512`) | Loop 1.0s @ 30 FPS | à produire |
| `attack` | `hero_base_attack.png` (`512×512`) | `HERO_ANIM_CLIPS.attack`, `entityRenderer.ts` | `assets/characters/hero_base_attack_sheet.png` | `5×3 = 15f` (`2560×1536`, cell `512×512`) | One-shot 0.5s @ 30 FPS | à produire |
| `roll` (aussi partagé `death`) | `hero_base_roll.png` (`512×512`) | `HERO_ANIM_CLIPS.roll`, `entityRenderer.ts` | `assets/characters/hero_base_roll_sheet.png` | `5×3 = 15f` (`2560×1536`, cell `512×512`) | One-shot 0.5s @ 30 FPS | à produire |
| `hurt` (optionnel) | Partage `idle` + flash HDR | `HERO_ANIM_CLIPS.hurt` (`sharedFrom: 'idle'`) | `assets/characters/hero_base_hurt_sheet.png` | `5×3 = 15f` (`2560×1536`, cell `512×512`) | One-shot 0.5s @ 30 FPS | à produire |
| `death` (optionnel) | Partage `roll` fin | `HERO_ANIM_CLIPS.death` (`sharedFrom: 'roll'`) | `assets/characters/hero_base_death_sheet.png` | `6×5 = 30f` (`3072×2560`, cell `512×512`) | One-shot 1.0s @ 30 FPS | à produire |

---

## 3. Équipements visibles indépendants (`public/assets/equipment/` — 27 actifs, 0 arme secondaire)

| Slot | IDs actifs (`equipmentData.ts`) | Chemin actuel & cible | Dimensions | Couche & rendu | Statut |
|---|---|---|---|---|---|
| `weapon` (4) | `sword_wood`, `sword_steel`, `staff_arcane`, `blade_dragon` | `public/assets/equipment/<id>.png` | `256×256` | Couche corps héros (`spriteHero.ts`) | à produire |
| `shield` (2) | `shield_wood`, `shield_knight` | `public/assets/equipment/<id>.png` | `256×256` | Couche bouclier héros (`spriteHero.ts`) | à produire |
| `helmet` (4) | `helm_bandana`, `helm_knight`, `helm_mage`, `helm_dragon` | `public/assets/equipment/<id>.png` | `256×256` | Couche tête héros (`spriteHero.ts`) | à produire |
| `armor` (4) | `armor_tunic`, `armor_mail`, `armor_robe`, `armor_dragon` | `public/assets/equipment/<id>.png` | `256×256` | Couche torse héros (`spriteHero.ts`) | à produire |
| `boots` (4) | `boots_leather`, `boots_iron`, `boots_arcane`, `boots_dragon` | `public/assets/equipment/<id>.png` | `256×256` | Couche bottes héros (`spriteHero.ts`) | à produire |
| `gloves` (4) | `gloves_leather`, `gloves_iron`, `gloves_arcane`, `gloves_dragon` | `public/assets/equipment/<id>.png` | `256×256` | Couche gants héros (`spriteHero.ts`) | à produire |
| `trinket` (1) | `trinket_yarn` | `public/assets/equipment/trinket_yarn.png` | `256×256` | Couche bijou héros (`spriteHero.ts`) | à produire |
| `cape` (4) | `cape_traveler`, `cape_knight`, `cape_starlight`, `cape_dragon` | `public/assets/equipment/<id>.png` + `HD_CAPE_FABRIC_FILES` | `256×256` / `512×512` tissu | Couche 3D Verlet séparée (`CapeClothMesh`) | à produire |

---

## 4. PNJ & Compagnon actifs (`public/assets/characters/` — `lateralFlipOnly: true`)

| Entité | Chemin actuel | Usage vérifié | Chemin cible | Grille / Dimensions cible | Mode & Durée | Statut |
|---|---|---|---|---|---|---|
| `miaou_sprit` | `public/assets/characters/miaou_sprit.png` (`512×512`) | Compagnon 3D (`entityRenderer.ts`) + dialogues (`questsData.ts`) | `assets/characters/miaou_sprit_idle_sheet.png` | `6×5 = 30f` (cell `512×512`) | Loop 1.0s @ 30 FPS (`move`/`talk` partagés ou dédiés) | à produire |
| `mayor_moustache` | `public/assets/characters/mayor_moustache.png` (`512×512`) | PNJ 3D Miaou-bourg (`worldData.ts:264`) + dialogues (`questsData.ts`) | `assets/characters/mayor_moustache_idle_sheet.png` | `6×5 = 30f` (cell `512×512`) | Loop 1.0s @ 30 FPS (stationnaire) | à produire |

---

## 5. Ennemis & Boss actifs (`public/assets/characters/*_sheet.png` — 7 archétypes + Phase 2, 0 insecte)

| Archétype | Chemin actuel | Usage vérifié | Chemin cible | États & Frames cible @ 30 FPS (`cell 256×256`) | Statut |
|---|---|---|---|---|---|
| `slime_yarn` | `slime_yarn_sheet.png` (`1024×256`, 4×1) | `enemiesData.ts`, `worldData.ts`, `entityRenderer.ts` | `slime_yarn_sheet.png` (atlas) ou `HD_ENEMY_STATE_SHEET_FILES` | `idle` 30f (loop), `move` 24f (loop), `windup` 15f (1-shot), `attack` 15f (1-shot) = 84f (ou atlas 90c) | à produire |
| `mouse_goblin` | `mouse_goblin_sheet.png` (`1024×256`, 4×1) | `enemiesData.ts`, `worldData.ts`, `dungeonsData.ts` | `mouse_goblin_sheet.png` | Idem (`30+24+15+15 = 84f` / atlas 90c) | à produire |
| `thorn_wolf` | `thorn_wolf_sheet.png` (`1024×256`, 4×1) | `enemiesData.ts`, `worldData.ts` | `thorn_wolf_sheet.png` | Idem (`30+24+15+15 = 84f` / atlas 90c) | à produire |
| `fishbone_skeleton` | `fishbone_skeleton_sheet.png` (`1024×256`, 4×1) | `enemiesData.ts`, `dungeonsData.ts` (Grotte Fantôme) | `fishbone_skeleton_sheet.png` | Idem (`30+24+15+15 = 84f` / atlas 90c) | à produire |
| `frost_golem` | `frost_golem_sheet.png` (`1024×256`, 4×1) | `enemiesData.ts`, `worldData.ts` (Monts Prr-Glacés) | `frost_golem_sheet.png` | Idem (`30+24+15+15 = 84f` / atlas 90c) | à produire |
| `boss_rat_king` | `boss_rat_king_sheet.png` (`1024×256`, 4×1) | `enemiesData.ts`, `dungeonsData.ts` (Boss Grotte Fantôme) | `boss_rat_king_sheet.png` | `idle` 45f (loop), `move` 30f (loop), `windup` 30f (1-shot), `attack` 30f (1-shot) = 135f | à produire |
| `boss_dragon_claw` (P1) | `boss_dragon_claw_sheet.png` (`1024×256`, 4×1) | `enemiesData.ts`, `dungeonsData.ts` (Boss Antre Dragon-Griffe) | `boss_dragon_claw_sheet.png` | `idle` 45f, `move` 30f, `windup` 30f, `attack` 30f = 135f | à produire |
| `boss_dragon_claw` (P2) | Composite `drawBossDragonPhase2SheetCanvas` | `textureRegistry.ts:1068`, `entityRenderer.ts` (phase 2 <= 50 % PV) | `HD_ENEMY_PHASE2_SHEET_FILES.boss_dragon_claw` | `idle` 45f, `move` 30f, `windup` 30f, `attack` 30f = 135f | à produire |

---

## 6. Icônes UI & VFX particules

| Groupe | État vérifié dans le code | Chemins cibles | Dimensions | Statut |
|---|---|---|---|---|
| Icônes équipements (27) | `public/assets/icons/equip/*.png` présents (`128×128`), `0` appelant dans `src/ui/` | `public/assets/icons/equip/<id>.png` | `128×128` | à produire (si branchement UI) |
| Icônes sorts (7) | 4 PNG présents (`flamepurr`, `lightnyan`, `freezepaw`, `healing_paw`) + 3 absents (`aegis_purr`, `pounce_dash`, `meteor_paw`), HUD utilise SVG inline | `public/assets/icons/spells/<id>.png` | `128×128` | à produire (si branchement UI) |
| Icônes HUD (5) | `gold`, `inventory`, `key`, `map`, `quests` (`96×96`), `0` appelant dans `src/ui/` | `public/assets/icons/ui/<id>.png` | `96×96` | à produire (si branchement UI) |
| VFX particules (2) | `drawParticleCanvas` (`particle_orb`), `drawStarParticleCanvas` (`particle_star`) dans `textureRegistry.ts:172-189` | Optionnel PNG `64×64` ou `128×128` | `64×64` | à produire |

---

## 7. Exclusions strictes (non modifiées — vérifiées par `git status`)

- **Sol PBR** : 18 fichiers `public/assets/textures/{grass,forest,snow,path,dungeon_ghost,dungeon_dragon}_{albedo,normal,roughness}.png` + `src/art/mapTexture.ts` (`exclu`).
- **Bateau** : `src/render/shipRenderer.ts`, `src/render/shaders/shipShaders.ts`, `src/game/shipPhysics.ts`, `src/game/shorelineNavigation.ts` (`exclu`).
- **Eau** : `src/render/shaders/waterShader.ts` (`exclu`).
- **Audio** : 9 fichiers `public/assets/audio/**` + `src/audio/**` (`exclu`).
- **Orphelins, doublons & réserve** : `equipment/dagger_fang.png`, `icons/equip/dagger_fang.png`, `props/prop_fence.png`, `characters/hero_portrait.png`, `characters/kit_chat.png`, `characters/innkeeper.png`, les 7 `<enemy>.png` statiques redondants face à `*_sheet.png`, `asset-library/**` (`exclu`).
