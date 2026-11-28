import type {
  EquipSlot,
  EquipmentDefinition,
  EquipmentVisualStyle,
} from '../game/types';
import { getEquipmentDefinition } from '../data/equipmentData';
import {
  HERO_ANIM_CLIPS,
  type HdEquipmentKey,
  type HeroAnimState,
  type SpriteGridSpec,
  computeGridFrameUvInto,
  createSpriteUvRect,
  resolveActiveSpriteGrid,
} from './hdAssets';
import {
  type EquipmentCalibrationEntry,
  computeHeroEquipmentMaskState,
  computeNormalizedEquipmentFit,
  createNormalizedEquipmentCanvas,
  getBoneRestWorldPosition,
  getEquipmentCalibration,
} from './equipmentRig';
import { INK_COLOR, createCanvas } from './palette';

// ============================================================================
// Héros Chat-valier Modulaire 2.5D — Assemblage par couches d'assets externes
// - Zéro halo global, zéro teinte globale (`source-atop`) sur le corps/fourrure.
// - 5 emplacements strictement indépendants : `weapon`, `shield`, `helmet`,
//   `armor`, `cape` (aucune arme secondaire, ni bottes/gants/babiole).
// - En 3D, la cape est simulée séparément par `CapeClothMesh` : modifier `cape`
//   ne régénère ni ne modifie jamais la texture du corps/armure/casque.
// - Supporte aussi bien les poses unitaires 512×512 actuelles que des planches
//   multi-frames 30 FPS (corps et/ou pièces d'équipement synchronisées).
// ============================================================================

export type HeroAnimFrame =
  | 'idle'
  | 'walk1'
  | 'walk2'
  | 'attack'
  | 'roll'
  | 'hurt'
  | 'death';

/** Les 4 emplacements dessinés sur le quad du corps 3D (hors `cape`, gérée par `CapeClothMesh`). */
export const HERO_BODY_EQUIP_SLOTS: readonly Exclude<EquipSlot, 'cape'>[] = [
  'weapon',
  'shield',
  'helmet',
  'armor',
];

export interface HeroModularImages {
  basePoses: Partial<Record<HeroAnimFrame, HTMLImageElement>>;
  stateSheets?: Partial<Record<HeroAnimState, HTMLImageElement>>;
  portraitBase?: HTMLImageElement;
  equipment: Partial<Record<HdEquipmentKey, HTMLImageElement>>;
  equipmentSheets?: Partial<
    Record<HdEquipmentKey, Partial<Record<HeroAnimState, HTMLImageElement>>>
  >;
}

interface PoseAnchors {
  headX: number;
  headY: number;
  headScale: number;
  torsoX: number;
  torsoY: number;
  torsoW: number;
  torsoH: number;
  leftFootX: number;
  leftFootY: number;
  rightFootX: number;
  rightFootY: number;
  leftHandX: number;
  leftHandY: number;
  rightHandX: number;
  rightHandY: number;
  weaponX: number;
  weaponY: number;
  weaponRot: number;
  weaponScale: number;
  offhandX: number;
  offhandY: number;
  offhandScale: number;
  capeX: number;
  capeY: number;
  capeW: number;
  capeH: number;
}

// Coordonnées d'ancrage calibrées sur la grille 512×512 avec ligne de sol constante (y ≈ 446)
const POSE_ANCHORS: Record<HeroAnimFrame, PoseAnchors> = {
  idle: {
    headX: 252,
    headY: 162,
    headScale: 1.0,
    torsoX: 256,
    torsoY: 360,
    torsoW: 132,
    torsoH: 118,
    leftFootX: 230,
    leftFootY: 446,
    rightFootX: 282,
    rightFootY: 446,
    leftHandX: 194,
    leftHandY: 360,
    rightHandX: 316,
    rightHandY: 358,
    weaponX: 354,
    weaponY: 318,
    weaponRot: 0.28,
    weaponScale: 1.0,
    offhandX: 184,
    offhandY: 362,
    offhandScale: 1.0,
    capeX: 244,
    capeY: 326,
    capeW: 196,
    capeH: 158,
  },
  walk1: {
    headX: 254,
    headY: 158,
    headScale: 1.0,
    torsoX: 256,
    torsoY: 356,
    torsoW: 132,
    torsoH: 118,
    leftFootX: 214,
    leftFootY: 444,
    rightFootX: 294,
    rightFootY: 448,
    leftHandX: 192,
    leftHandY: 354,
    rightHandX: 320,
    rightHandY: 354,
    weaponX: 360,
    weaponY: 314,
    weaponRot: 0.36,
    weaponScale: 1.0,
    offhandX: 182,
    offhandY: 356,
    offhandScale: 1.0,
    capeX: 240,
    capeY: 322,
    capeW: 196,
    capeH: 158,
  },
  walk2: {
    headX: 254,
    headY: 160,
    headScale: 1.0,
    torsoX: 256,
    torsoY: 358,
    torsoW: 132,
    torsoH: 118,
    leftFootX: 242,
    leftFootY: 448,
    rightFootX: 274,
    rightFootY: 442,
    leftHandX: 198,
    leftHandY: 358,
    rightHandX: 312,
    rightHandY: 356,
    weaponX: 352,
    weaponY: 318,
    weaponRot: 0.22,
    weaponScale: 1.0,
    offhandX: 188,
    offhandY: 360,
    offhandScale: 1.0,
    capeX: 242,
    capeY: 324,
    capeW: 196,
    capeH: 158,
  },
  attack: {
    headX: 266,
    headY: 162,
    headScale: 1.0,
    torsoX: 264,
    torsoY: 358,
    torsoW: 132,
    torsoH: 118,
    leftFootX: 214,
    leftFootY: 446,
    rightFootX: 306,
    rightFootY: 446,
    leftHandX: 198,
    leftHandY: 354,
    rightHandX: 336,
    rightHandY: 342,
    weaponX: 392,
    weaponY: 288,
    weaponRot: 0.96,
    weaponScale: 1.12,
    offhandX: 186,
    offhandY: 356,
    offhandScale: 1.0,
    capeX: 242,
    capeY: 324,
    capeW: 196,
    capeH: 158,
  },
  roll: {
    headX: 252,
    headY: 228,
    headScale: 0.94,
    torsoX: 256,
    torsoY: 382,
    torsoW: 126,
    torsoH: 102,
    leftFootX: 222,
    leftFootY: 446,
    rightFootX: 302,
    rightFootY: 442,
    leftHandX: 204,
    leftHandY: 378,
    rightHandX: 312,
    rightHandY: 376,
    weaponX: 352,
    weaponY: 346,
    weaponRot: 0.55,
    weaponScale: 0.92,
    offhandX: 192,
    offhandY: 382,
    offhandScale: 0.92,
    capeX: 238,
    capeY: 350,
    capeW: 180,
    capeH: 136,
  },
  hurt: {
    headX: 246,
    headY: 166,
    headScale: 1.0,
    torsoX: 252,
    torsoY: 362,
    torsoW: 132,
    torsoH: 118,
    leftFootX: 228,
    leftFootY: 446,
    rightFootX: 282,
    rightFootY: 446,
    leftHandX: 190,
    leftHandY: 358,
    rightHandX: 312,
    rightHandY: 360,
    weaponX: 346,
    weaponY: 324,
    weaponRot: 0.16,
    weaponScale: 1.0,
    offhandX: 182,
    offhandY: 360,
    offhandScale: 1.0,
    capeX: 240,
    capeY: 328,
    capeW: 196,
    capeH: 158,
  },
  death: {
    headX: 252,
    headY: 228,
    headScale: 0.94,
    torsoX: 256,
    torsoY: 382,
    torsoW: 126,
    torsoH: 102,
    leftFootX: 222,
    leftFootY: 446,
    rightFootX: 302,
    rightFootY: 446,
    leftHandX: 204,
    leftHandY: 378,
    rightHandX: 312,
    rightHandY: 376,
    weaponX: 352,
    weaponY: 346,
    weaponRot: 0.55,
    weaponScale: 0.92,
    offhandX: 192,
    offhandY: 382,
    offhandScale: 0.92,
    capeX: 238,
    capeY: 350,
    capeW: 180,
    capeH: 136,
  },
};

const scratchCellUv = createSpriteUvRect();

