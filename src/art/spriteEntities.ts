import type { EnemyTypeId, EquipSlot, SpeakerPortraitId } from '../game/types';
import { STARTING_EQUIPMENT } from '../game/types';
import {
  ENEMY_ANIM_CLIPS,
  NPC_ANIM_CLIPS,
  type NpcId,
  type SpriteGridSpec,
  resolveActiveSpriteGrid,
} from './hdAssets';
import {
  CREAM_HIGHLIGHT,
  GOLD_LIGHT,
  GOLD_MID,
  INK_COLOR,
  createCanvas,
  drawInkEllipse,
  drawRoundedRect,
  drawStar,
} from './palette';
import {
  type HeroModularImages,
  drawHeroPortraitDataUrl,
} from './spriteHero';

const speakerPortraitCache = new Map<string, string>();

// ============================================================================
// 1. Ennemis & Boss (192×192 pour ennemis, 256×256 pour boss)
// ============================================================================

function drawSlimeYarn(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const cy = 128;

  // Fil de laine qui traîne à gauche
  ctx.beginPath();
  ctx.moveTo(cx - 48, cy + 36);
  ctx.bezierCurveTo(cx - 78, cy + 44, cx - 72, cy + 16, cx - 82, cy + 28);
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = '#ff70a6';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Corps gélatineux en boule de pelote rose bonbon
  ctx.beginPath();
  ctx.moveTo(cx - 56, cy + 24);
  ctx.bezierCurveTo(cx - 62, cy - 42, cx - 24, cy - 64, cx, cy - 64);
  ctx.bezierCurveTo(cx + 28, cy - 64, cx + 62, cy - 40, cx + 56, cy + 24);
  ctx.quadraticCurveTo(cx + 52, cy + 48, cx, cy + 48);
  ctx.quadraticCurveTo(cx - 52, cy + 48, cx - 56, cy + 24);
  ctx.closePath();

  const grad = ctx.createRadialGradient(cx - 18, cy - 26, 8, cx, cy, 68);
  grad.addColorStop(0, '#ffd4e6');
  grad.addColorStop(0.55, '#ff70a6');
  grad.addColorStop(1, '#c93c74');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Brins de laine entrecroisés façon pelote
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(166, 38, 92, 0.42)';
  ctx.lineWidth = 4.5;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.arc(cx - 16 + i * 16, cy - 12, 54, 0.2, 2.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 22 + i * 14, cy + 18, 52, 3.2, 5.5);
    ctx.stroke();
  }
  // Reflet brillant gélatine
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.ellipse(cx - 24, cy - 32, 16, 8, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Petites oreilles de laine mignonnes
  drawInkEllipse(ctx, cx - 34, cy - 54, 10, 12, '#ff85b5', 4, -0.35);
  drawInkEllipse(ctx, cx + 34, cy - 54, 10, 12, '#ff85b5', 4, 0.35);

  // Grands yeux espiègles
  const drawSlimeEye = (ex: number, ey: number): void => {
    drawInkEllipse(ctx, ex, ey, 9, 11, '#261420', 2);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex - 2.5, ey - 4, 3.5, 0, Math.PI * 2);
    ctx.arc(ex + 3, ey + 3, 1.8, 0, Math.PI * 2);
    ctx.fill();
  };
  drawSlimeEye(cx - 18, cy - 2);
  drawSlimeEye(cx + 20, cy - 2);

  // Sourire coquin
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(cx - 7, cy + 13);
  ctx.quadraticCurveTo(cx + 1, cy + 22, cx + 10, cy + 13);
  ctx.stroke();
}

function drawMouseGoblin(ctx: CanvasRenderingContext2D): void {
  const cx = 92;
  const baseY = 178;

  // Queue rose zigzaguante derrière
  ctx.beginPath();
  ctx.moveTo(cx - 24, baseY - 28);
  ctx.bezierCurveTo(cx - 66, baseY - 22, cx - 74, baseY - 56, cx - 54, baseY - 64);
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = '#e88b9c';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Pattes
  drawInkEllipse(ctx, cx - 14, baseY - 8, 12, 8, '#538239', 4);
  drawInkEllipse(ctx, cx + 16, baseY - 8, 12, 8, '#538239', 4);

  // Corps & tunique de brigand ocre
  ctx.beginPath();
  ctx.moveTo(cx - 26, baseY - 62);
  ctx.lineTo(cx + 24, baseY - 62);
  ctx.lineTo(cx + 30, baseY - 14);
  ctx.quadraticCurveTo(cx, baseY - 4, cx - 30, baseY - 14);
  ctx.closePath();
  const tunicGrad = ctx.createLinearGradient(cx - 26, baseY - 62, cx + 26, baseY - 10);
  tunicGrad.addColorStop(0, '#e8b954');
  tunicGrad.addColorStop(1, '#a87622');
  ctx.fillStyle = tunicGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.2;
  ctx.stroke();

  // Ceinture marron
  drawRoundedRect(ctx, cx - 28, baseY - 34, 56, 10, 3);
  ctx.fillStyle = '#5c3b20';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Grandes oreilles rondes de souris-gobelin
  const headY = baseY - 88;
  drawInkEllipse(ctx, cx - 34, headY - 24, 22, 20, '#6da34d', 4.5, -0.2);
  drawInkEllipse(ctx, cx - 33, headY - 24, 13, 12, '#f0a3b0', 0);
  drawInkEllipse(ctx, cx + 30, headY - 26, 22, 20, '#6da34d', 4.5, 0.25);
  drawInkEllipse(ctx, cx + 29, headY - 26, 13, 12, '#f0a3b0', 0);

  // Tête verte pointue
  const headGrad = ctx.createRadialGradient(cx - 8, headY - 8, 6, cx, headY, 36);
  headGrad.addColorStop(0, '#8cc767');
  headGrad.addColorStop(1, '#4b7a33');
  drawInkEllipse(ctx, cx + 2, headY, 33, 27, headGrad, 4.5);

  // Museau pointu vers la droite
  ctx.beginPath();
  ctx.moveTo(cx + 20, headY - 4);
  ctx.quadraticCurveTo(cx + 46, headY + 2, cx + 44, headY + 11);
  ctx.quadraticCurveTo(cx + 28, headY + 19, cx + 12, headY + 14);
  ctx.closePath();
  ctx.fillStyle = '#7bb858';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.8;
  ctx.stroke();
  drawInkEllipse(ctx, cx + 43, headY + 7, 5, 4, '#d95768', 2.5);

  // Yeux jaunes sournois
  drawInkEllipse(ctx, cx - 6, headY - 2, 7.5, 7, '#ffe047', 3);
  drawInkEllipse(ctx, cx + 16, headY - 2, 7.5, 7, '#ffe047', 3);
  ctx.fillStyle = '#2b1e16';
  ctx.beginPath();
  ctx.arc(cx - 4, headY - 2, 3, 0, Math.PI * 2);
  ctx.arc(cx + 18, headY - 2, 3, 0, Math.PI * 2);
  ctx.fill();

  // Sourcils froncés
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx - 16, headY - 12);
  ctx.lineTo(cx, headY - 7);
  ctx.moveTo(cx + 26, headY - 12);
  ctx.lineTo(cx + 10, headY - 7);
  ctx.stroke();

  // Dague recourbée brillante dans la patte droite
  ctx.save();
  ctx.translate(cx + 34, baseY - 42);
  ctx.rotate(0.28);
  // Lame
  ctx.beginPath();
  ctx.moveTo(-4, -2);
  ctx.quadraticCurveTo(10, -24, 34, -36);
  ctx.quadraticCurveTo(22, -10, 6, 4);
  ctx.closePath();
  ctx.fillStyle = '#e0eaf5';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Garde
  drawRoundedRect(ctx, -10, -4, 18, 7, 3);
  ctx.fillStyle = GOLD_MID;
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Patte tenant la dague
  drawInkEllipse(ctx, cx + 30, baseY - 40, 9, 8, '#6da34d', 3.5);
}

