import * as THREE from 'three';
import type {
  ActiveSpellEffect,
  GameEvent,
  GameState,
  SpellId,
  TelegraphZone,
} from '../game/types';
import { ENEMIES } from '../data/enemiesData';
import { GOLD_LIGHT, GOLD_MID, VFX_COLORS } from '../art/palette';
import { TextureRegistry } from '../art/textureRegistry';
import {
  createTelegraphMaterial,
  updateTelegraphMaterial,
} from './shaders/telegraphShader';
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
const MAX_PARTICLES = 320;

interface TelegraphVisual {
  id: string;
  shape: TelegraphZone['shape'];
  group: THREE.Group;
  material: THREE.ShaderMaterial;
  disposables: Array<{ dispose(): void }>;
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
  // Spécifique Chute d'Étoiles
  meteorBlastMesh?: THREE.Mesh;
  meteorOrbMesh?: THREE.Mesh;
  meteorBeamMesh?: THREE.Mesh;
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
  material: THREE.MeshBasicMaterial;
  geometry: THREE.BufferGeometry;
  baseAngle: number;
  sweepDir: number;
  age: number;
  duration: number;
}

interface ExpandingRingVfx {
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

interface Particle {
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
  spiral?: SpiralMotion;
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
  private readonly scorchMarks: ScorchMarkVfx[] = [];
  private readonly slashes: SlashVisual[] = [];
  private readonly rings: ExpandingRingVfx[] = [];
  private readonly levelBeams: LevelUpBeamVfx[] = [];
  private readonly particles: Particle[] = [];

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
  private readonly beamCylinderGeo: THREE.CylinderGeometry;
  private readonly heatHazeCylinderGeo: THREE.CylinderGeometry;
  private readonly iceCrystalGeo: THREE.ConeGeometry;
  private readonly aegisDomeGeo: THREE.SphereGeometry;
  private readonly meteorOrbGeo: THREE.IcosahedronGeometry;

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

    // Orbe météore astral partagé pour Chute d'Étoiles
    this.meteorOrbGeo = new THREE.IcosahedronGeometry(0.75, 1);

    this.ghostGeo = new THREE.PlaneGeometry(1, 1);
    this.ghostGeo.translate(0, 0.5, 0);

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

    // Flèche dorée directionnelle lumineuse
    const arrow = buildQuestArrowMesh();
    this.questArrowGroup = arrow.group;
    this.questArrowInnerMat = arrow.innerMat;
    this.questArrowHaloMat = arrow.haloMat;
    this.questArrowDisposables = arrow.disposables;
    this.questArrowGroup.visible = false;
    this.rootGroup.add(this.questArrowGroup);
  }

  // ==========================================================================
  // 1. Télégraphes Rouges Ennemis en Hologramme Runique GLSL (ZÉRO z-fighting)
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

