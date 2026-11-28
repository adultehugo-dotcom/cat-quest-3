// ============================================================================
// Système de Combat : Combo Mêlée 3 coups (+MP), Roulade i-frames (dodge-cancel),
// 4 Sorts VF, Formules de Dégâts & Mitigation DEF.
// Zéro import Three.js, zéro dépendance DOM.
// ============================================================================

import { getEnemyDefinition } from '../data/enemiesData';
import { getWeaponCombatProfile } from '../data/equipmentData';
import { getSpellDefinition, getSpellPower } from '../data/spellsData';
import {
  angleBetween,
  distSq,
  isPointInCircle,
  isPointInCone,
  isPointInLine,
  normalize,
} from './math';
import {
  applyStatusEffect,
  getIncomingDamageMultiplier,
  getOutgoingDamageMultiplier,
  isEntityStunned,
  purgeEntityStatuses,
  reduceBurnOnDodge,
} from './statusEffects';
import type {
  ActiveSpellEffect,
  AttackMetadata,
  DodgeGhost,
  EnemyInstance,
  GameEvent,
  PlayerProjectile,
  PlayerState,
  SpellId,
  TelegraphZone,
  Vec2,
} from './types';

// --- Constantes de combat (Section 5 du cahier des charges) ---

export const PLAYER_MOVE_SPEED = 8.5;
export const PLAYER_RADIUS = 0.62;

export const MELEE_RANGE = 2.6;
export const MELEE_AUTO_AIM_RADIUS = 3.2;
export const COMBO_RESET_WINDOW = 0.65;

export const DODGE_DURATION = 0.28;
export const DODGE_SPEED = 19.0;
export const DODGE_IFRAMES = 0.3;
export const DODGE_COOLDOWN = 0.55;

export const POST_HIT_IFRAMES = 0.45;
export const CRIT_MULTIPLIER = 1.65;
export const FREEZEPAW_SLOW_FACTOR = 0.4;
export const HITSTOP_MAJOR_DURATION = 0.045;

export const PERFECT_DODGE_WINDOW_SEC = 0.18;
export const PERFECT_DODGE_TIMESCALE = 0.3;
export const PERFECT_DODGE_SLOW_DURATION = 0.22;
export const PERFECT_DODGE_BUFF_DURATION = 3.0;
export const PERFECT_DODGE_MP_PCT = 0.15;
export const PERFECT_DODGE_DAMAGE_MULT = 1.35;

export const STAGGER_DURATION_SEC = 2.2;
export const STAGGER_DAMAGE_MULT = 1.4;

let nextProjectileId = 1;

export interface MeleeComboStepConfig {
  step: 0 | 1 | 2;
  damageMult: number;
  arcAngle: number;
  cooldown: number;
  dashDist: number;
  mpGain: number;
  knockback: number;
  isFinisher: boolean;
}

const DEG = Math.PI / 180;

export const MELEE_COMBO_STEPS: readonly MeleeComboStepConfig[] = [
  {
    step: 0,
    damageMult: 1.0,
    arcAngle: 140 * DEG,
    cooldown: 0.24,
    dashDist: 0.45,
    mpGain: 12,
    knockback: 4.5,
    isFinisher: false,
  },
  {
    step: 1,
    damageMult: 1.15,
    arcAngle: 140 * DEG,
    cooldown: 0.24,
    dashDist: 0.55,
    mpGain: 12,
    knockback: 5.5,
    isFinisher: false,
  },
  {
    step: 2,
    damageMult: 1.5,
    arcAngle: 180 * DEG,
    cooldown: 0.38,
    dashDist: 0.65,
    mpGain: 18,
    knockback: 9.5,
    isFinisher: true,
  },
];

let nextSpellEffectId = 1;

// --- Formules de dégâts ---

/**
 * Calcule les dégâts infligés par le joueur (physique ou magique) avec variance [0.92, 1.08] et critique x1.65.
 */
export function calculatePlayerDamage(
  rawPower: number,
  critChance: number,
  rng: () => number = Math.random,
): { damage: number; isCrit: boolean } {
  const variance = 0.92 + rng() * 0.16;
  const isCrit = rng() < critChance;
  const mult = isCrit ? CRIT_MULTIPLIER : 1;
  const damage = Math.max(1, Math.round(rawPower * variance * mult));
  return { damage, isCrit };
}

/**
 * Calcule les dégâts ennemis reçus par le joueur après mitigation DEF :
 * Math.max(1, Math.round(enemyAtk * (100 / (100 + playerDef * 2.2))))
 */
export function calculateEnemyDamage(enemyAtk: number, playerDef: number): number {
  const def = Math.max(0, playerDef);
  return Math.max(1, Math.round(enemyAtk * (100 / (100 + def * 2.2))));
}

// --- Mêlée 3 coups + Projectiles + Stagger + Recharge Mana ---

export function applyEnemyStagger(
  enemy: EnemyInstance,
  amount: number,
  telegraphs?: TelegraphZone[],
  events?: GameEvent[],
): boolean {
  if (
    amount <= 0 ||
    !enemy.maxStagger ||
    enemy.maxStagger <= 0 ||
    enemy.state === 'dead' ||
    enemy.hp <= 0 ||
    (enemy.staggeredTimer ?? 0) > 0
  ) {
    return false;
  }

  enemy.stagger = Math.min(enemy.maxStagger, (enemy.stagger ?? 0) + amount);
  enemy.staggerDecayDelay = 3.0;

  if (enemy.stagger >= enemy.maxStagger) {
    enemy.stagger = 0;
    enemy.staggeredTimer = STAGGER_DURATION_SEC;
    enemy.state = 'staggered';
    enemy.stateTimer = STAGGER_DURATION_SEC;
    enemy.attackCooldown = Math.max(enemy.attackCooldown, STAGGER_DURATION_SEC + 0.3);
    enemy.activePatternId = undefined;
    enemy.activeLungeAngle = undefined;
    enemy.activeLungeDist = undefined;

    if (telegraphs && telegraphs.length > 0) {
      for (let i = telegraphs.length - 1; i >= 0; i--) {
        if (telegraphs[i].ownerId === enemy.id) {
          telegraphs[i].resolved = true;
          telegraphs.splice(i, 1);
        }
      }
    }

    events?.push({
      type: 'stagger_break',
      x: enemy.x,
      z: enemy.z,
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      value: STAGGER_DURATION_SEC,
      text: 'BRIS DE POSTURE !',
    });

    return true;
  }

  return false;
}

export interface MeleeAttackResult {
  executed: boolean;
  comboStep: 0 | 1 | 2;
  hitEnemies: EnemyInstance[];
  killedEnemies: EnemyInstance[];
  totalMpRestored: number;
  triggeredHitstop: boolean;
  hitstopSec: number;
  shakeAmount: number;
  attackMeta?: AttackMetadata;
  spawnedProjectile?: PlayerProjectile;
}

export interface ProjectileUpdateResult {
  hitEnemies: EnemyInstance[];
  killedEnemies: EnemyInstance[];
  totalMpRestored: number;
  triggeredHitstop: boolean;
  hitstopSec: number;
  shakeAmount: number;
}

