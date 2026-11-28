import { describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/audioEngine';
import { AUDIO_SFX_GROUPS } from '../src/audio/audioManifest';
import { WEAPON_COMBAT_PROFILES, getWeaponCombatProfile } from '../src/data/equipmentData';
import { ENEMIES } from '../src/data/enemiesData';
import {
  MELEE_COMBO_STEPS,
  PERFECT_DODGE_DAMAGE_MULT,
  PERFECT_DODGE_MP_PCT,
  PERFECT_DODGE_SLOW_DURATION,
  PERFECT_DODGE_TIMESCALE,
  STAGGER_DAMAGE_MULT,
  STAGGER_DURATION_SEC,
  applyEnemyStagger,
  castSpell,
  executeDodgeRoll,
  executeMeleeAttack,
  updatePlayerProjectiles,
} from '../src/game/combat';
import {
  createEnemyInstance,
  updateEnemies,
  updateTelegraphs,
} from '../src/game/enemyAI';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import {
  addEquipment,
  createInitialPlayerState,
  equipItem,
} from '../src/game/progression';
import { createMemoryStorage } from '../src/game/saveSystem';
import {
  applyStatusEffect,
  getChillSlowFactor,
  getIncomingDamageMultiplier,
  getOutgoingDamageMultiplier,
  hasStatus,
  isEntityStunned,
  updateEnemyStatuses,
  updatePlayerStatuses,
} from '../src/game/statusEffects';
import type { GameEvent, PlayerProjectile, TelegraphZone } from '../src/game/types';

const neutralRng = () => 0.5;

describe('Phase 3 — Refactorisation combatProfile, Géométries & Projectiles', () => {
  it('unifie cooldown, knockback, hitstopSec et métadonnées d attaque pour les 13 armes', () => {
    const weaponIds = Object.keys(WEAPON_COMBAT_PROFILES);
    expect(weaponIds).toHaveLength(13);

    for (const weaponId of weaponIds) {
      const profile = getWeaponCombatProfile(weaponId);
      const player = createInitialPlayerState(0, 0);
      player.aimAngle = 0;
      addEquipment(player, weaponId);
      equipItem(player, weaponId);

      const dummy = createEnemyInstance({
        id: `e_${weaponId}`,
        typeId: 'boss_dragon_claw',
        x: 2.0,
        z: 0,
      });
      dummy.hp = 5000;
      dummy.maxHp = 5000;
      const events: GameEvent[] = [];
      const projectiles: PlayerProjectile[] = [];

      const res = executeMeleeAttack(player, [dummy], events, {
        rng: () => 0.0, // force crit pour vérifier hitstopSec calibré
        applyDash: () => {},
        projectiles,
      });

      expect(res.executed).toBe(true);
      expect(player.attackCooldown).toBeCloseTo(profile.attackCooldown, 4);
      expect(res.attackMeta).toBeDefined();
      expect(res.attackMeta?.weaponId).toBe(weaponId);
      expect(res.attackMeta?.attackShape).toBe(profile.attackShape);
      expect(res.attackMeta?.weaponFamily).toBe(profile.weaponFamily);
      expect(res.attackMeta?.activeSec).toBeCloseTo(profile.activeSec, 4);
      expect(res.attackMeta?.windupSec).toBeCloseTo(profile.windupSec, 4);

      const swingEv = events.find((e) => e.type === 'melee_swing');
      expect(swingEv).toBeDefined();
      expect(swingEv?.attackShape).toBe(profile.attackShape);
      expect(swingEv?.startAngle).toBeDefined();
      expect(swingEv?.endAngle).toBeDefined();
      expect(swingEv?.activeSec).toBeCloseTo(profile.activeSec, 4);
      expect(swingEv?.accentColor).toBe(profile.slashAccent);

      if (profile.attackShape === 'projectile') {
        expect(projectiles).toHaveLength(1);
        expect(res.spawnedProjectile?.speed).toBeCloseTo(profile.projectileSpeed ?? 18, 2);
      } else {
        expect(res.hitEnemies).toHaveLength(1);
        expect(res.hitstopSec).toBeCloseTo(profile.hitstopSec, 4);
      }
    }

    // Invariant historique : sword_wood step 0 reste à 0.24
    expect(getWeaponCombatProfile('sword_wood').attackCooldown).toBeCloseTo(
      MELEE_COMBO_STEPS[0].cooldown,
      4,
    );
  });

  it('applique thrust_line étroit pour les lances et cleave englobant au corps à corps', () => {
    const spearPlayer = createInitialPlayerState(0, 0);
    spearPlayer.aimAngle = 0; // +X
    addEquipment(spearPlayer, 'spear_fishbone');
    equipItem(spearPlayer, 'spear_fishbone');

    const longTarget = createEnemyInstance({ id: 'long', typeId: 'slime_yarn', x: 3.5, z: 0 });
    const wideSideTarget = createEnemyInstance({ id: 'side', typeId: 'slime_yarn', x: 1.5, z: 2.3 });
    wideSideTarget.radius = 0.2;

    const spearRes = executeMeleeAttack(spearPlayer, [longTarget, wideSideTarget], [], {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(spearRes.hitEnemies.map((e) => e.id)).toEqual(['long']);

    // halberd_royal finisher (step 2) balaye en large arc (135°)
    const halberdPlayer = createInitialPlayerState(0, 0);
    halberdPlayer.aimAngle = 0;
    halberdPlayer.comboStep = 2;
    addEquipment(halberdPlayer, 'halberd_royal');
    equipItem(halberdPlayer, 'halberd_royal');
    const flank = createEnemyInstance({ id: 'flank', typeId: 'slime_yarn', x: 1.6, z: 2.0 });
    const halberdFinisher = executeMeleeAttack(halberdPlayer, [flank], [], {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(halberdFinisher.hitEnemies.map((e) => e.id)).toEqual(['flank']);

    // cleave (axe_iron) touche un ennemi collé sur le flanc arrière immédiat
    const axePlayer = createInitialPlayerState(0, 0);
    axePlayer.aimAngle = 0;
    addEquipment(axePlayer, 'axe_iron');
    equipItem(axePlayer, 'axe_iron');
    const hugging = createEnemyInstance({ id: 'hug', typeId: 'slime_yarn', x: -0.4, z: 0.4 });
    const axeRes = executeMeleeAttack(axePlayer, [hugging], [], {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(axeRes.hitEnemies.map((e) => e.id)).toEqual(['hug']);
  });

  it('gère les PlayerProjectiles de staff et bow_crossbow y compris collisions murs/obstacles', () => {
    const engine = new GameEngine({ storage: createMemoryStorage(), rng: neutralRng });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    engine.loadZone('dungeon_ghost_cave', { x: 0, z: 0 }, false);
    const p = engine.state.player;
    addEquipment(p, 'staff_arcane');
    equipItem(p, 'staff_arcane');
    p.aimAngle = Math.PI; // -X vers mur gauche (-13)

    const input = createEmptyInputState();
    input.attackPressed = true;
    engine.step(1 / 60, input);
    expect(engine.state.playerProjectiles).toHaveLength(1);

    // Le projectile se détruit contre un mur ou atteint sa portée max sans rester bloqué
    for (let i = 0; i < 40; i++) {
      engine.step(0.025, createEmptyInputState());
    }
    expect(engine.state.playerProjectiles).toHaveLength(0);

    // Test direct collision obstacle & portée
    const p2 = createInitialPlayerState(0, 0);
    p2.aimAngle = 0;
    addEquipment(p2, 'crossbow_storm');
    equipItem(p2, 'crossbow_storm');
    const projs: PlayerProjectile[] = [];
    const events: GameEvent[] = [];
    executeMeleeAttack(p2, [], events, {
      rng: neutralRng,
      applyDash: () => {},
      projectiles: projs,
    });
    expect(projs).toHaveLength(1);
    updatePlayerProjectiles(projs, [], p2, events, {
      dt: 0.05,
      isObstacleHit: (x) => x > 0.8,
    });
    expect(projs).toHaveLength(0);
  });
});

describe('Phase 3 — Statuts (7), Procs Boss 100 % & Contre-jeu actif', () => {
  it('supporte les 7 statuts (burn, chill, poison, bleed, stun, shock, curse) avec effets distincts', () => {
    const enemy = createEnemyInstance({ id: 't1', typeId: 'frost_golem', x: 0, z: 0 });
    enemy.hp = 500;
    enemy.maxHp = 500;
    const events: GameEvent[] = [];

    expect(applyStatusEffect(enemy, { statusId: 'burn', chance: 1, durationSec: 2.0, potency: 6 }, events)).toBe(true);
    expect(applyStatusEffect(enemy, { statusId: 'poison', chance: 1, durationSec: 2.0, potency: 5 }, events)).toBe(true);
    expect(applyStatusEffect(enemy, { statusId: 'bleed', chance: 1, durationSec: 2.0, potency: 4 }, events)).toBe(true);
    expect(applyStatusEffect(enemy, { statusId: 'chill', chance: 1, durationSec: 2.0, potency: 0.35 }, events)).toBe(true);
    expect(applyStatusEffect(enemy, { statusId: 'stun', chance: 1, durationSec: 1.0, potency: 1 }, events)).toBe(true);
    expect(applyStatusEffect(enemy, { statusId: 'shock', chance: 1, durationSec: 2.0, potency: 1 }, events)).toBe(true);
    expect(applyStatusEffect(enemy, { statusId: 'curse', chance: 1, durationSec: 2.0, potency: 1 }, events)).toBe(true);

    expect(hasStatus(enemy, 'burn')).toBe(true);
    expect(getChillSlowFactor(enemy)).toBeCloseTo(0.35);
    expect(isEntityStunned(enemy)).toBe(true);
    expect(getIncomingDamageMultiplier(enemy)).toBeCloseTo(1.15 * 1.15, 3);
    expect(getOutgoingDamageMultiplier(enemy)).toBeCloseTo(0.8, 3);

    // Tick DoT (burn 0.75s, bleed 0.8s, poison 0.85s)
    enemy.vx = 2.0; // bleed bonus +35% en mouvement
    updateEnemyStatuses([enemy], 0.9, events);
    expect(enemy.hp).toBeLessThan(500);
    expect(events.filter((e) => e.type === 'status_tick').length).toBe(3);

    // Stun empêche le déplacement dans updateEnemies
    const startX = enemy.x;
    const player = createInitialPlayerState(5, 0);
    updateEnemies([enemy], player, [], 'dungeon_ghost_cave', 0.25, events);
    expect(enemy.x).toBe(startX);
  });

  it('applique les procs 100 % sur attaques spéciales rares de boss/mini-boss', () => {
    const player = createInitialPlayerState(0, 0);
    player.maxHp = 500;
    player.hp = 500;

    // 1. Golem de Givre frost_ring -> chill 100%
    // 2. Roi Rat-Spectre rat_miasma_ring -> curse 100%
    // 3. Drak-Miaou dragon_seismic_ring -> burn 100%
    const frostPattern = ENEMIES.frost_golem.patterns.find((p) => p.id === 'frost_ring')!;
    const ratPattern = ENEMIES.boss_rat_king.patterns.find((p) => p.id === 'rat_miasma_ring')!;
    const dragonPattern = ENEMIES.boss_dragon_claw.patterns.find((p) => p.id === 'dragon_seismic_ring')!;

    expect(frostPattern.statusProc?.chance).toBe(1.0);
    expect(frostPattern.statusProc?.statusId).toBe('chill');
    expect(ratPattern.statusProc?.chance).toBe(1.0);
    expect(ratPattern.statusProc?.statusId).toBe('curse');
    expect(dragonPattern.statusProc?.chance).toBe(1.0);
    expect(dragonPattern.statusProc?.statusId).toBe('burn');

    const telegraphs: TelegraphZone[] = [
      {
        id: 't_frost',
        ownerId: 'g1',
        shape: 'ring',
        x: 0,
        z: 0,
        angle: 0,
        innerRadius: 1,
        radius: 5,
        elapsed: 0.9,
        duration: 1.0,
        damage: 10,
        resolved: false,
        statusProc: frostPattern.statusProc,
      },
      {
        id: 't_rat',
        ownerId: 'r1',
        shape: 'ring',
        x: 0,
        z: 0,
        angle: 0,
        innerRadius: 1,
        radius: 5,
        elapsed: 0.9,
        duration: 1.0,
        damage: 10,
        resolved: false,
        statusProc: ratPattern.statusProc,
      },
      {
        id: 't_dragon',
        ownerId: 'd1',
        shape: 'ring',
        x: 0,
        z: 0,
        angle: 0,
        innerRadius: 1,
        radius: 5,
        elapsed: 0.9,
        duration: 1.0,
        damage: 10,
        resolved: false,
        statusProc: dragonPattern.statusProc,
      },
    ];

    const events: GameEvent[] = [];
    player.x = 2.5;
    player.z = 0;
    // Résout chacun séparément (i-frames post-hit après le 1er)
    updateTelegraphs([telegraphs[0]], [], player, 0.2, events);
    expect(hasStatus(player, 'chill')).toBe(true);

    player.invulnTimer = 0;
    updateTelegraphs([telegraphs[1]], [], player, 0.2, events);
    expect(hasStatus(player, 'curse')).toBe(true);

    player.invulnTimer = 0;
    updateTelegraphs([telegraphs[2]], [], player, 0.2, events);
    expect(hasStatus(player, 'burn')).toBe(true);
  });

  it('réduit/éteint burn par roulade et purge tous les débuffs via Soin-velours', () => {
    const player = createInitialPlayerState(0, 0);
    const events: GameEvent[] = [];

    applyStatusEffect(player, { statusId: 'burn', chance: 1, durationSec: 3.0, potency: 6 }, events);
    expect(hasStatus(player, 'burn')).toBe(true);

    // 1re roulade : réduit nettement (3.0 -> 1.05s)
    expect(executeDodgeRoll(player, 1, 0, events)).toBe(true);
    const burnAfterFirst = player.activeStatuses?.find((s) => s.id === 'burn');
    expect(burnAfterFirst?.remainingSec).toBeCloseTo(1.05, 2);

    // 2e roulade : éteint complètement une brûlure de 3.0s
    player.dodgeTimer = 0;
    player.dodgeCooldown = 0;
    expect(executeDodgeRoll(player, 1, 0, events)).toBe(true);
    expect(hasStatus(player, 'burn')).toBe(false);

    // Soin-velours purge immédiatement poison, curse et burn
    applyStatusEffect(player, { statusId: 'poison', chance: 1, durationSec: 4.0, potency: 4 }, events);
    applyStatusEffect(player, { statusId: 'curse', chance: 1, durationSec: 5.0, potency: 1 }, events);
    applyStatusEffect(player, { statusId: 'burn', chance: 1, durationSec: 4.0, potency: 6 }, events);
    expect(player.activeStatuses?.length).toBe(3);

    const healRes = castSpell(player, 'healing_paw', [], events);
    expect(healRes.cast).toBe(true);
    expect(player.activeStatuses).toHaveLength(0);
    expect(events.some((e) => e.type === 'status_purged')).toBe(true);

    // Aucun tick résiduel après purge
    const hpAfterPurge = player.hp;
    updatePlayerStatuses(player, 2.0, events);
    expect(player.hp).toBe(hpAfterPurge);
  });
});

describe('Phase 3 — Esquive Parfaite (perfect_dodge) & Stagger Boss/Golem', () => {
  it('déclenche perfect_dodge dans les 0.18s avant impact, timeScale=0.3 pendant 0.22s, +15% PM et +35% dégâts', () => {
    const engine = new GameEngine({ storage: createMemoryStorage(), rng: neutralRng });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();
    engine.consumeEvents();

    const p = engine.state.player;
    p.x = 0;
    p.z = 0;
    p.mp = 20;
    const expectedMpGain = Math.round(p.maxMp * PERFECT_DODGE_MP_PCT);

    // Place un télégraphe imminent à 0.10 s de l'impact sur le héros
    engine.state.telegraphs.push({
      id: 'tg_imminent',
      ownerId: 'enemy_1',
      shape: 'circle',
      x: 0,
      z: 0,
      angle: 0,
      radius: 2.5,
      elapsed: 0.9,
      duration: 1.0,
      damage: 20,
      resolved: false,
    });

    const dodgeInput = createEmptyInputState();
    dodgeInput.dodgePressed = true;
    dodgeInput.moveX = 1;
    engine.step(0.01, dodgeInput);

    const events = engine.consumeEvents();
    expect(events.some((e) => e.type === 'perfect_dodge')).toBe(true);
    expect(engine.state.timeScale).toBeCloseTo(PERFECT_DODGE_TIMESCALE, 3);
    expect(engine.state.perfectDodgeTimer).toBeCloseTo(PERFECT_DODGE_SLOW_DURATION, 2);
    expect(p.mp).toBe(20 + expectedMpGain);
    expect(p.perfectDodgeBuffTimer).toBeGreaterThan(2.5);

    // Récupère proprement vers timeScale = 1.0 après 0.22s en temps réel non ralenti
    for (let i = 0; i < 6; i++) {
      engine.step(0.04, createEmptyInputState());
    }
    expect(engine.state.perfectDodgeTimer).toBe(0);
    expect(engine.state.timeScale).toBe(1);

    // Vérifie le bonus +35% sur la prochaine attaque mêlée
    p.dodgeTimer = 0;
    p.attackCooldown = 0;
    p.aimAngle = 0;
    const dummy = createEnemyInstance({ id: 'pd_dummy', typeId: 'slime_yarn', x: p.x + 1.5, z: p.z });
    dummy.hp = 500;
    dummy.maxHp = 500;
    const buffedRes = executeMeleeAttack(p, [dummy], [], { rng: neutralRng, applyDash: () => {} });
    const baseExpected = Math.round(p.stats.atk * 1.0);
    const buffedExpected = Math.round(p.stats.atk * PERFECT_DODGE_DAMAGE_MULT);
    expect(buffedRes.hitEnemies).toHaveLength(1);
    expect(500 - dummy.hp).toBe(buffedExpected);
    expect(buffedExpected).toBeGreaterThan(baseExpected);
    expect(p.perfectDodgeBuffTimer).toBe(0);
  });

  it('brise la posture de frost_golem, boss_rat_king et boss_dragon_claw (2.2s, annule télégraphes, +40% dégâts)', () => {
    for (const bossType of ['frost_golem', 'boss_rat_king', 'boss_dragon_claw'] as const) {
      const target = createEnemyInstance({ id: `s_${bossType}`, typeId: bossType, x: 2, z: 0 });
      expect(target.maxStagger).toBeGreaterThan(0);
      target.state = 'windup';
      target.stateTimer = 0.8;
      target.activePatternId = ENEMIES[bossType].patterns[0].id;

      const telegraphs: TelegraphZone[] = [
        {
          id: `tg_${bossType}`,
          ownerId: target.id,
          shape: 'circle',
          x: 2,
          z: 0,
          angle: 0,
          radius: 4,
          elapsed: 0.3,
          duration: 1.0,
          damage: 25,
          resolved: false,
        },
      ];
      const events: GameEvent[] = [];

      const broke = applyEnemyStagger(target, target.maxStagger!, telegraphs, events);
      expect(broke).toBe(true);
      expect(target.state).toBe('staggered');
      expect(target.staggeredTimer).toBeCloseTo(STAGGER_DURATION_SEC, 2);
      expect(telegraphs).toHaveLength(0);
      expect(events.some((e) => e.type === 'stagger_break')).toBe(true);

      // Pendant 2.2s, l'ennemi ne peut pas attaquer
      const player = createInitialPlayerState(0, 0);
      updateEnemies([target], player, telegraphs, 'dungeon_ghost_cave', 0.5, events);
      expect(target.state).toBe('staggered');
      expect(telegraphs).toHaveLength(0);

      // Dégâts reçus +40% pendant stagger
      player.aimAngle = 0;
      target.x = 1.6;
      target.z = 0;
      const hpBefore = target.hp;
      executeMeleeAttack(player, [target], events, { rng: neutralRng, applyDash: () => {} });
      const expectedDmg = Math.round(player.stats.atk * STAGGER_DAMAGE_MULT);
      expect(hpBefore - target.hp).toBe(expectedDmg);
    }
  });
});

describe('Phase 3 — Butin physique magnétique, Signal PV bas (<20%), Audio & Isolation', () => {
  it('fait jaillir le butin en arc parabolique, rebondir puis aspirer vers le héros en déclenchant gold_pickup/xp_pickup', () => {
    const engine = new GameEngine({ storage: createMemoryStorage(), rng: neutralRng });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();
    engine.consumeEvents();

    const p = engine.state.player;
    const slime = engine.state.enemies.find((e) => e.typeId === 'slime_yarn')!;
    expect(slime).toBeDefined();
    p.x = slime.x - 1.4;
    p.z = slime.z;
    p.aimAngle = 0;
    slime.hp = 1;

    const goldBefore = p.gold;
    const xpBefore = p.xp;
    const def = ENEMIES.slime_yarn;

    const atk = createEmptyInputState();
    atk.attackPressed = true;
    engine.step(1 / 60, atk);
    expect(slime.state).toBe('dead');
    expect(engine.state.lootDrops.length).toBeGreaterThanOrEqual(4);
    expect(p.gold).toBe(goldBefore); // pas encore ramassé à t=0

    let sawBounce = false;
    let sawGoldPickup = false;
    let sawXpPickup = false;
    for (let i = 0; i < 120; i++) {
      engine.step(1 / 60, createEmptyInputState());
      for (const ev of engine.consumeEvents()) {
        if (ev.type === 'loot_bounce') sawBounce = true;
        if (ev.type === 'gold_pickup') sawGoldPickup = true;
        if (ev.type === 'xp_pickup') sawXpPickup = true;
      }
      if (engine.state.lootDrops.length === 0) break;
    }

    expect(sawBounce).toBe(true);
    expect(sawGoldPickup).toBe(true);
    expect(sawXpPickup).toBe(true);
    expect(engine.state.lootDrops).toHaveLength(0);
    expect(p.gold).toBe(goldBefore + def.goldReward);
    expect(p.xp).toBe(xpBefore + def.xpReward);
  });

  it('auto-récupère le butin physique restant lors d un changement de zone vivant', () => {
    const engine = new GameEngine({ storage: createMemoryStorage(), rng: neutralRng });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    const p = engine.state.player;
    const slime = engine.state.enemies.find((e) => e.typeId === 'slime_yarn')!;
    p.x = slime.x - 1.4;
    p.z = slime.z;
    p.aimAngle = 0;
    slime.hp = 1;

    const goldBefore = p.gold;
    const atk = createEmptyInputState();
    atk.attackPressed = true;
    engine.step(1 / 60, atk);
    expect(engine.state.lootDrops.length).toBeGreaterThan(0);

    engine.loadZone('dungeon_ghost_cave', { x: 0, z: 12 }, true);
    expect(engine.state.lootDrops).toHaveLength(0);
    expect(p.gold).toBe(goldBefore + ENEMIES.slime_yarn.goldReward);
  });

  it('expose lowHpActive/lowHpIntensity (<20%) et route tous les événements Phase 3 vers AudioEngine (107 groupes intacts)', () => {
    expect(Object.keys(AUDIO_SFX_GROUPS)).toHaveLength(107);

    const sim = new GameEngine({ storage: createMemoryStorage(), rng: neutralRng });
    sim.startNewGame();
    while (sim.state.dialogue.active) sim.advanceDialogue();

    sim.step(0.05, createEmptyInputState());
    expect(sim.state.lowHpActive).toBe(false);
    expect(sim.state.lowHpIntensity).toBe(0);

    sim.state.player.hp = Math.floor(sim.state.player.maxHp * 0.12);
    sim.step(0.05, createEmptyInputState());
    expect(sim.state.lowHpActive).toBe(true);
    expect(sim.state.lowHpIntensity).toBeGreaterThan(0.3);

    const audio = new AudioEngine(createMemoryStorage());
    const playSpy = vi.spyOn(audio, 'playVariant');
    audio.handleEvents([
      { type: 'perfect_dodge', x: 0, z: 0 },
      { type: 'status_applied', x: 0, z: 0, statusId: 'burn' },
      { type: 'status_tick', x: 0, z: 0, statusId: 'poison', value: 4 },
      { type: 'status_purged', x: 0, z: 0 },
      { type: 'stagger_break', x: 0, z: 0 },
      { type: 'loot_bounce', x: 0, z: 0, lootKind: 'gold' },
    ]);

    const playedGroups = playSpy.mock.calls.map((c) => c[0]);
    expect(playedGroups).toEqual([
      'combat_perfect_dodge',
      'status_burn_apply',
      'status_poison_tick',
      'status_purge',
      'boss_stagger_break',
      'loot_item_drop',
    ]);
    audio.dispose();
  });
});

describe('Phase 3 — Régressions Remédiation (5 correctifs)', () => {
  it('1. ralentit le héros d environ 35 % dans GameEngine.step lorsqu il subit chill (potency 0.35)', () => {
    const baseSim = new GameEngine({ storage: createMemoryStorage(), rng: neutralRng });
    baseSim.startNewGame();
    while (baseSim.state.dialogue.active) baseSim.advanceDialogue();
    baseSim.state.player.x = 0;
    baseSim.state.player.z = 0;
    const moveInput = createEmptyInputState();
    moveInput.moveX = 1;
    baseSim.step(0.05, moveInput);
    const unchilledDist = baseSim.state.player.x;

    const chillSim = new GameEngine({ storage: createMemoryStorage(), rng: neutralRng });
    chillSim.startNewGame();
    while (chillSim.state.dialogue.active) chillSim.advanceDialogue();
    chillSim.state.player.x = 0;
    chillSim.state.player.z = 0;
    applyStatusEffect(
      chillSim.state.player,
      { statusId: 'chill', chance: 1.0, durationSec: 3.0, potency: 0.35 },
      [],
    );
    chillSim.step(0.05, moveInput);
    const chilledDist = chillSim.state.player.x;

    expect(unchilledDist).toBeGreaterThan(0.4);
    expect(chilledDist).toBeCloseTo(unchilledDist * 0.65, 4);
  });

  it('2. annule windup et lunge de thorn_wolf lors d un stun pour empêcher toute charge fantôme après expiration', () => {
    const wolf = createEnemyInstance({ id: 'w1', typeId: 'thorn_wolf', x: 0, z: 0 });
    wolf.state = 'chase';
    wolf.aggroed = true;
    wolf.attackCooldown = 0;
    const player = createInitialPlayerState(4, 0);
    const telegraphs: TelegraphZone[] = [];
    const events: GameEvent[] = [];

    // Déclenche le windup avec lungeOnImpact
    updateEnemies([wolf], player, telegraphs, 'overworld', 0.02, events);
    expect(wolf.state).toBe('windup');
    expect(wolf.activeLungeDist).toBeGreaterThan(0);
    expect(telegraphs).toHaveLength(1);

    // Applique stun pendant 0.4s en plein windup
    applyStatusEffect(wolf, { statusId: 'stun', chance: 1.0, durationSec: 0.4, potency: 1 }, events);
    const xAtStun = wolf.x;

    // Simule 1.8s : stun expire puis recover s achève sans jamais exécuter le lunge fantôme
    for (let i = 0; i < 36; i++) {
      updateEnemyStatuses([wolf], 0.05, events);
      updateEnemies([wolf], player, telegraphs, 'overworld', 0.05, events);
      updateTelegraphs(telegraphs, [wolf], player, 0.05, events);
      // Vérifie qu aucun télégraphe fantôme ni déplacement brusque de lunge (> 1.5 u en 1 step) ne survient
      expect(Math.abs(wolf.x - xAtStun)).toBeLessThan(3.5);
      if (wolf.state === 'chase') break;
    }

    expect(wolf.activeLungeAngle).toBeUndefined();
    expect(wolf.activeLungeDist).toBeUndefined();
    expect(wolf.activePatternId).toBeUndefined();
    expect(wolf.state).not.toBe('windup');
    expect(telegraphs).toHaveLength(0);
    expect(Math.abs(wolf.x - xAtStun)).toBeLessThan(0.01);
  });

  it('3. empêche le tunneling de crossbow_storm à dt=0.05 sur un slime_yarn à bout portant (x=0.60) et respecte les obstacles', () => {
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0;
    addEquipment(player, 'crossbow_storm');
    equipItem(player, 'crossbow_storm');

    const slime = createEnemyInstance({ id: 'pb_slime', typeId: 'slime_yarn', x: 0.6, z: 0 });
    const hpBefore = slime.hp;
    const projectiles: PlayerProjectile[] = [];
    const events: GameEvent[] = [];

    executeMeleeAttack(player, [slime], events, {
      rng: neutralRng,
      applyDash: () => {},
      projectiles,
    });
    expect(projectiles).toHaveLength(1);

    const res = updatePlayerProjectiles(projectiles, [slime], player, events, {
      dt: 0.05,
      rng: neutralRng,
    });
    expect(res.hitEnemies.map((e) => e.id)).toEqual(['pb_slime']);
    expect(slime.hp).toBeLessThan(hpBefore);
    expect(projectiles).toHaveLength(0);

    // Un ennemi derrière un mur/pilier fin ne doit pas être touché
    const blockedSlime = createEnemyInstance({ id: 'behind_wall', typeId: 'slime_yarn', x: 2.0, z: 0 });
    const wallProjs: PlayerProjectile[] = [];
    player.attackCooldown = 0;
    executeMeleeAttack(player, [blockedSlime], events, {
      rng: neutralRng,
      applyDash: () => {},
      projectiles: wallProjs,
    });
    const blockedRes = updatePlayerProjectiles(wallProjs, [blockedSlime], player, events, {
      dt: 0.05,
      rng: neutralRng,
      isObstacleHit: (x) => x >= 0.85 && x <= 1.05,
    });
    expect(blockedRes.hitEnemies).toHaveLength(0);
    expect(wallProjs).toHaveLength(0);
  });

  it('4. conserve perfectDodgeBuffTimer si un PlayerProjectile rate ou touche un mur, et le consomme uniquement sur un coup au but (+35 %)', () => {
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0;
    player.perfectDodgeBuffTimer = 2.8;
    addEquipment(player, 'crossbow_storm');
    equipItem(player, 'crossbow_storm');

    // Tir qui touche un mur -> le buff reste actif
    const missProjs: PlayerProjectile[] = [];
    executeMeleeAttack(player, [], [], {
      rng: neutralRng,
      applyDash: () => {},
      projectiles: missProjs,
    });
    expect(player.perfectDodgeBuffTimer).toBeCloseTo(2.8, 3);
    updatePlayerProjectiles(missProjs, [], player, [], {
      dt: 0.05,
      rng: neutralRng,
      isObstacleHit: (x) => x > 0.8,
    });
    expect(missProjs).toHaveLength(0);
    expect(player.perfectDodgeBuffTimer).toBeCloseTo(2.8, 3);

    // Deux projectiles en vol (même comboStep = 0) : seul le 1er impact reçoit +35 % et consomme le buff
    player.attackCooldown = 0;
    player.comboStep = 0;
    const hitProjs: PlayerProjectile[] = [];
    executeMeleeAttack(player, [], [], {
      rng: neutralRng,
      applyDash: () => {},
      projectiles: hitProjs,
    });
    player.attackCooldown = 0;
    player.comboStep = 0;
    executeMeleeAttack(player, [], [], {
      rng: neutralRng,
      applyDash: () => {},
      projectiles: hitProjs,
    });
    expect(hitProjs).toHaveLength(2);

    const e1 = createEnemyInstance({ id: 'pd_e1', typeId: 'slime_yarn', x: 1.0, z: 0 });
    const e2 = createEnemyInstance({ id: 'pd_e2', typeId: 'slime_yarn', x: 1.0, z: 0 });
    e1.hp = 500;
    e1.maxHp = 500;
    e2.hp = 500;
    e2.maxHp = 500;

    // 1er projectile touche e1 (+35 %), 2e projectile touche e2 (sans buff)
    updatePlayerProjectiles([hitProjs[0]], [e1], player, [], { dt: 0.05, rng: neutralRng });
    expect(player.perfectDodgeBuffTimer).toBe(0);
    updatePlayerProjectiles([hitProjs[1]], [e2], player, [], { dt: 0.05, rng: neutralRng });

    const dmg1 = 500 - e1.hp;
    const dmg2 = 500 - e2.hp;
    expect(dmg1).toBeGreaterThan(dmg2);
    expect(dmg1).toBe(Math.round(dmg2 * PERFECT_DODGE_DAMAGE_MULT));
  });

  it('5. éteint de façon fiable une brûlure (burn) de 3.5s en deux roulades d esquive', () => {
    const player = createInitialPlayerState(0, 0);
    const events: GameEvent[] = [];

    applyStatusEffect(
      player,
      { statusId: 'burn', chance: 1.0, durationSec: 3.5, potency: 6 },
      events,
    );
    expect(hasStatus(player, 'burn')).toBe(true);

    // 1re roulade : réduit fortement sans encore éteindre
    expect(executeDodgeRoll(player, 1, 0, events)).toBe(true);
    expect(hasStatus(player, 'burn')).toBe(true);

    // 2e roulade : éteint complètement burn et émet status_purged
    player.dodgeTimer = 0;
    player.dodgeCooldown = 0;
    events.length = 0;
    expect(executeDodgeRoll(player, 1, 0, events)).toBe(true);
    expect(hasStatus(player, 'burn')).toBe(false);
    expect(events.some((e) => e.type === 'status_purged' && e.statusId === 'burn')).toBe(true);
  });
});
