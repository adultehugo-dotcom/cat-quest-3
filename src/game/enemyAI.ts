// ============================================================================
// IA des Ennemis, Génération & Résolution des Télégraphes, Pièges & Boss 2 Phases
// Zéro import Three.js, zéro dépendance DOM.
// ============================================================================

import { getEnemyDefinition } from '../data/enemiesData';
import { VILLAGE_SAFE_ZONE, isInsideVillage } from '../data/worldData';
import {
  FREEZEPAW_SLOW_FACTOR,
  PLAYER_RADIUS,
  applyDamageToPlayer,
} from './combat';
import {
  angleBetween,
  angleDiff,
  clamp,
  dist,
  isPointInCircle,
  isPointInCone,
  isPointInLine,
  isTargetInTelegraph,
  lerp,
  normalize,
  resolveCircleAABB,
  resolveCircleCircle,
} from './math';
import {
  applyStatusEffect,
  getChillSlowFactor,
  getOutgoingDamageMultiplier,
  isEntityStunned,
} from './statusEffects';
import type {
  EnemyAttackPattern,
  EnemyDefinition,
  EnemyInstance,
  EnemyProjectile,
  EnemyProjectileKind,
  EnemySkillBehavior,
  EnemySpawnDef,
  GameEvent,
  HazardZone,
  HazardZoneKind,
  PlayerState,
  TelegraphElement,
  TelegraphZone,
  TrapInstance,
  Vec2,
  ZoneId,
} from './types';

export const OVERWORLD_RESPAWN_TIME = 35;
export const OVERWORLD_RESPAWN_MIN_PLAYER_DIST = 25;

let nextTelegraphId = 1;
let nextEnemyProjectileId = 1;
let nextHazardZoneId = 1;

function inferTelegraphElement(pattern: EnemyAttackPattern): TelegraphElement {
  if (pattern.element) return pattern.element;
  if (pattern.statusProc?.statusId === 'chill') return 'frost';
  if (pattern.statusProc?.statusId === 'burn') return 'fire';
  if (pattern.statusProc?.statusId === 'poison') return 'poison';
  if (pattern.statusProc?.statusId === 'curse') return 'spectral';
  return 'physical';
}

function defaultElementColor(element: TelegraphElement): string {
  switch (element) {
    case 'frost':
      return '#38bdf8';
    case 'fire':
      return '#ff6b1a';
    case 'poison':
      return '#4ade80';
    case 'spectral':
      return '#a855f7';
    case 'physical':
    default:
      return '#ff3b30';
  }
}

const PROJECTILE_SPAWN_BEHAVIORS = new Set<EnemySkillBehavior>([
  'goblin_dagger_throw',
  'boomerang_bone',
  'cheese_wheel',
  'homing_orb',
  'spectral_scythe',
]);

/**
 * Instancie un ennemi à partir d'un point de spawn.
 */
export function createEnemyInstance(spawn: EnemySpawnDef): EnemyInstance {
  const def = getEnemyDefinition(spawn.typeId);
  return {
    id: spawn.id,
    typeId: spawn.typeId,
    name: def.name,
    level: spawn.levelOverride ?? def.level,
    x: spawn.x,
    z: spawn.z,
    homeX: spawn.x,
    homeZ: spawn.z,
    facingX: -1,
    hp: def.maxHp,
    maxHp: def.maxHp,
    radius: def.radius,
    state: 'idle',
    stateTimer: 0,
    attackCooldown: 0.45,
    slowTimer: 0,
    hitFlashTimer: 0,
    phase: 1,
    isBoss: def.isBoss,
    respawnTimer: 0,
    vx: 0,
    vz: 0,
    knockbackVx: 0,
    knockbackVz: 0,
    attackPatternIndex: 0,
    activePatternId: undefined,
    activeLungeAngle: undefined,
    activeLungeDist: undefined,
    aggroed: false,
    activeStatuses: [],
    stagger: 0,
    maxStagger: def.maxStagger ?? 0,
    staggeredTimer: 0,
    staggerDecayDelay: 0,
    deathTimer: 0,
    deathDuration: 0,
    introPlayed: false,
  };
}

/**
 * Vérifie et déclenche la transition Phase 2 d'un Boss (ex: Drak-Miaou à <= 50 % PV).
 */
export function checkBossPhaseTransition(
  enemy: EnemyInstance,
  events: GameEvent[],
): boolean {
  if (enemy.state === 'dead' || enemy.hp <= 0 || enemy.phase !== 1) {
    return false;
  }
  const def = getEnemyDefinition(enemy.typeId);
  if (!def.hasPhaseTwo) return false;

  const threshold = def.phaseTwoThreshold ?? 0.5;
  if (enemy.hp <= enemy.maxHp * threshold) {
    enemy.phase = 2;

    // Oriente la prochaine attaque vers l'attaque signature de phase 2 (ring) si présente
    const phase2Index = def.patterns.findIndex((p) => (p.phaseMin ?? 1) >= 2);
    if (phase2Index >= 0) {
      enemy.attackPatternIndex = phase2Index;
    }

    events.push({
      type: 'boss_phase_two',
      x: enemy.x,
      z: enemy.z,
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      text: def.phaseTwoDialogue ?? 'Phase 2 !',
    });
    return true;
  }

  return false;
}

/**
 * Sélectionne le prochain pattern d'attaque éligible en effectuant une rotation propre.
 */
export function selectAttackPattern(
  enemy: EnemyInstance,
  def: EnemyDefinition,
  distToPlayer: number,
): EnemyAttackPattern | null {
  const count = def.patterns.length;
  if (count === 0) return null;

  const startIdx = (enemy.attackPatternIndex ?? 0) % count;
  for (let offset = 0; offset < count; offset++) {
    const idx = (startIdx + offset) % count;
    const pattern = def.patterns[idx];
    const phaseMin = pattern.phaseMin ?? 1;
    const minRange = pattern.minRange ?? 0;

    if (
      enemy.phase >= phaseMin &&
      distToPlayer <= pattern.triggerRange &&
      distToPlayer >= minRange
    ) {
      enemy.attackPatternIndex = (idx + 1) % count;
      return pattern;
    }
  }

  return null;
}

/**
 * Crée les TelegraphZone correspondant à un pattern d'attaque ennemi.
 */