/**
 * Trouve l'ennemi vivant le plus proche du héros dans le rayon d'auto-aim doux (3.2 u par défaut).
 */
export function findNearestAutoAimTarget(
  player: PlayerState,
  enemies: readonly EnemyInstance[],
  radius = MELEE_AUTO_AIM_RADIUS,
): EnemyInstance | null {
  if (radius <= 0) return null;
  const maxDistSq = radius * radius + 1e-9;
  let nearest: EnemyInstance | null = null;
  let bestDistSq = maxDistSq;

  for (const enemy of enemies) {
    if (enemy.state === 'dead' || enemy.hp <= 0) continue;
    const dSq = distSq(player.x, player.z, enemy.x, enemy.z);
    if (dSq <= bestDistSq) {
      bestDistSq = dSq;
      nearest = enemy;
    }
  }

  return nearest;
}

export function executeMeleeAttack(
  player: PlayerState,
  enemies: EnemyInstance[],
  events: GameEvent[],
  options?: {
    rng?: () => number;
    applyDash?: (dx: number, dz: number) => void;
    autoAim?: boolean;
    autoAimRadius?: number;
    projectiles?: PlayerProjectile[];
    telegraphs?: TelegraphZone[];
  },
): MeleeAttackResult {
  const rng = options?.rng ?? Math.random;
  if (
    player.hp <= 0 ||
    player.attackCooldown > 0 ||
    player.dodgeTimer > 0 ||
    isEntityStunned(player)
  ) {
    return {
      executed: false,
      comboStep: player.comboStep,
      hitEnemies: [],
      killedEnemies: [],
      totalMpRestored: 0,
      triggeredHitstop: false,
      hitstopSec: 0,
      shakeAmount: 0,
    };
  }

  // Auto-aim doux clavier/manette (hors visée souris explicite) :
  // oriente aimAngle (et facingX) vers l'ennemi vivant le plus proche dans un rayon de 3.2 u
  if (options?.autoAim) {
    const autoAimRadius = options.autoAimRadius ?? MELEE_AUTO_AIM_RADIUS;
    const target = findNearestAutoAimTarget(player, enemies, autoAimRadius);
    if (target && distSq(player.x, player.z, target.x, target.z) > 1e-6) {
      player.aimAngle = angleBetween(player.x, player.z, target.x, target.z);
    }
  }

  const stepIndex = player.comboStep;
  const cfg = MELEE_COMBO_STEPS[stepIndex];
  const weaponProfile = getWeaponCombatProfile(player.equipped.weapon);
  const actualReach = cfg.isFinisher ? weaponProfile.reachFinisher : weaponProfile.reach;
  const actualArc = cfg.isFinisher ? weaponProfile.arcAngleFinisher : weaponProfile.arcAngle;
  const actualCooldown = Number(
    (weaponProfile.attackCooldown * (cfg.cooldown / MELEE_COMBO_STEPS[0].cooldown)).toFixed(4),
  );
  const stepKnockback =
    weaponProfile.knockback * (cfg.knockback / MELEE_COMBO_STEPS[0].knockback);
  const actualDashDist = cfg.dashDist * weaponProfile.dashMult;
  const maxSteps = Math.max(1, Math.min(3, weaponProfile.comboSteps));
  const stepDamageMult = weaponProfile.comboMultipliers[stepIndex] ?? cfg.damageMult;
  const effectiveCritChance = Math.min(0.85, player.stats.critChance + weaponProfile.critBonus);

  player.attackCooldown = actualCooldown;
  player.attackAnimTimer = Math.min(actualCooldown, weaponProfile.animDuration);
  player.comboResetTimer = COMBO_RESET_WINDOW;
  player.comboStep = ((stepIndex + 1) % maxSteps) as 0 | 1 | 2;
  player.lastMeleeAngle = player.aimAngle;
  player.lastMeleeWeaponId = weaponProfile.weaponId;

  const dirX = Math.cos(player.aimAngle);
  const dirZ = Math.sin(player.aimAngle);
  if (Math.abs(dirX) > 0.05) {
    player.facingX = dirX >= 0 ? 1 : -1;
  }

  // Léger dash avant modulé selon l'arme
  const dashX = dirX * actualDashDist;
  const dashZ = dirZ * actualDashDist;
  if (options?.applyDash) {
    options.applyDash(dashX, dashZ);
  } else {
    player.x += dashX;
    player.z += dashZ;
  }

  const sweepDir = stepIndex === 1 ? -1 : 1;
  const halfSweep =
    weaponProfile.attackShape === 'thrust_line'
      ? weaponProfile.weaponId === 'halberd_royal' && cfg.isFinisher
        ? actualArc * 0.5
        : 0.32
      : weaponProfile.attackShape === 'projectile'
        ? 0.35
        : actualArc * 0.5;
  const startAngle = player.aimAngle - halfSweep * sweepDir;
  const endAngle = player.aimAngle + halfSweep * sweepDir;
  const element =
    weaponProfile.statusProc?.statusId ??
    (weaponProfile.materialSound === 'arcane' ? 'arcane' : 'physical');

  const attackMeta: AttackMetadata = {
    weaponId: weaponProfile.weaponId,
    weaponFamily: weaponProfile.weaponFamily,
    materialSound: weaponProfile.materialSound,
    attackShape: weaponProfile.attackShape,
    comboStep: stepIndex,
    startAngle,
    endAngle,
    range: actualReach,
    windupSec: weaponProfile.windupSec,
    activeSec: weaponProfile.activeSec,
    element,
    color: weaponProfile.slashColor,
    accentColor: weaponProfile.slashAccent,
  };

  events.push({
    type: 'melee_swing',
    x: player.x,
    z: player.z,
    angle: player.aimAngle,
    radius: actualReach,
    hitArc: actualArc,
    comboStep: stepIndex,
    weaponId: weaponProfile.weaponId,
    weaponFamily: weaponProfile.weaponFamily,
    materialSound: weaponProfile.materialSound,
    attackShape: weaponProfile.attackShape,
    startAngle,
    endAngle,
    windupSec: weaponProfile.windupSec,
    activeSec: weaponProfile.activeSec,
    element,
    color: weaponProfile.slashColor,
    accentColor: weaponProfile.slashAccent,
  });

  const hasPerfectDodgeBuff = (player.perfectDodgeBuffTimer ?? 0) > 0;
  const outgoingMult =
    getOutgoingDamageMultiplier(player) *
    (hasPerfectDodgeBuff ? PERFECT_DODGE_DAMAGE_MULT : 1.0);

  // Armes à distance (Bâtons & Arcs/Arbalètes) : génère un vrai PlayerProjectile
  if (weaponProfile.attackShape === 'projectile') {
    const speed = weaponProfile.projectileSpeed ?? 18;
    const { damage, isCrit } = calculatePlayerDamage(
      player.stats.atk *
        stepDamageMult *
        weaponProfile.damageMult *
        getOutgoingDamageMultiplier(player),
      effectiveCritChance,
      rng,
    );

    const proj: PlayerProjectile = {
      id: `pproj_${nextProjectileId++}`,
      projectileId: weaponProfile.projectileId ?? 'arcane_bolt',
      weaponId: weaponProfile.weaponId,
      weaponFamily: weaponProfile.weaponFamily,
      materialSound: weaponProfile.materialSound,
      x: player.x + dirX * 0.55,
      z: player.z + dirZ * 0.55,
      vx: dirX * speed,
      vz: dirZ * speed,
      speed,
      radius: weaponProfile.weaponFamily === 'staff' ? 0.38 : 0.28,
      distanceTraveled: 0,
      maxRange: actualReach,
      damage,
      isCrit,
      knockback: stepKnockback,
      staggerPower: weaponProfile.staggerPower * (cfg.isFinisher ? 1.35 : 1.0),
      hitstopSec: weaponProfile.hitstopSec,
      mpGain: cfg.mpGain,
      comboStep: stepIndex,
      statusProc: weaponProfile.statusProc,
      canConsumePerfectDodgeBuff: hasPerfectDodgeBuff,
      color: weaponProfile.slashColor,
      accentColor: weaponProfile.slashAccent,
    };

    options?.projectiles?.push(proj);

    return {
      executed: true,
      comboStep: stepIndex,
      hitEnemies: [],
      killedEnemies: [],
      totalMpRestored: 0,
      triggeredHitstop: false,
      hitstopSec: 0,
      shakeAmount: 0.06,
      attackMeta,
      spawnedProjectile: proj,
    };
  }

  const hitEnemies: EnemyInstance[] = [];
  const killedEnemies: EnemyInstance[] = [];
  let totalMpRestored = 0;
  let triggeredHitstop = false;
  let shakeAmount = weaponProfile.animStyle === 'dragon_cleave' ? 0.14 : 0.08;

  for (const enemy of enemies) {
    if (enemy.state === 'dead' || enemy.hp <= 0) continue;

    let inShape = false;
    if (weaponProfile.attackShape === 'thrust_line') {
      const thrustWidth = weaponProfile.weaponId === 'halberd_royal' ? 1.85 : 1.35;
      inShape = isPointInLine(
        enemy.x,
        enemy.z,
        player.x,
        player.z,
        player.aimAngle,
        actualReach,
        thrustWidth,
        enemy.radius,
      );
      if (!inShape && weaponProfile.weaponId === 'halberd_royal' && cfg.isFinisher) {
        inShape = isPointInCone(
          enemy.x,
          enemy.z,
          player.x,
          player.z,
          player.aimAngle,
          actualReach,
          actualArc,
          enemy.radius,
        );
      }
    } else if (weaponProfile.attackShape === 'cleave') {
      inShape =
        isPointInCone(
          enemy.x,
          enemy.z,
          player.x,
          player.z,
          player.aimAngle,
          actualReach,
          actualArc,
          enemy.radius,
        ) ||
        isPointInCircle(
          enemy.x,
          enemy.z,
          player.x,
          player.z,
          PLAYER_RADIUS + 0.65,
          enemy.radius,
        );
    } else {
      inShape = isPointInCone(
        enemy.x,
        enemy.z,
        player.x,
        player.z,
        player.aimAngle,
        actualReach,
        actualArc,
        enemy.radius,
      );
    }

    if (!inShape) continue;

    const staggerMult = (enemy.staggeredTimer ?? 0) > 0 ? STAGGER_DAMAGE_MULT : 1.0;
    const totalDmgMult =
      outgoingMult * getIncomingDamageMultiplier(enemy) * staggerMult;

    const { damage, isCrit } = calculatePlayerDamage(
      player.stats.atk * stepDamageMult * weaponProfile.damageMult * totalDmgMult,
      effectiveCritChance,
      rng,
    );

    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlashTimer = 0.12;
    enemy.aggroed = true;

    // Knockback modulé par l'arme (combatProfile.knockback)
    const kbDir = normalize(enemy.x - player.x, enemy.z - player.z);
    const kbScale = enemy.isBoss ? 0.2 : 1.0;
    const kbForce = stepKnockback * kbScale;
    enemy.knockbackVx = (kbDir.x || dirX) * kbForce;
    enemy.knockbackVz = (kbDir.z || dirZ) * kbForce;

    // Recharge MP signature Cat Quest (+12 / +18 par ennemi touché)
    const prevMp = player.mp;
    player.mp = Math.min(player.maxMp, player.mp + cfg.mpGain);
    const mpDelta = player.mp - prevMp;
    totalMpRestored += mpDelta;

    events.push({
      type: 'hit_enemy',
      x: enemy.x,
      z: enemy.z,
      value: damage,
      isCrit,
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      enemyMaterial: getEnemyDefinition(enemy.typeId).materialSound,
      comboStep: stepIndex,
      weaponId: weaponProfile.weaponId,
      weaponFamily: weaponProfile.weaponFamily,
      materialSound: weaponProfile.materialSound,
    });

    if (mpDelta > 0) {
      events.push({
        type: 'mp_gain',
        x: player.x,
        z: player.z,
        value: mpDelta,
        text: `+${mpDelta} PM`,
      });
    }

    if (enemy.hp > 0) {
      if (weaponProfile.statusProc) {
        const applied = applyStatusEffect(enemy, weaponProfile.statusProc, events, {
          rng,
          sourceId: weaponProfile.weaponId,
          enemyId: enemy.id,
          enemyTypeId: enemy.typeId,
        });
        if (applied && weaponProfile.statusProc.statusId === 'shock') {
          enemy.attackCooldown += 0.18;
        }
      }
      const staggerGain = weaponProfile.staggerPower * (cfg.isFinisher ? 1.35 : 1.0);
      if (applyEnemyStagger(enemy, staggerGain, options?.telegraphs, events)) {
        triggeredHitstop = true;
      }
    }

    hitEnemies.push(enemy);
    shakeAmount = Math.max(
      shakeAmount,
      isCrit || cfg.isFinisher || weaponProfile.animStyle === 'dragon_cleave' ? 0.26 : 0.15,
    );

    if (isCrit || cfg.isFinisher || enemy.hp <= 0) {
      triggeredHitstop = true;
    }

    if (enemy.hp <= 0) {
      killedEnemies.push(enemy);
    }
  }

  if (hitEnemies.length > 0 && hasPerfectDodgeBuff) {
    player.perfectDodgeBuffTimer = 0;
  }

  return {
    executed: true,
    comboStep: stepIndex,
    hitEnemies,
    killedEnemies,
    totalMpRestored,
    triggeredHitstop,
    hitstopSec: triggeredHitstop ? weaponProfile.hitstopSec : 0,
    shakeAmount,
    attackMeta,
  };
}

