// ============================================================================
// Système de Sauvegarde & Préférences Audio (StorageLike injectable + validation)
// Zéro import Three.js, 100 % testable sans DOM sous Vitest (environment: node).
// ============================================================================

import { ENEMIES } from '../data/enemiesData';
import { EQUIPMENT } from '../data/equipmentData';
import { SPELL_ORDER } from '../data/spellsData';
import {
  ALL_EQUIP_SLOTS,
  AUDIO_PREFS_STORAGE_KEY,
  MAX_PLAYER_LEVEL,
  MAX_SPELL_LEVEL,
  OPTIONAL_EQUIP_SLOTS,
  SAVE_STORAGE_KEY,
  STARTING_EQUIPMENT,
  type AudioPrefs,
  type EnemyTypeId,
  type EquipSlot,
  type GameState,
  type IslandId,
  type OwnedEquipment,
  type QuestId,
  type QuestProgress,
  type QuestStatus,
  type SaveData,
  type SavedShipData,
  type SavedShipMode,
  type ShipBlueprint,
  type ShipSlot,
  type SpellId,
  type StorageAdapter,
  type Vec2,
} from './types';

export type StorageLike = StorageAdapter;

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  muted: false,
  volume: 0.7,
};

const VALID_QUEST_IDS: readonly QuestId[] = [
  'main_dragon_blood',
  'side_yarn_hunt',
  'side_lost_blade',
];

const VALID_QUEST_STATUSES: readonly QuestStatus[] = [
  'available',
  'active',
  'completed',
];

const VALID_ISLAND_IDS: readonly IslandId[] = [
  'felingard',
  'tropical',
  'mountain',
  'mystic',
  'wild',
  'archipelago',
];

const VALID_SHIP_MODES: readonly SavedShipMode[] = ['parked', 'sailing'];

const VALID_SHIP_SLOTS: readonly ShipSlot[] = [
  'coque',
  'puissance_canon',
  'cadence',
  'capacite_munitions',
  'rechargement',
  'patte_boost',
  'super_patte_canon',
  'patte_canon_magma',
  'patte_canon_electrique',
  'patte_canon_maudite',
  'redoutable_canard',
];

const VALID_SHIP_BLUEPRINTS: readonly ShipBlueprint[] = [
  'coque_cuirassée',
  'canon_foudre',
  'cadence_double',
  'grenier_munitions',
  'rechargement_rapide',
];

/**
 * Crée un stockage en mémoire conforme à StorageLike (pratique pour Vitest).
 */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key: string): string | null {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    setItem(key: string, value: string): void {
      map.set(key, value);
    },
    removeItem(key: string): void {
      map.delete(key);
    },
  };
}

/**
 * Résout `localStorage` de façon défensive (retourne null si absent ou bloqué).
 */
