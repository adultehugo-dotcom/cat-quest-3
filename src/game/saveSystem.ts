// ============================================================================
// Système de Sauvegarde & Préférences Audio (StorageLike injectable + validation)
// Zéro import Three.js, 100 % testable sans DOM sous Vitest (environment: node).
// ============================================================================

import { ENEMIES } from '../data/enemiesData';
import { EQUIPMENT } from '../data/equipmentData';
import { SPELL_ORDER } from '../data/spellsData';
import {
  AUDIO_PREFS_STORAGE_KEY,
  MAX_PLAYER_LEVEL,
  MAX_SPELL_LEVEL,
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
  type SpellId,
  type StorageAdapter,
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

/**
 * Valide et nettoie un objet désérialisé en `SaveData` conforme, ou retourne `null`.
 */
export function validateSaveData(raw: unknown): SaveData | null {
  if (!isPlainObject(raw)) return null;
  if (raw.version !== 1) return null;
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
  let position: { x: number; z: number } | undefined;
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

  const validIslandIds: readonly IslandId[] = [
    'felingard',
    'tropical',
    'mountain',
    'mystic',
    'wild',
    'archipelago',
  ];
  const islandId =
    raw.islandId === undefined
      ? 'felingard'
      : typeof raw.islandId === 'string' &&
          validIslandIds.includes(raw.islandId as IslandId)
        ? (raw.islandId as IslandId)
        : null;
  if (islandId === null) return null;

  // Equipped
  if (!isPlainObject(rawPlayer.equipped)) return null;
  const equipped: Record<EquipSlot, string> = {
    weapon: STARTING_EQUIPMENT.weapon,
    secondary_weapon: STARTING_EQUIPMENT.secondary_weapon,
    shield: STARTING_EQUIPMENT.shield,
    helmet: STARTING_EQUIPMENT.helmet,
    armor: STARTING_EQUIPMENT.armor,
    trinket: STARTING_EQUIPMENT.trinket,
  };
  for (const slot of [
    'weapon',
    'secondary_weapon',
    'shield',
    'helmet',
    'armor',
    'trinket',
  ] as EquipSlot[]) {
    const id = rawPlayer.equipped[slot];
    if (
      typeof id !== 'string' ||
      (id !== '' &&
        (!EQUIPMENT[id] || EQUIPMENT[id].slot !== slot))
    ) {
      return null;
    }
    equipped[slot] = id;
  }

  // Inventory
  if (!isPlainObject(rawPlayer.inventory)) return null;
  const inventory: Record<string, OwnedEquipment> = {};
  for (const [key, item] of Object.entries(rawPlayer.inventory)) {
    if (!isPlainObject(item)) return null;
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
  for (const slot of [
    'weapon',
    'secondary_weapon',
    'shield',
    'helmet',
    'armor',
    'trinket',
  ] as EquipSlot[]) {
    const id = equipped[slot];
    if (id && !inventory[id]) {
      inventory[id] = { id, level: 1 };
    }
  }

  // Spell levels
  if (!isPlainObject(rawPlayer.spellLevels)) return null;
  const spellLevels = {} as Record<SpellId, number>;
  for (const spellId of SPELL_ORDER) {
    const lv = rawPlayer.spellLevels[spellId];
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
    version: 1,
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
 * Construit un snapshot `SaveData` propre à partir du `GameState`.
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

  return {
    version: 1,
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
      position: { x: state.player.x, z: state.player.z },
    },
    islandId: state.islandId,
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
