import {
  AUDIO_PREFS_STORAGE_KEY,
  type AudioPrefs,
  type GameEvent,
  type MusicTrackId,
  type SfxId,
  type SpellId,
  type StorageAdapter,
} from '../game/types';
import { LocalMusicPlayer } from './localMusic';
import { playProceduralSfx } from './sfxSynth';
import {
  WeatherAudioController,
  type WeatherAudioState,
  type WeatherAudioStatus,
} from './weatherAudio';

export type { WeatherAudioState, WeatherAudioStatus } from './weatherAudio';

const DEFAULT_VOLUME = 0.85;
const DEFAULT_SFX_BUS_GAIN = 0.78;
const DEFAULT_BGM_BUS_GAIN = 0.18;
const DEFAULT_WEATHER_BUS_GAIN = 0.42;

// Délai minimal (ms) par SFX pour éviter le stacking agressif sur coups multiples simultanés
const SFX_MIN_INTERVAL_MS: Partial<Record<SfxId, number>> = {
  sword_hit: 35,
  crit_hit: 40,
  coin_pickup: 45,
  player_hurt: 80,
};

function getBrowserStorage(): StorageAdapter | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Mode privé ou stockage indisponible
  }
  return null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_VOLUME;
  return Math.max(0, Math.min(1, value));
}

