import { describe, expect, it } from 'vitest';
import {
  HERO_BONE_ORDER,
  createHeroSkeletonPose,
  getEquipmentCalibration,
  resolveWeaponAttackStyle,
  solveHeroBoneTransformsInto,
  solveHeroEarPose,
} from '../src/art/equipmentRig';
import {
  BELT_LANTERN_IGNITE_DURATION,
  createHeroBeltLanternState,
  stepHeroBeltLantern,
} from '../src/art/spriteHero';
import { computeWeatherMix } from '../src/audio/weatherAudio';
import {
  WEAPON_COMBAT_PROFILES,
  getWeaponCombatProfile,
} from '../src/data/equipmentData';
import { SPELLS } from '../src/data/spellsData';
import {
  CHEST_OPEN_DURATION,
  GameEngine,
  HERO_DEATH_DURATION,
} from '../src/game/gameEngine';
import type { InputState, SpellId } from '../src/game/types';
import { WeatherCycleController } from '../src/render/weatherSystem';

function createEmptySpellPressed(active?: SpellId): Record<SpellId, boolean> {
  return {
    flamepurr: active === 'flamepurr',
    lightnyan: active === 'lightnyan',
    freezepaw: active === 'freezepaw',
    healing_paw: active === 'healing_paw',
    aegis_purr: active === 'aegis_purr',
    pounce_dash: active === 'pounce_dash',
    meteor_paw: active === 'meteor_paw',
  };
}

function createIdleInput(
  overrides: Partial<InputState> & { castSpell?: SpellId } = {},
): InputState {
  const { castSpell, ...rest } = overrides;
  return {
    moveX: 0,
    moveZ: 0,
    attackPressed: false,
    attackHeld: false,
    dodgePressed: false,
    interactPressed: false,
    spellPressed: createEmptySpellPressed(castSpell),
    aimWorldPos: null,
    usingPointerAim: false,
    toggleInventoryPressed: false,
    toggleMapPressed: false,
    pausePressed: false,
    confirmPressed: false,
    ...rest,
  };
}

function startPlayingEngine(): GameEngine {
  const engine = new GameEngine({ storage: null });
  engine.startNewGame();
  // Ferme le dialogue d'introduction
  for (let i = 0; i < 10 && engine.state.dialogue.active; i++) {
    engine.advanceDialogue();
  }
  engine.consumeEvents();
  return engine;
}

