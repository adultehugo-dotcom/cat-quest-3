import { describe, expect, it } from 'vitest';
import { DUNGEON_GHOST_CAVE } from '../src/data/dungeonsData';
import { getEnemyDefinition } from '../src/data/enemiesData';
import { getSpellPower } from '../src/data/spellsData';
import { VILLAGE_SAFE_ZONE, isInsideVillage } from '../src/data/worldData';
import {
  DODGE_COOLDOWN,
  DODGE_DURATION,
  DODGE_IFRAMES,
  DODGE_SPEED,
  MELEE_AUTO_AIM_RADIUS,
  MELEE_COMBO_STEPS,
  POST_HIT_IFRAMES,
  applyDamageToPlayer,
  calculateEnemyDamage,
  calculatePlayerDamage,
  castSpell,
  executeDodgeRoll,
  executeMeleeAttack,
  findNearestAutoAimTarget,
  updatePlayerRegen,
} from '../src/game/combat';
import {
  OVERWORLD_RESPAWN_TIME,
  checkBossPhaseTransition,
  createEnemyInstance,
  selectAttackPattern,
  spawnTelegraphsForPattern,
  updateEnemies,
  updateTelegraphs,
  updateTraps,
} from '../src/game/enemyAI';
import { GameEngine } from '../src/game/gameEngine';
import {
  isPointInCircle,
  isPointInCone,
  isPointInLine,
  isPointInRing,
  isTargetInTelegraph,
} from '../src/game/math';
import { InputManager, createEmptyInputState } from '../src/game/input';
import { createInitialPlayerState } from '../src/game/progression';
import { createMemoryStorage } from '../src/game/saveSystem';
import type { GameEvent, TelegraphZone, TrapInstance } from '../src/game/types';

// RNG déterministe qui renvoie toujours 0.5 (variance = 1.0, pas de critique si critChance < 0.5)
const neutralRng = () => 0.5;
// RNG qui force un coup critique (variance = 0.92 + 0.05*0.16 ≈ 0.928, crit = true)
const critRng = () => 0.01;

