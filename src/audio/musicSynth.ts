import type { MusicTrackId } from '../game/types';

// Conversion note MIDI -> fréquence en Hz
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface TrackSchedulerState {
  step: number;
  nextNoteTime: number;
  gainNode: GainNode;
  active: boolean;
  fadeOutEndTime: number;
}

const DEFAULT_CROSSFADE_SEC = 0.6;
const LOOKAHEAD_SEC = 0.14;
const TICK_INTERVAL_MS = 40;

// ============================================================================
// Partitions procédurales (64 croches = 8 mesures en 4/4 par thème)
// ============================================================================

// 1) Overworld — Sol majeur pastoral, 112 BPM (harpe/luth + flûte douce + basse)
// Accords : G | D/F# | Em | C | G | C | Am | D
const OVERWORLD_HARP: readonly (number | null)[] = [
  // Mesure 1 : G (G3 B3 D4 G4)
  55, 59, 62, 67, 62, 59, 62, 67,
  // Mesure 2 : D/F# (F#3 A3 D4 F#4)
  54, 57, 62, 66, 62, 57, 62, 66,
  // Mesure 3 : Em (E3 G3 B3 E4)
  52, 55, 59, 64, 59, 55, 59, 64,
  // Mesure 4 : C (C3 G3 C4 E4)
  48, 55, 60, 64, 60, 55, 60, 64,
  // Mesure 5 : G
  55, 59, 62, 67, 62, 59, 62, 67,
  // Mesure 6 : C
  48, 55, 60, 64, 67, 64, 60, 55,
  // Mesure 7 : Am (A3 C4 E4 A4)
  57, 60, 64, 69, 64, 60, 64, 60,
  // Mesure 8 : D7 (D3 A3 D4 F#4)
  50, 57, 62, 66, 62, 60, 57, 54,
];

const OVERWORLD_FLUTE: readonly (number | null)[] = [
  // Mesure 1 (G)
  71, null, 74, null, 79, null, 78, 74,
  // Mesure 2 (D)
  76, null, 74, null, 69, null, null, null,
  // Mesure 3 (Em)
  71, null, 72, null, 74, null, 71, 67,
  // Mesure 4 (C)
  69, null, 72, null, 71, null, 69, null,
  // Mesure 5 (G - phrase B plus lumineuse)
  74, null, 79, null, 81, null, 79, 76,
  // Mesure 6 (C)
  79, null, 76, null, 72, null, 74, null,
  // Mesure 7 (Am)
  76, null, 74, 72, 71, null, 69, null,
  // Mesure 8 (D)
  74, null, 71, null, 69, null, null, null,
];

const OVERWORLD_BASS: readonly (number | null)[] = [
  43, null, null, null, 43, null, null, null,
  42, null, null, null, 42, null, null, null,
  40, null, null, null, 40, null, null, null,
  36, null, null, null, 36, null, null, null,
  43, null, null, null, 43, null, null, null,
  36, null, null, null, 36, null, null, null,
  45, null, null, null, 45, null, null, null,
  38, null, null, null, 38, null, null, null,
];

// 2) Donjon — Ré mineur mystérieux, 96 BPM (pizzicato léger + basse feutrée + carillon)
// Accords : Dm | Bb | Gm | A7 | Dm | C | Bb | A7
const DUNGEON_PIZZ: readonly (number | null)[] = [
  // Dm
  62, null, 65, 69, null, 65, 62, null,
  // Bb
  58, null, 62, 65, null, 62, 58, null,
  // Gm
  55, null, 58, 62, null, 58, 55, null,
  // A7
  57, null, 61, 64, null, 67, 64, 61,
  // Dm
  62, null, 69, 65, null, 62, 65, null,
  // C
  60, null, 64, 67, null, 64, 60, null,
  // Bb
  58, null, 62, 65, null, 69, 65, null,
  // A7
  57, null, 61, 64, null, 61, null, null,
];

const DUNGEON_BASS: readonly (number | null)[] = [
  38, null, null, null, null, null, 45, null,
  34, null, null, null, null, null, 41, null,
  43, null, null, null, null, null, 38, null,
  33, null, null, null, null, null, 40, null,
  38, null, null, null, null, null, 45, null,
  36, null, null, null, null, null, 43, null,
  34, null, null, null, null, null, 41, null,
  33, null, null, null, 33, null, null, null,
];

