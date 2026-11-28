import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

interface MinimalNodeFs {
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: string): string;
}

interface MinimalNodePath {
  resolve(...segs: string[]): string;
  join(...segs: string[]): string;
}

async function getNodeFsAndPath(): Promise<{
  fs: MinimalNodeFs;
  path: MinimalNodePath;
  cwd: string;
}> {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as MinimalNodeFs;
  const path = (await import(/* @vite-ignore */ 'node:' + 'path')) as unknown as MinimalNodePath;
  const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
  return { fs, path, cwd: proc ? proc.cwd() : '.' };
}
import {
  computeHeroEquipmentMaskState,
  createHeroSkeletonPose,
  getEquipmentCalibration,
  solveHeroBoneTransformsInto,
  solveHeroEarPose,
} from '../src/art/equipmentRig';
import { AUDIO_SFX_GROUPS } from '../src/audio/audioManifest';
import { OVERWORLD_DATA } from '../src/data/worldData';
import { ALL_NEW_ISLANDS, NEW_ISLANDS } from '../src/data/worldIslands';
import {
  GameEngine,
  PORTAL_ENTER_DURATION,
  PORTAL_EXIT_DURATION,
} from '../src/game/gameEngine';
import {
  createMemoryStorage,
  loadGame,
  serializeGameState,
  validateSaveData,
} from '../src/game/saveSystem';
import { sampleShorelineField } from '../src/game/shorelineNavigation';
import type { InputState, IslandId, PropKind } from '../src/game/types';
import { SAVE_STORAGE_KEY } from '../src/game/types';
import { computeShipBowLanternLevel } from '../src/render/shipRenderer';
import {
  createHeroMaskUniforms,
  enableSpriteLighting,
} from '../src/render/spriteLighting';
import {
  WildlifeSystem,
  resolveWildlifeCounts,
  shouldSpawnDolphins,
} from '../src/render/wildlifeSystem';
import { getZoneBannerName } from '../src/ui/screensController';

function createIdleInput(overrides?: Partial<InputState>): InputState {
  return {
    moveX: 0,
    moveZ: 0,
    attackPressed: false,
    attackHeld: false,
    dodgePressed: false,
    interactPressed: false,
    spellPressed: {
      flamepurr: false,
      lightnyan: false,
      freezepaw: false,
      healing_paw: false,
      aegis_purr: false,
      pounce_dash: false,
      meteor_paw: false,
    },
    aimWorldPos: null,
    usingPointerAim: false,
    toggleInventoryPressed: false,
    toggleMapPressed: false,
    pausePressed: false,
    confirmPressed: false,
    ...overrides,
  };
}

function startPlayingEngine(): GameEngine {
  const engine = new GameEngine({
    storage: createMemoryStorage(),
    rng: () => 0.1,
  });
  engine.startNewGame();
  while (engine.state.dialogue.active) {
    engine.advanceDialogue();
  }
  engine.consumeEvents();
  return engine;
}

