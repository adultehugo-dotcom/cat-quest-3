import * as THREE from 'three';
import type { BiomeId, GameState, IslandId, WildlifeDensity } from '../game/types';
import { getBiomeAt } from '../data/worldData';
import { ALL_NEW_ISLANDS, NEW_ISLANDS, getBiomeAtNewIsland } from '../data/worldIslands';
import {
  getIslandTerrainHeightLocal,
  sampleShorelineField,
} from '../game/shorelineNavigation';
import type { WeatherSnapshot } from './weatherSystem';

export const DENSITY_MULTIPLIER: Readonly<Record<WildlifeDensity, number>> = {
  low: 0.4,
  normal: 1.0,
  high: 1.7,
};

const MAX_BIRDS = 36;
const MAX_BUTTERFLIES = 28;
const MAX_FIREFLIES = 32;
const MAX_CRITTERS = 22;
const MAX_DOLPHINS = 8;

const WATER_LEVEL_Y = -0.14;

export interface WildlifeCounts {
  birds: number;
  butterflies: number;
  fireflies: number;
  critters: number;
  dolphins: number;
}

export function resolveWildlifeCounts(density: WildlifeDensity): WildlifeCounts {
  const mult = DENSITY_MULTIPLIER[density] ?? 1.0;
  return {
    birds: Math.min(MAX_BIRDS, Math.max(1, Math.round(20 * mult))),
    butterflies: Math.min(MAX_BUTTERFLIES, Math.max(1, Math.round(16 * mult))),
    fireflies: Math.min(MAX_FIREFLIES, Math.max(1, Math.round(18 * mult))),
    critters: Math.min(MAX_CRITTERS, Math.max(1, Math.round(12 * mult))),
    dolphins: Math.min(MAX_DOLPHINS, Math.max(1, Math.round(4 * mult))),
  };
}

export function shouldSpawnDolphins(state: GameState): boolean {
  if (state.zoneId !== 'overworld' || state.ship.mode !== 'sailing') return false;
  return (
    sampleShorelineField(state.ship.position.x, state.ship.position.z).signedDistance >
    3.8
  );
}

function seededRand(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function resolveIslandCenter(islandId: IslandId): { x: number; z: number; radius: number } {
  if (islandId === 'felingard') {
    return { x: 0, z: 0, radius: 42 };
  }
  const isl = NEW_ISLANDS[islandId];
  return { x: isl.centerX, z: isl.centerZ, radius: isl.radius - 4 };
}

function resolveBiomeAtPoint(x: number, z: number): { islandId: IslandId; biome: BiomeId } {
  let bestId: IslandId = 'felingard';
  let bestDistSq = x * x + z * z;
  for (const id of ALL_NEW_ISLANDS) {
    const isl = NEW_ISLANDS[id];
    const dSq = (x - isl.centerX) ** 2 + (z - isl.centerZ) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      bestId = id;
    }
  }
  const biome =
    bestId === 'felingard'
      ? getBiomeAt(x, z)
      : getBiomeAtNewIsland(bestId, x, z);
  return { islandId: bestId, biome };
}

function sampleLandHeight(islandId: IslandId, worldX: number, worldZ: number): number {
  if (islandId === 'felingard') {
    return getIslandTerrainHeightLocal('felingard', worldX, worldZ);
  }
  const isl = NEW_ISLANDS[islandId];
  return getIslandTerrainHeightLocal(islandId, worldX - isl.centerX, worldZ - isl.centerZ);
}

