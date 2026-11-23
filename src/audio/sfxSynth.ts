import type { SfxId } from '../game/types';

// Cache d'un buffer de bruit blanc par AudioContext pour éviter toute allocation répétée
const noiseBufferCache = new WeakMap<AudioContext, AudioBuffer>();

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const existing = noiseBufferCache.get(ctx);
  if (existing) return existing;

  const duration = 1.5;
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Bruit blanc légèrement adouci pour éviter l'agressivité numérique
  let prev = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    data[i] = white * 0.85 + prev * 0.15;
    prev = white;
  }
  noiseBufferCache.set(ctx, buffer);
  return buffer;
}

/**
 * Enveloppe ADSR propre (sans clic ni saturation) sur un GainNode.
 */
function applyAdsr(
  gainParam: AudioParam,
  now: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): number {
  const safePeak = Math.max(0.0005, peak);
  const atk = Math.max(0.003, attack);
  const rel = Math.max(0.01, release);
  const endTime = now + atk + hold + rel;

  gainParam.setValueAtTime(0.0001, now);
  gainParam.linearRampToValueAtTime(safePeak, now + atk);
  if (hold > 0) {
    gainParam.setValueAtTime(safePeak, now + atk + hold);
  }
  gainParam.exponentialRampToValueAtTime(0.0001, endTime);
  return endTime;
}

function playNoiseBurst(
  ctx: AudioContext,
  dest: AudioNode,
  now: number,
  opts: {
    filterType: BiquadFilterType;
    startFreq: number;
    endFreq?: number;
    q?: number;
    peak: number;
    attack: number;
    hold?: number;
    release: number;
  },
): void {
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.setValueAtTime(Math.max(40, opts.startFreq), now);
  if (opts.endFreq !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.endFreq),
      now + opts.attack + (opts.hold ?? 0) + opts.release,
    );
  }
  filter.Q.setValueAtTime(opts.q ?? 1.2, now);

  const gain = ctx.createGain();
  const endTime = applyAdsr(
    gain.gain,
    now,
    opts.peak,
    opts.attack,
    opts.hold ?? 0,
    opts.release,
  );

  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  const randomOffset = Math.random() * 0.4;
  src.start(now, randomOffset);
  src.stop(endTime + 0.02);
}

function playTone(
  ctx: AudioContext,
  dest: AudioNode,
  now: number,
  opts: {
    type: OscillatorType;
    startFreq: number;
    endFreq?: number;
    peak: number;
    attack: number;
    hold?: number;
    release: number;
    detune?: number;
    filterFreq?: number;
  },
): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(Math.max(20, opts.startFreq), now);
  if (opts.detune !== undefined) {
    osc.detune.setValueAtTime(opts.detune, now);
  }

  const gain = ctx.createGain();
  const endTime = applyAdsr(
    gain.gain,
    now,
    opts.peak,
    opts.attack,
    opts.hold ?? 0,
    opts.release,
  );

  if (opts.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, opts.endFreq),
      endTime,
    );
  }

  if (opts.filterFreq !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(opts.filterFreq, now);
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }

  gain.connect(dest);
  osc.start(now);
  osc.stop(endTime + 0.02);
}

/**
 * Synthétise et joue l'un des 14 effets sonores procéduraux du jeu.
 */
