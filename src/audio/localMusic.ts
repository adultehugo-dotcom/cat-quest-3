import type { MusicTrackId } from '../game/types';
import { resolveAssetUrl } from '../art/hdAssets';

const MUSIC_FILES: Record<MusicTrackId, string> = {
  overworld: 'assets/audio/music/overworld.wav',
  dungeon: 'assets/audio/music/dungeon.ogg',
  boss: 'assets/audio/music/boss.mp3',
};

interface MusicVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

/** Lecteur de pistes locales en boucle avec crossfade Web Audio. */
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

  public setTheme(theme: MusicTrackId | null, fadeSeconds = 0.8): void {
    if (this.disposed) return;
    this.desiredTheme = theme;
    if (theme === this.currentTheme && theme !== null) return;

    const now = this.ctx.currentTime;
    const fade = Math.max(0.05, fadeSeconds);
    for (const voice of this.voices) {
      const param = voice.gain.gain;
      param.cancelScheduledValues(now);
      param.setValueAtTime(param.value, now);
      param.linearRampToValueAtTime(0, now + fade);
      try {
        voice.source.stop(now + fade + 0.04);
      } catch {
        // La source a déjà été arrêtée lors d'un changement de thème rapide.
      }
    }
    this.voices.clear();
    this.currentTheme = theme;
    if (theme) this.startTheme(theme, fade, now);
  }

  public dispose(): void {
    this.disposed = true;
    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {
        // Une source déjà terminée n'a plus rien à libérer.
      }
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    this.buffers.clear();
  }

  private async loadTracks(): Promise<void> {
    const ids = Object.keys(MUSIC_FILES) as MusicTrackId[];
    await Promise.all(ids.map(async (id) => {
      try {
        const response = await fetch(resolveAssetUrl(MUSIC_FILES[id]));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const bytes = await response.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(bytes);
        if (this.disposed) return;
        this.buffers.set(id, buffer);
        if (id === this.desiredTheme && !this.voices.size) {
          this.currentTheme = null;
          this.setTheme(id, 0.8);
        }
      } catch (error) {
        console.error(`[Félingard] Impossible de charger la musique locale « ${id} ».`, error);
      }
    }));
  }

  private startTheme(theme: MusicTrackId, fade: number, now: number): void {
    const buffer = this.buffers.get(theme);
    if (!buffer || this.disposed) return;
    const source = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = true;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fade);
    source.connect(gain);
    gain.connect(this.destination);
    const voice = { source, gain };
    this.voices.add(voice);
    source.addEventListener('ended', () => {
      this.voices.delete(voice);
      source.disconnect();
      gain.disconnect();
    }, { once: true });
    source.start(now);
  }
}