export function getDefaultStorage(): StorageLike | null {
  try {
    const g = globalThis as { localStorage?: StorageLike };
    if (
      g &&
      g.localStorage &&
      typeof g.localStorage.getItem === 'function' &&
      typeof g.localStorage.setItem === 'function' &&
      typeof g.localStorage.removeItem === 'function'
    ) {
      return g.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  return getDefaultStorage();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateSavedShipData(rawShip: unknown): SavedShipData | null {
  if (!isPlainObject(rawShip)) return null;

  if (
    typeof rawShip.mode !== 'string' ||
    !VALID_SHIP_MODES.includes(rawShip.mode as SavedShipMode)
  ) {
    return null;
  }

  if (
    !isPlainObject(rawShip.position) ||
    !isFiniteNumber(rawShip.position.x) ||
    !isFiniteNumber(rawShip.position.z)
  ) {
    return null;
  }

  if (!isFiniteNumber(rawShip.angle)) {
    return null;
  }

  let dockedIslandId: IslandId | null;
  if (rawShip.dockedIslandId === null) {
    dockedIslandId = null;
  } else if (
    typeof rawShip.dockedIslandId === 'string' &&
    VALID_ISLAND_IDS.includes(rawShip.dockedIslandId as IslandId)
  ) {
    dockedIslandId = rawShip.dockedIslandId as IslandId;
  } else {
    return null;
  }

  if (
    !isFiniteNumber(rawShip.hullHp) ||
    rawShip.hullHp < 0 ||
    !isFiniteNumber(rawShip.maxHullHp) ||
    rawShip.maxHullHp < 0 ||
    !isFiniteNumber(rawShip.ammo) ||
    rawShip.ammo < 0 ||
    !isFiniteNumber(rawShip.maxAmmo) ||
    rawShip.maxAmmo < 0
  ) {
    return null;
  }

  if (!isPlainObject(rawShip.equippedBlueprints)) return null;
  const equippedBlueprints: Partial<Record<ShipSlot, ShipBlueprint>> = {};
  for (const [slotKey, bp] of Object.entries(rawShip.equippedBlueprints)) {
    if (bp === undefined) continue;
    if (
      !VALID_SHIP_SLOTS.includes(slotKey as ShipSlot) ||
      typeof bp !== 'string' ||
      !VALID_SHIP_BLUEPRINTS.includes(bp as ShipBlueprint)
    ) {
      return null;
    }
    equippedBlueprints[slotKey as ShipSlot] = bp as ShipBlueprint;
  }

  if (!isPlainObject(rawShip.unlockedSlots)) return null;
  for (const [slotKey, val] of Object.entries(rawShip.unlockedSlots)) {
    if (!VALID_SHIP_SLOTS.includes(slotKey as ShipSlot) || typeof val !== 'boolean') {
      return null;
    }
  }
  const unlockedSlots = {} as Record<ShipSlot, boolean>;
  for (const slot of VALID_SHIP_SLOTS) {
    const val = rawShip.unlockedSlots[slot];
    unlockedSlots[slot] = typeof val === 'boolean' ? val : false;
  }

  const maxHullHp = Math.round(rawShip.maxHullHp);
  const hullHp =
    maxHullHp > 0
      ? Math.min(maxHullHp, Math.round(rawShip.hullHp))
      : Math.round(rawShip.hullHp);
  const maxAmmo = Math.floor(rawShip.maxAmmo);
  const ammo = Math.min(maxAmmo, Math.floor(rawShip.ammo));

  return {
    mode: rawShip.mode as SavedShipMode,
    position: { x: rawShip.position.x, z: rawShip.position.z },
    angle: rawShip.angle,
    dockedIslandId,
    hullHp,
    maxHullHp,
    ammo,
    maxAmmo,
    equippedBlueprints,
    unlockedSlots,
  };
}

/**
 * Valide et nettoie un objet désérialisé en `SaveData` conforme, ou retourne `null`.
 * Accepte les sauvegardes v1 (sans données bateau) et v2 (avec `ship: SavedShipData`).
 */
export function validateSaveData(raw: unknown): SaveData | null {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== 1 && raw.version !== 2) return null;
  const version: 1 | 2 = raw.version;
  if (!isFiniteNumber(raw.timestamp) || raw.timestamp < 0) return null;

  // --- Player ---
  const rawPlayer = raw.player;
  if (!isPlainObject(rawPlayer)) return null;
  if (
    !isFiniteNumber(rawPlayer.level) ||
    !isFiniteNumber(rawPlayer.xp) ||
    !isFiniteNumber(rawPlayer.gold) ||
    !isFiniteNumber(rawPlayer.hp) ||
    !isFiniteNumber(rawPlayer.mp) ||
    typeof rawPlayer.hasRunicKey !== 'boolean'
  ) {
    return null;
  }

  const level = Math.max(1, Math.min(MAX_PLAYER_LEVEL, Math.floor(rawPlayer.level)));
  const xp = Math.max(0, Math.floor(rawPlayer.xp));
  const gold = Math.max(0, Math.floor(rawPlayer.gold));
  const hp = Math.max(0, Math.round(rawPlayer.hp));
  const mp = Math.max(0, Math.round(rawPlayer.mp));
  let position: Vec2 | undefined;
  if (rawPlayer.position !== undefined) {
    if (
      !isPlainObject(rawPlayer.position) ||
      !isFiniteNumber(rawPlayer.position.x) ||
      !isFiniteNumber(rawPlayer.position.z)
    ) {
      return null;
    }
    position = { x: rawPlayer.position.x, z: rawPlayer.position.z };
  }

  const islandId =
    raw.islandId === undefined
      ? 'felingard'
      : typeof raw.islandId === 'string' &&
          VALID_ISLAND_IDS.includes(raw.islandId as IslandId)
        ? (raw.islandId as IslandId)
        : null;
  if (islandId === null) return null;

  // --- Ship (optionnel en v1, validé strictement si présent) ---
  let ship: SavedShipData | undefined;
  if (raw.ship !== undefined) {
    const validatedShip = validateSavedShipData(raw.ship);
    if (!validatedShip) return null;
    ship = validatedShip;
  }

  // Equipped (rétrocompatible avec anciennes sauvegardes v1/v2 sans boots/gloves/cape ou slots optionnels)
  if (!isPlainObject(rawPlayer.equipped)) return null;
  const equipped: Record<EquipSlot, string> = { ...STARTING_EQUIPMENT };
  for (const slot of ALL_EQUIP_SLOTS) {
    const rawId = rawPlayer.equipped[slot];
    if (rawId === undefined && OPTIONAL_EQUIP_SLOTS.includes(slot)) {
      equipped[slot] = '';
      continue;
    }
    if (
      typeof rawId !== 'string' ||
      (rawId !== '' && (!EQUIPMENT[rawId] || EQUIPMENT[rawId].slot !== slot))
    ) {
      return null;
    }
    equipped[slot] = rawId;
  }

  // Inventory
  if (!isPlainObject(rawPlayer.inventory)) return null;
  const inventory: Record<string, OwnedEquipment> = {};
  for (const [key, item] of Object.entries(rawPlayer.inventory)) {
    if (!isPlainObject(item)) return null;
    // Migration douce : l'ancienne arme secondaire est abandonnée, le reste de
    // l'inventaire et les autres emplacements sont conservés tels quels.
    if (key === 'dagger_fang' || item.slot === 'secondary_weapon') continue;
    if (
      typeof item.id !== 'string' ||
      item.id !== key ||
      !EQUIPMENT[item.id] ||
      !isFiniteNumber(item.level) ||
      item.level < 1
    ) {
      return null;
    }
    inventory[item.id] = {
      id: item.id,
      level: Math.max(1, Math.floor(item.level)),
    };
  }
  // Garantit que chaque objet équipé existe dans l'inventaire
  for (const slot of ALL_EQUIP_SLOTS) {
    const id = equipped[slot];
    if (id && !inventory[id]) {
      inventory[id] = { id, level: 1 };
    }
  }

  // Spell levels (rétrocompatible : les nouveaux sorts absents d'une ancienne sauvegarde démarrent au Niv. 1)
  if (!isPlainObject(rawPlayer.spellLevels)) return null;
  const LEGACY_REQUIRED_SPELLS: readonly SpellId[] = [
    'flamepurr',
    'lightnyan',
    'freezepaw',
    'healing_paw',
  ];
  const spellLevels = {} as Record<SpellId, number>;
  for (const spellId of SPELL_ORDER) {
    const lv = rawPlayer.spellLevels[spellId];
    if (lv === undefined && !LEGACY_REQUIRED_SPELLS.includes(spellId)) {
      spellLevels[spellId] = 1;
      continue;
    }
    if (!isFiniteNumber(lv) || lv < 1) {
      return null;
    }
    spellLevels[spellId] = Math.max(1, Math.min(MAX_SPELL_LEVEL, Math.floor(lv)));
  }

  // --- Quests ---
  if (!isPlainObject(raw.quests)) return null;
  const quests = {} as Record<QuestId, QuestProgress>;
  for (const qid of VALID_QUEST_IDS) {
    const rq = raw.quests[qid];
    if (!isPlainObject(rq)) return null;
    if (
      rq.id !== qid ||
      typeof rq.status !== 'string' ||
      !VALID_QUEST_STATUSES.includes(rq.status as QuestStatus) ||
      !isFiniteNumber(rq.stepIndex) ||
      rq.stepIndex < 0 ||
      !isFiniteNumber(rq.counter) ||
      rq.counter < 0
    ) {
      return null;
    }
    quests[qid] = {
      id: qid,
      status: rq.status as QuestStatus,
      stepIndex: Math.floor(rq.stepIndex),
      counter: Math.floor(rq.counter),
    };
  }

  // Tracked quest
  let trackedQuestId: QuestId | null = null;
  if (raw.trackedQuestId === null) {
    trackedQuestId = null;
  } else if (
    typeof raw.trackedQuestId === 'string' &&
    VALID_QUEST_IDS.includes(raw.trackedQuestId as QuestId)
  ) {
    trackedQuestId = raw.trackedQuestId as QuestId;
  } else {
    return null;
  }

  // Opened chests
  if (!Array.isArray(raw.openedChestIds)) return null;
  const openedChestIds: string[] = [];
  for (const cid of raw.openedChestIds) {
    if (typeof cid !== 'string') return null;
    if (!openedChestIds.includes(cid)) openedChestIds.push(cid);
  }

  // Defeated bosses
  if (!Array.isArray(raw.defeatedBossIds)) return null;
  const defeatedBossIds: EnemyTypeId[] = [];
  for (const bid of raw.defeatedBossIds) {
    if (typeof bid !== 'string' || !(bid in ENEMIES)) return null;
    const typed = bid as EnemyTypeId;
    if (!defeatedBossIds.includes(typed)) defeatedBossIds.push(typed);
  }

  // Run stats
  if (!isPlainObject(raw.runStats)) return null;
  if (
    !isFiniteNumber(raw.runStats.playTimeSec) ||
    raw.runStats.playTimeSec < 0 ||
    !isFiniteNumber(raw.runStats.enemiesDefeated) ||
    raw.runStats.enemiesDefeated < 0 ||
    !isFiniteNumber(raw.runStats.chestsOpened) ||
    raw.runStats.chestsOpened < 0
  ) {
    return null;
  }

  return {
    version,
    timestamp: raw.timestamp,
    player: {
      level,
      xp,
      gold,
      hp,
      mp,
      equipped,
      inventory,
      spellLevels,
      hasRunicKey: rawPlayer.hasRunicKey,
      ...(position ? { position } : {}),
    },
    islandId,
    ...(ship ? { ship } : {}),
    quests,
    trackedQuestId,
    openedChestIds,
    defeatedBossIds,
    runStats: {
      playTimeSec: raw.runStats.playTimeSec,
      enemiesDefeated: Math.floor(raw.runStats.enemiesDefeated),
      chestsOpened: Math.floor(raw.runStats.chestsOpened),
    },
  };
}

/**
 * Construit un snapshot `SaveData` (version 2) propre à partir du `GameState`.
 * Normalise systématiquement les états transitoires du bateau (`boarding`, `docking`,
 * `disembarking`) vers un état stable (`parked` ou `sailing`).
 */
export function serializeGameState(state: GameState): SaveData {
  const inventoryCopy: Record<string, OwnedEquipment> = {};
  for (const [id, item] of Object.entries(state.player.inventory)) {
    inventoryCopy[id] = { id: item.id, level: item.level };
  }

  const questsCopy = {} as Record<QuestId, QuestProgress>;
  for (const qid of VALID_QUEST_IDS) {
    const q = state.quests[qid];
    questsCopy[qid] = {
      id: q.id,
      status: q.status,
      stepIndex: q.stepIndex,
      counter: q.counter,
    };
  }

  const ship = state.ship;
  const transition = ship.transition;
  const shipPosition: Vec2 = { x: ship.position.x, z: ship.position.z };
  const shipAngle = ship.angle;

  let savedIslandId: IslandId = state.islandId;
  let savedPlayerPos: Vec2 = { x: state.player.x, z: state.player.z };
  let savedShipMode: SavedShipMode = 'parked';
  let savedDockedIslandId: IslandId | null = ship.dockedIslandId ?? state.islandId;

  switch (ship.mode) {
    case 'boarding': {
      savedShipMode = 'parked';
      savedDockedIslandId = state.islandId;
      savedPlayerPos = transition
        ? { x: transition.heroStartPos.x, z: transition.heroStartPos.z }
        : { x: state.player.x, z: state.player.z };
      break;
    }
    case 'docking': {
      savedShipMode = 'sailing';
      savedDockedIslandId = null;
      savedPlayerPos = { x: ship.position.x, z: ship.position.z };
      break;
    }
    case 'disembarking': {
      const destIsland = transition?.targetIslandId ?? ship.dockedIslandId ?? state.islandId;
      const land = transition?.landingPos ?? transition?.heroTargetPos;
      savedShipMode = 'parked';
      savedIslandId = destIsland;
      savedDockedIslandId = destIsland;
      savedPlayerPos = land
        ? { x: land.x, z: land.z }
        : { x: state.player.x, z: state.player.z };
      break;
    }
    case 'sailing': {
      savedShipMode = 'sailing';
      savedDockedIslandId = null;
      savedPlayerPos = { x: ship.position.x, z: ship.position.z };
      break;
    }
    case 'parked': {
      savedShipMode = 'parked';
      savedDockedIslandId = ship.dockedIslandId ?? state.islandId;
      savedPlayerPos = { x: state.player.x, z: state.player.z };
      break;
    }
  }

  const equippedBlueprintsCopy: Partial<Record<ShipSlot, ShipBlueprint>> = {};
  for (const [slot, bp] of Object.entries(ship.equippedBlueprints)) {
    if (bp !== undefined) {
      equippedBlueprintsCopy[slot as ShipSlot] = bp;
    }
  }

  const unlockedSlotsCopy = {} as Record<ShipSlot, boolean>;
  for (const slot of VALID_SHIP_SLOTS) {
    unlockedSlotsCopy[slot] = Boolean(ship.unlockedSlots[slot]);
  }

  const savedShip: SavedShipData = {
    mode: savedShipMode,
    position: shipPosition,
    angle: shipAngle,
    dockedIslandId: savedDockedIslandId,
    hullHp: ship.hullHp,
    maxHullHp: ship.maxHullHp,
    ammo: ship.ammo,
    maxAmmo: ship.maxAmmo,
    equippedBlueprints: equippedBlueprintsCopy,
    unlockedSlots: unlockedSlotsCopy,
  };

  return {
    version: 2,
    timestamp: Date.now(),
    player: {
      level: state.player.level,
      xp: state.player.xp,
      gold: state.player.gold,
      hp: state.player.hp,
      mp: state.player.mp,
      equipped: { ...state.player.equipped },
      inventory: inventoryCopy,
      spellLevels: { ...state.player.spellLevels },
      hasRunicKey: state.player.hasRunicKey,
      position: savedPlayerPos,
    },
    islandId: savedIslandId,
    ship: savedShip,
    quests: questsCopy,
    trackedQuestId: state.trackedQuestId,
    openedChestIds: [...state.openedChestIds],
    defeatedBossIds: [...state.defeatedBossIds],
    runStats: { ...state.runStats },
  };
}

/**
 * Enregistre `SaveData` dans le stockage sous `felingard_cat_quest_save_v1`.
 */
export function saveGame(
  data: SaveData,
  storage?: StorageLike | null,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    const validated = validateSaveData(data);
    if (!validated) return false;
    store.setItem(SAVE_STORAGE_KEY, JSON.stringify(validated));
    return true;
  } catch {
    return false;
  }
}

/**
 * Charge et valide la sauvegarde depuis `felingard_cat_quest_save_v1`.
 * Ne lève jamais d'exception sur un JSON corrompu ou incomplet (retourne `null`).
 */
export function loadGame(storage?: StorageLike | null): SaveData | null {
  const store = resolveStorage(storage);
  if (!store) return null;
  try {
    const rawStr = store.getItem(SAVE_STORAGE_KEY);
    if (!rawStr) return null;
    const parsed: unknown = JSON.parse(rawStr);
    return validateSaveData(parsed);
  } catch {
    return null;
  }
}

/**
 * Indique si une sauvegarde valide existe dans le stockage.
 */
export function hasSaveData(storage?: StorageLike | null): boolean {
  return loadGame(storage) !== null;
}

/**
 * Supprime la sauvegarde du stockage.
 */
export function deleteSaveData(storage?: StorageLike | null): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    store.removeItem(SAVE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sauvegarde les préférences audio sous `felingard_audio_prefs_v1`.
 */
export function saveAudioPrefs(
  prefs: AudioPrefs,
  storage?: StorageLike | null,
): boolean {
  const store = resolveStorage(storage);
  if (!store) return false;
  try {
    const sanitized: AudioPrefs = {
      muted: Boolean(prefs.muted),
      volume: isFiniteNumber(prefs.volume)
        ? Math.max(0, Math.min(1, prefs.volume))
        : DEFAULT_AUDIO_PREFS.volume,
    };
    store.setItem(AUDIO_PREFS_STORAGE_KEY, JSON.stringify(sanitized));
    return true;
  } catch {
    return false;
  }
}

/**
 * Charge les préférences audio avec fallback propre si absent ou corrompu.
 */
export function loadAudioPrefs(storage?: StorageLike | null): AudioPrefs {
  const store = resolveStorage(storage);
  if (!store) return { ...DEFAULT_AUDIO_PREFS };
  try {
    const rawStr = store.getItem(AUDIO_PREFS_STORAGE_KEY);
    if (!rawStr) return { ...DEFAULT_AUDIO_PREFS };
    const parsed: unknown = JSON.parse(rawStr);
    if (!isPlainObject(parsed)) return { ...DEFAULT_AUDIO_PREFS };
    if (typeof parsed.muted !== 'boolean' || !isFiniteNumber(parsed.volume)) {
      return { ...DEFAULT_AUDIO_PREFS };
    }
    return {
      muted: parsed.muted,
      volume: Math.max(0, Math.min(1, parsed.volume)),
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}
