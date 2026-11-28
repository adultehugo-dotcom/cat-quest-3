// ============================================================================
// Système d'Effets de Statut (Phase 3) :
// 7 statuts : burn, chill, poison, bleed, stun, shock, curse
// Contre-jeu actif : roulade atténue/éteint burn, Soin-velours purge tout.
// ZÉRO import Three.js, ZÉRO dépendance DOM.
// ============================================================================

import type {
  ActiveStatusEffect,
  EnemyInstance,
  GameEvent,
  PlayerState,
  StatusEffectId,
  WeaponStatusProc,
} from './types';

export const STATUS_TICK_INTERVALS: Readonly<Partial<Record<StatusEffectId, number>>> = {
  burn: 0.75,
  poison: 0.85,
  bleed: 0.8,
};

const DEFAULT_STATUS_POTENCY: Readonly<Record<StatusEffectId, number>> = {
  burn: 5,
  chill: 0.35,
  poison: 4,
  bleed: 4,
  stun: 1,
  shock: 1,
  curse: 1,
};

export interface StatusTarget {
  x: number;
  z: number;
  hp: number;
  vx?: number;
  vz?: number;
  activeStatuses?: ActiveStatusEffect[];
}

export function ensureActiveStatuses(target: Pick<StatusTarget, 'activeStatuses'>): ActiveStatusEffect[] {
  if (!target.activeStatuses) {
    target.activeStatuses = [];
  }
  return target.activeStatuses;
}

export function hasStatus(
  target: Pick<StatusTarget, 'activeStatuses'> | null | undefined,
  statusId: StatusEffectId,
): boolean {
  const list = target?.activeStatuses;
  if (!list || list.length === 0) return false;
  return list.some((s) => s.id === statusId && s.remainingSec > 0);
}

export function getActiveStatus(
  target: Pick<StatusTarget, 'activeStatuses'> | null | undefined,
  statusId: StatusEffectId,
): ActiveStatusEffect | undefined {
  return target?.activeStatuses?.find((s) => s.id === statusId && s.remainingSec > 0);
}

export function getChillSlowFactor(
  target: Pick<StatusTarget, 'activeStatuses'> | null | undefined,
): number {
  const chill = getActiveStatus(target, 'chill');
  if (!chill) return 0;
  return Math.max(0.1, Math.min(0.65, chill.potency > 0 ? chill.potency : 0.35));
}

export function isEntityStunned(
  target: Pick<StatusTarget, 'activeStatuses'> | null | undefined,
): boolean {
  return hasStatus(target, 'stun');
}

export function getIncomingDamageMultiplier(
  target: Pick<StatusTarget, 'activeStatuses'> | null | undefined,
): number {
  let mult = 1.0;
  if (hasStatus(target, 'shock')) mult *= 1.15;
  if (hasStatus(target, 'curse')) mult *= 1.15;
  return mult;
}

export function getOutgoingDamageMultiplier(
  target: Pick<StatusTarget, 'activeStatuses'> | null | undefined,
): number {
  return hasStatus(target, 'curse') ? 0.8 : 1.0;
}

export function applyStatusEffect(
  target: StatusTarget,
  proc: WeaponStatusProc,
  events: GameEvent[],
  options?: {
    rng?: () => number;
    force?: boolean;
    sourceId?: string;
    enemyId?: string;
    enemyTypeId?: EnemyInstance['typeId'];
  },
): boolean {
  if (target.hp <= 0 || proc.durationSec <= 0) return false;

  const rng = options?.rng ?? Math.random;
  if (!options?.force && proc.chance < 1 && rng() >= proc.chance) {
    return false;
  }

  const list = ensureActiveStatuses(target);
  const potency = proc.potency ?? DEFAULT_STATUS_POTENCY[proc.statusId];
  const existing = list.find((s) => s.id === proc.statusId);

  if (existing) {
    existing.remainingSec = Math.max(existing.remainingSec, proc.durationSec);
    existing.durationSec = Math.max(existing.durationSec, proc.durationSec);
    existing.potency = Math.max(existing.potency, potency);
    if (options?.sourceId) existing.sourceId = options.sourceId;
  } else {
    list.push({
      id: proc.statusId,
      remainingSec: proc.durationSec,
      durationSec: proc.durationSec,
      potency,
      tickAccum: 0,
      sourceId: options?.sourceId,
    });
  }

  events.push({
    type: 'status_applied',
    x: target.x,
    z: target.z,
    statusId: proc.statusId,
    value: proc.durationSec,
    ...(options?.enemyId ? { enemyId: options.enemyId } : {}),
    ...(options?.enemyTypeId ? { enemyTypeId: options.enemyTypeId } : {}),
  });

  return true;
}

