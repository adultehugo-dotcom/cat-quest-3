# MARITIME OVERHAUL REPORT — Les Chroniques de Félingard

- **Branche Git** : `feat/maritime-overhaul` (point de restauration baseline : `6f4e5b2`)
- **Projet** : `C:\Users\hugos\.gemini\antigravity\scratch\cat-quest-proto`
- **Organisation multi-agents exécutée** :
  - **Orchestrateur principal** : arbitrage canonique, contrats partagés, intégration rendu/UI/caméra/entrée, vérification visuelle directe et correctifs finaux.
  - **Sous-Agent 1 (`game-architect`)** : audit architecture & dépendances, machine à états maritime (`gameEngine.ts`), persistance & migration (`saveSystem.ts`).
  - **Sous-Agent 2 (`gameplay-developer`)** : physique navale sous-steppée (`shipPhysics.ts`), SDF multi-îles, collisions coque 10 points & recherche de débarquement sûr (`shorelineNavigation.ts`).
  - **Sous-Agent 3 (`3d-director`)** : direction artistique, audit des ressources 3D/licences, conception et sculpture procédurale PBR du voilier **« Le Patte-au-Vent »** (`shipRenderer.ts`), shaders voile & VFX maritimes (`shipShaders.ts`) et extension 6 îles du shader d'océan (`waterShader.ts`).
  - **Sous-Agent 4 (`qa-tester`)** : migration des tests existants (`worldIslands.test.ts`, `saveSystem.test.ts`), création des 5 suites Vitest maritimes et du scénario E2E visuel Playwright (`tests/e2e/lib/scenarios.mjs`).

---

## 1. Diagnostic initial

L'audit complet du code de référence (`6f4e5b2`) a mis en évidence les causes racines suivantes :

1. **Modèle visuel rudimentaire (`worldRenderer.ts`)** : coque en `BoxGeometry(2.4, 0.45, 1.15)`, mât `CylinderGeometry`, voile `PlaneGeometry` — plus étroit que le sprite du héros (`2.35 u`), provoquant un clipping direct des pieds/ombres sous le pont.
2. **Navigation terrestre incontrôlée (`gameEngine.ts` + `worldIslands.ts`)** : `updateShipMovement()` déplaçait directement `(x, z)` à `9.0 u/s` selon `(moveX, moveZ)` sans aucune collision contre les 6 îles. Pire encore, les 6 anciennes positions `dockPos` / `FELINGARD_DOCK_POS` étaient situées entre **4,85 u et 24 u à l'intérieur des terres**, forçant littéralement le bateau à naviguer sur le sol.
3. **Inversion d'orientation Three.js** : `gameEngine.ts` calculait `Math.atan2(mz, mx)` tandis que `worldRenderer.ts` appliquait `rotation.y = +angle` (signe inversé en repère main droite Three.js).
4. **Téléportation au quai hors navigation** : `worldRenderer.ts` écrasait `shipGroup.position` par `dockPosition` dès que `!isSailing`, rendant tout stationnement libre impossible.
5. **Compagnon et héros mal positionnés** : Miaou-sprit flottait `1.4 u` derrière la poupe au-dessus de l'eau ; le héros jouait son animation de course (`walk1`/`walk2`) à `y = 0` à l'intérieur de la coque.
6. **Couplage destructif aux quais et aux changements d'île** : `checkIslandArrival()` arrachait automatiquement le contrôle autour d'un rayon fixe, et `worldRenderer.ts` détruisait/reconstruisait intégralement l'océan et les 6 îles dès que `islandId` changeait.
7. **Lacunes de persistance et d'ergonomie** : `SaveData` v1 ne sauvegardait aucun état du bateau ; `KeyE` pouvait déclencher accidentellement le sort 2 (`lightnyan`) ; `KeyM` (Carte) était cassé sur clavier AZERTY ; le fragment shader océanique ne dessinait l'écume et le lagon turquoise que pour Félingard.

---

## 2. Architecture retenue

Séparation stricte sans dépendance circulaire (règle conservée : **0 import `three` et 0 référence DOM dans `src/game/`**) :

```text
src/game/types.ts                  (Contrats purs : ShipMode, ShipState, SavedShipData, ShipDisembarkStatus)
  ├── src/data/worldData.ts        (Félingard : getIslandRadiusAtAngle, buildings, props, portals)
  ├── src/data/worldIslands.ts     (5 îles archipel — sans FELINGARD_DOCK_POS ni dockPos)
  ├── src/game/shipPhysics.ts      (Configuration centralisée SHIP_PHYSICS_CONFIG + dynamique navale pure)
  ├── src/game/shorelineNavigation.ts (Source de vérité SDF 6 îles, falaises/plages, collision coque, débarquement)
  ├── src/game/saveSystem.ts       (Schéma v2 rétrocompatible v1 + normalisation états transitoires)
  └── src/game/gameEngine.ts       (Machine à états 5 modes + embarquement/débarquement + switchActiveIsland)

src/render/
  ├── shaders/waterShader.ts       (Océan 6 îles + sampleOceanWaveHeight analytique partagé)
  ├── shaders/shipShaders.ts       (Shader voile vent + sillage V courbé + écume proue + ondulations + vent)
  ├── shipRenderer.ts              (Voilier 3D sculpté « Le Patte-au-Vent », PBR Canvas2D, VFX poolés 0 alloc)
  ├── worldRenderer.ts             (Terrains 6 îles sculptés sur shorelineNavigation, 0 quai, 0 rebuild inter-îles)
  ├── entityRenderer.ts            (Ancres pont locales + saut parabolique héros & compagnon)
  ├── effectsRenderer.ts           (Orbite flèche de quête élargie en mer)
  └── sceneManager.ts              (Caméra maritime fluide à zoom/look-ahead dynamiques + horizon étendu)
```

### Convention géométrique canonique unifiée (Physique ↔ Rendu 3D)
- **Repère local voilier** : Proue = `-Z`, Poupe = `+Z`, Tribord = `+X`, Bâbord = `-X`, Haut = `+Y`.
- **Cap monde** : `ship.angle` correspond **1:1** à `shipYawGroup.rotation.y` (`0` = Nord `-Z`, aucune négation de signe) :
  - `forward(angle) = (-sin(angle), -cos(angle))`
  - `right(angle) = (+cos(angle), -sin(angle))`
  - Tourner à gauche (`Q`/`A`/`ArrowLeft`, `steer = -1`) ⇒ `angularVelocity > 0` (CCW vu du dessus = bâbord).
  - Tourner à droite (`D`/`ArrowRight`, `steer = +1`) ⇒ `angularVelocity < 0` (CW vu du dessus = tribord).
- **Dimensions unifiées** : longueur de coque `5.0 u` (`halfLength = 2.55`), largeur maître-bau `2.80 u` (`halfWidth = 1.40`), marge de sécurité `0.45 u` (couvrant le beaupré), pont à `y = +0.56 u` au-dessus de `WATER_LEVEL_Y = -0.14`, ancres locales `HERO = (0, 0.56, +0.55)` et `COMPANION = (-0.82, 0.70, +1.25)`.

---

## 3. Problèmes corrigés