export function mapHeroFrameToAnimState(frame: HeroAnimFrame): HeroAnimState {
  switch (frame) {
    case 'walk1':
    case 'walk2':
      return 'walk';
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

export function getHeroEquipmentKey(equipped: Record<EquipSlot, string>): string {
  return [
    equipped.weapon || '',
    equipped.shield || '',
    equipped.helmet || '',
    equipped.armor || '',
    equipped.cape || '',
  ].join('|');
}

/** Clé de texture du corps/équipement 3D hors cape (la cape est un maillage tissu indépendant). */
export function getHeroBodyTextureKey(
  equipped: Record<EquipSlot, string>,
  frame: HeroAnimFrame,
  subFrameIndex = 0,
): string {
  const bodyKey = [
    equipped.weapon || '',
    equipped.shield || '',
    equipped.helmet || '',
    equipped.armor || '',
  ].join('|');
  if (subFrameIndex > 0) {
    return `hero_body|${bodyKey}|${frame}|f${subFrameIndex}`;
  }
  return `hero_body|${bodyKey}|${frame}`;
}

export function getHeroTextureKey(
  equipped: Record<EquipSlot, string>,
  frame: HeroAnimFrame,
  subFrameIndex = 0,
): string {
  if (subFrameIndex > 0) {
    return `hero_mod|${getHeroEquipmentKey(equipped)}|${frame}|f${subFrameIndex}`;
  }
  return `hero_mod|${getHeroEquipmentKey(equipped)}|${frame}`;
}

function getEquipImage(
  images: HeroModularImages | undefined,
  itemId: string,
): HTMLImageElement | undefined {
  if (!images || !itemId) return undefined;
  return images.equipment[itemId as HdEquipmentKey];
}

function getEquipSheetImage(
  images: HeroModularImages | undefined,
  itemId: string,
  state: HeroAnimState,
): HTMLImageElement | undefined {
  if (!images || !itemId || !images.equipmentSheets) return undefined;
  return images.equipmentSheets[itemId as HdEquipmentKey]?.[state];
}

function drawSheetCell(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  grid: SpriteGridSpec,
  subFrameIndex: number,
  destSize: number,
  itemId?: string,
): void {
  const imgW = img.naturalWidth || img.width || destSize;
  const imgH = img.naturalHeight || img.height || destSize;
  computeGridFrameUvInto(grid, subFrameIndex, scratchCellUv, false);
  const cellW = imgW / Math.max(1, grid.cols);
  const cellH = imgH / Math.max(1, grid.rows);
  const sx = scratchCellUv.col * cellW;
  const sy = scratchCellUv.row * cellH;

  if (itemId) {
    const def = getEquipmentDefinition(itemId);
    const isLuminous = Boolean(def?.visualStyle.luminous && def.visualStyle.glowColor);
    if (isLuminous && def?.visualStyle.glowColor) {
      ctx.save();
      ctx.shadowColor = def.visualStyle.glowColor;
      ctx.shadowBlur = 16;
      ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, destSize, destSize);
      ctx.restore();
      return;
    }
  }
  ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, destSize, destSize);
}

function tryDrawEquipmentSynchronizedSheet(
  ctx: CanvasRenderingContext2D,
  images: HeroModularImages | undefined,
  itemId: string,
  state: HeroAnimState,
  subFrameIndex: number,
  destSize: number,
): boolean {
  const dedicatedSheet = getEquipSheetImage(images, itemId, state);
  const candidate = dedicatedSheet ?? getEquipImage(images, itemId);
  if (!candidate) return false;

  const w = candidate.naturalWidth || candidate.width;
  const h = candidate.naturalHeight || candidate.height;
  // Une pièce 256×256 ou 512×512 unitaire est ancrée via POSE_ANCHORS ;
  // une planche multi-cellules (>1 cellule) est découpée frame par frame en 1:1.
  if (!dedicatedSheet && w === h && w <= 512) {
    return false;
  }

  const clip = HERO_ANIM_CLIPS[state];
  const grid = resolveActiveSpriteGrid(clip, w, h);
  if (!dedicatedSheet && grid.cols === 1 && grid.rows === 1) {
    return false;
  }

  drawSheetCell(ctx, candidate, grid, subFrameIndex, destSize, itemId);
  return true;
}

function drawPieceWithOptionalLocalGlow(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  itemId: string,
  options: { rotation?: number; flipX?: boolean } = {},
): void {
  const def = getEquipmentDefinition(itemId);
  const isLuminous = Boolean(def?.visualStyle.luminous && def.visualStyle.glowColor);

  ctx.save();
  ctx.translate(dx, dy);
  if (options.rotation) {
    ctx.rotate(options.rotation);
  }
  if (options.flipX) {
    ctx.scale(-1, 1);
  }
  if (isLuminous && def?.visualStyle.glowColor) {
    // Effet lumineux STRICTEMENT localisé sur les pixels de cette pièce uniquement
    ctx.shadowColor = def.visualStyle.glowColor;
    ctx.shadowBlur = 16;
  }
  ctx.drawImage(img, -dw * 0.5, -dh * 0.5, dw, dh);
  ctx.restore();
}

// ============================================================================
// Ajustement automatique idéal des armures (sans génération d'image)
// - Analyse les pixels opaques réels du PNG d'armure (en ignorant les poussières isolées)
// - Agrandit automatiquement les armures trop petites/étroites et rapetisse les trop grandes
// - Aligne l'axe central du torse de l'armure exactement sur le tronc du chat-valier
// ============================================================================

export const ARMOR_FIT_CONTENT_FILL = 0.88;

export const HERO_TORSO_ENVELOPE = {
  /** Centre horizontal exact du tronc félin dans la grille 512×512 (x ≈ 238 -> -0.035) */
  centerX: -0.035,
  /** Centre vertical exact du torse (entre le menton y≈330 et les hanches y≈406 -> normY≈0.281) */
  centerY: 0.281,
  /** Largeur cible idéale du tronc habillé (en fraction de la largeur héros) */
  coreWidth: 0.172,
  /** Hauteur cible idéale du torse habillé (du col jusqu'aux hanches) */
  coreHeight: 0.172,
} as const;

export interface ArmorContentMetrics {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly contentW: number;
  readonly contentH: number;
  readonly coreW: number;
  readonly coreCx: number;
  readonly halfSpanX: number;
}

export interface ArmorFitTransform {
  readonly normX: number;
  readonly normY: number;
  readonly quadW: number;
  readonly quadH: number;
  readonly visibleW: number;
  readonly visibleH: number;
  readonly shoulderRatio: number;
}

const FALLBACK_ARMOR_METRICS: Record<string, ArmorContentMetrics> = {
  tunic: {
    sourceWidth: 256,
    sourceHeight: 256,
    minX: 26,
    maxX: 193,
    minY: 27,
    maxY: 232,
    contentW: 168,
    contentH: 206,
    coreW: 140,
    coreCx: 112,
    halfSpanX: 86,
  },
  star_robe: {
    sourceWidth: 256,
    sourceHeight: 256,
    minX: 26,
    maxX: 193,
    minY: 27,
    maxY: 232,
    contentW: 168,
    contentH: 206,
    coreW: 140,
    coreCx: 112,
    halfSpanX: 86,
  },
  mail: {
    sourceWidth: 256,
    sourceHeight: 256,
    minX: 12,
    maxX: 243,
    minY: 46,
    maxY: 209,
    contentW: 232,
    contentH: 164,
    coreW: 117,
    coreCx: 127.5,
    halfSpanX: 115.5,
  },
  dragon_plate: {
    sourceWidth: 256,
    sourceHeight: 256,
    minX: 60,
    maxX: 183,
    minY: 27,
    maxY: 231,
    contentW: 124,
    contentH: 205,
    coreW: 94,
    coreCx: 125,
    halfSpanX: 65,
  },
};

function getFallbackArmorMetrics(shape?: EquipmentVisualStyle['shape']): ArmorContentMetrics {
  if (shape && shape in FALLBACK_ARMOR_METRICS) {
    return FALLBACK_ARMOR_METRICS[shape];
  }
  return {
    sourceWidth: 256,
    sourceHeight: 256,
    minX: 32,
    maxX: 223,
    minY: 32,
    maxY: 223,
    contentW: 192,
    contentH: 192,
    coreW: 144,
    coreCx: 128,
    halfSpanX: 96,
  };
}

/**
 * Mesure les bornes opaques utiles d'une image d'armure (en ignorant les poussières isolées)
 * ainsi que la largeur et l'axe central de son tronc (bande poitrine/taille).
 */