function drawThornWolf(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 178;

  // Queue touffue hérissée d'épines
  ctx.beginPath();
  ctx.moveTo(cx - 44, baseY - 56);
  ctx.quadraticCurveTo(cx - 84, baseY - 76, cx - 72, baseY - 104);
  ctx.quadraticCurveTo(cx - 50, baseY - 82, cx - 34, baseY - 64);
  ctx.closePath();
  ctx.fillStyle = '#3a4a34';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.2;
  ctx.stroke();

  // Pattes arrière et avant (posture bondissante)
  const drawLeg = (lx: number, ly: number, tilt: number): void => {
    ctx.save();
    ctx.translate(lx, ly);
    ctx.rotate(tilt);
    drawRoundedRect(ctx, -9, -38, 18, 38, 7);
    ctx.fillStyle = '#3d4d37';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4;
    ctx.stroke();
    drawInkEllipse(ctx, 3, -2, 11, 6, '#2b3626', 3.2);
    ctx.restore();
  };
  drawLeg(cx - 38, baseY - 4, -0.22);
  drawLeg(cx - 18, baseY - 2, -0.08);
  drawLeg(cx + 26, baseY - 2, 0.16);
  drawLeg(cx + 42, baseY - 4, 0.28);

  // Corps musclé moussu
  const bodyGrad = ctx.createLinearGradient(cx - 50, baseY - 86, cx + 44, baseY - 26);
  bodyGrad.addColorStop(0, '#5f7355');
  bodyGrad.addColorStop(1, '#364530');
  drawInkEllipse(ctx, cx - 2, baseY - 56, 52, 28, bodyGrad, 4.8, -0.08);

  // Crinière de ronces & épines magenta sur le dos
  ctx.fillStyle = '#a64d79';
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  const spikes = [
    { x: cx - 36, y: baseY - 80, dx: -12, dy: -22 },
    { x: cx - 16, y: baseY - 84, dx: -4, dy: -26 },
    { x: cx + 6, y: baseY - 84, dx: 4, dy: -24 },
    { x: cx + 22, y: baseY - 88, dx: 12, dy: -22 },
  ];
  for (const s of spikes) {
    ctx.beginPath();
    ctx.moveTo(s.x - 10, s.y + 4);
    ctx.lineTo(s.x + s.dx, s.y + s.dy);
    ctx.lineTo(s.x + 10, s.y + 4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Tête de loup féroce à droite
  const hx = cx + 38;
  const hy = baseY - 76;
  // Oreilles pointues
  ctx.beginPath();
  ctx.moveTo(hx - 18, hy - 14);
  ctx.lineTo(hx - 24, hy - 44);
  ctx.lineTo(hx - 2, hy - 22);
  ctx.closePath();
  ctx.fillStyle = '#4c5c44';
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(hx - 2, hy - 18);
  ctx.lineTo(hx + 6, hy - 46);
  ctx.lineTo(hx + 16, hy - 18);
  ctx.closePath();
  ctx.fillStyle = '#5f7355';
  ctx.fill();
  ctx.stroke();

  // Crâne + gueule ouverte
  drawInkEllipse(ctx, hx, hy, 28, 23, '#53664a', 4.5);
  ctx.beginPath();
  ctx.moveTo(hx + 12, hy - 8);
  ctx.lineTo(hx + 46, hy - 2);
  ctx.lineTo(hx + 42, hy + 10);
  ctx.lineTo(hx + 10, hy + 12);
  ctx.closePath();
  ctx.fillStyle = '#4c5c44';
  ctx.fill();
  ctx.stroke();

  // Crocs blancs
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(hx + 24, hy + 9);
  ctx.lineTo(hx + 28, hy + 19);
  ctx.lineTo(hx + 33, hy + 9);
  ctx.moveTo(hx + 35, hy + 8);
  ctx.lineTo(hx + 39, hy + 16);
  ctx.lineTo(hx + 42, hy + 8);
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Œil ambre féroce
  ctx.beginPath();
  ctx.moveTo(hx + 4, hy - 8);
  ctx.lineTo(hx + 20, hy - 4);
  ctx.lineTo(hx + 10, hy + 4);
  ctx.closePath();
  ctx.fillStyle = '#ffb830';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Rose épineuse violette sur l'épaule
  drawStar(ctx, cx + 8, baseY - 62, 5, 11, 5.5);
  ctx.fillStyle = '#d45b98';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawFishboneSkeleton(ctx: CanvasRenderingContext2D): void {
  const cx = 92;
  const baseY = 178;

  // Cape violette déchirée à l'arrière
  ctx.beginPath();
  ctx.moveTo(cx - 18, baseY - 94);
  ctx.lineTo(cx - 48, baseY - 22);
  ctx.lineTo(cx - 32, baseY - 30);
  ctx.lineTo(cx - 22, baseY - 14);
  ctx.lineTo(cx + 12, baseY - 26);
  ctx.lineTo(cx + 18, baseY - 94);
  ctx.closePath();
  ctx.fillStyle = '#6c4799';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Jambes squelettiques
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(cx - 12, baseY - 46);
  ctx.lineTo(cx - 16, baseY - 10);
  ctx.moveTo(cx + 12, baseY - 46);
  ctx.lineTo(cx + 16, baseY - 10);
  ctx.stroke();
  ctx.strokeStyle = '#ebe6d8';
  ctx.lineWidth = 7;
  ctx.stroke();

  // Colonne vertébrale + côtes en arêtes de poisson !
  drawRoundedRect(ctx, cx - 5, baseY - 96, 10, 54, 4);
  ctx.fillStyle = '#ebe6d8';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  for (let i = 0; i < 3; i++) {
    const ry = baseY - 84 + i * 13;
    drawRoundedRect(ctx, cx - 26 + i * 2, ry, 52 - i * 4, 8, 4);
    ctx.fillStyle = '#ebe6d8';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.2;
    ctx.stroke();
  }

  // Crâne félin squelettique
  const hy = baseY - 120;
  // Oreilles osseuses
  ctx.beginPath();
  ctx.moveTo(cx - 24, hy - 14);
  ctx.lineTo(cx - 32, hy - 42);
  ctx.lineTo(cx - 8, hy - 24);
  ctx.moveTo(cx + 24, hy - 14);
  ctx.lineTo(cx + 32, hy - 42);
  ctx.lineTo(cx + 8, hy - 24);
  ctx.fillStyle = '#ebe6d8';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();

  drawInkEllipse(ctx, cx, hy, 31, 27, '#f2eee2', 4.5);
  // Mâchoire crantée
  drawRoundedRect(ctx, cx - 16, hy + 16, 32, 14, 5);
  ctx.fillStyle = '#e3decb';
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 8, hy + 17);
  ctx.lineTo(cx - 8, hy + 29);
  ctx.moveTo(cx, hy + 17);
  ctx.lineTo(cx, hy + 29);
  ctx.moveTo(cx + 8, hy + 17);
  ctx.lineTo(cx + 8, hy + 29);
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Orbites sombres + lueurs violettes
  drawInkEllipse(ctx, cx - 11, hy - 2, 8.5, 9.5, '#241833', 2.5);
  drawInkEllipse(ctx, cx + 13, hy - 2, 8.5, 9.5, '#241833', 2.5);
  ctx.fillStyle = '#c278ff';
  ctx.beginPath();
  ctx.arc(cx - 10, hy - 2, 4, 0, Math.PI * 2);
  ctx.arc(cx + 14, hy - 2, 4, 0, Math.PI * 2);
  ctx.fill();

  // Sabre géant en arête de poisson !
  ctx.save();
  ctx.translate(cx + 34, baseY - 64);
  ctx.rotate(0.25);
  // Tige d'os
  drawRoundedRect(ctx, -4, -56, 8, 72, 4);
  ctx.fillStyle = '#f5f2e8';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Arêtes transversales de la lame
  for (let i = 0; i < 4; i++) {
    drawRoundedRect(ctx, -14 + i * 1.5, -48 + i * 11, 28 - i * 3, 6, 3);
    ctx.fillStyle = '#f5f2e8';
    ctx.fill();
    ctx.stroke();
  }
  // Nageoire caudale en garde
  ctx.beginPath();
  ctx.moveTo(0, 6);
  ctx.lineTo(-14, 18);
  ctx.lineTo(14, 18);
  ctx.closePath();
  ctx.fillStyle = '#7f58af';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFrostGolem(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 180;

  // Jambes piliers de glace
  drawRoundedRect(ctx, cx - 36, baseY - 42, 26, 38, 6);
  ctx.fillStyle = '#4c8cb5';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  drawRoundedRect(ctx, cx + 10, baseY - 42, 26, 38, 6);
  ctx.fillStyle = '#4c8cb5';
  ctx.fill();
  ctx.stroke();

  // Torse massif en cristal de glacier
  ctx.beginPath();
  ctx.moveTo(cx - 56, baseY - 108);
  ctx.lineTo(cx - 28, baseY - 144);
  ctx.lineTo(cx + 28, baseY - 144);
  ctx.lineTo(cx + 56, baseY - 108);
  ctx.lineTo(cx + 42, baseY - 38);
  ctx.lineTo(cx - 42, baseY - 38);
  ctx.closePath();
  const bodyGrad = ctx.createLinearGradient(cx - 56, baseY - 144, cx + 56, baseY - 38);
  bodyGrad.addColorStop(0, '#dff6ff');
  bodyGrad.addColorStop(0.5, '#8ecae6');
  bodyGrad.addColorStop(1, '#3a7ca5');
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Stalactites sur les épaules
  const drawSpike = (sx: number, sy: number, w: number, h: number): void => {
    ctx.beginPath();
    ctx.moveTo(sx - w, sy);
    ctx.lineTo(sx, sy - h);
    ctx.lineTo(sx + w, sy);
    ctx.closePath();
    ctx.fillStyle = '#e8f9ff';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.8;
    ctx.stroke();
  };
  drawSpike(cx - 38, baseY - 122, 14, 30);
  drawSpike(cx + 38, baseY - 122, 14, 30);
  drawSpike(cx, baseY - 142, 12, 22);

  // Cœur runique cyan incandescent dans la poitrine
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 102);
  ctx.lineTo(cx + 15, baseY - 82);
  ctx.lineTo(cx, baseY - 62);
  ctx.lineTo(cx - 15, baseY - 82);
  ctx.closePath();
  ctx.fillStyle = '#8ef7ff';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Yeux de glace brillants encastrés dans la visière
  drawRoundedRect(ctx, cx - 26, baseY - 126, 52, 16, 6);
  ctx.fillStyle = '#1b364d';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#80f7ff';
  ctx.fillRect(cx - 18, baseY - 121, 12, 6);
  ctx.fillRect(cx + 6, baseY - 121, 12, 6);

  // Poings géants de glace
  drawRoundedRect(ctx, cx - 78, baseY - 84, 30, 44, 10);
  ctx.fillStyle = '#79bddb';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  drawRoundedRect(ctx, cx + 48, baseY - 84, 30, 44, 10);
  ctx.fillStyle = '#79bddb';
  ctx.fill();
  ctx.stroke();
}

function drawBossRatKing(ctx: CanvasRenderingContext2D): void {
  const cx = 128;
  const baseY = 238;

  // Cape royale spectrale pourpre & hermine
  ctx.beginPath();
  ctx.moveTo(cx - 48, baseY - 134);
  ctx.quadraticCurveTo(cx - 94, baseY - 58, cx - 80, baseY - 10);
  ctx.lineTo(cx - 44, baseY - 22);
  ctx.lineTo(cx, baseY - 6);
  ctx.lineTo(cx + 44, baseY - 22);
  ctx.lineTo(cx + 80, baseY - 10);
  ctx.quadraticCurveTo(cx + 94, baseY - 58, cx + 48, baseY - 134);
  ctx.closePath();
  const capeGrad = ctx.createLinearGradient(cx, baseY - 134, cx, baseY - 6);
  capeGrad.addColorStop(0, '#6a3ea1');
  capeGrad.addColorStop(1, '#311a54');
  ctx.fillStyle = capeGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Corps spectral flottant du Roi Rat-Spectre
  ctx.beginPath();
  ctx.moveTo(cx - 42, baseY - 122);
  ctx.quadraticCurveTo(cx - 56, baseY - 46, cx - 32, baseY - 18);
  ctx.quadraticCurveTo(cx, baseY + 2, cx + 32, baseY - 18);
  ctx.quadraticCurveTo(cx + 56, baseY - 46, cx + 42, baseY - 122);
  ctx.closePath();
  const bodyGrad = ctx.createLinearGradient(cx, baseY - 122, cx, baseY - 10);
  bodyGrad.addColorStop(0, '#b599eb');
  bodyGrad.addColorStop(0.65, '#8b6ec4');
  bodyGrad.addColorStop(1, 'rgba(92, 66, 150, 0.72)');
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.8;
  ctx.stroke();

  // Collet d'hermine royal
  drawInkEllipse(ctx, cx, baseY - 122, 46, 14, '#f7f2e8', 4);

  // Grandes oreilles de rat entaillées
  const hy = baseY - 156;
  drawInkEllipse(ctx, cx - 44, hy - 28, 28, 26, '#8b6ec4', 4.8, -0.2);
  drawInkEllipse(ctx, cx - 43, hy - 28, 16, 15, '#d9a6e8', 0);
  drawInkEllipse(ctx, cx + 44, hy - 28, 28, 26, '#8b6ec4', 4.8, 0.2);
  drawInkEllipse(ctx, cx + 43, hy - 28, 16, 15, '#d9a6e8', 0);

  // Tête royale de rat fantôme
  drawInkEllipse(ctx, cx, hy, 44, 34, '#a68ce0', 5);
  // Museau pointu
  ctx.beginPath();
  ctx.moveTo(cx + 12, hy + 2);
  ctx.quadraticCurveTo(cx + 54, hy + 8, cx + 48, hy + 20);
  ctx.quadraticCurveTo(cx + 22, hy + 28, cx - 4, hy + 20);
  ctx.closePath();
  ctx.fillStyle = '#b9a3eb';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();
  drawInkEllipse(ctx, cx + 46, hy + 14, 7, 5.5, '#ff7aa8', 3);

  // Couronne dorée royale inclinée !
  ctx.save();
  ctx.translate(cx, hy - 34);
  ctx.rotate(-0.1);
  ctx.beginPath();
  ctx.moveTo(-30, 8);
  ctx.lineTo(-34, -22);
  ctx.lineTo(-14, -6);
  ctx.lineTo(0, -32);
  ctx.lineTo(14, -6);
  ctx.lineTo(34, -22);
  ctx.lineTo(30, 8);
  ctx.closePath();
  const crownGrad = ctx.createLinearGradient(0, -32, 0, 8);
  crownGrad.addColorStop(0, GOLD_LIGHT);
  crownGrad.addColorStop(1, '#c98916');
  ctx.fillStyle = crownGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();
  drawInkEllipse(ctx, 0, -4, 6, 6, '#ff3b5c', 2.5);
  ctx.restore();

  // Yeux dorés lumineux
  drawInkEllipse(ctx, cx - 14, hy - 2, 9.5, 9, '#261436', 2.5);
  drawInkEllipse(ctx, cx + 16, hy - 2, 9.5, 9, '#261436', 2.5);
  ctx.fillStyle = '#ffe552';
  ctx.beginPath();
  ctx.arc(cx - 12, hy - 2, 4.8, 0, Math.PI * 2);
  ctx.arc(cx + 18, hy - 2, 4.8, 0, Math.PI * 2);
  ctx.fill();

  // Longues moustaches
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(cx - 28, hy + 12);
  ctx.lineTo(cx - 64, hy + 4);
  ctx.moveTo(cx - 28, hy + 18);
  ctx.lineTo(cx - 62, hy + 24);
  ctx.moveTo(cx + 36, hy + 12);
  ctx.lineTo(cx + 70, hy + 6);
  ctx.moveTo(cx + 36, hy + 18);
  ctx.lineTo(cx + 68, hy + 24);
  ctx.stroke();

  // Sceptre spectral doré à droite
  ctx.save();
  ctx.translate(cx + 58, baseY - 76);
  ctx.rotate(0.16);
  drawRoundedRect(ctx, -5, -72, 10, 118, 4);
  ctx.fillStyle = GOLD_MID;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();
  drawStar(ctx, 0, -84, 5, 22, 10);
  ctx.fillStyle = '#ff59b4';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBossDragonClaw(ctx: CanvasRenderingContext2D, phase: 1 | 2): void {
  const cx = 128;
  const baseY = 242;
  const isP2 = phase === 2;

  // Grandes ailes de dragon déployées à gauche et à droite !
  const drawWing = (dir: -1 | 1): void => {
    ctx.beginPath();
    ctx.moveTo(cx + dir * 24, baseY - 122);
    ctx.quadraticCurveTo(cx + dir * 88, baseY - 216, cx + dir * 120, baseY - 182);
    ctx.quadraticCurveTo(cx + dir * 116, baseY - 122, cx + dir * 102, baseY - 82);
    ctx.quadraticCurveTo(cx + dir * 78, baseY - 102, cx + dir * 68, baseY - 72);
    ctx.quadraticCurveTo(cx + dir * 48, baseY - 96, cx + dir * 28, baseY - 78);
    ctx.closePath();

    const wingGrad = ctx.createLinearGradient(cx, baseY - 190, cx + dir * 118, baseY - 78);
    wingGrad.addColorStop(0, isP2 ? '#ff4f2b' : '#d6453a');
    wingGrad.addColorStop(0.6, isP2 ? '#ff9929' : '#f08c3a');
    wingGrad.addColorStop(1, '#7d1626');
    ctx.fillStyle = wingGrad;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 5;
    ctx.stroke();

    // Nervures d'ailes
    ctx.strokeStyle = '#691220';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx + dir * 26, baseY - 118);
    ctx.lineTo(cx + dir * 102, baseY - 86);
    ctx.moveTo(cx + dir * 28, baseY - 114);
    ctx.lineTo(cx + dir * 68, baseY - 76);
    ctx.stroke();
  };
  drawWing(-1);
  drawWing(1);

  // Queue draconique épineuse enroulée
  ctx.beginPath();
  ctx.moveTo(cx - 34, baseY - 40);
  ctx.bezierCurveTo(cx - 104, baseY - 26, cx - 106, baseY - 80, cx - 72, baseY - 76);
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 22;
  ctx.stroke();
  ctx.strokeStyle = isP2 ? '#d62439' : '#b5283a';
  ctx.lineWidth = 14;
  ctx.stroke();
  // Pointe de flèche dorée au bout de la queue
  ctx.beginPath();
  ctx.moveTo(cx - 72, baseY - 76);
  ctx.lineTo(cx - 56, baseY - 94);
  ctx.lineTo(cx - 52, baseY - 68);
  ctx.closePath();
  ctx.fillStyle = GOLD_MID;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Pattes griffues puissantes
  const drawClawFoot = (fx: number): void => {
    drawInkEllipse(ctx, fx, baseY - 18, 22, 16, '#8f1d2c', 4.8);
    ctx.fillStyle = '#fff3d6';
    for (const dx of [-12, 0, 12]) {
      ctx.beginPath();
      ctx.moveTo(fx + dx - 4, baseY - 10);
      ctx.lineTo(fx + dx, baseY - 1);
      ctx.lineTo(fx + dx + 4, baseY - 10);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  };
  drawClawFoot(cx - 34);
  drawClawFoot(cx + 34);

  // Corps robuste écaillé pourpre & ventre plaqué d'or
  const bodyGrad = ctx.createRadialGradient(cx, baseY - 90, 12, cx, baseY - 74, 62);
  bodyGrad.addColorStop(0, isP2 ? '#e83344' : '#cf3448');
  bodyGrad.addColorStop(1, '#7a1524');
  drawInkEllipse(ctx, cx, baseY - 78, 52, 56, bodyGrad, 5);

  // Plaques ventrales dorées
  ctx.beginPath();
  ctx.ellipse(cx, baseY - 74, 30, 44, 0, 0, Math.PI * 2);
  const bellyGrad = ctx.createLinearGradient(cx, baseY - 118, cx, baseY - 30);
  bellyGrad.addColorStop(0, GOLD_LIGHT);
  bellyGrad.addColorStop(1, '#c9861a');
  ctx.fillStyle = bellyGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = '#995f10';
  ctx.lineWidth = 3;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(cx - 24, baseY - 74 + i * 14);
    ctx.quadraticCurveTo(cx, baseY - 68 + i * 14, cx + 24, baseY - 74 + i * 14);
    ctx.stroke();
  }

  // Flammes crinière en Phase 2 !
  if (isP2) {
    ctx.fillStyle = '#ff9824';
    for (let i = -3; i <= 3; i++) {
      const fx = cx + i * 16;
      const fy = baseY - 148 + Math.abs(i) * 6;
      ctx.beginPath();
      ctx.moveTo(fx - 10, fy + 16);
      ctx.quadraticCurveTo(fx, fy - 24, fx + 10, fy + 16);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Tête imposante de Dragon-Chat (Drak-Miaou)
  const hy = baseY - 150;

  // Grandes cornes dorées recourbées
  const drawDragonHorn = (dir: -1 | 1): void => {
    ctx.beginPath();
    ctx.moveTo(cx + dir * 20, hy - 22);
    ctx.quadraticCurveTo(cx + dir * 56, hy - 58, cx + dir * 48, hy - 80);
    ctx.quadraticCurveTo(cx + dir * 28, hy - 54, cx + dir * 32, hy - 14);
    ctx.closePath();
    ctx.fillStyle = GOLD_MID;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.2;
    ctx.stroke();
  };
  drawDragonHorn(-1);
  drawDragonHorn(1);

  // Oreilles félines-draconiques
  ctx.beginPath();
  ctx.moveTo(cx - 34, hy - 8);
  ctx.lineTo(cx - 56, hy - 34);
  ctx.lineTo(cx - 20, hy - 22);
  ctx.moveTo(cx + 34, hy - 8);
  ctx.lineTo(cx + 56, hy - 34);
  ctx.lineTo(cx + 20, hy - 22);
  ctx.fillStyle = isP2 ? '#e83344' : '#b5283a';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Crâne
  const headGrad = ctx.createRadialGradient(cx, hy - 10, 8, cx, hy, 44);
  headGrad.addColorStop(0, isP2 ? '#ff4d4d' : '#db374b');
  headGrad.addColorStop(1, '#821827');
  drawInkEllipse(ctx, cx, hy, 42, 34, headGrad, 5);

  // Museau draconique + crocs + braise dans la gueule
  drawInkEllipse(ctx, cx, hy + 16, 26, 16, '#9c1f30', 4);
  ctx.beginPath();
  ctx.arc(cx, hy + 20, 14, 0, Math.PI);
  ctx.fillStyle = isP2 ? '#ffdd55' : '#ff6b2b';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Crocs blancs
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx - 14, hy + 18);
  ctx.lineTo(cx - 10, hy + 30);
  ctx.lineTo(cx - 5, hy + 18);
  ctx.moveTo(cx + 5, hy + 18);
  ctx.lineTo(cx + 10, hy + 30);
  ctx.lineTo(cx + 14, hy + 18);
  ctx.fill();
  ctx.stroke();

  // Yeux félins à pupilles fendues ardentes
  const drawDragonEye = (ex: number, dir: -1 | 1): void => {
    ctx.beginPath();
    ctx.moveTo(ex - dir * 13, hy - 10);
    ctx.lineTo(ex + dir * 10, hy - 2);
    ctx.lineTo(ex - dir * 6, hy + 6);
    ctx.closePath();
    ctx.fillStyle = isP2 ? '#fff480' : '#ffcf38';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.stroke();
    // Pupille verticale féline
    ctx.fillStyle = '#2b0d0d';
    ctx.fillRect(ex - 2, hy - 6, 4, 10);
  };
  drawDragonEye(cx - 15, -1);
  drawDragonEye(cx + 15, 1);

  // Griffes avant menaçantes + flammes aux serres
  drawInkEllipse(ctx, cx - 44, baseY - 82, 16, 12, '#9e2031', 4, -0.3);
  drawInkEllipse(ctx, cx + 44, baseY - 82, 16, 12, '#9e2031', 4, 0.3);
}

/**
 * Génère le sprite Canvas2D pour chacun des 7 ennemis/boss.
 */
export function drawEnemyCanvas(
  typeId: EnemyTypeId,
  phase: 1 | 2 = 1,
): HTMLCanvasElement {
  const isBoss = typeId === 'boss_rat_king' || typeId === 'boss_dragon_claw';
  const size = isBoss ? 256 : 192;
  const { canvas, ctx } = createCanvas(size, size);

  switch (typeId) {
    case 'slime_yarn':
      drawSlimeYarn(ctx);
      break;
    case 'mouse_goblin':
      drawMouseGoblin(ctx);
      break;
    case 'thorn_wolf':
      drawThornWolf(ctx);
      break;
    case 'fishbone_skeleton':
      drawFishboneSkeleton(ctx);
      break;
    case 'frost_golem':
      drawFrostGolem(ctx);
      break;
    case 'boss_rat_king':
      drawBossRatKing(ctx);
      break;
    case 'boss_dragon_claw':
      drawBossDragonClaw(ctx, phase);
      break;
  }

  return canvas;
}

// ============================================================================
// 2. Compagnon flottant Miaou-sprit (128×128)
// ============================================================================

export function drawCompanionCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(128, 128);
  const cx = 64;
  const cy = 62;

  // Halo astral bleu-or
  const halo = ctx.createRadialGradient(cx, cy, 8, cx, cy, 56);
  halo.addColorStop(0, 'rgba(130, 240, 255, 0.72)');
  halo.addColorStop(0.55, 'rgba(255, 224, 102, 0.28)');
  halo.addColorStop(1, 'rgba(130, 240, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, 56, 0, Math.PI * 2);
  ctx.fill();

  // Petite auréole dorée flottant au-dessus de la tête
  ctx.beginPath();
  ctx.ellipse(cx, cy - 38, 18, 5.5, 0, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD_LIGHT;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Corps fantomatique sans pattes se terminant en volute
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy - 12);
  ctx.quadraticCurveTo(cx - 32, cy + 26, cx - 8, cy + 44);
  ctx.quadraticCurveTo(cx + 8, cy + 52, cx + 18, cy + 36);
  ctx.quadraticCurveTo(cx + 4, cy + 34, cx + 26, cy + 16);
  ctx.quadraticCurveTo(cx + 30, cy - 6, cx + 24, cy - 18);
  // Oreille droite
  ctx.lineTo(cx + 26, cy - 34);
  ctx.lineTo(cx + 10, cy - 24);
  // Sommet crâne
  ctx.quadraticCurveTo(cx, cy - 28, cx - 10, cy - 24);
  // Oreille gauche
  ctx.lineTo(cx - 26, cy - 34);
  ctx.closePath();

  const ghostGrad = ctx.createLinearGradient(cx, cy - 34, cx, cy + 48);
  ghostGrad.addColorStop(0, '#eefcff');
  ghostGrad.addColorStop(0.55, '#8ee8ff');
  ghostGrad.addColorStop(1, 'rgba(110, 200, 255, 0.48)');
  ctx.fillStyle = ghostGrad;
  ctx.fill();
  ctx.strokeStyle = '#29577a';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Yeux dorés pétillants de joie
  drawInkEllipse(ctx, cx - 10, cy - 4, 5.5, 6.5, '#1e3554', 1.8);
  drawInkEllipse(ctx, cx + 10, cy - 4, 5.5, 6.5, '#1e3554', 1.8);
  ctx.fillStyle = GOLD_LIGHT;
  ctx.beginPath();
  ctx.arc(cx - 10, cy - 5, 2.5, 0, Math.PI * 2);
  ctx.arc(cx + 10, cy - 5, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Sourire :3 mignon
  ctx.strokeStyle = '#1e3554';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 5);
  ctx.quadraticCurveTo(cx - 4, cy + 9, cx - 8, cy + 6);
  ctx.moveTo(cx, cy + 5);
  ctx.quadraticCurveTo(cx + 4, cy + 9, cx + 8, cy + 6);
  ctx.stroke();

  // Étoiles brillantes autour
  ctx.fillStyle = GOLD_LIGHT;
  drawStar(ctx, cx + 36, cy - 18, 4, 7, 2.5);
  ctx.fill();
  drawStar(ctx, cx - 36, cy + 10, 4, 5.5, 2);
  ctx.fill();

  return canvas;
}

// ============================================================================
// 3. PNJ Maire Moustache (et Kit-Chat / Aubergiste)
// ============================================================================

function drawMayorMoustache(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 180;

  // Bottines distinguées
  drawInkEllipse(ctx, cx - 14, baseY - 8, 12, 8, '#3b2416', 3.8);
  drawInkEllipse(ctx, cx + 14, baseY - 8, 12, 8, '#3b2416', 3.8);

  // Manteau bleu marine de Maire bien rondouillet
  ctx.beginPath();
  ctx.moveTo(cx - 30, baseY - 84);
  ctx.lineTo(cx + 30, baseY - 84);
  ctx.quadraticCurveTo(cx + 42, baseY - 40, cx + 34, baseY - 12);
  ctx.quadraticCurveTo(cx, baseY - 2, cx - 34, baseY - 12);
  ctx.quadraticCurveTo(cx - 42, baseY - 40, cx - 30, baseY - 84);
  ctx.closePath();
  const coatGrad = ctx.createLinearGradient(cx - 34, baseY - 84, cx + 34, baseY - 10);
  coatGrad.addColorStop(0, '#3a4f8a');
  coatGrad.addColorStop(1, '#202e59');
  ctx.fillStyle = coatGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.2;
  ctx.stroke();

  // Écharpe tricolore/royale rouge et or du Maire
  ctx.beginPath();
  ctx.moveTo(cx - 24, baseY - 82);
  ctx.lineTo(cx + 28, baseY - 24);
  ctx.lineTo(cx + 16, baseY - 14);
  ctx.lineTo(cx - 32, baseY - 70);
  ctx.closePath();
  ctx.fillStyle = '#d63636';
  ctx.fill();
  ctx.strokeStyle = GOLD_MID;
  ctx.lineWidth = 3;
  ctx.stroke();

  // Parchemin officiel dans la patte droite
  drawRoundedRect(ctx, cx + 28, baseY - 58, 14, 28, 4);
  ctx.fillStyle = CREAM_HIGHLIGHT;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();
  drawInkEllipse(ctx, cx + 32, baseY - 44, 9, 8, '#d4cbc0', 3.2);

  // Tête de chat gris-crème distingué
  const hy = baseY - 110;
  // Oreilles
  ctx.beginPath();
  ctx.moveTo(cx - 28, hy - 14);
  ctx.lineTo(cx - 34, hy - 42);
  ctx.lineTo(cx - 10, hy - 22);
  ctx.moveTo(cx + 28, hy - 14);
  ctx.lineTo(cx + 34, hy - 42);
  ctx.lineTo(cx + 10, hy - 22);
  ctx.fillStyle = '#c9bfb3';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();

  drawInkEllipse(ctx, cx, hy, 35, 30, '#ded6cc', 4.5);

  // Haut-de-forme majestueux avec ruban doré !
  drawInkEllipse(ctx, cx, hy - 24, 42, 9, '#2b2433', 4);
  drawRoundedRect(ctx, cx - 23, hy - 66, 46, 44, 6);
  ctx.fillStyle = '#382f42';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();
  // Ruban bordeaux & boucle or
  ctx.fillStyle = '#c93636';
  ctx.fillRect(cx - 21, hy - 34, 42, 9);
  ctx.fillStyle = GOLD_MID;
  ctx.fillRect(cx - 6, hy - 35, 12, 11);

  // Yeux + monocle doré !
  drawInkEllipse(ctx, cx - 12, hy - 2, 5.5, 6.5, '#2b1e16', 2);
  drawInkEllipse(ctx, cx + 12, hy - 2, 5.5, 6.5, '#2b1e16', 2);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - 13, hy - 4, 2, 0, Math.PI * 2);
  ctx.arc(cx + 11, hy - 4, 2, 0, Math.PI * 2);
  ctx.fill();

  // Monocle
  ctx.beginPath();
  ctx.arc(cx + 12, hy - 2, 11, 0, Math.PI * 2);
  ctx.strokeStyle = GOLD_MID;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 22, hy + 2);
  ctx.quadraticCurveTo(cx + 28, hy + 18, cx + 22, hy + 30);
  ctx.strokeStyle = GOLD_MID;
  ctx.lineWidth = 2;
  ctx.stroke();

  // ÉNORME MOUSTACHE BLANCHE EN GUIDON (signature du Maire Moustache !)
  ctx.beginPath();
  ctx.moveTo(cx, hy + 9);
  ctx.bezierCurveTo(cx - 16, hy + 2, cx - 44, hy + 26, cx - 46, hy + 10);
  ctx.bezierCurveTo(cx - 48, hy + 30, cx - 14, hy + 32, cx, hy + 18);
  ctx.bezierCurveTo(cx + 14, hy + 32, cx + 48, hy + 30, cx + 46, hy + 10);
  ctx.bezierCurveTo(cx + 44, hy + 26, cx + 16, hy + 2, cx, hy + 9);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Petit nez rose au-dessus de la moustache
  drawInkEllipse(ctx, cx, hy + 7, 5, 3.8, '#d96675', 2);
}

export function drawNpcCanvas(npcId: string): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(192, 192);
  if (npcId === 'mayor_moustache') {
    drawMayorMoustache(ctx);
  } else {
    drawMayorMoustache(ctx);
  }
  return canvas;
}