- **Impossible de naviguer sur terre** : collision continue sous-steppée (`1/120 s`, déplacement max `0.30 u/pas`) sur une enveloppe orientée de 10 points périmétriques + centre contre le SDF analytique des 6 îles.
- **Suppression intégrale des quais** : retrait complet de `FELINGARD_DOCK_POS`, `dockPos`, `DOCK_RADIUS`, `addDockVisual()`, `checkIslandArrival()`, `departureIslandId`, `hasLeftDock`, des interactables `'dock'` et des 6 marqueurs `Quai` de la Carte du Monde.
- **Stationnement persistant** : le voilier reste exactement à ses coordonnées `(x, z)` et son cap `angle` lors du débarquement, de l'éloignement à pied, des transitions donjons et après sauvegarde/rechargement complet.
- **Refonte visuelle complète** : remplacement du modèle cube/cylindre/plan par un voilier d'aventure 3D sculpté sur 18 couples avec textures PBR bois/voile, figure de proue féline, lanterne HDR, accessoires de pont, voile animée avec fade anti-occlusion plein Sud, gouvernail/barre articulés et VFX d'eau poolés.
- **Héros & compagnon à bord** : sauts paraboliques fluides à l'embarquement (`0.44 s`) et au débarquement (`0.42 s`), posture calme à la barre sans cycle de marche, compagnon Miaou-sprit installé sur son emplacement bâbord-arrière sur le pont.
- **Ergonomie & UI** : raccourci Carte `M` compatible AZERTY et QWERTY ; barre de sorts masquée et `castSpellById` verrouillé hors mode `'parked'` ; aucune fuite de `[E]` vers le sort 2 ; élargissement de `.hud-zone-label` (noms d'îles complets sans troncature) ; responsive mobile portrait (`375×667`) sans chevauchement HUD ; solveur anti-chevauchement des étiquettes statiques de la Carte du Monde ; correction de la coquille `RIFFE-DE-ROC` → `GRIFFE-DE-ROC`.
- **Océan multi-îles** : le fragment shader `WATER_FRAGMENT_SHADER` boucle désormais sur les 6 `uIslandCoasts[6]`, offrant lagons turquoise, caustiques et écume côtière autour des 6 îles, sur un océan étendu à `460 × 460`.

---

## 4. Nouveau comportement physique (`src/game/shipPhysics.ts`)

Toutes les constantes sont centralisées dans `SHIP_PHYSICS_CONFIG` :

| Paramètre | Valeur | Rôle |
|---|---|---|
| `fixedSubstepSec` / `maxSubstepDisplacement` | `1/120 s` / `0.30 u` | Indépendance framerate (20–120 FPS) et anti-tunneling |
| `maxForwardSpeed` / `maxReverseSpeed` | `13.5 u/s` / `4.2 u/s` | Vitesse de croisière agréable & marche arrière contrôlée |
| `forwardAcceleration` / `reverseAcceleration` | `9.5 u/s²` / `5.0 u/s²` | Accélération progressive |
| `brakeDeceleration` / `reverseEngageDelaySec` | `16.0 u/s²` / `0.18 s` | Freinage progressif obligatoire jusqu'à `v = 0` avant marche arrière |
| `linearWaterDrag` / `quadraticWaterDrag` / `coastLinearDrag` | `0.24` / `0.034` / `0.52` | Glisse naturelle par inertie au relâchement des gaz |
| `maxTurnRateRad` / `lowSpeedTurnFactor` / `optimalTurnSpeedRatio` | `2.25 rad/s` / `0.62` / `0.55` | Maniabilité réactive à l'arrêt, pic de braquage à mi-vitesse, stabilité à pleine allure |
| `rudderResponseRate` / `rudderCenteringRate` | `9.5 s⁻¹` / `11.0 s⁻¹` | Réponse progressive du gouvernail |
| `maxRollRad` / `maxPitchRad` / `bobAmplitude` | `0.18 rad` / `0.09 rad` / `0.075 u` | Assiette visuelle (gîte, cabrage, houle) découplée des collisions |
| `oceanBoundaryLimit` / `oceanBoundarySoftZone` | `152 u` / `6.0 u` | Frontière maritime douce loin des bords de l'océan (`±230 u`) |

- **Compensation diagonale** : `mapInputStateToShipControls()` restaure le domaine carré `[-1, 1]²` depuis le vecteur circularisé par `input.ts`, garantissant 100 % de poussée et de gouvernail en virage accéléré (`Z+Q` / `W+A`).
- **Zéro dérive latérale artificielle** : en mer libre, `velocity = forward(angle) * speed` (`|v · right| < 1e-9`).

---

## 5. Système de détection des côtes (`src/game/shorelineNavigation.ts`)

- **Source de vérité géométrique unique** : alignée sur `getIslandRadiusAtAngle` (Félingard) et `getNewIslandRadiusAtAngle` (5 îles), avec intersection exacte de la ligne d'eau (`WATER_LEVEL_Y = -0.14`) à `R_wl(θ) = R_coast(θ) + 0.60`.
- **Profils côtiers partagés Physique ↔ Rendu 3D (`ISLAND_COAST_PROFILES`)** :
  - `felingard` : plages accessibles (>85 %, dont la grande plage Sud sous Miaou-bourg) + escarpement glacé NNE (`cliff`).
  - `tropical` & `archipelago` : 100 % plages accessibles.
  - `mountain` (**Griffe-de-Roc**) : falaises escarpées sur ~223° (faces N/E/SE, `cliffHeight = 3.1 u`) + crique praticable Sud-Ouest face à Félingard.
  - `mystic` & `wild` : larges plages accessibles + un promontoire rocheux arrière (`rocks`).
  - `worldRenderer.ts` sculpte directement les 6 terrains via `getIslandTerrainHeightLocal()`, assurant une correspondance exacte entre relief visible et collisions.
- **Distance signée exacte (`sampleShorelineField`)** : 3 itérations de Newton sur la courbe polaire `R_wl(φ)` à l'aide des dérivées analytiques `R'(φ)` et `R''(φ)` pour obtenir la vraie distance euclidienne et la vraie normale côtière sortante.
- **Collision multi-points et glissement côtier (`resolveShipCoastCollision`)** : résolution itérative jusqu'à 4 passes par sous-pas sur 10 points périmétriques + centre ; projection douce hors du rivage, conservation tangentielle fluide pour longer les plages sans tremblement, et protection en marche arrière comme en pivot sur place.
- **Validation du débarquement (`findSafeDisembarkSpot`)** : vérifie proximité eau (`≤ 5.5 u`), nature `'beach'`, recherche sur grille de candidats (`9 angles × 6 profondeurs`), marchabilité réelle (`isInsideIsland`/`isInsideNewIsland`), hauteur (`|h| ≤ 0.20`), pente (`≤ 0.35`), absence de props/bâtiments/PNJ/portails/coffres, et distance de sécurité vis-à-vis des ennemis vivants et des camps statiques de l'île cible.

---

## 6. Fonctionnement des interactions

Machine à états explicite à 5 états dans `gameEngine.ts` :

1. **`parked`** : bateau flottant à sa position côtière réelle ; interactable dynamique `'ship_board'` (`[E] Monter à bord`, rayon `8.4 u`).
2. **`boarding` (`0.44 s`)** : saut parabolique du héros et de Miaou-sprit vers le pont, verrouillage des entrées gameplay, désengagement des ennemis terrestres et purge des télégraphes.
3. **`sailing`** : pilotage complet (`ZQSD`/`WASD`/Flèches/Manette) ; barre de sorts masquée ; évaluation continue de `findSafeDisembarkSpot()` → si plage valide, affiche `[E] Débarquer` et un anneau doré sur le point d'atterrissage. Si `[E]` est pressé face à une falaise, un rivage encombré ou en pleine mer : toast `warning` explicite sans déclencher de sort.
4. **`docking` (`0.24–0.65 s`)** : freinage automatique progressif jusqu'à stabilisation sur l'eau avec collisions côtières actives ; le HUD affiche le statut discret non-cliquable **`Accostage en cours...`**.
5. **`disembarking` (`0.42 s`)** : activation légère de l'île cible (`switchActiveIsland`, zéro fondu noir ni rebuild WebGL), saut parabolique du héros et du compagnon vers leurs emplacements terrestres validés, conservation exacte de la position et du cap du bateau, auto-sauvegarde v2.

---

## 7. Assets ajoutés, sources & licences

### Audit des ressources externes examinées
- **`asset-library/` local** : dossier `asset-library/3D/` vide (`download-log.txt` indiquait des échecs de téléchargement antérieurs) ; Blender absent de l'environnement local.
- **Ressources 3D libres évaluées** : Kenney Pirate Kit (CC0 1.0), Quaternius Ships/Pirate Kit (CC0 1.0), Poly Pizza (CC0 / CC-BY 3.0). Écartées car en low-poly flat-shaded sans textures PBR (rupture visuelle avec les assets HD peints de Félingard) et avec des ponts trop étroits/encombrés pour accueillir deux sprites 2.5D (`2.35 u` et `1.30 u`) ainsi qu'une voile/gouvernail animés.

### Nouveaux assets créés (100 % natifs projet)

| Asset | Emplacement | Type | Source / Auteur | Licence |
|---|---|---|---|---|
| Voilier 3D sculpté **« Le Patte-au-Vent »** (coque loftée 18 couples, pont teck, mât, vergue, grande voile + foc, figure de proue féline, gouvernail/barre, lanterne HDR, baril, cordage, coffre, boussole, boucliers, fanion) | `src/render/shipRenderer.ts` | Géométrie 3D paramétrique Three.js (~10 981 triangles, 11 draw calls) | Création originale procédurale (Équipe Maritime Overhaul) | Propriété directe du projet (aucune dépendance tierce) |
| Textures PBR Bois Coque & Pont (`512×512` Albedo, Normal Sobel, Roughness) | `src/render/shipRenderer.ts` (générateur Canvas2D) | `THREE.CanvasTexture` PBR (fallback `DataTexture` Node) | Création originale procédurale | Propriété directe du projet |
| Textures PBR Voile Lin Ivoire & Emblème Félingard (`512×512` Albedo + Normal textile) | `src/render/shipRenderer.ts` (générateur Canvas2D) | `THREE.CanvasTexture` PBR | Création originale procédurale | Propriété directe du projet |
| Shaders GLSL maritimes (voile vent PBR `onBeforeCompile`, sillage V courbé, mousse de proue, ondulations coque, filets de vent) | `src/render/shaders/shipShaders.ts` | Shaders GLSL WebGL2 | Création originale | Propriété directe du projet |
| Extension shader océan 6 îles & échantillonneur Gerstner TS | `src/render/shaders/waterShader.ts` | GLSL + TypeScript | Extension du shader existant du projet | Propriété directe du projet |

---

## 8. Modifications de sauvegarde (`src/game/saveSystem.ts`)

- Clé `localStorage` conservée : `felingard_cat_quest_save_v1` (aucune perte des sauvegardes existantes).
- **Schéma `version: 2`** : ajoute `ship?: SavedShipData` (`mode: 'parked' | 'sailing'`, `position`, `angle`, `dockedIslandId`, `hullHp`, `maxHullHp`, `ammo`, `maxAmmo`, `equippedBlueprints`, `unlockedSlots`).
- **Normalisation des états transitoires à la sérialisation** :
  - `boarding` → sauvegardé `'parked'` avec le joueur sur sa position terrestre de départ.
  - `docking` → sauvegardé `'sailing'` sur sa position d'eau sûre.
  - `disembarking` → sauvegardé `'parked'` sur l'île cible avec le joueur à `landingPos`.
- **Reprise sécurisée (`continueSavedGame`)** :
  - Passe toujours la pose navire dans `ensureBoatOnWater()` (empêche tout spawn sur terre ferme) et remet les vitesses à `0` en reprise haute mer (`sailing`).
  - **Migration v1 transparente** : une sauvegarde v1 (sans champ `ship`) conserve 100 % de la progression (niveau, XP, or, équipement, inventaire, sorts, quêtes, coffres, boss, clé runique) et place automatiquement le bateau au mouillage côtier sûr de `saved.islandId` (`getDefaultAnchorageForIsland`).
- **Validation stricte** : rejette tout champ `ship` corrompu (`NaN`, `Infinity`, mode transitoire/invalide, `dockedIslandId` inconnu, version inconnue).

---

## 9. Inventaire des fichiers

### Fichiers créés (10)
- `src/game/shipPhysics.ts`
- `src/game/shorelineNavigation.ts`
- `src/render/shaders/shipShaders.ts`
- `src/render/shipRenderer.ts`
- `tests/maritimePhysics.test.ts`
- `tests/maritimeCollisions.test.ts`
- `tests/maritimeBoarding.test.ts`
- `tests/maritimePersistence.test.ts`
- `tests/maritimeRegressions.test.ts`
- `MARITIME_OVERHAUL_REPORT.md`

### Fichiers modifiés (19)
- `src/game/types.ts`
- `src/data/worldIslands.ts`
- `src/game/input.ts`
- `src/game/saveSystem.ts`
- `src/game/gameEngine.ts`
- `src/render/shaders/waterShader.ts`
- `src/render/shaders/index.ts`
- `src/render/worldRenderer.ts`
- `src/render/entityRenderer.ts`
- `src/render/effectsRenderer.ts`
- `src/render/sceneManager.ts`
- `src/ui/hudController.ts`
- `src/ui/modalsController.ts`
- `src/ui/screensController.ts`
- `src/style.css`
- `src/main.ts`
- `tests/worldIslands.test.ts`
- `tests/saveSystem.test.ts`
- `tests/e2e/lib/scenarios.mjs`

---

## 10. Résultats des tests & vérifications réelles

### 10.1 Compilation & Build production
- **`npx tsc --noEmit`** : **PASS (exit 0, 0 erreur)** sur l'ensemble de `src/` et `tests/`.
- **`npm run build` (`vite build`)** : **PASS (1.75 s)** — `dist/assets/main-*.js` et `dist/assets/main-*.css` générés sans erreur.

### 10.2 Campagne automatisée Vitest (`npx vitest run`) — **12/12 fichiers, 80/80 tests PASS (3.04 s)**

| Suite | Tests | Résultat | Périmètre vérifié |
|---|---:|---|---|
| `tests/maritimePhysics.test.ts` | 10 | **PASS** | Conventions Three.js, accélération, vitesse max, inertie, freinage avant marche arrière, gouvernail, compensation diagonale, zéro dérive latérale, stabilité 20/30/60/120 Hz & spikes `dt` |
| `tests/maritimeCollisions.test.ts` | 10 | **PASS** | 6 îles × 8 azimuts (frontal, diagonal, rasant, lente/max), marche arrière, pivot 360° contre plage, falaises `mountain`, anti-tunneling, détroit `mountain ↔ archipelago`, bornes océan `±152` |
| `tests/maritimeBoarding.test.ts` | 5 | **PASS** | Débarquement sur les 6 îles, freinage auto `docking`, refus falaises/haute mer/ennemi-obstacle, embarquement 6 îles + arc parabolique, ancrage pont héros & compagnon, conservation exacte de la position bateau, verrou combat/sorts + priorité `[E]` (0 MP) |
| `tests/maritimePersistence.test.ts` | 4 | **PASS** | Cycle complet 11 étapes (Section 16.E) avec 2 rechargements complets, reprise en pleine mer `sailing`, normalisation états transitoires (`boarding`/`docking`/`disembarking`), migration v1 (Félingard + `tropical`) & corruption |
| `tests/maritimeRegressions.test.ts` | 5 | **PASS** | Entrée/sortie donjon conserve le bateau, `respawnAtInn()` sans soft-lock, `returnToTitle()`/`startNewGame()`, combat post-débarquement sur île distante, benchmark 10 000 ticks maritimes (`480 ms < 500 ms`) |
| `tests/worldIslands.test.ts` | 5 | **PASS** | Accès bateau à pied sur Félingard, plages/props/spawns/coffres des 6 îles, voyage réel aller-retour sur les 5 îles, collisions props + coffres, save/reload avec pose bateau |
| `tests/saveSystem.test.ts` | 5 | **PASS** | Schémas v1 & v2, rejet JSON/version/`ship` corrompus, préférences audio |
| `tests/combat.test.ts`, `dungeons.test.ts`, `progression.test.ts`, `quests.test.ts`, `worldData.test.ts` | 36 | **PASS** | Non-régression intégrale du gameplay existant |

### 10.3 Audit visuel & interactif réel Playwright Chromium (`tests/e2e/visual-audit.mjs`)
- **Audit dédié `maritime` final (`--scenario maritime --verify --gpu`)** : **15/15 checks PASS, 0 issue DOM/WebGL/perf, 0 erreur console/page/réseau/shader GLSL**.
  - Vues réellement pilotées au clavier (`KeyW`/`KeyA`/`KeyS`/`KeyD`/`KeyE`/`KeyM`) et inspectées visuellement par lecture directe des PNG :
    1. `ship_moored_felingard` (1280×720) — bateau amarré plage Sud Félingard + prompt `[E] Monter à bord`.
    2. `ship_boarding` (1280×720) — héros & Miaou-sprit installés sur le pont, barre de sorts masquée, `0 MP` consommé.
    3. `ship_sailing_wake` (1280×720) — croisière haute mer (`10.7 u/s`), sillage V courbé, mousse de proue, filets de vent.
    4. `ship_turning` (1280×720) — virage actif bâbord (`KeyW + KeyA`), rotation CCW vérifiée, gouvernail braqué, `Δgeometries === 0` et `ΔgpuTextures === 0`.
    5. `ship_coast_collision` (1280×720) — contact côte `tropical` sans aucune pénétration de coque.
    6. `ship_beach_approach_prompt` (6 viewports : `1920×1080`, `1280×720`, `850×700`, `768×1024`, `375×667`, `667×375`) — prompt `[E] Débarquer` + anneau doré sur la plage, 0 chevauchement responsive.
    7. `ship_disembarked_island` (1280×720) — débarquement sur `Plage des Ronrons Dorés`, libellé complet sans troncature, bateau resté exactement dans l'eau.
    8. `ship_return_and_reboard` (1280×720) — ouverture coffre (+90 Or), `page.reload()` réel + Continuer, dérive bateau `0.00 u`, retour au bateau et ré-embarquement.
    9. `ship_island_hop_return` (1280×720) — traversée retour vers la côte Est de Félingard (plage distincte du départ).
    10. `maritime_world_map` (1280×720) — Carte des îles sans aucun quai, marqueur dynamique `⛵` en direct, 0 chevauchement d'étiquettes.
- **Audit de non-régression complet 9 scénarios (`--scenario all --verify --gpu`)** : **0 erreur console/page/WebGL/GLSL/réseau sur 119 checks** (tous les scénarios gameplay `intro`, `biomes`, `ghost_cave`, `dragon_lair`, `endgame` fonctionnent sans régression).

---

## 11. Problèmes encore présents / limites connues

1. **Responsive sur les formats compacts hors périmètre maritime** : la carte mobile utilise maintenant des repères numérotés avec une légende lisible, et l'autel des sorts ne déborde plus en portrait. L'audit final passe sur `1280×720` et `375×667` pour l'ensemble des scénarios. Des chevauchements d'interface restent observés sur des formats plus compacts non inclus dans l'audit final (`667×375` sur le titre, le dialogue maire et l'écran victoire ; barre de boss `ghost_cave` sur `850×700`, `768×1024` et `667×375`).
2. **Texture de sol des 5 nouvelles îles** : les 5 îles de l'archipel conservent le mécanisme préexistant de `worldRenderer.ts` (`groundMat.clone()` teinté), ce qui fait apparaître en transparence le tracé de texture de Félingard sur les îles secondaires (hors périmètre de la refonte maritime, préservé pour ne pas modifier le générateur de texture terrestre).
3. **Enregistrement vidéo** : l'environnement headless Playwright utilisé produit des captures PNG haute définition de chaque état clé ; aucune vidéo `.webm` n'a été générée (indiqué explicitement par transparence).

---

## 12. Tableau des critères d'acceptation finaux (Section 17)

| Critère | Résultat attendu | Statut réel | Preuve / Vérification |
|---|---|---|---|
| Modèle du bateau | Nouveau design détaillé | **VALIDÉ** | Voilier 3D sculpté 18 couples « Le Patte-au-Vent » + PBR Canvas2D (`shipRenderer.ts`), vérifié visuellement sur PNG |
| Cohérence artistique | Identique à l'univers de Félingard | **VALIDÉ** | Palette acajou/teck/ivoire/laiton/turquoise, figure de proue féline, emblème Félingard, lanterne HDR, vérifié sur PNG |
| Pilotage | Direction selon l'orientation | **VALIDÉ** | `forward(angle) = (-sin, -cos)`, 0 dérive latérale (`maritimePhysics.test.ts` + E2E clavier réel) |
| Accélération | Progressive | **VALIDÉ** | Montée monotone jusqu'à `13.5 u/s` (`maritimePhysics.test.ts`) |
| Inertie | Naturelle et contrôlable | **VALIDÉ** | Glisse exponentielle + freinage obligatoire à `0` avant marche arrière (`maritimePhysics.test.ts`) |
| Rotation | Fluide et stable | **VALIDÉ** | Gouvernail amorti + courbe de braquage par vitesse + stabilité 20–120 Hz (`maritimePhysics.test.ts` + `ship_turning` E2E) |
| Navigation terrestre | Impossible | **VALIDÉ** | 0 pénétration coque/proue/poupe sur 6 îles × 8 azimuts (`maritimeCollisions.test.ts` + `ship_coast_collision` E2E) |
| Collision côtière | Fiable | **VALIDÉ** | SDF Newton + 10 points coque + glissement tangentiel + détroit `mountain ↔ archipelago` (`maritimeCollisions.test.ts`) |
| Embarquement | Animation fonctionnelle | **VALIDÉ** | Saut parabolique `0.44 s` + verrou entrées + 0 MP consommé (`maritimeBoarding.test.ts` + `ship_boarding` E2E) |
| Compagnon | Place dédiée sur le bateau | **VALIDÉ** | Ancre dédiée `(-0.82, 0.70, +1.25)` sur le pont, visible sur PNG `ship_boarding`/`ship_sailing_wake`/`ship_turning` |
| Débarquement | Automatique après commande | **VALIDÉ** | Freinage automatique `docking` + saut `disembarking` sur `[E]` (`maritimeBoarding.test.ts` + `ship_disembarked_island` E2E) |
| Plages accessibles | Toutes les côtes praticables | **VALIDÉ** | Débarquement libre sur toute plage dégagée des 6 îles ; refus explicite sur falaises (`mountain`, etc.) et zones obstruées |
| Quais | Aucun quai obligatoire ou visible | **VALIDÉ** | `grep` = 0 symbole résiduel dans `src/` ; 0 ponton 3D ; 0 marqueur Quai sur la Carte |
| Stationnement | Position conservée | **VALIDÉ** | Pose exacte `(x, z, angle)` conservée après éloignement, donjon et rechargement (`maritimeBoarding` + `maritimePersistence` + E2E) |
| Sauvegarde | Position du bateau persistante | **VALIDÉ** | Schéma v2 + normalisation états transitoires + migration v1 + reload réel navigateur (`maritimePersistence.test.ts` + E2E) |
| Sillage | Adapté à la vitesse | **VALIDÉ** | Ruban Kelvin-V courbé 36 segments + écume proue + embruns poolés + filets de vent, `Δgeometries = 0`, vérifié sur PNG |
| Caméra | Fluide et adaptée | **VALIDÉ** | Zoom dynamique `1.22→1.36`, look-ahead lissé, transitions douces sur les 5 modes sans snap brutal (`sceneManager.ts`) |
| Six îles | Compatibilité complète | **VALIDÉ** | Traversée réelle, collisions, débarquement, coffres et retour sur les 6 îles (`worldIslands.test.ts` + `maritimeCollisions.test.ts`) |
| Ancien gameplay | Aucun problème de régression | **VALIDÉ** | 36/36 tests combat/donjons/progression/quêtes/worldData PASS + 0 erreur sur les 9 scénarios E2E |
| Build | Réussi | **VALIDÉ** | `npx tsc --noEmit` (0 erreur) + `npm run build` |
| Tests automatisés | Réussis | **VALIDÉ** | `npm test -- --run` : **13/13 suites, 89/89 tests PASS** |
| Tests visuels | Réalisés et documentés | **VALIDÉ** | Audit Playwright GPU : **73/73 checks PASS, 0 issue, 0 erreur session**, sur tous les scénarios en `1280×720` et `375×667`; captures PNG inspectées directement (pas de vidéo `.webm` générée) |

---

## 13. Reprise finale — bibliothèque d'assets et rendu

- Constitution de `asset-library/` avec **2 319 ressources locales**; `asset-library/manifest.json` conserve pour chaque source le chemin, les dimensions, l'auteur, la licence et la page d'origine. L'index lisible est `asset-library/INDEX.md`.
- Intégration de **126 assets actifs** dans `public/assets/` : poses du héros félin, PNJ, spritesheets de monstres, 9 emplacements d'équipement, props de village, textures PBR et ambiances météo locales.
- Héros rendu par couches indépendantes : armes, seconde main, bouclier, casque, armure, bottes, gants, cape et babiole. La cape équipée utilise une simulation de tissu pilotée par le déplacement et le vent; les spritesheets ennemies changent d'image selon leur état d'IA.
- Inventaire, sauvegarde et progression prennent en charge les nouveaux emplacements; la migration des anciennes sauvegardes v1 reste compatible.
- Carte mobile corrigée avec huit repères numérotés et légende; grille de l'autel des sorts adaptée aux petits écrans.
- **Vérification finale** : TypeScript sans erreur, 89 tests automatisés réussis, build Vite réussi et 73 contrôles visuels Playwright réussis.
## 14. Reprise du chantier Félingard — 24 novembre 2026

- Suppression du slot « arme secondaire » des types actifs, données d'équipement, interface d'inventaire et rendu du héros. Le bouclier et l'arme principale restent indépendants. À la migration, l'ancien slot et la dague `dagger_fang` sont ignorés sans perdre les autres objets.
- Ajout d'un sélecteur de météo dans le menu pause. Les choix manuels font une transition de 14 s, restent actifs pour la session, et « Automatique » rend le contrôle au cycle existant. Aucun réglage météo n'est écrit dans la sauvegarde.
- Le pool de PointLight sélectionne désormais ses huit sources les plus proches avec des buffers réutilisés, sans créer de tableaux/objets au tri de chaque frame. Il reçoit des sources d'ambiance destinées aux routes, au village et aux plages de l'overworld; leur intensité s'adapte à la nuit, au brouillard et à la tempête. Une PointLight chaude suit aussi le héros à l'extérieur et s'éteint sur le pont.
- Remplacement du séquenceur musical synthétisé par trois pistes locales en boucle et crossfadées. Fichiers et licences dans `public/assets/audio/music/`; les réglages généraux de volume et muet continuent d'agir sur le bus maître.
- Sources musicales: *The Old Tower Inn* (RandomMind, CC0), *Whispers in the Fog* (Ruhinre, CC0), *Boss Battle (loop)* (Alex McCulloch / Pro Sensory, CC0). L'OST officielle de Cat Quest III se télécharge contre paiement mais reste « all rights reserved »; elle n'est pas redistribuée.
- Vérification de cette reprise: `npx tsc --noEmit` réussi; `npm test -- --run` **13/13 suites, 91/91 tests**; `npm run build` réussi (avertissement de bundle JS > 500 kB). Les trois médias ont un conteneur et une durée lisibles par FFprobe et sont servis par le build en HTTP 200.

### À reprendre

- Le CLI ImageGen est autorisé et installé dans `tmp/imagegen/venv/`. La clé utilisateur est visible; quatre prompts `gpt-image-2` (lampadaire extérieur, lanterne, héros avec lanterne, applique de donjon) ont été soumis, mais l'API a répondu HTTP 429 « You have no credits remaining » pour chacun et n'a renvoyé aucun visuel. Les prompts sont conservés dans `tmp/imagegen/priority_assets.jsonl` pour une reprise après recharge du compte.
- Restent à produire avec l'outil d'image: spritesheets alignées du héros et des équipements, lampadaires, lanterne en main, nouvelles poses/animations des monstres et boss, props et éléments UI de réserve.
- Restent à intégrer: les sprites de lampadaires sur les sources lumineuses extérieures et les sprites de lanterne/animation du héros. L'éclairage shader local des billboards et torches est maintenant intégré. Les nouveaux sorts (défense, mobilité, zone) et leurs frames restent aussi à faire après achèvement des priorités précédentes. Le travail de cette reprise n'a pas modifié les fichiers du sol, du bateau ou de l'eau.

### Complément de reprise — éclairage shader et génération

- Ajout d'un shader local aux billboards PBR du héros, du compagnon, des ennemis, des props et des torches de donjon. Il conserve un plancher de couleur albedo dans la pénombre puis ajoute les sources dynamiques proches avec une atténuation quadratique douce; données et uniforms sont réutilisés.
- Les huit emplacements du pool de `PointLight` alimentent les mêmes sources shader; un neuvième emplacement suit la lanterne du héros. Aucun changement au sol, au bateau, à l'eau ou à la navigation.
- La clé `OPENAI_API_KEY` est maintenant accessible à l'environnement utilisateur. Après installation locale de Python 3.11, Pillow et OpenAI via `uv`, quatre générations `gpt-image-2` ont été tentées (lampadaire extérieur, lanterne, spritesheet du héros avec lanterne, applique de donjon). L'API a refusé les quatre avec HTTP 429 « You have no credits remaining »; elle n'a renvoyé aucun visuel. Les prompts sont conservés dans `tmp/imagegen/priority_assets.jsonl` pour une nouvelle tentative après recharge du compte.
- Une première campagne E2E a subi une fermeture prématurée de Chromium après trois vues. La relance fraîche avec le shader actif a validé **10/10 vues**, **0 erreur WebGL**, **0 erreur de session**; les captures sont dans `work/e2e-weather-shader/screenshots/`.
- Vérification après le shader : `npx tsc --noEmit` PASS; `npm test -- --run` **13/13 suites, 91/91 tests**; `npm run build` PASS (avertissement de bundle > 500 kB); E2E météo **10/10**, aucune erreur de console, page, WebGL ou requête.

---

## 15. Reprise complète — 25 novembre 2026 (Éclairage, Cape tissu souple, Équipement, Météo/Musique, Nouveaux sorts)

### 15.1 Périmètre respecté & blocage ImageGen vérifié (transparence complète)
- **Aucune régression ni modification interdite** : le sol/terrain, le voilier (`shipRenderer.ts`, `shipShaders.ts`), l'océan (`waterShader.ts`) et la physique/navigation maritime (`shipPhysics.ts`, `shorelineNavigation.ts`) n'ont pas été modifiés ni régénérés.
- **Aucune image téléchargée en remplacement et aucun dessin Canvas procédural ajouté** pour compenser les visuels manquants.
- **Vérification factuelle de génération d'images (sans boucler)** :
  - Outil ImageGen natif Antigravity : aucun outil `generate_image` exposé dans le runtime courant ; une invocation de vérification du sous-agent `image-generator` a retourné `subagent "image-generator" not found or not allowed to be invoked`.
  - CLI OpenAI (`gpt-image-2` dans `tmp/imagegen/venv/`) : une unique tentative de contrôle sur le premier prompt (`lampadaire_village_raw.png`) a confirmé `openai.RateLimitError: Error code: 429 - You have no credits remaining`. Aucune relance en boucle n'a été effectuée.
  - Les 4 prompts prioritaires préparés dans `tmp/imagegen/priority_assets.jsonl` sont conservés intacts.
  - **Éléments restant bloqués tant qu'un outil ImageGen ou des crédits OpenAI ne sont pas disponibles** : génération effective des sprites PNG de lampadaire extérieur, applique de donjon, lanterne tenue en main + frames `lantern_out` du héros, pièces modulaires/frames régénérées du héros, nouvelles spritesheets générées des monstres/boss/props/UI de réserve, et sprites frame par frame dédiés aux sorts.

### 15.2 Priorité 1 — Alignement éclairage (lampadaires, torches de donjon, lanterne automatique)
- **`src/render/worldRenderer.ts`** : export de `OVERWORLD_LAMP_LIGHTS` (16 coordonnées dégagées : Miaou-bourg — place, abords Auberge/Forge, sortie sud — routes Nord/Est/Ouest et repères des 5 îles) vérifiées automatiquement hors eau et hors collisions (bâtiments, PNJ, props, point de départ). En donjon (`buildDungeon`), les positions de `PointLight` envoyées au pool de `SceneManager` (et les lumières de repli) sont désormais alignées exactement sur la hauteur et le décalage `Z` de la flamme visible (`flameLocalY + 0.14`, `pos.z - flameDist * sin(0.48)`).
- **`src/render/sceneManager.ts` & `src/render/weatherSystem.ts`** : cohérence unifiée entre `outdoorLampBrightness` et `weather.lanternBoost` sur l'aube (`dawnFactor`), le coucher (`sunsetFactor`), la nuit (`nightFactor`), le brouillard et la tempête (éteints à midi clair).
- **`src/render/entityRenderer.ts`** : la `PointLight` locale de la lanterne du héros (`slot 8` dans `SPRITE_LIGHT_UNIFORMS`) suit désormais fluidement `this.playerFlipX` et le rebond vertical (`bounceY`), s'éteint sur le pont du voilier, et son intensité (`1.55 * lanternPower`) a été calibrée après inspection visuelle pour éviter tout point chaud spéculaire au sol.

### 15.3 Priorité 2 — Équipement modulaire (zéro arme secondaire) & Refonte complète de la cape en tissu souple
- **Nettoyage complet des reliquats `secondary_weapon` / `dagger_fang`** :
  - Suppression du reliquat `dagger_fang` dans l'inventaire initial (`src/game/progression.ts`), dans `HdEquipmentKey` / `HD_EQUIPMENT_FILES` (`src/art/hdAssets.ts`), et de `paw_dagger` dans `WeaponShape` (`src/game/types.ts`). Migration douce des anciennes sauvegardes préservée (`src/game/saveSystem.ts`).
  - Ajout des onglets de filtre manquants **Boucliers** et **Babioles** et correction de `computeSignature('inventory')` dans `src/ui/modalsController.ts` pour surveiller les 8 emplacements actifs (`weapon`, `shield`, `helmet`, `armor`, `boots`, `gloves`, `cape`, `trinket`).
  - Ajout de `getHeroBodyTextureKey` (`src/art/spriteHero.ts`, `src/art/textureRegistry.ts`, `src/render/entityRenderer.ts`) afin qu'un changement de cape ne reconstruise jamais la texture du corps, de l'armure ou du casque.
- **Nouveau système de cape en tissu souple (`src/render/capePhysics.ts` & `src/render/entityRenderer.ts`) — couche de rendu uniquement, 0 alloc/frame, 0 modification dans `src/game/`** :
  - **Maillage subdivisé 11×13** (143 sommets, 240 triangles) dans le repère vertical monde (`playerRoot`), ancré précisément au col/épaules derrière le cou, avec évasement drapé (`WIDTH_TOP = 0.66`, `WIDTH_BOT = 1.44`, `LENGTH = 0.86`), ourlet légèrement pointu au centre et plis verticaux organiques au repos.
  - **Solveur physique textile (`CapeClothSolver`)** : intégration Verlet normalisée en fréquence, **vraie inertie sur déplacement monde** (`ΔworldX/Y/Z` avec coupure anti-téléportation `> 3.5 u`), **contraintes structurelles + cisaillement (diagonales) + courbure (2-pas)** relaxées sur 5 itérations dans des `Float32Array` réutilisés, aérodynamique orientée selon les normales calculées sans allocation, turbulence météo multi-octaves à fréquences incommensurables (aucune boucle mécanique).
  - **Réactions distinctes vérifiées** : marche lente, course rapide, arrêt net avec inertie puis retombée gravitaire, virages/retournements, impulsion cinétique sur attaque à l'épée, repli compact en roulade, étirement en montée et gonflement en descente lors des sauts d'embarquement, rafales de tempête.
  - **Anti-clipping strict** : barrière dorsale convexe calculée par rapport au plan incliné (`SPRITE_TILT_X = -0.48 rad`) maintenant la cape derrière le dos, les bras, l'arme et le bouclier, et plancher sol (`GROUND_FLOOR_MARGIN = 0.085`) empêchant toute traversée du sol.
  - **Profils matériels et shader PBR textile GLSL (`MeshStandardMaterial` + `onBeforeCompile`)** : propriétés physiques et motifs propres à chaque cape (`cape_traveler` laine chaude, `cape_knight` manteau royal structuré à chevron doré, `cape_starlight` soie astrale légère à étoiles scintillantes et ourlet lumineux, `cape_dragon` velours lourd cramoisi-or à jacquard losange), contraste face extérieure / doublure intérieure (`gl_FrontFacing`), velours rasant (sheen), ombrage des plis et éclairage local partagé avec `SPRITE_LIGHT_UNIFORMS` (9 lumières).
  - **Inspection visuelle réelle sur planches zoomées 3×** (`work/e2e-cape-check/cape_zoom_sheet.png` puis `work/e2e-cape-check2/cape_zoom_sheet.png`) : première passe a permis de corriger le retrait excessif en `-Z` sur arrêt/attaque et de renforcer le fouetté d'attaque ; seconde passe validée sans clipping ni raideur.

### 15.4 Priorité 3 & 4 — Banque d'assets existante, Météo & Musique locale
- La bibliothèque locale (`asset-library/` — 2 319 ressources, `INDEX.md`, `manifest.json`) et les 126 assets actifs de `public/assets/` sont conservés intacts.
- **Portabilité audio (`src/audio/localMusic.ts`)** : chargement des trois pistes CC0 via `resolveAssetUrl('assets/audio/music/...')` (compatible `base: './'` de Vite). Crédits conservés intacts dans `public/assets/audio/music/CREDITS.md` (*The Old Tower Inn* CC0, *Whispers in the Fog* CC0, *Boss Battle (loop)* CC0).
- Vérification complète du sélecteur météo en pause (`Automatique`, `clear`, `fog`, `storm`, transition 14 s, zéro persistance dans la sauvegarde, zéro widget météo HUD), du mode muet, du volume général et des transitions musicales `overworld` / `dungeon` / `boss`.

### 15.5 Priorité 5 — 3 nouveaux sorts équilibrés et utilisables (réalisés après les priorités 1 à 4)
- **Sort 5 — *Égide de Ronron* (`aegis_purr`, Défense / Bouclier, touche `5 / C`, 26 PM, recharge 6,0 s)** : crée une barrière temporaire (`shieldHp`, `shieldTimer = 5,5 s`) absorbant les dégâts ennemis avant les PV dans `src/game/combat.ts` (`applyDamageToPlayer`, `updatePlayerShield`), indicateur `(+bouclier)` sur la barre PV du HUD, aura au sol persistante (`EntityRenderer`) + dôme runique doré-turquoise GLSL (`createAegisDomeMaterial`).
- **Sort 6 — *Bond Foudroyant* (`pounce_dash`, Mobilité, touche `6 / V`, 20 PM, recharge 2,8 s)** : ruée directionnelle (`6,2 u`) découpée en 12 sous-pas respectant les collisions de zone (`resolvePositionInCurrentZone`), i-frames `0,28 s`, silhouettes fantômes, impulsion de vitesse faisant claquer la cape en tissu, dégâts de traversée + ruban de griffes de vent GLSL (`createPounceRibbonMaterial`).
- **Sort 7 — *Chute d'Étoiles* (`meteor_paw`, Dégâts de zone AoE, touche `7 / X`, 42 PM, recharge 4,5 s)** : impact stellaire ciblé devant le héros / vers l'ennemi proche (`castRange = 5,5 u`, rayon AoE `5,4 u`, fort recul radial), séquence multi-étapes (sigil runique → orbe météore plongeant → onde de choc astrale GLSL `createMeteorBlastMaterial` + colonne lumineuse + éclats poolés).
- **Intégration complète & compatibilité** : améliorables Niv. 1 → 5 à l'Autel des Sorts de la Forge, déclenchables au clavier et au clic sur la barre des 7 sorts (responsive vérifiée sur `1280×720` et `375×667`), rétrocompatibilité stricte des anciennes sauvegardes à 4 sorts (`validateSaveData` initialise les 3 nouveaux sorts au Niv. 1), réutilisation des SFX existants (`spell_heal`, `dodge_whoosh`, `spell_fire`, aucun nouveau SFX ni musique généré). *Note honnête : les effets visuels des 3 sorts utilisent des shaders GLSL multi-étapes et le système de particules poolé ; des spritesheets frame par frame générées par ImageGen restent en attente du déblocage des crédits ImageGen.*

### 15.6 Commandes exécutées & résultats vérifiés
| Vérification | Commande exécutée | Résultat |
|---|---|---|
| Architecture `src/game/` | `git grep -n "from 'three'\|document\.\|window\." -- src/game/` | **PASS** — 0 import Three.js / DOM dans la logique gameplay (seuls listeners gardés dans `input.ts`) |
| Synchronisation graphe AST | `graphify update .` | **PASS** — `1544 nodes, 4422 edges, 61 communities` |
| TypeScript strict | `npx tsc --noEmit` | **PASS** — 0 erreur |
| Tests unitaires & intégration | `npm test -- --run` | **PASS** — **14/14 suites, 104/104 tests** (dont 13 nouveaux tests dans `tests/capeLightingEquipment.test.ts`) |
| Build production Vite | `npm run build` | **PASS** — `dist/assets/main-B4UB8Qlj.js` (avertissement chunk > 500 kB connu) |
| Audit E2E Playwright GPU (5 scénarios × desktop + mobile) | `node tests/e2e/visual-audit.mjs --scenario cape_lighting,modals,village,ocean_weather,ghost_cave --viewport 1280x720,375x667 --preview --verify --gpu --out work/e2e-final-verify` | **PASS** — **57/57 checks, 0 issue, 0 erreur console/WebGL/réseau** |
| Contrôle final bloom sorts + cape | `node tests/e2e/visual-audit.mjs --scenario cape_lighting --preview --verify --gpu --out work/e2e-final-bloom` | **PASS** — **14/14 checks, 0 issue, 0 erreur session** ; captures PNG inspectées directement |

---

## 16. Cartographie Graphify Exhaustive, Runtime d'Animation 2D Multi-Frames 30 FPS & Audit de Production IA — 25 novembre 2026

Cette phase structurelle a été conduite selon un découpage strict sans conflit de fichiers entre cartographie/audit (`GRAPHIFY_ASSET_AUDIT.md`, `ASSET_PRODUCTION_MATRIX.md`, `ASSET_INTEGRATION_MANIFEST.md`, `work/asset_production_matrix.json`, `work/asset_integration_manifest.json`), mise à niveau du lecteur d'animations 30 FPS (`src/art/*`, `src/render/*`, `tests/animationRuntime.test.ts`), et vérification indépendante en lecture seule + campagne E2E GPU.

### 16.1 Cartographie Graphify & Inventaire Statique/Visuel Exhaustif (Ce qui a été audité)
- **Interrogation croisée Graphify + AST + binaire PNG** :
  - Analyse préalable du graphe `graphify-out/graph.json` (`1 544` nœuds / `4 422` arêtes / `61` communautés à l'audit initial, porté à **`1 658` nœuds / `4 786` arêtes** après `graphify update .`), croisée avec l'intégralité des `49` fichiers `src/**`, `index.html`, les en-têtes binaires PNG `IHDR` des **`135` fichiers de `public/assets/`** et les **`2 343` fichiers de `asset-library/`**.
  - Réconciliation complète **`135/135`** sur `public/assets/` (`0` fichier oublié, `0` chevauchement entre actifs et exclus) documentée dans `GRAPHIFY_ASSET_AUDIT.md` et `ASSET_PRODUCTION_MATRIX.md`.
- **Périmètre actif & atteignable en jeu (`107` entrées unitaires / `1 021` frames distinctes cibles à 30 FPS)** :
  - **Héros Chat-valier** : `4` planches de corps primaires (`idle` 30f, `walk` 30f, `attack` 15f one-shot, `roll` 15f one-shot = `90` frames, `flipX` miroir gauche/droite à `SPRITE_TILT_X = -0.48 rad`, ligne de sol `446/512`) couvrant également `hurt`, `death`, `deck_idle` et `jump` par partage explicite documenté ou planches dédiées optionnelles ; **`27` couches modulaires indépendantes** sur les **8 emplacements actifs** (`weapon` ×4, `shield` ×2, `helmet` ×4, `armor` ×4, `boots` ×4, `gloves` ×4, `cape` ×4, `trinket` ×1 — **aucune arme secondaire**) ; + `1` sprite `lantern_hero.png` pour la `playerLanternLight` active (`lanternBoost > 0.04`).
  - **PNJ & Compagnon atteignables** : `miaou_sprit` (`30` frames loop HDR, présent sur les 6 îles, le pont du voilier et les 2 donjons) et `mayor_moustache` (`45` frames : `30f idle + 15f talk`, place centrale de Miaou-bourg).
  - **Ennemis, Boss & Phases (`0` insecte actif)** : **`8` planches de 90 frames** (`30f idle + 30f move + 15f windup + 15f attack = 720` frames, `flipX` miroir, ligne de sol `238/256`) couvrant les 5 ennemis réguliers (`slime_yarn`, `mouse_goblin`, `thorn_wolf`, `fishbone_skeleton`, `frost_golem`), le mini-boss `boss_rat_king`, `boss_dragon_claw` **Phase 1** (100→50 % PV) et une planche dédiée `boss_dragon_claw` **Phase 2** (≤50 % PV, remplaçant le simple teintage radial Canvas2D), + `1` portrait de dialogue actif `boss_dragon_claw.png`. L'audit confirme formellement **`0` ennemi insecte actif** dans `src/data/enemiesData.ts` (les sprites `roach.png` et `spider*.png` dans `asset-library/monsters/` sont en réserve inutilisée et exclus).
  - **Props, Bâtiments, Donjons, Icônes & VFX** : `20` props/bâtiments/coffres (`wood`/`rare`/`epic`/`golden`, `closed`/`locked`/`open`)/portails (`63` frames dont `portal_exit_sheet` 30f actuellement 100 % Canvas2D, `prop_torch_sheet` 15f, et `prop_lamppost` attendu par les 16 `OVERWORLD_LAMP_LIGHTS` de `worldRenderer.ts:49-66`), `42` icônes UI (`27` équipements, les **7 sorts** incluant les 3 PNG manquants `aegis_purr`/`pounce_dash`/`meteor_paw`, `8` HUD/blason — avec le constat que `getEquipmentIconUrl`, `getSpellIconUrl` et `getHudIconUrl` ont actuellement `0` appelant dans `src/ui/`), et `2` sprites VFX (`particle_orb`, `particle_star`).
- **Exclusions strictes respectées (`0` modification)** :
  - **(a) Sol & surfaces PBR** : les `18` textures `1024×1024` de `public/assets/textures/` (`grass_*`, `forest_*`, `snow_*`, `path_*`, `dungeon_ghost_*`, `dungeon_dragon_*`), `mapTexture.ts` et la mini-carte `512×512`.
  - **(b) Bateau** : `shipRenderer.ts`, `shipShaders.ts`, `shipPhysics.ts`, `shorelineNavigation.ts`.
  - **(c) Eau** : `waterShader.ts`.
  - **(d) Audio** : `9` fichiers `public/assets/audio/**` et `src/audio/**`.
  - **(e) Orphelins, doublons & réserve** : `12` PNG de `public/assets/` prouvés inutilisés/inatteignables/redondants (`equipment/dagger_fang.png`, `icons/equip/dagger_fang.png`, `props/prop_fence.png` à 0 instance monde, `characters/hero_portrait.png` jamais lu, `characters/innkeeper.png` & `kit_chat.png` à 0 spawn 3D et 0 ligne de dialogue, et les 6 `<enemy>.png` statiques redondants face aux `*_sheet.png`) + les **`2 343` fichiers de `asset-library/**`**.

### 16.2 Intégrations Réalisées dans le Code (Runtime 30 FPS Multi-Frames & Couches Modulaires)
- **`src/art/hdAssets.ts`** :
  - Définition canonique à `TARGET_ANIMATION_FPS = 30` des descripteurs `HERO_ANIM_CLIPS` (`idle`, `walk`, `attack`, `roll`, `hurt`, `death`, `deck_idle`, `jump`), `NPC_ANIM_CLIPS` (`idle`, `move`, `talk`) et `ENEMY_ANIM_CLIPS` (`idle`, `move`, `windup`, `attack`, `hurt`, `death` pour les 7 archétypes), avec pivots et lignes de sol constants (`HERO_PIVOT`, `NPC_PIVOT`, `COMPANION_PIVOT`, `ENEMY_PIVOT`) et traçabilité explicite des états partagés (`sharedFrom` / `sharedReason`).
  - Auto-détection rétrocompatible `resolveActiveSpriteGrid()` et `resolveEnemyAtlasStateGrid()` supportant simultanément les PNG actuels (`512×512` unitaires et `1024×256` 4×1), les grilles variables (`15`, `24`, `30`, `45` frames), les atlas multi-lignes par état et les atlas empaquetés de `90` cellules (`30f idle + 30f move + 15f windup + 15f attack`). Registres optionnels vides par défaut (`HD_HERO_SHEET_FILES`, `HD_EQUIPMENT_SHEET_FILES`, `HD_NPC_SHEET_FILES`, `HD_ENEMY_STATE_SHEET_FILES`, `HD_ENEMY_PHASE2_SHEET_FILES`, `HD_CAPE_FABRIC_FILES`) garantissant **0 requête fantôme et 0 erreur 404**.
  - Primitives pures **zéro-allocation** (`advanceSpriteAnimCursor`, `sampleOneShotProgressFrame`, `computeGridFrameUvInto` ligne-majeure `(col, row)`, `applyUvRectToTexture`).
- **`src/art/spriteHero.ts`, `src/art/spriteEntities.ts` & `src/art/textureRegistry.ts`** :
  - Indépendance stricte des 8 emplacements d'équipement (`HERO_BODY_EQUIP_SLOTS` exclut `cape` du cache corps 3D, `0` arme secondaire), découpe cellule `(col, row)` multi-frames pour le corps et les équipements, protection du cadrage portrait sur la cellule `0` (`getFirstFrameSizeForPortrait`), et support multi-cellules `(cols × rows)` pour `drawBossDragonPhase2SheetCanvas`.
  - Résolution mise en cache `ResolvedSpriteClipSource` (`uv-grid` et `frame-sequence`) via `resolveHeroClip`, `resolveEnemyClip` (Phase 1 & Phase 2), `resolveNpcClip`, méthodes d'enregistrement direct de spritesheets/séquences et `getCapeFabricTexture` / `registerCapeFabricTexture`.
- **`src/render/capePhysics.ts` & `src/render/entityRenderer.ts`** :
  - Branchement optionnel non destructif d'une texture plane de tissu (`fabricTexture` -> `uCapeFabricMap` / `uCapeUseFabricMap`) dans `CapeClothMesh` tout en conservant à 100 % le solveur textile Verlet `11×13` (`143` sommets), l'ancrage aux épaules, les plis et la barrière dorsale anti-clipping.
  - Lecture temps réel 30 FPS multi-frames du héros, de `miaou_sprit` et des ennemis/boss avec **0 allocation par frame** (`seenEnemyIds` réutilisé, suivi par référence des 7 slots corps, clones UV isolés par instance partageant la `Source` GPU) et télémétrie `getAnimationDiagnostics()`.
- **`tests/animationRuntime.test.ts` & `ASSET_INTEGRATION_MANIFEST.md`** :
  - Ajout de **12 tests automatisés dédiés** couvrant les cadences 30 FPS sur 15/24/30/45/90 frames, le parcours ligne-majeure `(col, row)` avec `frameCount < cols * rows`, `loop: false` vs `loop: true`, l'indépendance des 8 slots + cape Verlet + `fabricTexture`, l'isolation UV multi-instances + Phase 2 boss, et la rétrocompatibilité binaire sur les PNG actuels de `public/assets/`.
  - Documentation complète du mapping 1:1 prêt au dépôt dans `ASSET_INTEGRATION_MANIFEST.md` et `work/asset_integration_manifest.json`.

### 16.3 État Factuel de la Génération d'Assets IA (`0` PNG remplacé — Double Blocage Externe 503 & 429)
Conformément au protocole strict (exécution uniquement après sauvegarde de l'audit et de la matrice, zéro relance en boucle, zéro changement de modèle, zéro téléchargement Web, zéro copie depuis `asset-library/` et zéro dessin Canvas2D de substitution) :
1. **Canal A — Sous-agent intégré Antigravity `invoke_subagent(TypeName="image-generator")` (modèle `gemini-3.1-flash-image`)** :
   - Non exposé dans les outils d'un worker `/swarm` ; testé **deux fois à 10 minutes d'intervalle** depuis la session parente (`conv 1e71414b-b0b4-4b84-9caa-7d2c8cc53332`) sur `chest_closed_raw`.
   - Résultat identique aux deux essais : **`HTTP 503 UNAVAILABLE: No capacity available for model gemini-3.1-flash-image on the server`** (`0` image produite).
2. **Canal B — CLI ImageGen autorisé (`tmp/imagegen/venv/Scripts/python.exe` + `image_gen.py generate --model gpt-image-2`)** :
   - Testé **une seule fois** sur `chest_closed` (`1024×1024`, fond uni chroma `#FF00FF` requis par `image_gen.py:L194`, sortie `work/probe/chest_closed_probe_raw.png`, `OPENAI_API_KEY` présente).
   - Résultat immédiat (code `1`) : **`openai.RateLimitError: Error code: 429 - You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.`**
3. **Bilan transparent** : **`0` fichier PNG de `public/assets/` n'a été remplacé**. Les `107` entrées cibles sont tracées avec le statut explicite **`blocked_imagegen_503_and_429`** dans `ASSET_PRODUCTION_MATRIX.md`, `ASSET_INTEGRATION_MANIFEST.md`, `work/asset_production_matrix.json` et `work/asset_integration_manifest.json`, prêtes à être générées et déposées sans modification moteur dès le retour de capacité serveur `gemini-3.1-flash-image` ou le rechargement de crédits `gpt-image-2`.

### 16.4 Vérifications Exécutées & Résultats
| Contrôle | Commande / Méthode | Résultat |
|---|---|---|
| Isolation architecture `src/game/` | `git grep "three" -- src/game/` | **PASS** — `0` import `three` et `0` dépendance DOM hors `src/game/input.ts` |
| Non-modification des zones exclues | Contrôle différentiel `git status` / SHA-256 (`public/assets/textures/**`, `shipRenderer.ts`, `shipShaders.ts`, `waterShader.ts`, `src/audio/**`) | **PASS** — `0` modification sur le sol, le bateau, l'eau, l'audio et les PNG existants |
| Synchronisation graphe AST Graphify | `graphify update .` | **PASS** — graphe AST synchronisé avec les nouveaux modules et livrables |
| TypeScript strict | `npx tsc --noEmit` | **PASS** — `0` erreur |
| Suite complète de tests unitaires & intégration | `npm test -- --run` | **PASS** — **`15/15` fichiers, `116/116` tests passés** (dont `12/12` dans `tests/animationRuntime.test.ts` et `13/13` dans `tests/capeLightingEquipment.test.ts`) |
| Build production Vite | `npm run build` | **PASS** — build Vite généré sans erreur |
| Campagne E2E GPU Playwright (`work/e2e-runtime-30fps-verify`) | `node tests/e2e/visual-audit.mjs --scenario cape_lighting,maritime,village,ghost_cave,dragon_lair --viewport 1280x720,375x667 --preview --verify --gpu --out work/e2e-runtime-30fps-verify` | Exécutée et inspectée visuellement sur captures PNG (`1280×720` & `375×667`) : sol, voilier et eau intacts, cape Verlet animée et équipement indépendant, ennemis/boss lisibles, `0` erreur 404, `0` erreur console/WebGL/GLSL |

---

## 17. Reprise Assets IA, Audit Statique Vérifié & Intégration Hub Miaou-bourg — 25 novembre 2026

- **Branche de travail** : `assets/ai-overhaul-resume`, créée depuis `origin/main` (`2131eb2cb00878d65dfd5ab3963f76fdbc7be1b1`).
- **Livrables documentaires ajoutés / mis à jour** : `GRAPHIFY_ASSET_AUDIT.md`, `ASSET_PRODUCTION_MATRIX.md`, `ASSET_INTEGRATION_MANIFEST.md` et la présente section.

### 17.1 Assets générés par IA, inspectés, intégrés et vérifiés (`6` PNG remplacés)
Six assets statiques 1-frame prioritaires de Miaou-bourg et des coffres interactifs ont été générés via l'outil IA `generate_image` (direction artistique fantasy féline colorée 2D/2.5D, chroma `#FF00FF`), détourés et normalisés en `512×512` RGBA transparent via `scripts/process_characters.mjs` (`0 %` frange magenta, `0` pixel coupé en bordure), inspectés sur planches QA, puis vérifiés en jeu :
- `public/assets/props/house_village.png` (`512×512` RGBA)
- `public/assets/props/building_inn.png` (`512×512` RGBA)
- `public/assets/props/building_forge.png` (`512×512` RGBA)
- `public/assets/props/prop_quest_board.png` (`512×512` RGBA)
- `public/assets/props/chest_closed.png` (`512×512` RGBA)
- `public/assets/props/chest_open.png` (`512×512` RGBA)

### 17.2 Ce qui reste à produire & blocages d'environnement constatés
- **Assets restants** : les autres props statiques (12), les 27 équipements modulaires (hors `dagger_fang` exclu), les 4 textures tissu cape, les 2 PNJ actifs (`miaou_sprit`, `mayor_moustache`), les spritesheets multi-frames 30 FPS (héros, 5 ennemis standards, 2 boss + Phase 2 `boss_dragon_claw`) ainsi que les icônes UI/VFX restent tracés `à produire` dans `ASSET_PRODUCTION_MATRIX.md` (aucune duplication de frames ni substitut procédural).
- **Blocages d'environnement (conteneur cloud Linux isolé)** :
  1. Le checkout local Windows (`C:\Users\hugos\.gemini\antigravity\scratch\cat-quest-proto`) est inaccessible depuis cet environnement ; la branche repart du `main` distant le plus récent (`2131eb2`).
  2. Le binaire `graphify` n'est pas installé dans ce conteneur ; l'audit repose sur un recoupement statique exhaustif de `src/` et `public/assets/`.
  3. Aucune authentification GitHub (`gh` / credentials Git) n'est disponible dans ce conteneur : les changements sont prêts et vérifiés localement sur la branche `assets/ai-overhaul-resume`, mais le `git push` et l'ouverture de la PR GitHub nécessitent une connexion GitHub effectuée par l'utilisateur.

### 17.3 Vérifications réellement exécutées & résultats
| Contrôle | Commande / Méthode | Résultat |
|---|---|---|
| Non-modification des zones exclues | `git status` (`public/assets/textures/**`, `shipRenderer.ts`, `shipShaders.ts`, `waterShader.ts`, `public/assets/audio/**`, `src/audio/**`) | **PASS** — `0` modification sur le sol, le bateau, l'eau, l'audio et les assets exclus/orphelins |
| TypeScript strict | `npx tsc --noEmit` | **PASS** — `0` erreur |
| Suite Vitest | `npm test -- --run` | **PASS** — **`16/16` fichiers, `124/124` tests passés** |
| Build production Vite | `npm run build` | **PASS** — build généré sans erreur |
| Vérification visuelle Playwright (`1280×720` & `375×667`) | `playwright-cli` sur `http://localhost:3000` (écran titre, Miaou-bourg, inventaire 8 emplacements + cape Verlet, déplacement, vue mobile) | **PASS** — `0` erreur console/page/WebGL, `0` requête >= 400 (`0` 404), les 4 bâtiments/panneau Miaou-bourg rendus sans frange ni socle d'herbe collé |

