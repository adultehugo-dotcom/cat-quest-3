import type {
  ArmorShape,
  EquipSlot,
  EquipmentVisualStyle,
  HelmetShape,
  WeaponShape,
} from '../game/types';
import { STARTING_EQUIPMENT } from '../game/types';
import { getEquipmentDefinition } from '../data/equipmentData';
import {
  CREAM_HIGHLIGHT,
  GOLD_LIGHT,
  GOLD_MID,
  HERO_FUR,
  INK_COLOR,
  createCanvas,
  drawInkEllipse,
  drawRoundedRect,
  drawStar,
} from './palette';

export type HeroAnimFrame = 'idle' | 'walk1' | 'walk2' | 'attack' | 'roll';

const portraitCache = new Map<string, string>();

export function getHeroEquipmentKey(equipped: Record<EquipSlot, string>): string {
  const w = equipped.weapon || STARTING_EQUIPMENT.weapon;
  const sw = equipped.secondary_weapon || 'none';
  const sh = equipped.shield || 'none';
  const h = equipped.helmet || STARTING_EQUIPMENT.helmet;
  const a = equipped.armor || STARTING_EQUIPMENT.armor;
  const tr = equipped.trinket || 'none';
  return `${w}_${sw}_${sh}_${h}_${a}_${tr}`;
}

export function getHeroTextureKey(
  equipped: Record<EquipSlot, string>,
  frame: HeroAnimFrame,
): string {
  return `${getHeroEquipmentKey(equipped)}_${frame}`;
}

function resolveStyle(id: string, fallbackId: string): EquipmentVisualStyle {
  const def = getEquipmentDefinition(id) ?? getEquipmentDefinition(fallbackId);
  if (!def) {
    return {
      shape: 'tunic',
      primaryColor: '#4e9e48',
      secondaryColor: '#336e30',
      accentColor: '#9c6234',
    };
  }
  return def.visualStyle;
}

// ============================================================================
// Dessin modulaire par couches du Chat Chevalier (256 × 256)
// ============================================================================

function drawCapeBack(
  ctx: CanvasRenderingContext2D,
  armorStyle: EquipmentVisualStyle,
  frame: HeroAnimFrame,
  bodyX: number,
  bodyY: number,
): void {
  if (!armorStyle.hasCape) return;
  const capeColor = armorStyle.capeColor ?? '#b82534';
  const flutter =
    frame === 'attack' ? -14 : frame === 'walk1' ? -8 : frame === 'walk2' ? 4 : 0;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bodyX - 24, bodyY - 22);
  ctx.quadraticCurveTo(bodyX - 66 + flutter, bodyY + 12, bodyX - 68 + flutter, bodyY + 62);
  ctx.quadraticCurveTo(bodyX - 32 + flutter * 0.5, bodyY + 74, bodyX + 6, bodyY + 56);
  ctx.lineTo(bodyX + 18, bodyY - 18);
  ctx.closePath();

  const grad = ctx.createLinearGradient(bodyX - 68, bodyY - 18, bodyX + 12, bodyY + 68);
  grad.addColorStop(0, capeColor);
  grad.addColorStop(1, '#6b101d');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Galon doré au bas de la cape royale
  ctx.beginPath();
  ctx.moveTo(bodyX - 64 + flutter, bodyY + 55);
  ctx.quadraticCurveTo(bodyX - 30 + flutter * 0.5, bodyY + 66, bodyX + 4, bodyY + 49);
  ctx.strokeStyle = GOLD_MID;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.restore();
}

function drawTail(
  ctx: CanvasRenderingContext2D,
  frame: HeroAnimFrame,
  bodyX: number,
  bodyY: number,
): void {
  const sway =
    frame === 'walk1' ? -12 : frame === 'walk2' ? 10 : frame === 'attack' ? -18 : 0;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bodyX - 24, bodyY + 26);
  ctx.bezierCurveTo(
    bodyX - 66,
    bodyY + 22 + sway * 0.4,
    bodyX - 78,
    bodyY - 16 + sway,
    bodyX - 54,
    bodyY - 26 + sway,
  );
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 22;
  ctx.stroke();

  ctx.strokeStyle = HERO_FUR.base;
  ctx.lineWidth = 14;
  ctx.stroke();

  // Rayures sur la queue
  ctx.strokeStyle = HERO_FUR.stripe;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(bodyX - 50, bodyY + 14 + sway * 0.2);
  ctx.lineTo(bodyX - 42, bodyY + 6 + sway * 0.2);
  ctx.moveTo(bodyX - 64, bodyY - 2 + sway * 0.6);
  ctx.lineTo(bodyX - 54, bodyY - 6 + sway * 0.6);
  ctx.stroke();

  // Bout crème de la queue
  drawInkEllipse(ctx, bodyX - 53, bodyY - 26 + sway, 8, 7, HERO_FUR.cream, 3.5);
  ctx.restore();
}

function drawLegs(
  ctx: CanvasRenderingContext2D,
  armorStyle: EquipmentVisualStyle,
  frame: HeroAnimFrame,
  bodyX: number,
  baseY: number,
): void {
  const leftOffset =
    frame === 'walk1' ? { dx: -14, dy: -6 } :
    frame === 'walk2' ? { dx: 10, dy: 0 } :
    frame === 'attack' ? { dx: -16, dy: 0 } :
    { dx: -4, dy: 0 };

  const rightOffset =
    frame === 'walk1' ? { dx: 12, dy: 0 } :
    frame === 'walk2' ? { dx: -12, dy: -6 } :
    frame === 'attack' ? { dx: 18, dy: 0 } :
    { dx: 4, dy: 0 };

  const shape = armorStyle.shape as ArmorShape;
  const bootColor =
    shape === 'dragon_plate'
      ? '#7d204f'
      : shape === 'mail'
        ? '#8f9eb3'
        : shape === 'star_robe'
          ? '#263278'
          : '#7d4d27';
  const cuffColor =
    shape === 'dragon_plate' || shape === 'star_robe' ? GOLD_MID : armorStyle.accentColor;

  const drawSinglePaw = (cx: number, cy: number): void => {
    // Jambe fourrure
    drawRoundedRect(ctx, cx - 10, cy - 26, 20, 18, 8);
    ctx.fillStyle = HERO_FUR.base;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Botte / patte chaussée
    drawInkEllipse(ctx, cx + 2, cy - 6, 14, 10, bootColor, 4);
    // Revers de botte
    drawRoundedRect(ctx, cx - 11, cy - 16, 22, 6, 3);
    ctx.fillStyle = cuffColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
  };

  drawSinglePaw(bodyX - 16 + leftOffset.dx, baseY + leftOffset.dy);
  drawSinglePaw(bodyX + 16 + rightOffset.dx, baseY + rightOffset.dy);
}