/**
 * Met à jour les projectiles lancés par les armes à distance (Bâtons, Arcs, Arbalètes).
 */
export function updatePlayerProjectiles(
  projectiles: PlayerProjectile[],
  enemies: EnemyInstance[],
  player: PlayerState,
  events: GameEvent[],
  options: {
    dt: number;
    rng?: () => number;
    telegraphs?: TelegraphZone[];
    isObstacleHit?: (x: number, z: number, radius: number) => boolean;
  },
): ProjectileUpdateResult {
  const hitEnemies: EnemyInstance[] = [];
  const killedEnemies: EnemyInstance[] = [];
  let totalMpRestored = 0;
  let triggeredHitstop = false;
  let hitstopSec = 0;
  let shakeAmount = 0;

  const dt = options.dt;
  if (projectiles.length === 0 || dt <= 0) {
    return {
      hitEnemies,
      killedEnemies,
      totalMpRestored,
      triggeredHitstop,
      hitstopSec,
      shakeAmount,
    };
  }

  const rng = options.rng ?? Math.random;

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const prevX = p.x;
    const prevZ = p.z;
    const prevDistanceTraveled = p.distanceTraveled;
    const stepDist = p.speed * dt;

    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.distanceTraveled += stepDist;

    const dx = p.x - prevX;
    const dz = p.z - prevZ;
    const segLenSq = dx * dx + dz * dz;

    let obstacleHitT = Infinity;
    if (options.isObstacleHit) {
      for (const sampleT of [0.25, 0.5, 0.75, 1.0]) {
        if (options.isObstacleHit(prevX + dx * sampleT, prevZ + dz * sampleT, p.radius)) {
          obstacleHitT = sampleT;
          break;
        }
      }
    }

    const maxRangeT =
      stepDist > 1e-8
        ? Math.max(0, Math.min(1, (p.maxRange - prevDistanceTraveled) / stepDist))
        : 1;
    const maxValidT = Math.min(obstacleHitT, maxRangeT);

    let hitEnemy: EnemyInstance | null = null;
    let bestHitT = Infinity;
    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      const sumR = p.radius + enemy.radius;
      const fx = prevX - enemy.x;
      const fz = prevZ - enemy.z;
      const c = fx * fx + fz * fz - sumR * sumR;

      let hitT: number | null = null;
      if (c <= 0) {
        hitT = 0;
      } else if (segLenSq > 1e-12) {
        const b = 2 * (fx * dx + fz * dz);
        const disc = b * b - 4 * segLenSq * c;
        if (disc >= 0) {
          const tEntry = (-b - Math.sqrt(disc)) / (2 * segLenSq);
          if (tEntry >= 0 && tEntry <= 1) {
            hitT = tEntry;
          }
        }
      }

      if (hitT !== null && hitT <= maxValidT && hitT < bestHitT) {
        bestHitT = hitT;
        hitEnemy = enemy;
      }
    }

    if (hitEnemy) {
      const applyPerfectDodgeBuff =
        p.canConsumePerfectDodgeBuff !== false && (player.perfectDodgeBuffTimer ?? 0) > 0;
      const perfectDodgeMult = applyPerfectDodgeBuff ? PERFECT_DODGE_DAMAGE_MULT : 1.0;
      if (applyPerfectDodgeBuff) {
        player.perfectDodgeBuffTimer = 0;
      }

      const staggerMult = (hitEnemy.staggeredTimer ?? 0) > 0 ? STAGGER_DAMAGE_MULT : 1.0;
      const incomingMult = getIncomingDamageMultiplier(hitEnemy);
      const damage = Math.max(
        1,
        Math.round(p.damage * staggerMult * incomingMult * perfectDodgeMult),
      );

      hitEnemy.hp = Math.max(0, hitEnemy.hp - damage);
      hitEnemy.hitFlashTimer = 0.12;
      hitEnemy.aggroed = true;

      const dir = normalize(p.vx, p.vz);
      const kbScale = hitEnemy.isBoss ? 0.2 : 1.0;
      hitEnemy.knockbackVx = dir.x * p.knockback * kbScale;
      hitEnemy.knockbackVz = dir.z * p.knockback * kbScale;

      const prevMp = player.mp;
      player.mp = Math.min(player.maxMp, player.mp + p.mpGain);
      const mpDelta = player.mp - prevMp;
      totalMpRestored += mpDelta;

      events.push({
        type: 'hit_enemy',
        x: hitEnemy.x,
        z: hitEnemy.z,
        value: damage,
        isCrit: p.isCrit,
        enemyId: hitEnemy.id,
        enemyTypeId: hitEnemy.typeId,
        enemyMaterial: getEnemyDefinition(hitEnemy.typeId).materialSound,
        comboStep: p.comboStep,
        weaponId: p.weaponId,
        weaponFamily: p.weaponFamily,
        materialSound: p.materialSound,
      });

      if (mpDelta > 0) {
        events.push({
          type: 'mp_gain',
          x: player.x,
          z: player.z,
          value: mpDelta,
          text: `+${mpDelta} PM`,
        });
      }

      let brokeStagger = false;
      if (hitEnemy.hp > 0) {
        if (p.statusProc) {
          const applied = applyStatusEffect(hitEnemy, p.statusProc, events, {
            rng,
            sourceId: p.weaponId,
            enemyId: hitEnemy.id,
            enemyTypeId: hitEnemy.typeId,
          });
          if (applied && p.statusProc.statusId === 'shock') {
            hitEnemy.attackCooldown += 0.18;
          }
        }
        brokeStagger = applyEnemyStagger(
          hitEnemy,
          p.staggerPower,
          options.telegraphs,
          events,
        );
      }

      hitEnemies.push(hitEnemy);
      if (hitEnemy.hp <= 0) {
        killedEnemies.push(hitEnemy);
      }

      const isMajor = p.isCrit || p.comboStep === 2 || hitEnemy.hp <= 0 || brokeStagger;
      if (isMajor) {
        triggeredHitstop = true;
        hitstopSec = Math.max(hitstopSec, p.hitstopSec);
      }
      shakeAmount = Math.max(shakeAmount, isMajor ? 0.2 : 0.1);

      projectiles.splice(i, 1);
      continue;
    }

    if (obstacleHitT <= 1 || p.distanceTraveled >= p.maxRange) {
      projectiles.splice(i, 1);
    }
  }

  return {
    hitEnemies,
    killedEnemies,
    totalMpRestored,
    triggeredHitstop,
    hitstopSec,
    shakeAmount,
  };
}

