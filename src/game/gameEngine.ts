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
import { SPELL_ORDER } from '../data/spellsData';
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
  isInsideVillage,
} from '../data/worldData';
import {
  NEW_ISLANDS,
  clampToNewIsland,
  getNewIslandRadiusAtAngle,
} from '../data/worldIslands';
import {
  DODGE_SPEED,
  HITSTOP_MAJOR_DURATION,
  PLAYER_MOVE_SPEED,
  PLAYER_RADIUS,
  castSpell,
  executeDodgeRoll,
  executeMeleeAttack,
  updatePlayerRegen,
  updatePlayerShield,
} from './combat';
import {
  OVERWORLD_RESPAWN_TIME,
  createEnemyInstance,
  updateEnemies,
  updateTelegraphs,
  updateTraps,
} from './enemyAI';
import {
  angleBetween,
  clamp,
  dist,
  resolveCircleAABB,
  resolveCircleCircle,
} from './math';
import {
  addEquipment,
  buyMysteryChest as progressionBuyMysteryChest,
  createInitialPlayerState,
  equipItem as progressionEquipItem,
  getXpToNextLevel,
  grantXp,
  recalculatePlayerStats,
  rollEquipmentByWeights,
  unequipSlot as progressionUnequipSlot,
  upgradeSpell as progressionUpgradeSpell,
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
} from './shorelineNavigation';
import type {
  ActiveModal,
  ChestInstance,
  DialogueAction,
  DialogueLine,
  EnemyInstance,
  EquipSlot,
  GameEvent,
  GameState,
  InputState,
  Interactable,
  IslandId,
  MusicTrackId,
  MysteryChestResult,
  QuestId,
  ShipDisembarkStatus,
  ShipSlot,
  ShipState,
  SpellId,
  Vec2,
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
      p.inventory[id] = { id: item.id, level: item.level };
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
    this.state.screen = 'playing';
    this.shipRefusalCooldown = 0;
    this.disembarkChangedIsland = false;

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

  public returnToTitle(): void {
    this.state.activeModal = 'none';
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
    for (const sid of SPELL_ORDER) {
      p.spellCooldowns[sid] = 0;
    }

    this.state.companion.y = 0;
    this.state.companion.onShipDeck = false;

    this.state.activeModal = 'none';
    this.state.dialogue = {
      active: false,
      lines: [],
      currentIndex: 0,
      onCompleteAction: 'none',
    };
    this.state.screen = 'playing';
    this.shipRefusalCooldown = 0;
    this.disembarkChangedIsland = false;

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
    if (this.state.zoneId === 'dungeon_dragon_lair') {
      return 'boss';
    }
    if (this.state.zoneId === 'dungeon_ghost_cave') {
      const activeBoss = this.getActiveBoss();
      if (activeBoss) return 'boss';
      return 'dungeon';
    }
    return 'overworld';
  }

  // ==========================================================================
  // Boucle de Simulation Principale : step(rawDt, input)
  // ==========================================================================

  public step(rawDt: number, input: InputState): void {
    // Clamp obligatoire du delta-time (max 50 ms)
    const dt = Math.min(Math.max(rawDt, 0), 0.05);

    // Décroissance des transitions visuelles et du screen shake (même en hitstop)
    if (this.state.transitionTimer > 0) {
      this.state.transitionTimer = Math.max(0, this.state.transitionTimer - dt);
      this.state.transitionFade = clamp(this.state.transitionTimer / 0.45, 0, 1);
    } else {
      this.state.transitionFade = 0;
    }

    if (this.state.screenShake > 0) {
      this.state.screenShake = Math.max(0, this.state.screenShake - dt * 2.4);
    }

    // Écran Titre / Défaite / Victoire : horloge ambiante + douce flottaison du bateau
    if (
      this.state.screen === 'title' ||
      this.state.screen === 'defeat' ||
      this.state.screen === 'victory'
    ) {
      this.state.time += dt;
      if (this.state.zoneId === 'overworld' && this.state.ship.mode === 'parked') {
        updateShipIdleBobbing(this.state.ship, dt);
      }
      return;
    }

    // Dialogue actif : bloque le combat jusqu'à validation
    if (this.state.dialogue.active) {
      this.state.time += dt;
      if (this.state.zoneId === 'overworld' && this.state.ship.mode === 'parked') {
        updateShipIdleBobbing(this.state.ship, dt);
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
      this.state.hitstopTimer = Math.max(0, this.state.hitstopTimer - dt);
      return;
    }

    // Avance les horloges de jeu
    this.state.time += dt;
    this.state.runStats.playTimeSec += dt;
    if (this.shipRefusalCooldown > 0) {
      this.shipRefusalCooldown = Math.max(0, this.shipRefusalCooldown - dt);
    }

    const player = this.state.player;

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

    // Effets visuels temporaires
    this.updateTransientVisuals(dt);

    // --- Machine à états maritime (boarding | sailing | docking | disembarking) ---
    if (this.state.ship.mode !== 'parked') {
      this.stepMaritimeState(dt, input);
      return;
    }

    // En mode 'parked' sur l'overworld : flottaison douce du bateau ancré
    if (this.state.zoneId === 'overworld') {
      updateShipIdleBobbing(this.state.ship, dt);
    }

    // --- 2. Orientation & Visée ---
    const moveMag = Math.hypot(input.moveX, input.moveZ);
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

    // --- 3. Interaction contextuelle ([E] prioritaire sur Sort 2) ---
    this.updateNearestInteractable();
    let interactedThisTick = false;
    if (input.interactPressed && this.state.nearestInteractable) {
      this.interactWith(this.state.nearestInteractable);
      interactedThisTick = true;
      if (this.state.ship.mode !== 'parked') return;
      if (
        this.state.dialogue.active ||
        this.state.activeModal !== 'none' ||
        this.state.screen !== 'playing'
      ) {
        return;
      }
    }

    // --- 4. Roulade d'esquive (dodge-cancel prioritaire sur mêlée) ---
    if (input.dodgePressed) {
      const dodged = executeDodgeRoll(
        player,
        input.moveX,
        input.moveZ,
        this.state.events,
        this.state.dodgeGhosts,
      );
      if (dodged) {
        this.dodgeGhostAccum = 0;
      }
    }

    // --- 5. Déplacement du joueur ---
    if (player.dodgeTimer > 0) {
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
      let mx = input.moveX;
      let mz = input.moveZ;
      if (moveMag > 1) {
        mx /= moveMag;
        mz /= moveMag;
      }
      const speedScale = player.attackAnimTimer > 0 ? 0.55 : 1.0;
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
    }

    this.state.inVillage =
      this.state.zoneId === 'overworld' &&
      this.state.islandId === 'felingard' &&
      isInsideVillage(player.x, player.z);

    // --- 6. Attaque Mêlée (Combo 3 coups + auto-aim doux hors visée souris explicite) ---
    if (
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
        this.state.screenShake = Math.max(
          this.state.screenShake,
          meleeRes.shakeAmount,
        );
        if (meleeRes.triggeredHitstop) {
          this.state.hitstopTimer = Math.max(
            this.state.hitstopTimer,
            HITSTOP_MAJOR_DURATION,
          );
        }
        for (const killed of meleeRes.killedEnemies) {
          this.handleEnemyKilled(killed);
        }
      }
    }

    // --- 7. Sorts (1-4 / Q E R F — E ignoré si interaction exécutée ce tick) ---
    for (const sid of SPELL_ORDER) {
      if (sid === 'lightnyan' && interactedThisTick) continue;
      if (input.spellPressed[sid]) {
        this.castSpellById(sid);
      }
    }

    // --- 8. Compagnon Miaou-sprit ---
    const targetCompX = player.x - player.facingX * 1.4;
    const targetCompZ = player.z - 0.8;
    const followAlpha = 1 - Math.exp(-6 * dt);
    this.state.companion.x += (targetCompX - this.state.companion.x) * followAlpha;
    this.state.companion.z += (targetCompZ - this.state.companion.z) * followAlpha;
    this.state.companion.bobPhase += dt * 4;

    // --- 9. Pièges, IA Ennemis & Télégraphes ---
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
    );

    if (tgRes.maxShake > 0) {
      this.state.screenShake = Math.max(this.state.screenShake, tgRes.maxShake);
    }

    if (tgRes.playerDied || player.hp <= 0) {
      this.state.screen = 'defeat';
      this.state.activeModal = 'none';
      this.state.telegraphs = [];
      return;
    }

    // --- 10. Boss actif, interactable le plus proche & flèche dorée ---
    this.updateActiveBoss();
    this.updateNearestInteractable();
    this.refreshQuestTarget();
  }

  // ==========================================================================
  // Transitions de Zone (Overworld <-> Donjon 1 <-> Donjon 2)
  // ==========================================================================

  public loadZone(zoneId: ZoneId, spawnPos: Vec2, emitEvent = true): void {
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

    this.state.companion.x = spawnPos.x - this.state.player.facingX * 1.4;
    this.state.companion.z = spawnPos.z - 0.8;
    this.state.companion.y = 0;
    this.state.companion.onShipDeck = false;

    this.state.telegraphs = [];
    this.state.activeSpellEffects = [];
    this.state.dodgeGhosts = [];
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

    this.state.transitionTimer = 0.45;
    this.state.transitionFade = 1;

    if (emitEvent) {
      this.state.events.push({
        type: 'zone_transition',
        zoneId,
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
    if (this.state.ship.mode !== 'parked') {
      return false;
    }
    this.updateNearestInteractable();
    if (!this.state.nearestInteractable) return false;
    this.interactWith(this.state.nearestInteractable);
    return true;
  }

  public openChest(chestId: string): boolean {
    const chest = this.state.chests.find((c) => c.id === chestId);
    if (!chest || chest.opened || chest.locked) return false;

    chest.opened = true;
    if (!this.state.openedChestIds.includes(chest.id)) {
      this.state.openedChestIds.push(chest.id);
    }
    this.state.runStats.chestsOpened += 1;

    const p = this.state.player;
    const gold = chest.loot.gold;
    if (gold > 0) {
      p.gold += gold;
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

  public castSpellById(spellId: SpellId): boolean {
    if (
      this.state.screen !== 'playing' ||
      this.state.activeModal !== 'none' ||
      this.state.dialogue.active ||
      this.state.ship.mode !== 'parked'
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
        rng: this.rng,
      },
    );

    if (!res.cast) return false;

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

  private interactWith(interactable: Interactable): void {
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
          this.openChest(interactable.chestId);
        }
        break;

      case 'dungeon_entrance': {
        if (interactable.requiresRunicKey && !this.state.player.hasRunicKey) {
          this.startDialogue(SEALED_DRAGON_LAIR_DIALOGUE, 'none');
          return;
        }
        if (interactable.targetZoneId && interactable.targetSpawn) {
          this.loadZone(interactable.targetZoneId, { ...interactable.targetSpawn }, true);
        }
        break;
      }

      case 'dungeon_exit': {
        if (interactable.targetZoneId && interactable.targetSpawn) {
          this.loadZone(interactable.targetZoneId, { ...interactable.targetSpawn }, true);
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
    enemy.respawnTimer =
      this.state.zoneId === 'overworld' && !enemy.isBoss
        ? OVERWORLD_RESPAWN_TIME
        : 0;

    this.state.runStats.enemiesDefeated += 1;

    const def = getEnemyDefinition(enemy.typeId);
    const p = this.state.player;
    p.gold += def.goldReward;

    this.state.events.push({
      type: 'enemy_died',
      x: enemy.x,
      z: enemy.z,
      enemyId: enemy.id,
      enemyTypeId: enemy.typeId,
      value: def.xpReward,
      text: `+${def.xpReward} XP  +${def.goldReward} Or`,
    });

    grantXp(p, def.xpReward, this.state.events);

    let shouldSave = false;

    if (enemy.isBoss) {
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
      this.startDialogue(VICTORY_DIALOGUE, 'trigger_victory');
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
      if (d <= item.radius && d < bestDist) {
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
    // Active spell effects
    for (let i = this.state.activeSpellEffects.length - 1; i >= 0; i--) {
      const fx = this.state.activeSpellEffects[i];
      fx.elapsed += dt;
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
}
