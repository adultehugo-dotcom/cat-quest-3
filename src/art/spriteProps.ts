import type { BuildingDef, ChestTier, PropKind } from '../game/types';
import {
  BIOME_PALETTE,
  CREAM_HIGHLIGHT,
  GOLD_LIGHT,
  GOLD_MID,
  INK_COLOR,
  createCanvas,
  drawInkEllipse,
  drawRoundedRect,
  drawStar,
} from './palette';

// ============================================================================
// Utilitaires de dessin partagés (Toits en oreilles de chat, badges, etc.)
// ============================================================================

function drawCatEarRoof(
  ctx: CanvasRenderingContext2D,
  cx: number,
  eaveY: number,
  halfW: number,
  roofH: number,
  colorLight: string,
  colorDark: string,
): void {
  const topY = eaveY - roofH;
  // Silhouette du toit rouge avec deux adorables oreilles de chat pointues !
  ctx.beginPath();
  ctx.moveTo(cx - halfW - 10, eaveY + 6);
  ctx.lineTo(cx - halfW + 10, topY + 26);
  // Oreille gauche
  ctx.lineTo(cx - halfW * 0.62, topY - 22);
  ctx.lineTo(cx - halfW * 0.22, topY + 12);
  // Faîtage entre les oreilles
  ctx.quadraticCurveTo(cx, topY + 4, cx + halfW * 0.22, topY + 12);
  // Oreille droite
  ctx.lineTo(cx + halfW * 0.62, topY - 22);
  ctx.lineTo(cx + halfW - 10, topY + 26);
  ctx.lineTo(cx + halfW + 10, eaveY + 6);
  ctx.quadraticCurveTo(cx, eaveY + 14, cx - halfW - 10, eaveY + 6);
  ctx.closePath();

  const roofGrad = ctx.createLinearGradient(cx, topY - 20, cx, eaveY + 10);
  roofGrad.addColorStop(0, colorLight);
  roofGrad.addColorStop(1, colorDark);
  ctx.fillStyle = roofGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.8;
  ctx.stroke();

  // Intérieurs crème/or dans les oreilles du toit (rappel félin malin !)
  ctx.fillStyle = '#f5c289';
  for (const dir of [-1, 1] as const) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * (halfW * 0.54), topY - 8);
    ctx.lineTo(cx + dir * (halfW * 0.34), topY + 15);
    ctx.lineTo(cx + dir * (halfW * 0.68), topY + 17);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  // Tuiles festonnées stylisées
  ctx.strokeStyle = 'rgba(43, 30, 22, 0.28)';
  ctx.lineWidth = 2.6;
  for (let row = 0; row < 2; row++) {
    const ry = topY + 38 + row * 22;
    const count = 4 + row;
    const span = halfW * (1.35 + row * 0.25);
    const step = span / count;
    for (let i = 0; i < count; i++) {
      const tx = cx - span * 0.5 + step * (i + 0.5);
      ctx.beginPath();
      ctx.arc(tx, ry, step * 0.45, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    }
  }
}

function drawWarmWindow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  drawRoundedRect(ctx, x, y, w, h, 6);
  const glow = ctx.createLinearGradient(x, y, x, y + h);
  glow.addColorStop(0, '#fff5a8');
  glow.addColorStop(1, '#f7b23b');
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Croisillons de fenêtre
  ctx.beginPath();
  ctx.moveTo(x + w * 0.5, y);
  ctx.lineTo(x + w * 0.5, y + h);
  ctx.moveTo(x, y + h * 0.5);
  ctx.lineTo(x + w, y + h * 0.5);
  ctx.strokeStyle = '#5c3b20';
  ctx.lineWidth = 3;
  ctx.stroke();
}

// ============================================================================
// 1. Décors Overworld (`PropKind`) — 192×192
// ============================================================================

