import type {
  FloatingTextStyle,
  GameEvent,
  GameState,
} from '../game/types';
import type { ProjectedPoint } from './sceneManager';

export type FloatingTextProjector = (
  x: number,
  y: number,
  z: number,
) => ProjectedPoint;

interface ActiveFloatingText {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  age: number;
  duration: number;
  baseScale: number;
  popBoost: number;
}

interface StyleSpec {
  color: string;
  fontSize: number;
  fontWeight: string;
  fontFamily: string;
  duration: number;
  vy: number;
  popBoost: number;
}

const STYLE_SPECS: Record<FloatingTextStyle, StyleSpec> = {
  damage: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.78,
    vy: 1.9,
    popBoost: 0.25,
  },
  crit: {
    color: '#ffe047',
    fontSize: 28,
    fontWeight: '900',
    fontFamily: 'Georgia, "Palatino Linotype", serif',
    duration: 0.98,
    vy: 2.35,
    popBoost: 0.65,
  },
  spell_fire: {
    color: '#ff8833',
    fontSize: 22,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.84,
    vy: 2.0,
    popBoost: 0.35,
  },
  spell_lightning: {
    color: '#ffef5c',
    fontSize: 23,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.84,
    vy: 2.1,
    popBoost: 0.4,
  },
  spell_ice: {
    color: '#75ebff',
    fontSize: 22,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.84,
    vy: 1.9,
    popBoost: 0.3,
  },
  heal: {
    color: '#63f084',
    fontSize: 21,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.95,
    vy: 1.7,
    popBoost: 0.25,
  },
  mp: {
    color: '#66c2ff',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.82,
    vy: 1.65,
    popBoost: 0.2,
  },
  xp: {
    color: '#ffd966',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 1.15,
    vy: 1.45,
    popBoost: 0.2,
  },
  gold: {
    color: '#ffe859',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 1.15,
    vy: 1.55,
    popBoost: 0.22,
  },
  player_damage: {
    color: '#ff5252',
    fontSize: 23,
    fontWeight: '900',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.88,
    vy: 2.0,
    popBoost: 0.35,
  },
  level_up: {
    color: '#ffe566',
    fontSize: 30,
    fontWeight: '900',
    fontFamily: 'Georgia, "Palatino Linotype", serif',
    duration: 1.65,
    vy: 1.5,
    popBoost: 0.7,
  },
  info: {
    color: '#fff0b3',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'Georgia, "Palatino Linotype", serif',
    duration: 1.45,
    vy: 1.35,
    popBoost: 0.35,
  },
  status_burn: {
    color: '#ff7a2b',
    fontSize: 17,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.72,
    vy: 1.5,
    popBoost: 0.2,
  },
  status_poison: {
    color: '#7bf054',
    fontSize: 17,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.72,
    vy: 1.5,
    popBoost: 0.2,
  },
  status_bleed: {
    color: '#e84359',
    fontSize: 17,
    fontWeight: '800',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
    duration: 0.72,
    vy: 1.5,
    popBoost: 0.2,
  },
  perfect_dodge: {
    color: '#ffe66d',
    fontSize: 25,
    fontWeight: '900',
    fontFamily: 'Georgia, "Palatino Linotype", serif',
    duration: 1.15,
    vy: 2.1,
    popBoost: 0.55,
  },
  stagger_break: {
    color: '#ffaa3b',
    fontSize: 24,
    fontWeight: '900',
    fontFamily: 'Georgia, "Palatino Linotype", serif',
    duration: 1.25,
    vy: 1.9,
    popBoost: 0.5,
  },
  status_purge: {
    color: '#7ef5a8',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'Georgia, "Palatino Linotype", serif',
    duration: 1.05,
    vy: 1.7,
    popBoost: 0.35,
  },
};

const MAX_FLOATING_ITEMS = 45;

export class FloatingTextManager {
  private readonly container: HTMLElement;
  private readonly items: ActiveFloatingText[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    this.container.style.pointerEvents = 'none';
    this.container.style.overflow = 'hidden';
  }

