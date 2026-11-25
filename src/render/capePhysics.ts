import * as THREE from 'three';
import { SPRITE_LIGHT_COUNT, SPRITE_LIGHT_UNIFORMS } from './spriteLighting';

// ============================================================================
// Simulation physique de tissu souple pour la cape (Couche de rendu uniquement)
// - Zéro dépendance src/game/, zéro allocation mémoire par frame.
// - Maillage subdivisé 11×13 (143 sommets, 240 triangles) dans le repère vertical
//   monde du héros (`playerRoot`), ancré précisément aux épaules/col derrière le dos.
// - Contraintes structurelles, de cisaillement (diagonales) et de courbure (2-pas),
//   inertie réelle sur déplacement monde (accélération, freinage, virages, sauts,
//   attaques, roulades), aérodynamique orientée normales et vent météo multi-octaves.
// - Garde-fous anti-clipping dos/bras/armes/bouclier et anti-traversée du sol.
// - Shader PBR textile (MeshStandardMaterial + onBeforeCompile) : tissage fin,
//   ourlet brodé, doublure intérieure (`gl_FrontFacing`), velours/soie (sheen)
//   et éclairage local partagé avec `SPRITE_LIGHT_UNIFORMS` (9 lumières).
// ============================================================================

export interface CapeMaterialProfile {
  readonly id: string;
  readonly mass: number;
  readonly gravity: number;
  readonly damping: number;
  readonly stretchStiffness: number;
  readonly shearStiffness: number;
  readonly bendStiffness: number;
  readonly windCatch: number;
  readonly inertiaScale: number;
  readonly roughness: number;
  readonly sheen: number;
  readonly patternId: 0 | 1 | 2 | 3;
  readonly weaveScale: number;
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly accentColor: string;
  readonly luminous: boolean;
  readonly glowColor: string;
}

export interface CapeAppearanceSpec {
  readonly id: string;
  readonly primaryColor?: string;
  readonly secondaryColor?: string;
  readonly accentColor?: string;
  readonly luminous?: boolean;
  readonly glowColor?: string;
  /** Texture textile plane séparée optionnelle appliquée sans altérer les plis Verlet */
  readonly fabricTexture?: THREE.Texture | null;
}

export interface CapeWindInput {
  vx: number;
  vz: number;
  vy?: number;
  worldX?: number;
  worldY?: number;
  worldZ?: number;
  facingX: number;
  windDirX: number;
  windDirZ: number;
  windIntensity: number;
  stormIntensity?: number;
  isRolling: boolean;
  isAttacking?: boolean;
  attackProgress?: number;
  isJumping?: boolean;
  isOnDeck?: boolean;
  bounceY?: number;
  elevationY?: number;
  speed: number;
}

const DEFAULT_CAPE_PROFILE: CapeMaterialProfile = {
  id: 'cape_traveler',
  mass: 1.08,
  gravity: 11.4,
  damping: 0.935,
  stretchStiffness: 0.92,
  shearStiffness: 0.68,
  bendStiffness: 0.42,
  windCatch: 0.96,
  inertiaScale: 0.86,
  roughness: 0.86,
  sheen: 0.3,
  patternId: 0,
  weaveScale: 92,
  primaryColor: '#3f7a47',
  secondaryColor: '#244a2a',
  accentColor: '#d9a45b',
  luminous: false,
  glowColor: '#000000',
};

const CAPE_PROFILES: Readonly<Record<string, CapeMaterialProfile>> = {
  cape_traveler: DEFAULT_CAPE_PROFILE,
  cape_knight: {
    id: 'cape_knight',
    mass: 1.18,
    gravity: 12.2,
    damping: 0.928,
    stretchStiffness: 0.95,
    shearStiffness: 0.75,
    bendStiffness: 0.52,
    windCatch: 0.88,
    inertiaScale: 0.9,
    roughness: 0.74,
    sheen: 0.44,
    patternId: 1,
    weaveScale: 108,
    primaryColor: '#2c5ca8',
    secondaryColor: '#173468',
    accentColor: '#f2c249',
    luminous: false,
    glowColor: '#000000',
  },
  cape_starlight: {
    id: 'cape_starlight',
    mass: 0.72,
    gravity: 8.6,
    damping: 0.954,
    stretchStiffness: 0.88,
    shearStiffness: 0.56,
    bendStiffness: 0.22,
    windCatch: 1.34,
    inertiaScale: 0.96,
    roughness: 0.46,
    sheen: 0.72,
    patternId: 2,
    weaveScale: 130,
    primaryColor: '#3a2b82',
    secondaryColor: '#1b1148',
    accentColor: '#7be3ff',
    luminous: true,
    glowColor: '#7be3ff',
  },
  cape_dragon: {
    id: 'cape_dragon',
    mass: 1.26,
    gravity: 12.8,
    damping: 0.932,
    stretchStiffness: 0.96,
    shearStiffness: 0.77,
    bendStiffness: 0.48,
    windCatch: 0.95,
    inertiaScale: 0.94,
    roughness: 0.62,
    sheen: 0.6,
    patternId: 3,
    weaveScale: 100,
    primaryColor: '#b82534',
    secondaryColor: '#69101a',
    accentColor: '#f5c242',
    luminous: false,
    glowColor: '#000000',
  },
};

export function getCapeMaterialProfile(
  capeId: string,
  override?: CapeAppearanceSpec,
): CapeMaterialProfile {
  const base = CAPE_PROFILES[capeId] ?? DEFAULT_CAPE_PROFILE;
  if (!override) return base;
  return {
    ...base,
    id: capeId || base.id,
    primaryColor: override.primaryColor ?? base.primaryColor,
    secondaryColor: override.secondaryColor ?? base.secondaryColor,
    accentColor: override.accentColor ?? base.accentColor,
    luminous: override.luminous ?? base.luminous,
    glowColor: override.glowColor ?? base.glowColor,
  };
}

// Inclinaison exacte du billboard héros (`SPRITE_TILT_X = -0.48 rad`)
const HERO_TILT_RAD = 0.48;
const HERO_COS_TILT = Math.cos(HERO_TILT_RAD);
const HERO_SIN_TILT = Math.sin(HERO_TILT_RAD);
const HERO_TAN_TILT = Math.tan(HERO_TILT_RAD);

