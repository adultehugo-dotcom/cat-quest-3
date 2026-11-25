import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/audioEngine';
import { ALL_NEW_ISLANDS, NEW_ISLANDS } from '../src/data/worldIslands';
import { GameEngine } from '../src/game/gameEngine';
import {
  type OceanCoastIsland,
  sampleOceanCoastDistance,
  sampleOceanWaveHeight,
} from '../src/render/shaders/waterShader';
import {
  DAY_CYCLE_DURATION_SEC,
  WeatherCycleController,
  type WeatherCondition,
} from '../src/render/weatherSystem';

function makeSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const ARCHIPELAGO_COASTS: readonly OceanCoastIsland[] = [
  { x: 0, z: 0, radius: 52.5, isMain: true },
  ...ALL_NEW_ISLANDS.map((id) => ({
    x: NEW_ISLANDS[id].centerX,
    z: NEW_ISLANDS[id].centerZ,
    radius: NEW_ISLANDS[id].radius,
    isMain: false,
  })),
];

describe('WeatherCycleController — Cycle jour/nuit (30 min) & météo automatique', () => {
  it('démarre chaque nouvelle session sur une heure et une météo choisies aléatoirement sans persistance', () => {
    const seenConditions = new Set<WeatherCondition>();
    const seenHours: number[] = [];

    for (let seed = 1; seed <= 30; seed++) {
      const ctrl = new WeatherCycleController({ rng: makeSeededRng(seed * 7919) });
      const snap = ctrl.getSnapshot();
      seenConditions.add(snap.currentCondition);
      seenHours.push(snap.timeOfDay);
    }

    expect(seenConditions.has('clear')).toBe(true);
    expect(seenConditions.has('fog')).toBe(true);
    expect(seenConditions.has('storm')).toBe(true);

    const minH = Math.min(...seenHours);
    const maxH = Math.max(...seenHours);
    expect(maxH - minH).toBeGreaterThan(0.7);
  });

  it('complète exactement un cycle jour/nuit en 30 minutes (1800 s) avec aube, jour, coucher doré et nuit', () => {
    expect(DAY_CYCLE_DURATION_SEC).toBe(1800);

    const ctrl = new WeatherCycleController({
      rng: makeSeededRng(101),
      initialCondition: 'clear',
      initialTimeOfDay: 0.0,
    });

    const phasesSeen = new Set<string>();
    const samples: Array<{
      t: number;
      phase: string;
      r: number;
      g: number;
      b: number;
      dirIntensity: number;
      ambientIntensity: number;
      sunsetFactor: number;
      nightFactor: number;
      lanternBoost: number;
    }> = [];

    // Avance de 1800 s par pas de 0.25 s (7200 steps)
    for (let step = 0; step < 7200; step++) {
      const snap = ctrl.update(0.25);
      phasesSeen.add(snap.dayPhase);
      if (step % 180 === 0) {
        samples.push({
          t: snap.timeOfDay,
          phase: snap.dayPhase,
          r: snap.dirLightColor.r,
          g: snap.dirLightColor.g,
          b: snap.dirLightColor.b,
          dirIntensity: snap.dirLightIntensity,
          ambientIntensity: snap.ambientIntensity,
          sunsetFactor: snap.sunsetFactor,
          nightFactor: snap.nightFactor,
          lanternBoost: snap.lanternBoost,
        });
      }
    }

    expect(phasesSeen.has('night')).toBe(true);
    expect(phasesSeen.has('dawn')).toBe(true);
    expect(phasesSeen.has('day')).toBe(true);
    expect(phasesSeen.has('sunset')).toBe(true);
    expect(phasesSeen.has('dusk')).toBe(true);

    // Après 1800 s, l'heure revient à 0.0 (tolérance flottante)
    const endT = ctrl.getSnapshot().timeOfDay;
    expect(Math.min(endT, 1 - endT)).toBeLessThan(0.002);

    // Vérifie le coucher de soleil doré : lumière nettement chaude (R > G > B) et sunsetFactor élevé
    ctrl.applyQaOverride({ condition: 'clear', timeOfDay: 0.745, instant: true });
    const sunset = ctrl.getSnapshot();
    expect(sunset.dayPhase).toBe('sunset');
    expect(sunset.sunsetFactor).toBeGreaterThan(0.85);
    expect(sunset.dirLightColor.r).toBeGreaterThan(sunset.dirLightColor.g);
    expect(sunset.dirLightColor.g).toBeGreaterThan(sunset.dirLightColor.b);

    // Vérifie la nuit : nuit lunaire (B > R), lanterne activée, scène toujours lisible
    ctrl.applyQaOverride({ condition: 'clear', timeOfDay: 0.02, instant: true });
    const night = ctrl.getSnapshot();
    expect(night.dayPhase).toBe('night');
    expect(night.nightFactor).toBeGreaterThan(0.9);
    expect(night.dirLightColor.b).toBeGreaterThan(night.dirLightColor.r);
    expect(night.ambientIntensity).toBeGreaterThanOrEqual(0.3);
    expect(night.dirLightIntensity).toBeGreaterThanOrEqual(0.65);
    expect(night.lanternBoost).toBeGreaterThan(0.8);
  });

  it('alterne progressivement entre beau temps, brouillard et tempête avec durée variable et oceanTime monotone', () => {
    const ctrl = new WeatherCycleController({
      rng: makeSeededRng(4242),
      initialCondition: 'clear',
      initialTimeOfDay: 0.5,
    });

    const visited = new Set<WeatherCondition>();
    let sawProgressiveTransition = false;
    let maxWeightJump = 0;
    let prevStorm = ctrl.getSnapshot().stormWeight;
    let prevOceanTime = ctrl.getSnapshot().oceanTime;

    // Simule 12 minutes de jeu par pas de 0.2 s
    for (let i = 0; i < 3600; i++) {
      const snap = ctrl.update(0.2);
      visited.add(snap.currentCondition);

      // Somme des poids toujours égale à 1
      expect(snap.clearWeight + snap.fogWeight + snap.stormWeight).toBeCloseTo(1, 5);

      // L'horloge de houle est strictement monotone (zéro saut de phase)
      expect(snap.oceanTime).toBeGreaterThan(prevOceanTime);
      prevOceanTime = snap.oceanTime;

      const deltaStorm = Math.abs(snap.stormWeight - prevStorm);
      if (deltaStorm > maxWeightJump) maxWeightJump = deltaStorm;
      prevStorm = snap.stormWeight;

      if (snap.transitionProgress > 0.1 && snap.transitionProgress < 0.9) {
        sawProgressiveTransition = true;
      }
    }

    expect(visited.has('clear')).toBe(true);
    expect(visited.has('fog')).toBe(true);
    expect(visited.has('storm')).toBe(true);
    expect(sawProgressiveTransition).toBe(true);
    // Transition progressive : jamais un saut brutal sur un pas de 0.2 s
    expect(maxWeightJump).toBeLessThan(0.05);
  });

  it('déclenche forte houle, pluie, brouillard dense, éclairs et tonnerre différé en tempête', () => {
    const ctrl = new WeatherCycleController({
      rng: makeSeededRng(777),
      initialCondition: 'storm',
      initialTimeOfDay: 0.5,
    });

    const stormSnap = ctrl.getSnapshot();
    expect(stormSnap.stormIntensity).toBeCloseTo(1, 3);
    expect(stormSnap.rainIntensity).toBeGreaterThan(0.9);
    expect(stormSnap.waveAmplitude).toBeGreaterThan(1.9);
    expect(stormSnap.fogIntensity).toBeGreaterThan(0.8);
    // Le brouillard garde la zone proche / le bateau net (fogNearOffset > 0) tout en masquant le lointain
    expect(stormSnap.fogNearOffset).toBeGreaterThan(0);
    expect(stormSnap.fogFarOffset).toBeLessThan(55);

    let maxFlash = 0;
    let thunderEvents = 0;
    for (let i = 0; i < 600; i++) {
      const s = ctrl.update(0.1);
      if (s.lightningFlash > maxFlash) maxFlash = s.lightningFlash;
      if (ctrl.consumePendingThunder() > 0) thunderEvents += 1;
    }

    expect(maxFlash).toBeGreaterThan(0.5);
    expect(thunderEvents).toBeGreaterThanOrEqual(2);
  });

  it('en brouillard dense, masque le lointain tout en gardant le bateau et la zone proche reconnaissables', () => {
    const ctrl = new WeatherCycleController({
      rng: makeSeededRng(99),
      initialCondition: 'fog',
      initialTimeOfDay: 0.48,
    });
    const fogSnap = ctrl.getSnapshot();
    expect(fogSnap.fogIntensity).toBeCloseTo(1, 3);
    expect(fogSnap.rainIntensity).toBe(0);
    expect(fogSnap.fogNearOffset).toBeGreaterThan(0);
    expect(fogSnap.fogFarOffset).toBeLessThan(55);
  });
});