// ============================================================================
// 4. Portraits DataURL pour Dialogues (tous les SpeakerPortraitId)
// ============================================================================

function drawKitChatPortrait(ctx: CanvasRenderingContext2D): void {
  const cx = 64;
  const cy = 74;
  // Tête de chat forgeron roux/calico avec lunettes de forge
  ctx.beginPath();
  ctx.moveTo(cx - 28, cy - 16);
  ctx.lineTo(cx - 34, cy - 48);
  ctx.lineTo(cx - 10, cy - 26);
  ctx.moveTo(cx + 28, cy - 16);
  ctx.lineTo(cx + 34, cy - 48);
  ctx.lineTo(cx + 10, cy - 26);
  ctx.fillStyle = '#cf6d34';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  drawInkEllipse(ctx, cx, cy, 34, 30, '#e38042', 4);
  drawInkEllipse(ctx, cx, cy + 12, 18, 12, '#fce8c8', 0);

  // Bandeau & lunettes de forgeron sur le front
  drawRoundedRect(ctx, cx - 34, cy - 22, 68, 11, 4);
  ctx.fillStyle = '#5c3322';
  ctx.fill();
  ctx.stroke();
  drawInkEllipse(ctx, cx - 13, cy - 17, 10, 9, '#7be3ff', 3);
  drawInkEllipse(ctx, cx + 13, cy - 17, 10, 9, '#7be3ff', 3);

  // Yeux + sourire confiant
  drawInkEllipse(ctx, cx - 12, cy + 2, 5, 6, '#2b1e16', 1.5);
  drawInkEllipse(ctx, cx + 12, cy + 2, 5, 6, '#2b1e16', 1.5);
  ctx.fillStyle = '#fff';
  ctx.fillRect(cx - 14, cy - 1, 2.5, 2.5);
  ctx.fillRect(cx + 10, cy - 1, 2.5, 2.5);
  drawInkEllipse(ctx, cx, cy + 10, 4.5, 3, '#d45555', 1.5);
}