export function measureArmorImageMetrics(
  img: HTMLImageElement | HTMLCanvasElement | undefined,
  shape?: EquipmentVisualStyle['shape'],
): ArmorContentMetrics {
  if (!img || typeof document === 'undefined') {
    return getFallbackArmorMetrics(shape);
  }
  const w =
    img instanceof HTMLImageElement ? img.naturalWidth || img.width : img.width;
  const h =
    img instanceof HTMLImageElement ? img.naturalHeight || img.height : img.height;
  if (w <= 0 || h <= 0) {
    return getFallbackArmorMetrics(shape);
  }

  try {
    const { ctx } = createCanvas(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const alphaMin = 48;
    const minRowPixels = Math.max(3, Math.floor(w * 0.015));
    const minColPixels = Math.max(3, Math.floor(h * 0.015));

    let minY = h;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      let count = 0;
      const rowOff = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[rowOff + x * 4 + 3] >= alphaMin) count++;
      }
      if (count >= minRowPixels) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (maxY < minY) {
      return getFallbackArmorMetrics(shape);
    }

    let minX = w;
    let maxX = -1;
    for (let x = 0; x < w; x++) {
      let count = 0;
      for (let y = minY; y <= maxY; y++) {
        if (data[(y * w + x) * 4 + 3] >= alphaMin) count++;
      }
      if (count >= minColPixels) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }

    if (maxX < minX) {
      return getFallbackArmorMetrics(shape);
    }

    const contentW = maxX - minX + 1;
    const contentH = maxY - minY + 1;
    const bandStartY = Math.floor(minY + contentH * 0.45);
    const bandEndY = Math.min(maxY, Math.floor(minY + contentH * 0.82));

    let coreWidthSum = 0;
    let coreCxSum = 0;
    let coreRows = 0;
    for (let y = bandStartY; y <= bandEndY; y++) {
      let lx = maxX + 1;
      let rx = minX - 1;
      const rowOff = y * w * 4;
      for (let x = minX; x <= maxX; x++) {
        if (data[rowOff + x * 4 + 3] >= alphaMin) {
          if (x < lx) lx = x;
          if (x > rx) rx = x;
        }
      }
      if (rx > lx) {
        coreWidthSum += rx - lx + 1;
        coreCxSum += (lx + rx) * 0.5;
        coreRows++;
      }
    }

    const coreW = coreRows > 0 ? coreWidthSum / coreRows : contentW * 0.78;
    const coreCx = coreRows > 0 ? coreCxSum / coreRows : (minX + maxX) * 0.5;
    const halfSpanX = Math.max(coreCx - minX, maxX - coreCx, contentW * 0.5);

    return {
      sourceWidth: w,
      sourceHeight: h,
      minX,
      maxX,
      minY,
      maxY,
      contentW,
      contentH,
      coreW,
      coreCx,
      halfSpanX,
    };
  } catch {
    return getFallbackArmorMetrics(shape);
  }
}

/**
 * Calcule la transformation idéale d'une armure sur le torse du héros :
 * agrandit les armures trop petites/étroites, rapetisse les armures trop grandes
 * et conserve une silhouette naturelle sans écraser les épaulières ni les manches.
 */
export function computeIdealArmorFit(
  metrics: ArmorContentMetrics,
  shape?: EquipmentVisualStyle['shape'],
): ArmorFitTransform {
  const fullSpanW = Math.max(1, metrics.halfSpanX * 2);
  const safeContentH = Math.max(1, metrics.contentH);
  const safeCoreW = Math.max(1, metrics.coreW);
  const shoulderRatio = fullSpanW / safeCoreW;
  const naturalAspect = fullSpanW / safeContentH;

  let targetCoreW: number = HERO_TORSO_ENVELOPE.coreWidth;
  let targetH: number = HERO_TORSO_ENVELOPE.coreHeight;
  let yShift = 0;
  let maxTotalW = 0.285;
  let minTotalW = 0.188;

  if (shape === 'tunic') {
    targetCoreW = 0.198;
    targetH = 0.196;
    yShift = 0.002;
    maxTotalW = 0.275;
  } else if (shape === 'star_robe') {
    targetCoreW = 0.204;
    targetH = 0.206;
    yShift = -0.002;
    maxTotalW = 0.285;
  } else if (shape === 'mail') {
    targetCoreW = 0.192;
    targetH = 0.194;
    yShift = 0.004;
    maxTotalW = 0.315;
  } else if (shape === 'dragon_plate') {
    targetCoreW = 0.198;
    targetH = 0.196;
    yShift = 0.002;
    maxTotalW = 0.236;
    minTotalW = 0.192;
  } else if (shoulderRatio > 1.55) {
    targetCoreW = 0.192;
    targetH = 0.194;
    maxTotalW = 0.312;
  } else if (shoulderRatio < 1.15) {
    targetCoreW = 0.196;
    targetH = 0.196;
    maxTotalW = 0.236;
  }

  let visibleW = Math.max(
    minTotalW,
    Math.min(maxTotalW, targetCoreW * Math.min(1.85, Math.max(1.0, shoulderRatio))),
  );
  let visibleH = Math.max(0.168, Math.min(0.228, targetH));

  // Garde-fou de proportions pour éviter toute déformation excessive tout en
  // garantissant que les cuirasses étroites s'élargissent et les armures trop grandes se réduisent.
  const minAspect = naturalAspect * 0.72;
  const maxAspect = naturalAspect * 1.62;
  const currentAspect = visibleW / visibleH;
  if (currentAspect > maxAspect) {
    visibleW = Math.max(minTotalW, visibleH * maxAspect);
  } else if (currentAspect < minAspect) {
    visibleH = Math.max(0.168, visibleW / minAspect);
  }

  return {
    normX: HERO_TORSO_ENVELOPE.centerX,
    normY: HERO_TORSO_ENVELOPE.centerY + yShift,
    quadW: visibleW / ARMOR_FIT_CONTENT_FILL,
    quadH: visibleH / ARMOR_FIT_CONTENT_FILL,
    visibleW,
    visibleH,
    shoulderRatio,
  };
}

const fittedArmorCanvasCache = new WeakMap<
  HTMLImageElement,
  { canvas: HTMLCanvasElement; metrics: ArmorContentMetrics }
>();

/**
 * Recadre proprement l'image d'armure existante autour de ses pixels opaques réels
 * (sans aucune génération d'image), supprime les poussières isolées hors boîte et
 * aligne exactement l'axe du torse au centre horizontal (u = 0.5).
 */
