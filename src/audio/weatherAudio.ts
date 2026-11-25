// ============================================================================
// Ambiances météo & maritimes locales (Web Audio API + repli procédural)
// - Charge uniquement des assets locaux vérifiés dans public/assets/audio/weather/
// - Bouclage sans couture par crossfade égal-puissance sur l'AudioBuffer décodé
// - Transitions douces (setTargetAtTime) entre temps calme, brouillard, tempête et donjon
// - Repli procédural Web Audio propre en cas d'indisponibilité de fetch / decodeAudioData
// ============================================================================

export interface WeatherAudioState {
  inOverworld: boolean;
  stormIntensity: number; // [0..1]
  fogIntensity: number;   // [0..1]
  rainIntensity: number;  // [0..1]
  windIntensity: number;  // [0..1]
  seaAgitation: number;   // [0..1]
  seaProximity: number;   // [0..1] (1 en mer / plage, ~0.35 centre d'île)
  shipSpeedRatio: number; // [0..1]
}

export interface WeatherAudioStatus {
  readonly loadedTracks: readonly string[];
  readonly fallbackTracks: readonly string[];
  readonly activeGains: Readonly<{ ocean: number; wind: number; rain: number }>;
  readonly thunderCount: number;
}

export type WeatherLoopTrackId = 'ocean' | 'wind' | 'rain';
export type WeatherTrackId = WeatherLoopTrackId | 'thunder';

const WEATHER_TRACK_ORDER: readonly WeatherTrackId[] = [
  'ocean',
  'wind',
  'rain',
  'thunder',
];

const WEATHER_LOOP_TRACKS: readonly WeatherLoopTrackId[] = [
  'ocean',
  'wind',
  'rain',
];

// Fichiers locaux présents dans public/assets/audio/weather/ (zéro URL externe, zéro 404)
const WEATHER_ASSET_FILES: Readonly<Record<WeatherTrackId, string>> = {
  ocean: 'assets/audio/weather/ocean_waves.ogg',
  wind: 'assets/audio/weather/wind_gale.ogg',
  rain: 'assets/audio/weather/rain_storm.ogg',
  thunder: 'assets/audio/weather/thunder_clap.ogg',
};

const LOOP_CROSSFADE_SEC = 0.35;
const GAIN_TAU_WEATHER_SEC = 0.55;
const GAIN_TAU_FADE_OUT_SEC = 0.35;
const FILTER_TAU_SEC = 0.5;
const RATE_TAU_SEC = 0.65;
const THUNDER_MIN_INTERVAL_MS = 180;
const THUNDER_BASE_GAIN = 1.12;
const THUNDER_MAX_CONCURRENT = 3;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function resolveWeatherAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base =
    metaEnv && typeof metaEnv.BASE_URL === 'string' ? metaEnv.BASE_URL : './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${clean}`;
}

/**
 * Construit un AudioBuffer bouclable 100 % sans couture grâce à un crossfade
 * à puissance constante (cos/sin) entre la fin et le début du buffer décodé.
 * Cela élimine tout clic ou résidu de padding codec lors du bouclage `loop = true`.
 */
function makeSeamlessLoopBuffer(
  ctx: AudioContext,
  source: AudioBuffer,
  crossfadeSec: number,
): AudioBuffer {
  const sampleRate = source.sampleRate;
  const channels = source.numberOfChannels;
  const totalFrames = source.length;
  const xfadeFrames = Math.min(
    Math.floor(crossfadeSec * sampleRate),
    Math.floor(totalFrames / 4),
  );

  if (xfadeFrames < 32 || totalFrames <= xfadeFrames * 2) {
    return source;
  }

  const outFrames = totalFrames - xfadeFrames;
  const result = ctx.createBuffer(channels, outFrames, sampleRate);

  for (let ch = 0; ch < channels; ch += 1) {
    const src = source.getChannelData(ch);
    const dst = result.getChannelData(ch);

    // Zone de couture [0 .. xfadeFrames) : fondu égal-puissance queue -> tête
    for (let i = 0; i < xfadeFrames; i += 1) {
      const t = i / xfadeFrames;
      const gTail = Math.cos(t * Math.PI * 0.5);
      const gHead = Math.sin(t * Math.PI * 0.5);
      dst[i] = src[outFrames + i] * gTail + src[i] * gHead;
    }

    // Corps intact [xfadeFrames .. outFrames)
    dst.set(src.subarray(xfadeFrames, outFrames), xfadeFrames);
  }

  return result;
}

