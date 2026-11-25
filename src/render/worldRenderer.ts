import * as THREE from 'three';
import type {
  BuildingDef,
  ChestInstance,
  ChestTier,
  DungeonDefinition,
  GameState,
  PropKind,
  ZoneId,
} from '../game/types';
import {
  OVERWORLD_DATA,
  OVERWORLD_HALF_SIZE,
} from '../data/worldData';
import {
  ALL_NEW_ISLANDS,
  NEW_ISLANDS,
} from '../data/worldIslands';
import { getIslandTerrainHeightLocal } from '../game/shorelineNavigation';
import { DUNGEONS } from '../data/dungeonsData';
import { DUNGEON_PALETTE, GOLD_LIGHT } from '../art/palette';
import { TextureRegistry } from '../art/textureRegistry';
import {
  type WaterDynamicUpdate,
  createWaterGeometry,
  createWaterMaterial,
  updateWaterMaterial,
} from './shaders/waterShader';
import type { WeatherSnapshot } from './weatherSystem';
import { enableSpriteLighting } from './spriteLighting';

const SPRITE_TILT_X = -0.48;
const WATER_LEVEL_Y = -0.14;

export interface TorchLightPosition {
  x: number;
  y: number;
  z: number;
  intensity?: number;
  distance?: number;
  outdoor?: boolean;
}

// Sources lumineuses prévues pour des lampadaires générés. Les huit plus proches
// sont activées par le pool de SceneManager; chaque coordonnée est dégagée des
// bâtiments, PNJ, routes principales et obstacles pour ne bloquer aucun passage.
// La géométrie de sprite visible sera branchée sur ces mêmes coordonnées dès que
// les visuels générés de lampadaires seront disponibles.
export const OVERWORLD_LAMP_LIGHTS: readonly TorchLightPosition[] = [
  { x: 2.4, y: 2.35, z: 21.0, intensity: 2.4, distance: 12.5, outdoor: true },
  { x: -4.4, y: 2.35, z: 23.2, intensity: 2.35, distance: 12.5, outdoor: true },
  { x: 5.6, y: 2.35, z: 23.2, intensity: 2.35, distance: 12.5, outdoor: true },
  { x: 2.8, y: 2.35, z: 31.2, intensity: 2.25, distance: 12.5, outdoor: true },
  { x: 0.3, y: 2.35, z: 5.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: 4.8, y: 2.35, z: -19.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: 8.2, y: 2.35, z: -36.0, intensity: 2.3, distance: 12.5, outdoor: true },
  { x: 17.0, y: 2.35, z: 17.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: 27.0, y: 2.35, z: 9.0, intensity: 2.15, distance: 12.5, outdoor: true },
  { x: -18.0, y: 2.35, z: 10.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: -32.0, y: 2.35, z: -10.0, intensity: 2.15, distance: 12.5, outdoor: true },
  { x: 86.0, y: 2.35, z: 48.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: 68.0, y: 2.35, z: -84.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: -79.0, y: 2.35, z: 58.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: -111.0, y: 2.35, z: -74.0, intensity: 2.2, distance: 12.5, outdoor: true },
  { x: 18.0, y: 2.35, z: -107.0, intensity: 2.2, distance: 12.5, outdoor: true },
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
  glowMesh: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  baseGlowOpacity: number;
  sealed: boolean;
  barrierRing: THREE.Mesh | null;
}

interface ChestVisual {
  id: string;
  tier: ChestTier;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  shadow: THREE.Mesh;
  glowMesh: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  baseGlowOpacity: number;
  glowCenterY: number;
  stateKey: 'closed' | 'open' | 'locked';
  baseY: number;
  phase: number;
}

interface CrystalVisual {
  id: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  shadow: THREE.Mesh;
  glowMesh: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  glowBaseY: number;
  used: boolean;
  phase: number;
}

interface TorchVisual {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  glowMesh: THREE.Mesh;
  glowMat: THREE.MeshBasicMaterial;
  phase: number;
  frame: 0 | 1;
  light?: THREE.PointLight;
  baseIntensity: number;
}

interface NpcVisual {
  id: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  baseScaleY: number;
  phase: number;
}

interface RefreshableBinding {
  material: THREE.MeshStandardMaterial;
  resolve: () => THREE.Texture;
  syncEmissiveMap?: boolean;
}

const PROP_BASE_SIZES: Record<
  PropKind,
  { w: number; h: number; shadowR: number; sways?: boolean }
