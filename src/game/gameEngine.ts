// ============================================================================
// Façade Principale de Simulation : GameEngine
// Gère GameState, step(dt, input), consumeEvents(), interactions contextuelles,
// dialogues, transitions Overworld <-> Donjons, Auberge, Forge, Quêtes,
// Pause, Défaite (réveil Auberge sans perte) et Victoire.
// RÈGLE STRICTE : ZÉRO import de 'three', ZÉRO dépendance DOM.
// ============================================================================

import {
  DUNGEON_PILLAR_RADIUS,
  getDungeonDefinition,
} from '../data/dungeonsData';
import { getEnemyDefinition } from '../data/enemiesData';
import { SPELLS, SPELL_ORDER } from '../data/spellsData';
import {
  BOSS_DRAGON_PHASE2_DIALOGUE,
  INN_REST_MESSAGE,
  INTRO_DIALOGUE,
  MAYOR_DIALOGUES,
  SEALED_DRAGON_LAIR_DIALOGUE,
  VICTORY_DIALOGUE,
} from '../data/questsData';
import {
  OVERWORLD_DATA,
  VILLAGE_SAFE_ZONE,
  clampToIsland,
  getBiomeAt,
  isInsideIsland,
  isInsideVillage,
} from '../data/worldData';
import {
  NEW_ISLANDS,
  clampToNewIsland,
  getBiomeAtNewIsland,
  getNewIslandRadiusAtAngle,
} from '../data/worldIslands';
import {
  DODGE_SPEED,
  HITSTOP_MAJOR_DURATION,
  PERFECT_DODGE_BUFF_DURATION,
  PERFECT_DODGE_MP_PCT,
  PERFECT_DODGE_SLOW_DURATION,
  PERFECT_DODGE_TIMESCALE,
  PERFECT_DODGE_WINDOW_SEC,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  applyStarfallWaveDamage,
  castSpell,
  executeDodgeRoll,
  executeMeleeAttack,
  updatePlayerProjectiles,
  updatePlayerRegen,
  updatePlayerShield,
} from './combat';
import {
  OVERWORLD_RESPAWN_TIME,
  createEnemyInstance,
  updateEnemies,
  updateEnemyProjectiles,
  updateHazardZones,
  updateTelegraphs,
  updateTraps,
} from './enemyAI';
import {
  angleBetween,
  circleIntersectsAABB,
  circlesOverlap,
  clamp,
  dist,
  isPointInCircle,
  isPointInCone,
  isPointInLine,
  isTargetInTelegraph,
  normalize,
  resolveCircleAABB,
  resolveCircleCircle,
} from './math';
import {
  getChillSlowFactor,
  isEntityStunned,
  updateEnemyStatuses,
  updatePlayerStatuses,
} from './statusEffects';
import {
  addEquipment,
  buyEquipment as progressionBuyEquipment,
  buyMysteryChest as progressionBuyMysteryChest,
  createInitialPlayerState,
  equipItem as progressionEquipItem,
  getXpToNextLevel,
  grantXp,
  recalculatePlayerStats,
  rollEquipmentByWeights,
  unequipSlot as progressionUnequipSlot,
  upgradeEquipment as progressionUpgradeEquipment,
  upgradeSpell as progressionUpgradeSpell,
  type EquipmentPurchaseResult,
  type EquipmentUpgradeResult,
  type SpellUpgradeResult,
} from './progression';
import {
  acceptQuest as questsAcceptQuest,
  computeQuestTarget,
  createInitialQuests,
  onChestOpenedForQuests,
  onEnemyDefeated,
  onNpcTalked,
  pickTrackedQuestId,
} from './quests';
import {
  DEFAULT_GAME_OPTIONS,
  hasSaveData,
  loadGame,
  saveGame,
  serializeGameState,
  type StorageLike,
} from './saveSystem';
import {
  SHIP_BOARDING_RADIUS,
  SHIP_COMPANION_DECK_LOCAL,
  SHIP_HERO_DECK_LOCAL,
  SHIP_PHYSICS_CONFIG,
  evaluateParabolicJump,
  getShipDeckWorldAnchor,
  getShipForward,
  mapInputStateToShipControls,
  stepShipPhysics,
  updateShipIdleBobbing,
} from './shipPhysics';
import {
  ensureBoatOnWater,
  findSafeDisembarkSpot,
  findSafeLandPositionOnIsland,
  getDefaultAnchorageForIsland,
  getDefaultBoatSpawnOnFelingard,
  getIslandName,
  resolveShipCoastCollision,
  sampleShorelineField,
} from './shorelineNavigation';
import type {
  ActiveModal,
  AttackMetadata,
  ChestInstance,
  CinematicKind,
  CinematicState,
  CompanionReactionKind,
  DecorMaterialKind,
  DialogueAction,
  DialogueLine,
  EnemyInstance,
  EquipSlot,
  GameEvent,
  GameState,
  InputState,
  Interactable,
  IslandId,
  LootDrop,
  LootDropKind,
  MusicTrackId,
  MysteryChestResult,
  PropKind,
  QuestId,
  ShipDisembarkStatus,
  ShipSlot,
  ShipState,
  SpellId,
  TerrainSurfaceId,
  Vec2,
  WildlifeDensity,
  ZoneId,
} from './types';
import { STARTING_EQUIPMENT } from './types';

export interface GameEngineOptions {
  storage?: StorageLike | null;
  rng?: () => number;
}

const INN_RESPAWN_POS: Vec2 = { x: -7, z: 23.2 };
const DODGE_GHOST_INTERVAL = 0.065;
const BOARDING_DURATION = 0.44;
const BOARDING_ARC_HEIGHT = 1.95;
const DISEMBARKING_DURATION = 0.42;
const DISEMBARKING_ARC_HEIGHT = 1.85;
const SHIP_REFUSAL_COOLDOWN = 1.4;
export const CHEST_OPEN_DURATION = 1.35;
export const PORTAL_ENTER_DURATION = 1.40;
export const PORTAL_EXIT_DURATION = 0.40;
export const PORTAL_MAX_DURATION = 2.40;
export const HERO_DEATH_DURATION = 2.0;
const INTERACT_CLOSE_DIST = 1.68;
const INTERACT_APPROACH_EXTRA = 2.4;
const COMBAT_MUSIC_HOLD_SEC = 4.5;
export const FOOTSTEP_STRIDE_DIST = 1.8;
export const LOW_HP_ALERT_THRESHOLD = 0.2;
export const LOW_HP_ALERT_COOLDOWN_SEC = 6.5;

let nextLootDropId = 1;
let nextCinematicId = 1;

function splitRewardAmounts(total: number, count: number): number[] {
  const safeTotal = Math.max(0, Math.round(total));
  if (safeTotal <= 0) return [];
  const pieces = Math.max(1, Math.min(safeTotal, Math.floor(count)));
  const base = Math.floor(safeTotal / pieces);
  let rem = safeTotal % pieces;
  const result: number[] = [];
  for (let i = 0; i < pieces; i++) {
    const extra = rem > 0 ? 1 : 0;
    if (rem > 0) rem -= 1;
    result.push(base + extra);
  }
  return result;
}

/**
 * Résout la surface sonore de pas au sol à partir de la zone, de l'île,
 * des coordonnées monde et de la présence sur le pont du Patte-au-Vent.
 */
export function resolveFootstepSurface(
  zoneId: ZoneId,
  islandId: IslandId,
  x: number,
  z: number,
  onShipDeck: boolean,
): TerrainSurfaceId {
  if (onShipDeck) return 'wood_deck';
  if (zoneId !== 'overworld') return 'dungeon_tiles';

  const shore = sampleShorelineField(x, z);
  const biome =
    islandId === 'felingard'
      ? getBiomeAt(x, z)
      : getBiomeAtNewIsland(islandId, x, z);

  if (biome === 'tropical') return 'sand';
  if (biome === 'frost' || biome === 'mountain') return 'snow_ice';
  if (biome === 'village' || biome === 'mystic') return 'rock';
  if (shore.signedDistance >= -4.2) {
    return shore.coastKind === 'beach' ? 'sand' : 'rock';
  }
  return 'grass';
}

function createEmptyDisembarkStatus(): ShipDisembarkStatus {
  return {
    canDisembark: false,
    nearestIslandId: null,
    coastDistance: Infinity,
    coastKind: 'beach',
  };
}

function createDefaultUnlockedSlots(): Record<ShipSlot, boolean> {
  return {
    coque: true,
    puissance_canon: true,
    cadence: false,
    capacite_munitions: false,
    rechargement: false,
    patte_boost: false,
    super_patte_canon: false,
    patte_canon_magma: false,
    patte_canon_electrique: false,
    patte_canon_maudite: false,
    redoutable_canard: false,
  };
}

function createInitialShipState(): ShipState {
  const spawn = getDefaultBoatSpawnOnFelingard();
  return {
    mode: 'parked',
    isSailing: false,
    position: { x: spawn.position.x, z: spawn.position.z },
    angle: spawn.angle,
    vx: 0,
    vz: 0,
    speed: 0,
    angularVelocity: 0,
    rudder: 0,
    roll: 0,
    pitch: 0,
    bobPhase: 0,
    bobY: 0,
    wakeIntensity: 0,
    reverseEngageTimer: 0,
    isCollidingShore: false,
    nearestCoastIslandId: 'felingard',
    dockedIslandId: 'felingard',
    transition: null,
    disembarkStatus: createEmptyDisembarkStatus(),
    hullHp: 100,
    maxHullHp: 100,
    ammo: 0,
    maxAmmo: 20,
    reloadTimer: 0,
    equippedBlueprints: {},
    unlockedSlots: createDefaultUnlockedSlots(),
  };
}

export class GameEngine {
  public readonly state: GameState;
  private readonly storage?: StorageLike | null;
  private readonly rng: () => number;
  private dodgeGhostAccum = 0;
  private shipRefusalCooldown = 0;
  private disembarkChangedIsland = false;
  private footstepDistanceAccum = 0;
  private lowHpAlertCooldown = 0;
  private wasLowHp = false;
  private activeHazardSlowFactor = 0;
  private pendingCinematicDialogue: { lines: DialogueLine[]; action: DialogueAction } | null = null;
  private companionChimeCooldown = 0;
  private companionReactionCooldown = 0;
  private lastCompanionGuideTargetId = '';
  private readonly decorHitCooldowns = new Map<string, number>();

  constructor(options?: GameEngineOptions) {
    this.storage = options?.storage;
    this.rng = options?.rng ?? Math.random;

    const player = createInitialPlayerState();
    player.elevationY = 0;
    player.onShipDeck = false;
    const quests = createInitialQuests();

    this.state = {
      screen: 'title',
      activeModal: 'none',
      zoneId: 'overworld',
      islandId: 'felingard',
      time: 0,
      hitstopTimer: 0,
      screenShake: 0,
      transitionTimer: 0,
      transitionFade: 0,
      player,
      companion: {
        x: player.x - 1.4,
        z: player.z - 0.8,
        bobPhase: 0,
        y: 0,
        onShipDeck: false,
        mode: 'follow',
        guideKind: null,
        guidePulse: 0,
        reactionKind: null,
        reactionTimer: 0,
        reactionDuration: 0,
      },
      ship: createInitialShipState(),
      enemies: [],
      telegraphs: [],
      chests: [],
      traps: [],
      healingCrystals: [],
      activeSpellEffects: [],
      dodgeGhosts: [],
      interactables: [],
      nearestInteractable: null,
      quests,
      trackedQuestId: 'main_dragon_blood',
      questTarget: null,
      openedChestIds: [],
      defeatedBossIds: [],
      dialogue: {
        active: false,
        lines: [],
        currentIndex: 0,
        onCompleteAction: 'none',
      },
      runStats: {
        playTimeSec: 0,
        enemiesDefeated: 0,
        chestsOpened: 0,
      },
      events: [],
      activeBossId: null,
      victoryShown: false,
      inVillage: true,
      pendingInteraction: null,
      openingChest: null,
      portalTransition: null,
      deathSequence: null,
      inCombat: false,
      combatMusicTimer: 0,
      timeScale: 1,
      perfectDodgeTimer: 0,
      lowHpActive: false,
      lowHpIntensity: 0,
      lastAttackMeta: null,
      playerProjectiles: [],
      lootDrops: [],
      enemyProjectiles: [],
      hazardZones: [],
      cinematic: null,
      playedBossIntros: [],
      options: { ...DEFAULT_GAME_OPTIONS },
    };

    // Peuple immédiatement l'overworld pour le survol animé de l'écran titre
    this.loadZone('overworld', { ...OVERWORLD_DATA.playerStart }, false);
    this.state.transitionTimer = 0;
    this.state.transitionFade = 0;
  }

  // ==========================================================================
  // Cycle de partie : Nouvelle Partie / Continuer / Sauvegarde / Écrans
  // ==========================================================================

  public hasSavedGame(): boolean {
    return hasSaveData(this.storage);
  }

  public startNewGame(): void {
    const freshPlayer = createInitialPlayerState();
    freshPlayer.elevationY = 0;
    freshPlayer.onShipDeck = false;
    this.state.player = freshPlayer;
    this.state.islandId = 'felingard';
    this.state.ship = createInitialShipState();
    this.shipRefusalCooldown = 0;
    this.disembarkChangedIsland = false;
    this.footstepDistanceAccum = 0;
    this.lowHpAlertCooldown = 0;
    this.wasLowHp = false;
    this.state.quests = createInitialQuests();
    this.state.trackedQuestId = 'main_dragon_blood';
    this.state.openedChestIds = [];
    this.state.defeatedBossIds = [];
    this.state.runStats = {
      playTimeSec: 0,
      enemiesDefeated: 0,
      chestsOpened: 0,
    };
    this.state.events = [];
    this.state.hitstopTimer = 0;
    this.state.screenShake = 0;
    this.state.victoryShown = false;
    this.state.activeModal = 'none';
    this.state.pendingInteraction = null;
    this.state.openingChest = null;
    this.state.portalTransition = null;
    this.state.deathSequence = null;
    this.state.inCombat = false;
    this.state.combatMusicTimer = 0;
    this.state.timeScale = 1;
    this.state.perfectDodgeTimer = 0;
    this.state.lowHpActive = false;
    this.state.lowHpIntensity = 0;
    this.state.lastAttackMeta = null;
    this.state.playerProjectiles = [];
    this.state.lootDrops = [];
    this.state.enemyProjectiles = [];
    this.state.hazardZones = [];
    this.state.cinematic = null;
    this.state.playedBossIntros = [];
    this.activeHazardSlowFactor = 0;
    this.pendingCinematicDialogue = null;
    this.companionChimeCooldown = 0;
    this.companionReactionCooldown = 0;
    this.lastCompanionGuideTargetId = '';
    this.decorHitCooldowns.clear();
    this.state.companion = {
      x: freshPlayer.x - 1.4,
      z: freshPlayer.z - 0.8,
      bobPhase: 0,
      y: 0,
      onShipDeck: false,
      mode: 'follow',
      guideKind: null,
      guidePulse: 0,
      reactionKind: null,
      reactionTimer: 0,
      reactionDuration: 0,
    };
    this.state.screen = 'playing';

    this.loadZone('overworld', { ...OVERWORLD_DATA.playerStart }, true);
    this.startDialogue(INTRO_DIALOGUE, 'none');
  }

  public continueSavedGame(): boolean {
    const saved = loadGame(this.storage);
    if (!saved) return false;

    const p = createInitialPlayerState();
    p.level = saved.player.level;
    p.xp = saved.player.xp;
    p.xpToNext = getXpToNextLevel(p.level);
    p.gold = saved.player.gold;
    p.equipped = { ...STARTING_EQUIPMENT, ...saved.player.equipped };
    p.inventory = {};
    for (const [id, item] of Object.entries(saved.player.inventory)) {
      p.inventory[id] = {
        id: item.id,
        level: item.level,
        upgradeLevel: item.upgradeLevel ?? 0,
      };
    }
    p.spellLevels = { ...saved.player.spellLevels };
    p.hasRunicKey = saved.player.hasRunicKey;
    p.elevationY = 0;
    p.onShipDeck = false;

    recalculatePlayerStats(p);
    p.hp = clamp(saved.player.hp, 1, p.maxHp);
    p.mp = clamp(saved.player.mp, 0, p.maxMp);

    const savedIsland: IslandId = saved.islandId ?? 'felingard';
    this.state.player = p;
    this.state.islandId = savedIsland;
    this.state.quests = {
      main_dragon_blood: { ...saved.quests.main_dragon_blood },
      side_yarn_hunt: { ...saved.quests.side_yarn_hunt },
      side_lost_blade: { ...saved.quests.side_lost_blade },
    };
    this.state.trackedQuestId = pickTrackedQuestId(
      this.state.quests,
      saved.trackedQuestId,
    );
    this.state.openedChestIds = [...saved.openedChestIds];
    this.state.defeatedBossIds = [...saved.defeatedBossIds];
    this.state.runStats = { ...saved.runStats };
    this.state.victoryShown =
      this.state.defeatedBossIds.includes('boss_dragon_claw') &&
      this.state.quests.main_dragon_blood.status === 'completed';

    this.state.events = [];
    this.state.dialogue = {
      active: false,
      lines: [],
      currentIndex: 0,
      onCompleteAction: 'none',
    };
    this.state.activeModal = 'none';
    this.state.timeScale = 1;
    this.state.perfectDodgeTimer = 0;
    this.state.lowHpActive = false;
    this.state.lowHpIntensity = 0;
    this.state.lastAttackMeta = null;
    this.state.playerProjectiles = [];
    this.state.lootDrops = [];
    this.state.enemyProjectiles = [];
    this.state.hazardZones = [];
    this.state.cinematic = null;
    this.state.playedBossIntros = [];
    this.activeHazardSlowFactor = 0;
    this.pendingCinematicDialogue = null;
    this.companionChimeCooldown = 0;
    this.companionReactionCooldown = 0;
    this.lastCompanionGuideTargetId = '';
    this.decorHitCooldowns.clear();
    this.state.companion = {
      x: p.x - 1.4,
      z: p.z - 0.8,
      bobPhase: 0,
      y: 0,
      onShipDeck: false,
      mode: 'follow',
      guideKind: null,
      guidePulse: 0,
      reactionKind: null,
      reactionTimer: 0,
      reactionDuration: 0,
    };
    if (saved.options?.wildlifeDensity) {
      this.state.options = { wildlifeDensity: saved.options.wildlifeDensity };
    } else if (!this.state.options) {
      this.state.options = { ...DEFAULT_GAME_OPTIONS };
    }
    this.state.screen = 'playing';
    this.shipRefusalCooldown = 0;
    this.disembarkChangedIsland = false;
    this.footstepDistanceAccum = 0;
    this.lowHpAlertCooldown = 0;
    this.wasLowHp = false;

    // Restauration / migration du bateau (v2 avec ship ou v1 sans ship)
    const ship = createInitialShipState();
    this.state.ship = ship;

    if (saved.ship) {
      ship.hullHp = saved.ship.hullHp;
      ship.maxHullHp = saved.ship.maxHullHp;
      ship.ammo = saved.ship.ammo;
      ship.maxAmmo = saved.ship.maxAmmo;
      ship.reloadTimer = 0;
      ship.equippedBlueprints = { ...saved.ship.equippedBlueprints };
      ship.unlockedSlots = { ...saved.ship.unlockedSlots };

      const preferredIsland = saved.ship.dockedIslandId ?? savedIsland;
      const safeBoat = ensureBoatOnWater(
        saved.ship.position,
        saved.ship.angle,
        preferredIsland,
      );
      ship.position = { x: safeBoat.position.x, z: safeBoat.position.z };
      ship.angle = safeBoat.angle;

      if (saved.ship.mode === 'sailing') {
        ship.mode = 'sailing';
        ship.isSailing = true;
        ship.dockedIslandId = null;
        ship.nearestCoastIslandId = null;

        this.loadZone('overworld', { x: ship.position.x, z: ship.position.z }, true);
        this.state.islandId = savedIsland;
        this.state.inVillage = false;
        this.syncCrewToShipDeck();
        this.refreshShipDisembarkStatus();
        this.updateNearestInteractable();
        return true;
      }

      // Mode 'parked' (v2) : position terrestre sûre + bateau conservé sur l'eau
      ship.mode = 'parked';
      ship.isSailing = false;
      ship.dockedIslandId = saved.ship.dockedIslandId ?? savedIsland;
      ship.nearestCoastIslandId = ship.dockedIslandId;

      const safeLandPos = findSafeLandPositionOnIsland(
        savedIsland,
        saved.player.position,
      );
      this.loadZone('overworld', safeLandPos, true);
      this.state.islandId = savedIsland;
      return true;
    }

    // Migration d'une ancienne sauvegarde v1 (sans champ `ship`) :
    // place le joueur sur terre sûre et ancre le bateau au mouillage côtier sûr de l'île.
    const anchorage = getDefaultAnchorageForIsland(savedIsland);
    ship.mode = 'parked';
    ship.isSailing = false;
    ship.position = { x: anchorage.position.x, z: anchorage.position.z };
    ship.angle = anchorage.angle;
    ship.dockedIslandId = savedIsland;
    ship.nearestCoastIslandId = savedIsland;

    const safeLandPos =
      savedIsland === 'felingard' && saved.player.position === undefined
        ? { ...OVERWORLD_DATA.playerStart }
        : findSafeLandPositionOnIsland(savedIsland, saved.player.position);

    this.loadZone('overworld', safeLandPos, true);
    this.state.islandId = savedIsland;
    return true;
  }