export function createFittedArmorCanvas(
  img: HTMLImageElement,
  shape?: EquipmentVisualStyle['shape'],
): { canvas: HTMLCanvasElement; metrics: ArmorContentMetrics } {
  const cached = fittedArmorCanvasCache.get(img);
  if (cached) return cached;

  const metrics = measureArmorImageMetrics(img, shape);
  const outSize = 256;
  const { canvas, ctx } = createCanvas(outSize, outSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const padPx = outSize * ((1 - ARMOR_FIT_CONTENT_FILL) * 0.5);
  const innerSize = outSize * ARMOR_FIT_CONTENT_FILL;
  const fullSpanW = Math.max(1, metrics.halfSpanX * 2);
  const scaleX = innerSize / fullSpanW;
  const scaleY = innerSize / Math.max(1, metrics.contentH);

  const destX = outSize * 0.5 - (metrics.coreCx - metrics.minX) * scaleX;
  const destY = padPx;
  const destW = metrics.contentW * scaleX;
  const destH = metrics.contentH * scaleY;

  ctx.clearRect(0, 0, outSize, outSize);
  ctx.drawImage(
    img,
    metrics.minX,
    metrics.minY,
    metrics.contentW,
    metrics.contentH,
    destX,
    destY,
    destW,
    destH,
  );

  const result = { canvas, metrics };
  fittedArmorCanvasCache.set(img, result);
  return result;
}

const proceduralWeaponCanvasCache = new Map<string, HTMLCanvasElement>();

/**
 * Génère un sprite Canvas2D procédural haute netteté (256×256) pour toute arme
 * sans PNG dédié (zéro génération IA, zéro 404, zéro arc de coupe peint).
 * Orientation canonique : poignée/prise vers (u ≈ 0.26, v ≈ 0.74), pointe vers haut-droite.
 */
export function drawProceduralWeaponCanvas(def: EquipmentDefinition): HTMLCanvasElement {
  const cached = proceduralWeaponCanvasCache.get(def.id);
  if (cached) return cached;

  const size = 256;
  const { canvas, ctx } = createCanvas(size, size);
  const { primaryColor, secondaryColor, accentColor, shape } = def.visualStyle;
  const family = def.weaponFamily ?? 'sword';

  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const drawOutlineStroke = (width: number) => {
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = width;
  };

  if (family === 'axe_hammer') {
    // Manche diagonal du bas-gauche vers haut-droite
    ctx.beginPath();
    ctx.moveTo(56, 200);
    ctx.lineTo(188, 68);
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 22;
    ctx.stroke();
    ctx.strokeStyle = secondaryColor;
    ctx.lineWidth = 13;
    ctx.stroke();

    if (shape === 'frost_hammer') {
      // Tête de marteau runique octogonale
      ctx.save();
      ctx.translate(182, 74);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.roundRect(-44, -28, 88, 56, 10);
      ctx.fillStyle = primaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(-24, -18, 48, 36, 6);
      ctx.fillStyle = accentColor;
      ctx.fill();
      ctx.restore();
    } else {
      // Fer de hache en croissant
      ctx.save();
      ctx.translate(178, 78);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-12, -16);
      ctx.quadraticCurveTo(46, -42, 54, 0);
      ctx.quadraticCurveTo(46, 42, -12, 16);
      ctx.closePath();
      ctx.fillStyle = primaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(28, -22);
      ctx.quadraticCurveTo(48, 0, 28, 22);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 5;
      ctx.stroke();
      ctx.restore();
    }
  } else if (family === 'dagger_claws') {
    if (shape === 'lynx_claws') {
      // Garde de cuir + 3 griffes acérées parallèles
      ctx.save();
      ctx.translate(76, 180);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.roundRect(-22, -24, 44, 48, 12);
      ctx.fillStyle = secondaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      for (const oy of [-16, 0, 16]) {
        ctx.beginPath();
        ctx.moveTo(16, oy - 5);
        ctx.lineTo(130, oy - 2);
        ctx.lineTo(16, oy + 6);
        ctx.closePath();
        ctx.fillStyle = primaryColor;
        ctx.fill();
        drawOutlineStroke(5);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // Dague croc-de-vipère effilée
      ctx.save();
      ctx.translate(70, 186);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-24, -6);
      ctx.lineTo(12, -6);
      ctx.lineTo(12, 6);
      ctx.lineTo(-24, 6);
      ctx.closePath();
      ctx.fillStyle = secondaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(10, -24);
      ctx.lineTo(22, -24);
      ctx.lineTo(22, 24);
      ctx.lineTo(10, 24);
      ctx.closePath();
      ctx.fillStyle = accentColor;
      ctx.fill();
      drawOutlineStroke(5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(22, -11);
      ctx.quadraticCurveTo(102, -16, 152, 0);
      ctx.quadraticCurveTo(102, 16, 22, 11);
      ctx.closePath();
      ctx.fillStyle = primaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      ctx.restore();
    }
  } else if (family === 'spear') {
    // Longue hampe + pointe d'arme d'hast
    ctx.beginPath();
    ctx.moveTo(42, 214);
    ctx.lineTo(188, 68);
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 17;
    ctx.stroke();
    ctx.strokeStyle = secondaryColor;
    ctx.lineWidth = 10;
    ctx.stroke();

    ctx.save();
    ctx.translate(182, 74);
    ctx.rotate(-Math.PI / 4);
    if (shape === 'royal_halberd') {
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.lineTo(54, 0);
      ctx.lineTo(-10, 10);
      ctx.closePath();
      ctx.fillStyle = primaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-16, 8);
      ctx.quadraticCurveTo(22, 44, 34, 18);
      ctx.lineTo(4, 6);
      ctx.closePath();
      ctx.fillStyle = accentColor;
      ctx.fill();
      drawOutlineStroke(5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(-8, -14);
      ctx.lineTo(58, 0);
      ctx.lineTo(-8, 14);
      ctx.closePath();
      ctx.fillStyle = primaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-8, 0, 10, 0, Math.PI * 2);
      ctx.fillStyle = accentColor;
      ctx.fill();
      drawOutlineStroke(4);
      ctx.stroke();
    }
    ctx.restore();
  } else if (family === 'staff') {
    ctx.beginPath();
    ctx.moveTo(48, 208);
    ctx.lineTo(176, 80);
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = 11;
    ctx.stroke();

    // Orbe / cristal au sommet
    ctx.beginPath();
    ctx.arc(192, 64, 28, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    drawOutlineStroke(6);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(185, 57, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else if (family === 'bow_crossbow') {
    if (shape === 'storm_crossbow') {
      ctx.save();
      ctx.translate(128, 128);
      ctx.rotate(-Math.PI / 4);
      // Crosse
      ctx.beginPath();
      ctx.roundRect(-64, -9, 136, 18, 6);
      ctx.fillStyle = secondaryColor;
      ctx.fill();
      drawOutlineStroke(6);
      ctx.stroke();
      // Arc frontal
      ctx.beginPath();
      ctx.moveTo(32, -64);
      ctx.quadraticCurveTo(68, 0, 32, 64);
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = 18;
      ctx.stroke();
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 11;
      ctx.stroke();
      // Corde + carreau lumineux
      ctx.beginPath();
      ctx.moveTo(32, -62);
      ctx.lineTo(-14, 0);
      ctx.lineTo(32, 62);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(86, 0);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(128, 128);
      ctx.rotate(-Math.PI / 4);
      ctx.beginPath();
      ctx.moveTo(-12, -82);
      ctx.quadraticCurveTo(56, 0, -12, 82);
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = 18;
      ctx.stroke();
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 11;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-12, -78);
      ctx.lineTo(-12, 78);
      ctx.strokeStyle = '#f5ecd4';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(74, 0);
      ctx.strokeStyle = accentColor;
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // Épée générique
    ctx.save();
    ctx.translate(66, 190);
    ctx.rotate(-Math.PI / 4);
    ctx.beginPath();
    ctx.roundRect(-24, -7, 36, 14, 4);
    ctx.fillStyle = secondaryColor;
    ctx.fill();
    drawOutlineStroke(5);
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(10, -28, 12, 56, 4);
    ctx.fillStyle = accentColor;
    ctx.fill();
    drawOutlineStroke(5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, -13);
    ctx.lineTo(156, -8);
    ctx.lineTo(176, 0);
    ctx.lineTo(156, 8);
    ctx.lineTo(22, 13);
    ctx.closePath();
    ctx.fillStyle = primaryColor;
    ctx.fill();
    drawOutlineStroke(6);
    ctx.stroke();
    ctx.restore();
  }

  proceduralWeaponCanvasCache.set(def.id, canvas);
  return canvas;
}

function drawNormalizedEquipPiece2D(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | HTMLCanvasElement,
  calibration: EquipmentCalibrationEntry,
  anchorX: number,
  anchorY: number,
  size: number,
  options: { rotation2D?: number; mirrorSign?: 1 | -1; scale?: number } = {},
): void {
  const normalized = createNormalizedEquipmentCanvas(img, calibration);
  const fit = computeNormalizedEquipmentFit(calibration, normalized.bounds);
  const sc = options.scale ?? 1;
  const dw = fit.quadW * size * sc;
  const dh = fit.quadH * size * sc;
  const offX = fit.meshOffsetX * size * sc;
  // En Three.js +Y est vers le haut ; sur Canvas 2D +Y est vers le bas -> inversion du signe
  const offY = -fit.meshOffsetY * size * sc;
  const mirror = options.mirrorSign ?? 1;
  const rot = options.rotation2D ?? -calibration.baseRotZ;

  const def = getEquipmentDefinition(calibration.itemId);
  const isLuminous = Boolean(def?.visualStyle.luminous && def.visualStyle.glowColor);

  ctx.save();
  ctx.translate(anchorX, anchorY);
  if (rot) ctx.rotate(rot);
  if (mirror < 0) ctx.scale(-1, 1);
  if (isLuminous && def?.visualStyle.glowColor) {
    ctx.shadowColor = def.visualStyle.glowColor;
    ctx.shadowBlur = 12;
  }
  ctx.drawImage(normalized.canvas, offX - dw * 0.5, offY - dh * 0.5, dw, dh);
  ctx.restore();
}

/**
 * Assemble le héros 2.5D en couches strictement indépendantes (512×512) en utilisant
 * le même squelette anatomique (`HERO_SKELETON_SPEC`) et le même registre de calibration
 * (`EQUIPMENT_CALIBRATION_REGISTRY`) que le rendu 3D, pour une cohérence 1:1.
 */
export function drawHeroCanvas(
  equipped: Record<EquipSlot, string>,
  frame: HeroAnimFrame,
  images?: HeroModularImages,
  includeCapeLayer = false,
  subFrameIndex = 0,
  animStateOverride?: HeroAnimState,
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const animState = animStateOverride ?? mapHeroFrameToAnimState(frame);
  const a = POSE_ANCHORS[frame] ?? POSE_ANCHORS.idle;
  const idleA = POSE_ANCHORS.idle;
  const boneToCanvas = (
    boneId: Parameters<typeof getBoneRestWorldPosition>[0],
    extraNormX = 0,
    extraNormY = 0,
    frameDx = 0,
    frameDy = 0,
  ) => {
    const rest = getBoneRestWorldPosition(boneId);
    return {
      x: (0.5 + rest.x + extraNormX) * size + frameDx,
      y: (1 - (rest.y + extraNormY)) * size + frameDy,
    };
  };

  // 1. Cape derrière le personnage (uniquement en aperçu 2D ; en 3D c'est CapeClothMesh)
  if (includeCapeLayer && equipped.cape) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.cape, animState, subFrameIndex, size)) {
      const capeImg = getEquipImage(images, equipped.cape);
      if (capeImg) {
        const collarPos = boneToCanvas(
          'collar',
          0,
          -0.075,
          a.capeX - idleA.capeX,
          a.capeY - idleA.capeY,
        );
        drawPieceWithOptionalLocalGlow(
          ctx,
          capeImg,
          collarPos.x,
          collarPos.y,
          a.capeW,
          a.capeH,
          equipped.cape,
        );
      }
    }
  }

  // 2. Corps de base du héros félin (fourrure tigrée rousse intacte, jamais teintée)
  const stateSheet = images?.stateSheets?.[animState];
  const fallbackFrame: HeroAnimFrame =
    frame === 'hurt' ? 'idle' : frame === 'death' ? 'roll' : frame;
  const baseImg =
    stateSheet ??
    images?.basePoses[frame] ??
    images?.basePoses[fallbackFrame] ??
    images?.basePoses.idle;

  if (baseImg) {
    const bw = baseImg.naturalWidth || baseImg.width || size;
    const bh = baseImg.naturalHeight || baseImg.height || size;
    const baseGrid = resolveActiveSpriteGrid(HERO_ANIM_CLIPS[animState], bw, bh);
    if (baseGrid.cols > 1 || baseGrid.rows > 1) {
      drawSheetCell(ctx, baseImg, baseGrid, subFrameIndex, size);
    } else {
      ctx.drawImage(baseImg, 0, 0, size, size);
    }

    // Masquage anatomique 2D aligné 1:1 avec le shader 3D (`computeHeroEquipmentMaskState`)
    const equipMask = computeHeroEquipmentMaskState({
      equipped,
      heroState: animState,
      showSocketEquip: true,
    });
    if (equipMask.torsoMasked) {
      const torsoDx = a.torsoX - idleA.torsoX;
      const torsoDy = a.torsoY - idleA.torsoY;
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.ellipse(
        equipMask.torsoCenterU * size + torsoDx,
        (1 - equipMask.torsoCenterV) * size + torsoDy,
        equipMask.torsoHalfW * size,
        equipMask.torsoHalfH * size,
        -equipMask.torsoRotZ,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
    if (equipMask.headMaskEnabled) {
      const headDx = a.headX - idleA.headX;
      const headDy = a.headY - idleA.headY;
      const browCanvasY = (1 - (equipMask.headBoneV - 0.035)) * size + headDy;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size, Math.max(0, browCanvasY));
      ctx.clip();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.ellipse(
        equipMask.headCenterU * size + headDx,
        (1 - equipMask.headCenterV) * size + headDy,
        equipMask.headHalfW * size * a.headScale,
        equipMask.headHalfH * size * a.headScale,
        -equipMask.headRotZ,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();
    }
  }

  // 3. Armure (torse — ajustement automatique idéal sur le tronc félin réel)
  if (equipped.armor) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.armor, animState, subFrameIndex, size)) {
      const armorImg = getEquipImage(images, equipped.armor);
      if (armorImg) {
        const def = getEquipmentDefinition(equipped.armor);
        const fitted = createFittedArmorCanvas(armorImg, def?.visualStyle.shape);
        const fit = computeIdealArmorFit(fitted.metrics, def?.visualStyle.shape);
        const torsoDx = a.torsoX - idleA.torsoX;
        const torsoDy = a.torsoY - idleA.torsoY;
        const scaleFactor = a.torsoW / idleA.torsoW;
        const destX = (0.5 + fit.normX) * size + torsoDx;
        const destY = (1 - fit.normY) * size + torsoDy;
        const destW = fit.quadW * size * scaleFactor;
        const destH = fit.quadH * size * scaleFactor;
        drawPieceWithOptionalLocalGlow(
          ctx,
          fitted.canvas,
          destX,
          destY,
          destW,
          destH,
          equipped.armor,
        );
      }
    }
  }

  // 4. Casque / Coiffe (centré sur le crâne réel x ≈ 230, y ≈ 176)
  if (equipped.helmet) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.helmet, animState, subFrameIndex, size)) {
      const helmImg = getEquipImage(images, equipped.helmet);
      const cal = getEquipmentCalibration(equipped.helmet);
      if (helmImg && cal) {
        const hp = boneToCanvas(
          'head',
          cal.offsetX,
          cal.offsetY,
          a.headX - idleA.headX,
          a.headY - idleA.headY,
        );
        drawNormalizedEquipPiece2D(ctx, helmImg, cal, hp.x, hp.y, size, {
          scale: a.headScale,
        });
      }
    }
  }

  // 8. Bouclier (main gauche)
  if (equipped.shield) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.shield, animState, subFrameIndex, size)) {
      const shieldImg = getEquipImage(images, equipped.shield);
      const cal = getEquipmentCalibration(equipped.shield);
      if (shieldImg && cal) {
        const sp = boneToCanvas(
          'leftHand',
          cal.offsetX,
          cal.offsetY,
          a.offhandX - idleA.offhandX,
          a.offhandY - idleA.offhandY,
        );
        drawNormalizedEquipPiece2D(ctx, shieldImg, cal, sp.x, sp.y, size, {
          scale: a.offhandScale,
        });
      }
    }
  }

  // 6. Arme principale (main droite — pivotée autour de la garde dans la patte ; repli procédural zéro-404)
  if (equipped.weapon) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.weapon, animState, subFrameIndex, size)) {
      const def = getEquipmentDefinition(equipped.weapon);
      const weapImg =
        getEquipImage(images, equipped.weapon) ??
        (def?.slot === 'weapon' && typeof document !== 'undefined'
          ? drawProceduralWeaponCanvas(def)
          : undefined);
      const cal = getEquipmentCalibration(equipped.weapon);
      if (weapImg && cal) {
        const wp = boneToCanvas(
          'rightHand',
          cal.offsetX,
          cal.offsetY,
          a.weaponX - idleA.weaponX,
          a.weaponY - idleA.weaponY,
        );
        const attackDeltaRot = a.weaponRot - idleA.weaponRot;
        drawNormalizedEquipPiece2D(ctx, weapImg, cal, wp.x, wp.y, size, {
          scale: a.weaponScale,
          rotation2D: -cal.baseRotZ + attackDeltaRot,
        });
      }
    }
  }

  return canvas;
}

