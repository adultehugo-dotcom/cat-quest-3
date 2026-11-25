import type { EquipSlot } from '../game/types';
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
import { createCanvas } from './palette';

// ============================================================================
// Héros Chat-valier Modulaire 2.5D — Assemblage par couches d'assets externes
// - Zéro halo global, zéro teinte globale (`source-atop`) sur le corps/fourrure.
// - 8 emplacements strictement indépendants : `weapon`, `shield`, `helmet`,
//   `armor`, `boots`, `gloves`, `cape`, `trinket` (aucune arme secondaire).
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

/** Les 7 emplacements dessinés sur le quad du corps 3D (hors `cape`, gérée par `CapeClothMesh`). */
export const HERO_BODY_EQUIP_SLOTS: readonly Exclude<EquipSlot, 'cape'>[] = [
  'weapon',
  'shield',
  'helmet',
  'armor',
  'boots',
  'gloves',
  'trinket',
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
  bootSize: number;
  leftHandX: number;
  leftHandY: number;
  rightHandX: number;
  rightHandY: number;
  gloveSize: number;
  weaponX: number;
  weaponY: number;
  weaponRot: number;
  weaponScale: number;
  offhandX: number;
  offhandY: number;
  offhandScale: number;
  trinketX: number;
  trinketY: number;
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
    bootSize: 56,
    leftHandX: 194,
    leftHandY: 360,
    rightHandX: 316,
    rightHandY: 358,
    gloveSize: 48,
    weaponX: 354,
    weaponY: 318,
    weaponRot: 0.28,
    weaponScale: 1.0,
    offhandX: 184,
    offhandY: 362,
    offhandScale: 1.0,
    trinketX: 256,
    trinketY: 332,
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
    bootSize: 56,
    leftHandX: 192,
    leftHandY: 354,
    rightHandX: 320,
    rightHandY: 354,
    gloveSize: 48,
    weaponX: 360,
    weaponY: 314,
    weaponRot: 0.36,
    weaponScale: 1.0,
    offhandX: 182,
    offhandY: 356,
    offhandScale: 1.0,
    trinketX: 256,
    trinketY: 328,
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
    bootSize: 56,
    leftHandX: 198,
    leftHandY: 358,
    rightHandX: 312,
    rightHandY: 356,
    gloveSize: 48,
    weaponX: 352,
    weaponY: 318,
    weaponRot: 0.22,
    weaponScale: 1.0,
    offhandX: 188,
    offhandY: 360,
    offhandScale: 1.0,
    trinketX: 256,
    trinketY: 330,
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
    bootSize: 56,
    leftHandX: 198,
    leftHandY: 354,
    rightHandX: 336,
    rightHandY: 342,
    gloveSize: 48,
    weaponX: 392,
    weaponY: 288,
    weaponRot: 0.96,
    weaponScale: 1.12,
    offhandX: 186,
    offhandY: 356,
    offhandScale: 1.0,
    trinketX: 264,
    trinketY: 330,
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
    bootSize: 52,
    leftHandX: 204,
    leftHandY: 378,
    rightHandX: 312,
    rightHandY: 376,
    gloveSize: 44,
    weaponX: 352,
    weaponY: 346,
    weaponRot: 0.55,
    weaponScale: 0.92,
    offhandX: 192,
    offhandY: 382,
    offhandScale: 0.92,
    trinketX: 256,
    trinketY: 356,
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
    bootSize: 56,
    leftHandX: 190,
    leftHandY: 358,
    rightHandX: 312,
    rightHandY: 360,
    gloveSize: 48,
    weaponX: 346,
    weaponY: 324,
    weaponRot: 0.16,
    weaponScale: 1.0,
    offhandX: 182,
    offhandY: 360,
    offhandScale: 1.0,
    trinketX: 252,
    trinketY: 334,
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
    bootSize: 52,
    leftHandX: 204,
    leftHandY: 378,
    rightHandX: 312,
    rightHandY: 376,
    gloveSize: 44,
    weaponX: 352,
    weaponY: 346,
    weaponRot: 0.55,
    weaponScale: 0.92,
    offhandX: 192,
    offhandY: 382,
    offhandScale: 0.92,
    trinketX: 256,
    trinketY: 356,
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
    equipped.boots || '',
    equipped.gloves || '',
    equipped.cape || '',
    equipped.trinket || '',
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
    equipped.boots || '',
    equipped.gloves || '',
    equipped.trinket || '',
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
  img: HTMLImageElement,
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

function drawHelmetPiece(
  ctx: CanvasRenderingContext2D,
  helmetImg: HTMLImageElement,
  helmetId: string,
  headX: number,
  headY: number,
  scale: number,
): void {
  const def = getEquipmentDefinition(helmetId);
  const shape = def?.visualStyle.shape;

  // Positionnement calibré pour chaque type de couvre-chef sans altérer ni couvrir le museau/fourrure
  if (shape === 'bandana') {
    drawPieceWithOptionalLocalGlow(
      ctx,
      helmetImg,
      headX + 2 * scale,
      headY + 24 * scale,
      148 * scale,
      54 * scale,
      helmetId,
      { rotation: -0.05 },
    );
  } else if (shape === 'mage_hat') {
    drawPieceWithOptionalLocalGlow(
      ctx,
      helmetImg,
      headX + 2 * scale,
      headY - 40 * scale,
      176 * scale,
      148 * scale,
      helmetId,
      { rotation: -0.06 },
    );
  } else if (shape === 'dragon_crown') {
    drawPieceWithOptionalLocalGlow(
      ctx,
      helmetImg,
      headX + 4 * scale,
      headY - 22 * scale,
      148 * scale,
      130 * scale,
      helmetId,
    );
  } else {
    // knight_helm ou casque standard posé proprement sur le sommet du crâne
    drawPieceWithOptionalLocalGlow(
      ctx,
      helmetImg,
      headX + 4 * scale,
      headY - 18 * scale,
      146 * scale,
      126 * scale,
      helmetId,
    );
  }
}

/**
 * Assemble le héros 2.5D en couches strictement indépendantes (512×512).
 * `includeCapeLayer`: false en jeu 3D (la cape est un maillage 2D physique dédié),
 *                     true pour l'aperçu 2D corps entier dans l'inventaire.
 * `subFrameIndex`: indice de frame pour les planches multi-frames 30 FPS (0 par défaut).
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

  // 1. Cape derrière le personnage (uniquement en aperçu 2D ; en 3D c'est CapeClothMesh)
  if (includeCapeLayer && equipped.cape) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.cape, animState, subFrameIndex, size)) {
      const capeImg = getEquipImage(images, equipped.cape);
      if (capeImg) {
        drawPieceWithOptionalLocalGlow(
          ctx,
          capeImg,
          a.capeX,
          a.capeY + a.capeH * 0.4,
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
  }

  // 3. Bottes (pieds/pattes uniquement)
  if (equipped.boots) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.boots, animState, subFrameIndex, size)) {
      const bootsImg = getEquipImage(images, equipped.boots);
      if (bootsImg) {
        drawPieceWithOptionalLocalGlow(
          ctx,
          bootsImg,
          a.leftFootX,
          a.leftFootY,
          a.bootSize,
          a.bootSize,
          equipped.boots,
          { flipX: true },
        );
        drawPieceWithOptionalLocalGlow(
          ctx,
          bootsImg,
          a.rightFootX,
          a.rightFootY,
          a.bootSize,
          a.bootSize,
          equipped.boots,
        );
      }
    }
  }

  // 4. Armure (torse uniquement — ne modifie jamais la tête, les oreilles ni la fourrure)
  if (equipped.armor) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.armor, animState, subFrameIndex, size)) {
      const armorImg = getEquipImage(images, equipped.armor);
      if (armorImg) {
        const def = getEquipmentDefinition(equipped.armor);
        const isRobe = def?.visualStyle.shape === 'star_robe';
        drawPieceWithOptionalLocalGlow(
          ctx,
          armorImg,
          a.torsoX,
          isRobe ? a.torsoY + 8 : a.torsoY,
          isRobe ? a.torsoW * 1.12 : a.torsoW,
          isRobe ? a.torsoH * 1.18 : a.torsoH,
          equipped.armor,
        );
      }
    }
  }

  // 5. Accessoire / Babiole (poitrine / ceinture uniquement)
  if (equipped.trinket) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.trinket, animState, subFrameIndex, size)) {
      const trinketImg = getEquipImage(images, equipped.trinket);
      if (trinketImg) {
        drawPieceWithOptionalLocalGlow(
          ctx,
          trinketImg,
          a.trinketX,
          a.trinketY,
          36,
          36,
          equipped.trinket,
        );
      }
    }
  }

  // 6. Gants (mains/poignets uniquement)
  if (equipped.gloves) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.gloves, animState, subFrameIndex, size)) {
      const glovesImg = getEquipImage(images, equipped.gloves);
      if (glovesImg) {
        drawPieceWithOptionalLocalGlow(
          ctx,
          glovesImg,
          a.leftHandX,
          a.leftHandY,
          a.gloveSize,
          a.gloveSize,
          equipped.gloves,
          { flipX: true },
        );
        drawPieceWithOptionalLocalGlow(
          ctx,
          glovesImg,
          a.rightHandX,
          a.rightHandY,
          a.gloveSize,
          a.gloveSize,
          equipped.gloves,
        );
      }
    }
  }

  // 7. Casque / Coiffe (tête uniquement)
  if (equipped.helmet) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.helmet, animState, subFrameIndex, size)) {
      const helmImg = getEquipImage(images, equipped.helmet);
      if (helmImg) {
        drawHelmetPiece(ctx, helmImg, equipped.helmet, a.headX, a.headY, a.headScale);
      }
    }
  }

  // 8. Bouclier (main gauche uniquement)
  if (equipped.shield) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.shield, animState, subFrameIndex, size)) {
      const shieldImg = getEquipImage(images, equipped.shield);
      if (shieldImg) {
        drawPieceWithOptionalLocalGlow(
          ctx,
          shieldImg,
          a.offhandX,
          a.offhandY,
          104 * a.offhandScale,
          104 * a.offhandScale,
          equipped.shield,
          { rotation: -0.1 },
        );
      }
    }
  }

  // 9. Arme principale (main droite uniquement, pivotée pendant l'attaque)
  if (equipped.weapon) {
    if (!tryDrawEquipmentSynchronizedSheet(ctx, images, equipped.weapon, animState, subFrameIndex, size)) {
      const weapImg = getEquipImage(images, equipped.weapon);
      if (weapImg) {
        const def = getEquipmentDefinition(equipped.weapon);
        const isLong =
          def?.visualStyle.shape === 'arcane_staff' ||
          def?.visualStyle.shape === 'dragon_blade';
        const sz = (isLong ? 168 : 148) * a.weaponScale;
        drawPieceWithOptionalLocalGlow(
          ctx,
          weapImg,
          a.weaponX,
          a.weaponY,
          sz,
          sz,
          equipped.weapon,
          { rotation: a.weaponRot },
        );
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