// Hauteur du col/épaules sur le sprite 512×512 (`HERO_HEIGHT = 2.45`, y_px ≈ 318)
const COLLAR_SPRITE_Y = 0.94;
const COLLAR_BASE_Y = COLLAR_SPRITE_Y * HERO_COS_TILT; // ≈ 0.834 u
const COLLAR_BASE_Z = -COLLAR_SPRITE_Y * HERO_SIN_TILT - 0.088; // ≈ -0.522 u (strictement derrière le cou)
const GROUND_FLOOR_MARGIN = 0.085;

export class CapeClothSolver {
  public static readonly COLS = 11;
  public static readonly ROWS = 13;
  public static readonly VERT_COUNT = CapeClothSolver.COLS * CapeClothSolver.ROWS;
  public static readonly WIDTH_TOP = 0.66;
  public static readonly WIDTH_BOT = 1.44;
  public static readonly LENGTH = 0.86;

  public readonly posX = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly posY = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly posZ = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly prevX = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly prevY = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly prevZ = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly restX = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly restY = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly restZ = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly normX = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly normY = new Float32Array(CapeClothSolver.VERT_COUNT);
  public readonly normZ = new Float32Array(CapeClothSolver.VERT_COUNT);

  // Longueurs au repos pré-calculées (structural, shear, bend) — zéro alloc
  private readonly restLenV: Float32Array;
  private readonly restLenH: Float32Array;
  private readonly restLenShearA: Float32Array; // (r, c) <-> (r+1, c+1)
  private readonly restLenShearB: Float32Array; // (r, c+1) <-> (r+1, c)
  private readonly restLenBendV: Float32Array;  // (r, c) <-> (r+2, c)
  private readonly restLenBendH: Float32Array;  // (r, c) <-> (r, c+2)

  public time = 0;
  private profile: CapeMaterialProfile = DEFAULT_CAPE_PROFILE;

  // État cinématique du héros suivi dans la couche de rendu pour vraie inertie
  private hasPrevWorld = false;
  private prevWorldX = 0;
  private prevWorldY = 0;
  private prevWorldZ = 0;
  private prevVx = 0;
  private prevVz = 0;
  private prevFacingX = 1;
  private wasAttacking = false;
  private attackWhipTimer = 0;
  private attackWhipSign = 1;
  private smoothedAccX = 0;
  private smoothedAccZ = 0;
  private smoothedTurnRate = 0;

  constructor() {
    const cols = CapeClothSolver.COLS;
    const rows = CapeClothSolver.ROWS;
    const halfTop = CapeClothSolver.WIDTH_TOP * 0.5;
    const halfBot = CapeClothSolver.WIDTH_BOT * 0.5;

    for (let r = 0; r < rows; r++) {
      const rf = r / (rows - 1);
      // Courbe d'évasement organique d'un manteau drapé (plus fluide qu'un trapèze rigide)
      const flare = Math.pow(rf, 0.88);
      const halfW = halfTop + (halfBot - halfTop) * flare;

      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const cf = c / (cols - 1); // 0..1
        const centered = (cf - 0.5) * 2; // -1..+1
        const edgeSq = centered * centered;

        // Ourlet royal légèrement plus long au centre du dos
        const hemTail = (1 - edgeSq) * 0.062 * rf;
        // Col légèrement arqué autour des épaules + plis verticaux souples bien lisibles au repos
        const collarArchZ = -0.044 * (1 - edgeSq);
        const drapeBackZ = -0.068 * rf;
        const softPleatZ = -0.036 * Math.cos(centered * Math.PI * 2.5) * Math.pow(rf, 0.75);

        this.restX[i] = centered * halfW;
        this.restY[i] = Math.max(
          GROUND_FLOOR_MARGIN + 0.02,
          COLLAR_BASE_Y - rf * CapeClothSolver.LENGTH - hemTail,
        );
        this.restZ[i] = COLLAR_BASE_Z + collarArchZ + drapeBackZ + softPleatZ;
      }
    }

    this.restLenV = new Float32Array((rows - 1) * cols);
    this.restLenH = new Float32Array(rows * (cols - 1));
    this.restLenShearA = new Float32Array((rows - 1) * (cols - 1));
    this.restLenShearB = new Float32Array((rows - 1) * (cols - 1));
    this.restLenBendV = new Float32Array((rows - 2) * cols);
    this.restLenBendH = new Float32Array(rows * (cols - 2));

