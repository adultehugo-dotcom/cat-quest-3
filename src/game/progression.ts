// ============================================================================
// Progression du Joueur : XP, Level-Up, Équipement (doublons +1), Forge & Sorts
// Zéro import Three.js, zéro dépendance DOM.
// ============================================================================

import {
  EQUIPMENT_BY_RARITY,
  MYSTERY_CHEST_WEIGHTS,
  getEquipmentDefinition,
} from '../data/equipmentData';
import { getSpellDefinition, getSpellUpgradeCost } from '../data/spellsData';
import { OVERWORLD_DATA } from '../data/worldData';
import {
  ALL_EQUIP_SLOTS,
  FORGE_UPGRADE_MULTIPLIERS,
  MAX_FORGE_UPGRADE_LEVEL,
  MAX_PLAYER_LEVEL,
  MAX_SPELL_LEVEL,
  MYSTERY_CHEST_COST,
  OPTIONAL_EQUIP_SLOTS,
  STARTING_EQUIPMENT,
  type EquipSlot,
  type EquipmentDefinition,
  type EquipmentStatBonuses,
  type ForgeUpgradeLevel,
  type GameEvent,
  type MysteryChestResult,
  type OwnedEquipment,
  type PlayerState,
  type PlayerStats,
  type Rarity,
  type SpellId,
} from './types';

export interface BaseHeroStats {
  maxHp: number;
  maxMp: number;
  atk: number;
  mag: number;
  def: number;
  critChance: number;
}

export interface AddEquipmentResult {
  itemId: string;
  itemName: string;
  slot: EquipSlot;
  rarity: Rarity;
  isUpgrade: boolean;
  newLevel: number;
}

export interface EquipmentUpgradeResult {
  success: boolean;
  itemId: string;
  previousUpgradeLevel: ForgeUpgradeLevel;
  newUpgradeLevel: ForgeUpgradeLevel;
  isMaxUpgrade: boolean;
  cost: number;
  reason?: 'not_owned' | 'unknown_item' | 'max_upgrade' | 'insufficient_gold';
}

export interface EquipmentPurchaseResult {
  success: boolean;
  itemId: string;
  cost: number;
  isUpgrade: boolean;
  newLevel: number;
  reason?: 'unknown_item' | 'not_for_sale' | 'insufficient_gold';
}

export interface SpellUpgradeResult {
  success: boolean;
  spellId: SpellId;
  newLevel: number;
  cost: number;
  reason?: 'max_level' | 'insufficient_gold';
}

export interface XpGrantResult {
  leveledUp: boolean;
  levelsGained: number;
  newLevel: number;
}

/**
 * Courbe d'XP requise pour passer du niveau N au niveau N+1 :
 * Math.round(80 * Math.pow(1.45, N - 1))
 */
export function getXpToNextLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return Math.round(80 * Math.pow(1.45, n - 1));
}

/**
 * Stats de base du héros (sans équipement) au niveau N.
 */
export function getBasePlayerStats(level: number): BaseHeroStats {
  const n = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(level)));
  return {
    maxHp: 100 + (n - 1) * 24,
    maxMp: 100 + (n - 1) * 10,
    atk: 14 + (n - 1) * 4,
    mag: 14 + (n - 1) * 4,
    def: 4 + (n - 1) * 2,
    critChance: 0.1,
  };
}

export function clampForgeUpgradeLevel(level: number | undefined): ForgeUpgradeLevel {
  const n = Math.max(0, Math.min(MAX_FORGE_UPGRADE_LEVEL, Math.floor(level ?? 0)));
  return n as ForgeUpgradeLevel;
}

export function isMaxUpgrade(
  target: Pick<OwnedEquipment, 'upgradeLevel'> | ForgeUpgradeLevel | number,
): boolean {
  const raw = typeof target === 'number' ? target : (target.upgradeLevel ?? 0);
  return clampForgeUpgradeLevel(raw) >= MAX_FORGE_UPGRADE_LEVEL;
}

/**
 * Scaling d'une stat entière d'équipement au niveau L et palier de Forge U (+0..+3) :
 * Math.round(base * (1 + 0.25 * (L - 1)) * FORGE_UPGRADE_MULTIPLIERS[U])
 */
export function scaleEquipmentStat(
  base: number,
  level: number,
  upgradeLevel: ForgeUpgradeLevel | number = 0,
): number {
  const l = Math.max(1, Math.floor(level));
  const u = clampForgeUpgradeLevel(upgradeLevel);
  return Math.round(base * (1 + 0.25 * (l - 1)) * FORGE_UPGRADE_MULTIPLIERS[u]);
}