describe('Cat Quest 3 — Armes, Sorts, Boss, Interactions, Lanterne & Audio', () => {
  it('différencie nettement les 4 profils d’armes (portée, arc, cadence, recul, style rig)', () => {
    const wood = getWeaponCombatProfile('sword_wood');
    const steel = getWeaponCombatProfile('sword_steel');
    const staff = getWeaponCombatProfile('staff_arcane');
    const dragon = getWeaponCombatProfile('blade_dragon');

    expect(Object.keys(WEAPON_COMBAT_PROFILES)).toEqual(
      expect.arrayContaining(['sword_wood', 'sword_steel', 'staff_arcane', 'blade_dragon']),
    );
    expect(wood.reach).toBeLessThan(steel.reach);
    expect(steel.reach).toBeLessThan(dragon.reach);
    expect(staff.reach).toBeGreaterThan(steel.reach);
    expect(steel.arcAngle).toBeLessThan(dragon.arcAngle);
    expect(dragon.knockbackMult).toBeGreaterThan(wood.knockbackMult);
    expect(dragon.cooldownMult).toBeGreaterThan(wood.cooldownMult);

    expect(resolveWeaponAttackStyle('sword_wood')).toBe('wood_slash');
    expect(resolveWeaponAttackStyle('sword_steel')).toBe('steel_thrust');
    expect(resolveWeaponAttackStyle('staff_arcane')).toBe('arcane_sweep');
    expect(resolveWeaponAttackStyle('blade_dragon')).toBe('dragon_cleave');

    // Vérifie que les poses d'attaque diffèrent par arme sur le squelette 15 os
    expect(HERO_BONE_ORDER.length).toBe(15);
    const poseWood = createHeroSkeletonPose();
    const poseSteel = createHeroSkeletonPose();
    const poseStaff = createHeroSkeletonPose();
    const poseDragon = createHeroSkeletonPose();
    // Compare la phase clé (frame 5/15) où estoc, taille, balayage arcanique et fendoir draconique divergent nettement
    solveHeroBoneTransformsInto(poseWood, 'attack', 5, 15, {
      weaponId: 'sword_wood',
      comboStep: 0,
    });
    solveHeroBoneTransformsInto(poseSteel, 'attack', 5, 15, {
      weaponId: 'sword_steel',
      comboStep: 0,
    });
    solveHeroBoneTransformsInto(poseStaff, 'attack', 5, 15, {
      weaponId: 'staff_arcane',
      comboStep: 0,
    });
    solveHeroBoneTransformsInto(poseDragon, 'attack', 5, 15, {
      weaponId: 'blade_dragon',
      comboStep: 0,
    });
    expect(poseSteel.rightShoulder.x).toBeGreaterThan(poseDragon.rightShoulder.x + 0.05);
    expect(
      Math.abs(poseSteel.rightShoulder.rotZ - poseWood.rightShoulder.rotZ),
    ).toBeGreaterThan(0.15);
    expect(
      Math.abs(poseDragon.rightShoulder.rotZ - poseStaff.rightShoulder.rotZ),
    ).toBeGreaterThan(0.25);
  });

  it('cible Chute d’Étoiles (meteor_paw) sur le curseur (<= 12u), verrouille la zone et retombe sur aimAngle sans curseur', () => {
    const engine = startPlayingEngine();
    engine.state.player.x = 0;
    engine.state.player.z = 22;
    engine.state.player.mp = engine.state.player.maxMp;
    engine.state.player.aimAngle = 0;

    // 1. Curseur très loin (x=40, z=22 -> 40u) doit être clampé à <= 12u
    engine.step(
      0.016,
      createIdleInput({
        aimWorldPos: { x: 40, z: 22 },
        usingPointerAim: true,
        castSpell: 'meteor_paw',
      }),
    );
    const meteor = engine.state.activeSpellEffects.find((s) => s.spellId === 'meteor_paw');
    expect(meteor).toBeDefined();
    expect(meteor!.duration).toBeGreaterThanOrEqual(2.0);
    expect(meteor!.x).toBeCloseTo(12, 1);
    expect(meteor!.z).toBeCloseTo(22, 1);

    const lockedX = meteor!.x;
    const lockedZ = meteor!.z;

    // Déplace fortement le joueur et tourne le curseur : la zone verrouillée ne doit PAS bouger
    engine.step(
      0.35,
      createIdleInput({
        moveX: -1,
        aimWorldPos: { x: -30, z: 5 },
        usingPointerAim: true,
      }),
    );
    const stillMeteor = engine.state.activeSpellEffects.find(
      (s) => s.spellId === 'meteor_paw',
    );
    expect(stillMeteor).toBeDefined();
    expect(stillMeteor!.x).toBeCloseTo(lockedX, 3);
    expect(stillMeteor!.z).toBeCloseTo(lockedZ, 3);

    // 2. Repli propre sans coordonnées curseur (clavier pur -> devant le joueur selon aimAngle)
    engine.state.activeSpellEffects = [];
    engine.state.player.spellCooldowns.meteor_paw = 0;
    engine.state.player.mp = engine.state.player.maxMp;
    engine.state.player.x = 2;
    engine.state.player.z = 24;
    engine.state.player.aimAngle = Math.PI * 0.5; // vers +Z
    engine.step(
      0.016,
      createIdleInput({
        aimWorldPos: null,
        usingPointerAim: false,
        castSpell: 'meteor_paw',
      }),
    );
    const fallbackMeteor = engine.state.activeSpellEffects.find(
      (s) => s.spellId === 'meteor_paw',
    );
    expect(fallbackMeteor).toBeDefined();
    expect(fallbackMeteor!.x).toBeCloseTo(2, 1);
    expect(fallbackMeteor!.z).toBeGreaterThan(24 + 3);
    expect(SPELLS.meteor_paw.castRange).toBe(12);
  });

  it('diversifie les motifs d’attaque du Roi des Rats et du Dragon-Griffe', () => {
    // Roi des Rats dans la Grotte des Souris-Fantômes
    const ratEngine = startPlayingEngine();
    ratEngine.loadZone('dungeon_ghost_cave', { x: 0, z: -12 }, true);
    const ratBoss = ratEngine.state.enemies.find((e) => e.typeId === 'boss_rat_king');
    expect(ratBoss).toBeDefined();
    ratBoss!.aggroed = true;
    const ratPatterns = new Set<string>();
    for (let i = 0; i < 650; i++) {
      ratEngine.state.player.hp = ratEngine.state.player.maxHp;
      ratEngine.state.player.x = ratBoss!.x + 3.5;
      ratEngine.state.player.z = ratBoss!.z + 2.5;
      ratEngine.step(0.05, createIdleInput());
      for (const tg of ratEngine.state.telegraphs) {
        if (tg.patternId) ratPatterns.add(tg.patternId);
      }
      if (ratPatterns.size >= 3) break;
    }
    expect(ratPatterns.size).toBeGreaterThanOrEqual(3);

    // Dragon-Griffe dans l'Antre du Dragon
    const dragonEngine = startPlayingEngine();
    dragonEngine.loadZone('dungeon_dragon_lair', { x: 0, z: -16 }, true);
    const dragonBoss = dragonEngine.state.enemies.find(
      (e) => e.typeId === 'boss_dragon_claw',
    );
    expect(dragonBoss).toBeDefined();
    dragonBoss!.aggroed = true;
    const dragonPatterns = new Set<string>();
    for (let i = 0; i < 650; i++) {
      dragonEngine.state.player.hp = dragonEngine.state.player.maxHp;
      dragonEngine.state.player.x = dragonBoss!.x + 4.5;
      dragonEngine.state.player.z = dragonBoss!.z + 3.0;
      dragonEngine.step(0.05, createIdleInput());
      for (const tg of dragonEngine.state.telegraphs) {
        if (tg.patternId) dragonPatterns.add(tg.patternId);
      }
      if (dragonPatterns.size >= 3) break;
    }
    expect(dragonPatterns.size).toBeGreaterThanOrEqual(3);
  });

  it('rapproche automatiquement le héros sur interaction [E] et annule proprement sur déplacement manuel', () => {
    const engine = startPlayingEngine();
    const chest = engine.state.chests.find((c) => !c.opened);
    expect(chest).toBeDefined();
    // Place le joueur dans le rayon de détection mais au-delà de la distance de contact immédiat
    engine.state.player.x = chest!.x - 2.3;
    engine.state.player.z = chest!.z;
    engine.step(0.016, createIdleInput());
    expect(engine.state.nearestInteractable?.chestId).toBe(chest!.id);

    // Lance l'interaction -> doit enclencher l'auto-approche vers le coffre
    engine.step(0.016, createIdleInput({ interactPressed: true }));
    expect(engine.state.pendingInteraction).not.toBeNull();
    const startX = engine.state.player.x;
    engine.step(0.12, createIdleInput());
    expect(engine.state.player.x).toBeGreaterThan(startX);

    // Un déplacement manuel annule proprement l'auto-approche
    engine.step(0.05, createIdleInput({ moveX: -1 }));
    expect(engine.state.pendingInteraction).toBeNull();
  });

  it('ouvre les coffres lentement (~1.35s) et n’octroie le butin qu’une seule fois à la fin', () => {
    const engine = startPlayingEngine();
    const chest = engine.state.chests.find((c) => !c.opened);
    expect(chest).toBeDefined();
    engine.state.player.x = chest!.x - 0.9;
    engine.state.player.z = chest!.z;
    const goldBefore = engine.state.player.gold;

    engine.step(0.016, createIdleInput());
    engine.step(0.016, createIdleInput({ interactPressed: true }));
    expect(engine.state.openingChest).not.toBeNull();
    expect(chest!.opened).toBe(false);
    expect(engine.state.player.gold).toBe(goldBefore);

    // Mi-parcours + tentative de double interaction : toujours pas de récompense
    for (let i = 0; i < 12; i++) {
      engine.step(0.05, createIdleInput({ interactPressed: i === 5 }));
    }
    expect(chest!.opened).toBe(false);
    expect(engine.state.player.gold).toBe(goldBefore);

    // Complète l'animation (~1.35s)
    for (let i = 0; i < 20; i++) {
      engine.step(0.05, createIdleInput());
    }
    expect(CHEST_OPEN_DURATION).toBeCloseTo(1.35, 2);
    expect(chest!.opened).toBe(true);
    expect(engine.state.openingChest).toBeNull();
    const goldAfterFirst = engine.state.player.gold;
    expect(goldAfterFirst).toBeGreaterThan(goldBefore);

    // Nouvelle interaction sur le coffre déjà ouvert : zéro double-récompense
    engine.step(0.05, createIdleInput({ interactPressed: true }));
    expect(engine.state.player.gold).toBe(goldAfterFirst);
  });

  it('anime l’entrée et la sortie des portails de donjon avec portalTransition', () => {
    const engine = startPlayingEngine();
    // Place le héros devant le portail réel de la Grotte des Souris-Fantômes
    const ghostPortal = engine.state.interactables.find(
      (i) => i.type === 'dungeon_entrance' && i.targetZoneId === 'dungeon_ghost_cave',
    );
    expect(ghostPortal).toBeDefined();
    engine.state.player.x = ghostPortal!.x;
    engine.state.player.z = ghostPortal!.z + 0.9;
    engine.step(0.016, createIdleInput());
    engine.step(0.016, createIdleInput({ interactPressed: true }));

    expect(engine.state.portalTransition).not.toBeNull();
    expect(engine.state.portalTransition?.phase).toBe('entering');

    // Avance jusqu'à la bascule en donjon puis sortie du portail (transition cinématique 1.8 s)
    let sawExiting = false;
    for (let i = 0; i < 48; i++) {
      engine.step(0.04, createIdleInput());
      if (engine.state.portalTransition?.phase === 'exiting') {
        sawExiting = true;
      }
    }
    expect(engine.state.zoneId).toBe('dungeon_ghost_cave');
    expect(sawExiting).toBe(true);
    expect(engine.state.portalTransition).toBeNull();
  });

  it('joue la séquence de mort du héros (~2.0s) avant la défaite et préserve la progression au réveil à l’auberge', () => {
    const engine = startPlayingEngine();
    engine.state.player.gold = 145;
    engine.state.player.xp = 35;
    engine.state.player.hp = 1;
    engine.state.player.invulnTimer = 0;

    // Place un ennemi proche pour infliger un coup fatal via telegraph
    const enemy = engine.state.enemies.find((e) => e.state !== 'dead');
    expect(enemy).toBeDefined();
    engine.state.player.x = enemy!.x;
    engine.state.player.z = enemy!.z;
    engine.state.telegraphs.push({
      id: 'fatal_test_tg',
      ownerId: enemy!.id,
      shape: 'circle',
      x: engine.state.player.x,
      z: engine.state.player.z,
      radius: 3,
      angle: 0,
      arcAngle: Math.PI * 2,
      elapsed: 0.99,
      duration: 1.0,
      damage: 500,
      resolved: false,
    });

    engine.step(0.05, createIdleInput());
    const events = engine.consumeEvents();
    expect(events.some((e) => e.type === 'hero_death_start')).toBe(true);
    expect(engine.state.deathSequence).not.toBeNull();
    expect(engine.state.screen).toBe('playing'); // reste en jeu pendant la mise en scène de mort

    // Avance pendant 1.0s : toujours en cours d'animation de mort
    for (let i = 0; i < 20; i++) {
      engine.step(0.05, createIdleInput());
    }
    expect(engine.state.deathSequence).not.toBeNull();
    expect(engine.state.screen).toBe('playing');

    // Complète les ~2.0s -> bascule vers 'defeat'
    for (let i = 0; i < 25; i++) {
      engine.step(0.05, createIdleInput());
    }
    expect(HERO_DEATH_DURATION).toBeCloseTo(2.0, 1);
    expect(engine.state.screen).toBe('defeat');
    expect(engine.state.deathSequence?.completed).toBe(true);

    // Réveil à l'auberge : PV/PM restaurés, or & XP conservés
    engine.respawnAtInn();
    expect(engine.state.screen).toBe('playing');
    expect(engine.state.deathSequence).toBeNull();
    expect(engine.state.player.hp).toBe(engine.state.player.maxHp);
    expect(engine.state.player.gold).toBe(145);
    expect(engine.state.player.xp).toBe(35);
  });

  it('maintient la lanterne fixée à la ceinture, masquée en plein jour et à allumage progressif (~2s) dans l’obscurité', () => {
    const state = createHeroBeltLanternState();

    // 1. Plein jour clair : invisible et éteinte
    stepHeroBeltLantern(
      state,
      { lanternBoost: 0, inDungeon: false, vx: 0, vz: 0, facingSign: 1 },
      0.05,
    );
    expect(state.socket).toBe('belt');
    expect(state.visible).toBe(false);
    expect(state.lightLevel).toBe(0);
    expect(state.effectiveIntensity).toBe(0);

    // 2. Entrée dans un lieu sombre : se déploie à la ceinture ÉTEINTE puis s'allume sur ~2s
    stepHeroBeltLantern(
      state,
      { lanternBoost: 0.9, inDungeon: false, vx: 0, vz: 0, facingSign: 1 },
      0.04,
    );
    expect(state.socket).toBe('belt');
    expect(state.visible).toBe(true);
    expect(state.lightLevel).toBe(0);

    // À mi-allumage (~1.1s au total : ~0.15s déploiement + ~1.0s allumage)
    for (let i = 0; i < 23; i++) {
      stepHeroBeltLantern(
        state,
        { lanternBoost: 0.9, inDungeon: false, vx: 0, vz: 0, facingSign: 1 },
        0.05,
      );
    }
    expect(state.lightLevel).toBeGreaterThan(0.35);
    expect(state.lightLevel).toBeLessThan(0.75);

    // Après ~2.4s : pleinement allumée
    for (let i = 0; i < 28; i++) {
      stepHeroBeltLantern(
        state,
        { lanternBoost: 0.9, inDungeon: false, vx: 0, vz: 0, facingSign: 1 },
        0.05,
      );
    }
    expect(BELT_LANTERN_IGNITE_DURATION).toBeCloseTo(2.0, 1);
    expect(state.lightLevel).toBeCloseTo(1, 2);
    expect(state.effectiveIntensity).toBeGreaterThan(0.75);

    // 3. Retour à la lumière du jour : s'éteint, se range et redevient invisible
    for (let i = 0; i < 25; i++) {
      stepHeroBeltLantern(
        state,
        { lanternBoost: 0, inDungeon: false, vx: 0, vz: 0, facingSign: 1 },
        0.05,
      );
    }
    expect(state.visible).toBe(false);
    expect(state.lightLevel).toBe(0);
  });

  it('assombrit nettement les tempêtes tout en préservant la lisibilité nocturne', () => {
    const clearCtrl = new WeatherCycleController();
    clearCtrl.applyQaOverride({ condition: 'clear', timeOfDay: 0.45 });
    const clearDay = clearCtrl.getSnapshot();

    const stormCtrl = new WeatherCycleController();
    stormCtrl.applyQaOverride({ condition: 'storm', timeOfDay: 0.45 });
    const stormDay = stormCtrl.getSnapshot();

    const nightCtrl = new WeatherCycleController();
    nightCtrl.applyQaOverride({ condition: 'clear', timeOfDay: 0.02 });
    const clearNight = nightCtrl.getSnapshot();

    expect(stormDay.dirLightIntensity).toBeLessThan(clearDay.dirLightIntensity * 0.48);
    expect(stormDay.ambientIntensity).toBeLessThan(clearDay.ambientIntensity * 0.65);
    expect(stormDay.hemiIntensity).toBeLessThan(clearDay.hemiIntensity * 0.6);
    expect(stormDay.lanternBoost).toBeGreaterThan(0.5);

    // Compatibilité nuit claire
    expect(clearNight.ambientIntensity).toBeGreaterThanOrEqual(0.3);
    expect(clearNight.dirLightIntensity).toBeGreaterThanOrEqual(0.65);
  });

  it('coupe strictement les oiseaux par tempête, nuit, donjon ou mer ouverte et choisit les 6 thèmes musicaux', () => {
    const dayFair = computeWeatherMix({
      inOverworld: true,
      stormIntensity: 0,
      fogIntensity: 0,
      rainIntensity: 0,
      windIntensity: 0.15,
      seaAgitation: 0.25,
      seaProximity: 0.4,
      shipSpeedRatio: 0,
      nightFactor: 0,
      isSailing: false,
      inCombat: false,
    });
    expect(dayFair.birdsGain).toBeGreaterThan(0.05);

    const storm = computeWeatherMix({
      inOverworld: true,
      stormIntensity: 0.8,
      fogIntensity: 0.2,
      rainIntensity: 0.8,
      windIntensity: 0.9,
      seaAgitation: 0.9,
      seaProximity: 0.5,
      shipSpeedRatio: 0,
      nightFactor: 0,
      isSailing: false,
    });
    expect(storm.birdsGain).toBe(0);

    const night = computeWeatherMix({
      inOverworld: true,
      stormIntensity: 0,
      fogIntensity: 0,
      rainIntensity: 0,
      windIntensity: 0.15,
      seaAgitation: 0.25,
      seaProximity: 0.4,
      shipSpeedRatio: 0,
      nightFactor: 0.9,
      isSailing: false,
    });
    expect(night.birdsGain).toBe(0);

    const dungeon = computeWeatherMix({
      inOverworld: false,
      stormIntensity: 0,
      fogIntensity: 0,
      rainIntensity: 0,
      windIntensity: 0,
      seaAgitation: 0,
      seaProximity: 0,
      shipSpeedRatio: 0,
      nightFactor: 0,
      isSailing: false,
    });
    expect(dungeon.birdsGain).toBe(0);

    const openSea = computeWeatherMix({
      inOverworld: true,
      stormIntensity: 0,
      fogIntensity: 0,
      rainIntensity: 0,
      windIntensity: 0.3,
      seaAgitation: 0.5,
      seaProximity: 1.0,
      shipSpeedRatio: 0.6,
      nightFactor: 0,
      isSailing: true,
    });
    expect(openSea.birdsGain).toBe(0);

    // Vérifie les 6 thèmes musicaux via GameEngine
    const titleEngine = new GameEngine({ storage: null });
    expect(titleEngine.getCurrentMusicTrack()).toBe('menu');

    const engine = startPlayingEngine();
    expect(engine.getCurrentMusicTrack()).toBe('overworld');

    engine.state.ship.mode = 'sailing';
    engine.state.ship.isSailing = true;
    expect(engine.getCurrentMusicTrack()).toBe('maritime');

    engine.state.ship.mode = 'parked';
    engine.state.ship.isSailing = false;
    engine.state.combatMusicTimer = 4.0;
    expect(engine.getCurrentMusicTrack()).toBe('combat');

    engine.state.combatMusicTimer = 0;
    engine.state.inCombat = false;
    engine.loadZone('dungeon_ghost_cave', { x: 0, z: 12 }, true);
    expect(engine.getCurrentMusicTrack()).toBe('dungeon');

    const boss = engine.state.enemies.find((e) => e.isBoss);
    boss!.aggroed = true;
    engine.state.activeBossId = boss!.id;
    expect(engine.getCurrentMusicTrack()).toBe('boss');
  });

  it('calme l’animation des oreilles au repos et configure l’occlusion arrière des chapeaux', () => {
    const restEar = solveHeroEarPose(0.5, 'idle');
    expect(Math.abs(restEar.leftRotZ)).toBeLessThan(0.08);
    expect(Math.abs(restEar.rightRotZ)).toBeLessThan(0.08);

    const mageHat = getEquipmentCalibration('helm_mage');
    const knightHelm = getEquipmentCalibration('helm_knight');
    expect(mageHat?.helmetOcclusion?.backLayerAlpha).toBeGreaterThan(0.5);
    expect(mageHat?.helmetOcclusion?.earVisibility).toBeGreaterThan(0);
    expect(knightHelm?.helmetOcclusion?.backLayerAlpha).toBeGreaterThan(0.5);
  });
});