export function spawnTelegraphsForPattern(
  enemy: EnemyInstance,
  def: EnemyDefinition,
  pattern: EnemyAttackPattern,
  player: PlayerState,
  telegraphs: TelegraphZone[],
  options?: {
    rng?: () => number;
    clampPoint?: (x: number, z: number) => Vec2;
  },
): { created: TelegraphZone[]; duration: number } {
  const rng = options?.rng ?? Math.random;
  const speedMult =
    enemy.phase === 2 && def.phaseTwoSpeedMult ? def.phaseTwoSpeedMult : 1;
  const duration = pattern.windupDuration / speedMult;
  const damage = Math.max(1, Math.round(def.atk * pattern.damageMultiplier));
  const angle = angleBetween(enemy.x, enemy.z, player.x, player.z);

  const count =
    enemy.phase === 2 && pattern.multiCountPhase2
      ? pattern.multiCountPhase2
      : (pattern.multiCount ?? 1);

  const created: TelegraphZone[] = [];
  const element = inferTelegraphElement(pattern);
  const color = pattern.color ?? defaultElementColor(element);
  const skillBehavior: EnemySkillBehavior = pattern.skillBehavior ?? 'standard';

  // Vague séquentielle (ex: Golem de Givre pics glacés radiants)
  if (skillBehavior === 'ice_spikes_wave') {
    const seqCount = Math.max(2, pattern.sequentialCount ?? 3);
    const stepDelay = pattern.sequentialStepDelay ?? 0.24;
    const stepDist = pattern.sequentialStepDist ?? 2.4;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    for (let i = 0; i < seqCount; i++) {
      const distOut = 1.9 + i * stepDist;
      const rawX = enemy.x + dirX * distOut;
      const rawZ = enemy.z + dirZ * distOut;
      const pos = options?.clampPoint ? options.clampPoint(rawX, rawZ) : { x: rawX, z: rawZ };
      const tz: TelegraphZone = {
        id: `tg_${nextTelegraphId++}`,
        ownerId: enemy.id,
        ownerTypeId: enemy.typeId,
        patternId: pattern.id,
        shape: pattern.shape,
        x: pos.x,
        z: pos.z,
        angle,
        radius: pattern.radius + i * 0.25,
        innerRadius: pattern.innerRadius,
        width: pattern.width,
        arcAngle: pattern.arcAngle,
        elapsed: 0,
        duration,
        delaySec: i * stepDelay,
        damage,
        color,
        element,
        skillBehavior,
        resolved: false,
        ...(pattern.statusProc ? { statusProc: { ...pattern.statusProc } } : {}),
      };
      telegraphs.push(tz);
      created.push(tz);
    }
    return { created, duration };
  }

  // Croix infernale multi-directionnelle (Drak-Miaou Phase 2)
  if (skillBehavior === 'inferno_cross') {
    for (let i = 0; i < 4; i++) {
      const lineAngle = angle + (i * Math.PI) / 2;
      const tz: TelegraphZone = {
        id: `tg_${nextTelegraphId++}`,
        ownerId: enemy.id,
        ownerTypeId: enemy.typeId,
        patternId: pattern.id,
        shape: 'line',
        x: enemy.x,
        z: enemy.z,
        angle: lineAngle,
        radius: pattern.radius,
        width: pattern.width ?? 2.3,
        elapsed: 0,
        duration,
        damage,
        color,
        element,
        skillBehavior,
        resolved: false,
        ...(pattern.statusProc ? { statusProc: { ...pattern.statusProc } } : {}),
      };
      telegraphs.push(tz);
      created.push(tz);
    }
    return { created, duration };
  }

  if (count <= 1) {
    const basePos = pattern.targetAtPlayer
      ? { x: player.x, z: player.z }
      : { x: enemy.x, z: enemy.z };
    const pos = options?.clampPoint
      ? options.clampPoint(basePos.x, basePos.z)
      : basePos;

    const halfArc = (pattern.arcAngle ?? Math.PI * 0.43) * 0.5;
    const tz: TelegraphZone = {
      id: `tg_${nextTelegraphId++}`,
      ownerId: enemy.id,
      ownerTypeId: enemy.typeId,
      patternId: pattern.id,
      shape: pattern.shape,
      x: pos.x,
      z: pos.z,
      angle,
      radius: pattern.radius,
      innerRadius: pattern.innerRadius,
      width: pattern.width,
      arcAngle: pattern.arcAngle,
      elapsed: 0,
      duration,
      damage,
      color,
      element,
      skillBehavior,
      ...(skillBehavior === 'flame_jet_sweep'
        ? {
            sweepProgress: 0,
            sweepStartAngle: angle - halfArc,
            sweepEndAngle: angle + halfArc,
          }
        : {}),
      resolved: false,
      ...(pattern.statusProc ? { statusProc: { ...pattern.statusProc } } : {}),
    };
    telegraphs.push(tz);
    created.push(tz);
    return { created, duration };
  }

  // Zones multiples (ex: 3 cercles Roi Rat-Spectre, 3 ou 5 météores Dragon-Griffe)
  const spread = pattern.spreadRadius ?? 4.0;
  const baseAngleOffset = rng() * Math.PI * 2;

  for (let i = 0; i < count; i++) {
    let tx = player.x;
    let tzCoord = player.z;
    if (i > 0) {
      const a = baseAngleOffset + ((i - 1) * Math.PI * 2) / (count - 1);
      const r = spread * (0.65 + 0.35 * rng());
      tx += Math.cos(a) * r;
      tzCoord += Math.sin(a) * r;
    }

    const pos = options?.clampPoint ? options.clampPoint(tx, tzCoord) : { x: tx, z: tzCoord };
    const tz: TelegraphZone = {
      id: `tg_${nextTelegraphId++}`,
      ownerId: enemy.id,
      ownerTypeId: enemy.typeId,
      patternId: pattern.id,
      shape: pattern.shape,
      x: pos.x,
      z: pos.z,
      angle,
      radius: pattern.radius,
      innerRadius: pattern.innerRadius,
      width: pattern.width,
      arcAngle: pattern.arcAngle,
      elapsed: 0,
      duration,
      damage,
      color,
      element,
      skillBehavior,
      resolved: false,
      ...(pattern.statusProc ? { statusProc: { ...pattern.statusProc } } : {}),
    };
    telegraphs.push(tz);
    created.push(tz);
  }

  return { created, duration };
}