/**
 * Scaling d'une stat fractionnaire (ex: critChance = 0.03) au niveau L et palier de Forge U.
 */
export function scaleEquipmentFraction(
  base: number,
  level: number,
  upgradeLevel: ForgeUpgradeLevel | number = 0,
): number {
  const l = Math.max(1, Math.floor(level));
  const u = clampForgeUpgradeLevel(upgradeLevel);
  return Math.round(base * (1 + 0.25 * (l - 1)) * FORGE_UPGRADE_MULTIPLIERS[u] * 10000) / 10000;
}

/**
 * Calcule les bonus agrégés d'un équipement donné à un niveau L et palier de Forge U.
 */
export function getScaledEquipmentStats(
  itemId: string,
  level: number,
  upgradeLevel: ForgeUpgradeLevel | number = 0,
): Required<EquipmentStatBonuses> {
  const def = getEquipmentDefinition(itemId);
  if (!def) {
    return { atk: 0, mag: 0, def: 0, hp: 0, mp: 0, critChance: 0 };
  }
  const b = def.baseStats;
  return {
    atk: b.atk ? scaleEquipmentStat(b.atk, level, upgradeLevel) : 0,
    mag: b.mag ? scaleEquipmentStat(b.mag, level, upgradeLevel) : 0,
    def: b.def ? scaleEquipmentStat(b.def, level, upgradeLevel) : 0,
    hp: b.hp ? scaleEquipmentStat(b.hp, level, upgradeLevel) : 0,
    mp: b.mp ? scaleEquipmentStat(b.mp, level, upgradeLevel) : 0,
    critChance: b.critChance ? scaleEquipmentFraction(b.critChance, level, upgradeLevel) : 0,
  };
}

/**
 * Calcule les statistiques totales du joueur (base niveau + 5 emplacements équipés).
 */
export function computeAggregatedStats(player: PlayerState): {
  maxHp: number;
  maxMp: number;
  stats: PlayerStats;
} {
  const base = getBasePlayerStats(player.level);
  let maxHp = base.maxHp;
  let maxMp = base.maxMp;
  let atk = base.atk;
  let mag = base.mag;
  let def = base.def;
  let critChance = base.critChance;

  for (const slot of ALL_EQUIP_SLOTS) {
    const itemId = player.equipped[slot];
    if (!itemId) continue;
    const owned = player.inventory[itemId];
    const itemLevel = owned ? owned.level : 1;
    const upgradeLevel = owned ? clampForgeUpgradeLevel(owned.upgradeLevel) : 0;
    const bonus = getScaledEquipmentStats(itemId, itemLevel, upgradeLevel);
    maxHp += bonus.hp;
    maxMp += bonus.mp;
    atk += bonus.atk;
    mag += bonus.mag;
    def += bonus.def;
    critChance += bonus.critChance;
  }

  critChance = Math.min(0.75, Math.round(critChance * 10000) / 10000);

  return {
    maxHp,
    maxMp,
    stats: { atk, mag, def, critChance },
  };
}

/**
 * Met à jour `maxHp`, `maxMp` et `stats` du joueur en place et borne `hp`/`mp`.
 */
export function recalculatePlayerStats(player: PlayerState): void {
  const computed = computeAggregatedStats(player);
  player.maxHp = computed.maxHp;
  player.maxMp = computed.maxMp;
  player.stats = computed.stats;
  player.hp = Math.min(player.hp, player.maxHp);
  player.mp = Math.min(player.mp, player.maxMp);
}

/**
 * Crée un nouvel état joueur de niveau 1 avec l'équipement de départ.
 */