export function playProceduralSfx(
  ctx: AudioContext,
  destination: AudioNode,
  name: SfxId,
): void {
  const now = ctx.currentTime + 0.002;

  switch (name) {
    case 'sword_swing': {
      // Bruit blanc passe-bande balayé + léger souffle d'air
      playNoiseBurst(ctx, destination, now, {
        filterType: 'bandpass',
        startFreq: 2100,
        endFreq: 480,
        q: 2.1,
        peak: 0.34,
        attack: 0.012,
        hold: 0.015,
        release: 0.115,
      });
      playTone(ctx, destination, now, {
        type: 'sine',
        startFreq: 420,
        endFreq: 155,
        peak: 0.12,
        attack: 0.008,
        release: 0.09,
      });
      break;
    }

    case 'sword_hit': {
      // Impact percussif triangle + court bruit craquant
      playTone(ctx, destination, now, {
        type: 'triangle',
        startFreq: 230,
        endFreq: 68,
        peak: 0.42,
        attack: 0.004,
        hold: 0.01,
        release: 0.095,
      });
      playNoiseBurst(ctx, destination, now, {
        filterType: 'bandpass',
        startFreq: 1500,
        endFreq: 550,
        q: 1.4,
        peak: 0.28,
        attack: 0.003,
        release: 0.06,
      });
      break;
    }

    case 'crit_hit': {
      // Impact renforcé + harmonique cristalline éclatante
      playTone(ctx, destination, now, {
        type: 'triangle',
        startFreq: 280,
        endFreq: 58,
        peak: 0.46,
        attack: 0.004,
        hold: 0.015,
        release: 0.12,
      });
      playNoiseBurst(ctx, destination, now, {
        filterType: 'bandpass',
        startFreq: 2200,
        endFreq: 750,
        q: 1.6,
        peak: 0.26,
        attack: 0.003,
        release: 0.075,
      });
      const sparkleNotes = [880, 1318.5, 1760];
      sparkleNotes.forEach((freq, idx) => {
        playTone(ctx, destination, now + 0.01 + idx * 0.022, {
          type: idx === 2 ? 'sine' : 'triangle',
          startFreq: freq,
          peak: 0.17 - idx * 0.03,
          attack: 0.005,
          hold: 0.015,
          release: 0.22,
        });
      });
      break;
    }

    case 'dodge_whoosh': {
      // Filtre passe-bas descendant rapide et aérien
      playNoiseBurst(ctx, destination, now, {
        filterType: 'lowpass',
        startFreq: 1650,
        endFreq: 210,
        q: 1.5,
        peak: 0.3,
        attack: 0.018,
        hold: 0.025,
        release: 0.16,
      });
      playTone(ctx, destination, now, {
        type: 'sine',
        startFreq: 310,
        endFreq: 120,
        peak: 0.14,
        attack: 0.012,
        release: 0.14,
      });
      break;
    }

    case 'spell_fire': {
      // Grondement grave + crépitement passe-bande enflammé
      playTone(ctx, destination, now, {
        type: 'sawtooth',
        startFreq: 128,
        endFreq: 52,
        peak: 0.26,
        attack: 0.02,
        hold: 0.06,
        release: 0.34,
        filterFreq: 320,
      });
      playNoiseBurst(ctx, destination, now, {
        filterType: 'bandpass',
        startFreq: 680,
        endFreq: 1850,
        q: 1.3,
        peak: 0.32,
        attack: 0.015,
        hold: 0.06,
        release: 0.28,
      });
      playNoiseBurst(ctx, destination, now + 0.09, {
        filterType: 'bandpass',
        startFreq: 2400,
        endFreq: 900,
        q: 2.4,
        peak: 0.2,
        attack: 0.01,
        release: 0.24,
      });
      break;
    }

    case 'spell_lightning': {
      // Dents de scie modulées haute fréquence (FM) + craquement électrique
      const carrier = ctx.createOscillator();
      carrier.type = 'sawtooth';
      carrier.frequency.setValueAtTime(1180, now);
      carrier.frequency.exponentialRampToValueAtTime(240, now + 0.25);

      const mod = ctx.createOscillator();
      mod.type = 'square';
      mod.frequency.setValueAtTime(62, now);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(340, now);
      modGain.gain.exponentialRampToValueAtTime(45, now + 0.25);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1900, now);
      bp.Q.setValueAtTime(1.1, now);

      const gain = ctx.createGain();
      const endTime = applyAdsr(gain.gain, now, 0.26, 0.005, 0.04, 0.22);

      mod.connect(modGain);
      modGain.connect(carrier.frequency);
      carrier.connect(bp);
      bp.connect(gain);
      gain.connect(destination);

      carrier.start(now);
      mod.start(now);
      carrier.stop(endTime + 0.02);
      mod.stop(endTime + 0.02);

      playNoiseBurst(ctx, destination, now, {
        filterType: 'highpass',
        startFreq: 3200,
        endFreq: 1800,
        q: 0.9,
        peak: 0.26,
        attack: 0.003,
        release: 0.075,
      });
      playNoiseBurst(ctx, destination, now + 0.065, {
        filterType: 'highpass',
        startFreq: 4200,
        endFreq: 2200,
        q: 1.2,
        peak: 0.18,
        attack: 0.003,
        release: 0.09,
      });
      break;
    }

    case 'spell_ice': {
      // Arpège aigu cristallin sinusoïdal + léger souffle givré
      const notes = [1046.5, 1318.5, 1568.0, 1975.5, 2349.3];
      notes.forEach((freq, i) => {
        const start = now + i * 0.038;
        playTone(ctx, destination, start, {
          type: 'sine',
          startFreq: freq,
          peak: 0.18 - i * 0.018,
          attack: 0.006,
          hold: 0.02,
          release: 0.3,
        });
        playTone(ctx, destination, start, {
          type: 'triangle',
          startFreq: freq * 2,
          peak: 0.045,
          attack: 0.004,
          release: 0.16,
        });
      });
      playNoiseBurst(ctx, destination, now, {
        filterType: 'highpass',
        startFreq: 4800,
        endFreq: 2800,
        q: 1.5,
        peak: 0.13,
        attack: 0.02,
        release: 0.26,
      });
      break;
    }

    case 'spell_heal': {
      // Accord majeur ascendant doux et lumineux (C5 - E5 - G5 - B5 - D6)
      const chord = [523.25, 659.25, 783.99, 987.77, 1174.66];
      chord.forEach((freq, i) => {
        const start = now + i * 0.058;
        playTone(ctx, destination, start, {
          type: 'sine',
          startFreq: freq,
          peak: 0.16,
          attack: 0.03,
          hold: 0.07,
          release: 0.44,
        });
        playTone(ctx, destination, start, {
          type: 'triangle',
          startFreq: freq * 1.003,
          peak: 0.05,
          attack: 0.04,
          release: 0.38,
        });
      });
      break;
    }

    case 'player_hurt': {
      // Court miaulement/pitch descendant + petit choc sourd
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(620, now);
      osc.frequency.linearRampToValueAtTime(710, now + 0.04);
      osc.frequency.exponentialRampToValueAtTime(300, now + 0.22);

      const formant = ctx.createBiquadFilter();
      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(1150, now);
      formant.frequency.exponentialRampToValueAtTime(580, now + 0.22);
      formant.Q.setValueAtTime(2.6, now);

      const gain = ctx.createGain();
      const endTime = applyAdsr(gain.gain, now, 0.42, 0.01, 0.04, 0.18);

      osc.connect(formant);
      formant.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(endTime + 0.02);

      playTone(ctx, destination, now, {
        type: 'sine',
        startFreq: 165,
        endFreq: 58,
        peak: 0.26,
        attack: 0.004,
        release: 0.1,
      });
      break;
    }

    case 'chest_open': {
      // Petit clic de loquet + fanfare 4 notes joyeuse (G4 - B4 - D5 - G5)
      playNoiseBurst(ctx, destination, now, {
        filterType: 'bandpass',
        startFreq: 1200,
        q: 2.5,
        peak: 0.14,
        attack: 0.003,
        release: 0.03,
      });
      const fanfare = [
        { freq: 392.0, offset: 0.03, hold: 0.04, rel: 0.16, peak: 0.22 },
        { freq: 493.88, offset: 0.12, hold: 0.04, rel: 0.16, peak: 0.23 },
        { freq: 587.33, offset: 0.21, hold: 0.04, rel: 0.18, peak: 0.24 },
        { freq: 783.99, offset: 0.31, hold: 0.12, rel: 0.34, peak: 0.28 },
      ];
      for (const n of fanfare) {
        playTone(ctx, destination, now + n.offset, {
          type: 'triangle',
          startFreq: n.freq,
          peak: n.peak,
          attack: 0.01,
          hold: n.hold,
          release: n.rel,
        });
        playTone(ctx, destination, now + n.offset, {
          type: 'sine',
          startFreq: n.freq * 2,
          peak: n.peak * 0.3,
          attack: 0.012,
          hold: n.hold * 0.5,
          release: n.rel * 0.8,
        });
      }
      break;
    }

    case 'level_up': {
      // Arpège héroïque brillant suivi d'un accord triomphal
      const arp = [523.25, 659.25, 783.99, 987.77, 1046.5];
      arp.forEach((freq, i) => {
        const start = now + i * 0.075;
        playTone(ctx, destination, start, {
          type: 'triangle',
          startFreq: freq,
          peak: 0.22,
          attack: 0.01,
          hold: 0.04,
          release: 0.22,
        });
        playTone(ctx, destination, start, {
          type: 'sine',
          startFreq: freq * 2,
          peak: 0.08,
          attack: 0.01,
          release: 0.18,
        });
      });
      const chordStart = now + 0.38;
      for (const freq of [523.25, 783.99, 1046.5, 1318.51]) {
        playTone(ctx, destination, chordStart, {
          type: 'sine',
          startFreq: freq,
          peak: 0.15,
          attack: 0.025,
          hold: 0.16,
          release: 0.45,
        });
      }
      break;
    }

    case 'coin_pickup': {
      // Double tintement aigu cristallin (B5 -> E6)
      playTone(ctx, destination, now, {
        type: 'sine',
        startFreq: 987.77,
        peak: 0.22,
        attack: 0.004,
        hold: 0.01,
        release: 0.11,
      });
      playTone(ctx, destination, now + 0.065, {
        type: 'sine',
        startFreq: 1318.51,
        peak: 0.25,
        attack: 0.004,
        hold: 0.02,
        release: 0.2,
      });
      playTone(ctx, destination, now + 0.065, {
        type: 'triangle',
        startFreq: 2637.02,
        peak: 0.06,
        attack: 0.004,
        release: 0.12,
      });
      break;
    }

    case 'meow_ui': {
      // Petit miaulement synthétique mignon pour dialogues & auberge
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(540, now);
      osc.frequency.exponentialRampToValueAtTime(790, now + 0.075);
      osc.frequency.exponentialRampToValueAtTime(485, now + 0.21);

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1100, now);
      filter.frequency.linearRampToValueAtTime(1850, now + 0.08);
      filter.frequency.linearRampToValueAtTime(920, now + 0.21);
      filter.Q.setValueAtTime(2.2, now);

      const gain = ctx.createGain();
      const endTime = applyAdsr(gain.gain, now, 0.34, 0.018, 0.055, 0.145);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(destination);
      osc.start(now);
      osc.stop(endTime + 0.02);

      // Douce harmonique sinusoïdale de soutien
      playTone(ctx, destination, now, {
        type: 'sine',
        startFreq: 540,
        endFreq: 495,
        peak: 0.1,
        attack: 0.02,
        hold: 0.05,
        release: 0.14,
      });
      break;
    }

    case 'boss_roar': {
      // Oscillateur grave modulé + bruit filtré puissant pour transition phase 2
      const saw = ctx.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.setValueAtTime(106, now);
      saw.frequency.exponentialRampToValueAtTime(54, now + 0.82);

      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(64, now);
      sub.frequency.exponentialRampToValueAtTime(34, now + 0.85);

      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(24, now);
      const lfoGain = ctx.createGain();
      lfoGain.gain.setValueAtTime(18, now);
      lfo.connect(lfoGain);
      lfoGain.connect(saw.frequency);

      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(680, now);
      lp.frequency.exponentialRampToValueAtTime(210, now + 0.82);
      lp.Q.setValueAtTime(3.2, now);

      const voiceGain = ctx.createGain();
      const endTime = applyAdsr(voiceGain.gain, now, 0.36, 0.05, 0.34, 0.46);

      saw.connect(lp);
      sub.connect(lp);
      lp.connect(voiceGain);
      voiceGain.connect(destination);

      saw.start(now);
      sub.start(now);
      lfo.start(now);
      saw.stop(endTime + 0.03);
      sub.stop(endTime + 0.03);
      lfo.stop(endTime + 0.03);

      playNoiseBurst(ctx, destination, now, {
        filterType: 'bandpass',
        startFreq: 480,
        endFreq: 170,
        q: 1.6,
        peak: 0.3,
        attack: 0.06,
        hold: 0.28,
        release: 0.48,
      });
      break;
    }
  }
}