function drawOakTree(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 180;
  const pal = BIOME_PALETTE.plains;

  // Tronc robuste et racines
  ctx.beginPath();
  ctx.moveTo(cx - 26, baseY);
  ctx.quadraticCurveTo(cx - 14, baseY - 20, cx - 15, baseY - 78);
  ctx.lineTo(cx + 15, baseY - 78);
  ctx.quadraticCurveTo(cx + 14, baseY - 20, cx + 26, baseY);
  ctx.closePath();
  const trunkGrad = ctx.createLinearGradient(cx - 18, baseY - 40, cx + 18, baseY - 40);
  trunkGrad.addColorStop(0, pal.trunkLight);
  trunkGrad.addColorStop(1, pal.trunkDark);
  ctx.fillStyle = trunkGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Feuillage rond en 3 couches luxuriantes
  const drawPuff = (px: number, py: number, rx: number, ry: number, color: string): void => {
    drawInkEllipse(ctx, px, py, rx, ry, color, 4.5);
  };
  drawPuff(cx - 38, baseY - 94, 34, 30, pal.foliageDark);
  drawPuff(cx + 38, baseY - 94, 34, 30, pal.foliageDark);
  drawPuff(cx, baseY - 110, 56, 48, pal.foliageMid);
  drawPuff(cx - 24, baseY - 122, 32, 26, pal.foliageLight);
  drawPuff(cx + 22, baseY - 128, 28, 22, pal.foliageLight);

  // Touches de lumière chaude et petites baies
  ctx.fillStyle = '#c4ed72';
  ctx.beginPath();
  ctx.arc(cx - 26, baseY - 130, 10, 0, Math.PI * 2);
  ctx.arc(cx + 14, baseY - 136, 8, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff7b54';
  for (const [bx, by] of [
    [cx - 32, baseY - 98],
    [cx + 12, baseY - 102],
    [cx + 34, baseY - 92],
  ]) {
    ctx.beginPath();
    ctx.arc(bx, by, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawTwistedTree(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 180;
  const pal = BIOME_PALETTE.forest;

  // Tronc tordu sombre du Bois Griffu
  ctx.beginPath();
  ctx.moveTo(cx - 30, baseY);
  ctx.bezierCurveTo(cx - 12, baseY - 28, cx - 32, baseY - 62, cx - 10, baseY - 92);
  ctx.lineTo(cx + 18, baseY - 92);
  ctx.bezierCurveTo(cx + 4, baseY - 58, cx + 22, baseY - 28, cx + 28, baseY);
  ctx.closePath();
  const trunkGrad = ctx.createLinearGradient(cx - 24, baseY - 40, cx + 24, baseY - 40);
  trunkGrad.addColorStop(0, pal.trunkLight);
  trunkGrad.addColorStop(1, pal.trunkDark);
  ctx.fillStyle = trunkGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Branches crochues
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(cx - 10, baseY - 76);
  ctx.quadraticCurveTo(cx - 52, baseY - 96, cx - 58, baseY - 124);
  ctx.moveTo(cx + 14, baseY - 82);
  ctx.quadraticCurveTo(cx + 52, baseY - 104, cx + 56, baseY - 128);
  ctx.stroke();
  ctx.strokeStyle = pal.trunkDark;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Couronne sombre émeraude-améthyste
  drawInkEllipse(ctx, cx - 40, baseY - 116, 32, 24, pal.foliageDark, 4.5, -0.2);
  drawInkEllipse(ctx, cx + 40, baseY - 118, 32, 24, pal.foliageDark, 4.5, 0.2);
  drawInkEllipse(ctx, cx, baseY - 126, 48, 36, pal.foliageMid, 4.5);
  drawInkEllipse(ctx, cx - 14, baseY - 138, 28, 19, pal.foliageLight, 3.8);

  // Lucioles / fleurs améthyste subtiles
  ctx.fillStyle = '#c58cff';
  for (const [gx, gy] of [
    [cx - 34, baseY - 114],
    [cx + 28, baseY - 124],
    [cx - 4, baseY - 112],
  ]) {
    ctx.beginPath();
    ctx.arc(gx, gy, 4.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSnowPine(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 180;
  const pal = BIOME_PALETTE.frost;

  // Tronc conifère
  drawRoundedRect(ctx, cx - 12, baseY - 40, 24, 40, 4);
  ctx.fillStyle = pal.trunkDark;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.2;
  ctx.stroke();

  // 3 étages de branches de pin enneigées
  const tiers = [
    { y: baseY - 32, w: 62, h: 52 },
    { y: baseY - 72, w: 50, h: 48 },
    { y: baseY - 108, w: 36, h: 48 },
  ];

  for (const t of tiers) {
    // Vert-bleu sapin
    ctx.beginPath();
    ctx.moveTo(cx, t.y - t.h);
    ctx.lineTo(cx + t.w, t.y);
    ctx.quadraticCurveTo(cx, t.y + 10, cx - t.w, t.y);
    ctx.closePath();
    ctx.fillStyle = pal.foliageMid;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // Capuchon de neige festonné au sommet de chaque étage
    ctx.beginPath();
    ctx.moveTo(cx, t.y - t.h);
    ctx.lineTo(cx + t.w * 0.56, t.y - t.h * 0.44);
    ctx.quadraticCurveTo(cx + t.w * 0.25, t.y - t.h * 0.28, cx, t.y - t.h * 0.42);
    ctx.quadraticCurveTo(cx - t.w * 0.25, t.y - t.h * 0.28, cx - t.w * 0.56, t.y - t.h * 0.44);
    ctx.closePath();
    ctx.fillStyle = '#eef8ff';
    ctx.fill();
    ctx.strokeStyle = '#7ea3bd';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
}

function drawRock(ctx: CanvasRenderingContext2D, snowy: boolean): void {
  const cx = 96;
  const baseY = 176;
  const mainCol = snowy ? '#6f8296' : '#8d877c';
  const darkCol = snowy ? '#4c5e70' : '#635d54';
  const lightCol = snowy ? '#9fb5cc' : '#b5aea0';

  // Rocher principal facetté
  ctx.beginPath();
  ctx.moveTo(cx - 56, baseY);
  ctx.lineTo(cx - 48, baseY - 46);
  ctx.lineTo(cx - 12, baseY - 72);
  ctx.lineTo(cx + 36, baseY - 58);
  ctx.lineTo(cx + 58, baseY);
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx - 40, baseY - 72, cx + 40, baseY);
  grad.addColorStop(0, lightCol);
  grad.addColorStop(0.55, mainCol);
  grad.addColorStop(1, darkCol);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.8;
  ctx.stroke();

  // Petit rocher latéral
  drawInkEllipse(ctx, cx - 44, baseY - 16, 22, 16, darkCol, 4);

  if (snowy) {
    // Couverture de neige brillante sur le sommet
    ctx.beginPath();
    ctx.moveTo(cx - 42, baseY - 46);
    ctx.lineTo(cx - 12, baseY - 72);
    ctx.lineTo(cx + 34, baseY - 58);
    ctx.quadraticCurveTo(cx + 12, baseY - 42, cx - 10, baseY - 48);
    ctx.quadraticCurveTo(cx - 28, baseY - 38, cx - 42, baseY - 46);
    ctx.closePath();
    ctx.fillStyle = '#eef8ff';
    ctx.fill();
    ctx.strokeStyle = '#89aec7';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    // Touffe de mousse verte
    drawInkEllipse(ctx, cx - 14, baseY - 58, 22, 9, '#6ba840', 2.8, -0.15);
  }
}

function drawFlowerPatch(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 176;

  // Touffe d'herbe fraîche
  ctx.fillStyle = '#6eb542';
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  for (let i = -3; i <= 3; i++) {
    const bx = cx + i * 16;
    ctx.beginPath();
    ctx.moveTo(bx - 10, baseY);
    ctx.quadraticCurveTo(bx + i * 3, baseY - 44 + Math.abs(i) * 5, bx + 10, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Fleurs colorées vives
  const flowers = [
    { x: cx - 34, y: baseY - 30, col: '#ff6b7a' },
    { x: cx - 6, y: baseY - 44, col: '#ffe052' },
    { x: cx + 26, y: baseY - 36, col: '#ffffff' },
    { x: cx + 44, y: baseY - 22, col: '#ff9654' },
    { x: cx - 22, y: baseY - 18, col: '#78d5ff' },
  ];
  for (const f of flowers) {
    drawStar(ctx, f.x, f.y, 5, 11, 5);
    ctx.fillStyle = f.col;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    drawInkEllipse(ctx, f.x, f.y, 3.8, 3.8, '#ffbe2e', 1.8);
  }
}

function drawMushroom(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 176;

  const drawOneMush = (mx: number, my: number, scale: number, capColor: string): void => {
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(scale, scale);

    // Pied crème
    drawRoundedRect(ctx, -12, -40, 24, 40, 8);
    ctx.fillStyle = '#f2e8d5';
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4;
    ctx.stroke();

    // Chapeau champignon magique
    ctx.beginPath();
    ctx.moveTo(-36, -34);
    ctx.bezierCurveTo(-38, -78, 38, -78, 36, -34);
    ctx.quadraticCurveTo(0, -24, -36, -34);
    ctx.closePath();
    ctx.fillStyle = capColor;
    ctx.fill();
    ctx.stroke();

    // Pois lumineux
    ctx.fillStyle = '#f5e8ff';
    ctx.beginPath();
    ctx.arc(-14, -52, 6, 0, Math.PI * 2);
    ctx.arc(12, -56, 7, 0, Math.PI * 2);
    ctx.arc(2, -40, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  drawOneMush(cx - 24, baseY, 0.72, '#9a52c7');
  drawOneMush(cx + 12, baseY, 1.0, '#7c3eb0');
}

function drawSignpost(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 178;

  // Poteau bois
  drawRoundedRect(ctx, cx - 8, baseY - 108, 16, 108, 5);
  ctx.fillStyle = '#8c582e';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Flèche haute vers la droite
  ctx.beginPath();
  ctx.moveTo(cx - 32, baseY - 94);
  ctx.lineTo(cx + 30, baseY - 94);
  ctx.lineTo(cx + 46, baseY - 80);
  ctx.lineTo(cx + 30, baseY - 66);
  ctx.lineTo(cx - 32, baseY - 66);
  ctx.closePath();
  ctx.fillStyle = '#c4864b';
  ctx.fill();
  ctx.stroke();

  // Flèche basse vers la gauche
  ctx.beginPath();
  ctx.moveTo(cx + 28, baseY - 58);
  ctx.lineTo(cx - 28, baseY - 58);
  ctx.lineTo(cx - 44, baseY - 46);
  ctx.lineTo(cx - 28, baseY - 34);
  ctx.lineTo(cx + 28, baseY - 34);
  ctx.closePath();
  ctx.fillStyle = '#b3753d';
  ctx.fill();
  ctx.stroke();
}

function drawFence(ctx: CanvasRenderingContext2D): void {
  const baseY = 176;
  ctx.fillStyle = '#b57b45';
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;

  // Traverses horizontales
  drawRoundedRect(ctx, 22, baseY - 54, 148, 14, 4);
  ctx.fill();
  ctx.stroke();
  drawRoundedRect(ctx, 22, baseY - 28, 148, 14, 4);
  ctx.fill();
  ctx.stroke();

  // Piquets verticaux
  for (const px of [36, 96, 156]) {
    drawRoundedRect(ctx, px - 10, baseY - 70, 20, 70, 5);
    ctx.fillStyle = '#9c6332';
    ctx.fill();
    ctx.stroke();
  }
}

function drawCatCottage(ctx: CanvasRenderingContext2D, size: number): void {
  const s = size / 256;
  ctx.save();
  ctx.scale(s, s);
  const cx = 128;
  const baseY = 240;

  // Cheminée en brique
  drawRoundedRect(ctx, cx + 44, baseY - 196, 26, 56, 4);
  ctx.fillStyle = '#a8533e';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Façades colombages crème
  drawRoundedRect(ctx, cx - 74, baseY - 108, 148, 108, 8);
  const wallGrad = ctx.createLinearGradient(cx, baseY - 108, cx, baseY);
  wallGrad.addColorStop(0, '#fff4dc');
  wallGrad.addColorStop(1, '#e3cea6');
  ctx.fillStyle = wallGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Poutres bois
  ctx.fillStyle = '#7a4a26';
  ctx.fillRect(cx - 72, baseY - 108, 144, 10);
  ctx.fillRect(cx - 72, baseY - 18, 144, 16);
  ctx.fillRect(cx - 68, baseY - 104, 10, 96);
  ctx.fillRect(cx + 58, baseY - 104, 10, 96);

  // Porte cintrée en chêne
  ctx.beginPath();
  ctx.moveTo(cx - 20, baseY);
  ctx.lineTo(cx - 20, baseY - 46);
  ctx.arc(cx, baseY - 46, 20, Math.PI, 0);
  ctx.lineTo(cx + 20, baseY);
  ctx.closePath();
  ctx.fillStyle = '#8c5228';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.2;
  ctx.stroke();
  drawInkEllipse(ctx, cx + 10, baseY - 26, 3.8, 3.8, GOLD_MID, 2);

  // Deux fenêtres lumineuses
  drawWarmWindow(ctx, cx - 54, baseY - 76, 26, 28);
  drawWarmWindow(ctx, cx + 28, baseY - 76, 26, 28);

  // Toit rouge en forme d'oreilles de chat !
  drawCatEarRoof(ctx, cx, baseY - 102, 86, 84, '#e34b3b', '#9e2420');
  ctx.restore();
}

function drawBush(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 174;
  drawInkEllipse(ctx, cx - 34, baseY - 26, 30, 26, '#2f7a3e', 4.2);
  drawInkEllipse(ctx, cx + 34, baseY - 26, 30, 26, '#2f7a3e', 4.2);
  drawInkEllipse(ctx, cx, baseY - 38, 42, 34, '#449e4f', 4.4);
  drawInkEllipse(ctx, cx - 10, baseY - 46, 26, 20, '#62c25e', 0);
  // Petites baies/fleurs colorées
  drawInkEllipse(ctx, cx - 22, baseY - 34, 4.5, 4.5, '#ff7878', 1.8);
  drawInkEllipse(ctx, cx + 16, baseY - 42, 4.5, 4.5, '#ffd452', 1.8);
  drawInkEllipse(ctx, cx + 4, baseY - 24, 4.5, 4.5, '#ff7878', 1.8);
}

function drawBarrel(ctx: CanvasRenderingContext2D): void {
  const cx = 96;
  const baseY = 176;
  // Corps du tonneau en chêne bombé
  ctx.beginPath();
  ctx.moveTo(cx - 32, baseY - 82);
  ctx.quadraticCurveTo(cx - 46, baseY - 41, cx - 34, baseY);
  ctx.lineTo(cx + 34, baseY);
  ctx.quadraticCurveTo(cx + 46, baseY - 41, cx + 32, baseY - 82);
  ctx.closePath();
  const grad = ctx.createLinearGradient(cx - 42, baseY - 41, cx + 42, baseY - 41);
  grad.addColorStop(0, '#6c3f1d');
  grad.addColorStop(0.42, '#a86938');
  grad.addColorStop(1, '#5d3417');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.6;
  ctx.stroke();

  // Couvercle supérieur
  drawInkEllipse(ctx, cx, baseY - 82, 32, 10, '#8d562b', 3.6);

  // Douelles verticales
  ctx.strokeStyle = 'rgba(42, 22, 10, 0.55)';
  ctx.lineWidth = 2.4;
  for (const ox of [-14, 0, 14]) {
    ctx.beginPath();
    ctx.moveTo(cx + ox * 0.85, baseY - 73);
    ctx.quadraticCurveTo(cx + ox * 1.15, baseY - 40, cx + ox * 0.9, baseY - 2);
    ctx.stroke();
  }

  // Cerclages en fer
  for (const hy of [baseY - 64, baseY - 22]) {
    ctx.fillStyle = '#535e6b';
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(cx - 39, hy, 78, 10, 3);
    ctx.fill();
    ctx.stroke();
  }
}

export function drawPropCanvas(kind: PropKind): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(192, 192);
  switch (kind) {
    case 'oak_tree':
      drawOakTree(ctx);
      break;
    case 'twisted_tree':
      drawTwistedTree(ctx);
      break;
    case 'snow_pine':
      drawSnowPine(ctx);
      break;
    case 'rock':
      drawRock(ctx, false);
      break;
    case 'snow_rock':
      drawRock(ctx, true);
      break;
    case 'flower_patch':
      drawFlowerPatch(ctx);
      break;
    case 'mushroom':
      drawMushroom(ctx);
      break;
    case 'house_cat':
      drawCatCottage(ctx, 192);
      break;
    case 'signpost':
      drawSignpost(ctx);
      break;
    case 'fence':
      drawFence(ctx);
      break;
    case 'bush':
      drawBush(ctx);
      break;
    case 'barrel':
      drawBarrel(ctx);
      break;
  }
  return canvas;
}

// ============================================================================
// 2. Bâtiments de Miaou-bourg (`BuildingDef['kind']`) — 256×256
// ============================================================================

function drawInnBuilding(ctx: CanvasRenderingContext2D): void {
  const cx = 128;
  const baseY = 242;

  // Cheminée douillette
  drawRoundedRect(ctx, cx - 68, baseY - 208, 26, 60, 4);
  ctx.fillStyle = '#a8533e';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Grande façade chaleureuse de l'Auberge du Coussin Doux
  drawRoundedRect(ctx, cx - 86, baseY - 118, 172, 118, 10);
  const wallGrad = ctx.createLinearGradient(cx, baseY - 118, cx, baseY);
  wallGrad.addColorStop(0, '#fff6e0');
  wallGrad.addColorStop(1, '#e6c993');
  ctx.fillStyle = wallGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Soubassement pierre + colombages
  ctx.fillStyle = '#a69a88';
  ctx.fillRect(cx - 84, baseY - 22, 168, 20);
  ctx.strokeStyle = '#704523';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(cx - 82, baseY - 112);
  ctx.lineTo(cx - 82, baseY - 20);
  ctx.moveTo(cx + 82, baseY - 112);
  ctx.lineTo(cx + 82, baseY - 20);
  ctx.stroke();

  // Porte accueillante avec auvent rayé rouge & crème
  ctx.beginPath();
  ctx.moveTo(cx - 24, baseY);
  ctx.lineTo(cx - 24, baseY - 52);
  ctx.arc(cx, baseY - 52, 24, Math.PI, 0);
  ctx.lineTo(cx + 24, baseY);
  ctx.closePath();
  ctx.fillStyle = '#7d4420';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();
  drawInkEllipse(ctx, cx + 13, baseY - 28, 4, 4, GOLD_MID, 2);

  // Fenêtres chaleureuses
  drawWarmWindow(ctx, cx - 68, baseY - 82, 30, 32);
  drawWarmWindow(ctx, cx + 38, baseY - 82, 30, 32);

  // Toit rouge en oreilles de chat de l'Auberge
  drawCatEarRoof(ctx, cx, baseY - 110, 96, 88, '#e84d3d', '#9e211c');

  // Enseigne suspendue iconique : LIT / COUSSIN DOUX + Zzz !
  drawRoundedRect(ctx, cx - 34, baseY - 134, 68, 36, 8);
  ctx.fillStyle = '#5c361a';
  ctx.fill();
  ctx.strokeStyle = GOLD_MID;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Petit lit dessiné sur l'enseigne
  drawRoundedRect(ctx, cx - 22, baseY - 116, 44, 12, 4);
  ctx.fillStyle = '#6db5ff';
  ctx.fill();
  drawInkEllipse(ctx, cx - 12, baseY - 120, 9, 6, '#ffffff', 1.8);
  ctx.fillStyle = GOLD_LIGHT;
  ctx.font = 'bold 13px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.fillText('Zzz', cx + 12, baseY - 119);
}

function drawForgeBuilding(ctx: CanvasRenderingContext2D): void {
  const cx = 128;
  const baseY = 242;

  // Grande cheminée de forge avec panache de fumée & braises
  drawRoundedRect(ctx, cx + 44, baseY - 220, 32, 88, 5);
  ctx.fillStyle = '#595054';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.8;
  ctx.stroke();
  // Fumée de forge
  drawInkEllipse(ctx, cx + 62, baseY - 230, 16, 11, 'rgba(225, 220, 225, 0.85)', 2.5);
  drawInkEllipse(ctx, cx + 76, baseY - 242, 12, 8, 'rgba(235, 232, 238, 0.72)', 2);

  // Corps en pierre de la Forge de Kit-Chat
  drawRoundedRect(ctx, cx - 84, baseY - 114, 168, 114, 8);
  const stoneGrad = ctx.createLinearGradient(cx, baseY - 114, cx, baseY);
  stoneGrad.addColorStop(0, '#8f8682');
  stoneGrad.addColorStop(1, '#5e5654');
  ctx.fillStyle = stoneGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Foyer incandescent de la forge au centre-gauche
  ctx.beginPath();
  ctx.moveTo(cx - 64, baseY - 16);
  ctx.lineTo(cx - 64, baseY - 62);
  ctx.arc(cx - 32, baseY - 62, 32, Math.PI, 0);
  ctx.lineTo(cx, baseY - 16);
  ctx.closePath();
  const fireGrad = ctx.createRadialGradient(cx - 32, baseY - 34, 6, cx - 32, baseY - 46, 44);
  fireGrad.addColorStop(0, '#fff599');
  fireGrad.addColorStop(0.5, '#ff7b24');
  fireGrad.addColorStop(1, '#7a1912');
  ctx.fillStyle = fireGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Enclume noire brillante devant la forge (à droite)
  const ax = cx + 38;
  const ay = baseY - 4;
  ctx.beginPath();
  ctx.moveTo(ax - 24, ay);
  ctx.lineTo(ax + 24, ay);
  ctx.lineTo(ax + 16, ay - 16);
  ctx.lineTo(ax + 30, ay - 26);
  ctx.lineTo(ax + 34, ay - 36);
  ctx.lineTo(ax - 22, ay - 36);
  ctx.lineTo(ax - 34, ay - 26);
  ctx.lineTo(ax - 14, ay - 16);
  ctx.closePath();
  ctx.fillStyle = '#404652';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#94a2b8';
  ctx.fillRect(ax - 18, ay - 33, 38, 6);

  // Toit rouge sombre en oreilles de chat
  drawCatEarRoof(ctx, cx, baseY - 108, 94, 82, '#c93c2e', '#751c17');

  // Emblème marteau & épée sur le fronton
  drawInkEllipse(ctx, cx, baseY - 122, 22, 22, '#3d281c', 3.8);
  ctx.strokeStyle = GOLD_LIGHT;
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(cx - 11, baseY - 111);
  ctx.lineTo(cx + 11, baseY - 133);
  ctx.moveTo(cx + 11, baseY - 111);
  ctx.lineTo(cx - 11, baseY - 133);
  ctx.stroke();
}

function drawQuestBoardBuilding(ctx: CanvasRenderingContext2D): void {
  const cx = 128;
  const baseY = 240;

  // Deux poteaux de chêne
  drawRoundedRect(ctx, cx - 64, baseY - 148, 18, 148, 5);
  ctx.fillStyle = '#754621';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  drawRoundedRect(ctx, cx + 46, baseY - 148, 18, 148, 5);
  ctx.fillStyle = '#754621';
  ctx.fill();
  ctx.stroke();

  // Grand tableau de bois
  drawRoundedRect(ctx, cx - 68, baseY - 156, 136, 98, 8);
  ctx.fillStyle = '#a86d3b';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Parchemins épinglés avec sceaux de cire rouges
  const notes = [
    { x: cx - 54, y: baseY - 142, w: 34, h: 42, rot: -0.08 },
    { x: cx - 14, y: baseY - 146, w: 36, h: 46, rot: 0.04 },
    { x: cx + 26, y: baseY - 138, w: 32, h: 40, rot: 0.1 },
    { x: cx - 38, y: baseY - 100, w: 34, h: 32, rot: 0.05 },
    { x: cx + 8, y: baseY - 98, w: 36, h: 32, rot: -0.06 },
  ];
  for (const n of notes) {
    ctx.save();
    ctx.translate(n.x + n.w * 0.5, n.y + n.h * 0.5);
    ctx.rotate(n.rot);
    drawRoundedRect(ctx, -n.w * 0.5, -n.h * 0.5, n.w, n.h, 3);
    ctx.fillStyle = CREAM_HIGHLIGHT;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 2.8;
    ctx.stroke();
    // Lignes d'écriture
    ctx.strokeStyle = '#9e8462';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-n.w * 0.3, -4);
    ctx.lineTo(n.w * 0.3, -4);
    ctx.moveTo(-n.w * 0.3, 5);
    ctx.lineTo(n.w * 0.22, 5);
    ctx.stroke();
    // Punaise / sceau rouge
    drawInkEllipse(ctx, 0, -n.h * 0.5 + 5, 4.5, 4.5, '#d93838', 1.8);
    ctx.restore();
  }

  // Petit auvent rouge à oreilles de chat au-dessus du panneau !
  drawCatEarRoof(ctx, cx, baseY - 152, 78, 46, '#d94538', '#8f221b');

  // Médaillon doré « ! » au sommet
  drawInkEllipse(ctx, cx, baseY - 180, 18, 18, GOLD_MID, 3.8);
  ctx.fillStyle = INK_COLOR;
  ctx.font = 'bold 26px Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', cx, baseY - 179);
}

export function drawBuildingCanvas(kind: BuildingDef['kind']): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(256, 256);
  switch (kind) {
    case 'inn':
      drawInnBuilding(ctx);
      break;
    case 'forge':
      drawForgeBuilding(ctx);
      break;
    case 'quest_board':
      drawQuestBoardBuilding(ctx);
      break;
    case 'house':
      drawCatCottage(ctx, 256);
      break;
  }
  return canvas;
}

// ============================================================================
// 3. Arches de Donjon (+ Badge Niv. X + Barrière Runique) & Portail de Sortie
// ============================================================================

export function drawDungeonEntranceCanvas(
  theme: 'ghost_cave' | 'dragon_lair',
  levelLabel: string,
  sealed: boolean,
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(256, 256);
  const cx = 128;
  const baseY = 242;
  const isDragon = theme === 'dragon_lair';

  // Monticule rocheux encadrant l'arche
  ctx.beginPath();
  ctx.moveTo(cx - 108, baseY);
  ctx.quadraticCurveTo(cx - 104, baseY - 148, cx, baseY - 170);
  ctx.quadraticCurveTo(cx + 104, baseY - 148, cx + 108, baseY);
  ctx.closePath();
  const rockGrad = ctx.createLinearGradient(cx, baseY - 170, cx, baseY);
  if (isDragon) {
    rockGrad.addColorStop(0, '#5e4b59');
    rockGrad.addColorStop(1, '#261c24');
  } else {
    rockGrad.addColorStop(0, '#786c8c');
    rockGrad.addColorStop(1, '#3b334d');
  }
  ctx.fillStyle = rockGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5.5;
  ctx.stroke();

  // Cornes de dragon sculptées (Antre) ou cristaux violets (Grotte)
  if (isDragon) {
    for (const dir of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + dir * 48, baseY - 144);
      ctx.quadraticCurveTo(cx + dir * 102, baseY - 188, cx + dir * 92, baseY - 216);
      ctx.quadraticCurveTo(cx + dir * 66, baseY - 176, cx + dir * 68, baseY - 122);
      ctx.closePath();
      ctx.fillStyle = '#473642';
      ctx.fill();
      ctx.strokeStyle = INK_COLOR;
      ctx.lineWidth = 4.5;
      ctx.stroke();
    }
    // Neige posée sur les rochers du Nord
    ctx.beginPath();
    ctx.moveTo(cx - 64, baseY - 146);
    ctx.quadraticCurveTo(cx, baseY - 176, cx + 64, baseY - 146);
    ctx.quadraticCurveTo(cx, baseY - 134, cx - 64, baseY - 146);
    ctx.closePath();
    ctx.fillStyle = '#e8f6ff';
    ctx.fill();
  } else {
    // Mousse & cristaux violets autour de la grotte
    drawInkEllipse(ctx, cx - 56, baseY - 136, 26, 12, '#5a8f49', 3.5, -0.35);
    drawInkEllipse(ctx, cx + 56, baseY - 136, 26, 12, '#5a8f49', 3.5, 0.35);
  }

  // Ouverture sombre & tourbillon intérieur
  ctx.beginPath();
  ctx.moveTo(cx - 56, baseY);
  ctx.lineTo(cx - 56, baseY - 76);
  ctx.arc(cx, baseY - 76, 56, Math.PI, 0);
  ctx.lineTo(cx + 56, baseY);
  ctx.closePath();
  const voidGrad = ctx.createRadialGradient(cx, baseY - 66, 8, cx, baseY - 66, 72);
  if (isDragon) {
    voidGrad.addColorStop(0, '#ff6d2b');
    voidGrad.addColorStop(0.45, '#6e1624');
    voidGrad.addColorStop(1, '#14090e');
  } else {
    voidGrad.addColorStop(0, '#9e75ff');
    voidGrad.addColorStop(0.45, '#3b2466');
    voidGrad.addColorStop(1, '#120b21');
  }
  ctx.fillStyle = voidGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 5;
  ctx.stroke();

  // Pierres de voussure autour de l'arche
  ctx.strokeStyle = isDragon ? '#ff8b38' : '#b48cff';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(cx, baseY - 76, 62, Math.PI, 0);
  ctx.stroke();

  // Barrière runique lumineuse quand le donjon est scellé !
  if (sealed) {
    ctx.save();
    ctx.strokeStyle = '#68f0ff';
    ctx.lineWidth = 6;
    ctx.shadowColor = '#5ceeff';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(cx - 54, baseY - 104);
    ctx.lineTo(cx + 54, baseY - 24);
    ctx.moveTo(cx + 54, baseY - 104);
    ctx.lineTo(cx - 54, baseY - 24);
    ctx.moveTo(cx - 56, baseY - 64);
    ctx.lineTo(cx + 56, baseY - 64);
    ctx.stroke();

    // Sceau cadenas runique au centre
    drawInkEllipse(ctx, cx, baseY - 64, 22, 22, '#281e4a', 4);
    ctx.strokeStyle = '#7bf4ff';
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.arc(cx, baseY - 64, 15, 0, Math.PI * 2);
    ctx.stroke();
    // Serrure dorée
    drawInkEllipse(ctx, cx, baseY - 68, 5, 5, GOLD_LIGHT, 1.5);
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillRect(cx - 3, baseY - 65, 6, 10);
    ctx.restore();
  }

  // Badge flottant du niveau recommandé (« Niv. 2 », « Niv. 5 ») au-dessus de l'arche !
  const badgeY = 38;
  drawRoundedRect(ctx, cx - 54, badgeY - 22, 108, 44, 14);
  const badgeGrad = ctx.createLinearGradient(cx, badgeY - 22, cx, badgeY + 22);
  badgeGrad.addColorStop(0, sealed ? '#664a9e' : '#f7d060');
  badgeGrad.addColorStop(1, sealed ? '#382461' : '#c9881c');
  ctx.fillStyle = badgeGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Liseré intérieur parchemin
  drawRoundedRect(ctx, cx - 48, badgeY - 16, 96, 32, 10);
  ctx.strokeStyle = sealed ? '#88efff' : '#fff4cc';
  ctx.lineWidth = 2.2;
  ctx.stroke();

  ctx.fillStyle = sealed ? '#ffffff' : '#2b1e16';
  ctx.font = 'bold 23px Georgia, "Palatino Linotype", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(levelLabel, cx, badgeY + 1);

  return canvas;
}

export function drawDungeonExitPortalCanvas(
  theme: 'ghost_cave' | 'dragon_lair',
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(192, 192);
  const cx = 96;
  const baseY = 180;
  const outer = theme === 'dragon_lair' ? '#ffae42' : '#5edbff';

  // Halo portail
  const halo = ctx.createRadialGradient(cx, baseY - 76, 12, cx, baseY - 76, 76);
  halo.addColorStop(0, '#ffffff');
  halo.addColorStop(0.45, outer);
  halo.addColorStop(1, 'rgba(94, 219, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, baseY - 76, 76, 0, Math.PI * 2);
  ctx.fill();

  // Arche runique lumineuse
  ctx.beginPath();
  ctx.ellipse(cx, baseY - 72, 46, 62, 0, 0, Math.PI * 2);
  ctx.strokeStyle = outer;
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Spirale magique intérieure
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(cx, baseY - 72, 26, 38, 0.25, 0, Math.PI * 1.6);
  ctx.stroke();

  // Étincelles
  ctx.fillStyle = GOLD_LIGHT;
  drawStar(ctx, cx - 44, baseY - 124, 4, 10, 4);
  ctx.fill();
  drawStar(ctx, cx + 48, baseY - 108, 4, 8, 3);
  ctx.fill();

  return canvas;
}

// ============================================================================
// 4. Coffres (4 tiers × 3 états : closed / open / locked)
// ============================================================================

export function drawChestCanvas(
  tier: ChestTier,
  state: 'closed' | 'open' | 'locked',
): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(160, 160);
  const cx = 80;
  const baseY = 146;

  const palette =
    tier === 'golden'
      ? { body: '#f5c23b', dark: '#b87c14', trim: '#fff199', gem: '#ff3b5c' }
      : tier === 'epic'
        ? { body: '#6e329e', dark: '#411b63', trim: '#f2c144', gem: '#ff6642' }
        : tier === 'rare'
          ? { body: '#2f68ad', dark: '#1c4070', trim: '#dce8f5', gem: '#66f0ff' }
          : { body: '#a66533', dark: '#6b3d1b', trim: '#d9b159', gem: '#ffe070' };

  if (state === 'open') {
    // Couvercle rabattu derrière
    drawRoundedRect(ctx, cx - 44, baseY - 94, 88, 38, 12);
    ctx.fillStyle = palette.dark;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.2;
    ctx.stroke();

    // Intérieur velours chaud
    drawRoundedRect(ctx, cx - 36, baseY - 84, 72, 26, 6);
    ctx.fillStyle = '#331c1a';
    ctx.fill();
  }

  // Base du coffre
  drawRoundedRect(ctx, cx - 46, baseY - 52, 92, 52, 8);
  const bodyGrad = ctx.createLinearGradient(cx, baseY - 52, cx, baseY);
  bodyGrad.addColorStop(0, palette.body);
  bodyGrad.addColorStop(1, palette.dark);
  ctx.fillStyle = bodyGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Bandes métalliques verticales
  ctx.fillStyle = palette.trim;
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3;
  drawRoundedRect(ctx, cx - 32, baseY - 52, 12, 52, 2);
  ctx.fill();
  ctx.stroke();
  drawRoundedRect(ctx, cx + 20, baseY - 52, 12, 52, 2);
  ctx.fill();
  ctx.stroke();

  if (state !== 'open') {
    // Couvercle bombé fermé
    ctx.beginPath();
    ctx.moveTo(cx - 48, baseY - 48);
    ctx.quadraticCurveTo(cx - 46, baseY - 88, cx, baseY - 88);
    ctx.quadraticCurveTo(cx + 46, baseY - 88, cx + 48, baseY - 48);
    ctx.closePath();
    ctx.fillStyle = palette.body;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 4.5;
    ctx.stroke();

    // Bandes sur le couvercle
    ctx.fillStyle = palette.trim;
    ctx.fillRect(cx - 32, baseY - 82, 12, 34);
    ctx.fillRect(cx + 20, baseY - 82, 12, 34);

    // Serrure centrale + gemme
    drawRoundedRect(ctx, cx - 12, baseY - 60, 24, 24, 5);
    ctx.fillStyle = palette.trim;
    ctx.fill();
    ctx.strokeStyle = INK_COLOR;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    drawInkEllipse(ctx, cx, baseY - 48, 5.5, 5.5, palette.gem, 2);
  }

  if (state === 'locked') {
    // Chaînes runiques violettes autour du coffre tant que le boss est vivant
    ctx.strokeStyle = '#9c6eff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx - 46, baseY - 68);
    ctx.lineTo(cx + 46, baseY - 12);
    ctx.moveTo(cx + 46, baseY - 68);
    ctx.lineTo(cx - 46, baseY - 12);
    ctx.stroke();
    drawInkEllipse(ctx, cx, baseY - 42, 12, 12, '#3b2466', 3);
    drawInkEllipse(ctx, cx, baseY - 42, 4.5, 4.5, '#78f4ff', 0);
  } else if (state === 'closed') {
    // Petites étoiles scintillantes
    ctx.fillStyle = GOLD_LIGHT;
    drawStar(ctx, cx - 44, baseY - 94, 4, 10, 4);
    ctx.fill();
    drawStar(ctx, cx + 44, baseY - 84, 4, 8, 3);
    ctx.fill();
  }

  return canvas;
}

// ============================================================================
// 5. Accessoires de Donjon : Torches, Colonnes, Cristal de Soin
// ============================================================================

export function drawTorchCanvas(frame: 0 | 1): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(128, 128);
  const cx = 64;
  const baseY = 118;
  const sway = frame === 0 ? -4 : 5;

  // Support fer forgé
  drawRoundedRect(ctx, cx - 6, baseY - 56, 12, 56, 4);
  ctx.fillStyle = '#4a434f';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3.5;
  ctx.stroke();

  // Vasque
  ctx.beginPath();
  ctx.moveTo(cx - 20, baseY - 62);
  ctx.lineTo(cx + 20, baseY - 62);
  ctx.lineTo(cx + 12, baseY - 46);
  ctx.lineTo(cx - 12, baseY - 46);
  ctx.closePath();
  ctx.fillStyle = '#36303b';
  ctx.fill();
  ctx.stroke();

  // Flamme vacillante
  ctx.beginPath();
  ctx.moveTo(cx - 14, baseY - 62);
  ctx.quadraticCurveTo(cx - 20 + sway, baseY - 86, cx + sway, baseY - 108);
  ctx.quadraticCurveTo(cx + 22 + sway * 0.5, baseY - 84, cx + 14, baseY - 62);
  ctx.closePath();
  const fGrad = ctx.createLinearGradient(cx, baseY - 108, cx, baseY - 62);
  fGrad.addColorStop(0, '#fff7b2');
  fGrad.addColorStop(0.5, '#ff982e');
  fGrad.addColorStop(1, '#d93824');
  ctx.fillStyle = fGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 3;
  ctx.stroke();

  return canvas;
}

export function drawPillarCanvas(theme: 'ghost_cave' | 'dragon_lair'): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(192, 192);
  const cx = 96;
  const baseY = 180;
  const isDragon = theme === 'dragon_lair';

  const light = isDragon ? '#6e5863' : '#7b6e94';
  const dark = isDragon ? '#382a33' : '#403657';
  const rune = isDragon ? '#ff7b38' : '#80e6ff';

  // Socle
  drawRoundedRect(ctx, cx - 36, baseY - 22, 72, 22, 5);
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.5;
  ctx.stroke();

  // Fût de la colonne
  drawRoundedRect(ctx, cx - 24, baseY - 146, 48, 126, 4);
  const grad = ctx.createLinearGradient(cx - 24, baseY - 80, cx + 24, baseY - 80);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.stroke();

  // Chapiteau
  drawRoundedRect(ctx, cx - 34, baseY - 166, 68, 22, 5);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.stroke();

  // Runes gravées lumineuses
  ctx.strokeStyle = rune;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 124);
  ctx.lineTo(cx + 10, baseY - 104);
  ctx.lineTo(cx, baseY - 84);
  ctx.lineTo(cx - 10, baseY - 104);
  ctx.closePath();
  ctx.stroke();

  return canvas;
}

export function drawHealingCrystalCanvas(used: boolean): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(160, 160);
  const cx = 80;
  const baseY = 148;

  // Piédestal de pierre
  drawRoundedRect(ctx, cx - 34, baseY - 24, 68, 24, 6);
  ctx.fillStyle = '#5c5569';
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4;
  ctx.stroke();

  // Obélisque cristallin flottant
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 128);
  ctx.lineTo(cx + 24, baseY - 80);
  ctx.lineTo(cx + 14, baseY - 36);
  ctx.lineTo(cx, baseY - 28);
  ctx.lineTo(cx - 14, baseY - 36);
  ctx.lineTo(cx - 24, baseY - 80);
  ctx.closePath();
  const cGrad = ctx.createLinearGradient(cx - 24, baseY - 128, cx + 24, baseY - 32);
  if (used) {
    cGrad.addColorStop(0, '#8ca3a0');
    cGrad.addColorStop(1, '#4c5c5c');
  } else {
    cGrad.addColorStop(0, '#e3ffef');
    cGrad.addColorStop(0.45, '#5ce68a');
    cGrad.addColorStop(1, '#1d9e6b');
  }
  ctx.fillStyle = cGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 4.2;
  ctx.stroke();

  // Facette brillante
  ctx.beginPath();
  ctx.moveTo(cx, baseY - 124);
  ctx.lineTo(cx + 8, baseY - 78);
  ctx.lineTo(cx, baseY - 34);
  ctx.strokeStyle = used ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 3;
  ctx.stroke();

  if (!used) {
    ctx.fillStyle = '#ffffff';
    drawStar(ctx, cx + 30, baseY - 106, 4, 8, 3);
    ctx.fill();
    drawStar(ctx, cx - 32, baseY - 64, 4, 6.5, 2.5);
    ctx.fill();
  }

  return canvas;
}

// ============================================================================
// 6. Composites HD 512×512 à partir des props Diorama PNG validés
// ============================================================================

/**
 * Composite l'arche HD `portal_dungeon.png` avec l'atmosphère du thème
 * (`ghost_cave` ou `dragon_lair`), la barrière runique scellée et le badge `Niv. X`.
 */
export function drawDungeonEntranceHdCanvas(
  baseImg: HTMLImageElement,
  theme: 'ghost_cave' | 'dragon_lair',
  levelLabel: string,
  sealed: boolean,
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  const cx = 256;
  const isDragon = theme === 'dragon_lair';
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // 1. Arche sculptée HD (légèrement décalée vers le bas pour laisser respirer le badge Niv.)
  ctx.drawImage(baseImg, 12, 48, 488, 464);

  // Teinte subtile selon le biome du donjon (source-atop pour préserver l'alpha !)
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = isDragon ? 'rgba(165, 38, 28, 0.16)' : 'rgba(92, 74, 178, 0.12)';
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  // 2. Barrière runique lumineuse quand le donjon exige la Clé Runique (traits nets sans shadowBlur)
  if (sealed) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 102, 276);
    ctx.lineTo(cx + 102, 434);
    ctx.moveTo(cx + 102, 276);
    ctx.lineTo(cx - 102, 434);
    ctx.moveTo(cx - 110, 355);
    ctx.lineTo(cx + 110, 355);
    ctx.strokeStyle = '#3378c8';
    ctx.lineWidth = 14;
    ctx.stroke();
    ctx.strokeStyle = '#8ef6ff';
    ctx.lineWidth = 7;
    ctx.stroke();

    drawInkEllipse(ctx, cx, 355, 42, 42, '#241a46', 6);
    ctx.strokeStyle = '#84f6ff';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, 355, 29, 0, Math.PI * 2);
    ctx.stroke();
    drawInkEllipse(ctx, cx, 348, 10, 10, GOLD_LIGHT, 2.5);
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillRect(cx - 5, 352, 10, 18);
    ctx.restore();
  }

  // 3. Badge diorama élégant du niveau recommandé (« Niv. 2 », « Niv. 5 ») sans shadowBlur
  const badgeY = 58;
  ctx.save();
  drawRoundedRect(ctx, cx - 104, badgeY - 34, 208, 76, 22);
  ctx.fillStyle = '#140c06';
  ctx.fill();
  drawRoundedRect(ctx, cx - 104, badgeY - 38, 208, 76, 22);
  const badgeGrad = ctx.createLinearGradient(cx, badgeY - 38, cx, badgeY + 38);
  badgeGrad.addColorStop(0, sealed ? '#664a9e' : '#fae07a');
  badgeGrad.addColorStop(1, sealed ? '#321e5a' : '#bd7a16');
  ctx.fillStyle = badgeGrad;
  ctx.fill();
  ctx.strokeStyle = INK_COLOR;
  ctx.lineWidth = 7;
  ctx.stroke();

  drawRoundedRect(ctx, cx - 94, badgeY - 29, 188, 58, 16);
  ctx.strokeStyle = sealed ? '#8ef2ff' : '#fff5cf';
  ctx.lineWidth = 3.5;
  ctx.stroke();

  ctx.fillStyle = sealed ? '#ffffff' : '#2b1c12';
  ctx.font = 'bold 42px Georgia, "Palatino Linotype", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(levelLabel, cx, badgeY + 2);
  ctx.restore();

  return canvas;
}