export function createInitialPlayerState(
  startX = OVERWORLD_DATA.playerStart.x,
  startZ = OVERWORLD_DATA.playerStart.z,
): PlayerState {
  const player: PlayerState = {
    x: startX,
    z: startZ,
    vx: 0,
    vz: 0,
    facingX: 1,
    aimAngle: 0,
    hp: 100,
    maxHp: 100,
    mp: 100,
    maxMp: 100,
    level: 1,
    xp: 0,
    xpToNext: getXpToNextLevel(1),
    gold: 0,
    equipped: { ...STARTING_EQUIPMENT },
    inventory: {
      [STARTING_EQUIPMENT.weapon]: { id: STARTING_EQUIPMENT.weapon, level: 1, upgradeLevel: 0 },
      [STARTING_EQUIPMENT.helmet]: { id: STARTING_EQUIPMENT.helmet, level: 1, upgradeLevel: 0 },
      [STARTING_EQUIPMENT.armor]: { id: STARTING_EQUIPMENT.armor, level: 1, upgradeLevel: 0 },
      cape_traveler: { id: 'cape_traveler', level: 1, upgradeLevel: 0 },
      shield_wood: { id: 'shield_wood', level: 1, upgradeLevel: 0 },
    },
    spellLevels: {
      flamepurr: 1,
      lightnyan: 1,
      freezepaw: 1,
      healing_paw: 1,
      aegis_purr: 1,
      pounce_dash: 1,
      meteor_paw: 1,
    },
    spellCooldowns: {
      flamepurr: 0,
      lightnyan: 0,
      freezepaw: 0,
      healing_paw: 0,
      aegis_purr: 0,
      pounce_dash: 0,
      meteor_paw: 0,
    },
    comboStep: 0,
    comboResetTimer: 0,
    attackCooldown: 0,
    attackAnimTimer: 0,
    dodgeTimer: 0,
    dodgeCooldown: 0,
    invulnTimer: 0,
    hitFlashTimer: 0,
    regenTimer: 0,
    regenTickAccum: 0,
    shieldHp: 0,
    shieldMaxHp: 0,
    shieldTimer: 0,
    hasRunicKey: false,
    stats: { atk: 14, mag: 14, def: 4, critChance: 0.1 },
    dodgeDirX: 1,
    dodgeDirZ: 0,
    knockbackVx: 0,
    knockbackVz: 0,
    lastMeleeAngle: 0,
    activeStatuses: [],
    perfectDodgeBuffTimer: 0,
  };

  recalculatePlayerStats(player);
  player.hp = player.maxHp;
  player.mp = player.maxMp;
  return player;
}

/**
 * Attribue de l'XP au joueur et gère les passages de niveau (avec soin 100 % PV/PM).
 */
export function grantXp(
  player: PlayerState,
  amount: number,
  events?: GameEvent[],
): XpGrantResult {
  if (amount <= 0) {
    return { leveledUp: false, levelsGained: 0, newLevel: player.level };
  }

  if (player.level >= MAX_PLAYER_LEVEL) {
    player.xp = 0;
    player.xpToNext = getXpToNextLevel(MAX_PLAYER_LEVEL);
    return { leveledUp: false, levelsGained: 0, newLevel: player.level };
  }

  const roundedXp = Math.round(amount);
  player.xp += roundedXp;
  events?.push({
    type: 'xp_pickup',
    x: player.x,
    z: player.z,
    value: roundedXp,
  });
  let levelsGained = 0;

  while (player.level < MAX_PLAYER_LEVEL && player.xp >= player.xpToNext) {
    player.xp -= player.xpToNext;
    player.level += 1;
    levelsGained += 1;
    player.xpToNext = getXpToNextLevel(player.level);
  }

  if (player.level >= MAX_PLAYER_LEVEL) {
    player.xp = 0;
  }

  if (levelsGained > 0) {
    recalculatePlayerStats(player);
    player.hp = player.maxHp;
    player.mp = player.maxMp;

    events?.push({
      type: 'level_up',
      x: player.x,
      z: player.z,
      value: player.level,
      text: `NIVEAU ${player.level} !`,
    });
  }

  return {
    leveledUp: levelsGained > 0,
    levelsGained,
    newLevel: player.level,
  };
}

/**
 * Ajoute un équipement à l'inventaire.
 * Signature Cat Quest : si déjà possédé, monte automatiquement son niveau de +1 !
 */
export function addEquipment(
  player: PlayerState,
  itemId: string,
  events?: GameEvent[],
): AddEquipmentResult | null {
  const def = getEquipmentDefinition(itemId);
  if (!def) return null;

  const existing = player.inventory[itemId];
  if (existing) {
    existing.level += 1;
    recalculatePlayerStats(player);
    events?.push({
      type: 'item_upgraded',
      x: player.x,
      z: player.z,
      itemId: def.id,
      itemLevel: existing.level,
      text: `${def.name} amélioré Niv. ${existing.level} !`,
    });
    return {
      itemId: def.id,
      itemName: def.name,
      slot: def.slot,
      rarity: def.rarity,
      isUpgrade: true,
      newLevel: existing.level,
    };
  }

  player.inventory[itemId] = { id: def.id, level: 1, upgradeLevel: 0 };
  events?.push({
    type: 'toast',
    x: player.x,
    z: player.z,
    itemId: def.id,
    itemLevel: 1,
    text: `Nouvel équipement : ${def.name} !`,
  });
  return {
    itemId: def.id,
    itemName: def.name,
    slot: def.slot,
    rarity: def.rarity,
    isUpgrade: false,
    newLevel: 1,
  };
}