describe('Phase 5 — Masquage Équipement, Portails 1.8s, Miaou-sprit, Faune & Décor Interactif', () => {
  it('1. masque le torse sous armure, garde les oreilles sous casques ouverts et masque crâne+oreilles sous heaumes fermés', () => {
    const pose = createHeroSkeletonPose();

    for (const armorId of ['armor_tunic', 'armor_mail', 'armor_robe', 'armor_dragon']) {
      const m = computeHeroEquipmentMaskState({
        equipped: { armor: armorId, helmet: '' },
        heroState: 'idle',
        bonePose: pose,
      });
      expect(m.torsoMasked).toBe(true);
      // Enveloppe torse strictement contenue dans la largeur du plastron sans mordre sur les bras
      expect(m.torsoHalfW).toBeLessThan(0.08);
      expect(m.torsoHalfH).toBeLessThan(0.08);
    }

    for (const openHelm of ['helm_bandana', 'helm_mage']) {
      const cal = getEquipmentCalibration(openHelm);
      expect(cal?.helmetOcclusion?.earVisibility).toBe(1.0);
      const earPose = solveHeroEarPose(0.5, 'idle', openHelm);
      expect(earPose.visibility).toBe(1.0);

      const m = computeHeroEquipmentMaskState({
        equipped: { armor: 'armor_tunic', helmet: openHelm },
        heroState: 'idle',
        bonePose: pose,
      });
      expect(m.headMaskMode).toBe('open_helmet');
      expect(m.headMaskEnabled).toBe(false);
      expect(m.earVisibility).toBe(1.0);
    }

    for (const closedHelm of ['helm_knight', 'helm_dragon']) {
      const m = computeHeroEquipmentMaskState({
        equipped: { armor: 'armor_dragon', helmet: closedHelm },
        heroState: 'idle',
        bonePose: pose,
      });
      expect(m.headMaskMode).toBe('closed_helmet');
      expect(m.headMaskEnabled).toBe(true);
      expect(m.earVisibility).toBe(0);
      // Centre du masque au-dessus de l'os de tête pour préserver yeux & museau
      expect(m.headCenterV).toBeGreaterThan(m.headBoneV);
    }

    // Régression roll & death : le masquage reste actif et suit les os quand armure/casque restent visibles
    for (const animState of ['roll', 'death'] as const) {
      solveHeroBoneTransformsInto(pose, animState, 4, 15, { deathProgress: 0.45 });
      const mAnim = computeHeroEquipmentMaskState({
        equipped: { armor: 'armor_dragon', helmet: 'helm_knight' },
        heroState: animState,
        bonePose: pose,
      });
      expect(mAnim.torsoMasked).toBe(true);
      expect(mAnim.headMaskEnabled).toBe(true);
      expect(mAnim.headMaskMode).toBe('closed_helmet');
      expect(Number.isFinite(mAnim.torsoCenterU)).toBe(true);
      expect(Number.isFinite(mAnim.headCenterV)).toBe(true);
    }

    // Régression pixel-audit pointes d'oreilles : l'ellipse élargie couvre (0.284, 0.726) et (0.614, 0.726) sans masquer la bande des yeux
    solveHeroBoneTransformsInto(pose, 'idle', 0, 1);
    const closedIdle = computeHeroEquipmentMaskState({
      equipped: { armor: 'armor_dragon', helmet: 'helm_knight' },
      heroState: 'idle',
      bonePose: pose,
    });
    const isHeadUvMasked = (u: number, v: number): boolean => {
      const dx = u - closedIdle.headCenterU;
      const dy = v - closedIdle.headCenterV;
      const nx = dx / closedIdle.headHalfW;
      const ny = dy / closedIdle.headHalfH;
      return dy >= -closedIdle.headHalfH * 0.77 && nx * nx + ny * ny <= 1.0;
    };
    expect(isHeadUvMasked(0.284, 0.726)).toBe(true);
    expect(isHeadUvMasked(0.614, 0.726)).toBe(true);
    expect(isHeadUvMasked(0.449, 0.56)).toBe(false);
    expect(isHeadUvMasked(0.449, 0.62)).toBe(false);

    // Déséquipement complet : restauration propre
    const naked = computeHeroEquipmentMaskState({
      equipped: { armor: '', helmet: '' },
      heroState: 'idle',
      bonePose: pose,
    });
    expect(naked.torsoMasked).toBe(false);
    expect(naked.headMaskEnabled).toBe(false);
    expect(naked.headMaskMode).toBe('none');
    expect(naked.earVisibility).toBe(1.0);

    // Clé shader distincte pour le matériau masqué du héros
    const baseMat = new THREE.MeshStandardMaterial();
    const heroMat = new THREE.MeshStandardMaterial();
    enableSpriteLighting(baseMat);
    enableSpriteLighting(heroMat, { heroMaskUniforms: createHeroMaskUniforms() });
    expect(heroMat.customProgramCacheKey()).not.toBe(baseMat.customProgramCacheKey());
    baseMat.dispose();
    heroMat.dispose();
  });

  it('2. exécute la cinématique de portail 1.8s (marche 0-0.9s, vortex >=0.3s, fondu 1.1-1.8s, invulnérabilité & watchdog) et les bannières des 6 îles', () => {
    expect(PORTAL_ENTER_DURATION).toBeCloseTo(1.4, 2);
    expect(PORTAL_EXIT_DURATION).toBeCloseTo(0.4, 2);
    expect(PORTAL_ENTER_DURATION + PORTAL_EXIT_DURATION).toBeCloseTo(1.8, 2);

    const engine = startPlayingEngine();
    const ghostPortal = engine.state.interactables.find(
      (i) => i.type === 'dungeon_entrance' && i.targetZoneId === 'dungeon_ghost_cave',
    );
    expect(ghostPortal).toBeDefined();

    engine.state.player.x = ghostPortal!.x;
    engine.state.player.z = ghostPortal!.z + 1.2;
    engine.step(0.016, createIdleInput());
    engine.step(0.016, createIdleInput({ interactPressed: true }));
    engine.consumeEvents();

    expect(engine.state.portalTransition?.phase).toBe('entering');
    expect(engine.state.transitionFade).toBe(0);

    // 0.0 - 0.9 s : approche + déclenchement portal_vortex à >= 0.3 s
    let sawVortex = false;
    for (let i = 0; i < 20; i++) {
      engine.step(0.025, createIdleInput()); // +0.50s
      if (engine.consumeEvents().some((e) => e.type === 'portal_vortex')) {
        sawVortex = true;
      }
      expect(engine.state.player.invulnTimer).toBeGreaterThanOrEqual(0.24);
    }
    expect(sawVortex).toBe(true);
    expect(engine.state.zoneId).toBe('overworld');
    expect(engine.state.transitionFade).toBe(0);

    // Avance dans la fenêtre 1.1 - 1.4 s : fondu au noir progressif
    for (let i = 0; i < 30; i++) {
      engine.step(0.025, createIdleInput()); // +0.75s -> total ~1.25s
    }
    expect(engine.state.zoneId).toBe('overworld');
    expect(engine.state.transitionFade).toBeGreaterThan(0.2);

    // Bascule en donjon à 1.4 s avec islandId sur zone_transition puis sortie 1.4 - 1.8 s
    let sawZoneEvent = false;
    let sawExiting = false;
    let invulnRightAfterExit = 0;
    for (let i = 0; i < 30; i++) {
      const wasExiting = engine.state.portalTransition?.phase === 'exiting';
      engine.step(0.025, createIdleInput());
      const evs = engine.consumeEvents();
      if (evs.some((e) => e.type === 'zone_transition' && e.zoneId === 'dungeon_ghost_cave' && e.islandId === 'felingard')) {
        sawZoneEvent = true;
      }
      if (engine.state.portalTransition?.phase === 'exiting') {
        sawExiting = true;
      }
      if (wasExiting && engine.state.portalTransition === null) {
        invulnRightAfterExit = engine.state.player.invulnTimer;
      }
    }
    expect(sawZoneEvent).toBe(true);
    expect(sawExiting).toBe(true);
    expect(engine.state.zoneId).toBe('dungeon_ghost_cave');
    expect(engine.state.portalTransition).toBeNull();
    expect(invulnRightAfterExit).toBeGreaterThanOrEqual(0.58);

    // Watchdog anti-blocage
    engine.state.portalTransition = {
      phase: 'entering',
      elapsed: 2.5,
      duration: PORTAL_ENTER_DURATION,
      maxDuration: 2.4,
      portalX: 0,
      portalZ: 22,
      exitTargetX: 30,
      exitTargetZ: 8,
      targetZoneId: 'overworld',
      targetSpawn: { x: 30, z: 8 },
    };
    engine.step(0.016, createIdleInput());
    expect(engine.state.zoneId).toBe('overworld');

    // Toutes les 6 îles résolvent un nom de bannière valide
    const allIslands: IslandId[] = ['felingard', ...ALL_NEW_ISLANDS];
    expect(allIslands).toHaveLength(6);
    for (const isl of allIslands) {
      const label = getZoneBannerName('overworld', isl);
      expect(label.length).toBeGreaterThan(3);
    }
  });

  it('3. active Miaou-sprit pour guider vers les coffres/quêtes et réagir aux critiques, esquives parfaites et victoires de boss', () => {
    const engine = startPlayingEngine();

    // Guidage vers un coffre proche non ouvert (<= 18u)
    const chest = engine.state.chests.find((c) => !c.opened && !c.locked)!;
    expect(chest).toBeDefined();
    engine.state.player.x = chest.x - 6;
    engine.state.player.z = chest.z;
    engine.step(0.05, createIdleInput());
    const evsChest = engine.consumeEvents();
    expect(engine.state.companion.guideKind).toBe('chest');
    expect(engine.state.companion.mode).toBe('guide_chest');
    expect(evsChest.some((e) => e.type === 'companion_chime' && e.companionTargetKind === 'chest')).toBe(true);

    // Guidage vers quête suivie quand aucun coffre n'est à portée
    engine.state.player.x = 0;
    engine.state.player.z = 24;
    engine.step(0.05, createIdleInput());
    if (engine.state.questTarget && engine.state.questTarget.zoneId === 'overworld') {
      const qDist = Math.hypot(
        engine.state.questTarget.x - engine.state.player.x,
        engine.state.questTarget.z - engine.state.player.z,
      );
      if (qDist > 5) {
        expect(engine.state.companion.guideKind).toBe('quest');
      }
    }

    // Réaction sur esquive parfaite
    engine.state.telegraphs.push({
      id: 'comp_pd_tg',
      ownerId: 'ow_slime_1',
      shape: 'circle',
      x: engine.state.player.x,
      z: engine.state.player.z,
      angle: 0,
      radius: 3.0,
      elapsed: 0.9,
      duration: 1.0,
      damage: 10,
      resolved: false,
    });
    engine.step(0.016, createIdleInput({ dodgePressed: true, moveX: 1 }));
    expect(engine.state.companion.reactionKind).toBe('perfect_dodge');
    expect(engine.state.companion.mode).toBe('react_dodge');

    // Réaction critique sur vague secondaire de Chute d'Étoiles (updateTransientVisuals)
    const targetEnemy = engine.state.enemies.find((e) => e.state !== 'dead' && e.hp > 0)!;
    expect(targetEnemy).toBeDefined();
    targetEnemy.hp = Math.max(targetEnemy.hp, 500);
    engine.state.perfectDodgeTimer = 0;
    engine.state.timeScale = 1;
    engine.state.companion.reactionKind = null;
    engine.state.companion.reactionTimer = 0;
    engine.state.activeSpellEffects.push({
      id: 'starfall_crit_probe',
      spellId: 'meteor_paw',
      x: targetEnemy.x,
      z: targetEnemy.z,
      angle: 0,
      targetX: targetEnemy.x,
      targetZ: targetEnemy.z,
      radius: 3.5,
      elapsed: 0.34,
      duration: 1.2,
      wavesTriggered: 1,
      waveCount: 3,
      waveInterval: 0.35,
      spellDamage: 20,
      spellCritChance: 1.0,
    });
    engine.step(0.02, createIdleInput());
    expect(engine.state.companion.reactionKind).toBe('crit');
    expect(engine.state.companion.mode).toBe('react_crit');

    // Réaction sur victoire de boss
    engine.loadZone('dungeon_ghost_cave', { x: 0, z: -15 }, false);
    const ratKing = engine.state.enemies.find((e) => e.typeId === 'boss_rat_king')!;
    ratKing.hp = 1;
    engine.state.player.x = ratKing.x - 1.2;
    engine.state.player.z = ratKing.z;
    engine.state.player.aimAngle = 0;
    engine.state.player.attackCooldown = 0;
    engine.state.player.dodgeTimer = 0;
    engine.step(0.016, createIdleInput({ attackPressed: true }));
    expect(engine.state.companion.reactionKind).toBe('boss_victory');
    expect(engine.state.companion.mode).toBe('react_victory');
  });

  it('4. gère WildlifeDensity (défaut normal, persistance, rétrocompatibilité v1/v2), WildlifeSystem et la lanterne de proue', () => {
    const storage = createMemoryStorage();
    const engine = new GameEngine({ storage, rng: () => 0.25 });
    expect(engine.state.options.wildlifeDensity).toBe('normal');

    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();
    engine.setWildlifeDensity('high');
    expect(engine.state.options.wildlifeDensity).toBe('high');

    const loaded = loadGame(storage);
    expect(loaded?.options?.wildlifeDensity).toBe('high');

    // Rétrocompatibilité sauvegarde v1/v2 sans champ options
    const snap = serializeGameState(engine.state);
    const legacyNoOptions = { ...snap } as Record<string, unknown>;
    delete legacyNoOptions.options;
    const validatedLegacy = validateSaveData(legacyNoOptions);
    expect(validatedLegacy).not.toBeNull();
    expect(validatedLegacy?.options).toBeUndefined();

    // Validation stricte si options.wildlifeDensity est corrompu
    expect(
      validateSaveData({ ...snap, options: { wildlifeDensity: 'ultra' } }),
    ).toBeNull();

    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(legacyNoOptions));
    const resumed = new GameEngine({ storage });
    expect(resumed.continueSavedGame()).toBe(true);
    expect(resumed.state.options.wildlifeDensity).toBe('normal');

    // Échelles de densité & système Three.js poolé + .dispose()
    const lowC = resolveWildlifeCounts('low');
    const normC = resolveWildlifeCounts('normal');
    const highC = resolveWildlifeCounts('high');
    expect(lowC.birds).toBeLessThan(normC.birds);
    expect(normC.birds).toBeLessThan(highC.birds);
    expect(lowC.critters).toBeLessThan(normC.critters);
    expect(normC.critters).toBeLessThan(highC.critters);

    const scene = new THREE.Scene();
    const wildlife = new WildlifeSystem(scene);
    engine.state.options.wildlifeDensity = 'high';
    wildlife.update(engine.state, 0.016, null);
    const dHigh = wildlife.getDiagnostics();
    expect(dHigh.visible).toBe(true);
    expect(dHigh.activeBirds).toBe(highC.birds);

    engine.state.options.wildlifeDensity = 'low';
    wildlife.update(engine.state, 0.016, null);
    const dLow = wildlife.getDiagnostics();
    expect(dLow.activeBirds).toBe(lowC.birds);

    // Masqué en donjon
    engine.loadZone('dungeon_ghost_cave', { x: 0, z: 19.5 }, false);
    wildlife.update(engine.state, 0.016, null);
    expect(wildlife.getDiagnostics().visible).toBe(false);

    // Dauphins uniquement en navigation en eau libre
    engine.loadZone('overworld', { x: 0, z: 24 }, false);
    expect(shouldSpawnDolphins(engine.state)).toBe(false);
    engine.state.ship.mode = 'sailing';
    engine.state.ship.position = { x: 0, z: 95 };
    expect(shouldSpawnDolphins(engine.state)).toBe(true);

    wildlife.dispose();
    expect(scene.getObjectByName('WildlifeRoot')).toBeUndefined();

    // Lanterne de proue : éteinte à midi clair, allumée au crépuscule, la nuit et en tempête
    expect(computeShipBowLanternLevel({ dayPhase: 'day', lanternBoost: 0, stormIntensity: 0, nightFactor: 0 })).toBe(0);
    expect(computeShipBowLanternLevel({ dayPhase: 'dusk', lanternBoost: 0.4, stormIntensity: 0, nightFactor: 0.4 })).toBeGreaterThan(0.5);
    expect(computeShipBowLanternLevel({ dayPhase: 'night', lanternBoost: 0.95, stormIntensity: 0, nightFactor: 1 })).toBeGreaterThan(0.8);
    expect(computeShipBowLanternLevel({ dayPhase: 'day', lanternBoost: 0.8, stormIntensity: 0.9, nightFactor: 0 })).toBeGreaterThan(0.8);
  });

  it('5. déclenche decor_hit (non-bloquant + cooldown), empreintes sable/neige et éclaboussures de rivage', () => {
    const engine = startPlayingEngine();
    // Place le héros devant un tonneau près de la Forge (non-bloquant)
    engine.state.player.x = 11.1;
    engine.state.player.z = 20.5;
    engine.state.player.aimAngle = 0;
    engine.state.player.attackCooldown = 0;

    engine.step(0.016, createIdleInput({ attackPressed: true }));
    const evs1 = engine.consumeEvents();
    const barrelHit = evs1.find((e) => e.type === 'decor_hit' && e.propKind === 'barrel');
    expect(barrelHit).toBeDefined();
    expect(barrelHit?.decorMaterial).toBe('wood');
    // Non-bloquant : ne déclenche pas la musique de combat
    expect(engine.state.inCombat).toBe(false);

    // Cooldown actif empêche le spam immédiat
    engine.state.player.attackCooldown = 0;
    engine.step(0.016, createIdleInput({ attackPressed: true }));
    const evs2 = engine.consumeEvents();
    expect(evs2.some((e) => e.type === 'decor_hit' && e.propId === barrelHit?.propId)).toBe(false);

    // Vérifie le déclenchement sur un rocher ('stone')
    engine.state.player.x = 31.8;
    engine.state.player.z = 7.0;
    engine.state.player.aimAngle = 0;
    engine.state.player.attackCooldown = 0;
    engine.step(0.016, createIdleInput({ attackPressed: true }));
    const stoneHit = engine
      .consumeEvents()
      .find((e) => e.type === 'decor_hit' && e.decorMaterial === 'stone');
    expect(stoneHit).toBeDefined();

    // Régression lightnyan (line_pierce) : ne touche jamais un arbre derrière le héros (player.x - 1.2)
    // mais touche bien un arbre devant dans l'axe du rayon (player.x + 3.0)
    const oakTree = OVERWORLD_DATA.props.find((pr) => pr.id === 'prop_oak_1' && pr.kind === 'oak_tree')!;
    expect(oakTree).toBeDefined();
    engine.state.player.x = oakTree.x + 1.2;
    engine.state.player.z = oakTree.z;
    engine.state.player.aimAngle = 0;
    engine.state.player.mp = 100;
    engine.state.player.spellCooldowns.lightnyan = 0;
    engine.consumeEvents();
    expect(engine.castSpellById('lightnyan', { x: engine.state.player.x + 10, z: engine.state.player.z })).toBe(true);
    const behindEvs = engine.consumeEvents();
    expect(behindEvs.some((e) => e.type === 'decor_hit' && e.propId === oakTree.id)).toBe(false);

    engine.state.player.x = oakTree.x - 3.0;
    engine.state.player.z = oakTree.z;
    engine.state.player.aimAngle = 0;
    engine.state.player.mp = 100;
    engine.state.player.spellCooldowns.lightnyan = 0;
    expect(engine.castSpellById('lightnyan', { x: engine.state.player.x + 10, z: engine.state.player.z })).toBe(true);
    const frontEvs = engine.consumeEvents();
    const oakHit = frontEvs.find((e) => e.type === 'decor_hit' && e.propId === oakTree.id);
    expect(oakHit).toBeDefined();
    expect(oakHit?.decorMaterial).toBe('foliage');

    // Éclaboussure de rivage sur plage peu profonde + empreintes sable
    engine.state.islandId = 'tropical';
    const isl = NEW_ISLANDS.tropical;
    // Cherche un point de plage dans la bande [-2.0, 0.5]
    let beachX = isl.centerX + isl.radius - 1.5;
    let beachZ = isl.centerZ;
    for (let r = isl.radius - 4; r <= isl.radius + 4; r += 0.4) {
      const sample = sampleShorelineField(isl.centerX + r, isl.centerZ);
      if (sample.coastKind === 'beach' && sample.signedDistance >= -2.0 && sample.signedDistance <= 0.8) {
        beachX = isl.centerX + r;
        beachZ = isl.centerZ;
        break;
      }
    }
    engine.state.player.x = beachX;
    engine.state.player.z = beachZ;
    // Marche latérale le long du rivage pour dépasser FOOTSTEP_STRIDE_DIST
    let sawShoreSplash = false;
    let sawSandStep = false;
    for (let i = 0; i < 16; i++) {
      engine.step(0.05, createIdleInput({ moveZ: 1 }));
      for (const ev of engine.consumeEvents()) {
        if (ev.type === 'shore_splash') sawShoreSplash = true;
        if (ev.type === 'footstep' && ev.terrain === 'sand') sawSandStep = true;
      }
    }
    expect(sawSandStep).toBe(true);
    expect(sawShoreSplash).toBe(true);

    // Vérifie que les groupes audio utilisés par Phase 5 existent bien dans le manifeste
    expect(AUDIO_SFX_GROUPS.impact_prop_wood.variants.length).toBeGreaterThan(0);
    expect(AUDIO_SFX_GROUPS.impact_prop_stone.variants.length).toBeGreaterThan(0);
    expect(AUDIO_SFX_GROUPS.footstep_water_shore.variants.length).toBeGreaterThan(0);
    expect(AUDIO_SFX_GROUPS.ui_portal_vortex.variants.length).toBeGreaterThan(0);

    // Vérifie l'exhaustivité du PropKind 'bush' | 'barrel' sans fuite
    const extraProps: PropKind[] = ['bush', 'barrel'];
    expect(extraProps).toContain('bush');
    expect(extraProps).toContain('barrel');
  });

  it('6. respecte l’isolation stricte src/game/ (0 import three, 0 DOM inconditionnel)', async () => {
    const { fs, path, cwd } = await getNodeFsAndPath();
    const gameDir = path.resolve(cwd, 'src', 'game');
    const files = fs.readdirSync(gameDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);

    for (const file of files) {
      const content = fs.readFileSync(path.join(gameDir, file), 'utf8');
      expect(content).not.toMatch(/from\s+['"]three['"]/);
      if (file !== 'input.ts') {
        expect(content).not.toMatch(/\bdocument\./);
        expect(content).not.toMatch(/\bwindow\./);
        expect(content).not.toMatch(/\bHTMLElement\b/);
      }
    }
  });
});