function createBirdGeometry(): THREE.BufferGeometry {
  // Silhouette V stylisée (2 ailes inclinées + petit corps central)
  const positions = new Float32Array([
    // Aile gauche
    0, 0, -0.18,
    -0.36, 0.1, 0.02,
    0, 0, 0.14,
    // Aile droite
    0, 0, -0.18,
    0, 0, 0.14,
    0.36, 0.1, 0.02,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function createButterflyGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    // Aile gauche
    0, 0, -0.09,
    -0.18, 0.06, -0.08,
    -0.14, 0.04, 0.1,
    0, 0, 0.08,
    // Aile droite
    0, 0, -0.09,
    0, 0, 0.08,
    0.14, 0.04, 0.1,
    0.18, 0.06, -0.08,
  ]);
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createCritterGeometry(): THREE.BufferGeometry {
  // Petit corps ovale + deux petites oreilles
  const positions = new Float32Array([
    // Corps pyramidal compact orienté +Z
    -0.16, 0, -0.18,
    0.16, 0, -0.18,
    0.18, 0, 0.18,
    -0.18, 0, 0.18,
    0, 0.28, 0.02,
    // Oreille gauche
    -0.12, 0.22, 0.06,
    -0.04, 0.22, 0.06,
    -0.1, 0.44, 0.04,
    // Oreille droite
    0.04, 0.22, 0.06,
    0.12, 0.22, 0.06,
    0.1, 0.44, 0.04,
  ]);
  const indices = [
    0, 1, 4,
    1, 2, 4,
    2, 3, 4,
    3, 0, 4,
    5, 6, 7,
    8, 9, 10,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function createDolphinGeometry(): THREE.BufferGeometry {
  // Corps fuselé de dauphin (nez vers +Z) + aileron dorsal
  const positions = new Float32Array([
    // Flanc gauche & droit (avant -> milieu -> queue)
    0, 0, 0.72,
    -0.18, 0.08, 0.12,
    0, 0.22, 0.12,
    0.18, 0.08, 0.12,
    0, -0.06, 0.12,
    0, 0.02, -0.76,
    // Aileron dorsal
    0, 0.18, 0.12,
    0, 0.42, -0.06,
    0, 0.16, -0.16,
  ]);
  const indices = [
    0, 2, 1,
    0, 3, 2,
    0, 1, 4,
    0, 4, 3,
    1, 2, 5,
    2, 3, 5,
    4, 1, 5,
    3, 4, 5,
    6, 7, 8,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

interface BirdAgent {
  cx: number;
  cz: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  angle: number;
  angularSpeed: number;
  flapPhase: number;
  coastalGull: boolean;
  biome: BiomeId;
  fleeBoost: number;
}

interface ButterflyAgent {
  homeX: number;
  homeZ: number;
  x: number;
  y: number;
  z: number;
  phase: number;
  biome: BiomeId;
  fleeVx: number;
  fleeVz: number;
}

interface FireflyAgent {
  homeX: number;
  homeZ: number;
  phase: number;
  speed: number;
}

interface CritterAgent {
  islandId: IslandId;
  biome: BiomeId;
  homeX: number;
  homeZ: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hopPhase: number;
  wanderTimer: number;
  facingAngle: number;
}

interface DolphinAgent {
  active: boolean;
  startX: number;
  startZ: number;
  dirX: number;
  dirZ: number;
  dist: number;
  peakHeight: number;
  elapsed: number;
  duration: number;
  cooldown: number;
}

export class WildlifeSystem {
  private readonly scene: THREE.Scene;
  private readonly rootGroup = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  private readonly birdMesh: THREE.InstancedMesh;
  private readonly butterflyMesh: THREE.InstancedMesh;
  private readonly fireflyMesh: THREE.InstancedMesh;
  private readonly critterMesh: THREE.InstancedMesh;
  private readonly dolphinMesh: THREE.InstancedMesh;

  private readonly birds: BirdAgent[] = [];
  private readonly butterflies: ButterflyAgent[] = [];
  private readonly fireflies: FireflyAgent[] = [];
  private readonly critters: CritterAgent[] = [];
  private readonly dolphins: DolphinAgent[] = [];

  private readonly dummy = new THREE.Object3D();
  private readonly tmpColor = new THREE.Color();

  private animTime = 0;
  private lastDensity: WildlifeDensity = 'normal';
  private activeBirds = 0;
  private activeButterflies = 0;
  private activeFireflies = 0;
  private activeCritters = 0;
  private activeDolphins = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup.name = 'WildlifeRoot';
    this.rootGroup.userData.skipSSAO = true;
    this.scene.add(this.rootGroup);

    const birdGeo = this.track(createBirdGeometry());
    const birdMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.65,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    );
    this.birdMesh = this.track(new THREE.InstancedMesh(birdGeo, birdMat, MAX_BIRDS));
    this.birdMesh.name = 'WildlifeBirds';
    this.birdMesh.frustumCulled = false;
    this.birdMesh.castShadow = false;
    this.birdMesh.userData.skipSSAO = true;
    this.rootGroup.add(this.birdMesh);

    const butterflyGeo = this.track(createButterflyGeometry());
    const butterflyMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.5,
        metalness: 0.05,
        side: THREE.DoubleSide,
      }),
    );
    this.butterflyMesh = this.track(new THREE.InstancedMesh(butterflyGeo, butterflyMat, MAX_BUTTERFLIES));
    this.butterflyMesh.name = 'WildlifeButterflies';
    this.butterflyMesh.frustumCulled = false;
    this.butterflyMesh.userData.skipSSAO = true;
    this.rootGroup.add(this.butterflyMesh);

    const fireflyGeo = this.track(new THREE.OctahedronGeometry(0.085, 0));
    const fireflyMat = this.track(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0xd8ff6b).multiplyScalar(1.8),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.fireflyMesh = this.track(new THREE.InstancedMesh(fireflyGeo, fireflyMat, MAX_FIREFLIES));
    this.fireflyMesh.name = 'WildlifeFireflies';
    this.fireflyMesh.frustumCulled = false;
    this.fireflyMesh.userData.skipSSAO = true;
    this.rootGroup.add(this.fireflyMesh);

    const critterGeo = this.track(createCritterGeometry());
    const critterMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.78,
        metalness: 0.02,
      }),
    );
    this.critterMesh = this.track(new THREE.InstancedMesh(critterGeo, critterMat, MAX_CRITTERS));
    this.critterMesh.name = 'WildlifeCritters';
    this.critterMesh.frustumCulled = false;
    this.critterMesh.castShadow = true;
    this.critterMesh.userData.skipSSAO = true;
    this.rootGroup.add(this.critterMesh);

    const dolphinGeo = this.track(createDolphinGeometry());
    const dolphinMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x4b93c9,
        roughness: 0.22,
        metalness: 0.14,
      }),
    );
    this.dolphinMesh = this.track(new THREE.InstancedMesh(dolphinGeo, dolphinMat, MAX_DOLPHINS));
    this.dolphinMesh.name = 'WildlifeDolphins';
    this.dolphinMesh.frustumCulled = false;
    this.dolphinMesh.castShadow = true;
    this.dolphinMesh.userData.skipSSAO = true;
    this.rootGroup.add(this.dolphinMesh);

    this.initAgents();
  }

  private track<T extends { dispose(): void }>(res: T): T {
    this.disposables.push(res);
    return res;
  }

  private initAgents(): void {
    const rand = seededRand(202605);
    const islands: IslandId[] = ['felingard', ...ALL_NEW_ISLANDS];

    // 1. Oiseaux, hiboux des neiges & mouettes côtières
    for (let i = 0; i < MAX_BIRDS; i++) {
      const coastalGull = i % 3 === 0;
      const isl = islands[i % islands.length];
      const ctr = resolveIslandCenter(isl);
      const ang = rand() * Math.PI * 2;
      const distR = coastalGull
        ? ctr.radius + 6 + rand() * 14
        : rand() * Math.max(8, ctr.radius - 4);
      const cx = ctr.x + Math.cos(ang) * distR;
      const cz = ctr.z + Math.sin(ang) * distR;
      const resolved = resolveBiomeAtPoint(cx, cz);
      this.birds.push({
        cx,
        cz,
        x: cx,
        y: coastalGull ? 5.8 + rand() * 2.5 : 4.2 + rand() * 2.2,
        z: cz,
        radius: 4.5 + rand() * 7.5,
        angle: rand() * Math.PI * 2,
        angularSpeed: (0.28 + rand() * 0.25) * (i % 2 === 0 ? 1 : -1),
        flapPhase: rand() * Math.PI * 2,
        coastalGull,
        biome: resolved.biome,
        fleeBoost: 0,
      });

      if (coastalGull) {
        this.tmpColor.setHex(0xf4f8ff);
      } else if (resolved.biome === 'frost' || resolved.biome === 'mountain') {
        this.tmpColor.setHex(0xdff5ff);
      } else if (resolved.biome === 'mystic' || resolved.biome === 'wild') {
        this.tmpColor.setHex(0x524b75);
      } else if (resolved.biome === 'tropical') {
        this.tmpColor.setHex(0xff9e3d);
      } else {
        this.tmpColor.setHex(0xe8c55a);
      }
      this.birdMesh.setColorAt(i, this.tmpColor);
    }
    if (this.birdMesh.instanceColor) {
      this.birdMesh.instanceColor.needsUpdate = true;
    }

    // 2. Papillons diurnes colorés
    const butterflyIslands: IslandId[] = ['felingard', 'tropical', 'wild', 'archipelago'];
    const butterflyPalette = [0xffb8e6, 0xffe46b, 0x7ae8ff, 0xff9d5c, 0xc2ff78];
    for (let i = 0; i < MAX_BUTTERFLIES; i++) {
      const isl = butterflyIslands[i % butterflyIslands.length];
      const ctr = resolveIslandCenter(isl);
      const ang = rand() * Math.PI * 2;
      const r = 4 + rand() * Math.max(6, ctr.radius - 6);
      const hx = ctr.x + Math.cos(ang) * r;
      const hz = ctr.z + Math.sin(ang) * r;
      const resolved = resolveBiomeAtPoint(hx, hz);
      this.butterflies.push({
        homeX: hx,
        homeZ: hz,
        x: hx,
        y: 0.9 + rand() * 0.7,
        z: hz,
        phase: rand() * Math.PI * 2,
        biome: resolved.biome,
        fleeVx: 0,
        fleeVz: 0,
      });
      this.tmpColor.setHex(butterflyPalette[i % butterflyPalette.length]);
      this.butterflyMesh.setColorAt(i, this.tmpColor);
    }
    if (this.butterflyMesh.instanceColor) {
      this.butterflyMesh.instanceColor.needsUpdate = true;
    }

    // 3. Lucioles (crépuscule / nuit)
    const fireflyIslands: IslandId[] = ['felingard', 'mystic', 'wild'];
    for (let i = 0; i < MAX_FIREFLIES; i++) {
      const isl = fireflyIslands[i % fireflyIslands.length];
      const ctr = resolveIslandCenter(isl);
      const ang = rand() * Math.PI * 2;
      const r = 4 + rand() * Math.max(6, ctr.radius - 5);
      this.fireflies.push({
        homeX: ctr.x + Math.cos(ang) * r,
        homeZ: ctr.z + Math.sin(ang) * r,
        phase: rand() * Math.PI * 2,
        speed: 0.8 + rand() * 0.9,
      });
    }

    // 4. Petits animaux terrestres non-combattants (lapins, renards, crabes)
    for (let i = 0; i < MAX_CRITTERS; i++) {
      const isl = islands[i % islands.length];
      const ctr = resolveIslandCenter(isl);
      const ang = rand() * Math.PI * 2;
      const r = 6 + rand() * Math.max(6, ctr.radius - 8);
      const hx = ctr.x + Math.cos(ang) * r;
      const hz = ctr.z + Math.sin(ang) * r;
      const biome =
        isl === 'felingard' ? getBiomeAt(hx, hz) : getBiomeAtNewIsland(isl, hx, hz);
      this.critters.push({
        islandId: isl,
        biome,
        homeX: hx,
        homeZ: hz,
        x: hx,
        z: hz,
        vx: 0,
        vz: 0,
        hopPhase: rand() * Math.PI * 2,
        wanderTimer: 1.0 + rand() * 2.5,
        facingAngle: rand() * Math.PI * 2,
      });
      if (biome === 'frost' || biome === 'mountain') {
        this.tmpColor.setHex(0xf0f7ff);
      } else if (biome === 'tropical') {
        this.tmpColor.setHex(0xe87b4a);
      } else if (biome === 'mystic') {
        this.tmpColor.setHex(0x9b86d6);
      } else {
        this.tmpColor.setHex(0xc9965b);
      }
      this.critterMesh.setColorAt(i, this.tmpColor);
    }
    if (this.critterMesh.instanceColor) {
      this.critterMesh.instanceColor.needsUpdate = true;
    }

    // 5. Dauphins bondissants
    for (let i = 0; i < MAX_DOLPHINS; i++) {
      this.dolphins.push({
        active: false,
        startX: 0,
        startZ: 0,
        dirX: 0,
        dirZ: -1,
        dist: 6.5,
        peakHeight: 2.1,
        elapsed: 0,
        duration: 1.35,
        cooldown: 0.8 + i * 1.1,
      });
    }
  }

  private hideRemainingInstances(mesh: THREE.InstancedMesh, startIndex: number, maxCount: number): void {
    this.dummy.scale.set(0, 0, 0);
    this.dummy.position.set(0, -50, 0);
    this.dummy.rotation.order = 'XYZ';
    this.dummy.rotation.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = startIndex; i < maxCount; i++) {
      mesh.setMatrixAt(i, this.dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  public update(
    state: GameState,
    dt: number,
    weather?: WeatherSnapshot | null,
  ): void {
    const density = state.options?.wildlifeDensity ?? 'normal';
    this.lastDensity = density;

    if (state.zoneId !== 'overworld') {
      this.rootGroup.visible = false;
      this.activeBirds = 0;
      this.activeButterflies = 0;
      this.activeFireflies = 0;
      this.activeCritters = 0;
      this.activeDolphins = 0;
      return;
    }
    this.rootGroup.visible = true;

    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    if (safeDt <= 0) {
      return;
    }
    this.animTime += safeDt;

    const counts = resolveWildlifeCounts(density);
    const px = state.player.x;
    const pz = state.player.z;
    const playerAttacking = state.player.attackAnimTimer > 0;
    const nightFactor = weather?.nightFactor ?? 0;
    const sunsetFactor = weather?.sunsetFactor ?? 0;
    const storm = weather?.stormIntensity ?? 0;

    // 1. Oiseaux / Hiboux / Mouettes
    let birdCount = 0;
    for (let i = 0; i < counts.birds; i++) {
      const b = this.birds[i];
      b.angle += b.angularSpeed * (1 + b.fleeBoost * 1.4) * safeDt;
      const targetX = b.cx + Math.cos(b.angle) * b.radius;
      const targetZ = b.cz + Math.sin(b.angle) * b.radius;

      const dHero = Math.hypot(targetX - px, targetZ - pz);
      if (dHero < (playerAttacking ? 9.0 : 6.0)) {
        b.fleeBoost = Math.min(1, b.fleeBoost + safeDt * 3.5);
      } else {
        b.fleeBoost = Math.max(0, b.fleeBoost - safeDt * 1.2);
      }

      b.x = targetX;
      b.z = targetZ;
      b.flapPhase += safeDt * (9.5 + b.fleeBoost * 8.0);
      const flapY = 0.65 + Math.sin(b.flapPhase) * 0.55;
      const heading = b.angle + (b.angularSpeed >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5);

      this.dummy.position.set(b.x, b.y + b.fleeBoost * 1.4 + Math.sin(b.flapPhase * 0.35) * 0.25, b.z);
      this.dummy.rotation.set(0, -heading + Math.PI * 0.5, Math.sin(b.angle * 2) * 0.14);
      this.dummy.scale.set(1.0, flapY, 1.0);
      this.dummy.updateMatrix();
      this.birdMesh.setMatrixAt(i, this.dummy.matrix);
      birdCount++;
    }
    this.hideRemainingInstances(this.birdMesh, birdCount, MAX_BIRDS);
    this.activeBirds = birdCount;

    // 2. Papillons (actifs hors nuit profonde et hors tempête violente)
    let butterflyCount = 0;
    const butterfliesVisible = nightFactor < 0.72 && storm < 0.75;
    if (butterfliesVisible) {
      for (let i = 0; i < counts.butterflies; i++) {
        const bf = this.butterflies[i];
        bf.phase += safeDt * 6.5;
        const dx = bf.x - px;
        const dz = bf.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < 4.5 && d > 1e-4) {
          bf.fleeVx = (dx / d) * 3.4;
          bf.fleeVz = (dz / d) * 3.4;
        }
        bf.x += bf.fleeVx * safeDt + Math.cos(bf.phase * 0.42) * 0.75 * safeDt;
        bf.z += bf.fleeVz * safeDt + Math.sin(bf.phase * 0.37) * 0.75 * safeDt;
        bf.fleeVx *= Math.exp(-3.5 * safeDt);
        bf.fleeVz *= Math.exp(-3.5 * safeDt);

        // Retour doux vers la zone fleurie d'origine
        bf.x += (bf.homeX - bf.x) * safeDt * 0.45;
        bf.z += (bf.homeZ - bf.z) * safeDt * 0.45;

        const y = bf.y + Math.sin(bf.phase * 0.8) * 0.28;
        this.dummy.position.set(bf.x, y, bf.z);
        this.dummy.rotation.set(0, bf.phase * 0.35, 0);
        this.dummy.scale.set(1, 0.4 + Math.abs(Math.sin(bf.phase * 2.1)) * 1.1, 1);
        this.dummy.updateMatrix();
        this.butterflyMesh.setMatrixAt(i, this.dummy.matrix);
        butterflyCount++;
      }
    }
    this.hideRemainingInstances(this.butterflyMesh, butterflyCount, MAX_BUTTERFLIES);
    this.activeButterflies = butterflyCount;

    // 3. Lucioles (crépuscule / nuit)
    let fireflyCount = 0;
    const firefliesActive = nightFactor + sunsetFactor > 0.25;
    if (firefliesActive) {
      const glowPulseScale = Math.min(1.25, 0.55 + (nightFactor + sunsetFactor) * 0.6);
      for (let i = 0; i < counts.fireflies; i++) {
        const ff = this.fireflies[i];
        ff.phase += safeDt * ff.speed;
        const fx = ff.homeX + Math.sin(ff.phase * 1.1) * 1.8;
        const fz = ff.homeZ + Math.cos(ff.phase * 0.9) * 1.8;
        const fy = 0.75 + Math.sin(ff.phase * 2.2) * 0.45;
        const flicker = (0.4 + 0.6 * Math.abs(Math.sin(ff.phase * 3.1))) * glowPulseScale;

        this.dummy.position.set(fx, fy, fz);
        this.dummy.rotation.set(ff.phase, ff.phase * 0.7, 0);
        this.dummy.scale.setScalar(flicker);
        this.dummy.updateMatrix();
        this.fireflyMesh.setMatrixAt(i, this.dummy.matrix);
        fireflyCount++;
      }
    }
    this.hideRemainingInstances(this.fireflyMesh, fireflyCount, MAX_FIREFLIES);
    this.activeFireflies = fireflyCount;

    // 4. Petits animaux terrestres non-combattants (fuient le héros tout en restant sur terre)
    let critterCount = 0;
    for (let i = 0; i < counts.critters; i++) {
      const c = this.critters[i];
      const onFoot = state.ship.mode === 'parked';
      const dx = c.x - px;
      const dz = c.z - pz;
      const d = Math.hypot(dx, dz);

      if (onFoot && d < 4.8 && d > 1e-4) {
        const fleeSpeed = 4.6;
        c.vx = (dx / d) * fleeSpeed;
        c.vz = (dz / d) * fleeSpeed;
        c.facingAngle = Math.atan2(c.vx, c.vz);
      } else {
        c.wanderTimer -= safeDt;
        if (c.wanderTimer <= 0) {
          c.wanderTimer = 1.6 + ((i * 37) % 10) * 0.22;
          const toHomeX = c.homeX - c.x;
          const toHomeZ = c.homeZ - c.z;
          const ang =
            Math.hypot(toHomeX, toHomeZ) > 6
              ? Math.atan2(toHomeZ, toHomeX)
              : this.animTime * 1.7 + i * 1.9;
          c.vx = Math.cos(ang) * 1.1;
          c.vz = Math.sin(ang) * 1.1;
          c.facingAngle = Math.atan2(c.vx, c.vz);
        } else {
          const damp = Math.exp(-2.8 * safeDt);
          c.vx *= damp;
          c.vz *= damp;
        }
      }

      const nextX = c.x + c.vx * safeDt;
      const nextZ = c.z + c.vz * safeDt;
      const shore = sampleShorelineField(nextX, nextZ);
      if (shore.signedDistance <= -1.6) {
        c.x = nextX;
        c.z = nextZ;
      } else {
        // Rebondit doucement vers l'intérieur de l'île
        c.vx = (c.homeX - c.x) * 0.8;
        c.vz = (c.homeZ - c.z) * 0.8;
      }

      const speed = Math.hypot(c.vx, c.vz);
      c.hopPhase += safeDt * (speed > 0.3 ? 11.0 : 2.5);
      const groundY = sampleLandHeight(c.islandId, c.x, c.z);
      const hopY = speed > 0.25 ? Math.abs(Math.sin(c.hopPhase)) * 0.22 : 0;

      this.dummy.position.set(c.x, groundY + hopY, c.z);
      this.dummy.rotation.set(0, c.facingAngle, 0);
      this.dummy.scale.setScalar(0.95);
      this.dummy.updateMatrix();
      this.critterMesh.setMatrixAt(i, this.dummy.matrix);
      critterCount++;
    }
    this.hideRemainingInstances(this.critterMesh, critterCount, MAX_CRITTERS);
    this.activeCritters = critterCount;

    // 5. Dauphins bondissants près du Patte-au-Vent en navigation en eau libre
    let dolphinCount = 0;
    const allowDolphins = shouldSpawnDolphins(state);
    const shipFwdX = -Math.sin(state.ship.angle);
    const shipFwdZ = -Math.cos(state.ship.angle);
    const shipRightX = Math.cos(state.ship.angle);
    const shipRightZ = -Math.sin(state.ship.angle);

    for (let i = 0; i < counts.dolphins; i++) {
      const dp = this.dolphins[i];
      if (!allowDolphins) {
        dp.active = false;
        continue;
      }

      if (!dp.active) {
        dp.cooldown -= safeDt;
        if (dp.cooldown <= 0) {
          const side = i % 2 === 0 ? 1 : -1;
          const lateral = side * (6.5 + (i % 3) * 2.8);
          const forward = 9.0 + (i % 2) * 5.0;
          const sx = state.ship.position.x + shipFwdX * forward + shipRightX * lateral;
          const sz = state.ship.position.z + shipFwdZ * forward + shipRightZ * lateral;
          if (sampleShorelineField(sx, sz).signedDistance > 3.0) {
            dp.active = true;
            dp.startX = sx;
            dp.startZ = sz;
            dp.dirX = shipFwdX;
            dp.dirZ = shipFwdZ;
            dp.dist = 6.2 + (i % 2) * 1.8;
            dp.peakHeight = 1.9 + (i % 3) * 0.35;
            dp.elapsed = 0;
            dp.duration = 1.25 + (i % 2) * 0.25;
            dp.cooldown = 1.8 + i * 0.9;
          } else {
            dp.cooldown = 0.8;
          }
        }
      }

      if (dp.active) {
        dp.elapsed += safeDt;
        const t = dp.elapsed / dp.duration;
        if (t >= 1) {
          dp.active = false;
          continue;
        }
        const horiz = t * dp.dist;
        const x = dp.startX + dp.dirX * horiz;
        const z = dp.startZ + dp.dirZ * horiz;
        const y = WATER_LEVEL_Y - 0.3 + Math.sin(t * Math.PI) * (dp.peakHeight + 0.3);
        const vy = Math.cos(t * Math.PI) * Math.PI * (dp.peakHeight + 0.3) / dp.duration;
        const horizSpeed = dp.dist / dp.duration;
        const pitch = -Math.atan2(vy, horizSpeed);
        const yaw = Math.atan2(dp.dirX, dp.dirZ);

        this.dummy.position.set(x, y, z);
        this.dummy.rotation.order = 'YXZ';
        this.dummy.rotation.set(pitch, yaw, 0);
        this.dummy.scale.setScalar(1.25);
        this.dummy.updateMatrix();
        this.dolphinMesh.setMatrixAt(dolphinCount, this.dummy.matrix);
        dolphinCount++;
      }
    }
    this.hideRemainingInstances(this.dolphinMesh, dolphinCount, MAX_DOLPHINS);
    this.activeDolphins = dolphinCount;
  }

  public getDiagnostics(): Readonly<{
    visible: boolean;
    density: WildlifeDensity;
    activeBirds: number;
    activeButterflies: number;
    activeFireflies: number;
    activeCritters: number;
    activeDolphins: number;
  }> {
    return {
      visible: this.rootGroup.visible,
      density: this.lastDensity,
      activeBirds: this.activeBirds,
      activeButterflies: this.activeButterflies,
      activeFireflies: this.activeFireflies,
      activeCritters: this.activeCritters,
      activeDolphins: this.activeDolphins,
    };
  }

  public dispose(): void {
    this.scene.remove(this.rootGroup);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
