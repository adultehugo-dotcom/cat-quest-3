import * as THREE from 'three';
import { ALL_NEW_ISLANDS, NEW_ISLANDS } from '../data/worldIslands';

// ============================================================================
// WeatherSystem — Cycle Jour/Nuit (~30 min), Météo Automatique (Beau temps,
// Brouillard, Tempête), Éclairage Dynamique & VFX Atmosphériques (0 alloc/frame)
//
// Règles strictes :
// - Purement visuel et sonore : 0 impact sur physique, conduite ou règles de jeu.
// - Non sauvegardé : chaque nouvelle session démarre sur un état aléatoire.
// - Zéro indicateur/commande UI.
// - Bloom-safe : luminances diffuses <= 0.80 sous seuil UnrealBloomPass 0.85.
// ============================================================================

export type WeatherCondition = 'clear' | 'fog' | 'storm';
export type DayPhase = 'night' | 'dawn' | 'day' | 'sunset' | 'dusk';

/** Une journée complète dure 30 minutes de jeu (1800 secondes). */
export const DAY_CYCLE_DURATION_SEC = 1800;

export interface WeatherAudioSnapshot {
  readonly inOverworld: boolean;
  readonly stormIntensity: number;
  readonly fogIntensity: number;
  readonly rainIntensity: number;
  readonly windIntensity: number;
  readonly seaAgitation: number;
  readonly seaProximity: number;
  readonly shipSpeedRatio: number;
}

export interface WeatherSnapshot {
  /** Heure normalisée du cycle [0..1) : 0 = minuit, 0.25 = 06h, 0.50 = midi, 0.75 = 18h. */
  timeOfDay: number;
  dayPhase: DayPhase;
  currentCondition: WeatherCondition;
  targetCondition: WeatherCondition;
  transitionProgress: number;
  clearWeight: number;
  fogWeight: number;
  stormWeight: number;
  fogIntensity: number;
  stormIntensity: number;
  rainIntensity: number;
  windIntensity: number;
  windDirX: number;
  windDirZ: number;
  /** Horloge monotone intégrée de la houle (évite tout saut de phase lors des changements météo). */
  oceanTime: number;
  waveAmplitude: number;
  waveChoppiness: number;
  waveSpeedScale: number;
  lightningFlash: number;
  sunElevation: number;
  dawnFactor: number;
  sunsetFactor: number;
  nightFactor: number;
  sunGlintIntensity: number;
  causticsIntensity: number;
  lanternBoost: number;

  // Éclairage & palette pré-alloués (mutés en place, 0 allocation/frame)
  readonly sunDirection: THREE.Vector3;
  readonly dirLightOffset: THREE.Vector3;
  readonly sunColor: THREE.Color;
  readonly dirLightColor: THREE.Color;
  dirLightIntensity: number;
  readonly ambientColor: THREE.Color;
  ambientIntensity: number;
  readonly hemiSkyColor: THREE.Color;
  readonly hemiGroundColor: THREE.Color;
  hemiIntensity: number;
  readonly fogColor: THREE.Color;
  /** Distance fogNear relative à la distance caméra-cible (garantit lisibilité bateau/zone proche). */
  fogNearOffset: number;
  /** Distance fogFar relative à la distance caméra-cible. */
  fogFarOffset: number;
  readonly skyReflectColor: THREE.Color;
  readonly horizonReflectColor: THREE.Color;
  readonly waterShallowColor: THREE.Color;
  readonly waterMidColor: THREE.Color;
  readonly waterDeepColor: THREE.Color;
  readonly waterFoamColor: THREE.Color;
}

export interface WeatherQaOverride {
  condition?: WeatherCondition;
  targetCondition?: WeatherCondition;
  timeOfDay?: number;
  instant?: boolean;
  transitionDurationSec?: number;
  triggerLightning?: boolean;
}

interface DayKeyframe {
  t: number;
  dirPos: readonly [number, number, number];
  dirColor: number;
  dirIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  fogColor: number;
  sunSpecColor: number;
  skyReflect: number;
  horizonReflect: number;
  waterShallow: number;
  waterMid: number;
  waterDeep: number;
  waterFoam: number;
  sunGlint: number;
  caustics: number;
}