/**
 * Composite un coffre HD 512×512 selon son palier (`wood`/`rare`/`epic`/`golden`)
 * et son état (`closed`/`open`/`locked`).
 */
export function drawChestHdCanvas(
  baseImg: HTMLImageElement,
  tier: ChestTier,
  state: 'closed' | 'open' | 'locked',
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(baseImg, 0, 0, size, size);

  // Nuance colorimétrique respectueuse des micro-textures bois/or du coffre HD
  if (tier !== 'wood') {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    if (tier === 'rare') {
      ctx.fillStyle = 'rgba(42, 132, 228, 0.24)';
    } else if (tier === 'epic') {
      ctx.fillStyle = 'rgba(148, 56, 218, 0.26)';
    } else {
      ctx.fillStyle = 'rgba(255, 210, 56, 0.22)';
    }
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  // Chaînes & cadenas runiques si verrouillé jusqu'à la défaite du boss (traits nets sans shadowBlur)
  if (state === 'locked') {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(112, 240);
    ctx.lineTo(400, 420);
    ctx.moveTo(400, 240);
    ctx.lineTo(112, 420);
    ctx.strokeStyle = '#3b2466';
    ctx.lineWidth = 18;
    ctx.stroke();
    ctx.strokeStyle = '#b488ff';
    ctx.lineWidth = 10;
    ctx.stroke();

    drawInkEllipse(ctx, 256, 330, 38, 38, '#2d1c54', 6);
    drawInkEllipse(ctx, 256, 330, 14, 14, '#7cf4ff', 0);
    ctx.restore();
  }

  return canvas;
}

/**
 * Produit une variante enneigée HD 512×512 à partir de `prop_rock.png`.
 */
export function drawSnowRockHdCanvas(rockImg: HTMLImageElement): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(rockImg, 0, 0, size, size);

  // Refroidissement ardoise-givre + chapeau de neige fraîche sur le sommet
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(128, 178, 224, 0.24)';
  ctx.fillRect(0, 0, size, size);

  const snowGrad = ctx.createLinearGradient(0, 90, 0, 295);
  snowGrad.addColorStop(0, 'rgba(248, 253, 255, 0.94)');
  snowGrad.addColorStop(0.55, 'rgba(224, 244, 255, 0.78)');
  snowGrad.addColorStop(1, 'rgba(210, 236, 252, 0)');
  ctx.fillStyle = snowGrad;
  ctx.fillRect(0, 60, size, 240);
  ctx.restore();

  return canvas;
}

