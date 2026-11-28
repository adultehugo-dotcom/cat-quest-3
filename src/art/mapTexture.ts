import type { BiomeId, DungeonDefinition, MapLabelDef, Vec2 } from '../game/types';
import {
  OVERWORLD_DATA,
  OVERWORLD_HALF_SIZE,
  OVERWORLD_ROADS,
  VILLAGE_SAFE_ZONE,
  getBiomeAt,
  getIslandRadiusAtAngle,
} from '../data/worldData';
import {
  ALL_NEW_ISLANDS,
  NEW_ISLANDS,
  getNewIslandRadiusAtAngle,
} from '../data/worldIslands';
import type { HdSurfaceImages, HdTerrainBundle } from './hdAssets';
import {
  BIOME_PALETTE,
  CREAM_HIGHLIGHT,
  DUNGEON_PALETTE,
  GOLD_MID,
  INK_COLOR,
  OCEAN_PALETTE,
  createCanvas,
  createSeededRandom,
  drawRoundedRect,
} from './palette';

const OVERWORLD_CANVAS_SIZE = 2048;
const BIOME_MASK_SIZE = 512;

export const ARCHIPELAGO_MAP_BOUNDS = {
  minX: -135,
  maxX: 135,
  minZ: -140,
  maxZ: 80,
  spanX: 270,
  spanZ: 220,
} as const;

export interface OverworldPbrCanvases {
  albedo: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
}

export interface DungeonPbrCanvases {
  albedo: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
  emissive: HTMLCanvasElement;
}

export interface WallPbrCanvases {
  albedo: HTMLCanvasElement;
  normal: HTMLCanvasElement;
  roughness: HTMLCanvasElement;
}

let cachedOverworldPbr: OverworldPbrCanvases | null = null;
let cachedOverworldHdSig = '';
let cachedArchipelagoCanvas: HTMLCanvasElement | null = null;
let cachedArchipelagoHdSig = '';
let cachedMiniMapDataUrl: string | null = null;
let cachedMiniMapHdSig = '';
const cachedDungeonMinimapCanvases = new Map<string, HTMLCanvasElement>();

function worldToPx(v: number, halfSize: number, canvasSize: number): number {
  return ((v + halfSize) / (halfSize * 2)) * canvasSize;
}

function getTerrainBundleSig(hd?: HdTerrainBundle): string {
  if (!hd) return 'proc';
  const flags = [
    hd.grass?.albedo ? 'ga' : '',
    hd.grass?.normal ? 'gn' : '',
    hd.grass?.roughness ? 'gr' : '',
    hd.forest?.albedo ? 'fa' : '',
    hd.forest?.normal ? 'fn' : '',
    hd.forest?.roughness ? 'fr' : '',
    hd.snow?.albedo ? 'sa' : '',
    hd.snow?.normal ? 'sn' : '',
    hd.snow?.roughness ? 'sr' : '',
    hd.path?.albedo ? 'pa' : '',
    hd.path?.normal ? 'pn' : '',
    hd.path?.roughness ? 'pr' : '',
  ];
  return flags.join('|') || 'proc';
}

function makeScaledPattern(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  tilePx: number,
): CanvasPattern | null {
  const pattern = ctx.createPattern(img, 'repeat');
  if (!pattern) return null;
  const srcW = Math.max(1, img.naturalWidth || img.width);
  const srcH = Math.max(1, img.naturalHeight || img.height);
  if (typeof DOMMatrix !== 'undefined' && typeof pattern.setTransform === 'function') {
    pattern.setTransform(new DOMMatrix().scale(tilePx / srcW, tilePx / srcH));
  }
  return pattern;
}

function buildIslandPath(
  ctx: CanvasRenderingContext2D,
  radiusOffset: number,
  size: number,
  segments = 180,
): void {
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = Math.max(4, getIslandRadiusAtAngle(a) + radiusOffset);
    const wx = Math.cos(a) * r;
    const wz = Math.sin(a) * r;
    const px = worldToPx(wx, OVERWORLD_HALF_SIZE, size);
    const py = worldToPx(wz, OVERWORLD_HALF_SIZE, size);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceSmoothPolyline(
  ctx: CanvasRenderingContext2D,
  points: Vec2[],
  size: number,
): void {
  if (points.length < 2) return;
  const pts = points.map((p) => ({
    x: worldToPx(p.x, OVERWORLD_HALF_SIZE, size),
    y: worldToPx(p.z, OVERWORLD_HALF_SIZE, size),
  }));
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) * 0.5;
    const midY = (pts[i].y + pts[i + 1].y) * 0.5;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function drawForestBiomeShape(ctx: CanvasRenderingContext2D, size: number): void {
  const joinZ = 10.336;
  const joinX = -10 + 2.0 * Math.sin(joinZ * 0.11);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let wz = -60; wz < joinZ; wz += 2) {
    const borderX = -10 + 2.0 * Math.sin(wz * 0.11);
    ctx.lineTo(
      worldToPx(borderX, OVERWORLD_HALF_SIZE, size),
      worldToPx(wz, OVERWORLD_HALF_SIZE, size),
    );
  }
  ctx.lineTo(
    worldToPx(joinX, OVERWORLD_HALF_SIZE, size),
    worldToPx(joinZ, OVERWORLD_HALF_SIZE, size),
  );
  for (let wx = joinX; wx >= -60; wx -= 2) {
    const borderZ = 12 + 2.0 * Math.sin(wx * 0.12);
    ctx.lineTo(
      worldToPx(wx, OVERWORLD_HALF_SIZE, size),
      worldToPx(borderZ, OVERWORLD_HALF_SIZE, size),
    );
  }
  ctx.lineTo(0, worldToPx(12 + 2.0 * Math.sin(-60 * 0.12), OVERWORLD_HALF_SIZE, size));
  ctx.closePath();
}

function drawFrostBiomeShape(ctx: CanvasRenderingContext2D, size: number): void {
  const joinZ = -11.179;
  const joinX = -10 + 2.0 * Math.sin(joinZ * 0.11);
  ctx.beginPath();
  ctx.moveTo(worldToPx(-10 + 2.0 * Math.sin(-60 * 0.11), OVERWORLD_HALF_SIZE, size), 0);
  ctx.lineTo(size, 0);
  ctx.lineTo(size, worldToPx(-12 + 2.2 * Math.cos(60 * 0.1), OVERWORLD_HALF_SIZE, size));
  for (let wx = 60; wx > joinX; wx -= 2) {
    const borderZ = -12 + 2.2 * Math.cos(wx * 0.1);
    ctx.lineTo(
      worldToPx(wx, OVERWORLD_HALF_SIZE, size),
      worldToPx(borderZ, OVERWORLD_HALF_SIZE, size),
    );
  }
  ctx.lineTo(
    worldToPx(joinX, OVERWORLD_HALF_SIZE, size),
    worldToPx(joinZ, OVERWORLD_HALF_SIZE, size),
  );
  for (let wz = joinZ; wz >= -60; wz -= 2) {
    const borderX = -10 + 2.0 * Math.sin(wz * 0.11);
    ctx.lineTo(
      worldToPx(borderX, OVERWORLD_HALF_SIZE, size),
      worldToPx(wz, OVERWORLD_HALF_SIZE, size),
    );
  }
  ctx.lineTo(worldToPx(-10 + 2.0 * Math.sin(-60 * 0.11), OVERWORLD_HALF_SIZE, size), 0);
  ctx.closePath();
}

function createFeatheredMask(
  size: number,
  blurPx: number,
  drawMask: (ctx: CanvasRenderingContext2D, size: number) => void,
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(size, size);
  ctx.save();
  if (blurPx > 0) {
    ctx.filter = `blur(${blurPx}px)`;
  }
  drawMask(ctx, size);
  ctx.restore();
  return canvas;
}

function compositeMaskedLayer(
  targetCtx: CanvasRenderingContext2D,
  scratchCanvas: HTMLCanvasElement,
  scratchCtx: CanvasRenderingContext2D,
  mask: HTMLCanvasElement,
  fillLayer: (ctx: CanvasRenderingContext2D, size: number) => void,
  alpha = 1.0,
): void {
  const size = scratchCanvas.width;
  scratchCtx.save();
  scratchCtx.globalCompositeOperation = 'source-over';
  scratchCtx.globalAlpha = 1;
  scratchCtx.clearRect(0, 0, size, size);
  fillLayer(scratchCtx, size);
  scratchCtx.globalCompositeOperation = 'destination-in';
  scratchCtx.drawImage(mask, 0, 0, size, size);
  scratchCtx.restore();

  targetCtx.save();
  targetCtx.globalAlpha = alpha;
  targetCtx.drawImage(scratchCanvas, 0, 0);
  targetCtx.restore();
}