  public saveCurrentGame(): boolean {
    const snapshot = serializeGameState(this.state);
    return saveGame(snapshot, this.storage);
  }

  public setWildlifeDensity(density: WildlifeDensity): void {
    this.state.options.wildlifeDensity = density;
    if (this.state.screen === 'playing') {
      this.saveCurrentGame();
    }
  }

  public returnToTitle(): void {
    this.state.activeModal = 'none';
    this.state.cinematic = null;
    this.state.portalTransition = null;
    this.state.timeScale = 1;
    this.state.enemyProjectiles = [];
    this.state.hazardZones = [];
    this.activeHazardSlowFactor = 0;
    this.pendingCinematicDialogue = null;
    this.state.dialogue = {
      active: false,
      lines: [],
      currentIndex: 0,
      onCompleteAction: 'none',
    };
    const shouldReloadOverworld =
      this.state.zoneId !== 'overworld' ||
      this.state.islandId !== 'felingard' ||
      this.state.ship.mode !== 'parked';
    this.state.screen = 'title';
    this.state.islandId = 'felingard';
    this.state.ship = createInitialShipState();
    this.state.player.elevationY = 0;
    this.state.player.onShipDeck = false;
    this.footstepDistanceAccum = 0;
    this.state.companion.y = 0;
    this.state.companion.onShipDeck = false;
    this.shipRefusalCooldown = 0;
    this.disembarkChangedIsland = false;
    if (shouldReloadOverworld) {
      this.loadZone('overworld', { ...OVERWORLD_DATA.playerStart }, false);
    }
    this.state.transitionTimer = 0;
    this.state.transitionFade = 0;
  }

  public resumeGame(): void {
    this.state.activeModal = 'none';
    if (this.state.screen === 'paused') {
      this.state.screen = 'playing';
    }
  }

  public respawnAtInn(): void {
    const p = this.state.player;
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.invulnTimer = 0.8;
    p.hitFlashTimer = 0;
    p.regenTimer = 0;
    p.regenTickAccum = 0;
    p.dodgeTimer = 0;
    p.dodgeCooldown = 0;
    p.attackCooldown = 0;
    p.attackAnimTimer = 0;
    p.knockbackVx = 0;
    p.knockbackVz = 0;
    p.elevationY = 0;
    p.onShipDeck = false;
    p.shieldHp = 0;
    p.shieldMaxHp = 0;
    p.shieldTimer = 0;
    p.activeStatuses = [];
    p.perfectDodgeBuffTimer = 0;
    for (const sid of SPELL_ORDER) {
      p.spellCooldowns[sid] = 0;
    }

    this.state.companion.y = 0;
    this.state.companion.onShipDeck = false;

    this.state.activeModal = 'none';
    this.state.pendingInteraction = null;
    this.state.openingChest = null;
    this.state.portalTransition = null;
    this.state.deathSequence = null;
    this.state.inCombat = false;
    this.state.combatMusicTimer = 0;
    this.state.timeScale = 1;
    this.state.perfectDodgeTimer = 0;
    this.state.lowHpActive = false;
    this.state.lowHpIntensity = 0;
    this.state.lastAttackMeta = null;
    this.state.playerProjectiles = [];
    this.state.lootDrops = [];
    this.state.enemyProjectiles = [];
    this.state.hazardZones = [];
    this.state.cinematic = null;
    this.activeHazardSlowFactor = 0;
    this.pendingCinematicDialogue = null;
    this.state.dialogue = {
      active: false,
      lines: [],
      currentIndex: 0,
      onCompleteAction: 'none',
    };
    this.state.screen = 'playing';
    this.shipRefusalCooldown = 0;
    this.disembarkChangedIsland = false;
    this.footstepDistanceAccum = 0;
    this.lowHpAlertCooldown = 0;
    this.wasLowHp = false;

    // Évite tout soft-lock : si le navire était en mer ou sur une autre île,
    // on le rapatrie au mouillage côtier par défaut de Félingard.
    // S'il était déjà ancré sur Félingard, on conserve sa position exacte !
    const ship = this.state.ship;
    const shouldRepatriateShip =
      ship.mode !== 'parked' || ship.dockedIslandId !== 'felingard';
    if (shouldRepatriateShip) {
      const felingardSpawn = getDefaultBoatSpawnOnFelingard();
      ship.position = { x: felingardSpawn.position.x, z: felingardSpawn.position.z };
      ship.angle = felingardSpawn.angle;
      ship.dockedIslandId = 'felingard';
      ship.nearestCoastIslandId = 'felingard';
    }
    ship.mode = 'parked';
    ship.isSailing = false;
    ship.vx = 0;
    ship.vz = 0;
    ship.speed = 0;
    ship.angularVelocity = 0;
    ship.rudder = 0;
    ship.roll = 0;
    ship.pitch = 0;
    ship.wakeIntensity = 0;
    ship.reverseEngageTimer = 0;
    ship.isCollidingShore = false;
    ship.transition = null;
    ship.disembarkStatus = createEmptyDisembarkStatus();

    this.state.islandId = 'felingard';
    this.loadZone('overworld', { ...INN_RESPAWN_POS }, true);
    this.state.events.push({
      type: 'player_rested',
      x: p.x,
      z: p.z,
      text: "Réveil à l'Auberge du Coussin Doux — rien n'est perdu !",
    });
    this.saveCurrentGame();
  }

  public continueAfterVictory(): void {
    this.state.screen = 'playing';
    this.state.activeModal = 'none';
    this.state.victoryShown = true;
  }

  // ==========================================================================
  // Flux d'événements pour Rendu / Audio / UI
  // ==========================================================================

  public consumeEvents(): GameEvent[] {
    if (this.state.events.length === 0) return [];
    const batch = this.state.events;
    this.state.events = [];
    return batch;
  }

  public peekEvents(): readonly GameEvent[] {
    return this.state.events;
  }

  public getActiveBoss(): EnemyInstance | null {
    if (!this.state.activeBossId) return null;
    const boss = this.state.enemies.find(
      (e) => e.id === this.state.activeBossId && e.state !== 'dead' && e.hp > 0,
    );
    return boss ?? null;
  }

  public getCurrentMusicTrack(): MusicTrackId {
    if (this.state.screen === 'title') {
      return 'menu';
    }
    if (this.state.screen === 'victory') {
      return 'victory';
    }
    if (
      this.state.cinematic?.kind === 'boss_death' &&
      this.state.cinematic.bossTypeId === 'boss_dragon_claw'
    ) {
      return 'victory';
    }
    if (this.state.zoneId === 'dungeon_dragon_lair') {
      const activeBoss = this.getActiveBoss();
      if (activeBoss?.typeId === 'boss_dragon_claw' && activeBoss.phase === 2) {
        return 'boss_phase2';
      }
      if (this.state.defeatedBossIds.includes('boss_dragon_claw') && !activeBoss) {
        return 'dungeon';
      }
      return 'boss';
    }
    const isCombatActive =
      Boolean(this.state.inCombat) || (this.state.combatMusicTimer ?? 0) > 0;
    if (this.state.zoneId === 'dungeon_ghost_cave') {
      const activeBoss = this.getActiveBoss();
      if (activeBoss) return 'boss';
      if (isCombatActive) return 'combat';
      return 'dungeon';
    }
    if (
      this.state.ship.mode === 'sailing' ||
      this.state.ship.mode === 'boarding' ||
      this.state.ship.mode === 'docking' ||
      this.state.ship.mode === 'disembarking'
    ) {
      return 'maritime';
    }
    if (isCombatActive) {
      return 'combat';
    }
    return 'overworld';
  }

  // ==========================================================================
  // Boucle de Simulation Principale : step(rawDt, input)
  // ==========================================================================