    this.precomputeRestLengths();
    this.reset();
  }

  private distRest(i0: number, i1: number): number {
    const dx = this.restX[i1] - this.restX[i0];
    const dy = this.restY[i1] - this.restY[i0];
    const dz = this.restZ[i1] - this.restZ[i0];
    return Math.hypot(dx, dy, dz);
  }

  private precomputeRestLengths(): void {
    const cols = CapeClothSolver.COLS;
    const rows = CapeClothSolver.ROWS;

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols; c++) {
        this.restLenV[r * cols + c] = this.distRest(r * cols + c, (r + 1) * cols + c);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 1; c++) {
        this.restLenH[r * (cols - 1) + c] = this.distRest(r * cols + c, r * cols + c + 1);
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const idx = r * (cols - 1) + c;
        this.restLenShearA[idx] = this.distRest(r * cols + c, (r + 1) * cols + c + 1);
        this.restLenShearB[idx] = this.distRest(r * cols + c + 1, (r + 1) * cols + c);
      }
    }
    for (let r = 0; r < rows - 2; r++) {
      for (let c = 0; c < cols; c++) {
        this.restLenBendV[r * cols + c] = this.distRest(r * cols + c, (r + 2) * cols + c);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols - 2; c++) {
        this.restLenBendH[r * (cols - 2) + c] = this.distRest(r * cols + c, r * cols + c + 2);
      }
    }
  }

  public get cols(): number {
    return CapeClothSolver.COLS;
  }

  public get rows(): number {
    return CapeClothSolver.ROWS;
  }

  public get vertexCount(): number {
    return CapeClothSolver.VERT_COUNT;
  }

  public getMaterialProfile(): CapeMaterialProfile {
    return this.profile;
  }

  public setMaterialProfile(profile: CapeMaterialProfile): void {
    this.profile = profile;
  }

  public reset(): void {
    this.time = 0;
    this.hasPrevWorld = false;
    this.prevWorldX = 0;
    this.prevWorldY = 0;
    this.prevWorldZ = 0;
    this.prevVx = 0;
    this.prevVz = 0;
    this.prevFacingX = 1;
    this.wasAttacking = false;
    this.attackWhipTimer = 0;
    this.smoothedAccX = 0;
    this.smoothedAccZ = 0;
    this.smoothedTurnRate = 0;

    for (let i = 0; i < CapeClothSolver.VERT_COUNT; i++) {
      this.posX[i] = this.restX[i];
      this.posY[i] = this.restY[i];
      this.posZ[i] = this.restZ[i];
      this.prevX[i] = this.restX[i];
      this.prevY[i] = this.restY[i];
      this.prevZ[i] = this.restZ[i];
    }
    this.computeVertexNormals();
  }

  public computeVertexNormals(): void {
    const cols = CapeClothSolver.COLS;
    const rows = CapeClothSolver.ROWS;
    const n = CapeClothSolver.VERT_COUNT;
    this.normX.fill(0);
    this.normY.fill(0);
    this.normZ.fill(0);

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;

        // Triangle 1: (a, d, b)
        let e1x = this.posX[d] - this.posX[a];
        let e1y = this.posY[d] - this.posY[a];
        let e1z = this.posZ[d] - this.posZ[a];
        let e2x = this.posX[b] - this.posX[a];
        let e2y = this.posY[b] - this.posY[a];
        let e2z = this.posZ[b] - this.posZ[a];
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;

        this.normX[a] += nx;
        this.normY[a] += ny;
        this.normZ[a] += nz;
        this.normX[d] += nx;
        this.normY[d] += ny;
        this.normZ[d] += nz;
        this.normX[b] += nx;
        this.normY[b] += ny;
        this.normZ[b] += nz;

        // Triangle 2: (b, d, e)
        e1x = this.posX[d] - this.posX[b];
        e1y = this.posY[d] - this.posY[b];
        e1z = this.posZ[d] - this.posZ[b];
        e2x = this.posX[e] - this.posX[b];
        e2y = this.posY[e] - this.posY[b];
        e2z = this.posZ[e] - this.posZ[b];
        nx = e1y * e2z - e1z * e2y;
        ny = e1z * e2x - e1x * e2z;
        nz = e1x * e2y - e1y * e2x;

        this.normX[b] += nx;
        this.normY[b] += ny;
        this.normZ[b] += nz;
        this.normX[d] += nx;
        this.normY[d] += ny;
        this.normZ[d] += nz;
        this.normX[e] += nx;
        this.normY[e] += ny;
        this.normZ[e] += nz;
      }
    }

    for (let i = 0; i < n; i++) {
      const len = Math.hypot(this.normX[i], this.normY[i], this.normZ[i]);
      if (len > 1e-6) {
        const inv = 1 / len;
        this.normX[i] *= inv;
        this.normY[i] *= inv;
        this.normZ[i] *= inv;
      } else {
        this.normX[i] = 0;
        this.normY[i] = 0;
        this.normZ[i] = -1;
      }
    }
  }

  private solveConstraint(
    i0: number,
    i1: number,
    restLen: number,
    stiffness: number,
    pin0: boolean,
    pin1: boolean,
  ): void {
    const dx = this.posX[i1] - this.posX[i0];
    const dy = this.posY[i1] - this.posY[i0];
    const dz = this.posZ[i1] - this.posZ[i0];
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-6) return;

    const corr = ((dist - restLen) / dist) * stiffness;
    if (pin0 && pin1) return;
    if (pin0) {
      this.posX[i1] -= dx * corr;
      this.posY[i1] -= dy * corr;
      this.posZ[i1] -= dz * corr;
    } else if (pin1) {
      this.posX[i0] += dx * corr;
      this.posY[i0] += dy * corr;
      this.posZ[i0] += dz * corr;
    } else {
      const half = corr * 0.5;
      this.posX[i0] += dx * half;
      this.posY[i0] += dy * half;
      this.posZ[i0] += dz * half;
      this.posX[i1] -= dx * half;
      this.posY[i1] -= dy * half;
      this.posZ[i1] -= dz * half;
    }
  }

  private enforceCollisions(
    bounceY: number,
    minFloorY: number,
    anchorOffsetX: number,
    isRolling: boolean,
  ): void {
    const cols = CapeClothSolver.COLS;
    const n = CapeClothSolver.VERT_COUNT;
    const rollExtraBack = isRolling ? 0.06 : 0;

    for (let i = cols; i < n; i++) {
      // 1. Plancher anti-traversée du sol
      if (this.posY[i] < minFloorY) {
        this.posY[i] = minFloorY;
        if (this.prevY[i] > minFloorY) {
          this.prevY[i] = minFloorY + (this.prevY[i] - minFloorY) * 0.35;
        }
      }

      // 2. Barrière convexe derrière le plan incliné du héros (dos, bras, armes, bouclier)
      const relX = this.posX[i] - anchorOffsetX;
      const yAboveGround = Math.max(0, this.posY[i] - bounceY);
      const heroPlaneZ = -yAboveGround * HERO_TAN_TILT;

      // Dôme dorsal arrondi derrière le torse + retrait propre derrière les armes/bouclier
      const absX = Math.abs(relX);
      const torsoDome = absX < 0.48 ? 1 - (absX / 0.48) * (absX / 0.48) : 0;
      const clearance = 0.088 + torsoDome * 0.055 + rollExtraBack;
      const maxAllowedZ = heroPlaneZ - clearance;

      if (this.posZ[i] > maxAllowedZ) {
        this.posZ[i] = maxAllowedZ;
        if (this.prevZ[i] < maxAllowedZ) {
          // Amortit le rebond contre le dos lors d'un arrêt brutal
          this.prevZ[i] = maxAllowedZ - (maxAllowedZ - this.prevZ[i]) * 0.25;
        }
      }
    }
  }

  public step(rawDt: number, input: CapeWindInput): void {
    const dt = Math.min(Math.max(Number.isFinite(rawDt) ? rawDt : 0, 0), 0.033);
    if (dt <= 0.0001) return;

    this.time += dt;
    const cols = CapeClothSolver.COLS;
    const rows = CapeClothSolver.ROWS;
    const p = this.profile;

    const vx = Number.isFinite(input.vx) ? Math.max(-22, Math.min(22, input.vx)) : 0;
    const vz = Number.isFinite(input.vz) ? Math.max(-22, Math.min(22, input.vz)) : 0;
    const vy = Number.isFinite(input.vy) ? Math.max(-18, Math.min(18, input.vy ?? 0)) : 0;
    const speed = Number.isFinite(input.speed)
      ? Math.max(0, Math.min(22, input.speed))
      : Math.hypot(vx, vz);
    const facingX = Number.isFinite(input.facingX)
      ? Math.max(-1, Math.min(1, input.facingX))
      : 1;
    const facingSign = facingX < 0 ? -1 : 1;

    const windStr = Math.max(
      0.06,
      Math.min(1.8, Number.isFinite(input.windIntensity) ? input.windIntensity : 0.2),
    );
    const stormStr = Math.max(
      0,
      Math.min(1, Number.isFinite(input.stormIntensity) ? (input.stormIntensity ?? 0) : 0),
    );
    const windDirX = Number.isFinite(input.windDirX) ? input.windDirX : 0.85;
    const windDirZ = Number.isFinite(input.windDirZ) ? input.windDirZ : 0.52;
    const bounceY = Number.isFinite(input.bounceY)
      ? Math.max(-0.25, Math.min(0.45, input.bounceY ?? 0))
      : 0;
    const elevationY = Number.isFinite(input.elevationY)
      ? Math.max(0, Math.min(4.0, input.elevationY ?? 0))
      : 0;
    const isRolling = Boolean(input.isRolling);
    const isAttacking = Boolean(input.isAttacking);
    const isJumping = Boolean(input.isJumping) || elevationY > 0.06;

    // 1. Calcul réel du déplacement monde du héros -> transfert d'inertie authentique
    let deltaWorldX = vx * dt;
    let deltaWorldY = vy * dt;
    let deltaWorldZ = vz * dt;
    if (
      Number.isFinite(input.worldX) &&
      Number.isFinite(input.worldY) &&
      Number.isFinite(input.worldZ)
    ) {
      const wx = input.worldX as number;
      const wy = input.worldY as number;
      const wz = input.worldZ as number;
      if (this.hasPrevWorld) {
        const dx = wx - this.prevWorldX;
        const dy = wy - this.prevWorldY;
        const dz = wz - this.prevWorldZ;
        const jumpDist = Math.hypot(dx, dy, dz);
        if (jumpDist > 3.5) {
          // Téléportation / transition de zone : zéro coup de fouet artificiel
          deltaWorldX = 0;
          deltaWorldY = 0;
          deltaWorldZ = 0;
        } else {
          deltaWorldX = dx;
          deltaWorldY = dy;
          deltaWorldZ = dz;
        }
      } else {
        this.hasPrevWorld = true;
      }
      this.prevWorldX = wx;
      this.prevWorldY = wy;
      this.prevWorldZ = wz;
    }

    // 2. Accélération / freinage & vitesse de virage lissés (pour réactions franches mais fluides)
    const rawAccX = Math.max(-42, Math.min(42, (vx - this.prevVx) / dt));
    const rawAccZ = Math.max(-42, Math.min(42, (vz - this.prevVz) / dt));
    const accBlend = Math.min(1, dt * 11);
    this.smoothedAccX += (rawAccX - this.smoothedAccX) * accBlend;
    this.smoothedAccZ += (rawAccZ - this.smoothedAccZ) * accBlend;

    const rawTurn = Math.max(-18, Math.min(18, (facingX - this.prevFacingX) / dt));
    this.smoothedTurnRate += (rawTurn - this.smoothedTurnRate) * Math.min(1, dt * 12);

    this.prevVx = vx;
    this.prevVz = vz;
    this.prevFacingX = facingX;

    // Impulsion de coup d'épée (torsion épaules vers le côté opposé de la frappe)
    const attackJustStarted = isAttacking && !this.wasAttacking;
    if (attackJustStarted) {
      this.attackWhipTimer = 0.28;
      this.attackWhipSign = -facingSign;
      // Impulsion cinétique immédiate sur la partie libre pour un fouetté franc et souple
      for (let r = 2; r < rows; r++) {
        const rf = r / (rows - 1);
        const impulse = rf * rf * 0.065;
        for (let c = 0; c < cols; c++) {
          const idx = r * cols + c;
          this.prevX[idx] -= this.attackWhipSign * impulse;
          this.prevZ[idx] += impulse * 0.35;
          this.prevY[idx] -= impulse * 0.18;
        }
      }
    }
    this.wasAttacking = isAttacking;
    if (this.attackWhipTimer > 0) {
      this.attackWhipTimer = Math.max(0, this.attackWhipTimer - dt);
    }

    // Position du col animée (suit le rebond de marche, s'abaisse légèrement en roulade)
    const anchorOffsetX = -0.032 * facingX;
    const anchorOffsetY = bounceY - (isRolling ? 0.16 : 0) + (isAttacking ? 0.025 : 0);
    const anchorOffsetZ = isRolling ? -0.08 : 0;

    // 3. Mise à jour des normales courantes avant aérodynamique
    this.computeVertexNormals();

    // 4. Transfert inertiel du déplacement monde vers les particules libres
    const inertiaFactor = p.inertiaScale * (isRolling ? 0.65 : 1.0);
    const invMass = 1 / Math.max(0.45, p.mass);
    const dt2 = dt * dt;
    const baseDamping = isRolling
      ? Math.min(0.84, p.damping - 0.09)
      : p.damping;
    // Normalise l'amortissement au pas de temps (invariant 30/60/120 Hz)
    const frameDamping = Math.pow(baseDamping, dt * 60);

    // Vent météo de base + souffle de croisière sur le pont (privilégie un balayage latéral lisible)
    const deckBreeze = input.isOnDeck ? 0.42 : 0;
    const effectiveWind = windStr + stormStr * 0.6 + deckBreeze;
    const baseWindX = windDirX * (1.35 + effectiveWind * 5.2) * p.windCatch;
    const baseWindZ =
      (-Math.abs(windDirZ) * 0.38 + windDirZ * 0.18) *
        (0.85 + effectiveWind * 2.4) *
        p.windCatch -
      effectiveWind * 0.55 * p.windCatch;

    // Flux d'air relatif lié à la course : forte traînée latérale (-vx) et recul maîtrisé (-Z)
    // pour que la cape ne disparaisse jamais derrière la tête en caméra 45°
    const runFlowX = -vx * 1.48;
    const runFlowZ = -Math.min(7.5, speed * 0.44) - Math.max(-2.5, vz * 0.62);

    // Saut : montée étire vers le bas, descente gonfle la cape par-dessous
    const verticalAirLift = isJumping
      ? Math.max(-5.5, Math.min(10.5, -vy * 2.35))
      : 0;

    // Torsion sur attaque et virage
    const whipStrength =
      this.attackWhipTimer > 0
        ? Math.sin((this.attackWhipTimer / 0.28) * Math.PI) * 14.5
        : 0;
    const whipAccX = this.attackWhipSign * whipStrength;
    const whipAccZ = -whipStrength * 0.34;
    const turnCentrifugalZ = -Math.min(4.2, Math.abs(this.smoothedTurnRate) * 0.45);
    const turnSwingX = -this.smoothedTurnRate * 0.92;

    // Intégration Verlet (ligne 0 épinglée aux épaules)
    for (let r = 1; r < rows; r++) {
      const rf = r / (rows - 1);
      // Transition douce près du col (r=1..2) puis liberté complète sur la chute
      const freeWeight = Math.min(1, rf * 2.6);
      const aeroWeight = (0.22 + 0.78 * Math.pow(rf, 0.85)) * (isRolling ? 0.55 : 1.0);
      const shiftScale = freeWeight * inertiaFactor;

      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const cf = c / (cols - 1);
        const centered = (cf - 0.5) * 2;

        // Décalage inertiel dans le repère du héros
        const curX = this.posX[i] - deltaWorldX * shiftScale;
        const curY = this.posY[i] - deltaWorldY * shiftScale;
        const curZ = this.posZ[i] - deltaWorldZ * shiftScale;
        const pX = this.prevX[i] - deltaWorldX * shiftScale * 0.86;
        const pY = this.prevY[i] - deltaWorldY * shiftScale * 0.86;
        const pZ = this.prevZ[i] - deltaWorldZ * shiftScale * 0.86;

        let velX = (curX - pX) * frameDamping;
        let velY = (curY - pY) * frameDamping;
        let velZ = (curZ - pZ) * frameDamping;

        // Garde-fou de vitesse par particule (zéro tremblement / explosion)
        const vLen = Math.hypot(velX, velY, velZ);
        if (vLen > 0.14) {
          const cap = 0.14 / vLen;
          velX *= cap;
          velY *= cap;
          velZ *= cap;
        }

        this.prevX[i] = curX;
        this.prevY[i] = curY;
        this.prevZ[i] = curZ;

        // Turbulence météo multi-octaves à fréquences incommensurables (zéro boucle mécanique)
        const t = this.time;
        const freqScale = 1.0 + effectiveWind * 1.15 + Math.min(1.1, speed * 0.11);
        const oct1 = Math.sin(t * 2.31 * freqScale + cf * 3.7 - rf * 4.4);
        const oct2 = Math.sin(t * 3.74 * freqScale - cf * 5.9 - rf * 2.8 + 1.13);
        const oct3 = Math.cos(t * 6.28 * freqScale + cf * 8.1 - rf * 7.2 + 2.41);
        const gustEnv = 0.62 + 0.38 * Math.sin(t * 0.83 + cf * 1.4);
        const turbMag = (0.45 + effectiveWind * 2.6 + speed * 0.16) * gustEnv * p.windCatch;

        const turbX = (oct1 * 0.55 + oct2 * 0.3 + oct3 * 0.15) * turbMag;
        const turbZ = (oct2 * 0.52 - oct1 * 0.32 + oct3 * 0.16) * turbMag * 1.12;
        const turbY = (oct1 * 0.24 + oct3 * 0.22) * turbMag * 0.55;

        // Flux d'air total appliqué à la particule
        const airX = baseWindX + runFlowX + turbX;
        const airY = verticalAirLift + turbY;
        const airZ = baseWindZ + runFlowZ + turbZ;

        // Pression aérodynamique orientée selon la normale du tissu (gonflement & plis réels)
        const nx = this.normX[i];
        const ny = this.normY[i];
        const nz = this.normZ[i];
        const dotAir = airX * nx + airY * ny + airZ * nz;
        const normalLift = 0.42;
        const dragShare = 0.68;

        const aeroAccX = (airX * dragShare + nx * dotAir * normalLift) * aeroWeight * invMass;
        const aeroAccY = (airY * dragShare + ny * dotAir * normalLift) * aeroWeight * invMass;
        const aeroAccZ = (airZ * dragShare + nz * dotAir * normalLift) * aeroWeight * invMass;

        // Force d'accélération/freinage inertielle (crée un vrai balancier à l'arrêt net)
        const inertAccX = -this.smoothedAccX * 0.14 * freeWeight;
        const inertAccZ = -Math.max(-12, Math.min(12, this.smoothedAccZ)) * 0.12 * freeWeight;

        // Portance subtile lors de la course et du vent fort (la cape se soulève naturellement)
        const liftY =
          Math.min(5.2, (speed * 0.36 + effectiveWind * 1.45) * Math.pow(rf, 0.9) * invMass);

        // Légère asymétrie des bords extérieurs dans les virages/attaques
        const edgeSwingZ = -Math.abs(centered) * (Math.abs(this.smoothedTurnRate) * 0.18 + whipStrength * 0.12);

        const accX = aeroAccX + inertAccX + (whipAccX + turnSwingX) * aeroWeight;
        const accY = -p.gravity + liftY + aeroAccY;
        const accZ = aeroAccZ + inertAccZ + (whipAccZ + turnCentrifugalZ) * aeroWeight + edgeSwingZ;

        this.posX[i] = curX + velX + accX * dt2;
        this.posY[i] = curY + velY + accY * dt2;
        this.posZ[i] = curZ + velZ + accZ * dt2;
      }
    }

    // 5. Relaxation multi-contraintes (5 itérations : structural + shear + bend + collisions)
    const minFloorY = Math.max(-elevationY + GROUND_FLOOR_MARGIN, -0.34);
    const stretchStiff = p.stretchStiffness;
    const shearStiff = p.shearStiffness;
    const bendStiff = p.bendStiffness;

    for (let iter = 0; iter < 5; iter++) {
      // Ligne 0 strictement épinglée aux épaules/col
      for (let c = 0; c < cols; c++) {
        this.posX[c] = this.restX[c] + anchorOffsetX;
        this.posY[c] = this.restY[c] + anchorOffsetY;
        this.posZ[c] = this.restZ[c] + anchorOffsetZ;
      }

      // Contraintes structurelles verticales
      for (let r = 0; r < rows - 1; r++) {
        const pinTop = r === 0;
        for (let c = 0; c < cols; c++) {
          this.solveConstraint(
            r * cols + c,
            (r + 1) * cols + c,
            this.restLenV[r * cols + c],
            stretchStiff,
            pinTop,
            false,
          );
        }
      }

      // Contraintes structurelles horizontales
      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols - 1; c++) {
          this.solveConstraint(
            r * cols + c,
            r * cols + c + 1,
            this.restLenH[r * (cols - 1) + c],
            stretchStiff * 0.9,
            false,
            false,
          );
        }
      }

      // Contraintes de cisaillement (diagonales — empêche le tissu de s'écraser ou de vriller)
      for (let r = 0; r < rows - 1; r++) {
        const pinTop = r === 0;
        for (let c = 0; c < cols - 1; c++) {
          const idx = r * (cols - 1) + c;
          this.solveConstraint(
            r * cols + c,
            (r + 1) * cols + c + 1,
            this.restLenShearA[idx],
            shearStiff,
            pinTop,
            false,
          );
          this.solveConstraint(
            r * cols + c + 1,
            (r + 1) * cols + c,
            this.restLenShearB[idx],
            shearStiff,
            pinTop,
            false,
          );
        }
      }

      // Contraintes de courbure (2-pas — produit des plis larges pour la laine/velours, fins pour la soie)
      for (let r = 0; r < rows - 2; r++) {
        const pinTop = r === 0;
        for (let c = 0; c < cols; c++) {
          this.solveConstraint(
            r * cols + c,
            (r + 2) * cols + c,
            this.restLenBendV[r * cols + c],
            bendStiff,
            pinTop,
            false,
          );
        }
      }
      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols - 2; c++) {
          this.solveConstraint(
            r * cols + c,
            r * cols + c + 2,
            this.restLenBendH[r * (cols - 2) + c],
            bendStiff * 0.82,
            false,
            false,
          );
        }
      }

      // Anti-clipping dos/bras/armes + sol à chaque passe pour cohérence géométrique
      this.enforceCollisions(bounceY, minFloorY, anchorOffsetX, isRolling);
    }

    // 6. Garde-fous stricts finaux anti-NaN & enveloppe de sécurité
    for (let i = 0; i < CapeClothSolver.VERT_COUNT; i++) {
      let x = this.posX[i];
      let y = this.posY[i];
      let z = this.posZ[i];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        x = this.restX[i] + anchorOffsetX;
        y = this.restY[i] + anchorOffsetY;
        z = this.restZ[i] + anchorOffsetZ;
        this.prevX[i] = x;
        this.prevY[i] = y;
        this.prevZ[i] = z;
      }

      if (i < cols) {
        this.posX[i] = this.restX[i] + anchorOffsetX;
        this.posY[i] = this.restY[i] + anchorOffsetY;
        this.posZ[i] = this.restZ[i] + anchorOffsetZ;
      } else {
        this.posX[i] = Math.max(-1.45, Math.min(1.45, x));
        this.posY[i] = Math.max(minFloorY, Math.min(COLLAR_BASE_Y + bounceY + 0.42, y));
        this.posZ[i] = Math.max(-1.62, Math.min(z, -0.05));
      }
    }

    this.enforceCollisions(bounceY, minFloorY, anchorOffsetX, isRolling);
    this.computeVertexNormals();
  }
}