> = {
  oak_tree: { w: 4.5, h: 4.7, shadowR: 1.55, sways: true },
  twisted_tree: { w: 4.8, h: 5.0, shadowR: 1.6, sways: true },
  snow_pine: { w: 4.2, h: 5.1, shadowR: 1.45, sways: true },
  rock: { w: 2.3, h: 2.1, shadowR: 1.05 },
  snow_rock: { w: 2.5, h: 2.2, shadowR: 1.1 },
  flower_patch: { w: 1.8, h: 1.5, shadowR: 0 },
  mushroom: { w: 1.6, h: 1.6, shadowR: 0.5 },
  house_cat: { w: 4.6, h: 4.6, shadowR: 1.9 },
  signpost: { w: 1.8, h: 2.0, shadowR: 0.45 },
  fence: { w: 2.2, h: 1.4, shadowR: 0 },
};

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
  private readonly highlightRingGeo: THREE.RingGeometry;
  private readonly highlightRingMat: THREE.MeshBasicMaterial;
  private readonly highlightRing: THREE.Mesh;

  // Matériaux & géométries temporaires de la zone courante à disposer au changement de zone
  private zoneDisposables: Array<{ dispose(): void }> = [];

  // Références aux surfaces PBR actives pour hot-swap HD sans recharge
  private overworldGroundMat: THREE.MeshStandardMaterial | null = null;
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
  private exitPortalRing: THREE.Mesh | null = null;
  private torches: TorchVisual[] = [];
  private npcs: NpcVisual[] = [];
  private chests = new Map<string, ChestVisual>();
  private crystals = new Map<string, CrystalVisual>();

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

  private createShadowMesh(
    x: number,
    z: number,
    rx: number,
    rz = rx * 0.72,
  ): THREE.Mesh {
    const mat = this.trackDisposable(
      new THREE.MeshBasicMaterial({
        map: this.textures.getShadowTexture(),
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
      }),
    );
    const mesh = new THREE.Mesh(this.shadowGeo, mat);
    mesh.position.set(x, 0.03, z);
    mesh.scale.set(rx, 1, rz);
    mesh.renderOrder = 1;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.userData.skipSSAO = true;
    return mesh;
  }

  private createGlowBillboard(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    colorHex: number,
    opacity: number,
  ): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
    const material = this.trackDisposable(
      new THREE.MeshBasicMaterial({
        map: this.textures.getParticleTexture(),
        color: new THREE.Color(colorHex),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    const mesh = new THREE.Mesh(this.glowGeo, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, 1);
    mesh.rotation.x = SPRITE_TILT_X;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 2;
    mesh.userData.skipSSAO = true;
    return { mesh, material };
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
    this.exitPortalRing = null;
    this.torches = [];
    this.npcs = [];
    this.chests.clear();
    this.crystals.clear();
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
      this.torchLightsHandler?.(OVERWORLD_LAMP_LIGHTS);
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

    for (const chest of this.chests.values()) {
      chest.material.map = this.textures.getChestTexture(
        chest.tier,
        chest.stateKey,
      );
      chest.material.needsUpdate = true;
    }

    for (const crystal of this.crystals.values()) {
      const nextTex = this.textures.getHealingCrystalTexture(crystal.used);
      crystal.material.map = nextTex;
      crystal.material.emissiveMap = crystal.used ? null : nextTex;
      crystal.material.needsUpdate = true;
    }

    for (const torch of this.torches) {
      const nextTex = this.textures.getTorchTexture(torch.frame);
      torch.material.map = nextTex;
      torch.material.emissiveMap = nextTex;
      torch.material.needsUpdate = true;
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

    // 3. Bâtiments de Miaou-bourg (toujours présents en overworld)
    for (const b of OVERWORLD_DATA.buildings) {
      const dims =
        b.kind === 'quest_board'
          ? { w: 2.9, h: 3.0, shadow: 1.15 }
          : b.kind === 'house'
            ? { w: 5.0, h: 5.0, shadow: 2.1 }
            : { w: 5.8, h: 5.8, shadow: 2.35 };

      const kind: BuildingDef['kind'] = b.kind;
      const isForge = kind === 'forge';
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getBuildingTexture(kind),
        b.x,
        b.z,
        dims.w,
        dims.h,
        {
          roughness: 0.72,
          metalness: isForge ? 0.14 : 0.06,
          emissiveHex: isForge ? 0xff7728 : 0x000000,
          emissiveIntensity: isForge ? 0.28 : 0,
          useEmissiveMap: isForge,
        },
      );
      this.refreshableBindings.push({
        material,
        resolve: () => this.textures.getBuildingTexture(kind),
        syncEmissiveMap: isForge,
      });
      group.add(mesh);
      group.add(this.createShadowMesh(b.x, b.z + 0.15, dims.shadow, dims.shadow * 0.65));
    }

    // 4. PNJ (Maire Moustache)
    for (const npc of OVERWORLD_DATA.npcs) {
      const npcId = npc.id;
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getNpcTexture(npcId),
        npc.x,
        npc.z,
        2.15,
        2.25,
      );
      this.refreshableBindings.push({
        material,
        resolve: () => this.textures.getNpcTexture(npcId),
      });
      group.add(mesh);
      group.add(this.createShadowMesh(npc.x, npc.z, 0.72, 0.5));
      this.npcs.push({ id: npcId, mesh, material, baseScaleY: 2.25, phase: npc.x * 0.7 });
    }

    // 5. Entrées des 2 Donjons (+ badge Niv. X + barrière runique dynamique HDR)
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
      const { mesh, material } = this.createCutoutSprite(
        tex,
        portal.x,
        portal.z,
        size,
        size,
        {
          roughness: 0.78,
          emissiveHex: theme === 'dragon_lair' ? 0xff6d28 : 0x8d68ff,
          emissiveIntensity: 0.22,
          useEmissiveMap: true,
        },
      );
      group.add(mesh);
      group.add(this.createShadowMesh(portal.x, portal.z + 0.2, size * 0.42, size * 0.25));

      const portalGlowH = size * 0.42;
      const baseGlowOpacity = sealed ? 0.3 : 0.46;
      const { mesh: glowMesh, material: glowMat } = this.createGlowBillboard(
        portal.x,
        portalGlowH * Math.cos(Math.abs(SPRITE_TILT_X)),
        portal.z - portalGlowH * Math.sin(Math.abs(SPRITE_TILT_X)) - 0.06,
        size * 0.82,
        size * 0.82,
        theme === 'dragon_lair' ? 0xff6d28 : 0x8d68ff,
        baseGlowOpacity,
      );
      group.add(glowMesh);

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
        glowMesh,
        glowMat,
        baseGlowOpacity,
        sealed,
        barrierRing,
      });
    }

    // 6. Props 2.5D de TOUTES les 6 îles (arbres par biome, rochers, fleurs, champignons, panneaux)
    const allOverworldProps = [
      ...OVERWORLD_DATA.props,
      ...ALL_NEW_ISLANDS.flatMap((id) => NEW_ISLANDS[id].props),
    ];
    for (const prop of allOverworldProps) {
      const spec = PROP_BASE_SIZES[prop.kind];
      const w = spec.w * prop.scale;
      const h = spec.h * prop.scale;
      const kind = prop.kind;
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getPropTexture(kind),
        prop.x,
        prop.z,
        w,
        h,
        {
          castShadow: spec.shadowR > 0,
        },
      );
      this.refreshableBindings.push({
        material,
        resolve: () => this.textures.getPropTexture(kind),
      });
      group.add(mesh);

      if (spec.shadowR > 0) {
        group.add(
          this.createShadowMesh(
            prop.x,
            prop.z + 0.08,
            spec.shadowR * prop.scale,
            spec.shadowR * prop.scale * 0.65,
          ),
        );
      }

      if (spec.sways) {
        this.swayProps.push({
          mesh,
          phase: prop.x * 0.37 + prop.z * 0.29,
          amplitude: 0.026,
        });
      }
    }
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

    // 3. Colonnes sculptées PBR de donjon
    const theme = dungeon.theme;
    for (const pillar of dungeon.pillars) {
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getPillarTexture(theme),
        pillar.x,
        pillar.z,
        2.7,
        4.2,
        {
          roughness: 0.8,
          emissiveHex: theme === 'dragon_lair' ? 0xff7b38 : 0x7ae2ff,
          emissiveIntensity: 0.22,
          useEmissiveMap: true,
        },
      );
      this.refreshableBindings.push({
        material,
        resolve: () => this.textures.getPillarTexture(theme),
        syncEmissiveMap: true,
      });
      group.add(mesh);
      group.add(this.createShadowMesh(pillar.x, pillar.z + 0.1, 1.25, 0.9));
    }

    // 4. Torches au sol vacillantes HDR + Lumières dynamiques alignées sur la flamme exacte
    const tiltAbs = Math.abs(SPRITE_TILT_X);
    const flameDist = 1.35; // v ≈ 0.73 sur une torche ancrée au sol de hauteur 1.85
    const flameLocalY = flameDist * Math.cos(tiltAbs);
    const flameOffsetZ = -flameDist * Math.sin(tiltAbs);
    const torchPositions: TorchLightPosition[] = dungeon.torches.map((pos) => ({
      x: pos.x,
      y: flameLocalY + 0.14,
      z: pos.z + flameOffsetZ,
      distance: 17,
    }));
    const useSceneTorchLights = this.torchLightsHandler !== null;
    if (useSceneTorchLights) {
      this.torchLightsHandler?.(torchPositions);
    }

    const torchCount = dungeon.torches.length;
    const maxFallbackLights = 6;
    const lightStep = Math.max(1, Math.ceil(torchCount / maxFallbackLights));
    const lightColor = dungeon.theme === 'dragon_lair' ? 0xff8a3d : 0xffaa52;

    dungeon.torches.forEach((pos, idx) => {
      const torchTex = this.textures.getTorchTexture(0);
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

      const { mesh: glowMesh, material: glowMat } = this.createGlowBillboard(
        pos.x,
        flameLocalY,
        pos.z + flameOffsetZ - 0.04,
        1.65,
        1.65,
        dungeon.theme === 'dragon_lair' ? 0xff7a2e : 0xffa642,
        0.55,
      );
      group.add(glowMesh);

      let pointLight: THREE.PointLight | undefined;
      if (
        !useSceneTorchLights &&
        idx % lightStep === 0 &&
        this.torches.filter((t) => t.light).length < maxFallbackLights
      ) {
        pointLight = new THREE.PointLight(lightColor, 6.5, 17, 1.65);
        pointLight.position.set(pos.x, flameLocalY + 0.14, pos.z + flameOffsetZ);
        group.add(pointLight);
      }

      this.torches.push({
        mesh,
        material: mat,
        glowMesh,
        glowMat,
        phase: idx * 1.37,
        frame: 0,
        light: pointLight,
        baseIntensity: 6.5,
      });
    });

    // 5. Portail lumineux HDR de sortie
    const exit = dungeon.exitPortal;
    const exitTex = this.textures.getDungeonExitPortalTexture(dungeon.theme);
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
  }

  private syncChests(chests: ChestInstance[], group: THREE.Group): void {
    const activeIds = new Set<string>();

    for (const c of chests) {
      activeIds.add(c.id);
      const stateKey: 'closed' | 'open' | 'locked' = c.opened
        ? 'open'
        : c.locked
          ? 'locked'
          : 'closed';

      const existing = this.chests.get(c.id);
      if (existing) {
        const scale = c.tier === 'golden' ? 2.15 : 1.85;
        const glowH = scale * 0.45;
        const tiltAbs = Math.abs(SPRITE_TILT_X);
        existing.mesh.position.x = c.x;
        existing.mesh.position.z = c.z;
        existing.shadow.position.x = c.x;
        existing.shadow.position.z = c.z + 0.08;
        existing.glowMesh.position.x = c.x;
        existing.glowMesh.position.z = c.z - glowH * Math.sin(tiltAbs) - 0.05;
        if (existing.stateKey !== stateKey) {
          existing.stateKey = stateKey;
          existing.material.map = this.textures.getChestTexture(c.tier, stateKey);
          existing.material.emissiveIntensity =
            stateKey === 'closed' && (c.tier === 'golden' || c.tier === 'epic')
              ? 0.28
              : 0;
          existing.material.needsUpdate = true;
          existing.glowMesh.visible = stateKey === 'closed' && c.tier !== 'wood';
        }
        continue;
      }

      const scale = c.tier === 'golden' ? 2.15 : 1.85;
      const isGlowingTier =
        stateKey === 'closed' && (c.tier === 'golden' || c.tier === 'epic');
      const { mesh, material } = this.createCutoutSprite(
        this.textures.getChestTexture(c.tier, stateKey),
        c.x,
        c.z,
        scale,
        scale,
        {
          roughness: 0.58,
          metalness: c.tier === 'golden' ? 0.32 : 0.14,
          emissiveHex: c.tier === 'golden' ? 0xffcc42 : 0xb366ff,
          emissiveIntensity: isGlowingTier ? 0.28 : 0,
          useEmissiveMap: true,
        },
      );
      const shadow = this.createShadowMesh(
        c.x,
        c.z + 0.08,
        scale * 0.42,
        scale * 0.28,
      );
      const tiltAbs = Math.abs(SPRITE_TILT_X);
      const glowH = scale * 0.45;
      const glowCenterY = glowH * Math.cos(tiltAbs);
      const glowColor =
        c.tier === 'golden'
          ? 0xffd858
          : c.tier === 'epic'
            ? 0xc472ff
            : 0x68d8ff;
      const baseGlowOpacity = c.tier === 'golden' ? 0.5 : 0.42;
      const { mesh: glowMesh, material: glowMat } = this.createGlowBillboard(
        c.x,
        glowCenterY,
        c.z - glowH * Math.sin(tiltAbs) - 0.05,
        scale * 1.35,
        scale * 1.35,
        glowColor,
        baseGlowOpacity,
      );
      glowMesh.visible = stateKey === 'closed' && c.tier !== 'wood';

      group.add(mesh);
      group.add(shadow);
      group.add(glowMesh);

      this.chests.set(c.id, {
        id: c.id,
        tier: c.tier,
        mesh,
        material,
        shadow,
        glowMesh,
        glowMat,
        baseGlowOpacity,
        glowCenterY,
        stateKey,
        baseY: 0,
        phase: c.x * 0.5 + c.z * 0.3,
      });
    }

    for (const [id, vis] of this.chests.entries()) {
      if (!activeIds.has(id)) {
        group.remove(vis.mesh);
        group.remove(vis.shadow);
        group.remove(vis.glowMesh);
        this.chests.delete(id);
      }
    }
  }

  private syncHealingCrystals(state: GameState): void {
    if (!this.zoneGroup) return;
    const activeIds = new Set<string>();

    for (const crystal of state.healingCrystals) {
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
          existing.glowMesh.visible = !crystal.used;
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
          roughness: 0.28,
          metalness: 0.12,
          emissiveHex: 0x3ef59c,
          emissiveIntensity: crystal.used ? 0 : 1.48,
          useEmissiveMap: !crystal.used,
        },
      );
      const shadow = this.createShadowMesh(crystal.x, crystal.z + 0.05, 0.85, 0.6);
      const tiltAbs = Math.abs(SPRITE_TILT_X);
      const glowH = 1.25;
      const glowBaseY = glowH * Math.cos(tiltAbs);
      const { mesh: glowMesh, material: glowMat } = this.createGlowBillboard(
        crystal.x,
        glowBaseY,
        crystal.z - glowH * Math.sin(tiltAbs) - 0.05,
        2.9,
        2.9,
        0x3ef59c,
        0.52,
      );
      glowMesh.visible = !crystal.used;

      this.zoneGroup.add(mesh);
      this.zoneGroup.add(shadow);
      this.zoneGroup.add(glowMesh);
      this.crystals.set(crystal.id, {
        id: crystal.id,
        mesh,
        material,
        shadow,
        glowMesh,
        glowMat,
        glowBaseY,
        used: crystal.used,
        phase: crystal.x * 0.4,
      });
    }

    for (const [id, vis] of this.crystals.entries()) {
      if (!activeIds.has(id)) {
        this.zoneGroup.remove(vis.mesh);
        this.zoneGroup.remove(vis.shadow);
        this.zoneGroup.remove(vis.glowMesh);
        this.crystals.delete(id);
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

    // 2. Brise & rafales météo sur les arbres (calme -> souffle tempête)
    const windPower = weather ? weather.windIntensity : 0.2;
    const swayFreq = 1.65 + windPower * 2.15;
    const swayBoost = 0.85 + windPower * 1.65;
    for (const entry of this.swayProps) {
      entry.mesh.rotation.z =
        Math.sin(this.animTime * swayFreq + entry.phase) * entry.amplitude * swayBoost +
        Math.sin(this.animTime * (swayFreq * 1.9) + entry.phase * 1.7) *
          entry.amplitude *
          windPower *
          0.45;
    }

    // 3. Respiration douce des PNJ (Maire Moustache)
    for (const npc of this.npcs) {
      const breath = 1 + Math.sin(this.animTime * 3.0 + npc.phase) * 0.025;
      npc.mesh.scale.y = npc.baseScaleY * breath;
    }

    // 4. Mise à jour de la barrière runique & halo additif des entrées de donjon
    for (const portal of this.portals) {
      const shouldBeSealed = portal.requiresRunicKey && !state.player.hasRunicKey;
      if (portal.sealed !== shouldBeSealed) {
        portal.sealed = shouldBeSealed;
        portal.baseGlowOpacity = shouldBeSealed ? 0.3 : 0.46;
        portal.material.map = this.textures.getDungeonEntranceTexture(
          portal.theme,
          portal.levelLabel,
          shouldBeSealed,
        );
        portal.material.needsUpdate = true;
      }
      portal.glowMat.opacity =
        portal.baseGlowOpacity + Math.sin(this.animTime * 2.6) * 0.06;
      if (portal.barrierRing) {
        portal.barrierRing.visible = shouldBeSealed;
        if (shouldBeSealed) {
          portal.barrierRing.rotation.y = this.animTime * 0.7;
          const pulse = 1 + Math.sin(this.animTime * 4) * 0.05;
          portal.barrierRing.scale.set(pulse, 1, pulse);
        }
      }
    }

    // 5. Torches de donjon vacillantes (flamme émissive HDR > 1.3 + halo additif !)
    for (const torch of this.torches) {
      const nextFrame: 0 | 1 =
        Math.sin(this.animTime * 11 + torch.phase) > 0 ? 1 : 0;
      if (torch.frame !== nextFrame) {
        torch.frame = nextFrame;
        const nextTex = this.textures.getTorchTexture(nextFrame);
        torch.material.map = nextTex;
        torch.material.emissiveMap = nextTex;
        torch.material.needsUpdate = true;
      }
      const flicker = 0.94 + Math.sin(this.animTime * 14 + torch.phase) * 0.06;
      torch.mesh.scale.y = 1.85 * flicker;
      torch.material.emissiveIntensity =
        1.48 + Math.sin(this.animTime * 16 + torch.phase) * 0.24;
      const glowPulse = 0.92 + Math.sin(this.animTime * 15 + torch.phase) * 0.14;
      torch.glowMesh.scale.set(1.65 * glowPulse, 1.65 * glowPulse, 1);
      torch.glowMat.opacity = 0.48 + Math.sin(this.animTime * 15 + torch.phase) * 0.12;
      if (torch.light) {
        torch.light.intensity =
          torch.baseIntensity *
          (0.88 + Math.sin(this.animTime * 15 + torch.phase) * 0.14);
      }
    }

    // 6. Portail de sortie de donjon lumineux HDR
    if (this.exitPortalMesh && this.exitPortalRing) {
      const pulse = 1 + Math.sin(this.animTime * 3.5) * 0.05;
      this.exitPortalMesh.scale.set(3.2 * pulse, 3.4 * pulse, 1);
      this.exitPortalRing.rotation.y = this.animTime * 1.2;
      if (this.exitPortalMat) {
        this.exitPortalMat.emissiveIntensity =
          1.42 + Math.sin(this.animTime * 4.2) * 0.2;
      }
    }

    // 7. Coffres fermés légèrement scintillants
    for (const chest of this.chests.values()) {
      if (chest.stateKey === 'closed') {
        const bob = Math.max(0, Math.sin(this.animTime * 3.2 + chest.phase)) * 0.08;
        chest.mesh.position.y = chest.baseY + bob;
        chest.glowMesh.position.y = chest.glowCenterY + bob;
        chest.glowMat.opacity =
          chest.baseGlowOpacity + Math.sin(this.animTime * 3.2 + chest.phase) * 0.08;
      } else {
        chest.mesh.position.y = chest.baseY;
        chest.glowMesh.position.y = chest.glowCenterY;
      }
    }

    // 8. Cristal de soin flottant + pulsation HDR émeraude
    for (const crystal of this.crystals.values()) {
      if (!crystal.used) {
        const floatY = 0.08 + Math.sin(this.animTime * 3.4 + crystal.phase) * 0.12;
        crystal.mesh.position.y = floatY;
        crystal.glowMesh.position.y = crystal.glowBaseY + floatY;
        crystal.glowMat.opacity = 0.46 + Math.sin(this.animTime * 3.8 + crystal.phase) * 0.1;
        crystal.material.emissiveIntensity =
          1.45 + Math.sin(this.animTime * 3.8 + crystal.phase) * 0.22;
      } else {
        crystal.mesh.position.y = 0;
        crystal.glowMesh.position.y = crystal.glowBaseY;
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
    this.highlightRingGeo.dispose();
    this.highlightRingMat.dispose();
  }
}