  public step(rawDt: number, input: InputState): void {
    // Clamp obligatoire du delta-time (max 50 ms)
    const clampedRawDt = Math.min(Math.max(rawDt, 0), 0.05);

    // Décroissance des transitions visuelles et du screen shake (même en hitstop)
    if (this.state.transitionTimer > 0) {
      this.state.transitionTimer = Math.max(0, this.state.transitionTimer - clampedRawDt);
      this.state.transitionFade = clamp(this.state.transitionTimer / PORTAL_EXIT_DURATION, 0, 1);
    } else if (!this.state.portalTransition) {
      this.state.transitionFade = 0;
    }

    if (this.state.screenShake > 0) {
      this.state.screenShake = Math.max(0, this.state.screenShake - clampedRawDt * 2.4);
    }

    // Écran Titre / Défaite / Victoire : horloge ambiante + douce flottaison du bateau
    if (
      this.state.screen === 'title' ||
      this.state.screen === 'defeat' ||
      this.state.screen === 'victory'
    ) {
      this.state.timeScale = 1;
      this.state.perfectDodgeTimer = 0;
      this.state.time += clampedRawDt;
      if (this.state.zoneId === 'overworld' && this.state.ship.mode === 'parked') {
        updateShipIdleBobbing(this.state.ship, clampedRawDt);
      }
      return;
    }

    // Dialogue actif : bloque le combat jusqu'à validation
    if (this.state.dialogue.active) {
      this.state.timeScale = 1;
      this.state.perfectDodgeTimer = 0;
      this.state.time += clampedRawDt;
      if (this.state.zoneId === 'overworld' && this.state.ship.mode === 'parked') {
        updateShipIdleBobbing(this.state.ship, clampedRawDt);
      }
      if (
        input.confirmPressed ||
        input.interactPressed ||
        input.attackPressed ||
        input.pausePressed
      ) {
        this.advanceDialogue();
      }
      return;
    }

    // Gestion des raccourcis Pause / Inventaire / Carte
    if (input.pausePressed) {
      if (this.state.activeModal !== 'none') {
        this.closeModal();
      } else {
        this.openModal('pause');
      }
      return;
    }

    if (this.state.screen !== 'paused' && input.toggleInventoryPressed) {
      this.toggleModal('inventory');
      return;
    }

    if (this.state.screen !== 'paused' && input.toggleMapPressed) {
      this.toggleModal('map');
      return;
    }

    // Simulation figée lorsque le jeu est en pause ou qu'une modale est ouverte
    if (this.state.screen === 'paused' || this.state.activeModal !== 'none') {
      return;
    }

    // Hitstop : fige la simulation quelques dizaines de ms sur impacts majeurs
    if (this.state.hitstopTimer > 0) {
      this.state.hitstopTimer = Math.max(0, this.state.hitstopTimer - clampedRawDt);
      return;
    }

    // Cinématique de Boss (Intro / Mort) : invulnérabilité joueur, verrouillage contrôles & watchdog anti-blocage
    if (this.state.cinematic) {
      this.updateCinematic(clampedRawDt);
      return;
    }

    // Ralenti micro-temporel d'esquive parfaite (décrémenté en temps réel non ralenti)
    if (this.state.perfectDodgeTimer > 0) {
      this.state.perfectDodgeTimer = Math.max(
        0,
        this.state.perfectDodgeTimer - clampedRawDt,
      );
      this.state.timeScale =
        this.state.perfectDodgeTimer > 0 ? PERFECT_DODGE_TIMESCALE : 1.0;
    } else {
      this.state.timeScale = 1.0;
    }

    const dt = clampedRawDt * this.state.timeScale;

    // Avance les horloges de jeu
    this.state.time += dt;
    this.state.runStats.playTimeSec += clampedRawDt;
    if (this.shipRefusalCooldown > 0) {
      this.shipRefusalCooldown = Math.max(0, this.shipRefusalCooldown - clampedRawDt);
    }

    const player = this.state.player;
    if ((player.perfectDodgeBuffTimer ?? 0) > 0) {
      player.perfectDodgeBuffTimer = Math.max(
        0,
        (player.perfectDodgeBuffTimer ?? 0) - clampedRawDt,
      );
    }

    // --- 1. Mise à jour des timers joueur, régénération et VFX transitoires ---
    // (Actifs y compris pendant les transitions/navigation pour ne jamais figer les VFX)
    if (player.attackCooldown > 0) {
      player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    }
    if (player.attackAnimTimer > 0) {
      player.attackAnimTimer = Math.max(0, player.attackAnimTimer - dt);
    }
    if (player.comboResetTimer > 0) {
      player.comboResetTimer = Math.max(0, player.comboResetTimer - dt);
      if (player.comboResetTimer <= 0) {
        player.comboStep = 0;
      }
    }
    if (player.dodgeCooldown > 0) {
      player.dodgeCooldown = Math.max(0, player.dodgeCooldown - dt);
    }
    if (player.invulnTimer > 0) {
      player.invulnTimer = Math.max(0, player.invulnTimer - dt);
    }
    if (player.hitFlashTimer > 0) {
      player.hitFlashTimer = Math.max(0, player.hitFlashTimer - dt);
    }
    for (const sid of SPELL_ORDER) {
      if (player.spellCooldowns[sid] > 0) {
        player.spellCooldowns[sid] = Math.max(0, player.spellCooldowns[sid] - dt);
      }
    }

    // Régénération Soin-velours & bouclier Égide de Ronron
    updatePlayerRegen(player, dt, this.state.events);
    updatePlayerShield(player, dt);

    const eventStartIdx = this.state.events.length;

    // Effets visuels temporaires (inclut les vagues de Chute d'Étoiles)
    this.updateTransientVisuals(dt);

    // --- Séquence animée de mort du héros (~2.0 s avant l'écran Défaite) ---
    if (this.state.deathSequence) {
      this.updateDeathSequence(dt);
      return;
    }

    // --- Séquence animée d'entrée / sortie de portail (non ralentie par timeScale) ---
    if (this.state.portalTransition) {
      this.updatePortalTransition(clampedRawDt);
      return;
    }

    // --- Séquence animée d'ouverture lente de coffre (~1.35 s, loot strictement à la fin) ---
    if (this.state.openingChest) {
      this.updateOpeningChest(dt, input);
      return;
    }

    // --- Machine à états maritime (boarding | sailing | docking | disembarking) ---
    if (this.state.ship.mode !== 'parked') {
      this.state.pendingInteraction = null;
      this.stepMaritimeState(dt, input);
      return;
    }

    // En mode 'parked' sur l'overworld : flottaison douce du bateau ancré
    if (this.state.zoneId === 'overworld') {
      updateShipIdleBobbing(this.state.ship, dt);
    }

    // --- 2. Orientation & Visée ---
    const playerStunned = isEntityStunned(player);
    const moveMag = Math.hypot(input.moveX, input.moveZ);
    if (!playerStunned) {
      if (input.usingPointerAim && input.aimWorldPos) {
        player.aimAngle = angleBetween(
          player.x,
          player.z,
          input.aimWorldPos.x,
          input.aimWorldPos.z,
        );
        const aimCos = Math.cos(player.aimAngle);
        if (Math.abs(aimCos) > 0.1 && (input.attackPressed || moveMag < 0.05)) {
          player.facingX = aimCos >= 0 ? 1 : -1;
        }
      } else if (moveMag > 0.05) {
        player.aimAngle = Math.atan2(input.moveZ, input.moveX);
      }

      if (Math.abs(input.moveX) > 0.05 && player.dodgeTimer <= 0) {
        player.facingX = input.moveX >= 0 ? 1 : -1;
      }
    }

    // --- 3. Interaction contextuelle ([E] prioritaire sur Sort 2) ---
    this.updateNearestInteractable();
    let interactedThisTick = false;
    if (!playerStunned && input.interactPressed && this.state.nearestInteractable) {
      this.initiateInteractionOrApproach(this.state.nearestInteractable, false);
      interactedThisTick = true;
      if (
        this.state.ship.mode !== 'parked' ||
        this.state.portalTransition ||
        this.state.openingChest
      ) {
        return;
      }
      if (
        this.state.dialogue.active ||
        this.state.activeModal !== 'none' ||
        this.state.screen !== 'playing'
      ) {
        return;
      }
    }

    // Annulation propre de l'approche automatique si le joueur reprend la main
    if (
      this.state.pendingInteraction &&
      (moveMag > 0.12 ||
        input.dodgePressed ||
        input.attackPressed ||
        SPELL_ORDER.some((sid) => !(sid === 'lightnyan' && interactedThisTick) && input.spellPressed[sid]))
    ) {
      this.state.pendingInteraction = null;
    }

    // --- 4. Roulade d'esquive (dodge-cancel prioritaire sur mêlée + détection Esquive Parfaite) ---
    if (!playerStunned && input.dodgePressed) {
      const dodged = executeDodgeRoll(
        player,
        input.moveX,
        input.moveZ,
        this.state.events,
        this.state.dodgeGhosts,
      );
      if (dodged) {
        this.dodgeGhostAccum = 0;
        this.checkPerfectDodge();
      }
    }

    // --- 5. Déplacement du joueur (ou approche automatique vers un interactable) ---
    const preMoveX = player.x;
    const preMoveZ = player.z;
    if (this.state.pendingInteraction && player.dodgeTimer <= 0 && !playerStunned) {
      this.stepPendingInteraction(dt);
      const movedPending = Math.hypot(player.x - preMoveX, player.z - preMoveZ);
      this.accumulateFootstep(movedPending);
      if (
        this.state.ship.mode !== 'parked' ||
        this.state.portalTransition ||
        this.state.openingChest ||
        this.state.dialogue.active ||
        this.state.activeModal !== 'none' ||
        this.state.screen !== 'playing'
      ) {
        return;
      }
    } else if (player.dodgeTimer > 0) {
      const dx = (player.dodgeDirX ?? Math.cos(player.aimAngle)) * DODGE_SPEED;
      const dz = (player.dodgeDirZ ?? Math.sin(player.aimAngle)) * DODGE_SPEED;
      player.vx = dx;
      player.vz = dz;

      const resolved = this.resolvePositionInCurrentZone(
        player.x + dx * dt,
        player.z + dz * dt,
        PLAYER_RADIUS,
        false,
      );
      player.x = resolved.x;
      player.z = resolved.z;

      player.dodgeTimer = Math.max(0, player.dodgeTimer - dt);
      this.dodgeGhostAccum += dt;
      if (this.dodgeGhostAccum >= DODGE_GHOST_INTERVAL) {
        this.dodgeGhostAccum -= DODGE_GHOST_INTERVAL;
        this.state.dodgeGhosts.push({
          x: player.x,
          z: player.z,
          facingX: player.facingX,
          age: 0,
          duration: 0.24,
        });
      }
    } else {
      let mx = playerStunned ? 0 : input.moveX;
      let mz = playerStunned ? 0 : input.moveZ;
      if (moveMag > 1) {
        mx /= moveMag;
        mz /= moveMag;
      }
      const totalSlow = Math.min(
        0.65,
        Math.max(getChillSlowFactor(player), this.activeHazardSlowFactor),
      );
      const speedScale =
        (player.attackAnimTimer > 0 ? 0.55 : 1.0) * (1 - totalSlow);
      let vx = mx * PLAYER_MOVE_SPEED * speedScale;
      let vz = mz * PLAYER_MOVE_SPEED * speedScale;

      if (player.knockbackVx || player.knockbackVz) {
        vx += player.knockbackVx ?? 0;
        vz += player.knockbackVz ?? 0;
        const damp = Math.exp(-12 * dt);
        player.knockbackVx = (player.knockbackVx ?? 0) * damp;
        player.knockbackVz = (player.knockbackVz ?? 0) * damp;
        if (Math.hypot(player.knockbackVx, player.knockbackVz) < 0.1) {
          player.knockbackVx = 0;
          player.knockbackVz = 0;
        }
      }

      player.vx = vx;
      player.vz = vz;

      if (Math.hypot(vx, vz) > 1e-4) {
        const resolved = this.resolvePositionInCurrentZone(
          player.x + vx * dt,
          player.z + vz * dt,
          PLAYER_RADIUS,
          false,
        );
        player.x = resolved.x;
        player.z = resolved.z;
      }
      const movedOnFoot = Math.hypot(player.x - preMoveX, player.z - preMoveZ);
      this.accumulateFootstep(movedOnFoot);
    }

    this.state.inVillage =
      this.state.zoneId === 'overworld' &&
      this.state.islandId === 'felingard' &&
      isInsideVillage(player.x, player.z);

    // Décroissance des cooldowns de réaction du décor interactif
    if (this.decorHitCooldowns.size > 0) {
      for (const [key, cd] of this.decorHitCooldowns.entries()) {
        if (cd <= dt) {
          this.decorHitCooldowns.delete(key);
        } else {
          this.decorHitCooldowns.set(key, cd - dt);
        }
      }
    }

    // --- 6. Attaque Mêlée / Distance (combatProfile) ---
    if (
      !playerStunned &&
      (input.attackPressed || (input.attackHeld && player.attackCooldown <= 0)) &&
      player.dodgeTimer <= 0
    ) {
      const hasExplicitPointerAim =
        input.usingPointerAim && input.aimWorldPos !== null;
      const meleeRes = executeMeleeAttack(
        player,
        this.state.enemies,
        this.state.events,
        {
          rng: this.rng,
          autoAim: !hasExplicitPointerAim,
          projectiles: this.state.playerProjectiles,
          telegraphs: this.state.telegraphs,
          applyDash: (dx, dz) => {
            const next = this.resolvePositionInCurrentZone(
              player.x + dx,
              player.z + dz,
              PLAYER_RADIUS,
              false,
            );
            player.x = next.x;
            player.z = next.z;
          },
        },
      );

      if (meleeRes.executed) {
        this.state.lastAttackMeta = meleeRes.attackMeta ?? null;
        if (meleeRes.attackMeta && meleeRes.attackMeta.attackShape !== 'projectile') {
          this.triggerDecorHitsForMelee(meleeRes.attackMeta, player.x, player.z);
        }
        if (meleeRes.hitEnemies.length > 0) {
          this.markCombatActivity();
        }
        this.state.screenShake = Math.max(
          this.state.screenShake,
          meleeRes.shakeAmount,
        );
        if (meleeRes.triggeredHitstop) {
          this.state.hitstopTimer = Math.max(
            this.state.hitstopTimer,
            meleeRes.hitstopSec > 0 ? meleeRes.hitstopSec : HITSTOP_MAJOR_DURATION,
          );
        }
        for (const killed of meleeRes.killedEnemies) {
          this.handleEnemyKilled(killed);
        }
      }
    }

    // --- 7. Sorts (1-7 — E ignoré si interaction exécutée ce tick) ---
    if (!playerStunned) {
      for (const sid of SPELL_ORDER) {
        if (sid === 'lightnyan' && interactedThisTick) continue;
        if (input.spellPressed[sid]) {
          this.castSpellById(
            sid,
            input.usingPointerAim ? input.aimWorldPos : null,
          );
        }
      }
    }

    // --- 7b. Mise à jour des projectiles du joueur (Bâtons & Arcs/Arbalètes) ---
    this.triggerDecorHitsForProjectiles(dt);
    const projRes = updatePlayerProjectiles(
      this.state.playerProjectiles,
      this.state.enemies,
      player,
      this.state.events,
      {
        dt,
        rng: this.rng,
        telegraphs: this.state.telegraphs,
        isObstacleHit: (px, pz, pr) => this.isProjectileBlocked(px, pz, pr),
      },
    );
    if (projRes.hitEnemies.length > 0) {
      this.markCombatActivity();
    }
    if (projRes.shakeAmount > 0) {
      this.state.screenShake = Math.max(this.state.screenShake, projRes.shakeAmount);
    }
    if (projRes.triggeredHitstop) {
      this.state.hitstopTimer = Math.max(
        this.state.hitstopTimer,
        projRes.hitstopSec > 0 ? projRes.hitstopSec : HITSTOP_MAJOR_DURATION,
      );
    }
    for (const killed of projRes.killedEnemies) {
      this.handleEnemyKilled(killed);
    }

    // Réaction visuelle du Miaou-sprit sur coup critique joueur (mêlée, projectile ou sort)
    for (let ei = eventStartIdx; ei < this.state.events.length; ei++) {
      const ev = this.state.events[ei];
      if (ev.type === 'hit_enemy' && ev.isCrit) {
        this.triggerCompanionReaction('crit');
        break;
      }
    }

    // --- 8. Compagnon Miaou-sprit actif ---
    this.updateCompanion(dt);

    // --- 9. Pièges, IA Ennemis, Télégraphes & Statuts ---
    updateTraps(this.state.traps, player, this.state.telegraphs, dt);

    const enemyRes = updateEnemies(
      this.state.enemies,
      player,
      this.state.telegraphs,
      this.state.zoneId,
      dt,
      this.state.events,
      {
        rng: this.rng,
        resolvePosition: (x, z, r) =>
          this.resolvePositionInCurrentZone(x, z, r, true),
        clampTelegraphPoint: (x, z) => this.clampPointToCurrentZone(x, z),
      },
    );

    if (enemyRes.bossEnteredPhaseTwo) {
      this.state.screenShake = Math.max(this.state.screenShake, 0.65);
      if (enemyRes.bossEnteredPhaseTwo.typeId === 'boss_dragon_claw') {
        this.startDialogue(BOSS_DRAGON_PHASE2_DIALOGUE, 'none');
      }
    }

    const tgRes = updateTelegraphs(
      this.state.telegraphs,
      this.state.enemies,
      player,
      dt,
      this.state.events,
      {
        rng: this.rng,
        enemyProjectiles: this.state.enemyProjectiles,
        hazardZones: this.state.hazardZones,
      },
    );

    const eProjRes = updateEnemyProjectiles(
      this.state.enemyProjectiles,
      this.state.enemies,
      player,
      dt,
      this.state.events,
      {
        rng: this.rng,
        isObstacleHit: (px, pz, pr) => this.isProjectileBlocked(px, pz, pr),
      },
    );

    const hazRes = updateHazardZones(
      this.state.hazardZones,
      player,
      dt,
      this.state.events,
      { rng: this.rng },
    );
    this.activeHazardSlowFactor = hazRes.slowFactor;

    if (tgRes.playerHit || eProjRes.playerHit || hazRes.playerHit) {
      this.markCombatActivity();
    }

    const combinedShake = Math.max(tgRes.maxShake, eProjRes.maxShake);
    if (combinedShake > 0) {
      this.state.screenShake = Math.max(this.state.screenShake, combinedShake);
    }

    const playerStatusRes = updatePlayerStatuses(player, dt, this.state.events);
    const statusKilledEnemies = updateEnemyStatuses(
      this.state.enemies,
      dt,
      this.state.events,
    );
    for (const killed of statusKilledEnemies) {
      this.handleEnemyKilled(killed);
    }

    if (
      tgRes.playerDied ||
      eProjRes.playerDied ||
      hazRes.playerDied ||
      playerStatusRes.died ||
      player.hp <= 0
    ) {
      this.state.lowHpActive = false;
      this.state.lowHpIntensity = 0;
      this.startHeroDeathSequence();
      return;
    }

    // --- 10. Butin physique magnétique, musique, boss actif, intro boss, interactable, flèche dorée & PV bas ---
    this.updateLootDrops(dt);
    this.updateCombatMusicState(dt);
    this.updateActiveBoss();
    this.maybeTriggerBossIntro();
    this.updateNearestInteractable();
    this.refreshQuestTarget();
    this.updateLowHpAlert(clampedRawDt);
  }

  private accumulateFootstep(movedDist: number): void {
    if (
      movedDist <= 1e-5 ||
      this.state.screen !== 'playing' ||
      this.state.ship.mode !== 'parked' ||
      this.state.player.dodgeTimer > 0 ||
      this.state.deathSequence ||
      this.state.dialogue.active ||
      this.state.activeModal !== 'none'
    ) {
      return;
    }
    this.footstepDistanceAccum += movedDist;
    while (this.footstepDistanceAccum >= FOOTSTEP_STRIDE_DIST) {
      this.footstepDistanceAccum -= FOOTSTEP_STRIDE_DIST;
      const p = this.state.player;
      const terrain = resolveFootstepSurface(
        this.state.zoneId,
        this.state.islandId,
        p.x,
        p.z,
        Boolean(p.onShipDeck),
      );
      this.state.events.push({
        type: 'footstep',
        x: p.x,
        z: p.z,
        terrain,
      });
      if (this.state.zoneId === 'overworld' && !p.onShipDeck) {
        const shore = sampleShorelineField(p.x, p.z);
        if (
          shore.coastKind === 'beach' &&
          shore.signedDistance >= -3.6 &&
          shore.signedDistance <= 0.9
        ) {
          this.state.events.push({
            type: 'shore_splash',
            x: p.x,
            z: p.z,
          });
        }
      }
    }
  }

  private updateLowHpAlert(dt: number): void {
    const p = this.state.player;
    const ratio = p.hp / Math.max(1, p.maxHp);
    const isLow = p.hp > 0 && ratio < LOW_HP_ALERT_THRESHOLD;
    this.state.lowHpActive = isLow;
    this.state.lowHpIntensity = isLow
      ? clamp((LOW_HP_ALERT_THRESHOLD - ratio) / LOW_HP_ALERT_THRESHOLD, 0.18, 1)
      : 0;

    if (
      this.state.screen !== 'playing' ||
      this.state.deathSequence ||
      this.state.dialogue.active ||
      this.state.activeModal !== 'none' ||
      p.hp <= 0
    ) {
      return;
    }
    if (this.lowHpAlertCooldown > 0) {
      this.lowHpAlertCooldown = Math.max(0, this.lowHpAlertCooldown - dt);
    }
    if (isLow && (!this.wasLowHp || this.lowHpAlertCooldown <= 0)) {
      this.state.events.push({
        type: 'low_hp_alert',
        x: p.x,
        z: p.z,
        value: Math.round(ratio * 100),
      });
      this.lowHpAlertCooldown = LOW_HP_ALERT_COOLDOWN_SEC;
    }
    this.wasLowHp = isLow;
  }

  // ==========================================================================
  // Transitions de Zone (Overworld <-> Donjon 1 <-> Donjon 2)
  // ==========================================================================

  public loadZone(zoneId: ZoneId, spawnPos: Vec2, emitEvent = true): void {
    // Récupère proprement le butin physique restant avant de changer de zone (si vivant)
    if (this.state.player.hp > 0 && this.state.lootDrops.length > 0) {
      for (const drop of this.state.lootDrops) {
        this.collectLootDrop(drop);
      }
    }
    this.state.lootDrops = [];
    this.state.playerProjectiles = [];
    this.state.enemyProjectiles = [];
    this.state.hazardZones = [];
    this.state.cinematic = null;
    this.activeHazardSlowFactor = 0;
    this.pendingCinematicDialogue = null;
    this.state.timeScale = 1;
    this.state.perfectDodgeTimer = 0;
    this.state.lastAttackMeta = null;

    this.state.zoneId = zoneId;
    this.state.player.x = spawnPos.x;
    this.state.player.z = spawnPos.z;
    this.state.player.vx = 0;
    this.state.player.vz = 0;
    this.state.player.dodgeTimer = 0;
    this.state.player.knockbackVx = 0;
    this.state.player.knockbackVz = 0;
    this.state.player.elevationY = 0;
    this.state.player.onShipDeck = false;
    this.footstepDistanceAccum = 0;

    this.state.companion.x = spawnPos.x - this.state.player.facingX * 1.4;
    this.state.companion.z = spawnPos.z - 0.8;
    this.state.companion.y = 0;
    this.state.companion.onShipDeck = false;
    this.state.companion.mode = 'follow';
    this.state.companion.guideKind = null;
    this.state.companion.guideTargetX = undefined;
    this.state.companion.guideTargetZ = undefined;
    this.lastCompanionGuideTargetId = '';
    this.decorHitCooldowns.clear();

    this.state.telegraphs = [];
    this.state.activeSpellEffects = [];
    this.state.dodgeGhosts = [];
    this.state.pendingInteraction = null;
    this.state.openingChest = null;
    this.state.hitstopTimer = 0;
    this.state.screenShake = 0;
    this.state.enemies = [];
    this.state.chests = [];
    this.state.traps = [];
    this.state.healingCrystals = [];
    this.state.activeBossId = null;

    if (zoneId === 'overworld') {
      this.populateOverworldIslandEntities(this.state.islandId);
    } else {
      const def = getDungeonDefinition(zoneId);
      for (const sp of def.spawns) {
        // Un boss déjà vaincu ne réapparaît pas si on revisite le donjon
        if (
          sp.typeId === def.bossTypeId &&
          this.state.defeatedBossIds.includes(def.bossTypeId)
        ) {
          continue;
        }
        this.state.enemies.push(createEnemyInstance(sp));
      }
      this.state.chests = def.chests.map((c) => ({
        ...c,
        loot: { ...c.loot },
        opened: this.state.openedChestIds.includes(c.id),
        locked: c.lockedUntilBossDefeated
          ? !this.state.defeatedBossIds.includes(c.lockedUntilBossDefeated)
          : false,
      }));
      this.state.traps = def.traps.map((t) => ({
        ...t,
        timer: t.initialDelay,
      }));
      this.state.healingCrystals = def.healingCrystals.map((hc) => ({
        ...hc,
        used: false,
      }));
    }

    this.state.inVillage =
      zoneId === 'overworld' &&
      this.state.islandId === 'felingard' &&
      isInsideVillage(spawnPos.x, spawnPos.z);

    this.rebuildInteractables();
    this.updateNearestInteractable();
    this.updateActiveBoss();
    this.refreshQuestTarget();

    this.state.transitionTimer = PORTAL_EXIT_DURATION;
    this.state.transitionFade = 1;

    if (emitEvent) {
      this.state.events.push({
        type: 'zone_transition',
        zoneId,
        islandId: this.state.islandId,
        x: spawnPos.x,
        z: spawnPos.z,
      });
    }
  }

  // ==========================================================================
  // Interactions Contextuelles, Coffres, Auberge, Forge, Quêtes, Dialogues
  // ==========================================================================

  public triggerInteraction(): boolean {
    if (this.state.ship.mode === 'sailing') {
      this.refreshShipDisembarkStatus();
      this.updateNearestInteractable();
      return this.tryInitiateDocking();
    }
    if (
      this.state.ship.mode !== 'parked' ||
      this.state.openingChest ||
      this.state.portalTransition ||
      this.state.deathSequence
    ) {
      return false;
    }
    this.updateNearestInteractable();
    if (!this.state.nearestInteractable) return false;
    this.interactWith(this.state.nearestInteractable, true);
    return true;
  }

  public openChest(chestId: string): boolean {
    const chest = this.state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened || chest.locked) return false;

    chest.opened = true;
    chest.opening = false;
    chest.openingProgress = 1;
    if (!this.state.openedChestIds.includes(chest.id)) {
      this.state.openedChestIds.push(chest.id);
    }
    this.state.runStats.chestsOpened += 1;

    const p = this.state.player;
    const gold = chest.loot.gold;
    if (gold > 0) {
      p.gold += gold;
      this.state.events.push({
        type: 'gold_pickup',
        x: chest.x,
        z: chest.z,
        value: gold,
      });
    }

