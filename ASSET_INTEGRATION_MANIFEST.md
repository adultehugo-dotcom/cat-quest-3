# ASSET INTEGRATION MANIFEST — Les Chroniques de Félingard

- **Branche** : `assets/ai-overhaul-resume` (depuis `origin/main` `2131eb2`)
- **Runtime cible** : `src/art/hdAssets.ts`, `src/art/textureRegistry.ts`, `src/art/spriteHero.ts`, `src/art/spriteEntities.ts`, `src/render/entityRenderer.ts`, `src/render/capePhysics.ts`

---

## 1. Contrats techniques du runtime (vérifiés dans `src/art/hdAssets.ts`)

### 1.1 Pivots & lignes de sol normalisés
| Entité | `pivotX` | `pivotY` | `groundLineRatio` | Directions (`lateralFlipOnly`) |
|---|---:|---:|---:|---|
| Héros (`HERO_PIVOT`) | `0.5` | `0.0` | `446 / 512` (`0.871`) | Droite + miroir `flipX` (`true`) |
| PNJ au sol (`NPC_PIVOT`) | `0.5` | `0.0` | `472 / 512` (`0.922`) | Droite + miroir `flipX` (`true`) |
| Compagnon flottant (`COMPANION_PIVOT`) | `0.5` | `0.0` | `0.5` | Droite + miroir `flipX` (`true`) |
| Ennemis & Boss (`ENEMY_PIVOT`) | `0.5` | `0.0` | `238 / 256` (`0.930`) | Droite + miroir `flipX` (`true`) |
| Bâtiments & Props (`HD_PROP_FILES`) | `0.5` | `0.0` | Bas de quad (`padding-bottom: 10-16 px` sur `512×512`) | Front/3/4 diorama fixe (`SPRITE_TILT_X = -0.48 rad`) |

### 1.2 Grilles, cadences 30 FPS, durées & modes boucle/one-shot
- **Cadence canonique** : `TARGET_ANIMATION_FPS = 30`.
- **Parcours grille** : ordre ligne-majeure `(col = absCell % cols, row = floor(absCell / cols))` avec inversion `flipY` UV Three.js (`computeGridFrameUvInto`, zéro allocation par frame).
- **Auto-détection rétrocompatible** : `resolveActiveSpriteGrid()` et `resolveEnemyAtlasStateGrid()` lisent sans erreur les PNG unitaires (`512×512`), les planches legacy (`1024×256` 4×1), les planches dédiées (`15f` `5×3`, `24f` `6×4`, `30f` `6×5`, `45f` `9×5`) et les atlas empaquetés `90` cellules (`30f idle + 30f move + 15f windup + 15f attack`).
- **Zéro 404** : les registres optionnels (`HD_HERO_SHEET_FILES`, `HD_EQUIPMENT_SHEET_FILES`, `HD_NPC_SHEET_FILES`, `HD_ENEMY_STATE_SHEET_FILES`, `HD_ENEMY_PHASE2_SHEET_FILES`, `HD_CAPE_FABRIC_FILES`) ne doivent contenir que des chemins effectivement présents dans `public/assets/`.
- **Équipement & Cape** :
  - 8 emplacements indépendants (`weapon`, `shield`, `helmet`, `armor`, `boots`, `gloves`, `cape`, `trinket`), **0 arme secondaire**.
  - `HERO_BODY_EQUIP_SLOTS` exclut `cape` ; la cape reste simulée en tissu Verlet 3D (`CapeClothMesh`, `11×13 = 143` sommets) avec support optionnel de texture tissu plane `HD_CAPE_FABRIC_FILES`.

---

## 2. Assets générés par IA, inspectés, intégrés & vérifiés dans cette passe (`6/6`)

Pipeline appliqué à chaque asset : génération IA (`generate_image`, fond chroma uni `#FF00FF`, direction artistique fantasy féline colorée 2D/2.5D) -> détourage chirurgical, despill & rééchantillonnage Lanczos-3 `512×512` RGBA via `scripts/process_characters.mjs` -> inspection visuelle sur planche QA (damier / fond sombre / fond herbe) -> dépôt direct dans `public/assets/props/` -> vérification navigateur Playwright (`1280×720` & `375×667`).

| Asset | Chemin intégré | Dimensions | Frange chroma (`magEdgePct`) | Couverture | Statut |
|---|---|---|---:|---:|---|
| Maison village | `public/assets/props/house_village.png` | `512×512` RGBA | `0 %` | `56.3 %` | **intégré & vérifié** |
| Auberge du Coussin Doux | `public/assets/props/building_inn.png` | `512×512` RGBA | `0 %` | `56.9 %` | **intégré & vérifié** |
| Forge de Kit-Chat | `public/assets/props/building_forge.png` | `512×512` RGBA | `0 %` | `50.7 %` | **intégré & vérifié** |
| Panneau de quêtes | `public/assets/props/prop_quest_board.png` | `512×512` RGBA | `0 %` | `48.3 %` | **intégré & vérifié** |
| Coffre fermé | `public/assets/props/chest_closed.png` | `512×512` RGBA | `0 %` | `59.4 %` | **intégré & vérifié** |
| Coffre ouvert | `public/assets/props/chest_open.png` | `512×512` RGBA | `0 %` | `58.4 %` | **intégré & vérifié** |

---

## 3. Assets restants à produire (mapping prêt au dépôt sans modification moteur)

Les emplacements suivants sont prêts à recevoir leurs PNG/spritesheets 30 FPS sans casser les chargeurs existants :
- **Props statiques restants (12)** : `tree_oak`, `tree_dark`, `tree_pine_snow`, `prop_rock`, `prop_rock_snow`, `prop_flower_patch`, `prop_mushroom`, `prop_signpost`, `portal_dungeon`, `prop_torch`, `prop_pillar`, `prop_crystal` (+ `portal_exit_sheet` 30f & `prop_lamppost` si ajoutés au registre).
- **Héros multi-frames 30 FPS** : enregistrer dans `HD_HERO_SHEET_FILES` (`idle` 30f, `walk` 30f, `attack` 15f, `roll` 15f, optionnels `hurt` 15f & `death` 30f).
- **27 équipements modulaires** : `public/assets/equipment/<id>.png` (`256×256`) + 4 textures tissu cape dans `HD_CAPE_FABRIC_FILES`.
- **2 PNJ actifs** : `miaou_sprit` & `mayor_moustache` dans `HD_NPC_SHEET_FILES`.
- **7 ennemis/boss + Phase 2 Dragon-Griffe** : `public/assets/characters/<id>_sheet.png` (atlas multi-frames 30 FPS) ou `HD_ENEMY_STATE_SHEET_FILES` + `HD_ENEMY_PHASE2_SHEET_FILES.boss_dragon_claw`.
- **Icônes UI & VFX** : `public/assets/icons/{equip,spells,ui}/` (après branchement dans `src/ui/`).
