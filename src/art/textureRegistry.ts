import * as THREE from 'three';
import type {
  BuildingDef,
  ChestTier,
  DungeonDefinition,
  EnemyTypeId,
  EquipSlot,
  PropKind,
  SpeakerPortraitId,
} from '../game/types';
import {
  ENEMY_ANIM_CLIPS,
  HD_CAPE_FABRIC_FILES,
  HD_CHARACTER_FILES,
  HD_ENEMY_PHASE2_SHEET_FILES,
  HD_ENEMY_SHEET_FILES,
  HD_ENEMY_STATE_SHEET_FILES,
  HD_EQUIPMENT_FILES,
  HD_EQUIPMENT_SHEET_FILES,
  HD_HERO_SHEET_FILES,
  HD_NPC_SHEET_FILES,
  HD_PROP_FILES,
  HD_SURFACE_FILES,
  HERO_ANIM_CLIPS,
  NPC_ANIM_CLIPS,
  type AnimationManifest,
  type CanonicalSheetId,
  type EnemyAnimState,
  type HdCapeKey,
  type HdCharacterKey,
  type HdEnemySheetKey,
  type HdEquipmentKey,
  type HdLoadSummary,
  type HdPbrChannel,
  type HdPropKey,
  type HdSurfaceImages,
  type HdSurfaceKey,
  type HdTerrainBundle,
  type HeroAnimState,
  type NpcAnimState,
  type NpcId,
  type SpriteAnimClipDescriptor,
  type SpriteGridSpec,
  configureDioramaTexture,
  configureSpritesheetTexture,
  extractHtmlImage,
  getTextureDimensions,
  loadAnimationManifestSafe,
  loadTextureSafe,
  normalizeSpriteGridSpec,
  resolveActiveSpriteGrid,
  resolveEnemyAtlasStateGrid,
  resolveEnemySixStateGrid,
  resolveMayorMoustacheGrid,
} from './hdAssets';
import {
  OCEAN_PALETTE,
  createCanvas,
  createSeededRandom,
  drawStar,
} from './palette';
import {
  type ArmorFitTransform,
  type HeroAnimFrame,
  type HeroModularImages,
  computeIdealArmorFit,
  createFittedArmorCanvas,
  drawHeroCanvas,
  drawHeroFullPreviewDataUrl,
  drawHeroLanternCanvas,
  drawHeroPortraitDataUrl,
  drawProceduralWeaponCanvas,
  getHeroBodyTextureKey,
  measureArmorImageMetrics,
} from './spriteHero';
import {
  type EquipmentCalibrationEntry,
  type NormalizedEquipmentFit,
  computeNormalizedEquipmentFit,
  createNormalizedEquipmentCanvas,
  getEquipmentCalibration,
} from './equipmentRig';
import { getEquipmentDefinition } from '../data/equipmentData';
import { VFX_ASSETS, type VfxAssetId } from './vfxManifest';
import {
  type HdPortraitImages,
  drawBossDragonPhase2HdCanvas,
  drawBossDragonPhase2SheetCanvas,
  drawCompanionCanvas,
  drawEnemyCanvas,
  drawNpcCanvas,
  drawSpeakerPortraitDataUrl,
} from './spriteEntities';
import {
  drawBuildingCanvas,
  drawChestCanvas,
  drawChestHdCanvas,
  drawChestOpeningFrameCanvas,
  drawDungeonEntranceCanvas,
  drawDungeonEntranceHdCanvas,
  drawDungeonExitPortalCanvas,
  drawHealingCrystalCanvas,
  drawHealingCrystalHdCanvas,
  drawLamppostCanvas,
  drawPillarCanvas,
  drawPillarHdCanvas,
  drawPropCanvas,
  drawSnowRockHdCanvas,
  drawTorchCanvas,
  drawTorchHdCanvas,
} from './spriteProps';
import {
  createSeaLabelCanvas,
  generateDungeonPbrCanvases,
  generateDungeonWallPbrCanvases,
  generateOverworldPbrCanvases,
  getArchipelagoMapCanvas,
  getOverworldMiniMapDataUrl,
} from './mapTexture';

export interface OverworldPbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export interface DungeonFloorPbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

export interface WallPbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

/**
 * Source d'animation pré-résolue et mise en cache pour exécution zéro-allocation
 * dans la boucle de rendu (`EntityRenderer`).
 */
export interface ResolvedSpriteClipSource {
  readonly clip: SpriteAnimClipDescriptor;
  readonly mode: 'uv-grid' | 'frame-sequence';
  readonly grid: SpriteGridSpec;
  readonly frameCount: number;
  readonly sheetTexture: THREE.Texture | null;
  readonly frames: readonly THREE.Texture[];
  readonly isDedicatedAsset: boolean;
}

const SINGLE_CELL_GRID: SpriteGridSpec = {
  cols: 1,
  rows: 1,
  frameCount: 1,
  startFrame: 0,
};

function drawWaterTileCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(256, 256);
  ctx.fillStyle = OCEAN_PALETTE.deep;
  ctx.fillRect(0, 0, 256, 256);

  const rand = createSeededRandom(12345);
  for (let i = 0; i < 42; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const rx = 18 + rand() * 26;
    const ry = 5 + rand() * 6;
    ctx.fillStyle =
      i % 2 === 0 ? 'rgba(62, 164, 204, 0.24)' : 'rgba(205, 245, 255, 0.14)';
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvas;
}

function drawShadowCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(128, 128);
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 58);
  grad.addColorStop(0, 'rgba(28, 18, 12, 0.56)');
  grad.addColorStop(0.58, 'rgba(28, 18, 12, 0.32)');
  grad.addColorStop(1, 'rgba(28, 18, 12, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return canvas;
}

function drawParticleCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(64, 64);
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

function drawStarParticleCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(64, 64);
  drawStar(ctx, 32, 32, 4, 28, 9);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return canvas;
}

function mapHeroStateToLegacyFrame(state: HeroAnimState): HeroAnimFrame {
  switch (state) {
    case 'walk':
      return 'walk1';
    case 'jump':
      return 'walk2';
    case 'attack':
      return 'attack';
    case 'roll':
      return 'roll';
    case 'hurt':
      return 'hurt';
    case 'death':
      return 'death';
    default:
      return 'idle';
  }
}

/**
 * Registre centralisé hybride des textures et animations multi-frames 30 FPS du jeu :
 * - Fallback procédural instantané dès le premier rendu en navigateur (First Paint zéro attente).
 * - Chargement asynchrone de tous les PNG HD (Personnages, Planches, Équipements, Props, PBR).
 * - Résolution mise en cache des clips multi-frames (`uv-grid` ou `frame-sequence`) avec
 *   rétrocompatibilité 100 % transparente pour les PNG unitaires et planches 4 colonnes actuels.
 */
export class TextureRegistry {
  private readonly cache = new Map<string, THREE.CanvasTexture>();
  private readonly headlessCache = new Map<string, THREE.DataTexture>();
  private readonly retiredTextures: THREE.Texture[] = [];

  private readonly hdCharacters = new Map<HdCharacterKey, THREE.Texture>();
  private readonly hdHeroSheets = new Map<HeroAnimState, THREE.Texture>();
  private readonly hdHeroSheetGridOverrides = new Map<HeroAnimState, SpriteGridSpec>();
  private readonly hdHeroFrameSequences = new Map<HeroAnimState, readonly THREE.Texture[]>();

  private readonly hdEnemySheets = new Map<HdEnemySheetKey, THREE.Texture>();
  private readonly hdEnemyPhase2Sheets = new Map<HdEnemySheetKey, THREE.Texture>();
  private readonly hdEnemyStateSheets = new Map<string, THREE.Texture>();
  private readonly hdEnemyGridOverrides = new Map<string, SpriteGridSpec>();
  private readonly hdEnemyFrameSequences = new Map<string, readonly THREE.Texture[]>();

  private readonly hdNpcStateSheets = new Map<string, THREE.Texture>();
  private readonly hdNpcGridOverrides = new Map<string, SpriteGridSpec>();
  private readonly hdNpcFrameSequences = new Map<string, readonly THREE.Texture[]>();

  private readonly hdEquipment = new Map<HdEquipmentKey, THREE.Texture>();
  private readonly fittedArmorCache = new Map<
    string,
    { texture: THREE.Texture; ownsTexture: boolean; fit: ArmorFitTransform }
  >();
  private readonly normalizedEquipmentCache = new Map<
    string,
    {
      texture: THREE.Texture;
      ownsTexture: boolean;
      calibration: EquipmentCalibrationEntry;
      fit: NormalizedEquipmentFit;
    }
  >();
  private readonly hdEquipmentSheets = new Map<
    HdEquipmentKey,
    Partial<Record<HeroAnimState, THREE.Texture>>
  >();
  private readonly hdCapeFabrics = new Map<string, THREE.Texture>();
  private readonly hdProps = new Map<HdPropKey, THREE.Texture>();
  private readonly hdPropSheets = new Map<string, THREE.Texture>();
  private readonly vfxTextures = new Map<VfxAssetId, THREE.Texture>();
  private animationManifest: AnimationManifest | null = null;
  private readonly hdSurfaces = new Map<
    HdSurfaceKey,
    Partial<Record<HdPbrChannel, THREE.Texture>>
  >();
  private heroModularCache: HeroModularImages | null = null;

