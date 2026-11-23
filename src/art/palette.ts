import type { BiomeId, Rarity } from '../game/types';

// ============================================================================
// Palette "Livre illustré de Félingard" & utilitaires Canvas2D
// ============================================================================

export const INK_COLOR = '#2b1e16';
export const INK_SOFT = '#4a3325';
export const CREAM_HIGHLIGHT = '#fff7e3';

export const GOLD_LIGHT = '#ffe570';
export const GOLD_MID = '#f2b838';
export const GOLD_DARK = '#b57816';

export const HERO_FUR = {
  base: '#e88c38',
  light: '#f8ba6b',
  shadow: '#bd621d',
  stripe: '#994712',
  cream: '#fce9c7',
  earInner: '#f4a1a8',
  nose: '#d95768',
  eyeIris: '#f5b83d',
  cheek: 'rgba(240, 118, 128, 0.45)',
} as const;

export interface BiomeColorSet {
  groundBase: string;
  groundLight: string;
  groundShadow: string;
  accent: string;
  foliageLight: string;
  foliageMid: string;
  foliageDark: string;
  trunkLight: string;
  trunkDark: string;
}

export const BIOME_PALETTE: Record<BiomeId, BiomeColorSet> = {
  plains: {
    groundBase: '#78b848',
    groundLight: '#8cc955',
    groundShadow: '#5e9936',
    accent: '#a3d962',
    foliageLight: '#8fd14f',
    foliageMid: '#5ea338',
    foliageDark: '#3d7025',
    trunkLight: '#9c6638',
    trunkDark: '#693f1e',
  },
  village: {
    groundBase: '#85bf52',
    groundLight: '#9bd164',
    groundShadow: '#6ba13e',
    accent: '#e2c58f',
    foliageLight: '#97d658',
    foliageMid: '#64a83b',
    foliageDark: '#417526',
    trunkLight: '#a66d3e',
    trunkDark: '#6e4321',
  },
  forest: {
    groundBase: '#3d6e47',
    groundLight: '#4e8256',
    groundShadow: '#2b5234',
    accent: '#5f4b7a',
    foliageLight: '#4f8559',
    foliageMid: '#2f5c3e',
    foliageDark: '#1c3b29',
    trunkLight: '#59423a',
    trunkDark: '#362622',
  },
  frost: {
    groundBase: '#dceef7',
    groundLight: '#f0f8fc',
    groundShadow: '#b9d7e8',
    accent: '#6f7d8c',
    foliageLight: '#4e8a82',
    foliageMid: '#2f6363',
    foliageDark: '#1d4045',
    trunkLight: '#6e5240',
    trunkDark: '#453124',
  },
  tropical: {
    groundBase: '#ffd166',
    groundLight: '#ffe580',
    groundShadow: '#b3882e',
    accent: '#ff9e2e',
    foliageLight: '#a3d962',
    foliageMid: '#6aaa2f',
    foliageDark: '#3d7025',
    trunkLight: '#cda73e',
    trunkDark: '#8b5a20',
  },
  mountain: {
    groundBase: '#a0a0a0',
    groundLight: '#d0d0d0',
    groundShadow: '#7a7a7a',
    accent: '#6b5b4a',
    foliageLight: '#8b6e45',
    foliageMid: '#5a4f30',
    foliageDark: '#3d2b15',
    trunkLight: '#6b4f28',
    trunkDark: '#4a351a',
  },
  mystic: {
    groundBase: '#e8d5f0',
    groundLight: '#f4e0f5',
    groundShadow: '#a07aa5',
    accent: '#9b59b6',
    foliageLight: '#b388ff',
    foliageMid: '#7e57c2',
    foliageDark: '#6a1b9a',
    trunkLight: '#ce93d8',
    trunkDark: '#7b1fa2',
  },
  wild: {
    groundBase: '#6a5a3e',
    groundLight: '#8b6f4a',
    groundShadow: '#4a3d27',
    accent: '#a7c966',
    foliageLight: '#a3d962',
    foliageMid: '#5ea338',
    foliageDark: '#3d7025',
    trunkLight: '#8b6e45',
    trunkDark: '#5a4229',
  },
};

export const OCEAN_PALETTE = {
  deep: '#1b5e85',
  mid: '#287ba8',
  shallow: '#3ea4cc',
  foam: '#eefbff',
  sandLight: '#f6dfa9',
  sandMid: '#f2d399',
  sandDark: '#d4ae6a',
  roadLight: '#e8c892',
  roadMid: '#d9b37c',
  roadBorder: '#a8814d',
  cobbleLight: '#dfd2b8',
  cobbleMid: '#c4b395',
  cobbleDark: '#968366',
} as const;

export const DUNGEON_PALETTE = {
  ghost_cave: {
    floorBase: '#483d5c',
    floorLight: '#5a4d73',
    floorDark: '#362d47',
    grout: '#231c30',
    carpetMain: '#6e3468',
    carpetTrim: '#d9b04c',
    wallTop: '#241d33',
    wallSide: '#3a3052',
    wallAccent: '#584a78',
    torchCore: '#fff3b8',
    torchGlow: '#ff9638',
    portalOuter: '#66d9ff',
    portalInner: '#d8fbff',
    bgHex: 0x161124,
  },
  dragon_lair: {
    floorBase: '#3d333c',
    floorLight: '#524450',
    floorDark: '#2b222a',
    grout: '#1c151c',
    carpetMain: '#8a1f2e',
    carpetTrim: '#f2c144',
    wallTop: '#1f171e',
    wallSide: '#382a34',
    wallAccent: '#6e3038',
    torchCore: '#fff1b5',
    torchGlow: '#ff6629',
    portalOuter: '#ffad42',
    portalInner: '#fff4c2',
    bgHex: 0x1a0f14,
  },
} as const;

export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#d6c9b2',
  rare: '#4ec6ff',
  epic: '#ff9f38',
};

export const VFX_COLORS = {
  telegraphRed: '#ff3b30',
  telegraphBright: '#ff7369',
  flame: '#ff6b2b',
  flameCore: '#ffe066',
  lightning: '#ffe44d',
  lightningArc: '#7be3ff',
  frost: '#5edbff',
  frostLight: '#e3f9ff',
  heal: '#5ce67a',
  healLight: '#dcffe4',
  mpBlue: '#5cb8ff',
  bossPhase2: '#ff2442',
} as const;

// --- Utilitaires de dessin Canvas2D ---

export function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Impossible de créer un contexte Canvas 2D');
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  return { canvas, ctx };
}

/**
 * PRNG déterministe (Mulberry32) pour des textures procédurales stables d'une session à l'autre.
 */
export function createSeededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

export function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  points: number,
  outerR: number,
  innerR: number,
  rotation = -Math.PI / 2,
): void {
  ctx.beginPath();
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = rotation + i * step;
    const px = cx + Math.cos(a) * r;
    const py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export function drawInkEllipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string | CanvasGradient,
  lineWidth = 4,
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, rotation, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (lineWidth > 0) {
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}