/**
 * Synthétise un buffer stéréo bouclable sans couture en repli procédural
 * (bruit brun/rose filtré + modulation organique lente) si l'asset local ne peut pas être décodé.
 */
function createProceduralLoopBuffer(
  ctx: AudioContext,
  track: WeatherLoopTrackId,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const durationSec = track === 'rain' ? 5.0 : 6.0;
  const rawFrames = Math.floor(sampleRate * (durationSec + LOOP_CROSSFADE_SEC));
  const rawBuffer = ctx.createBuffer(2, rawFrames, sampleRate);

  for (let ch = 0; ch < 2; ch += 1) {
    const data = rawBuffer.getChannelData(ch);
    // États filtre bruit rose (Paul Kellet) + intégrateur bruit brun
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    let brown = 0;
    let prev = 0;
    const phaseOffset = ch === 0 ? 0 : 1.73;

    for (let i = 0; i < rawFrames; i += 1) {
      const t = i / sampleRate;
      const white = Math.random() * 2 - 1;

      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.045;
      b6 = white * 0.115926;

      brown = (brown + 0.024 * white) / 1.024;
      const brownScaled = brown * 0.42;

      if (track === 'ocean') {
        // Houle lente (~0.17 Hz) + écume douce sur les crêtes
        const swell =
          0.62 +
          0.32 * Math.sin(2 * Math.PI * (1 / durationSec) * t + phaseOffset) +
          0.12 * Math.sin(2 * Math.PI * (2 / durationSec) * t + phaseOffset * 0.5);
        data[i] = (brownScaled * 0.65 + pink * 0.55) * swell * 0.72;
      } else if (track === 'wind') {
        // Rafales fluides modulées
        const gust =
          0.68 +
          0.26 * Math.sin(2 * Math.PI * (1 / durationSec) * t + phaseOffset) +
          0.14 * Math.sin(2 * Math.PI * (3 / durationSec) * t - phaseOffset);
        const soft = pink * 0.82 + brownScaled * 0.25;
        data[i] = soft * gust * 0.68;
      } else {
        // Pluie régulière : spectre fin + micro-texture de gouttes
        const hpWhite = (white - prev * 0.45) * 0.085;
        prev = white;
        data[i] = (pink * 0.68 + hpWhite * 0.55) * 0.75;
      }
    }
  }

  return makeSeamlessLoopBuffer(ctx, rawBuffer, LOOP_CROSSFADE_SEC);
}

interface LoopChannelNodes {
  filter: BiquadFilterNode;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
}

interface ComputedWeatherMix {
  oceanGain: number;
  windGain: number;
  rainGain: number;
  oceanCutoffHz: number;
  windCutoffHz: number;
  rainCutoffHz: number;
  oceanRate: number;
  windRate: number;
  rainRate: number;
}