const DUNGEON_CHIME: readonly (number | null)[] = [
  null, null, null, null, 74, null, null, null,
  null, null, 77, null, null, null, null, null,
  null, null, null, null, 79, null, 77, null,
  76, null, null, null, null, null, 73, null,
  null, null, 81, null, null, null, null, null,
  null, null, 79, null, null, null, 76, null,
  74, null, null, null, 77, null, null, null,
  76, null, null, null, 73, null, null, null,
];

// 3) Boss — Mi mineur épique, 136 BPM (basse rapide + accords rythmiques + mélodie héroïque)
// Progression : Em | C | D | B7 | Em | G | Am | B7
const BOSS_BASS: readonly number[] = [
  // Em (E2 = 40)
  40, 40, 47, 40, 40, 40, 47, 43,
  // C (C2 = 36)
  36, 36, 43, 36, 36, 36, 43, 40,
  // D (D2 = 38)
  38, 38, 45, 38, 38, 38, 45, 42,
  // B7 (B1 = 35)
  35, 35, 42, 35, 35, 39, 42, 47,
  // Em
  40, 40, 47, 40, 40, 40, 47, 43,
  // G (G2 = 43)
  43, 43, 50, 43, 43, 43, 50, 47,
  // Am (A2 = 45)
  45, 45, 52, 45, 45, 45, 50, 48,
  // B7
  35, 35, 42, 35, 47, 45, 42, 39,
];

const BOSS_CHORDS: readonly (readonly number[] | null)[] = [
  // Mesure 1 : Em
  [52, 55, 59], null, null, [52, 55, 59], null, null, [52, 55, 59], null,
  // Mesure 2 : C
  [48, 52, 55], null, null, [48, 52, 55], null, null, [48, 52, 55], null,
  // Mesure 3 : D
  [50, 54, 57], null, null, [50, 54, 57], null, null, [50, 54, 57], null,
  // Mesure 4 : B7
  [47, 51, 54], null, null, [47, 51, 54], null, [47, 51, 57], null, null,
  // Mesure 5 : Em
  [52, 55, 59], null, null, [52, 55, 59], null, null, [52, 55, 59], null,
  // Mesure 6 : G
  [55, 59, 62], null, null, [55, 59, 62], null, null, [55, 59, 62], null,
  // Mesure 7 : Am
  [57, 60, 64], null, null, [57, 60, 64], null, null, [57, 60, 64], null,
  // Mesure 8 : B7
  [47, 51, 54], null, [47, 51, 54], null, [47, 51, 57], null, [47, 51, 54], null,
];

const BOSS_LEAD: readonly (number | null)[] = [
  // Mesure 1 (Em)
  64, null, 67, null, 71, null, 74, 71,
  // Mesure 2 (C)
  72, null, 71, null, 67, null, 64, null,
  // Mesure 3 (D)
  66, null, 69, null, 74, null, 72, 69,
  // Mesure 4 (B7)
  71, null, 66, null, 63, null, null, null,
  // Mesure 5 (Em)
  76, null, 74, 71, 76, null, 79, null,
  // Mesure 6 (G)
  78, null, 74, null, 71, null, 74, null,
  // Mesure 7 (Am)
  76, null, 72, null, 69, null, 72, 76,
  // Mesure 8 (B7)
  75, null, 71, null, 78, null, 75, null,
];

const TRACK_STEP_SEC: Record<MusicTrackId, number> = {
  overworld: 60 / 112 / 2, // 112 BPM en croches (~0.268 s)
  dungeon: 60 / 96 / 2,    // 96 BPM en croches (0.3125 s)
  boss: 60 / 136 / 2,      // 136 BPM en croches (~0.221 s)
};

/**
 * Séquenceur musical procédural Web Audio API pour les 3 thèmes
 * (overworld, dungeon, boss) avec crossfade doux de 0.6 s.
 */
export class MusicSynth {
  private readonly ctx: AudioContext;
  private readonly tracks: Record<MusicTrackId, TrackSchedulerState>;
  private currentTheme: MusicTrackId | null = null;
  private timerId: number | null = null;
  private disposed = false;

  constructor(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;

    const createTrackState = (): TrackSchedulerState => {
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, ctx.currentTime);
      gainNode.connect(destination);
      return {
        step: 0,
        nextNoteTime: ctx.currentTime + 0.05,
        gainNode,
        active: false,
        fadeOutEndTime: 0,
      };
    };