    if (chest.loot.grantsRunicKey) {
      p.hasRunicKey = true;
      this.state.events.push({
        type: 'toast',
        x: chest.x,
        z: chest.z,
        text: "Clé Runique obtenue ! L'Antre du Dragon-Griffe peut être ouvert !",
      });
    }

    let lootItemId: string | undefined;
    let lootItemLevel: number | undefined;
    let lootItemName: string | undefined;

    if (chest.loot.guaranteedItemId) {
      const added = addEquipment(p, chest.loot.guaranteedItemId, this.state.events);
      if (added) {
        lootItemId = added.itemId;
        lootItemLevel = added.newLevel;
        lootItemName = added.itemName;
      }
    } else if (chest.loot.rarityWeights) {
      const rolled = rollEquipmentByWeights(chest.loot.rarityWeights, this.rng);
      const added = addEquipment(p, rolled.id, this.state.events);
      if (added) {
        lootItemId = added.itemId;
        lootItemLevel = added.newLevel;
        lootItemName = added.itemName;
      }
    }

    const summaryParts: string[] = [];
    if (gold > 0) summaryParts.push(`+${gold} Or`);
    if (lootItemName) summaryParts.push(lootItemName);
    if (chest.loot.grantsRunicKey) summaryParts.push('Clé Runique');

    this.state.events.push({
      type: 'chest_opened',
      x: chest.x,
      z: chest.z,
      value: gold,
      itemId: lootItemId,
      itemLevel: lootItemLevel,
      text: summaryParts.join(' • ') || 'Coffre ouvert !',
    });

    const qRes = onChestOpenedForQuests(
      this.state.quests,
      chest.id,
      p,
      this.state.events,
    );
    if (qRes.dialogues.length > 0) {
      this.startDialogue(qRes.dialogues[0], 'none');
    }