/**
 * Équipe un objet présent dans l'inventaire du joueur et recalcule les stats.
 */
export function equipItem(player: PlayerState, itemId: string): boolean {
  const owned = player.inventory[itemId];
  const def = getEquipmentDefinition(itemId);
  if (!owned || !def) return false;
  player.equipped[def.slot] = itemId;
  recalculatePlayerStats(player);
  return true;
}

/**
 * Retire l'équipement d'un emplacement optionnel (bouclier ou cape).
 */
export function unequipSlot(player: PlayerState, slot: EquipSlot): boolean {
  if (!OPTIONAL_EQUIP_SLOTS.includes(slot)) return false;
  if (!player.equipped[slot]) return false;
  player.equipped[slot] = '';
  recalculatePlayerStats(player);
  return true;
}

/**
 * Tire une rareté selon des poids donnés (par défaut 55 % / 35 % / 10 %).
 */
export function rollRarity(
  weights: Record<Rarity, number> = MYSTERY_CHEST_WEIGHTS,
  rng: () => number = Math.random,
): Rarity {
  const commonW = Math.max(0, weights.common);
  const rareW = Math.max(0, weights.rare);
  const epicW = Math.max(0, weights.epic);
  const total = commonW + rareW + epicW;
  if (total <= 0) return 'common';

  const roll = rng() * total;
  if (roll < commonW) return 'common';
  if (roll < commonW + rareW) return 'rare';
  return 'epic';
}

/**
 * Tire un équipement aléatoire pondéré par rareté.
 */
export function rollEquipmentByWeights(
  weights: Record<Rarity, number> = MYSTERY_CHEST_WEIGHTS,
  rng: () => number = Math.random,
): EquipmentDefinition {
  const rarity = rollRarity(weights, rng);
  const pool = EQUIPMENT_BY_RARITY[rarity];
  const idx = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  return pool[idx];
}

/**
 * Achète un Coffre Mystère à la Forge de Kit-Chat (120 Or, 55/35/10 %).
 */
export function buyMysteryChest(
  player: PlayerState,
  events?: GameEvent[],
  rng: () => number = Math.random,
): MysteryChestResult | null {
  if (player.gold < MYSTERY_CHEST_COST) {
    return null;
  }

  player.gold -= MYSTERY_CHEST_COST;
  const rolled = rollEquipmentByWeights(MYSTERY_CHEST_WEIGHTS, rng);
  const added = addEquipment(player, rolled.id, events);
  if (!added) {
    // Remboursement de sécurité (ne devrait jamais arriver)
    player.gold += MYSTERY_CHEST_COST;
    return null;
  }

  return {
    itemId: added.itemId,
    itemName: added.itemName,
    rarity: added.rarity,
    isUpgrade: added.isUpgrade,
    newLevel: added.newLevel,
  };
}

/**
 * Améliore un sort du niveau L vers L+1 (max niveau 5) contre de l'or.
 */
export function upgradeSpell(
  player: PlayerState,
  spellId: SpellId,
  events?: GameEvent[],
): SpellUpgradeResult {
  const currentLevel = player.spellLevels[spellId] ?? 1;
  if (currentLevel >= MAX_SPELL_LEVEL) {
    return {
      success: false,
      spellId,
      newLevel: currentLevel,
      cost: 0,
      reason: 'max_level',
    };
  }

  const cost = getSpellUpgradeCost(spellId, currentLevel);
  if (player.gold < cost) {
    return {
      success: false,
      spellId,
      newLevel: currentLevel,
      cost,
      reason: 'insufficient_gold',
    };
  }

  player.gold -= cost;
  const newLevel = currentLevel + 1;
  player.spellLevels[spellId] = newLevel;
  const def = getSpellDefinition(spellId);

  events?.push({
    type: 'toast',
    x: player.x,
    z: player.z,
    spellId,
    value: newLevel,
    text: `${def.name} amélioré Niv. ${newLevel} !`,
  });

  return {
    success: true,
    spellId,
    newLevel,
    cost,
  };
}

const FORGE_BASE_COST_BY_RARITY: Readonly<Record<Rarity, number>> = {
  common: 90,
  rare: 150,
  epic: 240,
};

const FORGE_STEP_MULTIPLIERS: readonly [number, number, number] = [1, 2, 3.5];

/**
 * Coût progressif en or pour forger un équipement du palier U vers U+1 (0->1, 1->2, 2->3).
 */
