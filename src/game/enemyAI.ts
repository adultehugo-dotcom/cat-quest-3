// ============================================================================
// IA des Ennemis, Génération & Résolution des Télégraphes, Pièges & Boss 2 Phases
// Zéro import Three.js, zéro dépendance DOM.
// ============================================================================

import { getEnemyDefinition } from '../data/enemiesData';
import { VILLAGE_SAFE_ZONE, isInsideVillage } from '../data/worldData';
import {
  FREEZEPAW_SLOW_FACTOR,
  applyDamageToPlayer,
} from './combat';
import {
  angleBetween,
  dist,
  isTargetInTelegraph,
  normalize,
  resolveCircleAABB,
  resolveCircleCircle,
} from './math';
import type {
  EnemyAttackPattern,
  EnemyDefinition,
  EnemyInstance,
  EnemySpawnDef,
  GameEvent,
  PlayerState,
  TelegraphZone,
  TrapInstance,
  Vec2,
  ZoneId,
} from './types';

export const OVERWORLD_RESPAWN_TIME = 35;
export const OVERWORLD_RESPAWN_MIN_PLAYER_DIST = 25;

let nextTelegraphId = 1;

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

  if (count <= 1) {
    const basePos = pattern.targetAtPlayer
      ? { x: player.x, z: player.z }
      : { x: enemy.x, z: enemy.z };
    const pos = options?.clampPoint
      ? options.clampPoint(basePos.x, basePos.z)
      : basePos;

    const tz: TelegraphZone = {
      id: `tg_${nextTelegraphId++}`,
      ownerId: enemy.id,
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
      color: pattern.color ?? '#ff3b30',
      resolved: false,
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
      color: pattern.color ?? '#ff3b30',
      resolved: false,
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
): TelegraphUpdateResult {
  let playerHit = false;
  let playerDied = false;
  let maxShake = 0;
  let resolvedCount = 0;

  if (telegraphs.length === 0 || dt < 0) {
    return { playerHit, playerDied, maxShake, resolvedCount };
  }

  const enemyById = new Map<string, EnemyInstance>();
  for (const enemy of enemies) {
    enemyById.set(enemy.id, enemy);
  }

  const remaining: TelegraphZone[] = [];

  for (const tz of telegraphs) {
    if (tz.resolved) continue;

    // Annule un télégraphe si l'ennemi qui le préparait est mort
    const owner = enemyById.get(tz.ownerId);
    if (owner && (owner.state === 'dead' || owner.hp <= 0)) {
      continue;
    }

    tz.elapsed += dt;
    if (tz.elapsed >= tz.duration) {
      tz.resolved = true;
      resolvedCount += 1;

      events.push({
        type: 'telegraph_impact',
        x: tz.x,
        z: tz.z,
        angle: tz.angle,
        radius: tz.radius,
        shape: tz.shape,
        color: tz.color,
      });

      const isBossAttack = owner?.isBoss ?? false;
      maxShake = Math.max(maxShake, isBossAttack ? 0.55 : 0.14);

      if (isTargetInTelegraph(tz, player.x, player.z, 0)) {
        const hitResult = applyDamageToPlayer(
          player,
          tz.damage,
          tz.x,
          tz.z,
          events,
        );
        if (hitResult.hit) {
          playerHit = true;
          maxShake = Math.max(maxShake, isBossAttack ? 0.6 : 0.35);
          if (hitResult.died) {
            playerDied = true;
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

    // --- Ennemi mort : gestion respawn Overworld (35 s si joueur > 25 u) ---
    if (enemy.state === 'dead') {
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

    const dPlayer = dist(enemy.x, enemy.z, player.x, player.z);
    const speedMult =
      (enemy.slowTimer > 0 ? 1 - FREEZEPAW_SLOW_FACTOR : 1) *
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