function drawInnkeeperPortrait(ctx: CanvasRenderingContext2D): void {
  const cx = 64;
  const cy = 76;
  drawInkEllipse(ctx, cx, cy, 34, 30, '#f5d9b0', 4);

  // Bonnet de nuit cosy bleu étoilé
  ctx.beginPath();
  ctx.moveTo(cx - 32, cy - 14);
  ctx.quadraticCurveTo(cx - 4, cy - 64, cx + 36, cy - 40);
  ctx.quadraticCurveTo(cx + 28, cy - 22, cx + 32, cy - 14);
  ctx.closePath();
  ctx.fillStyle = '#4776b8';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  drawInkEllipse(ctx, cx + 36, cy - 38, 7, 7, '#ffffff', 2.5);

  // Yeux fermés souriants apaisants (^ ^)
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.arc(cx - 12, cy + 4, 7, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 12, cy + 4, 7, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  drawInkEllipse(ctx, cx, cy + 12, 4, 3, '#e37b88', 1.5);
}

export interface HdPortraitImages {
  miaou_sprit?: HTMLImageElement;
  mayor_moustache?: HTMLImageElement;
  kit_chat?: HTMLImageElement;
  innkeeper?: HTMLImageElement;
  boss_rat_king?: HTMLImageElement;
  boss_dragon_claw?: HTMLImageElement;
  heroModular?: HeroModularImages;
}

/**
 * Crée une variante HD Phase 2 enflammée de Drak-Miaou à partir du PNG HD 512×512
 * (extrait proprement la première cellule si l'image source est une planche multi-frames).
 */
export function drawBossDragonPhase2HdCanvas(
  hdDragonImg: HTMLImageElement,
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const rawW = hdDragonImg.naturalWidth || hdDragonImg.width || size;
  const rawH = hdDragonImg.naturalHeight || hdDragonImg.height || size;
  const grid = resolveActiveSpriteGrid(ENEMY_ANIM_CLIPS.boss_dragon_claw.idle, rawW, rawH);
  const cellW = rawW / Math.max(1, grid.cols);
  const cellH = rawH / Math.max(1, grid.rows);

  // Sprite HD principal (cellule 0)
  ctx.drawImage(hdDragonImg, 0, 0, cellW, cellH, 0, 0, size, size);

  // Lueur chaude additive sur le poitrail / gueule sans casser la transparence
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const heat = ctx.createRadialGradient(256, 220, 24, 256, 240, 220);
  heat.addColorStop(0, 'rgba(255, 195, 72, 0.34)');
  heat.addColorStop(0.55, 'rgba(255, 72, 28, 0.18)');
  heat.addColorStop(1, 'rgba(180, 15, 25, 0)');
  ctx.fillStyle = heat;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  return canvas;
}

/**
 * Crée une planche complète Phase 2 enflammée pour `boss_dragon_claw` en préservant
 * exactement la grille `(cols × rows)` de la spritesheet source (4 frames ou 30/45 frames),
 * permettant au lecteur UV zéro-allocation de fonctionner à l'identique en Phase 2.
 */
export function drawBossDragonPhase2SheetCanvas(
  sheetImg: HTMLImageElement,
  grid: SpriteGridSpec,
): HTMLCanvasElement {
  const w = Math.max(1, sheetImg.naturalWidth || sheetImg.width);
  const h = Math.max(1, sheetImg.naturalHeight || sheetImg.height);
  const cols = Math.max(1, grid.cols);
  const rows = Math.max(1, grid.rows);
  const cellW = w / cols;
  const cellH = h / rows;

  const { canvas, ctx } = createCanvas(w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sheetImg, 0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cellW;
      const cy = (r + 0.44) * cellH;
      const radOuter = Math.max(cellW, cellH) * 0.46;
      const heat = ctx.createRadialGradient(
        cx,
        cy,
        radOuter * 0.1,
        cx,
        cy + cellH * 0.04,
        radOuter,
      );
      heat.addColorStop(0, 'rgba(255, 190, 72, 0.34)');
      heat.addColorStop(0.55, 'rgba(255, 72, 28, 0.18)');
      heat.addColorStop(1, 'rgba(180, 15, 25, 0)');
      ctx.fillStyle = heat;
      ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
    }
  }
  ctx.restore();

  return canvas;
}