    const material = createTelegraphMaterial(t.shape, {
      radius: outerR,
      innerRadius: innerR,
      width,
      arcAngle: arc,
      color: t.color || VFX_COLORS.telegraphRed,
      brightColor: VFX_COLORS.telegraphBright,
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

    this.rootGroup.add(group);
    return {
      id: t.id,
      shape: t.shape,
      group,
      material,
      disposables: [geometry, material],
    };
  }

  private disposeTelegraphVisual(vis: TelegraphVisual): void {
    this.rootGroup.remove(vis.group);
    for (const d of vis.disposables) {
      d.dispose();
    }
  }

  private updateTelegraphs(telegraphs: TelegraphZone[]): void {
    const activeIds = new Set<string>();

    for (const t of telegraphs) {
      if (t.resolved) continue;
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

    // --- 7. CHUTE D'ÉTOILES : Météore plongeant + Onde de choc astrale AoE ---
    if (eff.spellId === 'meteor_paw') {
      const blastMat = createMeteorBlastMaterial();
      const meteorBlastMesh = new THREE.Mesh(this.unitDiskGeo, blastMat);
      meteorBlastMesh.scale.set(eff.radius, 1, eff.radius);
      meteorBlastMesh.renderOrder = 3;
      meteorBlastMesh.userData.skipSSAO = true;
      group.add(meteorBlastMesh);

      const orbMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(2.2, 1.35, 2.45),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const meteorOrbMesh = new THREE.Mesh(this.meteorOrbGeo, orbMat);
      meteorOrbMesh.position.set(-2.6, 11.5, -1.8);
      meteorOrbMesh.renderOrder = 6;
      meteorOrbMesh.userData.skipSSAO = true;
      group.add(meteorOrbMesh);

      const beamMat = createHealBeamMaterial(0xc95bff, 0xffbe4d);
      const meteorBeamMesh = new THREE.Mesh(this.beamCylinderGeo, beamMat);
      meteorBeamMesh.position.y = -0.04;
      meteorBeamMesh.scale.set(0.01, 0.01, 0.01);
      meteorBeamMesh.renderOrder = 5;
      meteorBeamMesh.userData.skipSSAO = true;
      group.add(meteorBeamMesh);

      disposables.push(blastMat, orbMat, beamMat);
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
        meteorOrbMesh,
        meteorBeamMesh,
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
    const activeIds = new Set<string>();

    for (const eff of effects) {
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
        const dropT = Math.min(1, t / 0.3);
        const postT = Math.max(0, (t - 0.28) / 0.72);
        if (vis.meteorOrbMesh) {
          if (t < 0.34) {
            vis.meteorOrbMesh.visible = true;
            const easeDrop = dropT * dropT;
            vis.meteorOrbMesh.position.set(
              -2.6 * (1 - easeDrop),
              11.5 * (1 - easeDrop) + 0.45,
              -1.8 * (1 - easeDrop),
            );
            const orbScale = 0.75 + easeDrop * 0.7;
            vis.meteorOrbMesh.scale.set(orbScale, orbScale, orbScale);
            vis.meteorOrbMesh.rotation.set(this.animTime * 6, this.animTime * 9, 0);
          } else {
            vis.meteorOrbMesh.visible = false;
          }
        }
        if (vis.meteorBeamMesh) {
          if (postT > 0.01) {
            const bW = vis.radius * (0.34 + (1 - postT) * 0.25);
            vis.meteorBeamMesh.scale.set(bW, 0.95 * (1 - postT * 0.45), bW);
          } else {
            vis.meteorBeamMesh.scale.set(0.01, 0.01, 0.01);
          }
        }
        if (!vis.meteorImpactBurstDone && t >= 0.28) {
          vis.meteorImpactBurstDone = true;
          this.spawnExpandingRing(eff.x, eff.z, '#ffbe4d', 0.6, vis.radius * 1.08, 0.42, 2.2);
          this.spawnBurst(eff.x, 0.65, eff.z, 28, '#c95bff', 7.4, {
            size: 0.56,
            duration: 0.62,
            star: true,
            upward: 4.8,
            gravity: -4.2,
            hdrBoost: 2.2,
          });
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
    if (this.particles.length >= MAX_PARTICLES) {
      const oldest = this.particles.shift();
      if (oldest) {
        this.rootGroup.remove(oldest.sprite);
        oldest.material.dispose();
      }
    }

    const col = new THREE.Color(opts.color);
    if (!opts.smoke && opts.hdrBoost && opts.hdrBoost > 1) {
      col.multiplyScalar(opts.hdrBoost);
    }

    const baseOpacity = opts.opacity ?? (opts.smoke ? 0.42 : 1.0);
    const material = new THREE.SpriteMaterial({
      map: opts.star
        ? this.textures.getStarParticleTexture()
        : this.textures.getParticleTexture(),
      color: col,
      transparent: true,
      opacity: baseOpacity,
      depthWrite: false,
      blending: opts.smoke ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(opts.x, opts.y, opts.z);
    sprite.scale.set(opts.size, opts.size, 1);
    sprite.renderOrder = opts.smoke ? 5 : 6;
    sprite.userData.skipSSAO = true;
    this.rootGroup.add(sprite);

    this.particles.push({
      sprite,
      material,
      vx: opts.vx,
      vy: opts.vy,
      vz: opts.vz,
      gravity: opts.gravity ?? -9.5,
      age: 0,
      duration: opts.duration,
      startSize: opts.size,
      endSize: opts.endSize ?? (opts.smoke ? opts.size * 2.2 : 0.05),
      baseOpacity,
      isSmoke: Boolean(opts.smoke),
      spiral: opts.spiral,
    });
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
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(hdrBoost),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.unitRingGeo, material);
    mesh.position.set(x, TELEGRAPH_Y + 0.02, z);
    mesh.scale.set(startScale, 1, startScale);
    mesh.renderOrder = 3;
    mesh.userData.skipSSAO = true;
    this.rootGroup.add(mesh);

    this.rings.push({
      mesh,
      material,
      age: 0,
      duration,
      startScale,
      endScale,
    });
  }

  private spawnMeleeSlash(x: number, z: number, angle: number, comboStep: 0 | 1 | 2): void {
    const isFinisher = comboStep === 2;
    const arc = isFinisher ? Math.PI : (140 * Math.PI) / 180;
    const outerR = isFinisher ? 2.9 : 2.48;
    const innerR = isFinisher ? 1.2 : 1.15;

    const geometry = createSlashArcGeometry(innerR, outerR, arc, 22);
    const slashColor = new THREE.Color(isFinisher ? 0xffe066 : 0xfff5d6).multiplyScalar(
      isFinisher ? 1.65 : 1.18,
    );
    const material = new THREE.MeshBasicMaterial({
      color: slashColor,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0.85, z);
    mesh.rotation.y = -angle;
    mesh.renderOrder = 5;
    mesh.userData.skipSSAO = true;
    this.rootGroup.add(mesh);

    this.slashes.push({
      mesh,
      material,
      geometry,
      baseAngle: angle,
      sweepDir: comboStep === 1 ? -1 : 1,
      age: 0,
      duration: isFinisher ? 0.24 : 0.17,
    });
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
          this.spawnMeleeSlash(px, pz, angle, step);
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
          const col = ev.enemyTypeId
            ? ENEMIES[ev.enemyTypeId].primaryColor
            : GOLD_LIGHT;
          this.spawnBurst(px, 0.9, pz, 18, col, 4.8, {
            size: 0.48,
            duration: 0.56,
            hdrBoost: 1.45,
          });
          this.spawnBurst(px, 1.1, pz, 8, GOLD_LIGHT, 3.4, {
            size: 0.44,
            duration: 0.68,
            star: true,
            hdrBoost: 1.9,
          });
          break;
        }
        case 'spell_cast': {
          if (ev.spellId === 'flamepurr') {
            // Braises incandescentes HDR + flammèches ascendantes
            this.spawnBurst(px, 0.55, pz, 24, VFX_COLORS.flame, 5.8, {
              size: 0.52,
              duration: 0.56,
              upward: 4.2,
              gravity: -2.6,
              hdrBoost: 2.2,
              star: true,
            });
            // Fumée volumétrique chaude au-dessus de l'anneau de feu
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
            // Éclats de givre étincelants + brume glacée rasante
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
            // Double spirale ascendante d'étoiles dorées & émeraude
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
            this.spawnBurst(px, 0.5, pz, 14, '#ffbe4d', 3.4, {
              size: 0.4,
              duration: 0.45,
              star: true,
              upward: 3.6,
              gravity: -1.2,
              hdrBoost: 2.0,
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
          this.spawnExpandingRing(
            px,
            pz,
            VFX_COLORS.telegraphBright,
            0.35,
            Math.min(5.8, ev.radius ?? 2.4),
            0.34,
            1.8,
          );
          this.spawnBurst(px, 0.4, pz, 10, '#ff7340', 3.6, {
            size: 0.4,
            duration: 0.36,
            hdrBoost: 1.85,
          });
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

    this.updateTelegraphs(state.telegraphs);
    this.updateSpellEffects(state.activeSpellEffects, state, safeDt);
    this.updateDodgeGhosts(state);
    this.updateQuestArrow(state);

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
      s.mesh.rotation.y = -(s.baseAngle + (t - 0.5) * 0.85 * s.sweepDir);
      const scale = 0.88 + t * 0.3;
      s.mesh.scale.set(scale, 1, scale);
      s.material.opacity = (1 - t) * 0.94;
    }

    // Mise à jour des anneaux d'impact / choc
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += safeDt;
      if (r.age >= r.duration) {
        this.rootGroup.remove(r.mesh);
        r.material.dispose();
        this.rings.splice(i, 1);
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

    // Mise à jour des particules (ballistiques, fumée volumétrique & spirales hélicoïdales)
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += safeDt;
      if (p.age >= p.duration) {
        this.rootGroup.remove(p.sprite);
        p.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      const t = p.age / p.duration;
      p.vy += p.gravity * safeDt;

      if (p.spiral) {
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

    for (const r of this.rings) {
      this.rootGroup.remove(r.mesh);
      r.material.dispose();
    }
    this.rings.length = 0;

    for (const b of this.levelBeams) {
      this.rootGroup.remove(b.group);
      b.beamMat.dispose();
      b.ringMat.dispose();
    }
    this.levelBeams.length = 0;

    for (const p of this.particles) {
      this.rootGroup.remove(p.sprite);
      p.material.dispose();
    }
    this.particles.length = 0;

    for (const slot of this.ghostPool) {
      slot.tiltGroup.visible = false;
    }
  }

  public dispose(): void {
    this.clear();
    for (const slot of this.ghostPool) {
      this.rootGroup.remove(slot.tiltGroup);
      slot.material.dispose();
    }
    this.ghostPool.length = 0;

    this.rootGroup.remove(this.questArrowGroup);
    for (const d of this.questArrowDisposables) {
      d.dispose();
    }

    this.scene.remove(this.rootGroup);
    this.unitRingGeo.dispose();
    this.unitDiskGeo.dispose();
    this.beamCylinderGeo.dispose();
    this.heatHazeCylinderGeo.dispose();
    this.iceCrystalGeo.dispose();
    this.aegisDomeGeo.dispose();
    this.meteorOrbGeo.dispose();
    this.ghostGeo.dispose();
  }
}
