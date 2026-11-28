import type { MusicTrackId } from '../game/types';
import { resolveAssetUrl } from '../art/hdAssets';
import { AUDIO_MUSIC_TRACKS } from './audioManifest';

const MUSIC_FILES: Record<MusicTrackId, string> = {
  menu: AUDIO_MUSIC_TRACKS.menu.path,
  overworld: AUDIO_MUSIC_TRACKS.overworld.path,
  maritime: AUDIO_MUSIC_TRACKS.maritime.path,
  dungeon: AUDIO_MUSIC_TRACKS.dungeon.path,
  combat: AUDIO_MUSIC_TRACKS.combat.path,
  boss: AUDIO_MUSIC_TRACKS.boss.path,
  boss_phase2: AUDIO_MUSIC_TRACKS.boss_phase2.path,
  victory: AUDIO_MUSIC_TRACKS.victory.path,
};

const TRACK_GAIN_SCALE: Record<MusicTrackId, number> = {
  menu: AUDIO_MUSIC_TRACKS.menu.defaultGain,
  overworld: AUDIO_MUSIC_TRACKS.overworld.defaultGain,
  maritime: 1.25, // Gain augmenté dédié pour Le Patte-au-Vent au-dessus des vagues
  dungeon: AUDIO_MUSIC_TRACKS.dungeon.defaultGain,
  combat: 0.98,
  boss: AUDIO_MUSIC_TRACKS.boss.defaultGain,
  boss_phase2: 1.08,
  victory: 1.04,
};

interface MusicVoice {
  theme: MusicTrackId;
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopping: boolean;
}

/** Lecteur de pistes locales en boucle avec crossfade Web Audio fluide sans coupure ni superposition parasite. */
export class LocalMusicPlayer {
  private readonly ctx: AudioContext;
  private readonly destination: AudioNode;
  private readonly buffers = new Map<MusicTrackId, AudioBuffer>();
  private readonly voices = new Set<MusicVoice>();
  private desiredTheme: MusicTrackId | null = null;
  private currentTheme: MusicTrackId | null = null;
  private disposed = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
    void this.loadTracks();
  }

  public getCurrentTheme(): MusicTrackId | null {
    return this.currentTheme;
  }

  public setTheme(theme: MusicTrackId | null, fadeSeconds = 1.35): void {
    if (this.disposed) return;
    this.desiredTheme = theme;
    if (theme === this.currentTheme && theme !== null) {
      // Déjà actif : ne pas relancer ni couper la piste en cours
      const hasActiveVoice = Array.from(this.voices).some(
        (v) => v.theme === theme && !v.stopping,
      );
      if (hasActiveVoice) return;
    }

    const now = this.ctx.currentTime;
    const fade = Math.max(0.08, fadeSeconds);

    // Fondu sortant doux sur toutes les voix précédentes
    for (const voice of this.voices) {
      if (voice.stopping) continue;
      voice.stopping = true;
      const param = voice.gain.gain;
      param.cancelScheduledValues(now);
      const currentVal = Math.max(0.0001, param.value);
      param.setValueAtTime(currentVal, now);
      param.linearRampToValueAtTime(0, now + fade);
      try {
        voice.source.stop(now + fade + 0.05);
      } catch {
        // Source déjà arrêtée lors d'une transition rapide
      }
    }

    this.currentTheme = theme;
    if (theme) {
      this.startTheme(theme, fade, now);
    }
  }

  public dispose(): void {
    this.disposed = true;
    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {
        // Une source déjà terminée n'a plus rien à libérer.
      }
      try {
        voice.source.disconnect();
        voice.gain.disconnect();
      } catch {
        // Ignore
      }
    }
    this.voices.clear();
    this.buffers.clear();
  }

  private async loadTracks(): Promise<void> {
    if (typeof fetch !== 'function') return;
    const ids = Object.keys(MUSIC_FILES) as MusicTrackId[];
    await Promise.all(
      ids.map(async (id) => {
        try {
          const response = await fetch(resolveAssetUrl(MUSIC_FILES[id]));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const bytes = await response.arrayBuffer();
          if (this.disposed) return;
          const buffer = await this.decodeAudioSafe(bytes);
          if (!buffer || this.disposed) return;
          this.buffers.set(id, buffer);
          if (id === this.desiredTheme) {
            const hasActiveForDesired = Array.from(this.voices).some(
              (v) => v.theme === id && !v.stopping,
            );
            if (!hasActiveForDesired) {
              this.currentTheme = null;
              this.setTheme(id, 0.9);
            }
          }
        } catch {
          // Dégradation propre sans planter si une piste locale échoue
        }
      }),
    );
  }

  private decodeAudioSafe(bytes: ArrayBuffer): Promise<AudioBuffer | null> {
    return new Promise((resolve) => {
      try {
        const res = this.ctx.decodeAudioData(
          bytes.slice(0),
          (buf) => resolve(buf),
          () => resolve(null),
        );
        if (res && typeof res.then === 'function') {
          res.then(
            (buf) => resolve(buf),
            () => resolve(null),
          );
        }
      } catch {
        resolve(null);
      }
    });
  }

  private startTheme(theme: MusicTrackId, fade: number, now: number): void {
    const buffer = this.buffers.get(theme);
    if (!buffer || this.disposed) return;

    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = AUDIO_MUSIC_TRACKS[theme]?.loop ?? true;

    const targetGain = TRACK_GAIN_SCALE[theme] ?? 1.0;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(targetGain, now + fade);

    source.connect(gain);
    gain.connect(this.destination);

    const voice: MusicVoice = { theme, source, gain, stopping: false };
    this.voices.add(voice);
    source.addEventListener(
      'ended',
      () => {
        this.voices.delete(voice);
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          // Ignore
        }
      },
      { once: true },
    );
    source.start(now);
  }
}