// Clés du cycle jour-nuit (bouclées de 0.0 à 1.0)
// Calibrées pour ACESFilmicToneMapping (exposure 1.05) + Bloom 0.85 :
// - Coucher du soleil (0.72..0.79) : lumière dorée chaleureuse modifiant tout le décor
// - Nuit (0.87..1.0 / 0.0..0.19) : nuit lunaire profonde mais 100 % lisible
// - Aube (0.23..0.30) : rosée pêche-dorée fraîche
// - Jour (0.34..0.67) : ensoleillement maritime vif et réaliste
const DAY_KEYFRAMES: readonly DayKeyframe[] = [
  {
    // 00:00 — Pleine nuit lunaire (bleu profond argenté, lisible pour le jeu)
    t: 0.0,
    dirPos: [-18, 34, -26],
    dirColor: 0x9ec0f5,
    dirIntensity: 0.72,
    ambientColor: 0x3b598f,
    ambientIntensity: 0.34,
    hemiSky: 0x4b70ad,
    hemiGround: 0x22334a,
    hemiIntensity: 0.36,
    fogColor: 0x10223d,
    sunSpecColor: 0xbcd8ff,
    skyReflect: 0x142c4f,
    horizonReflect: 0x1d3b63,
    waterShallow: 0x1a566b,
    waterMid: 0x0d2f4d,
    waterDeep: 0x06162b,
    waterFoam: 0x6f8fa8,
    sunGlint: 0.56,
    caustics: 0.14,
  },
  {
    // 04:45 — Fin de nuit avant l'aube
    t: 0.2,
    dirPos: [16, 26, -28],
    dirColor: 0x9eb8e8,
    dirIntensity: 0.72,
    ambientColor: 0x415b8c,
    ambientIntensity: 0.35,
    hemiSky: 0x5674ad,
    hemiGround: 0x28364a,
    hemiIntensity: 0.37,
    fogColor: 0x192c4a,
    sunSpecColor: 0xc2d4f5,
    skyReflect: 0x1a3457,
    horizonReflect: 0x2d4363,
    waterShallow: 0x1e5c6e,
    waterMid: 0x0f3452,
    waterDeep: 0x071a30,
    waterFoam: 0x7a96ab,
    sunGlint: 0.52,
    caustics: 0.18,
  },
  {
    // 06:15 — Aube (soleil bas à l'Est-Nord, lumière rose-pêche dorée)
    t: 0.26,
    dirPos: [34, 17, -24],
    dirColor: 0xffb985,
    dirIntensity: 1.24,
    ambientColor: 0xd9a896,
    ambientIntensity: 0.31,
    hemiSky: 0xf0be9c,
    hemiGround: 0x5c5c52,
    hemiIntensity: 0.34,
    fogColor: 0x68829e,
    sunSpecColor: 0xffd0a0,
    skyReflect: 0x4f7ba8,
    horizonReflect: 0xcf9b7e,
    waterShallow: 0x2e9e9e,
    waterMid: 0x185c82,
    waterDeep: 0x0a2947,
    waterFoam: 0xc2c8c9,
    sunGlint: 1.05,
    caustics: 0.52,
  },
  {
    // 08:30 — Matinée claire
    t: 0.35,
    dirPos: [30, 34, -18],
    dirColor: 0xffe4bc,
    dirIntensity: 1.52,
    ambientColor: 0xf7eedc,
    ambientIntensity: 0.29,
    hemiSky: 0xaedfff,
    hemiGround: 0x5f7842,
    hemiIntensity: 0.33,
    fogColor: 0x3b86ad,
    sunSpecColor: 0xfff0cc,
    skyReflect: 0x357eb8,
    horizonReflect: 0x8cc6db,
    waterShallow: 0x28b5b2,
    waterMid: 0x136a99,
    waterDeep: 0x072c4f,
    waterFoam: 0xd2e4ea,
    sunGlint: 1.0,
    caustics: 0.88,
  },
  {
    // 12:00 — Midi lumineux (équilibre diorama + réalisme marin)
    t: 0.5,
    dirPos: [20, 44, -14],
    dirColor: 0xfff0d4,
    dirIntensity: 1.62,
    ambientColor: 0xfff5e4,
    ambientIntensity: 0.3,
    hemiSky: 0xb8e6ff,
    hemiGround: 0x647c44,
    hemiIntensity: 0.34,
    fogColor: 0x3f8cb3,
    sunSpecColor: 0xfff6dc,
    skyReflect: 0x307ab8,
    horizonReflect: 0x8fcbe0,
    waterShallow: 0x29bab5,
    waterMid: 0x126e9e,
    waterDeep: 0x072e54,
    waterFoam: 0xd5e6ec,
    sunGlint: 1.08,
    caustics: 1.0,
  },
  {
    // 15:45 — Après-midi dorée qui commence à tiédir
    t: 0.655,
    dirPos: [-16, 33, -18],
    dirColor: 0xffe0ad,
    dirIntensity: 1.52,
    ambientColor: 0xfcead0,
    ambientIntensity: 0.3,
    hemiSky: 0xb5daf2,
    hemiGround: 0x687240,
    hemiIntensity: 0.33,
    fogColor: 0x5288a3,
    sunSpecColor: 0xffe6b3,
    skyReflect: 0x3675a6,
    horizonReflect: 0xa6c0c7,
    waterShallow: 0x2ab0a8,
    waterMid: 0x14658f,
    waterDeep: 0x082a4a,
    waterFoam: 0xd4dfd8,
    sunGlint: 1.12,
    caustics: 0.85,
  },
  {
    // 17:50 — Coucher de soleil doré (Golden Hour / Sunset marqué sur tout le décor !)
    t: 0.745,
    dirPos: [-35, 16, -24],
    dirColor: 0xffa652,
    dirIntensity: 1.48,
    ambientColor: 0xeb9e70,
    ambientIntensity: 0.34,
    hemiSky: 0xffad6e,
    hemiGround: 0x5e4234,
    hemiIntensity: 0.36,
    fogColor: 0x8c5e54,
    sunSpecColor: 0xffbc66,
    skyReflect: 0x4e5f87,
    horizonReflect: 0xde8954,
    waterShallow: 0x2c948f,
    waterMid: 0x174d73,
    waterDeep: 0x0b213d,
    waterFoam: 0xd1b9a3,
    sunGlint: 1.42,
    caustics: 0.62,
  },
  {
    // 19:20 — Crépuscule violacé-indigo
    t: 0.805,
    dirPos: [-30, 18, -26],
    dirColor: 0xc97b7a,
    dirIntensity: 0.86,
    ambientColor: 0x665e8a,
    ambientIntensity: 0.34,
    hemiSky: 0x786e9e,
    hemiGround: 0x2f2c42,
    hemiIntensity: 0.36,
    fogColor: 0x2c3457,
    sunSpecColor: 0xe3a89a,
    skyReflect: 0x23355c,
    horizonReflect: 0x5e4b6e,
    waterShallow: 0x206875,
    waterMid: 0x103859,
    waterDeep: 0x081a33,
    waterFoam: 0x8f99ab,
    sunGlint: 0.72,
    caustics: 0.22,
  },
  {
    // 20:50 — Entrée dans la nuit lunaire
    t: 0.87,
    dirPos: [-20, 32, -26],
    dirColor: 0x9ec0f5,
    dirIntensity: 0.72,
    ambientColor: 0x3b598f,
    ambientIntensity: 0.34,
    hemiSky: 0x4b70ad,
    hemiGround: 0x22334a,
    hemiIntensity: 0.36,
    fogColor: 0x10223d,
    sunSpecColor: 0xbcd8ff,
    skyReflect: 0x142c4f,
    horizonReflect: 0x1d3b63,
    waterShallow: 0x1a566b,
    waterMid: 0x0d2f4d,
    waterDeep: 0x06162b,
    waterFoam: 0x6f8fa8,
    sunGlint: 0.56,
    caustics: 0.14,
  },
  {
    // 24:00 — Boucle exacte sur minuit
    t: 1.0,
    dirPos: [-18, 34, -26],
    dirColor: 0x9ec0f5,
    dirIntensity: 0.72,
    ambientColor: 0x3b598f,
    ambientIntensity: 0.34,
    hemiSky: 0x4b70ad,
    hemiGround: 0x22334a,
    hemiIntensity: 0.36,
    fogColor: 0x10223d,
    sunSpecColor: 0xbcd8ff,
    skyReflect: 0x142c4f,
    horizonReflect: 0x1d3b63,
    waterShallow: 0x1a566b,
    waterMid: 0x0d2f4d,
    waterDeep: 0x06162b,
    waterFoam: 0x6f8fa8,
    sunGlint: 0.56,
    caustics: 0.14,
  },
];

// Palettes météo (brouillard & tempête) modulées avec le cycle jour-nuit
const FOG_DAY_COLOR = new THREE.Color(0x9ab0bd);
const FOG_SUNSET_COLOR = new THREE.Color(0x967e78);
const FOG_NIGHT_COLOR = new THREE.Color(0x283a52);

