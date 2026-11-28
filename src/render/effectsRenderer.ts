import * as THREE from 'three';
import type {
  ActiveSpellEffect,
  GameEvent,
  GameState,
  HazardZoneKind,
  SpellId,
  StatusEffectId,
  TelegraphZone,
} from '../game/types';
import { ENEMIES } from '../data/enemiesData';
import { getWeaponCombatProfile } from '../data/equipmentData';
import { GOLD_LIGHT, GOLD_MID, VFX_COLORS } from '../art/palette';
import { TextureRegistry } from '../art/textureRegistry';
import {
  VFX_ASSETS,
  type VfxAssetId,
  computeVfxFlipbookFrameUv,
  getVfxFrameIndexAtTime,
} from '../art/vfxManifest';
import {
  createTelegraphMaterial,
  resolveTelegraphPalette,
  updateTelegraphMaterial,
} from './shaders/telegraphShader';
import {
  createFlipbookVfxMaterial,
  createProjectileTrailMaterial,
  createSlashTrailShaderMaterial,
} from './shaders/slashShader';
import { createHeatDistortionMaterial } from './shaders/heatDistortionShader';
import {
  createAegisDomeMaterial,
  createFlameRingMaterial,
  createFrostMistMaterial,
  createHealBeamMaterial,
  createHealRingMaterial,
  createHeatHazeMaterial,
  createIceCrystalMaterial,
  createLightningBeamMaterial,
  createLightningScorchMaterial,
  createMeteorBlastMaterial,
  createPounceRibbonMaterial,
  createQuestArrowMaterial,
} from './shaders/spellShaders';

const TELEGRAPH_Y = 0.06;
const QUEST_ARROW_Y = 0.11;
const SPRITE_TILT_X = -0.48;
const PARTICLE_POOL_SIZE = 320;
const RING_POOL_SIZE = 28;
const FLIPBOOK_POOL_SIZE = 72;
const DECAL_POOL_SIZE = 32;
const FOOTPRINT_POOL_SIZE = 48;

interface TelegraphVisual {
  id: string;
  shape: TelegraphZone['shape'];
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  meteorShadowMesh?: THREE.Mesh;
  meteorShadowMat?: THREE.MeshBasicMaterial;
  meteorFallingOrb?: THREE.Mesh;
  meteorFallingMat?: THREE.MeshBasicMaterial;
  disposables: Array<{ dispose(): void }>;
  sparkAccum: number;
}

interface IceCrystalSpike {
  mesh: THREE.Mesh;
  targetHeight: number;
  baseRadius: number;
  delay: number;
}

interface SpellEffectVisual {
  id: string;
  spellId: SpellId;
  group: THREE.Group;
  disposables: Array<{ dispose(): void }>;
  shaderMaterials: THREE.ShaderMaterial[];
  radius: number;
  width: number;
  // Spécifique Flamme-ronron
  flameRingMesh?: THREE.Mesh;
  heatHazeMesh?: THREE.Mesh;
  emberEmitAccum?: number;
  // Spécifique Éclair-miaou
  lightningPlanes?: THREE.Mesh[];
  // Spécifique Patte-givrée
  frostMistMesh?: THREE.Mesh;
  iceSpikes?: IceCrystalSpike[];
  // Spécifique Soin-velours
  healBeamMesh?: THREE.Mesh;
  healRings?: THREE.Mesh[];
  // Spécifique Égide de Ronron
  aegisDomeMesh?: THREE.Mesh;
  aegisRingMesh?: THREE.Mesh;
  // Spécifique Bond Foudroyant
  pounceRibbonMesh?: THREE.Mesh;
  // Spécifique Chute d'Étoiles (pluie d'étoiles hautes dans le ciel verrouillée sur la cible)
  meteorBlastMesh?: THREE.Mesh;
  meteorOrbMesh?: THREE.Mesh;
  meteorBeamMesh?: THREE.Mesh;
  meteorStars?: Array<{
    group: THREE.Group;
    orb: THREE.Mesh;
    tail: THREE.Mesh;
    offsetX: number;
    offsetZ: number;
    startT: number;
    impactT: number;
    impactDone: boolean;
    trailAccum: number;
  }>;
  meteorImpactBurstDone?: boolean;
  followPlayer?: boolean;
}

interface ScorchMarkVfx {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.ShaderMaterial;
  age: number;
  duration: number;
}

interface SlashVisual {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  geometry: THREE.BufferGeometry;
  baseAngle: number;
  startAngle: number;
  endAngle: number;
  sweepDir: number;
  sweepSpan: number;
  isThrust: boolean;
  age: number;
  duration: number;
}

interface ProjectileVisual {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  trailMesh: THREE.Mesh;
  trailMat: THREE.ShaderMaterial;
  trailAccum: number;
}

interface EnemyProjectileVisual {
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  trailMesh: THREE.Mesh;
  trailMat: THREE.ShaderMaterial;
  trailAccum: number;
}

interface HazardZoneVisual {
  id: string;
  kind: HazardZoneKind;
  group: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  ringMesh?: THREE.Mesh;
  ringMat?: THREE.MeshBasicMaterial;
  disposables: Array<{ dispose(): void }>;
  emitAccum: number;
}

interface EnemySweepVisual {
  group: THREE.Group;
  coneMesh: THREE.Mesh;
  coneMat: THREE.ShaderMaterial;
  emitAccum: number;
}

interface FlipbookSlot {
  active: boolean;
  vfxId: VfxAssetId;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  age: number;
  duration: number;
  loop: boolean;
  startScale: number;
  endScale: number;
  vx: number;
  vy: number;
  vz: number;
  baseOpacity: number;
  flatOnGround: boolean;
}

interface DecalSlot {
  active: boolean;
  decalId: VfxAssetId;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  baseOpacity: number;
}

interface LootDropVisual {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  kind: 'gold' | 'xp';
}

interface ExpandingRingSlot {
  active: boolean;
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  startScale: number;
  endScale: number;
}

interface LevelUpBeamVfx {
  group: THREE.Group;
  beamMat: THREE.ShaderMaterial;
  ringMat: THREE.ShaderMaterial;
  ringMesh: THREE.Mesh;
  beamMesh: THREE.Mesh;
  age: number;
  duration: number;
}

interface SpiralMotion {
  cx: number;
  cz: number;
  radius: number;
  angle: number;
  angularSpeed: number;
  radiusSpeed: number;
  followPlayer: boolean;
}

interface ParticleSlot {
  active: boolean;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  age: number;
  duration: number;
  startSize: number;
  endSize: number;
  baseOpacity: number;
  isSmoke: boolean;
  hasSpiral: boolean;
  spiral: SpiralMotion;
}