function drawArmorTorso(
  ctx: CanvasRenderingContext2D,
  armorStyle: EquipmentVisualStyle,
  bodyX: number,
  bodyY: number,
): void {
  const shape = armorStyle.shape as ArmorShape;
  ctx.save();

  // Silhouette trapézoïdale mignonne du torse
  ctx.beginPath();
  ctx.moveTo(bodyX - 28, bodyY - 24);
  ctx.lineTo(bodyX + 28, bodyY - 24);
  ctx.quadraticCurveTo(bodyX + 38, bodyY + 12, bodyX + 33, bodyY + 42);
  ctx.quadraticCurveTo(bodyX, bodyY + 50, bodyX - 33, bodyY + 42);
  ctx.quadraticCurveTo(bodyX - 38, bodyY + 12, bodyX - 28, bodyY - 24);
  ctx.closePath();

  const grad = ctx.createLinearGradient(bodyX - 32, bodyY - 24, bodyX + 32, bodyY + 46);
  grad.addColorStop(0, armorStyle.primaryColor);
  grad.addColorStop(1, armorStyle.secondaryColor);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  if (shape === 'tunic') {
    // Col V crème + bandoulière cuir + ceinture avec boucle dorée
    ctx.beginPath();
    ctx.moveTo(bodyX - 11, bodyY - 23);
    ctx.lineTo(bodyX, bodyY - 7);
    ctx.lineTo(bodyX + 11, bodyY - 23);
    ctx.closePath();
    ctx.fillStyle = HERO_FUR.cream;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Sangle diagonale
    ctx.beginPath();
    ctx.moveTo(bodyX - 24, bodyY - 18);
    ctx.lineTo(bodyX + 24, bodyY + 24);
    ctx.strokeStyle = armorStyle.accentColor;
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Ceinture cuir
    drawRoundedRect(ctx, bodyX - 33, bodyY + 15, 66, 12, 4);
    ctx.fillStyle = armorStyle.accentColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Boucle dorée
    drawRoundedRect(ctx, bodyX - 8, bodyY + 13, 16, 16, 3);
    ctx.fillStyle = GOLD_MID;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (shape === 'mail') {
    // Motif mailles argentées subtiles
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 2;
    for (let row = 0; row < 4; row++) {
      const yy = bodyY - 10 + row * 11;
      for (let col = -2; col <= 2; col++) {
        ctx.beginPath();
        ctx.arc(bodyX + col * 11 + (row % 2) * 5, yy, 5, 0, Math.PI);
        ctx.stroke();
      }
    }

    // Tabard bleu royal central
    drawRoundedRect(ctx, bodyX - 15, bodyY - 20, 30, 62, 6);
    ctx.fillStyle = armorStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Emblème patte dorée sur le tabard
    drawInkEllipse(ctx, bodyX, bodyY + 12, 7, 6, GOLD_MID, 2);
    drawInkEllipse(ctx, bodyX - 7, bodyY + 3, 3.2, 3.2, GOLD_MID, 1.5);
    drawInkEllipse(ctx, bodyX, bodyY + 1, 3.2, 3.2, GOLD_MID, 1.5);
    drawInkEllipse(ctx, bodyX + 7, bodyY + 3, 3.2, 3.2, GOLD_MID, 1.5);

    // Épaulières d'acier avec rivets
    drawInkEllipse(ctx, bodyX - 30, bodyY - 14, 15, 11, '#dce6f2', 3.8, -0.35);
    drawInkEllipse(ctx, bodyX + 30, bodyY - 14, 15, 11, '#dce6f2', 3.8, 0.35);
    drawInkEllipse(ctx, bodyX - 30, bodyY - 14, 3, 3, GOLD_MID, 1.5);
    drawInkEllipse(ctx, bodyX + 30, bodyY - 14, 3, 3, GOLD_MID, 1.5);
  } else if (shape === 'star_robe') {
    // Robe légèrement évasée à broderie or + étoiles
    ctx.beginPath();
    ctx.moveTo(bodyX - 10, bodyY - 22);
    ctx.lineTo(bodyX + 10, bodyY - 22);
    ctx.lineTo(bodyX + 16, bodyY + 44);
    ctx.lineTo(bodyX - 16, bodyY + 44);
    ctx.closePath();
    ctx.fillStyle = '#1b2259';
    ctx.fill();
    ctx.strokeStyle = GOLD_MID;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Écharpe stellaire & gemme cyan lumineuse
    drawRoundedRect(ctx, bodyX - 32, bodyY + 14, 64, 11, 5);
    ctx.fillStyle = GOLD_MID;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Gemme magique
    drawStar(ctx, bodyX, bodyY + 19, 4, 9, 4);
    ctx.fillStyle = '#6cf2ff';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Petites étoiles dorées brodées
    ctx.fillStyle = GOLD_LIGHT;
    drawStar(ctx, bodyX - 21, bodyY + 33, 5, 5, 2.2);
    ctx.fill();
    drawStar(ctx, bodyX + 21, bodyY + 33, 5, 5, 2.2);
    ctx.fill();
    drawStar(ctx, bodyX - 20, bodyY - 2, 5, 4.5, 2);
    ctx.fill();
    drawStar(ctx, bodyX + 20, bodyY - 2, 5, 4.5, 2);
    ctx.fill();
  } else if (shape === 'dragon_plate') {
    // Plastron sculpté pourpre & plaques d'écailles d'or
    ctx.beginPath();
    ctx.moveTo(bodyX - 24, bodyY - 14);
    ctx.lineTo(bodyX, bodyY + 4);
    ctx.lineTo(bodyX + 24, bodyY - 14);
    ctx.lineTo(bodyX + 22, bodyY + 26);
    ctx.lineTo(bodyX, bodyY + 42);
    ctx.lineTo(bodyX - 22, bodyY + 26);
    ctx.closePath();
    const goldGrad = ctx.createLinearGradient(bodyX - 22, bodyY - 14, bodyX + 22, bodyY + 42);
    goldGrad.addColorStop(0, GOLD_LIGHT);
    goldGrad.addColorStop(0.5, GOLD_MID);
    goldGrad.addColorStop(1, '#b57816');
    ctx.fillStyle = goldGrad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Écailles gravées
    ctx.strokeStyle = '#7d204f';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(bodyX, bodyY + 8 + i * 10, 12 - i * 2, 0.2, Math.PI - 0.2);
      ctx.stroke();
    }

    // Rubis draconique incandescent sur le torse
    ctx.beginPath();
    ctx.moveTo(bodyX, bodyY - 12);
    ctx.lineTo(bodyX + 9, bodyY - 1);
    ctx.lineTo(bodyX, bodyY + 10);
    ctx.lineTo(bodyX - 9, bodyY - 1);
    ctx.closePath();
    ctx.fillStyle = '#ff4444';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Reflet rubis
    ctx.fillStyle = '#ffd1d1';
    ctx.fillRect(bodyX - 2, bodyY - 7, 3, 5);

    // Épaulières dorées pointues draconiques
    const drawDragonPauldron = (dir: -1 | 1): void => {
      ctx.beginPath();
      ctx.moveTo(bodyX + dir * 20, bodyY - 22);
      ctx.quadraticCurveTo(bodyX + dir * 44, bodyY - 28, bodyX + dir * 45, bodyY - 8);
      ctx.quadraticCurveTo(bodyX + dir * 32, bodyY + 2, bodyX + dir * 18, bodyY - 6);
      ctx.closePath();
      ctx.fillStyle = GOLD_MID;
      ctx.fill();
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = 3.5;
      ctx.stroke();
    };
    drawDragonPauldron(-1);
    drawDragonPauldron(1);
  }

  ctx.restore();
}

function drawCatEars(
  ctx: CanvasRenderingContext2D,
  headX: number,
  headY: number,
): void {
  const drawOneEar = (dir: -1 | 1): void => {
    const baseX = headX + dir * 22;
    const tipX = headX + dir * 39;
    const tipY = headY - 54;

    ctx.beginPath();
    ctx.moveTo(baseX - dir * 13, headY - 24);
    ctx.quadraticCurveTo(tipX - dir * 2, tipY - 4, tipX, tipY);
    ctx.quadraticCurveTo(baseX + dir * 20, headY - 32, baseX + dir * 16, headY - 10);
    ctx.closePath();
    ctx.fillStyle = HERO_FUR.base;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.5;
    ctx.stroke();

    // Intérieur rose de l'oreille
    ctx.beginPath();
    ctx.moveTo(baseX - dir * 5, headY - 23);
    ctx.lineTo(tipX - dir * 4, tipY + 11);
    ctx.lineTo(baseX + dir * 10, headY - 16);
    ctx.closePath();
    ctx.fillStyle = HERO_FUR.earInner;
    ctx.fill();
  };

  drawOneEar(-1);
  drawOneEar(1);
}