function getFirstFrameSizeForPortrait(
  portraitId: Exclude<SpeakerPortraitId, 'hero'>,
  img: HTMLImageElement,
): { cellW: number; cellH: number } {
  const rawW = img.naturalWidth || img.width;
  const rawH = img.naturalHeight || img.height;
  if (portraitId === 'boss_rat_king' || portraitId === 'boss_dragon_claw') {
    const grid = resolveActiveSpriteGrid(ENEMY_ANIM_CLIPS[portraitId].idle, rawW, rawH);
    return {
      cellW: rawW / Math.max(1, grid.cols),
      cellH: rawH / Math.max(1, grid.rows),
    };
  }
  const npcClip = NPC_ANIM_CLIPS[portraitId as NpcId]?.idle;
  if (npcClip) {
    const grid = resolveActiveSpriteGrid(npcClip, rawW, rawH);
    return {
      cellW: rawW / Math.max(1, grid.cols),
      cellH: rawH / Math.max(1, grid.rows),
    };
  }
  return { cellW: rawW, cellH: rawH };
}

/**
 * Retourne un portrait DataURL PNG (256×256 en HD, 128×128 en fallback)
 * pour tous les interlocuteurs de dialogue.
 */
export function drawSpeakerPortraitDataUrl(
  portraitId: SpeakerPortraitId,
  equipped?: Record<EquipSlot, string>,
  hdPortraits?: HdPortraitImages,
): string {
  if (portraitId === 'hero') {
    return drawHeroPortraitDataUrl(
      equipped ?? STARTING_EQUIPMENT,
      hdPortraits?.heroModular,
    );
  }

  const hdImg =
    portraitId === 'miaou_sprit'
      ? hdPortraits?.miaou_sprit
      : portraitId === 'mayor_moustache'
        ? hdPortraits?.mayor_moustache
        : portraitId === 'kit_chat'
          ? hdPortraits?.kit_chat
          : portraitId === 'innkeeper'
            ? hdPortraits?.innkeeper
            : portraitId === 'boss_rat_king'
              ? hdPortraits?.boss_rat_king
              : portraitId === 'boss_dragon_claw'
                ? hdPortraits?.boss_dragon_claw
                : undefined;

  const cacheKey = `${portraitId}_${hdImg ? 'hd' : 'proc'}`;
  const cached = speakerPortraitCache.get(cacheKey);
  if (cached) return cached;

  const size = hdImg ? 256 : 128;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Fond médaillon selon le personnage
  const bg = ctx.createRadialGradient(
    size * 0.5,
    size * 0.44,
    size * 0.06,
    size * 0.5,
    size * 0.5,
    size * 0.54,
  );
  if (portraitId === 'boss_dragon_claw') {
    bg.addColorStop(0, '#ff8e47');
    bg.addColorStop(0.65, '#8c1e2e');
    bg.addColorStop(1, '#360a14');
  } else if (portraitId === 'boss_rat_king') {
    bg.addColorStop(0, '#9676d9');
    bg.addColorStop(0.7, '#432773');
    bg.addColorStop(1, '#1d0f38');
  } else if (portraitId === 'miaou_sprit') {
    bg.addColorStop(0, '#4682b8');
    bg.addColorStop(0.75, '#1d3b66');
    bg.addColorStop(1, '#0f1f3d');
  } else {
    bg.addColorStop(0, '#fff5d6');
    bg.addColorStop(0.75, '#e8cb92');
    bg.addColorStop(1, '#b5874a');
  }
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  if (hdImg) {
    const { cellW: srcW, cellH: srcH } = getFirstFrameSizeForPortrait(portraitId, hdImg);
    if (portraitId === 'miaou_sprit') {
      ctx.drawImage(hdImg, srcW * 0.06, srcH * 0.04, srcW * 0.88, srcH * 0.88, 6, 6, size - 12, size - 12);
    } else if (
      portraitId === 'mayor_moustache' ||
      portraitId === 'kit_chat' ||
      portraitId === 'innkeeper'
    ) {
      ctx.drawImage(hdImg, srcW * 0.12, srcH * 0.04, srcW * 0.76, srcH * 0.76, 0, 4, size, size);
    } else if (portraitId === 'boss_rat_king') {
      ctx.drawImage(hdImg, srcW * 0.12, srcH * 0.02, srcW * 0.76, srcH * 0.76, 0, 4, size, size);
    } else if (portraitId === 'boss_dragon_claw') {
      ctx.drawImage(hdImg, srcW * 0.06, srcH * 0.04, srcW * 0.88, srcH * 0.88, 0, 4, size, size);
    }
  } else if (portraitId === 'miaou_sprit') {
    const sprite = drawCompanionCanvas();
    ctx.drawImage(sprite, 6, 4, 116, 116, 4, 6, 120, 120);
  } else if (portraitId === 'mayor_moustache') {
    const sprite = drawNpcCanvas('mayor_moustache');
    ctx.drawImage(sprite, 32, 0, 128, 128, 0, 4, 128, 128);
  } else if (portraitId === 'boss_rat_king') {
    const sprite = drawEnemyCanvas('boss_rat_king', 1);
    ctx.drawImage(sprite, 38, 12, 180, 180, 0, 4, 128, 128);
  } else if (portraitId === 'boss_dragon_claw') {
    const sprite = drawEnemyCanvas('boss_dragon_claw', 2);
    ctx.drawImage(sprite, 44, 6, 168, 168, 0, 4, 128, 128);
  } else if (portraitId === 'kit_chat') {
    drawKitChatPortrait(ctx);
  } else if (portraitId === 'innkeeper') {
    drawInnkeeperPortrait(ctx);
  }

  const dataUrl = canvas.toDataURL('image/png');
  speakerPortraitCache.set(cacheKey, dataUrl);
  return dataUrl;
}