// --- Roulade d'esquive (i-frames & dodge-cancel) ---

export function executeDodgeRoll(
  player: PlayerState,
  moveX: number,
  moveZ: number,
  events: GameEvent[],
  dodgeGhosts?: DodgeGhost[],
): boolean {
  if (
    player.hp <= 0 ||
    player.dodgeCooldown > 0 ||
    player.dodgeTimer > 0 ||
    isEntityStunned(player)
  ) {
    return false;
  }

  let dirX = moveX;
  let dirZ = moveZ;
  if (Math.hypot(dirX, dirZ) > 0.05) {
    const n = normalize(dirX, dirZ);
    dirX = n.x;
    dirZ = n.z;
  } else {
    dirX = Math.cos(player.aimAngle);
    dirZ = Math.sin(player.aimAngle);
  }

  player.dodgeTimer = DODGE_DURATION;
  player.dodgeCooldown = DODGE_COOLDOWN;
  player.invulnTimer = Math.max(player.invulnTimer, DODGE_IFRAMES);
  player.dodgeDirX = dirX;
  player.dodgeDirZ = dirZ;

  // Dodge-cancel : annule immédiatement le recovery d'attaque mêlée !
  player.attackCooldown = 0;
  player.attackAnimTimer = 0;

  if (Math.abs(dirX) > 0.05) {
    player.facingX = dirX >= 0 ? 1 : -1;
  }

  dodgeGhosts?.push({
    x: player.x,
    z: player.z,
    facingX: player.facingX,
    age: 0,
    duration: 0.24,
  });

  events.push({
    type: 'dodge_roll',
    x: player.x,
    z: player.z,
    angle: Math.atan2(dirZ, dirX),
  });

  // Contre-jeu actif : la roulade étouffe/réduit les brûlures actives
  reduceBurnOnDodge(player, events);

  return true;
}