function getAudioContextCtor(): (new () => AudioContext) | null {
  if (typeof window === 'undefined') return null;
  const win = globalThis as typeof globalThis & {
    webkitAudioContext?: new () => AudioContext;
  };
  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

function mapSpellToSfx(spellId: SpellId | undefined): SfxId | null {
  switch (spellId) {
    case 'flamepurr':
      return 'spell_fire';
    case 'lightnyan':
      return 'spell_lightning';
    case 'freezepaw':
      return 'spell_ice';
    case 'healing_paw':
      return 'spell_heal';
    case 'aegis_purr':
      return 'spell_heal';
    case 'pounce_dash':
      return 'dodge_whoosh';
    case 'meteor_paw':
      return 'spell_fire';
    default:
      return null;
  }
}

/**
 * Moteur audio (Web Audio API) :
 * - Création / reprise automatique de l'AudioContext sur 1re interaction utilisateur
 * - Hiérarchie masterGain / sfxGain / bgmGain / weatherGain + compresseur anti-saturation
 * - Persistance des préférences dans localStorage (felingard_audio_prefs_v1)
 * - 14 SFX procéduraux + 3 pistes locales avec crossfade doux
 * - Ambiances météo & maritimes locales (mer, vent, pluie, tonnerre) avec repli procédural
 */
export class AudioEngine {
  private readonly storage: StorageAdapter | null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private bgmGain: GainNode | null = null;
  private weatherGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private musicPlayer: LocalMusicPlayer | null = null;
  private weatherAudio: WeatherAudioController | null = null;

  private prefs: AudioPrefs;
  private desiredTheme: MusicTrackId | null = null;
  private lastWeatherState: WeatherAudioState | null = null;
  private lastSfxTimestamp: Partial<Record<SfxId, number>> = {};
  private unlockListenersBound = false;
  private disposed = false;

  private readonly onFirstGesture = (): void => {
    this.unlock();
  };

  constructor(storage?: StorageAdapter) {
    this.storage = storage ?? getBrowserStorage();
    this.prefs = this.loadPrefs();
    this.bindUnlockListeners();
  }

  public isUnlocked(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  public isMuted(): boolean {
    return this.prefs.muted;
  }

  public getVolume(): number {
    return this.prefs.volume;
  }

  public getPrefs(): AudioPrefs {
    return { ...this.prefs };
  }

  public getMusicTheme(): MusicTrackId | null {
    return this.desiredTheme;
  }

  /**
   * Initialise ou reprend l'AudioContext (appelé automatiquement sur 1re interaction).
   */
  public unlock(): void {
    if (this.disposed) return;

    if (!this.ctx) {
      const Ctor = getAudioContextCtor();
      if (!Ctor) return;

      try {
        const ctx = new Ctor();
        const masterGain = ctx.createGain();
        const sfxGain = ctx.createGain();
        const bgmGain = ctx.createGain();
        const weatherGain = ctx.createGain();
        const compressor = ctx.createDynamicsCompressor();

        compressor.threshold.setValueAtTime(-12, ctx.currentTime);
        compressor.knee.setValueAtTime(16, ctx.currentTime);
        compressor.ratio.setValueAtTime(4, ctx.currentTime);
        compressor.attack.setValueAtTime(0.005, ctx.currentTime);
        compressor.release.setValueAtTime(0.15, ctx.currentTime);

        sfxGain.gain.setValueAtTime(DEFAULT_SFX_BUS_GAIN, ctx.currentTime);
        bgmGain.gain.setValueAtTime(DEFAULT_BGM_BUS_GAIN, ctx.currentTime);
        weatherGain.gain.setValueAtTime(DEFAULT_WEATHER_BUS_GAIN, ctx.currentTime);

        sfxGain.connect(masterGain);
        bgmGain.connect(masterGain);
        weatherGain.connect(masterGain);
        masterGain.connect(compressor);
        compressor.connect(ctx.destination);

        this.ctx = ctx;
        this.masterGain = masterGain;
        this.sfxGain = sfxGain;
        this.bgmGain = bgmGain;
        this.weatherGain = weatherGain;
        this.compressor = compressor;
        this.musicPlayer = new LocalMusicPlayer(ctx, bgmGain);
        this.weatherAudio = new WeatherAudioController(ctx, weatherGain);
        this.weatherAudio.startLoading();

        this.applyMasterGain(true);
      } catch {
        return;
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx
        .resume()
        .then(() => {
          this.onContextRunning();
        })
        .catch(() => {
          // Le navigateur peut refuser hors geste direct ; on retentera au prochain geste
        });
    } else if (this.ctx && this.ctx.state === 'running') {
      this.onContextRunning();
    }
  }

  /**
   * Bascule l'état muet et persiste dans localStorage. Retourne le nouvel état muted.
   */
  public toggleMute(): boolean {
    this.unlock();
    this.prefs.muted = !this.prefs.muted;
    this.applyMasterGain(false);
    this.savePrefs();
    return this.prefs.muted;
  }

  public setMuted(muted: boolean): void {
    this.prefs.muted = muted;
    this.applyMasterGain(false);
    this.savePrefs();
  }

  /**
   * Définit le volume global (0..1) et persiste dans localStorage.
   */
  public setVolume(volume: number): void {
    this.prefs.volume = clamp01(volume);
    if (this.prefs.volume > 0 && this.prefs.muted) {
      this.prefs.muted = false;
    }
    this.applyMasterGain(false);
    this.savePrefs();
  }

  /**
   * Joue l'un des 14 effets sonores procéduraux.
   */
  public playSfx(name: SfxId): void {
    if (this.disposed || this.prefs.muted || this.prefs.volume <= 0.001) {
      return;
    }
    if (!this.ctx || !this.sfxGain || this.ctx.state !== 'running') {
      return;
    }

    const minInterval = SFX_MIN_INTERVAL_MS[name] ?? 0;
    if (minInterval > 0) {
      const nowMs = performance.now();
      const prevMs = this.lastSfxTimestamp[name] ?? 0;
      if (nowMs - prevMs < minInterval) {
        return;
      }
      this.lastSfxTimestamp[name] = nowMs;
    }

    playProceduralSfx(this.ctx, this.sfxGain, name);
  }

  /**
   * Définit le thème musical actif ('overworld' | 'dungeon' | 'boss' | null)
   * avec crossfade doux de 0.6 s.
   */
  public setMusicTheme(theme: MusicTrackId | null): void {
    if (this.disposed) return;
    this.desiredTheme = theme;
    if (this.musicPlayer && this.ctx && this.ctx.state === 'running') {
      this.musicPlayer.setTheme(theme, 0.8);
    }
  }

  /**
   * Met à jour les ambiances météo & maritimes (mer, vent, pluie) avec transitions lissées.
   * Sans effet réseau ou WebAudio avant `unlock()` ou en environnement Node/Vitest.
   */
  public updateWeatherAmbience(state: WeatherAudioState, dt: number): void {
    if (this.disposed) return;
    this.lastWeatherState = { ...state };
    if (this.weatherAudio && this.ctx && this.ctx.state === 'running') {
      this.weatherAudio.update(state, dt);
    }
  }

  /**
   * Déclenche un coup de tonnerre one-shot (respecte muted, volume, inOverworld et ctx running).
   */
  public triggerThunder(intensity = 1.0): void {
    if (this.disposed || this.prefs.muted || this.prefs.volume <= 0.001) {
      return;
    }
    if (!this.ctx || !this.weatherAudio || this.ctx.state !== 'running') {
      return;
    }
    if (this.lastWeatherState && !this.lastWeatherState.inOverworld) {
      return;
    }
    this.weatherAudio.triggerThunder(intensity);
  }

  /**
   * Retourne l'état courant des pistes météo chargées, en repli, gains actifs et compteur tonnerre.
   */
  public getWeatherAudioStatus(): WeatherAudioStatus {
    if (!this.weatherAudio) {
      return {
        loadedTracks: [],
        fallbackTracks: [],
        activeGains: { ocean: 0, wind: 0, rain: 0 },
        thunderCount: 0,
      };
    }
    return this.weatherAudio.getStatus();
  }

  /**
   * Traduit un lot d'événements de simulation en effets sonores adaptés.
   */
  public handleEvents(events: readonly GameEvent[]): void {
    if (this.disposed || events.length === 0) return;

    let playedChest = false;
    let playedLevelUp = false;
    let playedMeow = false;

    for (const ev of events) {
      switch (ev.type) {
        case 'melee_swing':
          this.playSfx('sword_swing');
          break;
        case 'hit_enemy':
          this.playSfx(ev.isCrit ? 'crit_hit' : 'sword_hit');
          break;
        case 'hit_player':
          this.playSfx('player_hurt');
          break;
        case 'enemy_died':
          this.playSfx('coin_pickup');
          break;
        case 'spell_cast': {
          const sfx = mapSpellToSfx(ev.spellId);
          if (sfx) this.playSfx(sfx);
          break;
        }
        case 'dodge_roll':
          this.playSfx('dodge_whoosh');
          break;
        case 'level_up':
          if (!playedLevelUp) {
            this.playSfx('level_up');
            playedLevelUp = true;
          }
          break;
        case 'chest_opened':
          if (!playedChest) {
            this.playSfx('chest_open');
            playedChest = true;
          }
          break;
        case 'item_upgraded':
          if (!playedChest) {
            this.playSfx('chest_open');
            playedChest = true;
          }
          break;
        case 'quest_updated':
          if (!playedMeow) {
            this.playSfx('meow_ui');
            playedMeow = true;
          }
          break;
        case 'quest_completed':
          if (!playedLevelUp) {
            this.playSfx('level_up');
            playedLevelUp = true;
          }
          break;
        case 'player_rested':
        case 'dialogue_started':
          if (!playedMeow) {
            this.playSfx('meow_ui');
            playedMeow = true;
          }
          break;
        case 'boss_phase_two':
          this.playSfx('boss_roar');
          break;
        case 'player_died':
          this.playSfx('player_hurt');
          break;
        case 'victory':
          if (!playedLevelUp) {
            this.playSfx('level_up');
            playedLevelUp = true;
          }
          break;
        case 'zone_transition':
        case 'heal_tick':
        case 'mp_gain':
        case 'telegraph_impact':
        case 'toast':
          break;
      }
    }
  }

  public dispose(): void {
    this.disposed = true;
    this.unbindUnlockListeners();
    if (this.musicPlayer) {
      this.musicPlayer.dispose();
      this.musicPlayer = null;
    }
    if (this.weatherAudio) {
      this.weatherAudio.dispose();
      this.weatherAudio = null;
    }
    this.lastWeatherState = null;
    for (const node of [
      this.sfxGain,
      this.bgmGain,
      this.weatherGain,
      this.masterGain,
      this.compressor,
    ]) {
      if (node) {
        try {
          node.disconnect();
        } catch {
          // Ignore
        }
      }
    }
    this.masterGain = null;
    this.sfxGain = null;
    this.bgmGain = null;
    this.weatherGain = null;
    this.compressor = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => {
        // Ignore
      });
      this.ctx = null;
    }
  }

  private onContextRunning(): void {
    this.unbindUnlockListeners();
    this.applyMasterGain(false);
    if (this.musicPlayer && this.desiredTheme !== null) {
      this.musicPlayer.setTheme(this.desiredTheme, 0.8);
    }
    if (this.weatherAudio) {
      if (this.lastWeatherState) {
        this.weatherAudio.update(this.lastWeatherState, 0.016);
      } else {
        this.weatherAudio.syncCurrentState();
      }
    }
  }

  private applyMasterGain(immediate: boolean): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this.prefs.muted ? 0 : this.prefs.volume;
    const gainParam = this.masterGain.gain;
    gainParam.cancelScheduledValues(now);
    if (immediate) {
      gainParam.setValueAtTime(target, now);
    } else {
      gainParam.setValueAtTime(gainParam.value, now);
      gainParam.linearRampToValueAtTime(target, now + 0.04);
    }
  }

  private bindUnlockListeners(): void {
    if (this.unlockListenersBound || typeof window === 'undefined') return;
    this.unlockListenersBound = true;
    window.addEventListener('pointerdown', this.onFirstGesture, { passive: true });
    window.addEventListener('keydown', this.onFirstGesture, { passive: true });
  }

  private unbindUnlockListeners(): void {
    if (!this.unlockListenersBound || typeof window === 'undefined') return;
    this.unlockListenersBound = false;
    window.removeEventListener('pointerdown', this.onFirstGesture);
    window.removeEventListener('keydown', this.onFirstGesture);
  }

  private loadPrefs(): AudioPrefs {
    const fallback: AudioPrefs = { muted: false, volume: DEFAULT_VOLUME };
    if (!this.storage) return fallback;
    try {
      const raw = this.storage.getItem(AUDIO_PREFS_STORAGE_KEY);
      if (!raw) return fallback;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return fallback;
      const obj = parsed as Partial<AudioPrefs>;
      return {
        muted: typeof obj.muted === 'boolean' ? obj.muted : false,
        volume: typeof obj.volume === 'number' ? clamp01(obj.volume) : DEFAULT_VOLUME,
      };
    } catch {
      return fallback;
    }
  }

  private savePrefs(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(AUDIO_PREFS_STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      // Stockage plein ou bloqué
    }
  }
}
