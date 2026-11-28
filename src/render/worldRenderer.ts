import * as THREE from 'three';
import type {
  BuildingDef,
  ChestInstance,
  ChestTier,
  DungeonDefinition,
  GameEvent,
  GameState,
  PropKind,
  ZoneId,
} from '../game/types';
import {
  OVERWORLD_DATA,
  OVERWORLD_HALF_SIZE,
  getBiomeAt,
  isInsideIsland,
  isInsideVillage,
} from '../data/worldData';
import {
  ALL_NEW_ISLANDS,
  NEW_ISLANDS,
  getBiomeAtNewIsland,
  isInsideNewIsland,
} from '../data/worldIslands';
import { getIslandTerrainHeightLocal } from '../game/shorelineNavigation';
import { DUNGEONS } from '../data/dungeonsData';
import { DUNGEON_PALETTE, GOLD_LIGHT } from '../art/palette';
import {
  CANONICAL_16_SPRITESHEETS,
  type SpriteGridSpec,
  type SpriteUvRect,
  applyUvRectToTexture,
  computeGridFrameUvInto,
  createSpriteUvRect,
  getTextureDimensions,
  resolveMayorMoustacheGrid,
} from '../art/hdAssets';
import { TextureRegistry } from '../art/textureRegistry';
import {
  type WaterDynamicUpdate,
  createWaterGeometry,
  createWaterMaterial,
  updateWaterMaterial,
} from './shaders/waterShader';
import type { WeatherSnapshot } from './weatherSystem';
import { enableSpriteLighting } from './spriteLighting';
import {
  SHARED_PROP_WIND_UNIFORMS,
  applyEmissivePulseShader,
  applyWindSwayShader,
  createPortalExitVortexMaterial,
  createPortalRunicSealMaterial,
} from './shaders/propShaders';
import type { DynamicLightFlickerMode } from './sceneManager';

const SPRITE_TILT_X = -0.48;
const WATER_LEVEL_Y = -0.14;
const DRAGON_LAIR_CLEARED_EMISSIVE = new THREE.Color(0xffe6ba);
const DRAGON_LAIR_CLEARED_COLOR = new THREE.Color(0xfff2d9);
const DRAGON_LAIR_HEAT_EMISSIVE = new THREE.Color(0xff3d14);

export interface TorchLightPosition {
  x: number;
  y: number;
  z: number;
  intensity?: number;
  distance?: number;
  outdoor?: boolean;
  color?: number;
  flickerMode?: DynamicLightFlickerMode;
}

// Sources lumineuses réelles des lampadaires extérieurs (PointLights physiques decay=2).
// Les 8 plus proches sont activées par le pool de SceneManager et synchronisées au shader 2.5D.
export const OVERWORLD_LAMP_LIGHTS: readonly TorchLightPosition[] = [
  { x: 2.4, y: 2.35, z: 21.0, intensity: 13.0, distance: 15.0, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: -4.4, y: 2.35, z: 23.2, intensity: 12.2, distance: 15.0, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 5.6, y: 2.35, z: 23.2, intensity: 12.2, distance: 15.0, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 2.8, y: 2.35, z: 31.2, intensity: 12.0, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 0.3, y: 2.35, z: 5.0, intensity: 12.0, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 4.8, y: 2.35, z: -19.0, intensity: 12.0, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 8.2, y: 2.35, z: -36.0, intensity: 12.2, distance: 15.0, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 17.0, y: 2.35, z: 17.0, intensity: 12.0, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 27.0, y: 2.35, z: 9.0, intensity: 11.5, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: -18.0, y: 2.35, z: 10.0, intensity: 12.0, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: -32.0, y: 2.35, z: -10.0, intensity: 11.5, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 86.0, y: 2.35, z: 48.0, intensity: 11.8, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 68.0, y: 2.35, z: -84.0, intensity: 11.8, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: -79.0, y: 2.35, z: 58.0, intensity: 11.8, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: -111.0, y: 2.35, z: -74.0, intensity: 11.8, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
  { x: 18.0, y: 2.35, z: -107.0, intensity: 11.8, distance: 14.5, outdoor: true, color: 0xffbe55, flickerMode: 'lamp' },
];

export type TorchLightsHandler = (positions: readonly TorchLightPosition[]) => void;

interface SwayEntry {
  mesh: THREE.Mesh;
  phase: number;
  amplitude: number;
}

interface PortalVisual {
  id: string;
  theme: 'ghost_cave' | 'dragon_lair';
  levelLabel: string;
  requiresRunicKey: boolean;
  material: THREE.MeshStandardMaterial;
  mesh: THREE.Mesh;
  sealMesh: THREE.Mesh;
  sealMat: THREE.ShaderMaterial;
  sealed: boolean;
  barrierRing: THREE.Mesh | null;
}

const TORCH_SHEET_GRID: SpriteGridSpec = {
  cols: CANONICAL_16_SPRITESHEETS.prop_torch.cols,
  rows: CANONICAL_16_SPRITESHEETS.prop_torch.rows,
  frameCount: CANONICAL_16_SPRITESHEETS.prop_torch.frameCount,
  startFrame: 0,
};

const PORTAL_EXIT_SHEET_GRID: SpriteGridSpec = {
  cols: CANONICAL_16_SPRITESHEETS.portal_exit.cols,
  rows: CANONICAL_16_SPRITESHEETS.portal_exit.rows,
  frameCount: CANONICAL_16_SPRITESHEETS.portal_exit.frameCount,
  startFrame: 0,
};

const CHEST_OPENING_SHEET_GRID: SpriteGridSpec = {
  cols: 5,
  rows: 3,
  frameCount: 15,
  startFrame: 0,
};

interface ChestVisual {
  id: string;
  tier: ChestTier;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  shadow: THREE.Mesh;
  stateKey: 'closed' | 'opening' | 'open' | 'locked';
  openAnimProgress: number;
  openAnimFrame: number;
  openSourceSheet: THREE.Texture | null;
  openSheetTex: THREE.Texture | null;
  uvRect: SpriteUvRect;
  baseY: number;
  phase: number;
}

interface CrystalVisual {
  id: string;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  shadow: THREE.Mesh;
  used: boolean;
  phase: number;
  shakeTimer: number;
}

interface InteractivePropVisual {
  mesh: THREE.Mesh;
  baseX: number;
  baseY: number;
  baseRotX: number;
  baseRotZ: number;
  shakeTimer: number;
  hitDirX: number;
  hitDirZ: number;
  amplitude: number;
}

interface GrassTuftData {
  x: number;
  y: number;
  z: number;
  scale: number;
  phase: number;
  rotY: number;
  bendX: number;
  bendZ: number;
}

interface WindPetalParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
  scale: number;
}

interface TorchVisual {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  phase: number;
  frame: number;
  sourceSheet: THREE.Texture | null;
  sheetTex: THREE.Texture | null;
  uvRect: SpriteUvRect;
  light?: THREE.PointLight;
  baseIntensity: number;
}

interface LamppostVisual {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  lit: boolean;
  phase: number;
}

interface BuildingVisual {
  kind: BuildingDef['kind'];
  x: number;
  z: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  phase: number;
}

interface NpcVisual {
  id: string;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseScaleX: number;
  baseScaleY: number;
  phase: number;
  state: 'idle' | 'talk' | 'greet';
  sourceSheet: THREE.Texture | null;
  sheetTex: THREE.Texture | null;
  uvRect: SpriteUvRect;
  animFrame: number;
}

interface RefreshableBinding {
  material: THREE.MeshStandardMaterial;
  resolve: () => THREE.Texture;
  syncEmissiveMap?: boolean;
}

const PROP_BASE_SIZES: Record<
  PropKind,
  { w: number; h: number; shadowR: number; sinkRatio: number; sways?: boolean }
> = {
  oak_tree: { w: 4.5, h: 4.7, shadowR: 1.55, sinkRatio: 0.048, sways: false },
  twisted_tree: { w: 4.8, h: 5.0, shadowR: 1.6, sinkRatio: 0.05, sways: false },
  snow_pine: { w: 4.2, h: 5.1, shadowR: 1.45, sinkRatio: 0.052, sways: false },
  rock: { w: 2.3, h: 2.1, shadowR: 1.05, sinkRatio: 0.048 },
  snow_rock: { w: 2.5, h: 2.2, shadowR: 1.1, sinkRatio: 0.048 },
  flower_patch: { w: 1.8, h: 1.5, shadowR: 0, sinkRatio: 0.0 },
  mushroom: { w: 1.6, h: 1.6, shadowR: 0.5, sinkRatio: 0.048 },
  house_cat: { w: 4.6, h: 4.6, shadowR: 1.9, sinkRatio: 0.032 },
  signpost: { w: 1.8, h: 2.0, shadowR: 0.45, sinkRatio: 0.048 },
  fence: { w: 2.2, h: 1.4, shadowR: 0, sinkRatio: 0.048 },
  bush: { w: 1.95, h: 1.55, shadowR: 0.72, sinkRatio: 0.04 },
  barrel: { w: 1.35, h: 1.45, shadowR: 0.55, sinkRatio: 0.045 },
};

/**
 * Échantillonne la hauteur exacte du sol sur l'île contenant `(worldX, worldZ)`
 * (Félingard ou l'une des 5 îles de l'archipel) afin qu'aucun bâtiment ou prop
 * ne flotte jamais au-dessus d'une pente ou d'un rebord de terrain.
 */
function sampleOverworldGroundY(worldX: number, worldZ: number): number {
  let bestY = getIslandTerrainHeightLocal('felingard', worldX, worldZ);
  let bestDistSq = worldX * worldX + worldZ * worldZ;
  for (const islandId of ALL_NEW_ISLANDS) {
    const isl = NEW_ISLANDS[islandId];
    const lx = worldX - isl.centerX;
    const lz = worldZ - isl.centerZ;
    const dSq = lx * lx + lz * lz;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestY = getIslandTerrainHeightLocal(islandId, lx, lz);
    }
  }
  return Math.max(WATER_LEVEL_Y + 0.02, bestY);
}

/**
 * Génère une ombre d'occlusion de contact isométrique (losange adouci + ancrage
 * sombre sous les murs de fondation) pour souder visuellement les bâtiments 2.5D
 * au sol sans aucun effet de flottement ni de rupture d'ombre.
 */
function createBuildingContactShadowTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  const drawDiamond = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: string,
  ): void => {
    ctx.beginPath();
    ctx.moveTo(cx, cy - ry); // coin arrière
    ctx.lineTo(cx + rx, cy); // coin droit
    ctx.lineTo(cx, cy + ry); // coin avant
    ctx.lineTo(cx - rx, cy); // coin gauche
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  };

  // Halo ambiant doux s'étendant légèrement vers l'arrière-gauche (opposé au soleil)
  ctx.save();
  ctx.filter = 'blur(18px)';
  drawDiamond(120, 122, 108, 102, 'rgba(10, 7, 4, 0.42)');
  ctx.restore();

  // Occlusion de contact principale couvrant l'emprise au sol complète du bâtiment
  ctx.save();
  ctx.filter = 'blur(9px)';
  drawDiamond(128, 128, 96, 90, 'rgba(8, 5, 3, 0.78)');
  ctx.restore();

  // Ligne d'ancrage dense sous le socle pierre/bois (supprime tout jour lumineux)
  ctx.save();
  ctx.filter = 'blur(4px)';
  drawDiamond(128, 132, 82, 76, 'rgba(6, 4, 2, 0.85)');
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Construit un maillage diorama 3D de l'île de Félingard à partir de la source de vérité
 * `getIslandTerrainHeightLocal` (plages douces + escarpements rocheux alignés au millimètre
 * avec les collisions maritimes et la ligne d'eau `y = -0.14` à `R_coast + 0.60`).
 */
function createIslandTerrainGeometry(mapSize: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(mapSize, mapSize, 256, 256);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, getIslandTerrainHeightLocal('felingard', x, z));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function createNewIslandTerrainGeometry(
  islandId: (typeof ALL_NEW_ISLANDS)[number],
  segments: number,
): THREE.PlaneGeometry {
  const island = NEW_ISLANDS[islandId];
  const mapSize = (island.radius + 5) * 2;
  const geo = new THREE.PlaneGeometry(mapSize, mapSize, segments, segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, getIslandTerrainHeightLocal(islandId, x, z));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

const ISLAND_TINTS: Record<(typeof ALL_NEW_ISLANDS)[number], number> = {
  tropical: 0xc3b27e,
  mountain: 0xa8c2ce,
  mystic: 0xaaa0c5,
  wild: 0x82aa68,
  archipelago: 0x93bd83,
};

function applyBoxWorldUVs(
  geo: THREE.BoxGeometry,
  w: number,
  h: number,
  d: number,
  tileWorld = 3.0,
): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const norm = geo.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(norm.getX(i));
    const nz = Math.abs(norm.getZ(i));
    const uScale = nx > 0.5 ? d / tileWorld : w / tileWorld;
    const vScale = nx > 0.5 || nz > 0.5 ? h / tileWorld : d / tileWorld;
    uv.setXY(i, uv.getX(i) * uScale, uv.getY(i) * vScale);
  }
  uv.needsUpdate = true;
}