  private readonly heroResolvedClipCache = new Map<string, ResolvedSpriteClipSource>();
  private readonly enemyResolvedClipCache = new Map<string, ResolvedSpriteClipSource>();
  private readonly npcResolvedClipCache = new Map<string, ResolvedSpriteClipSource>();

  private readonly overworldPbrCache = new Map<string, OverworldPbrTextureSet>();
  private readonly dungeonPbrCache = new Map<string, DungeonFloorPbrTextureSet>();
  private readonly wallPbrCache = new Map<string, WallPbrTextureSet>();

  private maxAnisotropy = 8;
  private hdLoaded = false;
  private hdLoadPromise: Promise<HdLoadSummary> | null = null;
  private hdSummary: HdLoadSummary = { loaded: 0, failed: 0, total: 0 };
  private revisionCounter = 1;

  public get isHdLoaded(): boolean {
    return this.hdLoaded;
  }

  public get hdLoadSummary(): Readonly<HdLoadSummary> {
    return this.hdSummary;
  }

  /** Compteur de révision monotone incrémenté à chaque rechargement/enregistrement d'assets. */
  public get revision(): number {
    return this.revisionCounter;
  }

  private bumpRevision(): void {
    this.revisionCounter += 1;
    this.heroModularCache = null;
    this.heroResolvedClipCache.clear();
    this.enemyResolvedClipCache.clear();
    this.npcResolvedClipCache.clear();
  }

  public setMaxAnisotropy(value: number): void {
    this.maxAnisotropy = Math.max(1, Math.min(16, value));
    for (const tex of this.cache.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdCharacters.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdHeroSheets.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdEnemySheets.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdEnemyPhase2Sheets.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdEnemyStateSheets.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdNpcStateSheets.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdEquipment.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdCapeFabrics.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdProps.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdPropSheets.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.vfxTextures.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const surf of this.hdSurfaces.values()) {
      for (const tex of Object.values(surf)) {
        if (tex) tex.anisotropy = this.maxAnisotropy;
      }
    }
  }

  // ==========================================================================
  // Enregistrement explicite de spritesheets multi-frames & séquences de textures
  // ==========================================================================

  public registerHeroSpriteSheet(
    state: HeroAnimState,
    sheet: THREE.Texture,
    gridOverride?: SpriteGridSpec,
  ): void {
    this.hdHeroSheets.set(state, sheet);
    if (gridOverride) {
      this.hdHeroSheetGridOverrides.set(state, normalizeSpriteGridSpec(gridOverride));
    } else {
      this.hdHeroSheetGridOverrides.delete(state);
    }
    this.bumpRevision();
  }

  public registerHeroFrameSequence(
    state: HeroAnimState,
    frames: readonly THREE.Texture[],
  ): void {
    if (frames.length === 0) {
      this.hdHeroFrameSequences.delete(state);
    } else {
      this.hdHeroFrameSequences.set(state, frames.slice());
    }
    this.bumpRevision();
  }

  public registerEnemySpriteSheet(
    typeId: EnemyTypeId,
    sheet: THREE.Texture,
    options: {
      state?: EnemyAnimState;
      phase?: 1 | 2;
      grid?: SpriteGridSpec;
    } = {},
  ): void {
    const phase = typeId === 'boss_dragon_claw' ? (options.phase ?? 1) : 1;
    if (options.state) {
      const stateKey = `${typeId}|${options.state}|p${phase}`;
      this.hdEnemyStateSheets.set(stateKey, sheet);
      if (options.grid) {
        this.hdEnemyGridOverrides.set(stateKey, normalizeSpriteGridSpec(options.grid));
      } else {
        this.hdEnemyGridOverrides.delete(stateKey);
      }
    } else {
      if (phase === 2) {
        this.hdEnemyPhase2Sheets.set(typeId, sheet);
      } else {
        this.hdEnemySheets.set(typeId, sheet);
      }
      const atlasKey = `${typeId}|*|p${phase}`;
      if (options.grid) {
        this.hdEnemyGridOverrides.set(atlasKey, normalizeSpriteGridSpec(options.grid));
      } else {
        this.hdEnemyGridOverrides.delete(atlasKey);
      }
    }
    this.bumpRevision();
  }

  public registerEnemyFrameSequence(
    typeId: EnemyTypeId,
    state: EnemyAnimState,
    frames: readonly THREE.Texture[],
    phase: 1 | 2 = 1,
  ): void {
    const effPhase = typeId === 'boss_dragon_claw' ? phase : 1;
    const key = `${typeId}|${state}|p${effPhase}`;
    if (frames.length === 0) {
      this.hdEnemyFrameSequences.delete(key);
    } else {
      this.hdEnemyFrameSequences.set(key, frames.slice());
    }
    this.bumpRevision();
  }

  public registerNpcSpriteSheet(
    npcId: NpcId,
    sheet: THREE.Texture,
    options: { state?: NpcAnimState; grid?: SpriteGridSpec } = {},
  ): void {
    if (options.state) {
      const key = `${npcId}|${options.state}`;
      this.hdNpcStateSheets.set(key, sheet);
      if (options.grid) {
        this.hdNpcGridOverrides.set(key, normalizeSpriteGridSpec(options.grid));
      } else {
        this.hdNpcGridOverrides.delete(key);
      }
    } else {
      this.hdCharacters.set(npcId, sheet);
      const key = `${npcId}|*`;
      if (options.grid) {
        this.hdNpcGridOverrides.set(key, normalizeSpriteGridSpec(options.grid));
      } else {
        this.hdNpcGridOverrides.delete(key);
      }
    }
    this.bumpRevision();
  }

  public registerNpcFrameSequence(
    npcId: NpcId,
    state: NpcAnimState,
    frames: readonly THREE.Texture[],
  ): void {
    const key = `${npcId}|${state}`;
    if (frames.length === 0) {
      this.hdNpcFrameSequences.delete(key);
    } else {
      this.hdNpcFrameSequences.set(key, frames.slice());
    }
    this.bumpRevision();
  }

  public registerCapeFabricTexture(
    capeId: string,
    texture: THREE.Texture | null,
  ): void {
    if (!capeId) return;
    if (texture) {
      this.hdCapeFabrics.set(capeId, texture);
    } else {
      this.hdCapeFabrics.delete(capeId);
    }
    this.bumpRevision();
  }

  /**
   * Charge en parallèle tous les assets HD déclarés dans `hdAssets.ts` via `THREE.TextureLoader`.
   * Sûr à appeler plusieurs fois (mémoïsé).
   */
  public loadAllHdAssets(): Promise<HdLoadSummary> {
    if (this.hdLoadPromise) return this.hdLoadPromise;

    this.hdLoadPromise = this.runLoadAllHdAssets();
    return this.hdLoadPromise;
  }