/**
 * Met à jour les pièges périodiques des salles de donjon (ex: Couloir des Ossements).
 */
export function updateTraps(
  traps: TrapInstance[],
  player: PlayerState,
  telegraphs: TelegraphZone[],
  dt: number,
): void {
  if (traps.length === 0 || dt <= 0) return;

  for (const trap of traps) {
    // Active le piège lorsque le joueur est proche de la salle
    if (dist(player.x, player.z, trap.x, trap.z) > 18) {
      continue;
    }

    trap.timer -= dt;
    if (trap.timer <= 0) {
      trap.timer += trap.interval;
      telegraphs.push({
        id: `tg_trap_${nextTelegraphId++}`,
        ownerId: trap.id,
        shape: 'circle',
        x: trap.x,
        z: trap.z,
        angle: 0,
        radius: trap.radius,
        elapsed: 0,
        duration: trap.windupDuration,
        damage: trap.damage,
        color: '#ff453a',
        resolved: false,
      });
    }
  }
}

export interface TelegraphUpdateResult {
  playerHit: boolean;
  playerDied: boolean;
  maxShake: number;
  resolvedCount: number;
}

function spawnSkillProjectilesFromTelegraph(
  tz: TelegraphZone,
  owner: EnemyInstance | undefined,
  pattern: EnemyAttackPattern | undefined,
  enemyProjectiles: EnemyProjectile[],
  events: GameEvent[],
): void {
  const behavior = tz.skillBehavior ?? pattern?.skillBehavior ?? 'standard';
  if (!PROJECTILE_SPAWN_BEHAVIORS.has(behavior)) return;

  const ownerTypeId = tz.ownerTypeId ?? owner?.typeId ?? 'mouse_goblin';
  const originX = owner ? owner.x : tz.x;
  const originZ = owner ? owner.z : tz.z;
  const element = tz.element ?? 'physical';
  const count = Math.max(1, pattern?.projectileCount ?? 1);
  const spreadRad = ((pattern?.projectileSpreadDeg ?? 0) * Math.PI) / 180;
  const speed = pattern?.projectileSpeed ?? 11.0;
  const radius = pattern?.projectileRadius ?? 0.5;
  const maxRange = pattern?.projectileRange ?? Math.max(8, tz.radius);

  let kind: EnemyProjectileKind = 'dagger';
  let color = tz.color ?? '#ff3b30';
  let accentColor = '#ffffff';
  let isBoomerang = false;
  let piercing = false;
  let homingTurnRate: number | undefined;

  if (behavior === 'goblin_dagger_throw') {
    kind = 'dagger';
    color = '#4ade80';
    accentColor = '#b9ff8a';
  } else if (behavior === 'boomerang_bone') {
    kind = 'fishbone';
    color = '#e8e4d5';
    accentColor = '#a855f7';
    isBoomerang = true;
    piercing = true;
  } else if (behavior === 'cheese_wheel') {
    kind = 'cheese_wheel';
    color = '#f5c542';
    accentColor = '#ffe999';
    piercing = true;
  } else if (behavior === 'homing_orb') {
    kind = 'spectral_orb';
    color = '#a855f7';
    accentColor = '#e9b8ff';
    homingTurnRate = pattern?.homingTurnRate ?? 2.1;
  } else if (behavior === 'spectral_scythe') {
    kind = 'spectral_scythe';
    color = '#a855f7';
    accentColor = '#e9b8ff';
    piercing = true;
  }

  for (let i = 0; i < count; i++) {
    const offset =
      count <= 1 ? 0 : ((i / (count - 1)) - 0.5) * spreadRad;
    const angle = tz.angle + offset;
    const vx = Math.cos(angle) * speed;
    const vz = Math.sin(angle) * speed;
    const proj: EnemyProjectile = {
      id: `eproj_${nextEnemyProjectileId++}`,
      ownerId: tz.ownerId,
      ownerTypeId,
      patternId: tz.patternId,
      kind,
      x: originX + Math.cos(angle) * 0.85,
      z: originZ + Math.sin(angle) * 0.85,
      startX: originX,
      startZ: originZ,
      vx,
      vz,
      speed,
      radius,
      distanceTraveled: 0,
      maxRange,
      age: 0,
      maxAge: isBoomerang ? 3.8 : Math.max(1.8, maxRange / Math.max(1, speed) + 0.6),
      damage: tz.damage,
      element,
      color,
      accentColor,
      ...(tz.statusProc ? { statusProc: { ...tz.statusProc } } : {}),
      ...(homingTurnRate ? { homingTurnRate } : {}),
      ...(isBoomerang
        ? {
            isBoomerang: true,
            returning: false,
            hitPlayerOnOutbound: false,
            hitPlayerOnInbound: false,
            returnSpeed: pattern?.boomerangReturnSpeed ?? speed * 1.08,
          }
        : {}),
      ...(piercing ? { piercing: true } : {}),
      spinAngle: 0,
    };
    enemyProjectiles.push(proj);
    events.push({
      type: 'enemy_projectile_spawned',
      x: proj.x,
      z: proj.z,
      angle,
      radius: proj.radius,
      enemyId: tz.ownerId,
      enemyTypeId: ownerTypeId,
      patternId: tz.patternId,
      element,
      color,
      accentColor,
      projectileKind: kind,
    });
  }
}

