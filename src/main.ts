import './style.css';
import * as THREE from 'three';
import { TextureRegistry } from './art/textureRegistry';
import {
  AudioEngine,
  type WeatherAudioState,
  type WeatherAudioStatus,
} from './audio/audioEngine';
import { DUNGEONS } from './data/dungeonsData';
import { ALL_NEW_ISLANDS, NEW_ISLANDS } from './data/worldIslands';
import { GameEngine } from './game/gameEngine';
import { InputManager } from './game/input';
import { addEquipment } from './game/progression';
import { sampleShorelineField } from './game/shorelineNavigation';
import type {
  ActiveModal,
  EquipSlot,
  GameEvent,
  IslandId,
  MusicTrackId,
  OwnedEquipment,
  QuestId,
  QuestProgress,
  ShipMode,
  SpeakerPortraitId,
  WildlifeDensity,
  ZoneId,
} from './game/types';
import { EffectsRenderer } from './render/effectsRenderer';
import { EntityRenderer } from './render/entityRenderer';
import { FloatingTextManager } from './render/floatingText';
import {
  SPRITE_LIGHT_COUNT,
  getSpriteLightSlotSnapshot,
} from './render/spriteLighting';
import { SceneManager } from './render/sceneManager';
import {
  type OceanCoastIsland,
  sampleOceanCoastDistance,
} from './render/shaders/waterShader';
import { ShipRenderer } from './render/shipRenderer';
import {
  type DayPhase,
  type WeatherCondition,
  WeatherCycleController,
  type WeatherQaOverride,
  WeatherVfxRenderer,
} from './render/weatherSystem';
import {
  type TorchLightPosition,
  WorldRenderer,
} from './render/worldRenderer';
import { WildlifeSystem } from './render/wildlifeSystem';
import { HudController } from './ui/hudController';
import { MinimapController } from './ui/minimapController';
import { ModalsController } from './ui/modalsController';
import { ScreensController } from './ui/screensController';

// ============================================================================
// Point d'entrée principal — Les Chroniques de Félingard
// Assemble Simulation, Art/Rendu 2.5D PBR Three.js, Audio procédural et UI Parchemin
// ============================================================================

const MAX_DELTA_SEC = 0.05;
const FORGE_HEARTH_POS = { x: 8.15, z: 21.1 } as const;

const STATIC_PORTRAIT_IDS: readonly SpeakerPortraitId[] = [
  'miaou_sprit',
  'mayor_moustache',
  'kit_chat',
  'innkeeper',
  'boss_rat_king',
  'boss_dragon_claw',
];

export interface CatQuestQaHook {
  readonly version: string;
  readonly getSnapshot: () => Readonly<{
    screen: string;
    activeModal: string;
    zoneId: string;
    islandId: IslandId;
    inVillage: boolean;
    time: number;
    timeScale: number;
    lowHpActive: boolean;
    lowHpIntensity: number;
    playerProjectilesCount: number;
    enemyProjectilesCount: number;
    hazardZonesCount: number;
    lootDropsCount: number;
    cinematic: {
      kind: string;
      bossTypeId: string;
      stage: string;
      elapsed: number;
    } | null;
    wildlifeDensity: WildlifeDensity;
    player: {
      x: number;
      z: number;
      elevationY: number;
      onShipDeck: boolean;
      hp: number;
      maxHp: number;
      shieldHp: number;
      mp: number;
      maxMp: number;
      level: number;
      xp: number;
      xpToNext: number;
      gold: number;
      hasRunicKey: boolean;
      perfectDodgeBuffTimer: number;
      activeStatuses: ReadonlyArray<{ id: string; remainingSec: number }>;
      equipped: Record<EquipSlot, string>;
      stats: { atk: number; mag: number; def: number; critChance: number };
      spellLevels: Record<string, number>;
    };
    companion: {
      x: number;
      z: number;
      y: number;
      onShipDeck: boolean;
    };
    ship: {
      mode: ShipMode;
      isSailing: boolean;
      x: number;
      z: number;
      angle: number;
      speed: number;
      angularVelocity: number;
      rudder: number;
      dockedIslandId: IslandId | null;
      isCollidingShore: boolean;
      nearestCoastIslandId: IslandId | null;
      canDisembark: boolean;
      disembarkReason: string | null;
    };
    activeBoss: {
      id: string;
      typeId: string;
      name: string;
      hp: number;
      maxHp: number;
      phase: 1 | 2;
      stagger: number;
      maxStagger: number;
      staggeredTimer: number;
    } | null;
    enemiesAlive: number;
    enemiesTotal: number;
    telegraphCount: number;
    chestsOpened: number;
    chestsTotal: number;
    trackedQuestId: QuestId | null;
    questTarget: {
      questId: QuestId;
      label: string;
      zoneId: string;
      x: number;
      z: number;
      isPortalRedirect: boolean;
    } | null;
    nearestInteractable: {
      id: string;
      type: string;
      label: string;
    } | null;
    dialogue: {
      active: boolean;
      currentIndex: number;
      lineCount: number;
    };
    weather: {
      condition: WeatherCondition;
      targetCondition: WeatherCondition;
      transitionProgress: number;
      dayPhase: DayPhase;
      timeOfDay: number;
      fogIntensity: number;
      stormIntensity: number;
      rainIntensity: number;
      windIntensity: number;
      waveAmplitude: number;
      lightningFlash: number;
    };
    runStats: {
      playTimeSec: number;
      enemiesDefeated: number;
      chestsOpened: number;
    };
  }>;
  readonly getQuests: () => Readonly<Record<QuestId, Readonly<QuestProgress>>>;
  readonly getInventory: () => Readonly<Record<string, Readonly<OwnedEquipment>>>;
  readonly getMetrics: () => Readonly<{
    fps: number;
    frameCount: number;
    textureCount: number;
    hdAssetsLoaded: boolean;
    zoneId: string;
    musicTrack: MusicTrackId | null;
    audioMuted: boolean;
    audioVolume: number;
    audioUnlocked: boolean;
    weatherAudio: WeatherAudioStatus;
    hasSave: boolean;
    geometries: number;
    gpuTextures: number;
    drawCalls: number;
    triangles: number;
    minimapVisible: boolean;
    cape: Readonly<ReturnType<EntityRenderer['getCapeDiagnostics']>>;
    wildlife: Readonly<ReturnType<WildlifeSystem['getDiagnostics']>>;
  }>;
  readonly setWeatherForTest?: (override: WeatherQaOverride) => void;
  readonly advanceWeatherForTest?: (seconds: number) => void;
  readonly setAudioVolumeForTest?: (volume: number) => void;
  readonly setWildlifeDensityForTest?: (density: WildlifeDensity) => void;
  readonly equipItemsForTest?: (itemIds: readonly string[]) => void;
  readonly enterZoneForTest?: (zoneId: ZoneId, x?: number, z?: number) => void;
  readonly setHeroPoseForTest?: (opts: {
    facingX?: 1 | -1;
    attackAnimTimer?: number;
    dodgeTimer?: number;
    vx?: number;
    vz?: number;
  }) => void;
  readonly getLightingDiagnostics?: () => Readonly<{
    activeSpriteLightCount: number;
    slots: readonly {
      index: number;
      x: number;
      y: number;
      z: number;
      intensity: number;
      distance: number;
    }[];
  }>;
}