/**
 * Aperçu complet du héros pour la modale Inventaire (inclut la cape 2D derrière).
 */
export function drawHeroFullPreviewDataUrl(
  equipped: Record<EquipSlot, string>,
  images?: HeroModularImages,
): string {
  const full = drawHeroCanvas(equipped, 'idle', images, true, 0, 'idle');
  const { canvas, ctx } = createCanvas(256, 256);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(full, 0, 0, 256, 256);
  return canvas.toDataURL('image/png');
}

/**
 * Portrait buste du héros pour le HUD et les dialogues (reflète casque, armure et cape équipés).
 */
export function drawHeroPortraitDataUrl(
  equipped: Record<EquipSlot, string>,
  images?: HeroModularImages,
): string {
  const { canvas, ctx } = createCanvas(128, 128);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fond parchemin/prairie discret pour le médaillon de portrait
  const bg = ctx.createRadialGradient(64, 52, 8, 64, 64, 66);
  bg.addColorStop(0, '#72a362');
  bg.addColorStop(1, '#3b5c34');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 128, 128);

  const full = drawHeroCanvas(equipped, 'idle', images, true, 0, 'idle');
  // Recadre proprement sur le buste (tête + casque + épaules/armure/cape)
  ctx.drawImage(full, 96, 56, 320, 320, 0, 2, 128, 128);
  return canvas.toDataURL('image/png');
}