function spawnHazardZoneFromTelegraph(
  tz: TelegraphZone,
  owner: EnemyInstance | undefined,
  pattern: EnemyAttackPattern | undefined,
  hazardZones: HazardZone[],
  events: GameEvent[],
): void {
  const behavior = tz.skillBehavior ?? pattern?.skillBehavior ?? 'standard';
  const ownerTypeId = tz.ownerTypeId ?? owner?.typeId ?? 'slime_yarn';
  let kind: HazardZoneKind | null = null;
  let element: TelegraphElement = tz.element ?? 'physical';
  let color = tz.color ?? '#ff3b30';
  let tickInterval = 0.55;
  let slowFactor = pattern?.hazardSlowFactor;

  switch (behavior) {
    case 'slime_splatter':
      kind = 'slime_puddle';
      element = tz.element ?? 'poison';
      color = tz.patternId === 'yarn_bounce' ? '#ff70a6' : '#4ade80';
      slowFactor = slowFactor ?? 0.35;
      tickInterval = 0.65;
      break;
    case 'thorn_burst':
      kind = 'thorn_patch';
      element = 'physical';
      color = '#a64d79';
      tickInterval = 0.55;
      break;
    case 'toxic_miasma':
      kind = 'toxic_miasma';
      element = tz.element ?? 'poison';
      color = tz.element === 'spectral' ? '#a855f7' : '#4ade80';
      slowFactor = slowFactor ?? 0.25;
      tickInterval = 0.5;
      break;
    case 'abyssal_fissure':
      kind = 'abyssal_fissure';
      element = 'spectral';
      color = '#a855f7';
      tickInterval = 0.5;
      break;
    case 'meteor_rain':
    case 'thermal_shockwave':
    case 'inferno_cross':
      kind = 'scorch_crater';
      element = 'fire';
      color = '#ff6b1a';
      tickInterval = 0.5;
      break;
    case 'ice_spikes_wave':
      kind = 'frost_patch';
      element = 'frost';
      color = '#38bdf8';
      slowFactor = slowFactor ?? 0.3;
      tickInterval = 0.65;
      break;
    default:
      return;
  }

  const duration = pattern?.hazardDurationSec ?? 3.4;
  const radius = pattern?.hazardRadius ?? Math.min(3.2, tz.radius);
  const damagePerTick = Math.max(1, pattern?.hazardDamagePerSec ? Math.round(pattern.hazardDamagePerSec * tickInterval) : 3);
  const isLine = kind === 'abyssal_fissure' || behavior === 'inferno_cross';
  const hx = tz.x;
  const hz = tz.z;

  const zone: HazardZone = {
    id: `haz_${nextHazardZoneId++}`,
    ownerId: tz.ownerId,
    ownerTypeId,
    patternId: tz.patternId,
    kind,
    x: hx,
    z: hz,
    radius,
    ...(isLine ? { length: tz.radius, width: tz.width ?? 2.1, angle: tz.angle } : {}),
    elapsed: 0,
    duration,
    tickInterval,
    tickAccum: 0,
    damagePerTick,
    ...(slowFactor ? { slowFactor } : {}),
    ...(tz.statusProc ? { statusProc: { ...tz.statusProc } } : {}),
    element,
    color,
  };
  hazardZones.push(zone);
  events.push({
    type: 'hazard_zone_spawned',
    x: hx,
    z: hz,
    angle: tz.angle,
    radius,
    enemyId: tz.ownerId,
    enemyTypeId: ownerTypeId,
    patternId: tz.patternId,
    element,
    color,
    hazardKind: kind,
  });
}

/**
 * Fait progresser les télégraphes et résout exactement ceux dont `elapsed >= duration`.
 * Les télégraphes dont l'ennemi propriétaire vient de mourir sont annulés proprement.
 */
export function updateTelegraphs(
  telegraphs: TelegraphZone[],
  enemies: EnemyInstance[],
  player: PlayerState,
  dt: number,
  events: GameEvent[],
  options?: {
    rng?: () => number;
    enemyProjectiles?: EnemyProjectile[];
    hazardZones?: HazardZone[];
  },
): TelegraphUpdateResult {
  let playerHit = false;
  let playerDied = false;
  let maxShake = 0;
  let resolvedCount = 0;

  if (telegraphs.length === 0 || dt < 0) {
    return { playerHit, playerDied, maxShake, resolvedCount };
  }

  const rng = options?.rng ?? Math.random;
  const enemyById = new Map<string, EnemyInstance>();
  for (const enemy of enemies) {
    enemyById.set(enemy.id, enemy);
  }

  const remaining: TelegraphZone[] = [];

  for (const tz of telegraphs) {
    if (tz.resolved) continue;

    // Annule un télégraphe si l'ennemi qui le préparait est mort, brisé (staggered) ou étourdi
    const owner = enemyById.get(tz.ownerId);
    if (
      owner &&
      (owner.state === 'dead' ||
        owner.hp <= 0 ||
        owner.state === 'staggered' ||
        (owner.staggeredTimer ?? 0) > 0 ||
        isEntityStunned(owner))
    ) {
      continue;
    }

    // Délai séquentiel avant démarrage du remplissage (ex: pics de glace du Golem)
    if ((tz.delaySec ?? 0) > 0) {
      tz.delaySec = Math.max(0, (tz.delaySec ?? 0) - dt);
      remaining.push(tz);
      continue;
    }

    tz.elapsed += dt;
    if (tz.elapsed >= tz.duration) {
      tz.resolved = true;
      resolvedCount += 1;

      const resolvedEnemyTypeId = tz.ownerTypeId ?? owner?.typeId;
      const resolvedDef = resolvedEnemyTypeId ? getEnemyDefinition(resolvedEnemyTypeId) : undefined;
      const pattern = resolvedDef?.patterns.find((p) => p.id === tz.patternId);
      const behavior: EnemySkillBehavior = tz.skillBehavior ?? pattern?.skillBehavior ?? 'standard';

      events.push({
        type: 'telegraph_impact',
        x: tz.x,
        z: tz.z,
        angle: tz.angle,
        radius: tz.radius,
        shape: tz.shape,
        color: tz.color,
        element: tz.element,
        enemyId: tz.ownerId,
        enemyTypeId: resolvedEnemyTypeId,
        enemyMaterial: resolvedDef?.materialSound,
        patternId: tz.patternId,
      });

      const isBossAttack = owner?.isBoss ?? false;
      maxShake = Math.max(maxShake, isBossAttack ? 0.55 : 0.14);

      if (PROJECTILE_SPAWN_BEHAVIORS.has(behavior) && options?.enemyProjectiles) {
        spawnSkillProjectilesFromTelegraph(tz, owner, pattern, options.enemyProjectiles, events);
      } else {
        if (behavior === 'flame_jet_sweep' && owner && owner.state !== 'dead' && owner.hp > 0) {
          const halfArc = (tz.arcAngle ?? Math.PI * 0.43) * 0.5;
          owner.activeSweepStartAngle = tz.sweepStartAngle ?? (tz.angle - halfArc);
          owner.activeSweepEndAngle = tz.sweepEndAngle ?? (tz.angle + halfArc);
          owner.activeSweepElapsed = 0;
          owner.activeSweepDuration = pattern?.sweepDurationSec ?? 0.85;
          owner.activeSweepTickAccum = 0;
          owner.activeSweepPatternId = tz.patternId;
        }

        if (options?.hazardZones) {
          spawnHazardZoneFromTelegraph(tz, owner, pattern, options.hazardZones, events);
        }

        if (isTargetInTelegraph(tz, player.x, player.z, 0)) {
          const outgoingScale = owner ? getOutgoingDamageMultiplier(owner) : 1.0;
          const hitResult = applyDamageToPlayer(
            player,
            Math.max(1, Math.round(tz.damage * outgoingScale)),
            tz.x,
            tz.z,
            events,
          );
          if (hitResult.hit) {
            playerHit = true;
            maxShake = Math.max(maxShake, isBossAttack ? 0.6 : 0.35);
            if (hitResult.damage > 0 && player.hp > 0 && tz.statusProc) {
              applyStatusEffect(player, tz.statusProc, events, {
                rng,
                sourceId: tz.ownerId,
              });
            }
            if (hitResult.died) {
              playerDied = true;
            }
          }
        }
      }
    } else {
      remaining.push(tz);
    }
  }

  telegraphs.length = 0;
  for (const tz of remaining) {
    telegraphs.push(tz);
  }

  return { playerHit, playerDied, maxShake, resolvedCount };
}