const STORM_DAY_FOG_COLOR = new THREE.Color(0x2c3c4c);
const STORM_SUNSET_FOG_COLOR = new THREE.Color(0x3a323b);
const STORM_NIGHT_FOG_COLOR = new THREE.Color(0x101c2b);

const STORM_WATER_SHALLOW = new THREE.Color(0x1f5966);
const STORM_WATER_MID = new THREE.Color(0x103347);
const STORM_WATER_DEEP = new THREE.Color(0x071926);
const STORM_WATER_FOAM = new THREE.Color(0xa6b9c2);

const LIGHTNING_SKY_COLOR = new THREE.Color(0xbcd8f7);
const LIGHTNING_DIR_COLOR = new THREE.Color(0xd8ecff);

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrap01(v: number): number {
  const r = v % 1;
  return r < 0 ? r + 1 : r;
}

export function getDayPhaseFromTime(t: number): DayPhase {
  const w = wrap01(t);
  if (w >= 0.22 && w < 0.31) return 'dawn';
  if (w >= 0.31 && w < 0.68) return 'day';
  if (w >= 0.68 && w < 0.79) return 'sunset';
  if (w >= 0.79 && w < 0.86) return 'dusk';
  return 'night';
}

/**
 * Contrôleur pur de la météo et du cycle jour-nuit (30 min).
 * Testable à 100 % sous Node/Vitest (0 dépendance DOM ou WebGL).
 */
export class WeatherCycleController {
  private readonly rng: () => number;

  private timeOfDay: number;
  private fromCondition: WeatherCondition;
  private targetCondition: WeatherCondition;
  private transitionElapsed = 0;
  private transitionDuration = 16;
  private episodeElapsed = 0;
  private episodeDuration = 65;
  private manualWeather = false;

  private windAngle = 0.55;
  private gustClock = 0;
  private oceanTime = 0;

  // Éclairs et tonnerre (en tempête)
  private nextLightningTimer = 6.0;
  private lightningAge = 99;
  private lightningDuration = 0.45;
  private lightningStrength = 0;
  private thunderDelayTimer = -1;
  private thunderPendingStrength = 0;
  private consumableThunderStrength = 0;

  // Couleurs scratch pré-allouées (0 allocation/frame)
  private readonly colorA = new THREE.Color();
  private readonly colorB = new THREE.Color();
  private readonly tmpColor1 = new THREE.Color();
  private readonly tmpColor2 = new THREE.Color();

  private readonly snapshot: WeatherSnapshot;

  constructor(options?: {
    rng?: () => number;
    initialCondition?: WeatherCondition;
    initialTimeOfDay?: number;
  }) {
    this.rng = options?.rng ?? Math.random;

    // Chaque nouvelle session démarre sur une heure et une météo choisies aléatoirement
    this.timeOfDay =
      options?.initialTimeOfDay !== undefined
        ? wrap01(options.initialTimeOfDay)
        : this.rng();

    const initialCond = options?.initialCondition ?? this.pickInitialCondition();
    this.fromCondition = initialCond;
    this.targetCondition = initialCond;
    this.transitionElapsed = 1;
    this.transitionDuration = 1;
    this.episodeElapsed = 0;
    this.episodeDuration = this.pickEpisodeDuration(initialCond);
    this.windAngle = this.rng() * Math.PI * 2;
    this.nextLightningTimer = 3.5 + this.rng() * 5.0;

    this.snapshot = {
      timeOfDay: this.timeOfDay,
      dayPhase: getDayPhaseFromTime(this.timeOfDay),
      currentCondition: initialCond,
      targetCondition: initialCond,
      transitionProgress: 1,
      clearWeight: initialCond === 'clear' ? 1 : 0,
      fogWeight: initialCond === 'fog' ? 1 : 0,
      stormWeight: initialCond === 'storm' ? 1 : 0,
      fogIntensity: initialCond === 'fog' ? 1 : initialCond === 'storm' ? 0.86 : 0,
      stormIntensity: initialCond === 'storm' ? 1 : 0,
      rainIntensity: initialCond === 'storm' ? 1 : 0,
      windIntensity: initialCond === 'storm' ? 0.95 : initialCond === 'fog' ? 0.24 : 0.18,
      windDirX: Math.cos(this.windAngle),
      windDirZ: Math.sin(this.windAngle),
      oceanTime: 0,
      waveAmplitude: initialCond === 'storm' ? 2.15 : initialCond === 'fog' ? 0.96 : 1.18,
      waveChoppiness: initialCond === 'storm' ? 1.0 : initialCond === 'fog' ? 0.35 : 0.48,
      waveSpeedScale: initialCond === 'storm' ? 1.38 : initialCond === 'fog' ? 0.88 : 1.04,
      lightningFlash: 0,
      sunElevation: 0.5,
      dawnFactor: 0,
      sunsetFactor: 0,
      nightFactor: 0,
      sunGlintIntensity: 1.0,
      causticsIntensity: 0.85,
      lanternBoost: 0,
      sunDirection: new THREE.Vector3(0.4, 0.85, -0.3).normalize(),
      dirLightOffset: new THREE.Vector3(20, 44, -14),
      sunColor: new THREE.Color(0xfff0d4),
      dirLightColor: new THREE.Color(0xfff0d4),
      dirLightIntensity: 1.55,
      ambientColor: new THREE.Color(0xfff4e0),
      ambientIntensity: 0.3,
      hemiSkyColor: new THREE.Color(0xb4e2ff),
      hemiGroundColor: new THREE.Color(0x637a3f),
      hemiIntensity: 0.33,
      fogColor: new THREE.Color(0x3f8cb3),
      fogNearOffset: 82,
      fogFarOffset: 230,
      skyReflectColor: new THREE.Color(0x307ab8),
      horizonReflectColor: new THREE.Color(0x8fcbe0),
      waterShallowColor: new THREE.Color(0x29bab5),
      waterMidColor: new THREE.Color(0x126e9e),
      waterDeepColor: new THREE.Color(0x072e54),
      waterFoamColor: new THREE.Color(0xd5e6ec),
    };

    this.recomputeSnapshot();
  }

  private pickInitialCondition(): WeatherCondition {
    const r = this.rng();
    if (r < 0.44) return 'clear';
    if (r < 0.72) return 'fog';
    return 'storm';
  }

  private pickNextCondition(current: WeatherCondition): WeatherCondition {
    const r = this.rng();
    if (current === 'clear') {
      return r < 0.5 ? 'fog' : 'storm';
    }
    if (current === 'fog') {
      return r < 0.55 ? 'clear' : 'storm';
    }
    // Depuis storm : retour fréquent au beau temps ou transition brumeuse
    return r < 0.62 ? 'clear' : 'fog';
  }