function tickEntityStatuses(
  target: StatusTarget,
  dt: number,
  events: GameEvent[],
  extra?: {
    isPlayer?: boolean;
    enemyId?: string;
    enemyTypeId?: EnemyInstance['typeId'];
  },
): number {
  const list = target.activeStatuses;
  if (!list || list.length === 0 || dt <= 0 || target.hp <= 0) return 0;

  let totalDotDamage = 0;
  const isMoving = Math.hypot(target.vx ?? 0, target.vz ?? 0) > 0.25;

  for (let i = list.length - 1; i >= 0; i--) {
    const st = list[i];
    const stepDt = Math.min(dt, st.remainingSec);
    st.remainingSec = Math.max(0, st.remainingSec - stepDt);

    const interval = STATUS_TICK_INTERVALS[st.id];
    if (interval && stepDt > 0 && target.hp > 0) {
      st.tickAccum += stepDt;
      while (st.tickAccum >= interval - 1e-6 && target.hp > 0) {
        st.tickAccum = Math.max(0, st.tickAccum - interval);
        const rawPotency = st.potency > 0 ? st.potency : DEFAULT_STATUS_POTENCY[st.id];
        const moveBonus = st.id === 'bleed' && isMoving ? 1.35 : 1.0;
        const dmg = Math.max(1, Math.round(rawPotency * moveBonus));
        target.hp = Math.max(0, target.hp - dmg);
        totalDotDamage += dmg;

        events.push({
          type: 'status_tick',
          x: target.x,
          z: target.z,
          statusId: st.id,
          value: dmg,
          text: `${dmg}`,
          ...(extra?.enemyId ? { enemyId: extra.enemyId } : {}),
          ...(extra?.enemyTypeId ? { enemyTypeId: extra.enemyTypeId } : {}),
        });
      }
    }

    if (st.remainingSec <= 1e-6) {
      list.splice(i, 1);
    }
  }

  return totalDotDamage;
}

/**
 * Met à jour tous les statuts actifs sur le héros.
 */
export function updatePlayerStatuses(
  player: PlayerState,
  dt: number,
  events: GameEvent[],
): { damageTaken: number; died: boolean } {
  if (player.hp <= 0 || dt <= 0) {
    return { damageTaken: 0, died: false };
  }
  const prevHp = player.hp;
  const damageTaken = tickEntityStatuses(player, dt, events, { isPlayer: true });
  const died = prevHp > 0 && player.hp <= 0;
  if (died) {
    events.push({
      type: 'player_died',
      x: player.x,
      z: player.z,
    });
  }
  return { damageTaken, died };
}

/**
 * Met à jour tous les statuts actifs sur les ennemis vivants et retourne ceux tués par DoT.
 */
export function updateEnemyStatuses(
  enemies: EnemyInstance[],
  dt: number,
  events: GameEvent[],
): EnemyInstance[] {
  const killed: EnemyInstance[] = [];
  if (dt <= 0) return killed;

  for (const enemy of enemies) {
    if (enemy.state === 'dead' || enemy.hp <= 0) continue;
    if (!enemy.activeStatuses || enemy.activeStatuses.length === 0) continue;

    const prevHp = enemy.hp;
    tickEntityStatuses(enemy, dt, events, {
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
    });

    if (prevHp > 0 && enemy.hp <= 0) {
      killed.push(enemy);
    }
  }

  return killed;
}

/**
 * Contre-jeu actif : une roulade réduit fortement la durée de `burn`
 * et l'éteint complètement si la durée restante passe sous 0.5 s.
 */
export function reduceBurnOnDodge(
  player: PlayerState,
  events: GameEvent[],
): { affected: boolean; extinguished: boolean; remainingSec: number } {
  const list = player.activeStatuses;
  if (!list || list.length === 0) {
    return { affected: false, extinguished: false, remainingSec: 0 };
  }
  const idx = list.findIndex((s) => s.id === 'burn' && s.remainingSec > 0);
  if (idx < 0) {
    return { affected: false, extinguished: false, remainingSec: 0 };
  }

  const burn = list[idx];
  const reduced = Math.max(0, Math.min(burn.remainingSec * 0.35, burn.remainingSec - 1.2));
  burn.remainingSec = Number(reduced.toFixed(4));
  const extinguished = burn.remainingSec <= 0.5;
  if (extinguished) {
    list.splice(idx, 1);
  }

  events.push({
    type: 'status_purged',
    x: player.x,
    z: player.z,
    statusId: 'burn',
    text: extinguished ? 'FLAMMES ÉTEINTES !' : 'BRÛLURE RÉDUITE !',
  });

  return {
    affected: true,
    extinguished,
    remainingSec: extinguished ? 0 : burn.remainingSec,
  };
}

/**
 * Purge immédiate de tous les débuffs actifs (ex: sort Soin-velours).
 */
export function purgeEntityStatuses(
  target: StatusTarget,
  events: GameEvent[],
  extra?: { enemyId?: string; enemyTypeId?: EnemyInstance['typeId'] },
): number {
  const list = target.activeStatuses;
  if (!list || list.length === 0) return 0;

  const count = list.length;
  list.length = 0;

  events.push({
    type: 'status_purged',
    x: target.x,
    z: target.z,
    value: count,
    text: 'PURIFIÉ !',
    ...(extra?.enemyId ? { enemyId: extra.enemyId } : {}),
    ...(extra?.enemyTypeId ? { enemyTypeId: extra.enemyTypeId } : {}),
  });

  return count;
}