export interface EnemyProjectileUpdateResult {
  playerHit: boolean;
  playerDied: boolean;
  maxShake: number;
}

/**
 * Met à jour tous les projectiles ennemis (linéaires, meules roulantes, orbes guidés, os boomerang).
 */
export function updateEnemyProjectiles(
  projectiles: EnemyProjectile[],
  enemies: EnemyInstance[],
  player: PlayerState,
  dt: number,
  events: GameEvent[],
  options?: {
    rng?: () => number;
    isObstacleHit?: (x: number, z: number, radius: number) => boolean;
  },
): EnemyProjectileUpdateResult {
  let playerHit = false;
  let playerDied = false;
  let maxShake = 0;
  if (projectiles.length === 0 || dt <= 0) {
    return { playerHit, playerDied, maxShake };
  }

  const rng = options?.rng ?? Math.random;
  const enemyById = new Map<string, EnemyInstance>();
  for (const enemy of enemies) {
    enemyById.set(enemy.id, enemy);
  }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.age += dt;
    p.spinAngle = (p.spinAngle ?? 0) + dt * 14;
    if (p.age >= p.maxAge) {
      projectiles.splice(i, 1);
      continue;
    }

    const owner = enemyById.get(p.ownerId);

    // Guidage progressif (orbes spectraux du Roi Rat-Spectre)
    if (p.homingTurnRate && p.homingTurnRate > 0 && !p.returning && player.hp > 0) {
      const currentAngle = Math.atan2(p.vz, p.vx);
      const desiredAngle = angleBetween(p.x, p.z, player.x, player.z);
      const delta = angleDiff(currentAngle, desiredAngle);
      const maxTurn = p.homingTurnRate * dt;
      const nextAngle = currentAngle + clamp(delta, -maxTurn, maxTurn);
      p.vx = Math.cos(nextAngle) * p.speed;
      p.vz = Math.sin(nextAngle) * p.speed;
    }

    // Boomerang : demi-tour vers le lanceur après maxRange ou mur
    if (p.isBoomerang && p.returning) {
      const targetX = owner && owner.state !== 'dead' && owner.hp > 0 ? owner.x : p.startX;
      const targetZ = owner && owner.state !== 'dead' && owner.hp > 0 ? owner.z : p.startZ;
      const dir = normalize(targetX - p.x, targetZ - p.z);
      const retSpeed = p.returnSpeed ?? p.speed * 1.08;
      p.vx = dir.x * retSpeed;
      p.vz = dir.z * retSpeed;
    }

    const stepDist = Math.hypot(p.vx, p.vz) * dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.distanceTraveled += stepDist;

    if (p.isBoomerang && p.returning) {
      const targetX = owner && owner.state !== 'dead' && owner.hp > 0 ? owner.x : p.startX;
      const targetZ = owner && owner.state !== 'dead' && owner.hp > 0 ? owner.z : p.startZ;
      if (dist(p.x, p.z, targetX, targetZ) <= 0.95) {
        projectiles.splice(i, 1);
        continue;
      }
    }

    const hitObstacle = options?.isObstacleHit?.(p.x, p.z, p.radius * 0.7) ?? false;
    if (hitObstacle || (!p.returning && p.distanceTraveled >= p.maxRange)) {
      if (p.isBoomerang && !p.returning) {
        p.returning = true;
        p.distanceTraveled = 0;
        p.vx = -p.vx;
        p.vz = -p.vz;
      } else {
        projectiles.splice(i, 1);
        continue;
      }
    }

    // Collision projectile -> joueur
    if (player.hp > 0 && dist(p.x, p.z, player.x, player.z) <= p.radius + PLAYER_RADIUS * 0.85) {
      const canHit =
        !p.isBoomerang || (p.returning ? !p.hitPlayerOnInbound : !p.hitPlayerOnOutbound);
      if (canHit) {
        const outgoingScale = owner ? getOutgoingDamageMultiplier(owner) : 1.0;
        const hitResult = applyDamageToPlayer(
          player,
          Math.max(1, Math.round(p.damage * outgoingScale)),
          p.x,
          p.z,
          events,
        );
        if (hitResult.hit) {
          playerHit = true;
          maxShake = Math.max(maxShake, owner?.isBoss ? 0.42 : 0.25);
          if (p.isBoomerang) {
            if (p.returning) {
              p.hitPlayerOnInbound = true;
            } else {
              p.hitPlayerOnOutbound = true;
            }
          }
          if (hitResult.damage > 0 && player.hp > 0 && p.statusProc) {
            applyStatusEffect(player, p.statusProc, events, {
              rng,
              sourceId: p.ownerId,
            });
          }
          if (hitResult.died) {
            playerDied = true;
          }
          if (!p.piercing && !p.isBoomerang) {
            projectiles.splice(i, 1);
            continue;
          }
        }
      }
    }
  }

  return { playerHit, playerDied, maxShake };
}