export function getEquipmentUpgradeCost(
  itemId: string,
  currentUpgradeLevel: ForgeUpgradeLevel | number,
): number {
  const clamped = clampForgeUpgradeLevel(currentUpgradeLevel);
  if (clamped >= MAX_FORGE_UPGRADE_LEVEL) {
    return 0;
  }
  const def = getEquipmentDefinition(itemId);
  const rarity: Rarity = def?.rarity ?? 'common';
  const base = FORGE_BASE_COST_BY_RARITY[rarity];
  const stepMult = FORGE_STEP_MULTIPLIERS[clamped as 0 | 1 | 2];
  return Math.round(base * stepMult);
}

/**
 * Améliore un équipement possédé à la Forge de Kit-Chat (+1 -> +2 -> +3).
 */
export function upgradeEquipment(
  player: PlayerState,
  itemId: string,
  events?: GameEvent[],
): EquipmentUpgradeResult {
  const def = getEquipmentDefinition(itemId);
  if (!def) {
    return {
      success: false,
      itemId,
      previousUpgradeLevel: 0,
      newUpgradeLevel: 0,
      isMaxUpgrade: false,
      cost: 0,
      reason: 'unknown_item',
    };
  }

  const owned = player.inventory[itemId];
  if (!owned) {
    return {
      success: false,
      itemId,
      previousUpgradeLevel: 0,
      newUpgradeLevel: 0,
      isMaxUpgrade: false,
      cost: 0,
      reason: 'not_owned',
    };
  }

  const currentUpgrade = clampForgeUpgradeLevel(owned.upgradeLevel);
  if (isMaxUpgrade(currentUpgrade)) {
    return {
      success: false,
      itemId,
      previousUpgradeLevel: currentUpgrade,
      newUpgradeLevel: currentUpgrade,
      isMaxUpgrade: true,
      cost: 0,
      reason: 'max_upgrade',
    };
  }

  const cost = getEquipmentUpgradeCost(itemId, currentUpgrade);
  if (player.gold < cost) {
    return {
      success: false,
      itemId,
      previousUpgradeLevel: currentUpgrade,
      newUpgradeLevel: currentUpgrade,
      isMaxUpgrade: false,
      cost,
      reason: 'insufficient_gold',
    };
  }

  player.gold -= cost;
  const nextUpgrade = (currentUpgrade + 1) as ForgeUpgradeLevel;
  owned.upgradeLevel = nextUpgrade;
  recalculatePlayerStats(player);

  events?.push({
    type: 'forge_upgraded',
    x: player.x,
    z: player.z,
    itemId: def.id,
    itemLevel: owned.level,
    upgradeLevel: nextUpgrade,
    value: cost,
    text: `${def.name} forgé +${nextUpgrade} !`,
  });

  return {
    success: true,
    itemId: def.id,
    previousUpgradeLevel: currentUpgrade,
    newUpgradeLevel: nextUpgrade,
    isMaxUpgrade: nextUpgrade >= MAX_FORGE_UPGRADE_LEVEL,
    cost,
  };
}

/**
 * Achète une arme à l'armurerie de Kit-Chat contre de l'or.
 */
export function buyEquipment(
  player: PlayerState,
  itemId: string,
  events?: GameEvent[],
): EquipmentPurchaseResult {
  const def = getEquipmentDefinition(itemId);
  if (!def) {
    return {
      success: false,
      itemId,
      cost: 0,
      isUpgrade: false,
      newLevel: 0,
      reason: 'unknown_item',
    };
  }
  const price = def.shopPrice ?? 0;
  if (price <= 0) {
    return {
      success: false,
      itemId,
      cost: 0,
      isUpgrade: false,
      newLevel: 0,
      reason: 'not_for_sale',
    };
  }
  if (player.gold < price) {
    return {
      success: false,
      itemId,
      cost: price,
      isUpgrade: false,
      newLevel: player.inventory[itemId]?.level ?? 0,
      reason: 'insufficient_gold',
    };
  }

  player.gold -= price;
  const added = addEquipment(player, def.id, events);
  if (!added) {
    player.gold += price;
    return {
      success: false,
      itemId,
      cost: price,
      isUpgrade: false,
      newLevel: 0,
      reason: 'unknown_item',
    };
  }

  events?.push({
    type: 'equipment_purchased',
    x: player.x,
    z: player.z,
    itemId: def.id,
    itemLevel: added.newLevel,
    value: price,
    text: `${def.name} acquis à l'Armurerie !`,
  });

  return {
    success: true,
    itemId: def.id,
    cost: price,
    isUpgrade: added.isUpgrade,
    newLevel: added.newLevel,
  };
}
