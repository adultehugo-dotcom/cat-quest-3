import * as THREE from 'three';
import type { GameState } from '../game/types';
import { ALL_NEW_ISLANDS, NEW_ISLANDS } from '../data/worldIslands';
import { configureDioramaTexture } from '../art/hdAssets';
import { createCanvas, createSeededRandom, drawStar } from '../art/palette';
import {
  type OceanCoastIsland,
  sampleOceanCoastDistance,
  sampleOceanWaveHeight,
} from './shaders/waterShader';
import type { WeatherSnapshot } from './weatherSystem';
import {
  type SailWindUniforms,
  applySailWindShader,
  createBowFoamMaterial,
  createHullRippleMaterial,
  createShipWakeMaterial,
  createWindStreakMaterial,
} from './shaders/shipShaders';

// ============================================================================
// ShipRenderer — Voilier d'Aventure 3D « Le Patte-au-Vent » & Effets Maritimes
//
// Repère local canonique Three.js (arbitrage unifié Physique <-> Rendu 3D) :
//   - Proue (Bow / Avant)     : -Z  (z = -2.55, beaupré jusqu'à z = -3.10)
//   - Poupe (Stern / Arrière) : +Z  (z = +2.45, safran jusqu'à z = +2.90)
//   - Tribord (Droite)        : +X  (x = +1.40)
//   - Bâbord (Gauche)         : -X  (x = -1.40)
//   - Mât (Haut)              : +Y  (quille = -0.55, pont DECK_Y = +0.56)
//   - Rotation monde          : shipYawGroup.rotation.y = state.ship.angle
// ============================================================================

const WATER_LEVEL_Y = -0.14;
const DECK_Y = 0.56;
const MAST_Z = -0.75;
const MAST_HEIGHT = 3.95; // sommet à y = 4.51 au-dessus de flottaison
const MAX_RUDDER_RAD = THREE.MathUtils.degToRad(28);
const MAX_REF_SPEED = 14.0;

const WAKE_SEGMENTS = 36;
const SPRAY_POOL_SIZE = 48;
const WIND_STREAK_COUNT = 6;

const HERO_LOCAL_ANCHOR = new THREE.Vector3(0.0, DECK_Y, 0.55);
const COMPANION_LOCAL_ANCHOR = new THREE.Vector3(-0.82, 0.70, 1.25);

const ARCHIPELAGO_COASTS: readonly OceanCoastIsland[] = [
  { x: 0, z: 0, radius: 52.5, isMain: true },
  ...ALL_NEW_ISLANDS.map((id) => ({
    x: NEW_ISLANDS[id].centerX,
    z: NEW_ISLANDS[id].centerZ,
    radius: NEW_ISLANDS[id].radius,
    isMain: false,
  })),
];

export interface ShipDeckAnchors {
  heroWorldPos: THREE.Vector3;
  companionWorldPos: THREE.Vector3;
  deckRoll: number;
  deckPitch: number;
  waterY: number;
}

interface ShipTextureBundle {
  woodAlbedo: THREE.Texture;
  woodNormal: THREE.Texture;
  woodRoughness: THREE.Texture;
  sailAlbedo: THREE.Texture;
  sailNormal: THREE.Texture;
}

// ============================================================================
// Utilitaires géométriques purs (fusion statique & courbes navales)
// ============================================================================

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function safeExpAlpha(rate: number, dt: number): number {
  return dt > 0 ? 1 - Math.exp(-rate * dt) : 1;
}

/**
 * Fusionne plusieurs `BufferGeometry` statiques partageant le même matériau
 * en un seul maillage (1 draw call) et libère les géométries sources.
 */
function mergeStaticGeometries(
  geometries: THREE.BufferGeometry[],
): THREE.BufferGeometry {
  const normalized: THREE.BufferGeometry[] = [];
  let totalVerts = 0;

  for (const raw of geometries) {
    const g = raw.index ? raw.toNonIndexed() : raw;
    if (!g.getAttribute('normal')) {
      g.computeVertexNormals();
    }
    const posAttr = g.getAttribute('position');
    if (!posAttr || posAttr.count === 0) {
      if (g !== raw) g.dispose();
      raw.dispose();
      continue;
    }
    totalVerts += posAttr.count;
    normalized.push(g);
    if (g !== raw) {
      raw.dispose();
    }
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);

  let offset = 0;
  for (const g of normalized) {
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      const i3 = (offset + i) * 3;
      const i2 = (offset + i) * 2;
      positions[i3] = pos.getX(i);
      positions[i3 + 1] = pos.getY(i);
      positions[i3 + 2] = pos.getZ(i);

      normals[i3] = norm ? norm.getX(i) : 0;
      normals[i3 + 1] = norm ? norm.getY(i) : 1;
      normals[i3 + 2] = norm ? norm.getZ(i) : 0;

      uvs[i2] = uv ? uv.getX(i) : 0.5;
      uvs[i2 + 1] = uv ? uv.getY(i) : 0.9;
    }
    offset += count;
    g.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return merged;
}

/**
 * Remappe les UVs d'une géométrie dans une bande verticale `[vMin, vMax]` de l'atlas bois.
 */
function remapGeometryUVBand(
  geo: THREE.BufferGeometry,
  uMin: number,
  uMax: number,
  vMin: number,
  vMax: number,
): THREE.BufferGeometry {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    uv.setXY(i, uMin + u * (uMax - uMin), vMin + v * (vMax - vMin));
  }
  uv.needsUpdate = true;
  return geo;
}

// ============================================================================
// Courbes paramétriques navales de la coque (18 couples : z ∈ [-2.55, +2.45])
// ============================================================================

const HULL_BOW_Z = -2.55;
const HULL_STERN_Z = 2.45;
const HULL_LENGTH = HULL_STERN_Z - HULL_BOW_Z; // 5.0 u

function hullStationZ(s: number): number {
  return HULL_BOW_Z + s * HULL_LENGTH;
}

/** Demi-largeur extérieure (maître-bau = 1.40 u → largeur totale 2.80 u). */
function hullHalfBeam(s: number): number {
  if (s <= 0) return 0.025;
  // Montée galbée de la proue effilée vers des épaules pleines
  const bowProfile = Math.pow(Math.sin(Math.min(1, s / 0.52) * Math.PI * 0.5), 0.72);
  // Retombée gracieuse vers un tableau arrière arrondi (largeur ~0.90 u à la poupe)
  const sternTaper =
    s <= 0.52
      ? 1.0
      : 1.0 - 0.34 * Math.pow((s - 0.52) / 0.48, 1.85);
  return Math.max(0.025, 1.40 * bowProfile * sternTaper);
}

/** Hauteur du pavois (courbe de tonture : 1.26 proue -> 0.92 milieu -> 1.18 poupe). */
function hullSheerY(s: number): number {
  const bowLift = Math.pow(Math.max(0, 1 - s / 0.52), 2.15) * 0.34;
  const sternLift = Math.pow(Math.max(0, (s - 0.52) / 0.48), 2.0) * 0.26;
  return 0.92 + bowLift + sternLift;
}

/** Ligne de quille (tirant d'eau -0.55 u au centre, relèvement étrave/étambot). */
function hullKeelY(s: number): number {
  const bowRise = Math.pow(Math.max(0, 1 - s / 0.28), 2.3) * 0.72;
  const sternRise = Math.pow(Math.max(0, (s - 0.78) / 0.22), 2.0) * 0.32;
  return -0.55 + bowRise + sternRise;
}

/** Épaisseur du pavois / bordé pour la paroi interne du cockpit. */
function hullWallThickness(s: number): number {
  return 0.09 + 0.05 * smoothstep(0.05, 0.25, s);
}

/** Demi-largeur intérieure au niveau du pont DECK_Y (largeur utile ~2.46 u au poste héros). */
function deckInnerHalfBeam(s: number): number {
  const outer = hullHalfBeam(s);
  const deckScale = 0.96 - 0.04 * (1 - smoothstep(0.08, 0.28, s));
  return Math.max(0.015, outer * deckScale - hullWallThickness(s));
}

/**
 * Évalue un point `(x, y)` d'un demi-couple de coque (côté tribord `+X`).
 * `t ∈ [0..1]` va de la quille (`t = 0`) au bouchain arrondi puis jusqu'au plat-bord (`t = 1`).
 */
function sampleHullCrossSection(
  s: number,
  t: number,
): { x: number; y: number } {
  const halfB = hullHalfBeam(s);
  const keelY = hullKeelY(s);
  const sheerY = hullSheerY(s);

  // Plein de carène : plus fin/en V à la proue, plus rond et stable au maître-bau
  const fullness = 0.48 + 0.36 * smoothstep(0.06, 0.38, s) - 0.10 * smoothstep(0.82, 1.0, s);
  // Dévers de proue (flare) + léger rentré en haut de muraille (tumblehome) au milieu
  const flare = (1 - smoothstep(0.0, 0.35, s)) * 0.14 * Math.pow(t, 1.8);
  const tumblehome = smoothstep(0.28, 0.75, s) * 0.045 * Math.pow(Math.max(0, t - 0.65) / 0.35, 1.5);

  const widthFactor = Math.pow(Math.sin(t * Math.PI * 0.5), fullness);
  const x = halfB * Math.max(0, widthFactor + flare - tumblehome);

  // Progression verticale douce : montée lente au bouchain puis plus droite sur les flancs
  const yNorm = Math.pow(t, 1.24);
  const y = keelY + (sheerY - keelY) * yNorm;
  return { x, y };
}

// ============================================================================
// Génération des textures PBR Canvas2D (512×512) — créées une seule fois
// ============================================================================