declare global {
  interface Window {
    __CAT_QUEST__?: CatQuestQaHook;
  }
}

function getRequiredContainer(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`[Félingard] Conteneur DOM introuvable : #${id}`);
  }
  return el;
}

function blurFocusedButton(): void {
  const active = document.activeElement;
  if (active instanceof HTMLButtonElement) {
    active.blur();
  }
}

function getEquippedSignature(
  equipped: Record<EquipSlot, string>,
  hdLoaded: boolean,
): string {
  return `${hdLoaded ? 'hd' : 'proc'}|${equipped.weapon}|${equipped.shield}|${equipped.helmet}|${equipped.armor}|${equipped.cape}`;
}

function bootstrap(): void {
  const canvasContainer = getRequiredContainer('game-canvas-container');
  const floatingTextLayer = getRequiredContainer('floating-text-layer');
  const hudLayer = getRequiredContainer('hud-layer');
  const modalLayer = getRequiredContainer('modal-layer');
  const screenLayer = getRequiredContainer('screen-layer');

  // --- 1. Sous-systèmes centraux ---
  const textures = new TextureRegistry();
  const sceneManager = new SceneManager(canvasContainer);
  textures.setMaxAnisotropy(sceneManager.getMaxAnisotropy());

  const worldRenderer = new WorldRenderer(
    sceneManager.scene,
    textures,
    (positions: readonly TorchLightPosition[]) => {
      sceneManager.setDynamicTorchLights(positions);
    },
  );
  const shipRenderer = new ShipRenderer(sceneManager.scene);
  const entityRenderer = new EntityRenderer(sceneManager.scene, textures);
  const effectsRenderer = new EffectsRenderer(sceneManager.scene, textures);
  const weatherController = new WeatherCycleController();
  const weatherVfx = new WeatherVfxRenderer(sceneManager.scene);
  const wildlifeSystem = new WildlifeSystem(sceneManager.scene);
  const floatingTextManager = new FloatingTextManager(floatingTextLayer);

  const audioEngine = new AudioEngine();
  const inputManager = new InputManager();
  const engine = new GameEngine();

  const archipelagoCoasts: readonly OceanCoastIsland[] = [
    { x: 0, z: 0, radius: 52.5, isMain: true },
    ...ALL_NEW_ISLANDS.map((id) => ({
      x: NEW_ISLANDS[id].centerX,
      z: NEW_ISLANDS[id].centerZ,
      radius: NEW_ISLANDS[id].radius,
      isMain: false,
    })),
  ];
  const cameraFocusScratch = new THREE.Vector3();
  const weatherAudioState: WeatherAudioState = {
    inOverworld: true,
    stormIntensity: 0,
    fogIntensity: 0,
    rainIntensity: 0,
    windIntensity: 0.2,
    seaAgitation: 0.3,
    seaProximity: 0.7,
    shipSpeedRatio: 0,
    nightFactor: 0,
    isSailing: false,
    inCombat: false,
  };

  const syncAtmosphereAndAudio = (dtForAudio: number): void => {
    const isOverworld = engine.state.zoneId === 'overworld';
    const w = weatherController.getSnapshot();
    sceneManager.applyOverworldAtmosphere(w, isOverworld);

    let seaProximity = 0;
    const isSailing = isOverworld && engine.state.ship.mode !== 'parked';
    if (isOverworld) {
      if (isSailing) {
        seaProximity = 1.0;
      } else {
        const dCoast = sampleOceanCoastDistance(
          engine.state.player.x,
          engine.state.player.z,
          archipelagoCoasts,
          0.6,
        );
        const inlandDepth = Math.max(0, -dCoast);
        const t = Math.min(1, inlandDepth / 40);
        seaProximity = 1.0 - t * 0.66;
      }
    }

    // Facteur nocturne [0..1] aligné sur le cycle jour/nuit (0 = plein jour, 1 = nuit noire)
    const tod = w.timeOfDay;
    let nightFactor = 0;
    if (tod < 0.18 || tod > 0.86) {
      nightFactor = 1;
    } else if (tod < 0.3) {
      nightFactor = Math.max(0, Math.min(1, (0.3 - tod) / 0.12));
    } else if (tod > 0.74) {
      nightFactor = Math.max(0, Math.min(1, (tod - 0.74) / 0.12));
    }

    weatherAudioState.inOverworld = isOverworld;
    weatherAudioState.stormIntensity = w.stormIntensity;
    weatherAudioState.fogIntensity = w.fogIntensity;
    weatherAudioState.rainIntensity = w.rainIntensity;
    weatherAudioState.windIntensity = w.windIntensity;
    weatherAudioState.seaAgitation = Math.min(1, Math.max(0.22, (w.waveAmplitude - 0.7) / 1.45));
    weatherAudioState.seaProximity = seaProximity;
    weatherAudioState.shipSpeedRatio =
      isOverworld && engine.state.ship.isSailing
        ? Math.min(1, Math.abs(engine.state.ship.speed) / 13.5)
        : 0;
    weatherAudioState.nightFactor = nightFactor;
    weatherAudioState.isSailing = isSailing;
    weatherAudioState.inCombat =
      Boolean(engine.state.inCombat) ||
      (engine.state.combatMusicTimer ?? 0) > 0 ||
      engine.getActiveBoss() !== null;

    audioEngine.updateWeatherAmbience(weatherAudioState, dtForAudio);

    const dungeonDef =
      engine.state.zoneId !== 'overworld' ? DUNGEONS[engine.state.zoneId] : null;
    const shoreSample = isOverworld
      ? sampleShorelineField(engine.state.player.x, engine.state.player.z)
      : null;
    audioEngine.updateSpatialAmbience({
      zoneId: engine.state.zoneId,
      islandId: engine.state.islandId,
      listenerX: engine.state.player.x,
      listenerZ: engine.state.player.z,
      torches: dungeonDef?.torches,
      activeCrystals: engine.state.healingCrystals.filter((c) => !c.used),
      forgeHearth: FORGE_HEARTH_POS,
      shorePoint: shoreSample
        ? {
            x: shoreSample.shoreX,
            z: shoreSample.shoreZ,
            signedDistance: shoreSample.signedDistance,
          }
        : null,
      seaProximity,
      nightFactor,
      stormIntensity: w.stormIntensity,
      rainIntensity: w.rainIntensity,
      inCombat: weatherAudioState.inCombat,
      isSailing,
    });

    const pendingThunder = weatherController.consumePendingThunder();
    if (pendingThunder > 0 && isOverworld) {
      audioEngine.triggerThunder(pendingThunder);
    }
  };

  // Cache local des aperçus corps entier du héros pour l'Inventaire
  const heroFullPreviewCache = new Map<string, string>();
  let lastEquippedKey = '';
  let disposed = false;

  const getHeroFullPreviewUrl = (equipped: Record<EquipSlot, string>): string => {
    const key = getEquippedSignature(equipped, textures.isHdLoaded);
    const cached = heroFullPreviewCache.get(key);
    if (cached) return cached;
    const url = textures.getHeroFullPreviewUrl(equipped);
    heroFullPreviewCache.set(key, url);
    return url;
  };

  let lastSfxModal: ActiveModal = engine.state.activeModal;
  const syncModalTransitionSfx = (nextModal: ActiveModal): void => {
    if (nextModal === lastSfxModal) return;
    if (lastSfxModal !== 'none') {
      audioEngine.playUiScreenSfx(lastSfxModal, 'close');
    }
    if (nextModal !== 'none') {
      audioEngine.playUiScreenSfx(nextModal, 'open');
    }
    lastSfxModal = nextModal;
  };

  // --- 2. Contrôleurs UI Parchemin ---
  const hudController = new HudController(hudLayer, {
    onCastSpell: (spellId) => {
      audioEngine.unlock();
      engine.castSpellById(spellId);
      blurFocusedButton();
    },
    onInteract: () => {
      audioEngine.unlock();
      if (
        engine.state.screen === 'playing' &&
        engine.state.activeModal === 'none' &&
        !engine.state.dialogue.active
      ) {
        engine.triggerInteraction();
      }
      blurFocusedButton();
    },
    onToggleInventory: () => {
      audioEngine.unlock();
      if (engine.state.screen === 'playing' && !engine.state.dialogue.active) {
        engine.toggleModal('inventory');
        syncModalTransitionSfx(engine.state.activeModal);
      }
      blurFocusedButton();
    },
    onToggleMap: () => {
      audioEngine.unlock();
      if (engine.state.screen === 'playing' && !engine.state.dialogue.active) {
        engine.toggleModal('map');
        syncModalTransitionSfx(engine.state.activeModal);
      }
      blurFocusedButton();
    },
    onToggleMute: () => {
      const muted = audioEngine.toggleMute();
      hudController.setMuted(muted);
      blurFocusedButton();
    },
    onTogglePause: () => {
      audioEngine.unlock();
      if (engine.state.dialogue.active) {
        blurFocusedButton();
        return;
      }
      if (engine.state.screen === 'paused' || engine.state.activeModal === 'pause') {
        engine.resumeGame();
        syncModalTransitionSfx(engine.state.activeModal);
        inputManager.reset();
      } else if (engine.state.screen === 'playing') {
        engine.openModal('pause');
        syncModalTransitionSfx(engine.state.activeModal);
      }
      blurFocusedButton();
    },
    onOpenQuests: () => {
      audioEngine.unlock();
      if (engine.state.screen === 'playing' && !engine.state.dialogue.active) {
        engine.toggleModal('quests');
        syncModalTransitionSfx(engine.state.activeModal);
      }
      blurFocusedButton();
    },
  });

  const minimapController = new MinimapController(hudLayer, {
    onOpenWorldMap: () => {
      audioEngine.unlock();
      if (engine.state.screen === 'playing' && !engine.state.dialogue.active) {
        engine.toggleModal('map');
        syncModalTransitionSfx(engine.state.activeModal);
      }
      blurFocusedButton();
    },
  });

  const modalsController = new ModalsController(modalLayer, {
    onClose: () => {
      audioEngine.unlock();
      engine.closeModal();
      syncModalTransitionSfx(engine.state.activeModal);
      inputManager.reset();
      blurFocusedButton();
    },
    onEquipItem: (itemId) => {
      audioEngine.unlock();
      const equippedOk = engine.equipItem(itemId);
      if (equippedOk) {
        audioEngine.playVariant('ui_interact');
        syncHeroVisuals(true);
        screensController.setHasSave(engine.hasSavedGame());
      }
      blurFocusedButton();
    },
    onAcceptQuest: (questId) => {
      audioEngine.unlock();
      if (engine.acceptQuest(questId)) {
        screensController.setHasSave(engine.hasSavedGame());
      }
      blurFocusedButton();
    },
    onTrackQuest: (questId) => {
      audioEngine.unlock();
      if (engine.trackQuest(questId)) {
        audioEngine.playVariant('ui_interact');
      }
      blurFocusedButton();
    },
    onBuyMysteryChest: () => {
      audioEngine.unlock();
      const result = engine.buyMysteryChest();
      if (result) {
        if (!result.isUpgrade) {
          audioEngine.playVariant('loot_chest_open', { fadeOutTailSec: 0.22 });
          audioEngine.duckMusic(0.5, 0.45, 0.65);
        }
        screensController.setHasSave(engine.hasSavedGame());
      }
      blurFocusedButton();
      return result;
    },
    onUpgradeSpell: (spellId) => {
      audioEngine.unlock();
      const result = engine.upgradeSpell(spellId);
      if (result.success) {
        audioEngine.playVariant('ui_forge_upgrade');
        screensController.setHasSave(engine.hasSavedGame());
      }
      blurFocusedButton();
      return result.success;
    },
    onUpgradeEquipment: (itemId) => {
      audioEngine.unlock();
      const result = engine.upgradeEquipment(itemId);
      if (result.success) {
        syncHeroVisuals(true);
        screensController.setHasSave(engine.hasSavedGame());
      }
      blurFocusedButton();
      return result.success;
    },
    onBuyEquipment: (itemId) => {
      audioEngine.unlock();
      const result = engine.buyEquipment(itemId);
      if (result.success) {
        syncHeroVisuals(true);
        screensController.setHasSave(engine.hasSavedGame());
      }
      blurFocusedButton();
      return result.success;
    },
  });

  const screensController = new ScreensController(screenLayer, {
    onNewGame: () => {
      audioEngine.unlock();
      audioEngine.playSfx('meow_ui');
      clearTransientRenderers();
      engine.startNewGame();
      lastSfxModal = engine.state.activeModal;
      inputManager.reset();
      syncHeroVisuals(true);
      blurFocusedButton();
    },
    onContinueGame: () => {
      audioEngine.unlock();
      if (engine.continueSavedGame()) {
        audioEngine.playSfx('meow_ui');
        clearTransientRenderers();
        lastSfxModal = engine.state.activeModal;
        inputManager.reset();
        syncHeroVisuals(true);
      }
      blurFocusedButton();
    },
    onAdvanceDialogue: () => {
      audioEngine.unlock();
      audioEngine.playSfx('meow_ui');
      engine.advanceDialogue();
      if (!engine.state.dialogue.active) {
        inputManager.reset();
      }
      blurFocusedButton();
    },
    onResumeGame: () => {
      audioEngine.unlock();
      engine.resumeGame();
      syncModalTransitionSfx(engine.state.activeModal);
      inputManager.reset();
      blurFocusedButton();
    },
    onReturnToTitle: () => {
      audioEngine.unlock();
      audioEngine.playSfx('meow_ui');
      clearTransientRenderers();
      engine.returnToTitle();
      lastSfxModal = engine.state.activeModal;
      sceneManager.setZoneLighting(engine.state.zoneId);
      worldRenderer.loadZone(engine.state.zoneId, engine.state);
      screensController.setHasSave(engine.hasSavedGame());
      inputManager.reset();
      blurFocusedButton();
    },
    onRespawnAtInn: () => {
      audioEngine.unlock();
      audioEngine.playSfx('meow_ui');
      clearTransientRenderers();
      engine.respawnAtInn();
      lastSfxModal = engine.state.activeModal;
      screensController.setHasSave(engine.hasSavedGame());
      inputManager.reset();
      blurFocusedButton();
    },
    onContinueAfterVictory: () => {
      audioEngine.unlock();
      audioEngine.playSfx('meow_ui');
      engine.continueAfterVictory();
      inputManager.reset();
      blurFocusedButton();
    },
    onSetWeather: (condition) => {
      audioEngine.unlock();
      weatherController.setManualWeather(condition === 'auto' ? null : condition);
      syncAtmosphereAndAudio(0.016);
      audioEngine.playSfx('meow_ui');
    },
  });

  function clearTransientRenderers(): void {
    effectsRenderer.clear();
    floatingTextManager.clear();
    entityRenderer.clear();
    shipRenderer.resetWake();
  }

  function syncStaticSpeakerPortraits(): void {
    const staticPortraits: Partial<Record<SpeakerPortraitId, string>> = {};
    for (const id of STATIC_PORTRAIT_IDS) {
      staticPortraits[id] = textures.getSpeakerPortraitUrl(
        id,
        engine.state.player.equipped,
      );
    }
    screensController.setPortraits(staticPortraits);
  }

  function syncHeroVisuals(force = false): void {
    const equipped = engine.state.player.equipped;
    const key = getEquippedSignature(equipped, textures.isHdLoaded);
    if (!force && key === lastEquippedKey) return;
    lastEquippedKey = key;

    const bustPortraitUrl = textures.getHeroPortraitUrl(equipped);
    const fullPreviewUrl = getHeroFullPreviewUrl(equipped);
    hudController.setHeroPortrait(bustPortraitUrl);
    modalsController.setHeroPortrait(fullPreviewUrl);
    screensController.setPortrait('hero', bustPortraitUrl);
  }

  // --- 3. Initialisation de la scène 2.5D, des portraits, de la carte et des entrées ---
  sceneManager.setZoneLighting(engine.state.zoneId);
  worldRenderer.loadZone(engine.state.zoneId, engine.state);

  syncStaticSpeakerPortraits();
  syncHeroVisuals(true);

  modalsController.setMapImage(textures.getMiniMapUrl());
  minimapController.refreshTerrain(textures.getHdTerrainBundle());
  screensController.setHasSave(engine.hasSavedGame());
  hudController.setMuted(audioEngine.isMuted());

  // Chargement asynchrone des assets HD (Personnages, Props Diorama & Textures PBR)
  // avec mise à jour à chaud transparente dès la résolution !
  void textures.loadAllHdAssets().then(() => {
    if (disposed) return;
    heroFullPreviewCache.clear();
    worldRenderer.refreshTextures(engine.state);
    entityRenderer.refreshTextures(engine.state);
    effectsRenderer.refreshTextures();
    sceneManager.setHeatDistortion(0, textures.getVfxTexture('heat_distortion_normal'));
    syncStaticSpeakerPortraits();
    syncHeroVisuals(true);
    modalsController.setMapImage(textures.getMiniMapUrl());
    minimapController.refreshTerrain(textures.getHdTerrainBundle());
    textures.flushRetiredTextures();
  });

  inputManager.attach(sceneManager.domElement);
  inputManager.setAimWorldResolver((ndcX, ndcY) =>
    sceneManager.ndcToWorld(ndcX, ndcY),
  );

  // Thème musical du menu prêt dès la première interaction utilisateur
  let lastMusicTrack: MusicTrackId | null = 'menu';
  audioEngine.setMusicTheme('menu');

  // --- 4. Traitement des événements de simulation ---
  const processEventBatch = (events: GameEvent[]): void => {
    if (events.length === 0) return;

    let zoneChanged = false;
    let saveMayHaveChanged = false;

    for (const ev of events) {
      if (ev.type === 'zone_transition') {
        zoneChanged = true;
      }
      if (
        ev.type === 'chest_opened' ||
        ev.type === 'quest_completed' ||
        ev.type === 'quest_updated' ||
        ev.type === 'player_rested' ||
        ev.type === 'ship_disembarked' ||
        ev.type === 'victory'
      ) {
        saveMayHaveChanged = true;
      }
    }

    if (zoneChanged) {
      clearTransientRenderers();
      sceneManager.setZoneLighting(engine.state.zoneId);
      worldRenderer.loadZone(engine.state.zoneId, engine.state);
      const initialZoom =
        engine.state.dialogue.active || engine.state.inVillage ? 0.85 : 1.0;
      sceneManager.snapCameraTo(
        engine.state.player.x,
        engine.state.player.z,
        initialZoom,
      );
    }

    audioEngine.handleEvents(events);
    worldRenderer.processEvents(events);
    effectsRenderer.processEvents(events, engine.state);
    floatingTextManager.processEvents(events, engine.state);
    hudController.handleEvents(events);
    screensController.handleEvents(events);

    if (saveMayHaveChanged) {
      screensController.setHasSave(engine.hasSavedGame());
    }
  };

  const syncMusicTrack = (): void => {
    let desired: MusicTrackId | null;
    if (engine.state.screen === 'defeat') {
      desired = null;
    } else if (engine.state.screen === 'title') {
      desired = 'menu';
    } else {
      desired = engine.getCurrentMusicTrack();
    }

    if (desired !== lastMusicTrack) {
      lastMusicTrack = desired;
      audioEngine.setMusicTheme(desired, 1.35);
    }
  };

  const projectWorldToScreen = (x: number, y: number, z: number) =>
    sceneManager.worldToScreen(x, y, z);

  // --- 5. Premier rendu immédiat (scène 2.5D en orbite douce derrière l'Écran Titre) ---
  sceneManager.updateCamera(engine.state, 0.016);
  syncAtmosphereAndAudio(0.016);
  {
    const w = weatherController.getSnapshot();
    const isOverworld = engine.state.zoneId === 'overworld';
    const fogNear = sceneManager.getFogNear();
    const fogFar = sceneManager.getFogFar();
    worldRenderer.update(engine.state, 0, w, fogNear, fogFar);
    shipRenderer.update(engine.state, 0, w, fogNear, fogFar);
    sceneManager.getCameraFocusPosition(cameraFocusScratch);
    weatherVfx.update(
      0,
      w,
      cameraFocusScratch.x,
      cameraFocusScratch.z,
      engine.state.ship.position.x,
      engine.state.ship.position.z,
      isOverworld,
    );
    wildlifeSystem.update(engine.state, 0, w);
  }
  entityRenderer.update(
    engine.state,
    0,
    engine.state.zoneId === 'overworld' ? shipRenderer.getDeckAnchors() : null,
    weatherController.getSnapshot(),
  );
  effectsRenderer.update(engine.state, 0);
  sceneManager.render(0.016);
  hudController.update(engine.state);
  minimapController.update(engine.state, 0.016);
  modalsController.update(engine.state);
  screensController.update(engine.state);

  // --- 6. Boucle principale requestAnimationFrame ---
  let rafId: number | null = null;
  let lastFrameTime = performance.now();
  let frameCount = 0;
  let smoothedFps = 60;

  const tick = (now: number): void => {
    if (disposed) return;

    const rawDt = Math.max(0, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    const dt = Math.min(rawDt, MAX_DELTA_SEC);

    if (rawDt > 0.0005 && rawDt < 0.5) {
      const instantFps = 1 / rawDt;
      smoothedFps = smoothedFps * 0.9 + instantFps * 0.1;
    }
    frameCount += 1;

    const prevDialogueActive = engine.state.dialogue.active;
    const prevDialogueIdx = engine.state.dialogue.currentIndex;
    const prevModal = engine.state.activeModal;

    const inputState = inputManager.poll();
    engine.step(dt, inputState);

    // Feedback audio & nettoyage d'entrées lors des transitions dialogue / modales au clavier
    if (prevDialogueActive) {
      if (!engine.state.dialogue.active) {
        if (engine.state.activeModal === 'none') {
          audioEngine.playUiScreenSfx('pause', 'close');
        }
        inputManager.reset();
      } else if (engine.state.dialogue.currentIndex !== prevDialogueIdx) {
        audioEngine.playVariant('ui_interact');
      }
    }
    if (prevModal !== engine.state.activeModal) {
      syncModalTransitionSfx(engine.state.activeModal);
      if (engine.state.activeModal === 'none') {
        inputManager.reset();
      }
    }

    const events = engine.consumeEvents();
    processEventBatch(events);

    syncHeroVisuals(false);
    syncMusicTrack();

    const isSimFrozen =
      engine.state.screen === 'paused' ||
      engine.state.activeModal !== 'none' ||
      engine.state.hitstopTimer > 0;
    const animDt = isSimFrozen ? 0 : dt * (engine.state.timeScale ?? 1);

    // Caméra & screen shake toujours fluides (y compris hitstop et orbite Écran Titre)
    // La météo est visuelle et sonore: elle continue ses transitions même si le
    // gameplay est en pause, notamment pour que le sélecteur pause soit réactif.
    const weatherSnap = weatherController.update(dt);
    const isOverworld = engine.state.zoneId === 'overworld';
    sceneManager.updateCamera(engine.state, dt);
    syncAtmosphereAndAudio(dt);
    const fogNear = sceneManager.getFogNear();
    const fogFar = sceneManager.getFogFar();
    worldRenderer.update(engine.state, animDt, weatherSnap, fogNear, fogFar);
    shipRenderer.update(engine.state, animDt, weatherSnap, fogNear, fogFar);
    sceneManager.getCameraFocusPosition(cameraFocusScratch);
    weatherVfx.update(
      animDt,
      weatherSnap,
      cameraFocusScratch.x,
      cameraFocusScratch.z,
      engine.state.ship.position.x,
      engine.state.ship.position.z,
      isOverworld,
    );
    wildlifeSystem.update(engine.state, animDt, weatherSnap);
    entityRenderer.update(
      engine.state,
      animDt,
      isOverworld ? shipRenderer.getDeckAnchors() : null,
      weatherSnap,
    );
    effectsRenderer.update(engine.state, animDt);
    floatingTextManager.update(animDt, projectWorldToScreen);

    if (engine.state.zoneId === 'dungeon_dragon_lair') {
      const cin = engine.state.cinematic;
      const boss = engine.getActiveBoss();
      const dragonDefeated = engine.state.defeatedBossIds.includes('boss_dragon_claw');
      const cleared =
        cin?.kind === 'boss_death' && cin.bossTypeId === 'boss_dragon_claw'
          ? (cin.lairBrighten ?? 0)
          : dragonDefeated && !boss
            ? 1
            : 0;
      const heat = Math.max(
        cin?.heatDistortion ?? 0,
        boss?.typeId === 'boss_dragon_claw' && boss.phase === 2 ? 0.55 : 0,
        (boss?.activeSweepDuration ?? 0) > 0 ? 0.45 : 0,
      );
      worldRenderer.setDragonLairAtmosphere(heat, cleared);
      sceneManager.setHeatDistortion(heat, textures.getVfxTexture('heat_distortion_normal'));
    } else {
      sceneManager.setHeatDistortion(0);
    }

    sceneManager.render(dt);

    hudController.update(engine.state);
    minimapController.update(engine.state, dt);
    modalsController.update(engine.state);
    screensController.update(engine.state);

    rafId = window.requestAnimationFrame(tick);
  };

  rafId = window.requestAnimationFrame(tick);

  // --- 7. Hook lecture seule QA / Debug : window.__CAT_QUEST__ ---
  const qaHook: CatQuestQaHook = Object.freeze({
    version: '1.0.0',
    getSnapshot: () => {
      const s = engine.state;
      const p = s.player;
      const boss = engine.getActiveBoss();
      const enemiesAlive = s.enemies.reduce(
        (acc, e) => acc + (e.state !== 'dead' && e.hp > 0 ? 1 : 0),
        0,
      );
      return Object.freeze({
        screen: s.screen,
        activeModal: s.activeModal,
        zoneId: s.zoneId,
        islandId: s.islandId,
        inVillage: s.inVillage,
        time: Math.round(s.time * 100) / 100,
        timeScale: Math.round((s.timeScale ?? 1) * 100) / 100,
        lowHpActive: Boolean(s.lowHpActive),
        lowHpIntensity: Math.round((s.lowHpIntensity ?? 0) * 100) / 100,
        playerProjectilesCount: s.playerProjectiles.length,
        enemyProjectilesCount: s.enemyProjectiles.length,
        hazardZonesCount: s.hazardZones.length,
        lootDropsCount: s.lootDrops.length,
        cinematic: s.cinematic
          ? Object.freeze({
              kind: s.cinematic.kind,
              bossTypeId: s.cinematic.bossTypeId,
              stage: s.cinematic.stage,
              elapsed: Math.round(s.cinematic.elapsed * 100) / 100,
            })
          : null,
        wildlifeDensity: s.options.wildlifeDensity,
        player: Object.freeze({
          x: Math.round(p.x * 100) / 100,
          z: Math.round(p.z * 100) / 100,
          elevationY: Math.round((p.elevationY ?? 0) * 100) / 100,
          onShipDeck: Boolean(p.onShipDeck),
          hp: Math.round(p.hp),
          maxHp: Math.round(p.maxHp),
          shieldHp: (p.shieldTimer ?? 0) > 0 ? Math.round(p.shieldHp ?? 0) : 0,
          mp: Math.round(p.mp),
          maxMp: Math.round(p.maxMp),
          level: p.level,
          xp: p.xp,
          xpToNext: p.xpToNext,
          gold: p.gold,
          hasRunicKey: p.hasRunicKey,
          perfectDodgeBuffTimer: Math.round((p.perfectDodgeBuffTimer ?? 0) * 100) / 100,
          activeStatuses: Object.freeze(
            (p.activeStatuses ?? []).map((st) =>
              Object.freeze({
                id: st.id,
                remainingSec: Math.round(st.remainingSec * 100) / 100,
              }),
            ),
          ),
          equipped: Object.freeze({ ...p.equipped }),
          stats: Object.freeze({ ...p.stats }),
          spellLevels: Object.freeze({ ...p.spellLevels }),
        }),
        companion: Object.freeze({
          x: Math.round(s.companion.x * 100) / 100,
          z: Math.round(s.companion.z * 100) / 100,
          y: Math.round((s.companion.y ?? 0) * 100) / 100,
          onShipDeck: Boolean(s.companion.onShipDeck),
        }),
        ship: Object.freeze({
          mode: s.ship.mode,
          isSailing: s.ship.isSailing,
          x: Math.round(s.ship.position.x * 100) / 100,
          z: Math.round(s.ship.position.z * 100) / 100,
          angle: Math.round(s.ship.angle * 1000) / 1000,
          speed: Math.round(s.ship.speed * 100) / 100,
          angularVelocity: Math.round(s.ship.angularVelocity * 100) / 100,
          rudder: Math.round(s.ship.rudder * 100) / 100,
          dockedIslandId: s.ship.dockedIslandId,
          isCollidingShore: s.ship.isCollidingShore,
          nearestCoastIslandId: s.ship.nearestCoastIslandId,
          canDisembark: s.ship.disembarkStatus.canDisembark,
          disembarkReason: s.ship.disembarkStatus.reason ?? null,
        }),
        activeBoss: boss
          ? Object.freeze({
              id: boss.id,
              typeId: boss.typeId,
              name: boss.name,
              hp: Math.round(boss.hp),
              maxHp: Math.round(boss.maxHp),
              phase: boss.phase,
              stagger: Math.round((boss.stagger ?? 0) * 10) / 10,
              maxStagger: boss.maxStagger ?? 0,
              staggeredTimer: Math.round((boss.staggeredTimer ?? 0) * 100) / 100,
            })
          : null,
        enemiesAlive,
        enemiesTotal: s.enemies.length,
        telegraphCount: s.telegraphs.length,
        chestsOpened: s.openedChestIds.length,
        chestsTotal: s.chests.length,
        trackedQuestId: s.trackedQuestId,
        questTarget: s.questTarget ? Object.freeze({ ...s.questTarget }) : null,
        nearestInteractable: s.nearestInteractable
          ? Object.freeze({
              id: s.nearestInteractable.id,
              type: s.nearestInteractable.type,
              label: s.nearestInteractable.label,
            })
          : null,
        dialogue: Object.freeze({
          active: s.dialogue.active,
          currentIndex: s.dialogue.currentIndex,
          lineCount: s.dialogue.lines.length,
        }),
        weather: (() => {
          const w = weatherController.getSnapshot();
          return Object.freeze({
            condition: w.currentCondition,
            targetCondition: w.targetCondition,
            transitionProgress: Math.round(w.transitionProgress * 1000) / 1000,
            dayPhase: w.dayPhase,
            timeOfDay: Math.round(w.timeOfDay * 10000) / 10000,
            fogIntensity: Math.round(w.fogIntensity * 1000) / 1000,
            stormIntensity: Math.round(w.stormIntensity * 1000) / 1000,
            rainIntensity: Math.round(w.rainIntensity * 1000) / 1000,
            windIntensity: Math.round(w.windIntensity * 1000) / 1000,
            waveAmplitude: Math.round(w.waveAmplitude * 1000) / 1000,
            lightningFlash: Math.round(w.lightningFlash * 1000) / 1000,
          });
        })(),
        runStats: Object.freeze({ ...s.runStats }),
      });
    },
    getQuests: () =>
      Object.freeze({
        main_dragon_blood: Object.freeze({ ...engine.state.quests.main_dragon_blood }),
        side_yarn_hunt: Object.freeze({ ...engine.state.quests.side_yarn_hunt }),
        side_lost_blade: Object.freeze({ ...engine.state.quests.side_lost_blade }),
      }),
    getInventory: () => {
      const copy: Record<string, Readonly<OwnedEquipment>> = {};
      for (const [id, owned] of Object.entries(engine.state.player.inventory)) {
        copy[id] = Object.freeze({ ...owned });
      }
      return Object.freeze(copy);
    },
    getMetrics: () =>
      Object.freeze({
        fps: Math.round(smoothedFps),
        frameCount,
        textureCount: textures.size,
        hdAssetsLoaded: textures.isHdLoaded,
        zoneId: engine.state.zoneId,
        musicTrack: audioEngine.getMusicTheme(),
        audioMuted: audioEngine.isMuted(),
        audioVolume: audioEngine.getVolume(),
        audioBuses: audioEngine.getBusVolumes(),
        audioUnlocked: audioEngine.isUnlocked(),
        weatherAudio: audioEngine.getWeatherAudioStatus(),
        hasSave: engine.hasSavedGame(),
        geometries: sceneManager.renderer.info.memory.geometries,
        gpuTextures: sceneManager.renderer.info.memory.textures,
        drawCalls: sceneManager.renderer.info.render.calls,
        triangles: sceneManager.renderer.info.render.triangles,
        minimapVisible: minimapController.isVisible(),
        cape: Object.freeze(entityRenderer.getCapeDiagnostics()),
        wildlife: Object.freeze(wildlifeSystem.getDiagnostics()),
      }),
    setWeatherForTest: (override: WeatherQaOverride) => {
      weatherController.applyQaOverride(override);
      syncAtmosphereAndAudio(0.016);
    },
    advanceWeatherForTest: (seconds: number) => {
      const total = Math.max(0, Math.min(seconds, 7200));
      let remaining = total;
      while (remaining > 0.0001) {
        const step = Math.min(0.2, remaining);
        weatherController.update(step);
        remaining -= step;
      }
      syncAtmosphereAndAudio(0.016);
    },
    setAudioVolumeForTest: (volume: number) => {
      audioEngine.setVolume(volume);
      hudController.setMuted(audioEngine.isMuted());
    },
    setWildlifeDensityForTest: (density: WildlifeDensity) => {
      engine.setWildlifeDensity(density);
      wildlifeSystem.update(engine.state, 0.016, weatherController.getSnapshot());
    },
    equipItemsForTest: (itemIds: readonly string[]) => {
      for (const id of itemIds) {
        addEquipment(engine.state.player, id);
        engine.equipItem(id);
      }
      hudController.update(engine.state);
      modalsController.update(engine.state);
      modalsController.setHeroPortrait(
        textures.getHeroFullPreviewUrl(engine.state.player.equipped),
      );
      hudController.setHeroPortrait(
        textures.getHeroPortraitUrl(engine.state.player.equipped),
      );
    },
    enterZoneForTest: (zoneId: ZoneId, x?: number, z?: number) => {
      const defaultPos = zoneId === 'overworld' ? { x: 0, z: 24 } : { x: 0, z: 12 };
      engine.loadZone(zoneId, { x: x ?? defaultPos.x, z: z ?? defaultPos.z }, true);
      worldRenderer.loadZone(engine.state.zoneId, engine.state);
      syncAtmosphereAndAudio(0.016);
    },
    setHeroPoseForTest: (opts: {
      facingX?: 1 | -1;
      attackAnimTimer?: number;
      dodgeTimer?: number;
      vx?: number;
      vz?: number;
    }) => {
      const p = engine.state.player;
      if (opts.facingX !== undefined) p.facingX = opts.facingX;
      if (opts.attackAnimTimer !== undefined) p.attackAnimTimer = opts.attackAnimTimer;
      if (opts.dodgeTimer !== undefined) p.dodgeTimer = opts.dodgeTimer;
      if (opts.vx !== undefined) p.vx = opts.vx;
      if (opts.vz !== undefined) p.vz = opts.vz;
    },
    getLightingDiagnostics: () => {
      const slots: {
        index: number;
        x: number;
        y: number;
        z: number;
        intensity: number;
        distance: number;
      }[] = [];
      let activeSpriteLightCount = 0;
      for (let i = 0; i < SPRITE_LIGHT_COUNT; i++) {
        const s = getSpriteLightSlotSnapshot(i);
        if (!s) continue;
        if (s.intensity > 0.01) activeSpriteLightCount++;
        slots.push({
          index: i,
          x: Math.round(s.x * 100) / 100,
          y: Math.round(s.y * 100) / 100,
          z: Math.round(s.z * 100) / 100,
          intensity: Math.round(s.intensity * 100) / 100,
          distance: Math.round(s.distance * 100) / 100,
        });
      }
      return Object.freeze({ activeSpriteLightCount, slots });
    },
  });

  window.__CAT_QUEST__ = qaHook;

  // --- 8. Nettoyage propre des ressources à la fermeture de la page ---
  const cleanup = (): void => {
    if (disposed) return;
    disposed = true;
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
    inputManager.detach();
    hudController.dispose();
    minimapController.dispose();
    modalsController.dispose();
    screensController.dispose();
    floatingTextManager.dispose();
    wildlifeSystem.dispose();
    weatherVfx.dispose();
    effectsRenderer.dispose();
    entityRenderer.dispose();
    shipRenderer.dispose();
    worldRenderer.dispose();
    textures.dispose();
    sceneManager.dispose();
    audioEngine.dispose();
    if (window.__CAT_QUEST__ === qaHook) {
      delete window.__CAT_QUEST__;
    }
  };

  window.addEventListener('pagehide', cleanup);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