export interface HazardZoneUpdateResult {
  playerHit: boolean;
  playerDied: boolean;
  slowFactor: number;
}

/**
 * Met à jour les zones persistantes au sol (flaques, ronces, miasmes, cratères, fissures abyssales).
 */
export function updateHazardZones(
  zones: HazardZone[],
  player: PlayerState,
  dt: number,
  events: GameEvent[],
  options?: { rng?: () => number },
): HazardZoneUpdateResult {
  let playerHit = false;
  let playerDied = false;
  let slowFactor = 0;
  if (zones.length === 0 || dt <= 0) {
    return { playerHit, playerDied, slowFactor };
  }

  const rng = options?.rng ?? Math.random;

  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    z.elapsed += dt;
    if (z.elapsed >= z.duration) {
      zones.splice(i, 1);
      continue;
    }

    if (player.hp <= 0) continue;

    const inside =
      z.length !== undefined && z.width !== undefined && z.angle !== undefined
        ? isPointInLine(player.x, player.z, z.x, z.z, z.angle, z.length, z.width, PLAYER_RADIUS * 0.4)
        : isPointInCircle(player.x, player.z, z.x, z.z, z.radius, PLAYER_RADIUS * 0.35);

    if (!inside) {
      z.tickAccum = Math.min(z.tickAccum, z.tickInterval * 0.5);
      continue;
    }

    if (z.slowFactor && z.slowFactor > slowFactor) {
      slowFactor = z.slowFactor;
    }

    z.tickAccum += dt;
    if (z.tickAccum >= z.tickInterval) {
      z.tickAccum -= z.tickInterval;
      if (z.damagePerTick > 0) {
        const hitResult = applyDamageToPlayer(player, z.damagePerTick, z.x, z.z, events);
        if (hitResult.hit) {
          playerHit = true;
          if (hitResult.damage > 0 && player.hp > 0 && z.statusProc) {
            applyStatusEffect(player, z.statusProc, events, {
              rng,
              sourceId: z.ownerId,
            });
          }
          if (hitResult.died) {
            playerDied = true;
          }
        }
      }
    }
  }

  return { playerHit, playerDied, slowFactor };
}

export interface EnemyUpdateOptions {
  rng?: () => number;
  resolvePosition?: (x: number, z: number, radius: number) => Vec2;
  clampTelegraphPoint?: (x: number, z: number) => Vec2;
}

export interface EnemyUpdateResult {
  bossEnteredPhaseTwo: EnemyInstance | null;
}

function clampOutsideVillage(x: number, z: number, radius: number): Vec2 {
  const paddedRect = {
    minX: VILLAGE_SAFE_ZONE.minX - 0.5,
    maxX: VILLAGE_SAFE_ZONE.maxX + 0.5,
    minZ: VILLAGE_SAFE_ZONE.minZ - 0.5,
    maxZ: VILLAGE_SAFE_ZONE.maxZ + 0.5,
  };
  return resolveCircleAABB(x, z, radius, paddedRect);
}

/**
 * Met à jour l'IA de tous les ennemis actifs dans la zone.
 */