    this.tracks = {
      overworld: createTrackState(),
      dungeon: createTrackState(),
      boss: createTrackState(),
    };
  }

  public getCurrentTheme(): MusicTrackId | null {
    return this.currentTheme;
  }

  /**
   * Lance ou bascule vers un thème musical avec crossfade doux (0.6 s par défaut).
   */
  public setTheme(
    theme: MusicTrackId | null,
    fadeSeconds = DEFAULT_CROSSFADE_SEC,
  ): void {
    if (this.disposed) return;
    if (theme === this.currentTheme) {
      if (theme !== null) {
        this.ensureSchedulerRunning();
      }
      return;
    }

    const now = this.ctx.currentTime;
    const fade = Math.max(0.05, fadeSeconds);

    // Fondu sortant de l'ancien thème (et de tout autre thème résiduel)
    (Object.keys(this.tracks) as MusicTrackId[]).forEach((id) => {
      const state = this.tracks[id];
      if (id === theme) return;
      if (state.active || state.fadeOutEndTime > now) {
        const g = state.gainNode.gain;
        const currentVal = g.value;
        g.cancelScheduledValues(now);
        g.setValueAtTime(Math.max(0.0001, currentVal), now);
        g.linearRampToValueAtTime(0.0001, now + fade);
        g.setValueAtTime(0, now + fade + 0.01);
        state.active = false;
        state.fadeOutEndTime = now + fade + 0.02;
      }
    });

    this.currentTheme = theme;

    // Fondu entrant du nouveau thème
    if (theme !== null) {
      const next = this.tracks[theme];
      const g = next.gainNode.gain;
      const startVal = Math.max(0.0001, g.value);
      g.cancelScheduledValues(now);
      g.setValueAtTime(startVal, now);
      g.linearRampToValueAtTime(1.0, now + fade);

      if (!next.active && next.fadeOutEndTime <= now) {
        next.step = 0;
        next.nextNoteTime = now + 0.04;
      } else if (next.nextNoteTime < now) {
        next.nextNoteTime = now + 0.04;
      }
      next.active = true;
      next.fadeOutEndTime = 0;
      this.ensureSchedulerRunning();
    }
  }

  public stop(fadeSeconds = 0.25): void {
    this.setTheme(null, fadeSeconds);
  }

  public dispose(): void {
    this.disposed = true;
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    const now = this.ctx.currentTime;
    (Object.keys(this.tracks) as MusicTrackId[]).forEach((id) => {
      const state = this.tracks[id];
      state.active = false;
      state.fadeOutEndTime = 0;
      try {
        state.gainNode.gain.cancelScheduledValues(now);
        state.gainNode.gain.setValueAtTime(0, now);
        state.gainNode.disconnect();
      } catch {
        // Ignore si déjà déconnecté
      }
    });
    this.currentTheme = null;
  }

  private ensureSchedulerRunning(): void {
    if (this.timerId !== null || this.disposed) return;
    this.timerId = window.setInterval(() => this.schedulerTick(), TICK_INTERVAL_MS);
    this.schedulerTick();
  }

  private schedulerTick(): void {
    if (this.disposed) return;
    if (this.ctx.state !== 'running') return;

    const now = this.ctx.currentTime;
    let anyTrackAlive = false;

    (Object.keys(this.tracks) as MusicTrackId[]).forEach((id) => {
      const state = this.tracks[id];
      const stillAudible = state.active || state.fadeOutEndTime > now;
      if (!stillAudible) return;
      anyTrackAlive = true;

      const stepSec = TRACK_STEP_SEC[id];
      // Évite le rattrapage massif après changement d'onglet
      if (state.nextNoteTime < now - stepSec * 2) {
        state.nextNoteTime = now + 0.02;
      }

      while (state.nextNoteTime < now + LOOKAHEAD_SEC) {
        this.scheduleTrackStep(id, state.step, state.nextNoteTime, state.gainNode);
        state.nextNoteTime += stepSec;
        state.step = (state.step + 1) % 64;
      }
    });

    if (!anyTrackAlive && this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private scheduleTrackStep(
    theme: MusicTrackId,
    step: number,
    time: number,
    bus: GainNode,
  ): void {
    const stepSec = TRACK_STEP_SEC[theme];

    if (theme === 'overworld') {
      const harpNote = OVERWORLD_HARP[step];
      if (harpNote !== null) {
        this.playPluck(bus, time, midiToFreq(harpNote), 0.24, stepSec * 1.45, 2100);
      }

      const fluteNote = OVERWORLD_FLUTE[step];
      if (fluteNote !== null) {
        this.playFlute(bus, time, midiToFreq(fluteNote), 0.22, stepSec * 1.85);
      }

      const bassNote = OVERWORLD_BASS[step];
      if (bassNote !== null) {
        this.playSoftBass(bus, time, midiToFreq(bassNote), 0.26, stepSec * 3.1);
      }
      return;
    }

    if (theme === 'dungeon') {
      const pizzNote = DUNGEON_PIZZ[step];
      if (pizzNote !== null) {
        this.playPluck(bus, time, midiToFreq(pizzNote), 0.24, stepSec * 0.65, 1450);
      }

      const bassNote = DUNGEON_BASS[step];
      if (bassNote !== null) {
        this.playSoftBass(bus, time, midiToFreq(bassNote), 0.3, stepSec * 2.6);
      }

      const chimeNote = DUNGEON_CHIME[step];
      if (chimeNote !== null) {
        this.playBell(bus, time, midiToFreq(chimeNote), 0.14, stepSec * 2.2);
      }
      return;
    }

    // Thème 'boss'
    const bassNote = BOSS_BASS[step];
    const isAccent = step % 4 === 0;
    this.playBossBass(
      bus,
      time,
      midiToFreq(bassNote),
      isAccent ? 0.3 : 0.21,
      stepSec * 0.82,
    );

    const chord = BOSS_CHORDS[step];
    if (chord !== null) {
      for (const midi of chord) {
        this.playBossChordNote(bus, time, midiToFreq(midi), 0.11, stepSec * 1.05);
      }
    }

    const leadNote = BOSS_LEAD[step];
    if (leadNote !== null) {
      this.playBossLead(bus, time, midiToFreq(leadNote), 0.2, stepSec * 1.55);
    }

    // Pulsation percussive légère (timbale sur temps forts)
    if (step % 4 === 0) {
      this.playTimpani(bus, time, step % 8 === 0 ? 110 : 88, 0.24);
    }
  }

  private playPluck(
    bus: GainNode,
    time: number,
    freq: number,
    peak: number,
    duration: number,
    cutoff: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(Math.max(320, cutoff * 0.32), time + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private playFlute(
    bus: GainNode,
    time: number,
    freq: number,
    peak: number,
    duration: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    const overtone = this.ctx.createOscillator();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(freq * 2, time);

    const overGain = this.ctx.createGain();
    overGain.gain.setValueAtTime(0.14, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.032);
    gain.gain.setValueAtTime(peak * 0.85, time + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(gain);
    overtone.connect(overGain);
    overGain.connect(gain);
    gain.connect(bus);

    osc.start(time);
    overtone.start(time);
    osc.stop(time + duration + 0.02);
    overtone.stop(time + duration + 0.02);
  }

  private playSoftBass(
    bus: GainNode,
    time: number,
    freq: number,
    peak: number,
    duration: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private playBell(
    bus: GainNode,
    time: number,
    freq: number,
    peak: number,
    duration: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private playBossBass(
    bus: GainNode,
    time: number,
    freq: number,
    peak: number,
    duration: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, time);
    filter.frequency.exponentialRampToValueAtTime(180, time + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private playBossChordNote(
    bus: GainNode,
    time: number,
    freq: number,
    peak: number,
    duration: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1350, time);
    filter.frequency.exponentialRampToValueAtTime(480, time + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc.stop(time + duration + 0.02);
  }

  private playBossLead(
    bus: GainNode,
    time: number,
    freq: number,
    peak: number,
    duration: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sawtooth';
    osc2.frequency.setValueAtTime(freq, time);
    osc2.detune.setValueAtTime(5, time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2200, time);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.015);
    gain.gain.setValueAtTime(peak * 0.78, time + duration * 0.65);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);

    const osc2Mix = this.ctx.createGain();
    osc2Mix.gain.setValueAtTime(0.35, time);

    osc.connect(filter);
    osc2.connect(osc2Mix);
    osc2Mix.connect(filter);
    filter.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + duration + 0.02);
    osc2.stop(time + duration + 0.02);
  }

  private playTimpani(
    bus: GainNode,
    time: number,
    startFreq: number,
    peak: number,
  ): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.14);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(peak, time + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.16);

    osc.connect(gain);
    gain.connect(bus);

    osc.start(time);
    osc.stop(time + 0.18);
  }
}