// ============================================================================
// SYSTÈME DE SOCKETS HIÉRARCHIQUES PAR FRAME (27 COUCHES ACTIVES + LANTERNE),
// FLIP 180° FEUILLE RIGIDE AVEC OVERSHOOT & RIG PENDULAIRE DE LANTERNE
// ============================================================================

export type HeroSocketId =
  | 'head'
  | 'torso'
  | 'leftHand'
  | 'rightHand'
  | 'leftFoot'
  | 'rightFoot'
  | 'weapon'
  | 'shield'
  | 'cape'
  | 'lanternBelt'
  | 'lanternHand';

export interface HeroSocketPose {
  x: number;
  y: number;
  z: number;
  rot: number;
  sx: number;
  sy: number;
}

export type HeroFrameSockets = Record<HeroSocketId, HeroSocketPose>;

/**
 * Associe chaque emplacement d'équipement (5 slots actifs) à son socket
 * hiérarchique de référence sur le rig du héros.
 */
export const HERO_SLOT_TO_SOCKET: Readonly<Record<EquipSlot, HeroSocketId>> = {
  helmet: 'head',
  armor: 'torso',
  cape: 'cape',
  shield: 'shield',
  weapon: 'weapon',
};

/**
 * Catalogue complet des couches d'équipement dynamiques (27 pièces actives :
 * 4 armures, 4 capes, 4 casques, 2 boucliers, 13 armes) et leurs attributs.
 */
export const HERO_27_EQUIPMENT_LAYERS: Readonly<
  Record<
    string,
    {
      slot: EquipSlot;
      socket: HeroSocketId;
      glowHex?: number;
      isCloth?: boolean;
      isPendulum?: boolean;
      raisesOnBlock?: boolean;
      noBakedSlashArc?: boolean;
    }
  >
> = {
  // Armures (4)
  armor_tunic: { slot: 'armor', socket: 'torso' },
  armor_mail: { slot: 'armor', socket: 'torso' },
  armor_robe: { slot: 'armor', socket: 'torso' },
  armor_dragon: { slot: 'armor', socket: 'torso', glowHex: 0xff5a28 },
  // Capes (4)
  cape_traveler: { slot: 'cape', socket: 'cape', isCloth: true },
  cape_knight: { slot: 'cape', socket: 'cape', isCloth: true },
  cape_starlight: { slot: 'cape', socket: 'cape', isCloth: true, glowHex: 0x70d8ff },
  cape_dragon: { slot: 'cape', socket: 'cape', isCloth: true, glowHex: 0xff4d24 },
  // Casques (4)
  helm_bandana: { slot: 'helmet', socket: 'head' },
  helm_knight: { slot: 'helmet', socket: 'head' },
  helm_mage: { slot: 'helmet', socket: 'head', glowHex: 0x85c8ff },
  helm_dragon: { slot: 'helmet', socket: 'head', glowHex: 0xff5424 },
  // Boucliers (2)
  shield_wood: { slot: 'shield', socket: 'shield', raisesOnBlock: true },
  shield_knight: { slot: 'shield', socket: 'shield', raisesOnBlock: true },
  // Armes (13) — règle stricte : AUCUN arc de coupe peint dans la texture
  sword_wood: { slot: 'weapon', socket: 'weapon', noBakedSlashArc: true },
  sword_steel: { slot: 'weapon', socket: 'weapon', noBakedSlashArc: true },
  blade_dragon: { slot: 'weapon', socket: 'weapon', glowHex: 0xff6b26, noBakedSlashArc: true },
  axe_iron: { slot: 'weapon', socket: 'weapon', noBakedSlashArc: true },
  hammer_frost: { slot: 'weapon', socket: 'weapon', glowHex: 0x68e3ff, noBakedSlashArc: true },
  claws_lynx: { slot: 'weapon', socket: 'weapon', noBakedSlashArc: true },
  dagger_viper: { slot: 'weapon', socket: 'weapon', glowHex: 0x6be854, noBakedSlashArc: true },
  spear_fishbone: { slot: 'weapon', socket: 'weapon', noBakedSlashArc: true },
  halberd_royal: { slot: 'weapon', socket: 'weapon', noBakedSlashArc: true },
  staff_arcane: { slot: 'weapon', socket: 'weapon', glowHex: 0x66e8ff, noBakedSlashArc: true },
  staff_ember: { slot: 'weapon', socket: 'weapon', glowHex: 0xff6e24, noBakedSlashArc: true },
  bow_hunter: { slot: 'weapon', socket: 'weapon', noBakedSlashArc: true },
  crossbow_storm: { slot: 'weapon', socket: 'weapon', glowHex: 0x66d9ff, noBakedSlashArc: true },
};

const SOCKET_Z_STEP = 0.002;

/**
 * Calcule sans dépendance DOM les positions locales (espace normalisé autour du
 * pivot [0.5, 0.06], +Y vers le haut) des 12 sockets hiérarchiques du héros pour
 * n'importe quel état (`idle`, `walk`, `jump`, `attack`, `roll`, `hurt`, `death`)
 * et index de frame 30 FPS.
 */