    this.rebuildInteractables();
    this.updateNearestInteractable();
    this.refreshQuestTarget();
    this.saveCurrentGame();
    return true;
  }

  public startDialogue(
    lines: DialogueLine[],
    onCompleteAction: DialogueAction = 'none',
  ): void {
    if (lines.length === 0) return;
    this.state.dialogue = {
      active: true,
      lines: [...lines],
      currentIndex: 0,
      onCompleteAction,
    };
    this.state.events.push({
      type: 'dialogue_started',
      text: lines[0].text,
    });
  }

  public advanceDialogue(): void {
    const dlg = this.state.dialogue;
    if (!dlg.active) return;

    if (dlg.currentIndex + 1 < dlg.lines.length) {
      dlg.currentIndex += 1;
      return;
    }

    const action = dlg.onCompleteAction ?? 'none';
    this.state.dialogue = {
      active: false,
      lines: [],
      currentIndex: 0,
      onCompleteAction: 'none',
    };

    switch (action) {
      case 'complete_act1': {
        onNpcTalked(
          this.state.quests,
          'mayor_moustache',
          this.state.player,
          this.state.events,
        );
        this.refreshQuestTarget();
        this.saveCurrentGame();
        break;
      }
      case 'open_forge':
        this.openModal('forge');
        break;
      case 'open_quest_board':
        this.openModal('quests');
        break;
      case 'trigger_victory':
        this.state.screen = 'victory';
        this.state.victoryShown = true;
        this.state.events.push({
          type: 'victory',
          text: 'Légende de Félingard !',
        });
        this.saveCurrentGame();
        break;
      case 'none':
        break;
    }
  }

  public openModal(modal: ActiveModal): void {
    if (this.state.screen !== 'playing' && this.state.screen !== 'paused') {
      return;
    }
    this.state.activeModal = modal;
    if (modal === 'pause') {
      this.state.screen = 'paused';
    } else if (this.state.screen === 'paused') {
      this.state.screen = 'playing';
    }
  }

  public closeModal(): void {
    this.state.activeModal = 'none';
    if (this.state.screen === 'paused') {
      this.state.screen = 'playing';
    }
  }

  public toggleModal(modal: Exclude<ActiveModal, 'none'>): void {
    if (this.state.activeModal === modal) {
      this.closeModal();
    } else {
      this.openModal(modal);
    }
  }

  public equipItem(itemId: string): boolean {
    const ok = progressionEquipItem(this.state.player, itemId);
    if (ok) {
      this.saveCurrentGame();
    }
    return ok;
  }

  public unequipSlot(slot: EquipSlot): boolean {
    const ok = progressionUnequipSlot(this.state.player, slot);
    if (ok) {
      this.saveCurrentGame();
    }
    return ok;
  }

  public buyMysteryChest(): MysteryChestResult | null {
    const result = progressionBuyMysteryChest(
      this.state.player,
      this.state.events,
      this.rng,
    );
    if (result) {
      this.saveCurrentGame();
    }
    return result;
  }

  public upgradeSpell(spellId: SpellId): SpellUpgradeResult {
    const result = progressionUpgradeSpell(
      this.state.player,
      spellId,
      this.state.events,
    );
    if (result.success) {
      this.saveCurrentGame();
    }
    return result;
  }

  public upgradeEquipment(itemId: string): EquipmentUpgradeResult {
    const result = progressionUpgradeEquipment(
      this.state.player,
      itemId,
      this.state.events,
    );
    if (result.success) {
      this.saveCurrentGame();
    }
    return result;
  }

  public buyEquipment(itemId: string): EquipmentPurchaseResult {
    const result = progressionBuyEquipment(
      this.state.player,
      itemId,
      this.state.events,
    );
    if (result.success) {
      this.saveCurrentGame();
    }
    return result;
  }

  public acceptQuest(questId: QuestId): boolean {
    const res = questsAcceptQuest(
      this.state.quests,
      questId,
      this.state.player,
      this.state.events,
      {
        openedChestIds: this.state.openedChestIds,
        defeatedBossIds: this.state.defeatedBossIds,
      },
    );
    if (!res.accepted) return false;

    if (!res.completedImmediately) {
      this.state.trackedQuestId = questId;
    }
    this.refreshQuestTarget();

    if (res.acceptDialogue && res.acceptDialogue.length > 0) {
      this.closeModal();
      this.startDialogue(res.acceptDialogue, 'none');
    }

    this.saveCurrentGame();
    return true;
  }

  public trackQuest(questId: QuestId): boolean {
    const progress = this.state.quests[questId];
    if (!progress || progress.status !== 'active') return false;
    this.state.trackedQuestId = questId;
    this.refreshQuestTarget();
    return true;
  }

  public castSpellById(spellId: SpellId, aimWorldPos?: Vec2 | null): boolean {
    if (
      this.state.screen !== 'playing' ||
      this.state.activeModal !== 'none' ||
      this.state.dialogue.active ||
      this.state.ship.mode !== 'parked' ||
      this.state.deathSequence ||
      this.state.portalTransition ||
      this.state.openingChest
    ) {
      return false;
    }

    const res = castSpell(
      this.state.player,
      spellId,
      this.state.enemies,
      this.state.events,
      {
        activeSpellEffects: this.state.activeSpellEffects,
        dodgeGhosts: this.state.dodgeGhosts,
        resolveDashPosition: (x, z) =>
          this.resolvePositionInCurrentZone(x, z, PLAYER_RADIUS, false),
        clampTargetPoint: (x, z) => this.clampPointToCurrentZone(x, z),
        aimWorldPos: aimWorldPos ?? null,
        rng: this.rng,
        telegraphs: this.state.telegraphs,
      },
    );

    if (!res.cast) return false;

    this.triggerDecorHitsForSpell(spellId, aimWorldPos ?? null);

    if (res.hitEnemies.length > 0) {
      this.markCombatActivity();
    }

    this.state.screenShake = Math.max(this.state.screenShake, res.shakeAmount);
    if (res.triggeredHitstop) {
      this.state.hitstopTimer = Math.max(
        this.state.hitstopTimer,
        HITSTOP_MAJOR_DURATION,
      );
    }

    for (const killed of res.killedEnemies) {
      this.handleEnemyKilled(killed);
    }
    return true;
  }

  // ==========================================================================
  // Méthodes internes de simulation & collisions
  // ==========================================================================

  private initiateInteractionOrApproach(
    interactable: Interactable,
    directApi: boolean,
  ): void {
    const player = this.state.player;
    const dx = interactable.x - player.x;
    const dz = interactable.z - player.z;
    const distance = Math.hypot(dx, dz);

    // Embarquement navire ou déjà tout près : exécution immédiate (oriente le héros vers la cible)
    if (
      directApi ||
      interactable.type === 'ship_board' ||
      interactable.type === 'ship_disembark' ||
      distance <= INTERACT_CLOSE_DIST
    ) {
      if (Math.abs(dx) > 0.05) {
        player.facingX = dx >= 0 ? 1 : -1;
      }
      if (distance > 0.05) {
        player.aimAngle = Math.atan2(dz, dx);
      }
      this.interactWith(interactable, directApi);
      return;
    }

    // Calcule un point d'arrêt marchable juste devant la cible
    const dirX = dx / Math.max(distance, 1e-4);
    const dirZ = dz / Math.max(distance, 1e-4);
    const standOffset =
      interactable.type === 'dungeon_entrance' || interactable.type === 'dungeon_exit'
        ? 0.55
        : 1.15;
    const rawStandX = interactable.x - dirX * standOffset;
    const rawStandZ = interactable.z - dirZ * standOffset;
    const safeStand = this.resolvePositionInCurrentZone(
      rawStandX,
      rawStandZ,
      PLAYER_RADIUS,
      false,
    );

    this.state.pendingInteraction = {
      interactableId: interactable.id,
      targetX: interactable.x,
      targetZ: interactable.z,
      standX: safeStand.x,
      standZ: safeStand.z,
      elapsed: 0,
      maxDuration: 1.85,
    };
  }

  private stepPendingInteraction(dt: number): void {
    const pending = this.state.pendingInteraction;
    if (!pending) return;

    const interactable = this.state.interactables.find(
      (item) => item.id === pending.interactableId && !item.disabled,
    );
    if (!interactable) {
      this.state.pendingInteraction = null;
      return;
    }

    pending.elapsed += dt;
    const player = this.state.player;
    const toStandX = pending.standX - player.x;
    const toStandZ = pending.standZ - player.z;
    const distToStand = Math.hypot(toStandX, toStandZ);
    const distToTarget = dist(player.x, player.z, interactable.x, interactable.z);

    if (distToStand <= 0.35 || distToTarget <= INTERACT_CLOSE_DIST) {
      this.state.pendingInteraction = null;
      player.vx = 0;
      player.vz = 0;
      const faceDx = interactable.x - player.x;
      const faceDz = interactable.z - player.z;
      if (Math.abs(faceDx) > 0.04) {
        player.facingX = faceDx >= 0 ? 1 : -1;
      }
      if (Math.hypot(faceDx, faceDz) > 0.04) {
        player.aimAngle = Math.atan2(faceDz, faceDx);
      }
      this.interactWith(interactable, false);
      return;
    }

    if (pending.elapsed >= pending.maxDuration) {
      this.state.pendingInteraction = null;
      player.vx = 0;
      player.vz = 0;
      return;
    }

    const walkSpeed = PLAYER_MOVE_SPEED * 0.88 * (1 - getChillSlowFactor(player));
    const dirX = toStandX / Math.max(distToStand, 1e-4);
    const dirZ = toStandZ / Math.max(distToStand, 1e-4);
    const stepLen = Math.min(distToStand, walkSpeed * dt);
    const prevX = player.x;
    const prevZ = player.z;
    const resolved = this.resolvePositionInCurrentZone(
      player.x + dirX * stepLen,
      player.z + dirZ * stepLen,
      PLAYER_RADIUS,
      false,
    );
    player.x = resolved.x;
    player.z = resolved.z;
    player.vx = dirX * walkSpeed;
    player.vz = dirZ * walkSpeed;
    if (Math.abs(dirX) > 0.05) {
      player.facingX = dirX >= 0 ? 1 : -1;
    }
    player.aimAngle = Math.atan2(dirZ, dirX);

    // Sécurité anti-blocage : si le héros ne progresse plus contre un obstacle
    const moved = Math.hypot(player.x - prevX, player.z - prevZ);
    if (moved < stepLen * 0.12 && pending.elapsed > 0.22) {
      this.state.pendingInteraction = null;
      player.vx = 0;
      player.vz = 0;
      if (distToTarget <= interactable.radius + 0.35) {
        this.interactWith(interactable, false);
      }
    }
  }

  private startOpeningChest(chestId: string): boolean {
    if (this.state.openingChest) return false;
    const chest = this.state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened || chest.locked || chest.opening) return false;

    chest.opening = true;
    chest.openingProgress = 0;
    const p = this.state.player;
    p.vx = 0;
    p.vz = 0;
    if (Math.abs(chest.x - p.x) > 0.04) {
      p.facingX = chest.x >= p.x ? 1 : -1;
    }

    this.state.openingChest = {
      chestId: chest.id,
      elapsed: 0,
      duration: CHEST_OPEN_DURATION,
      x: chest.x,
      z: chest.z,
    };
    this.state.events.push({
      type: 'chest_opening_start',
      x: chest.x,
      z: chest.z,
    });
    return true;
  }

  private updateOpeningChest(dt: number, input: InputState): void {
    const oc = this.state.openingChest;
    if (!oc) return;

    const chest = this.state.chests.find((c) => c.id === oc.chestId);
    if (!chest || chest.opened) {
      this.state.openingChest = null;
      return;
    }

    // Permet d'esquiver en urgence (annule l'ouverture sans jamais accorder le butin)
    if (input.dodgePressed) {
      chest.opening = false;
      chest.openingProgress = 0;
      this.state.openingChest = null;
      const dodged = executeDodgeRoll(
        this.state.player,
        input.moveX,
        input.moveZ,
        this.state.events,
        this.state.dodgeGhosts,
      );
      if (dodged) {
        this.dodgeGhostAccum = 0;
        this.checkPerfectDodge();
      }
      return;
    }

    this.state.player.vx = 0;
    this.state.player.vz = 0;
    oc.elapsed += dt;
    chest.openingProgress = clamp(oc.elapsed / Math.max(oc.duration, 1e-4), 0, 1);

    if (oc.elapsed >= oc.duration) {
      this.state.openingChest = null;
      chest.opening = false;
      chest.openingProgress = 1;
      // Récompense accordée STRICTEMENT à la fin de l'animation
      this.openChest(chest.id);
    }
  }

  private startPortalTransition(
    portalX: number,
    portalZ: number,
    targetZoneId: ZoneId,
    targetSpawn: Vec2,
  ): void {
    if (this.state.portalTransition) return;
    const p = this.state.player;
    p.vx = 0;
    p.vz = 0;
    p.dodgeTimer = 0;
    p.attackAnimTimer = 0;
    p.invulnTimer = Math.max(p.invulnTimer, 0.5);
    this.state.pendingInteraction = null;
    this.state.telegraphs = [];
    this.state.transitionTimer = 0;
    this.state.transitionFade = 0;

    const exitTarget = {
      x: targetSpawn.x,
      z: targetSpawn.z + (targetZoneId === 'overworld' ? 1.85 : -1.65),
    };

    this.state.portalTransition = {
      phase: 'entering',
      elapsed: 0,
      duration: PORTAL_ENTER_DURATION,
      maxDuration: PORTAL_MAX_DURATION,
      vortexEmitted: false,
      portalX,
      portalZ,
      exitTargetX: exitTarget.x,
      exitTargetZ: exitTarget.z,
      targetZoneId,
      targetSpawn: { ...targetSpawn },
    };
    this.state.events.push({
      type: 'portal_enter',
      x: portalX,
      z: portalZ,
      zoneId: targetZoneId,
    });
  }

  private updatePortalTransition(dt: number): void {
    const pt = this.state.portalTransition;
    if (!pt) return;
    const player = this.state.player;
    player.invulnTimer = Math.max(player.invulnTimer, 0.25);

    pt.elapsed += dt;

    if (pt.phase === 'entering') {
      // 0.0 - 0.9 s : marche automatique douce vers le centre du portail
      if (pt.elapsed < 0.9) {
        const dx = pt.portalX - player.x;
        const dz = pt.portalZ - player.z;
        const d = Math.hypot(dx, dz);
        const speed = PLAYER_MOVE_SPEED * 0.72;
        if (d > 0.15) {
          const stepLen = Math.min(d, speed * dt);
          player.x += (dx / d) * stepLen;
          player.z += (dz / d) * stepLen;
          player.vx = (dx / d) * speed;
          player.vz = (dz / d) * speed;
          if (Math.abs(dx) > 0.04) player.facingX = dx >= 0 ? 1 : -1;
        } else {
          player.vx = 0;
          player.vz = 0;
        }
      } else {
        player.vx = 0;
        player.vz = 0;
      }

      // 0.3 - 1.4 s : déclenchement du vortex lumineux & audio
      if (pt.elapsed >= 0.3 && !pt.vortexEmitted) {
        pt.vortexEmitted = true;
        this.state.events.push({
          type: 'portal_vortex',
          x: pt.portalX,
          z: pt.portalZ,
          zoneId: pt.targetZoneId,
        });
      }

      // 1.1 - 1.4 s : fondu au noir progressif avant le chargement de zone
      if (pt.elapsed >= 1.1) {
        const fadeT = clamp((pt.elapsed - 1.1) / Math.max(0.01, pt.duration - 1.1), 0, 1);
        this.state.transitionFade = Math.max(this.state.transitionFade, fadeT);
      } else {
        this.state.transitionFade = 0;
      }

      const maxEnter = pt.maxDuration ?? PORTAL_MAX_DURATION;
      if (pt.elapsed >= pt.duration || pt.elapsed >= maxEnter) {
        const destZone = pt.targetZoneId;
        const destSpawn = { ...pt.targetSpawn };
        this.loadZone(destZone, destSpawn, true);
        const safeExit = this.resolvePositionInCurrentZone(
          pt.exitTargetX,
          pt.exitTargetZ,
          PLAYER_RADIUS,
          false,
        );
        this.state.portalTransition = {
          phase: 'exiting',
          elapsed: 0,
          duration: PORTAL_EXIT_DURATION,
          maxDuration: 1.0,
          vortexEmitted: true,
          portalX: destSpawn.x,
          portalZ: destSpawn.z,
          exitTargetX: safeExit.x,
          exitTargetZ: safeExit.z,
          targetZoneId: destZone,
          targetSpawn: destSpawn,
        };
        this.state.events.push({
          type: 'portal_exit',
          x: destSpawn.x,
          z: destSpawn.z,
          zoneId: destZone,
        });
      }
      return;
    }

    // Phase 'exiting' (1.4 - 1.8 s) : le héros ressort du portail pendant le fondu entrant
    const dx = pt.exitTargetX - player.x;
    const dz = pt.exitTargetZ - player.z;
    const d = Math.hypot(dx, dz);
    const speed = PLAYER_MOVE_SPEED * 0.65;
    if (d > 0.15) {
      const stepLen = Math.min(d, speed * dt);
      const resolved = this.resolvePositionInCurrentZone(
        player.x + (dx / d) * stepLen,
        player.z + (dz / d) * stepLen,
        PLAYER_RADIUS,
        false,
      );
      player.x = resolved.x;
      player.z = resolved.z;
      player.vx = (dx / d) * speed;
      player.vz = (dz / d) * speed;
      if (Math.abs(dx) > 0.04) player.facingX = dx >= 0 ? 1 : -1;
    } else {
      player.vx = 0;
      player.vz = 0;
    }

    // Compagnon suit doucement la sortie
    this.state.companion.x += (player.x - player.facingX * 1.4 - this.state.companion.x) * Math.min(1, dt * 6);
    this.state.companion.z += (player.z - 0.8 - this.state.companion.z) * Math.min(1, dt * 6);

    const maxExit = pt.maxDuration ?? 1.0;
    if (pt.elapsed >= pt.duration || pt.elapsed >= maxExit) {
      this.forceCompletePortalTransition();
    }
  }

  public forceCompletePortalTransition(): void {
    const pt = this.state.portalTransition;
    if (!pt) return;
    const p = this.state.player;
    if (pt.phase === 'entering') {
      const destZone = pt.targetZoneId;
      const destSpawn = { ...pt.targetSpawn };
      this.loadZone(destZone, destSpawn, true);
      const safeExit = this.resolvePositionInCurrentZone(
        pt.exitTargetX,
        pt.exitTargetZ,
        PLAYER_RADIUS,
        false,
      );
      p.x = safeExit.x;
      p.z = safeExit.z;
      this.state.events.push({
        type: 'portal_exit',
        x: destSpawn.x,
        z: destSpawn.z,
        zoneId: destZone,
      });
    }
    p.vx = 0;
    p.vz = 0;
    p.invulnTimer = Math.max(p.invulnTimer, 0.6);
    this.state.portalTransition = null;
    this.state.transitionTimer = 0;
    this.state.transitionFade = 0;
    this.updateNearestInteractable();
  }

  private startHeroDeathSequence(): void {
    if (this.state.deathSequence) return;
    const p = this.state.player;
    p.hp = 0;
    p.vx = 0;
    p.vz = 0;
    p.dodgeTimer = 0;
    p.attackAnimTimer = 0;
    this.state.pendingInteraction = null;
    this.state.openingChest = null;
    this.state.portalTransition = null;
    this.state.activeModal = 'none';
    this.state.telegraphs = [];
    this.state.screenShake = Math.max(this.state.screenShake, 0.55);
    this.state.deathSequence = {
      elapsed: 0,
      duration: HERO_DEATH_DURATION,
      x: p.x,
      z: p.z,
      completed: false,
    };
    this.state.events.push({
      type: 'hero_death_start',
      x: p.x,
      z: p.z,
    });
  }

  private updateDeathSequence(dt: number): void {
    const ds = this.state.deathSequence;
    if (!ds) return;
    ds.elapsed += dt;
    this.state.player.vx = 0;
    this.state.player.vz = 0;
    const ratio = clamp(ds.elapsed / Math.max(ds.duration, 1e-4), 0, 1);
    if (ratio > 0.65) {
      this.state.transitionFade = clamp(((ratio - 0.65) / 0.35) * 0.72, 0, 0.72);
    }
    if (ds.elapsed >= ds.duration && !ds.completed) {
      ds.completed = true;
      this.state.screen = 'defeat';
      this.state.activeModal = 'none';
      this.state.telegraphs = [];
      this.state.transitionFade = 0;
    }
  }

  private markCombatActivity(): void {
    this.state.inCombat = true;
    this.state.combatMusicTimer = COMBAT_MUSIC_HOLD_SEC;
  }

  private updateCombatMusicState(dt: number): void {
    let aggroEnemyNearby = false;
    const px = this.state.player.x;
    const pz = this.state.player.z;
    for (const enemy of this.state.enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      if (enemy.aggroed && dist(px, pz, enemy.x, enemy.z) <= 15) {
        aggroEnemyNearby = true;
        break;
      }
    }
    if (aggroEnemyNearby && !this.state.inVillage) {
      this.state.inCombat = true;
      this.state.combatMusicTimer = Math.max(
        this.state.combatMusicTimer ?? 0,
        2.5,
      );
    } else if ((this.state.combatMusicTimer ?? 0) > 0) {
      this.state.combatMusicTimer = Math.max(
        0,
        (this.state.combatMusicTimer ?? 0) - dt,
      );
      if (this.state.combatMusicTimer <= 0 || this.state.inVillage) {
        this.state.inCombat = false;
        this.state.combatMusicTimer = 0;
      }
    } else {
      this.state.inCombat = false;
    }
  }

  private interactWith(interactable: Interactable, directApi = false): void {
    switch (interactable.type) {
      case 'inn': {
        const p = this.state.player;
        p.hp = p.maxHp;
        p.mp = p.maxMp;
        p.regenTimer = 0;
        p.regenTickAccum = 0;
        this.state.transitionTimer = 0.55;
        this.state.transitionFade = 0.85;
        this.saveCurrentGame();
        this.state.events.push({
          type: 'player_rested',
          x: p.x,
          z: p.z,
          text: INN_REST_MESSAGE,
        });
        this.state.events.push({
          type: 'toast',
          text: INN_REST_MESSAGE,
        });
        break;
      }

      case 'quest_board':
        this.openModal('quests');
        break;

      case 'forge':
        this.openModal('forge');
        break;

      case 'npc': {
        if (interactable.npcId === 'mayor_moustache') {
          const mainQ = this.state.quests.main_dragon_blood;
          if (mainQ.status === 'active' && mainQ.stepIndex === 0) {
            this.startDialogue(MAYOR_DIALOGUES.act1, 'complete_act1');
          } else if (mainQ.status === 'active' && mainQ.stepIndex === 1) {
            this.startDialogue(MAYOR_DIALOGUES.act2, 'none');
          } else if (mainQ.status === 'active' && mainQ.stepIndex === 2) {
            this.startDialogue(MAYOR_DIALOGUES.act3, 'none');
          } else {
            this.startDialogue(MAYOR_DIALOGUES.postVictory, 'none');
          }
        }
        break;
      }

      case 'chest':
        if (interactable.chestId) {
          if (directApi) {
            this.openChest(interactable.chestId);
          } else {
            this.startOpeningChest(interactable.chestId);
          }
        }
        break;

      case 'dungeon_entrance': {
        if (interactable.requiresRunicKey && !this.state.player.hasRunicKey) {
          this.startDialogue(SEALED_DRAGON_LAIR_DIALOGUE, 'none');
          return;
        }
        if (interactable.targetZoneId && interactable.targetSpawn) {
          if (directApi) {
            this.loadZone(interactable.targetZoneId, { ...interactable.targetSpawn }, true);
          } else {
            this.startPortalTransition(
              interactable.x,
              interactable.z,
              interactable.targetZoneId,
              interactable.targetSpawn,
            );
          }
        }
        break;
      }

      case 'dungeon_exit': {
        if (interactable.targetZoneId && interactable.targetSpawn) {
          if (directApi) {
            this.loadZone(interactable.targetZoneId, { ...interactable.targetSpawn }, true);
          } else {
            this.startPortalTransition(
              interactable.x,
              interactable.z,
              interactable.targetZoneId,
              interactable.targetSpawn,
            );
          }
        }
        break;
      }

      case 'healing_crystal': {
        const crystal = this.state.healingCrystals.find(
          (c) => c.id === interactable.crystalId,
        );
        if (!crystal || crystal.used) return;
        crystal.used = true;
        const p = this.state.player;
        const healed = p.maxHp - p.hp;
        p.hp = p.maxHp;
        p.mp = p.maxMp;
        this.state.events.push({
          type: 'heal_tick',
          x: p.x,
          z: p.z,
          value: Math.max(healed, p.maxHp),
          text: '100 % PV & PM !',
        });
        this.state.events.push({
          type: 'toast',
          text: 'Cristal de Soin : PV & PM restaurés à 100 % !',
        });
        this.rebuildInteractables();
        this.updateNearestInteractable();
        break;
      }

      case 'ship_board': {
        this.startBoarding();
        break;
      }

      case 'ship_disembark': {
        this.tryInitiateDocking();
        break;
      }
    }
  }

  private handleEnemyKilled(enemy: EnemyInstance): void {
    if (enemy.state === 'dead') return;

    enemy.state = 'dead';
    enemy.hp = 0;
    enemy.vx = 0;
    enemy.vz = 0;
    enemy.activeSweepDuration = undefined;
    enemy.activeSweepElapsed = undefined;
    enemy.respawnTimer =
      this.state.zoneId === 'overworld' && !enemy.isBoss
        ? OVERWORLD_RESPAWN_TIME
        : 0;

    if (!enemy.isBoss) {
      enemy.deathTimer = 0.35;
      enemy.deathDuration = 0.35;
      this.state.hitstopTimer = Math.max(this.state.hitstopTimer, 0.04);
    } else {
      const bossDeathDur = enemy.typeId === 'boss_dragon_claw' ? 3.4 : 2.6;
      enemy.deathTimer = bossDeathDur;
      enemy.deathDuration = bossDeathDur;
    }

    this.state.runStats.enemiesDefeated += 1;

    const def = getEnemyDefinition(enemy.typeId);
    const p = this.state.player;

    this.state.events.push({
      type: 'enemy_died',
      x: enemy.x,
      z: enemy.z,
      radius: enemy.radius,
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      enemyMaterial: def.materialSound,
      color: def.primaryColor,
      accentColor: def.accentColor,
      knockbackVx: enemy.knockbackVx ?? 0,
      knockbackVz: enemy.knockbackVz ?? 0,
      value: def.xpReward,
      text: `+${def.xpReward} XP  +${def.goldReward} Or`,
    });

    // Butin physique parabolique & magnétique (Or + XP)
    this.spawnLootDropsForEnemy(enemy, def.goldReward, def.xpReward);

    let shouldSave = false;

    if (enemy.isBoss) {
      this.triggerCompanionReaction('boss_victory');
      if (!this.state.defeatedBossIds.includes(enemy.typeId)) {
        this.state.defeatedBossIds.push(enemy.typeId);
      }
      // Déverrouille les coffres liés à ce boss
      for (const chest of this.state.chests) {
        if (chest.locked && chest.lockedUntilBossDefeated === enemy.typeId) {
          chest.locked = false;
        }
      }
      this.rebuildInteractables();
      shouldSave = true;
    }

    const qRes = onEnemyDefeated(
      this.state.quests,
      enemy.typeId,
      p,
      this.state.events,
    );

    if (qRes.updatedQuestIds.length > 0 || qRes.completedQuestIds.length > 0) {
      shouldSave = true;
    }

    this.updateActiveBoss();
    this.refreshQuestTarget();

    if (enemy.typeId === 'boss_dragon_claw' && !this.state.victoryShown) {
      this.pendingCinematicDialogue = {
        lines: VICTORY_DIALOGUE,
        action: 'trigger_victory',
      };
      this.startBossCinematic(enemy, 'boss_death');
    } else if (enemy.typeId === 'boss_rat_king') {
      if (qRes.dialogues.length > 0) {
        this.pendingCinematicDialogue = {
          lines: qRes.dialogues[0],
          action: 'none',
        };
      }
      this.startBossCinematic(enemy, 'boss_death');
    } else if (qRes.dialogues.length > 0) {
      this.startDialogue(qRes.dialogues[0], 'none');
    }

    if (shouldSave) {
      this.saveCurrentGame();
    }
  }

  private rebuildInteractables(): void {
    const list: Interactable[] = [];
    const zoneId = this.state.zoneId;

    if (zoneId === 'overworld') {
      list.push({
        id: 'ship_board',
        type: 'ship_board',
        label: 'Monter à bord',
        x: this.state.ship.position.x,
        z: this.state.ship.position.z,
        radius: SHIP_BOARDING_RADIUS,
        zoneId: 'overworld',
      });

      if (this.state.islandId === 'felingard') {
        for (const b of OVERWORLD_DATA.buildings) {
          if (!b.interactableType || !b.interactLabel) continue;
          list.push({
            id: `interact_${b.id}`,
            type: b.interactableType,
            label: b.interactLabel,
            x: b.interactX,
            z: b.interactZ,
            radius: 3.1,
            zoneId: 'overworld',
          });
        }

        for (const npc of OVERWORLD_DATA.npcs) {
          list.push({
            id: `interact_${npc.id}`,
            type: 'npc',
            label: npc.interactLabel,
            x: npc.x,
            z: npc.z,
            radius: 2.8,
            zoneId: 'overworld',
            npcId: npc.id,
          });
        }

        for (const portal of OVERWORLD_DATA.dungeonPortals) {
          const sealed =
            Boolean(portal.requiresRunicKey) && !this.state.player.hasRunicKey;
          list.push({
            id: portal.id,
            type: 'dungeon_entrance',
            label: sealed
              ? 'Barrière Runique — Antre du Dragon-Griffe (Clé Runique requise)'
              : portal.label,
            x: portal.x,
            z: portal.z,
            radius: portal.radius,
            zoneId: 'overworld',
            targetZoneId: portal.targetZoneId,
            targetSpawn: portal.targetSpawn,
            recommendedLevel: portal.recommendedLevel,
            requiresRunicKey: portal.requiresRunicKey,
          });
        }
      }
    } else {
      const def = getDungeonDefinition(zoneId);
      list.push({
        id: def.exitPortal.id,
        type: 'dungeon_exit',
        label: def.exitPortal.label,
        x: def.exitPortal.x,
        z: def.exitPortal.z,
        radius: def.exitPortal.radius,
        zoneId,
        targetZoneId: def.exitPortal.targetZoneId,
        targetSpawn: def.exitPortal.targetSpawn,
      });

      for (const crystal of this.state.healingCrystals) {
        if (crystal.used) continue;
        list.push({
          id: `interact_${crystal.id}`,
          type: 'healing_crystal',
          label: crystal.label,
          x: crystal.x,
          z: crystal.z,
          radius: 2.6,
          zoneId,
          crystalId: crystal.id,
        });
      }
    }

    // Coffres non ouverts et déverrouillés
    for (const chest of this.state.chests) {
      if (chest.opened || chest.locked) continue;
      list.push(this.chestToInteractable(chest));
    }

    this.state.interactables = list;
  }

  private chestToInteractable(chest: ChestInstance): Interactable {
    return {
      id: `interact_${chest.id}`,
      type: 'chest',
      label: chest.label,
      x: chest.x,
      z: chest.z,
      radius: 2.6,
      zoneId: chest.zoneId,
      chestId: chest.id,
    };
  }

  private updateNearestInteractable(): void {
    const ship = this.state.ship;

    if (ship.mode === 'sailing') {
      const status = ship.disembarkStatus;
      if (status.canDisembark && status.landingPos) {
        this.state.nearestInteractable = {
          id: 'ship_disembark',
          type: 'ship_disembark',
          label: 'Débarquer',
          x: status.landingPos.x,
          z: status.landingPos.z,
          radius: SHIP_BOARDING_RADIUS,
          zoneId: 'overworld',
          destinationIslandId: status.nearestIslandId ?? undefined,
        };
      } else {
        this.state.nearestInteractable = null;
      }
      return;
    }

    if (ship.mode !== 'parked') {
      this.state.nearestInteractable = null;
      return;
    }

    const px = this.state.player.x;
    const pz = this.state.player.z;

    let best: Interactable | null = null;
    let bestDist = Infinity;

    for (const item of this.state.interactables) {
      if (item.disabled) continue;
      if (item.type === 'ship_board') {
        item.x = ship.position.x;
        item.z = ship.position.z;
      }
      const d = dist(px, pz, item.x, item.z);
      const effectiveRadius =
        item.type === 'ship_board'
          ? item.radius
          : item.radius + INTERACT_APPROACH_EXTRA;
      if (d <= effectiveRadius && d < bestDist) {
        best = item;
        bestDist = d;
      }
    }

    this.state.nearestInteractable = best;
  }

  private updateActiveBoss(): void {
    const px = this.state.player.x;
    const pz = this.state.player.z;

    let foundId: string | null = null;
    for (const enemy of this.state.enemies) {
      if (!enemy.isBoss || enemy.state === 'dead' || enemy.hp <= 0) continue;
      if (enemy.aggroed || dist(px, pz, enemy.x, enemy.z) <= 22) {
        foundId = enemy.id;
        break;
      }
    }
    this.state.activeBossId = foundId;
  }

  private refreshQuestTarget(): void {
    this.state.trackedQuestId = pickTrackedQuestId(
      this.state.quests,
      this.state.trackedQuestId,
    );
    this.state.questTarget = computeQuestTarget(
      this.state.quests,
      this.state.trackedQuestId,
      this.state.zoneId,
      {
        hasRunicKey: this.state.player.hasRunicKey,
        defeatedBossIds: this.state.defeatedBossIds,
      },
    );
  }

  private updateTransientVisuals(dt: number): void {
    // Active spell effects (avec salves multi-vagues verrouillées pour Chute d'Étoiles)
    for (let i = this.state.activeSpellEffects.length - 1; i >= 0; i--) {
      const fx = this.state.activeSpellEffects[i];
      fx.elapsed += dt;

      if (
        fx.spellId === 'meteor_paw' &&
        fx.waveCount &&
        fx.waveInterval &&
        (fx.wavesTriggered ?? 1) < fx.waveCount
      ) {
        const nextWaveThreshold = (fx.wavesTriggered ?? 1) * fx.waveInterval;
        if (fx.elapsed >= nextWaveThreshold) {
          fx.wavesTriggered = (fx.wavesTriggered ?? 1) + 1;
          const waveRes = applyStarfallWaveDamage(
            fx,
            this.state.enemies,
            this.state.events,
            0.46,
            this.rng,
            this.state.telegraphs,
          );
          if (waveRes.hitEnemies.length > 0) {
            this.markCombatActivity();
          }
          this.state.screenShake = Math.max(this.state.screenShake, 0.34);
          if (waveRes.triggeredHitstop) {
            this.state.hitstopTimer = Math.max(
              this.state.hitstopTimer,
              HITSTOP_MAJOR_DURATION * 0.75,
            );
          }
          for (const killed of waveRes.killedEnemies) {
            this.handleEnemyKilled(killed);
          }
        }
      }

      if (fx.elapsed >= fx.duration) {
        this.state.activeSpellEffects.splice(i, 1);
      }
    }

    // Dodge roll translucent ghosts
    for (let i = this.state.dodgeGhosts.length - 1; i >= 0; i--) {
      const ghost = this.state.dodgeGhosts[i];
      ghost.age += dt;
      if (ghost.age >= ghost.duration) {
        this.state.dodgeGhosts.splice(i, 1);
      }
    }
  }

  private resolvePositionInCurrentZone(
    x: number,
    z: number,
    radius: number,
    isEnemy: boolean,
  ): Vec2 {
    if (this.state.zoneId === 'overworld') {
      if (this.state.islandId !== 'felingard') {
        const def = NEW_ISLANDS[this.state.islandId];
        const dx = x - def.centerX;
        const dz = z - def.centerZ;
        const dist = Math.hypot(dx, dz);
        if (dist < 1e-6) return { x: def.centerX, z: def.centerZ };
        let pos = {
          x: def.centerX + dx,
          z: def.centerZ + dz,
        };
        for (const prop of def.props) {
          if (!prop.collidable || !prop.colliderRadius) continue;
          const push = resolveCircleCircle(
            pos.x,
            pos.z,
            radius,
            prop.x,
            prop.z,
            prop.colliderRadius,
          );
          pos.x += push.x;
          pos.z += push.z;
        }
        const distanceAfterCollisions = Math.hypot(pos.x - def.centerX, pos.z - def.centerZ);
        const maxR = Math.max(
          0,
          getNewIslandRadiusAtAngle(this.state.islandId, Math.atan2(pos.z - def.centerZ, pos.x - def.centerX)) -
            1.8 -
            radius,
        );
        if (distanceAfterCollisions <= maxR) return pos;
        const scale = maxR / Math.max(distanceAfterCollisions, 1e-6);
        return {
          x: def.centerX + (pos.x - def.centerX) * scale,
          z: def.centerZ + (pos.z - def.centerZ) * scale,
        };
      }

      let pos = clampToIsland(x, z, 1.8 + radius);

      // Collisions bâtiments
      for (const b of OVERWORLD_DATA.buildings) {
        const push = resolveCircleCircle(
          pos.x,
          pos.z,
          radius,
          b.x,
          b.z,
          b.colliderRadius,
        );
        pos.x += push.x;
        pos.z += push.z;
      }

      // Collisions props solides (arbres, rochers, panneaux)
      for (const prop of OVERWORLD_DATA.props) {
        if (!prop.collidable || !prop.colliderRadius) continue;
        const push = resolveCircleCircle(
          pos.x,
          pos.z,
          radius,
          prop.x,
          prop.z,
          prop.colliderRadius,
        );
        pos.x += push.x;
        pos.z += push.z;
      }

      // Les ennemis ne peuvent jamais entrer dans Miaou-bourg
      if (isEnemy) {
        pos = resolveCircleAABB(pos.x, pos.z, radius, {
          minX: VILLAGE_SAFE_ZONE.minX - 0.5,
          maxX: VILLAGE_SAFE_ZONE.maxX + 0.5,
          minZ: VILLAGE_SAFE_ZONE.minZ - 0.5,
          maxZ: VILLAGE_SAFE_ZONE.maxZ + 0.5,
        });
      }

      return clampToIsland(pos.x, pos.z, 1.8 + radius);
    }

    // Donjon instancié : murs AABB
    const def = getDungeonDefinition(this.state.zoneId);
    const halfW = def.width * 0.5 - radius;
    const halfD = def.depth * 0.5 - radius;
    let px = clamp(x, -halfW, halfW);
    let pz = clamp(z, -halfD, halfD);

    // 2 passes pour résoudre proprement les coins de couloirs et piliers
    for (let pass = 0; pass < 2; pass++) {
      for (const wall of def.walls) {
        const corrected = resolveCircleAABB(px, pz, radius, wall);
        px = corrected.x;
        pz = corrected.z;
      }
      for (const pillar of def.pillars) {
        const push = resolveCircleCircle(
          px,
          pz,
          radius,
          pillar.x,
          pillar.z,
          DUNGEON_PILLAR_RADIUS,
        );
        px += push.x;
        pz += push.z;
      }
    }

    return {
      x: clamp(px, -halfW, halfW),
      z: clamp(pz, -halfD, halfD),
    };
  }

  private clampPointToCurrentZone(x: number, z: number): Vec2 {
    if (this.state.zoneId === 'overworld') {
      if (this.state.islandId !== 'felingard') {
        return clampToNewIsland(this.state.islandId, x, z, 2.5);
      }
      return clampToIsland(x, z, 2.5);
    }
    const def = getDungeonDefinition(this.state.zoneId);
    return {
      x: clamp(x, -def.width * 0.5 + 2.5, def.width * 0.5 - 2.5),
      z: clamp(z, -def.depth * 0.5 + 2.5, def.depth * 0.5 - 2.5),
    };
  }

  // ==========================================================================
  // MACHINE À ÉTATS MARITIME : parked | boarding | sailing | docking | disembarking
  // ==========================================================================

  private populateOverworldIslandEntities(islandId: IslandId): void {
    const islandCamps =
      islandId === 'felingard'
        ? OVERWORLD_DATA.camps
        : NEW_ISLANDS[islandId].camps;
    const islandChests =
      islandId === 'felingard'
        ? OVERWORLD_DATA.chests
        : NEW_ISLANDS[islandId].chests;

    this.state.enemies = [];
    for (const camp of islandCamps) {
      for (const sp of camp.spawns) {
        this.state.enemies.push(createEnemyInstance(sp));
      }
    }
    this.state.chests = islandChests.map((c) => ({
      ...c,
      loot: { ...c.loot },
      opened: this.state.openedChestIds.includes(c.id),
      locked: false,
    }));
  }

  /**
   * Bascule en douceur les entités de l'île active lors d'un débarquement
   * sans déclencher de fondu noir `zone_transition` ni déplacer le bateau.
   */
  private switchActiveIsland(targetIslandId: IslandId): void {
    if (this.state.zoneId !== 'overworld') return;

    if (this.state.islandId !== targetIslandId) {
      if (this.state.player.hp > 0 && this.state.lootDrops.length > 0) {
        for (const drop of this.state.lootDrops) {
          this.collectLootDrop(drop);
        }
      }
      this.state.lootDrops = [];
      this.state.playerProjectiles = [];
      this.state.islandId = targetIslandId;
      this.state.telegraphs = [];
      this.state.activeBossId = null;
      this.populateOverworldIslandEntities(targetIslandId);
    }

    this.rebuildInteractables();
    this.refreshQuestTarget();
  }

  private syncCrewToShipDeck(): void {
    const ship = this.state.ship;
    const player = this.state.player;
    const companion = this.state.companion;

    const heroAnchor = getShipDeckWorldAnchor(ship, SHIP_HERO_DECK_LOCAL);
    player.x = heroAnchor.x;
    player.z = heroAnchor.z;
    player.elevationY = heroAnchor.y;
    player.onShipDeck = true;
    player.vx = 0;
    player.vz = 0;

    const fwd = getShipForward(ship.angle);
    if (Math.abs(fwd.x) > 0.15) {
      player.facingX = fwd.x >= 0 ? 1 : -1;
    }

    const compAnchor = getShipDeckWorldAnchor(ship, SHIP_COMPANION_DECK_LOCAL);
    companion.x = compAnchor.x;
    companion.z = compAnchor.z;
    companion.y = compAnchor.y;
    companion.onShipDeck = true;
  }

  private refreshShipDisembarkStatus(): void {
    const ship = this.state.ship;
    ship.disembarkStatus = findSafeDisembarkSpot(
      ship.position.x,
      ship.position.z,
      ship.angle,
      {
        zoneId: this.state.zoneId,
        currentIslandId: this.state.islandId,
        enemies: this.state.enemies,
      },
    );
  }

  private stepMaritimeState(dt: number, input: InputState): void {
    switch (this.state.ship.mode) {
      case 'boarding':
        this.updateBoarding(dt);
        break;
      case 'sailing':
        this.updateSailing(dt, input);
        break;
      case 'docking':
        this.updateDocking(dt);
        break;
      case 'disembarking':
        this.updateDisembarking(dt);
        break;
      case 'parked':
        break;
    }
  }

  private startBoarding(): void {
    const ship = this.state.ship;
    const player = this.state.player;
    const companion = this.state.companion;

    if (
      this.state.zoneId !== 'overworld' ||
      ship.mode !== 'parked' ||
      player.hp <= 0
    ) {
      return;
    }

    player.vx = 0;
    player.vz = 0;
    player.dodgeTimer = 0;
    player.attackAnimTimer = 0;
    player.knockbackVx = 0;
    player.knockbackVz = 0;
    player.onShipDeck = false;
    player.elevationY = 0;
    this.footstepDistanceAccum = 0;

    companion.onShipDeck = false;
    companion.y = companion.y ?? 0;

    // Désengage les ennemis terrestres & annule les télégraphes en cours
    for (const enemy of this.state.enemies) {
      enemy.aggroed = false;
      if (enemy.state === 'chase' || enemy.state === 'windup') {
        enemy.state = 'idle';
        enemy.stateTimer = 0;
        enemy.vx = 0;
        enemy.vz = 0;
      }
    }
    this.state.telegraphs = [];
    this.state.activeBossId = null;

    const heroDeck = getShipDeckWorldAnchor(ship, SHIP_HERO_DECK_LOCAL);
    const compDeck = getShipDeckWorldAnchor(ship, SHIP_COMPANION_DECK_LOCAL);

    const dxJump = heroDeck.x - player.x;
    if (Math.abs(dxJump) > 0.05) {
      player.facingX = dxJump >= 0 ? 1 : -1;
    }

    ship.mode = 'boarding';
    ship.isSailing = false;
    ship.transition = {
      kind: 'boarding',
      elapsed: 0,
      duration: BOARDING_DURATION,
      targetIslandId: this.state.islandId,
      shipStartPos: { x: ship.position.x, z: ship.position.z },
      shipTargetPos: { x: ship.position.x, z: ship.position.z },
      shipStartAngle: ship.angle,
      shipTargetAngle: ship.angle,
      heroStartPos: { x: player.x, z: player.z },
      heroStartY: 0,
      heroTargetPos: { x: heroDeck.x, z: heroDeck.z },
      heroTargetY: heroDeck.y,
      companionStartPos: { x: companion.x, z: companion.z },
      companionStartY: companion.y ?? 0,
      companionTargetPos: { x: compDeck.x, z: compDeck.z },
      companionTargetY: compDeck.y,
      arcHeight: BOARDING_ARC_HEIGHT,
    };

    this.state.nearestInteractable = null;
    this.state.events.push({
      type: 'ship_boarding',
      x: ship.position.x,
      z: ship.position.z,
    });
  }

  private updateBoarding(dt: number): void {
    const ship = this.state.ship;
    const player = this.state.player;
    const companion = this.state.companion;

    updateShipIdleBobbing(ship, dt);
    companion.bobPhase += dt * 4;
    this.state.inVillage = false;
    this.state.nearestInteractable = null;

    const tr = ship.transition;
    if (!tr || tr.kind !== 'boarding') {
      ship.mode = 'sailing';
      ship.isSailing = true;
      ship.dockedIslandId = null;
      ship.transition = null;
      this.syncCrewToShipDeck();
      this.refreshShipDisembarkStatus();
      this.updateNearestInteractable();
      return;
    }

    // Suit le léger bobbing vertical du pont en temps réel
    const liveHeroDeck = getShipDeckWorldAnchor(ship, SHIP_HERO_DECK_LOCAL);
    const liveCompDeck = getShipDeckWorldAnchor(ship, SHIP_COMPANION_DECK_LOCAL);
    tr.heroTargetPos.x = liveHeroDeck.x;
    tr.heroTargetPos.z = liveHeroDeck.z;
    tr.heroTargetY = liveHeroDeck.y;
    tr.companionTargetPos.x = liveCompDeck.x;
    tr.companionTargetPos.z = liveCompDeck.z;
    tr.companionTargetY = liveCompDeck.y;

    tr.elapsed += dt;
    const t = clamp(tr.elapsed / Math.max(tr.duration, 1e-4), 0, 1);

    const heroPos = evaluateParabolicJump(
      tr.heroStartPos,
      tr.heroTargetPos,
      tr.heroStartY,
      tr.heroTargetY,
      tr.arcHeight,
      t,
    );
    player.x = heroPos.x;
    player.z = heroPos.z;
    player.elevationY = heroPos.y;
    player.onShipDeck = false;
    player.vx = 0;
    player.vz = 0;

    const compPos = evaluateParabolicJump(
      tr.companionStartPos,
      tr.companionTargetPos,
      tr.companionStartY,
      tr.companionTargetY,
      tr.arcHeight * 0.85,
      t,
    );
    companion.x = compPos.x;
    companion.z = compPos.z;
    companion.y = compPos.y;
    companion.onShipDeck = false;

    if (tr.elapsed >= tr.duration) {
      ship.mode = 'sailing';
      ship.isSailing = true;
      ship.dockedIslandId = null;
      ship.transition = null;
      this.syncCrewToShipDeck();
      this.refreshShipDisembarkStatus();
      this.updateNearestInteractable();
      this.refreshQuestTarget();
      this.state.events.push({
        type: 'ship_boarded',
        x: ship.position.x,
        z: ship.position.z,
        text: 'À la barre ! ZQSD / WASD / Flèches pour naviguer, E près d’une plage pour débarquer.',
      });
    }
  }

  private updateSailing(dt: number, input: InputState): void {
    const ship = this.state.ship;
    this.state.companion.bobPhase += dt * 4;
    this.state.inVillage = false;

    const controls = mapInputStateToShipControls(input);
    const physRes = stepShipPhysics(
      ship,
      controls,
      dt,
      SHIP_PHYSICS_CONFIG,
      (x, z, angle, speed, angVel, cfg, substepDt) =>
        resolveShipCoastCollision(x, z, angle, speed, angVel, cfg, substepDt),
    );
    ship.vx = physRes.vx;
    ship.vz = physRes.vz;

    this.syncCrewToShipDeck();
    this.refreshShipDisembarkStatus();
    this.updateNearestInteractable();
    this.refreshQuestTarget();

    if (input.interactPressed) {
      this.tryInitiateDocking();
    }
  }

  private tryInitiateDocking(): boolean {
    const ship = this.state.ship;
    if (ship.mode !== 'sailing') return false;

    const status = ship.disembarkStatus;
    if (status.canDisembark && status.landingPos && status.nearestIslandId) {
      const duration = clamp(0.24 + Math.abs(ship.speed) * 0.032, 0.24, 0.65);
      const heroDeck = getShipDeckWorldAnchor(ship, SHIP_HERO_DECK_LOCAL);
      const compDeck = getShipDeckWorldAnchor(ship, SHIP_COMPANION_DECK_LOCAL);

      ship.mode = 'docking';
      ship.isSailing = true;
      ship.transition = {
        kind: 'docking',
        elapsed: 0,
        duration,
        targetIslandId: status.nearestIslandId,
        shipStartPos: { x: ship.position.x, z: ship.position.z },
        shipTargetPos: { x: ship.position.x, z: ship.position.z },
        shipStartAngle: ship.angle,
        shipTargetAngle: ship.angle,
        heroStartPos: { x: heroDeck.x, z: heroDeck.z },
        heroStartY: heroDeck.y,
        heroTargetPos: { x: status.landingPos.x, z: status.landingPos.z },
        heroTargetY: 0,
        companionStartPos: { x: compDeck.x, z: compDeck.z },
        companionStartY: compDeck.y,
        companionTargetPos: { x: status.landingPos.x, z: status.landingPos.z },
        companionTargetY: 0,
        arcHeight: DISEMBARKING_ARC_HEIGHT,
        landingPos: { x: status.landingPos.x, z: status.landingPos.z },
      };
      this.state.nearestInteractable = null;
      this.state.events.push({
        type: 'ship_docking',
        x: ship.position.x,
        z: ship.position.z,
        islandId: status.nearestIslandId,
      });
      return true;
    }

    if (this.shipRefusalCooldown <= 0) {
      this.shipRefusalCooldown = SHIP_REFUSAL_COOLDOWN;
      let message: string;
      switch (status.reason) {
        case 'inaccessible_cliff':
          message =
            'Falaises impraticables — longez la côte vers une plage accessible.';
          break;
        case 'no_safe_spot':
          message =
            'Rivage encombré ou dangereux — cherchez une plage dégagée.';
          break;
        case 'too_far_from_shore':
        default:
          message = 'Approchez-vous d’une plage pour débarquer.';
          break;
      }
      this.state.events.push({
        type: 'ship_refused',
        x: ship.position.x,
        z: ship.position.z,
        text: message,
        toastVariant: 'warning',
      });
    }
    return false;
  }

  private updateDocking(dt: number): void {
    const ship = this.state.ship;
    this.state.companion.bobPhase += dt * 4;
    this.state.inVillage = false;
    this.state.nearestInteractable = null;

    const tr = ship.transition;
    if (!tr || tr.kind !== 'docking') {
      ship.mode = 'sailing';
      ship.isSailing = true;
      ship.transition = null;
      this.syncCrewToShipDeck();
      this.refreshShipDisembarkStatus();
      this.updateNearestInteractable();
      return;
    }

    // Freinage automatique doux vers v = 0 en préservant la collision côtière continue
    let brakeThrottle = 0;
    if (ship.speed > SHIP_PHYSICS_CONFIG.stopSpeedEpsilon) {
      brakeThrottle = -1;
    } else if (ship.speed < -SHIP_PHYSICS_CONFIG.stopSpeedEpsilon) {
      brakeThrottle = 1;
    } else {
      ship.speed = 0;
    }
    // Empêche tout basculement involontaire en marche arrière pendant l'accostage
    ship.reverseEngageTimer = SHIP_PHYSICS_CONFIG.reverseEngageDelaySec;

    const physRes = stepShipPhysics(
      ship,
      { throttle: brakeThrottle, steer: 0 },
      dt,
      SHIP_PHYSICS_CONFIG,
      (x, z, angle, speed, angVel, cfg, substepDt) =>
        resolveShipCoastCollision(x, z, angle, speed, angVel, cfg, substepDt),
    );
    ship.vx = physRes.vx;
    ship.vz = physRes.vz;

    if (
      (brakeThrottle < 0 && ship.speed < 0) ||
      (brakeThrottle > 0 && ship.speed > 0)
    ) {
      ship.speed = 0;
      ship.vx = 0;
      ship.vz = 0;
    }

    tr.shipTargetPos.x = ship.position.x;
    tr.shipTargetPos.z = ship.position.z;
    tr.shipTargetAngle = ship.angle;

    this.syncCrewToShipDeck();
    tr.elapsed += dt;

    const isStopped = Math.abs(ship.speed) <= 0.15;
    if (
      (tr.elapsed >= tr.duration && isStopped) ||
      tr.elapsed >= tr.duration + 0.35
    ) {
      ship.speed = 0;
      ship.vx = 0;
      ship.vz = 0;
      ship.angularVelocity = 0;
      ship.rudder = 0;
      ship.wakeIntensity = 0;
      ship.reverseEngageTimer = 0;

      // Re-valide le point de débarquement à l'emplacement final exact du navire
      const recheck = findSafeDisembarkSpot(
        ship.position.x,
        ship.position.z,
        ship.angle,
        {
          zoneId: this.state.zoneId,
          currentIslandId: this.state.islandId,
          enemies: this.state.enemies,
        },
      );
      ship.disembarkStatus = recheck;

      let targetIslandId: IslandId = tr.targetIslandId;
      let landingPos: Vec2 | null = null;
      if (recheck.canDisembark && recheck.landingPos && recheck.nearestIslandId) {
        targetIslandId = recheck.nearestIslandId;
        landingPos = { x: recheck.landingPos.x, z: recheck.landingPos.z };
      } else if (
        tr.landingPos &&
        dist(ship.position.x, ship.position.z, tr.landingPos.x, tr.landingPos.z) <=
          SHIP_BOARDING_RADIUS
      ) {
        landingPos = { x: tr.landingPos.x, z: tr.landingPos.z };
      }

      if (!landingPos) {
        ship.mode = 'sailing';
        ship.isSailing = true;
        ship.transition = null;
        this.updateNearestInteractable();
        this.state.events.push({
          type: 'ship_refused',
          x: ship.position.x,
          z: ship.position.z,
          text: 'Rivage encombré ou hors de portée — cherchez une plage dégagée.',
          toastVariant: 'warning',
        });
        return;
      }

      this.beginDisembarking(targetIslandId, landingPos);
    }
  }

  private beginDisembarking(targetIslandId: IslandId, landingPos: Vec2): void {
    const ship = this.state.ship;
    const player = this.state.player;
    const companion = this.state.companion;

    this.disembarkChangedIsland = targetIslandId !== this.state.islandId;
    this.switchActiveIsland(targetIslandId);

    const heroDeck = getShipDeckWorldAnchor(ship, SHIP_HERO_DECK_LOCAL);
    const compDeck = getShipDeckWorldAnchor(ship, SHIP_COMPANION_DECK_LOCAL);

    const dxJump = landingPos.x - heroDeck.x;
    if (Math.abs(dxJump) > 0.05) {
      player.facingX = dxJump >= 0 ? 1 : -1;
    }

    const compDesired: Vec2 = {
      x: landingPos.x - player.facingX * 1.4,
      z: landingPos.z - 0.8,
    };
    const compLanding = findSafeLandPositionOnIsland(targetIslandId, compDesired);

    ship.mode = 'disembarking';
    ship.isSailing = false;
    ship.dockedIslandId = targetIslandId;
    ship.nearestCoastIslandId = targetIslandId;
    ship.transition = {
      kind: 'disembarking',
      elapsed: 0,
      duration: DISEMBARKING_DURATION,
      targetIslandId,
      shipStartPos: { x: ship.position.x, z: ship.position.z },
      shipTargetPos: { x: ship.position.x, z: ship.position.z },
      shipStartAngle: ship.angle,
      shipTargetAngle: ship.angle,
      heroStartPos: { x: heroDeck.x, z: heroDeck.z },
      heroStartY: heroDeck.y,
      heroTargetPos: { x: landingPos.x, z: landingPos.z },
      heroTargetY: 0,
      companionStartPos: { x: compDeck.x, z: compDeck.z },
      companionStartY: compDeck.y,
      companionTargetPos: { x: compLanding.x, z: compLanding.z },
      companionTargetY: 0,
      arcHeight: DISEMBARKING_ARC_HEIGHT,
      landingPos: { x: landingPos.x, z: landingPos.z },
    };

    player.onShipDeck = false;
    companion.onShipDeck = false;
    this.state.nearestInteractable = null;
  }

  private updateDisembarking(dt: number): void {
    const ship = this.state.ship;
    const player = this.state.player;
    const companion = this.state.companion;

    // Le bateau flotte doucement SANS jamais bouger sa position ni son cap !
    updateShipIdleBobbing(ship, dt);
    companion.bobPhase += dt * 4;
    this.state.nearestInteractable = null;

    const tr = ship.transition;
    if (!tr || tr.kind !== 'disembarking') {
      const safePos = findSafeLandPositionOnIsland(this.state.islandId, {
        x: player.x,
        z: player.z,
      });
      player.x = safePos.x;
      player.z = safePos.z;
      player.elevationY = 0;
      player.onShipDeck = false;
      companion.y = 0;
      companion.onShipDeck = false;
      ship.mode = 'parked';
      ship.isSailing = false;
      ship.transition = null;
      this.rebuildInteractables();
      this.updateNearestInteractable();
      return;
    }

    tr.elapsed += dt;
    const t = clamp(tr.elapsed / Math.max(tr.duration, 1e-4), 0, 1);

    const heroPos = evaluateParabolicJump(
      tr.heroStartPos,
      tr.heroTargetPos,
      tr.heroStartY,
      tr.heroTargetY,
      tr.arcHeight,
      t,
    );
    player.x = heroPos.x;
    player.z = heroPos.z;
    player.elevationY = heroPos.y;
    player.onShipDeck = false;
    player.vx = 0;
    player.vz = 0;

    const compPos = evaluateParabolicJump(
      tr.companionStartPos,
      tr.companionTargetPos,
      tr.companionStartY,
      tr.companionTargetY,
      tr.arcHeight * 0.85,
      t,
    );
    companion.x = compPos.x;
    companion.z = compPos.z;
    companion.y = compPos.y;
    companion.onShipDeck = false;

    if (tr.elapsed >= tr.duration) {
      const finalLanding = tr.landingPos ?? tr.heroTargetPos;
      const targetIslandId = tr.targetIslandId;
      const changedIsland = this.disembarkChangedIsland;
      this.disembarkChangedIsland = false;

      player.x = finalLanding.x;
      player.z = finalLanding.z;
      player.elevationY = 0;
      player.onShipDeck = false;
      player.vx = 0;
      player.vz = 0;

      companion.x = tr.companionTargetPos.x;
      companion.z = tr.companionTargetPos.z;
      companion.y = 0;
      companion.onShipDeck = false;

      ship.mode = 'parked';
      ship.isSailing = false;
      ship.transition = null;
      ship.dockedIslandId = targetIslandId;
      ship.nearestCoastIslandId = targetIslandId;
      ship.disembarkStatus = createEmptyDisembarkStatus();

      this.state.islandId = targetIslandId;
      this.state.inVillage =
        this.state.zoneId === 'overworld' &&
        targetIslandId === 'felingard' &&
        isInsideVillage(player.x, player.z);

      this.rebuildInteractables();
      this.updateNearestInteractable();
      this.updateActiveBoss();
      this.refreshQuestTarget();
      this.saveCurrentGame();

      this.state.events.push({
        type: 'ship_disembarked',
        x: player.x,
        z: player.z,
        islandId: targetIslandId,
        ...(changedIsland
          ? { text: `Bienvenue sur ${getIslandName(targetIslandId)} !` }
          : {}),
      });
    }
  }

  private checkPerfectDodge(): boolean {
    const player = this.state.player;
    let triggered = false;

    for (const tz of this.state.telegraphs) {
      if (tz.resolved || tz.perfectDodged || (tz.delaySec ?? 0) > 0) continue;
      const timeRemaining = tz.duration - tz.elapsed;
      if (timeRemaining <= 0 || timeRemaining > PERFECT_DODGE_WINDOW_SEC) continue;
      if (isTargetInTelegraph(tz, player.x, player.z, PLAYER_RADIUS * 0.5)) {
        tz.perfectDodged = true;
        triggered = true;
      }
    }

    // Support esquive parfaite à l'approche immédiate d'un projectile ennemi (< 0.18s d'impact)
    if (!triggered) {
      for (const ep of this.state.enemyProjectiles) {
        const d = dist(ep.x, ep.z, player.x, player.z);
        const hitDist = ep.radius + PLAYER_RADIUS + ep.speed * PERFECT_DODGE_WINDOW_SEC;
        if (d <= hitDist) {
          triggered = true;
          break;
        }
      }
    }

    if (!triggered) return false;

    this.state.timeScale = PERFECT_DODGE_TIMESCALE;
    this.state.perfectDodgeTimer = PERFECT_DODGE_SLOW_DURATION;
    player.perfectDodgeBuffTimer = PERFECT_DODGE_BUFF_DURATION;

    const mpBonus = Math.max(1, Math.round(player.maxMp * PERFECT_DODGE_MP_PCT));
    const prevMp = player.mp;
    player.mp = Math.min(player.maxMp, player.mp + mpBonus);
    const actualMp = player.mp - prevMp;

    this.state.events.push({
      type: 'perfect_dodge',
      x: player.x,
      z: player.z,
      value: actualMp,
      text: 'ESQUIVE PARFAITE !',
    });
    this.triggerCompanionReaction('perfect_dodge');

    if (actualMp > 0) {
      this.state.events.push({
        type: 'mp_gain',
        x: player.x,
        z: player.z,
        value: actualMp,
        text: `+${actualMp} PM`,
      });
    }

    return true;
  }

  private isProjectileBlocked(x: number, z: number, radius: number): boolean {
    if (this.state.zoneId === 'overworld') {
      if (this.state.islandId !== 'felingard') {
        const def = NEW_ISLANDS[this.state.islandId];
        const dx = x - def.centerX;
        const dz = z - def.centerZ;
        const maxR = Math.max(
          0,
          getNewIslandRadiusAtAngle(this.state.islandId, Math.atan2(dz, dx)) - 0.5,
        );
        if (Math.hypot(dx, dz) > maxR) return true;
        for (const prop of def.props) {
          if (!prop.collidable || !prop.colliderRadius) continue;
          if (circlesOverlap(x, z, radius, prop.x, prop.z, prop.colliderRadius * 0.85)) {
            return true;
          }
        }
        return false;
      }

      if (!isInsideIsland(x, z, 0.5)) return true;
      for (const b of OVERWORLD_DATA.buildings) {
        if (circlesOverlap(x, z, radius, b.x, b.z, b.colliderRadius * 0.9)) {
          return true;
        }
      }
      for (const prop of OVERWORLD_DATA.props) {
        if (!prop.collidable || !prop.colliderRadius) continue;
        if (circlesOverlap(x, z, radius, prop.x, prop.z, prop.colliderRadius * 0.85)) {
          return true;
        }
      }
      return false;
    }

    const def = getDungeonDefinition(this.state.zoneId);
    const halfW = def.width * 0.5 - radius;
    const halfD = def.depth * 0.5 - radius;
    if (x < -halfW || x > halfW || z < -halfD || z > halfD) {
      return true;
    }
    for (const wall of def.walls) {
      if (circleIntersectsAABB(x, z, radius, wall)) {
        return true;
      }
    }
    for (const pillar of def.pillars) {
      if (circlesOverlap(x, z, radius, pillar.x, pillar.z, DUNGEON_PILLAR_RADIUS)) {
        return true;
      }
    }
    return false;
  }

  private spawnLootDropsForEnemy(
    enemy: EnemyInstance,
    goldReward: number,
    xpReward: number,
  ): void {
    const goldCount = enemy.isBoss ? 5 : goldReward >= 40 ? 3 : 2;
    const xpCount = enemy.isBoss ? 4 : xpReward >= 60 ? 3 : 2;
    const goldPieces = splitRewardAmounts(goldReward, goldCount);
    const xpPieces = splitRewardAmounts(xpReward, xpCount);

    const totalDrops = goldPieces.length + xpPieces.length;
    if (totalDrops === 0) return;

    const magnetRange = enemy.isBoss ? 8.5 : 5.5;
    const baseAngle = this.rng() * Math.PI * 2;
    let idx = 0;

    const pushPiece = (kind: LootDropKind, amount: number): void => {
      const angle = baseAngle + (idx / totalDrops) * Math.PI * 2 + (this.rng() - 0.5) * 0.45;
      idx += 1;
      const launchSpeed = 2.4 + this.rng() * 2.1;
      const drop: LootDrop = {
        id: `loot_${nextLootDropId++}`,
        kind,
        amount,
        x: enemy.x,
        y: 0.45,
        z: enemy.z,
        vx: Math.cos(angle) * launchSpeed,
        vy: 4.5 + this.rng() * 1.6,
        vz: Math.sin(angle) * launchSpeed,
        age: 0,
        collectDelay: 0.48,
        bounces: 0,
        magnetRange,
        magnetized: false,
      };
      this.state.lootDrops.push(drop);
    };

    for (const amt of goldPieces) pushPiece('gold', amt);
    for (const amt of xpPieces) pushPiece('xp', amt);

    this.state.events.push({
      type: 'loot_spawned',
      x: enemy.x,
      z: enemy.z,
      value: totalDrops,
    });
  }

  private collectLootDrop(drop: LootDrop): void {
    const p = this.state.player;
    if (drop.kind === 'gold') {
      p.gold += drop.amount;
      this.state.events.push({
        type: 'gold_pickup',
        x: p.x,
        z: p.z,
        value: drop.amount,
        lootKind: 'gold',
      });
    } else {
      grantXp(p, drop.amount, this.state.events);
    }
  }

  private updateLootDrops(dt: number): void {
    const drops = this.state.lootDrops;
    if (drops.length === 0 || dt <= 0) return;

    const p = this.state.player;
    const canMagnet = p.hp > 0 && this.state.ship.mode === 'parked';
    const groundY = 0.15;

    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.age += dt;

      // Balistique parabolique + rebonds au sol
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.y += d.vy * dt;
      d.vy -= 24.0 * dt;

      if (d.y <= groundY) {
        d.y = groundY;
        if (d.bounces < 2 && Math.abs(d.vy) > 1.8) {
          d.vy = -d.vy * 0.46;
          d.vx *= 0.72;
          d.vz *= 0.72;
          d.bounces += 1;
          this.state.events.push({
            type: 'loot_bounce',
            x: d.x,
            z: d.z,
            lootKind: d.kind,
          });
        } else {
          d.vy = 0;
          const damp = Math.exp(-8 * dt);
          d.vx *= damp;
          d.vz *= damp;
        }
      }

      const readyToMagnetize = (d.bounces >= 1 && d.age >= d.collectDelay) || d.age >= 0.75;
      if (!canMagnet || !readyToMagnetize) {
        continue;
      }

      const distToPlayer = dist(d.x, d.z, p.x, p.z);
      if (distToPlayer <= 0.9) {
        this.collectLootDrop(d);
        drops.splice(i, 1);
        continue;
      }

      if (d.magnetized || distToPlayer <= d.magnetRange) {
        d.magnetized = true;
        const dir = normalize(p.x - d.x, p.z - d.z);
        const pullSpeed = 13.5 + Math.min(14, d.age * 7.5);
        d.vx = dir.x * pullSpeed;
        d.vz = dir.z * pullSpeed;
        d.y = Math.max(groundY, d.y + (0.55 - d.y) * Math.min(1, dt * 8));
      }
    }
  }

  // ==========================================================================
  // Cinématiques d'Intro & de Mort des Boss (Roi Rat-Spectre & Drak-Miaou)
  // ==========================================================================

  private maybeTriggerBossIntro(): void {
    if (
      this.state.screen !== 'playing' ||
      this.state.cinematic ||
      this.state.dialogue.active ||
      this.state.deathSequence ||
      this.state.portalTransition ||
      this.state.openingChest
    ) {
      return;
    }

    const p = this.state.player;
    for (const enemy of this.state.enemies) {
      if (!enemy.isBoss || enemy.state === 'dead' || enemy.hp <= 0) continue;
      if (enemy.introPlayed || this.state.playedBossIntros.includes(enemy.typeId)) continue;

      const def = getEnemyDefinition(enemy.typeId);
      const d = dist(p.x, p.z, enemy.x, enemy.z);
      const enteredArena =
        (this.state.zoneId === 'dungeon_ghost_cave' && p.z <= -8.5) ||
        (this.state.zoneId === 'dungeon_dragon_lair' && p.z <= 6.0);

      if (enemy.aggroed || enteredArena || d <= def.aggroRange) {
        this.startBossCinematic(enemy, 'boss_intro');
        break;
      }
    }
  }

  private startBossCinematic(boss: EnemyInstance, kind: CinematicKind): void {
    if (this.state.cinematic) {
      this.forceCompleteCinematic();
    }

    const isDragon = boss.typeId === 'boss_dragon_claw';
    const isIntro = kind === 'boss_intro';

    if (isIntro) {
      boss.introPlayed = true;
      boss.aggroed = true;
      if (!this.state.playedBossIntros.includes(boss.typeId)) {
        this.state.playedBossIntros.push(boss.typeId);
      }
    } else {
      // Sur mort de boss : purge immédiatement les menaces actives pour garantir la sécurité
      this.state.telegraphs = [];
      this.state.enemyProjectiles = [];
      this.state.hazardZones = [];
    }

    const p = this.state.player;
    p.vx = 0;
    p.vz = 0;
    p.dodgeTimer = 0;
    p.attackAnimTimer = 0;
    p.invulnTimer = Math.max(p.invulnTimer, 0.5);
    this.state.pendingInteraction = null;
    this.state.perfectDodgeTimer = 0;

    const duration = isIntro ? (isDragon ? 2.4 : 2.2) : isDragon ? 3.4 : 2.6;
    const maxDuration = isIntro ? (isDragon ? 3.4 : 3.2) : isDragon ? 4.8 : 3.8;
    const initialStage = isIntro
      ? isDragon
        ? 'aerial_descent'
        : 'throne_arrival'
      : isDragon
        ? 'cracks'
        : 'slowmo_collapse';

    if (!isIntro && !isDragon) {
      this.state.timeScale = 0.38;
    }

    const cin: CinematicState = {
      id: `cin_${nextCinematicId++}`,
      kind,
      bossId: boss.id,
      bossTypeId: boss.typeId,
      stage: initialStage,
      stageIndex: 0,
      elapsed: 0,
      duration,
      maxDuration,
      focusX: boss.x,
      focusZ: boss.z,
      targetZoom: isDragon ? 1.05 : 0.92,
      heatDistortion: isDragon ? (isIntro ? 0.65 : 0.75) : 0,
      lairBrighten: 0,
      completed: false,
    };

    this.state.cinematic = cin;
    this.updateActiveBoss();
    this.state.events.push({
      type: 'boss_cinematic_start',
      x: boss.x,
      z: boss.z,
      enemyId: boss.id,
      enemyTypeId: boss.typeId,
      cinematicKind: kind,
      cinematicStage: initialStage,
    });
  }

  private updateCinematic(unscaledDt: number): void {
    const c = this.state.cinematic;
    if (!c) return;

    const p = this.state.player;
    p.vx = 0;
    p.vz = 0;
    p.dodgeTimer = 0;
    p.attackAnimTimer = 0;
    p.invulnTimer = Math.max(p.invulnTimer, 0.25);

    const boss = this.state.enemies.find((e) => e.id === c.bossId);
    if (!boss && c.kind === 'boss_intro') {
      this.forceCompleteCinematic();
      return;
    }

    if (boss) {
      c.focusX = boss.x;
      c.focusZ = boss.z;
    }

    c.elapsed += unscaledDt;
    const t = clamp(c.elapsed / Math.max(c.duration, 1e-4), 0, 1);

    let nextStage = c.stage;
    let nextStageIndex = c.stageIndex;

    if (c.kind === 'boss_intro') {
      if (c.bossTypeId === 'boss_dragon_claw') {
        if (t < 0.54) {
          nextStage = 'aerial_descent';
          nextStageIndex = 0;
          c.heatDistortion = 0.55 + t * 0.65;
        } else {
          nextStage = 'inferno_roar';
          nextStageIndex = 1;
          c.heatDistortion = 1.0;
          this.state.screenShake = Math.max(this.state.screenShake, 0.28);
        }
      } else {
        if (t < 0.5) {
          nextStage = 'throne_arrival';
          nextStageIndex = 0;
        } else {
          nextStage = 'king_challenge';
          nextStageIndex = 1;
        }
      }
    } else if (c.bossTypeId === 'boss_dragon_claw') {
      if (t < 0.25) {
        nextStage = 'cracks';
        nextStageIndex = 0;
        c.heatDistortion = 0.75;
        c.lairBrighten = t * 0.2;
      } else if (t < 0.5) {
        nextStage = 'double_shockwave';
        nextStageIndex = 1;
        c.heatDistortion = 0.55;
        c.lairBrighten = 0.1 + (t - 0.25) * 1.2;
        this.state.screenShake = Math.max(this.state.screenShake, 0.48);
      } else if (t < 0.75) {
        nextStage = 'ascending_embers';
        nextStageIndex = 2;
        c.heatDistortion = Math.max(0, 0.45 * (1 - (t - 0.5) / 0.25));
        c.lairBrighten = 0.4 + ((t - 0.5) / 0.25) * 0.35;
      } else {
        nextStage = 'lair_brighten';
        nextStageIndex = 3;
        c.heatDistortion = 0;
        c.lairBrighten = clamp(0.75 + ((t - 0.75) / 0.25) * 0.25, 0, 1);
      }
    } else {
      // Mort Roi Rat-Spectre : ralenti puis fermeture faille abyssale
      if (t < 0.46) {
        nextStage = 'slowmo_collapse';
        nextStageIndex = 0;
        this.state.timeScale = clamp(0.35 + (t / 0.46) * 0.35, 0.35, 0.7);
      } else {
        nextStage = 'rift_close';
        nextStageIndex = 1;
        this.state.timeScale = clamp(0.7 + ((t - 0.46) / 0.54) * 0.3, 0.7, 1.0);
      }
    }

    if (nextStageIndex !== c.stageIndex || nextStage !== c.stage) {
      c.stage = nextStage;
      c.stageIndex = nextStageIndex;
      this.state.events.push({
        type: 'boss_cinematic_stage',
        x: c.focusX,
        z: c.focusZ,
        enemyId: c.bossId,
        enemyTypeId: c.bossTypeId,
        cinematicKind: c.kind,
        cinematicStage: nextStage,
      });
    }

    this.state.time += unscaledDt * (this.state.timeScale ?? 1);
    this.updateTransientVisuals(unscaledDt);
    this.updateLootDrops(unscaledDt);
    this.updateCompanion(unscaledDt);
    this.updateActiveBoss();

    if (c.elapsed >= c.duration || c.elapsed >= c.maxDuration) {
      this.completeCinematic();
    }
  }

  private completeCinematic(): void {
    const c = this.state.cinematic;
    if (!c || c.completed) {
      this.state.cinematic = null;
      this.state.timeScale = 1;
      this.state.perfectDodgeTimer = 0;
      return;
    }

    c.completed = true;
    const finished = c;
    this.state.cinematic = null;
    this.state.timeScale = 1;
    this.state.perfectDodgeTimer = 0;
    this.state.player.invulnTimer = Math.max(this.state.player.invulnTimer, 0.6);

    if (finished.kind === 'boss_death') {
      const deadBoss = this.state.enemies.find((e) => e.id === finished.bossId);
      if (deadBoss) {
        deadBoss.deathTimer = 0;
        deadBoss.deathDuration = 0;
      }
    }

    this.state.events.push({
      type: 'boss_cinematic_end',
      x: finished.focusX,
      z: finished.focusZ,
      enemyId: finished.bossId,
      enemyTypeId: finished.bossTypeId,
      cinematicKind: finished.kind,
      cinematicStage: finished.stage,
    });

    if (this.pendingCinematicDialogue) {
      const dlg = this.pendingCinematicDialogue;
      this.pendingCinematicDialogue = null;
      this.startDialogue(dlg.lines, dlg.action);
    }
  }

  public forceCompleteCinematic(): void {
    if (!this.state.cinematic) {
      this.state.timeScale = 1;
      return;
    }
    this.completeCinematic();
  }

  // ==========================================================================
  // Compagnon Miaou-sprit actif (Guidage coffres/quêtes & réactions)
  // ==========================================================================

  private triggerCompanionReaction(kind: CompanionReactionKind): void {
    const comp = this.state.companion;
    if (kind === 'crit') {
      if (this.companionReactionCooldown > 0) return;
      if (comp.reactionKind === 'boss_victory' || comp.reactionKind === 'perfect_dodge') {
        if ((comp.reactionTimer ?? 0) > 0) return;
      }
      comp.reactionKind = 'crit';
      comp.reactionDuration = 0.55;
      comp.reactionTimer = 0.55;
      this.companionReactionCooldown = 0.6;
      return;
    }
    if (kind === 'perfect_dodge') {
      if (comp.reactionKind === 'boss_victory' && (comp.reactionTimer ?? 0) > 0) return;
      comp.reactionKind = 'perfect_dodge';
      comp.reactionDuration = 0.75;
      comp.reactionTimer = 0.75;
      return;
    }
    comp.reactionKind = 'boss_victory';
    comp.reactionDuration = 1.65;
    comp.reactionTimer = 1.65;
  }

  private updateCompanion(dt: number): void {
    const comp = this.state.companion;
    const player = this.state.player;
    comp.bobPhase += dt * 4;

    if (this.companionChimeCooldown > 0) {
      this.companionChimeCooldown = Math.max(0, this.companionChimeCooldown - dt);
    }
    if (this.companionReactionCooldown > 0) {
      this.companionReactionCooldown = Math.max(0, this.companionReactionCooldown - dt);
    }

    if ((comp.reactionTimer ?? 0) > 0) {
      comp.reactionTimer = Math.max(0, (comp.reactionTimer ?? 0) - dt);
      if (comp.reactionTimer <= 0) {
        comp.reactionKind = null;
        comp.reactionDuration = 0;
      }
    }

    let targetCompX = player.x - player.facingX * 1.4;
    let targetCompZ = player.z - 0.8;
    let guideKind: 'chest' | 'quest' | null = null;
    let guideTargetX: number | undefined;
    let guideTargetZ: number | undefined;

    if (
      this.state.ship.mode === 'parked' &&
      !this.state.cinematic &&
      !this.state.portalTransition &&
      !this.state.deathSequence
    ) {
      const chestRadius = this.state.zoneId === 'overworld' ? 18 : 14;
      let nearestChest: ChestInstance | null = null;
      let nearestChestDist = chestRadius;

      for (const chest of this.state.chests) {
        if (chest.opened || chest.locked) continue;
        const d = dist(player.x, player.z, chest.x, chest.z);
        if (d <= nearestChestDist) {
          nearestChestDist = d;
          nearestChest = chest;
        }
      }

      if (nearestChest && (!this.state.inCombat || nearestChestDist <= 10)) {
        guideKind = 'chest';
        guideTargetX = nearestChest.x;
        guideTargetZ = nearestChest.z;
        const dir = normalize(nearestChest.x - player.x, nearestChest.z - player.z);
        const leadDist = clamp(nearestChestDist * 0.45, 2.0, 4.2);
        const clamped = this.clampPointToCurrentZone(
          player.x + dir.x * leadDist,
          player.z + dir.z * leadDist,
        );
        targetCompX = clamped.x;
        targetCompZ = clamped.z;

        if (
          this.state.screen === 'playing' &&
          (this.companionChimeCooldown <= 0 || this.lastCompanionGuideTargetId !== nearestChest.id)
        ) {
          this.companionChimeCooldown = 9.0;
          this.lastCompanionGuideTargetId = nearestChest.id;
          this.state.events.push({
            type: 'companion_chime',
            x: comp.x,
            z: comp.z,
            targetX: nearestChest.x,
            targetZ: nearestChest.z,
            companionTargetKind: 'chest',
          });
        }
      } else if (
        this.state.questTarget &&
        this.state.questTarget.zoneId === this.state.zoneId &&
        !this.state.inCombat
      ) {
        const qt = this.state.questTarget;
        const qDist = dist(player.x, player.z, qt.x, qt.z);
        if (qDist > 5.0) {
          guideKind = 'quest';
          guideTargetX = qt.x;
          guideTargetZ = qt.z;
          const dir = normalize(qt.x - player.x, qt.z - player.z);
          const clamped = this.clampPointToCurrentZone(
            player.x + dir.x * 2.4 - dir.z * 0.65,
            player.z + dir.z * 2.4 + dir.x * 0.65,
          );
          targetCompX = clamped.x;
          targetCompZ = clamped.z;

          const qKey = `quest_${qt.questId}`;
          if (
            this.state.screen === 'playing' &&
            (this.companionChimeCooldown <= 0 || this.lastCompanionGuideTargetId !== qKey)
          ) {
            this.companionChimeCooldown = 14.0;
            this.lastCompanionGuideTargetId = qKey;
            this.state.events.push({
              type: 'companion_chime',
              x: comp.x,
              z: comp.z,
              targetX: qt.x,
              targetZ: qt.z,
              companionTargetKind: 'quest',
            });
          }
        }
      }
    }

    comp.guideKind = guideKind;
    comp.guideTargetX = guideTargetX;
    comp.guideTargetZ = guideTargetZ;
    comp.guidePulse = guideKind ? (Math.sin(this.state.time * 4.2) + 1) * 0.5 : 0;

    if (comp.reactionKind === 'crit') {
      comp.mode = 'react_crit';
    } else if (comp.reactionKind === 'perfect_dodge') {
      comp.mode = 'react_dodge';
    } else if (comp.reactionKind === 'boss_victory') {
      comp.mode = 'react_victory';
    } else if (guideKind === 'chest') {
      comp.mode = 'guide_chest';
    } else if (guideKind === 'quest') {
      comp.mode = 'guide_quest';
    } else {
      comp.mode = 'follow';
    }

    const followAlpha = 1 - Math.exp(-6 * dt);
    comp.x += (targetCompX - comp.x) * followAlpha;
    comp.z += (targetCompZ - comp.z) * followAlpha;
  }

  // ==========================================================================
  // Décor Interactif (réactions non-bloquantes sur attaques/projectiles/sorts)
  // ==========================================================================

  private resolveDecorMaterial(kind: PropKind): DecorMaterialKind {
    switch (kind) {
      case 'rock':
      case 'snow_rock':
        return 'stone';
      case 'barrel':
      case 'fence':
      case 'signpost':
        return 'wood';
      case 'oak_tree':
      case 'twisted_tree':
      case 'snow_pine':
      case 'bush':
      case 'flower_patch':
      case 'mushroom':
      default:
        return 'foliage';
    }
  }

  private emitDecorHit(
    id: string,
    x: number,
    z: number,
    decorMaterial: DecorMaterialKind,
    angle: number,
    propKind?: PropKind,
  ): void {
    if (this.decorHitCooldowns.has(id)) return;
    this.decorHitCooldowns.set(id, 0.18);
    this.state.events.push({
      type: 'decor_hit',
      x,
      z,
      angle,
      propId: id,
      propKind,
      decorMaterial,
    });
  }

  private triggerDecorHitsForMelee(meta: AttackMetadata, ox: number, oz: number): void {
    const centerAngle = (meta.startAngle + meta.endAngle) * 0.5;
    const arcSpan = Math.max(0.65, Math.abs(meta.endAngle - meta.startAngle));
    const checkShape = (tx: number, tz: number, tr: number): boolean => {
      if (meta.attackShape === 'thrust_line') {
        return isPointInLine(tx, tz, ox, oz, centerAngle, meta.range, 1.3, tr);
      }
      if (meta.attackShape === 'cleave') {
        return isPointInCone(tx, tz, ox, oz, centerAngle, meta.range, Math.max(arcSpan, 2.2), tr);
      }
      return isPointInCone(tx, tz, ox, oz, centerAngle, meta.range, arcSpan, tr);
    };

    if (this.state.zoneId === 'overworld') {
      const props =
        this.state.islandId === 'felingard'
          ? OVERWORLD_DATA.props
          : NEW_ISLANDS[this.state.islandId].props;
      for (const prop of props) {
        if (prop.kind === 'house_cat') continue;
        const r = prop.colliderRadius ?? (prop.kind === 'flower_patch' || prop.kind === 'bush' ? 0.9 : 0.65);
        if (checkShape(prop.x, prop.z, r)) {
          this.emitDecorHit(
            prop.id,
            prop.x,
            prop.z,
            this.resolveDecorMaterial(prop.kind),
            centerAngle,
            prop.kind,
          );
        }
      }
      return;
    }

    const dungeonDef = getDungeonDefinition(this.state.zoneId);
    for (const prop of dungeonDef.props ?? []) {
      const r = prop.colliderRadius ?? 0.7;
      if (checkShape(prop.x, prop.z, r)) {
        this.emitDecorHit(
          prop.id,
          prop.x,
          prop.z,
          this.resolveDecorMaterial(prop.kind),
          centerAngle,
          prop.kind,
        );
      }
    }
    for (const crystal of this.state.healingCrystals) {
      if (checkShape(crystal.x, crystal.z, 0.9)) {
        this.emitDecorHit(crystal.id, crystal.x, crystal.z, 'crystal', centerAngle);
      }
    }
  }

  private triggerDecorHitsForSpell(spellId: SpellId, aimWorldPos: Vec2 | null): void {
    const spell = SPELLS[spellId];
    if (!spell) return;
    if (spell.geometry === 'self_heal' || spell.geometry === 'self_shield') return;

    const p = this.state.player;
    let cx = p.x;
    let cz = p.z;
    const radius = spell.radius;
    const isLine = spell.geometry === 'line_pierce';

    if (spell.geometry === 'target_meteor_aoe') {
      if (aimWorldPos) {
        const clamped = this.clampPointToCurrentZone(aimWorldPos.x, aimWorldPos.z);
        cx = clamped.x;
        cz = clamped.z;
      } else {
        const castR = spell.castRange ?? 5.5;
        cx = p.x + Math.cos(p.aimAngle) * castR;
        cz = p.z + Math.sin(p.aimAngle) * castR;
      }
    }

    const checkSpellHit = (tx: number, tz: number, tr: number): boolean =>
      isLine
        ? isPointInLine(tx, tz, p.x, p.z, p.aimAngle, spell.radius, 1.4, tr)
        : isPointInCircle(tx, tz, cx, cz, radius, tr);

    if (this.state.zoneId === 'overworld') {
      const props =
        this.state.islandId === 'felingard'
          ? OVERWORLD_DATA.props
          : NEW_ISLANDS[this.state.islandId].props;
      for (const prop of props) {
        if (prop.kind === 'house_cat') continue;
        const r = prop.colliderRadius ?? 0.8;
        if (checkSpellHit(prop.x, prop.z, r)) {
          this.emitDecorHit(
            prop.id,
            prop.x,
            prop.z,
            this.resolveDecorMaterial(prop.kind),
            angleBetween(p.x, p.z, prop.x, prop.z),
            prop.kind,
          );
        }
      }
      return;
    }

    const dungeonDef = getDungeonDefinition(this.state.zoneId);
    for (const prop of dungeonDef.props ?? []) {
      const r = prop.colliderRadius ?? 0.7;
      if (checkSpellHit(prop.x, prop.z, r)) {
        this.emitDecorHit(
          prop.id,
          prop.x,
          prop.z,
          this.resolveDecorMaterial(prop.kind),
          angleBetween(p.x, p.z, prop.x, prop.z),
          prop.kind,
        );
      }
    }
    for (const crystal of this.state.healingCrystals) {
      if (checkSpellHit(crystal.x, crystal.z, 0.9)) {
        this.emitDecorHit(
          crystal.id,
          crystal.x,
          crystal.z,
          'crystal',
          angleBetween(p.x, p.z, crystal.x, crystal.z),
        );
      }
    }
  }

  private triggerDecorHitsForProjectiles(dt: number): void {
    const projs = this.state.playerProjectiles;
    if (projs.length === 0 || dt <= 0) return;

    if (this.state.zoneId === 'overworld') {
      const props =
        this.state.islandId === 'felingard'
          ? OVERWORLD_DATA.props
          : NEW_ISLANDS[this.state.islandId].props;
      for (const proj of projs) {
        const nx = proj.x + proj.vx * dt;
        const nz = proj.z + proj.vz * dt;
        const ang = Math.atan2(proj.vz, proj.vx);
        for (const prop of props) {
          if (prop.kind === 'house_cat') continue;
          const r = prop.colliderRadius ?? 0.8;
          if (circlesOverlap(nx, nz, proj.radius + 0.15, prop.x, prop.z, r)) {
            this.emitDecorHit(
              prop.id,
              prop.x,
              prop.z,
              this.resolveDecorMaterial(prop.kind),
              ang,
              prop.kind,
            );
          }
        }
      }
      return;
    }

    const dungeonDef = getDungeonDefinition(this.state.zoneId);
    for (const proj of projs) {
      const nx = proj.x + proj.vx * dt;
      const nz = proj.z + proj.vz * dt;
      const ang = Math.atan2(proj.vz, proj.vx);
      for (const prop of dungeonDef.props ?? []) {
        const r = prop.colliderRadius ?? 0.7;
        if (circlesOverlap(nx, nz, proj.radius + 0.15, prop.x, prop.z, r)) {
          this.emitDecorHit(
            prop.id,
            prop.x,
            prop.z,
            this.resolveDecorMaterial(prop.kind),
            ang,
            prop.kind,
          );
        }
      }
      for (const crystal of this.state.healingCrystals) {
        if (circlesOverlap(nx, nz, proj.radius + 0.15, crystal.x, crystal.z, 0.9)) {
          this.emitDecorHit(crystal.id, crystal.x, crystal.z, 'crystal', ang);
        }
      }
    }
  }
}