export function updateEnemies(
  enemies: EnemyInstance[],
  player: PlayerState,
  telegraphs: TelegraphZone[],
  zoneId: ZoneId,
  dt: number,
  events: GameEvent[],
  options?: EnemyUpdateOptions,
): EnemyUpdateResult {
  let bossEnteredPhaseTwo: EnemyInstance | null = null;
  if (dt <= 0) return { bossEnteredPhaseTwo };

  const playerInVillage =
    zoneId === 'overworld' && isInsideVillage(player.x, player.z);

  const resolvePos = (x: number, z: number, radius: number): Vec2 => {
    let pos: Vec2 = options?.resolvePosition
      ? options.resolvePosition(x, z, radius)
      : { x, z };
    if (zoneId === 'overworld') {
      pos = clampOutsideVillage(pos.x, pos.z, radius);
    }
    return pos;
  };

  for (const enemy of enemies) {
    const def = getEnemyDefinition(enemy.typeId);

    // --- Ennemi mort : projection de recul (deathTimer > 0) + respawn Overworld (35 s si joueur > 25 u) ---
    if (enemy.state === 'dead') {
      if ((enemy.deathTimer ?? 0) > 0) {
        enemy.deathTimer = Math.max(0, (enemy.deathTimer ?? 0) - dt);
        const kx = enemy.knockbackVx ?? 0;
        const kz = enemy.knockbackVz ?? 0;
        if (Math.hypot(kx, kz) > 0.08) {
          const next = resolvePos(enemy.x + kx * dt, enemy.z + kz * dt, enemy.radius);
          enemy.x = next.x;
          enemy.z = next.z;
          const damp = Math.exp(-8.5 * dt);
          enemy.knockbackVx = kx * damp;
          enemy.knockbackVz = kz * damp;
        } else {
          enemy.knockbackVx = 0;
          enemy.knockbackVz = 0;
        }
      }
      if (zoneId === 'overworld' && !enemy.isBoss) {
        if (enemy.respawnTimer > 0) {
          enemy.respawnTimer = Math.max(0, enemy.respawnTimer - dt);
        }
        if (enemy.respawnTimer <= 0) {
          const distFromHome = dist(
            player.x,
            player.z,
            enemy.homeX,
            enemy.homeZ,
          );
          if (distFromHome > OVERWORLD_RESPAWN_MIN_PLAYER_DIST) {
            enemy.x = enemy.homeX;
            enemy.z = enemy.homeZ;
            enemy.hp = enemy.maxHp;
            enemy.state = 'idle';
            enemy.stateTimer = 0;
            enemy.attackCooldown = 0.5;
            enemy.slowTimer = 0;
            enemy.hitFlashTimer = 0;
            enemy.aggroed = false;
            enemy.knockbackVx = 0;
            enemy.knockbackVz = 0;
            enemy.deathTimer = 0;
            enemy.deathDuration = 0;
            enemy.activeStatuses = [];
            enemy.stagger = 0;
            enemy.staggeredTimer = 0;
            enemy.staggerDecayDelay = 0;
          }
        }
      }
      continue;
    }

    // --- Décrémentation timers ---
    if (enemy.hitFlashTimer > 0) {
      enemy.hitFlashTimer = Math.max(0, enemy.hitFlashTimer - dt);
    }
    if (enemy.slowTimer > 0) {
      enemy.slowTimer = Math.max(0, enemy.slowTimer - dt);
    }
    if (enemy.attackCooldown > 0) {
      enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    }
    if ((enemy.staggeredTimer ?? 0) <= 0 && (enemy.stagger ?? 0) > 0) {
      if ((enemy.staggerDecayDelay ?? 0) > 0) {
        enemy.staggerDecayDelay = Math.max(0, (enemy.staggerDecayDelay ?? 0) - dt);
      } else {
        enemy.stagger = Math.max(0, (enemy.stagger ?? 0) - 10 * dt);
      }
    }

    // Transition Phase 2 (Boss Dragon <= 50 % PV)
    if (checkBossPhaseTransition(enemy, events)) {
      bossEnteredPhaseTwo = enemy;
    }

    // Recul (knockback) amorti
    if (enemy.knockbackVx || enemy.knockbackVz) {
      const kx = enemy.knockbackVx ?? 0;
      const kz = enemy.knockbackVz ?? 0;
      if (Math.hypot(kx, kz) > 0.1) {
        const next = resolvePos(
          enemy.x + kx * dt,
          enemy.z + kz * dt,
          enemy.radius,
        );
        enemy.x = next.x;
        enemy.z = next.z;
        const damp = Math.exp(-10 * dt);
        enemy.knockbackVx = kx * damp;
        enemy.knockbackVz = kz * damp;
      } else {
        enemy.knockbackVx = 0;
        enemy.knockbackVz = 0;
      }
    }

    // Posture brisée (staggered) ou étourdissement (stun) : bloque tout déplacement / attaque
    if (enemy.state === 'staggered' || (enemy.staggeredTimer ?? 0) > 0) {
      enemy.vx = 0;
      enemy.vz = 0;
      enemy.activeSweepDuration = undefined;
      enemy.activeSweepElapsed = undefined;
      enemy.staggeredTimer = Math.max(0, (enemy.staggeredTimer ?? 0) - dt);
      enemy.stateTimer = enemy.staggeredTimer;
      if (enemy.staggeredTimer <= 0) {
        enemy.staggeredTimer = 0;
        enemy.state = 'chase';
        enemy.stateTimer = 0;
      }
      continue;
    }

    if (isEntityStunned(enemy)) {
      enemy.vx = 0;
      enemy.vz = 0;
      enemy.activeSweepDuration = undefined;
      enemy.activeSweepElapsed = undefined;
      if (
        enemy.state === 'windup' ||
        enemy.activePatternId !== undefined ||
        enemy.activeLungeAngle !== undefined ||
        enemy.activeLungeDist !== undefined
      ) {
        enemy.state = 'recover';
        enemy.stateTimer = Math.max(enemy.stateTimer, 0.35);
        enemy.attackCooldown = Math.max(enemy.attackCooldown, 0.6);
        enemy.activePatternId = undefined;
        enemy.activeLungeAngle = undefined;
        enemy.activeLungeDist = undefined;
        for (let t = telegraphs.length - 1; t >= 0; t--) {
          if (telegraphs[t].ownerId === enemy.id) {
            telegraphs[t].resolved = true;
            telegraphs.splice(t, 1);
          }
        }
      }
      continue;
    }

    // Souffle continu balayant (Drak-Miaou `flame_jet_sweep`)
    if ((enemy.activeSweepDuration ?? 0) > 0) {
      const sweepDur = enemy.activeSweepDuration ?? 0.85;
      enemy.activeSweepElapsed = (enemy.activeSweepElapsed ?? 0) + dt;
      enemy.activeSweepTickAccum = (enemy.activeSweepTickAccum ?? 0) + dt;
      const t = clamp((enemy.activeSweepElapsed ?? 0) / Math.max(0.05, sweepDur), 0, 1);
      const startA = enemy.activeSweepStartAngle ?? 0;
      const endA = enemy.activeSweepEndAngle ?? 0;
      const beamAngle = lerp(startA, endA, t);
      if (enemy.activeSweepTickAccum >= 0.2) {
        enemy.activeSweepTickAccum -= 0.2;
        if (
          player.hp > 0 &&
          isPointInCone(player.x, player.z, enemy.x, enemy.z, beamAngle, 9.4, 0.5, PLAYER_RADIUS * 0.4)
        ) {
          const hitResult = applyDamageToPlayer(
            player,
            Math.max(1, Math.round(def.atk * 0.48 * getOutgoingDamageMultiplier(enemy))),
            enemy.x,
            enemy.z,
            events,
          );
          if (hitResult.hit && hitResult.damage > 0 && player.hp > 0) {
            applyStatusEffect(
              player,
              { statusId: 'burn', chance: 0.45, durationSec: 3.5, potency: 6 },
              events,
              { rng: options?.rng, sourceId: enemy.id },
            );
          }
        }
      }
      if ((enemy.activeSweepElapsed ?? 0) >= sweepDur) {
        enemy.activeSweepDuration = undefined;
        enemy.activeSweepElapsed = undefined;
        enemy.activeSweepTickAccum = undefined;
        enemy.activeSweepPatternId = undefined;
      }
    }

    const dPlayer = dist(enemy.x, enemy.z, player.x, player.z);
    const chillFactor = Math.max(
      enemy.slowTimer > 0 ? FREEZEPAW_SLOW_FACTOR : 0,
      getChillSlowFactor(enemy),
    );
    const speedMult =
      (1 - chillFactor) *
      (enemy.phase === 2 && def.phaseTwoSpeedMult ? def.phaseTwoSpeedMult : 1);
    const effectiveSpeed = def.speed * speedMult;

    // --- Machine à états IA ---
    if (enemy.state === 'idle') {
      enemy.vx = 0;
      enemy.vz = 0;

      if (
        player.hp > 0 &&
        !playerInVillage &&
        (dPlayer <= def.aggroRange || enemy.aggroed)
      ) {
        enemy.aggroed = true;
        enemy.state = 'chase';
      } else {
        // Retour tranquille vers le camp d'origine
        const dHome = dist(enemy.x, enemy.z, enemy.homeX, enemy.homeZ);
        if (dHome > 0.6) {
          const dir = normalize(enemy.homeX - enemy.x, enemy.homeZ - enemy.z);
          const stepSpeed = Math.min(dHome / dt, def.speed * 0.65);
          const next = resolvePos(
            enemy.x + dir.x * stepSpeed * dt,
            enemy.z + dir.z * stepSpeed * dt,
            enemy.radius,
          );
          enemy.x = next.x;
          enemy.z = next.z;
          enemy.vx = dir.x * stepSpeed;
          enemy.vz = dir.z * stepSpeed;
          if (Math.abs(dir.x) > 0.05) {
            enemy.facingX = dir.x >= 0 ? 1 : -1;
          }
        }
      }
    } else if (enemy.state === 'chase') {
      const dHome = dist(enemy.x, enemy.z, enemy.homeX, enemy.homeZ);
      const shouldLeash =
        player.hp <= 0 ||
        playerInVillage ||
        (!enemy.isBoss && dHome > def.leashRange);

      if (shouldLeash) {
        enemy.aggroed = false;
        enemy.state = 'idle';
        enemy.vx = 0;
        enemy.vz = 0;
        continue;
      }

      if (Math.abs(player.x - enemy.x) > 0.1) {
        enemy.facingX = player.x >= enemy.x ? 1 : -1;
      }

      // Tentative d'attaque télégraphée
      if (enemy.attackCooldown <= 0) {
        const pattern = selectAttackPattern(enemy, def, dPlayer);
        if (pattern) {
          const { duration } = spawnTelegraphsForPattern(
            enemy,
            def,
            pattern,
            player,
            telegraphs,
            {
              rng: options?.rng,
              clampPoint: options?.clampTelegraphPoint,
            },
          );
          enemy.state = 'windup';
          enemy.stateTimer = duration;
          enemy.activePatternId = pattern.id;
          enemy.vx = 0;
          enemy.vz = 0;

          events.push({
            type: 'enemy_telegraph',
            x: enemy.x,
            z: enemy.z,
            angle: angleBetween(enemy.x, enemy.z, player.x, player.z),
            enemyId: enemy.id,
            enemyTypeId: enemy.typeId,
            enemyMaterial: def.materialSound,
            patternId: pattern.id,
            shape: pattern.shape,
          });

          if (pattern.lungeOnImpact) {
            enemy.activeLungeAngle = angleBetween(
              enemy.x,
              enemy.z,
              player.x,
              player.z,
            );
            enemy.activeLungeDist = Math.min(
              pattern.radius * 0.75,
              Math.max(2.0, dPlayer + 1.2),
            );
          } else {
            enemy.activeLungeAngle = undefined;
            enemy.activeLungeDist = undefined;
          }
          continue;
        }
      }

      // Déplacement vers le joueur (s'arrête à courte distance pour ne pas superposer les sprites)
      const desiredStopDist = Math.max(1.2, enemy.radius + 0.55);
      if (dPlayer > desiredStopDist) {
        const dir = normalize(player.x - enemy.x, player.z - enemy.z);
        const next = resolvePos(
          enemy.x + dir.x * effectiveSpeed * dt,
          enemy.z + dir.z * effectiveSpeed * dt,
          enemy.radius,
        );
        enemy.x = next.x;
        enemy.z = next.z;
        enemy.vx = dir.x * effectiveSpeed;
        enemy.vz = dir.z * effectiveSpeed;
      } else {
        enemy.vx = 0;
        enemy.vz = 0;
      }
    } else if (enemy.state === 'windup') {
      enemy.vx = 0;
      enemy.vz = 0;
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        const pattern = def.patterns.find(
          (p) => p.id === enemy.activePatternId,
        );

        // Charge physique éventuelle (Loup-Épine, Roi Rat-Spectre, Dragon-Griffe)
        if (
          pattern?.lungeOnImpact &&
          enemy.activeLungeAngle !== undefined &&
          enemy.activeLungeDist
        ) {
          const steps = 4;
          const stepDist = enemy.activeLungeDist / steps;
          const dx = Math.cos(enemy.activeLungeAngle) * stepDist;
          const dz = Math.sin(enemy.activeLungeAngle) * stepDist;
          for (let s = 0; s < steps; s++) {
            const next = resolvePos(
              enemy.x + dx,
              enemy.z + dz,
              enemy.radius,
            );
            enemy.x = next.x;
            enemy.z = next.z;
          }
        }

        const phaseMult =
          enemy.phase === 2 && def.phaseTwoSpeedMult
            ? def.phaseTwoSpeedMult
            : 1;
        enemy.state = 'recover';
        enemy.stateTimer = (pattern?.recoverDuration ?? 0.5) / phaseMult;
        enemy.attackCooldown = (pattern?.cooldown ?? 1.5) / phaseMult;
        enemy.activePatternId = undefined;
        enemy.activeLungeAngle = undefined;
        enemy.activeLungeDist = undefined;
      }
    } else if (enemy.state === 'recover') {
      enemy.vx = 0;
      enemy.vz = 0;
      enemy.stateTimer -= dt;
      if (enemy.stateTimer <= 0) {
        enemy.state = 'chase';
      }
    }
  }

  // Séparation douce entre ennemis vivants pour éviter les empilements
  for (let i = 0; i < enemies.length; i++) {
    const a = enemies[i];
    if (a.state === 'dead') continue;
    for (let j = i + 1; j < enemies.length; j++) {
      const b = enemies[j];
      if (b.state === 'dead') continue;
      const push = resolveCircleCircle(a.x, a.z, a.radius * 0.85, b.x, b.z, b.radius * 0.85);
      if (push.x !== 0 || push.z !== 0) {
        const posA = resolvePos(a.x + push.x * 0.5, a.z + push.z * 0.5, a.radius);
        const posB = resolvePos(b.x - push.x * 0.5, b.z - push.z * 0.5, b.radius);
        a.x = posA.x;
        a.z = posA.z;
        b.x = posB.x;
        b.z = posB.z;
      }
    }
  }

  return { bossEnteredPhaseTwo };
}