export function sampleHeroFrameSockets(
  state: HeroAnimState,
  frameIndex: number,
  frameCount: number,
  options?: {
    blocking?: boolean;
    facingSign?: 1 | -1;
  },
): HeroFrameSockets {
  const safeCount = Math.max(1, Math.floor(frameCount));
  const clampedFrame = Math.max(0, Math.min(safeCount - 1, Math.floor(frameIndex)));
  const phase = (clampedFrame / safeCount) * Math.PI * 2;
  const prog = safeCount > 1 ? clampedFrame / (safeCount - 1) : 0;
  const facing = options?.facingSign ?? 1;
  const blocking = Boolean(options?.blocking);

  let bodyY = state === 'idle' ? Math.sin(phase) * 0.012 : 0;
  let bodyRot = 0;
  let headY = 0.66 + bodyY * 1.15;
  let headRot = Math.sin(phase * 0.5) * 0.03;

  let leftFootX = -0.09;
  let leftFootY = 0.08;
  let rightFootX = 0.09;
  let rightFootY = 0.08;

  let weaponX = 0.22;
  let weaponY = 0.35 + bodyY;
  let weaponRot = -0.18 + Math.sin(phase) * 0.04;

  let shieldX = -0.19;
  let shieldY = 0.34 + bodyY;
  let shieldRot = 0.06;

  if (state === 'walk') {
    const stride = Math.sin(phase);
    const bob = Math.abs(stride) * 0.028;
    bodyY = bob;
    headY = 0.66 + bob * 1.1;
    bodyRot = -0.07 + Math.sin(phase * 2) * 0.03;
    leftFootX = -0.08 + stride * 0.11;
    leftFootY = 0.08 + Math.max(0, stride) * 0.055;
    rightFootX = 0.08 - stride * 0.11;
    rightFootY = 0.08 + Math.max(0, -stride) * 0.055;
    weaponX = 0.22 + stride * 0.045;
    weaponY = 0.35 + bob;
    weaponRot = -0.22 - stride * 0.24;
    shieldX = -0.19 - stride * 0.035;
    shieldY = 0.34 + bob;
    shieldRot = 0.06 + stride * 0.14;
  } else if (state === 'jump') {
    const arc = Math.sin(prog * Math.PI);
    bodyY = 0.06 + arc * 0.08;
    headY = 0.68 + bodyY;
    leftFootX = -0.11;
    leftFootY = 0.14 + arc * 0.06;
    rightFootX = 0.10;
    rightFootY = 0.11 + arc * 0.04;
    weaponX = 0.25;
    weaponY = 0.44 + bodyY;
    weaponRot = 0.32;
    shieldX = -0.22;
    shieldY = 0.41 + bodyY;
    shieldRot = -0.16;
  } else if (state === 'attack') {
    if (prog < 0.28) {
      const t = prog / 0.28;
      bodyRot = 0.18 * t;
      weaponX = 0.16 - 0.14 * t;
      weaponY = 0.44 + 0.12 * t;
      weaponRot = 1.25 * t;
      shieldX = -0.23;
    } else if (prog < 0.58) {
      const t = (prog - 0.28) / 0.30;
      const snap = 1 - (1 - t) * (1 - t) * (1 - t);
      bodyRot = 0.18 - 0.44 * snap;
      weaponX = 0.02 + 0.36 * snap;
      weaponY = 0.56 - 0.28 * snap;
      weaponRot = 1.25 - 2.65 * snap;
      shieldX = -0.18 - 0.04 * snap;
    } else {
      const t = (prog - 0.58) / 0.42;
      const ease = 1 - (1 - t) * (1 - t);
      bodyRot = -0.26 * (1 - ease);
      weaponX = 0.38 - 0.16 * ease;
      weaponY = 0.28 + 0.07 * ease;
      weaponRot = -1.40 + 1.22 * ease;
    }
  } else if (state === 'roll') {
    const spin = prog * Math.PI * 2;
    bodyRot = -spin;
    bodyY = Math.sin(prog * Math.PI) * 0.14;
    headY = 0.52 + bodyY;
    weaponX = 0.12 * Math.cos(spin);
    weaponY = 0.34 + bodyY + 0.10 * Math.sin(spin);
    weaponRot = -spin - 0.4;
    shieldX = -0.12 * Math.cos(spin);
    shieldY = 0.34 + bodyY - 0.10 * Math.sin(spin);
  } else if (state === 'hurt') {
    const recoil = Math.sin(prog * Math.PI);
    bodyRot = 0.26 * recoil;
    headRot = 0.18 * recoil;
    weaponX = 0.18 - 0.06 * recoil;
    weaponRot = 0.35 * recoil;
  } else if (state === 'death') {
    const collapse = prog * prog;
    bodyY = -0.16 * collapse;
    bodyRot = 1.25 * collapse;
    headY = 0.66 - 0.42 * collapse;
    weaponX = 0.28 + 0.12 * collapse;
    weaponY = 0.12;
    weaponRot = -1.45 * collapse;
  }

  // Levée défensive du bouclier lors d'un blocage / Égide active
  if (blocking && state !== 'roll' && state !== 'death') {
    shieldX = 0.06;
    shieldY = 0.43 + bodyY;
    shieldRot = -0.22;
  }

  const make = (x: number, y: number, z: number, rot = 0): HeroSocketPose => ({
    x: x * facing,
    y,
    z,
    rot: rot * facing,
    sx: facing,
    sy: 1,
  });

  const walkSwing = state === 'walk' ? Math.sin(phase) : 0;

  return {
    head: make(0, headY, SOCKET_Z_STEP * 3, headRot),
    torso: make(0, 0.38 + bodyY, SOCKET_Z_STEP * 1, bodyRot),
    leftHand: make(shieldX, shieldY, SOCKET_Z_STEP * 2, shieldRot),
    rightHand: make(weaponX, weaponY, SOCKET_Z_STEP * 4, weaponRot),
    leftFoot: make(leftFootX, leftFootY, 0, walkSwing * 0.18),
    rightFoot: make(rightFootX, rightFootY, SOCKET_Z_STEP * 2, -walkSwing * 0.18),
    weapon: make(weaponX, weaponY, SOCKET_Z_STEP * 5, weaponRot),
    shield: make(shieldX, shieldY, SOCKET_Z_STEP * 3, shieldRot),
    cape: make(-0.04, 0.52 + bodyY, -SOCKET_Z_STEP * 2, bodyRot * 0.4),
    lanternBelt: make(0.16, 0.28 + bodyY, SOCKET_Z_STEP * 5, walkSwing * 0.15),
    lanternHand: make(0.29, 0.40 + bodyY, SOCKET_Z_STEP * 7, 0.08 + walkSwing * 0.22),
  };
}

// ============================================================================
// Retournement 180° façon feuille rigide (Paper-Cutout Flip avec Overshoot)
// ============================================================================

export interface PaperFlipOvershootState {
  targetSign: 1 | -1;
  currentSign: 1 | -1;
  progress: number;
  /** Angle courant sur l'axe Y en radians (0 -> PI ou PI -> 0) avec overshoot ~12° */
  rotationY: number;
  /** Facteur visuel latéral (+1 ou -1) stable pour éviter tout effondrement à 0 */
  scaleX: number;
  /** Décalage d'overshoot (radians) résiduel pour le diagnostic et les accessoires */
  overshootRad: number;
}

export function createPaperFlipOvershootState(initialSign: 1 | -1 = 1): PaperFlipOvershootState {
  return {
    targetSign: initialSign,
    currentSign: initialSign,
    progress: 1,
    rotationY: initialSign === 1 ? 0 : Math.PI,
    scaleX: initialSign,
    overshootRad: 0,
  };
}

/**
 * Anime un retournement gauche/droite à 180° sur l'axe Y façon feuille rigide
 * avec courbe d'overshoot amortie (`c1 = 1.70158`, ~10 % de dépassement) sur ~0.18 s.
 */
export function stepPaperFlipOvershoot(
  state: PaperFlipOvershootState,
  desiredSign: 1 | -1,
  dt: number,
  durationSec = 0.18,
): PaperFlipOvershootState {
  if (desiredSign !== state.targetSign) {
    state.currentSign = state.targetSign;
    state.targetSign = desiredSign;
    state.progress = 0;
  }

  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  if (state.progress < 1) {
    state.progress = Math.min(1, state.progress + safeDt / Math.max(0.05, durationSec));
  }

  const t = state.progress;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  // Back-out easing : dépasse 1.0 (~1.10) autour de t=0.68 puis revient exactement à 1.0
  const eased = t >= 1 ? 1 : 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);

  const startY = state.currentSign === 1 ? 0 : Math.PI;
  const endY = state.targetSign === 1 ? 0 : Math.PI;
  state.rotationY = startY + (endY - startY) * eased;
  state.overshootRad = (eased - Math.min(1, t)) * Math.abs(endY - startY);

  // Empêche le plan de devenir parfaitement invisible sur la tranche à 90°
  const cosY = Math.cos(state.rotationY);
  const minWidth = 0.14;
  if (Math.abs(cosY) < minWidth) {
    state.scaleX = (cosY >= 0 ? 1 : -1) * minWidth;
  } else {
    state.scaleX = cosY;
  }

  return state;
}

// ============================================================================
// Lanterne du Héros (`lantern_hero.png`) : Transfert Ceinture -> Main + Pendule
// ============================================================================

/** Seuil de `weather.lanternBoost` à partir duquel le héros saisit la lanterne en main */
export const HERO_LANTERN_HAND_THRESHOLD = 0.18;

export type HeroLanternSocket = 'belt' | 'hand';

export interface HeroLanternRigState {
  socket: HeroLanternSocket;
  /** 0 = accrochée à la ceinture (`lanternBelt`), 1 = tenue en main (`lanternHand`) */
  handBlend: number;
  /** Angle pendulaire courant (radians) */
  swingAngle: number;
  /** Vitesse angulaire pendulaire (rad/s) */
  swingVelocity: number;
  /** Intensité du halo d'éclairage [0..1] transmis à `spriteLighting.ts` */
  haloIntensity: number;
  /** Position locale résolue (normalisée autour du pivot héros) */
  localX: number;
  localY: number;
  localZ: number;
}

export function createHeroLanternRigState(): HeroLanternRigState {
  return {
    socket: 'belt',
    handBlend: 0,
    swingAngle: 0,
    swingVelocity: 0,
    haloIntensity: 0,
    localX: 0.16,
    localY: 0.28,
    localZ: SOCKET_Z_STEP * 5,
  };
}

/**
 * Met à jour le transfert de socket ceinture <-> main de la lanterne du héros
 * en fonction du seuil météo (`weather.lanternBoost`), ainsi que son balancement
 * physique pendule/ressort durant la marche et son halo d'éclairage actif.
 */