// --- Exécution des 4 Sorts VF ---

export interface SpellCastResult {
  cast: boolean;
  spellId: SpellId;
  hitEnemies: EnemyInstance[];
  killedEnemies: EnemyInstance[];
  healAmount: number;
  shieldAmount?: number;
  triggeredHitstop: boolean;
  shakeAmount: number;
  reason?: 'dead' | 'cooldown' | 'insufficient_mp';
}

export const STARFALL_DURATION = 2.15;
export const STARFALL_WAVE_COUNT = 4;
export const STARFALL_WAVE_INTERVAL = 0.48;

export function resolveStarfallTarget(
  player: PlayerState,
  aimWorldPos: Vec2 | null | undefined,
  enemies: readonly EnemyInstance[],
  castRange: number,
  clampTargetPoint?: (x: number, z: number) => Vec2,
): Vec2 {
  let targetX: number;
  let targetZ: number;

  if (
    aimWorldPos &&
    Number.isFinite(aimWorldPos.x) &&
    Number.isFinite(aimWorldPos.z)
  ) {
    // Ciblage prioritaire à la position du curseur, borné à la portée maximale cohérente
    const dx = aimWorldPos.x - player.x;
    const dz = aimWorldPos.z - player.z;
    const distToCursor = Math.hypot(dx, dz);
    if (distToCursor > castRange && distToCursor > 1e-6) {
      const scale = castRange / distToCursor;
      targetX = player.x + dx * scale;
      targetZ = player.z + dz * scale;
    } else {
      targetX = aimWorldPos.x;
      targetZ = aimWorldPos.z;
    }
  } else {
    // Repli propre directionnel (clavier/manette sans curseur)
    const fallbackRange = Math.min(5.5, castRange);
    targetX = player.x + Math.cos(player.aimAngle) * Math.min(4.2, fallbackRange);
    targetZ = player.z + Math.sin(player.aimAngle) * Math.min(4.2, fallbackRange);

    let bestDist = fallbackRange + 2.2;
    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      const d = Math.hypot(enemy.x - player.x, enemy.z - player.z);
      if (d < bestDist) {
        bestDist = d;
        const clamped = Math.min(d, fallbackRange);
        const dir = normalize(enemy.x - player.x, enemy.z - player.z);
        targetX = player.x + dir.x * clamped;
        targetZ = player.z + dir.z * clamped;
      }
    }
  }

  if (clampTargetPoint) {
    return clampTargetPoint(targetX, targetZ);
  }
  return { x: targetX, z: targetZ };
}

export function applyStarfallWaveDamage(
  fx: ActiveSpellEffect,
  enemies: EnemyInstance[],
  events: GameEvent[],
  waveScale = 0.45,
  rng: () => number = Math.random,
  telegraphs?: TelegraphZone[],
): { hitEnemies: EnemyInstance[]; killedEnemies: EnemyInstance[]; triggeredHitstop: boolean } {
  const targetX = fx.targetX ?? fx.x;
  const targetZ = fx.targetZ ?? fx.z;
  const basePower = fx.spellDamage ?? 30;
  const critChance = fx.spellCritChance ?? 0.08;
  const hitEnemies: EnemyInstance[] = [];
  const killedEnemies: EnemyInstance[] = [];
  let triggeredHitstop = false;

  events.push({
    type: 'starfall_impact',
    x: targetX,
    z: targetZ,
    radius: fx.radius,
    spellId: 'meteor_paw',
    color: '#c95bff',
  });

  for (const enemy of enemies) {
    if (enemy.state === 'dead' || enemy.hp <= 0) continue;
    if (!isPointInCircle(enemy.x, enemy.z, targetX, targetZ, fx.radius, enemy.radius)) {
      continue;
    }
    const staggerMult = (enemy.staggeredTimer ?? 0) > 0 ? STAGGER_DAMAGE_MULT : 1.0;
    const totalMult = getIncomingDamageMultiplier(enemy) * staggerMult;
    const { damage, isCrit } = calculatePlayerDamage(
      basePower * waveScale * totalMult,
      critChance,
      rng,
    );
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlashTimer = 0.16;
    enemy.aggroed = true;
    const kbScale = enemy.isBoss ? 0.15 : 0.7;
    const kbDir = normalize(enemy.x - targetX, enemy.z - targetZ);
    enemy.knockbackVx = kbDir.x * 5.2 * kbScale;
    enemy.knockbackVz = kbDir.z * 5.2 * kbScale;

    events.push({
      type: 'hit_enemy',
      x: enemy.x,
      z: enemy.z,
      value: damage,
      isCrit,
      spellId: 'meteor_paw',
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      enemyMaterial: getEnemyDefinition(enemy.typeId).materialSound,
    });
    if (enemy.hp > 0) {
      if (applyEnemyStagger(enemy, 22, telegraphs, events)) {
        triggeredHitstop = true;
      }
    }
    hitEnemies.push(enemy);
    if (isCrit || enemy.hp <= 0) triggeredHitstop = true;
    if (enemy.hp <= 0) killedEnemies.push(enemy);
  }

  return { hitEnemies, killedEnemies, triggeredHitstop };
}