const FALLBACK_CAPE_FABRIC_TEX = (() => {
  const data = new Uint8Array([255, 255, 255, 255]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
})();

interface CapeShaderUniforms {
  uCapePrimary: { value: THREE.Color };
  uCapeSecondary: { value: THREE.Color };
  uCapeAccent: { value: THREE.Color };
  uCapeGlow: { value: THREE.Color };
  uCapeStyle: { value: THREE.Vector4 };
  uCapeTime: { value: number };
  uCapeFabricMap: { value: THREE.Texture };
  uCapeUseFabricMap: { value: number };
}

function applyClothTextileShader(
  material: THREE.MeshStandardMaterial,
  uniforms: CapeShaderUniforms,
): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, SPRITE_LIGHT_UNIFORMS);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vCapeUv;
        varying vec3 vCapeWorldPos;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vCapeUv = uv;
        vCapeWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vCapeUv;
        varying vec3 vCapeWorldPos;
        uniform vec3 uCapePrimary;
        uniform vec3 uCapeSecondary;
        uniform vec3 uCapeAccent;
        uniform vec3 uCapeGlow;
        uniform vec4 uCapeStyle;
        uniform float uCapeTime;
        uniform sampler2D uCapeFabricMap;
        uniform float uCapeUseFabricMap;
        uniform vec4 uSpriteLightPositionRange[${SPRITE_LIGHT_COUNT}];
        uniform vec4 uSpriteLightColorIntensity[${SPRITE_LIGHT_COUNT}];

        float capeHash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Silhouette d'ourlet souple arrondi aux coins inférieurs
        vec2 cUv = vCapeUv;
        float sideDist = abs(cUv.x - 0.5) * 2.0; // 0 au centre, 1 sur les bords
        float cornerCut = smoothstep(0.68, 1.0, sideDist) * 0.085;
        float scallop = sin(sideDist * 3.14159 * 2.0) * 0.012;
        float hemEdge = cornerCut + scallop;
        if (cUv.y < hemEdge) discard;

        // Tissage textile fin + plis subtils
        float weaveScale = uCapeStyle.w;
        float twill = sin(cUv.x * weaveScale + cUv.y * weaveScale * 0.85) *
                      sin(cUv.x * weaveScale * 0.72 - cUv.y * weaveScale * 1.15);
        float verticalShade = mix(0.84, 1.08, smoothstep(0.0, 0.92, cUv.y));

        vec3 clothCol;
        if (uCapeUseFabricMap > 0.5) {
          // Couche de texture de cape dédiée : conserve 100 % du drapé, des plis Verlet,
          // de la doublure interne et de l'éclairage local tout en lisant le motif peint.
          vec4 fabricSample = texture2D(uCapeFabricMap, cUv);
          if (fabricSample.a < 0.15) discard;
          vec3 outerTex = fabricSample.rgb * (1.0 + twill * 0.03) * verticalShade;
          vec3 innerTex = mix(fabricSample.rgb * 0.58, uCapeSecondary * 0.65, 0.25) * (1.0 + twill * 0.02);
          clothCol = gl_FrontFacing ? outerTex : innerTex;
        } else {
          // Couleur de base + contraste doublure intérieure vs face extérieure
          vec3 outerCloth = mix(uCapeSecondary, uCapePrimary, 0.62 + 0.38 * smoothstep(0.08, 0.88, cUv.y));
          outerCloth *= (1.0 + twill * 0.048) * verticalShade;
          vec3 innerLining = mix(uCapeSecondary * 0.68, uCapePrimary * 0.52, 0.35) * (1.0 + twill * 0.03);
          clothCol = gl_FrontFacing ? outerCloth : innerLining;

          // Motifs & broderies distincts par cape
          float patternId = uCapeStyle.x;
          float hemBand = smoothstep(hemEdge + 0.015, hemEdge + 0.038, cUv.y) *
                          (1.0 - smoothstep(hemEdge + 0.095, hemEdge + 0.125, cUv.y));
          float sideTrim = smoothstep(0.84, 0.93, sideDist) * smoothstep(hemEdge + 0.01, hemEdge + 0.05, cUv.y);
          float collarTrim = smoothstep(0.90, 0.96, cUv.y);

          // Bordure brodée commune (plus riche selon le modèle)
          float trimMask = clamp(hemBand * 0.88 + sideTrim * 0.42 + collarTrim * 0.55, 0.0, 1.0);
          if (patternId > 0.5 && patternId < 1.5) {
            // Manteau de Chat-valier : double filet doré + chevron central
            float secondBand = smoothstep(hemEdge + 0.135, hemEdge + 0.15, cUv.y) *
                               (1.0 - smoothstep(hemEdge + 0.165, hemEdge + 0.18, cUv.y));
            float chevronY = hemEdge + 0.24 - sideDist * 0.14;
            float chevron = exp(-pow((cUv.y - chevronY) * 26.0, 2.0)) * (1.0 - smoothstep(0.35, 0.62, sideDist));
            trimMask = clamp(trimMask + secondBand * 0.72 + chevron * 0.78, 0.0, 1.0);
          } else if (patternId >= 1.5 && patternId < 2.5) {
            // Cape de Nuit Étoilée : constellations fines + lueur stellaire douce
            vec2 starGrid = floor(cUv * vec2(11.0, 14.0));
            vec2 starLocal = fract(cUv * vec2(11.0, 14.0)) - 0.5;
            float rnd = capeHash(starGrid);
            if (rnd > 0.76 && cUv.y > hemEdge + 0.14 && cUv.y < 0.88) {
              float twinkle = 0.55 + 0.45 * sin(uCapeTime * (2.6 + rnd * 3.5) + rnd * 25.0);
              float starDot = exp(-dot(starLocal, starLocal) * 46.0) * twinkle;
              clothCol += uCapeAccent * starDot * 0.95;
            }
          } else if (patternId >= 2.5) {
            // Cape Royale Draconique : jacquard losange velours + broderie royale dorée
            float diamond = abs(sin((cUv.x * 10.0 + cUv.y * 12.0) * 3.14159) *
                                sin((cUv.x * 10.0 - cUv.y * 12.0) * 3.14159));
            clothCol = mix(clothCol, uCapeSecondary * 0.85, (1.0 - diamond) * 0.16);
            float ornateWave = hemEdge + 0.14 + 0.025 * sin(cUv.x * 31.4159);
            float ornateLine = exp(-pow((cUv.y - ornateWave) * 34.0, 2.0));
            trimMask = clamp(trimMask + ornateLine * 0.85, 0.0, 1.0);
          }

          if (gl_FrontFacing) {
            clothCol = mix(clothCol, uCapeAccent, trimMask * 0.86);
          } else {
            clothCol = mix(clothCol, uCapeAccent * 0.65, trimMask * 0.45);
          }

          // Liseré cousu sombre discret sur l'ourlet pour harmoniser avec le style peint Cat Quest
          float edgeOutline = 1.0 - smoothstep(hemEdge, hemEdge + 0.024, cUv.y);
          float sideOutline = smoothstep(0.945, 0.995, sideDist);
          float seamMask = clamp(max(edgeOutline, sideOutline), 0.0, 1.0);
          clothCol = mix(clothCol, uCapeSecondary * 0.34, seamMask * 0.72);
        }

        diffuseColor.rgb = clothCol;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// Ombrage doux des plis + velours/soie rasant (sheen) + lumières locales partagées
        vec3 capeViewDir = normalize(vViewPosition);
        float grazing = pow(1.0 - abs(dot(normalize(normal), capeViewDir)), 2.5);
        float sheenAmt = uCapeStyle.y * grazing * (gl_FrontFacing ? 0.38 : 0.18);
        outgoingLight += mix(diffuseColor.rgb, uCapeAccent, 0.25) * sheenAmt;

        // Légère occlusion dans les creux de plis pour renforcer la lecture textile 3D
        float foldRelief = clamp(abs(normal.z) * 0.32 + max(normal.y, 0.0) * 0.18 + 0.68, 0.62, 1.12);
        outgoingLight *= foldRelief;

        // Plancher de lisibilité nocturne identique à spriteLighting.ts
        outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.34);

        // Éclat stellaire strictement localisé pour les capes lumineuses
        if (uCapeStyle.z > 0.01 && gl_FrontFacing) {
          float hemGlow = smoothstep(0.28, 0.04, vCapeUv.y) * 0.65 + 0.35;
          outgoingLight += uCapeGlow * uCapeStyle.z * hemGlow * 0.42;
        }

        // Sources dynamiques locales partagées (lampadaires, torches, lanterne du héros)
        for (int i = 0; i < ${SPRITE_LIGHT_COUNT}; i++) {
          vec4 positionRange = uSpriteLightPositionRange[i];
          vec4 colorIntensity = uSpriteLightColorIntensity[i];
          if (colorIntensity.w <= 0.0) continue;
          vec3 toLight = positionRange.xyz - vCapeWorldPos;
          float distanceToLight = length(toLight);
          float normalizedDistance = distanceToLight / max(positionRange.w, 0.001);
          float attenuation = pow(max(1.0 - normalizedDistance, 0.0), 2.0);
          float localStrength = min(colorIntensity.w * 0.11, 0.72) * attenuation;
          outgoingLight += diffuseColor.rgb * colorIntensity.rgb * localStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'fel-ingard-soft-cloth-cape-v2';
  material.needsUpdate = true;
}