function computeWeatherMix(state: WeatherAudioState): ComputedWeatherMix {
  if (!state.inOverworld) {
    return {
      oceanGain: 0,
      windGain: 0,
      rainGain: 0,
      oceanCutoffHz: 900,
      windCutoffHz: 900,
      rainCutoffHz: 2400,
      oceanRate: 1.0,
      windRate: 1.0,
      rainRate: 1.0,
    };
  }

  const storm = clamp01(state.stormIntensity);
  const fog = clamp01(state.fogIntensity);
  const rain = clamp01(state.rainIntensity);
  const wind = clamp01(state.windIntensity);
  const agitation = clamp01(state.seaAgitation);
  const proximity = clamp01(state.seaProximity);
  const shipSpeed = clamp01(state.shipSpeedRatio);

  // Mer : toujours perceptible au centre d'île (~0.35), ample sur plage et en mer (1.0)
  const proximityScale = 0.22 + 0.78 * proximity;
  const fogOceanAtten = 1 - 0.18 * fog * (1 - storm);
  const oceanGain = clamp(
    (0.32 + 0.36 * agitation + 0.14 * storm + 0.12 * shipSpeed * proximity) *
      proximityScale *
      fogOceanAtten,
    0,
    0.82,
  );

  // Vent : légère brise calme, souffle feutré dans le brouillard, rafales soutenues en tempête / navigation
  const windActive =
    wind > 0.01 || storm > 0.01 || fog > 0.01 || shipSpeed > 0.01;
  const windGain = windActive
    ? clamp(
        0.05 +
          0.46 * wind +
          0.14 * storm +
          0.08 * fog * (1 - storm) +
          0.14 * shipSpeed,
        0,
        0.74,
      )
    : 0;

  // Pluie : silencieuse hors averse, montée progressive et naturelle vers pluie dense
  const rainGain =
    rain <= 0.01 ? 0 : clamp(Math.pow(rain, 0.85) * (0.64 + 0.08 * storm), 0, 0.74);

  // Filtrage fréquentiel dynamique : mer sourde en brouillard, spectre ouvert en tempête
  const fogOceanMuffle = 1 - 0.72 * fog * (1 - 0.65 * storm);
  const oceanCutoffHz = clamp(
    (1400 + 2600 * proximity + 4800 * Math.max(agitation, storm)) * fogOceanMuffle,
    550,
    11000,
  );

  const fogWindMuffle = 1 - 0.45 * fog * (1 - 0.7 * storm);
  const windCutoffHz = clamp(
    (1100 + 3800 * wind + 1400 * storm + 600 * shipSpeed) * fogWindMuffle,
    650,
    8500,
  );

  const fogRainMuffle = 1 - 0.22 * fog;
  const rainCutoffHz = clamp(
    (3400 + 5000 * rain + 800 * storm) * fogRainMuffle,
    2200,
    11000,
  );

  // Légère modulation de vitesse de lecture pour renforcer la nervosité en tempête / navigation
  const oceanRate = clamp(0.96 + 0.11 * agitation + 0.04 * shipSpeed, 0.9, 1.14);
  const windRate = clamp(0.94 + 0.14 * wind + 0.06 * shipSpeed, 0.9, 1.16);
  const rainRate = clamp(0.96 + 0.08 * storm, 0.92, 1.08);

  return {
    oceanGain,
    windGain,
    rainGain,
    oceanCutoffHz,
    windCutoffHz,
    rainCutoffHz,
    oceanRate,
    windRate,
    rainRate,
  };
}

/**
 * Contrôleur des ambiances météo & maritimes (mer, vent, pluie, tonnerre).
 * Connecté sur le bus `weatherGain` de l'`AudioEngine`.
 */
export class WeatherAudioController {
  private readonly ctx: AudioContext;
  private readonly outputNode: GainNode;
  private readonly channels: Record<WeatherLoopTrackId, LoopChannelNodes>;
  private readonly buffers: Partial<Record<WeatherTrackId, AudioBuffer>> = {};
  private readonly trackState: Record<
    WeatherTrackId,
    'idle' | 'loading' | 'loaded' | 'fallback'
  > = {
    ocean: 'idle',
    wind: 'idle',
    rain: 'idle',
    thunder: 'idle',
  };

  private readonly activeThunderNodes = new Set<AudioNode>();
  private proceduralThunderBuffer: AudioBuffer | null = null;
  private abortController: AbortController | null = null;
  private loadingStarted = false;
  private disposed = false;

  private lastState: WeatherAudioState | null = null;
  private currentMix: ComputedWeatherMix = {
    oceanGain: 0,
    windGain: 0,
    rainGain: 0,
    oceanCutoffHz: 2400,
    windCutoffHz: 1800,
    rainCutoffHz: 5000,
    oceanRate: 1.0,
    windRate: 1.0,
    rainRate: 1.0,
  };

  private smoothedGains = { ocean: 0, wind: 0, rain: 0 };
  private thunderCount = 0;
  private lastThunderMs = -Infinity;

  constructor(ctx: AudioContext, weatherBusGain: GainNode) {
    this.ctx = ctx;
    this.outputNode = weatherBusGain;

    this.channels = {
      ocean: this.createLoopChannel(2400),
      wind: this.createLoopChannel(1800),
      rain: this.createLoopChannel(5000),
    };
  }

  /**
   * Lance le chargement asynchrone local des 4 pistes météo (une seule fois, après création de l'AudioContext).
   * Ne rejette jamais de promesse et n'émet aucune erreur console.
   */
  public startLoading(): void {
    if (this.disposed || this.loadingStarted) return;
    this.loadingStarted = true;

    if (typeof AbortController !== 'undefined') {
      this.abortController = new AbortController();
    }

    for (const track of WEATHER_TRACK_ORDER) {
      void this.loadTrackSafe(track);
    }
  }

  /**
   * Met à jour en douceur les volumes, filtres et vitesses des couches météo.
   */
  public update(state: WeatherAudioState, dt: number): void {
    if (this.disposed) return;

    this.lastState = { ...state };
    const mix = computeWeatherMix(state);
    this.currentMix = mix;

    const tau = state.inOverworld ? GAIN_TAU_WEATHER_SEC : GAIN_TAU_FADE_OUT_SEC;
    const safeDt = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 1.0) : 0.016;
    const alpha = 1 - Math.exp(-safeDt / tau);