export function castSpell(
  player: PlayerState,
  spellId: SpellId,
  enemies: EnemyInstance[],
  events: GameEvent[],
  options?: {
    activeSpellEffects?: ActiveSpellEffect[];
    dodgeGhosts?: DodgeGhost[];
    resolveDashPosition?: (x: number, z: number) => { x: number; z: number };
    clampTargetPoint?: (x: number, z: number) => { x: number; z: number };
    aimWorldPos?: Vec2 | null;
    rng?: () => number;
    telegraphs?: TelegraphZone[];
  },
): SpellCastResult {
  const rng = options?.rng ?? Math.random;
  if (player.hp <= 0 || isEntityStunned(player)) {
    return {
      cast: false,
      spellId,
      hitEnemies: [],
      killedEnemies: [],
      healAmount: 0,
      triggeredHitstop: false,
      shakeAmount: 0,
      reason: 'dead',
    };
  }

  const def = getSpellDefinition(spellId);
  if (player.spellCooldowns[spellId] > 0) {
    return {
      cast: false,
      spellId,
      hitEnemies: [],
      killedEnemies: [],
      healAmount: 0,
      triggeredHitstop: false,
      shakeAmount: 0,
      reason: 'cooldown',
    };
  }

  if (player.mp < def.mpCost) {
    return {
      cast: false,
      spellId,
      hitEnemies: [],
      killedEnemies: [],
      healAmount: 0,
      triggeredHitstop: false,
      shakeAmount: 0,
      reason: 'insufficient_mp',
    };
  }

  player.mp -= def.mpCost;
  player.spellCooldowns[spellId] = def.cooldown;

  const level = player.spellLevels[spellId] ?? 1;
  const spellPower = getSpellPower(spellId, level, player.stats.mag);

  // Sort 4 : Soin-velours (+ purge immédiate des débuffs actifs)
  if (spellId === 'healing_paw') {
    const instantPct = def.instantHealPct ?? 0.25;
    const rawHeal = Math.round(player.maxHp * instantPct + spellPower);
    const prevHp = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + rawHeal);
    const actualHeal = Math.max(0, player.hp - prevHp);

    player.regenTimer = def.regenDuration ?? 3.0;
    player.regenTickAccum = 0;

    purgeEntityStatuses(player, events);

    options?.activeSpellEffects?.push({
      id: `spell_fx_${nextSpellEffectId++}`,
      spellId,
      x: player.x,
      z: player.z,
      angle: player.aimAngle,
      radius: def.radius,
      width: def.width,
      elapsed: 0,
      duration: 0.85,
    });
    events.push({
      type: 'spell_cast',
      x: player.x,
      z: player.z,
      angle: player.aimAngle,
      radius: def.radius,
      spellId,
      color: def.color,
    });
    events.push({
      type: 'heal_tick',
      x: player.x,
      z: player.z,
      value: rawHeal,
      text: `+${rawHeal} PV`,
      spellId: 'healing_paw',
    });

    return {
      cast: true,
      spellId,
      hitEnemies: [],
      killedEnemies: [],
      healAmount: actualHeal > 0 ? actualHeal : rawHeal,
      triggeredHitstop: false,
      shakeAmount: 0.1,
    };
  }

  // Sort 5 : Égide de Ronron (Défense / Bouclier absorbant les dégâts)
  if (spellId === 'aegis_purr') {
    const shieldPct = def.shieldHpPct ?? 0.24;
    const shieldAmount = Math.max(15, Math.round(player.maxHp * shieldPct + spellPower));
    const shieldDur = def.shieldDuration ?? 5.5;
    player.shieldHp = shieldAmount;
    player.shieldMaxHp = shieldAmount;
    player.shieldTimer = shieldDur;

    options?.activeSpellEffects?.push({
      id: `spell_fx_${nextSpellEffectId++}`,
      spellId,
      x: player.x,
      z: player.z,
      angle: player.aimAngle,
      radius: def.radius,
      elapsed: 0,
      duration: 0.78,
    });
    events.push({
      type: 'spell_cast',
      x: player.x,
      z: player.z,
      angle: player.aimAngle,
      radius: def.radius,
      value: shieldAmount,
      text: `Égide +${shieldAmount}`,
      spellId,
      color: def.color,
    });

    return {
      cast: true,
      spellId,
      hitEnemies: [],
      killedEnemies: [],
      healAmount: 0,
      shieldAmount,
      triggeredHitstop: false,
      shakeAmount: 0.14,
    };
  }

  // Sort 6 : Bond Foudroyant (Mobilité : ruée directionnelle + i-frames + dégâts traversée)
  if (spellId === 'pounce_dash') {
    const startX = player.x;
    const startZ = player.z;
    const dirX = Math.cos(player.aimAngle);
    const dirZ = Math.sin(player.aimAngle);
    const steps = 12;
    const stepLen = def.radius / steps;

    for (let s = 1; s <= steps; s++) {
      const candidateX = player.x + dirX * stepLen;
      const candidateZ = player.z + dirZ * stepLen;
      const resolved = options?.resolveDashPosition
        ? options.resolveDashPosition(candidateX, candidateZ)
        : { x: candidateX, z: candidateZ };
      player.x = resolved.x;
      player.z = resolved.z;

      if (options?.dodgeGhosts && s % 3 === 0) {
        options.dodgeGhosts.push({
          x: player.x,
          z: player.z,
          facingX: Math.abs(dirX) > 0.08 ? (dirX >= 0 ? 1 : -1) : player.facingX,
          age: 0,
          duration: 0.28,
        });
      }
    }

    if (Math.abs(dirX) > 0.08) {
      player.facingX = dirX >= 0 ? 1 : -1;
    }
    player.vx = dirX * 14.0;
    player.vz = dirZ * 14.0;
    player.invulnTimer = Math.max(player.invulnTimer, def.dashIframes ?? 0.28);

    const traveledDist = Math.max(0.8, Math.hypot(player.x - startX, player.z - startZ));
    const dashAngle = Math.atan2(player.z - startZ, player.x - startX);

    options?.activeSpellEffects?.push({
      id: `spell_fx_${nextSpellEffectId++}`,
      spellId,
      x: startX,
      z: startZ,
      angle: traveledDist > 0.85 ? dashAngle : player.aimAngle,
      radius: traveledDist,
      width: def.width ?? 2.1,
      elapsed: 0,
      duration: 0.42,
    });
    events.push({
      type: 'spell_cast',
      x: player.x,
      z: player.z,
      angle: traveledDist > 0.85 ? dashAngle : player.aimAngle,
      radius: traveledDist,
      spellId,
      color: def.color,
    });

    const hasPerfectDodgeBuff = (player.perfectDodgeBuffTimer ?? 0) > 0;
    const outgoingMult =
      getOutgoingDamageMultiplier(player) *
      (hasPerfectDodgeBuff ? PERFECT_DODGE_DAMAGE_MULT : 1.0);
    const hitEnemies: EnemyInstance[] = [];
    const killedEnemies: EnemyInstance[] = [];
    let triggeredHitstop = false;
    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      const inLine = isPointInLine(
        enemy.x,
        enemy.z,
        startX,
        startZ,
        traveledDist > 0.85 ? dashAngle : player.aimAngle,
        traveledDist,
        def.width ?? 2.1,
        enemy.radius,
      );
      const inArrival = isPointInCircle(
        enemy.x,
        enemy.z,
        player.x,
        player.z,
        2.0,
        enemy.radius,
      );
      if (!inLine && !inArrival) continue;

      const staggerMult = (enemy.staggeredTimer ?? 0) > 0 ? STAGGER_DAMAGE_MULT : 1.0;
      const totalDmgMult = outgoingMult * getIncomingDamageMultiplier(enemy) * staggerMult;
      const { damage, isCrit } = calculatePlayerDamage(
        spellPower * totalDmgMult,
        player.stats.critChance,
        rng,
      );
      enemy.hp = Math.max(0, enemy.hp - damage);
      enemy.hitFlashTimer = 0.14;
      enemy.aggroed = true;
      const kbScale = enemy.isBoss ? 0.15 : 1.0;
      enemy.knockbackVx = dirX * 6.2 * kbScale;
      enemy.knockbackVz = dirZ * 6.2 * kbScale;

      events.push({
        type: 'hit_enemy',
        x: enemy.x,
        z: enemy.z,
        value: damage,
        isCrit,
        spellId,
        enemyId: enemy.id,
        enemyTypeId: enemy.typeId,
        enemyMaterial: getEnemyDefinition(enemy.typeId).materialSound,
      });
      if (enemy.hp > 0 && applyEnemyStagger(enemy, 20, options?.telegraphs, events)) {
        triggeredHitstop = true;
      }
      hitEnemies.push(enemy);
      if (isCrit || enemy.hp <= 0) triggeredHitstop = true;
      if (enemy.hp <= 0) killedEnemies.push(enemy);
    }

    if (hitEnemies.length > 0 && hasPerfectDodgeBuff) {
      player.perfectDodgeBuffTimer = 0;
    }

    return {
      cast: true,
      spellId,
      hitEnemies,
      killedEnemies,
      healAmount: 0,
      triggeredHitstop,
      shakeAmount: 0.26,
    };
  }

  // Sort 7 : Chute d'Étoiles (Pluie stellaire prolongée ciblée au curseur et verrouillée au lancer)
  if (spellId === 'meteor_paw') {
    const castRange = def.castRange ?? 12.0;
    const lockedTarget = resolveStarfallTarget(
      player,
      options?.aimWorldPos,
      enemies,
      castRange,
      options?.clampTargetPoint,
    );
    const targetX = lockedTarget.x;
    const targetZ = lockedTarget.z;
    const castAngle = angleBetween(player.x, player.z, targetX, targetZ);

    const hasPerfectDodgeBuff = (player.perfectDodgeBuffTimer ?? 0) > 0;
    const outgoingMult =
      getOutgoingDamageMultiplier(player) *
      (hasPerfectDodgeBuff ? PERFECT_DODGE_DAMAGE_MULT : 1.0);
    const effectiveSpellPower = spellPower * outgoingMult;
    if (hasPerfectDodgeBuff) {
      player.perfectDodgeBuffTimer = 0;
    }

    const starSeeds: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      starSeeds.push(rng());
    }

    options?.activeSpellEffects?.push({
      id: `spell_fx_${nextSpellEffectId++}`,
      spellId,
      x: targetX,
      z: targetZ,
      targetX,
      targetZ,
      angle: castAngle,
      radius: def.radius,
      elapsed: 0,
      duration: STARFALL_DURATION,
      waveCount: STARFALL_WAVE_COUNT,
      wavesTriggered: 1,
      waveInterval: STARFALL_WAVE_INTERVAL,
      starSeeds,
      spellDamage: effectiveSpellPower,
      spellCritChance: player.stats.critChance,
    });
    events.push({
      type: 'spell_cast',
      x: targetX,
      z: targetZ,
      targetX,
      targetZ,
      angle: castAngle,
      radius: def.radius,
      spellId,
      color: def.color,
    });

    const hitEnemies: EnemyInstance[] = [];
    const killedEnemies: EnemyInstance[] = [];
    let triggeredHitstop = false;

    // 1re salve d'impact stellaire immédiate (vagues 2..4 déclenchées sur ~2.15 s au point verrouillé)
    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      if (!isPointInCircle(enemy.x, enemy.z, targetX, targetZ, def.radius, enemy.radius)) {
        continue;
      }
      const staggerMult = (enemy.staggeredTimer ?? 0) > 0 ? STAGGER_DAMAGE_MULT : 1.0;
      const totalDmgMult = getIncomingDamageMultiplier(enemy) * staggerMult;
      const { damage, isCrit } = calculatePlayerDamage(
        effectiveSpellPower * totalDmgMult,
        player.stats.critChance,
        rng,
      );
      enemy.hp = Math.max(0, enemy.hp - damage);
      enemy.hitFlashTimer = 0.18;
      enemy.aggroed = true;
      const kbScale = enemy.isBoss ? 0.2 : 1.0;
      const kbDir = normalize(enemy.x - targetX, enemy.z - targetZ);
      enemy.knockbackVx = kbDir.x * 8.5 * kbScale;
      enemy.knockbackVz = kbDir.z * 8.5 * kbScale;

      events.push({
        type: 'hit_enemy',
        x: enemy.x,
        z: enemy.z,
        value: damage,
        isCrit,
        spellId,
        enemyId: enemy.id,
        enemyTypeId: enemy.typeId,
        enemyMaterial: getEnemyDefinition(enemy.typeId).materialSound,
      });
      if (enemy.hp > 0 && applyEnemyStagger(enemy, 35, options?.telegraphs, events)) {
        triggeredHitstop = true;
      }
      hitEnemies.push(enemy);
      if (isCrit || enemy.hp <= 0) triggeredHitstop = true;
      if (enemy.hp <= 0) killedEnemies.push(enemy);
    }

    return {
      cast: true,
      spellId,
      hitEnemies,
      killedEnemies,
      healAmount: 0,
      triggeredHitstop,
      shakeAmount: 0.55,
    };
  }

  // Sorts offensifs historiques : flamepurr, lightnyan, freezepaw
  const effectDuration = spellId === 'freezepaw' ? 0.55 : 0.45;
  options?.activeSpellEffects?.push({
    id: `spell_fx_${nextSpellEffectId++}`,
    spellId,
    x: player.x,
    z: player.z,
    angle: player.aimAngle,
    radius: def.radius,
    width: def.width,
    elapsed: 0,
    duration: effectDuration,
  });

  events.push({
    type: 'spell_cast',
    x: player.x,
    z: player.z,
    angle: player.aimAngle,
    radius: def.radius,
    spellId,
    color: def.color,
  });

  const hasPerfectDodgeBuff = (player.perfectDodgeBuffTimer ?? 0) > 0;
  const outgoingMult =
    getOutgoingDamageMultiplier(player) *
    (hasPerfectDodgeBuff ? PERFECT_DODGE_DAMAGE_MULT : 1.0);
  const hitEnemies: EnemyInstance[] = [];
  const killedEnemies: EnemyInstance[] = [];
  let triggeredHitstop = false;

  const lineDirX = Math.cos(player.aimAngle);
  const lineDirZ = Math.sin(player.aimAngle);

  for (const enemy of enemies) {
    if (enemy.state === 'dead' || enemy.hp <= 0) continue;

    let hit = false;
    if (spellId === 'flamepurr' || spellId === 'freezepaw') {
      hit = isPointInCircle(
        enemy.x,
        enemy.z,
        player.x,
        player.z,
        def.radius,
        enemy.radius,
      );
    } else if (spellId === 'lightnyan') {
      hit = isPointInLine(
        enemy.x,
        enemy.z,
        player.x,
        player.z,
        player.aimAngle,
        def.radius,
        def.width ?? 2.0,
        enemy.radius,
      );
    }

    if (!hit) continue;

    const staggerMult = (enemy.staggeredTimer ?? 0) > 0 ? STAGGER_DAMAGE_MULT : 1.0;
    const totalDmgMult = outgoingMult * getIncomingDamageMultiplier(enemy) * staggerMult;
    const { damage, isCrit } = calculatePlayerDamage(
      spellPower * totalDmgMult,
      player.stats.critChance,
      rng,
    );

    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlashTimer = 0.14;
    enemy.aggroed = true;

    if (spellId === 'freezepaw') {
      const slowDur = def.slowDuration ?? 3.5;
      enemy.slowTimer = Math.max(enemy.slowTimer, slowDur);
      if (enemy.hp > 0) {
        applyStatusEffect(
          enemy,
          { statusId: 'chill', chance: 1.0, durationSec: slowDur, potency: FREEZEPAW_SLOW_FACTOR },
          events,
          { rng, sourceId: 'freezepaw', enemyId: enemy.id, enemyTypeId: enemy.typeId },
        );
      }
    } else if (spellId === 'flamepurr' && enemy.hp > 0) {
      applyStatusEffect(
        enemy,
        { statusId: 'burn', chance: 0.35, durationSec: 3.5, potency: 5 },
        events,
        { rng, sourceId: 'flamepurr', enemyId: enemy.id, enemyTypeId: enemy.typeId },
      );
    } else if (spellId === 'lightnyan' && enemy.hp > 0) {
      const applied = applyStatusEffect(
        enemy,
        { statusId: 'shock', chance: 0.3, durationSec: 2.5, potency: 1 },
        events,
        { rng, sourceId: 'lightnyan', enemyId: enemy.id, enemyTypeId: enemy.typeId },
      );
      if (applied) {
        enemy.attackCooldown += 0.18;
      }
    }

    // Recul léger
    const kbScale = enemy.isBoss ? 0.15 : 1.0;
    const kbDir =
      spellId === 'lightnyan'
        ? { x: lineDirX, z: lineDirZ }
        : normalize(enemy.x - player.x, enemy.z - player.z);
    enemy.knockbackVx = kbDir.x * 6.0 * kbScale;
    enemy.knockbackVz = kbDir.z * 6.0 * kbScale;

    events.push({
      type: 'hit_enemy',
      x: enemy.x,
      z: enemy.z,
      value: damage,
      isCrit,
      spellId,
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      enemyMaterial: getEnemyDefinition(enemy.typeId).materialSound,
    });

    if (enemy.hp > 0) {
      const spellStagger = spellId === 'lightnyan' ? 18 : 16;
      if (applyEnemyStagger(enemy, spellStagger, options?.telegraphs, events)) {
        triggeredHitstop = true;
      }
    }

    hitEnemies.push(enemy);
    if (isCrit || enemy.hp <= 0) {
      triggeredHitstop = true;
    }
    if (enemy.hp <= 0) {
      killedEnemies.push(enemy);
    }
  }

  if (hitEnemies.length > 0 && hasPerfectDodgeBuff) {
    player.perfectDodgeBuffTimer = 0;
  }

  return {
    cast: true,
    spellId,
    hitEnemies,
    killedEnemies,
    healAmount: 0,
    triggeredHitstop,
    shakeAmount: 0.35,
  };
}

