// ============================================================================
// Système de Combat : Combo Mêlée 3 coups (+MP), Roulade i-frames (dodge-cancel),
// 4 Sorts VF, Formules de Dégâts & Mitigation DEF.
// Zéro import Three.js, zéro dépendance DOM.
// ============================================================================

import { getSpellDefinition, getSpellPower } from '../data/spellsData';
import {
  angleBetween,
  distSq,
  isPointInCircle,
  isPointInCone,
  isPointInLine,
  normalize,
} from './math';
import type {
  ActiveSpellEffect,
  DodgeGhost,
  EnemyInstance,
  GameEvent,
  PlayerState,
  SpellId,
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

// --- Mêlée 3 coups + Recharge Mana ---

export interface MeleeAttackResult {
  executed: boolean;
  comboStep: 0 | 1 | 2;
  hitEnemies: EnemyInstance[];
  killedEnemies: EnemyInstance[];
  totalMpRestored: number;
  triggeredHitstop: boolean;
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
  },
): MeleeAttackResult {
  const rng = options?.rng ?? Math.random;
  if (player.hp <= 0 || player.attackCooldown > 0 || player.dodgeTimer > 0) {
    return {
      executed: false,
      comboStep: player.comboStep,
      hitEnemies: [],
      killedEnemies: [],
      totalMpRestored: 0,
      triggeredHitstop: false,
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

  player.attackCooldown = cfg.cooldown;
  player.attackAnimTimer = Math.min(cfg.cooldown, 0.22);
  player.comboResetTimer = COMBO_RESET_WINDOW;
  player.comboStep = ((stepIndex + 1) % 3) as 0 | 1 | 2;
  player.lastMeleeAngle = player.aimAngle;

  const dirX = Math.cos(player.aimAngle);
  const dirZ = Math.sin(player.aimAngle);
  if (Math.abs(dirX) > 0.05) {
    player.facingX = dirX >= 0 ? 1 : -1;
  }

  // Léger dash avant
  const dashX = dirX * cfg.dashDist;
  const dashZ = dirZ * cfg.dashDist;
  if (options?.applyDash) {
    options.applyDash(dashX, dashZ);
  } else {
    player.x += dashX;
    player.z += dashZ;
  }

  events.push({
    type: 'melee_swing',
    x: player.x,
    z: player.z,
    angle: player.aimAngle,
    radius: MELEE_RANGE,
    comboStep: stepIndex,
  });

  const hitEnemies: EnemyInstance[] = [];
  const killedEnemies: EnemyInstance[] = [];
  let totalMpRestored = 0;
  let triggeredHitstop = false;
  let shakeAmount = 0.08;

  for (const enemy of enemies) {
    if (enemy.state === 'dead' || enemy.hp <= 0) continue;

    const inArc = isPointInCone(
      enemy.x,
      enemy.z,
      player.x,
      player.z,
      player.aimAngle,
      MELEE_RANGE,
      cfg.arcAngle,
      enemy.radius,
    );
    if (!inArc) continue;

    const { damage, isCrit } = calculatePlayerDamage(
      player.stats.atk * cfg.damageMult,
      player.stats.critChance,
      rng,
    );

    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlashTimer = 0.12;
    enemy.aggroed = true;

    // Knockback
    const kbDir = normalize(enemy.x - player.x, enemy.z - player.z);
    const kbScale = enemy.isBoss ? 0.2 : 1.0;
    const kbForce = cfg.knockback * kbScale;
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
      comboStep: stepIndex,
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

    hitEnemies.push(enemy);
    shakeAmount = Math.max(shakeAmount, isCrit || cfg.isFinisher ? 0.24 : 0.15);

    if (isCrit || cfg.isFinisher || enemy.hp <= 0) {
      triggeredHitstop = true;
    }

    if (enemy.hp <= 0) {
      killedEnemies.push(enemy);
    }
  }

  return {
    executed: true,
    comboStep: stepIndex,
    hitEnemies,
    killedEnemies,
    totalMpRestored,
    triggeredHitstop,
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
  if (player.hp <= 0 || player.dodgeCooldown > 0 || player.dodgeTimer > 0) {
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
    rng?: () => number;
  },
): SpellCastResult {
  const rng = options?.rng ?? Math.random;
  if (player.hp <= 0) {
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

  // Sort 4 : Soin-velours
  if (spellId === 'healing_paw') {
    const instantPct = def.instantHealPct ?? 0.25;
    const rawHeal = Math.round(player.maxHp * instantPct + spellPower);
    const prevHp = player.hp;
    player.hp = Math.min(player.maxHp, player.hp + rawHeal);
    const actualHeal = Math.max(0, player.hp - prevHp);

    player.regenTimer = def.regenDuration ?? 3.0;
    player.regenTickAccum = 0;

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

      const { damage, isCrit } = calculatePlayerDamage(
        spellPower,
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
      });
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
      shakeAmount: 0.26,
    };
  }

  // Sort 7 : Chute d'Étoiles (Dégâts de zone massifs projetés devant le héros)
  if (spellId === 'meteor_paw') {
    const castRange = def.castRange ?? 5.5;
    let targetX = player.x + Math.cos(player.aimAngle) * Math.min(4.2, castRange);
    let targetZ = player.z + Math.sin(player.aimAngle) * Math.min(4.2, castRange);

    // Accroche douce sur l'ennemi vivant le plus proche dans le cône avant
    let bestDist = castRange + 2.2;
    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      const d = Math.hypot(enemy.x - player.x, enemy.z - player.z);
      if (d < bestDist) {
        bestDist = d;
        const clamped = Math.min(d, castRange);
        const dir = normalize(enemy.x - player.x, enemy.z - player.z);
        targetX = player.x + dir.x * clamped;
        targetZ = player.z + dir.z * clamped;
      }
    }
    if (options?.clampTargetPoint) {
      const clampedPt = options.clampTargetPoint(targetX, targetZ);
      targetX = clampedPt.x;
      targetZ = clampedPt.z;
    }

    options?.activeSpellEffects?.push({
      id: `spell_fx_${nextSpellEffectId++}`,
      spellId,
      x: targetX,
      z: targetZ,
      angle: player.aimAngle,
      radius: def.radius,
      elapsed: 0,
      duration: 0.88,
    });
    events.push({
      type: 'spell_cast',
      x: targetX,
      z: targetZ,
      angle: player.aimAngle,
      radius: def.radius,
      spellId,
      color: def.color,
    });

    const hitEnemies: EnemyInstance[] = [];
    const killedEnemies: EnemyInstance[] = [];
    let triggeredHitstop = false;

    for (const enemy of enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      if (!isPointInCircle(enemy.x, enemy.z, targetX, targetZ, def.radius, enemy.radius)) {
        continue;
      }
      const { damage, isCrit } = calculatePlayerDamage(
        spellPower,
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
      });
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

    const { damage, isCrit } = calculatePlayerDamage(
      spellPower,
      player.stats.critChance,
      rng,
    );

    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.hitFlashTimer = 0.14;
    enemy.aggroed = true;

    if (spellId === 'freezepaw') {
      const slowDur = def.slowDuration ?? 3.5;
      enemy.slowTimer = Math.max(enemy.slowTimer, slowDur);
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
    });

    hitEnemies.push(enemy);
    if (isCrit || enemy.hp <= 0) {
      triggeredHitstop = true;
    }
    if (enemy.hp <= 0) {
      killedEnemies.push(enemy);
    }
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

  let damage = calculateEnemyDamage(rawEnemyAtk, player.stats.def);
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