function createRingBufferGeometry(
  innerR: number,
  outerR: number,
  segments: number,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const idxInner = i * 2 * 3;
    positions[idxInner] = c * innerR;
    positions[idxInner + 1] = 0;
    positions[idxInner + 2] = s * innerR;

    const idxOuter = (i * 2 + 1) * 3;
    positions[idxOuter] = c * outerR;
    positions[idxOuter + 1] = 0;
    positions[idxOuter + 2] = s * outerR;

    if (i < segments) {
      const a0 = i * 2;
      const b0 = i * 2 + 1;
      const a1 = (i + 1) * 2;
      const b1 = (i + 1) * 2 + 1;
      indices.push(a0, b0, a1, b0, b1, a1);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

function createConeWedgeGeometry(
  radius: number,
  arcAngle: number,
  segments = 32,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((segments + 2) * 3);
  const indices: number[] = [];

  positions[0] = 0;
  positions[1] = 0;
  positions[2] = 0;

  const half = arcAngle * 0.5;
  for (let i = 0; i <= segments; i++) {
    const a = -half + (i / segments) * arcAngle;
    const idx = (i + 1) * 3;
    positions[idx] = Math.cos(a) * radius;
    positions[idx + 1] = 0;
    positions[idx + 2] = Math.sin(a) * radius;
    if (i < segments) {
      indices.push(0, i + 1, i + 2);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

function createSlashArcGeometry(
  innerR: number,
  outerR: number,
  arcAngle: number,
  segments = 22,
): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const indices: number[] = [];
  const half = arcAngle * 0.5;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = -half + t * arcAngle;
    const taper = Math.sin(t * Math.PI);
    const rIn = innerR + (outerR - innerR) * (1 - taper) * 0.45;
    const rOut = innerR + (outerR - innerR) * (0.45 + taper * 0.55);
    const c = Math.cos(a);
    const s = Math.sin(a);

    const p0 = i * 2 * 3;
    positions[p0] = c * rIn;
    positions[p0 + 1] = 0;
    positions[p0 + 2] = s * rIn;

    const p1 = (i * 2 + 1) * 3;
    positions[p1] = c * rOut;
    positions[p1 + 1] = 0;
    positions[p1 + 2] = s * rOut;

    const u0 = i * 2 * 2;
    uvs[u0] = t;
    uvs[u0 + 1] = 0;
    uvs[u0 + 2] = t;
    uvs[u0 + 3] = 1;

    if (i < segments) {
      const a0 = i * 2;
      const b0 = i * 2 + 1;
      const a1 = (i + 1) * 2;
      const b1 = (i + 1) * 2 + 1;
      indices.push(a0, b0, a1, b0, b1, a1);
    }
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

function buildQuestArrowMesh(): {
  group: THREE.Group;
  innerMat: THREE.ShaderMaterial;
  haloMat: THREE.MeshBasicMaterial;
  disposables: Array<{ dispose(): void }>;
} {
  const group = new THREE.Group();
  const disposables: Array<{ dispose(): void }> = [];

  // Flèche stylisée pointant vers +X dans le plan XZ
  const outerShape = new THREE.Shape();
  outerShape.moveTo(0.98, 0);
  outerShape.lineTo(-0.35, 0.64);
  outerShape.lineTo(-0.08, 0.24);
  outerShape.lineTo(-0.78, 0.24);
  outerShape.lineTo(-0.78, -0.24);
  outerShape.lineTo(-0.08, -0.24);
  outerShape.lineTo(-0.35, -0.64);
  outerShape.closePath();

  // Halo doré lumineux doux sous la flèche
  const haloGeo = new THREE.CircleGeometry(0.66, 24);
  haloGeo.rotateX(-Math.PI / 2);
  const haloMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GOLD_MID).multiplyScalar(0.95),
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.position.set(0.05, -0.008, 0);
  haloMesh.scale.set(1.1, 1, 0.78);
  haloMesh.renderOrder = 2;
  group.add(haloMesh);

  // Bordure bronze/encre pour un contraste parfait sur la neige comme en donjon
  const outerGeo = new THREE.ShapeGeometry(outerShape);
  outerGeo.rotateX(-Math.PI / 2);
  const outerMat = new THREE.MeshBasicMaterial({
    color: 0x3b2414,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.renderOrder = 3;
  group.add(outerMesh);

  // Cœur doré animé GLSL (sheen lumineux + léger Bloom HDR)
  const innerGeo = outerGeo.clone();
  const innerMat = createQuestArrowMaterial();
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  innerMesh.scale.set(0.84, 1, 0.8);
  innerMesh.position.y = 0.006;
  innerMesh.renderOrder = 3;
  group.add(innerMesh);

  disposables.push(haloGeo, haloMat, outerGeo, outerMat, innerGeo, innerMat);
  return { group, innerMat, haloMat, disposables };
}

export class EffectsRenderer {
  private readonly scene: THREE.Scene;
  private readonly textures: TextureRegistry;
  private readonly rootGroup = new THREE.Group();

  private readonly telegraphs = new Map<string, TelegraphVisual>();
  private readonly spellEffects = new Map<string, SpellEffectVisual>();
  private readonly playerProjectiles = new Map<string, ProjectileVisual>();
  private readonly enemyProjectiles = new Map<string, EnemyProjectileVisual>();
  private readonly hazardZones = new Map<string, HazardZoneVisual>();
  private readonly enemySweeps = new Map<string, EnemySweepVisual>();
  private readonly lootDrops = new Map<string, LootDropVisual>();
  private readonly activeTelegraphIds = new Set<string>();
  private readonly activeSpellIds = new Set<string>();
  private readonly activeProjectileIds = new Set<string>();
  private readonly activeEnemyProjectileIds = new Set<string>();
  private readonly activeHazardIds = new Set<string>();
  private readonly activeSweepEnemyIds = new Set<string>();
  private readonly activeLootDropIds = new Set<string>();
  private readonly scorchMarks: ScorchMarkVfx[] = [];
  private readonly slashes: SlashVisual[] = [];
  private readonly ringPool: ExpandingRingSlot[] = [];
  private readonly flipbookPool: FlipbookSlot[] = [];
  private readonly decalPool: DecalSlot[] = [];
  private readonly footprintPool: Array<{
    active: boolean;
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    age: number;
    duration: number;
    baseOpacity: number;
  }> = [];
  private footprintTex: THREE.Texture | null = null;
  private footprintCursor = 0;
  private footprintStrideLeft = false;
  private readonly levelBeams: LevelUpBeamVfx[] = [];
  private readonly particlePool: ParticleSlot[] = [];
  private particleCursor = 0;
  private ringCursor = 0;
  private flipbookCursor = 0;
  private decalCursor = 0;
  private statusEmitAccum = 0;

  // Pool de silhouettes fantômes de roulade
  private readonly ghostGeo: THREE.PlaneGeometry;
  private readonly ghostPool: Array<{
    tiltGroup: THREE.Group;
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
  }> = [];

  // Géométries partagées VFX
  private readonly unitRingGeo: THREE.RingGeometry;
  private readonly unitDiskGeo: THREE.CircleGeometry;
  private readonly unitPlaneGeo: THREE.PlaneGeometry;
  private readonly groundPlaneGeo: THREE.PlaneGeometry;
  private readonly trailQuadGeo: THREE.PlaneGeometry;
  private readonly beamCylinderGeo: THREE.CylinderGeometry;
  private readonly heatHazeCylinderGeo: THREE.CylinderGeometry;
  private readonly iceCrystalGeo: THREE.ConeGeometry;
  private readonly aegisDomeGeo: THREE.SphereGeometry;
  private readonly meteorOrbGeo: THREE.IcosahedronGeometry;
  private readonly starTailGeo: THREE.ConeGeometry;
  private readonly projOrbGeo: THREE.SphereGeometry;
  private readonly projBoltGeo: THREE.ConeGeometry;
  private readonly cheeseWheelGeo: THREE.CylinderGeometry;
  private readonly scytheArcGeo: THREE.RingGeometry;
  private readonly lootCoinGeo: THREE.CylinderGeometry;
  private readonly lootXpGeo: THREE.OctahedronGeometry;

  // Flèche dorée directionnelle de quête (y = 0.095, renderOrder = 3)
  private readonly questArrowGroup: THREE.Group;
  private readonly questArrowInnerMat: THREE.ShaderMaterial;
  private readonly questArrowHaloMat: THREE.MeshBasicMaterial;
  private readonly questArrowDisposables: Array<{ dispose(): void }>;

  private animTime = 0;

  constructor(scene: THREE.Scene, textures: TextureRegistry) {
    this.scene = scene;
    this.textures = textures;
    this.rootGroup.name = 'EffectsRoot';
    this.rootGroup.userData.skipSSAO = true;
    this.scene.add(this.rootGroup);

    this.unitRingGeo = new THREE.RingGeometry(0.76, 1.0, 36);
    this.unitRingGeo.rotateX(-Math.PI / 2);

    this.unitDiskGeo = new THREE.CircleGeometry(1, 48);
    this.unitDiskGeo.rotateX(-Math.PI / 2);

    this.unitPlaneGeo = new THREE.PlaneGeometry(1, 1);
    this.groundPlaneGeo = new THREE.PlaneGeometry(1, 1);
    this.groundPlaneGeo.rotateX(-Math.PI / 2);

    this.trailQuadGeo = new THREE.PlaneGeometry(1.4, 0.36);
    this.trailQuadGeo.rotateX(-Math.PI / 2);
    this.trailQuadGeo.translate(-0.75, 0, 0);

    this.beamCylinderGeo = new THREE.CylinderGeometry(0.95, 1.25, 10.5, 36, 1, true);
    this.beamCylinderGeo.translate(0, 5.25, 0);

    // Cylindre subdivisé verticalement pour la distorsion convective Heat Haze de Flamme-ronron
    this.heatHazeCylinderGeo = new THREE.CylinderGeometry(0.92, 0.72, 2.8, 32, 12, true);
    this.heatHazeCylinderGeo.translate(0, 1.4, 0);

    // Cristal de glace 3D hexagonal taillé (base ancrée à y = 0)
    this.iceCrystalGeo = new THREE.ConeGeometry(0.32, 1.0, 6, 1, false);
    this.iceCrystalGeo.translate(0, 0.5, 0);

    // Dôme sphérique hémisphérique partagé pour Égide de Ronron
    this.aegisDomeGeo = new THREE.SphereGeometry(1.0, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.62);

    // Orbe météore astral & traînée stellaire partagés pour Chute d'Étoiles
    this.meteorOrbGeo = new THREE.IcosahedronGeometry(0.62, 1);
    this.starTailGeo = new THREE.ConeGeometry(0.42, 4.6, 8, 1, true);
    this.starTailGeo.translate(0, 2.3, 0);

    // Géométries partagées pour projectiles joueur/ennemis et butins physiques
    this.projOrbGeo = new THREE.SphereGeometry(0.26, 12, 10);
    this.projBoltGeo = new THREE.ConeGeometry(0.11, 0.72, 6);
    this.projBoltGeo.rotateZ(-Math.PI / 2);
    this.cheeseWheelGeo = new THREE.CylinderGeometry(0.62, 0.62, 0.34, 16);
    this.cheeseWheelGeo.rotateZ(Math.PI / 2);
    this.scytheArcGeo = new THREE.RingGeometry(0.45, 1.0, 16, 1, -Math.PI * 0.45, Math.PI * 0.9);
    this.scytheArcGeo.rotateX(-Math.PI / 2);
    this.lootCoinGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12);
    this.lootXpGeo = new THREE.OctahedronGeometry(0.22, 0);

    this.ghostGeo = new THREE.PlaneGeometry(1, 1);
    this.ghostGeo.translate(0, 0.5, 0);

    // Pré-alloue le pool de particules (zéro allocation / GC pendant les combats !)
    const defaultParticleTex = this.textures.getParticleTexture();
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: defaultParticleTex,
        color: new THREE.Color(0xffffff),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.renderOrder = 6;
      sprite.userData.skipSSAO = true;
      this.rootGroup.add(sprite);
      this.particlePool.push({
        active: false,
        sprite,
        material,
        vx: 0,
        vy: 0,
        vz: 0,
        gravity: -9.5,
        age: 0,
        duration: 0.4,
        startSize: 0.3,
        endSize: 0.05,
        baseOpacity: 1,
        isSmoke: false,
        hasSpiral: false,
        spiral: {
          cx: 0,
          cz: 0,
          radius: 1,
          angle: 0,
          angularSpeed: 0,
          radiusSpeed: 0,
          followPlayer: false,
        },
      });
    }

    // Pré-alloue le pool d'anneaux d'onde de choc
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xffffff),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.unitRingGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.userData.skipSSAO = true;
      this.rootGroup.add(mesh);
      this.ringPool.push({
        active: false,
        mesh,
        material,
        age: 0,
        duration: 0.4,
        startScale: 0.5,
        endScale: 3.0,
      });
    }

    // Pré-alloue 8 silhouettes fantômes de roulade
    for (let i = 0; i < 8; i++) {
      const tiltGroup = new THREE.Group();
      tiltGroup.rotation.x = SPRITE_TILT_X;
      const material = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xa6f2ff).multiplyScalar(1.15),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.ghostGeo, material);
      mesh.scale.set(2.3, 2.4, 1);
      mesh.renderOrder = 3;
      tiltGroup.add(mesh);
      tiltGroup.visible = false;
      this.rootGroup.add(tiltGroup);
      this.ghostPool.push({ tiltGroup, mesh, material });
    }

    // Pré-alloue le pool de flipbooks CC0 (zéro clone de texture)
    const defaultFlameTex = this.textures.getVfxTexture('flames');
    for (let i = 0; i < FLIPBOOK_POOL_SIZE; i++) {
      const material = createFlipbookVfxMaterial(defaultFlameTex, true);
      const mesh = new THREE.Mesh(this.unitPlaneGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 6;
      mesh.userData.skipSSAO = true;
      this.rootGroup.add(mesh);
      this.flipbookPool.push({
        active: false,
        vfxId: 'flames',
        mesh,
        material,
        age: 0,
        duration: 0.6,
        loop: false,
        startScale: 1,
        endScale: 1.4,
        vx: 0,
        vy: 0,
        vz: 0,
        baseOpacity: 1,
        flatOnGround: false,
      });
    }

    // Pré-alloue le pool de décalques au sol (cratères, brûlures, éclaboussures)
    const defaultDecalTex = this.textures.getVfxTexture('scorch_decal');
    for (let i = 0; i < DECAL_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: defaultDecalTex,
        color: new THREE.Color(0xffffff),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.groundPlaneGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      mesh.userData.skipSSAO = true;
      this.rootGroup.add(mesh);
      this.decalPool.push({
        active: false,
        decalId: 'scorch_decal',
        mesh,
        material,
        age: 0,
        duration: 3.5,
        baseOpacity: 0.85,
      });
    }

    // Flèche dorée directionnelle lumineuse
    const arrow = buildQuestArrowMesh();
    this.questArrowGroup = arrow.group;
    this.questArrowInnerMat = arrow.innerMat;
    this.questArrowHaloMat = arrow.haloMat;
    this.questArrowDisposables = arrow.disposables;
    this.questArrowGroup.visible = false;
    this.rootGroup.add(this.questArrowGroup);

    // Pool d'empreintes félines éphémères dans le sable & la neige
    if (typeof document !== 'undefined') {
      const fpCanvas = document.createElement('canvas');
      fpCanvas.width = 64;
      fpCanvas.height = 64;
      const fpCtx = fpCanvas.getContext('2d');
      if (fpCtx) {
        fpCtx.clearRect(0, 0, 64, 64);
        fpCtx.fillStyle = 'rgba(255, 255, 255, 0.92)';
        fpCtx.beginPath();
        fpCtx.ellipse(32, 38, 11, 9, 0, 0, Math.PI * 2);
        fpCtx.fill();
        const toes: Array<[number, number]> = [
          [20, 22],
          [28, 17],
          [37, 17],
          [44, 22],
        ];
        for (const [tx, ty] of toes) {
          fpCtx.beginPath();
          fpCtx.ellipse(tx, ty, 3.8, 4.6, 0, 0, Math.PI * 2);
          fpCtx.fill();
        }
        const tex = new THREE.CanvasTexture(fpCanvas);
        tex.needsUpdate = true;
        this.footprintTex = tex;
      }
    }
    for (let i = 0; i < FOOTPRINT_POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        map: this.footprintTex,
        color: new THREE.Color(0xb8935e),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(this.groundPlaneGeo, material);
      mesh.visible = false;
      mesh.renderOrder = 1;
      mesh.userData.skipSSAO = true;
      this.rootGroup.add(mesh);
      this.footprintPool.push({
        active: false,
        mesh,
        material,
        age: 0,
        duration: 3.5,
        baseOpacity: 0.48,
      });
    }
  }

  /**
   * Rafraîchit les textures CC0 des pools dès que TextureRegistry a terminé leur chargement asynchrone.
   */
  public refreshTextures(): void {
    const trailTex = this.textures.getVfxTexture('projectile_trail');
    for (const vis of this.playerProjectiles.values()) {
      if (vis.trailMat.uniforms.uMap) {
        vis.trailMat.uniforms.uMap.value = trailTex;
      }
    }
    for (const vis of this.enemyProjectiles.values()) {
      if (vis.trailMat.uniforms.uMap) {
        vis.trailMat.uniforms.uMap.value = trailTex;
      }
    }
    for (const slot of this.flipbookPool) {
      if (slot.active && slot.material.uniforms.uMap) {
        slot.material.uniforms.uMap.value = this.textures.getVfxTexture(slot.vfxId);
      }
    }
    for (const slot of this.decalPool) {
      if (slot.active) {
        slot.material.map = this.textures.getVfxTexture(slot.decalId);
        slot.material.needsUpdate = true;
      }
    }
    const heatNorm = this.textures.getVfxTexture('heat_distortion_normal');
    for (const vis of this.enemySweeps.values()) {
      if (vis.coneMat.uniforms.uNormalMap) {
        vis.coneMat.uniforms.uNormalMap.value = heatNorm;
      }
    }
    const meleeTrailTex = this.textures.getVfxTexture('melee_slash_trail');
    for (const slash of this.slashes) {
      if (slash.material.uniforms.uMap) {
        slash.material.uniforms.uMap.value = slash.isThrust ? trailTex : meleeTrailTex;
      }
    }
  }

  private spawnFlipbook(opts: {
    vfxId: VfxAssetId;
    x: number;
    y: number;
    z: number;
    scale?: number;
    endScale?: number;
    duration?: number;
    color?: string | number;
    hdrBoost?: number;
    opacity?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    loop?: boolean;
    flatOnGround?: boolean;
    rotationY?: number;
  }): void {
    let slot: FlipbookSlot | null = null;
    for (let attempt = 0; attempt < FLIPBOOK_POOL_SIZE; attempt++) {
      const idx = (this.flipbookCursor + attempt) % FLIPBOOK_POOL_SIZE;
      if (!this.flipbookPool[idx].active) {
        slot = this.flipbookPool[idx];
        this.flipbookCursor = (idx + 1) % FLIPBOOK_POOL_SIZE;
        break;
      }
    }
    if (!slot) {
      slot = this.flipbookPool[this.flipbookCursor];
      this.flipbookCursor = (this.flipbookCursor + 1) % FLIPBOOK_POOL_SIZE;
    }

    const entry = VFX_ASSETS[opts.vfxId];
    const tex = this.textures.getVfxTexture(opts.vfxId);
    slot.active = true;
    slot.vfxId = opts.vfxId;
    slot.age = 0;
    slot.duration = Math.max(0.12, opts.duration ?? (entry.durationSec > 0 ? entry.durationSec : 0.65));
    slot.loop = Boolean(opts.loop);
    slot.startScale = opts.scale ?? 1.4;
    slot.endScale = opts.endScale ?? slot.startScale * 1.25;
    slot.vx = opts.vx ?? 0;
    slot.vy = opts.vy ?? 0;
    slot.vz = opts.vz ?? 0;
    slot.baseOpacity = opts.opacity ?? 0.92;
    slot.flatOnGround = Boolean(opts.flatOnGround);

    slot.material.blending =
      entry.blending === 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending;
    slot.material.uniforms.uMap.value = tex;
    const uv = computeVfxFlipbookFrameUv(entry, 0);
    slot.material.uniforms.uUvRect.value.set(uv.repeatX, uv.repeatY, uv.offsetX, uv.offsetY);
    slot.material.uniforms.uColor.value
      .set(opts.color ?? 0xffffff)
      .multiplyScalar(opts.hdrBoost ?? (entry.blending === 'additive' ? 1.45 : 1.05));
    slot.material.uniforms.uOpacity.value = slot.baseOpacity;

    slot.mesh.position.set(opts.x, opts.y, opts.z);
    if (slot.flatOnGround) {
      slot.mesh.rotation.set(-Math.PI / 2, 0, opts.rotationY ?? 0);
    } else {
      slot.mesh.rotation.set(SPRITE_TILT_X, 0, 0);
    }
    slot.mesh.scale.set(slot.startScale, slot.startScale, 1);
    slot.mesh.visible = true;
  }

  private spawnDecal(opts: {
    decalId: VfxAssetId;
    x: number;
    z: number;
    scale: number;
    duration?: number;
    color?: string | number;
    opacity?: number;
    rotationY?: number;
  }): void {
    let slot: DecalSlot | null = null;
    for (let attempt = 0; attempt < DECAL_POOL_SIZE; attempt++) {
      const idx = (this.decalCursor + attempt) % DECAL_POOL_SIZE;
      if (!this.decalPool[idx].active) {
        slot = this.decalPool[idx];
        this.decalCursor = (idx + 1) % DECAL_POOL_SIZE;
        break;
      }
    }
    if (!slot) {
      slot = this.decalPool[this.decalCursor];
      this.decalCursor = (this.decalCursor + 1) % DECAL_POOL_SIZE;
    }

    slot.active = true;
    slot.decalId = opts.decalId;
    slot.age = 0;
    slot.duration = Math.max(0.5, opts.duration ?? 3.8);
    slot.baseOpacity = opts.opacity ?? 0.84;
    slot.material.map = this.textures.getVfxTexture(opts.decalId);
    slot.material.color.set(opts.color ?? 0xffffff);
    slot.material.opacity = slot.baseOpacity;
    slot.material.needsUpdate = true;

    slot.mesh.position.set(opts.x, TELEGRAPH_Y - 0.015, opts.z);
    slot.mesh.rotation.set(0, opts.rotationY ?? Math.random() * Math.PI * 2, 0);
    slot.mesh.scale.set(opts.scale, 1, opts.scale);
    slot.mesh.visible = true;
  }

  // ==========================================================================
  // 1. Télégraphes Double-Couche Codés par Élément (GLSL, ZÉRO z-fighting)
  // ==========================================================================

  private createTelegraphVisual(t: TelegraphZone): TelegraphVisual {
    const group = new THREE.Group();
    group.position.set(t.x, TELEGRAPH_Y, t.z);
    group.rotation.y = -t.angle;
    group.userData.skipSSAO = true;

    const innerR = t.innerRadius ?? Math.max(0.5, t.radius * 0.45);
    const outerR = t.shape === 'ring' ? Math.max(innerR + 0.3, t.radius) : t.radius;
    const width = t.width ?? 2.0;
    const arc = t.arcAngle ?? Math.PI * 0.45;
    const palette = resolveTelegraphPalette(t.element ?? t.color);

    const material = createTelegraphMaterial(t.shape, {
      radius: outerR,
      innerRadius: innerR,
      width,
      arcAngle: arc,
      element: t.element,
      color: palette.color,
      brightColor: palette.brightColor,
    });

    let geometry: THREE.BufferGeometry;
    if (t.shape === 'circle') {
      geometry = new THREE.CircleGeometry(outerR, 48);
      geometry.rotateX(-Math.PI / 2);
    } else if (t.shape === 'cone') {
      geometry = createConeWedgeGeometry(outerR, arc, 32);
    } else if (t.shape === 'line') {
      geometry = new THREE.PlaneGeometry(outerR, width);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(outerR * 0.5, 0, 0);
    } else {
      geometry = createRingBufferGeometry(innerR, outerR, 48);
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    mesh.userData.skipSSAO = true;
    group.add(mesh);

    const disposables: Array<{ dispose(): void }> = [geometry, material];
    let meteorShadowMesh: THREE.Mesh | undefined;
    let meteorShadowMat: THREE.MeshBasicMaterial | undefined;
    let meteorFallingOrb: THREE.Mesh | undefined;
    let meteorFallingMat: THREE.MeshBasicMaterial | undefined;

    if (t.skillBehavior === 'meteor_rain') {
      meteorShadowMat = new THREE.MeshBasicMaterial({
        color: 0x160908,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      meteorShadowMesh = new THREE.Mesh(this.unitDiskGeo, meteorShadowMat);
      meteorShadowMesh.position.y = 0.008;
      meteorShadowMesh.renderOrder = 2;
      meteorShadowMesh.userData.skipSSAO = true;
      group.add(meteorShadowMesh);

      meteorFallingMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xff6b22).multiplyScalar(1.85),
        transparent: true,
        opacity: 0.95,
      });
      meteorFallingOrb = new THREE.Mesh(this.meteorOrbGeo, meteorFallingMat);
      meteorFallingOrb.position.set(0, 14, 0);
      meteorFallingOrb.renderOrder = 6;
      meteorFallingOrb.userData.skipSSAO = true;
      group.add(meteorFallingOrb);
      disposables.push(meteorShadowMat, meteorFallingMat);
    }

    this.rootGroup.add(group);
    return {
      id: t.id,
      shape: t.shape,
      group,
      material,
      meteorShadowMesh,
      meteorShadowMat,
      meteorFallingOrb,
      meteorFallingMat,
      disposables,
      sparkAccum: 0,
    };
  }

  private disposeTelegraphVisual(vis: TelegraphVisual): void {
    this.rootGroup.remove(vis.group);
    for (const d of vis.disposables) {
      d.dispose();
    }
  }

  private updateTelegraphs(telegraphs: TelegraphZone[], dt: number): void {
    const activeIds = this.activeTelegraphIds;
    activeIds.clear();

    for (let i = 0; i < telegraphs.length; i++) {
      const t = telegraphs[i];
      if (t.resolved || (t.delaySec ?? 0) > 0) continue;
      activeIds.add(t.id);

      let vis = this.telegraphs.get(t.id);
      if (!vis) {
        vis = this.createTelegraphVisual(t);
        this.telegraphs.set(t.id, vis);
      }

      const progress = Math.max(0.01, Math.min(1, t.elapsed / Math.max(0.05, t.duration)));
      vis.group.position.set(t.x, TELEGRAPH_Y, t.z);
      vis.group.rotation.y = -t.angle;
      updateTelegraphMaterial(vis.material, progress, this.animTime);

      if (vis.meteorShadowMesh && vis.meteorShadowMat) {
        const s = Math.max(0.18, progress) * t.radius * 0.82;
        vis.meteorShadowMesh.scale.set(s, 1, s);
        vis.meteorShadowMat.opacity = 0.25 + progress * 0.48;
      }
      if (vis.meteorFallingOrb) {
        const fallY = Math.max(0.45, (1 - progress * progress) * 14.0);
        vis.meteorFallingOrb.position.set(0, fallY, 0);
        vis.meteorFallingOrb.rotation.x += dt * 7;
        vis.meteorFallingOrb.rotation.y += dt * 5;
      }

      // Signaux visuels d'anticipation thématiques pour les attaques de boss & ennemis
      vis.sparkAccum += dt;
      const emitInterval =
        t.ownerTypeId === 'boss_dragon_claw' || t.ownerTypeId === 'boss_rat_king' ? 0.085 : 0.16;
      if (vis.sparkAccum >= emitInterval && progress < 0.94) {
        vis.sparkAccum = 0;
        const a = Math.random() * Math.PI * 2;
        const r = Math.min(4.2, t.radius * (0.25 + Math.random() * 0.65));
        const sx = t.shape === 'line' ? t.x + Math.cos(t.angle) * r : t.x + Math.cos(a) * r;
        const sz = t.shape === 'line' ? t.z + Math.sin(t.angle) * r : t.z + Math.sin(a) * r;
        const palette = resolveTelegraphPalette(t.element ?? t.color);
        this.spawnParticle({
          x: sx,
          y: 0.16,
          z: sz,
          vx: (Math.random() - 0.5) * 0.8,
          vy: 1.6 + progress * 2.2,
          vz: (Math.random() - 0.5) * 0.8,
          color: palette.brightColor,
          size: t.ownerTypeId?.startsWith('boss_') ? 0.34 : 0.24,
          endSize: 0.05,
          duration: 0.34,
          gravity: -1.4,
          star: t.element === 'fire' || t.element === 'frost',
          hdrBoost: 1.85,
        });
      }
    }

    for (const [id, vis] of this.telegraphs.entries()) {
      if (!activeIds.has(id)) {
        this.disposeTelegraphVisual(vis);
        this.telegraphs.delete(id);
      }
    }
  }

  // ==========================================================================
  // 2. VFX GLSL Spectaculaires des 4 Sorts VF (`ActiveSpellEffect`)
  // ==========================================================================

  private spawnLightningScorch(
    x: number,
    z: number,
    angle: number,
    length: number,
    width: number,
  ): void {
    const geometry = new THREE.PlaneGeometry(length, width * 1.05);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(length * 0.5, 0, 0);

    const material = createLightningScorchMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, TELEGRAPH_Y - 0.012, z);
    mesh.rotation.y = -angle;
    mesh.renderOrder = 1;
    mesh.userData.skipSSAO = true;
    this.rootGroup.add(mesh);

    this.scorchMarks.push({
      mesh,
      geometry,
      material,
      age: 0,
      duration: 1.85,
    });
  }

  private createSpellVisual(eff: ActiveSpellEffect): SpellEffectVisual {
    const group = new THREE.Group();
    group.position.set(eff.x, TELEGRAPH_Y + 0.015, eff.z);
    group.rotation.y = -eff.angle;
    group.userData.skipSSAO = true;
    const disposables: Array<{ dispose(): void }> = [];
    const shaderMaterials: THREE.ShaderMaterial[] = [];

    // --- 1. FLAMME-RONRON : Anneau de feu incandescent + Heat Haze 3D ---
    if (eff.spellId === 'flamepurr') {
      const flameMat = createFlameRingMaterial();
      const flameRingMesh = new THREE.Mesh(this.unitDiskGeo, flameMat);
      flameRingMesh.renderOrder = 3;
      flameRingMesh.userData.skipSSAO = true;
      group.add(flameRingMesh);

      const hazeMat = createHeatHazeMaterial();
      const heatHazeMesh = new THREE.Mesh(this.heatHazeCylinderGeo, hazeMat);
      heatHazeMesh.position.y = -0.05;
      heatHazeMesh.renderOrder = 4;
      heatHazeMesh.userData.skipSSAO = true;
      group.add(heatHazeMesh);

      disposables.push(flameMat, hazeMat);
      shaderMaterials.push(flameMat, hazeMat);
      this.rootGroup.add(group);

      return {
        id: eff.id,
        spellId: eff.spellId,
        group,
        disposables,
        shaderMaterials,
        radius: eff.radius,
        width: eff.width ?? 2,
        flameRingMesh,
        heatHazeMesh,
        emberEmitAccum: 0,
      };
    }

    // --- 2. ÉCLAIR-MIAOU : Faisceau d'arcs fractals HDR + Brûlure runique ---
    if (eff.spellId === 'lightnyan') {
      const len = eff.radius;
      const w = eff.width ?? 2.0;

      // Marque de brûlure runique persistante au sol
      this.spawnLightningScorch(eff.x, eff.z, eff.angle, len, w);

      const groundGeo = new THREE.PlaneGeometry(len, w * 1.15);
      groundGeo.rotateX(-Math.PI / 2);
      groundGeo.translate(len * 0.5, 0.015, 0);
      const groundMat = createLightningBeamMaterial(1.7);
      const groundMesh = new THREE.Mesh(groundGeo, groundMat);
      groundMesh.renderOrder = 3;
      groundMesh.userData.skipSSAO = true;
      group.add(groundMesh);

      // Deux rubans 3D croisés dans l'air pour un volume d'éclair percutant sous caméra 45°
      const ribbonGeo = new THREE.PlaneGeometry(len, w * 0.85);
      ribbonGeo.translate(len * 0.5, 0, 0);

      const ribbonMatA = createLightningBeamMaterial(5.3);
      const ribbonMeshA = new THREE.Mesh(ribbonGeo, ribbonMatA);
      ribbonMeshA.position.y = 0.88;
      ribbonMeshA.rotation.x = 0.52;
      ribbonMeshA.renderOrder = 4;
      ribbonMeshA.userData.skipSSAO = true;
      group.add(ribbonMeshA);

      const ribbonMatB = createLightningBeamMaterial(11.9);
      const ribbonMeshB = new THREE.Mesh(ribbonGeo, ribbonMatB);
      ribbonMeshB.position.y = 0.88;
      ribbonMeshB.rotation.x = -0.68;
      ribbonMeshB.renderOrder = 4;
      ribbonMeshB.userData.skipSSAO = true;
      group.add(ribbonMeshB);

      disposables.push(groundGeo, groundMat, ribbonGeo, ribbonMatA, ribbonMatB);
      shaderMaterials.push(groundMat, ribbonMatA, ribbonMatB);
      this.rootGroup.add(group);

      return {
        id: eff.id,
        spellId: eff.spellId,
        group,
        disposables,
        shaderMaterials,
        radius: len,
        width: w,
        lightningPlanes: [groundMesh, ribbonMeshA, ribbonMeshB],
      };
    }

    // --- 3. PATTE-GIVRÉE : Cristaux de glace 3D translucides + Brume froide ---
    if (eff.spellId === 'freezepaw') {
      const mistMat = createFrostMistMaterial();
      const frostMistMesh = new THREE.Mesh(this.unitDiskGeo, mistMat);
      frostMistMesh.renderOrder = 3;
      frostMistMesh.userData.skipSSAO = true;
      group.add(frostMistMesh);

      const crystalMat = createIceCrystalMaterial();
      const spikeCount = 12;
      const iceSpikes: IceCrystalSpike[] = [];

      for (let i = 0; i < spikeCount; i++) {
        const angle = (i / spikeCount) * Math.PI * 2 + (i % 2 === 0 ? 0.08 : -0.06);
        const ringRatio = i % 3 === 0 ? 0.54 : i % 2 === 0 ? 0.78 : 0.9;
        const dist = eff.radius * ringRatio;
        const targetHeight = (i % 3 === 0 ? 1.55 : 1.05 + (i % 4) * 0.22);
        const baseRadius = 0.78 + (i % 3) * 0.24;

        const spikeMesh = new THREE.Mesh(this.iceCrystalGeo, crystalMat);
        spikeMesh.position.set(Math.cos(angle) * dist, -0.04, Math.sin(angle) * dist);
        // Inclinaison radiale naturelle vers l'extérieur façon éruption glacée
        spikeMesh.rotation.order = 'YXZ';
        spikeMesh.rotation.y = -angle + Math.PI * 0.5;
        spikeMesh.rotation.x = 0.2 + (i % 3) * 0.09;
        spikeMesh.scale.set(baseRadius, 0.01, baseRadius);
        spikeMesh.renderOrder = 4;
        spikeMesh.userData.skipSSAO = true;
        group.add(spikeMesh);

        iceSpikes.push({
          mesh: spikeMesh,
          targetHeight,
          baseRadius,
          delay: (ringRatio - 0.5) * 0.28,
        });
      }

      disposables.push(mistMat, crystalMat);
      shaderMaterials.push(mistMat, crystalMat);
      this.rootGroup.add(group);

      return {
        id: eff.id,
        spellId: eff.spellId,
        group,
        disposables,
        shaderMaterials,
        radius: eff.radius,
        width: 0,
        frostMistMesh,
        iceSpikes,
      };
    }

    // --- 5. ÉGIDE DE RONRON : Dôme runique doré-cyan + anneau au sol ---
    if (eff.spellId === 'aegis_purr') {
      const domeMat = createAegisDomeMaterial();
      const aegisDomeMesh = new THREE.Mesh(this.aegisDomeGeo, domeMat);
      aegisDomeMesh.position.y = 0.05;
      aegisDomeMesh.renderOrder = 5;
      aegisDomeMesh.userData.skipSSAO = true;
      group.add(aegisDomeMesh);

      const ringMat = createHealRingMaterial(0xffd166, 0x66f2ff);
      const aegisRingMesh = new THREE.Mesh(this.unitDiskGeo, ringMat);
      aegisRingMesh.position.y = 0.02;
      aegisRingMesh.renderOrder = 4;
      aegisRingMesh.userData.skipSSAO = true;
      group.add(aegisRingMesh);

      disposables.push(domeMat, ringMat);
      shaderMaterials.push(domeMat, ringMat);
      this.rootGroup.add(group);

      return {
        id: eff.id,
        spellId: eff.spellId,
        group,
        disposables,
        shaderMaterials,
        radius: eff.radius,
        width: 0,
        aegisDomeMesh,
        aegisRingMesh,
        followPlayer: true,
      };
    }

    // --- 6. BOND FOUDROYANT : Ruban de griffes de vent cinétique ---
    if (eff.spellId === 'pounce_dash') {
      const len = Math.max(1.2, eff.radius);
      const w = eff.width ?? 2.1;
      const ribbonGeo = new THREE.PlaneGeometry(len, w);
      ribbonGeo.rotateX(-Math.PI / 2);
      ribbonGeo.translate(len * 0.5, 0.14, 0);
      const ribbonMat = createPounceRibbonMaterial();
      const pounceRibbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
      pounceRibbonMesh.renderOrder = 4;
      pounceRibbonMesh.userData.skipSSAO = true;
      group.add(pounceRibbonMesh);

      disposables.push(ribbonGeo, ribbonMat);
      shaderMaterials.push(ribbonMat);
      this.rootGroup.add(group);

      return {
        id: eff.id,
        spellId: eff.spellId,
        group,
        disposables,
        shaderMaterials,
        radius: len,
        width: w,
        pounceRibbonMesh,
      };
    }

    // --- 7. CHUTE D'ÉTOILES : Pluie de 6 étoiles hautes dans le ciel verrouillée sur la cible ---
    if (eff.spellId === 'meteor_paw') {
      const blastMat = createMeteorBlastMaterial();
      const meteorBlastMesh = new THREE.Mesh(this.unitDiskGeo, blastMat);
      meteorBlastMesh.scale.set(eff.radius, 1, eff.radius);
      meteorBlastMesh.renderOrder = 3;
      meteorBlastMesh.userData.skipSSAO = true;
      group.add(meteorBlastMesh);

      const orbMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.4, 1.95, 1.05),
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const tailMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.85, 0.95, 2.35),
        transparent: true,
        opacity: 0.72,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });

      const starSpecs: Array<[number, number, number, number]> = [
        [0, 0, 0.0, 0.28],
        [-0.48, -0.34, 0.08, 0.36],
        [0.46, -0.24, 0.18, 0.46],
        [-0.34, 0.42, 0.28, 0.56],
        [0.42, 0.38, 0.40, 0.68],
        [-0.22, -0.45, 0.50, 0.78],
        [0.26, 0.16, 0.60, 0.88],
        [0.02, -0.06, 0.70, 0.96],
      ];

      const meteorStars: NonNullable<SpellEffectVisual['meteorStars']> = [];
      for (const [oxFrac, ozFrac, startT, impactT] of starSpecs) {
        const starGroup = new THREE.Group();
        starGroup.visible = false;
        const orb = new THREE.Mesh(this.meteorOrbGeo, orbMat);
        orb.renderOrder = 7;
        orb.userData.skipSSAO = true;
        const tail = new THREE.Mesh(this.starTailGeo, tailMat);
        tail.renderOrder = 6;
        tail.userData.skipSSAO = true;
        // Incline la traînée le long de la trajectoire oblique venant du ciel haut
        tail.rotation.z = 0.22;
        tail.rotation.x = -0.14;
        starGroup.add(orb, tail);
        group.add(starGroup);
        meteorStars.push({
          group: starGroup,
          orb,
          tail,
          offsetX: oxFrac * eff.radius * 0.75,
          offsetZ: ozFrac * eff.radius * 0.75,
          startT,
          impactT,
          impactDone: false,
          trailAccum: 0,
        });
      }

      const beamMat = createHealBeamMaterial(0xd06bff, 0xffd15c);
      const meteorBeamMesh = new THREE.Mesh(this.beamCylinderGeo, beamMat);
      meteorBeamMesh.position.y = -0.04;
      meteorBeamMesh.scale.set(0.01, 0.01, 0.01);
      meteorBeamMesh.renderOrder = 5;
      meteorBeamMesh.userData.skipSSAO = true;
      group.add(meteorBeamMesh);

      disposables.push(blastMat, orbMat, tailMat, beamMat);
      shaderMaterials.push(blastMat, beamMat);
      this.rootGroup.add(group);

      return {
        id: eff.id,
        spellId: eff.spellId,
        group,
        disposables,
        shaderMaterials,
        radius: eff.radius,
        width: 0,
        meteorBlastMesh,
        meteorBeamMesh,
        meteorStars,
        meteorImpactBurstDone: false,
      };
    }

    // --- 4. SOIN-VELOURS : Colonne de lumière divine + Anneaux dorés pulsants ---
    const beamMat = createHealBeamMaterial(0x5ce67a, 0xffe570);
    const healBeamMesh = new THREE.Mesh(this.beamCylinderGeo, beamMat);
    healBeamMesh.position.y = -0.04;
    healBeamMesh.renderOrder = 5;
    healBeamMesh.userData.skipSSAO = true;
    group.add(healBeamMesh);

    const ringMat = createHealRingMaterial(0x5ce67a, 0xffe570);
    const healRings: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const ringMesh = new THREE.Mesh(this.unitDiskGeo, ringMat);
      ringMesh.position.y = i * 0.35;
      ringMesh.renderOrder = 4;
      ringMesh.userData.skipSSAO = true;
      group.add(ringMesh);
      healRings.push(ringMesh);
    }

    disposables.push(beamMat, ringMat);
    shaderMaterials.push(beamMat, ringMat);
    this.rootGroup.add(group);

    return {
      id: eff.id,
      spellId: eff.spellId,
      group,
      disposables,
      shaderMaterials,
      radius: eff.radius,
      width: 0,
      healBeamMesh,
      healRings,
      followPlayer: true,
    };
  }

  private disposeSpellVisual(vis: SpellEffectVisual): void {
    this.rootGroup.remove(vis.group);
    for (const d of vis.disposables) {
      d.dispose();
    }
  }

  private updateSpellEffects(
    effects: ActiveSpellEffect[],
    state: GameState,
    dt: number,
  ): void {
    const activeIds = this.activeSpellIds;
    activeIds.clear();

    for (let idx = 0; idx < effects.length; idx++) {
      const eff = effects[idx];
      activeIds.add(eff.id);
      let vis = this.spellEffects.get(eff.id);
      if (!vis) {
        vis = this.createSpellVisual(eff);
        this.spellEffects.set(eff.id, vis);
      }

      const t = Math.max(0, Math.min(1, eff.elapsed / Math.max(0.05, eff.duration)));
      const easeOut = 1 - (1 - t) * (1 - t);

      if (vis.followPlayer) {
        vis.group.position.set(state.player.x, TELEGRAPH_Y + 0.015, state.player.z);
        vis.group.rotation.y = 0;
      } else {
        vis.group.position.set(eff.x, TELEGRAPH_Y + 0.015, eff.z);
        vis.group.rotation.y = -eff.angle;
      }

      // Synchronise les uniforms GLSL temps & progression
      for (const mat of vis.shaderMaterials) {
        if (mat.uniforms.uTime) mat.uniforms.uTime.value = this.animTime;
        if (mat.uniforms.uProgress) mat.uniforms.uProgress.value = t;
      }

      if (vis.spellId === 'flamepurr') {
        const s = Math.max(0.4, vis.radius * (0.38 + 0.7 * easeOut));
        if (vis.flameRingMesh) {
          vis.flameRingMesh.scale.set(s, 1, s);
        }
        if (vis.heatHazeMesh) {
          const hazeScale = Math.max(0.35, vis.radius * (0.36 + 0.62 * easeOut));
          vis.heatHazeMesh.scale.set(hazeScale, 0.75 + easeOut * 0.55, hazeScale);
        }
        // Émission continue de braises lumineuses + légère fumée pendant la combustion
        vis.emberEmitAccum = (vis.emberEmitAccum ?? 0) + dt;
        if (vis.emberEmitAccum > 0.045 && t < 0.85) {
          vis.emberEmitAccum = 0;
          const a = Math.random() * Math.PI * 2;
          const r = vis.radius * (0.3 + Math.random() * 0.65);
          this.spawnParticle({
            x: eff.x + Math.cos(a) * r,
            y: 0.25,
            z: eff.z + Math.sin(a) * r,
            vx: Math.cos(a) * 0.8,
            vy: 3.4 + Math.random() * 2.2,
            vz: Math.sin(a) * 0.8,
            color: VFX_COLORS.flameCore,
            hdrBoost: 2.1,
            size: 0.34,
            endSize: 0.04,
            duration: 0.45,
            gravity: -1.4,
            star: true,
          });
        }
      } else if (vis.spellId === 'lightnyan' && vis.lightningPlanes) {
        const pulse = 1.0 - t * 0.32;
        for (let i = 0; i < vis.lightningPlanes.length; i++) {
          const plane = vis.lightningPlanes[i];
          if (i === 0) {
            plane.scale.set(1, 1, pulse);
          } else {
            plane.scale.set(1, pulse, 1);
          }
        }
      } else if (vis.spellId === 'freezepaw') {
        if (vis.frostMistMesh) {
          const s = Math.max(0.45, vis.radius * (0.36 + 0.72 * easeOut));
          vis.frostMistMesh.scale.set(s, 1, s);
        }
        if (vis.iceSpikes) {
          for (const spike of vis.iceSpikes) {
            const localT = Math.max(0, Math.min(1, (t - spike.delay) / Math.max(0.15, 1 - spike.delay)));
            // Jaillissement explosif puis fonte douce
            const rise = localT < 0.24
              ? 1 - Math.pow(1 - localT / 0.24, 3)
              : 1.0;
            const melt = localT > 0.68
              ? Math.max(0.01, 1 - (localT - 0.68) / 0.32)
              : 1.0;
            const hScale = Math.max(0.01, spike.targetHeight * rise * melt);
            const wScale = Math.max(0.05, spike.baseRadius * (0.6 + 0.4 * melt));
            spike.mesh.scale.set(wScale, hScale, wScale);
          }
        }
      } else if (vis.spellId === 'aegis_purr') {
        if (vis.aegisDomeMesh) {
          const pop = t < 0.25 ? 0.55 + (t / 0.25) * 0.6 : 1.15 + Math.sin(t * Math.PI) * 0.14;
          const domeScale = vis.radius * 0.62 * pop;
          vis.aegisDomeMesh.scale.set(domeScale, domeScale * 1.12, domeScale);
          vis.aegisDomeMesh.rotation.y = this.animTime * 1.4;
        }
        if (vis.aegisRingMesh) {
          const rScale = vis.radius * (0.65 + easeOut * 0.42);
          vis.aegisRingMesh.scale.set(rScale, 1, rScale);
          vis.aegisRingMesh.rotation.y = -this.animTime * 1.9;
        }
      } else if (vis.spellId === 'pounce_dash') {
        if (vis.pounceRibbonMesh) {
          vis.pounceRibbonMesh.scale.set(1, 1, 1.0 - t * 0.35);
        }
      } else if (vis.spellId === 'meteor_paw') {
        if (vis.meteorBlastMesh) {
          vis.meteorBlastMesh.rotation.y = this.animTime * 0.9;
        }
        if (vis.meteorStars) {
          for (let si = 0; si < vis.meteorStars.length; si++) {
            const st = vis.meteorStars[si];
            if (t < st.startT) {
              st.group.visible = false;
            } else if (t <= st.impactT) {
              st.group.visible = true;
              const localT = (t - st.startT) / Math.max(0.05, st.impactT - st.startT);
              const accel = localT * localT;
              const skyHeight = 22.0;
              const xPos = st.offsetX - 5.6 * (1 - accel);
              const yPos = skyHeight * (1 - accel) + 0.42;
              const zPos = st.offsetZ - 3.6 * (1 - accel);
              st.group.position.set(xPos, yPos, zPos);
              const sScale = 0.95 + accel * 0.78;
              st.orb.scale.set(sScale, sScale, sScale);
              st.orb.rotation.set(this.animTime * 8, this.animTime * 11, si);
              st.tail.scale.set(1.18, 1.35 + accel * 1.15, 1.18);

              // Traînée d'étoiles scintillantes dans le ciel pendant la chute
              st.trailAccum += dt;
              if (st.trailAccum >= 0.04) {
                st.trailAccum = 0;
                this.spawnParticle({
                  x: eff.x + xPos,
                  y: yPos + 0.5,
                  z: eff.z + zPos,
                  vx: (Math.random() - 0.5) * 1.1,
                  vy: 1.1 + Math.random() * 1.2,
                  vz: (Math.random() - 0.5) * 1.1,
                  color: si % 2 === 0 ? '#ffd85c' : '#d578ff',
                  size: 0.42,
                  endSize: 0.06,
                  duration: 0.36,
                  gravity: -0.6,
                  star: true,
                  hdrBoost: 2.2,
                });
              }
            } else {
              st.group.visible = false;
              if (!st.impactDone) {
                st.impactDone = true;
                const ix = eff.x + st.offsetX;
                const iz = eff.z + st.offsetZ;
                const isFinalStar = si === vis.meteorStars.length - 1;
                this.spawnExpandingRing(
                  ix,
                  iz,
                  isFinalStar ? '#ffd85c' : '#c95bff',
                  0.45,
                  vis.radius * (isFinalStar ? 1.18 : 0.78),
                  isFinalStar ? 0.48 : 0.36,
                  2.2,
                );
                this.spawnBurst(
                  ix,
                  0.55,
                  iz,
                  isFinalStar ? 22 : 12,
                  si % 2 === 0 ? '#ffcf5c' : '#c95bff',
                  isFinalStar ? 7.6 : 5.4,
                  {
                    size: isFinalStar ? 0.56 : 0.44,
                    duration: 0.55,
                    star: true,
                    upward: 4.5,
                    gravity: -4.2,
                    hdrBoost: 2.3,
                  },
                );
              }
            }
          }
        }
        if (vis.meteorBeamMesh) {
          const beamPulse = t > 0.22 && t < 0.96 ? Math.sin(((t - 0.22) / 0.74) * Math.PI) : 0;
          if (beamPulse > 0.02) {
            const bW = vis.radius * (0.28 + beamPulse * 0.28);
            vis.meteorBeamMesh.scale.set(bW, 0.75 + beamPulse * 0.45, bW);
          } else {
            vis.meteorBeamMesh.scale.set(0.01, 0.01, 0.01);
          }
        }
      } else if (vis.spellId === 'healing_paw') {
        if (vis.healBeamMesh) {
          const beamW = (0.75 + Math.sin(t * Math.PI) * 0.35) * Math.max(0.85, vis.radius * 0.45);
          vis.healBeamMesh.scale.set(beamW, 0.85 + easeOut * 0.25, beamW);
        }
        if (vis.healRings) {
          vis.healRings.forEach((ring, idx) => {
            const phaseT = (t * 1.55 + idx * 0.33) % 1;
            const rScale = Math.max(0.65, vis.radius * (0.58 + phaseT * 0.48));
            ring.scale.set(rScale, 1, rScale);
            ring.position.y = idx === 0 ? 0.01 : 0.3 + phaseT * 3.1;
            ring.rotation.y = this.animTime * (idx % 2 === 0 ? 1.8 : -2.2);
          });
        }
      }
    }

    for (const [id, vis] of this.spellEffects.entries()) {
      if (!activeIds.has(id)) {
        this.disposeSpellVisual(vis);
        this.spellEffects.delete(id);
      }
    }
  }

  // ==========================================================================
  // 3. Particules HDR / Fumée / Spirales, Arcs de Slash & Colonne Level-Up
  // ==========================================================================

  private spawnParticle(opts: {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    vz: number;
    color: string | number;
    size: number;
    endSize?: number;
    duration: number;
    gravity?: number;
    star?: boolean;
    hdrBoost?: number;
    smoke?: boolean;
    opacity?: number;
    spiral?: SpiralMotion;
  }): void {
    // Sélectionne un slot libre dans le pool pré-alloué (ou recycle en round-robin)
    let slot: ParticleSlot | null = null;
    for (let attempt = 0; attempt < PARTICLE_POOL_SIZE; attempt++) {
      const idx = (this.particleCursor + attempt) % PARTICLE_POOL_SIZE;
      if (!this.particlePool[idx].active) {
        slot = this.particlePool[idx];
        this.particleCursor = (idx + 1) % PARTICLE_POOL_SIZE;
        break;
      }
    }
    if (!slot) {
      slot = this.particlePool[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    }

    const baseOpacity = opts.opacity ?? (opts.smoke ? 0.42 : 1.0);
    const targetMap = opts.star
      ? this.textures.getStarParticleTexture()
      : this.textures.getParticleTexture();
    const targetBlending = opts.smoke ? THREE.NormalBlending : THREE.AdditiveBlending;

    if (slot.material.map !== targetMap) {
      slot.material.map = targetMap;
    }
    if (slot.material.blending !== targetBlending) {
      slot.material.blending = targetBlending;
    }
    slot.material.color.set(opts.color);
    if (!opts.smoke && opts.hdrBoost && opts.hdrBoost > 1) {
      slot.material.color.multiplyScalar(opts.hdrBoost);
    }
    slot.material.opacity = baseOpacity;

    slot.sprite.position.set(opts.x, opts.y, opts.z);
    slot.sprite.scale.set(opts.size, opts.size, 1);
    slot.sprite.renderOrder = opts.smoke ? 5 : 6;
    slot.sprite.visible = true;

    slot.active = true;
    slot.vx = opts.vx;
    slot.vy = opts.vy;
    slot.vz = opts.vz;
    slot.gravity = opts.gravity ?? -9.5;
    slot.age = 0;
    slot.duration = Math.max(0.05, opts.duration);
    slot.startSize = opts.size;
    slot.endSize = opts.endSize ?? (opts.smoke ? opts.size * 2.2 : 0.05);
    slot.baseOpacity = baseOpacity;
    slot.isSmoke = Boolean(opts.smoke);
    if (opts.spiral) {
      slot.hasSpiral = true;
      slot.spiral.cx = opts.spiral.cx;
      slot.spiral.cz = opts.spiral.cz;
      slot.spiral.radius = opts.spiral.radius;
      slot.spiral.angle = opts.spiral.angle;
      slot.spiral.angularSpeed = opts.spiral.angularSpeed;
      slot.spiral.radiusSpeed = opts.spiral.radiusSpeed;
      slot.spiral.followPlayer = opts.spiral.followPlayer;
    } else {
      slot.hasSpiral = false;
    }
  }

  private spawnBurst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: string | number,
    speed: number,
    opts?: {
      size?: number;
      endSize?: number;
      duration?: number;
      star?: boolean;
      upward?: number;
      gravity?: number;
      hdrBoost?: number;
      smoke?: boolean;
      opacity?: number;
    },
  ): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = speed * (0.45 + Math.random() * 0.75);
      this.spawnParticle({
        x: x + (Math.random() - 0.5) * 0.45,
        y: y + Math.random() * 0.4,
        z: z + (Math.random() - 0.5) * 0.45,
        vx: Math.cos(a) * spd,
        vy: (opts?.upward ?? 2.8) + Math.random() * 2.5,
        vz: Math.sin(a) * spd,
        color,
        size: (opts?.size ?? 0.42) * (0.75 + Math.random() * 0.5),
        endSize: opts?.endSize,
        duration: (opts?.duration ?? 0.45) * (0.8 + Math.random() * 0.4),
        gravity: opts?.gravity ?? -9.0,
        star: opts?.star,
        hdrBoost: opts?.hdrBoost,
        smoke: opts?.smoke,
        opacity: opts?.opacity,
      });
    }
  }

  private spawnFootprint(
    x: number,
    z: number,
    aimAngle: number,
    colorHex: string,
    opacity: number,
  ): void {
    if (this.footprintPool.length === 0) return;
    const slot = this.footprintPool[this.footprintCursor];
    this.footprintCursor = (this.footprintCursor + 1) % this.footprintPool.length;
    this.footprintStrideLeft = !this.footprintStrideLeft;
    const sideSign = this.footprintStrideLeft ? -1 : 1;
    const perpX = -Math.sin(aimAngle) * 0.16 * sideSign;
    const perpZ = Math.cos(aimAngle) * 0.16 * sideSign;

    slot.active = true;
    slot.age = 0;
    slot.duration = 3.5;
    slot.baseOpacity = opacity;
    slot.material.color.set(colorHex);
    slot.material.opacity = opacity;
    slot.mesh.position.set(x + perpX, 0.045, z + perpZ);
    slot.mesh.rotation.y = -aimAngle + Math.PI * 0.5;
    slot.mesh.scale.set(0.36, 1, 0.36);
    slot.mesh.visible = true;
  }

  private spawnStarSpiral(
    cx: number,
    cz: number,
    count: number,
    primaryColor: string | number,
    secondaryColor: string | number,
    followPlayer: boolean,
    baseRadius = 1.25,
  ): void {
    for (let i = 0; i < count; i++) {
      const strand = i % 2 === 0 ? 1 : -1;
      const startAngle = (i / count) * Math.PI * 2 + (strand > 0 ? 0 : Math.PI);
      const r = baseRadius * (0.65 + (i % 3) * 0.2);
      const y0 = 0.15 + (i / count) * 1.1;

      this.spawnParticle({
        x: cx + Math.cos(startAngle) * r,
        y: y0,
        z: cz + Math.sin(startAngle) * r,
        vx: 0,
        vy: 3.1 + Math.random() * 1.3,
        vz: 0,
        color: i % 2 === 0 ? primaryColor : secondaryColor,
        hdrBoost: 1.9,
        size: 0.44 + Math.random() * 0.22,
        endSize: 0.06,
        duration: 0.85 + Math.random() * 0.35,
        gravity: -0.4,
        star: true,
        spiral: {
          cx,
          cz,
          radius: r,
          angle: startAngle,
          angularSpeed: strand * (5.2 + Math.random() * 1.8),
          radiusSpeed: -0.25,
          followPlayer,
        },
      });
    }
  }

  private spawnExpandingRing(
    x: number,
    z: number,
    color: string | number,
    startScale: number,
    endScale: number,
    duration: number,
    hdrBoost = 1.45,
  ): void {
    let slot: ExpandingRingSlot | null = null;
    for (let attempt = 0; attempt < RING_POOL_SIZE; attempt++) {
      const idx = (this.ringCursor + attempt) % RING_POOL_SIZE;
      if (!this.ringPool[idx].active) {
        slot = this.ringPool[idx];
        this.ringCursor = (idx + 1) % RING_POOL_SIZE;
        break;
      }
    }
    if (!slot) {
      slot = this.ringPool[this.ringCursor];
      this.ringCursor = (this.ringCursor + 1) % RING_POOL_SIZE;
    }

    slot.active = true;
    slot.age = 0;
    slot.duration = Math.max(0.06, duration);
    slot.startScale = startScale;
    slot.endScale = endScale;
    slot.material.color.set(color).multiplyScalar(hdrBoost);
    slot.material.opacity = 0.9;
    slot.mesh.position.set(x, TELEGRAPH_Y + 0.02, z);
    slot.mesh.scale.set(startScale, 1, startScale);
    slot.mesh.visible = true;
  }

  private spawnMeleeSlash(
    x: number,
    z: number,
    angle: number,
    comboStep: 0 | 1 | 2,
    weaponId?: string,
    ev?: GameEvent,
  ): void {
    const profile = getWeaponCombatProfile(weaponId);
    const isFinisher = comboStep === 2;
    const attackShape = ev?.attackShape ?? profile.attackShape;
    const outerR = ev?.radius ?? profile.reach * (isFinisher ? 1.12 : 0.98);

    // Armes à distance : petit éclat directionnel de tir/incantation au lieu d'un grand arc mêlée
    if (attackShape === 'projectile') {
      const tipX = x + Math.cos(angle) * 0.9;
      const tipZ = z + Math.sin(angle) * 0.9;
      this.spawnBurst(tipX, 0.9, tipZ, isFinisher ? 10 : 6, profile.sparkColor, 3.6, {
        size: 0.34,
        duration: 0.28,
        star: true,
        upward: 1.4,
        gravity: -1.1,
        hdrBoost: 1.9,
      });
      return;
    }

    const isThrust = attackShape === 'thrust_line' && !isFinisher;
    const innerR = isThrust
      ? outerR * 0.24
      : attackShape === 'cleave'
        ? outerR * 0.36
        : outerR * 0.44;
    const baseArc = ev?.hitArc ?? (isFinisher ? profile.arcAngleFinisher : profile.arcAngle);
    const arc = Math.min(Math.PI * 1.18, baseArc);

    let geometry: THREE.BufferGeometry;
    if (isThrust) {
      geometry = new THREE.PlaneGeometry(outerR, 0.88);
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(outerR * 0.5, 0, 0);
    } else {
      geometry = createSlashArcGeometry(innerR, outerR, arc, 24);
    }

    const primaryHex = new THREE.Color(ev?.color ?? profile.slashColor).getHex();
    const edgeHex = new THREE.Color(ev?.accentColor ?? profile.slashAccent).getHex();
    const slashTex = this.textures.getVfxTexture(isThrust ? 'projectile_trail' : 'melee_slash_trail');
    const material = createSlashTrailShaderMaterial({
      texture: slashTex,
      primaryColor: primaryHex,
      edgeColor: edgeHex,
      isThrust,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0.85, z);
    const startAngle = ev?.startAngle ?? (angle - (comboStep === 1 ? -0.42 : 0.42));
    const endAngle = ev?.endAngle ?? (angle + (comboStep === 1 ? -0.42 : 0.42));
    mesh.rotation.y = -startAngle;
    mesh.renderOrder = 5;
    mesh.userData.skipSSAO = true;
    this.rootGroup.add(mesh);

    const sweepSpan = isThrust ? 0.16 : 0.85;
    const activeDur = ev?.activeSec
      ? Math.max(0.14, ev.activeSec * 1.45)
      : Math.max(0.15, profile.animDuration * (isFinisher ? 1.02 : 0.86));

    this.slashes.push({
      mesh,
      material,
      geometry,
      baseAngle: angle,
      startAngle,
      endAngle,
      sweepDir: comboStep === 1 ? -1 : 1,
      sweepSpan,
      isThrust,
      age: 0,
      duration: activeDur,
    });

    // Flipbook élémentaire CC0 synchronisé sur l'arc d'arme
    const el = ev?.element;
    const slashTipX = x + Math.cos(angle) * (outerR * 0.72);
    const slashTipZ = z + Math.sin(angle) * (outerR * 0.72);
    if (el === 'fire' || el === 'burn') {
      this.spawnFlipbook({ vfxId: 'flames', x: slashTipX, y: 0.9, z: slashTipZ, scale: 1.35, endScale: 1.85, duration: 0.34, color: '#ff8833' });
    } else if (el === 'frost' || el === 'chill') {
      this.spawnFlipbook({ vfxId: 'ice_shards', x: slashTipX, y: 0.9, z: slashTipZ, scale: 1.25, endScale: 1.75, duration: 0.34, color: '#8be8ff' });
    } else if (el === 'shock') {
      this.spawnFlipbook({ vfxId: 'electric_arc', x: slashTipX, y: 0.95, z: slashTipZ, scale: 1.4, endScale: 1.8, duration: 0.24, color: '#fff37a' });
    } else if (el === 'poison') {
      this.spawnFlipbook({ vfxId: 'slime_splatter', x: slashTipX, y: 0.85, z: slashTipZ, scale: 1.15, endScale: 1.55, duration: 0.32, color: '#6df556' });
    } else if (isFinisher) {
      this.spawnFlipbook({ vfxId: 'sparks', x: slashTipX, y: 0.92, z: slashTipZ, scale: 1.45, endScale: 1.95, duration: 0.3, color: ev?.accentColor ?? profile.sparkColor });
    }

    // Particules thématiques par famille et matériau synchronisées à la portée de frappe
    const tipX = x + Math.cos(angle) * (outerR * 0.78);
    const tipZ = z + Math.sin(angle) * (outerR * 0.78);
    if (profile.attackShape === 'cleave') {
      this.spawnBurst(tipX, 0.85, tipZ, isFinisher ? 14 : 8, profile.sparkColor, 4.6, {
        size: 0.44,
        duration: 0.42,
        star: true,
        upward: 2.2,
        gravity: -2.4,
        hdrBoost: 2.0,
      });
      if (isFinisher) {
        this.spawnExpandingRing(tipX, tipZ, profile.slashAccent, 0.3, outerR * 0.72, 0.28, 1.9);
      }
    } else if (profile.weaponFamily === 'staff' || profile.weaponFamily === 'bow_crossbow') {
      this.spawnBurst(tipX, 0.9, tipZ, isFinisher ? 12 : 7, profile.sparkColor, 3.8, {
        size: 0.38,
        duration: 0.4,
        star: true,
        upward: 1.8,
        gravity: -1.1,
        hdrBoost: 1.9,
      });
    } else if (profile.attackShape === 'thrust_line' || weaponId === 'sword_steel') {
      // Étincelles d'estoc vives le long de la ligne d'attaque
      for (let i = 0; i < (isFinisher ? 8 : 5); i++) {
        const d = outerR * (0.45 + i * 0.11);
        this.spawnParticle({
          x: x + Math.cos(angle) * d,
          y: 0.82 + (Math.random() - 0.5) * 0.25,
          z: z + Math.sin(angle) * d,
          vx: Math.cos(angle) * (4.2 + Math.random() * 2.2),
          vy: 1.2 + Math.random() * 1.4,
          vz: Math.sin(angle) * (4.2 + Math.random() * 2.2),
          color: profile.sparkColor,
          size: 0.3,
          endSize: 0.04,
          duration: 0.26,
          gravity: -4.5,
          star: true,
          hdrBoost: 1.85,
        });
      }
    } else if (profile.weaponFamily === 'dagger_claws') {
      this.spawnBurst(tipX, 0.82, tipZ, isFinisher ? 9 : 6, profile.sparkColor, 3.9, {
        size: 0.28,
        duration: 0.24,
        star: true,
        upward: 1.4,
        gravity: -3.2,
        hdrBoost: 1.7,
      });
    } else {
      // Coupe classique : étincelles nettes à l'impact
      this.spawnBurst(tipX, 0.72, tipZ, 4, profile.sparkColor, 2.4, {
        size: 0.3,
        duration: 0.26,
        upward: 1.0,
        gravity: -5.5,
        hdrBoost: 1.2,
      });
    }
  }

  private spawnLevelUpBeam(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.userData.skipSSAO = true;

    const beamMat = createHealBeamMaterial(GOLD_MID, 0xfff7c2);
    const beamMesh = new THREE.Mesh(this.beamCylinderGeo, beamMat);
    beamMesh.renderOrder = 5;
    beamMesh.userData.skipSSAO = true;
    group.add(beamMesh);

    const ringMat = createHealRingMaterial(GOLD_MID, GOLD_LIGHT);
    const ringMesh = new THREE.Mesh(this.unitDiskGeo, ringMat);
    ringMesh.position.y = TELEGRAPH_Y + 0.025;
    ringMesh.renderOrder = 4;
    ringMesh.userData.skipSSAO = true;
    group.add(ringMesh);

    this.rootGroup.add(group);
    this.levelBeams.push({
      group,
      beamMat,
      ringMat,
      ringMesh,
      beamMesh,
      age: 0,
      duration: 1.45,
    });

    this.spawnStarSpiral(x, z, 24, GOLD_LIGHT, '#fff8d4', true, 1.45);
  }

  /**
   * Consomme les événements de simulation de la frame pour déclencher les VFX ponctuels.
   */
  public processEvents(events: GameEvent[], state: GameState): void {
    for (const ev of events) {
      const px = ev.x ?? state.player.x;
      const pz = ev.z ?? state.player.z;

      switch (ev.type) {
        case 'melee_swing': {
          const angle = ev.angle ?? state.player.aimAngle;
          const step = ev.comboStep ?? state.player.comboStep;
          this.spawnMeleeSlash(
            px,
            pz,
            angle,
            step,
            ev.weaponId ?? state.player.equipped.weapon,
            ev,
          );
          break;
        }
        case 'perfect_dodge': {
          this.spawnFlipbook({ vfxId: 'electric_burst', x: px, y: 0.9, z: pz, scale: 1.6, endScale: 2.3, duration: 0.36, color: '#ffe66d' });
          this.spawnExpandingRing(px, pz, '#ffe66d', 0.35, 3.2, 0.42, 2.2);
          this.spawnBurst(px, 0.95, pz, 18, '#ffe66d', 5.2, {
            size: 0.48,
            duration: 0.48,
            star: true,
            upward: 2.6,
            gravity: -2.0,
            hdrBoost: 2.3,
          });
          this.spawnBurst(state.companion.x, 1.85, state.companion.z, 10, '#a6f4ff', 3.4, {
            size: 0.36,
            duration: 0.55,
            star: true,
            upward: 2.4,
            gravity: -1.4,
            hdrBoost: 2.0,
          });
          break;
        }
        case 'status_purged': {
          this.spawnExpandingRing(px, pz, '#7ef5a8', 0.3, 2.4, 0.4, 1.9);
          this.spawnStarSpiral(px, pz, 14, '#7ef5a8', GOLD_LIGHT, true, 0.9);
          break;
        }
        case 'stagger_break': {
          this.spawnFlipbook({ vfxId: 'electric_burst', x: px, y: 1.15, z: pz, scale: 2.1, endScale: 3.1, duration: 0.45, color: '#ffd166' });
          this.spawnExpandingRing(px, pz, '#ffaa3b', 0.5, 4.4, 0.5, 2.2);
          this.spawnBurst(px, 1.2, pz, 20, '#ffd166', 5.8, {
            size: 0.5,
            duration: 0.52,
            star: true,
            upward: 3.4,
            gravity: -3.2,
            hdrBoost: 2.2,
          });
          break;
        }
        case 'status_applied': {
          const stColor =
            ev.statusId === 'burn'
              ? '#ff6b2b'
              : ev.statusId === 'chill'
                ? '#75ebff'
                : ev.statusId === 'poison'
                  ? '#7bf054'
                  : ev.statusId === 'shock'
                    ? '#ffef5c'
                    : ev.statusId === 'curse'
                      ? '#a96eff'
                      : '#e84359';
          if (ev.statusId === 'shock') {
            this.spawnFlipbook({ vfxId: 'electric_burst', x: px, y: 1.0, z: pz, scale: 1.5, endScale: 2.2, duration: 0.36, color: '#fff37a' });
          }
          this.spawnBurst(px, 0.95, pz, 8, stColor, 2.8, {
            size: 0.34,
            duration: 0.38,
            upward: 1.8,
            gravity: -1.5,
            hdrBoost: 1.6,
          });
          break;
        }
        case 'status_tick': {
          const tickColor =
            ev.statusId === 'poison'
              ? '#7bf054'
              : ev.statusId === 'bleed'
                ? '#e84359'
                : '#ff7a2b';
          this.spawnBurst(px, 0.9, pz, 4, tickColor, 2.0, {
            size: 0.26,
            duration: 0.28,
            upward: 1.5,
            gravity: -2.0,
            hdrBoost: 1.4,
          });
          break;
        }
        case 'loot_bounce': {
          const lootColor = ev.lootKind === 'xp' ? '#66e0ff' : '#ffd84d';
          this.spawnBurst(px, 0.22, pz, 4, lootColor, 1.8, {
            size: 0.22,
            duration: 0.26,
            star: true,
            upward: 1.6,
            gravity: -5.0,
            hdrBoost: 1.5,
          });
          break;
        }
        case 'hit_enemy': {
          const col = ev.isCrit
            ? GOLD_LIGHT
            : ev.spellId === 'flamepurr'
              ? VFX_COLORS.flame
              : ev.spellId === 'lightnyan'
                ? VFX_COLORS.lightning
                : ev.spellId === 'freezepaw'
                  ? VFX_COLORS.frost
                  : '#fff6e0';
          this.spawnBurst(px, 1.0, pz, ev.isCrit ? 16 : 8, col, ev.isCrit ? 5.4 : 3.6, {
            size: ev.isCrit ? 0.54 : 0.35,
            duration: 0.38,
            star: Boolean(ev.isCrit),
            hdrBoost: ev.isCrit ? 2.1 : 1.4,
          });
          if (ev.isCrit) {
            this.spawnBurst(state.companion.x, 1.85, state.companion.z, 6, GOLD_LIGHT, 2.6, {
              size: 0.3,
              duration: 0.42,
              star: true,
              upward: 2.2,
              gravity: -1.6,
              hdrBoost: 1.9,
            });
          }
          break;
        }
        case 'hit_player': {
          this.spawnBurst(px, 1.0, pz, 11, '#ff4d4d', 4.1, {
            size: 0.4,
            duration: 0.38,
            hdrBoost: 1.5,
          });
          break;
        }
        case 'enemy_died': {
          const col = ev.color ?? (ev.enemyTypeId ? ENEMIES[ev.enemyTypeId].primaryColor : GOLD_LIGHT);
          const acc = ev.accentColor ?? (ev.enemyTypeId ? ENEMIES[ev.enemyTypeId].accentColor : GOLD_LIGHT);
          const et = ev.enemyTypeId;
          if (et === 'slime_yarn') {
            this.spawnFlipbook({ vfxId: 'slime_splatter', x: px, y: 0.75, z: pz, scale: 2.0, endScale: 2.8, duration: 0.52, color: col });
            this.spawnDecal({ decalId: 'slime_decal', x: px, z: pz, scale: 2.4, duration: 4.5, color: col, opacity: 0.72 });
            this.spawnBurst(px, 0.7, pz, 16, col, 4.6, { size: 0.44, duration: 0.5, hdrBoost: 1.5 });
          } else if (et === 'frost_golem') {
            this.spawnFlipbook({ vfxId: 'ice_shards', x: px, y: 1.0, z: pz, scale: 2.6, endScale: 3.4, duration: 0.65, color: '#9ee8ff' });
            this.spawnExpandingRing(px, pz, '#66dcff', 0.4, 3.6, 0.45, 2.0);
            this.spawnBurst(px, 1.0, pz, 22, '#9ee8ff', 5.6, { size: 0.48, duration: 0.62, star: true, hdrBoost: 1.9 });
          } else if (et === 'fishbone_skeleton') {
            this.spawnFlipbook({ vfxId: 'spectral_cloud', x: px, y: 0.9, z: pz, scale: 2.2, endScale: 3.0, duration: 0.6, color: acc });
            this.spawnFlipbook({ vfxId: 'debris_fragments', x: px, y: 0.95, z: pz, scale: 2.0, endScale: 2.6, duration: 0.55, color: col });
            this.spawnBurst(px, 0.9, pz, 18, col, 5.2, { size: 0.42, duration: 0.55, hdrBoost: 1.4 });
          } else if (et === 'mouse_goblin' || et === 'thorn_wolf') {
            this.spawnFlipbook({ vfxId: 'smoke', x: px, y: 0.85, z: pz, scale: 2.1, endScale: 2.9, duration: 0.58, color: acc, opacity: 0.68 });
            this.spawnFlipbook({ vfxId: 'debris_fragments', x: px, y: 0.85, z: pz, scale: 1.85, endScale: 2.4, duration: 0.5, color: col });
            this.spawnBurst(px, 0.85, pz, 16, col, 4.8, { size: 0.45, duration: 0.54, hdrBoost: 1.5 });
          } else if (et === 'boss_rat_king') {
            this.spawnFlipbook({ vfxId: 'abyssal_vortex', x: px, y: 0.4, z: pz, scale: 4.5, endScale: 5.5, duration: 1.2, color: '#a855f7', flatOnGround: true });
            this.spawnBurst(px, 1.1, pz, 26, '#f5c542', 6.4, { size: 0.56, duration: 0.8, star: true, hdrBoost: 2.0 });
          } else if (et === 'boss_dragon_claw') {
            this.spawnFlipbook({ vfxId: 'fireball', x: px, y: 1.2, z: pz, scale: 4.6, endScale: 6.2, duration: 0.95, color: '#ff6a22' });
            this.spawnDecal({ decalId: 'crater_fissure_decal', x: px, z: pz, scale: 5.5, duration: 6.0, color: '#ff6b1a', opacity: 0.85 });
            this.spawnBurst(px, 1.3, pz, 30, '#ff8828', 7.2, { size: 0.6, duration: 0.85, star: true, hdrBoost: 2.2 });
          } else {
            this.spawnBurst(px, 0.9, pz, 18, col, 4.8, { size: 0.48, duration: 0.56, hdrBoost: 1.45 });
          }
          this.spawnBurst(px, 1.1, pz, 8, GOLD_LIGHT, 3.4, {
            size: 0.44,
            duration: 0.68,
            star: true,
            hdrBoost: 1.9,
          });
          if (et === 'boss_rat_king' || et === 'boss_dragon_claw') {
            this.spawnStarSpiral(state.companion.x, state.companion.z, 16, GOLD_LIGHT, '#7aeaff', false, 0.95);
          }
          break;
        }
        case 'boss_cinematic_start':
        case 'boss_cinematic_stage': {
          const stage = ev.cinematicStage ?? '';
          if (ev.enemyTypeId === 'boss_rat_king') {
            if (stage === 'throne_arrival' || stage === 'king_challenge') {
              this.spawnExpandingRing(px, pz, '#a855f7', 0.6, 4.2, 0.6, 1.9);
              this.spawnBurst(px, 0.9, pz, 16, '#f5c542', 4.8, { size: 0.46, duration: 0.65, star: true, hdrBoost: 1.8 });
            } else if (stage === 'slowmo_collapse') {
              this.spawnBurst(px, 1.0, pz, 24, '#f5c542', 6.2, { size: 0.5, duration: 0.9, star: true, hdrBoost: 1.95 });
              this.spawnFlipbook({ vfxId: 'spectral_cloud', x: px, y: 0.9, z: pz, scale: 3.4, endScale: 4.8, duration: 1.1, color: '#a855f7' });
            } else if (stage === 'rift_close') {
              this.spawnFlipbook({ vfxId: 'abyssal_vortex', x: px, y: 0.25, z: pz, scale: 5.0, endScale: 0.5, duration: 1.2, color: '#9333ea', flatOnGround: true });
              this.spawnExpandingRing(px, pz, '#c084fc', 4.5, 0.3, 0.9, 2.0);
            }
          } else if (ev.enemyTypeId === 'boss_dragon_claw') {
            if (stage === 'aerial_descent' || stage === 'inferno_roar') {
              this.spawnExpandingRing(px, pz, '#ff5b1f', 0.8, 7.5, 0.72, 2.2);
              this.spawnFlipbook({ vfxId: 'flames', x: px, y: 1.2, z: pz, scale: 3.8, endScale: 5.2, duration: 0.9, color: '#ff6a22' });
            } else if (stage === 'cracks') {
              this.spawnFlipbook({ vfxId: 'fireball', x: px, y: 1.3, z: pz, scale: 3.8, endScale: 4.8, duration: 0.8, color: '#ff521a' });
              this.spawnFlipbook({ vfxId: 'spark_ember', x: px, y: 1.4, z: pz, scale: 1.15, endScale: 1.7, duration: 0.65, vy: 2.4, color: '#ffb84d' });
              this.spawnBurst(px, 1.3, pz, 22, '#ffae33', 5.2, { size: 0.52, duration: 0.85, star: true, hdrBoost: 2.3 });
            } else if (stage === 'double_shockwave') {
              this.spawnExpandingRing(px, pz, '#ff4d1a', 0.7, 12.0, 0.75, 2.3);
              this.spawnExpandingRing(px, pz, '#ffd166', 0.5, 9.5, 0.58, 2.2);
              this.spawnFlipbook({ vfxId: 'fireball', x: px, y: 1.1, z: pz, scale: 4.5, endScale: 6.5, duration: 0.85, color: '#ff7722' });
            } else if (stage === 'ascending_embers') {
              this.spawnFlipbook({ vfxId: 'sparks', x: px, y: 1.1, z: pz, scale: 4.2, endScale: 5.8, duration: 1.1, vy: 2.2, color: '#ffd166' });
              this.spawnFlipbook({ vfxId: 'spark_ember', x: px, y: 1.0, z: pz, scale: 1.25, endScale: 1.85, duration: 0.95, vy: 3.2, color: '#ff9f40' });
              this.spawnBurst(px, 0.8, pz, 34, '#ff9f40', 4.2, { size: 0.5, duration: 1.2, star: true, upward: 6.8, gravity: 1.2, hdrBoost: 2.3 });
            } else if (stage === 'lair_brighten') {
              this.spawnFlipbook({ vfxId: 'steam_puff', x: px, y: 1.2, z: pz, scale: 2.4, endScale: 3.8, duration: 0.85, vy: 1.3, color: '#ffe8c2', opacity: 0.65 });
              this.spawnExpandingRing(px, pz, GOLD_LIGHT, 1.0, 14.0, 0.85, 2.0);
            }
          }
          break;
        }
        case 'spell_cast': {
          if (ev.spellId === 'flamepurr') {
            this.spawnFlipbook({ vfxId: 'spark_ember', x: px, y: 0.9, z: pz, scale: 0.9, endScale: 1.45, duration: 0.55, vy: 2.6, color: '#ff9b3d' });
            this.spawnBurst(px, 0.55, pz, 24, VFX_COLORS.flame, 5.8, {
              size: 0.52,
              duration: 0.56,
              upward: 4.2,
              gravity: -2.6,
              hdrBoost: 2.2,
              star: true,
            });
            this.spawnBurst(px, 0.85, pz, 10, '#3b251c', 2.6, {
              size: 0.95,
              endSize: 2.4,
              duration: 0.82,
              upward: 2.6,
              gravity: 0.4,
              smoke: true,
              opacity: 0.36,
            });
          } else if (ev.spellId === 'lightnyan') {
            this.spawnFlipbook({ vfxId: 'electric_burst', x: px, y: 0.9, z: pz, scale: 1.8, endScale: 2.6, duration: 0.4, color: '#fff37a' });
            const ang = ev.angle ?? state.player.aimAngle;
            const len = ev.radius ?? 9;
            for (let i = 1; i <= 7; i++) {
              const dist = (i / 7) * len;
              this.spawnBurst(
                px + Math.cos(ang) * dist,
                0.75,
                pz + Math.sin(ang) * dist,
                4,
                i % 2 === 0 ? VFX_COLORS.lightning : VFX_COLORS.lightningArc,
                3.0,
                {
                  size: 0.42,
                  duration: 0.34,
                  star: true,
                  gravity: -1.6,
                  hdrBoost: 2.5,
                },
              );
            }
          } else if (ev.spellId === 'freezepaw') {
            this.spawnBurst(px, 0.7, pz, 24, VFX_COLORS.frostLight, 5.8, {
              size: 0.46,
              duration: 0.58,
              star: true,
              upward: 3.2,
              gravity: -4.2,
              hdrBoost: 1.85,
            });
            this.spawnBurst(px, 0.25, pz, 12, VFX_COLORS.frost, 4.4, {
              size: 0.9,
              endSize: 1.9,
              duration: 0.72,
              upward: 0.45,
              gravity: -0.2,
              hdrBoost: 1.15,
              opacity: 0.5,
            });
          } else if (ev.spellId === 'healing_paw') {
            this.spawnStarSpiral(
              state.player.x,
              state.player.z,
              22,
              GOLD_LIGHT,
              VFX_COLORS.heal,
              true,
              1.2,
            );
          } else if (ev.spellId === 'aegis_purr') {
            this.spawnExpandingRing(state.player.x, state.player.z, '#ffd166', 0.4, 2.6, 0.46, 1.9);
            this.spawnStarSpiral(
              state.player.x,
              state.player.z,
              18,
              '#ffd166',
              '#66f2ff',
              true,
              1.35,
            );
          } else if (ev.spellId === 'pounce_dash') {
            this.spawnFlipbook({ vfxId: 'electric_burst', x: px, y: 0.85, z: pz, scale: 1.5, endScale: 2.1, duration: 0.34, color: '#4de8d6' });
            this.spawnExpandingRing(px, pz, '#4de8d6', 0.3, 2.4, 0.34, 2.0);
            this.spawnBurst(px, 0.6, pz, 16, '#4de8d6', 5.2, {
              size: 0.44,
              duration: 0.4,
              star: true,
              upward: 2.2,
              gravity: -2.0,
              hdrBoost: 2.0,
            });
          } else if (ev.spellId === 'meteor_paw') {
            // Cercle de verrouillage stellaire immédiat sur la cible du curseur
            this.spawnExpandingRing(px, pz, '#ffd85c', 0.5, ev.radius ?? 4.8, 0.55, 2.0);
            this.spawnBurst(px, 0.5, pz, 16, '#ffcf5c', 3.6, {
              size: 0.42,
              duration: 0.52,
              star: true,
              upward: 3.8,
              gravity: -1.0,
              hdrBoost: 2.1,
            });
          }
          break;
        }
        case 'dodge_roll': {
          this.spawnBurst(px, 0.25, pz, 8, '#fff2d6', 2.2, {
            size: 0.42,
            duration: 0.35,
            upward: 1.2,
            gravity: -2.4,
            hdrBoost: 1.15,
          });
          break;
        }
        case 'level_up': {
          this.spawnLevelUpBeam(state.player.x, state.player.z);
          break;
        }
        case 'chest_opening_start': {
          this.spawnExpandingRing(px, pz, GOLD_LIGHT, 0.25, 1.75, 0.55, 1.5);
          this.spawnBurst(px, 0.55, pz, 10, '#ffe89c', 2.2, {
            size: 0.34,
            duration: 0.65,
            star: true,
            upward: 3.1,
            gravity: -1.5,
            hdrBoost: 1.85,
          });
          break;
        }
        case 'chest_opened':
        case 'item_upgraded': {
          this.spawnExpandingRing(px, pz, GOLD_LIGHT, 0.4, 2.9, 0.58, 1.75);
          this.spawnBurst(px, 0.9, pz, 20, GOLD_LIGHT, 4.0, {
            size: 0.5,
            duration: 0.78,
            star: true,
            upward: 5.4,
            gravity: -5.8,
            hdrBoost: 2.0,
          });
          break;
        }
        case 'portal_enter':
        case 'portal_exit': {
          const portalColor = ev.zoneId === 'dungeon_dragon_lair' ? '#ff8833' : '#62e8ff';
          this.spawnExpandingRing(px, pz, portalColor, 0.35, 2.8, 0.45, 1.9);
          this.spawnStarSpiral(px, pz, 14, portalColor, GOLD_LIGHT, false, 1.1);
          break;
        }
        case 'portal_vortex': {
          const isDragon = ev.zoneId === 'dungeon_dragon_lair';
          const vortexColor = isDragon ? '#ff8833' : '#62e8ff';
          this.spawnFlipbook({
            vfxId: 'abyssal_vortex',
            x: px,
            y: 1.05,
            z: pz,
            scale: 3.1,
            endScale: 4.5,
            duration: 1.05,
            color: vortexColor,
            opacity: 0.92,
          });
          this.spawnExpandingRing(px, pz, vortexColor, 0.45, 3.8, 0.85, 2.1);
          this.spawnStarSpiral(px, pz, 18, vortexColor, GOLD_LIGHT, false, 1.25);
          break;
        }
        case 'companion_chime': {
          const chimeColor = ev.companionTargetKind === 'chest' ? '#ffd966' : '#7aeaff';
          this.spawnExpandingRing(px, pz, chimeColor, 0.25, 1.8, 0.55, 1.65);
          this.spawnBurst(px, 1.75, pz, 8, chimeColor, 2.2, {
            size: 0.32,
            duration: 0.55,
            star: true,
            upward: 1.8,
            gravity: -1.0,
            hdrBoost: 1.9,
          });
          break;
        }
        case 'decor_hit': {
          const mat = ev.decorMaterial ?? 'foliage';
          const col =
            mat === 'crystal'
              ? '#4ef5a8'
              : mat === 'stone'
                ? '#a7bac9'
                : mat === 'wood'
                  ? '#b87d44'
                  : '#62c25e';
          this.spawnBurst(px, 0.72, pz, mat === 'crystal' ? 10 : 7, col, 3.2, {
            size: mat === 'crystal' ? 0.34 : 0.28,
            duration: 0.45,
            star: mat === 'crystal',
            upward: 2.5,
            gravity: -8.5,
            hdrBoost: mat === 'crystal' ? 1.9 : 1.2,
          });
          break;
        }
        case 'shore_splash': {
          this.spawnExpandingRing(px, pz, '#9eeeff', 0.16, 0.95, 0.4, 1.35);
          this.spawnBurst(px, 0.18, pz, 7, '#d6f8ff', 2.4, {
            size: 0.24,
            duration: 0.34,
            upward: 2.3,
            gravity: -10.0,
            hdrBoost: 1.35,
          });
          break;
        }
        case 'footstep': {
          if (ev.terrain === 'sand' || ev.terrain === 'snow_ice') {
            this.spawnFootprint(
              px,
              pz,
              state.player.aimAngle,
              ev.terrain === 'snow_ice' ? '#92bddb' : '#a88450',
              ev.terrain === 'snow_ice' ? 0.52 : 0.44,
            );
          }
          break;
        }
        case 'hero_death_start': {
          this.spawnExpandingRing(px, pz, '#88d8ff', 0.4, 3.2, 0.85, 1.8);
          this.spawnStarSpiral(px, pz, 18, '#a6ecff', GOLD_LIGHT, true, 1.0);
          break;
        }
        case 'boss_phase_two': {
          this.spawnExpandingRing(px, pz, VFX_COLORS.bossPhase2, 0.8, 11.0, 0.78, 2.0);
          this.spawnBurst(px, 1.4, pz, 32, '#ff542b', 7.8, {
            size: 0.68,
            duration: 0.85,
            star: true,
            upward: 5.2,
            gravity: -3.8,
            hdrBoost: 2.2,
          });
          break;
        }
        case 'telegraph_impact': {
          const rad = Math.min(7.5, ev.radius ?? 2.4);
          const pat = ev.patternId ?? '';
          const owner = ev.enemyTypeId;

          if (owner === 'boss_dragon_claw' || pat.startsWith('dragon_')) {
            // VFX thématiques Dragon de Feu : souffles enflammés, piqué de lave, pluie de météores
            this.spawnExpandingRing(px, pz, '#ff5b1f', 0.4, rad * 1.05, 0.42, 2.1);
            if (pat.includes('breath') || pat.includes('cone') || pat.includes('flame')) {
              const ang = ev.angle ?? 0;
              for (let k = 1; k <= 6; k++) {
                const dist = (k / 6) * rad;
                this.spawnBurst(
                  px + Math.cos(ang) * dist,
                  0.65,
                  pz + Math.sin(ang) * dist,
                  5,
                  k % 2 === 0 ? '#ff9d2b' : '#ff3d14',
                  4.8,
                  {
                    size: 0.56,
                    duration: 0.48,
                    star: k % 2 === 0,
                    upward: 2.8,
                    gravity: -1.8,
                    hdrBoost: 2.2,
                  },
                );
              }
            } else if (pat.includes('swoop') || pat.includes('seismic') || pat.includes('ring')) {
              this.spawnFlipbook({ vfxId: 'steam_puff', x: px, y: 1.0, z: pz, scale: 2.2, endScale: 3.4, duration: 0.72, vy: 1.1, color: '#ffd9b3', opacity: 0.6 });
              this.spawnExpandingRing(px, pz, '#ffd24c', 0.6, rad * 1.15, 0.52, 2.2);
              this.spawnBurst(px, 0.5, pz, 22, '#ff6822', 6.4, {
                size: 0.58,
                duration: 0.56,
                star: true,
                upward: 4.5,
                gravity: -4.2,
                hdrBoost: 2.2,
              });
              this.spawnBurst(px, 0.8, pz, 8, '#38221a', 3.0, {
                size: 1.0,
                endSize: 2.2,
                duration: 0.75,
                upward: 2.4,
                gravity: 0.2,
                smoke: true,
                opacity: 0.4,
              });
            } else {
              // Pluie de magma / météore draconique : cratère + flammes CC0
              this.spawnFlipbook({ vfxId: 'fireball', x: px, y: 1.0, z: pz, scale: 3.2, endScale: 4.4, duration: 0.72, color: '#ff6a22' });
              this.spawnFlipbook({ vfxId: 'spark_ember', x: px, y: 1.1, z: pz, scale: 1.05, endScale: 1.6, duration: 0.58, vy: 2.4, color: '#ffb84d' });
              this.spawnDecal({ decalId: 'crater_fissure_decal', x: px, z: pz, scale: rad * 1.45, duration: 4.5, color: '#ff5e1a', opacity: 0.85 });
              this.spawnBurst(px, 0.55, pz, 18, '#ff7828', 5.2, {
                size: 0.52,
                duration: 0.5,
                star: true,
                upward: 4.2,
                gravity: -4.8,
                hdrBoost: 2.1,
              });
            }
          } else if (owner === 'boss_rat_king' || pat.startsWith('rat_')) {
            if (pat.includes('cheese')) {
              // Meules de fromage dorées roulantes + éclats de croûte !
              const ang = ev.angle ?? 0;
              this.spawnExpandingRing(px, pz, '#ffd84d', 0.3, Math.min(4.2, rad), 0.36, 1.9);
              for (let k = 1; k <= 5; k++) {
                const dist = (k / 5) * Math.min(8.5, rad);
                this.spawnBurst(
                  px + Math.cos(ang) * dist,
                  0.55,
                  pz + Math.sin(ang) * dist,
                  4,
                  k % 2 === 0 ? '#ffe066' : '#f29f24',
                  3.8,
                  {
                    size: 0.46,
                    duration: 0.44,
                    upward: 2.6,
                    gravity: -7.5,
                    hdrBoost: 1.75,
                  },
                );
              }
            } else {
              // Débris d'égouts & nuage de miasmes vert-violet toxique !
              this.spawnFlipbook({
                vfxId: ev.element === 'spectral' ? 'spectral_cloud' : 'slime_splatter',
                x: px,
                y: 0.8,
                z: pz,
                scale: 2.4,
                endScale: 3.3,
                duration: 0.65,
                color: ev.element === 'spectral' ? '#a855f7' : '#7bf054',
              });
              this.spawnExpandingRing(px, pz, '#74e84c', 0.35, rad * 1.02, 0.44, 1.9);
              this.spawnBurst(px, 0.5, pz, 16, '#7bf054', 4.4, {
                size: 0.46,
                duration: 0.54,
                upward: 3.1,
                gravity: -4.2,
                hdrBoost: 1.8,
              });
              this.spawnBurst(px, 0.7, pz, 10, '#6a488f', 2.8, {
                size: 0.92,
                endSize: 2.1,
                duration: 0.78,
                upward: 1.8,
                gravity: 0.25,
                smoke: true,
                opacity: 0.42,
              });
            }
          } else {
            if (ev.element === 'frost' || pat.includes('frost') || pat.includes('ice') || pat.includes('spikes')) {
              this.spawnFlipbook({ vfxId: 'ice_shards', x: px, y: 0.85, z: pz, scale: 2.3, endScale: 3.1, duration: 0.58, color: '#9ee8ff' });
              this.spawnFlipbook({ vfxId: 'ice_crystal', x: px, y: 0.9, z: pz, scale: 1.45, endScale: 2.1, duration: 0.48, vy: 1.4, color: '#a8f0ff' });
              this.spawnFlipbook({ vfxId: 'steam_puff', x: px, y: 0.6, z: pz, scale: 1.7, endScale: 2.6, duration: 0.62, vy: 0.9, color: '#dff8ff', opacity: 0.52 });
            } else if (pat.includes('slime') || pat.includes('yarn')) {
              this.spawnFlipbook({ vfxId: 'slime_splatter', x: px, y: 0.75, z: pz, scale: 2.1, endScale: 2.8, duration: 0.5, color: ev.color ?? '#ff70a6' });
              this.spawnFlipbook({ vfxId: 'steam_puff', x: px, y: 0.55, z: pz, scale: 1.5, endScale: 2.2, duration: 0.55, vy: 0.8, color: ev.color ?? '#ffc2d9', opacity: 0.48 });
            } else if (ev.element === 'poison') {
              this.spawnFlipbook({ vfxId: 'slime_splatter', x: px, y: 0.8, z: pz, scale: 1.9, endScale: 2.5, duration: 0.5, color: '#4ade80' });
            } else {
              this.spawnFlipbook({ vfxId: 'sparks', x: px, y: 0.8, z: pz, scale: 2.0, endScale: 2.7, duration: 0.45, color: ev.color ?? '#ff7340' });
            }
            const palette = resolveTelegraphPalette(ev.element ?? ev.color);
            this.spawnExpandingRing(
              px,
              pz,
              palette.brightColor,
              0.35,
              Math.min(5.8, rad),
              0.34,
              1.8,
            );
            this.spawnBurst(px, 0.4, pz, 10, palette.color, 3.6, {
              size: 0.4,
              duration: 0.36,
              hdrBoost: 1.85,
            });
          }
          break;
        }
        case 'heal_tick':
        case 'player_rested': {
          this.spawnStarSpiral(
            state.player.x,
            state.player.z,
            10,
            VFX_COLORS.heal,
            GOLD_LIGHT,
            true,
            1.05,
          );
          break;
        }
        default:
          break;
      }
    }
  }

  private updateDodgeGhosts(state: GameState): void {
    const ghosts = state.dodgeGhosts;
    const rollTex = this.textures.getHeroTexture(state.player.equipped, 'roll');

    for (let i = 0; i < this.ghostPool.length; i++) {
      const slot = this.ghostPool[i];
      const g = ghosts[i];
      if (!g || g.age >= g.duration) {
        slot.tiltGroup.visible = false;
        continue;
      }
      slot.tiltGroup.visible = true;
      slot.tiltGroup.position.set(g.x, 0.12, g.z);
      slot.mesh.rotation.y = 0;
      slot.mesh.scale.set(2.3 * (g.facingX < 0 ? -1 : 1), 2.4, 1);
      if (slot.material.map !== rollTex) {
        slot.material.map = rollTex;
        slot.material.needsUpdate = true;
      }
      const alpha = Math.max(0, 1 - g.age / Math.max(0.05, g.duration));
      slot.material.opacity = alpha * 0.54;
    }
  }

  private updateQuestArrow(state: GameState): void {
    const target = state.questTarget;
    if (
      state.screen !== 'playing' ||
      state.dialogue.active ||
      !target ||
      target.zoneId !== state.zoneId
    ) {
      this.questArrowGroup.visible = false;
      return;
    }

    const isOnBoat = state.zoneId === 'overworld' && state.ship.mode !== 'parked';
    const originX = isOnBoat ? state.ship.position.x : state.player.x;
    const originZ = isOnBoat ? state.ship.position.z : state.player.z;

    const dx = target.x - originX;
    const dz = target.z - originZ;
    const dist = Math.hypot(dx, dz);
    if (dist < (isOnBoat ? 5.2 : 3.6)) {
      this.questArrowGroup.visible = false;
      return;
    }

    const angle = Math.atan2(dz, dx);
    const orbitRadius = (isOnBoat ? 3.55 : 1.85) + Math.sin(this.animTime * 5.2) * 0.12;
    const ax = originX + Math.cos(angle) * orbitRadius;
    const az = originZ + Math.sin(angle) * orbitRadius;

    this.questArrowGroup.visible = true;
    this.questArrowGroup.position.set(ax, isOnBoat ? 0.42 : QUEST_ARROW_Y, az);
    this.questArrowGroup.rotation.y = -angle;
    const pulse = 0.78 + Math.sin(this.animTime * 5.2) * 0.06;
    this.questArrowGroup.scale.set(pulse, 1, pulse);

    if (this.questArrowInnerMat.uniforms.uTime) {
      this.questArrowInnerMat.uniforms.uTime.value = this.animTime;
    }
    this.questArrowHaloMat.opacity = 0.16 + Math.sin(this.animTime * 5.2) * 0.06;
  }

  public update(state: GameState, dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    this.animTime += safeDt;

    this.updateTelegraphs(state.telegraphs, safeDt);
    this.updateSpellEffects(state.activeSpellEffects, state, safeDt);
    this.updateDodgeGhosts(state);
    this.updateQuestArrow(state);
    this.syncPlayerProjectiles(state, safeDt);
    this.syncEnemyProjectiles(state, safeDt);
    this.syncHazardZones(state, safeDt);
    this.syncEnemySweeps(state, safeDt);
    this.syncEntityStatuses(state, safeDt);
    this.syncLootDrops(state, safeDt);

    // Mise à jour des marques de brûlure runique (Éclair-miaou)
    for (let i = this.scorchMarks.length - 1; i >= 0; i--) {
      const m = this.scorchMarks[i];
      m.age += safeDt;
      if (m.age >= m.duration) {
        this.rootGroup.remove(m.mesh);
        m.geometry.dispose();
        m.material.dispose();
        this.scorchMarks.splice(i, 1);
        continue;
      }
      const fade = Math.max(0, 1 - m.age / m.duration);
      if (m.material.uniforms.uTime) m.material.uniforms.uTime.value = this.animTime;
      if (m.material.uniforms.uFade) m.material.uniforms.uFade.value = fade;
    }

    // Mise à jour des arcs de slash mêlée
    for (let i = this.slashes.length - 1; i >= 0; i--) {
      const s = this.slashes[i];
      s.age += safeDt;
      if (s.age >= s.duration) {
        this.rootGroup.remove(s.mesh);
        s.geometry.dispose();
        s.material.dispose();
        this.slashes.splice(i, 1);
        continue;
      }
      const t = s.age / s.duration;
      const curAngle = s.startAngle + (s.endAngle - s.startAngle) * t;
      s.mesh.rotation.y = s.isThrust ? -s.baseAngle : -curAngle;
      const scale = s.isThrust ? 0.78 + t * 0.35 : 0.88 + t * 0.3;
      s.mesh.scale.set(scale, 1, scale);
      if (s.material.uniforms.uProgress) {
        s.material.uniforms.uProgress.value = t;
      }
    }

    // Mise à jour du pool de flipbooks CC0
    for (let i = 0; i < this.flipbookPool.length; i++) {
      const f = this.flipbookPool[i];
      if (!f.active) continue;
      f.age += safeDt;
      if (f.age >= f.duration) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      const t = f.age / f.duration;
      const entry = VFX_ASSETS[f.vfxId];
      const frameIdx = getVfxFrameIndexAtTime(entry, f.age, f.loop);
      const uv = computeVfxFlipbookFrameUv(entry, frameIdx);
      f.material.uniforms.uUvRect.value.set(uv.repeatX, uv.repeatY, uv.offsetX, uv.offsetY);
      const sc = f.startScale + (f.endScale - f.startScale) * t;
      f.mesh.scale.set(sc, sc, 1);
      f.mesh.position.x += f.vx * safeDt;
      f.mesh.position.y += f.vy * safeDt;
      f.mesh.position.z += f.vz * safeDt;
      f.material.uniforms.uOpacity.value = (1 - t * t) * f.baseOpacity;
    }

    // Mise à jour du pool de décalques au sol
    for (let i = 0; i < this.decalPool.length; i++) {
      const d = this.decalPool[i];
      if (!d.active) continue;
      d.age += safeDt;
      if (d.age >= d.duration) {
        d.active = false;
        d.mesh.visible = false;
        continue;
      }
      const t = d.age / d.duration;
      d.material.opacity = d.baseOpacity * (t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.35) : 1);
    }

    // Mise à jour des empreintes éphémères sable/neige
    for (let i = 0; i < this.footprintPool.length; i++) {
      const fp = this.footprintPool[i];
      if (!fp.active) continue;
      fp.age += safeDt;
      if (fp.age >= fp.duration) {
        fp.active = false;
        fp.mesh.visible = false;
        continue;
      }
      const t = fp.age / fp.duration;
      fp.material.opacity = fp.baseOpacity * Math.max(0, 1 - t * t);
    }

    // Mise à jour du pool d'anneaux d'impact (zéro allocation / zéro dispose par frame)
    for (let i = 0; i < this.ringPool.length; i++) {
      const r = this.ringPool[i];
      if (!r.active) continue;
      r.age += safeDt;
      if (r.age >= r.duration) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const t = r.age / r.duration;
      const ease = 1 - (1 - t) * (1 - t);
      const sc = r.startScale + (r.endScale - r.startScale) * ease;
      r.mesh.scale.set(sc, 1, sc);
      r.material.opacity = (1 - t) * 0.9;
    }

    // Mise à jour des colonnes divines dorées de Level-Up
    for (let i = this.levelBeams.length - 1; i >= 0; i--) {
      const b = this.levelBeams[i];
      b.age += safeDt;
      if (b.age >= b.duration) {
        this.rootGroup.remove(b.group);
        b.beamMat.dispose();
        b.ringMat.dispose();
        this.levelBeams.splice(i, 1);
        continue;
      }
      const t = b.age / b.duration;
      b.group.position.set(state.player.x, 0, state.player.z);

      if (b.beamMat.uniforms.uTime) b.beamMat.uniforms.uTime.value = this.animTime;
      if (b.beamMat.uniforms.uProgress) b.beamMat.uniforms.uProgress.value = t;
      if (b.ringMat.uniforms.uTime) b.ringMat.uniforms.uTime.value = this.animTime;
      if (b.ringMat.uniforms.uProgress) b.ringMat.uniforms.uProgress.value = t;

      const beamScale = 1.0 + Math.sin(t * Math.PI) * 0.25;
      b.beamMesh.scale.set(beamScale, 1 + t * 0.35, beamScale);
      const ringScale = 1.1 + t * 3.8;
      b.ringMesh.scale.set(ringScale, 1, ringScale);
    }

    // Mise à jour du pool de particules pré-alloué (ballistiques, fumée & spirales)
    for (let i = 0; i < this.particlePool.length; i++) {
      const p = this.particlePool[i];
      if (!p.active) continue;
      p.age += safeDt;
      if (p.age >= p.duration) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      const t = p.age / p.duration;
      p.vy += p.gravity * safeDt;

      if (p.hasSpiral) {
        p.spiral.angle += p.spiral.angularSpeed * safeDt;
        p.spiral.radius = Math.max(0.25, p.spiral.radius + p.spiral.radiusSpeed * safeDt);
        const cx = p.spiral.followPlayer ? state.player.x : p.spiral.cx;
        const cz = p.spiral.followPlayer ? state.player.z : p.spiral.cz;
        p.sprite.position.x = cx + Math.cos(p.spiral.angle) * p.spiral.radius;
        p.sprite.position.z = cz + Math.sin(p.spiral.angle) * p.spiral.radius;
        p.sprite.position.y = Math.max(0.1, p.sprite.position.y + p.vy * safeDt);
      } else {
        p.sprite.position.x += p.vx * safeDt;
        p.sprite.position.y = Math.max(0.08, p.sprite.position.y + p.vy * safeDt);
        p.sprite.position.z += p.vz * safeDt;
      }

      const size = p.startSize + (p.endSize - p.startSize) * t;
      p.sprite.scale.set(size, size, 1);
      if (p.isSmoke) {
        p.material.opacity = Math.sin(t * Math.PI) * p.baseOpacity;
      } else {
        p.material.opacity = (1 - t * t) * p.baseOpacity;
      }
    }
  }

  /**
   * Supprime tous les effets transitoires (ex. changement de zone).
   */
  public clear(): void {
    for (const vis of this.telegraphs.values()) {
      this.disposeTelegraphVisual(vis);
    }
    this.telegraphs.clear();

    for (const vis of this.spellEffects.values()) {
      this.disposeSpellVisual(vis);
    }
    this.spellEffects.clear();

    for (const m of this.scorchMarks) {
      this.rootGroup.remove(m.mesh);
      m.geometry.dispose();
      m.material.dispose();
    }
    this.scorchMarks.length = 0;

    for (const s of this.slashes) {
      this.rootGroup.remove(s.mesh);
      s.geometry.dispose();
      s.material.dispose();
    }
    this.slashes.length = 0;

    for (let i = 0; i < this.ringPool.length; i++) {
      this.ringPool[i].active = false;
      this.ringPool[i].mesh.visible = false;
    }

    for (const b of this.levelBeams) {
      this.rootGroup.remove(b.group);
      b.beamMat.dispose();
      b.ringMat.dispose();
    }
    this.levelBeams.length = 0;

    for (let i = 0; i < this.particlePool.length; i++) {
      this.particlePool[i].active = false;
      this.particlePool[i].sprite.visible = false;
    }

    for (const slot of this.ghostPool) {
      slot.tiltGroup.visible = false;
    }

    for (const slot of this.flipbookPool) {
      slot.active = false;
      slot.mesh.visible = false;
    }

    for (const slot of this.decalPool) {
      slot.active = false;
      slot.mesh.visible = false;
    }

    for (const slot of this.footprintPool) {
      slot.active = false;
      slot.mesh.visible = false;
    }

    for (const vis of this.playerProjectiles.values()) {
      this.rootGroup.remove(vis.group);
      vis.material.dispose();
      vis.trailMat.dispose();
    }
    this.playerProjectiles.clear();

    for (const vis of this.enemyProjectiles.values()) {
      this.rootGroup.remove(vis.group);
      vis.material.dispose();
      vis.trailMat.dispose();
    }
    this.enemyProjectiles.clear();

    for (const vis of this.hazardZones.values()) {
      this.rootGroup.remove(vis.group);
      for (const d of vis.disposables) d.dispose();
    }
    this.hazardZones.clear();

    for (const vis of this.enemySweeps.values()) {
      this.rootGroup.remove(vis.group);
      vis.coneMesh.geometry.dispose();
      vis.coneMat.dispose();
    }
    this.enemySweeps.clear();

    for (const vis of this.lootDrops.values()) {
      this.rootGroup.remove(vis.mesh);
      vis.material.dispose();
    }
    this.lootDrops.clear();
  }

  private syncPlayerProjectiles(state: GameState, dt: number): void {
    this.activeProjectileIds.clear();
    const trailTex = this.textures.getVfxTexture('projectile_trail');
    for (const p of state.playerProjectiles) {
      this.activeProjectileIds.add(p.id);
      let vis = this.playerProjectiles.get(p.id);
      if (!vis) {
        const group = new THREE.Group();
        group.userData.skipSSAO = true;
        const isStaff = p.weaponFamily === 'staff';
        const geo = isStaff ? this.projOrbGeo : this.projBoltGeo;
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(p.color).multiplyScalar(1.45),
        });
        const mesh = new THREE.Mesh(geo, material);
        mesh.renderOrder = 6;
        mesh.userData.skipSSAO = true;
        group.add(mesh);

        const trailMat = createProjectileTrailMaterial({
          texture: trailTex,
          primaryColor: p.color,
          edgeColor: p.accentColor,
        });
        const trailMesh = new THREE.Mesh(this.trailQuadGeo, trailMat);
        trailMesh.renderOrder = 5;
        trailMesh.userData.skipSSAO = true;
        group.add(trailMesh);

        this.rootGroup.add(group);
        vis = { group, mesh, material, trailMesh, trailMat, trailAccum: 0 };
        this.playerProjectiles.set(p.id, vis);
      }
      vis.group.position.set(p.x, 0.92, p.z);
      vis.group.rotation.y = -Math.atan2(p.vz, p.vx);
      if (vis.trailMat.uniforms.uTime) {
        vis.trailMat.uniforms.uTime.value = this.animTime;
      }
      vis.trailAccum += dt;
      if (vis.trailAccum >= 0.035) {
        vis.trailAccum = 0;
        this.spawnParticle({
          x: p.x,
          y: 0.92,
          z: p.z,
          vx: -p.vx * 0.08,
          vy: 0.25,
          vz: -p.vz * 0.08,
          color: p.accentColor,
          size: 0.28,
          endSize: 0.04,
          duration: 0.22,
          gravity: 0,
          star: true,
          hdrBoost: 1.7,
        });
      }
    }
    for (const [id, vis] of this.playerProjectiles.entries()) {
      if (!this.activeProjectileIds.has(id)) {
        this.rootGroup.remove(vis.group);
        vis.material.dispose();
        vis.trailMat.dispose();
        this.playerProjectiles.delete(id);
      }
    }
  }

  private syncEnemyProjectiles(state: GameState, dt: number): void {
    this.activeEnemyProjectileIds.clear();
    const trailTex = this.textures.getVfxTexture('projectile_trail');
    for (const ep of state.enemyProjectiles) {
      this.activeEnemyProjectileIds.add(ep.id);
      let vis = this.enemyProjectiles.get(ep.id);
      if (!vis) {
        const group = new THREE.Group();
        group.userData.skipSSAO = true;
        const geo =
          ep.kind === 'cheese_wheel'
            ? this.cheeseWheelGeo
            : ep.kind === 'spectral_scythe'
              ? this.scytheArcGeo
              : ep.kind === 'spectral_orb' || ep.kind === 'ember_bolt'
                ? this.projOrbGeo
                : this.projBoltGeo;
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(ep.color).multiplyScalar(1.35),
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, material);
        if (ep.kind === 'fishbone') {
          mesh.scale.set(1.45, 1.2, 1.45);
        } else if (ep.kind === 'spectral_scythe') {
          mesh.scale.set(ep.radius * 1.1, 1, ep.radius * 1.1);
        } else if (ep.kind === 'cheese_wheel') {
          const s = Math.max(0.7, ep.radius / 0.62);
          mesh.scale.set(s, s, s);
        } else if (ep.kind === 'spectral_orb') {
          mesh.scale.setScalar(1.35);
        }
        mesh.renderOrder = 6;
        mesh.userData.skipSSAO = true;
        group.add(mesh);

        const trailMat = createProjectileTrailMaterial({
          texture: trailTex,
          primaryColor: ep.color,
          edgeColor: ep.accentColor,
        });
        const trailMesh = new THREE.Mesh(this.trailQuadGeo, trailMat);
        trailMesh.scale.set(ep.kind === 'cheese_wheel' ? 1.4 : 1.15, 1, ep.radius * 1.4);
        trailMesh.renderOrder = 5;
        trailMesh.userData.skipSSAO = true;
        group.add(trailMesh);

        this.rootGroup.add(group);
        vis = { group, mesh, material, trailMesh, trailMat, trailAccum: 0 };
        this.enemyProjectiles.set(ep.id, vis);
      }

      const yHeight = ep.kind === 'cheese_wheel' ? 0.52 : 0.9;
      vis.group.position.set(ep.x, yHeight, ep.z);
      vis.group.rotation.y = -Math.atan2(ep.vz, ep.vx);
      if (ep.kind === 'fishbone' || ep.kind === 'spectral_scythe') {
        vis.mesh.rotation.y = ep.spinAngle ?? this.animTime * 14;
      } else if (ep.kind === 'cheese_wheel') {
        vis.mesh.rotation.x = -(ep.spinAngle ?? this.animTime * 10);
      }
      if (vis.trailMat.uniforms.uTime) {
        vis.trailMat.uniforms.uTime.value = this.animTime;
      }

      vis.trailAccum += dt;
      if (vis.trailAccum >= 0.065) {
        vis.trailAccum = 0;
        if (ep.kind === 'spectral_orb') {
          this.spawnFlipbook({ vfxId: 'spectral_cloud', x: ep.x, y: 0.85, z: ep.z, scale: 0.9, endScale: 1.3, duration: 0.35, color: ep.color, opacity: 0.72 });
        } else {
          this.spawnParticle({
            x: ep.x,
            y: yHeight,
            z: ep.z,
            vx: -ep.vx * 0.1,
            vy: 0.5,
            vz: -ep.vz * 0.1,
            color: ep.accentColor,
            size: ep.kind === 'cheese_wheel' ? 0.32 : 0.24,
            endSize: 0.04,
            duration: 0.24,
            gravity: ep.kind === 'cheese_wheel' ? -6.5 : 0,
            star: ep.kind !== 'cheese_wheel',
            hdrBoost: 1.6,
          });
        }
      }
    }

    for (const [id, vis] of this.enemyProjectiles.entries()) {
      if (!this.activeEnemyProjectileIds.has(id)) {
        this.rootGroup.remove(vis.group);
        vis.material.dispose();
        vis.trailMat.dispose();
        this.enemyProjectiles.delete(id);
      }
    }
  }

  private syncHazardZones(state: GameState, dt: number): void {
    this.activeHazardIds.clear();
    for (const hz of state.hazardZones) {
      this.activeHazardIds.add(hz.id);
      let vis = this.hazardZones.get(hz.id);
      if (!vis) {
        const group = new THREE.Group();
        group.position.set(hz.x, TELEGRAPH_Y - 0.01, hz.z);
        if (hz.angle !== undefined) {
          group.rotation.y = -hz.angle;
        }
        group.userData.skipSSAO = true;
        const disposables: Array<{ dispose(): void }> = [];

        const isLine = hz.length !== undefined && hz.width !== undefined;
        let geo: THREE.BufferGeometry;
        if (isLine) {
          geo = new THREE.PlaneGeometry(hz.length!, hz.width!);
          geo.rotateX(-Math.PI / 2);
          geo.translate(hz.length! * 0.5, 0, 0);
          disposables.push(geo);
        } else {
          geo = this.unitPlaneGeo;
        }

        const decalId: VfxAssetId =
          hz.kind === 'slime_puddle' || hz.kind === 'toxic_miasma'
            ? 'slime_decal'
            : hz.kind === 'abyssal_fissure'
              ? 'crater_fissure_decal'
              : 'scorch_decal';

        const material = new THREE.MeshBasicMaterial({
          map: this.textures.getVfxTexture(decalId),
          color: new THREE.Color(hz.color),
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
          side: THREE.DoubleSide,
        });
        disposables.push(material);

        const mesh = new THREE.Mesh(geo, material);
        if (!isLine) {
          mesh.rotation.x = -Math.PI / 2;
          mesh.scale.set(hz.radius * 2.1, hz.radius * 2.1, 1);
        }
        mesh.renderOrder = 1;
        mesh.userData.skipSSAO = true;
        group.add(mesh);

        const ringMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(hz.color).multiplyScalar(1.35),
          transparent: true,
          opacity: 0.45,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        disposables.push(ringMat);
        const ringMesh = new THREE.Mesh(this.unitRingGeo, ringMat);
        if (!isLine) {
          ringMesh.scale.set(hz.radius, 1, hz.radius);
        } else {
          ringMesh.visible = false;
        }
        ringMesh.position.y = 0.005;
        ringMesh.renderOrder = 2;
        ringMesh.userData.skipSSAO = true;
        group.add(ringMesh);

        this.rootGroup.add(group);
        vis = { id: hz.id, kind: hz.kind, group, mesh, material, ringMesh, ringMat, disposables, emitAccum: 0 };
        this.hazardZones.set(hz.id, vis);
      }

      const lifeRatio = Math.max(0, 1 - hz.elapsed / Math.max(0.1, hz.duration));
      const fade = lifeRatio < 0.25 ? lifeRatio / 0.25 : 1;
      vis.material.opacity = 0.78 * fade;
      if (vis.ringMat) {
        vis.ringMat.opacity = (0.35 + Math.sin(this.animTime * 6) * 0.12) * fade;
      }

      vis.emitAccum += dt;
      if (vis.emitAccum >= 0.32 && lifeRatio > 0.15) {
        vis.emitAccum = 0;
        const ox = hz.length ? hz.x + Math.cos(hz.angle ?? 0) * (Math.random() * hz.length) : hz.x + (Math.random() - 0.5) * hz.radius;
        const oz = hz.length ? hz.z + Math.sin(hz.angle ?? 0) * (Math.random() * hz.length) : hz.z + (Math.random() - 0.5) * hz.radius;
        if (hz.kind === 'scorch_crater') {
          this.spawnFlipbook({ vfxId: 'flames', x: ox, y: 0.45, z: oz, scale: 1.1, endScale: 1.5, duration: 0.48, color: '#ff7722', opacity: 0.78 });
        } else if (hz.kind === 'toxic_miasma') {
          this.spawnFlipbook({ vfxId: 'spectral_cloud', x: ox, y: 0.45, z: oz, scale: 1.3, endScale: 1.8, duration: 0.65, color: hz.color, opacity: 0.62 });
        } else if (hz.kind === 'abyssal_fissure') {
          this.spawnFlipbook({ vfxId: 'abyssal_vortex', x: ox, y: 0.15, z: oz, scale: 1.4, endScale: 1.8, duration: 0.6, color: '#a855f7', flatOnGround: true });
        } else if (hz.kind === 'frost_patch') {
          this.spawnFlipbook({ vfxId: 'ice_crystal', x: ox, y: 0.35, z: oz, scale: 0.9, endScale: 1.25, duration: 0.45, vy: 0.6, color: '#9ee8ff' });
          this.spawnParticle({ x: ox, y: 0.2, z: oz, vx: 0, vy: 1.2, vz: 0, color: '#9ee8ff', size: 0.28, endSize: 0.05, duration: 0.45, gravity: -0.5, star: true, hdrBoost: 1.7 });
        } else {
          this.spawnParticle({ x: ox, y: 0.18, z: oz, vx: 0, vy: 1.1, vz: 0, color: hz.color, size: 0.24, endSize: 0.06, duration: 0.4, gravity: -2.0, hdrBoost: 1.35 });
        }
      }
    }

    for (const [id, vis] of this.hazardZones.entries()) {
      if (!this.activeHazardIds.has(id)) {
        this.rootGroup.remove(vis.group);
        for (const d of vis.disposables) d.dispose();
        this.hazardZones.delete(id);
      }
    }
  }

  private syncEnemySweeps(state: GameState, dt: number): void {
    this.activeSweepEnemyIds.clear();
    const heatNorm = this.textures.getVfxTexture('heat_distortion_normal');

    for (const enemy of state.enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0 || !(enemy.activeSweepDuration && enemy.activeSweepDuration > 0)) {
        continue;
      }
      this.activeSweepEnemyIds.add(enemy.id);
      let vis = this.enemySweeps.get(enemy.id);
      if (!vis) {
        const group = new THREE.Group();
        group.userData.skipSSAO = true;
        const coneGeo = new THREE.CylinderGeometry(1.4, 0.45, 9.2, 20, 4, true);
        coneGeo.rotateZ(-Math.PI / 2);
        coneGeo.translate(4.6, 0, 0);
        const coneMat = createHeatDistortionMaterial(heatNorm, 0xff6b1a);
        const coneMesh = new THREE.Mesh(coneGeo, coneMat);
        coneMesh.renderOrder = 6;
        coneMesh.userData.skipSSAO = true;
        group.add(coneMesh);
        this.rootGroup.add(group);
        vis = { group, coneMesh, coneMat, emitAccum: 0 };
        this.enemySweeps.set(enemy.id, vis);
      }

      const t = Math.max(0, Math.min(1, (enemy.activeSweepElapsed ?? 0) / Math.max(0.05, enemy.activeSweepDuration)));
      const startA = enemy.activeSweepStartAngle ?? 0;
      const endA = enemy.activeSweepEndAngle ?? 0;
      const curAngle = startA + (endA - startA) * t;
      vis.group.position.set(enemy.x, 0.95, enemy.z);
      vis.group.rotation.y = -curAngle;
      if (vis.coneMat.uniforms.uTime) vis.coneMat.uniforms.uTime.value = this.animTime;
      if (vis.coneMat.uniforms.uIntensity) vis.coneMat.uniforms.uIntensity.value = 0.85;

      vis.emitAccum += dt;
      if (vis.emitAccum >= 0.06) {
        vis.emitAccum = 0;
        const d = 2.2 + Math.random() * 6.4;
        const fx = enemy.x + Math.cos(curAngle) * d;
        const fz = enemy.z + Math.sin(curAngle) * d;
        this.spawnFlipbook({ vfxId: 'flames', x: fx, y: 0.95, z: fz, scale: 1.8, endScale: 2.5, duration: 0.38, color: '#ff7b24' });
      }
    }

    for (const [id, vis] of this.enemySweeps.entries()) {
      if (!this.activeSweepEnemyIds.has(id)) {
        this.rootGroup.remove(vis.group);
        vis.coneMesh.geometry.dispose();
        vis.coneMat.dispose();
        this.enemySweeps.delete(id);
      }
    }
  }

  private emitStatusVfx(x: number, z: number, statusId: StatusEffectId, scale = 1.0): void {
    const ox = x + (Math.random() - 0.5) * 0.7 * scale;
    const oz = z + (Math.random() - 0.5) * 0.7 * scale;
    switch (statusId) {
      case 'burn':
        this.spawnFlipbook({ vfxId: 'flames', x: ox, y: 0.85, z: oz, scale: 0.85 * scale, endScale: 1.25 * scale, duration: 0.36, color: '#ff6b22', vy: 0.9, opacity: 0.85 });
        break;
      case 'chill':
        this.spawnParticle({ x: ox, y: 0.7, z: oz, vx: (Math.random() - 0.5) * 0.6, vy: 0.8, vz: (Math.random() - 0.5) * 0.6, color: '#75ebff', size: 0.28 * scale, endSize: 0.05, duration: 0.42, gravity: -0.3, star: true, hdrBoost: 1.65 });
        break;
      case 'poison':
        this.spawnFlipbook({ vfxId: 'slime_splatter', x: ox, y: 0.75, z: oz, scale: 0.7 * scale, endScale: 1.05 * scale, duration: 0.34, color: '#5ce645', vy: 0.5, opacity: 0.75 });
        break;
      case 'bleed':
        this.spawnParticle({ x: ox, y: 0.85, z: oz, vx: (Math.random() - 0.5) * 1.6, vy: 1.4, vz: (Math.random() - 0.5) * 1.6, color: '#e83850', size: 0.24 * scale, endSize: 0.05, duration: 0.34, gravity: -8.5, hdrBoost: 1.35 });
        break;
      case 'stun': {
        const a = this.animTime * 6 + Math.random() * 1.5;
        this.spawnParticle({ x: x + Math.cos(a) * 0.55 * scale, y: 1.65 * scale, z: z + Math.sin(a) * 0.35 * scale, vx: 0, vy: 0.2, vz: 0, color: '#ffe66d', size: 0.26, endSize: 0.08, duration: 0.26, gravity: 0, star: true, hdrBoost: 1.9 });
        break;
      }
      case 'shock':
        this.spawnFlipbook({ vfxId: 'electric_arc', x: ox, y: 0.9, z: oz, scale: 0.95 * scale, endScale: 1.2 * scale, duration: 0.2, color: '#fff37a', opacity: 0.9 });
        break;
      case 'curse':
        this.spawnFlipbook({ vfxId: 'spectral_cloud', x: ox, y: 0.8, z: oz, scale: 0.85 * scale, endScale: 1.2 * scale, duration: 0.45, color: '#a855f7', vy: 0.45, opacity: 0.7 });
        break;
    }
  }

  private syncEntityStatuses(state: GameState, dt: number): void {
    this.statusEmitAccum += dt;
    if (this.statusEmitAccum < 0.22) return;
    this.statusEmitAccum = 0;

    if (state.player.hp > 0 && state.player.activeStatuses) {
      for (const st of state.player.activeStatuses) {
        if (st.remainingSec > 0) {
          this.emitStatusVfx(state.player.x, state.player.z, st.id, 1.0);
        }
      }
    }

    for (const enemy of state.enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0 || !enemy.activeStatuses) continue;
      const scale = enemy.isBoss ? 1.5 : 1.0;
      for (const st of enemy.activeStatuses) {
        if (st.remainingSec > 0) {
          this.emitStatusVfx(enemy.x, enemy.z, st.id, scale);
        }
      }
    }
  }

  private syncLootDrops(state: GameState, dt: number): void {
    this.activeLootDropIds.clear();
    for (const d of state.lootDrops) {
      this.activeLootDropIds.add(d.id);
      let vis = this.lootDrops.get(d.id);
      if (!vis) {
        const isXp = d.kind === 'xp';
        const geo = isXp ? this.lootXpGeo : this.lootCoinGeo;
        const material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(isXp ? 0x5ce8ff : 0xffd84d).multiplyScalar(1.3),
        });
        const mesh = new THREE.Mesh(geo, material);
        mesh.renderOrder = 5;
        mesh.userData.skipSSAO = true;
        this.rootGroup.add(mesh);
        vis = { mesh, material, kind: d.kind };
        this.lootDrops.set(d.id, vis);
      }
      vis.mesh.position.set(d.x, d.y + 0.14, d.z);
      vis.mesh.rotation.y += dt * (vis.kind === 'xp' ? 4.2 : 5.5);
      if (vis.kind === 'gold') {
        vis.mesh.rotation.x = Math.PI * 0.35;
      }
    }
    for (const [id, vis] of this.lootDrops.entries()) {
      if (!this.activeLootDropIds.has(id)) {
        this.rootGroup.remove(vis.mesh);
        vis.material.dispose();
        this.lootDrops.delete(id);
      }
    }
  }

  public dispose(): void {
    this.clear();
    for (const slot of this.particlePool) {
      this.rootGroup.remove(slot.sprite);
      slot.material.dispose();
    }
    this.particlePool.length = 0;

    for (const slot of this.ringPool) {
      this.rootGroup.remove(slot.mesh);
      slot.material.dispose();
    }
    this.ringPool.length = 0;

    for (const slot of this.ghostPool) {
      this.rootGroup.remove(slot.tiltGroup);
      slot.material.dispose();
    }
    this.ghostPool.length = 0;

    for (const slot of this.flipbookPool) {
      this.rootGroup.remove(slot.mesh);
      slot.material.dispose();
    }
    this.flipbookPool.length = 0;

    for (const slot of this.decalPool) {
      this.rootGroup.remove(slot.mesh);
      slot.material.dispose();
    }
    this.decalPool.length = 0;

    for (const slot of this.footprintPool) {
      this.rootGroup.remove(slot.mesh);
      slot.material.dispose();
    }
    this.footprintPool.length = 0;
    this.footprintTex?.dispose();
    this.footprintTex = null;

    this.rootGroup.remove(this.questArrowGroup);
    for (const d of this.questArrowDisposables) {
      d.dispose();
    }

    this.scene.remove(this.rootGroup);
    this.unitRingGeo.dispose();
    this.unitDiskGeo.dispose();
    this.unitPlaneGeo.dispose();
    this.groundPlaneGeo.dispose();
    this.trailQuadGeo.dispose();
    this.beamCylinderGeo.dispose();
    this.heatHazeCylinderGeo.dispose();
    this.iceCrystalGeo.dispose();
    this.aegisDomeGeo.dispose();
    this.meteorOrbGeo.dispose();
    this.starTailGeo.dispose();
    this.projOrbGeo.dispose();
    this.projBoltGeo.dispose();
    this.cheeseWheelGeo.dispose();
    this.scytheArcGeo.dispose();
    this.lootCoinGeo.dispose();
    this.lootXpGeo.dispose();
    this.ghostGeo.dispose();
  }
}