/**
 * Produit une variante HD 512×512 du Cristal de Soin (actif rayonnant ou épuisé).
 */
export function drawHealingCrystalHdCanvas(
  crystalImg: HTMLImageElement,
  used: boolean,
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (used) {
    ctx.save();
    ctx.filter = 'grayscale(0.88) brightness(0.62)';
    ctx.drawImage(crystalImg, 0, 0, size, size);
    ctx.restore();
    return canvas;
  }

  ctx.drawImage(crystalImg, 0, 0, size, size);
  return canvas;
}

/**
 * Produit une variante HD 512×512 du Pilier de Donjon accordée au thème actif.
 */
export function drawPillarHdCanvas(
  pillarImg: HTMLImageElement,
  theme: 'ghost_cave' | 'dragon_lair',
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.drawImage(pillarImg, 0, 0, size, size);

  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle =
    theme === 'dragon_lair'
      ? 'rgba(145, 42, 34, 0.18)'
      : 'rgba(92, 74, 168, 0.16)';
  ctx.fillRect(0, 0, size, size);
  ctx.restore();

  return canvas;
}

/**
 * Produit les 2 frames vacillantes HD 512×512 de la torche de donjon.
 */
export function drawTorchHdCanvas(
  torchImg: HTMLImageElement,
  frame: 0 | 1,
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  ctx.save();
  if (frame === 1) {
    // Subtile pulsation horizontale de la flamme
    ctx.translate(256, 512);
    ctx.scale(-1, 1.02);
    ctx.translate(-256, -512);
  }
  ctx.drawImage(torchImg, 0, 0, size, size);
  ctx.restore();

  return canvas;
}