/**
 * Met à jour la régénération périodique de Soin-velours (3 ticks de 8 % maxHp sur 3 s).
 */
export function updatePlayerRegen(
  player: PlayerState,
  dt: number,
  events: GameEvent[],
): number {
  if (player.hp <= 0 || player.regenTimer <= 0 || dt <= 0) {
    return 0;
  }

  const def = getSpellDefinition('healing_paw');
  const tickCount = def.regenTicks ?? 3;
  const totalDur = def.regenDuration ?? 3.0;
  const tickInterval = totalDur / tickCount;
  const tickPct = def.regenTickPct ?? 0.08;

  const step = Math.min(dt, player.regenTimer);
  player.regenTimer = Math.max(0, player.regenTimer - step);
  player.regenTickAccum += step;

  let ticksFired = 0;
  while (player.regenTickAccum >= tickInterval - 1e-6) {
    player.regenTickAccum = Math.max(0, player.regenTickAccum - tickInterval);
    const heal = Math.round(player.maxHp * tickPct);
    player.hp = Math.min(player.maxHp, player.hp + heal);
    ticksFired += 1;
    events.push({
      type: 'heal_tick',
      x: player.x,
      z: player.z,
      value: heal,
      text: `+${heal} PV`,
      spellId: 'healing_paw',
    });
  }

  if (player.regenTimer <= 1e-6) {
    player.regenTimer = 0;
    player.regenTickAccum = 0;
  }

  return ticksFired;
}