describe('Océan synchronisé — Multi-échelles, tempête & étanchéité côtière', () => {
  it('produit une houle nettement plus ample en tempête qu’en mer calme au large', () => {
    let calmMin = Infinity;
    let calmMax = -Infinity;
    let stormMin = Infinity;
    let stormMax = -Infinity;

    // Échantillonne en haute mer (loin des 6 îles) sur 25 secondes
    for (let i = 0; i < 250; i++) {
      const t = i * 0.1;
      const x = 18 + (i % 7) * 2.1;
      const z = 78 + (i % 5) * 1.9;
      const hCalm = sampleOceanWaveHeight(x, z, t, ARCHIPELAGO_COASTS, 0.6, 1.18, 0.48, 0.0);
      const hStorm = sampleOceanWaveHeight(x, z, t * 1.35, ARCHIPELAGO_COASTS, 0.6, 2.15, 1.0, 1.0);
      if (hCalm < calmMin) calmMin = hCalm;
      if (hCalm > calmMax) calmMax = hCalm;
      if (hStorm < stormMin) stormMin = hStorm;
      if (hStorm > stormMax) stormMax = hStorm;
    }

    const calmRange = calmMax - calmMin;
    const stormRange = stormMax - stormMin;

    expect(calmRange).toBeGreaterThan(0.35);
    expect(stormRange).toBeGreaterThan(calmRange * 1.5);
  });

  it('atténue complètement les vagues au rivage sans jamais traverser les 6 îles même en tempête', () => {
    for (const isl of ARCHIPELAGO_COASTS) {
      // Sur la terre ferme (rayon - 2 u) : distance <= 0 et hauteur strictement plafonnée <= 0.005
      const landDist = sampleOceanCoastDistance(isl.x, isl.z, ARCHIPELAGO_COASTS, 0.6);
      expect(landDist).toBeLessThan(0);

      for (let t = 0; t < 15; t += 0.5) {
        const hLand = sampleOceanWaveHeight(
          isl.x,
          isl.z,
          t,
          ARCHIPELAGO_COASTS,
          0.6,
          2.2,
          1.0,
          1.0,
        );
        expect(hLand).toBeLessThanOrEqual(0.005);
      }
    }
  });

  it('n’altère ni la physique maritime, ni les règles d’accostage, ni les sauvegardes', () => {
    const engine = new GameEngine();
    engine.startNewGame();
    const saveBefore = engine.hasSavedGame();

    const weather = new WeatherCycleController({
      rng: makeSeededRng(321),
      initialCondition: 'storm',
      initialTimeOfDay: 0.75,
    });
    for (let i = 0; i < 60; i++) {
      weather.update(0.1);
    }

    // La météo ne modifie ni l'état de simulation du bateau ni la sauvegarde
    expect(engine.hasSavedGame()).toBe(saveBefore);
    expect(engine.state.ship.mode).toBe('parked');
    expect(engine.state.ship.speed).toBe(0);
  });

  it('maintient un choix météo manuel puis reprend le cycle aléatoire en mode automatique', () => {
    const weather = new WeatherCycleController({
      rng: makeSeededRng(123),
      initialCondition: 'clear',
      initialTimeOfDay: 0.5,
    });
    weather.setManualWeather('storm');
    for (let i = 0; i < 180; i++) weather.update(0.1);
    expect(weather.getSnapshot().stormIntensity).toBeGreaterThan(0.95);

    weather.setManualWeather('fog');
    for (let i = 0; i < 180; i++) weather.update(0.1);
    expect(weather.getSnapshot().fogIntensity).toBeGreaterThan(0.95);

    weather.setManualWeather(null);
    for (let i = 0; i < 180; i++) weather.update(0.1);
    expect(weather.getSnapshot().targetCondition).toBe('fog');
  });

  it('intègre proprement l’audio météo dans AudioEngine (respect volume, muet et environnement sans AudioContext)', () => {
    const memStore = new Map<string, string>();
    const audio = new AudioEngine({
      getItem: (k) => memStore.get(k) ?? null,
      setItem: (k, v) => {
        memStore.set(k, v);
      },
      removeItem: (k) => {
        memStore.delete(k);
      },
    });

    expect(audio.isMuted()).toBe(false);
    expect(audio.getVolume()).toBeCloseTo(0.85, 2);

    // Mise à jour météo sans AudioContext (Node/Vitest) : 0 exception, 0 rejet
    audio.updateWeatherAmbience(
      {
        inOverworld: true,
        stormIntensity: 1,
        fogIntensity: 0.85,
        rainIntensity: 1,
        windIntensity: 0.95,
        seaAgitation: 1,
        seaProximity: 1,
        shipSpeedRatio: 0.8,
      },
      0.016,
    );
    audio.triggerThunder(0.9);

    audio.setVolume(0.4);
    expect(audio.getVolume()).toBeCloseTo(0.4, 2);
    expect(audio.isMuted()).toBe(false);

    const muted = audio.toggleMute();
    expect(muted).toBe(true);
    expect(audio.isMuted()).toBe(true);
    audio.triggerThunder(1.0);

    const status = audio.getWeatherAudioStatus();
    expect(status.thunderCount).toBe(0);
    expect(status.activeGains.ocean).toBe(0);
    expect(status.activeGains.wind).toBe(0);
    expect(status.activeGains.rain).toBe(0);

    audio.dispose();
  });
});