/**
 * Dessine un lampadaire médiéval en fer forgé (`prop_lamppost`) en mode éteint
 * (jour) ou allumé chaud (crépuscule / nuit / brouillard / tempête).
 */
export function drawLamppostCanvas(lit: boolean): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(256, 384);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Socle de pierre & fer forgé
  drawInkEllipse(ctx, 128, 356, 44, 15, '#595452', 5);
  ctx.fillStyle = '#3a3438';
  ctx.strokeStyle = '#1f1916';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.roundRect(114, 108, 28, 246, 8);
  ctx.fill();
  ctx.stroke();

  // Reflet métallique vertical
  ctx.fillStyle = 'rgba(210, 215, 228, 0.22)';
  ctx.fillRect(120, 114, 6, 234);

  // Potence courbée élégante
  ctx.strokeStyle = '#1f1916';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(128, 124);
  ctx.quadraticCurveTo(128, 66, 174, 72);
  ctx.stroke();
  ctx.strokeStyle = '#4c464d';
  ctx.lineWidth = 7;
  ctx.stroke();

  // Volute décorative
  ctx.strokeStyle = '#2b2528';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(146, 116, 14, Math.PI * 0.2, Math.PI * 1.4);
  ctx.stroke();

  // Lanterne suspendue (éclairage assuré par de vraies PointLights, jamais par un faux halo peint)
  const lx = 176;
  const ly = 114;

  // Toit de lanterne
  ctx.fillStyle = '#363034';
  ctx.strokeStyle = '#1f1916';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(lx - 26, ly - 16);
  ctx.lineTo(lx, ly - 38);
  ctx.lineTo(lx + 26, ly - 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Vitre de lanterne
  const glassGrad = ctx.createRadialGradient(lx, ly + 6, 4, lx, ly + 6, 26);
  if (lit) {
    glassGrad.addColorStop(0, '#fffce0');
    glassGrad.addColorStop(0.55, '#ffd460');
    glassGrad.addColorStop(1, '#e88222');
  } else {
    glassGrad.addColorStop(0, '#c8d6df');
    glassGrad.addColorStop(1, '#687985');
  }
  ctx.fillStyle = glassGrad;
  ctx.beginPath();
  ctx.moveTo(lx - 20, ly - 16);
  ctx.lineTo(lx + 20, ly - 16);
  ctx.lineTo(lx + 15, ly + 28);
  ctx.lineTo(lx - 15, ly + 28);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Base de lanterne
  ctx.fillStyle = '#363034';
  ctx.beginPath();
  ctx.roundRect(lx - 17, ly + 26, 34, 10, 4);
  ctx.fill();
  ctx.stroke();

  return canvas;
}