describe('Combat — Combo mêlée 3 coups & Recharge Mana', () => {
  it('enchaîne 3 coups (1.0x / 1.15x / 1.5x), restaure +12/+12/+18 MP par ennemi touché et reset au bout du 3e', () => {
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0; // vers +X
    player.mp = 10;

    const slime = createEnemyInstance({
      id: 'test_slime',
      typeId: 'slime_yarn',
      x: 1.8,
      z: 0,
    });
    slime.hp = 500;
    slime.maxHp = 500;

    const events: GameEvent[] = [];

    // Coup 1 (1.0x ATK = 20, +12 MP)
    const hit1 = executeMeleeAttack(player, [slime], events, {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(hit1.executed).toBe(true);
    expect(hit1.comboStep).toBe(0);
    expect(hit1.hitEnemies).toHaveLength(1);
    expect(hit1.totalMpRestored).toBe(12);
    expect(player.mp).toBe(22);
    expect(player.comboStep).toBe(1);
    expect(player.attackCooldown).toBeCloseTo(MELEE_COMBO_STEPS[0].cooldown);
    const dmg1 = 500 - slime.hp;
    expect(dmg1).toBe(20);

    // Coup 2 (1.15x ATK = 23, +12 MP)
    player.attackCooldown = 0;
    const hpBefore2 = slime.hp;
    const hit2 = executeMeleeAttack(player, [slime], events, {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(hit2.comboStep).toBe(1);
    expect(hit2.totalMpRestored).toBe(12);
    expect(player.mp).toBe(34);
    expect(player.comboStep).toBe(2);
    expect(hpBefore2 - slime.hp).toBe(23);

    // Coup 3 Finisher (1.5x ATK = 30, +18 MP, arc 180°, hitstop)
    player.attackCooldown = 0;
    const hpBefore3 = slime.hp;
    const hit3 = executeMeleeAttack(player, [slime], events, {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(hit3.comboStep).toBe(2);
    expect(hit3.totalMpRestored).toBe(18);
    expect(hit3.triggeredHitstop).toBe(true);
    expect(player.mp).toBe(52);
    expect(player.comboStep).toBe(0);
    expect(hpBefore3 - slime.hp).toBe(30);
    expect(events.filter((e) => e.type === 'mp_gain')).toHaveLength(3);
  });

  it('multiplie le gain de MP par ennemi touché et plafonne à maxMp', () => {
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0;
    player.mp = player.maxMp - 20;

    const e1 = createEnemyInstance({ id: 'e1', typeId: 'slime_yarn', x: 1.5, z: -0.5 });
    const e2 = createEnemyInstance({ id: 'e2', typeId: 'slime_yarn', x: 1.5, z: 0.5 });
    const events: GameEvent[] = [];

    const res = executeMeleeAttack(player, [e1, e2], events, {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(res.hitEnemies).toHaveLength(2);
    expect(player.mp).toBe(player.maxMp);
    expect(res.totalMpRestored).toBe(20);
  });

  it("élargit l'arc à 180° sur le 3e coup (touche sur les flancs à 85° mais pas au coup 1)", () => {
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0; // +X
    // Ennemi à ~85° sur le flanc (juste hors 140° mais dans 180°)
    const flankEnemy = createEnemyInstance({
      id: 'flank',
      typeId: 'slime_yarn',
      x: 0.15,
      z: 2.2,
    });
    flankEnemy.radius = 0.05; // rayon fin pour tester l'angle exactement

    const res1 = executeMeleeAttack(player, [flankEnemy], [], {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(res1.hitEnemies).toHaveLength(0);

    player.attackCooldown = 0;
    player.comboStep = 2; // Finisher 180°
    const res3 = executeMeleeAttack(player, [flankEnemy], [], {
      rng: neutralRng,
      applyDash: () => {},
    });
    expect(res3.hitEnemies).toHaveLength(1);
  });

  it("oriente doucement aimAngle et facingX vers l'ennemi vivant le plus proche (<= 3.2 u) en auto-aim doux", () => {
    expect(MELEE_AUTO_AIM_RADIUS).toBeCloseTo(3.2);

    // 1. Ennemi sur axe perpendiculaire (+Z à 2.2 u) alors que le héros regarde à droite (+X)
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0;
    player.facingX = 1;
    player.mp = 20;

    const perpEnemy = createEnemyInstance({
      id: 'perp',
      typeId: 'slime_yarn',
      x: 0,
      z: 2.2,
    });
    perpEnemy.radius = 0.05;

    const deadClose = createEnemyInstance({
      id: 'dead_close',
      typeId: 'slime_yarn',
      x: -1.0,
      z: 0,
    });
    deadClose.hp = 0;
    deadClose.state = 'dead';

    const farEnemy = createEnemyInstance({
      id: 'far_enemy',
      typeId: 'slime_yarn',
      x: -3.6,
      z: 0,
    });

    const events: GameEvent[] = [];
    const resPerp = executeMeleeAttack(player, [deadClose, perpEnemy, farEnemy], events, {
      rng: neutralRng,
      applyDash: () => {},
      autoAim: true,
    });
    expect(resPerp.executed).toBe(true);
    expect(player.aimAngle).toBeCloseTo(Math.PI / 2, 4);
    expect(resPerp.hitEnemies.map((e) => e.id)).toEqual(['perp']);
    expect(resPerp.totalMpRestored).toBe(12);

    // 2. Choisit le plus proche parmi plusieurs vivants et retourne facingX vers -1 si l'ennemi est à gauche
    player.attackCooldown = 0;
    player.aimAngle = 0;
    player.facingX = 1;
    const leftCloser = createEnemyInstance({
      id: 'left_closer',
      typeId: 'slime_yarn',
      x: -1.8,
      z: 0.2,
    });
    const resLeft = executeMeleeAttack(player, [perpEnemy, leftCloser], events, {
      rng: neutralRng,
      applyDash: () => {},
      autoAim: true,
    });
    expect(player.aimAngle).toBeCloseTo(Math.atan2(0.2, -1.8), 4);
    expect(player.facingX).toBe(-1);
    expect(resLeft.hitEnemies.map((e) => e.id)).toContain('left_closer');

    // 3. Borne exacte du rayon 3.2 u sur diagonale -> détecté malgré l'arrondi flottant
    const exactBoundary = createEnemyInstance({
      id: 'exact_boundary',
      typeId: 'slime_yarn',
      x: MELEE_AUTO_AIM_RADIUS * Math.cos(0.7),
      z: MELEE_AUTO_AIM_RADIUS * Math.sin(0.7),
    });
    expect(findNearestAutoAimTarget(player, [exactBoundary])?.id).toBe(
      'exact_boundary',
    );

    // 4. Aucun ennemi dans le rayon 3.2 u -> conserve aimAngle et facingX inchangés
    player.attackCooldown = 0;
    player.aimAngle = 0;
    player.facingX = 1;
    expect(findNearestAutoAimTarget(player, [deadClose, farEnemy])).toBeNull();
    const resNone = executeMeleeAttack(player, [deadClose, farEnemy], events, {
      rng: neutralRng,
      applyDash: () => {},
      autoAim: true,
    });
    expect(player.aimAngle).toBe(0);
    expect(player.facingX).toBe(1);
    expect(resNone.hitEnemies).toHaveLength(0);
  });

  it("active l'auto-aim doux dans GameEngine au clavier/manette mais respecte la visée souris explicite", () => {
    const engine = new GameEngine({
      storage: createMemoryStorage(),
      rng: neutralRng,
    });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    const slime = createEnemyInstance({
      id: 'engine_perp_slime',
      typeId: 'slime_yarn',
      x: 20,
      z: 22.1,
    });
    slime.radius = 0.05;
    slime.hp = 200;
    slime.maxHp = 200;
    engine.state.enemies = [slime];
    engine.state.player.x = 20;
    engine.state.player.z = 20;
    engine.state.player.aimAngle = 0; // regarde vers +X, ennemi perpendiculaire en +Z (2.1 u)
    engine.state.player.facingX = 1;

    // Visée souris explicite vers +X (30, 20) -> PAS d'auto-aim, frappe dans la direction du curseur
    const mouseInput = createEmptyInputState();
    mouseInput.usingPointerAim = true;
    mouseInput.aimWorldPos = { x: 30, z: 20 };
    mouseInput.attackPressed = true;
    engine.step(0.016, mouseInput);
    expect(slime.hp).toBe(200);
    expect(engine.state.player.aimAngle).toBeCloseTo(0, 4);

    // Remet le héros à (20, 20), prêt à attaquer au clavier/manette (usingPointerAim = false)
    engine.state.player.x = 20;
    engine.state.player.z = 20;
    engine.state.player.aimAngle = 0;
    engine.state.player.attackCooldown = 0;
    engine.state.player.comboStep = 0;

    const kbInput = createEmptyInputState();
    kbInput.usingPointerAim = false;
    kbInput.attackPressed = true;
    engine.step(0.016, kbInput);

    // Auto-aim doux orienté vers le slime perpendiculaire -> touche garantie !
    expect(engine.state.player.aimAngle).toBeCloseTo(Math.PI / 2, 2);
    expect(slime.hp).toBeLessThan(200);

    // Maintien d'attaque clavier (attackHeld) sur le 2e coup du combo après cooldown -> conserve l'auto-aim
    engine.state.player.x = 20;
    engine.state.player.z = 20;
    engine.state.player.aimAngle = 0;
    engine.state.player.attackCooldown = 0;
    const hpBeforeHeld = slime.hp;
    const kbHeldInput = createEmptyInputState();
    kbHeldInput.usingPointerAim = false;
    kbHeldInput.attackHeld = true;
    engine.step(0.016, kbHeldInput);
    expect(engine.state.player.aimAngle).toBeCloseTo(Math.PI / 2, 2);
    expect(slime.hp).toBeLessThan(hpBeforeHeld);
  });
});

describe('Combat — Roulade d’esquive, i-frames & dodge-cancel', () => {
  it('déclenche i-frames 0.30s, durée 0.28s, cooldown 0.55s et annule le recovery mêlée (dodge-cancel)', () => {
    const player = createInitialPlayerState(0, 0);
    player.attackCooldown = 0.35;
    player.attackAnimTimer = 0.2;
    const events: GameEvent[] = [];

    const ok = executeDodgeRoll(player, 1, 0, events);
    expect(ok).toBe(true);
    expect(player.dodgeTimer).toBeCloseTo(DODGE_DURATION);
    expect(player.invulnTimer).toBeCloseTo(DODGE_IFRAMES);
    expect(player.dodgeCooldown).toBeCloseTo(DODGE_COOLDOWN);
    expect(DODGE_SPEED).toBe(19.0);
    // Dodge-cancel vérifié
    expect(player.attackCooldown).toBe(0);
    expect(player.attackAnimTimer).toBe(0);
    expect(events.some((e) => e.type === 'dodge_roll')).toBe(true);

    // Dégâts complètement bloqués pendant la roulade
    const hpBefore = player.hp;
    const hit = applyDamageToPlayer(player, 40, 2, 0, events);
    expect(hit.hit).toBe(false);
    expect(hit.blockedByInvuln).toBe(true);
    expect(player.hp).toBe(hpBefore);
  });

  it('applique la mitigation DEF et les i-frames post-coup hors roulade', () => {
    const player = createInitialPlayerState(0, 0);
    // DEF de départ = 4 (base) + 2 (bandana) + 3 (tunique) = 9
    expect(player.stats.def).toBe(9);
    const expectedDmg = Math.max(1, Math.round(30 * (100 / (100 + 9 * 2.2))));
    expect(calculateEnemyDamage(30, 9)).toBe(expectedDmg);

    const events: GameEvent[] = [];
    const hpBefore = player.hp;
    const first = applyDamageToPlayer(player, 30, 3, 0, events);
    expect(first.hit).toBe(true);
    expect(first.damage).toBe(expectedDmg);
    expect(player.hp).toBe(hpBefore - expectedDmg);
    expect(player.invulnTimer).toBeCloseTo(POST_HIT_IFRAMES);

    // Coup immédiat suivant bloqué par les i-frames post-coup
    const second = applyDamageToPlayer(player, 30, 3, 0, events);
    expect(second.hit).toBe(false);
    expect(second.blockedByInvuln).toBe(true);
  });

  it('calcule correctement les coups critiques x1.65', () => {
    const normal = calculatePlayerDamage(20, 0, neutralRng);
    expect(normal.isCrit).toBe(false);
    expect(normal.damage).toBe(20);

    const crit = calculatePlayerDamage(20, 1.0, critRng);
    expect(crit.isCrit).toBe(true);
    expect(crit.damage).toBeGreaterThanOrEqual(30);
  });
});

describe('Combat — Les 4 Sorts VF', () => {
  it('Flamme-ronron consomme 25 MP et touche les ennemis dans le rayon 4.2 u', () => {
    const player = createInitialPlayerState(0, 0);
    const near = createEnemyInstance({ id: 'near', typeId: 'slime_yarn', x: 3.5, z: 0 });
    const far = createEnemyInstance({ id: 'far', typeId: 'slime_yarn', x: 8.0, z: 0 });
    const events: GameEvent[] = [];

    const res = castSpell(player, 'flamepurr', [near, far], events, { rng: neutralRng });
    expect(res.cast).toBe(true);
    expect(player.mp).toBe(player.maxMp - 25);
    expect(player.spellCooldowns.flamepurr).toBeCloseTo(1.2);
    expect(res.hitEnemies.map((e) => e.id)).toEqual(['near']);
    expect(near.hp).toBe(near.maxHp - getSpellPower('flamepurr', 1, player.stats.mag));
    expect(far.hp).toBe(far.maxHp);

    // Impossible de relancer pendant le cooldown
    const blocked = castSpell(player, 'flamepurr', [near], events, { rng: neutralRng });
    expect(blocked.cast).toBe(false);
    expect(blocked.reason).toBe('cooldown');
  });

  it('Éclair-miaou perce en ligne (longueur 9 u, largeur 2 u) selon aimAngle', () => {
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0; // +X
    const aligned1 = createEnemyInstance({ id: 'a1', typeId: 'mouse_goblin', x: 3, z: 0.4 });
    const aligned2 = createEnemyInstance({ id: 'a2', typeId: 'mouse_goblin', x: 8.5, z: -0.3 });
    const offAxis = createEnemyInstance({ id: 'off', typeId: 'mouse_goblin', x: 4, z: 4.0 });

    const res = castSpell(player, 'lightnyan', [aligned1, aligned2, offAxis], [], {
      rng: neutralRng,
    });
    expect(res.cast).toBe(true);
    expect(player.mp).toBe(player.maxMp - 30);
    expect(res.hitEnemies.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(offAxis.hp).toBe(offAxis.maxHp);
  });

  it('Patte-givrée applique un ralentissement de 40 % pendant 3.5 s sur les ennemis touchés', () => {
    const player = createInitialPlayerState(0, 0);
    const wolf = createEnemyInstance({ id: 'w1', typeId: 'thorn_wolf', x: 4.0, z: 0 });
    const wolfFast = createEnemyInstance({ id: 'w2', typeId: 'thorn_wolf', x: 10.0, z: 0 });
    wolf.aggroed = true;
    wolfFast.aggroed = true;
    wolf.state = 'chase';
    wolfFast.state = 'chase';
    wolf.attackCooldown = 10;
    wolfFast.attackCooldown = 10;

    const res = castSpell(player, 'freezepaw', [wolf, wolfFast], [], { rng: neutralRng });
    expect(res.cast).toBe(true);
    expect(player.mp).toBe(player.maxMp - 28);
    expect(wolf.slowTimer).toBeCloseTo(3.5);
    expect(wolfFast.slowTimer).toBe(0);

    // Vérifie la vitesse réduite de 40 % dans enemyAI (hors recul initial du sort)
    wolf.knockbackVx = 0;
    wolf.knockbackVz = 0;
    const startXSlow = wolf.x;
    const startXFast = wolfFast.x;
    updateEnemies([wolf, wolfFast], player, [], 'dungeon_ghost_cave', 0.2, []);
    const movedSlow = Math.abs(startXSlow - wolf.x);
    const movedFast = Math.abs(startXFast - wolfFast.x);
    expect(movedSlow / movedFast).toBeCloseTo(0.6, 2);
  });

  it('Soin-velours soigne instantanément puis applique exactement 3 ticks de 8 % maxHp sur 3 s', () => {
    const player = createInitialPlayerState(0, 0);
    player.hp = 20;
    const events: GameEvent[] = [];

    const res = castSpell(player, 'healing_paw', [], events, { rng: neutralRng });
    expect(res.cast).toBe(true);
    expect(player.mp).toBe(player.maxMp - 35);
    const expectedInstant = Math.round(
      player.maxHp * 0.25 + getSpellPower('healing_paw', 1, player.stats.mag),
    );
    expect(player.hp).toBe(20 + expectedInstant);
    expect(player.regenTimer).toBeCloseTo(3.0);

    // Simule 3.5 s par pas de 0.05 s -> exactement 3 ticks
    let totalTicks = 0;
    for (let i = 0; i < 70; i++) {
      totalTicks += updatePlayerRegen(player, 0.05, events);
    }
    expect(totalTicks).toBe(3);
    expect(player.regenTimer).toBe(0);
    const tickHeal = Math.round(player.maxHp * 0.08);
    expect(player.hp).toBe(Math.min(player.maxHp, 20 + expectedInstant + 3 * tickHeal));
  });

  it('refuse le sort si les PM sont insuffisants', () => {
    const player = createInitialPlayerState(0, 0);
    player.mp = 10;
    const res = castSpell(player, 'flamepurr', [], []);
    expect(res.cast).toBe(false);
    expect(res.reason).toBe('insufficient_mp');
    expect(player.mp).toBe(10);
  });
});

describe('Télégraphes & IA Ennemis / Boss 2 Phases', () => {
  it('évalue précisément les 4 géométries de télégraphe (circle, cone, line, ring)', () => {
    // Circle
    expect(isPointInCircle(2, 0, 0, 0, 2.5)).toBe(true);
    expect(isPointInCircle(3, 0, 0, 0, 2.5)).toBe(false);

    // Cone (90° vers +X, rayon 4)
    expect(isPointInCone(3, 0.5, 0, 0, 0, 4, Math.PI / 2)).toBe(true);
    expect(isPointInCone(0, 3, 0, 0, 0, 4, Math.PI / 2)).toBe(false); // 90° hors demi-ouverture 45°
    expect(isPointInCone(5, 0, 0, 0, 0, 4, Math.PI / 2)).toBe(false); // trop loin

    // Line (longueur 8, largeur 2 vers +X)
    expect(isPointInLine(4, 0.9, 0, 0, 0, 8, 2)).toBe(true);
    expect(isPointInLine(4, 1.2, 0, 0, 0, 8, 2)).toBe(false);
    expect(isPointInLine(-0.5, 0, 0, 0, 0, 8, 2)).toBe(false);

    // Ring (inner 3.5, outer 11)
    expect(isPointInRing(2.0, 0, 0, 0, 3.5, 11)).toBe(false); // centre sûr !
    expect(isPointInRing(6.0, 0, 0, 0, 3.5, 11)).toBe(true);
    expect(isPointInRing(12.0, 0, 0, 0, 3.5, 11)).toBe(false);
  });

  it('résout un télégraphe exactement à elapsed >= duration et respecte les i-frames', () => {
    const player = createInitialPlayerState(5, 0);
    const tg: TelegraphZone = {
      id: 'tg_ring',
      ownerId: 'boss_1',
      shape: 'ring',
      x: 0,
      z: 0,
      angle: 0,
      innerRadius: 3.5,
      radius: 11,
      elapsed: 0,
      duration: 1.0,
      damage: 35,
      resolved: false,
    };
    expect(isTargetInTelegraph(tg, player.x, player.z)).toBe(true);

    const telegraphs = [tg];
    const events: GameEvent[] = [];

    // Avant expiration (0.5 s) : pas encore résolu
    updateTelegraphs(telegraphs, [], player, 0.5, events);
    expect(tg.resolved).toBe(false);
    expect(player.hp).toBe(player.maxHp);

    // À expiration (1.0 s) : résolu et blesse le joueur
    const res = updateTelegraphs(telegraphs, [], player, 0.5, events);
    expect(tg.resolved).toBe(true);
    expect(res.playerHit).toBe(true);
    expect(player.hp).toBeLessThan(player.maxHp);
    expect(telegraphs).toHaveLength(0);
  });

  it('déclenche la Phase 2 du Boss Dragon à <= 50 % PV, débloque le ring et passe à 5 météores', () => {
    const player = createInitialPlayerState(0, -3);
    const dragon = createEnemyInstance({
      id: 'dl_boss',
      typeId: 'boss_dragon_claw',
      x: 0,
      z: -11,
    });
    const def = getEnemyDefinition('boss_dragon_claw');
    const events: GameEvent[] = [];

    // En Phase 1, les météores génèrent 3 zones
    const meteorPattern = def.patterns.find((p) => p.id === 'dragon_meteors')!;
    const p1Zones: TelegraphZone[] = [];
    spawnTelegraphsForPattern(dragon, def, meteorPattern, player, p1Zones, {
      rng: neutralRng,
    });
    expect(p1Zones).toHaveLength(3);

    // Descente à 50 % PV -> transition Phase 2
    dragon.hp = Math.floor(dragon.maxHp * 0.5);
    const transitioned = checkBossPhaseTransition(dragon, events);
    expect(transitioned).toBe(true);
    expect(dragon.phase).toBe(2);
    expect(events.some((e) => e.type === 'boss_phase_two')).toBe(true);

    // Prochain pattern sélectionné en Phase 2 : Onde de Choc Sismique (ring)
    const nextPattern = selectAttackPattern(dragon, def, 8);
    expect(nextPattern?.shape).toBe('ring');

    // En Phase 2, les météores génèrent 5 zones en rafale
    const p2Zones: TelegraphZone[] = [];
    spawnTelegraphsForPattern(dragon, def, meteorPattern, player, p2Zones, {
      rng: neutralRng,
    });
    expect(p2Zones).toHaveLength(5);
  });

  it('empêche les ennemis Overworld d’entrer dans la zone sûre de Miaou-bourg et gère le respawn 35s > 25u', () => {
    const player = createInitialPlayerState(0, 24); // Dans Miaou-bourg
    expect(isInsideVillage(player.x, player.z)).toBe(true);

    const goblin = createEnemyInstance({
      id: 'g_border',
      typeId: 'mouse_goblin',
      x: VILLAGE_SAFE_ZONE.maxX + 1.5,
      z: 22,
    });
    goblin.aggroed = true;
    goblin.state = 'chase';

    updateEnemies([goblin], player, [], 'overworld', 0.1, []);
    // Doit lâcher l'aggro car joueur dans le village et rester hors zone sûre
    expect(goblin.state).toBe('idle');
    expect(isInsideVillage(goblin.x, goblin.z)).toBe(false);

    // Respawn Overworld : 35 s écoulées mais joueur à 10 u -> ne respawn pas encore
    goblin.state = 'dead';
    goblin.hp = 0;
    goblin.respawnTimer = OVERWORLD_RESPAWN_TIME;
    player.x = goblin.homeX + 10;
    player.z = goblin.homeZ;
    updateEnemies([goblin], player, [], 'overworld', 36, []);
    expect(goblin.state).toBe('dead');

    // Joueur s'éloigne à > 25 u -> respawn instantané
    player.x = goblin.homeX + 30;
    updateEnemies([goblin], player, [], 'overworld', 0.1, []);
    expect(goblin.state).toBe('idle');
    expect(goblin.hp).toBe(goblin.maxHp);
  });

  it('déclenche les pièges de salle du Donjon 1 en générant des télégraphes circulaires', () => {
    const player = createInitialPlayerState(0, -1);
    const traps: TrapInstance[] = DUNGEON_GHOST_CAVE.traps.map((t) => ({
      ...t,
      timer: t.initialDelay,
    }));
    const telegraphs: TelegraphZone[] = [];

    updateTraps(traps, player, telegraphs, 1.1);
    expect(telegraphs.length).toBeGreaterThanOrEqual(1);
    expect(telegraphs[0].shape).toBe('circle');
  });
});

describe('InputManager — Entrées unifiées (mode Node sans DOM)', () => {
  it('gère les déclencheurs synthétiques, la visée monde et vide les buffers après poll()', () => {
    const inputMgr = new InputManager();
    inputMgr.setAimWorldPos({ x: 10, z: -5 });
    inputMgr.triggerSpell('flamepurr');
    inputMgr.triggerInteract();
    inputMgr.triggerDodge();

    const frame1 = inputMgr.poll();
    expect(frame1.spellPressed.flamepurr).toBe(true);
    expect(frame1.interactPressed).toBe(true);
    expect(frame1.dodgePressed).toBe(true);
    expect(frame1.usingPointerAim).toBe(true);
    expect(frame1.aimWorldPos).toEqual({ x: 10, z: -5 });

    // Les fronts montants sont consommés au poll suivant
    const frame2 = inputMgr.poll();
    expect(frame2.spellPressed.flamepurr).toBe(false);
    expect(frame2.interactPressed).toBe(false);
    expect(frame2.dodgePressed).toBe(false);
  });
});