export class WorldRenderer {
  private readonly scene: THREE.Scene;
  private readonly textures: TextureRegistry;
  private readonly rootGroup = new THREE.Group();
  private zoneGroup: THREE.Group | null = null;
  private currentZoneId: ZoneId | null = null;
  private torchLightsHandler: TorchLightsHandler | null = null;

  // Géométries partagées réutilisables (disposées uniquement dans dispose())
  private readonly spriteGeo: THREE.PlaneGeometry;
  private readonly glowGeo: THREE.PlaneGeometry;
  private readonly shadowGeo: THREE.PlaneGeometry;
  private readonly buildingShadowTex: THREE.CanvasTexture | null;
  private readonly highlightRingGeo: THREE.RingGeometry;
  private readonly highlightRingMat: THREE.MeshBasicMaterial;
  private readonly highlightRing: THREE.Mesh;

  // Matériaux & géométries temporaires de la zone courante à disposer au changement de zone
  private zoneDisposables: Array<{ dispose(): void }> = [];

  // Références aux surfaces PBR actives pour hot-swap HD sans recharge
  private overworldGroundMat: THREE.MeshStandardMaterial | null = null;
  private islandGroundMats: THREE.MeshStandardMaterial[] = [];
  private activeDungeon: DungeonDefinition | null = null;
  private dungeonFloorMat: THREE.MeshStandardMaterial | null = null;
  private dungeonWallSideMat: THREE.MeshStandardMaterial | null = null;
  private refreshableBindings: RefreshableBinding[] = [];

  // Objets animés dynamiquement
  private waterMesh: THREE.Mesh | null = null;
  private waterTex: THREE.CanvasTexture | null = null;
  private waterShaderMat: THREE.ShaderMaterial | null = null;
  private seaLabelMats: THREE.MeshBasicMaterial[] = [];
  private readonly waterUpdatePayload: WaterDynamicUpdate = {
    time: 0,
    fogNear: 115,
    fogFar: 265,
    waveAmplitude: 1.18,
    waveChoppiness: 0.48,
    stormIntensity: 0,
    windDirX: 0.86,
    windDirZ: 0.51,
    windIntensity: 0.2,
    sunGlintIntensity: 1.05,
    causticsIntensity: 0.9,
    sunsetFactor: 0,
    nightFactor: 0,
    lightningFlash: 0,
    shipX: 0,
    shipZ: 53.03,
    shipHeading: 0,
    shipSignedSpeedRatio: 0,
    shipAbsSpeedRatio: 0,
    shipTurnRate: 0,
    shipActive: true,
  };
  private swayProps: SwayEntry[] = [];
  private portals: PortalVisual[] = [];
  private exitPortalMesh: THREE.Mesh | null = null;
  private exitPortalMat: THREE.MeshStandardMaterial | null = null;
  private exitPortalVortexMat: THREE.ShaderMaterial | null = null;
  private exitPortalRing: THREE.Mesh | null = null;
  private exitPortalSourceSheet: THREE.Texture | null = null;
  private exitPortalSheetTex: THREE.Texture | null = null;
  private readonly exitPortalUvRect: SpriteUvRect = createSpriteUvRect();
  private exitPortalFrame = -1;
  private torches: TorchVisual[] = [];
  private lampposts: LamppostVisual[] = [];
  private buildings: BuildingVisual[] = [];
  private npcs: NpcVisual[] = [];
  private chests = new Map<string, ChestVisual>();
  private crystals = new Map<string, CrystalVisual>();
  private interactiveProps = new Map<string, InteractivePropVisual>();
  private readonly seenChestIds = new Set<string>();
  private readonly seenCrystalIds = new Set<string>();
  private flowerPatches: Array<{
    mesh: THREE.Mesh;
    x: number;
    z: number;
    baseY: number;
    baseRotX: number;
    baseRotZ: number;
    lift: number;
    bendX: number;
    bendZ: number;
  }> = [];
  private grassTuftMesh: THREE.InstancedMesh | null = null;
  private grassTufts: GrassTuftData[] = [];
  private windPetalMesh: THREE.InstancedMesh | null = null;
  private windPetals: WindPetalParticle[] = [];
  private readonly decorDummy = new THREE.Object3D();
  private readonly decorColorScratch = new THREE.Color();

  private animTime = 0;

  constructor(
    scene: THREE.Scene,
    textures: TextureRegistry,
    torchLightsHandler?: TorchLightsHandler,
  ) {
    this.scene = scene;
    this.textures = textures;
    this.torchLightsHandler = torchLightsHandler ?? null;
    this.rootGroup.name = 'WorldRoot';
    this.scene.add(this.rootGroup);

    // Plan unitaire avec pivot au bas-centre (y ∈ [0, 1])
    this.spriteGeo = new THREE.PlaneGeometry(1, 1);
    this.spriteGeo.translate(0, 0.5, 0);

    // Plan unitaire centré pour halos additifs
    this.glowGeo = new THREE.PlaneGeometry(1, 1);

    // Plan d'ombre circulaire de contact au sol
    this.shadowGeo = new THREE.PlaneGeometry(2, 2);
    this.shadowGeo.rotateX(-Math.PI / 2);
    this.buildingShadowTex = createBuildingContactShadowTexture();

    // Anneau doré HDR discret soulignant l'objet interactif le plus proche
    this.highlightRingGeo = new THREE.RingGeometry(0.96, 1.12, 48);
    this.highlightRingGeo.rotateX(-Math.PI / 2);
    this.highlightRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(GOLD_LIGHT).multiplyScalar(0.95),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.highlightRing = new THREE.Mesh(this.highlightRingGeo, this.highlightRingMat);
    this.highlightRing.position.y = 0.052;
    this.highlightRing.renderOrder = 2;
    this.highlightRing.visible = false;
    this.highlightRing.userData.skipSSAO = true;
    this.rootGroup.add(this.highlightRing);
  }

  public setTorchLightsHandler(handler: TorchLightsHandler | null): void {
    this.torchLightsHandler = handler;
  }

  private trackDisposable<T extends { dispose(): void }>(item: T): T {
    this.zoneDisposables.push(item);
    return item;
  }

  private cloneTrackedSheet(source: THREE.Texture): THREE.Texture {
    const cloned = source.clone();
    cloned.colorSpace = source.colorSpace;
    cloned.generateMipmaps = false;
    cloned.minFilter = THREE.LinearFilter;
    cloned.magFilter = THREE.LinearFilter;
    cloned.wrapS = THREE.ClampToEdgeWrapping;
    cloned.wrapT = THREE.ClampToEdgeWrapping;
    cloned.needsUpdate = true;
    return this.trackDisposable(cloned);
  }

