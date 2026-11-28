import { DUNGEONS } from '../data/dungeonsData';
import { OVERWORLD_DATA } from '../data/worldData';
import { NEW_ISLANDS } from '../data/worldIslands';
import {
  ARCHIPELAGO_MAP_BOUNDS,
  getArchipelagoMapCanvas,
  getDungeonMinimapCanvas,
} from '../art/mapTexture';
import type { HdTerrainBundle } from '../art/hdAssets';
import type { GameState, ZoneId } from '../game/types';

export interface MinimapCallbacks {
  onOpenWorldMap: () => void;
}

function getMinimapZoneTitle(state: GameState): string {
  if (state.zoneId !== 'overworld') {
    return DUNGEONS[state.zoneId].name;
  }
  if (state.ship.mode === 'sailing' || state.ship.mode === 'docking') {
    return 'Mer des Ronrons';
  }
  if (state.islandId !== 'felingard') {
    return NEW_ISLANDS[state.islandId].name;
  }
  return state.inVillage ? 'Miaou-bourg' : 'Île de Félingard';
}

/**
 * Minimap HUD fixe en bas à droite de l'écran :
 * - Utilise exclusivement les canvas cartographiques mis en cache (zéro régénération par frame)
 * - Vue centrée et zoomée autour du joueur sur l'archipel (zoom élargi en mer) ou plan architectural en donjon
 * - Affiche joueur orienté, voilier, coffres non ouverts, ennemis proches, boss, portails et marqueur de quête
 * - Cliquable pour ouvrir la grande Carte du Monde (M)
 */
export class MinimapController {
  private readonly container: HTMLElement;
  private readonly callbacks: MinimapCallbacks;

  private readonly rootEl: HTMLDivElement;
  private readonly buttonEl: HTMLButtonElement;
  private readonly canvasEl: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly zoneEl: HTMLSpanElement;

  private overworldMapCanvas: HTMLCanvasElement | null = null;
  private cachedDungeonId: Exclude<ZoneId, 'overworld'> | null = null;
  private dungeonMapCanvas: HTMLCanvasElement | null = null;

  private lastVisible = false;
  private lastZoneTitle = '';
  private smoothViewHalf = 46;
  private pixelWidth = 176;
  private pixelHeight = 148;
  private lastDpr = 1;
  private pulseTime = 0;

  private readonly onResize = (): void => {
    this.syncCanvasResolution();
  };