export function stepHeroLanternRig(
  rig: HeroLanternRigState,
  sockets: Readonly<HeroFrameSockets>,
  input: {
    lanternBoost: number;
    vx: number;
    vz: number;
    facingSign: 1 | -1;
    windIntensity?: number;
    isRolling?: boolean;
    inDungeon?: boolean;
  },
  dt: number,
): HeroLanternRigState {
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
  const effectiveBoost = input.inDungeon ? Math.max(0.75, input.lanternBoost) : input.lanternBoost;
  const wantHand = !input.isRolling && effectiveBoost >= HERO_LANTERN_HAND_THRESHOLD;
  rig.socket = wantHand ? 'hand' : 'belt';

  // Transition fluide sortie / rangement (~0.26 s)
  const targetBlend = wantHand ? 1 : 0;
  const blendStep = safeDt > 0 ? Math.min(1, safeDt * 3.85) : 0;
  rig.handBlend += (targetBlend - rig.handBlend) * blendStep;
  if (Math.abs(targetBlend - rig.handBlend) < 0.005) {
    rig.handBlend = targetBlend;
  }

  // Dynamique pendule / ressort amorti couplée à la vitesse de marche et au vent
  const walkForce = -input.vx * 0.085 - input.vz * 0.025;
  const windForce = (input.windIntensity ?? 0.2) * 0.22 * input.facingSign;
  const targetRestAngle = Math.max(-0.62, Math.min(0.62, (walkForce + windForce) * (0.45 + 0.55 * rig.handBlend)));

  if (safeDt > 0) {
    const stiffness = 36.0;
    const damping = 6.4;
    const accel = (targetRestAngle - rig.swingAngle) * stiffness - rig.swingVelocity * damping;
    rig.swingVelocity += accel * safeDt;
    rig.swingAngle = Math.max(-0.78, Math.min(0.78, rig.swingAngle + rig.swingVelocity * safeDt));
  }

  // Interpolation cubique entre socket ceinture et socket main
  const u = rig.handBlend;
  const smooth = u * u * (3 - 2 * u);
  const belt = sockets.lanternBelt;
  const hand = sockets.lanternHand;
  // Petit arc vers l'avant lors de la sortie/rangement
  const arcLift = Math.sin(smooth * Math.PI) * 0.04;

  rig.localX = belt.x + (hand.x - belt.x) * smooth;
  rig.localY = belt.y + (hand.y - belt.y) * smooth + arcLift;
  rig.localZ = belt.z + (hand.z - belt.z) * smooth;

  // Halo lumineux actif dès que la lanterne est sortie ou en transition haute
  rig.haloIntensity =
    effectiveBoost >= HERO_LANTERN_HAND_THRESHOLD
      ? Math.max(0, Math.min(1, effectiveBoost * (0.25 + 0.75 * smooth)))
      : Math.max(0, effectiveBoost * 0.35 * smooth);

  return rig;
}

// ============================================================================
// Lanterne de Ceinture Permanente (Cat Quest 3) :
// - Toujours attachée à la ceinture (JAMAIS en main)
// - Dans les lieux lumineux : rangée proprement (visible = false)
// - Dans les lieux sombres (nuit, tempête, brouillard, donjon) :
//   commence ÉTEINTE, se déploie à la ceinture puis s'allume progressivement en ~2.0 s
// ============================================================================

export const BELT_LANTERN_IGNITE_DURATION = 2.0;
export const BELT_LANTERN_DARK_THRESHOLD = 0.14;

export interface HeroBeltLanternState {
  readonly socket: 'belt';
  /** 0 = rangée / cachée, 1 = sortie à la ceinture */
  deploy: number;
  /** 0 = éteinte, 1 = pleine luminosité (rampe 2.0 s) */
  lightLevel: number;
  /** Vrai tant que la lanterne est déployée ou en cours de rangement */
  visible: boolean;
  /** Intensité lumineuse finale pondérée par l'obscurité ambiante [0..1] */
  effectiveIntensity: number;
  /** Angle pendulaire de la lanterne accrochée à la ceinture */
  swingAngle: number;
  swingVelocity: number;
}

export function createHeroBeltLanternState(): HeroBeltLanternState {
  return {
    socket: 'belt',
    deploy: 0,
    lightLevel: 0,
    visible: false,
    effectiveIntensity: 0,
    swingAngle: 0,
    swingVelocity: 0,
  };
}

export function stepHeroBeltLantern(
  state: HeroBeltLanternState,
  input: {
    lanternBoost: number;
    inDungeon: boolean;
    isOnDeck?: boolean;
    isDead?: boolean;
    vx: number;
    vz: number;
    facingSign: 1 | -1;
    windIntensity?: number;
  },
  dt: number,
): HeroBeltLanternState {
  const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.05) : 0;
  const ambientDarkness = input.inDungeon
    ? Math.max(0.88, input.lanternBoost)
    : input.lanternBoost;
  const wantActive =
    !input.isDead &&
    !input.isOnDeck &&
    ambientDarkness >= BELT_LANTERN_DARK_THRESHOLD;

  if (wantActive) {
    // 1. Déploiement fluide à la ceinture (~0.32 s) en commençant ÉTEINTE
    if (safeDt > 0) {
      state.deploy = Math.min(1, state.deploy + safeDt / 0.32);
      // 2. Allumage progressif sur exactement ~2.0 secondes dès qu'elle est déployée
      if (state.deploy >= 0.45) {
        state.lightLevel = Math.min(
          1,
          state.lightLevel + safeDt / BELT_LANTERN_IGNITE_DURATION,
        );
      }
    }
  } else {
    // Extinction progressive (~0.55 s) puis rangement à la ceinture (~0.35 s)
    if (safeDt > 0) {
      state.lightLevel = Math.max(0, state.lightLevel - safeDt / 0.55);
      if (state.lightLevel <= 0.15) {
        state.deploy = Math.max(0, state.deploy - safeDt / 0.35);
      }
    }
  }

  state.visible = !input.isDead && state.deploy > 0.01;
  // Courbe douce S-curve sur l'allumage 0..1 pour une montée en lumière chaleureuse
  const l = state.lightLevel;
  const smoothLight = l * l * (3 - 2 * l);
  state.effectiveIntensity = state.visible
    ? Math.max(0, Math.min(1, smoothLight * Math.max(0.55, ambientDarkness)))
    : 0;

  // Pendule naturel à la ceinture (couplé au pas et au vent, jamais en main)
  const walkForce = -input.vx * 0.068 - input.vz * 0.022;
  const windForce = (input.windIntensity ?? 0.2) * 0.16 * input.facingSign;
  const targetAngle = Math.max(-0.52, Math.min(0.52, (walkForce + windForce) * state.deploy));
  if (safeDt > 0) {
    const accel = (targetAngle - state.swingAngle) * 32.0 - state.swingVelocity * 6.8;
    state.swingVelocity += accel * safeDt;
    state.swingAngle = Math.max(
      -0.65,
      Math.min(0.65, state.swingAngle + state.swingVelocity * safeDt),
    );
  }

  return state;
}

/**
 * Dessine la texture procédurale haute netteté de la lanterne du héros
 * (repli propre zéro-404 lorsque `public/assets/equipment/lantern_hero.png`
 * n'est pas encore sur disque).
 */
export function drawHeroLanternCanvas(lit = true): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(128, 128);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Anneau supérieur de suspension (pivot du pendule)
  ctx.strokeStyle = '#2b1e16';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(64, 20, 11, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#d49a3a';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Chapeau métallique forgé
  ctx.fillStyle = '#4a3525';
  ctx.strokeStyle = '#2b1e16';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(40, 44);
  ctx.quadraticCurveTo(64, 24, 88, 44);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Cage vitrée lumineuse
  const glassGrad = ctx.createRadialGradient(64, 68, 4, 64, 70, 26);
  if (lit) {
    glassGrad.addColorStop(0, '#fffce0');
    glassGrad.addColorStop(0.55, '#ffd052');
    glassGrad.addColorStop(1, '#e87a1e');
  } else {
    glassGrad.addColorStop(0, '#b8cbd4');
    glassGrad.addColorStop(1, '#5d7380');
  }
  ctx.fillStyle = glassGrad;
  ctx.beginPath();
  ctx.roundRect(44, 44, 40, 48, 8);
  ctx.fill();
  ctx.strokeStyle = '#2b1e16';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Barreaux de laiton
  ctx.strokeStyle = '#5c4128';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(64, 44);
  ctx.lineTo(64, 92);
  ctx.moveTo(44, 68);
  ctx.lineTo(84, 68);
  ctx.stroke();

  // Socle inférieur
  ctx.fillStyle = '#4a3525';
  ctx.beginPath();
  ctx.roundRect(38, 90, 52, 14, 6);
  ctx.fill();
  ctx.strokeStyle = '#2b1e16';
  ctx.lineWidth = 4;
  ctx.stroke();

  return canvas;
}