function drawCatHead(
  ctx: CanvasRenderingContext2D,
  frame: HeroAnimFrame,
  headX: number,
  headY: number,
): void {
  ctx.save();

  // Tête ronde douce
  const headGrad = ctx.createRadialGradient(
    headX - 8,
    headY - 12,
    8,
    headX,
    headY,
    46,
  );
  headGrad.addColorStop(0, HERO_FUR.light);
  headGrad.addColorStop(0.75, HERO_FUR.base);
  headGrad.addColorStop(1, HERO_FUR.shadow);
  drawInkEllipse(ctx, headX, headY, 44, 37, headGrad, 4.8);

  // Touffes de joues duveteuses
  ctx.fillStyle = HERO_FUR.base;
  ctx.beginPath();
  ctx.moveTo(headX - 42, headY + 4);
  ctx.lineTo(headX - 50, headY + 9);
  ctx.lineTo(headX - 40, headY + 15);
  ctx.moveTo(headX + 42, headY + 4);
  ctx.lineTo(headX + 50, headY + 9);
  ctx.lineTo(headX + 40, headY + 15);
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Rayures tabby sur le front
  ctx.fillStyle = HERO_FUR.stripe;
  for (const offset of [-10, 0, 10]) {
    ctx.beginPath();
    ctx.ellipse(headX + offset, headY - 26, 3.2, offset === 0 ? 9 : 7, offset * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }

  // Museau crème
  ctx.beginPath();
  ctx.ellipse(headX + 2, headY + 16, 22, 14, 0, 0, Math.PI * 2);
  ctx.fillStyle = HERO_FUR.cream;
  ctx.fill();

  // Joues rosées
  ctx.fillStyle = HERO_FUR.cheek;
  ctx.beginPath();
  ctx.ellipse(headX - 23, headY + 12, 7.5, 4.5, 0, 0, Math.PI * 2);
  ctx.ellipse(headX + 27, headY + 12, 7.5, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Grands yeux expressifs (orientés légèrement vers la droite)
  const drawEye = (ex: number, ey: number): void => {
    // Blanc / iris doré
    drawInkEllipse(ctx, ex, ey, 8.5, 10, '#2b1e16', 2.5);
    ctx.beginPath();
    ctx.ellipse(ex, ey + 2.5, 5.8, 5.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = HERO_FUR.eyeIris;
    ctx.fill();
    // Pupille
    ctx.beginPath();
    ctx.ellipse(ex + 1, ey, 4.5, 6.2, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#1a110c';
    ctx.fill();
    // Double reflet blanc lumineux
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex - 2.2, ey - 3.5, 3, 0, Math.PI * 2);
    ctx.arc(ex + 2.6, ey + 2.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
  };

  drawEye(headX - 13, headY + 1);
  drawEye(headX + 18, headY + 1);

  // Sourcils déterminés pendant l'attaque
  if (frame === 'attack') {
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(headX - 22, headY - 12);
    ctx.lineTo(headX - 5, headY - 7);
    ctx.moveTo(headX + 27, headY - 12);
    ctx.lineTo(headX + 10, headY - 7);
    ctx.stroke();
  }

  // Petit nez triangle rose
  ctx.beginPath();
  ctx.moveTo(headX - 1, headY + 10);
  ctx.lineTo(headX + 7, headY + 10);
  ctx.lineTo(headX + 3, headY + 15);
  ctx.closePath();
  ctx.fillStyle = HERO_FUR.nose;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Bouche :3 (ou cri héroïque en attaque)
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2.6;
  if (frame === 'attack') {
    ctx.beginPath();
    ctx.arc(headX + 3, headY + 18, 5.5, 0, Math.PI);
    ctx.fillStyle = '#a83244';
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(headX + 3, headY + 15);
    ctx.quadraticCurveTo(headX - 1, headY + 21, headX - 6, headY + 18);
    ctx.moveTo(headX + 3, headY + 15);
    ctx.quadraticCurveTo(headX + 7, headY + 21, headX + 12, headY + 18);
    ctx.stroke();
  }

  // Moustaches nettes (3 de chaque côté)
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(headX - 28, headY + 10);
  ctx.lineTo(headX - 49, headY + 6);
  ctx.moveTo(headX - 29, headY + 15);
  ctx.lineTo(headX - 50, headY + 15);
  ctx.moveTo(headX - 27, headY + 20);
  ctx.lineTo(headX - 46, headY + 24);

  ctx.moveTo(headX + 33, headY + 10);
  ctx.lineTo(headX + 54, headY + 6);
  ctx.moveTo(headX + 34, headY + 15);
  ctx.lineTo(headX + 55, headY + 15);
  ctx.moveTo(headX + 32, headY + 20);
  ctx.lineTo(headX + 51, headY + 24);
  ctx.stroke();

  ctx.restore();
}

function drawHelmet(
  ctx: CanvasRenderingContext2D,
  helmetStyle: EquipmentVisualStyle,
  frame: HeroAnimFrame,
  headX: number,
  headY: number,
): void {
  const shape = helmetStyle.shape as HelmetShape;
  const flutter = frame === 'walk1' || frame === 'attack' ? -6 : 3;
  ctx.save();

  if (shape === 'bandana') {
    // Rubans flottants à l'arrière gauche
    ctx.beginPath();
    ctx.moveTo(headX - 38, headY - 14);
    ctx.quadraticCurveTo(headX - 64, headY - 22 + flutter, headX - 72, headY - 8 + flutter);
    ctx.lineTo(headX - 56, headY - 6 + flutter * 0.5);
    ctx.lineTo(headX - 68, headY + 8 + flutter);
    ctx.quadraticCurveTo(headX - 50, headY + 4, headX - 36, headY - 4);
    ctx.closePath();
    ctx.fillStyle = helmetStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Bandeau rouge noué juste sous les oreilles
    ctx.beginPath();
    ctx.moveTo(headX - 42, headY - 14);
    ctx.quadraticCurveTo(headX, headY - 26, headX + 42, headY - 14);
    ctx.lineTo(headX + 41, headY - 4);
    ctx.quadraticCurveTo(headX, headY - 15, headX - 41, headY - 4);
    ctx.closePath();
    ctx.fillStyle = helmetStyle.primaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Emblème doré frontal
    drawInkEllipse(ctx, headX + 3, headY - 14, 7.5, 5.5, helmetStyle.accentColor, 2.8);
  } else if (shape === 'knight_helm') {
    // Plumet bleu royal sur le sommet du heaume
    ctx.beginPath();
    ctx.moveTo(headX - 4, headY - 36);
    ctx.quadraticCurveTo(headX - 24, headY - 70, headX - 44, headY - 52 + flutter);
    ctx.quadraticCurveTo(headX - 18, headY - 46, headX + 8, headY - 35);
    ctx.closePath();
    ctx.fillStyle = helmetStyle.accentColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.8;
    ctx.stroke();

    // Calotte métallique avec encoches arrondies laissant sortir les oreilles !
    ctx.beginPath();
    ctx.moveTo(headX - 45, headY - 6);
    ctx.quadraticCurveTo(headX - 45, headY - 30, headX - 34, headY - 34);
    // Encoche oreille gauche
    ctx.quadraticCurveTo(headX - 24, headY - 22, headX - 12, headY - 36);
    // Sommet du dôme
    ctx.quadraticCurveTo(headX, headY - 44, headX + 12, headY - 36);
    // Encoche oreille droite
    ctx.quadraticCurveTo(headX + 24, headY - 22, headX + 34, headY - 34);
    ctx.quadraticCurveTo(headX + 45, headY - 30, headX + 45, headY - 6);
    // Bord inférieur de la visière relevée
    ctx.quadraticCurveTo(headX + 3, headY - 19, headX - 45, headY - 6);
    ctx.closePath();

    const steelGrad = ctx.createLinearGradient(headX - 44, headY - 42, headX + 44, headY - 6);
    steelGrad.addColorStop(0, '#eef5fc');
    steelGrad.addColorStop(0.55, helmetStyle.primaryColor);
    steelGrad.addColorStop(1, helmetStyle.secondaryColor);
    ctx.fillStyle = steelGrad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // Protège-oreilles blindés dorés épousant les oreilles
    ctx.strokeStyle = '#9fb1c7';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(headX - 26, headY - 26);
    ctx.lineTo(headX - 38, headY - 50);
    ctx.moveTo(headX + 26, headY - 26);
    ctx.lineTo(headX + 38, headY - 50);
    ctx.stroke();

    // Bandeau nasal central & rivets brillants
    drawRoundedRect(ctx, headX - 3, headY - 38, 9, 25, 4);
    ctx.fillStyle = helmetStyle.accentColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // Reflet métallique
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(headX - 24, headY - 24);
    ctx.quadraticCurveTo(headX - 10, headY - 32, headX - 4, headY - 31);
    ctx.stroke();
  } else if (shape === 'mage_hat') {
    // Large bord incurvé du chapeau d'Archimiaou (avec entailles pour les oreilles)
    ctx.beginPath();
    ctx.ellipse(headX, headY - 21, 56, 15, -0.05, 0, Math.PI * 2);
    ctx.fillStyle = helmetStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // Cône pointu recourbé
    ctx.beginPath();
    ctx.moveTo(headX - 34, headY - 23);
    ctx.quadraticCurveTo(headX - 28, headY - 72, headX - 50 + flutter, headY - 88);
    ctx.quadraticCurveTo(headX + 2, headY - 86, headX + 33, headY - 23);
    ctx.closePath();
    const hatGrad = ctx.createLinearGradient(headX - 42, headY - 88, headX + 30, headY - 20);
    hatGrad.addColorStop(0, '#5047bd');
    hatGrad.addColorStop(0.6, helmetStyle.primaryColor);
    hatGrad.addColorStop(1, helmetStyle.secondaryColor);
    ctx.fillStyle = hatGrad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // Ruban lumineux cyan à la base du cône
    ctx.beginPath();
    ctx.moveTo(headX - 34, headY - 24);
    ctx.quadraticCurveTo(headX, headY - 15, headX + 34, headY - 24);
    ctx.strokeStyle = helmetStyle.accentColor;
    ctx.lineWidth = 7;
    ctx.stroke();

    // Étoiles dorées + étoile pendante à la pointe
    ctx.fillStyle = GOLD_LIGHT;
    drawStar(ctx, headX - 8, headY - 48, 5, 7, 3);
    ctx.fill();
    drawStar(ctx, headX + 12, headY - 38, 5, 5, 2.2);
    ctx.fill();
    drawStar(ctx, headX - 50 + flutter, headY - 82, 4, 8, 3.5);
    ctx.fillStyle = '#7be8ff';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Pointes des oreilles qui dépassent fièrement à travers le bord !
    for (const dir of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(headX + dir * 27, headY - 26);
      ctx.lineTo(headX + dir * 40, headY - 52);
      ctx.lineTo(headX + dir * 41, headY - 22);
      ctx.closePath();
      ctx.fillStyle = HERO_FUR.base;
      ctx.fill();
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = 3.5;
      ctx.stroke();
    }
  } else if (shape === 'dragon_crown') {
    // Petites cornes draconiques dorées recourbées vers l'arrière/haut
    const drawHorn = (dir: -1 | 1): void => {
      ctx.beginPath();
      ctx.moveTo(headX + dir * 16, headY - 30);
      ctx.quadraticCurveTo(headX + dir * 48, headY - 52, headX + dir * 56, headY - 76);
      ctx.quadraticCurveTo(headX + dir * 32, headY - 62, headX + dir * 24, headY - 26);
      ctx.closePath();
      const hornGrad = ctx.createLinearGradient(
        headX + dir * 16,
        headY - 28,
        headX + dir * 56,
        headY - 76,
      );
      hornGrad.addColorStop(0, GOLD_MID);
      hornGrad.addColorStop(1, '#fff2ad');
      ctx.fillStyle = hornGrad;
      ctx.fill();
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = 3.8;
      ctx.stroke();
    };
    drawHorn(-1);
    drawHorn(1);

    // Diadème royal dentelé doré posé sur le front entre les oreilles
    ctx.beginPath();
    ctx.moveTo(headX - 36, headY - 16);
    ctx.lineTo(headX - 28, headY - 36);
    ctx.lineTo(headX - 13, headY - 27);
    ctx.lineTo(headX, headY - 48);
    ctx.lineTo(headX + 13, headY - 27);
    ctx.lineTo(headX + 28, headY - 36);
    ctx.lineTo(headX + 36, headY - 16);
    ctx.quadraticCurveTo(headX, headY - 22, headX - 36, headY - 16);
    ctx.closePath();
    const crownGrad = ctx.createLinearGradient(headX, headY - 48, headX, headY - 14);
    crownGrad.addColorStop(0, GOLD_LIGHT);
    crownGrad.addColorStop(1, helmetStyle.secondaryColor);
    ctx.fillStyle = crownGrad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.8;
    ctx.stroke();

    // Rubis royal central
    ctx.beginPath();
    ctx.moveTo(headX, headY - 37);
    ctx.lineTo(headX + 7, headY - 27);
    ctx.lineTo(headX, headY - 18);
    ctx.lineTo(headX - 7, headY - 27);
    ctx.closePath();
    ctx.fillStyle = helmetStyle.accentColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }

  ctx.restore();
}

function drawWeaponAndPaws(
  ctx: CanvasRenderingContext2D,
  weaponStyle: EquipmentVisualStyle,
  frame: HeroAnimFrame,
  bodyX: number,
  bodyY: number,
  includeSoftGlow = true,
): void {
  const shape = weaponStyle.shape as WeaponShape;

  // Patte gauche libre (équilibre)
  drawInkEllipse(ctx, bodyX - 32, bodyY + 12, 11, 9, HERO_FUR.cream, 3.8);

  // Position et angle de l'arme selon la frame
  const handX = frame === 'attack' ? bodyX + 42 : bodyX + 34;
  const handY =
    frame === 'attack'
      ? bodyY + 12
      : frame === 'walk1'
        ? bodyY + 6
        : frame === 'walk2'
          ? bodyY + 12
          : bodyY + 9;
  const weaponAngle =
    frame === 'attack'
      ? 0.95 // grand coup vers l'avant !
      : frame === 'walk1'
        ? -0.35
        : frame === 'walk2'
          ? -0.18
          : -0.28;

  // Traînée de slash visuelle sur la frame d'attaque (uniquement pour aperçus 2D)
  if (includeSoftGlow && frame === 'attack') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(bodyX + 18, bodyY - 4, 78, -1.15, 0.72);
    ctx.strokeStyle =
      shape === 'dragon_blade'
        ? 'rgba(255, 110, 40, 0.78)'
        : shape === 'arcane_staff'
          ? 'rgba(102, 240, 255, 0.78)'
          : 'rgba(255, 247, 214, 0.85)';
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(handX, handY);
  ctx.rotate(weaponAngle);

  if (shape === 'wood_sword') {
    // Poignée + pommeau
    drawRoundedRect(ctx, -5, 4, 10, 22, 4);
    ctx.fillStyle = weaponStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Garde bois
    drawRoundedRect(ctx, -18, -4, 36, 10, 4);
    ctx.fillStyle = weaponStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Lame en bois de griffoir
    ctx.beginPath();
    ctx.moveTo(-9, -4);
    ctx.lineTo(-8, -68);
    ctx.lineTo(0, -82);
    ctx.lineTo(8, -68);
    ctx.lineTo(9, -4);
    ctx.closePath();
    const grad = ctx.createLinearGradient(-9, -40, 9, -40);
    grad.addColorStop(0, weaponStyle.accentColor);
    grad.addColorStop(0.6, weaponStyle.primaryColor);
    grad.addColorStop(1, weaponStyle.secondaryColor);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.8;
    ctx.stroke();

    // Nervures du bois
    ctx.strokeStyle = weaponStyle.secondaryColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2, -16);
    ctx.lineTo(-2, -62);
    ctx.moveTo(3, -24);
    ctx.lineTo(3, -52);
    ctx.stroke();
  } else if (shape === 'steel_saber') {
    // Poignée bleue + pommeau or
    drawRoundedRect(ctx, -5, 4, 10, 22, 4);
    ctx.fillStyle = weaponStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    drawInkEllipse(ctx, 0, 27, 6.5, 6.5, weaponStyle.accentColor, 3);

    // Garde incurvée bleue & or
    ctx.beginPath();
    ctx.moveTo(-20, -2);
    ctx.quadraticCurveTo(0, 8, 20, -2);
    ctx.lineTo(17, -10);
    ctx.quadraticCurveTo(0, -1, -17, -10);
    ctx.closePath();
    ctx.fillStyle = weaponStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Sabre courbe brillant en acier
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.quadraticCurveTo(-13, -50, -3, -90);
    ctx.quadraticCurveTo(14, -76, 11, -36);
    ctx.lineTo(9, -6);
    ctx.closePath();
    const steel = ctx.createLinearGradient(-12, -50, 14, -50);
    steel.addColorStop(0, '#ffffff');
    steel.addColorStop(0.45, weaponStyle.primaryColor);
    steel.addColorStop(1, '#8ea4bd');
    ctx.fillStyle = steel;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.8;
    ctx.stroke();

    // Reflet tranchant blanc
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-4, -18);
    ctx.quadraticCurveTo(-7, -50, -1, -78);
    ctx.stroke();
  } else if (shape === 'arcane_staff') {
    // Hampe violette ouvragée
    drawRoundedRect(ctx, -5.5, -72, 11, 102, 5);
    const staffGrad = ctx.createLinearGradient(-6, 0, 6, 0);
    staffGrad.addColorStop(0, '#8d5ae0');
    staffGrad.addColorStop(1, weaponStyle.secondaryColor);
    ctx.fillStyle = staffGrad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.8;
    ctx.stroke();

    // Halo lumineux autour de l'étoile (2D UI uniquement)
    if (includeSoftGlow) {
      const halo = ctx.createRadialGradient(0, -86, 4, 0, -86, 30);
      halo.addColorStop(0, 'rgba(104, 243, 255, 0.85)');
      halo.addColorStop(1, 'rgba(104, 243, 255, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(0, -86, 30, 0, Math.PI * 2);
      ctx.fill();
    }

    // Croissant doré porte-étoile
    ctx.beginPath();
    ctx.arc(0, -82, 17, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.strokeStyle = GOLD_MID;
    ctx.lineWidth = 6.5;
    ctx.stroke();

    // Grande étoile astrale cyan au sommet
    drawStar(ctx, 0, -88, 4, 20, 8, 0);
    ctx.fillStyle = weaponStyle.accentColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Coeur blanc étincelant
    drawStar(ctx, 0, -88, 4, 9, 3.5, Math.PI / 4);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else if (shape === 'dragon_blade') {
    // Aura de braise ardente autour de la Grande Lame Draconique (2D UI uniquement)
    if (includeSoftGlow) {
      const fireGlow = ctx.createRadialGradient(0, -56, 8, 0, -56, 52);
      fireGlow.addColorStop(0, 'rgba(255, 130, 38, 0.75)');
      fireGlow.addColorStop(0.6, 'rgba(255, 65, 35, 0.32)');
      fireGlow.addColorStop(1, 'rgba(255, 65, 35, 0)');
      ctx.fillStyle = fireGlow;
      ctx.beginPath();
      ctx.ellipse(0, -56, 34, 58, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Flammes dansantes léchant la lame
    ctx.beginPath();
    ctx.moveTo(-14, -18);
    ctx.quadraticCurveTo(-28, -46, -13, -72);
    ctx.quadraticCurveTo(-20, -90, 0, -110);
    ctx.quadraticCurveTo(22, -86, 15, -66);
    ctx.quadraticCurveTo(28, -42, 14, -18);
    ctx.closePath();
    const flameGrad = ctx.createLinearGradient(0, -110, 0, -16);
    flameGrad.addColorStop(0, '#fff280');
    flameGrad.addColorStop(0.45, '#ff8a2b');
    flameGrad.addColorStop(1, 'rgba(220, 38, 38, 0.85)');
    ctx.fillStyle = flameGrad;
    ctx.fill();

    // Poignée & pommeau rubis
    drawRoundedRect(ctx, -6, 6, 12, 24, 4);
    ctx.fillStyle = '#5c1420';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    drawInkEllipse(ctx, 0, 31, 8, 8, weaponStyle.secondaryColor, 3.2);

    // Garde ailée draconique dorée
    ctx.beginPath();
    ctx.moveTo(-26, -12);
    ctx.lineTo(-10, 5);
    ctx.lineTo(10, 5);
    ctx.lineTo(26, -12);
    ctx.lineTo(16, -2);
    ctx.lineTo(0, -10);
    ctx.lineTo(-16, -2);
    ctx.closePath();
    ctx.fillStyle = weaponStyle.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // Grande lame rubis & or
    ctx.beginPath();
    ctx.moveTo(-12, -5);
    ctx.lineTo(-14, -76);
    ctx.lineTo(0, -100);
    ctx.lineTo(14, -76);
    ctx.lineTo(12, -5);
    ctx.closePath();
    const bladeGrad = ctx.createLinearGradient(-14, -50, 14, -50);
    bladeGrad.addColorStop(0, '#ff6a45');
    bladeGrad.addColorStop(0.5, weaponStyle.primaryColor);
    bladeGrad.addColorStop(1, '#7a1120');
    ctx.fillStyle = bladeGrad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Veine de magma doré au centre de la lame
    ctx.strokeStyle = '#ffe570';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(0, -86);
    ctx.stroke();
  }

  ctx.restore();

  // Patte avant droite refermée sur la poignée
  drawInkEllipse(ctx, handX, handY + 2, 11.5, 9.5, HERO_FUR.cream, 3.8);
}

function drawRollFrame(
  ctx: CanvasRenderingContext2D,
  armorStyle: EquipmentVisualStyle,
  helmetStyle: EquipmentVisualStyle,
): void {
  const cx = 128;
  const cy = 180;

  // Traînées de vitesse tournoyantes
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 247, 227, 0.85)';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(cx, cy, 58, 0.3, 2.3);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 224, 102, 0.7)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, 66, 3.2, 5.1);
  ctx.stroke();

  // Boule féline en roulade dynamique
  const ballGrad = ctx.createRadialGradient(cx - 12, cy - 12, 8, cx, cy, 48);
  ballGrad.addColorStop(0, HERO_FUR.light);
  ballGrad.addColorStop(0.65, HERO_FUR.base);
  ballGrad.addColorStop(1, armorStyle.primaryColor);
  drawInkEllipse(ctx, cx, cy, 46, 44, ballGrad, 5);

  // Bande d'armure & casque enroulés
  ctx.beginPath();
  ctx.arc(cx, cy, 34, -0.5, 2.1);
  ctx.strokeStyle = armorStyle.primaryColor;
  ctx.lineWidth = 14;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 24, 2.4, 5.2);
  ctx.strokeStyle = helmetStyle.primaryColor;
  ctx.lineWidth = 10;
  ctx.stroke();

  // Petites oreilles qui dépassent pendant la roulade !
  ctx.beginPath();
  ctx.moveTo(cx + 18, cy - 38);
  ctx.lineTo(cx + 38, cy - 52);
  ctx.lineTo(cx + 36, cy - 26);
  ctx.closePath();
  ctx.fillStyle = HERO_FUR.base;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Queue en panache
  ctx.beginPath();
  ctx.moveTo(cx - 42, cy + 12);
  ctx.quadraticCurveTo(cx - 72, cy - 8, cx - 54, cy - 32);
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 18;
  ctx.stroke();
  ctx.strokeStyle = HERO_FUR.base;
  ctx.lineWidth = 11;
  ctx.stroke();

  // Nuages de poussière sous la roulade
  drawInkEllipse(ctx, cx - 44, cy + 44, 16, 10, CREAM_HIGHLIGHT, 3);
  drawInkEllipse(ctx, cx - 22, cy + 50, 12, 8, CREAM_HIGHLIGHT, 2.5);
  ctx.restore();
}

/**
 * Mappe un identifiant d'armure équipée vers la clé d'asset HD correspondante.
 */
export function getHeroArmorHdKey(
  armorId: string,
): 'hero_tunic' | 'hero_mail' | 'hero_robe' | 'hero_dragon' {
  switch (armorId) {
    case 'armor_mail':
      return 'hero_mail';
    case 'armor_robe':
      return 'hero_robe';
    case 'armor_dragon':
      return 'hero_dragon';
    case 'armor_tunic':
    default:
      return 'hero_tunic';
  }
}

/**
 * Peint une aura / particules subtiles autour de la tête lorsque le casque équipé
 * diffère de l'armure de base, sans jamais superposer un second casque sur l'art HD.
 */
function drawHdHelmetAccent(
  ctx: CanvasRenderingContext2D,
  helmetStyle: EquipmentVisualStyle,
  armorStyle: EquipmentVisualStyle,
  frame: HeroAnimFrame,
  includeSoftGlow = true,
): void {
  const shape = helmetStyle.shape as HelmetShape;
  const armorShape = armorStyle.shape as ArmorShape;
  const flutter = frame === 'walk1' || frame === 'attack' ? -8 : frame === 'walk2' ? 6 : 0;

  // Chaque sprite HD possède déjà son couvre-chef natif (tunic->bandana, mail->knight, robe->mage, dragon->crown)
  const isNativePair =
    (armorShape === 'tunic' && shape === 'bandana') ||
    (armorShape === 'mail' && shape === 'knight_helm') ||
    (armorShape === 'star_robe' && shape === 'mage_hat') ||
    (armorShape === 'dragon_plate' && shape === 'dragon_crown');

  if (isNativePair && shape !== 'dragon_crown' && shape !== 'mage_hat') {
    return;
  }

  ctx.save();
  if (shape === 'mage_hat') {
    // Étoiles astrales cyan-or en orbite douce autour du sommet de la tête
    const stars = [
      { x: 148, y: 92 + flutter * 0.4, r: 9, col: '#7cf4ff' },
      { x: 356, y: 86 - flutter * 0.4, r: 10, col: '#ffe878' },
      { x: 176, y: 52, r: 7, col: '#ffe878' },
    ];
    for (const s of stars) {
      drawStar(ctx, s.x, s.y, 4, s.r, s.r * 0.38);
      ctx.fillStyle = s.col;
      ctx.fill();
    }
  } else if (shape === 'dragon_crown') {
    // Halo royal doré (2D UI uniquement) & étincelles de braise autour de la couronne
    if (includeSoftGlow) {
      const glow = ctx.createRadialGradient(248, 108, 12, 248, 108, 118);
      glow.addColorStop(0, 'rgba(255, 224, 102, 0.28)');
      glow.addColorStop(0.6, 'rgba(255, 118, 36, 0.12)');
      glow.addColorStop(1, 'rgba(255, 118, 36, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(248, 108, 118, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const [ex, ey, er] of [
      [152, 84 + flutter * 0.3, 8],
      [348, 78 - flutter * 0.3, 9],
    ] as const) {
      drawStar(ctx, ex, ey, 4, er, er * 0.38);
      ctx.fillStyle = '#ffe570';
      ctx.fill();
    }
  } else if (shape === 'knight_helm' && !isNativePair) {
    // Éclat chevaleresque bleu-argent discret
    drawStar(ctx, 162, 88 + flutter * 0.3, 4, 8, 3.2);
    ctx.fillStyle = '#96ccff';
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Peint l'enchantement lumineux de l'arme équipée (lueur & particules sur la lame/bâton)
 * ainsi que le grand arc de slash semi-réaliste lors de la frame `attack`,
 * sans jamais dupliquer l'arme peinte dans le sprite HD.
 */
function drawHdWeaponOverlay(
  ctx: CanvasRenderingContext2D,
  weaponStyle: EquipmentVisualStyle,
  armorStyle: EquipmentVisualStyle,
  frame: HeroAnimFrame,
  includeSoftGlow = true,
): void {
  const shape = weaponStyle.shape as WeaponShape;
  const armorShape = armorStyle.shape as ArmorShape;

  // Traînée de slash semi-réaliste lumineuse sur la frame d'attaque (2D UI uniquement ; en 3D EffectsRenderer dessine le slash additif)
  if (includeSoftGlow && frame === 'attack') {
    ctx.save();
    const slashGrad = ctx.createLinearGradient(250, 70, 488, 390);
    if (shape === 'dragon_blade') {
      slashGrad.addColorStop(0, 'rgba(255, 244, 140, 0.96)');
      slashGrad.addColorStop(0.5, 'rgba(255, 108, 32, 0.88)');
      slashGrad.addColorStop(1, 'rgba(210, 28, 38, 0.06)');
    } else if (shape === 'arcane_staff') {
      slashGrad.addColorStop(0, 'rgba(225, 253, 255, 0.96)');
      slashGrad.addColorStop(0.5, 'rgba(92, 232, 255, 0.85)');
      slashGrad.addColorStop(1, 'rgba(128, 72, 230, 0.06)');
    } else if (shape === 'steel_saber') {
      slashGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      slashGrad.addColorStop(0.55, 'rgba(176, 218, 255, 0.78)');
      slashGrad.addColorStop(1, 'rgba(110, 160, 220, 0.05)');
    } else {
      slashGrad.addColorStop(0, 'rgba(255, 248, 214, 0.92)');
      slashGrad.addColorStop(0.55, 'rgba(235, 194, 126, 0.68)');
      slashGrad.addColorStop(1, 'rgba(196, 138, 74, 0.05)');
    }

    ctx.beginPath();
    ctx.arc(285, 265, 175, -1.15, 0.68);
    ctx.strokeStyle = slashGrad;
    ctx.lineWidth = 28;
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(290, 265, 168, -1.02, 0.54);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.78)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.restore();
  }

  if (shape === 'wood_sword') return;

  // Position de l'arme sur le côté droit du sprite HD selon l'armure
  const wx = armorShape === 'dragon_plate' ? 412 : armorShape === 'star_robe' ? 392 : 395;
  const wy = armorShape === 'mail' ? 215 : 155;

  ctx.save();
  if (shape === 'dragon_blade') {
    // Halo de braise & flammèches dorées le long de l'arme
    if (includeSoftGlow) {
      const fireGlow = ctx.createRadialGradient(wx, wy, 10, wx, wy, 110);
      fireGlow.addColorStop(0, 'rgba(255, 190, 68, 0.42)');
      fireGlow.addColorStop(0.55, 'rgba(255, 72, 24, 0.22)');
      fireGlow.addColorStop(1, 'rgba(220, 24, 32, 0)');
      ctx.fillStyle = fireGlow;
      ctx.beginPath();
      ctx.arc(wx, wy, 110, 0, Math.PI * 2);
      ctx.fill();
    }

    // Teinte ardente sur la lame (source-atop respecte l'alpha chirurgical !)
    if (armorShape !== 'dragon_plate') {
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      const bladeTint = ctx.createRadialGradient(wx, wy, 8, wx, wy, 125);
      bladeTint.addColorStop(0, 'rgba(255, 140, 36, 0.52)');
      bladeTint.addColorStop(0.6, 'rgba(230, 38, 38, 0.28)');
      bladeTint.addColorStop(1, 'rgba(230, 38, 38, 0)');
      ctx.fillStyle = bladeTint;
      ctx.fillRect(280, 0, 232, 370);
      ctx.restore();
    }

    for (const [sx, sy, sr] of [
      [wx + 32, wy - 56, 9],
      [wx - 28, wy + 24, 7],
      [wx + 18, wy + 52, 6],
    ] as const) {
      drawStar(ctx, sx, sy, 4, sr, sr * 0.35);
      ctx.fillStyle = '#ffe570';
      ctx.fill();
    }
  } else if (shape === 'arcane_staff') {
    // Halo stellaire cyan-violet autour du sommet de l'arme
    if (includeSoftGlow) {
      const arcGlow = ctx.createRadialGradient(wx, wy - 25, 8, wx, wy - 25, 96);
      arcGlow.addColorStop(0, 'rgba(130, 246, 255, 0.46)');
      arcGlow.addColorStop(0.55, 'rgba(136, 84, 240, 0.22)');
      arcGlow.addColorStop(1, 'rgba(136, 84, 240, 0)');
      ctx.fillStyle = arcGlow;
      ctx.beginPath();
      ctx.arc(wx, wy - 25, 96, 0, Math.PI * 2);
      ctx.fill();
    }

    drawStar(ctx, wx + 22, wy - 64, 4, 11, 4);
    ctx.fillStyle = '#7cf4ff';
    ctx.fill();
    drawStar(ctx, wx - 24, wy - 12, 4, 8, 3);
    ctx.fillStyle = '#e0b8ff';
    ctx.fill();
  } else if (shape === 'steel_saber' && armorShape !== 'mail') {
    // Reflet d'acier argenté sur l'arme
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const steelTint = ctx.createRadialGradient(wx, wy, 10, wx, wy, 115);
    steelTint.addColorStop(0, 'rgba(215, 238, 255, 0.48)');
    steelTint.addColorStop(1, 'rgba(160, 205, 255, 0)');
    ctx.fillStyle = steelTint;
    ctx.fillRect(290, 0, 222, 360);
    ctx.restore();

    drawStar(ctx, wx + 14, wy - 48, 4, 9, 3);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  ctx.restore();
}

function drawOffhandAndTrinketOverlays(
  ctx: CanvasRenderingContext2D,
  equipped: Record<EquipSlot, string>,
  isHd: boolean,
  bodyX = 122,
  bodyY = 172,
): void {
  const trinketDef = equipped.trinket ? getEquipmentDefinition(equipped.trinket) : undefined;
  if (trinketDef) {
    const style = trinketDef.visualStyle;
    const tx = isHd ? 204 : bodyX - 15;
    const ty = isHd ? 344 : bodyY + 25;
    const r = isHd ? 15 : 7.5;

    ctx.save();
    // Cordon attaché à la ceinture
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = isHd ? 4 : 2.2;
    ctx.beginPath();
    ctx.moveTo(tx, ty - r * 1.4);
    ctx.lineTo(tx, ty - r * 0.6);
    ctx.stroke();

    // Pelote porte-bonheur colorée
    const grad = ctx.createRadialGradient(tx - r * 0.3, ty - r * 0.3, r * 0.2, tx, ty, r);
    grad.addColorStop(0, style.accentColor);
    grad.addColorStop(0.5, style.primaryColor);
    grad.addColorStop(1, style.secondaryColor);
    drawInkEllipse(ctx, tx, ty, r, r, grad, isHd ? 4.5 : 2.5);

    // Brins croisés de la pelote
    ctx.strokeStyle = style.accentColor;
    ctx.lineWidth = isHd ? 2.8 : 1.5;
    ctx.beginPath();
    ctx.arc(tx - r * 0.2, ty, r * 0.68, -0.8, 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(tx + r * 0.25, ty + r * 0.1, r * 0.62, 1.8, 3.8);
    ctx.stroke();
    ctx.restore();
  }

  const secondaryDef = equipped.secondary_weapon
    ? getEquipmentDefinition(equipped.secondary_weapon)
    : undefined;
  if (secondaryDef) {
    const style = secondaryDef.visualStyle;
    const sx = isHd ? 168 : bodyX - 24;
    const sy = isHd ? 336 : bodyY + 20;
    const sc = isHd ? 1 : 0.5;

    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(-0.45);
    drawRoundedRect(ctx, -5 * sc, -30 * sc, 10 * sc, 36 * sc, 3 * sc);
    ctx.fillStyle = style.secondaryColor;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = isHd ? 4 : 2.2;
    ctx.stroke();
    drawRoundedRect(ctx, -14 * sc, -30 * sc, 28 * sc, 8 * sc, 3 * sc);
    ctx.fillStyle = style.accentColor;
    ctx.fill();
    ctx.stroke();
    drawRoundedRect(ctx, -4 * sc, -48 * sc, 8 * sc, 18 * sc, 3 * sc);
    ctx.fillStyle = style.primaryColor;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  const shieldDef = equipped.shield ? getEquipmentDefinition(equipped.shield) : undefined;
  if (shieldDef) {
    const style = shieldDef.visualStyle;
    const shX = isHd ? 138 : bodyX - 36;
    const shY = isHd ? 316 : bodyY + 14;
    const r = isHd ? 44 : 21;

    ctx.save();
    // Bouclier rond à bordure en bois / métal
    drawInkEllipse(ctx, shX, shY, r, r * 1.04, style.secondaryColor, isHd ? 6.5 : 3.6);
    drawInkEllipse(ctx, shX, shY, r * 0.78, r * 0.82, style.primaryColor, isHd ? 3.5 : 2);
    // Veines ou renforts verticaux
    ctx.strokeStyle = style.secondaryColor;
    ctx.lineWidth = isHd ? 3 : 1.6;
    ctx.beginPath();
    ctx.moveTo(shX - r * 0.35, shY - r * 0.65);
    ctx.lineTo(shX - r * 0.35, shY + r * 0.65);
    ctx.moveTo(shX + r * 0.35, shY - r * 0.65);
    ctx.lineTo(shX + r * 0.35, shY + r * 0.65);
    ctx.stroke();
    // Ombon central brillant
    drawInkEllipse(ctx, shX, shY, r * 0.28, r * 0.28, style.accentColor, isHd ? 3.5 : 2);
    ctx.restore();
  }
}

/**
 * Génère un sprite composite HD 512×512 du Héros Félin à partir du PNG semi-réaliste
 * de son armure (`hero_tunic/mail/robe/dragon.png`) + accents visuels de casque, d'arme
 * et d'animation (`idle` / `walk1` / `walk2` / `attack` / `roll`).
 */
export function drawHeroHdCompositeCanvas(
  equipped: Record<EquipSlot, string>,
  frame: HeroAnimFrame,
  hdArmorImg: HTMLImageElement,
  includeSoftGlow = true,
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);

  const weaponStyle = resolveStyle(equipped.weapon, STARTING_EQUIPMENT.weapon);
  const helmetStyle = resolveStyle(equipped.helmet, STARTING_EQUIPMENT.helmet);
  const armorStyle = resolveStyle(equipped.armor, STARTING_EQUIPMENT.armor);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Frame roulade : boule dynamique autour du sprite HD teinté + rubans de vitesse
  if (frame === 'roll') {
    ctx.save();
    ctx.translate(256, 326);
    ctx.rotate(0.55);
    ctx.scale(0.76, 0.72);
    ctx.drawImage(hdArmorImg, -256, -280, size, size);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 246, 222, 0.88)';
    ctx.lineWidth = 14;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(256, 322, 134, 0.25, 2.35);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 218, 96, 0.74)';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(256, 322, 152, 3.2, 5.2);
    ctx.stroke();
    ctx.restore();
    return canvas;
  }

  // Aura douce pour équipement épique ou magique (2D UI uniquement ; en 3D EntityRenderer ajoute l'aura additive)
  if (
    includeSoftGlow &&
    (armorStyle.glowColor || helmetStyle.glowColor || weaponStyle.glowColor)
  ) {
    const auraColor = weaponStyle.glowColor ?? helmetStyle.glowColor ?? armorStyle.glowColor!;
    const aura = ctx.createRadialGradient(256, 286, 28, 256, 286, 210);
    aura.addColorStop(0, `${auraColor}44`);
    aura.addColorStop(0.6, `${auraColor}1a`);
    aura.addColorStop(1, `${auraColor}00`);
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(256, 286, 210, 0, Math.PI * 2);
    ctx.fill();
  }

  // Micro-dynamique de pose selon la frame d'animation
  const tiltRad =
    frame === 'walk1' ? -0.045 : frame === 'walk2' ? 0.045 : frame === 'attack' ? 0.095 : 0;
  const shiftX = frame === 'attack' ? 14 : 0;
  const shiftY = frame === 'walk1' || frame === 'walk2' ? -8 : frame === 'attack' ? -4 : 0;

  ctx.save();
  ctx.translate(256 + shiftX, 496 + shiftY);
  ctx.rotate(tiltRad);
  ctx.translate(-256, -496);

  // Base sprite semi-réaliste HD (armure exacte)
  ctx.drawImage(hdArmorImg, 0, 0, size, size);

  // Reflète visiblement le casque, l'arme et les emplacements secondaires équipés
  drawHdHelmetAccent(ctx, helmetStyle, armorStyle, frame, includeSoftGlow);
  drawHdWeaponOverlay(ctx, weaponStyle, armorStyle, frame, includeSoftGlow);
  drawOffhandAndTrinketOverlays(ctx, equipped, true);

  ctx.restore();
  return canvas;
}

/**
 * Génère le sprite Canvas du héros équipé (HD 512×512 si disponible, sinon fallback 256×256).
 */
export function drawHeroCanvas(
  equipped: Record<EquipSlot, string>,
  frame: HeroAnimFrame,
  hdArmorImg?: HTMLImageElement,
  includeSoftGlow = true,
): HTMLCanvasElement {
  if (hdArmorImg) {
    return drawHeroHdCompositeCanvas(equipped, frame, hdArmorImg, includeSoftGlow);
  }

  const { canvas, ctx } = createCanvas(256, 256);

  const weaponStyle = resolveStyle(equipped.weapon, STARTING_EQUIPMENT.weapon);
  const helmetStyle = resolveStyle(equipped.helmet, STARTING_EQUIPMENT.helmet);
  const armorStyle = resolveStyle(equipped.armor, STARTING_EQUIPMENT.armor);

  if (frame === 'roll') {
    drawRollFrame(ctx, armorStyle, helmetStyle);
    return canvas;
  }

  const bobY =
    frame === 'walk1' ? -5 : frame === 'walk2' ? -3 : frame === 'attack' ? -2 : 0;
  const leanX = frame === 'attack' ? 8 : 0;

  const bodyX = 122 + leanX;
  const bodyY = 172 + bobY;
  const headX = 124 + leanX * 0.85;
  const headY = 114 + bobY;

  // Aura douce pour équipement épique draconique (2D UI uniquement)
  if (includeSoftGlow && (armorStyle.glowColor || helmetStyle.glowColor)) {
    const aura = ctx.createRadialGradient(bodyX, bodyY - 22, 16, bodyX, bodyY - 22, 92);
    aura.addColorStop(0, 'rgba(255, 210, 96, 0.28)');
    aura.addColorStop(1, 'rgba(255, 210, 96, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(bodyX, bodyY - 22, 92, 0, Math.PI * 2);
    ctx.fill();
  }

  // 1. Cape arrière (Armure Draconique)
  drawCapeBack(ctx, armorStyle, frame, bodyX, bodyY);

  // 2. Queue animée
  drawTail(ctx, frame, bodyX, bodyY);

  // 3. Jambes & bottes (ancrées à y = 240)
  drawLegs(ctx, armorStyle, frame, bodyX, 240);

  // 4. Armure / Torse
  drawArmorTorso(ctx, armorStyle, bodyX, bodyY);

  // 5. Oreilles + Tête expressive de chat
  drawCatEars(ctx, headX, headY);
  drawCatHead(ctx, frame, headX, headY);

  // 6. Casque équipé (avec encoches d'oreilles !)
  drawHelmet(ctx, helmetStyle, frame, headX, headY);

  // 7. Pattes avant + Arme équipée + Bouclier/Babiole/Secondaire
  drawWeaponAndPaws(ctx, weaponStyle, frame, bodyX, bodyY, includeSoftGlow);
  drawOffhandAndTrinketOverlays(ctx, equipped, false, bodyX, bodyY);

  return canvas;
}

/**
 * Génère un portrait buste DataURL PNG (256×256 en HD, 128×128 en fallback)
 * reflétant dynamiquement l'armure, le casque et l'arme équipés (HUD & Dialogues).
 */
export function drawHeroPortraitDataUrl(
  equipped: Record<EquipSlot, string>,
  hdArmorImg?: HTMLImageElement,
  hdPortraitImg?: HTMLImageElement,
): string {
  const modeTag = hdArmorImg ? 'hd' : hdPortraitImg ? 'hdp' : 'proc';
  const key = `${getHeroEquipmentKey(equipped)}_${modeTag}`;
  const cached = portraitCache.get(key);
  if (cached) return cached;

  const size = hdArmorImg || hdPortraitImg ? 256 : 128;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const armorStyle = resolveStyle(equipped.armor, STARTING_EQUIPMENT.armor);
  const bgGrad = ctx.createRadialGradient(
    size * 0.5,
    size * 0.42,
    size * 0.08,
    size * 0.5,
    size * 0.5,
    size * 0.55,
  );
  if (armorStyle.shape === 'dragon_plate') {
    bgGrad.addColorStop(0, '#ffdfa3');
    bgGrad.addColorStop(0.68, '#b85042');
    bgGrad.addColorStop(1, '#4a1820');
  } else if (armorStyle.shape === 'star_robe') {
    bgGrad.addColorStop(0, '#c2e8ff');
    bgGrad.addColorStop(0.68, '#3f529e');
    bgGrad.addColorStop(1, '#191e47');
  } else {
    bgGrad.addColorStop(0, '#fff5d6');
    bgGrad.addColorStop(0.75, '#e8cb92');
    bgGrad.addColorStop(1, '#ba8c4e');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  if (hdArmorImg) {
    const heroComposite = drawHeroHdCompositeCanvas(equipped, 'idle', hdArmorImg);
    // Plan rapproché buste + casque + haut d'armure/arme
    ctx.drawImage(heroComposite, 74, 26, 364, 364, 0, 4, size, size);
  } else if (hdPortraitImg) {
    ctx.drawImage(hdPortraitImg, 0, 0, size, size);
  } else {
    const heroSprite = drawHeroCanvas(equipped, 'idle');
    ctx.drawImage(heroSprite, 36, 16, 184, 184, -4, 4, 136, 136);
  }

  const dataUrl = canvas.toDataURL('image/png');
  portraitCache.set(key, dataUrl);
  return dataUrl;
}

/**
 * Génère un aperçu corps entier HD DataURL PNG pour la modale d'Inventaire.
 */
export function drawHeroFullPreviewDataUrl(
  equipped: Record<EquipSlot, string>,
  hdArmorImg?: HTMLImageElement,
): string {
  const sprite = drawHeroCanvas(equipped, 'idle', hdArmorImg);
  return sprite.toDataURL('image/png');
}