  private createShadowMesh(
    x: number,
    z: number,
    rx: number,
    rz = rx * 0.72,
    options?: {
      y?: number;
      opacity?: number;
      texture?: THREE.Texture | null;
      rotationY?: number;
    },
  ): THREE.Mesh {
    const mat = this.trackDisposable(
      new THREE.MeshBasicMaterial({
        map: options?.texture ?? this.textures.getShadowTexture(),
        transparent: true,
        opacity: options?.opacity ?? 0.42,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(this.shadowGeo, mat);
    mesh.position.set(x, (options?.y ?? 0) + 0.026, z);
    mesh.scale.set(rx, 1, rz);
    if (options?.rotationY) {
      mesh.rotation.y = options.rotationY;
    }
    mesh.renderOrder = 1;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.skipSSAO = true;
    return mesh;
  }

  private addBuildingGroundContactShadow(
    group: THREE.Group,
    kind: BuildingDef['kind'],
    x: number,
    z: number,
    groundY: number,
    w: number,
    h: number,
  ): void {
    if (kind === 'quest_board') {
      // Ancrage individuel sous chacun des deux poteaux bois + ombre portée reliant l'entraxe
      group.add(
        this.createShadowMesh(x - w * 0.27, z - 0.04, 0.44, 0.28, {
          y: groundY,
          opacity: 0.78,
        }),
      );
      group.add(
        this.createShadowMesh(x + w * 0.29, z - 0.44, 0.44, 0.28, {
          y: groundY,
          opacity: 0.78,
        }),
      );
      group.add(
        this.createShadowMesh(x + 0.04, z - 0.30, w * 0.44, 0.46, {
          y: groundY - 0.003,
          opacity: 0.44,
          rotationY: 0.24,
        }),
      );
      return;
    }

    // Emprise isométrique projetée exactement sous les murs gauche, droit et le coin avant
    const isoTex = this.buildingShadowTex ?? this.textures.getShadowTexture();
    const xBias = kind === 'forge' ? 0.05 : kind === 'inn' ? 0.04 : 0.02;
    const zBackOffset =
      kind === 'house' ? h * 0.17 : kind === 'forge' ? h * 0.15 : h * 0.15;
    const rx = w * (kind === 'house' ? 0.54 : 0.52);
    const rz = h * (kind === 'house' ? 0.31 : 0.28);

    group.add(
      this.createShadowMesh(x + xBias, z - zBackOffset, rx, rz, {
        y: groundY,
        opacity: 0.9,
        texture: isoTex,
      }),
    );
  }

  /**
   * Publie toutes les vraies sources lumineuses dynamiques de la zone active
   * (lampadaires, foyer de forge, auberge, portails, torches, cristaux actifs, coffres rares)
   * vers le pool de vraies PointLights de SceneManager (ZÉRO faux halo billboard).
   */
  private publishZoneLights(): void {
    if (!this.torchLightsHandler) return;
    const lights: TorchLightPosition[] = [];

    if (this.currentZoneId === 'overworld') {
      for (const lp of OVERWORLD_LAMP_LIGHTS) {
        lights.push(lp);
      }
      for (const b of OVERWORLD_DATA.buildings) {
        const groundY = sampleOverworldGroundY(b.x, b.z);
        if (b.kind === 'forge') {
          lights.push({
            x: b.x + 0.15,
            y: groundY + 1.55,
            z: b.z + 1.1,
            intensity: 10.5,
            distance: 14.0,
            outdoor: false,
            color: 0xff7824,
            flickerMode: 'forge',
          });
        } else if (b.kind === 'inn') {
          lights.push({
            x: b.x,
            y: groundY + 1.85,
            z: b.z + 1.4,
            intensity: 8.5,
            distance: 13.0,
            outdoor: true,
            color: 0xffc86b,
            flickerMode: 'lamp',
          });
        }
      }
      for (const portal of OVERWORLD_DATA.dungeonPortals) {
        const isDragon = portal.targetZoneId === 'dungeon_dragon_lair';
        const groundY = sampleOverworldGroundY(portal.x, portal.z);
        lights.push({
          x: portal.x,
          y: groundY + 1.9,
          z: portal.z + 0.65,
          intensity: 9.0,
          distance: 13.5,
          outdoor: false,
          color: isDragon ? 0xff6d28 : 0x8d68ff,
          flickerMode: 'magic',
        });
      }
    } else if (this.activeDungeon) {
      const dungeon = this.activeDungeon;
      const tiltAbs = Math.abs(SPRITE_TILT_X);
      const flameDist = 1.35;
      const flameLocalY = flameDist * Math.cos(tiltAbs);
      const flameOffsetZ = -flameDist * Math.sin(tiltAbs);
      for (const pos of dungeon.torches) {
        lights.push({
          x: pos.x,
          y: flameLocalY + 0.14,
          z: pos.z + flameOffsetZ,
          distance: 16.5,
          flickerMode: 'torch',
        });
      }
      lights.push({
        x: dungeon.exitPortal.x,
        y: 1.65,
        z: dungeon.exitPortal.z + 0.4,
        intensity: 10.5,
        distance: 14.5,
        outdoor: false,
        color: dungeon.theme === 'dragon_lair' ? 0xffae42 : 0x5edbff,
        flickerMode: 'magic',
      });
      for (const crystal of this.crystals.values()) {
        if (!crystal.used) {
          lights.push({
            x: crystal.x,
            y: 1.35,
            z: crystal.z + 0.35,
            intensity: 8.2,
            distance: 11.5,
            outdoor: false,
            color: 0x3ef59c,
            flickerMode: 'magic',
          });
        }
      }
      for (const chest of this.chests.values()) {
        if (chest.stateKey === 'closed' && (chest.tier === 'golden' || chest.tier === 'epic')) {
          lights.push({
            x: chest.x,
            y: 1.05,
            z: chest.z + 0.35,
            intensity: chest.tier === 'golden' ? 5.5 : 4.8,
            distance: 8.5,
            outdoor: false,
            color: chest.tier === 'golden' ? 0xffd048 : 0xb866ff,
            flickerMode: 'magic',
          });
        }
      }
    }

    this.torchLightsHandler(lights);
  }

  private createCutoutSprite(
    texture: THREE.Texture,
    x: number,
    z: number,
    width: number,
    height: number,
    options: {
      y?: number;
      castShadow?: boolean;
      roughness?: number;
      metalness?: number;
      emissiveHex?: number;
      emissiveIntensity?: number;
      useEmissiveMap?: boolean;
    } = {},
  ): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } {
    const material = this.trackDisposable(
      new THREE.MeshStandardMaterial({
        map: texture,
        emissive: new THREE.Color(options.emissiveHex ?? 0x000000),
        emissiveMap: options.useEmissiveMap ? texture : null,
        emissiveIntensity: options.emissiveIntensity ?? 0,
        roughness: options.roughness ?? 0.74,
        metalness: options.metalness ?? 0.06,
        transparent: false,
        alphaTest: 0.5,
        depthWrite: true,
        side: THREE.DoubleSide,
      }),
    );
    enableSpriteLighting(material);
    const mesh = new THREE.Mesh(this.spriteGeo, material);
    mesh.position.set(x, options.y ?? 0, z);
    mesh.scale.set(width, height, 1);
    mesh.rotation.x = SPRITE_TILT_X;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = false;
    mesh.userData.skipSSAO = true;
    mesh.userData.isSprite25D = true;
    return { mesh, material };
  }

  private clearZone(): void {
    if (this.zoneGroup) {
      this.rootGroup.remove(this.zoneGroup);
      this.zoneGroup = null;
    }
    for (const item of this.zoneDisposables) {
      item.dispose();
    }
    this.zoneDisposables = [];

    this.overworldGroundMat = null;
    this.activeDungeon = null;
    this.dungeonFloorMat = null;
    this.dungeonWallSideMat = null;
    this.refreshableBindings = [];

    this.waterMesh = null;
    this.waterTex = null;
    this.waterShaderMat = null;
    this.seaLabelMats = [];
    this.swayProps = [];
    this.portals = [];
    this.exitPortalMesh = null;
    this.exitPortalMat = null;
    this.exitPortalVortexMat = null;
    this.exitPortalRing = null;
    this.exitPortalSourceSheet = null;
    this.exitPortalSheetTex = null;
    this.exitPortalFrame = -1;
    this.torches = [];
    this.lampposts = [];
    this.islandGroundMats = [];
    this.buildings = [];
    this.npcs = [];
    this.chests.clear();
    this.crystals.clear();
    this.interactiveProps.clear();
    this.flowerPatches = [];
    this.grassTuftMesh = null;
    this.grassTufts = [];
    this.windPetalMesh = null;
    this.windPetals = [];
  }

  /**
   * Construit proprement la scène de la zone demandée (`overworld` ou donjon actif).
   */
  public loadZone(zoneId: ZoneId, state?: GameState): void {
    this.clearZone();
    this.currentZoneId = zoneId;

    const group = new THREE.Group();
    group.name = `Zone_${zoneId}`;
    this.zoneGroup = group;
    this.rootGroup.add(group);

    if (zoneId === 'overworld') {
      this.buildOverworld(group, state);
    } else {
      const dungeon = DUNGEONS[zoneId];
      this.activeDungeon = dungeon;
      this.buildDungeon(group, dungeon);
    }

    if (state) {
      this.syncChests(state.chests, group);
      this.syncHealingCrystals(state);
    }
    this.publishZoneLights();
  }

  /**
   * Met à jour à chaud toutes les textures PBR & sprites HD de la zone active
   * dès la résolution de `textures.loadAllHdAssets()`.
   */
  public refreshTextures(state?: GameState): void {
    if (this.overworldGroundMat) {
      const pbr = this.textures.getOverworldPbrTextures();
      this.overworldGroundMat.map = pbr.map;
      this.overworldGroundMat.normalMap = pbr.normalMap;
      this.overworldGroundMat.roughnessMap = pbr.roughnessMap;
      this.overworldGroundMat.needsUpdate = true;
      for (const islandMat of this.islandGroundMats) {
        islandMat.map = pbr.map;
        islandMat.normalMap = pbr.normalMap;
        islandMat.roughnessMap = pbr.roughnessMap;
        islandMat.needsUpdate = true;
      }
    }

    if (this.activeDungeon && this.dungeonFloorMat) {
      const pbr = this.textures.getDungeonFloorPbrTextures(this.activeDungeon);
      this.dungeonFloorMat.map = pbr.map;
      this.dungeonFloorMat.normalMap = pbr.normalMap;
      this.dungeonFloorMat.roughnessMap = pbr.roughnessMap;
      this.dungeonFloorMat.emissiveMap = pbr.emissiveMap;
      this.dungeonFloorMat.needsUpdate = true;
    }

    if (this.activeDungeon && this.dungeonWallSideMat) {
      const wallPbr = this.textures.getWallPbrTextures(this.activeDungeon.theme);
      this.dungeonWallSideMat.map = wallPbr.map;
      this.dungeonWallSideMat.normalMap = wallPbr.normalMap;
      this.dungeonWallSideMat.roughnessMap = wallPbr.roughnessMap;
      this.dungeonWallSideMat.needsUpdate = true;
    }

    for (const binding of this.refreshableBindings) {
      const nextTex = binding.resolve();
      binding.material.map = nextTex;
      if (binding.syncEmissiveMap) {
        binding.material.emissiveMap = nextTex;
      }
      binding.material.needsUpdate = true;
    }

    for (const portal of this.portals) {
      portal.material.map = this.textures.getDungeonEntranceTexture(
        portal.theme,
        portal.levelLabel,
        portal.sealed,
      );
      portal.material.needsUpdate = true;
    }

    for (const lamp of this.lampposts) {
      const nextTex = this.textures.getLamppostTexture(lamp.lit);
      lamp.material.map = nextTex;
      lamp.material.emissiveMap = lamp.lit ? nextTex : null;
      lamp.material.needsUpdate = true;
    }

    for (const chest of this.chests.values()) {
      chest.openSourceSheet = null;
      chest.openSheetTex = null;
      const texState: 'closed' | 'open' | 'locked' =
        chest.stateKey === 'opening' ? 'closed' : chest.stateKey;
      chest.material.map = this.textures.getChestTexture(
        chest.tier,
        texState,
      );
      chest.material.needsUpdate = true;
    }

    for (const crystal of this.crystals.values()) {
      const nextTex = this.textures.getHealingCrystalTexture(crystal.used);
      crystal.material.map = nextTex;
      crystal.material.emissiveMap = crystal.used ? null : nextTex;
      crystal.material.needsUpdate = true;
    }

    const torchSheet = this.textures.getPropSheetTexture('prop_torch');
    for (const torch of this.torches) {
      if (torchSheet && torch.sourceSheet !== torchSheet) {
        const cloned = this.cloneTrackedSheet(torchSheet);
        torch.sourceSheet = torchSheet;
        torch.sheetTex = cloned;
        torch.frame = -1;
        computeGridFrameUvInto(TORCH_SHEET_GRID, 0, torch.uvRect, true);
        applyUvRectToTexture(cloned, torch.uvRect);
        torch.material.map = cloned;
        torch.material.emissiveMap = cloned;
        torch.material.needsUpdate = true;
      } else if (!torchSheet) {
        const fallbackTex = this.textures.getTorchTexture(0);
        torch.material.map = fallbackTex;
        torch.material.emissiveMap = fallbackTex;
        torch.material.needsUpdate = true;
      }
    }

    const portalExitSheet = this.textures.getPropSheetTexture('portal_exit');
    if (this.exitPortalMat && portalExitSheet && this.exitPortalSourceSheet !== portalExitSheet) {
      const cloned = this.cloneTrackedSheet(portalExitSheet);
      this.exitPortalSourceSheet = portalExitSheet;
      this.exitPortalSheetTex = cloned;
      this.exitPortalFrame = -1;
      computeGridFrameUvInto(PORTAL_EXIT_SHEET_GRID, 0, this.exitPortalUvRect, true);
      applyUvRectToTexture(cloned, this.exitPortalUvRect);
      this.exitPortalMat.map = cloned;
      this.exitPortalMat.emissiveMap = cloned;
      this.exitPortalMat.needsUpdate = true;
    }

    const mayorSheet = this.textures.getNpcSheetTexture('mayor_moustache');
    for (const npc of this.npcs) {
      if (npc.id === 'mayor_moustache' && mayorSheet && npc.sourceSheet !== mayorSheet) {
        const cloned = this.cloneTrackedSheet(mayorSheet);
        npc.sourceSheet = mayorSheet;
        npc.sheetTex = cloned;
        npc.animFrame = -1;
        const dims = getTextureDimensions(mayorSheet);
        const grid = resolveMayorMoustacheGrid(npc.state, dims?.width ?? 0, dims?.height ?? 0);
        computeGridFrameUvInto(grid, 0, npc.uvRect, true);
        applyUvRectToTexture(cloned, npc.uvRect);
        npc.material.map = cloned;
        npc.material.needsUpdate = true;
      } else if (npc.id !== 'mayor_moustache' || !mayorSheet) {
        npc.material.map = this.textures.getNpcTexture(npc.id);
        npc.material.needsUpdate = true;
      }
    }

    if (state && this.zoneGroup) {
      this.syncChests(state.chests, this.zoneGroup);
      this.syncHealingCrystals(state);
    }
  }

  private buildOverworld(group: THREE.Group, state?: GameState): void {
    // 1. Océan GLSL réaliste & agité (6 trains Gerstner, profondeur Beer-Lambert, Fresnel, écume organique sur 6 îles)
    const waterGeo = this.trackDisposable(createWaterGeometry(480, 288));
    const waterMat = this.trackDisposable(
      createWaterMaterial({
        coastOffset: 0.6,
        waveAmplitude: 1.0,
        fogNear: 115,
        fogFar: 265,
        coastIslands: [
          new THREE.Vector4(0, 0, 52.5, 1),
          ...ALL_NEW_ISLANDS.map((islandId) => {
            const island = NEW_ISLANDS[islandId];
            return new THREE.Vector4(
              island.centerX,
              island.centerZ,
              island.radius,
              1,
            );
          }),
        ],
      }),
    );
    this.waterShaderMat = waterMat;

    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.name = 'FelingardOcean';
    waterMesh.position.set(0, WATER_LEVEL_Y, 0);
    waterMesh.receiveShadow = false;
    waterMesh.castShadow = false;
    waterMesh.renderOrder = -1;
    waterMesh.userData.skipSSAO = true;
    group.add(waterMesh);
    this.waterMesh = waterMesh;

    // 2. Terrain Diorama PBR Overworld 120×120 (Albedo + Normal + Roughness + receiveShadow)
    const mapSize = OVERWORLD_HALF_SIZE * 2;
    const groundGeo = this.trackDisposable(createIslandTerrainGeometry(mapSize));
    const pbr = this.textures.getOverworldPbrTextures();
    const groundMat = this.trackDisposable(
      new THREE.MeshStandardMaterial({
        map: pbr.map,
        normalMap: pbr.normalMap,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: pbr.roughnessMap,
        roughness: 1.0,
        metalness: 0.04,
      }),
    );
    this.overworldGroundMat = groundMat;

    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.set(0, 0, 0);
    groundMesh.receiveShadow = true;
    groundMesh.castShadow = false;
    groundMesh.renderOrder = 0;
    group.add(groundMesh);

    // Rend toutes les 5 îles de l'archipel en continu (zéro rebuild à l'accostage)
    for (const islandId of ALL_NEW_ISLANDS) {
      const islandGeo = this.trackDisposable(
        createNewIslandTerrainGeometry(islandId, 76),
      );
      const islandMat = this.trackDisposable(groundMat.clone());
      islandMat.color.setHex(ISLAND_TINTS[islandId]);
      islandMat.needsUpdate = true;
      this.islandGroundMats.push(islandMat);
      const islandMesh = new THREE.Mesh(islandGeo, islandMat);
      islandMesh.name = `Island_${islandId}`;
      islandMesh.position.set(
        NEW_ISLANDS[islandId].centerX,
        0,
        NEW_ISLANDS[islandId].centerZ,
      );
      islandMesh.receiveShadow = true;
      islandMesh.castShadow = false;
      group.add(islandMesh);
    }

    // 2b. Étiquettes cartographiques maritimes (`MER DES RONRONS`) au-dessus de l'océan
    for (const label of OVERWORLD_DATA.mapLabels) {
      if (label.style !== 'sea') continue;
      const labelGeo = this.trackDisposable(new THREE.PlaneGeometry(22, 5.5));
      labelGeo.rotateX(-Math.PI / 2);
      const labelMat = this.trackDisposable(
        new THREE.MeshBasicMaterial({
          map: this.textures.getSeaLabelTexture(label.text),
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: true,
        }),
      );
      this.seaLabelMats.push(labelMat);
      const labelMesh = new THREE.Mesh(labelGeo, labelMat);
      labelMesh.position.set(label.x, WATER_LEVEL_Y + 0.62, label.z);
      labelMesh.rotation.y = -(label.rotation ?? 0);
      labelMesh.renderOrder = 1;
      labelMesh.userData.skipSSAO = true;
      group.add(labelMesh);
    }

    // 3. Bâtiments vivants de Miaou-bourg (fenêtres chaudes, foyer forge, panneau quêtes)
    for (const b of OVERWORLD_DATA.buildings) {
      const dims =
        b.kind === 'quest_board'
          ? { w: 2.9, h: 3.0, sink: 0.11 }
          : b.kind === 'house'
            ? { w: 5.0, h: 5.0, sink: 0.16 }
            : b.kind === 'forge'
              ? { w: 5.8, h: 5.8, sink: 0.20 }
              : { w: 5.8, h: 5.8, sink: 0.17 };

      const groundY = sampleOverworldGroundY(b.x, b.z);
      const kind: BuildingDef['kind'] = b.kind;
      const isForge = kind === 'forge';
      const isInn = kind === 'inn';
      const isHouse = kind === 'house';
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getBuildingTexture(kind),
        b.x,
        b.z,
        dims.w,
        dims.h,
        {
          y: groundY - dims.sink,
          // L'emprise isométrique au sol remplace l'ombre directionnelle détachée du plan incliné
          castShadow: false,
          roughness: 0.72,
          metalness: isForge ? 0.14 : 0.06,
          emissiveHex: isForge ? 0xff7728 : isInn || isHouse ? 0xffc66e : 0x000000,
          emissiveIntensity: isForge ? 0.3 : isInn ? 0.14 : isHouse ? 0.08 : 0,
          useEmissiveMap: isForge || isInn || isHouse,
        },
      );
      this.refreshableBindings.push({
        material,
        resolve: () => this.textures.getBuildingTexture(kind),
        syncEmissiveMap: isForge || isInn || isHouse,
      });
      group.add(mesh);
      this.addBuildingGroundContactShadow(group, kind, b.x, b.z, groundY, dims.w, dims.h);

      this.buildings.push({
        kind,
        x: b.x,
        z: b.z,
        mesh,
        material,
        phase: b.x * 0.41 + b.z * 0.27,
      });
    }

    // 3b. Lampadaires 2.5D d'overworld éclairés par de vraies PointLights (ZÉRO faux halo)
    for (let i = 0; i < OVERWORLD_LAMP_LIGHTS.length; i++) {
      const lp = OVERWORLD_LAMP_LIGHTS[i];
      const groundY = sampleOverworldGroundY(lp.x, lp.z);
      const texOff = this.textures.getLamppostTexture(false);
      const { mesh, material } = this.createCutoutSprite(texOff, lp.x, lp.z, 1.35, 2.75, {
        y: groundY - 0.11,
        roughness: 0.42,
        metalness: 0.56,
        emissiveHex: 0xffc664,
        emissiveIntensity: 0,
        useEmissiveMap: true,
      });
      group.add(mesh);
      group.add(
        this.createShadowMesh(lp.x, lp.z + 0.02, 0.52, 0.34, {
          y: groundY,
          opacity: 0.54,
        }),
      );

      this.lampposts.push({
        mesh,
        material,
        lit: false,
        phase: i * 1.13,
      });
    }

    // 4. PNJ (Maire Moustache : spritesheet 45 frames 9×5 30 FPS idle/talk/greet)
    const mayorSheetTex = this.textures.getNpcSheetTexture('mayor_moustache');
    for (const npc of OVERWORLD_DATA.npcs) {
      const npcId = npc.id;
      let initialTex = this.textures.getNpcTexture(npcId);
      let sourceSheet: THREE.Texture | null = null;
      let sheetTex: THREE.Texture | null = null;
      const uvRect = createSpriteUvRect();
      if (npcId === 'mayor_moustache' && mayorSheetTex) {
        sourceSheet = mayorSheetTex;
        sheetTex = this.cloneTrackedSheet(mayorSheetTex);
        const dims = getTextureDimensions(mayorSheetTex);
        const grid = resolveMayorMoustacheGrid('idle', dims?.width ?? 0, dims?.height ?? 0);
        computeGridFrameUvInto(grid, 0, uvRect, true);
        applyUvRectToTexture(sheetTex, uvRect);
        initialTex = sheetTex;
      }
      const { mesh, material } = this.createCutoutSprite(
        initialTex,
        npc.x,
        npc.z,
        2.15,
        2.25,
      );
      if (npcId !== 'mayor_moustache') {
        this.refreshableBindings.push({
          material,
          resolve: () => this.textures.getNpcTexture(npcId),
        });
      }
      group.add(mesh);
      group.add(this.createShadowMesh(npc.x, npc.z, 0.72, 0.5));
      this.npcs.push({
        id: npcId,
        x: npc.x,
        z: npc.z,
        mesh,
        material,
        baseScaleX: 2.15,
        baseScaleY: 2.25,
        phase: npc.x * 0.7,
        state: 'idle',
        sourceSheet,
        sheetTex,
        uvRect,
        animFrame: 0,
      });
    }

    // 5. Entrées des 2 Donjons (+ badge Niv. X + sceau runique GLSL rotatif + barrière HDR)
    const hasKey = state?.player.hasRunicKey ?? false;
    for (const portal of OVERWORLD_DATA.dungeonPortals) {
      const theme: 'ghost_cave' | 'dragon_lair' =
        portal.targetZoneId === 'dungeon_dragon_lair' ? 'dragon_lair' : 'ghost_cave';
      const sealed = Boolean(portal.requiresRunicKey && !hasKey);
      const tex = this.textures.getDungeonEntranceTexture(
        theme,
        portal.shortLabel,
        sealed,
      );
      const size = theme === 'dragon_lair' ? 6.6 : 5.8;
      const groundY = sampleOverworldGroundY(portal.x, portal.z);
      // Compense exactement la marge basse transparente de `portal_dungeon.png` (v ≈ 0.124)
      const portalSink = size * 0.122;
      const { mesh, material } = this.createCutoutSprite(
        tex,
        portal.x,
        portal.z,
        size,
        size,
        {
          y: groundY - portalSink,
          castShadow: false,
          roughness: 0.78,
          emissiveHex: theme === 'dragon_lair' ? 0xff6d28 : 0x8d68ff,
          emissiveIntensity: 0.22,
          useEmissiveMap: true,
        },
      );
      group.add(mesh);
      group.add(
        this.createShadowMesh(
          portal.x,
          portal.z - size * 0.07,
          size * 0.48,
          size * 0.28,
          {
            y: groundY,
            opacity: 0.82,
          },
        ),
      );

      const portalGlowH = size * 0.30;

      // Sceau runique GLSL rotatif & pulsant devant l'arche du portail (éclairage assuré par PointLight réelle)
      const sealMat = this.trackDisposable(
        createPortalRunicSealMaterial(
          theme === 'dragon_lair' ? 0xff6224 : 0x9b66ff,
          theme === 'dragon_lair' ? 0xffe485 : 0x62f0ff,
        ),
      );
      const sealMesh = new THREE.Mesh(this.glowGeo, sealMat);
      sealMesh.position.set(
        portal.x,
        groundY + portalGlowH * Math.cos(Math.abs(SPRITE_TILT_X)),
        portal.z - portalGlowH * Math.sin(Math.abs(SPRITE_TILT_X)) + 0.08,
      );
      sealMesh.rotation.x = SPRITE_TILT_X;
      sealMesh.scale.set(size * 0.62, size * 0.62, 1);
      sealMesh.renderOrder = 3;
      sealMesh.userData.skipSSAO = true;
      group.add(sealMesh);

      let barrierRing: THREE.Mesh | null = null;
      if (portal.requiresRunicKey) {
        const ringGeo = this.trackDisposable(new THREE.RingGeometry(2.3, 2.75, 32));
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = this.trackDisposable(
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(0.55 * 1.45, 0.96 * 1.45, 1.0 * 1.45),
            transparent: true,
            opacity: 0.72,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        barrierRing = new THREE.Mesh(ringGeo, ringMat);
        barrierRing.position.set(portal.x, 0.05, portal.z + 0.4);
        barrierRing.renderOrder = 2;
        barrierRing.visible = sealed;
        barrierRing.userData.skipSSAO = true;
        group.add(barrierRing);
      }

      this.portals.push({
        id: portal.id,
        theme,
        levelLabel: portal.shortLabel,
        requiresRunicKey: Boolean(portal.requiresRunicKey),
        material,
        mesh,
        sealMesh,
        sealMat,
        sealed,
        barrierRing,
      });
    }

    // 6. Props 2.5D de TOUTES les 6 îles (arbres parfaitement stables, fleurs posées à plat au sol, champignons pulsants)
    const allOverworldProps = [
      ...OVERWORLD_DATA.props,
      ...ALL_NEW_ISLANDS.flatMap((id) => NEW_ISLANDS[id].props),
    ];
    for (const prop of allOverworldProps) {
      const spec = PROP_BASE_SIZES[prop.kind];
      const w = spec.w * prop.scale;
      const h = spec.h * prop.scale;
      const kind = prop.kind;
      const isMushroom = kind === 'mushroom';
      const isHouseCat = kind === 'house_cat';
      const isFlower = kind === 'flower_patch';
      const groundY = sampleOverworldGroundY(prop.x, prop.z);

      if (isFlower) {
        // Fleurs posées à plat / couchées sur le sol sans z-fighting (et relevées si l'on interagit près d'elles)
        const fMat = this.trackDisposable(
          new THREE.MeshStandardMaterial({
            map: this.textures.getPropTexture(kind),
            roughness: 0.78,
            metalness: 0.02,
            transparent: false,
            alphaTest: 0.45,
            depthWrite: true,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            side: THREE.DoubleSide,
          }),
        );
        enableSpriteLighting(fMat);
        const fMesh = new THREE.Mesh(this.glowGeo, fMat);
        const baseY = groundY + 0.06;
        const baseRotX = -Math.PI / 2 + 0.14;
        const baseRotZ = ((prop.x * 13 + prop.z * 7) % 10) * 0.04 - 0.2;
        fMesh.position.set(prop.x, baseY, prop.z);
        fMesh.scale.set(w, h, 1);
        fMesh.rotation.order = 'YXZ';
        fMesh.rotation.x = baseRotX;
        fMesh.rotation.z = baseRotZ;
        fMesh.castShadow = false;
        fMesh.receiveShadow = true;
        fMesh.renderOrder = 1;
        fMesh.userData.skipSSAO = true;
        fMesh.userData.isSprite25D = true;
        this.refreshableBindings.push({
          material: fMat,
          resolve: () => this.textures.getPropTexture(kind),
          syncEmissiveMap: false,
        });
        group.add(fMesh);
        this.flowerPatches.push({
          mesh: fMesh,
          x: prop.x,
          z: prop.z,
          baseY,
          baseRotX,
          baseRotZ,
          lift: 0,
          bendX: 0,
          bendZ: 0,
        });
        this.interactiveProps.set(prop.id, {
          mesh: fMesh,
          baseX: prop.x,
          baseY,
          baseRotX,
          baseRotZ,
          shakeTimer: 0,
          hitDirX: 1,
          hitDirZ: 0,
          amplitude: 0.12,
        });
        continue;
      }

      const { mesh, material } = this.createCutoutSprite(
        this.textures.getPropTexture(kind),
        prop.x,
        prop.z,
        w,
        h,
        {
          y: groundY - h * spec.sinkRatio,
          castShadow: !isHouseCat && spec.shadowR > 0,
          emissiveHex: isMushroom ? 0x52f2c8 : 0x000000,
          emissiveIntensity: isMushroom ? 0.14 : 0,
          useEmissiveMap: isMushroom,
        },
      );
      const propPhase = prop.x * 0.37 + prop.z * 0.29;
      if (spec.sways) {
        applyWindSwayShader(material, {
          phase: propPhase,
          strength: 0.05,
          frequency: 1.5,
          rustleAmp: 0.01,
        });
      } else if (kind === 'signpost') {
        applyWindSwayShader(material, {
          phase: propPhase,
          strength: 0.025,
          frequency: 1.4,
          rustleAmp: 0.003,
        });
      } else if (isMushroom) {
        applyEmissivePulseShader(material, 0x5cf5d0, 0.34, 2.4, propPhase);
      }

      this.refreshableBindings.push({
        material,
        resolve: () => this.textures.getPropTexture(kind),
        syncEmissiveMap: isMushroom,
      });
      group.add(mesh);

      if (isHouseCat) {
        this.addBuildingGroundContactShadow(group, 'house', prop.x, prop.z, groundY, w, h);
      } else if (spec.shadowR > 0) {
        const isSignpost = kind === 'signpost';
        group.add(
          this.createShadowMesh(
            prop.x,
            prop.z + (isSignpost ? 0.0 : 0.02),
            (isSignpost ? 0.62 : spec.shadowR) * prop.scale,
            (isSignpost ? 0.36 : spec.shadowR * 0.65) * prop.scale,
            {
              y: groundY,
              opacity: isSignpost ? 0.66 : 0.54,
            },
          ),
        );
      }

      if (spec.sways) {
        this.swayProps.push({
          mesh,
          phase: propPhase,
          amplitude: 0.014,
        });
      }
      if (!isHouseCat) {
        const isSmallProp = kind === 'bush' || kind === 'barrel' || kind === 'signpost' || kind === 'fence' || kind === 'mushroom';
        this.interactiveProps.set(prop.id, {
          mesh,
          baseX: prop.x,
          baseY: groundY - h * spec.sinkRatio,
          baseRotX: SPRITE_TILT_X,
          baseRotZ: 0,
          shakeTimer: 0,
          hitDirX: 1,
          hitDirZ: 0,
          amplitude: isSmallProp ? 0.16 : 0.085,
        });
      }
    }

    // 7. Touffes d'herbe flexibles & pétales/feuilles portés par le vent
    this.buildOverworldGrassAndPetals(group);
  }

  private buildOverworldGrassAndPetals(group: THREE.Group): void {
    // Géométrie en croix pour touffe d'herbe 3D légère (pivot au sol y=0)
    const p1 = new THREE.PlaneGeometry(0.46, 0.36);
    p1.translate(0, 0.18, 0);
    const p2 = new THREE.PlaneGeometry(0.46, 0.36);
    p2.translate(0, 0.18, 0);
    p2.rotateY(Math.PI * 0.5);

    const pos1 = p1.getAttribute('position') as THREE.BufferAttribute;
    const pos2 = p2.getAttribute('position') as THREE.BufferAttribute;
    const idx1 = p1.getIndex();
    const idx2 = p2.getIndex();
    const mergedPos = new Float32Array((pos1.count + pos2.count) * 3);
    mergedPos.set(pos1.array as Float32Array, 0);
    mergedPos.set(pos2.array as Float32Array, pos1.count * 3);
    const mergedIndices: number[] = [];
    if (idx1) {
      for (let i = 0; i < idx1.count; i++) mergedIndices.push(idx1.getX(i));
    }
    if (idx2) {
      for (let i = 0; i < idx2.count; i++) mergedIndices.push(idx2.getX(i) + pos1.count);
    }
    p1.dispose();
    p2.dispose();

    const grassGeo = this.trackDisposable(new THREE.BufferGeometry());
    grassGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
    grassGeo.setIndex(mergedIndices);
    grassGeo.computeVertexNormals();

    const grassMat = this.trackDisposable(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.85,
        metalness: 0.02,
        side: THREE.DoubleSide,
      }),
    );

    const tufts: GrassTuftData[] = [];
    const colors: number[] = [];
    let seed = 918273;
    const rand = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const MAX_TUFTS = 220;
    for (let attempt = 0; attempt < 900 && tufts.length < MAX_TUFTS; attempt++) {
      let wx = 0;
      let wz = 0;
      let biome: string = 'plains';
      let groundY = 0;

      if (attempt % 4 === 0) {
        const islId = ALL_NEW_ISLANDS[attempt % ALL_NEW_ISLANDS.length];
        const isl = NEW_ISLANDS[islId];
        if (isl.biome === 'mountain') continue;
        const a = rand() * Math.PI * 2;
        const r = 3 + rand() * Math.max(4, isl.radius - 5);
        wx = isl.centerX + Math.cos(a) * r;
        wz = isl.centerZ + Math.sin(a) * r;
        if (!isInsideNewIsland(islId, wx, wz, 2.5)) continue;
        biome = getBiomeAtNewIsland(islId, wx, wz);
        groundY = getIslandTerrainHeightLocal(islId, wx - isl.centerX, wz - isl.centerZ);
      } else {
        wx = (rand() - 0.5) * 90;
        wz = (rand() - 0.5) * 90;
        if (!isInsideIsland(wx, wz, 2.5) || isInsideVillage(wx, wz, 1.5)) continue;
        biome = getBiomeAt(wx, wz);
        if (biome === 'frost') continue;
        groundY = getIslandTerrainHeightLocal('felingard', wx, wz);
      }

      tufts.push({
        x: wx,
        y: groundY,
        z: wz,
        scale: 0.72 + rand() * 0.55,
        phase: rand() * Math.PI * 2,
        rotY: rand() * Math.PI,
        bendX: 0,
        bendZ: 0,
      });

      const hex =
        biome === 'forest'
          ? 0x457d3b
          : biome === 'wild'
            ? 0x4f9642
            : biome === 'tropical'
              ? 0x74b54a
              : biome === 'mystic'
                ? 0x62739e
                : 0x65a844;
      colors.push(hex);
    }

    if (tufts.length > 0) {
      const mesh = new THREE.InstancedMesh(grassGeo, grassMat, tufts.length);
      mesh.name = 'OverworldGrassTufts';
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      mesh.userData.skipSSAO = true;
      for (let i = 0; i < tufts.length; i++) {
        this.decorColorScratch.setHex(colors[i]);
        mesh.setColorAt(i, this.decorColorScratch);
      }
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
      this.grassTuftMesh = mesh;
      this.grassTufts = tufts;
    }

    // Pétales et feuilles emportés par le vent (64 instances poolées)
    const petalGeo = this.trackDisposable(new THREE.PlaneGeometry(0.16, 0.11));
    const petalMat = this.trackDisposable(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const PETAL_COUNT = 64;
    const petalMesh = new THREE.InstancedMesh(petalGeo, petalMat, PETAL_COUNT);
    petalMesh.name = 'OverworldWindPetals';
    petalMesh.frustumCulled = false;
    petalMesh.userData.skipSSAO = true;
    const petals: WindPetalParticle[] = [];
    for (let i = 0; i < PETAL_COUNT; i++) {
      const px = (rand() - 0.5) * 44;
      const pz = (rand() - 0.5) * 44;
      petals.push({
        x: px,
        y: 0.5 + rand() * 3.8,
        z: pz,
        vx: 0,
        vy: -0.25 - rand() * 0.3,
        vz: 0,
        phase: rand() * Math.PI * 2,
        scale: 0.75 + rand() * 0.7,
      });
      const col = i % 3 === 0 ? 0xffb7d5 : i % 3 === 1 ? 0xffe484 : 0x8be06e;
      this.decorColorScratch.setHex(col);
      petalMesh.setColorAt(i, this.decorColorScratch);
    }
    if (petalMesh.instanceColor) petalMesh.instanceColor.needsUpdate = true;
    group.add(petalMesh);
    this.windPetalMesh = petalMesh;
    this.windPetals = petals;
  }

  private buildDungeon(group: THREE.Group, dungeon: DungeonDefinition): void {
    const pal = DUNGEON_PALETTE[dungeon.theme];

    // 1. Sol dallé PBR (`albedo` + `normalMap` + `roughnessMap` + `emissiveMap` runes/lave)
    const floorGeo = this.trackDisposable(
      new THREE.PlaneGeometry(dungeon.width, dungeon.depth),
    );
    floorGeo.rotateX(-Math.PI / 2);
    const floorPbr = this.textures.getDungeonFloorPbrTextures(dungeon);
    const floorMat = this.trackDisposable(
      new THREE.MeshStandardMaterial({
        map: floorPbr.map,
        normalMap: floorPbr.normalMap,
        normalScale: new THREE.Vector2(1.05, 1.05),
        roughnessMap: floorPbr.roughnessMap,
        roughness: 0.95,
        metalness: 0.08,
        emissive: new THREE.Color(0xffffff),
        emissiveMap: floorPbr.emissiveMap,
        emissiveIntensity: 1.35,
      }),
    );
    this.dungeonFloorMat = floorMat;

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, 0, 0);
    floorMesh.receiveShadow = true;
    floorMesh.castShadow = false;
    floorMesh.renderOrder = 0;
    group.add(floorMesh);

    // 2. Murs 3D PBR sculptés (mur sud abaissé pour ne jamais gêner la caméra plongeante !)
    const wallPbr = this.textures.getWallPbrTextures(dungeon.theme);
    const wallTopMat = this.trackDisposable(
      new THREE.MeshStandardMaterial({
        color: pal.wallTop,
        roughness: 0.9,
        metalness: 0.05,
      }),
    );
    const wallSideBaseMat = this.trackDisposable(
      new THREE.MeshStandardMaterial({
        map: wallPbr.map,
        normalMap: wallPbr.normalMap,
        normalScale: new THREE.Vector2(0.95, 0.95),
        roughnessMap: wallPbr.roughnessMap,
        roughness: 0.92,
        metalness: 0.06,
      }),
    );
    this.dungeonWallSideMat = wallSideBaseMat;

    const southLimitZ = dungeon.depth * 0.5 - 3.5;

    for (const wall of dungeon.walls) {
      const w = Math.max(0.5, wall.maxX - wall.minX);
      const d = Math.max(0.5, wall.maxZ - wall.minZ);
      const cx = (wall.minX + wall.maxX) * 0.5;
      const cz = (wall.minZ + wall.maxZ) * 0.5;
      const isSouthEdge = wall.minZ >= southLimitZ;
      const h = isSouthEdge ? 1.25 : Math.min(wall.height ?? 3.2, 3.0);

      const boxGeo = this.trackDisposable(new THREE.BoxGeometry(w, h, d));
      applyBoxWorldUVs(boxGeo, w, h, d, 3.0);
      const materials = [
        wallSideBaseMat,
        wallSideBaseMat,
        wallTopMat,
        wallTopMat,
        wallSideBaseMat,
        wallSideBaseMat,
      ];
      const mesh = new THREE.Mesh(boxGeo, materials);
      mesh.position.set(cx, h * 0.5, cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }

    // 3. Colonnes sculptées PBR de donjon avec pulsation runique GLSL selon thème
    const theme = dungeon.theme;
    const pillarRuneHex = theme === 'dragon_lair' ? 0xff7b38 : 0x7ae2ff;
    for (const pillar of dungeon.pillars) {
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getPillarTexture(theme),
        pillar.x,
        pillar.z,
        2.7,
        4.2,
        {
          y: -0.22,
          roughness: 0.8,
          emissiveHex: pillarRuneHex,
          emissiveIntensity: 0.24,
          useEmissiveMap: true,
        },
      );
      applyEmissivePulseShader(
        material,
        pillarRuneHex,
        0.38,
        2.8,
        pillar.x * 0.31 + pillar.z * 0.43,
      );
      this.refreshableBindings.push({
        material,
        resolve: () => this.textures.getPillarTexture(theme),
        syncEmissiveMap: true,
      });
      group.add(mesh);
      group.add(
        this.createShadowMesh(pillar.x, pillar.z - 0.04, 1.32, 0.92, {
          opacity: 0.68,
        }),
      );
    }

    // 4. Torches au sol vacillantes HDR + Lumières dynamiques alignées sur la flamme exacte
    // (les sources réelles de la zone sont publiées par `publishZoneLights()` dès le chargement)
    const tiltAbs = Math.abs(SPRITE_TILT_X);
    const flameDist = 1.35; // v ≈ 0.73 sur une torche ancrée au sol de hauteur 1.85
    const flameLocalY = flameDist * Math.cos(tiltAbs);
    const flameOffsetZ = -flameDist * Math.sin(tiltAbs);
    const useSceneTorchLights = this.torchLightsHandler !== null;

    const torchCount = dungeon.torches.length;
    const maxFallbackLights = 6;
    const lightStep = Math.max(1, Math.ceil(torchCount / maxFallbackLights));
    const lightColor = dungeon.theme === 'dragon_lair' ? 0xff8a3d : 0xffaa52;

    const torchSheetSource = this.textures.getPropSheetTexture('prop_torch');
    dungeon.torches.forEach((pos, idx) => {
      const uvRect = createSpriteUvRect();
      let torchTex: THREE.Texture = this.textures.getTorchTexture(0);
      let sheetTex: THREE.Texture | null = null;
      if (torchSheetSource) {
        sheetTex = this.cloneTrackedSheet(torchSheetSource);
        computeGridFrameUvInto(TORCH_SHEET_GRID, idx % 15, uvRect, true);
        applyUvRectToTexture(sheetTex, uvRect);
        torchTex = sheetTex;
      }
      const mat = this.trackDisposable(
        new THREE.MeshStandardMaterial({
          map: torchTex,
          emissive: new THREE.Color(dungeon.theme === 'dragon_lair' ? 0xff7a2e : 0xffa642),
          emissiveMap: torchTex,
          emissiveIntensity: 1.5,
          roughness: 0.55,
          metalness: 0.2,
          transparent: false,
          alphaTest: 0.5,
          depthWrite: true,
          side: THREE.DoubleSide,
        }),
      );
      enableSpriteLighting(mat);
      const mesh = new THREE.Mesh(this.spriteGeo, mat);
      mesh.position.set(pos.x, 0, pos.z);
      mesh.scale.set(1.55, 1.85, 1);
      mesh.rotation.x = SPRITE_TILT_X;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.skipSSAO = true;
      mesh.userData.isSprite25D = true;
      group.add(mesh);
      group.add(this.createShadowMesh(pos.x, pos.z + 0.06, 0.55, 0.38));

      let pointLight: THREE.PointLight | undefined;
      if (
        !useSceneTorchLights &&
        idx % lightStep === 0 &&
        this.torches.filter((t) => t.light).length < maxFallbackLights
      ) {
        pointLight = new THREE.PointLight(lightColor, 14.5, 18, 2);
        pointLight.position.set(pos.x, flameLocalY + 0.14, pos.z + flameOffsetZ);
        group.add(pointLight);
      }

      this.torches.push({
        mesh,
        material: mat,
        phase: idx * 1.37,
        frame: idx % 15,
        sourceSheet: torchSheetSource,
        sheetTex,
        uvRect,
        light: pointLight,
        baseIntensity: 14.5,
      });
    });

    // 5. Portail lumineux HDR de sortie (spritesheet baked 30 frames 6×5 + vortex GLSL)
    const exit = dungeon.exitPortal;
    const portalExitSheetSource = this.textures.getPropSheetTexture('portal_exit');
    let exitTex: THREE.Texture = this.textures.getDungeonExitPortalTexture(dungeon.theme);
    if (portalExitSheetSource) {
      const clonedExit = this.cloneTrackedSheet(portalExitSheetSource);
      computeGridFrameUvInto(PORTAL_EXIT_SHEET_GRID, 0, this.exitPortalUvRect, true);
      applyUvRectToTexture(clonedExit, this.exitPortalUvRect);
      this.exitPortalSourceSheet = portalExitSheetSource;
      this.exitPortalSheetTex = clonedExit;
      this.exitPortalFrame = 0;
      exitTex = clonedExit;
    }
    const exitMat = this.trackDisposable(
      new THREE.MeshStandardMaterial({
        map: exitTex,
        emissive: new THREE.Color(
          dungeon.theme === 'dragon_lair' ? 0xffae42 : 0x5edbff,
        ),
        emissiveMap: exitTex,
        emissiveIntensity: 1.45,
        roughness: 0.2,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const exitMesh = new THREE.Mesh(this.spriteGeo, exitMat);
    exitMesh.position.set(exit.x, 0.05, exit.z);
    exitMesh.scale.set(3.2, 3.4, 1);
    exitMesh.rotation.x = SPRITE_TILT_X;
    exitMesh.renderOrder = 3;
    exitMesh.userData.skipSSAO = true;
    group.add(exitMesh);
    this.exitPortalMesh = exitMesh;
    this.exitPortalMat = exitMat;

    // Vortex spiralé GLSL 30 FPS superposé au portail de sortie
    const vortexMat = this.trackDisposable(
      createPortalExitVortexMaterial(
        dungeon.theme === 'dragon_lair' ? 0xff9838 : 0x56f0d8,
        0xfff099,
      ),
    );
    const vortexMesh = new THREE.Mesh(this.glowGeo, vortexMat);
    vortexMesh.position.set(exit.x, 1.48, exit.z - 0.65);
    vortexMesh.rotation.x = SPRITE_TILT_X;
    vortexMesh.scale.set(2.85, 2.85, 1);
    vortexMesh.renderOrder = 4;
    vortexMesh.userData.skipSSAO = true;
    group.add(vortexMesh);
    this.exitPortalVortexMat = vortexMat;

    const ringGeo = this.trackDisposable(new THREE.RingGeometry(1.45, 1.85, 32));
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = this.trackDisposable(
      new THREE.MeshBasicMaterial({
        color:
          dungeon.theme === 'dragon_lair'
            ? new THREE.Color(1.45, 0.95, 0.35)
            : new THREE.Color(0.55, 1.25, 1.45),
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const exitRing = new THREE.Mesh(ringGeo, ringMat);
    exitRing.position.set(exit.x, 0.05, exit.z);
    exitRing.renderOrder = 2;
    exitRing.userData.skipSSAO = true;
    group.add(exitRing);
    this.exitPortalRing = exitRing;

    // Props décoratifs interactifs du donjon (tonneaux, etc.)
    for (const prop of dungeon.props ?? []) {
      const spec = PROP_BASE_SIZES[prop.kind];
      const w = spec.w * prop.scale;
      const h = spec.h * prop.scale;
      const { mesh } = this.createCutoutSprite(
        this.textures.getPropTexture(prop.kind),
        prop.x,
        prop.z,
        w,
        h,
        {
          y: -h * spec.sinkRatio,
          castShadow: spec.shadowR > 0,
        },
      );
      group.add(mesh);
      if (spec.shadowR > 0) {
        group.add(
          this.createShadowMesh(
            prop.x,
            prop.z + 0.02,
            spec.shadowR * prop.scale,
            spec.shadowR * 0.65 * prop.scale,
            { y: 0, opacity: 0.56 },
          ),
        );
      }
      this.interactiveProps.set(prop.id, {
        mesh,
        baseX: prop.x,
        baseY: -h * spec.sinkRatio,
        baseRotX: SPRITE_TILT_X,
        baseRotZ: 0,
        shakeTimer: 0,
        hitDirX: 1,
        hitDirZ: 0,
        amplitude: 0.16,
      });
    }
  }

  private syncChests(chests: ChestInstance[], group: THREE.Group): void {
    const activeIds = this.seenChestIds;
    activeIds.clear();
    let lightsChanged = false;

    for (let i = 0; i < chests.length; i++) {
      const c = chests[i];
      activeIds.add(c.id);
      const stateKey: 'closed' | 'opening' | 'open' | 'locked' = c.opened
        ? 'open'
        : c.opening
          ? 'opening'
          : c.locked
            ? 'locked'
            : 'closed';
      const texKey: 'closed' | 'open' | 'locked' =
        stateKey === 'opening' ? 'closed' : stateKey;

      const existing = this.chests.get(c.id);
      if (existing) {
        existing.x = c.x;
        existing.z = c.z;
        existing.mesh.position.x = c.x;
        existing.mesh.position.z = c.z;
        existing.shadow.position.x = c.x;
        existing.shadow.position.z = c.z + 0.08;
        if (stateKey === 'opening') {
          existing.stateKey = 'opening';
          existing.openAnimProgress = Math.max(0, Math.min(1, c.openingProgress ?? 0));
        } else if (existing.stateKey !== stateKey) {
          const wasClosed = existing.stateKey === 'closed' || existing.stateKey === 'locked';
          const wasOpening = existing.stateKey === 'opening';
          existing.stateKey = stateKey;
          if (wasClosed && stateKey === 'open') {
            existing.openAnimProgress = 0.001;
            existing.openAnimFrame = -1;
          } else if (wasOpening && stateKey === 'open') {
            existing.openAnimProgress = 1;
            existing.material.map = this.textures.getChestTexture(c.tier, 'open');
            existing.material.needsUpdate = true;
          } else {
            existing.openAnimProgress = 1;
            existing.material.map = this.textures.getChestTexture(c.tier, texKey);
            existing.material.needsUpdate = true;
          }
          existing.material.emissiveIntensity =
            stateKey === 'closed' && (c.tier === 'golden' || c.tier === 'epic')
              ? 0.42
              : 0;
          if (c.tier === 'golden' || c.tier === 'epic') {
            lightsChanged = true;
          }
        }
        continue;
      }

      const scale = c.tier === 'golden' ? 2.15 : 1.85;
      const isGlowingTier =
        stateKey === 'closed' && (c.tier === 'golden' || c.tier === 'epic');
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getChestTexture(c.tier, texKey),
        c.x,
        c.z,
        scale,
        scale,
        {
          roughness: c.tier === 'golden' ? 0.34 : 0.58,
          metalness: c.tier === 'golden' ? 0.68 : 0.16,
          emissiveHex: c.tier === 'golden' ? 0xffcc42 : 0xb366ff,
          emissiveIntensity: isGlowingTier ? 0.42 : 0,
          useEmissiveMap: true,
        },
      );
      const shadow = this.createShadowMesh(
        c.x,
        c.z + 0.08,
        scale * 0.42,
        scale * 0.28,
      );

      group.add(mesh);
      group.add(shadow);

      this.chests.set(c.id, {
        id: c.id,
        tier: c.tier,
        x: c.x,
        z: c.z,
        mesh,
        material,
        shadow,
        stateKey,
        openAnimProgress: stateKey === 'opening' ? (c.openingProgress ?? 0) : 1,
        openAnimFrame: stateKey === 'opening' ? -1 : 14,
        openSourceSheet: null,
        openSheetTex: null,
        uvRect: createSpriteUvRect(),
        baseY: 0,
        phase: c.x * 0.5 + c.z * 0.3,
      });
      if (isGlowingTier) {
        lightsChanged = true;
      }
    }

    for (const [id, vis] of this.chests.entries()) {
      if (!activeIds.has(id)) {
        group.remove(vis.mesh);
        group.remove(vis.shadow);
        this.chests.delete(id);
        lightsChanged = true;
      }
    }
    if (lightsChanged && this.activeDungeon) {
      this.publishZoneLights();
    }
  }

  private syncHealingCrystals(state: GameState): void {
    if (!this.zoneGroup) return;
    const activeIds = this.seenCrystalIds;
    activeIds.clear();
    let lightsChanged = false;

    for (let i = 0; i < state.healingCrystals.length; i++) {
      const crystal = state.healingCrystals[i];
      activeIds.add(crystal.id);
      const existing = this.crystals.get(crystal.id);
      if (existing) {
        if (existing.used !== crystal.used) {
          existing.used = crystal.used;
          const nextTex = this.textures.getHealingCrystalTexture(crystal.used);
          existing.material.map = nextTex;
          existing.material.emissiveMap = crystal.used ? null : nextTex;
          existing.material.emissiveIntensity = crystal.used ? 0 : 1.48;
          existing.material.needsUpdate = true;
          lightsChanged = true;
        }
        continue;
      }

      const crystalTex = this.textures.getHealingCrystalTexture(crystal.used);
      const { mesh, material } = this.createCutoutSprite(
        crystalTex,
        crystal.x,
        crystal.z,
        2.3,
        2.5,
        {
          roughness: 0.24,
          metalness: 0.18,
          emissiveHex: 0x3ef59c,
          emissiveIntensity: crystal.used ? 0 : 1.48,
          useEmissiveMap: !crystal.used,
        },
      );
      const shadow = this.createShadowMesh(crystal.x, crystal.z + 0.05, 0.85, 0.6);

      this.zoneGroup.add(mesh);
      this.zoneGroup.add(shadow);
      this.crystals.set(crystal.id, {
        id: crystal.id,
        x: crystal.x,
        z: crystal.z,
        mesh,
        material,
        shadow,
        used: crystal.used,
        phase: crystal.x * 0.4,
        shakeTimer: 0,
      });
      if (!crystal.used) {
        lightsChanged = true;
      }
    }

    for (const [id, vis] of this.crystals.entries()) {
      if (!activeIds.has(id)) {
        this.zoneGroup.remove(vis.mesh);
        this.zoneGroup.remove(vis.shadow);
        this.crystals.delete(id);
        lightsChanged = true;
      }
    }
    if (lightsChanged && this.activeDungeon) {
      this.publishZoneLights();
    }
  }

  public processEvents(events: readonly GameEvent[]): void {
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (ev.type === 'decor_hit' && ev.propId) {
        const ang = ev.angle ?? 0;
        const propVis = this.interactiveProps.get(ev.propId);
        if (propVis) {
          propVis.shakeTimer = 0.34;
          propVis.hitDirX = Math.cos(ang);
          propVis.hitDirZ = Math.sin(ang);
        }
        const crystalVis = this.crystals.get(ev.propId);
        if (crystalVis) {
          crystalVis.shakeTimer = 0.34;
        }
      }
    }
  }

  /**
   * Met à jour les animations du monde, la transition Overworld ↔ Donjon,
   * l'océan GLSL synchronisé météo/bateau, les coffres, les cristaux et le halo d'interaction.
   */
  public update(
    state: GameState,
    dt: number,
    weather?: WeatherSnapshot | null,
    fogNear = 115,
    fogFar = 265,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    this.animTime += safeDt;

    if (this.currentZoneId !== state.zoneId) {
      this.loadZone(state.zoneId, state);
    }

    if (!this.zoneGroup) return;

    this.syncChests(state.chests, this.zoneGroup);
    this.syncHealingCrystals(state);

    // 1. Eau océanique animée (6 trains Gerstner + météo + cycle jour-nuit + couplage bateau)
    if (this.waterShaderMat) {
      const p = this.waterUpdatePayload;
      p.time = weather ? weather.oceanTime : this.animTime;
      p.fogNear = fogNear;
      p.fogFar = fogFar;

      if (weather) {
        p.sunDirection = weather.sunDirection;
        p.sunColor = weather.sunColor;
        p.ambientColor = weather.ambientColor;
        p.skyReflectColor = weather.skyReflectColor;
        p.horizonReflectColor = weather.horizonReflectColor;
        p.shallowColor = weather.waterShallowColor;
        p.midColor = weather.waterMidColor;
        p.deepColor = weather.waterDeepColor;
        p.foamColor = weather.waterFoamColor;
        p.fogColor = weather.fogColor;
        p.waveAmplitude = weather.waveAmplitude;
        p.waveChoppiness = weather.waveChoppiness;
        p.stormIntensity = weather.stormIntensity;
        p.windDirX = weather.windDirX;
        p.windDirZ = weather.windDirZ;
        p.windIntensity = weather.windIntensity;
        p.sunGlintIntensity = weather.sunGlintIntensity;
        p.causticsIntensity = weather.causticsIntensity;
        p.sunsetFactor = weather.sunsetFactor;
        p.nightFactor = weather.nightFactor;
        p.lightningFlash = weather.lightningFlash;
      }

      const ship = state.ship;
      const isActivelyMoving = ship.mode === 'sailing' || ship.mode === 'docking';
      p.shipActive = state.zoneId === 'overworld';
      p.shipX = ship.position.x;
      p.shipZ = ship.position.z;
      p.shipHeading = ship.angle;
      p.shipSignedSpeedRatio = isActivelyMoving
        ? ship.speed >= 0
          ? Math.min(1, ship.speed / 13.5)
          : -Math.min(1, Math.abs(ship.speed) / 4.2)
        : 0;
      p.shipAbsSpeedRatio = isActivelyMoving
        ? Math.min(1, Math.max(Math.abs(ship.speed) / 13.5, ship.wakeIntensity * 0.85))
        : 0;
      p.shipTurnRate = isActivelyMoving
        ? Math.max(-1, Math.min(1, ship.angularVelocity * 0.65))
        : 0;

      updateWaterMaterial(this.waterShaderMat, p);
    } else if (this.waterMesh && this.waterTex) {
      this.waterMesh.position.y = WATER_LEVEL_Y + Math.sin(this.animTime * 1.4) * 0.03;
      this.waterTex.offset.x = (this.animTime * 0.012) % 1;
      this.waterTex.offset.y = Math.sin(this.animTime * 0.35) * 0.025;
    }

    // Atténue doucement les étiquettes cartographiques maritimes la nuit, en brouillard ou tempête
    if (this.seaLabelMats.length > 0) {
      const labelDim = weather
        ? Math.max(0.28, 0.82 - weather.fogIntensity * 0.38 - weather.nightFactor * 0.25)
        : 0.82;
      for (const mat of this.seaLabelMats) {
        mat.opacity = labelDim;
      }
    }

    // 2. Uniforms globaux de vent GLSL + brise douce sur arbres
    const windPower = weather ? weather.windIntensity : 0.2;
    SHARED_PROP_WIND_UNIFORMS.uGlobalWindTime.value = this.animTime;
    SHARED_PROP_WIND_UNIFORMS.uGlobalWindPower.value = windPower;
    SHARED_PROP_WIND_UNIFORMS.uGlobalWindDirX.value = weather ? weather.windDirX : 0.85;

    const swayFreq = 1.65 + windPower * 2.15;
    const swayBoost = 0.72 + windPower * 1.35;
    for (const entry of this.swayProps) {
      entry.mesh.rotation.z =
        Math.sin(this.animTime * swayFreq + entry.phase) * entry.amplitude * swayBoost;
    }

    // 2b. Lampadaires 2.5D synchronisés sur weather.lanternBoost (vitre émissive HDR + vraie PointLight)
    const lampBoost = weather ? weather.lanternBoost : 0;
    const lampsLit = lampBoost > 0.08;
    for (const lamp of this.lampposts) {
      if (lamp.lit !== lampsLit) {
        lamp.lit = lampsLit;
        const nextTex = this.textures.getLamppostTexture(lampsLit);
        lamp.material.map = nextTex;
        lamp.material.emissiveMap = lampsLit ? nextTex : null;
        lamp.material.needsUpdate = true;
      }
      if (lampsLit) {
        const flick = 0.92 + Math.sin(this.animTime * 7.4 + lamp.phase) * 0.08;
        lamp.material.emissiveIntensity = lampBoost * 1.45 * flick;
      } else {
        lamp.material.emissiveIntensity = 0;
      }
    }

    // 2c. Bâtiments vivants (émissif propre des fenêtres/foyer + vraies PointLights dans SceneManager)
    let hasAvailableQuest = false;
    for (const qKey in state.quests) {
      if (state.quests[qKey as keyof typeof state.quests]?.status === 'available') {
        hasAvailableQuest = true;
        break;
      }
    }
    for (const b of this.buildings) {
      const distP = Math.hypot(state.player.x - b.x, state.player.z - b.z);
      if (b.kind === 'forge') {
        const fire = 0.28 + Math.sin(this.animTime * 9.5 + b.phase) * 0.09;
        b.material.emissiveIntensity = fire + lampBoost * 0.34;
      } else if (b.kind === 'inn' || b.kind === 'house') {
        const nearBoost = b.kind === 'inn' && distP < 7.5 ? 0.16 : 0;
        b.material.emissiveIntensity = 0.08 + lampBoost * 0.48 + nearBoost;
      } else if (b.kind === 'quest_board') {
        b.mesh.rotation.z = hasAvailableQuest ? Math.sin(this.animTime * 4.8) * 0.025 : 0;
        b.material.emissiveIntensity = hasAvailableQuest
          ? 0.24 + Math.sin(this.animTime * 4.2) * 0.10
          : 0;
      }
    }

    // 3. Machine à états PNJ (Maire Moustache : spritesheet baked 45f 9×5 @ 30 FPS idle/talk/greet)
    const activeDialogueSpeaker = state.dialogue.active
      ? state.dialogue.lines[state.dialogue.currentIndex]?.portraitId
      : null;
    const latestMayorSheet = this.textures.getNpcSheetTexture('mayor_moustache');
    for (const npc of this.npcs) {
      const distNpc = Math.hypot(state.player.x - npc.x, state.player.z - npc.z);
      const isTalking = activeDialogueSpeaker === npc.id;
      const isGreeting = !isTalking && distNpc < 5.4;
      const nextState: 'idle' | 'talk' | 'greet' = isTalking
        ? 'talk'
        : isGreeting
          ? 'greet'
          : 'idle';
      const stateChanged = npc.state !== nextState;
      npc.state = nextState;

      if (npc.id === 'mayor_moustache' && latestMayorSheet && npc.sourceSheet !== latestMayorSheet) {
        const cloned = this.cloneTrackedSheet(latestMayorSheet);
        npc.sourceSheet = latestMayorSheet;
        npc.sheetTex = cloned;
        npc.animFrame = -1;
        npc.material.map = cloned;
        npc.material.needsUpdate = true;
      }

      if (npc.id === 'mayor_moustache' && npc.sheetTex && npc.sourceSheet) {
        const localFrame = Math.floor(this.animTime * 30 + npc.phase * 3) % 15;
        if (stateChanged || npc.animFrame !== localFrame) {
          npc.animFrame = localFrame;
          const dims = getTextureDimensions(npc.sourceSheet);
          const grid = resolveMayorMoustacheGrid(npc.state, dims?.width ?? 0, dims?.height ?? 0);
          computeGridFrameUvInto(grid, localFrame, npc.uvRect, true);
          applyUvRectToTexture(npc.sheetTex, npc.uvRect);
        }
        npc.mesh.scale.set(npc.baseScaleX, npc.baseScaleY, 1);
        npc.mesh.rotation.z = 0;
      } else if (npc.state === 'talk') {
        const talkBob = Math.abs(Math.sin(this.animTime * 10.5 + npc.phase));
        npc.mesh.scale.set(
          npc.baseScaleX * (1 + talkBob * 0.035),
          npc.baseScaleY * (0.98 + talkBob * 0.055),
          1,
        );
        npc.mesh.rotation.z = Math.sin(this.animTime * 6.4) * 0.035;
      } else if (npc.state === 'greet') {
        const greetWave = Math.sin(this.animTime * 5.2 + npc.phase);
        npc.mesh.scale.set(
          npc.baseScaleX * (1 - greetWave * 0.015),
          npc.baseScaleY * (1.02 + Math.abs(greetWave) * 0.035),
          1,
        );
        npc.mesh.rotation.z = greetWave * 0.045;
      } else {
        const breath = 1 + Math.sin(this.animTime * 3.0 + npc.phase) * 0.025;
        npc.mesh.scale.set(npc.baseScaleX, npc.baseScaleY * breath, 1);
        npc.mesh.rotation.z = 0;
      }
    }

    // 4. Mise à jour du sceau runique GLSL rotatif & barrière des entrées de donjon
    for (const portal of this.portals) {
      const shouldBeSealed = portal.requiresRunicKey && !state.player.hasRunicKey;
      if (portal.sealed !== shouldBeSealed) {
        portal.sealed = shouldBeSealed;
        portal.material.map = this.textures.getDungeonEntranceTexture(
          portal.theme,
          portal.levelLabel,
          shouldBeSealed,
        );
        portal.material.needsUpdate = true;
      }
      if (portal.sealMat.uniforms.uTime) {
        portal.sealMat.uniforms.uTime.value = this.animTime;
      }
      if (portal.sealMat.uniforms.uSealed) {
        portal.sealMat.uniforms.uSealed.value = shouldBeSealed ? 1.0 : 0.0;
      }
      if (portal.barrierRing) {
        portal.barrierRing.visible = shouldBeSealed;
        if (shouldBeSealed) {
          portal.barrierRing.rotation.y = this.animTime * 0.7;
          const pulse = 1 + Math.sin(this.animTime * 4) * 0.05;
          portal.barrierRing.scale.set(pulse, 1, pulse);
        }
      }
    }

    // 5. Torches de donjon (spritesheet baked 5×3 = 15 frames @ 30 FPS + flamme HDR + vraie PointLight)
    const latestTorchSheet = this.textures.getPropSheetTexture('prop_torch');
    for (const torch of this.torches) {
      if (latestTorchSheet && torch.sourceSheet !== latestTorchSheet) {
        const cloned = this.cloneTrackedSheet(latestTorchSheet);
        torch.sourceSheet = latestTorchSheet;
        torch.sheetTex = cloned;
        torch.frame = -1;
        torch.material.map = cloned;
        torch.material.emissiveMap = cloned;
        torch.material.needsUpdate = true;
      }
      if (torch.sheetTex) {
        const nextFrame = Math.floor(this.animTime * 30 + torch.phase * 7) % 15;
        if (torch.frame !== nextFrame) {
          torch.frame = nextFrame;
          computeGridFrameUvInto(TORCH_SHEET_GRID, nextFrame, torch.uvRect, true);
          applyUvRectToTexture(torch.sheetTex, torch.uvRect);
        }
      }
      const flicker = 0.96 + Math.sin(this.animTime * 14 + torch.phase) * 0.04;
      torch.mesh.scale.y = 1.85 * flicker;
      torch.material.emissiveIntensity =
        1.52 + Math.sin(this.animTime * 16 + torch.phase) * 0.24;
      if (torch.light) {
        torch.light.intensity =
          torch.baseIntensity *
          (0.88 + Math.sin(this.animTime * 15 + torch.phase) * 0.14);
      }
    }

    // 6. Portail de sortie de donjon lumineux HDR (spritesheet baked 6×5 = 30f @ 30 FPS + vortex GLSL)
    const latestPortalSheet = this.textures.getPropSheetTexture('portal_exit');
    if (
      this.exitPortalMat &&
      latestPortalSheet &&
      this.exitPortalSourceSheet !== latestPortalSheet
    ) {
      const cloned = this.cloneTrackedSheet(latestPortalSheet);
      this.exitPortalSourceSheet = latestPortalSheet;
      this.exitPortalSheetTex = cloned;
      this.exitPortalFrame = -1;
      this.exitPortalMat.map = cloned;
      this.exitPortalMat.emissiveMap = cloned;
      this.exitPortalMat.needsUpdate = true;
    }
    if (this.exitPortalMesh && this.exitPortalRing) {
      const frame30 = Math.floor(this.animTime * 30) % 30;
      if (this.exitPortalSheetTex && this.exitPortalFrame !== frame30) {
        this.exitPortalFrame = frame30;
        computeGridFrameUvInto(PORTAL_EXIT_SHEET_GRID, frame30, this.exitPortalUvRect, true);
        applyUvRectToTexture(this.exitPortalSheetTex, this.exitPortalUvRect);
      }
      const pulse = 1 + Math.sin(this.animTime * 3.5) * 0.05;
      this.exitPortalMesh.scale.set(3.2 * pulse, 3.4 * pulse, 1);
      this.exitPortalRing.rotation.y = this.animTime * 1.2;
      if (this.exitPortalMat) {
        this.exitPortalMat.emissiveIntensity =
          1.42 + Math.sin(this.animTime * 4.2) * 0.2;
      }
      if (this.exitPortalVortexMat) {
        if (this.exitPortalVortexMat.uniforms.uTime) {
          this.exitPortalVortexMat.uniforms.uTime.value = this.animTime;
        }
        if (this.exitPortalVortexMat.uniforms.uFrameNorm) {
          this.exitPortalVortexMat.uniforms.uFrameNorm.value = frame30 / 30;
        }
      }
    }

    // 6b. Fleurs posées à plat au sol (relèvement + inclinaison radiale au passage du héros)
    for (let i = 0; i < this.flowerPatches.length; i++) {
      const f = this.flowerPatches[i];
      const dx = f.x - state.player.x;
      const dz = f.z - state.player.z;
      const d = Math.hypot(dx, dz);
      const near = d < 2.1;
      const targetLift = near ? 1 : 0;
      f.lift += (targetLift - f.lift) * Math.min(1, safeDt * 7);
      const targetBendX = near && d > 1e-4 ? (dz / d) * 0.28 : 0;
      const targetBendZ = near && d > 1e-4 ? -(dx / d) * 0.28 : 0;
      f.bendX += (targetBendX - f.bendX) * Math.min(1, safeDt * 10);
      f.bendZ += (targetBendZ - f.bendZ) * Math.min(1, safeDt * 10);
      f.mesh.position.y = f.baseY + f.lift * 0.06;
      f.mesh.rotation.x = f.baseRotX + f.lift * 0.2 + f.bendX;
      f.mesh.rotation.z = f.baseRotZ + f.bendZ;
    }

    // 6c. Secousse / vibration des props interactifs touchés (non-bloquant)
    for (const propVis of this.interactiveProps.values()) {
      if (propVis.shakeTimer > 0) {
        propVis.shakeTimer = Math.max(0, propVis.shakeTimer - safeDt);
        const elapsed = 0.34 - propVis.shakeTimer;
        const vib = Math.sin(elapsed * 44) * Math.exp(-elapsed * 8.5);
        propVis.mesh.rotation.z = propVis.baseRotZ + vib * propVis.amplitude;
        propVis.mesh.position.x = propVis.baseX + vib * propVis.hitDirX * 0.08;
      } else if (propVis.mesh.position.x !== propVis.baseX) {
        propVis.mesh.position.x = propVis.baseX;
        propVis.mesh.rotation.z = propVis.baseRotZ;
      }
    }

    // 6d. Touffes d'herbe flexibles au passage du héros + vent météo
    if (this.grassTuftMesh && this.grassTufts.length > 0 && state.zoneId === 'overworld') {
      const windX = weather ? weather.windDirX : 0.85;
      const windStr = weather ? weather.windIntensity : 0.2;
      for (let i = 0; i < this.grassTufts.length; i++) {
        const gt = this.grassTufts[i];
        const dx = gt.x - state.player.x;
        const dz = gt.z - state.player.z;
        const dSq = dx * dx + dz * dz;
        let tBendX = 0;
        let tBendZ = 0;
        if (dSq < 1.65 * 1.65 && dSq > 1e-6) {
          const d = Math.sqrt(dSq);
          const push = (1 - d / 1.65) * 0.62;
          tBendX = (dz / d) * push;
          tBendZ = -(dx / d) * push;
        }
        const lerpAlpha = Math.min(1, safeDt * 12);
        gt.bendX += (tBendX - gt.bendX) * lerpAlpha;
        gt.bendZ += (tBendZ - gt.bendZ) * lerpAlpha;
        const sway = Math.sin(this.animTime * (1.8 + windStr * 2.2) + gt.phase) * (0.08 + windStr * 0.16);
        this.decorDummy.position.set(gt.x, gt.y, gt.z);
        this.decorDummy.rotation.set(gt.bendX, gt.rotY, gt.bendZ + sway * windX);
        this.decorDummy.scale.setScalar(gt.scale);
        this.decorDummy.updateMatrix();
        this.grassTuftMesh.setMatrixAt(i, this.decorDummy.matrix);
      }
      this.grassTuftMesh.instanceMatrix.needsUpdate = true;
    }

    // 6e. Pétales & feuilles portés par le vent (synchronisés à weatherSystem.ts)
    if (this.windPetalMesh && this.windPetals.length > 0 && state.zoneId === 'overworld') {
      const wx = weather ? weather.windDirX : 0.85;
      const wz = weather ? weather.windDirZ : 0.35;
      const wInt = weather ? weather.windIntensity : 0.22;
      const windSpeed = 1.4 + wInt * 5.2;
      const focusX = state.ship.mode === 'sailing' ? state.ship.position.x : state.player.x;
      const focusZ = state.ship.mode === 'sailing' ? state.ship.position.z : state.player.z;

      for (let i = 0; i < this.windPetals.length; i++) {
        const pt = this.windPetals[i];
        pt.phase += safeDt * (2.5 + wInt * 3.0);
        pt.x += (wx * windSpeed + Math.sin(pt.phase) * 0.6) * safeDt;
        pt.z += (wz * windSpeed + Math.cos(pt.phase * 0.8) * 0.5) * safeDt;
        pt.y += pt.vy * safeDt;

        if (
          pt.y < 0.08 ||
          Math.abs(pt.x - focusX) > 26 ||
          Math.abs(pt.z - focusZ) > 26
        ) {
          pt.x = focusX + ((i * 73) % 44) - 22;
          pt.z = focusZ + ((i * 137) % 44) - 22;
          pt.y = 2.6 + (i % 5) * 0.55;
        }
        this.decorDummy.position.set(pt.x, pt.y, pt.z);
        this.decorDummy.rotation.set(pt.phase, pt.phase * 1.3, pt.phase * 0.7);
        this.decorDummy.scale.setScalar(pt.scale);
        this.decorDummy.updateMatrix();
        this.windPetalMesh.setMatrixAt(i, this.decorDummy.matrix);
      }
      this.windPetalMesh.instanceMatrix.needsUpdate = true;
    }

    // 7. Coffres fermés scintillants + ouverture lente (~1.35s) synchronisée à `chest.openingProgress`
    const chestOpeningSource = this.textures.getPropSheetTexture('chest_opening');
    for (const chest of this.chests.values()) {
      if (chest.stateKey === 'closed') {
        const bob = Math.max(0, Math.sin(this.animTime * 3.2 + chest.phase)) * 0.06;
        chest.mesh.position.y = chest.baseY + bob;
        chest.mesh.rotation.z = 0;
        if (chest.tier === 'golden' || chest.tier === 'epic') {
          chest.material.emissiveIntensity =
            0.38 + Math.sin(this.animTime * 3.2 + chest.phase) * 0.12;
        }
      } else if (chest.stateKey === 'opening') {
        // Ouverture progressive lente (1.35 s) : petit frémissement de serrure -> levée douce du couvercle + éclat doré
        const prog = Math.max(0, Math.min(1, chest.openAnimProgress));
        const frame15 = Math.min(14, Math.floor(prog * 15));
        if (chestOpeningSource) {
          if (chest.openSourceSheet !== chestOpeningSource || !chest.openSheetTex) {
            chest.openSourceSheet = chestOpeningSource;
            chest.openSheetTex = this.cloneTrackedSheet(chestOpeningSource);
            chest.material.map = chest.openSheetTex;
            chest.material.needsUpdate = true;
          }
          if (chest.openAnimFrame !== frame15) {
            chest.openAnimFrame = frame15;
            computeGridFrameUvInto(CHEST_OPENING_SHEET_GRID, frame15, chest.uvRect, true);
            applyUvRectToTexture(chest.openSheetTex, chest.uvRect);
          }
        }
        const rattle = prog < 0.28 ? Math.sin(this.animTime * 34) * 0.055 * (1 - prog / 0.28) : 0;
        const popY = Math.sin(prog * Math.PI) * 0.20;
        chest.mesh.position.y = chest.baseY + popY;
        chest.mesh.rotation.z = rattle;
        chest.material.emissive.setHex(chest.tier === 'epic' ? 0xb366ff : 0xffd452);
        chest.material.emissiveIntensity = 0.22 + prog * 0.95;
      } else if (chest.stateKey === 'open' && chest.openAnimProgress < 1) {
        chest.openAnimProgress = Math.min(1, chest.openAnimProgress + safeDt / 1.35);
        const frame15 = Math.min(14, Math.floor(chest.openAnimProgress * 15));
        if (chestOpeningSource) {
          if (chest.openSourceSheet !== chestOpeningSource || !chest.openSheetTex) {
            chest.openSourceSheet = chestOpeningSource;
            chest.openSheetTex = this.cloneTrackedSheet(chestOpeningSource);
            chest.material.map = chest.openSheetTex;
            chest.material.needsUpdate = true;
          }
          if (chest.openAnimFrame !== frame15) {
            chest.openAnimFrame = frame15;
            computeGridFrameUvInto(CHEST_OPENING_SHEET_GRID, frame15, chest.uvRect, true);
            applyUvRectToTexture(chest.openSheetTex, chest.uvRect);
          }
        }
        const popY = Math.sin(chest.openAnimProgress * Math.PI) * 0.18;
        chest.mesh.position.y = chest.baseY + popY;
        chest.mesh.rotation.z = 0;
        if (chest.openAnimProgress >= 1) {
          chest.material.map = this.textures.getChestTexture(chest.tier, 'open');
          chest.material.needsUpdate = true;
          chest.mesh.position.y = chest.baseY;
          chest.material.emissiveIntensity = 0;
        }
      } else {
        chest.mesh.position.y = chest.baseY;
        chest.mesh.rotation.z = 0;
      }
    }

    // 8. Cristal de soin flottant + pulsation HDR émeraude (éclairage assuré par vraie PointLight)
    for (const crystal of this.crystals.values()) {
      let shakeX = 0;
      let shakeRot = 0;
      if (crystal.shakeTimer > 0) {
        crystal.shakeTimer = Math.max(0, crystal.shakeTimer - safeDt);
        const el = 0.34 - crystal.shakeTimer;
        const vib = Math.sin(el * 44) * Math.exp(-el * 8.5);
        shakeX = vib * 0.08;
        shakeRot = vib * 0.14;
      }
      crystal.mesh.position.x = crystal.x + shakeX;
      crystal.mesh.rotation.z = shakeRot;
      if (!crystal.used) {
        const floatY = 0.08 + Math.sin(this.animTime * 3.4 + crystal.phase) * 0.12;
        crystal.mesh.position.y = floatY;
        crystal.material.emissiveIntensity =
          1.48 + Math.sin(this.animTime * 3.8 + crystal.phase) * 0.24;
      } else {
        crystal.mesh.position.y = 0;
        crystal.material.emissiveIntensity = 0;
      }
    }

    // 9. Halo doré discret sous l'élément interactif le plus proche (ou zone de débarquement)
    const nearest = state.nearestInteractable;
    if (nearest && state.screen === 'playing' && !state.dialogue.active) {
      this.highlightRing.visible = true;
      const zOffset =
        nearest.type === 'inn' || nearest.type === 'forge' || nearest.type === 'quest_board'
          ? 0.28
          : nearest.type === 'dungeon_entrance'
            ? 0.25
            : 0;
      const ringY =
        nearest.type === 'ship_board' ? WATER_LEVEL_Y + 0.18 : 0.052;
      this.highlightRing.position.set(nearest.x, ringY, nearest.z + zOffset);
      const p = 1 + Math.sin(this.animTime * 5.0) * 0.05;
      const baseR =
        nearest.type === 'ship_board'
          ? 2.75
          : nearest.type === 'ship_disembark'
            ? 1.25
            : nearest.type === 'dungeon_entrance' || nearest.type === 'dungeon_exit'
              ? 1.45
              : nearest.type === 'inn' || nearest.type === 'forge'
                ? 1.05
                : nearest.type === 'quest_board'
                  ? 0.85
                  : 1.05;
      this.highlightRing.scale.set(baseR * p, 1, baseR * p);
      this.highlightRingMat.opacity = 0.56 + Math.sin(this.animTime * 5.0) * 0.16;
    } else {
      this.highlightRing.visible = false;
    }
  }

  public dispose(): void {
    this.torchLightsHandler?.([]);
    this.clearZone();
    this.rootGroup.remove(this.highlightRing);
    this.scene.remove(this.rootGroup);
    this.spriteGeo.dispose();
    this.glowGeo.dispose();
    this.shadowGeo.dispose();
    this.buildingShadowTex?.dispose();
    this.highlightRingGeo.dispose();
    this.highlightRingMat.dispose();
  }

  /**
   * Module l'atmosphère de l'Antre du Dragon-Griffe :
   * - `heatIntensity` [0..1] : rougeoiement/fusion du sol et des murs pendant l'intro & Phase 2
   * - `clearedProgress` [0..1] : refroidissement & éclaircissement de l'antre à la mort de Drak-Miaou
   */
  public setDragonLairAtmosphere(heatIntensity: number, clearedProgress: number): void {
    if (!this.activeDungeon || this.activeDungeon.theme !== 'dragon_lair') {
      return;
    }
    const heat = Math.max(0, Math.min(1, heatIntensity));
    const cleared = Math.max(0, Math.min(1, clearedProgress));

    if (this.dungeonFloorMat) {
      if (cleared > 0.01) {
        this.dungeonFloorMat.emissive.setHex(0xffffff).lerp(DRAGON_LAIR_CLEARED_EMISSIVE, cleared * 0.45);
        this.dungeonFloorMat.emissiveIntensity = Math.max(0.45, 1.35 * (1 - cleared * 0.65));
        this.dungeonFloorMat.color.setHex(0xffffff).lerp(DRAGON_LAIR_CLEARED_COLOR, cleared * 0.25);
      } else {
        this.dungeonFloorMat.emissive.setHex(0xffffff).lerp(DRAGON_LAIR_HEAT_EMISSIVE, heat * 0.85);
        this.dungeonFloorMat.emissiveIntensity = 1.35 + heat * 1.55;
        this.dungeonFloorMat.color.setHex(0xffffff);
      }
    }

    if (this.dungeonWallSideMat) {
      if (cleared > 0.01) {
        this.dungeonWallSideMat.emissive.setHex(0xffe6ba);
        this.dungeonWallSideMat.emissiveIntensity = cleared * 0.24;
      } else {
        this.dungeonWallSideMat.emissive.setHex(0xff3814);
        this.dungeonWallSideMat.emissiveIntensity = heat * 0.36;
      }
    }

    for (const torch of this.torches) {
      if (cleared > 0.01) {
        torch.baseIntensity = 14.5 + cleared * 4.5;
      } else {
        torch.baseIntensity = 14.5 + heat * 6.5;
      }
    }
  }
}