/**
 * Produit une frame intermédiaire d'ouverture de coffre (`chest_opening_sheet`
 * en repli procédural zéro-404 à partir des PNG existants `chest_closed` et `chest_open`).
 */
export function drawChestOpeningFrameCanvas(
  closedImg: HTMLImageElement | undefined,
  openImg: HTMLImageElement | undefined,
  progress01: number,
  tier: 'common' | 'rare' | 'epic' | 'boss',
): HTMLCanvasElement {
  const size = 512;
  const { canvas, ctx } = createCanvas(size, size);
  const p = Math.max(0, Math.min(1, progress01));

  // Squash d'anticipation puis jaillissement doré à l'ouverture
  const squashX = p < 0.35 ? 1 + Math.sin((p / 0.35) * Math.PI) * 0.08 : 1 - Math.sin(((p - 0.35) / 0.65) * Math.PI) * 0.04;
  const squashY = p < 0.35 ? 1 - Math.sin((p / 0.35) * Math.PI) * 0.09 : 1 + Math.sin(((p - 0.35) / 0.65) * Math.PI) * 0.1;

  ctx.save();
  ctx.translate(size * 0.5, size * 0.92);
  ctx.scale(squashX, squashY);
  ctx.translate(-size * 0.5, -size * 0.92);

  if (closedImg && openImg) {
    ctx.globalAlpha = 1 - Math.max(0, (p - 0.35) / 0.45);
    ctx.drawImage(closedImg, 0, 0, size, size);
    ctx.globalAlpha = Math.min(1, Math.max(0, (p - 0.25) / 0.5));
    ctx.drawImage(openImg, 0, 0, size, size);
  } else {
    const chestTier: ChestTier =
      tier === 'boss' ? 'golden' : tier === 'epic' ? 'epic' : tier === 'rare' ? 'rare' : 'wood';
    const base = drawChestCanvas(chestTier, p > 0.5 ? 'open' : 'closed');
    ctx.drawImage(base, 0, 0, size, size);
  }
  ctx.restore();

  // Rayon lumineux d'ouverture proportionnel au palier de rareté
  if (p > 0.28) {
    const burst = Math.sin(((p - 0.28) / 0.72) * Math.PI);
    const beamColor =
      tier === 'epic'
        ? 'rgba(208, 128, 255, '
        : tier === 'rare'
          ? 'rgba(110, 210, 255, '
          : 'rgba(255, 224, 112, ';
    const grad = ctx.createRadialGradient(256, 250, 12, 256, 230, 180);
    grad.addColorStop(0, `${beamColor}${(0.75 * burst).toFixed(3)})`);
    grad.addColorStop(1, `${beamColor}0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }

  return canvas;
}