  /**
   * Fait apparaître un texte flottant projeté depuis la position 3D `(x, y, z)`.
   */
  public spawn(
    x: number,
    y: number,
    z: number,
    text: string,
    style: FloatingTextStyle,
    duration?: number,
  ): void {
    if (!text) return;

    if (this.items.length >= MAX_FLOATING_ITEMS) {
      const oldest = this.items.shift();
      oldest?.el.remove();
    }

    const spec = STYLE_SPECS[style];
    const el = document.createElement('div');
    el.className = `floating-text floating-text--${style}`;
    el.textContent = text;
    el.style.position = 'absolute';
    el.style.left = '0';
    el.style.top = '0';
    el.style.pointerEvents = 'none';
    el.style.userSelect = 'none';
    el.style.whiteSpace = 'nowrap';
    el.style.color = spec.color;
    el.style.fontSize = `${spec.fontSize}px`;
    el.style.fontWeight = spec.fontWeight;
    el.style.fontFamily = spec.fontFamily;
    el.style.letterSpacing = style === 'level_up' || style === 'crit' ? '0.04em' : '0.01em';
    el.style.textShadow =
      '-2px -2px 0 #2b1e16, 2px -2px 0 #2b1e16, -2px 2px 0 #2b1e16, 2px 2px 0 #2b1e16, 0 3px 6px rgba(0,0,0,0.55)';
    el.style.willChange = 'transform, opacity';
    el.style.opacity = '0';

    this.container.appendChild(el);

    const jitterX = (Math.random() - 0.5) * 0.7;
    const jitterZ = (Math.random() - 0.5) * 0.4;

    this.items.push({
      el,
      x: x + jitterX,
      y,
      z: z + jitterZ,
      vx: (Math.random() - 0.5) * 0.55,
      vy: spec.vy,
      age: 0,
      duration: duration ?? spec.duration,
      baseScale: 1,
      popBoost: spec.popBoost,
    });
  }