  private pickEpisodeDuration(cond: WeatherCondition): number {
    // Épisodes fréquents de durée variable (~40 s à ~105 s)
    if (cond === 'storm') {
      return 38 + this.rng() * 52;
    }
    if (cond === 'fog') {
      return 36 + this.rng() * 48;
    }
    return 45 + this.rng() * 62;
  }

  private pickTransitionDuration(): number {
    // Transitions progressives de 14 à 24 secondes
    return 14 + this.rng() * 10;
  }

  public getSnapshot(): WeatherSnapshot {
    return this.snapshot;
  }

  /** Choix visuel de session : null rend la main au cycle météo automatique. */
  public setManualWeather(condition: WeatherCondition | null): void {
    const current = this.snapshot.currentCondition;
    this.manualWeather = condition !== null;
    this.fromCondition = current;
    this.targetCondition = condition ?? current;
    this.transitionDuration = 14;
    this.transitionElapsed = 0;
    this.episodeElapsed = 0;
    if (condition === null) this.episodeDuration = 0;
    this.recomputeSnapshot();
  }

  /**
   * Consomme l'intensité d'un coup de tonnerre déclenché sur cette frame (> 0 si actif, sinon 0).
   */
  public consumePendingThunder(): number {
    const val = this.consumableThunderStrength;
    this.consumableThunderStrength = 0;
    return val;
  }

  /**
   * Déclenche immédiatement un éclair visuel et planifie son coup de tonnerre.
   */
  public triggerLightning(strength?: number): void {
    this.lightningAge = 0;
    this.lightningDuration = 0.42 + this.rng() * 0.16;
    this.lightningStrength = clamp(strength ?? (0.72 + this.rng() * 0.28), 0.45, 1.0);
    // Délai réaliste lumière -> son (0.35 s à 1.35 s)
    this.thunderDelayTimer = 0.35 + this.rng() * 1.0;
    this.thunderPendingStrength = this.lightningStrength;
  }

  /**
   * Contrôle interne dédié exclusivement aux tests automatisés QA / Playwright (jamais exposé en UI).
   */
  public applyQaOverride(override: WeatherQaOverride): void {
    if (override.timeOfDay !== undefined && Number.isFinite(override.timeOfDay)) {
      this.timeOfDay = wrap01(override.timeOfDay);
    }

    if (override.condition !== undefined) {
      if (override.instant !== false && override.targetCondition === undefined) {
        this.fromCondition = override.condition;
        this.targetCondition = override.condition;
        this.transitionDuration = 1;
        this.transitionElapsed = 1;
        this.episodeElapsed = 0;
        this.episodeDuration = this.pickEpisodeDuration(override.condition);
      } else {
        this.fromCondition = override.condition;
        this.targetCondition = override.targetCondition ?? override.condition;
        this.transitionDuration = Math.max(0.5, override.transitionDurationSec ?? 14);
        this.transitionElapsed = 0;
        this.episodeElapsed = 0;
      }
    } else if (override.targetCondition !== undefined) {
      this.fromCondition = this.snapshot.currentCondition;
      this.targetCondition = override.targetCondition;
      this.transitionDuration = Math.max(0.5, override.transitionDurationSec ?? 14);
      this.transitionElapsed = 0;
      this.episodeElapsed = 0;
    }

    if (override.triggerLightning) {
      this.triggerLightning(0.95);
    }

    this.recomputeSnapshot();
  }

  public update(dt: number): WeatherSnapshot {
    const safeDt = Math.max(0, Math.min(dt, 0.25));

    // 1. Avancement continu du cycle jour-nuit (30 minutes par journée complète)
    this.timeOfDay = wrap01(this.timeOfDay + safeDt / DAY_CYCLE_DURATION_SEC);

    // 2. Avancement des transitions & épisodes météo aléatoires
    if (this.manualWeather && this.transitionElapsed >= this.transitionDuration) {
      // Le réglage manuel reste verrouillé jusqu'au choix « Automatique ».
    } else if (this.transitionElapsed < this.transitionDuration) {
      this.transitionElapsed = Math.min(
        this.transitionDuration,
        this.transitionElapsed + safeDt,
      );
      if (this.transitionElapsed >= this.transitionDuration) {
        this.fromCondition = this.targetCondition;
        this.episodeElapsed = 0;
        if (!this.manualWeather) {
          this.episodeDuration = this.pickEpisodeDuration(this.targetCondition);
        }
      }
    } else {
      this.episodeElapsed += safeDt;
      if (this.episodeElapsed >= this.episodeDuration) {
        this.fromCondition = this.targetCondition;
        this.targetCondition = this.pickNextCondition(this.fromCondition);
        this.transitionDuration = this.pickTransitionDuration();
        this.transitionElapsed = 0;
        this.episodeElapsed = 0;
      }
    }

    // 3. Vent organique qui tourne très lentement + rafales
    this.gustClock += safeDt;
    this.windAngle += safeDt * 0.018;

    // 4. Éclairs & tonnerre pendant les tempêtes
    const stormW = this.computeConditionWeight('storm');
    if (stormW > 0.42) {
      this.nextLightningTimer -= safeDt * (0.65 + 0.75 * stormW);
      if (this.nextLightningTimer <= 0) {
        this.triggerLightning();
        this.nextLightningTimer = 4.8 + this.rng() * 9.5;
      }
    } else {
      this.nextLightningTimer = Math.max(this.nextLightningTimer, 2.5);
    }

    if (this.lightningAge < this.lightningDuration) {
      this.lightningAge += safeDt;
    }

    if (this.thunderDelayTimer >= 0) {
      this.thunderDelayTimer -= safeDt;
      if (this.thunderDelayTimer <= 0) {
        this.thunderDelayTimer = -1;
        this.consumableThunderStrength = this.thunderPendingStrength;
        this.thunderPendingStrength = 0;
      }
    }

    // 5. Intégration monotone de l'horloge de houle (0 discontinuité lors des transitions)
    const speedScale =
      this.computeConditionWeight('clear') * 1.04 +
      this.computeConditionWeight('fog') * 0.88 +
      stormW * 1.38;
    this.oceanTime += safeDt * speedScale;

    this.recomputeSnapshot();
    return this.snapshot;
  }

  private computeConditionWeight(cond: WeatherCondition): number {
    const rawT =
      this.transitionDuration > 0
        ? clamp(this.transitionElapsed / this.transitionDuration, 0, 1)
        : 1;
    // Courbe S douce (quintique smoothstep) pour des transitions météo imperceptibles et organiques
    const blend = rawT * rawT * rawT * (rawT * (rawT * 6 - 15) + 10);
    const fromW = this.fromCondition === cond ? 1 : 0;
    const toW = this.targetCondition === cond ? 1 : 0;
    return fromW + (toW - fromW) * blend;
  }