export class CapeClothMesh {
  public readonly solver = new CapeClothSolver();
  public readonly geometry: THREE.BufferGeometry;
  public readonly material: THREE.MeshStandardMaterial;
  public readonly mesh: THREE.Mesh;

  private readonly posAttr: THREE.BufferAttribute;
  private readonly normAttr: THREE.BufferAttribute;
  private readonly posBuffer: Float32Array;
  private readonly normBuffer: Float32Array;
  private readonly shaderUniforms: CapeShaderUniforms;
  private activeCapeId = '';

  constructor() {
    const cols = this.solver.cols;
    const rows = this.solver.rows;
    const vertCount = this.solver.vertexCount;

    this.posBuffer = new Float32Array(vertCount * 3);
    this.normBuffer = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices: number[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const o = i * 3;
        this.posBuffer[o] = this.solver.posX[i];
        this.posBuffer[o + 1] = this.solver.posY[i];
        this.posBuffer[o + 2] = this.solver.posZ[i];
        this.normBuffer[o] = this.solver.normX[i];
        this.normBuffer[o + 1] = this.solver.normY[i];
        this.normBuffer[o + 2] = this.solver.normZ[i];
        uvs[i * 2] = c / (cols - 1);
        uvs[i * 2 + 1] = 1 - r / (rows - 1);
      }
    }

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = (r + 1) * cols + c;
        const e = d + 1;
        indices.push(a, d, b, b, d, e);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.posBuffer, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.normAttr = new THREE.BufferAttribute(this.normBuffer, 3);
    this.normAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.normAttr);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);

    this.shaderUniforms = {
      uCapePrimary: { value: new THREE.Color(DEFAULT_CAPE_PROFILE.primaryColor) },
      uCapeSecondary: { value: new THREE.Color(DEFAULT_CAPE_PROFILE.secondaryColor) },
      uCapeAccent: { value: new THREE.Color(DEFAULT_CAPE_PROFILE.accentColor) },
      uCapeGlow: { value: new THREE.Color(DEFAULT_CAPE_PROFILE.glowColor) },
      uCapeStyle: {
        value: new THREE.Vector4(
          DEFAULT_CAPE_PROFILE.patternId,
          DEFAULT_CAPE_PROFILE.sheen,
          0,
          DEFAULT_CAPE_PROFILE.weaveScale,
        ),
      },
      uCapeTime: { value: 0 },
      uCapeFabricMap: { value: FALLBACK_CAPE_FABRIC_TEX },
      uCapeUseFabricMap: { value: 0 },
    };

    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: DEFAULT_CAPE_PROFILE.roughness,
      metalness: 0.05,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    });
    applyClothTextileShader(this.material, this.shaderUniforms);

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'HeroCapeClothMesh';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    this.mesh.userData.skipSSAO = true;
  }

  public setCapeAppearance(
    spec: CapeAppearanceSpec | null,
  ): void {
    if (!spec || !spec.id) {
      this.activeCapeId = '';
      this.mesh.visible = false;
      this.shaderUniforms.uCapeFabricMap.value = FALLBACK_CAPE_FABRIC_TEX;
      this.shaderUniforms.uCapeUseFabricMap.value = 0;
      return;
    }

    const profile = getCapeMaterialProfile(spec.id, spec);
    this.activeCapeId = profile.id;
    this.mesh.visible = true;
    this.solver.setMaterialProfile(profile);

    this.shaderUniforms.uCapePrimary.value.set(profile.primaryColor);
    this.shaderUniforms.uCapeSecondary.value.set(profile.secondaryColor);
    this.shaderUniforms.uCapeAccent.value.set(profile.accentColor);
    this.shaderUniforms.uCapeGlow.value.set(profile.luminous ? profile.glowColor : '#000000');
    this.shaderUniforms.uCapeStyle.value.set(
      profile.patternId,
      profile.sheen,
      profile.luminous ? 1.0 : 0.0,
      profile.weaveScale,
    );
    if (spec.fabricTexture) {
      this.shaderUniforms.uCapeFabricMap.value = spec.fabricTexture;
      this.shaderUniforms.uCapeUseFabricMap.value = 1;
    } else {
      this.shaderUniforms.uCapeFabricMap.value = FALLBACK_CAPE_FABRIC_TEX;
      this.shaderUniforms.uCapeUseFabricMap.value = 0;
    }
    this.material.roughness = profile.roughness;
  }

  public hasCustomFabricTexture(): boolean {
    return this.shaderUniforms.uCapeUseFabricMap.value > 0.5;
  }

  public getActiveCapeId(): string {
    return this.activeCapeId;
  }

  public update(dt: number, input: CapeWindInput): void {
    if (!this.mesh.visible) return;
    this.solver.step(dt, input);
    this.shaderUniforms.uCapeTime.value = this.solver.time;
    this.syncGeometryBuffers();
  }

  public reset(): void {
    this.solver.reset();
    this.shaderUniforms.uCapeTime.value = 0;
    this.syncGeometryBuffers();
  }

  private syncGeometryBuffers(): void {
    const n = this.solver.vertexCount;
    const sx = this.solver.posX;
    const sy = this.solver.posY;
    const sz = this.solver.posZ;
    const nx = this.solver.normX;
    const ny = this.solver.normY;
    const nz = this.solver.normZ;
    for (let i = 0; i < n; i++) {
      const o = i * 3;
      this.posBuffer[o] = sx[i];
      this.posBuffer[o + 1] = sy[i];
      this.posBuffer[o + 2] = sz[i];
      this.normBuffer[o] = nx[i];
      this.normBuffer[o + 1] = ny[i];
      this.normBuffer[o + 2] = nz[i];
    }
    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