  constructor(container: HTMLElement, callbacks: MinimapCallbacks) {
    this.container = container;
    this.callbacks = callbacks;

    this.rootEl = document.createElement('div');
    this.rootEl.className = 'hud-minimap is-hidden';

    this.buttonEl = document.createElement('button');
    this.buttonEl.type = 'button';
    this.buttonEl.className = 'hud-minimap-btn';
    this.buttonEl.setAttribute('data-testid', 'hud-minimap');
    this.buttonEl.title = 'Ouvrir la Carte du Monde (M)';
    this.buttonEl.setAttribute('aria-label', 'Ouvrir la Carte du Monde (M)');
    this.buttonEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.callbacks.onOpenWorldMap();
    });

    const northBadge = document.createElement('span');
    northBadge.className = 'hud-minimap-north';
    northBadge.setAttribute('aria-hidden', 'true');
    northBadge.textContent = 'N';

    this.canvasEl = document.createElement('canvas');
    this.canvasEl.className = 'hud-minimap-canvas';
    this.canvasEl.width = 176;
    this.canvasEl.height = 148;
    this.ctx = this.canvasEl.getContext('2d');

    const footer = document.createElement('div');
    footer.className = 'hud-minimap-footer';

    this.zoneEl = document.createElement('span');
    this.zoneEl.className = 'hud-minimap-zone';
    this.zoneEl.textContent = 'Miaou-bourg';

    const keyHint = document.createElement('span');
    keyHint.className = 'hud-minimap-key';
    keyHint.textContent = 'M';

    footer.append(this.zoneEl, keyHint);
    this.buttonEl.append(northBadge, this.canvasEl, footer);
    this.rootEl.appendChild(this.buttonEl);
    this.container.appendChild(this.rootEl);

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this.onResize);
    }
    this.syncCanvasResolution();
  }

  public isVisible(): boolean {
    return this.lastVisible;
  }

  public refreshTerrain(hdTerrain?: HdTerrainBundle): void {
    if (typeof document === 'undefined') return;
    this.overworldMapCanvas = getArchipelagoMapCanvas(hdTerrain);
  }

  public update(state: GameState, dt: number): void {
    const shouldShow =
      state.screen === 'playing' &&
      state.activeModal === 'none' &&
      !state.dialogue.active;

    if (shouldShow !== this.lastVisible) {
      this.lastVisible = shouldShow;
      this.rootEl.classList.toggle('is-hidden', !shouldShow);
      if (shouldShow) {
        this.syncCanvasResolution();
      }
    }

    if (!shouldShow) return;

    this.pulseTime += Math.max(0, Math.min(0.1, dt));

    const zoneTitle = getMinimapZoneTitle(state);
    if (zoneTitle !== this.lastZoneTitle) {
      this.lastZoneTitle = zoneTitle;
      this.zoneEl.textContent = zoneTitle;
    }

    if (!this.ctx) return;

    if (state.zoneId === 'overworld') {
      this.renderOverworldMinimap(state, dt);
    } else {
      this.renderDungeonMinimap(state);
    }
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this.onResize);
    }
    this.overworldMapCanvas = null;
    this.dungeonMapCanvas = null;
    this.rootEl.remove();
  }

  private syncCanvasResolution(): void {
    if (typeof window === 'undefined') return;
    const rect = this.canvasEl.getBoundingClientRect();
    const cssW = Math.max(120, Math.round(rect.width || 176));
    const cssH = Math.max(100, Math.round(rect.height || 148));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (
      cssW === this.pixelWidth &&
      cssH === this.pixelHeight &&
      Math.abs(dpr - this.lastDpr) < 0.01
    ) {
      return;
    }
    this.pixelWidth = cssW;
    this.pixelHeight = cssH;
    this.lastDpr = dpr;
    this.canvasEl.width = Math.round(cssW * dpr);
    this.canvasEl.height = Math.round(cssH * dpr);
  }

  private renderOverworldMinimap(state: GameState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    if (!this.overworldMapCanvas) {
      this.overworldMapCanvas = getArchipelagoMapCanvas();
    }
    const src = this.overworldMapCanvas;
    const w = this.pixelWidth;
    const h = this.pixelHeight;
    const dpr = this.lastDpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Zoom adapté : plus large en mer pour anticiper les îles voisines
    const isSailing = state.ship.mode !== 'parked';
    const targetHalf = isSailing ? 78 : 44;
    const lerpAlpha = 1 - Math.exp(-Math.max(0.001, dt) * 5.0);
    this.smoothViewHalf += (targetHalf - this.smoothViewHalf) * lerpAlpha;

    const aspect = w / Math.max(1, h);
    const viewHalfZ = this.smoothViewHalf;
    const viewHalfX = viewHalfZ * aspect;

    const focusX = isSailing ? state.ship.position.x : state.player.x;
    const focusZ = isSailing ? state.ship.position.z : state.player.z;

    // Fond océan profond de sécurité hors bornes
    ctx.fillStyle = '#184b6e';
    ctx.fillRect(0, 0, w, h);

    // Projection monde -> source canvas archipel
    const b = ARCHIPELAGO_MAP_BOUNDS;
    const srcPxPerWorldX = src.width / b.spanX;
    const srcPxPerWorldZ = src.height / b.spanZ;

    const worldLeft = focusX - viewHalfX;
    const worldTop = focusZ - viewHalfZ;
    const worldWidth = viewHalfX * 2;
    const worldHeight = viewHalfZ * 2;

    const sx = (worldLeft - b.minX) * srcPxPerWorldX;
    const sy = (worldTop - b.minZ) * srcPxPerWorldZ;
    const sw = worldWidth * srcPxPerWorldX;
    const sh = worldHeight * srcPxPerWorldZ;

    // Blit propre même si la fenêtre dépasse légèrement les bornes de la carte
    const clampedSx = Math.max(0, sx);
    const clampedSy = Math.max(0, sy);
    const clampedRight = Math.min(src.width, sx + sw);
    const clampedBottom = Math.min(src.height, sy + sh);
    if (clampedRight > clampedSx && clampedBottom > clampedSy) {
      const dx = ((clampedSx - sx) / sw) * w;
      const dy = ((clampedSy - sy) / sh) * h;
      const dw = ((clampedRight - clampedSx) / sw) * w;
      const dh = ((clampedBottom - clampedSy) / sh) * h;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'medium';
      ctx.drawImage(
        src,
        clampedSx,
        clampedSy,
        clampedRight - clampedSx,
        clampedBottom - clampedSy,
        dx,
        dy,
        dw,
        dh,
      );
    }

    const toMiniX = (wx: number): number => ((wx - focusX) / viewHalfX) * (w * 0.5) + w * 0.5;
    const toMiniY = (wz: number): number => ((wz - focusZ) / viewHalfZ) * (h * 0.5) + h * 0.5;

    // 1. Marqueur Village Miaou-bourg
    const vx = toMiniX(0);
    const vy = toMiniY(22);
    if (vx >= -8 && vx <= w + 8 && vy >= -8 && vy <= h + 8) {
      ctx.fillStyle = '#f5c95d';
      ctx.strokeStyle = '#2b1e16';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(vx, vy, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 2. Portails de donjons
    for (const portal of OVERWORLD_DATA.dungeonPortals) {
      const px = toMiniX(portal.x);
      const py = toMiniY(portal.z);
      if (px < -8 || px > w + 8 || py < -8 || py > h + 8) continue;
      const isDragon = portal.targetZoneId === 'dungeon_dragon_lair';
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = isDragon ? '#d42c44' : '#8d58dc';
      ctx.strokeStyle = '#fff3cf';
      ctx.lineWidth = 1.3;
      ctx.fillRect(-3.6, -3.6, 7.2, 7.2);
      ctx.strokeRect(-3.6, -3.6, 7.2, 7.2);
      ctx.restore();
    }

    // 3. Coffres non ouverts
    for (const chest of state.chests) {
      if (chest.opened) continue;
      const cx = toMiniX(chest.x);
      const cy = toMiniY(chest.z);
      if (cx < -6 || cx > w + 6 || cy < -6 || cy > h + 6) continue;
      ctx.fillStyle = '#ffd54a';
      ctx.strokeStyle = '#3b200d';
      ctx.lineWidth = 1.1;
      ctx.fillRect(cx - 2.4, cy - 2.4, 4.8, 4.8);
      ctx.strokeRect(cx - 2.4, cy - 2.4, 4.8, 4.8);
    }

    // 4. Voilier (si non en train de naviguer directement sur le centre joueur)
    const shipX = toMiniX(state.ship.position.x);
    const shipY = toMiniY(state.ship.position.z);
    if (!isSailing && shipX >= -8 && shipX <= w + 8 && shipY >= -8 && shipY <= h + 8) {
      ctx.save();
      ctx.translate(shipX, shipY);
      ctx.fillStyle = '#fff3d1';
      ctx.strokeStyle = '#4a2b14';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(4.2, 3.5);
      ctx.lineTo(-4.2, 3.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // 5. Ennemis vivants à portée de radar
    for (const enemy of state.enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      const ex = toMiniX(enemy.x);
      const ey = toMiniY(enemy.z);
      if (ex < -6 || ex > w + 6 || ey < -6 || ey > h + 6) continue;
      ctx.fillStyle = enemy.isBoss ? '#ff334b' : '#e84848';
      ctx.strokeStyle = '#2b1010';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(ex, ey, enemy.isBoss ? 4.4 : 2.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6. Objectif de quête (étoile dorée ou flèche directionnelle sur le bord)
    if (state.questTarget) {
      let qx = state.questTarget.x;
      let qz = state.questTarget.z;
      if (state.questTarget.zoneId !== 'overworld') {
        const portal = OVERWORLD_DATA.dungeonPortals.find(
          (p) => p.targetZoneId === state.questTarget?.zoneId,
        );
        if (portal) {
          qx = portal.x;
          qz = portal.z;
        }
      }
      this.drawQuestIndicator(ctx, toMiniX(qx), toMiniY(qz), w, h);
    }

    // 7. Flèche joueur orientée (ou cap du voilier en navigation)
    const headingAngle = isSailing ? state.ship.angle : state.player.aimAngle;
    this.drawPlayerArrow(ctx, w * 0.5, h * 0.5, headingAngle, isSailing);

    // Vignette parchemin subtile sur les bords du radar
    this.drawEdgeVignette(ctx, w, h);

    ctx.restore();
  }

  private renderDungeonMinimap(state: GameState): void {
    const ctx = this.ctx;
    if (!ctx || state.zoneId === 'overworld') return;

    const dungeon = DUNGEONS[state.zoneId];
    if (this.cachedDungeonId !== state.zoneId || !this.dungeonMapCanvas) {
      this.cachedDungeonId = state.zoneId;
      this.dungeonMapCanvas = getDungeonMinimapCanvas(dungeon);
    }

    const src = this.dungeonMapCanvas;
    const w = this.pixelWidth;
    const h = this.pixelHeight;
    const dpr = this.lastDpr;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = dungeon.theme === 'dragon_lair' ? '#1c0f15' : '#161326';
    ctx.fillRect(0, 0, w, h);

    // Ajuste le plan entier du donjon avec marges propres
    const pad = 6;
    const availW = w - pad * 2;
    const availH = h - pad * 2;
    const scale = Math.min(availW / dungeon.width, availH / dungeon.depth);
    const drawW = dungeon.width * scale;
    const drawH = dungeon.depth * scale;
    const ox = (w - drawW) * 0.5;
    const oy = (h - drawH) * 0.5;

    ctx.drawImage(src, ox, oy, drawW, drawH);

    const toMiniX = (wx: number): number => ox + (wx + dungeon.width * 0.5) * scale;
    const toMiniY = (wz: number): number => oy + (wz + dungeon.depth * 0.5) * scale;

    // Coffres non ouverts
    for (const chest of state.chests) {
      if (chest.opened) continue;
      const cx = toMiniX(chest.x);
      const cy = toMiniY(chest.z);
      ctx.fillStyle = '#ffd54a';
      ctx.strokeStyle = '#3b200d';
      ctx.lineWidth = 1.1;
      ctx.fillRect(cx - 2.6, cy - 2.6, 5.2, 5.2);
      ctx.strokeRect(cx - 2.6, cy - 2.6, 5.2, 5.2);
    }

    // Ennemis & Boss du donjon
    for (const enemy of state.enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      const ex = toMiniX(enemy.x);
      const ey = toMiniY(enemy.z);
      ctx.fillStyle = enemy.isBoss ? '#ff3a52' : '#e84848';
      ctx.strokeStyle = enemy.isBoss ? '#ffe680' : '#260b10';
      ctx.lineWidth = enemy.isBoss ? 1.5 : 1.0;
      ctx.beginPath();
      ctx.arc(ex, ey, enemy.isBoss ? 4.8 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Objectif de quête si dans ce donjon
    if (state.questTarget && state.questTarget.zoneId === state.zoneId) {
      this.drawQuestIndicator(
        ctx,
        toMiniX(state.questTarget.x),
        toMiniY(state.questTarget.z),
        w,
        h,
      );
    }

    // Joueur orienté
    this.drawPlayerArrow(
      ctx,
      toMiniX(state.player.x),
      toMiniY(state.player.z),
      state.player.aimAngle,
      false,
    );

    this.drawEdgeVignette(ctx, w, h);
    ctx.restore();
  }

  private drawQuestIndicator(
    ctx: CanvasRenderingContext2D,
    qx: number,
    qy: number,
    w: number,
    h: number,
  ): void {
    const pulse = 1 + Math.sin(this.pulseTime * 5.2) * 0.16;
    const margin = 11;
    const inside = qx >= margin && qx <= w - margin && qy >= margin && qy <= h - margin;

    if (inside) {
      ctx.save();
      ctx.translate(qx, qy);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#ffe052';
      ctx.strokeStyle = '#3b210a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = (i * Math.PI) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? 5.6 : 2.5;
        const x = Math.cos(ang) * r;
        const y = Math.sin(ang) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      // Flèche dorée collée au bord pointant vers l'objectif
      const cx = w * 0.5;
      const cy = h * 0.5;
      const dx = qx - cx;
      const dy = qy - cy;
      const angle = Math.atan2(dy, dx);
      const halfW = cx - margin;
      const halfH = cy - margin;
      const tx = Math.abs(dx) > 1e-4 ? halfW / Math.abs(dx) : Infinity;
      const ty = Math.abs(dy) > 1e-4 ? halfH / Math.abs(dy) : Infinity;
      const t = Math.min(tx, ty);
      const ex = cx + dx * t;
      const ey = cy + dy * t;

      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(angle);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#ffd942';
      ctx.strokeStyle = '#3b210a';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(6.5, 0);
      ctx.lineTo(-4.5, -4.5);
      ctx.lineTo(-2.5, 0);
      ctx.lineTo(-4.5, 4.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawPlayerArrow(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    angle: number,
    isSailing: boolean,
  ): void {
    ctx.save();
    ctx.translate(x, y);

    // Halo doux pour lisibilité instantanée
    ctx.fillStyle = isSailing
      ? 'rgba(255, 224, 118, 0.35)'
      : 'rgba(59, 232, 255, 0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, 8.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(angle);
    ctx.fillStyle = isSailing ? '#ffe282' : '#40eeff';
    ctx.strokeStyle = '#1b110a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(7.2, 0);
    ctx.lineTo(-5.2, -4.8);
    ctx.lineTo(-2.8, 0);
    ctx.lineTo(-5.2, 4.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  private drawEdgeVignette(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
  ): void {
    const grad = ctx.createRadialGradient(
      w * 0.5,
      h * 0.5,
      Math.min(w, h) * 0.36,
      w * 0.5,
      h * 0.5,
      Math.hypot(w, h) * 0.55,
    );
    grad.addColorStop(0, 'rgba(30, 18, 10, 0)');
    grad.addColorStop(1, 'rgba(28, 16, 8, 0.38)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }
}