  private evaluateLightningFlash(): number {
    if (this.lightningAge >= this.lightningDuration || this.lightningAge < 0) {
      return 0;
    }
    const u = this.lightningAge / this.lightningDuration;
    // Double flash naturel : pic principal vif (u ~ 0.08) + rebond secondaire (u ~ 0.36)
    const pulse1 = Math.exp(-Math.pow((u - 0.09) / 0.085, 2));
    const pulse2 = 0.62 * Math.exp(-Math.pow((u - 0.38) / 0.14, 2));
    const tail = 0.18 * (1 - smoothstep(0.45, 1.0, u));
    return clamp((pulse1 + pulse2 + tail) * this.lightningStrength, 0, 1);
  }

  private lerpHexColor(out: THREE.Color, hexA: number, hexB: number, t: number): void {
    this.colorA.setHex(hexA);
    this.colorB.setHex(hexB);
    out.copy(this.colorA).lerp(this.colorB, t);
  }

  private recomputeSnapshot(): void {
    const s = this.snapshot;
    const t = this.timeOfDay;
    s.timeOfDay = t;
    s.dayPhase = getDayPhaseFromTime(t);

    const rawT =
      this.transitionDuration > 0
        ? clamp(this.transitionElapsed / this.transitionDuration, 0, 1)
        : 1;
    s.transitionProgress = rawT;

    const clearW = this.computeConditionWeight('clear');
    const fogW = this.computeConditionWeight('fog');
    const stormW = this.computeConditionWeight('storm');

    s.clearWeight = clearW;
    s.fogWeight = fogW;
    s.stormWeight = stormW;
    s.targetCondition = this.targetCondition;
    s.currentCondition =
      stormW >= fogW && stormW >= clearW
        ? 'storm'
        : fogW >= clearW
          ? 'fog'
          : 'clear';

    // Facteurs de phase temporelle
    const dawnFactor =
      smoothstep(0.2, 0.26, t) * (1 - smoothstep(0.28, 0.35, t));
    const sunsetFactor =
      smoothstep(0.67, 0.745, t) * (1 - smoothstep(0.755, 0.83, t));
    const dayBell =
      smoothstep(0.23, 0.33, t) * (1 - smoothstep(0.76, 0.86, t));
    const nightFactor = 1 - dayBell;

    s.dawnFactor = dawnFactor;
    s.sunsetFactor = sunsetFactor;
    s.nightFactor = nightFactor;
    s.sunElevation = Math.sin((t - 0.25) * Math.PI * 2);

    // Interpolation sur les keyframes du cycle jour-nuit
    let k0 = DAY_KEYFRAMES[0];
    let k1 = DAY_KEYFRAMES[DAY_KEYFRAMES.length - 1];
    for (let i = 0; i < DAY_KEYFRAMES.length - 1; i++) {
      if (t >= DAY_KEYFRAMES[i].t && t <= DAY_KEYFRAMES[i + 1].t) {
        k0 = DAY_KEYFRAMES[i];
        k1 = DAY_KEYFRAMES[i + 1];
        break;
      }
    }
    const span = Math.max(0.0001, k1.t - k0.t);
    const localU = smoothstep(0, 1, (t - k0.t) / span);

    // Direction solaire/lunaire
    s.dirLightOffset.set(
      k0.dirPos[0] + (k1.dirPos[0] - k0.dirPos[0]) * localU,
      k0.dirPos[1] + (k1.dirPos[1] - k0.dirPos[1]) * localU,
      k0.dirPos[2] + (k1.dirPos[2] - k0.dirPos[2]) * localU,
    );
    s.sunDirection.copy(s.dirLightOffset).normalize();

    this.lerpHexColor(s.dirLightColor, k0.dirColor, k1.dirColor, localU);
    s.dirLightIntensity = k0.dirIntensity + (k1.dirIntensity - k0.dirIntensity) * localU;

    this.lerpHexColor(s.ambientColor, k0.ambientColor, k1.ambientColor, localU);
    s.ambientIntensity =
      k0.ambientIntensity + (k1.ambientIntensity - k0.ambientIntensity) * localU;

    this.lerpHexColor(s.hemiSkyColor, k0.hemiSky, k1.hemiSky, localU);
    this.lerpHexColor(s.hemiGroundColor, k0.hemiGround, k1.hemiGround, localU);
    s.hemiIntensity = k0.hemiIntensity + (k1.hemiIntensity - k0.hemiIntensity) * localU;

    this.lerpHexColor(s.fogColor, k0.fogColor, k1.fogColor, localU);
    this.lerpHexColor(s.sunColor, k0.sunSpecColor, k1.sunSpecColor, localU);
    this.lerpHexColor(s.skyReflectColor, k0.skyReflect, k1.skyReflect, localU);
    this.lerpHexColor(s.horizonReflectColor, k0.horizonReflect, k1.horizonReflect, localU);
    this.lerpHexColor(s.waterShallowColor, k0.waterShallow, k1.waterShallow, localU);
    this.lerpHexColor(s.waterMidColor, k0.waterMid, k1.waterMid, localU);
    this.lerpHexColor(s.waterDeepColor, k0.waterDeep, k1.waterDeep, localU);
    this.lerpHexColor(s.waterFoamColor, k0.waterFoam, k1.waterFoam, localU);

    let sunGlint = k0.sunGlint + (k1.sunGlint - k0.sunGlint) * localU;
    let caustics = k0.caustics + (k1.caustics - k0.caustics) * localU;

    // Modulation météo : Brouillard (lumière diffuse douce, brume épaisse)
    const warmHorizonMix = clamp(sunsetFactor + dawnFactor * 0.7, 0, 1);
    this.tmpColor1
      .copy(FOG_DAY_COLOR)
      .lerp(FOG_SUNSET_COLOR, warmHorizonMix * 0.78)
      .lerp(FOG_NIGHT_COLOR, nightFactor * 0.92);

    if (fogW > 0.001) {
      s.fogColor.lerp(this.tmpColor1, fogW * 0.92);
      s.skyReflectColor.lerp(this.tmpColor1, fogW * 0.72);
      s.horizonReflectColor.lerp(this.tmpColor1, fogW * 0.85);
      s.hemiSkyColor.lerp(this.tmpColor1, fogW * 0.55);
      s.ambientColor.lerp(this.tmpColor1, fogW * 0.42);
      s.dirLightIntensity *= 1 - fogW * 0.42;
      s.ambientIntensity += fogW * 0.09;
      s.hemiIntensity += fogW * 0.06;
      sunGlint *= 1 - fogW * 0.65;
      caustics *= 1 - fogW * 0.55;
    }

    // Modulation météo : Tempête (ciel plombé sombre, houle forte, pluie, brume dense)
    this.tmpColor2
      .copy(STORM_DAY_FOG_COLOR)
      .lerp(STORM_SUNSET_FOG_COLOR, warmHorizonMix * 0.65)
      .lerp(STORM_NIGHT_FOG_COLOR, nightFactor * 0.88);

    if (stormW > 0.001) {
      s.fogColor.lerp(this.tmpColor2, stormW * 0.94);
      s.skyReflectColor.lerp(this.tmpColor2, stormW * 0.85);
      s.horizonReflectColor.lerp(this.tmpColor2, stormW * 0.88);
      s.hemiSkyColor.lerp(this.tmpColor2, stormW * 0.72);
      s.ambientColor.lerp(this.tmpColor2, stormW * 0.52);
      s.dirLightColor.lerp(LIGHTNING_SKY_COLOR, stormW * 0.42);
      // Garde une lisibilité nette du bateau et des côtes proches même en tempête nocturne
      s.dirLightIntensity *= 1 - stormW * 0.48;
      s.ambientIntensity = Math.max(0.32, s.ambientIntensity + stormW * 0.06);
      s.hemiIntensity += stormW * 0.05;

      // Teintes d'océan plus sombres et tourmentées pendant la tempête
      s.waterShallowColor.lerp(STORM_WATER_SHALLOW, stormW * 0.72);
      s.waterMidColor.lerp(STORM_WATER_MID, stormW * 0.78);
      s.waterDeepColor.lerp(STORM_WATER_DEEP, stormW * 0.82);
      s.waterFoamColor.lerp(STORM_WATER_FOAM, stormW * 0.62);

      sunGlint *= 1 - stormW * 0.62;
      caustics *= 1 - stormW * 0.82;
    }

    // Intensités atmosphériques lissées + rafales de vent organiques
    const gustWave =
      0.5 +
      0.32 * Math.sin(this.gustClock * 0.85) +
      0.18 * Math.sin(this.gustClock * 2.15 + 1.4);

    s.stormIntensity = stormW;
    s.fogIntensity = clamp(fogW + stormW * 0.88, 0, 1);
    s.rainIntensity = smoothstep(0.12, 0.85, stormW);
    s.windIntensity = clamp(
      clearW * (0.16 + gustWave * 0.12) +
        fogW * (0.2 + gustWave * 0.1) +
        stormW * (0.76 + gustWave * 0.24),
      0.08,
      1.0,
    );
    s.windDirX = Math.cos(this.windAngle);
    s.windDirZ = Math.sin(this.windAngle);

    // Paramètres de houle synchronisés (océan + bateau)
    s.oceanTime = this.oceanTime;
    s.waveAmplitude =
      clearW * 1.18 + fogW * 0.96 + stormW * (2.05 + gustWave * 0.22);
    s.waveChoppiness = clearW * 0.48 + fogW * 0.35 + stormW * 1.0;
    s.waveSpeedScale = clearW * 1.04 + fogW * 0.88 + stormW * 1.38;

    // Distances de brouillard relatives à la distance caméra-cible :
    // En brouillard / tempête : masque presque tout le décor lointain et les côtes éloignées
    // tout en gardant le bateau (à offset 0) et la zone proche parfaitement reconnaissables !
    const nearClear = 84;
    const farClear = 235;
    const nearFog = 1.5;
    const farFog = 25;
    const nearStorm = 3.0;
    const farStorm = 29;
    s.fogNearOffset = clearW * nearClear + fogW * nearFog + stormW * nearStorm;
    s.fogFarOffset = clearW * farClear + fogW * farFog + stormW * farStorm;

    // Flash d'éclair réaliste (illumine ciel, brume, vagues et relief sans aveugler ni faire exploser le bloom)
    const flash = this.evaluateLightningFlash();
    s.lightningFlash = flash;
    if (flash > 0.005) {
      s.fogColor.lerp(LIGHTNING_SKY_COLOR, flash * 0.48);
      s.skyReflectColor.lerp(LIGHTNING_SKY_COLOR, flash * 0.65);
      s.horizonReflectColor.lerp(LIGHTNING_SKY_COLOR, flash * 0.62);
      s.dirLightColor.lerp(LIGHTNING_DIR_COLOR, flash * 0.78);
      s.dirLightIntensity += flash * 1.15;
      s.ambientColor.lerp(LIGHTNING_SKY_COLOR, flash * 0.52);
      s.ambientIntensity += flash * 0.36;
      s.sunColor.lerp(LIGHTNING_DIR_COLOR, flash * 0.8);
      sunGlint = Math.max(sunGlint, flash * 1.25);
    }

    s.sunGlintIntensity = sunGlint;
    s.causticsIntensity = caustics;
    s.lanternBoost = clamp(
      nightFactor * 0.95 +
        sunsetFactor * 0.45 +
        dawnFactor * 0.32 +
        stormW * 0.72 +
        fogW * 0.55,
      0,
      1,
    );
  }
}