// --- Application de dégâts au joueur (bouclier Égide, i-frames & mitigation DEF) ---

export interface PlayerHitResult {
  hit: boolean;
  blockedByInvuln: boolean;
  absorbedByShield?: number;
  damage: number;
  died: boolean;
}

export function updatePlayerShield(player: PlayerState, dt: number): void {
  if (dt <= 0) return;
  if ((player.shieldTimer ?? 0) > 0) {
    player.shieldTimer = Math.max(0, (player.shieldTimer ?? 0) - dt);
    if (player.shieldTimer <= 1e-6 || (player.shieldHp ?? 0) <= 0) {
      player.shieldTimer = 0;
      player.shieldHp = 0;
      player.shieldMaxHp = 0;
    }
  } else if ((player.shieldHp ?? 0) > 0) {
    player.shieldHp = 0;
    player.shieldMaxHp = 0;
  }
}

export function applyDamageToPlayer(
  player: PlayerState,
  rawEnemyAtk: number,
  sourceX: number,
  sourceZ: number,
  events: GameEvent[],
): PlayerHitResult {
  if (player.hp <= 0) {
    return { hit: false, blockedByInvuln: false, damage: 0, died: false };
  }

  if (player.invulnTimer > 0) {
    return { hit: false, blockedByInvuln: true, damage: 0, died: false };
  }

  let damage = calculateEnemyDamage(
    rawEnemyAtk * getIncomingDamageMultiplier(player),
    player.stats.def,
  );
  let absorbedByShield = 0;

  // Absorption prioritaire par le bouclier temporaire (Égide de Ronron)
  if ((player.shieldHp ?? 0) > 0 && (player.shieldTimer ?? 0) > 0) {
    const currentShield = player.shieldHp ?? 0;
    absorbedByShield = Math.min(currentShield, damage);
    const remainingShield = currentShield - absorbedByShield;
    damage -= absorbedByShield;
    player.shieldHp = remainingShield;
    if (remainingShield <= 0) {
      player.shieldTimer = 0;
      player.shieldMaxHp = 0;
    }

    if (damage <= 0) {
      player.invulnTimer = 0.25;
      events.push({
        type: 'hit_player',
        x: player.x,
        z: player.z,
        value: 0,
        blocked: true,
        absorbedByShield: true,
        text: 'BOUCLIER !',
        spellId: 'aegis_purr',
      });
      return {
        hit: true,
        blockedByInvuln: false,
        absorbedByShield,
        damage: 0,
        died: false,
      };
    }
  }

  player.hp = Math.max(0, player.hp - damage);
  player.invulnTimer = POST_HIT_IFRAMES;
  player.hitFlashTimer = 0.14;

  const kbDir = normalize(player.x - sourceX, player.z - sourceZ);
  player.knockbackVx = kbDir.x * 7.5;
  player.knockbackVz = kbDir.z * 7.5;

  events.push({
    type: 'hit_player',
    x: player.x,
    z: player.z,
    value: damage,
    ...(absorbedByShield > 0 ? { absorbedByShield: true } : {}),
  });

  const died = player.hp <= 0;
  if (died) {
    events.push({
      type: 'player_died',
      x: player.x,
      z: player.z,
    });
  }

  return {
    hit: true,
    blockedByInvuln: false,
    absorbedByShield,
    damage,
    died,
  };
}
