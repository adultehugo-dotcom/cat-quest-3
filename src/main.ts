import './style.css';
import { TextureRegistry } from './art/textureRegistry';
import { AudioEngine } from './audio/audioEngine';
import { GameEngine } from './game/gameEngine';
import { InputManager } from './game/input';
import type {
  EquipSlot,
  GameEvent,
  MusicTrackId,
  OwnedEquipment,
  QuestId,
  QuestProgress,
  SpeakerPortraitId,
} from './game/types';
import { EffectsRenderer } from './render/effectsRenderer';
import { EntityRenderer } from './render/entityRenderer';
import { FloatingTextManager } from './render/floatingText';
import { SceneManager } from './render/sceneManager';
import {
  type TorchLightPosition,
  WorldRenderer,
} from './render/worldRenderer';
import { HudController } from './ui/hudController';
import { ModalsController } from './ui/modalsController';
import { ScreensController } from './ui/screensController';

// ============================================================================
// Point d'entrée principal — Les Chroniques de Félingard
// Assemble Simulation, Art/Rendu 2.5D PBR Three.js, Audio procédural et UI Parchemin
// ============================================================================

const MAX_DELTA_SEC = 0.05;

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
    inVillage: boolean;
    time: number;
    player: {
      x: number;
      z: number;
      hp: number;
      maxHp: number;
      mp: number;
      maxMp: number;
      level: number;
      xp: number;
      xpToNext: number;
      gold: number;
      hasRunicKey: boolean;
      equipped: Record<EquipSlot, string>;
      stats: { atk: number; mag: number; def: number; critChance: number };
      spellLevels: Record<string, number>;
    };
    activeBoss: {
      id: string;
      typeId: string;
      name: string;
      hp: number;
      maxHp: number;
      phase: 1 | 2;
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
    audioUnlocked: boolean;
    hasSave: boolean;
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
  return `${hdLoaded ? 'hd' : 'proc'}|${equipped.weapon}|${equipped.secondary_weapon}|${equipped.shield}|${equipped.helmet}|${equipped.armor}|${equipped.trinket}`;
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
    (positions: TorchLightPosition[]) => {
      sceneManager.setDynamicTorchLights(positions);
    },
  );
  const entityRenderer = new EntityRenderer(sceneManager.scene, textures);
  const effectsRenderer = new EffectsRenderer(sceneManager.scene, textures);
  const floatingTextManager = new FloatingTextManager(floatingTextLayer);

  const audioEngine = new AudioEngine();
  const inputManager = new InputManager();
  const engine = new GameEngine();

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
        audioEngine.playSfx('meow_ui');
        engine.toggleModal('inventory');
      }
      blurFocusedButton();
    },
    onToggleMap: () => {
      audioEngine.unlock();
      if (engine.state.screen === 'playing' && !engine.state.dialogue.active) {
        audioEngine.playSfx('meow_ui');
        engine.toggleModal('map');
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
        audioEngine.playSfx('meow_ui');
        engine.resumeGame();
        inputManager.reset();
      } else if (engine.state.screen === 'playing') {
        audioEngine.playSfx('meow_ui');
        engine.openModal('pause');
      }
      blurFocusedButton();
    },
    onOpenQuests: () => {
      audioEngine.unlock();
      if (engine.state.screen === 'playing' && !engine.state.dialogue.active) {
        audioEngine.playSfx('meow_ui');
        engine.toggleModal('quests');
      }
      blurFocusedButton();
    },
  });

  const modalsController = new ModalsController(modalLayer, {
    onClose: () => {
      audioEngine.unlock();
      audioEngine.playSfx('meow_ui');
      engine.closeModal();
      inputManager.reset();
      blurFocusedButton();
    },
    onEquipItem: (itemId) => {
      audioEngine.unlock();
      const equippedOk = engine.equipItem(itemId);
      if (equippedOk) {
        audioEngine.playSfx('meow_ui');
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
        audioEngine.playSfx('meow_ui');
      }
      blurFocusedButton();
    },
    onBuyMysteryChest: () => {
      audioEngine.unlock();
      const result = engine.buyMysteryChest();
      if (result) {
        if (!result.isUpgrade) {
          audioEngine.playSfx('chest_open');
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
        audioEngine.playSfx('level_up');
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
      inputManager.reset();
      syncHeroVisuals(true);
      blurFocusedButton();
    },
    onContinueGame: () => {
      audioEngine.unlock();
      if (engine.continueSavedGame()) {
        audioEngine.playSfx('meow_ui');
        clearTransientRenderers();
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
      audioEngine.playSfx('meow_ui');
      engine.resumeGame();
      inputManager.reset();
      blurFocusedButton();
    },
    onReturnToTitle: () => {
      audioEngine.unlock();
      audioEngine.playSfx('meow_ui');
      clearTransientRenderers();
      engine.returnToTitle();
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
  });

  function clearTransientRenderers(): void {
    effectsRenderer.clear();
    floatingTextManager.clear();
    entityRenderer.clear();
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
  screensController.setHasSave(engine.hasSavedGame());
  hudController.setMuted(audioEngine.isMuted());

  // Chargement asynchrone des assets HD (Personnages, Props Diorama & Textures PBR)
  // avec mise à jour à chaud transparente dès la résolution !
  void textures.loadAllHdAssets().then(() => {
    if (disposed) return;
    heroFullPreviewCache.clear();
    worldRenderer.refreshTextures(engine.state);
    entityRenderer.refreshTextures(engine.state);
    syncStaticSpeakerPortraits();
    syncHeroVisuals(true);
    modalsController.setMapImage(textures.getMiniMapUrl());
    textures.flushRetiredTextures();
  });

  inputManager.attach(sceneManager.domElement);
  inputManager.setAimWorldResolver((ndcX, ndcY) =>
    sceneManager.ndcToWorld(ndcX, ndcY),
  );

  // Thème musical pastoral prêt dès la première interaction utilisateur
  let lastMusicTrack: MusicTrackId | null = 'overworld';
  audioEngine.setMusicTheme('overworld');

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
      desired = 'overworld';
    } else {
      desired = engine.getCurrentMusicTrack();
    }

    if (desired !== lastMusicTrack) {
      lastMusicTrack = desired;
      audioEngine.setMusicTheme(desired);
    }
  };

  const projectWorldToScreen = (x: number, y: number, z: number) =>
    sceneManager.worldToScreen(x, y, z);

  // --- 5. Premier rendu immédiat (scène 2.5D en orbite douce derrière l'Écran Titre) ---
  sceneManager.updateCamera(engine.state, 0.016);
  worldRenderer.update(engine.state, 0);
  entityRenderer.update(engine.state, 0);
  effectsRenderer.update(engine.state, 0);
  sceneManager.render(0.016);
  hudController.update(engine.state);
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
        audioEngine.playSfx('meow_ui');
        inputManager.reset();
      } else if (engine.state.dialogue.currentIndex !== prevDialogueIdx) {
        audioEngine.playSfx('meow_ui');
      }
    } else if (prevModal !== engine.state.activeModal) {
      audioEngine.playSfx('meow_ui');
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
    const animDt = isSimFrozen ? 0 : dt;

    // Caméra & screen shake toujours fluides (y compris hitstop et orbite Écran Titre)
    sceneManager.updateCamera(engine.state, dt);
    worldRenderer.update(engine.state, animDt);
    entityRenderer.update(engine.state, animDt);
    effectsRenderer.update(engine.state, animDt);
    floatingTextManager.update(animDt, projectWorldToScreen);
    sceneManager.render(dt);

    hudController.update(engine.state);
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
        inVillage: s.inVillage,
        time: Math.round(s.time * 100) / 100,
        player: Object.freeze({
          x: Math.round(p.x * 100) / 100,
          z: Math.round(p.z * 100) / 100,
          hp: Math.round(p.hp),
          maxHp: Math.round(p.maxHp),
          mp: Math.round(p.mp),
          maxMp: Math.round(p.maxMp),
          level: p.level,
          xp: p.xp,
          xpToNext: p.xpToNext,
          gold: p.gold,
          hasRunicKey: p.hasRunicKey,
          equipped: Object.freeze({ ...p.equipped }),
          stats: Object.freeze({ ...p.stats }),
          spellLevels: Object.freeze({ ...p.spellLevels }),
        }),
        activeBoss: boss
          ? Object.freeze({
              id: boss.id,
              typeId: boss.typeId,
              name: boss.name,
              hp: Math.round(boss.hp),
              maxHp: Math.round(boss.maxHp),
              phase: boss.phase,
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
        audioUnlocked: audioEngine.isUnlocked(),
        hasSave: engine.hasSavedGame(),
      }),
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
    modalsController.dispose();
    screensController.dispose();
    floatingTextManager.dispose();
    effectsRenderer.dispose();
    entityRenderer.dispose();
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