// ============================================================================
// WeatherVfxRenderer — Pluie inclinée au vent & Embruns marins de tempête
// 100 % InstancedMesh poolé (2 draw calls total, 0 allocation par frame, skipSSAO)
// ============================================================================

const RAIN_COUNT = 520;
const SPRAY_MIST_COUNT = 84;

const ISLAND_COASTS_FAST = [
  { x: 0, z: 0, r: 53.5 },
  ...ALL_NEW_ISLANDS.map((id) => ({
    x: NEW_ISLANDS[id].centerX,
    z: NEW_ISLANDS[id].centerZ,
    r: NEW_ISLANDS[id].radius + 2.2,
  })),
];

function isOverOpenWaterFast(x: number, z: number): boolean {
  for (let i = 0; i < ISLAND_COASTS_FAST.length; i++) {
    const isl = ISLAND_COASTS_FAST[i];
    const dx = x - isl.x;
    const dz = z - isl.z;
    if (dx * dx + dz * dz < isl.r * isl.r) {
      return false;
    }
  }
  return true;
}

function createSoftMistTexture(): THREE.Texture {
  if (typeof document === 'undefined') {
    const data = new Uint8Array([220, 232, 238, 128]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    return tex;
  }

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.04,
      size * 0.5,
      size * 0.5,
      size * 0.48,
    );
    grad.addColorStop(0, 'rgba(218, 234, 240, 0.85)');
    grad.addColorStop(0.45, 'rgba(195, 218, 228, 0.42)');
    grad.addColorStop(1, 'rgba(175, 205, 218, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class WeatherVfxRenderer {
  private readonly scene: THREE.Scene;
  private readonly rootGroup = new THREE.Group();
  private readonly disposables: Array<{ dispose(): void }> = [];

  // Pool de gouttes de pluie (InstancedMesh)
  private readonly rainMesh: THREE.InstancedMesh;
  private readonly rainMat: THREE.MeshBasicMaterial;
  private readonly rainX = new Float32Array(RAIN_COUNT);
  private readonly rainY = new Float32Array(RAIN_COUNT);
  private readonly rainZ = new Float32Array(RAIN_COUNT);
  private readonly rainSpeed = new Float32Array(RAIN_COUNT);
  private readonly rainLen = new Float32Array(RAIN_COUNT);

  // Pool d'embruns / brume de crête soufflés par la tempête (InstancedMesh)
  private readonly mistMesh: THREE.InstancedMesh;
  private readonly mistMat: THREE.MeshBasicMaterial;
  private readonly mistX = new Float32Array(SPRAY_MIST_COUNT);
  private readonly mistY = new Float32Array(SPRAY_MIST_COUNT);
  private readonly mistZ = new Float32Array(SPRAY_MIST_COUNT);
  private readonly mistPhase = new Float32Array(SPRAY_MIST_COUNT);
  private readonly mistScale = new Float32Array(SPRAY_MIST_COUNT);

  // Objets temporaires pré-alloués (0 allocation/frame)
  private readonly dummy = new THREE.Object3D();
  private readonly upVec = new THREE.Vector3(0, 1, 0);
  private readonly dropDir = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpColor = new THREE.Color();

  private randState = 48271;
  private animTime = 0;
  private initialized = false;
  private warmupFrames = 2;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.rootGroup.name = 'WeatherAtmosphereVfx';
    this.scene.add(this.rootGroup);

    // 1. Maillage de pluie en croix légère (visible sous tous les azimuts sans calcul billboard coûteux)
    const rainGeo = this.buildCrossedRainStreakGeometry();
    this.disposables.push(rainGeo);
    this.rainMat = new THREE.MeshBasicMaterial({
      color: 0xaec8d8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.disposables.push(this.rainMat);

    this.rainMesh = new THREE.InstancedMesh(rainGeo, this.rainMat, RAIN_COUNT);
    this.rainMesh.name = 'StormRainStreaks';
    this.rainMesh.frustumCulled = false;
    this.rainMesh.castShadow = false;
    this.rainMesh.receiveShadow = false;
    this.rainMesh.renderOrder = 6;
    this.rainMesh.userData.skipSSAO = true;
    // Pré-chauffage GPU à échelle 0 dès la frame 0 (0 stutter & 0 hausse de compteur GPU à la 1re tempête)
    this.dummy.position.set(0, -50, 0);
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.rainMesh.instanceMatrix.needsUpdate = true;
    this.rainMesh.visible = true;
    this.rootGroup.add(this.rainMesh);

    // 2. Embruns marins soufflés par le vent au ras des vagues en tempête
    const mistTex = createSoftMistTexture();
    this.disposables.push(mistTex);
    const mistGeo = new THREE.PlaneGeometry(1, 1);
    this.disposables.push(mistGeo);
    this.mistMat = new THREE.MeshBasicMaterial({
      map: mistTex,
      color: 0xaec6d1,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
    this.disposables.push(this.mistMat);

    this.mistMesh = new THREE.InstancedMesh(mistGeo, this.mistMat, SPRAY_MIST_COUNT);
    this.mistMesh.name = 'StormSeaMistSpray';
    this.mistMesh.frustumCulled = false;
    this.mistMesh.castShadow = false;
    this.mistMesh.receiveShadow = false;
    this.mistMesh.renderOrder = 5;
    this.mistMesh.userData.skipSSAO = true;
    for (let i = 0; i < SPRAY_MIST_COUNT; i++) {
      this.mistMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mistMesh.instanceMatrix.needsUpdate = true;
    this.mistMesh.visible = true;
    this.rootGroup.add(this.mistMesh);
  }

  private buildCrossedRainStreakGeometry(): THREE.BufferGeometry {
    // Deux fins rubans verticaux croisés à 90° (4 triangles par goutte, ultra rapide)
    const w = 0.028;
    const h = 1.0;
    const positions = new Float32Array([
      -w, -h * 0.5, 0,
      w, -h * 0.5, 0,
      w, h * 0.5, 0,
      -w, -h * 0.5, 0,
      w, h * 0.5, 0,
      -w, h * 0.5, 0,

      0, -h * 0.5, -w,
      0, -h * 0.5, w,
      0, h * 0.5, w,
      0, -h * 0.5, -w,
      0, h * 0.5, w,
      0, h * 0.5, -w,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }

  private nextRand(): number {
    this.randState = (Math.imul(this.randState, 1664525) + 1013904223) >>> 0;
    return this.randState / 4294967296;
  }

  private seedParticles(focusX: number, focusZ: number): void {
    for (let i = 0; i < RAIN_COUNT; i++) {
      this.rainX[i] = focusX + (this.nextRand() - 0.5) * 68;
      this.rainY[i] = this.nextRand() * 24;
      this.rainZ[i] = focusZ + (this.nextRand() - 0.5) * 62;
      this.rainSpeed[i] = 28 + this.nextRand() * 14;
      this.rainLen[i] = 1.05 + this.nextRand() * 0.85;
    }

    for (let i = 0; i < SPRAY_MIST_COUNT; i++) {
      this.mistX[i] = focusX + (this.nextRand() - 0.5) * 58;
      this.mistY[i] = 0.35 + this.nextRand() * 1.1;
      this.mistZ[i] = focusZ + (this.nextRand() - 0.5) * 52;
      this.mistPhase[i] = this.nextRand();
      this.mistScale[i] = 2.0 + this.nextRand() * 2.4;
    }

    this.initialized = true;
  }

  public update(
    dt: number,
    weather: WeatherSnapshot,
    focusX: number,
    focusZ: number,
    shipX: number,
    shipZ: number,
    isOverworld: boolean,
  ): void {
    if (!isOverworld) {
      this.rainMesh.visible = false;
      this.mistMesh.visible = false;
      return;
    }

    const safeDt = Math.max(0, Math.min(dt, 0.05));
    this.animTime += safeDt;

    if (!this.initialized) {
      this.seedParticles(focusX, focusZ);
    }

    const warmingUp = this.warmupFrames > 0;
    if (warmingUp) {
      this.warmupFrames -= 1;
    }

    // --- 1. Pluie inclinée au vent (en tempête) ---
    const rainPower = weather.rainIntensity;
    if (rainPower > 0.015) {
      this.rainMesh.visible = true;
      this.rainMat.opacity = clamp(rainPower * (0.44 + weather.lightningFlash * 0.2), 0, 0.58);

      // Teinte des gouttes réactive au cycle jour/nuit & éclairs (plafonnée < 0.78 linéaire)
      this.tmpColor
        .setHex(0xb4cede)
        .lerp(weather.fogColor, 0.28)
        .lerp(LIGHTNING_DIR_COLOR, weather.lightningFlash * 0.55);
      this.rainMat.color.copy(this.tmpColor);

      const windX = weather.windDirX * (6.5 + weather.windIntensity * 9.5);
      const windZ = weather.windDirZ * (6.5 + weather.windIntensity * 9.5);
      const activeCount = Math.max(
        40,
        Math.min(RAIN_COUNT, Math.floor(RAIN_COUNT * (0.25 + 0.75 * rainPower))),
      );

      // Orientation commune inclinée selon la vitesse de chute + vent
      this.dropDir.set(windX, -34, windZ).normalize();
      this.tmpQuat.setFromUnitVectors(this.upVec, this.dropDir);

      const halfSpanX = 34;
      const halfSpanZ = 31;
      const maxH = 24;

      for (let i = 0; i < RAIN_COUNT; i++) {
        if (i >= activeCount) {
          this.dummy.position.set(0, -50, 0);
          this.dummy.scale.set(0, 0, 0);
          this.dummy.updateMatrix();
          this.rainMesh.setMatrixAt(i, this.dummy.matrix);
          continue;
        }

        const spd = this.rainSpeed[i] * (0.85 + 0.3 * rainPower);
        let x = this.rainX[i] + windX * safeDt;
        let y = this.rainY[i] - spd * safeDt;
        let z = this.rainZ[i] + windZ * safeDt;

        if (y < -0.2) {
          y = maxH - this.nextRand() * 3.5;
          x = focusX + (this.nextRand() - 0.5) * (halfSpanX * 2);
          z = focusZ + (this.nextRand() - 0.5) * (halfSpanZ * 2);
        } else {
          // Recyclage toroïdal autour du focus caméra
          if (x - focusX > halfSpanX) x -= halfSpanX * 2;
          else if (x - focusX < -halfSpanX) x += halfSpanX * 2;
          if (z - focusZ > halfSpanZ) z -= halfSpanZ * 2;
          else if (z - focusZ < -halfSpanZ) z += halfSpanZ * 2;
        }

        this.rainX[i] = x;
        this.rainY[i] = y;
        this.rainZ[i] = z;

        // Dégage légèrement la silhouette immédiate du bateau à très courte distance
        const dShipSq = (x - shipX) * (x - shipX) + (z - shipZ) * (z - shipZ);
        const shipClear = dShipSq < 7.5 && y < 4.8 ? 0.45 : 1.0;

        this.dummy.position.set(x, y, z);
        this.dummy.quaternion.copy(this.tmpQuat);
        const len = this.rainLen[i] * (0.75 + 0.45 * rainPower) * shipClear;
        this.dummy.scale.set(1, len, 1);
        this.dummy.updateMatrix();
        this.rainMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.rainMesh.instanceMatrix.needsUpdate = true;
    } else if (warmingUp) {
      this.rainMat.opacity = 0;
      this.rainMesh.visible = true;
    } else {
      this.rainMesh.visible = false;
    }

    // --- 2. Embruns & brume rasante sur la mer en tempête ---
    const mistPower = smoothstep(0.22, 0.9, weather.stormIntensity);
    if (mistPower > 0.015) {
      this.mistMesh.visible = true;
      this.mistMat.opacity = clamp(mistPower * 0.21, 0, 0.24);
      this.tmpColor
        .copy(weather.waterFoamColor)
        .lerp(weather.fogColor, 0.42)
        .lerp(LIGHTNING_SKY_COLOR, weather.lightningFlash * 0.45);
      this.mistMat.color.copy(this.tmpColor);

      const driftX = weather.windDirX * (5.2 + weather.windIntensity * 7.5);
      const driftZ = weather.windDirZ * (5.2 + weather.windIntensity * 7.5);
      const halfX = 30;
      const halfZ = 27;

      for (let i = 0; i < SPRAY_MIST_COUNT; i++) {
        let phase = this.mistPhase[i] + safeDt * (0.34 + (i % 5) * 0.04);
        let x = this.mistX[i] + driftX * safeDt;
        let z = this.mistZ[i] + driftZ * safeDt;

        if (phase >= 1) {
          phase -= 1;
          x = focusX + (this.nextRand() - 0.5) * halfX * 2;
          z = focusZ + (this.nextRand() - 0.5) * halfZ * 2;
          this.mistY[i] = 0.25 + this.nextRand() * 0.95;
        } else {
          if (x - focusX > halfX) x -= halfX * 2;
          else if (x - focusX < -halfX) x += halfX * 2;
          if (z - focusZ > halfZ) z -= halfZ * 2;
          else if (z - focusZ < -halfZ) z += halfZ * 2;
        }

        this.mistPhase[i] = phase;
        this.mistX[i] = x;
        this.mistZ[i] = z;

        // Visible uniquement au-dessus de l'eau et hors bulle proche du bateau (lisibilité maximale)
        const dShipSq = (x - shipX) * (x - shipX) + (z - shipZ) * (z - shipZ);
        if (dShipSq < 18.0 || !isOverOpenWaterFast(x, z)) {
          this.dummy.position.set(0, -50, 0);
          this.dummy.scale.set(0, 0, 0);
          this.dummy.updateMatrix();
          this.mistMesh.setMatrixAt(i, this.dummy.matrix);
          continue;
        }

        const env = Math.sin(phase * Math.PI);
        const s = this.mistScale[i] * (0.65 + 0.55 * env) * mistPower;
        const y = this.mistY[i] + env * 0.65;

        this.dummy.position.set(x, y, z);
        this.dummy.rotation.set(-0.55, 0, Math.sin(this.animTime * 0.7 + i) * 0.12);
        this.dummy.scale.set(s * 1.45, s * 0.68, 1);
        this.dummy.updateMatrix();
        this.mistMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.mistMesh.instanceMatrix.needsUpdate = true;
    } else if (warmingUp) {
      this.mistMat.opacity = 0;
      this.mistMesh.visible = true;
    } else {
      this.mistMesh.visible = false;
    }
  }

  public dispose(): void {
    this.scene.remove(this.rootGroup);
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;
  }
}