  /**
   * Transforme automatiquement les événements de simulation (`GameEvent[]`) en textes flottants.
   */
  public processEvents(events: GameEvent[], state: GameState): void {
    for (const ev of events) {
      const px = ev.x ?? state.player.x;
      const pz = ev.z ?? state.player.z;

      switch (ev.type) {
        case 'hit_enemy': {
          if (ev.value === undefined) break;
          let style: FloatingTextStyle = 'damage';
          if (ev.isCrit) {
            style = 'crit';
          } else if (ev.spellId === 'flamepurr') {
            style = 'spell_fire';
          } else if (ev.spellId === 'lightnyan') {
            style = 'spell_lightning';
          } else if (ev.spellId === 'freezepaw') {
            style = 'spell_ice';
          }
          const label = ev.isCrit ? `${ev.value}!` : `${ev.value}`;
          this.spawn(px, 2.0, pz, label, style);
          break;
        }
        case 'hit_player': {
          if (ev.spellId === 'aegis_purr' && ev.text) {
            this.spawn(px, 2.45, pz, ev.text, 'info');
            break;
          }
          if (ev.value !== undefined) {
            this.spawn(px, 2.25, pz, `-${ev.value}`, 'player_damage');
          }
          break;
        }
        case 'mp_gain': {
          if (ev.value && ev.value > 0) {
            this.spawn(
              state.player.x + 0.35,
              2.35,
              state.player.z,
              `+${ev.value} PM`,
              'mp',
            );
          }
          break;
        }
        case 'heal_tick': {
          if (ev.value && ev.value > 0) {
            this.spawn(
              state.player.x - 0.2,
              2.45,
              state.player.z,
              `+${ev.value} PV`,
              'heal',
            );
          }
          break;
        }
        case 'spell_cast': {
          if (ev.spellId === 'healing_paw' && ev.value && ev.value > 0) {
            this.spawn(
              state.player.x,
              2.55,
              state.player.z,
              `+${ev.value} PV`,
              'heal',
            );
          } else if (ev.spellId === 'aegis_purr' && ev.value && ev.value > 0) {
            this.spawn(
              state.player.x,
              2.65,
              state.player.z,
              `Égide +${ev.value}`,
              'gold',
            );
          }
          break;
        }
        case 'gold_pickup': {
          if (ev.value && ev.value > 0) {
            this.spawn(px + 0.25, 1.75, pz, `+${ev.value} Or`, 'gold');
          }
          break;
        }
        case 'xp_pickup': {
          if (ev.value && ev.value > 0) {
            this.spawn(px - 0.25, 2.05, pz, `+${ev.value} XP`, 'xp');
          }
          break;
        }
        case 'perfect_dodge': {
          this.spawn(
            px,
            2.65,
            pz,
            ev.text ?? 'ESQUIVE PARFAITE !',
            'perfect_dodge',
          );
          break;
        }
        case 'stagger_break': {
          this.spawn(
            px,
            2.75,
            pz,
            ev.text ?? 'BRIS DE POSTURE !',
            'stagger_break',
          );
          break;
        }
        case 'status_purged': {
          this.spawn(
            px,
            2.5,
            pz,
            ev.text ?? 'PURIFIÉ !',
            'status_purge',
          );
          break;
        }
        case 'status_tick': {
          if (ev.value && ev.value > 0) {
            const stStyle: FloatingTextStyle =
              ev.statusId === 'poison'
                ? 'status_poison'
                : ev.statusId === 'bleed'
                  ? 'status_bleed'
                  : 'status_burn';
            this.spawn(px, 1.85, pz, `${ev.value}`, stStyle);
          }
          break;
        }
        case 'level_up': {
          const lvl = ev.value ?? state.player.level;
          this.spawn(
            state.player.x,
            2.9,
            state.player.z,
            `★ NIVEAU ${lvl} ! ★`,
            'level_up',
          );
          break;
        }
        case 'item_upgraded': {
          const msg =
            ev.text ??
            (ev.itemLevel ? `Amélioré Niv. ${ev.itemLevel} !` : 'Équipement amélioré !');
          this.spawn(px, 2.6, pz, msg, 'info');
          break;
        }
        case 'chest_opened': {
          break;
        }
        case 'player_rested': {
          this.spawn(
            state.player.x,
            2.5,
            state.player.z,
            'Zzz... 100 % PV & PM !',
            'heal',
            1.3,
          );
          break;
        }
        default:
          break;
      }
    }
  }

  /**
   * Met à jour l'animation et la projection 3D→2D de chaque texte flottant actif.
   */
  public update(dt: number, project: FloatingTextProjector): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.age += safeDt;

      if (item.age >= item.duration) {
        item.el.remove();
        this.items.splice(i, 1);
        continue;
      }

      const t = item.age / item.duration;
      // Ascension douce qui ralentit progressivement
      item.x += item.vx * safeDt;
      item.y += item.vy * (1 - t * 0.55) * safeDt;

      const proj = project(item.x, item.y, item.z);
      if (!proj.visible) {
        item.el.style.opacity = '0';
        continue;
      }

      // Courbe de pop élastique à l'apparition + fondu sur le dernier tiers
      const pop =
        t < 0.16
          ? item.baseScale + Math.sin((t / 0.16) * Math.PI) * item.popBoost
          : item.baseScale;
      const opacity = t > 0.65 ? Math.max(0, 1 - (t - 0.65) / 0.35) : 1;

      item.el.style.opacity = opacity.toFixed(3);
      item.el.style.transform = `translate3d(${proj.x.toFixed(1)}px, ${proj.y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${pop.toFixed(3)})`;
    }
  }

  public clear(): void {
    for (const item of this.items) {
      item.el.remove();
    }
    this.items.length = 0;
  }

  public dispose(): void {
    this.clear();
  }
}