  private async runLoadAllHdAssets(): Promise<HdLoadSummary> {
    const loader = new THREE.TextureLoader();
    const tasks: Array<Promise<boolean>> = [];

    for (const [key, path] of Object.entries(HD_CHARACTER_FILES) as Array<
      [HdCharacterKey, string | undefined]
    >) {
      if (!path) continue;
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdCharacters.set(key, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [state, path] of Object.entries(HD_HERO_SHEET_FILES) as Array<
      [HeroAnimState, string | undefined]
    >) {
      if (!path) continue;
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdHeroSheets.set(state, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [key, path] of Object.entries(HD_ENEMY_SHEET_FILES) as Array<
      [HdEnemySheetKey, string]
    >) {
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdEnemySheets.set(key, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [key, path] of Object.entries(HD_ENEMY_PHASE2_SHEET_FILES) as Array<
      [HdEnemySheetKey, string | undefined]
    >) {
      if (!path) continue;
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdEnemyPhase2Sheets.set(key, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [typeId, stateMap] of Object.entries(HD_ENEMY_STATE_SHEET_FILES) as Array<
      [HdEnemySheetKey, Partial<Record<EnemyAnimState, string>> | undefined]
    >) {
      if (!stateMap) continue;
      for (const [state, path] of Object.entries(stateMap) as Array<
        [EnemyAnimState, string | undefined]
      >) {
        if (!path) continue;
        tasks.push(
          loadTextureSafe(loader, path, {
            isDataMap: false,
            repeat: false,
            anisotropy: this.maxAnisotropy,
          }).then((tex) => {
            if (tex) {
              this.hdEnemyStateSheets.set(`${typeId}|${state}|p1`, tex);
              return true;
            }
            return false;
          }),
        );
      }
    }

    for (const [npcId, stateMap] of Object.entries(HD_NPC_SHEET_FILES) as Array<
      [NpcId, Partial<Record<NpcAnimState, string>> | undefined]
    >) {
      if (!stateMap) continue;
      for (const [state, path] of Object.entries(stateMap) as Array<
        [NpcAnimState, string | undefined]
      >) {
        if (!path) continue;
        tasks.push(
          loadTextureSafe(loader, path, {
            isDataMap: false,
            repeat: false,
            anisotropy: this.maxAnisotropy,
          }).then((tex) => {
            if (tex) {
              this.hdNpcStateSheets.set(`${npcId}|${state}`, tex);
              return true;
            }
            return false;
          }),
        );
      }
    }

    for (const [key, path] of Object.entries(HD_EQUIPMENT_FILES) as Array<
      [HdEquipmentKey, string]
    >) {
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdEquipment.set(key, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [equipKey, stateMap] of Object.entries(HD_EQUIPMENT_SHEET_FILES) as Array<
      [HdEquipmentKey, Partial<Record<HeroAnimState, string>> | undefined]
    >) {
      if (!stateMap) continue;
      const bucket: Partial<Record<HeroAnimState, THREE.Texture>> = {};
      this.hdEquipmentSheets.set(equipKey, bucket);
      for (const [state, path] of Object.entries(stateMap) as Array<
        [HeroAnimState, string | undefined]
      >) {
        if (!path) continue;
        tasks.push(
          loadTextureSafe(loader, path, {
            isDataMap: false,
            repeat: false,
            anisotropy: this.maxAnisotropy,
          }).then((tex) => {
            if (tex) {
              bucket[state] = tex;
              return true;
            }
            return false;
          }),
        );
      }
    }

    for (const [capeKey, path] of Object.entries(HD_CAPE_FABRIC_FILES) as Array<
      [HdCapeKey, string | undefined]
    >) {
      if (!path) continue;
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdCapeFabrics.set(capeKey, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [key, path] of Object.entries(HD_PROP_FILES) as Array<
      [HdPropKey, string | undefined]
    >) {
      if (!path) continue;
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdProps.set(key, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [surfKey, channels] of Object.entries(HD_SURFACE_FILES) as Array<
      [HdSurfaceKey, Partial<Record<HdPbrChannel, string>>]
    >) {
      const bucket: Partial<Record<HdPbrChannel, THREE.Texture>> = {};
      this.hdSurfaces.set(surfKey, bucket);
      for (const [channel, path] of Object.entries(channels) as Array<
        [HdPbrChannel, string | undefined]
      >) {
        if (!path) continue;
        const isDataMap = channel !== 'albedo';
        tasks.push(
          loadTextureSafe(loader, path, {
            isDataMap,
            repeat: true,
            anisotropy: this.maxAnisotropy,
          }).then((tex) => {
            if (tex) {
              bucket[channel] = tex;
              return true;
            }
            return false;
          }),
        );
      }
    }

    for (const entry of Object.values(VFX_ASSETS)) {
      const isDataMap = Boolean(entry.dataMap);
      const repeat = entry.kind === 'normalMap';
      tasks.push(
        loadTextureSafe(loader, entry.path, {
          isDataMap,
          repeat,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (!tex) return false;
          if (entry.kind === 'flipbook' || entry.frames > 1) {
            configureSpritesheetTexture(tex, this.maxAnisotropy);
          }
          this.vfxTextures.set(entry.id, tex);
          return true;
        }),
      );
    }

    const manifest = await loadAnimationManifestSafe();
    this.animationManifest = manifest;
    if (manifest) {
      for (const [sheetId, spec] of Object.entries(manifest.sheets) as Array<
        [CanonicalSheetId, AnimationManifest['sheets'][CanonicalSheetId]]
      >) {
        if (!spec || !spec.baked || !spec.file) continue;
        tasks.push(
          loadTextureSafe(loader, spec.file, {
            isDataMap: false,
            repeat: false,
            anisotropy: this.maxAnisotropy,
          }).then((tex) => {
            if (!tex) return false;
            configureSpritesheetTexture(tex, this.maxAnisotropy);
            const grid: SpriteGridSpec = {
              cols: spec.cols,
              rows: spec.rows,
              frameCount: spec.frameCount,
              startFrame: 0,
              cellWidth: spec.cellWidth,
              cellHeight: spec.cellHeight,
            };
            if (sheetId === 'hero_base_idle') {
              this.hdHeroSheets.set('idle', tex);
              this.hdHeroSheetGridOverrides.set('idle', grid);
            } else if (sheetId === 'hero_base_walk') {
              this.hdHeroSheets.set('walk', tex);
              this.hdHeroSheetGridOverrides.set('walk', grid);
            } else if (sheetId === 'hero_base_attack') {
              this.hdHeroSheets.set('attack', tex);
              this.hdHeroSheetGridOverrides.set('attack', grid);
            } else if (sheetId === 'hero_base_roll') {
              this.hdHeroSheets.set('roll', tex);
              this.hdHeroSheetGridOverrides.set('roll', grid);
            } else if (sheetId === 'miaou_sprit') {
              // Conserve hdCharacters('miaou_sprit') en 512×512 pour les portraits de dialogue
              this.hdNpcStateSheets.set('miaou_sprit|sheet', tex);
              this.hdNpcGridOverrides.set('miaou_sprit|sheet', grid);
            } else if (sheetId === 'mayor_moustache') {
              // Conserve hdCharacters('mayor_moustache') en 512×512 pour les portraits de dialogue
              this.hdNpcStateSheets.set('mayor_moustache|sheet', tex);
              this.hdNpcGridOverrides.set('mayor_moustache|sheet', grid);
            } else if (sheetId === 'boss_dragon_claw_p2') {
              // Pas d'override 90f global : resolveEnemySixStateGrid découpe les 6 états × 15 frames
              this.hdEnemyPhase2Sheets.set('boss_dragon_claw', tex);
              this.hdEnemyGridOverrides.delete('boss_dragon_claw|*|p2');
            } else if (
              sheetId === 'slime_yarn' ||
              sheetId === 'mouse_goblin' ||
              sheetId === 'thorn_wolf' ||
              sheetId === 'fishbone_skeleton' ||
              sheetId === 'frost_golem' ||
              sheetId === 'boss_rat_king' ||
              sheetId === 'boss_dragon_claw'
            ) {
              this.hdEnemySheets.set(sheetId, tex);
              this.hdEnemyGridOverrides.delete(`${sheetId}|*|p1`);
            } else if (sheetId === 'portal_exit' || sheetId === 'prop_torch') {
              this.hdPropSheets.set(sheetId, tex);
            }
            return true;
          }),
        );
      }

      if (manifest.chestOpeningSheet?.baked && manifest.chestOpeningSheet.file) {
        tasks.push(
          loadTextureSafe(loader, manifest.chestOpeningSheet.file, {
            isDataMap: false,
            repeat: false,
            anisotropy: this.maxAnisotropy,
          }).then((tex) => {
            if (!tex) return false;
            configureSpritesheetTexture(tex, this.maxAnisotropy);
            this.hdPropSheets.set('chest_opening', tex);
            return true;
          }),
        );
      }
    }

    const results = await Promise.all(tasks);
    const loaded = results.filter(Boolean).length;
    const total = results.length;
    this.hdSummary = { loaded, failed: total - loaded, total };
    this.hdLoaded = true;
    this.bumpRevision();

    // Retire proprement les anciens caches composites procéduraux afin que les
    // appels suivants retournent immédiatement les composites HD PBR !
    this.invalidateProceduralComposites();
    return this.hdSummary;
  }

  private invalidateProceduralComposites(): void {
    const prefixesToRefresh = [
      'hero_',
      'enemy_',
      'npc_',
      'prop_',
      'entrance_',
      'chest_',
      'torch_',
      'pillar_',
      'crystal_',
    ];
    // Ne jamais détruire les textures purement procédurales sans équivalent PNG HD
    // (sinon la lanterne du joueur et les 16 lampadaires diurnes perdent leur texture GPU).
    const proceduralOnlyPrefixes = ['hero_lantern_', 'prop_lamppost_'];
    for (const [key, tex] of this.cache.entries()) {
      if (proceduralOnlyPrefixes.some((p) => key.startsWith(p))) {
        continue;
      }
      if (prefixesToRefresh.some((p) => key.startsWith(p))) {
        this.retiredTextures.push(tex);
        this.cache.delete(key);
      }
    }
    for (const entry of this.fittedArmorCache.values()) {
      if (entry.ownsTexture) {
        this.retiredTextures.push(entry.texture);
      }
    }
    this.fittedArmorCache.clear();
    for (const set of this.overworldPbrCache.values()) {
      this.retiredTextures.push(set.map, set.normalMap, set.roughnessMap);
    }
    this.overworldPbrCache.clear();

    for (const set of this.dungeonPbrCache.values()) {
      this.retiredTextures.push(
        set.map,
        set.normalMap,
        set.roughnessMap,
        set.emissiveMap,
      );
    }
    this.dungeonPbrCache.clear();

    for (const set of this.wallPbrCache.values()) {
      this.retiredTextures.push(set.map, set.normalMap, set.roughnessMap);
    }
    this.wallPbrCache.clear();
  }

  /**
   * Libère les textures procédurales remplacées après que tous les renderers ont
   * basculé leurs matériaux vers les textures HD.
   */
  public flushRetiredTextures(): void {
    for (const tex of this.retiredTextures) {
      tex.dispose();
    }
    this.retiredTextures.length = 0;
  }

  private createCanvasTexture(
    canvas: HTMLCanvasElement,
    options: { isDataMap?: boolean; repeat?: boolean } = {},
  ): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    configureDioramaTexture(tex, {
      isDataMap: options.isDataMap,
      repeat: options.repeat,
      anisotropy: this.maxAnisotropy,
    });
    return tex;
  }

  private getOrCreateHeadlessDataTexture(
    key: string,
    repeat = false,
  ): THREE.DataTexture {
    const existing = this.headlessCache.get(key);
    if (existing) return existing;
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.name = key;
    configureDioramaTexture(tex, {
      isDataMap: false,
      repeat,
      anisotropy: this.maxAnisotropy,
    });
    this.headlessCache.set(key, tex);
    return tex;
  }

  private getOrCreate(
    key: string,
    factory: () => HTMLCanvasElement,
    repeat = false,
  ): THREE.CanvasTexture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    if (typeof document === 'undefined') {
      return this.getOrCreateHeadlessDataTexture(key, repeat) as unknown as THREE.CanvasTexture;
    }

    const tex = this.createCanvasTexture(factory(), { repeat });
    this.cache.set(key, tex);
    return tex;
  }

  private getHdCharacterImage(key: HdCharacterKey): HTMLImageElement | undefined {
    return extractHtmlImage(this.hdCharacters.get(key));
  }

  private getHdPropImage(key: HdPropKey): HTMLImageElement | undefined {
    return extractHtmlImage(this.hdProps.get(key));
  }

  private getHdSurfaceImages(key: HdSurfaceKey): HdSurfaceImages | undefined {
    const bucket = this.hdSurfaces.get(key);
    if (!bucket) return undefined;
    const albedo = extractHtmlImage(bucket.albedo);
    const normal = extractHtmlImage(bucket.normal);
    const roughness = extractHtmlImage(bucket.roughness);
    if (!albedo && !normal && !roughness) return undefined;
    return { albedo, normal, roughness };
  }

  public getHdTerrainBundle(): HdTerrainBundle {
    return {
      grass: this.getHdSurfaceImages('grass'),
      forest: this.getHdSurfaceImages('forest'),
      snow: this.getHdSurfaceImages('snow'),
      path: this.getHdSurfaceImages('path'),
      dungeon_ghost: this.getHdSurfaceImages('dungeon_ghost'),
      dungeon_dragon: this.getHdSurfaceImages('dungeon_dragon'),
    };
  }

  // ==========================================================================
  // Personnages, Couches Modulaires & Résolution Multi-Frames 30 FPS
  // ==========================================================================

  private getHeroModularImages(): HeroModularImages | undefined {
    if (this.heroModularCache) return this.heroModularCache;
    const idle = this.getHdCharacterImage('hero_base_idle');
    if (!idle) return undefined;

    const equipment: Partial<Record<HdEquipmentKey, HTMLImageElement>> = {};
    for (const [key, tex] of this.hdEquipment.entries()) {
      const img = extractHtmlImage(tex);
      if (img) equipment[key] = img;
    }

    const stateSheets: Partial<Record<HeroAnimState, HTMLImageElement>> = {};
    for (const [state, tex] of this.hdHeroSheets.entries()) {
      const img = extractHtmlImage(tex);
      if (img) stateSheets[state] = img;
    }

    const equipmentSheets: Partial<
      Record<HdEquipmentKey, Partial<Record<HeroAnimState, HTMLImageElement>>>
    > = {};
    for (const [equipKey, stateBucket] of this.hdEquipmentSheets.entries()) {
      const imgBucket: Partial<Record<HeroAnimState, HTMLImageElement>> = {};
      for (const [st, tex] of Object.entries(stateBucket) as Array<
        [HeroAnimState, THREE.Texture | undefined]
      >) {
        const img = extractHtmlImage(tex);
        if (img) imgBucket[st] = img;
      }
      equipmentSheets[equipKey] = imgBucket;
    }

    this.heroModularCache = {
      basePoses: {
        idle,
        walk1: this.getHdCharacterImage('hero_base_walk1') ?? idle,
        walk2: this.getHdCharacterImage('hero_base_walk2') ?? idle,
        attack: this.getHdCharacterImage('hero_base_attack') ?? idle,
        roll: this.getHdCharacterImage('hero_base_roll') ?? idle,
      },
      stateSheets,
      portraitBase: this.getHdCharacterImage('hero_portrait'),
      equipment,
      equipmentSheets,
    };
    return this.heroModularCache;
  }

  public getHeroTexture(
    equipped: Record<EquipSlot, string>,
    frame: HeroAnimFrame,
    subFrameIndex = 0,
    animStateOverride?: HeroAnimState,
  ): THREE.CanvasTexture {
    const modular = this.getHeroModularImages();
    const tag = modular ? 'hd' : 'proc';
    const key = `hero_${tag}_${getHeroBodyTextureKey(equipped, frame, subFrameIndex)}`;
    return this.getOrCreate(key, () =>
      drawHeroCanvas(equipped, frame, modular, false, subFrameIndex, animStateOverride),
    );
  }

  /**
   * Résout et met en cache le clip multi-frames 30 FPS du héros pour l'équipement courant
   * (hors `cape` : changer la cape ne modifie jamais la clé ni le cache du corps 3D !).
   */
  public resolveHeroClip(
    equipped: Record<EquipSlot, string>,
    state: HeroAnimState,
  ): ResolvedSpriteClipSource {
    const clip = HERO_ANIM_CLIPS[state];
    const bodyEquipSig = getHeroBodyTextureKey(equipped, 'idle', 0);
    const cacheKey = `${this.hdLoaded ? 'hd' : 'proc'}|r${this.revisionCounter}|${bodyEquipSig}|${state}`;
    const cached = this.heroResolvedClipCache.get(cacheKey);
    if (cached) return cached;

    // 1. Séquence de frames préchargées explicite
    const directSeq = this.hdHeroFrameSequences.get(state);
    if (directSeq && directSeq.length > 0) {
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'frame-sequence',
        grid: { cols: directSeq.length, rows: 1, frameCount: directSeq.length, startFrame: 0 },
        frameCount: directSeq.length,
        sheetTexture: null,
        frames: directSeq,
        isDedicatedAsset: true,
      };
      this.heroResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    // 2. Planche multi-frames 30 FPS dédiée (mode uv-grid GPU direct, zéro boucle Canvas2D)
    const directSheet = this.hdHeroSheets.get(state);
    if (directSheet) {
      const dims = getTextureDimensions(directSheet);
      const override = this.hdHeroSheetGridOverrides.get(state);
      const grid = resolveActiveSpriteGrid(
        clip,
        dims?.width ?? 0,
        dims?.height ?? 0,
        override,
      );
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'uv-grid',
        grid,
        frameCount: grid.frameCount,
        sheetTexture: directSheet,
        frames: [],
        isDedicatedAsset: true,
      };
      this.heroResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    // 3. États partagés documentés (`hurt`->`idle`, `death`->`roll`, `deck_idle`->`idle`, `jump`->`walk`)
    const effectiveState: HeroAnimState =
      clip.sharedFrom && clip.sharedFrom in HERO_ANIM_CLIPS
        ? (clip.sharedFrom as HeroAnimState)
        : state;
    const isDedicatedAsset = effectiveState === state;

    const sharedSheet = this.hdHeroSheets.get(effectiveState);
    if (sharedSheet) {
      const dims = getTextureDimensions(sharedSheet);
      const override = this.hdHeroSheetGridOverrides.get(effectiveState);
      const grid = resolveActiveSpriteGrid(
        HERO_ANIM_CLIPS[effectiveState],
        dims?.width ?? 0,
        dims?.height ?? 0,
        override,
      );
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'uv-grid',
        grid,
        frameCount: grid.frameCount,
        sheetTexture: sharedSheet,
        frames: [],
        isDedicatedAsset,
      };
      this.heroResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    // 4. Fallback minimal avant fin du chargement asynchrone (zéro switch 2-poses legacy)
    const poseFrame = mapHeroStateToLegacyFrame(effectiveState);
    const singleTex = this.getHeroTexture(equipped, poseFrame, 0, effectiveState);
    const resolved: ResolvedSpriteClipSource = {
      clip,
      mode: 'frame-sequence',
      grid: SINGLE_CELL_GRID,
      frameCount: 1,
      sheetTexture: null,
      frames: [singleTex],
      isDedicatedAsset,
    };
    this.heroResolvedClipCache.set(cacheKey, resolved);
    return resolved;
  }

  /** Texture d'équipement de cape (icône/aperçu 2D inventaire). */
  public getCapeTexture(capeId: string): THREE.Texture | null {
    if (!capeId) return null;
    return this.hdEquipment.get(capeId as HdEquipmentKey) ?? null;
  }

  /** Texture plane de tissu de cape dédiée au maillage Verlet 3D (si fournie séparément). */
  public getCapeFabricTexture(capeId: string): THREE.Texture | null {
    if (!capeId) return null;
    return this.hdCapeFabrics.get(capeId) ?? null;
  }

  private getOrBuildEnemyPhase2SheetTexture(
    typeId: EnemyTypeId,
    baseSheetTex: THREE.Texture,
    grid: SpriteGridSpec,
  ): THREE.Texture {
    const dedicatedP2 = this.hdEnemyPhase2Sheets.get(typeId);
    if (dedicatedP2) return dedicatedP2;

    if (typeId !== 'boss_dragon_claw') return baseSheetTex;

    const sheetImg = extractHtmlImage(baseSheetTex);
    if (!sheetImg) return baseSheetTex;

    const key = `enemy_sheet_p2_atlas_${typeId}_r${this.revisionCounter}_${grid.cols}x${grid.rows}`;
    return this.getOrCreate(key, () => drawBossDragonPhase2SheetCanvas(sheetImg, grid));
  }

  /**
   * Résout et met en cache le clip 30 FPS d'un ennemi ou boss (Phase 1 & Phase 2).
   * Supporte les séquences préchargées, les planches dédiées par état, les atlas multi-lignes
   * et les planches legacy 4 colonnes `1024×256`.
   */
  public resolveEnemyClip(
    typeId: EnemyTypeId,
    state: EnemyAnimState,
    phase: 1 | 2 = 1,
  ): ResolvedSpriteClipSource {
    const effPhase: 1 | 2 = typeId === 'boss_dragon_claw' ? phase : 1;
    const cacheKey = `${typeId}|${state}|p${effPhase}|r${this.revisionCounter}`;
    const cached = this.enemyResolvedClipCache.get(cacheKey);
    if (cached) return cached;

    const clip = ENEMY_ANIM_CLIPS[typeId][state];

    // 1. Séquence de textures préchargées
    const seq =
      this.hdEnemyFrameSequences.get(`${typeId}|${state}|p${effPhase}`) ??
      (effPhase === 2 ? this.hdEnemyFrameSequences.get(`${typeId}|${state}|p1`) : undefined);
    if (seq && seq.length > 0) {
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'frame-sequence',
        grid: { cols: seq.length, rows: 1, frameCount: seq.length, startFrame: 0 },
        frameCount: seq.length,
        sheetTexture: null,
        frames: seq,
        isDedicatedAsset: true,
      };
      this.enemyResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    // 2. Planche multi-frames dédiée à cet état précis
    const stateKeyP = `${typeId}|${state}|p${effPhase}`;
    const stateKeyP1 = `${typeId}|${state}|p1`;
    const stateSheet =
      this.hdEnemyStateSheets.get(stateKeyP) ?? this.hdEnemyStateSheets.get(stateKeyP1);
    if (stateSheet) {
      const dims = getTextureDimensions(stateSheet);
      const override =
        this.hdEnemyGridOverrides.get(stateKeyP) ?? this.hdEnemyGridOverrides.get(stateKeyP1);
      const grid = resolveActiveSpriteGrid(
        clip,
        dims?.width ?? 0,
        dims?.height ?? 0,
        override,
      );
      const finalSheet =
        effPhase === 2 && !this.hdEnemyStateSheets.get(stateKeyP)
          ? this.getOrBuildEnemyPhase2SheetTexture(typeId, stateSheet, grid)
          : stateSheet;
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'uv-grid',
        grid,
        frameCount: grid.frameCount,
        sheetTexture: finalSheet,
        frames: [],
        isDedicatedAsset: true,
      };
      this.enemyResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    // 3. Spritesheet partagée baked 10×9 (6 états × 15 frames = 90 frames @ 30 FPS)
    const baseSheet =
      (effPhase === 2 ? this.hdEnemyPhase2Sheets.get(typeId) : undefined) ??
      this.hdEnemySheets.get(typeId);
    if (baseSheet) {
      const dims = getTextureDimensions(baseSheet);
      const w = dims?.width ?? 0;
      const h = dims?.height ?? 0;
      const atlasOverride =
        this.hdEnemyGridOverrides.get(`${typeId}|*|p${effPhase}`) ??
        this.hdEnemyGridOverrides.get(`${typeId}|*|p1`);
      const isBakedSixState10x9 =
        !atlasOverride &&
        ((w === 10 * 256 && h === 9 * 256) || (w === 10 * 384 && h === 9 * 384));
      const grid = isBakedSixState10x9
        ? resolveEnemySixStateGrid(typeId, state, w, h)
        : resolveEnemyAtlasStateGrid(typeId, state, w, h, atlasOverride);
      const hasDedicatedRow =
        isBakedSixState10x9 ||
        !clip.sharedFrom ||
        (grid.rows >= 6 && state === 'death') ||
        (grid.rows >= 5 && state === 'hurt') ||
        Boolean(atlasOverride);
      const finalSheet =
        effPhase === 2 && !this.hdEnemyPhase2Sheets.get(typeId)
          ? this.getOrBuildEnemyPhase2SheetTexture(typeId, baseSheet, grid)
          : baseSheet;
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'uv-grid',
        grid,
        frameCount: grid.frameCount,
        sheetTexture: finalSheet,
        frames: [],
        isDedicatedAsset: hasDedicatedRow,
      };
      this.enemyResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    // 4. Fallback unitaire (PNG statique ou Canvas2D procédural)
    const fallbackTex = this.getEnemyTexture(typeId, effPhase);
    const resolved: ResolvedSpriteClipSource = {
      clip,
      mode: 'frame-sequence',
      grid: SINGLE_CELL_GRID,
      frameCount: 1,
      sheetTexture: null,
      frames: [fallbackTex],
      isDedicatedAsset: !clip.sharedFrom,
    };
    this.enemyResolvedClipCache.set(cacheKey, resolved);
    return resolved;
  }

  public getEnemyFrameTexture(
    typeId: EnemyTypeId,
    frameIndex = 0,
    phase: 1 | 2 = 1,
  ): THREE.Texture {
    const effectivePhase = typeId === 'boss_dragon_claw' ? phase : 1;
    const sheetTex = this.hdEnemySheets.get(typeId);
    const sheetImg = extractHtmlImage(sheetTex);
    if (sheetImg) {
      const imgW = sheetImg.naturalWidth || sheetImg.width;
      const imgH = sheetImg.naturalHeight || sheetImg.height;
      const grid = resolveActiveSpriteGrid(
        ENEMY_ANIM_CLIPS[typeId].idle,
        imgW,
        imgH,
        imgW === imgH * 4 ? { cols: 4, rows: 1, frameCount: 4 } : undefined,
      );
      const totalCells = Math.max(1, grid.cols * grid.rows);
      const safeIdx = Math.max(0, Math.min(totalCells - 1, Math.floor(frameIndex)));
      const key = `enemy_sheet_${typeId}_f${safeIdx}_p${effectivePhase}`;
      return this.getOrCreate(key, () => {
        const col = safeIdx % grid.cols;
        const row = Math.floor(safeIdx / grid.cols);
        const fw = Math.max(1, Math.floor(imgW / grid.cols));
        const fh = Math.max(1, Math.floor(imgH / grid.rows));
        const { canvas, ctx } = createCanvas(256, 256);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(sheetImg, col * fw, row * fh, fw, fh, 0, 0, 256, 256);
        if (typeId === 'boss_dragon_claw' && effectivePhase === 2) {
          ctx.save();
          ctx.globalCompositeOperation = 'source-atop';
          const heat = ctx.createRadialGradient(128, 110, 12, 128, 120, 118);
          heat.addColorStop(0, 'rgba(255, 190, 72, 0.34)');
          heat.addColorStop(0.55, 'rgba(255, 72, 28, 0.18)');
          heat.addColorStop(1, 'rgba(180, 15, 25, 0)');
          ctx.fillStyle = heat;
          ctx.fillRect(0, 0, 256, 256);
          ctx.restore();
        }
        return canvas;
      });
    }
    return this.getEnemyTexture(typeId, effectivePhase);
  }

  public getEnemyTexture(
    typeId: EnemyTypeId,
    phase: 1 | 2 = 1,
  ): THREE.Texture {
    const effectivePhase = typeId === 'boss_dragon_claw' ? phase : 1;
    const hdTex = this.hdCharacters.get(typeId);
    if (hdTex) {
      if (typeId === 'boss_dragon_claw' && effectivePhase === 2) {
        const hdImg = extractHtmlImage(hdTex);
        if (hdImg) {
          return this.getOrCreate('enemy_hd_boss_dragon_claw_p2', () =>
            drawBossDragonPhase2HdCanvas(hdImg),
          );
        }
      }
      return hdTex;
    }

    const key = `enemy_proc_${typeId}_p${effectivePhase}`;
    return this.getOrCreate(key, () => drawEnemyCanvas(typeId, effectivePhase));
  }

  /**
   * Résout et met en cache le clip 30 FPS d'un PNJ ou du compagnon `miaou_sprit`.
   */
  public resolveNpcClip(
    npcId: NpcId,
    state: NpcAnimState,
  ): ResolvedSpriteClipSource {
    const cacheKey = `${npcId}|${state}|r${this.revisionCounter}`;
    const cached = this.npcResolvedClipCache.get(cacheKey);
    if (cached) return cached;

    const clip = NPC_ANIM_CLIPS[npcId][state];
    const seqKey = `${npcId}|${state}`;
    const seq = this.hdNpcFrameSequences.get(seqKey);
    if (seq && seq.length > 0) {
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'frame-sequence',
        grid: { cols: seq.length, rows: 1, frameCount: seq.length, startFrame: 0 },
        frameCount: seq.length,
        sheetTexture: null,
        frames: seq,
        isDedicatedAsset: true,
      };
      this.npcResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    const stateSheet = this.hdNpcStateSheets.get(seqKey);
    if (stateSheet) {
      const dims = getTextureDimensions(stateSheet);
      const override = this.hdNpcGridOverrides.get(seqKey);
      const grid = resolveActiveSpriteGrid(
        clip,
        dims?.width ?? 0,
        dims?.height ?? 0,
        override,
      );
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'uv-grid',
        grid,
        frameCount: grid.frameCount,
        sheetTexture: stateSheet,
        frames: [],
        isDedicatedAsset: true,
      };
      this.npcResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    const sharedNpcSheet = this.hdNpcStateSheets.get(`${npcId}|sheet`);
    if (sharedNpcSheet) {
      const dims = getTextureDimensions(sharedNpcSheet);
      const w = dims?.width ?? 0;
      const h = dims?.height ?? 0;
      const grid =
        npcId === 'mayor_moustache'
          ? resolveMayorMoustacheGrid(
              state === 'talk' ? 'talk' : state === 'move' ? 'greet' : 'idle',
              w,
              h,
            )
          : resolveActiveSpriteGrid(
              NPC_ANIM_CLIPS[npcId].idle,
              w,
              h,
              this.hdNpcGridOverrides.get(`${npcId}|sheet`),
            );
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'uv-grid',
        grid,
        frameCount: grid.frameCount,
        sheetTexture: sharedNpcSheet,
        frames: [],
        isDedicatedAsset: npcId === 'mayor_moustache' ? true : !clip.sharedFrom,
      };
      this.npcResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    const charTex = this.hdCharacters.get(npcId);
    if (charTex) {
      const dims = getTextureDimensions(charTex);
      const override = this.hdNpcGridOverrides.get(`${npcId}|*`);
      const grid = resolveActiveSpriteGrid(
        NPC_ANIM_CLIPS[npcId].idle,
        dims?.width ?? 0,
        dims?.height ?? 0,
        override,
      );
      if (grid.frameCount > 1 || override) {
        const resolved: ResolvedSpriteClipSource = {
          clip,
          mode: 'uv-grid',
          grid,
          frameCount: grid.frameCount,
          sheetTexture: charTex,
          frames: [],
          isDedicatedAsset: !clip.sharedFrom,
        };
        this.npcResolvedClipCache.set(cacheKey, resolved);
        return resolved;
      }
      const resolved: ResolvedSpriteClipSource = {
        clip,
        mode: 'frame-sequence',
        grid: SINGLE_CELL_GRID,
        frameCount: 1,
        sheetTexture: null,
        frames: [charTex],
        isDedicatedAsset: !clip.sharedFrom,
      };
      this.npcResolvedClipCache.set(cacheKey, resolved);
      return resolved;
    }

    const fallback =
      npcId === 'miaou_sprit'
        ? this.getCompanionTexture()
        : this.getNpcTexture(npcId);
    const resolved: ResolvedSpriteClipSource = {
      clip,
      mode: 'frame-sequence',
      grid: SINGLE_CELL_GRID,
      frameCount: 1,
      sheetTexture: null,
      frames: [fallback],
      isDedicatedAsset: !clip.sharedFrom,
    };
    this.npcResolvedClipCache.set(cacheKey, resolved);
    return resolved;
  }

  public getCompanionTexture(): THREE.Texture {
    const hd = this.hdCharacters.get('miaou_sprit');
    if (hd) return hd;
    return this.getOrCreate('companion_miaou_sprit', () => drawCompanionCanvas());
  }

  public getNpcTexture(npcId: string): THREE.Texture {
    if (
      npcId === 'mayor_moustache' ||
      npcId === 'kit_chat' ||
      npcId === 'innkeeper'
    ) {
      const hd = this.hdCharacters.get(npcId);
      if (hd) return hd;
    }
    return this.getOrCreate(`npc_${npcId}`, () => drawNpcCanvas(npcId));
  }

  // ==========================================================================
  // Bâtiments, Props & Accessoires de Donjon
  // ==========================================================================

  public getPropTexture(kind: PropKind): THREE.Texture {
    const hdPropByKind: Partial<Record<PropKind, HdPropKey>> = {
      oak_tree: 'tree_oak',
      twisted_tree: 'tree_dark',
      snow_pine: 'tree_pine_snow',
      rock: 'prop_rock',
      snow_rock: 'prop_rock_snow',
      flower_patch: 'prop_flower_patch',
      mushroom: 'prop_mushroom',
      house_cat: 'house_village',
      signpost: 'prop_signpost',
      fence: 'prop_fence',
    };
    const mapped = hdPropByKind[kind];
    if (mapped) {
      const hd = this.hdProps.get(mapped);
      if (hd) return hd;
    }
    if (kind === 'snow_rock') {
      const rockImg = this.getHdPropImage('prop_rock');
      if (rockImg) {
        return this.getOrCreate('prop_snow_rock_hd', () =>
          drawSnowRockHdCanvas(rockImg),
        );
      }
    }

    return this.getOrCreate(`prop_${kind}`, () => drawPropCanvas(kind));
  }

  public getBuildingTexture(kind: BuildingDef['kind']): THREE.Texture {
    const hdKey: HdPropKey =
      kind === 'inn'
        ? 'building_inn'
        : kind === 'forge'
          ? 'building_forge'
          : kind === 'quest_board'
            ? 'prop_quest_board'
            : 'house_village';
    const hd = this.hdProps.get(hdKey);
    if (hd) return hd;
    return this.getOrCreate(`building_${kind}`, () => drawBuildingCanvas(kind));
  }

  public getDungeonEntranceTexture(
    theme: 'ghost_cave' | 'dragon_lair',
    levelLabel: string,
    sealed: boolean,
  ): THREE.CanvasTexture {
    const hdImg = this.getHdPropImage('portal_dungeon');
    const tag = hdImg ? 'hd' : 'proc';
    const key = `entrance_${tag}_${theme}_${levelLabel}_${sealed ? 'sealed' : 'open'}`;
    return this.getOrCreate(key, () =>
      hdImg
        ? drawDungeonEntranceHdCanvas(hdImg, theme, levelLabel, sealed)
        : drawDungeonEntranceCanvas(theme, levelLabel, sealed),
    );
  }

  public getDungeonExitPortalTexture(
    theme: 'ghost_cave' | 'dragon_lair',
  ): THREE.CanvasTexture {
    return this.getOrCreate(`exit_portal_${theme}`, () =>
      drawDungeonExitPortalCanvas(theme),
    );
  }

  public getChestTexture(
    tier: ChestTier,
    state: 'closed' | 'open' | 'locked',
  ): THREE.Texture {
    const hdKey: HdPropKey = state === 'open' ? 'chest_open' : 'chest_closed';
    const hdImg = this.getHdPropImage(hdKey);
    if (hdImg) {
      const key = `chest_hd_${tier}_${state}`;
      return this.getOrCreate(key, () => drawChestHdCanvas(hdImg, tier, state));
    }
    const key = `chest_proc_${tier}_${state}`;
    return this.getOrCreate(key, () => drawChestCanvas(tier, state));
  }

  public getTorchTexture(frame: 0 | 1): THREE.Texture {
    const hdImg = this.getHdPropImage('prop_torch');
    if (hdImg) {
      return this.getOrCreate(`torch_hd_${frame}`, () =>
        drawTorchHdCanvas(hdImg, frame),
      );
    }
    return this.getOrCreate(`torch_proc_${frame}`, () => drawTorchCanvas(frame));
  }

  public getPillarTexture(
    theme: 'ghost_cave' | 'dragon_lair',
  ): THREE.Texture {
    const hdImg = this.getHdPropImage('prop_pillar');
    if (hdImg) {
      return this.getOrCreate(`pillar_hd_${theme}`, () =>
        drawPillarHdCanvas(hdImg, theme),
      );
    }
    return this.getOrCreate(`pillar_proc_${theme}`, () =>
      drawPillarCanvas(theme),
    );
  }

  public getHealingCrystalTexture(used: boolean): THREE.Texture {
    const hdImg = this.getHdPropImage('prop_crystal');
    if (hdImg) {
      return this.getOrCreate(`crystal_hd_${used ? 'used' : 'active'}`, () =>
        drawHealingCrystalHdCanvas(hdImg, used),
      );
    }
    return this.getOrCreate(`crystal_proc_${used ? 'used' : 'active'}`, () =>
      drawHealingCrystalCanvas(used),
    );
  }

  // ==========================================================================
  // Terrains PBR & Cartes Composites (Overworld + Donjons + Murs)
  // ==========================================================================

  public getOverworldPbrTextures(): OverworldPbrTextureSet {
    const cacheKey = this.hdLoaded ? 'overworld_pbr_hd' : 'overworld_pbr_proc';
    const existing = this.overworldPbrCache.get(cacheKey);
    if (existing) return existing;

    const canvases = generateOverworldPbrCanvases(this.getHdTerrainBundle());
    const set: OverworldPbrTextureSet = {
      map: this.createCanvasTexture(canvases.albedo, { isDataMap: false }),
      normalMap: this.createCanvasTexture(canvases.normal, { isDataMap: true }),
      roughnessMap: this.createCanvasTexture(canvases.roughness, { isDataMap: true }),
    };
    this.overworldPbrCache.set(cacheKey, set);
    return set;
  }

  public getOverworldMapTexture(): THREE.CanvasTexture {
    return this.getOverworldPbrTextures().map;
  }

  public getDungeonFloorPbrTextures(
    dungeon: DungeonDefinition,
  ): DungeonFloorPbrTextureSet {
    const cacheKey = `${dungeon.id}_${this.hdLoaded ? 'hd' : 'proc'}`;
    const existing = this.dungeonPbrCache.get(cacheKey);
    if (existing) return existing;

    const surfKey: HdSurfaceKey =
      dungeon.theme === 'dragon_lair' ? 'dungeon_dragon' : 'dungeon_ghost';
    const canvases = generateDungeonPbrCanvases(
      dungeon,
      this.getHdSurfaceImages(surfKey),
    );
    const set: DungeonFloorPbrTextureSet = {
      map: this.createCanvasTexture(canvases.albedo, { isDataMap: false }),
      normalMap: this.createCanvasTexture(canvases.normal, { isDataMap: true }),
      roughnessMap: this.createCanvasTexture(canvases.roughness, { isDataMap: true }),
      emissiveMap: this.createCanvasTexture(canvases.emissive, { isDataMap: false }),
    };
    this.dungeonPbrCache.set(cacheKey, set);
    return set;
  }

  public getDungeonFloorTexture(
    dungeon: DungeonDefinition,
  ): THREE.CanvasTexture {
    return this.getDungeonFloorPbrTextures(dungeon).map;
  }

  public getWallPbrTextures(
    theme: 'ghost_cave' | 'dragon_lair',
  ): WallPbrTextureSet {
    const cacheKey = `wall_${theme}_${this.hdLoaded ? 'hd' : 'proc'}`;
    const existing = this.wallPbrCache.get(cacheKey);
    if (existing) return existing;

    const surfKey: HdSurfaceKey =
      theme === 'dragon_lair' ? 'dungeon_dragon' : 'dungeon_ghost';
    const canvases = generateDungeonWallPbrCanvases(
      theme,
      this.getHdSurfaceImages(surfKey),
    );
    const set: WallPbrTextureSet = {
      map: this.createCanvasTexture(canvases.albedo, { isDataMap: false, repeat: true }),
      normalMap: this.createCanvasTexture(canvases.normal, { isDataMap: true, repeat: true }),
      roughnessMap: this.createCanvasTexture(canvases.roughness, { isDataMap: true, repeat: true }),
    };
    for (const tex of [set.map, set.normalMap, set.roughnessMap]) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }
    this.wallPbrCache.set(cacheKey, set);
    return set;
  }

  public getWallTexture(
    theme: 'ghost_cave' | 'dragon_lair',
  ): THREE.CanvasTexture {
    return this.getWallPbrTextures(theme).map;
  }

  public getSeaLabelTexture(text: string): THREE.CanvasTexture {
    return this.getOrCreate(`sea_label_${text}`, () => createSeaLabelCanvas(text));
  }

  // ==========================================================================
  // Utilitaires (Eau fallback, Ombres de contact, Particules & Portraits UI)
  // ==========================================================================

  public getWaterTexture(): THREE.CanvasTexture {
    return this.getOrCreate('water_tile', () => drawWaterTileCanvas(), true);
  }

  public getShadowTexture(): THREE.CanvasTexture {
    return this.getOrCreate('shadow_ellipse', () => drawShadowCanvas());
  }

  public getParticleTexture(): THREE.CanvasTexture {
    return this.getOrCreate('particle_orb', () => drawParticleCanvas());
  }

  public getStarParticleTexture(): THREE.CanvasTexture {
    return this.getOrCreate('particle_star', () => drawStarParticleCanvas());
  }

  public getAnimationManifest(): AnimationManifest | null {
    return this.animationManifest;
  }

  public getPropSheetTexture(
    id: 'portal_exit' | 'prop_torch' | 'chest_opening',
  ): THREE.Texture | null {
    return this.hdPropSheets.get(id) ?? null;
  }

  public getNpcSheetTexture(npcId: NpcId): THREE.Texture | null {
    return this.hdNpcStateSheets.get(`${npcId}|sheet`) ?? null;
  }

  public getHeroLanternTexture(lit = true): THREE.Texture {
    return this.getOrCreate(`hero_lantern_${lit ? 'lit' : 'off'}`, () =>
      drawHeroLanternCanvas(lit),
    );
  }

  public getEquipmentOverlayTexture(itemId: string): THREE.Texture | null {
    return this.hdEquipment.get(itemId as HdEquipmentKey) ?? null;
  }

  /**
   * Retourne la texture d'armure recadrée/centrée sur son axe de torse réel ainsi que
   * sa transformation idéale (agrandie si trop petite, rapetissée si trop grande).
   * Utilise strictement le PNG existant (zéro génération d'image).
   */
  public getFittedArmorOverlay(
    itemId: string,
  ): { texture: THREE.Texture; fit: ArmorFitTransform } | null {
    if (!itemId) return null;
    const cached = this.fittedArmorCache.get(itemId);
    if (cached) {
      return { texture: cached.texture, fit: cached.fit };
    }

    const rawTex = this.hdEquipment.get(itemId as HdEquipmentKey);
    if (!rawTex) return null;

    const def = getEquipmentDefinition(itemId);
    const shape = def?.visualStyle.shape;
    const img = extractHtmlImage(rawTex);
    if (img && typeof document !== 'undefined') {
      const fitted = createFittedArmorCanvas(img, shape);
      const texture = this.createCanvasTexture(fitted.canvas, { repeat: false });
      const fit = computeIdealArmorFit(fitted.metrics, shape);
      this.fittedArmorCache.set(itemId, { texture, ownsTexture: true, fit });
      return { texture, fit };
    }

    const metrics = measureArmorImageMetrics(undefined, shape);
    const fit = computeIdealArmorFit(metrics, shape);
    this.fittedArmorCache.set(itemId, { texture: rawTex, ownsTexture: false, fit });
    return { texture: rawTex, fit };
  }

  /**
   * Retourne la texture normalisée (marges transparentes recadrées, orientation canonique
   * unifiée et pivot calibré) pour n'importe quel équipement du héros.
   * Utilise les PNG existants ou un canvas procédural zéro-404 pour les armes sans PNG.
   */
  public getNormalizedEquipmentOverlay(itemId: string): {
    texture: THREE.Texture;
    calibration: EquipmentCalibrationEntry;
    fit: NormalizedEquipmentFit;
  } | null {
    if (!itemId) return null;
    const cached = this.normalizedEquipmentCache.get(itemId);
    if (cached) {
      return {
        texture: cached.texture,
        calibration: cached.calibration,
        fit: cached.fit,
      };
    }

    const calibration = getEquipmentCalibration(itemId);
    if (!calibration) return null;

    const rawTex = this.hdEquipment.get(itemId as HdEquipmentKey);
    if (!rawTex) {
      const def = getEquipmentDefinition(itemId);
      if (def?.slot !== 'weapon') return null;

      if (typeof document !== 'undefined') {
        const procCanvas = drawProceduralWeaponCanvas(def);
        const normalized = createNormalizedEquipmentCanvas(procCanvas, calibration);
        const texture = this.createCanvasTexture(normalized.canvas, { repeat: false });
        const fit = computeNormalizedEquipmentFit(calibration, normalized.bounds);
        this.normalizedEquipmentCache.set(itemId, {
          texture,
          ownsTexture: true,
          calibration,
          fit,
        });
        return { texture, calibration, fit };
      }

      const texture = this.getOrCreateHeadlessDataTexture(`proc_weapon_${itemId}`);
      const fit = computeNormalizedEquipmentFit(calibration);
      this.normalizedEquipmentCache.set(itemId, {
        texture,
        ownsTexture: false,
        calibration,
        fit,
      });
      return { texture, calibration, fit };
    }

    // Pour les armures, réutilise exactement le pipeline d'ajustement de torse idéal
    if (calibration.slot === 'armor') {
      const fittedArmor = this.getFittedArmorOverlay(itemId);
      if (!fittedArmor) return null;
      const fit: NormalizedEquipmentFit = {
        quadW: fittedArmor.fit.quadW,
        quadH: fittedArmor.fit.quadH,
        visibleW: fittedArmor.fit.visibleW,
        visibleH: fittedArmor.fit.visibleH,
        meshOffsetX: 0,
        meshOffsetY: 0,
      };
      this.normalizedEquipmentCache.set(itemId, {
        texture: fittedArmor.texture,
        ownsTexture: false,
        calibration,
        fit,
      });
      return { texture: fittedArmor.texture, calibration, fit };
    }

    const img = extractHtmlImage(rawTex);
    if (img && typeof document !== 'undefined') {
      const normalized = createNormalizedEquipmentCanvas(img, calibration);
      const texture = this.createCanvasTexture(normalized.canvas, { repeat: false });
      const fit = computeNormalizedEquipmentFit(calibration, normalized.bounds);
      this.normalizedEquipmentCache.set(itemId, {
        texture,
        ownsTexture: true,
        calibration,
        fit,
      });
      return { texture, calibration, fit };
    }

    const fit = computeNormalizedEquipmentFit(calibration);
    this.normalizedEquipmentCache.set(itemId, {
      texture: rawTex,
      ownsTexture: false,
      calibration,
      fit,
    });
    return { texture: rawTex, calibration, fit };
  }

  public getLamppostTexture(lit: boolean): THREE.CanvasTexture {
    return this.getOrCreate(`prop_lamppost_${lit ? 'lit' : 'off'}`, () =>
      drawLamppostCanvas(lit),
    );
  }

  public getChestOpeningTexture(
    stepIndex: number,
    tier: 'common' | 'rare' | 'epic' | 'boss',
  ): THREE.CanvasTexture {
    const clamped = Math.max(0, Math.min(5, Math.floor(stepIndex)));
    const progress = clamped / 5;
    const closedImg = this.getHdPropImage('chest_closed');
    const openImg = this.getHdPropImage('chest_open');
    return this.getOrCreate(
      `chest_opening_${tier}_${clamped}_${closedImg ? 'hd' : 'proc'}`,
      () => drawChestOpeningFrameCanvas(closedImg, openImg, progress, tier),
    );
  }

  public resolveEnemySixStateSheetGrid(
    enemyKey: HdEnemySheetKey,
    state: EnemyAnimState,
    texWidth: number,
    texHeight: number,
  ): SpriteGridSpec {
    return resolveEnemySixStateGrid(enemyKey, state, texWidth, texHeight);
  }

  public getHeroPortraitUrl(equipped: Record<EquipSlot, string>): string {
    return drawHeroPortraitDataUrl(equipped, this.getHeroModularImages());
  }

  public getHeroFullPreviewUrl(equipped: Record<EquipSlot, string>): string {
    return drawHeroFullPreviewDataUrl(equipped, this.getHeroModularImages());
  }

  public getSpeakerPortraitUrl(
    portraitId: SpeakerPortraitId,
    equipped?: Record<EquipSlot, string>,
  ): string {
    const hdPortraits: HdPortraitImages = {
      miaou_sprit: this.getHdCharacterImage('miaou_sprit'),
      mayor_moustache: this.getHdCharacterImage('mayor_moustache'),
      kit_chat: this.getHdCharacterImage('kit_chat'),
      innkeeper: this.getHdCharacterImage('innkeeper'),
      boss_rat_king: this.getHdCharacterImage('boss_rat_king'),
      boss_dragon_claw: this.getHdCharacterImage('boss_dragon_claw'),
      heroModular: this.getHeroModularImages(),
    };
    return drawSpeakerPortraitDataUrl(portraitId, equipped, hdPortraits);
  }

  public getMiniMapUrl(): string {
    return getOverworldMiniMapDataUrl(this.getHdTerrainBundle());
  }

  public hasLoadedVfxTexture(id: VfxAssetId): boolean {
    return this.vfxTextures.has(id);
  }

  public getVfxTexture(id: VfxAssetId): THREE.Texture {
    const loaded = this.vfxTextures.get(id);
    if (loaded) return loaded;

    const entry = VFX_ASSETS[id];
    const repeat = entry?.kind === 'normalMap';
    const key = `vfx_fallback_${id}`;
    const existing = this.headlessCache.get(key);
    if (existing) return existing;

    if (entry?.dataMap) {
      const data = new Uint8Array([128, 128, 255, 255]);
      const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      tex.name = key;
      configureDioramaTexture(tex, {
        isDataMap: true,
        repeat: true,
        anisotropy: this.maxAnisotropy,
      });
      this.headlessCache.set(key, tex);
      return tex;
    }

    if (typeof document !== 'undefined') {
      return id === 'melee_slash_trail' || id === 'projectile_trail'
        ? this.getParticleTexture()
        : this.getOrCreateHeadlessDataTexture(key, repeat);
    }
    return this.getOrCreateHeadlessDataTexture(key, repeat);
  }

  public getArchipelagoMapCanvas(): HTMLCanvasElement {
    return getArchipelagoMapCanvas(this.getHdTerrainBundle());
  }

  public get size(): number {
    let surfaceCount = 0;
    for (const s of this.hdSurfaces.values()) {
      surfaceCount += Object.values(s).filter(Boolean).length;
    }
    return (
      this.cache.size +
      this.headlessCache.size +
      this.hdCharacters.size +
      this.hdHeroSheets.size +
      this.hdEnemySheets.size +
      this.hdEnemyPhase2Sheets.size +
      this.hdEnemyStateSheets.size +
      this.hdNpcStateSheets.size +
      this.hdEquipment.size +
      this.hdCapeFabrics.size +
      this.hdProps.size +
      this.vfxTextures.size +
      surfaceCount +
      this.overworldPbrCache.size * 3 +
      this.dungeonPbrCache.size * 4 +
      this.wallPbrCache.size * 3
    );
  }

  public dispose(): void {
    this.flushRetiredTextures();
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
    for (const tex of this.headlessCache.values()) {
      tex.dispose();
    }
    this.headlessCache.clear();
    for (const tex of this.hdCharacters.values()) {
      tex.dispose();
    }
    this.hdCharacters.clear();
    for (const tex of this.hdHeroSheets.values()) {
      tex.dispose();
    }
    this.hdHeroSheets.clear();
    this.hdHeroSheetGridOverrides.clear();
    this.hdHeroFrameSequences.clear();
    for (const tex of this.hdEnemySheets.values()) {
      tex.dispose();
    }
    this.hdEnemySheets.clear();
    for (const tex of this.hdEnemyPhase2Sheets.values()) {
      tex.dispose();
    }
    this.hdEnemyPhase2Sheets.clear();
    for (const tex of this.hdEnemyStateSheets.values()) {
      tex.dispose();
    }
    this.hdEnemyStateSheets.clear();
    this.hdEnemyGridOverrides.clear();
    this.hdEnemyFrameSequences.clear();
    for (const tex of this.hdNpcStateSheets.values()) {
      tex.dispose();
    }
    this.hdNpcStateSheets.clear();
    this.hdNpcGridOverrides.clear();
    this.hdNpcFrameSequences.clear();
    for (const entry of this.fittedArmorCache.values()) {
      if (entry.ownsTexture) {
        entry.texture.dispose();
      }
    }
    this.fittedArmorCache.clear();
    for (const entry of this.normalizedEquipmentCache.values()) {
      if (entry.ownsTexture) {
        entry.texture.dispose();
      }
    }
    this.normalizedEquipmentCache.clear();
    for (const tex of this.hdEquipment.values()) {
      tex.dispose();
    }
    this.hdEquipment.clear();
    for (const bucket of this.hdEquipmentSheets.values()) {
      for (const tex of Object.values(bucket)) {
        tex?.dispose();
      }
    }
    this.hdEquipmentSheets.clear();
    for (const tex of this.hdCapeFabrics.values()) {
      tex.dispose();
    }
    this.hdCapeFabrics.clear();
    this.heroModularCache = null;
    this.heroResolvedClipCache.clear();
    this.enemyResolvedClipCache.clear();
    this.npcResolvedClipCache.clear();
    for (const tex of this.hdProps.values()) {
      tex.dispose();
    }
    this.hdProps.clear();
    for (const tex of this.hdPropSheets.values()) {
      tex.dispose();
    }
    this.hdPropSheets.clear();
    for (const tex of this.vfxTextures.values()) {
      tex.dispose();
    }
    this.vfxTextures.clear();
    for (const surf of this.hdSurfaces.values()) {
      for (const tex of Object.values(surf)) {
        tex?.dispose();
      }
    }
    this.hdSurfaces.clear();
    for (const set of this.overworldPbrCache.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
    }
    this.overworldPbrCache.clear();
    for (const set of this.dungeonPbrCache.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
      set.emissiveMap.dispose();
    }
    this.dungeonPbrCache.clear();
    for (const set of this.wallPbrCache.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
    }
    this.wallPbrCache.clear();
  }
}