function fillTiledOrColor(
  ctx: CanvasRenderingContext2D,
  size: number,
  img: HTMLImageElement | undefined,
  tilePx: number,
  fallbackColor: string,
  tintColor?: string,
  tintAlpha = 0,
): void {
  if (img) {
    const pat = makeScaledPattern(ctx, img, tilePx);
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, size, size);
      if (tintColor && tintAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = tintAlpha;
        ctx.fillStyle = tintColor;
        ctx.fillRect(0, 0, size, size);
        ctx.restore();
      }
      return;
    }
  }
  ctx.fillStyle = fallbackColor;
  ctx.fillRect(0, 0, size, size);
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  letterSpacing: number,
  strokeFirst: boolean,
): number {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const totalWidth =
    widths.reduce((acc, w) => acc + w, 0) +
    Math.max(0, chars.length - 1) * letterSpacing;

  let cursor = -totalWidth * 0.5;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const w = widths[i];
    const x = cursor + w * 0.5;
    if (strokeFirst) ctx.strokeText(ch, x, 0);
    ctx.fillText(ch, x, 0);
    cursor += w + letterSpacing;
  }
  return totalWidth;
}

function paintMapLabel(
  ctx: CanvasRenderingContext2D,
  label: MapLabelDef,
  size: number,
): void {
  const px = worldToPx(label.x, OVERWORLD_HALF_SIZE, size);
  const py = worldToPx(label.z, OVERWORLD_HALF_SIZE, size);
  const fontSize =
    label.style === 'village'
      ? 24
      : label.size === 'large'
        ? 40
        : label.size === 'medium'
          ? 35
          : 32;
  const letterSpacing =
    label.style === 'village'
      ? 2.4
      : label.size === 'large'
        ? 3.2
        : label.size === 'medium'
          ? 3.2
          : 3.4;

  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(label.rotation ?? 0);
  ctx.font = `bold ${fontSize}px Georgia, "Palatino Linotype", "Book Antiqua", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;

  if (label.style === 'sea') {
    ctx.font = `italic bold ${fontSize}px Georgia, "Palatino Linotype", serif`;
    ctx.shadowColor = 'rgba(10, 38, 60, 0.55)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(14, 52, 82, 0.72)';
    ctx.lineWidth = 8;
    ctx.fillStyle = 'rgba(238, 252, 255, 0.92)';
    drawSpacedText(ctx, label.text, letterSpacing + 1.4, true);
  } else if (label.style === 'village') {
    ctx.shadowColor = 'rgba(30, 16, 8, 0.45)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.strokeStyle = CREAM_HIGHLIGHT;
    ctx.lineWidth = 9;
    ctx.fillStyle = '#4f220c';
    const width = drawSpacedText(ctx, label.text, letterSpacing, true);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    const halfLine = Math.max(96, width * 0.45);
    ctx.strokeStyle = 'rgba(196, 134, 28, 0.85)';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(-halfLine, fontSize * 0.7);
    ctx.lineTo(halfLine, fontSize * 0.7);
    ctx.stroke();
  } else {
    ctx.shadowColor = 'rgba(28, 16, 8, 0.42)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.strokeStyle = 'rgba(255, 248, 230, 0.94)';
    ctx.lineWidth = 12;
    ctx.fillStyle = '#331d0e';
    drawSpacedText(ctx, label.text, letterSpacing, true);
  }

  ctx.restore();
}

/**
 * Crée un canvas transparent haute netteté pour les étiquettes maritimes
 * (`MER DES RONRONS`) affichées au-dessus de l'océan GLSL animé.
 */
export function createSeaLabelCanvas(text: string): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(512, 128);
  ctx.save();
  ctx.translate(256, 64);
  ctx.font = 'italic bold 38px Georgia, "Palatino Linotype", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(8, 34, 58, 0.65)';
  ctx.shadowBlur = 12;
  ctx.strokeStyle = 'rgba(12, 48, 78, 0.78)';
  ctx.lineWidth = 8;
  ctx.fillStyle = 'rgba(240, 252, 255, 0.94)';
  drawSpacedText(ctx, text, 4.2, true);
  ctx.restore();
  return canvas;
}

const SWAMP_POOLS = [
  { x: -34, z: -1, rx: 5.2, rz: 3.2, rot: 0.2 },
  { x: -22, z: -18, rx: 4.5, rz: 2.8, rot: -0.35 },
  { x: -39, z: -13, rx: 3.8, rz: 2.5, rot: 0.4 },
  { x: -17, z: -6, rx: 3.2, rz: 2.1, rot: -0.15 },
];

const FROST_RIDGES = [
  { x: 17, z: -17, rx: 4.8, rz: 2.5, rot: -0.2 },
  { x: 30, z: -34, rx: 6.5, rz: 3.5, rot: 0.3 },
  { x: -2, z: -32, rx: 5.2, rz: 2.8, rot: -0.15 },
  { x: 14, z: -44, rx: 7, rz: 3.2, rot: 0.12 },
];

/**
 * Génère (et met en cache) les 3 cartes PBR 2048×2048 de l'île de Félingard :
 * Albedo + Normal Map + Roughness Map composites alignées au pixel près.
 */
export function generateOverworldPbrCanvases(
  hdTerrain?: HdTerrainBundle,
): OverworldPbrCanvases {
  const sig = getTerrainBundleSig(hdTerrain);
  if (cachedOverworldPbr && cachedOverworldHdSig === sig) {
    return cachedOverworldPbr;
  }

  const size = OVERWORLD_CANVAS_SIZE;
  const { canvas: albedo, ctx: aCtx } = createCanvas(size, size);
  const { canvas: normal, ctx: nCtx } = createCanvas(size, size);
  const { canvas: roughness, ctx: rCtx } = createCanvas(size, size);
  const { canvas: scratch, ctx: sCtx } = createCanvas(size, size);
  const rand = createSeededRandom(42077);
  const hasHd = Boolean(
    hdTerrain?.grass?.albedo ||
      hdTerrain?.forest?.albedo ||
      hdTerrain?.snow?.albedo ||
      hdTerrain?.path?.albedo,
  );

  // --- Masques adoucis partagés entre Albedo, Normal et Roughness ---
  const landMask = createFeatheredMask(BIOME_MASK_SIZE, 6, (ctx, mSize) => {
    buildIslandPath(ctx, -1.6, mSize);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  const forestMask = createFeatheredMask(BIOME_MASK_SIZE, 13, (ctx, mSize) => {
    drawForestBiomeShape(ctx, mSize);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  const frostMask = createFeatheredMask(BIOME_MASK_SIZE, 13, (ctx, mSize) => {
    drawFrostBiomeShape(ctx, mSize);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  });

  const roadMask = createFeatheredMask(BIOME_MASK_SIZE, 3.5, (ctx, mSize) => {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = (44 / OVERWORLD_CANVAS_SIZE) * mSize;
    for (const road of OVERWORLD_ROADS) {
      traceSmoothPolyline(ctx, road, mSize);
      ctx.stroke();
    }
  });

  // =========================================================================
  // 1. BASE PLAGE / FONDS MARINS SABLEUX (visible sous le bord d'eau GLSL)
  // =========================================================================
  const seabedGrad = aCtx.createRadialGradient(
    size * 0.5,
    size * 0.5,
    size * 0.34,
    size * 0.5,
    size * 0.5,
    size * 0.56,
  );
  seabedGrad.addColorStop(0, OCEAN_PALETTE.sandLight);
  seabedGrad.addColorStop(0.62, OCEAN_PALETTE.sandMid);
  seabedGrad.addColorStop(0.84, OCEAN_PALETTE.sandDark);
  seabedGrad.addColorStop(1, '#8c7650');
  aCtx.fillStyle = seabedGrad;
  aCtx.fillRect(0, 0, size, size);

  // Micro-grain sable fin sur la plage (utilise path_albedo teinté sable si dispo)
  if (hdTerrain?.path?.albedo) {
    aCtx.save();
    aCtx.globalAlpha = 0.28;
    fillTiledOrColor(aCtx, size, hdTerrain.path.albedo, 192, OCEAN_PALETTE.sandMid);
    aCtx.restore();
  } else {
    for (let i = 0; i < 650; i++) {
      const a = rand() * Math.PI * 2;
      const r = getIslandRadiusAtAngle(a) - 2.2 + rand() * 5.2;
      const px = worldToPx(Math.cos(a) * r, OVERWORLD_HALF_SIZE, size);
      const py = worldToPx(Math.sin(a) * r, OVERWORLD_HALF_SIZE, size);
      aCtx.fillStyle =
        rand() > 0.5 ? 'rgba(255, 245, 214, 0.28)' : 'rgba(164, 124, 68, 0.22)';
      aCtx.beginPath();
      aCtx.ellipse(px, py, 8 + rand() * 14, 4 + rand() * 8, rand() * Math.PI, 0, Math.PI * 2);
      aCtx.fill();
    }
  }

  // Bande de sable humide foncé au ras de la ligne d'eau
  buildIslandPath(aCtx, 0.6, size);
  aCtx.strokeStyle = 'rgba(138, 102, 54, 0.42)';
  aCtx.lineWidth = 34;
  aCtx.stroke();

  // Bases Normal & Roughness pour plage & sable humide
  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, size, size);
  if (hdTerrain?.path?.normal) {
    nCtx.save();
    nCtx.globalAlpha = 0.42;
    fillTiledOrColor(nCtx, size, hdTerrain.path.normal, 192, 'rgb(128, 128, 255)');
    nCtx.restore();
  }

  rCtx.fillStyle = 'rgb(198, 198, 198)'; // sable sec assez mat
  rCtx.fillRect(0, 0, size, size);
  // Sable mouillé près du rivage plus brillant sous le soleil !
  buildIslandPath(rCtx, 0.6, size);
  rCtx.strokeStyle = 'rgb(108, 108, 108)';
  rCtx.lineWidth = 42;
  rCtx.stroke();

  // =========================================================================
  // 2. MASSE TERRESTRE & BLENDING PBR DES 3 BIOMES
  // =========================================================================
  const tilePx = 256; // 8×8 tuiles sans raccord sur 120×120 unités (15 u / tuile)

  // --- ALBEDO : Plaines -> Bois Griffu -> Monts Prr-Glacés ---
  compositeMaskedLayer(aCtx, scratch, sCtx, landMask, (ctx, s) => {
    // Base Plaines de Miaou-Vert
    fillTiledOrColor(
      ctx,
      s,
      hdTerrain?.grass?.albedo,
      tilePx,
      BIOME_PALETTE.plains.groundBase,
      '#7bc44c',
      hasHd ? 0.12 : 0,
    );

    // Bois Griffu (mousse émeraude profonde, transition douce)
    const { canvas: sub, ctx: subCtx } = createCanvas(s, s);
    compositeMaskedLayer(ctx, sub, subCtx, forestMask, (fCtx, fs) => {
      fillTiledOrColor(
        fCtx,
        fs,
        hdTerrain?.forest?.albedo,
        tilePx,
        BIOME_PALETTE.forest.groundBase,
        '#244a32',
        hasHd ? 0.16 : 0,
      );
    });

    // Monts Prr-Glacés (neige cristalline fraîche, transition douce)
    compositeMaskedLayer(ctx, sub, subCtx, frostMask, (snCtx, sns) => {
      fillTiledOrColor(
        snCtx,
        sns,
        hdTerrain?.snow?.albedo,
        tilePx,
        BIOME_PALETTE.frost.groundBase,
        '#dff1fc',
        hasHd ? 0.1 : 0,
      );
    });
  });

  // --- NORMAL MAP : alignée exactement sur les mêmes masques de biomes ---
  compositeMaskedLayer(nCtx, scratch, sCtx, landMask, (ctx, s) => {
    fillTiledOrColor(ctx, s, hdTerrain?.grass?.normal, tilePx, 'rgb(128, 128, 255)');
    const { canvas: sub, ctx: subCtx } = createCanvas(s, s);
    compositeMaskedLayer(ctx, sub, subCtx, forestMask, (fCtx, fs) => {
      fillTiledOrColor(fCtx, fs, hdTerrain?.forest?.normal, tilePx, 'rgb(128, 128, 255)');
    });
    compositeMaskedLayer(ctx, sub, subCtx, frostMask, (snCtx, sns) => {
      fillTiledOrColor(snCtx, sns, hdTerrain?.snow?.normal, tilePx, 'rgb(128, 128, 255)');
    });
  });

  // --- ROUGHNESS MAP : alignée exactement sur les mêmes masques de biomes ---
  compositeMaskedLayer(rCtx, scratch, sCtx, landMask, (ctx, s) => {
    fillTiledOrColor(ctx, s, hdTerrain?.grass?.roughness, tilePx, 'rgb(220, 220, 220)');
    const { canvas: sub, ctx: subCtx } = createCanvas(s, s);
    compositeMaskedLayer(ctx, sub, subCtx, forestMask, (fCtx, fs) => {
      fillTiledOrColor(fCtx, fs, hdTerrain?.forest?.roughness, tilePx, 'rgb(208, 208, 208)');
    });
    compositeMaskedLayer(ctx, sub, subCtx, frostMask, (snCtx, sns) => {
      fillTiledOrColor(snCtx, sns, hdTerrain?.snow?.roughness, tilePx, 'rgb(168, 168, 168)');
    });
  });

  // Clip terrestre pour les détails peints de surface
  aCtx.save();
  buildIslandPath(aCtx, -1.6, size);
  aCtx.clip();

  nCtx.save();
  buildIslandPath(nCtx, -1.6, size);
  nCtx.clip();

  rCtx.save();
  buildIslandPath(rCtx, -1.6, size);
  rCtx.clip();

  // 3. Variations organiques macro (cassent toute répétition à grande échelle !)
  const macroCount = hasHd ? 900 : 2200;
  for (let i = 0; i < macroCount; i++) {
    const wx = (rand() * 2 - 1) * 55;
    const wz = (rand() * 2 - 1) * 55;
    const biome = getBiomeAt(wx, wz);
    const pal = BIOME_PALETTE[biome];
    const px = worldToPx(wx, OVERWORLD_HALF_SIZE, size);
    const py = worldToPx(wz, OVERWORLD_HALF_SIZE, size);
    const rx = (hasHd ? 28 : 14) + rand() * (hasHd ? 58 : 34);
    const ry = (hasHd ? 16 : 7) + rand() * (hasHd ? 32 : 16);
    const rot = (rand() - 0.5) * 1.4;

    aCtx.save();
    aCtx.translate(px, py);
    aCtx.rotate(rot);
    aCtx.globalAlpha = hasHd ? 0.08 + rand() * 0.09 : 0.22 + rand() * 0.2;
    aCtx.fillStyle = rand() > 0.48 ? pal.groundLight : pal.groundShadow;
    aCtx.beginPath();
    aCtx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    aCtx.fill();
    aCtx.restore();
  }

  // Flaques de marais améthyste brillantes dans le Bois Griffu
  for (const pool of SWAMP_POOLS) {
    const px = worldToPx(pool.x, OVERWORLD_HALF_SIZE, size);
    const py = worldToPx(pool.z, OVERWORLD_HALF_SIZE, size);
    const prx = (pool.rx / 120) * size;
    const pry = (pool.rz / 120) * size;

    aCtx.save();
    aCtx.translate(px, py);
    aCtx.rotate(pool.rot);
    aCtx.fillStyle = '#382a4f';
    aCtx.beginPath();
    aCtx.ellipse(0, 0, prx + 8, pry + 8, 0, 0, Math.PI * 2);
    aCtx.fill();
    const pGrad = aCtx.createRadialGradient(-prx * 0.15, -pry * 0.15, 6, 0, 0, prx);
    pGrad.addColorStop(0, '#6c548f');
    pGrad.addColorStop(0.7, '#4c3a69');
    pGrad.addColorStop(1, '#312347');
    aCtx.fillStyle = pGrad;
    aCtx.beginPath();
    aCtx.ellipse(0, 0, prx, pry, 0, 0, Math.PI * 2);
    aCtx.fill();
    aCtx.strokeStyle = 'rgba(195, 162, 240, 0.48)';
    aCtx.lineWidth = 3.5;
    aCtx.beginPath();
    aCtx.ellipse(-prx * 0.12, -pry * 0.12, prx * 0.65, pry * 0.58, 0, 0.2, 2.4);
    aCtx.stroke();
    aCtx.restore();

    // Surface d'eau calme : normale plate + roughness basse (reflet spéculaire !)
    nCtx.save();
    nCtx.translate(px, py);
    nCtx.rotate(pool.rot);
    nCtx.fillStyle = 'rgb(128, 128, 255)';
    nCtx.beginPath();
    nCtx.ellipse(0, 0, prx, pry, 0, 0, Math.PI * 2);
    nCtx.fill();
    nCtx.restore();

    rCtx.save();
    rCtx.translate(px, py);
    rCtx.rotate(pool.rot);
    rCtx.fillStyle = 'rgb(52, 52, 52)';
    rCtx.beginPath();
    rCtx.ellipse(0, 0, prx, pry, 0, 0, Math.PI * 2);
    rCtx.fill();
    rCtx.restore();
  }

  // Crêtes rocheuses gris-ardoise dans les Monts Prr-Glacés
  for (const ridge of FROST_RIDGES) {
    const px = worldToPx(ridge.x, OVERWORLD_HALF_SIZE, size);
    const py = worldToPx(ridge.z, OVERWORLD_HALF_SIZE, size);
    const prx = (ridge.rx / 120) * size;
    const pry = (ridge.rz / 120) * size;
    aCtx.save();
    aCtx.translate(px, py);
    aCtx.rotate(ridge.rot);
    aCtx.fillStyle = 'rgba(104, 118, 134, 0.36)';
    aCtx.beginPath();
    aCtx.ellipse(0, 0, prx, pry, 0, 0, Math.PI * 2);
    aCtx.fill();
    aCtx.fillStyle = 'rgba(244, 250, 255, 0.52)';
    aCtx.beginPath();
    aCtx.ellipse(-prx * 0.15, -pry * 0.2, prx * 0.6, pry * 0.42, 0, 0, Math.PI * 2);
    aCtx.fill();
    aCtx.restore();
  }

  // =========================================================================
  // 4. SENTIERS OCRE PBR (`OVERWORLD_ROADS`)
  // =========================================================================
  // Bordure de transition terre ombreuse
  aCtx.save();
  aCtx.lineCap = 'round';
  aCtx.lineJoin = 'round';
  for (const road of OVERWORLD_ROADS) {
    traceSmoothPolyline(aCtx, road, size);
    aCtx.strokeStyle = 'rgba(116, 84, 46, 0.45)';
    aCtx.lineWidth = 56;
    aCtx.stroke();
  }
  aCtx.restore();

  // Corps du sentier avec vraie texture PBR `path_albedo` & `path_normal`
  compositeMaskedLayer(aCtx, scratch, sCtx, roadMask, (ctx, s) => {
    fillTiledOrColor(
      ctx,
      s,
      hdTerrain?.path?.albedo,
      192,
      OCEAN_PALETTE.roadMid,
      OCEAN_PALETTE.roadLight,
      hasHd ? 0.16 : 0,
    );
  });

  if (hdTerrain?.path?.normal) {
    compositeMaskedLayer(nCtx, scratch, sCtx, roadMask, (ctx, s) => {
      fillTiledOrColor(ctx, s, hdTerrain.path?.normal, 192, 'rgb(128, 128, 255)');
    });
  }

  compositeMaskedLayer(rCtx, scratch, sCtx, roadMask, (ctx, s) => {
    fillTiledOrColor(ctx, s, hdTerrain?.path?.roughness, 192, 'rgb(228, 228, 228)');
  });

  // =========================================================================
  // 5. PLACE DU VILLAGE DE MIAOU-BOURG (Pavés concentriques diorama + Patte)
  // =========================================================================
  const vCx = worldToPx(0, OVERWORLD_HALF_SIZE, size);
  const vCz = worldToPx(23, OVERWORLD_HALF_SIZE, size);
  const vRx =
    (((VILLAGE_SAFE_ZONE.maxX - VILLAGE_SAFE_ZONE.minX) * 0.44) / 120) * size;
  const vRy =
    (((VILLAGE_SAFE_ZONE.maxZ - VILLAGE_SAFE_ZONE.minZ) * 0.42) / 120) * size;

  // Aura de terre battue douce autour de la place
  aCtx.save();
  const yardGrad = aCtx.createRadialGradient(vCx, vCz, vRx * 0.4, vCx, vCz, vRx);
  yardGrad.addColorStop(0, 'rgba(222, 188, 138, 0.72)');
  yardGrad.addColorStop(0.7, 'rgba(206, 170, 118, 0.48)');
  yardGrad.addColorStop(1, 'rgba(206, 170, 118, 0)');
  aCtx.fillStyle = yardGrad;
  aCtx.beginPath();
  aCtx.ellipse(vCx, vCz, vRx * 1.08, vRy * 1.08, 0, 0, Math.PI * 2);
  aCtx.fill();

  // Médaillon central pavé
  const cobbleRx = vRx * 0.56;
  const cobbleRy = vRy * 0.52;
  aCtx.save();
  aCtx.beginPath();
  aCtx.ellipse(vCx, vCz, cobbleRx, cobbleRy, 0, 0, Math.PI * 2);
  aCtx.clip();

  if (hdTerrain?.path?.albedo) {
    fillTiledOrColor(
      aCtx,
      size,
      hdTerrain.path.albedo,
      160,
      OCEAN_PALETTE.cobbleLight,
      '#f2e6cf',
      0.42,
    );
  } else {
    aCtx.fillStyle = OCEAN_PALETTE.cobbleLight;
    aCtx.fillRect(vCx - cobbleRx, vCz - cobbleRy, cobbleRx * 2, cobbleRy * 2);
  }

  // Anneaux de pavés concentriques dessinés dans Albedo & Normal Map
  aCtx.strokeStyle = 'rgba(116, 94, 68, 0.36)';
  aCtx.lineWidth = 3;
  nCtx.save();
  nCtx.beginPath();
  nCtx.ellipse(vCx, vCz, cobbleRx, cobbleRy, 0, 0, Math.PI * 2);
  nCtx.clip();
  nCtx.strokeStyle = 'rgb(128, 104, 240)';
  nCtx.lineWidth = 3.5;

  for (let ring = 1; ring <= 4; ring++) {
    const frac = ring / 4.4;
    const rx = cobbleRx * frac;
    const ry = cobbleRy * frac;
    aCtx.beginPath();
    aCtx.ellipse(vCx, vCz, rx, ry, 0, 0, Math.PI * 2);
    aCtx.stroke();
    nCtx.beginPath();
    nCtx.ellipse(vCx, vCz, rx, ry, 0, 0, Math.PI * 2);
    nCtx.stroke();

    const stoneCount = 8 + ring * 6;
    for (let s = 0; s < stoneCount; s++) {
      const ang = (s / stoneCount) * Math.PI * 2;
      const prevFrac = (ring - 1) / 4.4;
      aCtx.beginPath();
      aCtx.moveTo(vCx + Math.cos(ang) * cobbleRx * prevFrac, vCz + Math.sin(ang) * cobbleRy * prevFrac);
      aCtx.lineTo(vCx + Math.cos(ang) * rx, vCz + Math.sin(ang) * ry);
      aCtx.stroke();
    }
  }
  nCtx.restore();
  aCtx.restore();

  // Bordure sculptée de la place
  aCtx.strokeStyle = OCEAN_PALETTE.cobbleDark;
  aCtx.lineWidth = 6;
  aCtx.beginPath();
  aCtx.ellipse(vCx, vCz, cobbleRx, cobbleRy, 0, 0, Math.PI * 2);
  aCtx.stroke();

  // Emblème patte de chat gravé au centre de Miaou-bourg
  aCtx.fillStyle = 'rgba(154, 120, 74, 0.45)';
  aCtx.beginPath();
  aCtx.ellipse(vCx, vCz + 10, 26, 20, 0, 0, Math.PI * 2);
  aCtx.fill();
  for (const [dx, dy] of [
    [-24, -14],
    [0, -24],
    [24, -14],
  ]) {
    aCtx.beginPath();
    aCtx.arc(vCx + dx, vCz + dy, 10, 0, Math.PI * 2);
    aCtx.fill();
  }
  aCtx.restore();

  // Roughness pierre polie sur la place du village
  rCtx.save();
  rCtx.fillStyle = 'rgb(186, 186, 186)';
  rCtx.beginPath();
  rCtx.ellipse(vCx, vCz, cobbleRx, cobbleRy, 0, 0, Math.PI * 2);
  rCtx.fill();
  rCtx.restore();

  // Pierres dallées gravissant vers l'Antre du Dragon-Griffe (Nord)
  for (let i = 0; i < 12; i++) {
    const t = i / 11;
    const wx = 5 + t * 3;
    const wz = -22 - t * 18;
    const px = worldToPx(wx, OVERWORLD_HALF_SIZE, size);
    const py = worldToPx(wz, OVERWORLD_HALF_SIZE, size);
    aCtx.fillStyle = '#9aa8b6';
    aCtx.strokeStyle = '#53606d';
    aCtx.lineWidth = 3;
    drawRoundedRect(aCtx, px - 22, py - 11, 44, 22, 6);
    aCtx.fill();
    aCtx.stroke();
  }

  // Petites fleurs sauvages discrètes dans les Plaines
  const flowerColors = ['#fff5d6', '#ff8291', '#ffe066', '#94e2ff'];
  for (let i = 0; i < 360; i++) {
    const wx = (rand() * 2 - 1) * 48;
    const wz = (rand() * 2 - 1) * 48;
    if (getBiomeAt(wx, wz) !== 'plains') continue;
    const px = worldToPx(wx, OVERWORLD_HALF_SIZE, size);
    const py = worldToPx(wz, OVERWORLD_HALF_SIZE, size);
    aCtx.fillStyle = flowerColors[Math.floor(rand() * flowerColors.length)];
    aCtx.beginPath();
    aCtx.arc(px, py, 2.5 + rand() * 2.5, 0, Math.PI * 2);
    aCtx.fill();
  }

  aCtx.restore();
  nCtx.restore();
  rCtx.restore();

  // Fin contour organique subtil entre l'herbe et le sable
  buildIslandPath(aCtx, -1.7, size);
  aCtx.strokeStyle = 'rgba(116, 86, 48, 0.28)';
  aCtx.lineWidth = 6;
  aCtx.stroke();

  // 6. Noms des régions terrestres peints directement sur la carte 3D (signature Cat Quest !)
  for (const label of OVERWORLD_DATA.mapLabels) {
    if (label.style === 'sea') continue;
    paintMapLabel(aCtx, label, size);
  }

  cachedOverworldPbr = { albedo, normal, roughness };
  cachedOverworldHdSig = sig;
  return cachedOverworldPbr;
}

/**
 * Rétrocompatibilité : retourne le canvas Albedo 2048×2048 de l'Overworld.
 */
export function generateOverworldMapCanvas(
  hdTerrain?: HdTerrainBundle,
): HTMLCanvasElement {
  return generateOverworldPbrCanvases(hdTerrain).albedo;
}

const OUTER_ISLAND_PALETTE: Record<
  BiomeId,
  { fill: string; highlight: string; shadow: string; accent: string }
> = {
  plains: {
    fill: '#78b94d',
    highlight: '#9dd66c',
    shadow: '#538a33',
    accent: '#e7d28b',
  },
  village: {
    fill: '#c9b489',
    highlight: '#e6d6b0',
    shadow: '#947e56',
    accent: '#f0c451',
  },
  forest: {
    fill: '#3c7a49',
    highlight: '#599d62',
    shadow: '#245232',
    accent: '#7a599c',
  },
  frost: {
    fill: '#d6eaf5',
    highlight: '#f2faff',
    shadow: '#94b3c8',
    accent: '#758fa3',
  },
  tropical: {
    fill: '#66b858',
    highlight: '#95d96c',
    shadow: '#3e873c',
    accent: '#f0cf7d',
  },
  mountain: {
    fill: '#9aa4ad',
    highlight: '#d7e2ea',
    shadow: '#636d78',
    accent: '#eef6fc',
  },
  mystic: {
    fill: '#5c528c',
    highlight: '#8274b8',
    shadow: '#3b3261',
    accent: '#b894f5',
  },
  wild: {
    fill: '#3d8247',
    highlight: '#5ea85b',
    shadow: '#265930',
    accent: '#87c454',
  },
};

function traceArchipelagoMainIsland(
  ctx: CanvasRenderingContext2D,
  radiusOffset: number,
  mapW: number,
  mapH: number,
  segments = 160,
): void {
  const b = ARCHIPELAGO_MAP_BOUNDS;
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = Math.max(4, getIslandRadiusAtAngle(a) + radiusOffset);
    const wx = Math.cos(a) * r;
    const wz = Math.sin(a) * r;
    const px = ((wx - b.minX) / b.spanX) * mapW;
    const py = ((wz - b.minZ) / b.spanZ) * mapH;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function traceArchipelagoNewIsland(
  ctx: CanvasRenderingContext2D,
  islandId: (typeof ALL_NEW_ISLANDS)[number],
  radiusOffset: number,
  mapW: number,
  mapH: number,
  segments = 96,
): void {
  const def = NEW_ISLANDS[islandId];
  const b = ARCHIPELAGO_MAP_BOUNDS;
  ctx.beginPath();
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const r = Math.max(3, getNewIslandRadiusAtAngle(islandId, a) + radiusOffset);
    const wx = def.centerX + Math.cos(a) * r;
    const wz = def.centerZ + Math.sin(a) * r;
    const px = ((wx - b.minX) / b.spanX) * mapW;
    const py = ((wz - b.minZ) / b.spanZ) * mapH;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/**
 * Génère (et met en cache) la carte cartographique complète de l'Archipel de Félingard
 * en 1080×880 (ratio exact 270:220 correspondant à ARCHIPELAGO_MAP_BOUNDS).
 * Partagée par la grande Carte du Monde (alignement 1:1 avec worldToMapPercent) et la Minimap HUD.
 */
export function getArchipelagoMapCanvas(
  hdTerrain?: HdTerrainBundle,
): HTMLCanvasElement {
  const sig = getTerrainBundleSig(hdTerrain);
  if (cachedArchipelagoCanvas && cachedArchipelagoHdSig === sig) {
    return cachedArchipelagoCanvas;
  }

  const mapW = 1080;
  const mapH = 880;
  const b = ARCHIPELAGO_MAP_BOUNDS;
  const toX = (wx: number): number => ((wx - b.minX) / b.spanX) * mapW;
  const toY = (wz: number): number => ((wz - b.minZ) / b.spanZ) * mapH;
  const { canvas, ctx } = createCanvas(mapW, mapH);
  const rand = createSeededRandom(7331);

  // 1. Fond océan cartographique lumineux à profondeur nuancée
  const oceanGrad = ctx.createRadialGradient(
    toX(0),
    toY(-12),
    mapW * 0.14,
    toX(0),
    toY(-12),
    mapW * 0.72,
  );
  oceanGrad.addColorStop(0, '#3196be');
  oceanGrad.addColorStop(0.55, '#216e96');
  oceanGrad.addColorStop(1, '#144466');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, mapW, mapH);

  // 2. Quadrillage nautique discret & lignes de rhumbs depuis la Mer des Ronrons
  ctx.save();
  ctx.strokeStyle = 'rgba(225, 245, 255, 0.09)';
  ctx.lineWidth = 1;
  for (let gx = -120; gx <= 120; gx += 30) {
    const px = toX(gx);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, mapH);
    ctx.stroke();
  }
  for (let gz = -120; gz <= 60; gz += 30) {
    const py = toY(gz);
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(mapW, py);
    ctx.stroke();
  }

  const rhumbX = toX(-58);
  const rhumbY = toY(-28);
  ctx.strokeStyle = 'rgba(245, 232, 198, 0.12)';
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(rhumbX, rhumbY);
    ctx.lineTo(rhumbX + Math.cos(a) * mapW, rhumbY + Math.sin(a) * mapW);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Courants marins & petites vagues cartographiques
  ctx.save();
  ctx.strokeStyle = 'rgba(214, 248, 255, 0.16)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  for (let i = 0; i < 64; i++) {
    const wx = b.minX + 12 + rand() * (b.spanX - 24);
    const wz = b.minZ + 12 + rand() * (b.spanZ - 24);
    const px = toX(wx);
    const py = toY(wz);
    ctx.beginPath();
    ctx.moveTo(px - 11, py);
    ctx.quadraticCurveTo(px - 5, py - 3.5, px, py);
    ctx.quadraticCurveTo(px + 5, py + 3.5, px + 11, py);
    ctx.stroke();
  }

  // Routes maritimes en pointillés reliant Félingard aux 5 îles de l'archipel
  ctx.strokeStyle = 'rgba(255, 238, 188, 0.28)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 8]);
  for (const islandId of ALL_NEW_ISLANDS) {
    const def = NEW_ISLANDS[islandId];
    const angle = Math.atan2(def.centerZ, def.centerX);
    const startR = getIslandRadiusAtAngle(angle) + 5;
    const endDist = Math.hypot(def.centerX, def.centerZ) - def.radius - 4;
    if (endDist <= startR + 4) continue;
    const sx = toX(Math.cos(angle) * startR);
    const sy = toY(Math.sin(angle) * startR);
    const ex = toX(Math.cos(angle) * endDist);
    const ey = toY(Math.sin(angle) * endDist);
    const midX = (sx + ex) * 0.5 - Math.sin(angle) * 18;
    const midY = (sy + ey) * 0.5 + Math.cos(angle) * 18;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(midX, midY, ex, ey);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // 4. Île principale de Félingard (projetée exactement sur [-60..60, -60..60])
  traceArchipelagoMainIsland(ctx, 5.2, mapW, mapH);
  ctx.fillStyle = 'rgba(104, 218, 238, 0.34)';
  ctx.fill();

  traceArchipelagoMainIsland(ctx, 2.2, mapW, mapH);
  ctx.fillStyle = 'rgba(238, 251, 255, 0.78)';
  ctx.fill();

  ctx.save();
  traceArchipelagoMainIsland(ctx, 0.8, mapW, mapH);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const fullAlbedo = generateOverworldPbrCanvases(hdTerrain).albedo;
  const mainLeft = toX(-OVERWORLD_HALF_SIZE);
  const mainTop = toY(-OVERWORLD_HALF_SIZE);
  const mainW = toX(OVERWORLD_HALF_SIZE) - mainLeft;
  const mainH = toY(OVERWORLD_HALF_SIZE) - mainTop;
  ctx.drawImage(fullAlbedo, mainLeft, mainTop, mainW, mainH);
  ctx.restore();

  traceArchipelagoMainIsland(ctx, 0.8, mapW, mapH);
  ctx.strokeStyle = 'rgba(92, 60, 28, 0.65)';
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // 5. Les 5 îles extérieures de l'archipel (NEW_ISLANDS) à leurs vraies coordonnées & formes
  for (const islandId of ALL_NEW_ISLANDS) {
    const def = NEW_ISLANDS[islandId];
    const pal = OUTER_ISLAND_PALETTE[def.biome] ?? OUTER_ISLAND_PALETTE.wild;
    const cx = toX(def.centerX);
    const cy = toY(def.centerZ);
    const rxPx = (def.radius / b.spanX) * mapW;

    // Halo lagon + écume + bande de plage sableuse
    traceArchipelagoNewIsland(ctx, islandId, 4.8, mapW, mapH);
    ctx.fillStyle = 'rgba(102, 218, 236, 0.34)';
    ctx.fill();

    traceArchipelagoNewIsland(ctx, islandId, 2.0, mapW, mapH);
    ctx.fillStyle = 'rgba(238, 251, 255, 0.78)';
    ctx.fill();

    traceArchipelagoNewIsland(ctx, islandId, 0.7, mapW, mapH);
    ctx.fillStyle = def.biome === 'mountain' ? '#c8c3b4' : OCEAN_PALETTE.sandLight;
    ctx.fill();

    // Masse terrestre intérieure avec relief et motifs de biome
    ctx.save();
    traceArchipelagoNewIsland(ctx, islandId, -1.6, mapW, mapH);
    ctx.clip();

    const landGrad = ctx.createRadialGradient(
      cx - rxPx * 0.22,
      cy - rxPx * 0.2,
      rxPx * 0.08,
      cx,
      cy,
      rxPx * 1.15,
    );
    landGrad.addColorStop(0, pal.highlight);
    landGrad.addColorStop(0.65, pal.fill);
    landGrad.addColorStop(1, pal.shadow);
    ctx.fillStyle = landGrad;
    ctx.fillRect(cx - rxPx * 1.5, cy - rxPx * 1.5, rxPx * 3, rxPx * 3);

    // Reliefs / bosquets / crêtes stylisés
    for (let k = 0; k < 14; k++) {
      const ang = (k / 14) * Math.PI * 2 + rand() * 0.4;
      const dist = (0.18 + rand() * 0.56) * rxPx;
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist;
      const rBlob = 5 + rand() * 9;
      ctx.fillStyle = k % 3 === 0 ? pal.accent : pal.shadow;
      ctx.globalAlpha = k % 3 === 0 ? 0.35 : 0.26;
      ctx.beginPath();
      ctx.ellipse(px, py, rBlob * 1.3, rBlob * 0.85, rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Courbes de niveau douces (effet carte d'aventure Cat Quest)
    ctx.strokeStyle = 'rgba(255, 248, 224, 0.25)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rxPx * 0.54, rxPx * 0.46, 0.2, 0, Math.PI * 2);
    ctx.stroke();

    // Petits repères visuels propres au biome
    if (def.biome === 'mountain') {
      // Pics neigeux en chevrons
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
      ctx.lineWidth = 2.4;
      for (const [ox, oy] of [
        [-14, -6],
        [6, -12],
        [14, 6],
      ]) {
        ctx.beginPath();
        ctx.moveTo(cx + ox - 9, cy + oy + 6);
        ctx.lineTo(cx + ox, cy + oy - 7);
        ctx.lineTo(cx + ox + 9, cy + oy + 6);
        ctx.stroke();
      }
    } else if (def.biome === 'mystic') {
      // Cercle runique ancien
      ctx.strokeStyle = 'rgba(218, 186, 255, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, rxPx * 0.3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (def.biome === 'tropical') {
      // Lagon intérieur clair
      ctx.fillStyle = 'rgba(116, 224, 232, 0.42)';
      ctx.beginPath();
      ctx.ellipse(cx - 10, cy + 8, 16, 10, -0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Trait de côte encre sépia
    traceArchipelagoNewIsland(ctx, islandId, 0.7, mapW, mapH);
    ctx.strokeStyle = 'rgba(92, 60, 28, 0.65)';
    ctx.lineWidth = 2.2;
    ctx.stroke();
  }

  // 6. Étiquette maritime "MER DES RONRONS" dans la zone océanique libre (nord-ouest / sud-ouest)
  ctx.save();
  ctx.translate(toX(-64), toY(-10));
  ctx.rotate(-0.18);
  ctx.font = 'italic bold 22px Georgia, "Palatino Linotype", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = 'rgba(12, 46, 74, 0.72)';
  ctx.lineWidth = 5;
  ctx.fillStyle = 'rgba(235, 250, 255, 0.86)';
  drawSpacedText(ctx, 'MER DES RONRONS', 2.8, true);
  ctx.restore();

  // 7. Bordure cartographique intérieure chaude
  ctx.save();
  ctx.strokeStyle = 'rgba(242, 198, 102, 0.38)';
  ctx.lineWidth = 3;
  ctx.strokeRect(8, 8, mapW - 16, mapH - 16);
  ctx.restore();

  cachedArchipelagoCanvas = canvas;
  cachedArchipelagoHdSig = sig;
  return canvas;
}

/**
 * Retourne un DataURL PNG haute définition de tout l'Archipel de Félingard (1080×880)
 * aligné 1:1 avec `worldToMapPercent` pour la grande Carte du Monde.
 */
export function getOverworldMiniMapDataUrl(
  hdTerrain?: HdTerrainBundle,
): string {
  const sig = getTerrainBundleSig(hdTerrain);
  if (cachedMiniMapDataUrl && cachedMiniMapHdSig === sig) {
    return cachedMiniMapDataUrl;
  }

  const canvas = getArchipelagoMapCanvas(hdTerrain);
  cachedMiniMapDataUrl = canvas.toDataURL('image/png');
  cachedMiniMapHdSig = sig;
  return cachedMiniMapDataUrl;
}

/**
 * Génère (et met en cache) un plan architectural 2D propre d'un donjon pour la Minimap HUD.
 */
export function getDungeonMinimapCanvas(
  dungeon: DungeonDefinition,
): HTMLCanvasElement {
  const existing = cachedDungeonMinimapCanvases.get(dungeon.id);
  if (existing) return existing;

  const w = 280;
  const h = 350;
  const { canvas, ctx } = createCanvas(w, h);
  const pal = DUNGEON_PALETTE[dungeon.theme];

  const toPxX = (x: number): number =>
    ((x + dungeon.width * 0.5) / dungeon.width) * w;
  const toPxZ = (z: number): number =>
    ((z + dungeon.depth * 0.5) / dungeon.depth) * h;

  ctx.fillStyle = dungeon.theme === 'dragon_lair' ? '#1e1017' : '#18142b';
  ctx.fillRect(0, 0, w, h);

  // Sol des salles & couloirs
  ctx.fillStyle = pal.floorLight;
  ctx.strokeStyle =
    dungeon.theme === 'dragon_lair'
      ? 'rgba(242, 186, 78, 0.55)'
      : 'rgba(176, 152, 240, 0.52)';
  ctx.lineWidth = 2;
  for (const room of dungeon.rooms) {
    const rx = toPxX(room.minX);
    const ry = toPxZ(room.minZ);
    const rw = toPxX(room.maxX) - rx;
    const rh = toPxZ(room.maxZ) - ry;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeRect(rx, ry, rw, rh);
  }

  // Tapis central
  const carpetW = dungeon.theme === 'dragon_lair' ? 3.0 : 2.2;
  const cx1 = toPxX(-carpetW);
  const cx2 = toPxX(carpetW);
  const czStart = toPxZ(dungeon.exitPortal.z - 1);
  const czEnd = toPxZ(dungeon.bossArenaCenter.z + 3);
  ctx.fillStyle = pal.carpetMain;
  ctx.globalAlpha = 0.72;
  ctx.fillRect(cx1, czEnd, cx2 - cx1, czStart - czEnd);
  ctx.globalAlpha = 1;

  // Sceau circulaire de la salle du boss
  const bx = toPxX(dungeon.bossArenaCenter.x);
  const bz = toPxZ(dungeon.bossArenaCenter.z);
  const br = ((dungeon.theme === 'dragon_lair' ? 11.5 : 8.0) / dungeon.width) * w;
  ctx.strokeStyle =
    dungeon.theme === 'dragon_lair' ? '#ff9d3b' : '#a985ff';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(bx, bz, br, 0, Math.PI * 2);
  ctx.stroke();

  // Murs solides
  ctx.fillStyle = pal.wallTop;
  ctx.strokeStyle = '#120b0f';
  ctx.lineWidth = 1.2;
  for (const wall of dungeon.walls) {
    const wx = toPxX(wall.minX);
    const wy = toPxZ(wall.minZ);
    const ww = toPxX(wall.maxX) - wx;
    const wh = toPxZ(wall.maxZ) - wy;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.strokeRect(wx, wy, ww, wh);
  }

  // Portail de sortie
  const ex = toPxX(dungeon.exitPortal.x);
  const ez = toPxZ(dungeon.exitPortal.z);
  ctx.fillStyle = dungeon.theme === 'dragon_lair' ? '#ffaa44' : '#58e2ff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(ex, ez, 5.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  cachedDungeonMinimapCanvases.set(dungeon.id, canvas);
  return canvas;
}

// ============================================================================
// Textures PBR composites de sol & murs des 2 Donjons (1024×1280)
// ============================================================================

export function generateDungeonPbrCanvases(
  dungeon: DungeonDefinition,
  hdSurface?: HdSurfaceImages,
): DungeonPbrCanvases {
  const texW = 1024;
  const texH = 1280;
  const { canvas: albedo, ctx: aCtx } = createCanvas(texW, texH);
  const { canvas: normal, ctx: nCtx } = createCanvas(texW, texH);
  const { canvas: roughness, ctx: rCtx } = createCanvas(texW, texH);
  const { canvas: emissive, ctx: eCtx } = createCanvas(texW, texH);

  const pal = DUNGEON_PALETTE[dungeon.theme];
  const rand = createSeededRandom(dungeon.theme === 'dragon_lair' ? 9901 : 7703);

  const toPxX = (x: number): number =>
    ((x + dungeon.width * 0.5) / dungeon.width) * texW;
  const toPxZ = (z: number): number =>
    ((z + dungeon.depth * 0.5) / dungeon.depth) * texH;

  // Emissive noire par défaut (seules les runes/braises déclenchent le Bloom !)
  eCtx.fillStyle = '#000000';
  eCtx.fillRect(0, 0, texW, texH);

  const tilePx = 192;
  if (hdSurface?.albedo) {
    // Dallage HD PBR sans raccord !
    fillTiledOrColor(aCtx, texH, hdSurface.albedo, tilePx, pal.floorBase);
    // Légère teinte d'atmosphère pour préserver l'identité de chaque donjon
    aCtx.save();
    aCtx.globalAlpha = dungeon.theme === 'dragon_lair' ? 0.16 : 0.14;
    aCtx.fillStyle = dungeon.theme === 'dragon_lair' ? '#3a151d' : '#2d2248';
    aCtx.fillRect(0, 0, texW, texH);
    aCtx.restore();

    fillTiledOrColor(
      nCtx,
      texH,
      hdSurface.normal,
      tilePx,
      'rgb(128, 128, 255)',
    );
    fillTiledOrColor(
      rCtx,
      texH,
      hdSurface.roughness,
      tilePx,
      'rgb(198, 198, 198)',
    );
  } else {
    // Fallback procédural dallé
    aCtx.fillStyle = pal.grout;
    aCtx.fillRect(0, 0, texW, texH);
    nCtx.fillStyle = 'rgb(128, 128, 255)';
    nCtx.fillRect(0, 0, texW, texH);
    rCtx.fillStyle = 'rgb(200, 200, 200)';
    rCtx.fillRect(0, 0, texW, texH);

    const tileWorld = 2.0;
    const cols = Math.ceil(dungeon.width / tileWorld);
    const rows = Math.ceil(dungeon.depth / tileWorld);
    const cellW = texW / cols;
    const cellH = texH / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const tx = c * cellW;
        const ty = r * cellH;
        const shade = rand();
        aCtx.fillStyle =
          shade > 0.68
            ? pal.floorLight
            : shade < 0.3
              ? pal.floorDark
              : pal.floorBase;
        aCtx.fillRect(tx + 2, ty + 2, cellW - 4, cellH - 4);

        aCtx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        aCtx.fillRect(tx + 3, ty + 3, cellW - 6, 4);
        aCtx.fillRect(tx + 3, ty + 3, 4, cellH - 6);

        // Joints de pierre dans la Normal Map procédurale
        nCtx.strokeStyle = 'rgb(128, 96, 232)';
        nCtx.lineWidth = 3;
        nCtx.strokeRect(tx + 1, ty + 1, cellW - 2, cellH - 2);
      }
    }
  }

  // Bordure décorative sur chaque salle définie
  for (const room of dungeon.rooms) {
    const rx = toPxX(room.minX);
    const ry = toPxZ(room.minZ);
    const rw = toPxX(room.maxX) - rx;
    const rh = toPxZ(room.maxZ) - ry;
    aCtx.strokeStyle =
      dungeon.theme === 'dragon_lair'
        ? 'rgba(242, 193, 68, 0.28)'
        : 'rgba(164, 134, 224, 0.28)';
    aCtx.lineWidth = 8;
    aCtx.strokeRect(rx + 12, ry + 12, rw - 24, rh - 24);
  }

  // Tapis runique central reliant l'entrée à l'arène du boss
  const carpetHalfW = dungeon.theme === 'dragon_lair' ? 3.2 : 2.3;
  const cx1 = toPxX(-carpetHalfW);
  const cx2 = toPxX(carpetHalfW);
  const czStart = toPxZ(dungeon.exitPortal.z - 1.5);
  const czEnd = toPxZ(dungeon.bossArenaCenter.z + 3);
  const carpetW = cx2 - cx1;
  const carpetH = czStart - czEnd;

  aCtx.save();
  aCtx.globalAlpha = 0.88;
  aCtx.fillStyle = pal.carpetMain;
  aCtx.fillRect(cx1, czEnd, carpetW, carpetH);
  aCtx.strokeStyle = pal.carpetTrim;
  aCtx.lineWidth = 6;
  aCtx.strokeRect(cx1 + 8, czEnd + 8, carpetW - 16, carpetH - 16);
  aCtx.restore();

  // Tapis plus mat et légèrement plus plat dans Normal & Roughness
  nCtx.save();
  nCtx.globalAlpha = 0.72;
  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(cx1, czEnd, carpetW, carpetH);
  nCtx.restore();

  rCtx.save();
  rCtx.fillStyle = 'rgb(238, 238, 238)';
  rCtx.fillRect(cx1, czEnd, carpetW, carpetH);
  rCtx.restore();

  // Motifs losanges runiques dorés le long du tapis
  aCtx.strokeStyle = 'rgba(255, 224, 128, 0.55)';
  aCtx.lineWidth = 3;
  const midX = toPxX(0);
  for (let y = czEnd + 46; y < czStart - 30; y += 64) {
    aCtx.beginPath();
    aCtx.moveTo(midX, y - 16);
    aCtx.lineTo(midX + 16, y);
    aCtx.lineTo(midX, y + 16);
    aCtx.lineTo(midX - 16, y);
    aCtx.closePath();
    aCtx.stroke();
  }

  // Grand sceau circulaire d'arène autour du Boss (Albedo + Emissive HDR !)
  const arenaX = toPxX(dungeon.bossArenaCenter.x);
  const arenaY = toPxZ(dungeon.bossArenaCenter.z);
  const arenaR =
    ((dungeon.theme === 'dragon_lair' ? 12.5 : 8.5) / dungeon.width) * texW;

  const drawArenaSeal = (ctx: CanvasRenderingContext2D, isEmissive: boolean): void => {
    ctx.save();
    ctx.translate(arenaX, arenaY);
    const arenaGlow = ctx.createRadialGradient(
      0,
      0,
      arenaR * 0.2,
      0,
      0,
      arenaR * 1.12,
    );
    if (dungeon.theme === 'dragon_lair') {
      arenaGlow.addColorStop(0, isEmissive ? 'rgba(255, 118, 40, 0.22)' : 'rgba(255, 110, 42, 0.2)');
      arenaGlow.addColorStop(0.7, isEmissive ? 'rgba(200, 45, 25, 0.16)' : 'rgba(138, 31, 46, 0.26)');
      arenaGlow.addColorStop(1, 'rgba(138, 31, 46, 0)');
    } else {
      arenaGlow.addColorStop(0, isEmissive ? 'rgba(148, 110, 255, 0.24)' : 'rgba(145, 108, 224, 0.2)');
      arenaGlow.addColorStop(1, 'rgba(92, 62, 160, 0)');
    }
    ctx.fillStyle = arenaGlow;
    ctx.beginPath();
    ctx.arc(0, 0, arenaR * 1.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle =
      dungeon.theme === 'dragon_lair'
        ? isEmissive
          ? '#ff9d3b'
          : 'rgba(242, 193, 68, 0.72)'
        : isEmissive
          ? '#9e7aff'
          : 'rgba(176, 148, 240, 0.62)';
    ctx.lineWidth = isEmissive ? 7 : 6;
    ctx.beginPath();
    ctx.arc(0, 0, arenaR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(0, 0, arenaR * 0.84, 0, Math.PI * 2);
    ctx.stroke();

    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * arenaR * 0.84, Math.sin(a) * arenaR * 0.84);
      ctx.lineTo(Math.cos(a) * arenaR, Math.sin(a) * arenaR);
      ctx.stroke();
    }
    ctx.restore();
  };

  drawArenaSeal(aCtx, false);
  drawArenaSeal(eCtx, true);

  // Gravures lumineuses sur les dalles des pièges périodiques
  for (const trap of dungeon.traps) {
    const tx = toPxX(trap.x);
    const ty = toPxZ(trap.z);
    const tr = (trap.radius / dungeon.width) * texW;
    aCtx.strokeStyle = 'rgba(220, 90, 120, 0.42)';
    aCtx.lineWidth = 4;
    aCtx.beginPath();
    aCtx.arc(tx, ty, tr * 0.72, 0, Math.PI * 2);
    aCtx.stroke();

    eCtx.strokeStyle = 'rgba(255, 85, 130, 0.48)';
    eCtx.lineWidth = 3.5;
    eCtx.beginPath();
    eCtx.arc(tx, ty, tr * 0.72, 0, Math.PI * 2);
    eCtx.stroke();
  }

  // Fissures de lave incandescentes dans l'Antre du Dragon (Bloom sélectif !)
  if (dungeon.theme === 'dragon_lair') {
    const cracks: Array<[number, number, number, number]> = [
      [-19, -24, -14, -18],
      [19, -24, 14, -18],
      [-19, 3, -13, -1],
      [19, 3, 13, -1],
    ];
    for (const [x1, z1, x2, z2] of cracks) {
      const p1x = toPxX(x1);
      const p1y = toPxZ(z1);
      const pmx = toPxX((x1 + x2) * 0.5 + 1);
      const pmy = toPxZ((z1 + z2) * 0.5);
      const p2x = toPxX(x2);
      const p2y = toPxZ(z2);

      aCtx.strokeStyle = 'rgba(255, 118, 40, 0.75)';
      aCtx.lineWidth = 7;
      aCtx.beginPath();
      aCtx.moveTo(p1x, p1y);
      aCtx.lineTo(pmx, pmy);
      aCtx.lineTo(p2x, p2y);
      aCtx.stroke();

      eCtx.strokeStyle = '#ff6b1a';
      eCtx.lineWidth = 10;
      eCtx.beginPath();
      eCtx.moveTo(p1x, p1y);
      eCtx.lineTo(pmx, pmy);
      eCtx.lineTo(p2x, p2y);
      eCtx.stroke();

      eCtx.strokeStyle = '#ffe580';
      eCtx.lineWidth = 3.5;
      eCtx.beginPath();
      eCtx.moveTo(p1x, p1y);
      eCtx.lineTo(pmx, pmy);
      eCtx.lineTo(p2x, p2y);
      eCtx.stroke();
    }
  }

  // Liseré sombre AO sous les murs pour ancrer les volumes 3D
  aCtx.fillStyle = INK_COLOR;
  aCtx.globalAlpha = 0.48;
  for (const wall of dungeon.walls) {
    const wx = toPxX(wall.minX);
    const wy = toPxZ(wall.minZ);
    const ww = toPxX(wall.maxX) - wx;
    const wh = toPxZ(wall.maxZ) - wy;
    aCtx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
  }
  aCtx.globalAlpha = 1;

  // Ornement runique lumineux autour du portail de sortie
  const ex = toPxX(dungeon.exitPortal.x);
  const ez = toPxZ(dungeon.exitPortal.z);
  aCtx.strokeStyle = GOLD_MID;
  aCtx.globalAlpha = 0.6;
  aCtx.lineWidth = 4;
  aCtx.beginPath();
  aCtx.arc(ex, ez, 48, 0, Math.PI * 2);
  aCtx.stroke();
  aCtx.globalAlpha = 1;

  eCtx.strokeStyle = dungeon.theme === 'dragon_lair' ? '#ffaa44' : '#58e2ff';
  eCtx.lineWidth = 5;
  eCtx.beginPath();
  eCtx.arc(ex, ez, 48, 0, Math.PI * 2);
  eCtx.stroke();

  return { albedo, normal, roughness, emissive };
}

/**
 * Rétrocompatibilité : retourne uniquement le canvas Albedo du sol de donjon.
 */
export function generateDungeonFloorCanvas(
  dungeon: DungeonDefinition,
  hdSurface?: HdSurfaceImages,
): HTMLCanvasElement {
  return generateDungeonPbrCanvases(dungeon, hdSurface).albedo;
}

/**
 * Génère les textures PBR (Albedo + Normal + Roughness) des murs 3D de donjon.
 */
export function generateDungeonWallPbrCanvases(
  theme: 'ghost_cave' | 'dragon_lair',
  hdSurface?: HdSurfaceImages,
): WallPbrCanvases {
  const size = 512;
  const { canvas: albedo, ctx: aCtx } = createCanvas(size, size);
  const { canvas: normal, ctx: nCtx } = createCanvas(size, size);
  const { canvas: roughness, ctx: rCtx } = createCanvas(size, size);
  const pal = DUNGEON_PALETTE[theme];

  if (hdSurface?.albedo) {
    fillTiledOrColor(aCtx, size, hdSurface.albedo, 512, pal.wallSide);
    // Assombrit légèrement les murs par rapport au sol pour un contraste diorama net
    aCtx.save();
    aCtx.fillStyle = theme === 'dragon_lair' ? 'rgba(26, 12, 18, 0.36)' : 'rgba(22, 16, 40, 0.34)';
    aCtx.fillRect(0, 0, size, size);
    // Corniche supérieure sculptée
    const corniceGrad = aCtx.createLinearGradient(0, 0, 0, 42);
    corniceGrad.addColorStop(0, pal.wallTop);
    corniceGrad.addColorStop(0.7, 'rgba(255, 255, 255, 0.08)');
    corniceGrad.addColorStop(1, 'rgba(0, 0, 0, 0.42)');
    aCtx.fillStyle = corniceGrad;
    aCtx.fillRect(0, 0, size, 42);
    // Ombre AO de base au contact du sol
    const baseAo = aCtx.createLinearGradient(0, size - 70, 0, size);
    baseAo.addColorStop(0, 'rgba(0, 0, 0, 0)');
    baseAo.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    aCtx.fillStyle = baseAo;
    aCtx.fillRect(0, size - 70, size, 70);
    aCtx.restore();

    fillTiledOrColor(nCtx, size, hdSurface.normal, 512, 'rgb(128, 128, 255)');
    fillTiledOrColor(rCtx, size, hdSurface.roughness, 512, 'rgb(214, 214, 214)');
    return { albedo, normal, roughness };
  }

  // Fallback procédural briques
  const rand = createSeededRandom(theme === 'dragon_lair' ? 881 : 551);
  aCtx.fillStyle = pal.grout;
  aCtx.fillRect(0, 0, size, size);
  nCtx.fillStyle = 'rgb(128, 128, 255)';
  nCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(212, 212, 212)';
  rCtx.fillRect(0, 0, size, size);

  const rows = 4;
  const cols = 4;
  const brickH = size / rows;
  const brickW = size / cols;

  for (let r = 0; r < rows; r++) {
    const offset = (r % 2) * (brickW * 0.5);
    const rowColors: string[] = [];
    for (let i = 0; i < cols; i++) {
      rowColors.push(rand() > 0.45 ? pal.wallSide : pal.wallAccent);
    }
    for (let c = -1; c <= cols; c++) {
      const bx = c * brickW + offset;
      const by = r * brickH;
      const colIdx = ((c % cols) + cols) % cols;
      aCtx.fillStyle = rowColors[colIdx];
      aCtx.fillRect(bx + 5, by + 5, brickW - 10, brickH - 10);
      aCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      aCtx.fillRect(bx + 7, by + 7, brickW - 14, 10);
      aCtx.strokeStyle = INK_COLOR;
      aCtx.lineWidth = 4;
      aCtx.strokeRect(bx + 5, by + 5, brickW - 10, brickH - 10);

      nCtx.strokeStyle = 'rgb(128, 92, 232)';
      nCtx.lineWidth = 6;
      nCtx.strokeRect(bx + 4, by + 4, brickW - 8, brickH - 8);
    }
  }
  aCtx.fillStyle = pal.wallTop;
  aCtx.fillRect(0, 0, size, 32);

  return { albedo, normal, roughness };
}