function generateNormalCanvasFromHeight(
  height: Float32Array,
  size: number,
  strength: number,
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const sample = (x: number, y: number): number => {
    const cx = ((x % size) + size) % size;
    const cy = clamp(y, 0, size - 1);
    return height[cy * size + cx];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);

      const idx = (y * size + x) * 4;
      data[idx] = Math.round((-dx * invLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

function createShipWoodPbrCanvases(): {
  albedo: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
} {
  const size = 512;
  const { canvas: albedo, ctx } = createCanvas(size, size);
  const { canvas: roughness, ctx: rCtx } = createCanvas(size, size);
  const height = new Float32Array(size * size);
  const rand = createSeededRandom(7331);

  // Helper pour peindre des planches horizontales avec veines, joints et heightmap
  const paintPlankBand = (
    yStart: number,
    yEnd: number,
    plankCount: number,
    colors: string[],
    seamColor: string,
    baseRough: number,
    withNails: boolean,
  ) => {
    const bandH = yEnd - yStart;
    const plankH = bandH / plankCount;

    for (let p = 0; p < plankCount; p++) {
      const py0 = Math.floor(yStart + p * plankH);
      const py1 = Math.floor(yStart + (p + 1) * plankH);
      const col = colors[p % colors.length];

      // Fond de planche + ombre basse et reflet haut pour volume bombé
      ctx.fillStyle = col;
      ctx.fillRect(0, py0, size, py1 - py0);

      // Légère variation d'ombre en bas de virure
      ctx.fillStyle = 'rgba(43, 30, 22, 0.18)';
      ctx.fillRect(0, py1 - 3, size, 3);
      ctx.fillStyle = 'rgba(255, 240, 205, 0.08)';
      ctx.fillRect(0, py0 + 1, size, 2);

      // Roughness de la planche
      const rVal = Math.round(clamp(baseRough + (rand() - 0.5) * 0.08, 0.35, 0.95) * 255);
      rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
      rCtx.fillRect(0, py0, size, py1 - py0);

      // Fibres & veines organiques du bois
      const grainCount = 10;
      for (let g = 0; g < grainCount; g++) {
        const gy = py0 + 2 + rand() * Math.max(2, py1 - py0 - 4);
        const dark = rand() > 0.45;
        ctx.strokeStyle = dark
          ? `rgba(43, 25, 14, ${0.10 + rand() * 0.14})`
          : `rgba(248, 210, 152, ${0.06 + rand() * 0.10})`;
        ctx.lineWidth = 1 + rand() * 1.4;
        ctx.beginPath();
        const amp = 1.2 + rand() * 2.2;
        const phase = rand() * Math.PI * 2;
        for (let x = 0; x <= size; x += 16) {
          const yOff = Math.sin((x / size) * Math.PI * 2 * (1 + (g % 2)) + phase) * amp;
          if (x === 0) ctx.moveTo(x, gy + yOff);
          else ctx.lineTo(x, gy + yOff);
        }
        ctx.stroke();
      }

      // Joints verticaux en quinconce + clous de chevillage
      const joints = 3;
      const phaseX = ((p * 173 + 57) % size);
      for (let j = 0; j < joints; j++) {
        const jx = (phaseX + Math.floor((j * size) / joints)) % size;
        ctx.fillStyle = seamColor;
        ctx.fillRect(jx, py0, 2, py1 - py0);
        rCtx.fillStyle = 'rgb(235,235,235)';
        rCtx.fillRect(jx, py0, 2, py1 - py0);

        if (withNails) {
          const midY = (py0 + py1) * 0.5;
          for (const nx of [jx - 6, jx + 8]) {
            const wx = ((nx % size) + size) % size;
            ctx.fillStyle = '#3b2416';
            ctx.beginPath();
            ctx.arc(wx, midY - plankH * 0.2, 2.0, 0, Math.PI * 2);
            ctx.arc(wx, midY + plankH * 0.2, 2.0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(235, 195, 110, 0.55)';
            ctx.beginPath();
            ctx.arc(wx - 0.5, midY - plankH * 0.2 - 0.5, 0.9, 0, Math.PI * 2);
            ctx.arc(wx - 0.5, midY + plankH * 0.2 - 0.5, 0.9, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Creux du joint vertical dans heightmap
        for (let y = py0; y < py1; y++) {
          height[y * size + jx] -= 0.45;
          height[y * size + ((jx + 1) % size)] -= 0.35;
        }
      }

      // Joint horizontal sombre (calfatage)
      ctx.fillStyle = seamColor;
      ctx.fillRect(0, py0, size, 2);
      rCtx.fillStyle = 'rgb(238,238,238)';
      rCtx.fillRect(0, py0, size, 2);

      // Remplissage heightmap (profil bombé de la planche + micro-grain)
      for (let y = py0; y < py1; y++) {
        const localT = (y - py0) / Math.max(1, py1 - py0);
        const bevel = Math.sin(localT * Math.PI);
        const isSeam = y - py0 < 2;
        for (let x = 0; x < size; x++) {
          const fiber = Math.sin(x * 0.075 + y * 0.62 + p * 2.1) * 0.08;
          height[y * size + x] += isSeam ? 0.08 : 0.45 + bevel * 0.42 + fiber;
        }
      }
    }
  };

  // --- Bande 1 (HAUT canvas py 0..104 -> UV v ∈ [0.80, 1.00]) : Bois sculpté plats-bords/mât/props ---
  paintPlankBand(
    0,
    104,
    4,
    ['#9d6030', '#8b5126', '#aa6c39', '#7d4720'],
    '#321e14',
    0.66,
    false,
  );

  // --- Bande 2 (MILIEU canvas py 104..256 -> UV v ∈ [0.50, 0.80]) : Pont en teck miel lumineux ---
  paintPlankBand(
    104,
    256,
    8,
    ['#ca9554', '#be8747', '#d29f5f', '#b88042', '#c89252'],
    '#4a3325',
    0.70,
    true,
  );

  // --- Bande 3a (py 256..402 -> UV v ∈ [0.215, 0.50]) : Bordés extérieurs acajou/chêne verni ---
  paintPlankBand(
    256,
    402,
    6,
    ['#8d4f28', '#a15d30', '#7c4320', '#96562b', '#834723', '#9d5b2e'],
    '#2b1e16',
    0.64,
    true,
  );

  // --- Bande 3b (py 402..434 -> UV v ∈ [0.152, 0.215]) : Liseré signature turquoise & or de Félingard ---
  ctx.fillStyle = '#c89432';
  ctx.fillRect(0, 402, size, 4);
  ctx.fillStyle = '#2da8aa';
  ctx.fillRect(0, 406, size, 22);
  // Subtle brushstroke highlights sur le bandeau turquoise
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = i % 2 === 0 ? 'rgba(130, 240, 238, 0.14)' : 'rgba(20, 95, 108, 0.16)';
    ctx.fillRect(rand() * size, 408 + rand() * 16, 48 + rand() * 80, 2.5);
  }
  ctx.fillStyle = '#e5d4ae';
  ctx.fillRect(0, 428, size, 6);
  rCtx.fillStyle = 'rgb(142,142,142)';
  rCtx.fillRect(0, 402, size, 32);
  for (let y = 402; y < 434; y++) {
    const ridge = y < 406 || y >= 428 ? 0.92 : 0.72;
    for (let x = 0; x < size; x++) {
      height[y * size + x] = ridge;
    }
  }

  // --- Bande 3c (py 434..512 -> UV v ∈ [0.00, 0.152]) : Œuvres vives goudronnées sombres ---
  paintPlankBand(
    434,
    512,
    4,
    ['#4e2b18', '#422212', '#57311c', '#3d1f10'],
    '#22130b',
    0.46, // plus humide au contact de la mer
    false,
  );

  const normal = generateNormalCanvasFromHeight(height, size, 2.2);
  return { albedo, normal, roughness };
}

function createShipSailPbrCanvases(): {
  albedo: HTMLCanvasElement;
  normal: HTMLCanvasElement;
} {
  const size = 512;
  const { canvas: albedo, ctx } = createCanvas(size, size);
  const height = new Float32Array(size * size);
  const rand = createSeededRandom(9001);

  // 1. Toile de lin ivoire chaud (calibré #dfd0ae -> linéaire < 0.76, zéro Bloom parasite)
  const bgGrad = ctx.createLinearGradient(0, 0, 0, size);
  bgGrad.addColorStop(0, '#e3d5b5');
  bgGrad.addColorStop(0.55, '#dcd0b0');
  bgGrad.addColorStop(1, '#cfc09d');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // 2. Trame tissée organique du lin (chaîne & trame + heightmap)
  for (let y = 0; y < size; y += 4) {
    ctx.fillStyle = y % 8 === 0 ? 'rgba(130, 102, 68, 0.05)' : 'rgba(255, 248, 232, 0.05)';
    ctx.fillRect(0, y, size, 2);
  }
  for (let x = 0; x < size; x += 4) {
    ctx.fillStyle = x % 8 === 0 ? 'rgba(130, 102, 68, 0.045)' : 'rgba(255, 248, 232, 0.045)';
    ctx.fillRect(x, 0, 2, size);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const weave = Math.sin(x * 1.1) * Math.sin(y * 1.1) * 0.14;
      height[y * size + x] = 0.5 + weave;
    }
  }

  // 3. Coutures verticales de 5 laizes de toile
  const panels = 5;
  for (let i = 1; i < panels; i++) {
    const sx = Math.round((i / panels) * size);
    ctx.fillStyle = 'rgba(110, 82, 52, 0.24)';
    ctx.fillRect(sx - 2, 0, 4, size);
    ctx.strokeStyle = 'rgba(92, 66, 40, 0.42)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(sx - 4, 0);
    ctx.lineTo(sx - 4, size);
    ctx.moveTo(sx + 4, 0);
    ctx.lineTo(sx + 4, size);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let y = 0; y < size; y++) {
      for (let dx = -3; dx <= 3; dx++) {
        const px = clamp(sx + dx, 0, size - 1);
        height[y * size + px] += dx === 0 ? -0.22 : 0.16;
      }
    }
  }

  // 4. Galons supérieur et inférieur corail & or (signature Félingard)
  const drawBorderBand = (y0: number, h: number) => {
    ctx.fillStyle = '#bc3c34';
    ctx.fillRect(0, y0, size, h);
    ctx.fillStyle = '#d49a34';
    ctx.fillRect(0, y0, size, 5);
    ctx.fillRect(0, y0 + h - 5, size, 5);
    ctx.strokeStyle = '#4a3325';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(size, y0);
    ctx.moveTo(0, y0 + h);
    ctx.lineTo(size, y0 + h);
    ctx.stroke();

    for (let y = y0; y < y0 + h; y++) {
      for (let x = 0; x < size; x++) {
        height[y * size + x] += 0.24;
      }
    }
  };
  drawBorderBand(12, 34);
  drawBorderBand(size - 48, 34);

  // Renforts d'angle en cuir/lin cousu
  ctx.fillStyle = 'rgba(168, 128, 76, 0.32)';
  const corners: Array<[number, number, number, number]> = [
    [0, 0, 58, 58],
    [size, 0, size - 58, 58],
    [0, size, 58, size - 58],
    [size, size, size - 58, size - 58],
  ];
  for (const [x0, y0, x1, y1] of corners) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x0, y1);
    ctx.closePath();
    ctx.fill();
  }

  // 5. Emblème central peint de Félingard (Rose des vents or + anneau turquoise + patte féline)
  const cx = size * 0.5;
  const cy = size * 0.50;

  // Halo peint doux parchemin
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 122, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(45, 168, 170, 0.14)';
  ctx.fill();

  // Anneau turquoise cerclé d'or
  ctx.beginPath();
  ctx.arc(cx, cy, 108, 0, Math.PI * 2);
  ctx.strokeStyle = '#2d9d9f';
  ctx.lineWidth = 12;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 114, 0, Math.PI * 2);
  ctx.strokeStyle = '#c88c28';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 98, 0, Math.PI * 2);
  ctx.strokeStyle = '#4a3325';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Rose des vents à 8 branches dorées
  drawStar(ctx, cx, cy, 8, 128, 56, -Math.PI / 2);
  ctx.fillStyle = '#cf922a';
  ctx.fill();
  ctx.strokeStyle = '#4a3325';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Disque central ivoire pour la patte féline
  ctx.beginPath();
  ctx.arc(cx, cy, 66, 0, Math.PI * 2);
  ctx.fillStyle = '#dfd0af';
  ctx.fill();
  ctx.strokeStyle = '#c88c28';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Empreinte de patte de chat stylisée (coussinet principal + 4 coussinets en arc)
  const drawPad = (px: number, py: number, rx: number, ry: number, rot: number, fill: string) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#4a3325';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  };

  // Coussinet central trilobé
  ctx.beginPath();
  ctx.moveTo(cx, cy - 6);
  ctx.bezierCurveTo(cx + 28, cy - 12, cx + 36, cy + 28, cx + 12, cy + 32);
  ctx.quadraticCurveTo(cx, cy + 26, cx - 12, cy + 32);
  ctx.bezierCurveTo(cx - 36, cy + 28, cx - 28, cy - 12, cx, cy - 6);
  ctx.closePath();
  ctx.fillStyle = '#c23c34';
  ctx.fill();
  ctx.strokeStyle = '#4a3325';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // 4 doigts en arc de cercle (or & turquoise alterné subtil)
  drawPad(cx - 33, cy - 10, 11, 15, -0.45, '#2d9d9f');
  drawPad(cx - 12, cy - 28, 11, 16, -0.15, '#cf922a');
  drawPad(cx + 12, cy - 28, 11, 16, 0.15, '#cf922a');
  drawPad(cx + 33, cy - 10, 11, 15, 0.45, '#2d9d9f');
  ctx.restore();

  // Légère patine de sel marin près du bas de voile
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(110, 86, 56, ${0.03 + rand() * 0.04})`;
    ctx.beginPath();
    ctx.arc(rand() * size, size * (0.65 + rand() * 0.35), 8 + rand() * 24, 0, Math.PI * 2);
    ctx.fill();
  }

  const normal = generateNormalCanvasFromHeight(height, size, 1.5);
  return { albedo, normal };
}

function createFallbackTexture(hex: number, isDataMap = false): THREE.DataTexture {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  const data = new Uint8Array([r, g, b, 255]);
  const tex = new THREE.DataTexture(data, 1, 1);
  configureDioramaTexture(tex, { isDataMap, repeat: false, anisotropy: 4 });
  return tex;
}

function createShipTextureBundle(): ShipTextureBundle {
  if (typeof document === 'undefined') {
    return {
      woodAlbedo: createFallbackTexture(0x8c4f28, false),
      woodNormal: createFallbackTexture(0x8080ff, true),
      woodRoughness: createFallbackTexture(0xb0b0b0, true),
      sailAlbedo: createFallbackTexture(0xdfd0ae, false),
      sailNormal: createFallbackTexture(0x8080ff, true),
    };
  }

  const wood = createShipWoodPbrCanvases();
  const sail = createShipSailPbrCanvases();

  const wrap = (
    canvas: HTMLCanvasElement,
    isDataMap: boolean,
    repeat: boolean,
  ): THREE.CanvasTexture => {
    const tex = new THREE.CanvasTexture(canvas);
    configureDioramaTexture(tex, { isDataMap, repeat, anisotropy: 8 });
    return tex;
  };

  return {
    woodAlbedo: wrap(wood.albedo, false, true),
    woodNormal: wrap(wood.normal, true, true),
    woodRoughness: wrap(wood.roughness, true, true),
    sailAlbedo: wrap(sail.albedo, false, false),
    sailNormal: wrap(sail.normal, true, false),
  };
}

// ============================================================================
// Construction des géométries navales sculptées (0 assemblage de cubes bruts)
// ============================================================================

/**
 * Construit la coque organique complète par lofting sur 18 couples :
 * - Bordés extérieurs tribord & bâbord (UVs alignées aux virures & ligne de flottaison)
 * - Muraille intérieure des pavois
 * - Plats-bords (cap rail) courbes épousant la tonture
 * - Tableau arrière arrondi fermé (transom)
 */
function buildSculptedHullGeometry(): THREE.BufferGeometry {
  const stationCount = 18;
  const profileSteps = 10;

  // Paramètres de stations concentrés à la proue & à la poupe pour des courbes ultra-propres
  const stations: number[] = [];
  for (let i = 0; i < stationCount; i++) {
    const u = i / (stationCount - 1);
    // Clustering doux aux extrémités (cosine blend)
    const s = 0.5 - 0.5 * Math.cos(u * Math.PI);
    stations.push(s);
  }

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const pushVert = (x: number, y: number, z: number, u: number, v: number): number => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(u, v);
    return idx;
  };

  // --- 1. Coque extérieure Tribord (+X) et Bâbord (-X) ---
  const stbdGrid: number[][] = [];
  const portGrid: number[][] = [];

  for (let i = 0; i < stationCount; i++) {
    const s = stations[i];
    const z = hullStationZ(s);
    const uCoord = s * 2.2;
    const stbdRow: number[] = [];
    const portRow: number[] = [];

    for (let j = 0; j <= profileSteps; j++) {
      const t = j / profileSteps;
      const pt = sampleHullCrossSection(s, t);
      // Mappe y par rapport à la flottaison dans la bande coque v ∈ [0.01, 0.49]
      // Flottaison (y ≈ 0.08..0.22) alignée sur le liseré turquoise (v ≈ 0.16..0.21) !
      const vHull = clamp(0.165 + pt.y * 0.27, 0.015, 0.488);
      stbdRow.push(pushVert(pt.x, pt.y, z, uCoord, vHull));
      portRow.push(pushVert(-pt.x, pt.y, z, uCoord, vHull));
    }

    stbdGrid.push(stbdRow);
    portGrid.push(portRow);
  }

  for (let i = 0; i < stationCount - 1; i++) {
    for (let j = 0; j < profileSteps; j++) {
      // Tribord (+X outward): (a, d, c), (a, c, b)
      const sa = stbdGrid[i][j];
      const sb = stbdGrid[i + 1][j];
      const sc = stbdGrid[i + 1][j + 1];
      const sd = stbdGrid[i][j + 1];
      indices.push(sa, sd, sc, sa, sc, sb);

      // Bâbord (-X outward): (a, b, c), (a, c, d)
      const pa = portGrid[i][j];
      const pb = portGrid[i + 1][j];
      const pc = portGrid[i + 1][j + 1];
      const pd = portGrid[i][j + 1];
      indices.push(pa, pb, pc, pa, pc, pd);
    }
  }

  // --- 2. Muraille intérieure des pavois (du pont DECK_Y jusqu'au plat-bord) ---
  const stbdInBot: number[] = [];
  const stbdInTop: number[] = [];
  const portInBot: number[] = [];
  const portInTop: number[] = [];

  for (let i = 0; i < stationCount; i++) {
    const s = stations[i];
    const z = hullStationZ(s);
    const uCoord = s * 2.0;
    const outerTop = sampleHullCrossSection(s, 1.0);
    const wallT = hullWallThickness(s);
    const inTopX = Math.max(0.015, outerTop.x - wallT);
    const inBotX = deckInnerHalfBeam(s);

    stbdInBot.push(pushVert(inBotX, DECK_Y - 0.04, z, uCoord, 0.82));
    stbdInTop.push(pushVert(inTopX, outerTop.y, z, uCoord, 0.96));
    portInBot.push(pushVert(-inBotX, DECK_Y - 0.04, z, uCoord, 0.82));
    portInTop.push(pushVert(-inTopX, outerTop.y, z, uCoord, 0.96));
  }

  for (let i = 0; i < stationCount - 1; i++) {
    // Paroi interne tribord (normale -X)
    indices.push(
      stbdInBot[i],
      stbdInBot[i + 1],
      stbdInTop[i + 1],
      stbdInBot[i],
      stbdInTop[i + 1],
      stbdInTop[i],
    );
    // Paroi interne bâbord (normale +X)
    indices.push(
      portInBot[i],
      portInTop[i],
      portInTop[i + 1],
      portInBot[i],
      portInTop[i + 1],
      portInBot[i + 1],
    );
  }

  // --- 3. Plats-bords (Cap Rails) joignant bord extérieur et bord intérieur (normale +Y) ---
  const stbdCapOut: number[] = [];
  const stbdCapIn: number[] = [];
  const portCapOut: number[] = [];
  const portCapIn: number[] = [];

  for (let i = 0; i < stationCount; i++) {
    const s = stations[i];
    const z = hullStationZ(s);
    const uCoord = s * 2.4;
    const outerTop = sampleHullCrossSection(s, 1.0);
    const wallT = hullWallThickness(s);
    const outX = outerTop.x + 0.035; // léger débord mouluré du plat-bord
    const inX = Math.max(0.015, outerTop.x - wallT - 0.02);
    const capY = outerTop.y + 0.025;

    stbdCapOut.push(pushVert(outX, capY, z, uCoord, 0.84));
    stbdCapIn.push(pushVert(inX, capY, z, uCoord, 0.96));
    portCapOut.push(pushVert(-outX, capY, z, uCoord, 0.84));
    portCapIn.push(pushVert(-inX, capY, z, uCoord, 0.96));
  }

  for (let i = 0; i < stationCount - 1; i++) {
    // Tribord cap (+Y)
    indices.push(
      stbdCapOut[i],
      stbdCapIn[i],
      stbdCapIn[i + 1],
      stbdCapOut[i],
      stbdCapIn[i + 1],
      stbdCapOut[i + 1],
    );
    // Bâbord cap (+Y)
    indices.push(
      portCapOut[i],
      portCapOut[i + 1],
      portCapIn[i + 1],
      portCapOut[i],
      portCapIn[i + 1],
      portCapIn[i],
    );
  }

  // --- 4. Tableau arrière arrondi (Stern Transom à s = 1.0, z = +2.45, normale +Z) ---
  const sternCenter = pushVert(0, 0.52, HULL_STERN_Z + 0.08, 0.5, 0.34);
  const sternRing: number[] = [];
  // Du bas (quille) vers tribord haut, puis bâbord haut vers le bas (CCW vu de +Z)
  for (let j = 0; j <= profileSteps; j++) {
    const t = j / profileSteps;
    const pt = sampleHullCrossSection(1.0, t);
    const crownZ = HULL_STERN_Z + 0.08 * Math.cos((pt.x / 1.0) * Math.PI * 0.45);
    const vHull = clamp(0.165 + pt.y * 0.27, 0.015, 0.488);
    sternRing.push(pushVert(pt.x, pt.y, crownZ, 0.5 + pt.x * 0.4, vHull));
  }
  for (let j = profileSteps; j >= 0; j--) {
    const t = j / profileSteps;
    const pt = sampleHullCrossSection(1.0, t);
    const crownZ = HULL_STERN_Z + 0.08 * Math.cos((pt.x / 1.0) * Math.PI * 0.45);
    const vHull = clamp(0.165 + pt.y * 0.27, 0.015, 0.488);
    sternRing.push(pushVert(-pt.x, pt.y, crownZ, 0.5 - pt.x * 0.4, vHull));
  }
  for (let k = 0; k < sternRing.length - 1; k++) {
    indices.push(sternCenter, sternRing[k], sternRing[k + 1]);
  }

  // Paroi intérieure du tableau arrière (normale -Z) + plat-bord poupe
  const sternSheer = hullSheerY(1.0);
  const sternInHalf = deckInnerHalfBeam(1.0);
  const siBL = pushVert(-sternInHalf, DECK_Y - 0.02, HULL_STERN_Z - 0.10, 0.1, 0.83);
  const siBR = pushVert(sternInHalf, DECK_Y - 0.02, HULL_STERN_Z - 0.10, 0.9, 0.83);
  const siTR = pushVert(sternInHalf, sternSheer, HULL_STERN_Z - 0.10, 0.9, 0.96);
  const siTL = pushVert(-sternInHalf, sternSheer, HULL_STERN_Z - 0.10, 0.1, 0.96);
  indices.push(siBL, siTL, siTR, siBL, siTR, siBR);

  // Cap supérieur du tableau arrière (+Y)
  const scInL = pushVert(-sternInHalf, sternSheer + 0.025, HULL_STERN_Z - 0.11, 0.1, 0.86);
  const scInR = pushVert(sternInHalf, sternSheer + 0.025, HULL_STERN_Z - 0.11, 0.9, 0.86);
  const scOutR = pushVert(hullHalfBeam(1.0) + 0.03, sternSheer + 0.025, HULL_STERN_Z + 0.05, 0.9, 0.96);
  const scOutL = pushVert(-(hullHalfBeam(1.0) + 0.03), sternSheer + 0.025, HULL_STERN_Z + 0.05, 0.1, 0.96);
  indices.push(scInL, scOutL, scOutR, scInL, scOutR, scInR);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Construit le pont en planches de teck épousant exactement le contour intérieur de la coque
 * + petit gaillard avant légèrement surélevé + banc de barre courbé à la poupe.
 */
function buildSculptedDeckGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const buildDeckSurface = (
    sStart: number,
    sEnd: number,
    yLevel: number,
    inset: number,
    steps: number,
  ): THREE.BufferGeometry => {
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];

    for (let i = 0; i <= steps; i++) {
      const s = sStart + (i / steps) * (sEnd - sStart);
      const z = hullStationZ(s);
      const hw = Math.max(0.02, deckInnerHalfBeam(s) + inset);
      const u = (z - HULL_BOW_Z) / HULL_LENGTH * 1.65;

      // Planches de pont orientées longitudinalement (UV v ∈ [0.51, 0.79] -> bande teck)
      // On échange u/v pour que les rainures de planches courent de la proue vers la poupe !
      const vPort = 0.65 - (hw / 1.45) * 0.135;
      const vStbd = 0.65 + (hw / 1.45) * 0.135;

      pos.push(-hw, yLevel, z);
      uv.push(u, vPort);
      pos.push(hw, yLevel, z);
      uv.push(u, vStbd);

      if (i < steps) {
        const a = i * 2;
        const b = a + 2;
        const c = a + 3;
        const d = a + 1;
        // Normale +Y
        idx.push(a, b, c, a, c, d);
      }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // Pont principal dégagé (DECK_Y = 0.56)
  parts.push(buildDeckSurface(0.03, 0.985, DECK_Y, 0.03, 18));

  // Petit gaillard avant surélevé (z ∈ [-2.40, -1.45], y = 0.68)
  parts.push(buildDeckSurface(0.03, 0.22, DECK_Y + 0.12, 0.02, 6));
  // Contremarche du gaillard avant (face +Z vers le cockpit)
  const foreStepW = deckInnerHalfBeam(0.22) * 2;
  const foreStep = new THREE.PlaneGeometry(foreStepW, 0.13);
  foreStep.translate(0, DECK_Y + 0.06, hullStationZ(0.22));
  remapGeometryUVBand(foreStep, 0.1, 0.9, 0.82, 0.96);
  parts.push(foreStep);

  // Banc de poupe courbé (z ∈ [+1.90, +2.38], y = 0.74)
  parts.push(buildDeckSurface(0.89, 0.985, DECK_Y + 0.18, 0.02, 4));
  const sternStepW = deckInnerHalfBeam(0.89) * 2;
  const sternStep = new THREE.PlaneGeometry(sternStepW, 0.19);
  sternStep.rotateY(Math.PI);
  sternStep.translate(0, DECK_Y + 0.09, hullStationZ(0.89));
  remapGeometryUVBand(sternStep, 0.1, 0.9, 0.82, 0.96);
  parts.push(sternStep);

  return mergeStaticGeometries(parts);
}

/**
 * Construit les listons courbes (rubbing strakes), l'étrave galbée, le beaupré,
 * le mât fuselé, la hune miniature et les accessoires en bois (baril, coffre, pied boussole).
 */
function buildTimberDetailsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. Plats-bords tubulaires moulurés + listons latéraux (suivant exactement la tonture)
  for (const side of [-1, 1]) {
    const railPts: THREE.Vector3[] = [];
    const strakePts: THREE.Vector3[] = [];
    for (let i = 0; i <= 14; i++) {
      const s = i / 14;
      const z = hullStationZ(s);
      const topPt = sampleHullCrossSection(s, 1.0);
      const midPt = sampleHullCrossSection(s, 0.68);
      railPts.push(new THREE.Vector3(side * (topPt.x - 0.01), topPt.y + 0.03, z));
      strakePts.push(new THREE.Vector3(side * (midPt.x + 0.025), midPt.y, z));
    }
    const railGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPts), 24, 0.068, 7, false);
    remapGeometryUVBand(railGeo, 0, 2, 0.82, 0.98);
    parts.push(railGeo);

    const strakeGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(strakePts), 22, 0.042, 6, false);
    remapGeometryUVBand(strakeGeo, 0, 2, 0.82, 0.98);
    parts.push(strakeGeo);
  }

  // 2. Étrave courbe (stempost) reliant la quille à la proue haute
  const stemCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -0.45, -1.85),
    new THREE.Vector3(0, -0.18, -2.35),
    new THREE.Vector3(0, 0.48, -2.56),
    new THREE.Vector3(0, 1.24, -2.62),
  ]);
  const stemGeo = new THREE.TubeGeometry(stemCurve, 16, 0.085, 7, false);
  remapGeometryUVBand(stemGeo, 0, 1, 0.82, 0.98);
  parts.push(stemGeo);

  // 3. Beaupré effilé pointant vers -Z (jusqu'à z = -3.10)
  const bowspritPts = [
    new THREE.Vector2(0.085, 0.0),
    new THREE.Vector2(0.072, 0.45),
    new THREE.Vector2(0.052, 0.92),
    new THREE.Vector2(0.036, 1.25),
    new THREE.Vector2(0.008, 1.30),
  ];
  const bowspritGeo = new THREE.LatheGeometry(bowspritPts, 9);
  // Orienté de (0, 0.94, -1.92) vers (0, 1.46, -3.10)
  bowspritGeo.rotateX(-Math.PI * 0.5 + 0.40);
  bowspritGeo.translate(0, 0.95, -1.92);
  remapGeometryUVBand(bowspritGeo, 0, 1, 0.82, 0.98);
  parts.push(bowspritGeo);

  // 4. Mât principal galbé (fuseau LatheGeometry, hauteur 3.95 u au-dessus du pont à z = -0.75)
  const mastProfile = [
    new THREE.Vector2(0.145, 0.0),
    new THREE.Vector2(0.132, 0.25),
    new THREE.Vector2(0.118, 1.15),
    new THREE.Vector2(0.102, 2.35),
    new THREE.Vector2(0.082, 3.30),
    new THREE.Vector2(0.064, MAST_HEIGHT),
    new THREE.Vector2(0.02, MAST_HEIGHT + 0.06),
  ];
  const mastGeo = new THREE.LatheGeometry(mastProfile, 12);
  mastGeo.translate(0, DECK_Y - 0.04, MAST_Z);
  remapGeometryUVBand(mastGeo, 0, 1, 0.82, 0.98);
  parts.push(mastGeo);

  // Emplanture octogonale du mât sur le pont
  const collarGeo = new THREE.CylinderGeometry(0.20, 0.24, 0.14, 10);
  collarGeo.translate(0, DECK_Y + 0.06, MAST_Z);
  remapGeometryUVBand(collarGeo, 0, 1, 0.82, 0.98);
  parts.push(collarGeo);

  // 5. Hune / Nid-de-pie miniature (y = 3.62)
  const nestProfile = [
    new THREE.Vector2(0.10, 0.0),
    new THREE.Vector2(0.28, 0.06),
    new THREE.Vector2(0.32, 0.26),
    new THREE.Vector2(0.27, 0.26),
    new THREE.Vector2(0.23, 0.09),
    new THREE.Vector2(0.10, 0.09),
  ];
  const nestGeo = new THREE.LatheGeometry(nestProfile, 12);
  nestGeo.translate(0, DECK_Y + 3.05, MAST_Z);
  remapGeometryUVBand(nestGeo, 0, 1, 0.82, 0.98);
  parts.push(nestGeo);

  // 6. Accessoire : Baril douvé galbé (bâbord avant : x = -0.82, z = -1.12)
  const barrelProfile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.20, 0.0),
    new THREE.Vector2(0.255, 0.16),
    new THREE.Vector2(0.27, 0.30),
    new THREE.Vector2(0.255, 0.44),
    new THREE.Vector2(0.20, 0.58),
    new THREE.Vector2(0.17, 0.58),
    new THREE.Vector2(0.17, 0.54),
    new THREE.Vector2(0.0, 0.54),
  ];
  const barrelGeo = new THREE.LatheGeometry(barrelProfile, 12);
  barrelGeo.translate(-0.78, DECK_Y, -1.08);
  remapGeometryUVBand(barrelGeo, 0, 1, 0.82, 0.98);
  parts.push(barrelGeo);

  // 7. Accessoire : Petit coffre de bord à couvercle bombé (tribord arrière : x = +0.76, z = +1.34)
  const chestShape = new THREE.Shape();
  chestShape.moveTo(-0.22, 0);
  chestShape.lineTo(0.22, 0);
  chestShape.lineTo(0.22, 0.24);
  chestShape.absarc(0, 0.24, 0.22, 0, Math.PI, false);
  chestShape.closePath();
  const chestGeo = new THREE.ExtrudeGeometry(chestShape, {
    depth: 0.62,
    bevelEnabled: true,
    bevelThickness: 0.02,
    bevelSize: 0.015,
    bevelSegments: 2,
    curveSegments: 8,
  });
  chestGeo.center();
  chestGeo.rotateY(-0.22);
  chestGeo.translate(0.76, DECK_Y + 0.23, 1.34);
  remapGeometryUVBand(chestGeo, 0, 1, 0.82, 0.98);
  parts.push(chestGeo);

  // 8. Accessoire : Pied d'habitacle de boussole devant le héros (x = 0, z = -0.16)
  const binnacleProfile = [
    new THREE.Vector2(0.17, 0.0),
    new THREE.Vector2(0.13, 0.08),
    new THREE.Vector2(0.095, 0.22),
    new THREE.Vector2(0.09, 0.44),
    new THREE.Vector2(0.135, 0.54),
    new THREE.Vector2(0.115, 0.58),
    new THREE.Vector2(0.0, 0.58),
  ];
  const binnacleGeo = new THREE.LatheGeometry(binnacleProfile, 10);
  binnacleGeo.translate(0.0, DECK_Y, -0.16);
  remapGeometryUVBand(binnacleGeo, 0, 1, 0.82, 0.98);
  parts.push(binnacleGeo);

  return mergeStaticGeometries(parts);
}

/**
 * Construit toute la métallerie en laiton bruni (1 draw call fusionné) :
 * - Figure de proue féline sculptée sous le beaupré (tête de chat + oreilles pointues + collerette)
 * - Cerclages de mât & baril, sangles de coffre, cadènes de haubans
 * - Habitacle/anneau de boussole, potence courbe de lanterne arrière, pommeau de mât
 */
function buildBrassHardwareGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // 1. FIGURE DE PROUE FÉLINE (sous le beaupré, regardant vers -Z)
  const figZ = -2.68;
  const figY = 1.05;

  // Volute/socle de proue reliant l'étrave à la figure féline
  const scrollCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.62, -2.52),
    new THREE.Vector3(0, 0.84, -2.66),
    new THREE.Vector3(0, 1.02, -2.68),
  ]);
  parts.push(new THREE.TubeGeometry(scrollCurve, 10, 0.085, 7, false));

  // Tête féline galbée (sphère sculptée légèrement élargie aux joues)
  const headGeo = new THREE.SphereGeometry(0.19, 12, 10);
  headGeo.scale(1.08, 0.94, 1.04);
  headGeo.translate(0, figY + 0.04, figZ - 0.06);
  parts.push(headGeo);

  // Museau doux vers l'avant (-Z)
  const muzzleGeo = new THREE.SphereGeometry(0.085, 8, 8);
  muzzleGeo.scale(1.15, 0.78, 0.95);
  muzzleGeo.translate(0, figY - 0.01, figZ - 0.22);
  parts.push(muzzleGeo);

  // Deux oreilles de chat emblématiques pointées vers le ciel et légèrement vers l'arrière
  for (const side of [-1, 1]) {
    const earShape = new THREE.Shape();
    earShape.moveTo(-0.075, 0);
    earShape.quadraticCurveTo(-0.04, 0.14, 0.0, 0.21);
    earShape.quadraticCurveTo(0.055, 0.13, 0.075, 0);
    earShape.closePath();
    const earGeo = new THREE.ExtrudeGeometry(earShape, {
      depth: 0.05,
      bevelEnabled: true,
      bevelThickness: 0.015,
      bevelSize: 0.012,
      bevelSegments: 2,
    });
    earGeo.center();
    earGeo.rotateZ(-side * 0.26);
    earGeo.rotateX(0.22);
    earGeo.translate(side * 0.125, figY + 0.21, figZ - 0.02);
    parts.push(earGeo);
  }

  // Collier royal torsadé sous la tête féline
  const collarRing = new THREE.TorusGeometry(0.135, 0.032, 7, 14);
  collarRing.rotateX(Math.PI * 0.42);
  collarRing.translate(0, figY - 0.13, figZ - 0.04);
  parts.push(collarRing);

  // 2. Pommeau sphérique en tête de mât & cerclages de mât en laiton
  const finial = new THREE.SphereGeometry(0.085, 10, 8);
  finial.translate(0, DECK_Y + MAST_HEIGHT + 0.08, MAST_Z);
  parts.push(finial);

  for (const h of [0.32, 1.25, 2.35, 3.05, 3.36]) {
    const band = new THREE.TorusGeometry(0.142 - h * 0.017, 0.022, 6, 14);
    band.rotateX(Math.PI * 0.5);
    band.translate(0, DECK_Y + h, MAST_Z);
    parts.push(band);
  }

  // 3. Cerclages du baril douvé (bâbord avant)
  for (const bh of [0.11, 0.46]) {
    const hoop = new THREE.TorusGeometry(0.242, 0.018, 6, 14);
    hoop.rotateX(Math.PI * 0.5);
    hoop.translate(-0.78, DECK_Y + bh, -1.08);
    parts.push(hoop);
  }

  // 4. Bandes de laiton du coffre de bord (tribord arrière)
  for (const offset of [-0.18, 0.18]) {
    const strap = new THREE.TorusGeometry(0.225, 0.022, 6, 12, Math.PI * 1.15);
    strap.rotateZ(-0.08);
    strap.rotateY(-0.22);
    strap.translate(0.76 + Math.sin(-0.22) * offset, DECK_Y + 0.23, 1.34 + Math.cos(-0.22) * offset);
    parts.push(strap);
  }

  // 5. Anneau de boussole laiton devant le héros
  const compassBezel = new THREE.TorusGeometry(0.11, 0.024, 7, 14);
  compassBezel.rotateX(Math.PI * 0.5);
  compassBezel.translate(0.0, DECK_Y + 0.59, -0.16);
  parts.push(compassBezel);

  // 6. Potence courbe de la lanterne de poupe (tribord arrière : x = +0.72, z = +2.26)
  const davitCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.68, DECK_Y + 0.16, 2.22),
    new THREE.Vector3(0.76, DECK_Y + 0.88, 2.34),
    new THREE.Vector3(0.84, DECK_Y + 1.32, 2.48),
    new THREE.Vector3(0.90, DECK_Y + 1.24, 2.66),
  ]);
  parts.push(new THREE.TubeGeometry(davitCurve, 14, 0.032, 7, false));

  // 7. Cerclages des 2 boucliers décoratifs latéraux + cadènes de haubans + ferrures proue/poupe
  for (const side of [-1, 1]) {
    const shieldRim = new THREE.TorusGeometry(0.25, 0.032, 7, 16);
    shieldRim.rotateY(Math.PI * 0.5);
    shieldRim.translate(side * 1.42, 0.72, 0.15);
    parts.push(shieldRim);

    const boss = new THREE.SphereGeometry(0.075, 8, 6);
    boss.scale(0.55, 1, 1);
    boss.translate(side * 1.44, 0.72, 0.15);
    parts.push(boss);

    // Cadènes (ancrages haubans sur le pavois)
    for (const cz of [-0.95, -0.45]) {
      const s = (cz - HULL_BOW_Z) / HULL_LENGTH;
      const topPt = sampleHullCrossSection(s, 0.96);
      const plate = new THREE.CylinderGeometry(0.03, 0.03, 0.18, 6);
      plate.translate(side * (topPt.x + 0.02), topPt.y - 0.06, cz);
      parts.push(plate);
    }
  }

  return mergeStaticGeometries(parts);
}

/**
 * Construit les accents colorés turquoise/corail (médaillon figure de proue, cadran boussole,
 * disques des boucliers de flanc) en 1 seul draw call.
 */
function buildAccentEmblemsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Gemme turquoise sur le collier de la figure de proue féline
  const gem = new THREE.OctahedronGeometry(0.062, 1);
  gem.scale(0.9, 1.1, 0.65);
  gem.translate(0, 0.92, -2.81);
  parts.push(gem);

  // Cadran turquoise lumineux de la boussole
  const dial = new THREE.CylinderGeometry(0.095, 0.095, 0.02, 12);
  dial.translate(0.0, DECK_Y + 0.585, -0.16);
  parts.push(dial);

  // Disques peints des deux boucliers féeriques sur les flancs
  for (const side of [-1, 1]) {
    const disc = new THREE.CylinderGeometry(0.23, 0.23, 0.045, 14);
    disc.rotateZ(Math.PI * 0.5);
    disc.translate(side * 1.40, 0.72, 0.15);
    parts.push(disc);
  }

  return mergeStaticGeometries(parts);
}

/**
 * Construit tous les haubans, étai avant, sous-barbe et cordage lové en spirale 3D (1 draw call).
 */
function buildRiggingAndRopesGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mastHead = new THREE.Vector3(0, DECK_Y + 3.55, MAST_Z);

  const addRope = (a: THREE.Vector3, b: THREE.Vector3, sag: number, radius = 0.017) => {
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    mid.y -= sag;
    const curve = new THREE.CatmullRomCurve3([a, mid, b]);
    parts.push(new THREE.TubeGeometry(curve, 10, radius, 5, false));
  };

  // Haubans tribord & bâbord (2 de chaque côté)
  for (const side of [-1, 1]) {
    for (const cz of [-0.95, -0.45]) {
      const s = (cz - HULL_BOW_Z) / HULL_LENGTH;
      const topPt = sampleHullCrossSection(s, 0.98);
      addRope(
        new THREE.Vector3(side * 0.09, mastHead.y - 0.18, MAST_Z),
        new THREE.Vector3(side * topPt.x, topPt.y, cz),
        0.04,
      );
    }
    // Échelons / enfléchures horizontales entre les 2 haubans (signature navale immédiate !)
    for (let r = 1; r <= 4; r++) {
      const f = r / 5;
      const zA = -0.95 * (1 - f) + MAST_Z * f;
      const zB = -0.45 * (1 - f) + MAST_Z * f;
      const yR = 0.98 * (1 - f) + (mastHead.y - 0.18) * f;
      const xR = side * (1.28 * (1 - f) + 0.09 * f);
      addRope(
        new THREE.Vector3(xR, yR, zA),
        new THREE.Vector3(xR, yR, zB),
        0.01,
        0.012,
      );
    }
  }

  // Étai avant (du haut du mât à la pointe du beaupré) + sous-barbe (beaupré -> étrave)
  addRope(
    new THREE.Vector3(0, mastHead.y + 0.12, MAST_Z - 0.04),
    new THREE.Vector3(0, 1.44, -3.04),
    0.05,
    0.02,
  );
  addRope(
    new THREE.Vector3(0, 1.40, -2.98),
    new THREE.Vector3(0, 0.42, -2.54),
    0.02,
    0.016,
  );

  // Cordage lové en spirale 3D sur le gaillard avant (x = +0.52, z = -1.68)
  const coilPts: THREE.Vector3[] = [];
  const coilTurns = 3.2;
  const coilSamples = 32;
  for (let i = 0; i <= coilSamples; i++) {
    const t = i / coilSamples;
    const ang = t * coilTurns * Math.PI * 2;
    const rad = 0.06 + t * 0.19;
    coilPts.push(
      new THREE.Vector3(
        0.48 + Math.cos(ang) * rad,
        DECK_Y + 0.145 + (1 - t) * 0.02,
        -1.66 + Math.sin(ang) * rad,
      ),
    );
  }
  parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(coilPts), 36, 0.024, 6, false));

  return mergeStaticGeometries(parts);
}

/**
 * Construit la grande voile trapézoïdale échancrée en bas (dans `sailRigGroup`
 * pour pivoter autour du mât lors du brasage) avec attribut `aSailFlex`.
 */
function buildMainSailGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const flexes: number[] = [];
  const indices: number[] = [];

  const pushVertex = (
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    fx: number,
    fy: number,
    fz: number,
    fw: number,
  ): number => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(u, v);
    flexes.push(fx, fy, fz, fw);
    return idx;
  };

  // Grande Voile trapézoïdale avec échancrure haute au bas (y ∈ [1.84, 3.88])
  const segX = 16;
  const segY = 14;
  const topHalfW = 1.18;
  const botHalfW = 1.38;
  const yTop = DECK_Y + 3.34; // 3.90
  const yBotCorner = DECK_Y + 1.18; // 1.74 aux coins, monte à 1.98 au centre pour dégager le héros
  const sailBaseZ = MAST_Z - 0.12;

  const mainGrid: number[][] = [];
  for (let iy = 0; iy <= segY; iy++) {
    const v = iy / segY; // 0 = bas (foot), 1 = haut (vergue)
    const row: number[] = [];
    for (let ix = 0; ix <= segX; ix++) {
      const u = ix / segX; // 0 = bâbord (-X), 1 = tribord (+X)
      const uCentered = (u - 0.5) * 2.0; // [-1..+1]

      const halfW = botHalfW + (topHalfW - botHalfW) * v;
      const leechCurve = 1.0 + 0.05 * Math.sin(v * Math.PI);
      const x = uCentered * halfW * leechCurve;

      const footArch = (1 - uCentered * uCentered) * 0.24 * (1 - v);
      const headArch = (1 - uCentered * uCentered) * 0.08 * v;
      const y = yBotCorner + (yTop - yBotCorner) * v + footArch + headArch;

      const spanEnv = Math.cos(uCentered * Math.PI * 0.5);
      const vertEnv = Math.sin(v * Math.PI);
      const staticCamber = -0.26 * spanEnv * (0.28 + 0.72 * vertEnv);
      const z = sailBaseZ + staticCamber;

      const billowW =
        spanEnv *
        Math.pow(Math.sin(Math.min(1, v * 0.96 + 0.04) * Math.PI), 0.75) *
        (1 - v * 0.85);
      const edgeFree = (1 - v) * (0.35 + 0.65 * Math.abs(uCentered));
      const flutterW = clamp(edgeFree * 1.15, 0, 1);

      row.push(pushVertex(x, y, z, u, v, billowW, flutterW, 0.0, -1.0));
    }
    mainGrid.push(row);
  }

  for (let iy = 0; iy < segY; iy++) {
    for (let ix = 0; ix < segX; ix++) {
      const a = mainGrid[iy][ix];
      const b = mainGrid[iy][ix + 1];
      const c = mainGrid[iy + 1][ix + 1];
      const d = mainGrid[iy + 1][ix];
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aSailFlex', new THREE.Float32BufferAttribute(flexes, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Construit le foc triangulaire avant (attaché à `shipMotionGroup` pour que son point
 * d'amure reste parfaitement soudé au bout du beaupré z = -3.02 !).
 */
function buildJibSailGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const flexes: number[] = [];
  const indices: number[] = [];

  const pushVertex = (
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    fx: number,
    fy: number,
    fz: number,
    fw: number,
  ): number => {
    const idx = positions.length / 3;
    positions.push(x, y, z);
    uvs.push(u, v);
    flexes.push(fx, fy, fz, fw);
    return idx;
  };

  // Mappé sur la zone lin ivoire unie (u ∈ [0.06, 0.26], v ∈ [0.16, 0.84]) sans couper l'emblème central
  const jibSteps = 8;
  const pHead = new THREE.Vector3(0.0, DECK_Y + 3.50, MAST_Z - 0.06);
  const pTack = new THREE.Vector3(0.0, 1.44, -3.02);
  const pClew = new THREE.Vector3(0.10, 1.72, -1.32);

  const jibGrid: number[][] = [];
  for (let i = 0; i <= jibSteps; i++) {
    const tHeight = i / jibSteps;
    const row: number[] = [];
    const cols = Math.max(1, jibSteps - i);
    for (let j = 0; j <= cols; j++) {
      const tChord = j / cols;
      const wHead = tHeight;
      const wClew = (1 - tHeight) * tChord;
      const wTack = (1 - tHeight) * (1 - tChord);

      const x = pHead.x * wHead + pTack.x * wTack + pClew.x * wClew;
      const y = pHead.y * wHead + pTack.y * wTack + pClew.y * wClew;
      const z = pHead.z * wHead + pTack.z * wTack + pClew.z * wClew;

      const belly = Math.sin(tChord * Math.PI) * Math.sin(tHeight * Math.PI);
      const xCurved = x + belly * 0.24;

      const uLin = 0.06 + tChord * 0.20;
      const vLin = 0.16 + tHeight * 0.68;

      const billowW = belly * 0.85;
      const flutterW = tChord * (1 - tHeight * 0.7);
      row.push(pushVertex(xCurved, y, z, uLin, vLin, billowW, flutterW, 0.92, -0.38));
    }
    jibGrid.push(row);
  }

  for (let i = 0; i < jibSteps; i++) {
    const rowBot = jibGrid[i];
    const rowTop = jibGrid[i + 1];
    for (let j = 0; j < rowTop.length; j++) {
      const a = rowBot[j];
      const b = rowBot[j + 1];
      const c = rowTop[j];
      indices.push(a, b, c);
      if (j + 1 < rowTop.length) {
        const d = rowTop[j + 1];
        indices.push(b, d, c);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aSailFlex', new THREE.Float32BufferAttribute(flexes, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Vergue supérieure légèrement arquée (enfant de `sailRigGroup` pour pivoter avec la voile). */
function buildYardarmGeometry(): THREE.BufferGeometry {
  const yardCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.32, DECK_Y + 3.30, MAST_Z - 0.11),
    new THREE.Vector3(-0.62, DECK_Y + 3.38, MAST_Z - 0.12),
    new THREE.Vector3(0.0, DECK_Y + 3.41, MAST_Z - 0.12),
    new THREE.Vector3(0.62, DECK_Y + 3.38, MAST_Z - 0.12),
    new THREE.Vector3(1.32, DECK_Y + 3.30, MAST_Z - 0.11),
  ]);
  const geo = new THREE.TubeGeometry(yardCurve, 18, 0.048, 8, false);
  remapGeometryUVBand(geo, 0, 1.5, 0.82, 0.98);
  return geo;
}

/** Fanion bifide (queue d'aronde) en tête de mât, flottant vers +Z. */
function buildPennantGeometry(): THREE.BufferGeometry {
  const segX = 10;
  const segY = 2;
  const length = 1.05;
  const baseH = 0.28;

  const positions: number[] = [];
  const uvs: number[] = [];
  const flexes: number[] = [];
  const indices: number[] = [];

  for (let ix = 0; ix <= segX; ix++) {
    const t = ix / segX; // 0 = mât, 1 = pointe vers +Z
    const halfH = baseH * 0.5 * (1 - t * 0.62);
    // Encoche en V en bout de fanion (queue d'aronde)
    const notch = t > 0.78 ? ((t - 0.78) / 0.22) : 0;

    for (let iy = 0; iy <= segY; iy++) {
      const v = iy / segY; // 0 bas, 0.5 centre, 1 haut
      const z = t * length - (iy === 1 ? notch * 0.22 : 0);
      const y = (v - 0.5) * 2 * halfH;
      positions.push(0, y, z);
      uvs.push(t, v);
      // Ondulation latérale ±X progressive vers l'arrière
      flexes.push(t * 0.45, Math.pow(t, 1.25) * 1.45, 1.0, 0.0);
    }
  }

  for (let ix = 0; ix < segX; ix++) {
    for (let iy = 0; iy < segY; iy++) {
      const a = ix * (segY + 1) + iy;
      const b = (ix + 1) * (segY + 1) + iy;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aSailFlex', new THREE.Float32BufferAttribute(flexes, 4));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Construit le gouvernail articulé + barre franche courbe (pivoté autour de l'étambot z = +2.45).
 * Safran étendu vers +Z (z_local ∈ [0, +0.45]), barre franche courbe vers -Z (z_local ∈ [0, -1.05]).
 */
function buildRudderAndTillerGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  // Safran profilé (ExtrudeGeometry dans le plan YZ -> orienté le long de +Z)
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0.0, 0.65);
  bladeShape.lineTo(0.14, 0.62);
  bladeShape.quadraticCurveTo(0.42, 0.35, 0.44, -0.34);
  bladeShape.quadraticCurveTo(0.40, -0.52, 0.16, -0.54);
  bladeShape.lineTo(0.0, -0.46);
  bladeShape.closePath();

  const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
    depth: 0.08,
    bevelEnabled: true,
    bevelThickness: 0.018,
    bevelSize: 0.015,
    bevelSegments: 2,
    curveSegments: 8,
  });
  bladeGeo.translate(0, 0, -0.04);
  // Aligne le plan XY de la Shape sur le plan ZY (safran étendu vers +Z)
  bladeGeo.rotateY(-Math.PI * 0.5);
  remapGeometryUVBand(bladeGeo, 0, 1, 0.82, 0.98);
  parts.push(bladeGeo);

  // Mèche verticale du gouvernail montant au-dessus du plat-bord de poupe (y_world = 1.26)
  const postGeo = new THREE.CylinderGeometry(0.056, 0.068, 1.72, 8);
  postGeo.translate(0, 0.34, 0.03);
  remapGeometryUVBand(postGeo, 0, 1, 0.82, 0.98);
  parts.push(postGeo);

  // Barre franche élégamment courbée en S passant AU-DESSUS du tableau arrière (0 clipping !)
  const tillerCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.18, 0.02),
    new THREE.Vector3(0, 1.24, -0.26),
    new THREE.Vector3(0, 1.06, -0.68),
    new THREE.Vector3(0, 1.02, -1.04),
  ]);
  const tillerGeo = new THREE.TubeGeometry(tillerCurve, 14, 0.044, 7, false);
  remapGeometryUVBand(tillerGeo, 0, 1, 0.82, 0.98);
  parts.push(tillerGeo);

  return mergeStaticGeometries(parts);
}

/**
 * Construit le croissant de mousse de proue épousant l'étrave à la ligne de flottaison.
 */
function buildBowFoamGeometry(): THREE.BufferGeometry {
  const segArc = 24;
  const segRad = 2;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segArc; i++) {
    const u = i / segArc; // 0 (bâbord) -> 0.5 (pointe proue) -> 1 (tribord)
    const side = u < 0.5 ? -1 : 1;
    const distFromTip = Math.abs(u - 0.5) * 2.0; // 0 à la proue, 1 sur les épaules
    const s = Math.pow(distFromTip, 1.35) * 0.42;
    const zBase = hullStationZ(s) - 0.10 * (1 - distFromTip);
    const xBase = side * (hullHalfBeam(s) * 0.92 + 0.04);

    // Normale sortante horizontale approximée
    const nx = side * (0.28 + 0.72 * distFromTip);
    const nz = -(0.96 - 0.72 * distFromTip);
    const invN = 1 / Math.hypot(nx, nz);

    const spread = 0.55 + 0.65 * Math.sin(distFromTip * Math.PI * 0.75 + 0.25);

    for (let j = 0; j <= segRad; j++) {
      const v = j / segRad; // 0 = coque, 1 = crête extérieure
      const px = xBase + nx * invN * spread * v;
      const pz = zBase + nz * invN * spread * v;
      const py = 0.065 + Math.sin(v * Math.PI) * 0.03 * (1 - distFromTip * 0.5);
      positions.push(px, py, pz);
      uvs.push(u, v);
    }
  }

  for (let i = 0; i < segArc; i++) {
    for (let j = 0; j < segRad; j++) {
      const a = i * (segRad + 1) + j;
      const b = (i + 1) * (segRad + 1) + j;
      const c = b + 1;
      const d = a + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Construit la collerette elliptique d'ondulations autour de la flottaison de la coque.
 */
function buildHullRippleGeometry(): THREE.BufferGeometry {
  const segAngle = 40;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segAngle; i++) {
    const u = i / segAngle;
    const ang = u * Math.PI * 2;
    const sinA = Math.sin(ang);
    const cosA = Math.cos(ang);

    // Forme légèrement effilée vers la proue (-Z) pour épouser la silhouette du voilier
    const bowNarrow = cosA < 0 ? 1 - 0.22 * Math.abs(cosA) : 1.0;
    const inRx = 1.32 * bowNarrow;
    const inRz = 2.48;
    const outRx = inRx + 1.25;
    const outRz = inRz + 1.35;

    positions.push(sinA * inRx, 0.045, cosA * inRz);
    uvs.push(u, 0);
    positions.push(sinA * outRx, 0.035, cosA * outRz);
    uvs.push(u, 1);

    if (i < segAngle) {
      const a = i * 2;
      const b = a + 2;
      const c = a + 3;
      const d = a + 1;
      indices.push(a, b, c, a, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Construit 6 filets de vent courbes fins autour du voilier (1 seul draw call).
 */
function buildWindStreaksGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const seeds: number[] = [];
  const indices: number[] = [];

  const specs = [
    { x: -1.95, y: 1.55, zStart: -2.4, len: 4.8, arch: 0.26, w: 0.06, seed: 0.11 },
    { x: 2.05, y: 1.85, zStart: -2.1, len: 4.5, arch: -0.22, w: 0.055, seed: 0.37 },
    { x: -1.65, y: 3.15, zStart: -2.8, len: 5.2, arch: 0.32, w: 0.05, seed: 0.63 },
    { x: 1.75, y: 3.35, zStart: -2.6, len: 5.0, arch: -0.28, w: 0.05, seed: 0.89 },
    { x: -2.35, y: 0.85, zStart: -1.5, len: 4.1, arch: 0.18, w: 0.055, seed: 0.24 },
    { x: 2.30, y: 0.95, zStart: -1.7, len: 4.2, arch: -0.20, w: 0.055, seed: 0.72 },
  ];

  const segs = 12;
  let vertBase = 0;
  for (let s = 0; s < WIND_STREAK_COUNT; s++) {
    const spec = specs[s];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const z = spec.zStart + t * spec.len;
      const x = spec.x + Math.sin(t * Math.PI * 1.5) * spec.arch;
      const y = spec.y + Math.sin(t * Math.PI) * 0.18;

      positions.push(x, y - spec.w, z);
      uvs.push(t, 0);
      seeds.push(spec.seed);

      positions.push(x, y + spec.w, z);
      uvs.push(t, 1);
      seeds.push(spec.seed);

      if (i < segs) {
        const a = vertBase + i * 2;
        const b = a + 2;
        const c = a + 3;
        const d = a + 1;
        indices.push(a, b, c, a, c, d);
      }
    }
    vertBase += (segs + 1) * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aStreakSeed', new THREE.Float32BufferAttribute(seeds, 1));
  geo.setIndex(indices);
  return geo;
}

// ============================================================================
// Classe principale ShipRenderer
// ============================================================================

export function computeShipBowLanternLevel(
  weather?: {
    dayPhase?: string;
    lanternBoost?: number;
    stormIntensity?: number;
    nightFactor?: number;
  } | null,
): number {
  if (!weather) return 0;
  const phaseBoost =
    weather.dayPhase === 'night'
      ? 0.95
      : weather.dayPhase === 'dusk'
        ? 0.62
        : 0;
  const raw = Math.max(
    weather.lanternBoost ?? 0,
    phaseBoost,
    (weather.stormIntensity ?? 0) * 0.92,
    (weather.nightFactor ?? 0) * 0.95,
  );
  return Math.max(0, Math.min(1, raw));
}

export class ShipRenderer {
  private readonly scene: THREE.Scene;
  private readonly rootGroup = new THREE.Group();
  private readonly shipYawGroup = new THREE.Group();
  private readonly shipMotionGroup = new THREE.Group();
  private readonly sailRigGroup = new THREE.Group();
  private readonly rudderPivot = new THREE.Group();
  private readonly lanternPivot = new THREE.Group();
  private readonly bowLanternPivot = new THREE.Group();

  // Ancres de pont exactes (lues par EntityRenderer via getDeckAnchors())
  private readonly heroSeatAnchor = new THREE.Object3D();
  private readonly companionSeatAnchor = new THREE.Object3D();

  // Ressources GPU suivies pour libération propre dans dispose()
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly textures: ShipTextureBundle;

  // Matériaux & uniforms animés
  private readonly sailMat: THREE.MeshStandardMaterial;
  private readonly sailUniforms: SailWindUniforms;
  private readonly pennantUniforms: SailWindUniforms;
  private readonly wakeMat: THREE.ShaderMaterial;
  private readonly bowFoamMat: THREE.ShaderMaterial;
  private readonly hullRippleMat: THREE.ShaderMaterial;
  private readonly windStreakMat: THREE.ShaderMaterial;
  private readonly lanternGlowMat: THREE.MeshStandardMaterial;
  private readonly lanternLight: THREE.PointLight;
  private readonly bowLanternGlowMat: THREE.MeshStandardMaterial;
  private readonly bowLanternLight: THREE.PointLight;
  private readonly sprayMat: THREE.MeshBasicMaterial;
  private readonly tmpColor = new THREE.Color();

  // Maillages VFX maritimes (0 allocation par frame)
  private readonly wakeGeo: THREE.BufferGeometry;
  private readonly wakePosAttr: THREE.BufferAttribute;
  private readonly wakeStrengthAttr: THREE.BufferAttribute;
  private readonly wakeMesh: THREE.Mesh;
  private readonly bowFoamMesh: THREE.Mesh;
  private readonly hullRippleMesh: THREE.Mesh;
  private readonly windStreakMesh: THREE.Mesh;

  // Ring-buffer pré-alloué pour le ruban de sillage courbé en V
  private readonly wakeX = new Float32Array(WAKE_SEGMENTS);
  private readonly wakeZ = new Float32Array(WAKE_SEGMENTS);
  private readonly wakeRx = new Float32Array(WAKE_SEGMENTS);
  private readonly wakeRz = new Float32Array(WAKE_SEGMENTS);
  private readonly wakeAge = new Float32Array(WAKE_SEGMENTS);
  private readonly wakeStrength = new Float32Array(WAKE_SEGMENTS);
  private wakeInitialized = false;
  private wakeSampleTimer = 0;

  // Pool pré-alloué d'éclaboussures d'étrave (InstancedMesh, 1 draw call, 0 alloc/frame)
  private readonly sprayMesh: THREE.InstancedMesh;
  private readonly sprayX = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayY = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayZ = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayVx = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayVy = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayVz = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayAge = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayLife = new Float32Array(SPRAY_POOL_SIZE);
  private readonly sprayScale = new Float32Array(SPRAY_POOL_SIZE);
  private sprayCursor = 0;
  private sprayEmitAccum = 0;
  private sprayRandState = 1337;

  // Objets temporaires réutilisés (0 GC dans update)
  private readonly dummyObj = new THREE.Object3D();
  private readonly deckAnchors: ShipDeckAnchors = {
    heroWorldPos: new THREE.Vector3(),
    companionWorldPos: new THREE.Vector3(),
    deckRoll: 0,
    deckPitch: 0,
    waterY: WATER_LEVEL_Y,
  };

  // États visuels lissés (100 % découplés de la physique)
  private animTime = 0;
  private smoothWaterY = WATER_LEVEL_Y;
  private smoothRoll = 0;
  private smoothPitch = 0;
  private smoothRudder = 0;
  private smoothBillow = 0.22;
  private smoothSailTrim = 0;
  private smoothSouthOpacity = 1.0;
  private smoothWakeIntensity = 0;
  private smoothWindOpacity = 0;
  private smoothReverseMode = 0;
  private smoothTurnBias = 0;
  private smoothBowFoamSpeed = 0;
  private lastTravelSign: 1 | -1 = 1;
  private prevWaveBow = 0;
  private lanternSwingX = 0;
  private lanternSwingZ = 0;
  private prevShipX = 0;
  private prevShipZ = 0;
  private prevSpeed = 0;
  private hasPrevPos = false;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup.name = 'ShipSystemRoot';
    this.shipYawGroup.name = 'FelingardAdventureShip';
    this.shipMotionGroup.name = 'ShipMotionPivot';
    this.shipMotionGroup.rotation.order = 'YXZ';

    this.rootGroup.add(this.shipYawGroup);
    this.shipYawGroup.add(this.shipMotionGroup);
    this.scene.add(this.rootGroup);

    // 1. Textures PBR Canvas2D (créées une seule fois)
    this.textures = createShipTextureBundle();
    this.disposables.push(
      this.textures.woodAlbedo,
      this.textures.woodNormal,
      this.textures.woodRoughness,
      this.textures.sailAlbedo,
      this.textures.sailNormal,
    );

    // 2. Matériaux PBR partagés (cohérence diorama Félingard + Bloom-safe)
    const woodMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.textures.woodAlbedo,
        normalMap: this.textures.woodNormal,
        normalScale: new THREE.Vector2(0.85, 0.85),
        roughnessMap: this.textures.woodRoughness,
        roughness: 1.0,
        metalness: 0.04,
      }),
    );

    const brassMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xd49b35,
        roughness: 0.34,
        metalness: 0.78,
      }),
    );

    const ropeMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xb99a69,
        roughness: 0.92,
        metalness: 0.02,
      }),
    );

    const accentMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0x35c7c4,
        roughness: 0.42,
        metalness: 0.16,
        emissive: new THREE.Color(0x145e66),
        emissiveIntensity: 0.18,
      }),
    );

    // 3. Géométries statiques fusionnées par matériau (4 draw calls pour tout le corps !)
    const hullDeckTimberGeo = this.track(
      mergeStaticGeometries([
        buildSculptedHullGeometry(),
        buildSculptedDeckGeometry(),
        buildTimberDetailsGeometry(),
      ]),
    );
    const timberMesh = new THREE.Mesh(hullDeckTimberGeo, woodMat);
    timberMesh.name = 'ShipHullAndDeck';
    timberMesh.castShadow = true;
    timberMesh.receiveShadow = true;
    this.shipMotionGroup.add(timberMesh);

    const brassGeo = this.track(buildBrassHardwareGeometry());
    const brassMesh = new THREE.Mesh(brassGeo, brassMat);
    brassMesh.name = 'ShipBrassHardware';
    brassMesh.castShadow = true;
    brassMesh.receiveShadow = true;
    this.shipMotionGroup.add(brassMesh);

    const accentGeo = this.track(buildAccentEmblemsGeometry());
    const accentMesh = new THREE.Mesh(accentGeo, accentMat);
    accentMesh.name = 'ShipTurquoiseAccents';
    accentMesh.castShadow = false;
    accentMesh.receiveShadow = true;
    this.shipMotionGroup.add(accentMesh);

    const ropesGeo = this.track(buildRiggingAndRopesGeometry());
    const ropesMesh = new THREE.Mesh(ropesGeo, ropeMat);
    ropesMesh.name = 'ShipRiggingAndRopes';
    ropesMesh.castShadow = false;
    ropesMesh.receiveShadow = false;
    this.shipMotionGroup.add(ropesMesh);

    // 4. Voiles vivantes (Grande voile + Foc + Vergue pivotante)
    this.sailRigGroup.name = 'ShipSailRig';
    this.sailRigGroup.position.set(0, 0, MAST_Z);
    this.shipMotionGroup.add(this.sailRigGroup);

    const yardGeo = this.track(buildYardarmGeometry());
    yardGeo.translate(0, 0, -MAST_Z);
    const yardMesh = new THREE.Mesh(yardGeo, woodMat);
    yardMesh.name = 'ShipYardarm';
    yardMesh.castShadow = true;
    yardMesh.receiveShadow = true;
    this.sailRigGroup.add(yardMesh);

    this.sailMat = this.track(
      new THREE.MeshStandardMaterial({
        map: this.textures.sailAlbedo,
        normalMap: this.textures.sailNormal,
        normalScale: new THREE.Vector2(0.55, 0.55),
        roughness: 0.88,
        metalness: 0.02,
        emissive: new THREE.Color(0xffe0a4),
        emissiveIntensity: 0.05,
        transparent: true,
        opacity: 1.0,
        depthWrite: true,
        side: THREE.DoubleSide,
      }),
    );
    this.sailUniforms = applySailWindShader(this.sailMat, 'felingard_main_sail_v1');

    const mainSailGeo = this.track(buildMainSailGeometry());
    mainSailGeo.translate(0, 0, -MAST_Z);
    const mainSailMesh = new THREE.Mesh(mainSailGeo, this.sailMat);
    mainSailMesh.name = 'ShipMainSail';
    mainSailMesh.castShadow = true;
    mainSailMesh.receiveShadow = false;
    mainSailMesh.renderOrder = 3;
    mainSailMesh.userData.skipSSAO = true;
    this.sailRigGroup.add(mainSailMesh);

    // Foc triangulaire avant fixé sur shipMotionGroup (point d'amure soudé au beaupré)
    const jibSailGeo = this.track(buildJibSailGeometry());
    const jibSailMesh = new THREE.Mesh(jibSailGeo, this.sailMat);
    jibSailMesh.name = 'ShipJibSail';
    jibSailMesh.castShadow = true;
    jibSailMesh.receiveShadow = false;
    jibSailMesh.renderOrder = 3;
    jibSailMesh.userData.skipSSAO = true;
    this.shipMotionGroup.add(jibSailMesh);

    // 5. Fanion bifide corail/or en tête de mât
    const pennantMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xd44138,
        roughness: 0.78,
        metalness: 0.04,
        emissive: new THREE.Color(0x6e1a12),
        emissiveIntensity: 0.08,
        side: THREE.DoubleSide,
      }),
    );
    this.pennantUniforms = applySailWindShader(pennantMat, 'felingard_pennant_v1');
    const pennantGeo = this.track(buildPennantGeometry());
    const pennantMesh = new THREE.Mesh(pennantGeo, pennantMat);
    pennantMesh.name = 'ShipMastPennant';
    pennantMesh.position.set(0, DECK_Y + MAST_HEIGHT - 0.06, MAST_Z + 0.04);
    pennantMesh.castShadow = false;
    pennantMesh.userData.skipSSAO = true;
    this.shipMotionGroup.add(pennantMesh);

    // 6. Gouvernail & Barre franche articulés (pivot sur l'étambot z = +2.45)
    this.rudderPivot.name = 'ShipRudderPivot';
    this.rudderPivot.position.set(0, 0.06, HULL_STERN_Z);
    const rudderGeo = this.track(buildRudderAndTillerGeometry());
    const rudderMesh = new THREE.Mesh(rudderGeo, woodMat);
    rudderMesh.name = 'ShipRudderAndTiller';
    rudderMesh.castShadow = true;
    rudderMesh.receiveShadow = true;
    this.rudderPivot.add(rudderMesh);
    this.shipMotionGroup.add(this.rudderPivot);

    // 7. Lanterne de poupe pendulaire avec verre ambré HDR (déclenche le Bloom sélectif !)
    this.lanternPivot.name = 'ShipSternLanternPivot';
    this.lanternPivot.position.set(0.90, DECK_Y + 1.22, 2.66);

    const lanternCapTop = new THREE.ConeGeometry(0.115, 0.11, 6);
    lanternCapTop.translate(0, -0.06, 0);
    const lanternBase = new THREE.CylinderGeometry(0.085, 0.065, 0.05, 6);
    lanternBase.translate(0, -0.32, 0);
    const lanternFrameGeo = this.track(mergeStaticGeometries([lanternCapTop, lanternBase]));
    const lanternFrameMesh = new THREE.Mesh(lanternFrameGeo, brassMat);
    lanternFrameMesh.name = 'ShipLanternFrame';
    lanternFrameMesh.castShadow = false;
    this.lanternPivot.add(lanternFrameMesh);

    this.lanternGlowMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffe49c,
        emissive: new THREE.Color(0xffa838),
        emissiveIntensity: 1.55,
        roughness: 0.25,
        metalness: 0.1,
      }),
    );
    const lanternGlassGeo = this.track(new THREE.CylinderGeometry(0.072, 0.058, 0.19, 6));
    lanternGlassGeo.translate(0, -0.20, 0);
    const lanternGlassMesh = new THREE.Mesh(lanternGlassGeo, this.lanternGlowMat);
    lanternGlassMesh.name = 'ShipLanternGlow';
    lanternGlassMesh.userData.skipSSAO = true;
    this.lanternPivot.add(lanternGlassMesh);

    // PointLight chaud attaché à la lanterne de poupe : s'allume doucement la nuit, au crépuscule, en brouillard et tempête
    this.lanternLight = new THREE.PointLight(0xffb454, 0, 15, 1.55);
    this.lanternLight.name = 'ShipSternLanternLight';
    this.lanternLight.position.set(0, -0.22, 0);
    this.lanternLight.castShadow = false;
    this.lanternPivot.add(this.lanternLight);

    this.shipMotionGroup.add(this.lanternPivot);

    // 7b. Lanterne de proue suspendue au beaupré (s'allume au crépuscule, la nuit et par temps d'orage)
    const bowBracketGeo = this.track(new THREE.CylinderGeometry(0.022, 0.026, 0.24, 6));
    bowBracketGeo.rotateX(Math.PI * 0.34);
    const bowBracketMesh = new THREE.Mesh(bowBracketGeo, brassMat);
    bowBracketMesh.name = 'ShipBowLanternBracket';
    bowBracketMesh.position.set(0, DECK_Y + 0.84, -2.86);
    this.shipMotionGroup.add(bowBracketMesh);

    this.bowLanternPivot.name = 'ShipBowLanternPivot';
    this.bowLanternPivot.position.set(0, DECK_Y + 0.78, -2.95);

    const bowLanternFrameMesh = new THREE.Mesh(lanternFrameGeo, brassMat);
    bowLanternFrameMesh.name = 'ShipBowLanternFrame';
    bowLanternFrameMesh.castShadow = false;
    bowLanternFrameMesh.scale.setScalar(0.9);
    this.bowLanternPivot.add(bowLanternFrameMesh);

    this.bowLanternGlowMat = this.track(
      new THREE.MeshStandardMaterial({
        color: 0xffe49c,
        emissive: new THREE.Color(0xffaa38),
        emissiveIntensity: 0.15,
        roughness: 0.25,
        metalness: 0.1,
      }),
    );
    const bowLanternGlassMesh = new THREE.Mesh(lanternGlassGeo, this.bowLanternGlowMat);
    bowLanternGlassMesh.name = 'ShipBowLanternGlow';
    bowLanternGlassMesh.scale.setScalar(0.9);
    bowLanternGlassMesh.userData.skipSSAO = true;
    this.bowLanternPivot.add(bowLanternGlassMesh);

    this.bowLanternLight = new THREE.PointLight(0xffb454, 0, 14, 1.55);
    this.bowLanternLight.name = 'ShipBowLanternLight';
    this.bowLanternLight.position.set(0, -0.2, 0);
    this.bowLanternLight.castShadow = false;
    this.bowLanternPivot.add(this.bowLanternLight);

    this.shipMotionGroup.add(this.bowLanternPivot);

    // 8. Ancres locales exactes du Héros & de Miaou-sprit sur le pont
    this.heroSeatAnchor.name = 'ShipHeroSeatAnchor';
    this.heroSeatAnchor.position.copy(HERO_LOCAL_ANCHOR);
    this.shipMotionGroup.add(this.heroSeatAnchor);

    this.companionSeatAnchor.name = 'ShipCompanionSeatAnchor';
    this.companionSeatAnchor.position.copy(COMPANION_LOCAL_ANCHOR);
    this.shipMotionGroup.add(this.companionSeatAnchor);

    // 9. Effets d'eau & vent (0 allocation par frame, skipSSAO = true)
    // 9a. Sillage dynamique en V courbé (espace monde)
    this.wakeGeo = this.track(new THREE.BufferGeometry());
    const wakePositions = new Float32Array(WAKE_SEGMENTS * 2 * 3);
    const wakeUvs = new Float32Array(WAKE_SEGMENTS * 2 * 2);
    const wakeIndices: number[] = [];
    for (let i = 0; i < WAKE_SEGMENTS; i++) {
      const v = i / (WAKE_SEGMENTS - 1);
      wakeUvs[i * 4] = 0;
      wakeUvs[i * 4 + 1] = v;
      wakeUvs[i * 4 + 2] = 1;
      wakeUvs[i * 4 + 3] = v;
      if (i < WAKE_SEGMENTS - 1) {
        const a = i * 2;
        const b = a + 2;
        const c = a + 3;
        const d = a + 1;
        wakeIndices.push(a, b, c, a, c, d);
      }
    }
    this.wakePosAttr = new THREE.BufferAttribute(wakePositions, 3);
    this.wakePosAttr.setUsage(THREE.DynamicDrawUsage);
    const wakeStrengthVerts = new Float32Array(WAKE_SEGMENTS * 2);
    this.wakeStrengthAttr = new THREE.BufferAttribute(wakeStrengthVerts, 1);
    this.wakeStrengthAttr.setUsage(THREE.DynamicDrawUsage);
    this.wakeGeo.setAttribute('position', this.wakePosAttr);
    this.wakeGeo.setAttribute('uv', new THREE.BufferAttribute(wakeUvs, 2));
    this.wakeGeo.setAttribute('aWakeStrength', this.wakeStrengthAttr);
    this.wakeGeo.setIndex(wakeIndices);

    this.wakeMat = this.track(createShipWakeMaterial());
    this.wakeMesh = new THREE.Mesh(this.wakeGeo, this.wakeMat);
    this.wakeMesh.name = 'ShipWakeRibbon';
    this.wakeMesh.renderOrder = 1;
    this.wakeMesh.frustumCulled = false;
    this.wakeMesh.castShadow = false;
    this.wakeMesh.receiveShadow = false;
    this.wakeMesh.userData.skipSSAO = true;
    this.rootGroup.add(this.wakeMesh);

    // 9b. Mousse de proue (attachée à shipYawGroup -> reste posée sur la mer)
    const bowFoamGeo = this.track(buildBowFoamGeometry());
    this.bowFoamMat = this.track(createBowFoamMaterial());
    this.bowFoamMesh = new THREE.Mesh(bowFoamGeo, this.bowFoamMat);
    this.bowFoamMesh.name = 'ShipBowFoam';
    this.bowFoamMesh.renderOrder = 2;
    this.bowFoamMesh.castShadow = false;
    this.bowFoamMesh.receiveShadow = false;
    this.bowFoamMesh.userData.skipSSAO = true;
    this.shipYawGroup.add(this.bowFoamMesh);

    // 9c. Collerette d'ondulations autour de la flottaison
    const rippleGeo = this.track(buildHullRippleGeometry());
    this.hullRippleMat = this.track(createHullRippleMaterial());
    this.hullRippleMesh = new THREE.Mesh(rippleGeo, this.hullRippleMat);
    this.hullRippleMesh.name = 'ShipHullRipples';
    this.hullRippleMesh.renderOrder = 1;
    this.hullRippleMesh.castShadow = false;
    this.hullRippleMesh.receiveShadow = false;
    this.hullRippleMesh.userData.skipSSAO = true;
    this.shipYawGroup.add(this.hullRippleMesh);

    // 9d. Pool d'éclaboussures & embruns d'étrave (InstancedMesh, 1 draw call, 0 alloc)
    const sprayGeo = this.track(new THREE.IcosahedronGeometry(0.115, 0));
    this.sprayMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xcbe4ec,
        transparent: true,
        opacity: 0.74,
        depthWrite: false,
        fog: true,
      }),
    );
    this.sprayMesh = new THREE.InstancedMesh(sprayGeo, this.sprayMat, SPRAY_POOL_SIZE);
    this.sprayMesh.name = 'ShipBowSprayPool';
    this.sprayMesh.renderOrder = 2;
    this.sprayMesh.frustumCulled = false;
    this.sprayMesh.castShadow = false;
    this.sprayMesh.receiveShadow = false;
    this.sprayMesh.userData.skipSSAO = true;
    this.dummyObj.scale.set(0, 0, 0);
    this.dummyObj.updateMatrix();
    for (let i = 0; i < SPRAY_POOL_SIZE; i++) {
      this.sprayLife[i] = 0;
      this.sprayAge[i] = 1;
      this.sprayMesh.setMatrixAt(i, this.dummyObj.matrix);
    }
    this.sprayMesh.instanceMatrix.needsUpdate = true;
    this.rootGroup.add(this.sprayMesh);

    // 9e. Filets de vent stylisés discrets (apparaissent > 35 % vitesse)
    const windGeo = this.track(buildWindStreaksGeometry());
    this.windStreakMat = this.track(createWindStreakMaterial());
    this.windStreakMesh = new THREE.Mesh(windGeo, this.windStreakMat);
    this.windStreakMesh.name = 'ShipWindStreaks';
    this.windStreakMesh.renderOrder = 3;
    this.windStreakMesh.castShadow = false;
    this.windStreakMesh.receiveShadow = false;
    this.windStreakMesh.userData.skipSSAO = true;
    this.shipYawGroup.add(this.windStreakMesh);
  }

  private track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private nextRand(): number {
    this.sprayRandState = (Math.imul(this.sprayRandState, 1664525) + 1013904223) >>> 0;
    return this.sprayRandState / 4294967296;
  }

  /**
   * Réinitialise instantanément le ruban de sillage et le pool d'embruns
   * (à appeler sur transition de zone, chargement de sauvegarde ou nouvelle partie).
   */
  public resetWake(): void {
    this.wakeInitialized = false;
    this.wakeSampleTimer = 0;
    this.hasPrevPos = false;
    this.smoothWakeIntensity = 0;
    this.smoothReverseMode = 0;
    this.smoothTurnBias = 0;
    this.smoothBowFoamSpeed = 0;
    this.lastTravelSign = 1;
    this.wakeMat.uniforms.uIntensity.value = 0;
    this.wakeMat.uniforms.uReverseMode.value = 0;
    this.wakeMat.uniforms.uTurnBias.value = 0;
    this.bowFoamMat.uniforms.uSpeedRatio.value = 0;

    const strengthArr = this.wakeStrengthAttr.array as Float32Array;
    for (let i = 0; i < WAKE_SEGMENTS; i++) {
      this.wakeAge[i] = 1;
      this.wakeStrength[i] = 0;
      strengthArr[i * 2] = 0;
      strengthArr[i * 2 + 1] = 0;
      const idx = i * 6;
      const arr = this.wakePosAttr.array as Float32Array;
      arr[idx] = 0;
      arr[idx + 1] = -10;
      arr[idx + 2] = 0;
      arr[idx + 3] = 0;
      arr[idx + 4] = -10;
      arr[idx + 5] = 0;
    }
    this.wakePosAttr.needsUpdate = true;
    this.wakeStrengthAttr.needsUpdate = true;

    this.dummyObj.position.set(0, -10, 0);
    this.dummyObj.scale.set(0, 0, 0);
    this.dummyObj.updateMatrix();
    for (let i = 0; i < SPRAY_POOL_SIZE; i++) {
      this.sprayLife[i] = 0;
      this.sprayAge[i] = 1;
      this.sprayMesh.setMatrixAt(i, this.dummyObj.matrix);
    }
    this.sprayMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Retourne les ancres monde exactes du Héros et de Miaou-sprit sur le pont
   * (à lire par `EntityRenderer` après `shipRenderer.update(...)`).
   */
  public getDeckAnchors(): ShipDeckAnchors {
    return this.deckAnchors;
  }

  private updateWakeRibbon(
    shipX: number,
    shipZ: number,
    angle: number,
    speedRatio: number,
    signedSpeed: number,
    turnBias: number,
    targetIntensity: number,
    oceanTime: number,
    waveAmplitude: number,
    waveChoppiness: number,
    stormIntensity: number,
    dt: number,
  ): void {
    // Vecteurs monde canoniques : forward = (-sin(angle), -cos(angle)), right = (cos(angle), -sin(angle))
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);
    const fwdX = -sinA;
    const fwdZ = -cosA;
    const rightX = cosA;
    const rightZ = -sinA;

    // Inversion douce de l'ancrage du sillage en marche arrière afin qu'il file toujours derrière le déplacement réel
    const travelSign: 1 | -1 = signedSpeed < -0.35 ? -1 : signedSpeed > 0.25 ? 1 : this.lastTravelSign;
    if (travelSign !== this.lastTravelSign) {
      this.lastTravelSign = travelSign;
      // Atténue l'ancien ruban sans coupure brutale ni repli à travers la coque
      for (let i = 0; i < WAKE_SEGMENTS; i++) {
        this.wakeStrength[i] *= 0.22;
      }
      this.wakeInitialized = false;
    }

    // Origine du sillage : poupe (+2.18 u) en marche avant, étrave (-2.25 u) en marche arrière
    const anchorOffset = travelSign === 1 ? -2.18 : 2.25;
    const trailDirX = travelSign === 1 ? -fwdX : fwdX;
    const trailDirZ = travelSign === 1 ? -fwdZ : fwdZ;
    const sternX = shipX + fwdX * anchorOffset;
    const sternZ = shipZ + fwdZ * anchorOffset;

    if (!this.wakeInitialized) {
      for (let i = 0; i < WAKE_SEGMENTS; i++) {
        const back = i * 0.32;
        this.wakeX[i] = sternX + trailDirX * back;
        this.wakeZ[i] = sternZ + trailDirZ * back;
        this.wakeRx[i] = rightX;
        this.wakeRz[i] = rightZ;
        this.wakeAge[i] = i / (WAKE_SEGMENTS - 1);
        this.wakeStrength[i] = 0;
      }
      this.wakeInitialized = true;
    }

    // Vieillissement et dissipation progressive de tous les segments de sillage
    const ageRate = 0.48 + speedRatio * 0.36;
    const decayRate = targetIntensity < 0.05 ? 0.92 : 0.22;
    for (let i = 0; i < WAKE_SEGMENTS; i++) {
      this.wakeAge[i] = Math.min(1, this.wakeAge[i] + dt * ageRate);
      this.wakeStrength[i] = Math.max(0, this.wakeStrength[i] - dt * decayRate);
    }

    // Échantillonne un nouveau nœud de sillage dès que le bateau bouge (courbure fidèle en virage)
    this.wakeSampleTimer += dt;
    const dxHead = sternX - this.wakeX[0];
    const dzHead = sternZ - this.wakeZ[0];
    const headDist = Math.hypot(dxHead, dzHead);

    if (headDist >= 0.32 || (this.wakeSampleTimer >= 0.045 && targetIntensity > 0.04)) {
      this.wakeSampleTimer = 0;
      for (let i = WAKE_SEGMENTS - 1; i > 0; i--) {
        this.wakeX[i] = this.wakeX[i - 1];
        this.wakeZ[i] = this.wakeZ[i - 1];
        this.wakeRx[i] = this.wakeRx[i - 1];
        this.wakeRz[i] = this.wakeRz[i - 1];
        this.wakeAge[i] = this.wakeAge[i - 1];
        this.wakeStrength[i] = this.wakeStrength[i - 1];
      }
      this.wakeX[0] = sternX;
      this.wakeZ[0] = sternZ;
      this.wakeRx[0] = rightX;
      this.wakeRz[0] = rightZ;
      this.wakeAge[0] = 0;
      this.wakeStrength[0] = targetIntensity;
    } else {
      // Garde la tête du ruban soudée sans décrochage au bateau
      this.wakeX[0] = sternX;
      this.wakeZ[0] = sternZ;
      this.wakeRx[0] = rightX;
      this.wakeRz[0] = rightZ;
      this.wakeAge[0] = 0;
      this.wakeStrength[0] = targetIntensity;
    }

    // Met à jour les VertexBuffers en place (0 allocation) en suivant exactement la houle & les côtes
    const posArr = this.wakePosAttr.array as Float32Array;
    const strArr = this.wakeStrengthAttr.array as Float32Array;
    const turnWiden = Math.abs(turnBias) * 0.55;
    const revScale = travelSign === -1 ? 0.72 : 1.0;

    for (let i = 0; i < WAKE_SEGMENTS; i++) {
      const frac = i / (WAKE_SEGMENTS - 1);
      // Ouverture progressive en V de Kelvin (élargie en virage & grande vitesse)
      const halfWidth =
        (0.92 + Math.pow(frac, 0.85) * (1.75 + 1.05 * speedRatio + turnWiden)) * revScale;
      const cx = this.wakeX[i];
      const cz = this.wakeZ[i];
      const rx = this.wakeRx[i] * halfWidth;
      const rz = this.wakeRz[i] * halfWidth;

      const lx = cx - rx;
      const lz = cz - rz;
      const rpx = cx + rx;
      const rpz = cz + rz;

      // Échantillonne la hauteur exacte de la houle aux 2 bords pour épouser parfaitement la mer agitée
      const wyL =
        WATER_LEVEL_Y +
        sampleOceanWaveHeight(
          lx,
          lz,
          oceanTime,
          ARCHIPELAGO_COASTS,
          0.6,
          waveAmplitude,
          waveChoppiness,
          stormIntensity,
        ) +
        0.06;
      const wyR =
        WATER_LEVEL_Y +
        sampleOceanWaveHeight(
          rpx,
          rpz,
          oceanTime,
          ARCHIPELAGO_COASTS,
          0.6,
          waveAmplitude,
          waveChoppiness,
          stormIntensity,
        ) +
        0.06;

      const idx = i * 6;
      posArr[idx] = lx;
      posArr[idx + 1] = wyL;
      posArr[idx + 2] = lz;
      posArr[idx + 3] = rpx;
      posArr[idx + 4] = wyR;
      posArr[idx + 5] = rpz;

      // Atténue strictement chaque bord du sillage à l'approche d'une côte (0 traversée du sable !)
      const coastL = sampleOceanCoastDistance(lx, lz, ARCHIPELAGO_COASTS, 0.6);
      const coastR = sampleOceanCoastDistance(rpx, rpz, ARCHIPELAGO_COASTS, 0.6);
      const sVal = this.wakeStrength[i];
      strArr[i * 2] = sVal * smoothstep(0.35, 2.4, coastL);
      strArr[i * 2 + 1] = sVal * smoothstep(0.35, 2.4, coastR);
    }
    this.wakePosAttr.needsUpdate = true;
    this.wakeStrengthAttr.needsUpdate = true;

    const wakeAlpha = safeExpAlpha(6.0, dt);
    this.smoothWakeIntensity += (targetIntensity - this.smoothWakeIntensity) * wakeAlpha;
    const reverseTarget = travelSign === -1 ? 1.0 : 0.0;
    this.smoothReverseMode += (reverseTarget - this.smoothReverseMode) * wakeAlpha;
    this.smoothTurnBias += (turnBias - this.smoothTurnBias) * wakeAlpha;

    this.wakeMat.uniforms.uTime.value = oceanTime;
    this.wakeMat.uniforms.uIntensity.value = this.smoothWakeIntensity;
    this.wakeMat.uniforms.uReverseMode.value = this.smoothReverseMode;
    this.wakeMat.uniforms.uTurnBias.value = this.smoothTurnBias;
  }

  private updateBowSprayPool(
    shipX: number,
    shipZ: number,
    angle: number,
    waterY: number,
    signedSpeed: number,
    speedRatio: number,
    accel: number,
    rudder: number,
    stormIntensity: number,
    bowCrestImpact: number,
    shoreFade: number,
    dt: number,
  ): void {
    const sinA = Math.sin(angle);
    const cosA = Math.cos(angle);
    const fwdX = -sinA;
    const fwdZ = -cosA;
    const rightX = cosA;
    const rightZ = -sinA;

    // Émission d'embruns liée à la vitesse, l'accélération, les virages, la houle de tempête et la marche arrière
    const fwdRatio = signedSpeed > 0 ? speedRatio : 0;
    const revRatio = signedSpeed < -0.35 ? clamp(Math.abs(signedSpeed) / 4.2, 0, 1) : 0;
    const accelBoost = Math.max(0, accel) * 0.65;
    const turnBoost = Math.abs(rudder) * 0.72;
    const stormBowSlam = stormIntensity * clamp(bowCrestImpact * 2.2, 0, 1.15);

    if (dt > 0 && shoreFade > 0.15) {
      let emitRate = 0;
      let isReverseSpray = false;
      if (fwdRatio > 0.12 || stormBowSlam > 0.25) {
        emitRate =
          ((12 + 34 * fwdRatio) * (1 + turnBoost + accelBoost) + stormBowSlam * 24) * shoreFade;
      } else if (revRatio > 0.18) {
        emitRate = (8 + 16 * revRatio) * shoreFade;
        isReverseSpray = true;
      }

      if (emitRate > 0.1) {
        this.sprayEmitAccum += dt * emitRate;
        while (this.sprayEmitAccum >= 1.0) {
          this.sprayEmitAccum -= 1.0;
          const slot = this.sprayCursor;
          this.sprayCursor = (this.sprayCursor + 1) % SPRAY_POOL_SIZE;

          if (isReverseSpray) {
            // Éclaboussures de remous autour du gouvernail en marche arrière
            const side = this.nextRand() >= 0.5 ? 1 : -1;
            this.sprayX[slot] = shipX - fwdX * (2.15 + this.nextRand() * 0.45) + rightX * (side * (0.35 + this.nextRand() * 0.55));
            this.sprayY[slot] = waterY + 0.08 + this.nextRand() * 0.12;
            this.sprayZ[slot] = shipZ - fwdZ * (2.15 + this.nextRand() * 0.45) + rightZ * (side * (0.35 + this.nextRand() * 0.55));

            const latSpeed = (0.9 + this.nextRand() * 1.2) * revRatio;
            this.sprayVx[slot] = rightX * (side * latSpeed) + fwdX * (0.6 + this.nextRand() * 0.9);
            this.sprayVy[slot] = (1.05 + this.nextRand() * 1.15) * (0.55 + 0.45 * revRatio);
            this.sprayVz[slot] = rightZ * (side * latSpeed) + fwdZ * (0.6 + this.nextRand() * 0.9);
            this.sprayAge[slot] = 0;
            this.sprayLife[slot] = 0.26 + this.nextRand() * 0.2;
            this.sprayScale[slot] = 0.42 + this.nextRand() * 0.55;
          } else {
            // Embruns d'étrave — côté extérieur favorisé en virage + gerbes sur houle de tempête
            const sideBias = this.nextRand() - 0.5 - rudder * 0.3;
            const side = sideBias >= 0 ? 1 : -1;

            const alongBow = 1.6 + this.nextRand() * 0.9;
            const outHull = 0.55 + (2.5 - alongBow) * 0.65;

            this.sprayX[slot] = shipX + fwdX * alongBow + rightX * (side * outHull);
            this.sprayY[slot] = waterY + 0.12 + this.nextRand() * 0.16;
            this.sprayZ[slot] = shipZ + fwdZ * alongBow + rightZ * (side * outHull);

            const energy = clamp(fwdRatio + stormBowSlam * 0.55 + accelBoost * 0.3, 0.25, 1.35);
            const latSpeed = (1.6 + this.nextRand() * 2.2) * (0.6 + energy * 0.72);
            const backSpeed = (0.55 + this.nextRand() * 1.5) * Math.max(0.25, fwdRatio);
            this.sprayVx[slot] = rightX * (side * latSpeed) - fwdX * backSpeed;
            this.sprayVy[slot] = (1.6 + this.nextRand() * 1.95) * (0.55 + energy * 0.6);
            this.sprayVz[slot] = rightZ * (side * latSpeed) - fwdZ * backSpeed;

            this.sprayAge[slot] = 0;
            this.sprayLife[slot] = 0.34 + this.nextRand() * 0.28;
            this.sprayScale[slot] = 0.52 + this.nextRand() * 0.92 * (0.68 + energy * 0.42);
          }
        }
      }
    }

    // Intégration balistique des 48 instances (0 allocation)
    let dirty = false;
    for (let i = 0; i < SPRAY_POOL_SIZE; i++) {
      const life = this.sprayLife[i];
      if (life <= 0) continue;

      this.sprayAge[i] += dt;
      const age = this.sprayAge[i];
      if (age >= life) {
        this.sprayLife[i] = 0;
        this.dummyObj.position.set(0, -10, 0);
        this.dummyObj.scale.set(0, 0, 0);
        this.dummyObj.updateMatrix();
        this.sprayMesh.setMatrixAt(i, this.dummyObj.matrix);
        dirty = true;
        continue;
      }

      this.sprayVy[i] -= 9.8 * dt;
      this.sprayX[i] += this.sprayVx[i] * dt;
      this.sprayY[i] += this.sprayVy[i] * dt;
      this.sprayZ[i] += this.sprayVz[i] * dt;

      const t = age / life;
      // Courbe de taille : jaillit vite puis s'efface en retombant
      const s = this.sprayScale[i] * Math.sin(t * Math.PI) * (1.15 - t * 0.45);
      this.dummyObj.position.set(this.sprayX[i], this.sprayY[i], this.sprayZ[i]);
      this.dummyObj.rotation.set(age * 4.0 + i, age * 3.0, 0);
      this.dummyObj.scale.set(s, s * 0.82, s);
      this.dummyObj.updateMatrix();
      this.sprayMesh.setMatrixAt(i, this.dummyObj.matrix);
      dirty = true;
    }

    if (dirty) {
      this.sprayMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Met à jour l'ensemble du voilier 3D et des effets maritimes à chaque frame.
   * Lecture seule sur `state.ship` : 100 % découplé de la physique et synchronisé
   * en phase exacte avec la houle océanique & la météo (calme, brouillard, tempête).
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

    const isOverworld = state.zoneId === 'overworld';
    this.rootGroup.visible = isOverworld;
    if (!isOverworld) {
      return;
    }

    const ship = state.ship;
    const sx = ship.position.x;
    const sz = ship.position.z;
    const heading = ship.angle;

    // Détection de téléportation (load save / reset) -> purge propre du sillage
    if (this.hasPrevPos) {
      const jumpDist = Math.hypot(sx - this.prevShipX, sz - this.prevShipZ);
      if (jumpDist > 12.0) {
        this.resetWake();
      }
    }
    this.prevShipX = sx;
    this.prevShipZ = sz;
    this.hasPrevPos = true;

    const oceanTime = weather ? weather.oceanTime : this.animTime;
    const waveAmp = weather ? weather.waveAmplitude : 1.18;
    const waveChop = weather ? weather.waveChoppiness : 0.48;
    const storm = weather ? weather.stormIntensity : 0.0;
    const windPower = weather ? weather.windIntensity : 0.2;

    const isActivelyMoving = ship.mode === 'sailing' || ship.mode === 'docking';
    const signedSpeed = ship.speed;
    const absSpeed = Math.abs(signedSpeed);
    const speedRatio = clamp(Math.max(absSpeed / MAX_REF_SPEED, ship.wakeIntensity * 0.9), 0, 1);
    const signedSpeedRatio =
      signedSpeed >= 0
        ? clamp(signedSpeed / MAX_REF_SPEED, 0, 1)
        : -clamp(Math.abs(signedSpeed) / 4.2, 0, 1);
    const accel = safeDt > 0.001 ? clamp((signedSpeed - this.prevSpeed) / (safeDt * 14), -1, 1) : 0;
    this.prevSpeed = signedSpeed;

    // 1. Échantillonnage 4-points de la houle Gerstner exacte (proue, poupe, bâbord, tribord)
    const sinA = Math.sin(heading);
    const cosA = Math.cos(heading);
    const fwdX = -sinA;
    const fwdZ = -cosA;
    const rightX = cosA;
    const rightZ = -sinA;

    const bowX = sx + fwdX * 2.1;
    const bowZ = sz + fwdZ * 2.1;
    const hBow = sampleOceanWaveHeight(
      bowX,
      bowZ,
      oceanTime,
      ARCHIPELAGO_COASTS,
      0.6,
      waveAmp,
      waveChop,
      storm,
    );
    const hStern = sampleOceanWaveHeight(
      sx - fwdX * 2.1,
      sz - fwdZ * 2.1,
      oceanTime,
      ARCHIPELAGO_COASTS,
      0.6,
      waveAmp,
      waveChop,
      storm,
    );
    const hPort = sampleOceanWaveHeight(
      sx - rightX * 1.25,
      sz - rightZ * 1.25,
      oceanTime,
      ARCHIPELAGO_COASTS,
      0.6,
      waveAmp,
      waveChop,
      storm,
    );
    const hStbd = sampleOceanWaveHeight(
      sx + rightX * 1.25,
      sz + rightZ * 1.25,
      oceanTime,
      ARCHIPELAGO_COASTS,
      0.6,
      waveAmp,
      waveChop,
      storm,
    );

    // Détection d'impact d'étrave sur crête de vague (embruns dynamiques en tempête)
    const bowRiseRate = safeDt > 0.001 ? Math.max(0, (hBow - this.prevWaveBow) / safeDt) : 0;
    this.prevWaveBow = hBow;
    const bowCrestImpact = clamp(bowRiseRate * 0.45 + Math.max(0, hBow) * 0.65, 0, 1.2);

    const hullCoastDist = sampleOceanCoastDistance(sx, sz, ARCHIPELAGO_COASTS, 0.6);
    const bowCoastDist = sampleOceanCoastDistance(bowX, bowZ, ARCHIPELAGO_COASTS, 0.6);
    const hullShoreFade = smoothstep(0.2, 2.2, hullCoastDist);
    const bowShoreFade = smoothstep(0.3, 2.5, bowCoastDist);

    const waveCenterY = (hBow + hStern + hPort + hStbd) * 0.25;
    // Couplage visuel renforcé sur la houle (calme discret, tempête bien visible mais bateau toujours lisible)
    const swellGain = 0.78 + storm * 0.34;
    // pitch > 0 lève la proue (-Z)
    const wavePitch = Math.atan2(hBow - hStern, 4.2) * swellGain;
    // roll < 0 penche le mât (+Y) vers tribord (+X) quand bâbord (-X) est plus haut que tribord (+X)
    const waveRoll = Math.atan2(hStbd - hPort, 2.5) * (0.72 + storm * 0.28);

    const targetWaterY =
      WATER_LEVEL_Y + waveCenterY + ship.bobY * (0.18 + hullShoreFade * 0.08);
    const yAlpha = safeExpAlpha(9.5, safeDt);
    this.smoothWaterY += (targetWaterY - this.smoothWaterY) * yAlpha;

    // 2. Combinaison fluide houle + gîte virage + cabrage accélération / léger piqué freinage-recul
    const bowDynamicPitch = isActivelyMoving
      ? signedSpeed >= 0
        ? 0.055 * speedRatio + Math.max(0, accel) * 0.055 + Math.min(0, accel) * 0.032
        : -0.042 * clamp(Math.abs(signedSpeed) / 4.2, 0, 1)
      : 0;
    const targetPitch = clamp(wavePitch + ship.pitch * 0.68 + bowDynamicPitch, -0.21, 0.24);
    const turnHeel = isActivelyMoving
      ? -ship.angularVelocity * 0.072 * (0.38 + 0.62 * speedRatio)
      : 0;
    const targetRoll = clamp(waveRoll + ship.roll * 0.76 + turnHeel, -0.29, 0.29);

    const rotAlpha = safeExpAlpha(8.0, safeDt);
    this.smoothPitch += (targetPitch - this.smoothPitch) * rotAlpha;
    this.smoothRoll += (targetRoll - this.smoothRoll) * rotAlpha;

    // Application stricte de la convention unifiée 1:1 : rotation.y = state.ship.angle
    this.shipYawGroup.position.set(sx, this.smoothWaterY, sz);
    this.shipYawGroup.rotation.y = heading;

    this.shipMotionGroup.rotation.x = this.smoothPitch;
    this.shipMotionGroup.rotation.z = this.smoothRoll;

    // 3. Gouvernail & Barre franche articulés (±28° selon state.ship.rudder)
    const idleRudderSway = Math.sin(this.animTime * (1.45 + storm * 0.9)) * (0.06 + storm * 0.08);
    const targetRudder = isActivelyMoving ? clamp(ship.rudder, -1, 1) : idleRudderSway;
    const rudderAlpha = safeExpAlpha(12.0, safeDt);
    this.smoothRudder += (targetRudder - this.smoothRudder) * rudderAlpha;
    this.rudderPivot.rotation.y = this.smoothRudder * MAX_RUDDER_RAD;

    // 4. Voiles & Fanion animés au vent (sensibles aussi aux rafales de tempête) + Fade anti-occlusion plein Sud
    const forwardSpeedFactor = signedSpeed > 0 ? speedRatio : speedRatio * 0.25;
    const targetBillow =
      ship.mode === 'parked' || ship.mode === 'boarding' || ship.mode === 'disembarking'
        ? 0.2 + windPower * 0.38
        : clamp(0.28 + 0.62 * forwardSpeedFactor + windPower * 0.32, 0.2, 1.15);
    const billowAlpha = safeExpAlpha(5.0, safeDt);
    this.smoothBillow += (targetBillow - this.smoothBillow) * billowAlpha;

    const targetTrim = isActivelyMoving ? clamp(-ship.rudder * 0.85, -1, 1) : 0;
    this.smoothSailTrim += (targetTrim - this.smoothSailTrim) * billowAlpha;
    // Brasage discret de la vergue et des voiles en virage (±10°)
    this.sailRigGroup.rotation.y = this.smoothSailTrim * 0.17;

    const sailFlutter = clamp(0.22 + 0.62 * speedRatio + windPower * 0.55, 0.2, 1.35);
    this.sailUniforms.uSailTime.value = this.animTime;
    this.sailUniforms.uSailBillow.value = this.smoothBillow;
    this.sailUniforms.uSailFlutter.value = sailFlutter;
    this.sailUniforms.uSailTrim.value = this.smoothSailTrim;

    this.pennantUniforms.uSailTime.value = this.animTime * (1.35 + windPower * 0.55);
    this.pennantUniforms.uSailBillow.value = clamp(0.28 + 0.55 * speedRatio + windPower * 0.45, 0.28, 1.25);
    this.pennantUniforms.uSailFlutter.value = clamp(0.35 + 0.52 * speedRatio + windPower * 0.65, 0.35, 1.45);
    this.pennantUniforms.uSailTrim.value = this.smoothSailTrim * 0.5;

    // Fade anti-occlusion plein Sud : quand forwardZ = -cos(angle) > 0.35 -> opacité 1.0 -> 0.48
    const southFacing = smoothstep(0.35, 0.86, fwdZ);
    const targetOpacity = 1.0 - southFacing * 0.52;
    const opAlpha = safeExpAlpha(9.0, safeDt);
    this.smoothSouthOpacity += (targetOpacity - this.smoothSouthOpacity) * opAlpha;
    this.sailMat.opacity = this.smoothSouthOpacity;
    this.sailMat.depthWrite = this.smoothSouthOpacity > 0.96;

    // 5. Balancement pendulaire amorti de la lanterne HDR + halo chaud de nuit/brouillard/tempête
    const lanternTargetZ =
      -this.smoothRoll * 0.9 + Math.sin(this.animTime * (2.6 + storm * 1.4)) * (0.05 + storm * 0.07);
    const lanternTargetX =
      -this.smoothPitch * 0.8 + Math.cos(this.animTime * (2.1 + storm * 1.2)) * (0.04 + storm * 0.06);
    const lanAlpha = safeExpAlpha(5.5, safeDt);
    this.lanternSwingZ += (lanternTargetZ - this.lanternSwingZ) * lanAlpha;
    this.lanternSwingX += (lanternTargetX - this.lanternSwingX) * lanAlpha;
    this.lanternPivot.rotation.set(this.lanternSwingX, 0, this.lanternSwingZ);
    this.bowLanternPivot.rotation.set(this.lanternSwingX * 1.15, 0, this.lanternSwingZ * 1.15);

    const lanternBoost = weather ? weather.lanternBoost : 0;
    const bowBoost = computeShipBowLanternLevel(weather);
    const flicker =
      Math.sin(this.animTime * 6.8) * 0.1 + Math.sin(this.animTime * 13.4) * 0.04;
    this.lanternGlowMat.emissiveIntensity = 1.48 + lanternBoost * 0.72 + flicker;
    this.lanternLight.intensity = lanternBoost > 0.04 ? lanternBoost * (4.6 + flicker * 1.6) : 0;

    this.bowLanternGlowMat.emissiveIntensity =
      bowBoost > 0.04 ? 1.45 + bowBoost * 0.85 + flicker : 0.12;
    this.bowLanternLight.intensity =
      bowBoost > 0.04 ? bowBoost * (4.8 + flicker * 1.6) : 0;
    this.bowLanternLight.visible = bowBoost > 0.04;

    // 6. Mise à jour des matrices monde et export des ancres de pont pour EntityRenderer
    this.shipYawGroup.updateMatrixWorld(true);
    this.heroSeatAnchor.getWorldPosition(this.deckAnchors.heroWorldPos);
    this.companionSeatAnchor.getWorldPosition(this.deckAnchors.companionWorldPos);
    this.deckAnchors.deckRoll = this.smoothRoll;
    this.deckAnchors.deckPitch = this.smoothPitch;
    this.deckAnchors.waterY = this.smoothWaterY;

    // 7. Mise à jour des teintes météo & brouillard des effets maritimes (0 allocation/frame)
    if (weather) {
      this.tmpColor.copy(weather.waterFoamColor);
      (this.wakeMat.uniforms.uFoamColor.value as THREE.Color).copy(this.tmpColor);
      (this.bowFoamMat.uniforms.uFoamColor.value as THREE.Color).copy(this.tmpColor);
      (this.hullRippleMat.uniforms.uFoamColor.value as THREE.Color).copy(this.tmpColor);
      (this.windStreakMat.uniforms.uColor.value as THREE.Color).copy(this.tmpColor);
      this.sprayMat.color.copy(this.tmpColor);

      (this.wakeMat.uniforms.uTurquoiseColor.value as THREE.Color).copy(weather.waterShallowColor);
      (this.bowFoamMat.uniforms.uTurquoiseColor.value as THREE.Color).copy(weather.waterShallowColor);

      (this.wakeMat.uniforms.uFogColor.value as THREE.Color).copy(weather.fogColor);
      (this.bowFoamMat.uniforms.uFogColor.value as THREE.Color).copy(weather.fogColor);
      (this.hullRippleMat.uniforms.uFogColor.value as THREE.Color).copy(weather.fogColor);
    }
    this.wakeMat.uniforms.uFogNear.value = fogNear;
    this.wakeMat.uniforms.uFogFar.value = fogFar;
    this.bowFoamMat.uniforms.uFogNear.value = fogNear;
    this.bowFoamMat.uniforms.uFogFar.value = fogFar;
    this.hullRippleMat.uniforms.uFogNear.value = fogNear;
    this.hullRippleMat.uniforms.uFogFar.value = fogFar;

    // 8. Effets hydrodynamiques réactifs (arrêt, accélération, croisière, virage, freinage/recul, plage)
    const turnBias = isActivelyMoving
      ? clamp(-ship.angularVelocity * 0.65 + this.smoothRudder * 0.45, -1, 1)
      : 0;
    const accelSurges = Math.max(0, accel) * 0.22;
    const wakeTarget = isActivelyMoving
      ? clamp(Math.max(ship.wakeIntensity, speedRatio + accelSurges), 0, 1)
      : 0;

    this.updateWakeRibbon(
      sx,
      sz,
      heading,
      speedRatio,
      signedSpeed,
      turnBias,
      wakeTarget,
      oceanTime,
      waveAmp,
      waveChop,
      storm,
      safeDt,
    );

    // Mousse d'étrave : intense en accélération/marche avant, s'estompe au freinage et s'éteint en marche arrière
    const targetBowFoam =
      isActivelyMoving && signedSpeed > 0.15
        ? clamp(signedSpeedRatio + Math.max(0, accel) * 0.25 + storm * 0.12, 0, 1)
        : 0;
    this.smoothBowFoamSpeed += (targetBowFoam - this.smoothBowFoamSpeed) * safeExpAlpha(8.0, safeDt);
    this.bowFoamMat.uniforms.uTime.value = oceanTime;
    this.bowFoamMat.uniforms.uSpeedRatio.value = this.smoothBowFoamSpeed;
    this.bowFoamMat.uniforms.uTurnBias.value = this.smoothTurnBias;
    this.bowFoamMat.uniforms.uShoreFade.value = bowShoreFade;
    this.bowFoamMat.uniforms.uStormBoost.value = storm;

    // Ondulations autour de la coque : discrètes à l'arrêt, actives en tempête & remous poupe en marche arrière
    const rippleActivity = isActivelyMoving
      ? clamp(Math.max(speedRatio, 0.24 + storm * 0.35), 0.16, 1.0)
      : clamp(0.18 + storm * 0.32, 0.16, 0.55);
    this.hullRippleMat.uniforms.uTime.value = oceanTime;
    this.hullRippleMat.uniforms.uActivity.value = rippleActivity;
    this.hullRippleMat.uniforms.uSignedSpeed.value = isActivelyMoving ? signedSpeedRatio : 0;
    this.hullRippleMat.uniforms.uShoreFade.value = hullShoreFade;

    this.updateBowSprayPool(
      sx,
      sz,
      heading,
      this.smoothWaterY,
      isActivelyMoving ? signedSpeed : 0,
      isActivelyMoving ? speedRatio : 0,
      isActivelyMoving ? accel : 0,
      this.smoothRudder,
      storm,
      bowCrestImpact,
      bowShoreFade,
      safeDt,
    );

    // Filets de vent discrets à bonne allure ou lors des rafales de tempête
    const speedWind = isActivelyMoving && signedSpeed > 0.5 ? smoothstep(0.35, 0.85, speedRatio) : 0;
    const stormWind = storm * 0.52;
    const windTarget = clamp(Math.max(speedWind, stormWind), 0, 1);
    const windAlpha = safeExpAlpha(4.5, safeDt);
    this.smoothWindOpacity += (windTarget - this.smoothWindOpacity) * windAlpha;
    this.windStreakMat.uniforms.uTime.value = this.animTime * (1 + storm * 0.45);
    this.windStreakMat.uniforms.uOpacity.value = this.smoothWindOpacity;
    this.windStreakMesh.visible = this.smoothWindOpacity > 0.01;
  }

  /** Libère proprement l'ensemble des géométries, matériaux et textures GPU. */
  public dispose(): void {
    this.scene.remove(this.rootGroup);
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
  }
}