    this.smoothedGains.ocean += (mix.oceanGain - this.smoothedGains.ocean) * alpha;
    this.smoothedGains.wind += (mix.windGain - this.smoothedGains.wind) * alpha;
    this.smoothedGains.rain += (mix.rainGain - this.smoothedGains.rain) * alpha;

    if (this.smoothedGains.ocean < 0.0005 && mix.oceanGain === 0) {
      this.smoothedGains.ocean = 0;
    }
    if (this.smoothedGains.wind < 0.0005 && mix.windGain === 0) {
      this.smoothedGains.wind = 0;
    }
    if (this.smoothedGains.rain < 0.0005 && mix.rainGain === 0) {
      this.smoothedGains.rain = 0;
    }

    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    this.applyLoopParams('ocean', mix.oceanGain, mix.oceanCutoffHz, mix.oceanRate, tau, now);
    this.applyLoopParams('wind', mix.windGain, mix.windCutoffHz, mix.windRate, tau, now);
    this.applyLoopParams('rain', mix.rainGain, mix.rainCutoffHz, mix.rainRate, tau, now);
  }

  /**
   * Ré-applique le dernier état météo connu (utile juste après la reprise de l'AudioContext).
   */
  public syncCurrentState(): void {
    if (this.disposed || !this.lastState) return;
    this.update(this.lastState, 0.016);
  }

  /**
   * Déclenche un coup de tonnerre one-shot (enregistré localement, ou repli procédural propre).
   */
  public triggerThunder(intensity = 1.0): void {
    if (this.disposed || this.ctx.state !== 'running') return;

    const safeIntensity = Number.isFinite(intensity) ? clamp(intensity, 0, 1.35) : 1.0;
    if (safeIntensity <= 0.02) return;

    const nowMs =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    if (nowMs - this.lastThunderMs < THUNDER_MIN_INTERVAL_MS) {
      return;
    }
    if (this.activeThunderNodes.size >= THUNDER_MAX_CONCURRENT * 3) {
      return;
    }
    this.lastThunderMs = nowMs;

    const now = this.ctx.currentTime;
    const clampedGainScale = clamp(safeIntensity, 0.2, 1.25);
    const buffer = this.buffers.thunder;

    if (buffer) {
      this.playRecordedThunder(buffer, clampedGainScale, now);
    } else {
      this.playProceduralThunder(clampedGainScale, now);
    }

    this.thunderCount += 1;
  }

  public getStatus(): WeatherAudioStatus {
    const loadedTracks: string[] = [];
    const fallbackTracks: string[] = [];

    for (const track of WEATHER_TRACK_ORDER) {
      if (this.trackState[track] === 'loaded') {
        loadedTracks.push(track);
      } else if (this.trackState[track] === 'fallback') {
        fallbackTracks.push(track);
      }
    }

    const isRunning = !this.disposed && this.ctx.state === 'running';
    return {
      loadedTracks,
      fallbackTracks,
      activeGains: {
        ocean: isRunning ? Number(this.smoothedGains.ocean.toFixed(4)) : 0,
        wind: isRunning ? Number(this.smoothedGains.wind.toFixed(4)) : 0,
        rain: isRunning ? Number(this.smoothedGains.rain.toFixed(4)) : 0,
      },
      thunderCount: this.thunderCount,
    };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // Ignore
      }
      this.abortController = null;
    }

    for (const track of WEATHER_LOOP_TRACKS) {
      const ch = this.channels[track];
      if (ch.source) {
        try {
          ch.source.stop();
        } catch {
          // Ignore
        }
        try {
          ch.source.disconnect();
        } catch {
          // Ignore
        }
        ch.source = null;
      }
      try {
        ch.filter.disconnect();
      } catch {
        // Ignore
      }
      try {
        ch.gain.disconnect();
      } catch {
        // Ignore
      }
    }

    for (const node of this.activeThunderNodes) {
      try {
        if ('stop' in node && typeof (node as AudioScheduledSourceNode).stop === 'function') {
          (node as AudioScheduledSourceNode).stop();
        }
      } catch {
        // Ignore
      }
      try {
        node.disconnect();
      } catch {
        // Ignore
      }
    }
    this.activeThunderNodes.clear();

    for (const track of WEATHER_TRACK_ORDER) {
      delete this.buffers[track];
    }
    this.proceduralThunderBuffer = null;
  }

  private createLoopChannel(initialCutoffHz: number): LoopChannelNodes {
    const now = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(initialCutoffHz, now);
    filter.Q.setValueAtTime(0.707, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0, now);

    filter.connect(gain);
    gain.connect(this.outputNode);

    return { filter, gain, source: null };
  }

  private async loadTrackSafe(track: WeatherTrackId): Promise<void> {
    if (this.disposed) return;
    this.trackState[track] = 'loading';

    if (typeof fetch !== 'function') {
      this.activateFallback(track);
      return;
    }

    const url = resolveWeatherAssetUrl(WEATHER_ASSET_FILES[track]);

    try {
      const init: RequestInit | undefined = this.abortController
        ? { signal: this.abortController.signal }
        : undefined;
      const response = await fetch(url, init);
      if (this.disposed) return;

      if (!response.ok) {
        this.activateFallback(track);
        return;
      }

      const arrayBuffer = await response.arrayBuffer();
      if (this.disposed || arrayBuffer.byteLength < 64) {
        if (!this.disposed) this.activateFallback(track);
        return;
      }

      const decoded = await this.decodeBufferSafe(arrayBuffer);
      if (this.disposed) return;

      if (!decoded || decoded.length === 0) {
        this.activateFallback(track);
        return;
      }

      const finalBuffer =
        track === 'thunder'
          ? decoded
          : makeSeamlessLoopBuffer(this.ctx, decoded, LOOP_CROSSFADE_SEC);

      this.buffers[track] = finalBuffer;
      this.trackState[track] = 'loaded';

      if (track !== 'thunder') {
        this.startLoopSource(track, finalBuffer);
      }
    } catch {
      if (!this.disposed) {
        this.activateFallback(track);
      }
    }
  }

  private decodeBufferSafe(data: ArrayBuffer): Promise<AudioBuffer | null> {
    return new Promise((resolve) => {
      try {
        const result = this.ctx.decodeAudioData(
          data.slice(0),
          (buf) => resolve(buf),
          () => resolve(null),
        );
        if (result && typeof result.then === 'function') {
          result.then(
            (buf) => resolve(buf),
            () => resolve(null),
          );
        }
      } catch {
        resolve(null);
      }
    });
  }

  private activateFallback(track: WeatherTrackId): void {
    if (this.disposed) return;
    this.trackState[track] = 'fallback';

    if (track !== 'thunder') {
      try {
        const fallbackBuffer = createProceduralLoopBuffer(this.ctx, track);
        this.buffers[track] = fallbackBuffer;
        this.startLoopSource(track, fallbackBuffer);
      } catch {
        // AudioContext fermé ou indisponible : silence propre sans erreur
      }
    }
  }

  private startLoopSource(track: WeatherLoopTrackId, buffer: AudioBuffer): void {
    if (this.disposed) return;
    const ch = this.channels[track];

    if (ch.source) {
      try {
        ch.source.stop();
        ch.source.disconnect();
      } catch {
        // Ignore
      }
      ch.source = null;
    }

    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;

      const rate =
        track === 'ocean'
          ? this.currentMix.oceanRate
          : track === 'wind'
            ? this.currentMix.windRate
            : this.currentMix.rainRate;
      const now = this.ctx.currentTime;
      src.playbackRate.setValueAtTime(rate, now);

      // Garantit un démarrage à gain 0 (zéro clic au lancement du buffer décodé)
      ch.gain.gain.cancelScheduledValues(now);
      ch.gain.gain.setValueAtTime(0, now);

      src.connect(ch.filter);
      // Décalage aléatoire de départ pour éviter toute corrélation entre pistes
      const startOffset = buffer.duration > 1 ? Math.random() * buffer.duration * 0.85 : 0;
      src.start(now, startOffset);
      ch.source = src;

      // Applique immédiatement la rampe douce vers le gain cible actuel
      if (this.ctx.state === 'running') {
        const targetGain =
          track === 'ocean'
            ? this.currentMix.oceanGain
            : track === 'wind'
              ? this.currentMix.windGain
              : this.currentMix.rainGain;
        const targetCutoff =
          track === 'ocean'
            ? this.currentMix.oceanCutoffHz
            : track === 'wind'
              ? this.currentMix.windCutoffHz
              : this.currentMix.rainCutoffHz;
        this.applyLoopParams(track, targetGain, targetCutoff, rate, GAIN_TAU_WEATHER_SEC, now);
      }
    } catch {
      // Ignore proprement si le contexte audio est en cours de fermeture
    }
  }

  private applyLoopParams(
    track: WeatherLoopTrackId,
    targetGain: number,
    targetCutoffHz: number,
    targetRate: number,
    gainTau: number,
    now: number,
  ): void {
    const ch = this.channels[track];
    try {
      ch.filter.frequency.setTargetAtTime(targetCutoffHz, now, FILTER_TAU_SEC);
      if (ch.source) {
        ch.gain.gain.setTargetAtTime(targetGain, now, gainTau);
        ch.source.playbackRate.setTargetAtTime(targetRate, now, RATE_TAU_SEC);
      }
    } catch {
      // Ignore si un nœud a été déconnecté pendant dispose()
    }
  }

  private playRecordedThunder(
    buffer: AudioBuffer,
    intensity: number,
    now: number,
  ): void {
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;

      // Variation naturelle de pitch (0.88..1.08) pour éviter toute répétition mécanique
      const playbackRate = 0.88 + Math.random() * 0.2;
      src.playbackRate.setValueAtTime(playbackRate, now);

      // Filtre de distance : un éclair faible sonne plus sourd et lointain
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const cutoffHz = clamp(1800 + 7200 * clamp01(intensity), 1400, 10500);
      filter.frequency.setValueAtTime(cutoffHz, now);
      filter.Q.setValueAtTime(0.707, now);

      const gain = this.ctx.createGain();
      const peakGain = clamp(THUNDER_BASE_GAIN * intensity, 0.12, 1.35);
      gain.gain.setValueAtTime(peakGain, now);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.outputNode);

      this.activeThunderNodes.add(src);
      this.activeThunderNodes.add(filter);
      this.activeThunderNodes.add(gain);

      src.onended = () => {
        for (const node of [src, filter, gain]) {
          this.activeThunderNodes.delete(node);
          try {
            node.disconnect();
          } catch {
            // Ignore
          }
        }
      };

      src.start(now);
    } catch {
      // Ignore proprement
    }
  }

  /**
   * Repli procédural pour un coup de tonnerre avec claquement initial + grondement grave roulant.
   */
  private playProceduralThunder(intensity: number, now: number): void {
    try {
      const durationSec = 5.4;
      if (!this.proceduralThunderBuffer) {
        const sampleRate = this.ctx.sampleRate;
        const length = Math.floor(sampleRate * durationSec);
        const buf = this.ctx.createBuffer(2, length, sampleRate);

        for (let ch = 0; ch < 2; ch += 1) {
          const data = buf.getChannelData(ch);
          let lp = 0;
          const phase = ch === 0 ? 0 : 1.1;
          for (let i = 0; i < length; i += 1) {
            const t = i / sampleRate;
            const white = Math.random() * 2 - 1;
            lp = lp * 0.92 + white * 0.08;

            // Claquement bref initial (0..0.35 s) + double grondement roulant
            const crackEnv = Math.exp(-t * 9.5) * Math.min(1, t / 0.012);
            const rumble1 = Math.exp(-t * 0.65) * (0.72 + 0.28 * Math.sin(t * 7.5 + phase));
            const rumble2 =
              t > 1.35
                ? Math.exp(-(t - 1.35) * 0.95) * 0.55 * Math.min(1, (t - 1.35) / 0.25)
                : 0;
            const tailFade = t > durationSec - 1.0 ? Math.max(0, (durationSec - t) / 1.0) : 1;

            data[i] =
              (white * 0.28 * crackEnv + lp * 2.4 * (rumble1 + rumble2)) * tailFade * 0.55;
          }
        }
        this.proceduralThunderBuffer = buf;
      }

      const src = this.ctx.createBufferSource();
      src.buffer = this.proceduralThunderBuffer;
      src.playbackRate.setValueAtTime(0.88 + Math.random() * 0.2, now);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(clamp(600 + 1800 * intensity, 450, 2600), now);
      filter.frequency.exponentialRampToValueAtTime(140, now + durationSec * 0.85);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(clamp(0.95 * intensity, 0.12, 1.15), now);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.outputNode);

      this.activeThunderNodes.add(src);
      this.activeThunderNodes.add(filter);
      this.activeThunderNodes.add(gain);

      src.onended = () => {
        for (const node of [src, filter, gain]) {
          this.activeThunderNodes.delete(node);
          try {
            node.disconnect();
          } catch {
            // Ignore
          }
        }
      };

      src.start(now);
    } catch {
      // Ignore proprement
    }
  }
}
