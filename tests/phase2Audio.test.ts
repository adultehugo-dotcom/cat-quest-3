import { describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  AudioVoicePool,
  LOCAL_SFX_FILES,
  computeSpatialPanGain,
  mapEnemyMaterialToImpactGroup,
  mapModalToUiSfxGroup,
  mapMonsterAttackGroup,
  mapMonsterTelegraphGroup,
  mapStatusToSfxGroup,
  mapTerrainToFootstepGroup,
  mapWeaponToSfxGroups,
  pickNonRepeatingVariantIndex,
  resolveFallbackLegacySfx,
} from '../src/audio/audioEngine';
import {
  AUDIO_MUSIC_TRACKS,
  AUDIO_SFX_GROUPS,
  type AudioSfxGroupId,
} from '../src/audio/audioManifest';
import { WeatherAudioController } from '../src/audio/weatherAudio';
import { VOICE_PRIORITY } from '../src/audio/audioVoicePool';
import { ENEMIES, ENEMY_LIST } from '../src/data/enemiesData';
import { WEAPON_COMBAT_PROFILES } from '../src/data/equipmentData';
import { applyDamageToPlayer, castSpell, executeMeleeAttack } from '../src/game/combat';
import { createEnemyInstance, updateEnemies, updateTelegraphs } from '../src/game/enemyAI';
import {
  FOOTSTEP_STRIDE_DIST,
  GameEngine,
  LOW_HP_ALERT_COOLDOWN_SEC,
  resolveFootstepSurface,
} from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { createInitialPlayerState } from '../src/game/progression';
import { applyQuestReward } from '../src/game/quests';
import {
  createMemoryStorage,
  loadAudioPrefs,
} from '../src/game/saveSystem';
import {
  AUDIO_PREFS_STORAGE_KEY,
  type EnemyMaterialSound,
  type GameEvent,
  type TerrainSurfaceId,
} from '../src/game/types';

describe('Phase 2 Audio — AudioVoicePool (24-32 voix & éviction prioritaire)', () => {
  it('borne la capacité entre 24 et 32 voix (défaut 28) et évince la voix la moins prioritaire', () => {
    const defaultPool = new AudioVoicePool();
    expect(defaultPool.getMaxVoices()).toBe(28);
    expect(defaultPool.getMaxVoices()).toBeGreaterThanOrEqual(24);
    expect(defaultPool.getMaxVoices()).toBeLessThanOrEqual(32);

    expect(new AudioVoicePool(10).getMaxVoices()).toBe(24);
    expect(new AudioVoicePool(64).getMaxVoices()).toBe(32);

    const pool = new AudioVoicePool(24);
    const stoppedIds: number[] = [];

    // Remplit 24 voix : voix #1 en faible priorité (FOOTSTEP), les autres en WEAPON
    for (let i = 0; i < 24; i += 1) {
      const prio = i === 0 ? VOICE_PRIORITY.FOOTSTEP : VOICE_PRIORITY.WEAPON;
      const handle = pool.acquireSlot(
        i === 0 ? 'footstep_grass' : 'weapon_swing_wood',
        prio,
        2.0,
        1000 + i,
        (voiceId) => ({
          stop: () => {
            stoppedIds.push(voiceId);
          },
        }),
      );
      expect(handle).not.toBeNull();
    }
    expect(pool.getActiveCount()).toBe(24);

    // Une 25e voix prioritaire (BOSS) évince la voix #1 (FOOTSTEP), sans dépasser 24
    const bossVoice = pool.acquireSlot(
      'boss_dragon_roar',
      VOICE_PRIORITY.BOSS,
      2.0,
      1500,
      () => ({ stop: () => {} }),
    );
    expect(bossVoice).not.toBeNull();
    expect(pool.getActiveCount()).toBe(24);
    expect(stoppedIds).toEqual([1]);

    // Une voix de priorité inférieure à toutes les actives est refusée proprement
    for (let i = 0; i < 24; i += 1) {
      pool.acquireSlot('boss_dragon_roar', VOICE_PRIORITY.BOSS, 2.0, 2000 + i, () => ({
        stop: () => {},
      }));
    }
    const dropped = pool.acquireSlot(
      'footstep_grass',
      VOICE_PRIORITY.FOOTSTEP,
      0.2,
      2100,
      () => ({ stop: () => {} }),
    );
    expect(dropped).toBeNull();
  });

  it('libère automatiquement les voix expirées selon leur durationSec calibrée', () => {
    const pool = new AudioVoicePool(24);
    pool.acquireSlot('footstep_grass', VOICE_PRIORITY.FOOTSTEP, 0.25, 1000, () => ({
      stop: () => {},
    }));
    expect(pool.getActiveCount()).toBe(1);
    expect(pool.pruneExpired(1400)).toBe(1);
    expect(pool.getActiveCount()).toBe(0);
  });
});

describe('Phase 2 Audio — playVariant anti-répétition, jitter & chaîne Or/XP', () => {
  it('ne répète jamais 2 fois de suite la même variante quand variants.length >= 2', () => {
    let last: number | undefined;
    for (let i = 0; i < 120; i += 1) {
      const next = pickNonRepeatingVariantIndex(3, last, () => (i * 0.37) % 1);
      if (last !== undefined) {
        expect(next).not.toBe(last);
      }
      last = next;
    }

    const engine = new AudioEngine(createMemoryStorage());
    let prevIdx: number | undefined;
    for (let i = 0; i < 25; i += 1) {
      const res = engine.playVariant('weapon_swing_wood', {
        bypassInterval: true,
        rng: () => 0.5,
        nowMs: 1000 + i * 100,
      });
      expect(res).not.toBeNull();
      if (prevIdx !== undefined) {
        expect(res!.variantIndex).not.toBe(prevIdx);
      }
      prevIdx = res!.variantIndex;
    }
    engine.dispose();
  });

  it('applique la micro-variation pitch ±4 % et gain ±6 % sur les groupes calibrés', () => {
    const engine = new AudioEngine(createMemoryStorage());
    const group = AUDIO_SFX_GROUPS.weapon_swing_steel;
    expect(group.pitchJitter).toBeCloseTo(0.04, 4);
    expect(group.gainJitter).toBeCloseTo(0.06, 4);

    const minParams = engine.prepareVariantParams('weapon_swing_steel', {
      rng: () => 0,
      nowMs: 1000,
    });
    expect(minParams.playbackRate).toBeCloseTo(0.96, 4);
    expect(minParams.gain).toBeCloseTo(group.defaultGain * 0.94, 4);

    const maxParams = engine.prepareVariantParams('weapon_swing_steel', {
      rng: () => 0.9999,
      nowMs: 1100,
    });
    expect(maxParams.playbackRate).toBeCloseTo(1.04, 3);
    expect(maxParams.gain).toBeCloseTo(group.defaultGain * 1.06, 3);
    engine.dispose();
  });

  it('applique un pitch ascendant en chaîne sur Or et XP et réinitialise après la fenêtre', () => {
    const engine = new AudioEngine(createMemoryStorage());

    const coin0 = engine.playVariant('loot_coin_pickup', {
      chainId: 'coin',
      bypassInterval: true,
      rng: () => 0.5,
      nowMs: 1000,
    })!;
    const coin1 = engine.playVariant('loot_coin_pickup', {
      chainId: 'coin',
      bypassInterval: true,
      rng: () => 0.5,
      nowMs: 1300,
    })!;
    const coin2 = engine.playVariant('loot_coin_pickup', {
      chainId: 'coin',
      bypassInterval: true,
      rng: () => 0.5,
      nowMs: 1600,
    })!;
    expect(coin0.chainStep).toBe(0);
    expect(coin1.chainStep).toBe(1);
    expect(coin2.chainStep).toBe(2);
    expect(coin1.playbackRate).toBeGreaterThan(coin0.playbackRate);
    expect(coin2.playbackRate).toBeGreaterThan(coin1.playbackRate);

    // Dépassement fenêtre (> 1400 ms) -> reset à 0
    const coinReset = engine.playVariant('loot_coin_pickup', {
      chainId: 'coin',
      bypassInterval: true,
      rng: () => 0.5,
      nowMs: 3600,
    })!;
    expect(coinReset.chainStep).toBe(0);

    // XP indépendant de la chaîne Or
    const xp0 = engine.playVariant('loot_xp_pickup', {
      chainId: 'xp',
      bypassInterval: true,
      rng: () => 0.5,
      nowMs: 3650,
    })!;
    const xp1 = engine.playVariant('loot_xp_pickup', {
      chainId: 'xp',
      bypassInterval: true,
      rng: () => 0.5,
      nowMs: 3900,
    })!;
    expect(xp0.chainStep).toBe(0);
    expect(xp1.chainStep).toBe(1);
    expect(xp1.playbackRate).toBeGreaterThan(xp0.playbackRate);
    engine.dispose();
  });
});

describe('Phase 2 Audio — Mixeur 4 bus & migration felingard_audio_prefs_v1', () => {
  it('persiste master, music, sfx, ambience et migre l ancien format', () => {
    const storage = createMemoryStorage();
    storage.setItem(
      AUDIO_PREFS_STORAGE_KEY,
      JSON.stringify({ muted: true, volume: 0.4 }),
    );

    const engine = new AudioEngine(storage);
    expect(engine.isMuted()).toBe(true);
    expect(engine.getVolume()).toBeCloseTo(0.4, 4);
    expect(engine.getBusVolumes()).toEqual({
      master: 0.4,
      music: 1,
      sfx: 1,
      ambience: 1,
    });

    engine.setBusVolume('music', 0.55);
    engine.setBusVolume('sfx', 0.72);
    engine.setBusVolume('ambience', 0.33);
    engine.setBusVolume('master', 0.8);

    expect(engine.isMuted()).toBe(false);
    expect(loadAudioPrefs(storage)).toEqual({
      muted: false,
      volume: 0.8,
      master: 0.8,
      music: 0.55,
      sfx: 0.72,
      ambience: 0.33,
    });

    const reloaded = new AudioEngine(storage);
    expect(reloaded.getBusVolumes()).toEqual({
      master: 0.8,
      music: 0.55,
      sfx: 0.72,
      ambience: 0.33,
    });
    engine.dispose();
    reloaded.dispose();
  });
});

describe('Phase 2 Audio — Matrice matières ennemis, 13 armes & attaques 2 temps', () => {
  it('assigne un materialSound valide aux 7 ennemis et mappe chaque matière + crit/bloqué', () => {
    expect(ENEMY_LIST).toHaveLength(7);
    const expected: Record<string, EnemyMaterialSound> = {
      slime_yarn: 'gelatinous',
      mouse_goblin: 'flesh_fur',
      thorn_wolf: 'flesh_fur',
      fishbone_skeleton: 'bone',
      frost_golem: 'stone_ice',
      boss_rat_king: 'spectral',
      boss_dragon_claw: 'dragon_scales',
    };
    for (const [id, mat] of Object.entries(expected)) {
      const def = ENEMIES[id as keyof typeof ENEMIES];
      expect(def.materialSound).toBe(mat);
      const impactGroup = mapEnemyMaterialToImpactGroup(def.materialSound);
      expect(impactGroup).toBe(`impact_${mat}`);
      expect(AUDIO_SFX_GROUPS[impactGroup]).toBeDefined();
    }

    // Vérifie l'émission combat + layers crit & shield absorb
    const player = createInitialPlayerState();
    player.x = 0;
    player.z = 0;
    player.aimAngle = 0;
    const slime = createEnemyInstance({
      id: 'slime_test',
      typeId: 'slime_yarn',
      x: 1.2,
      z: 0,
    });
    const events: GameEvent[] = [];
    executeMeleeAttack(player, [slime], events, { rng: () => 0 });
    const swingEv = events.find((e) => e.type === 'melee_swing');
    const hitEv = events.find((e) => e.type === 'hit_enemy');
    expect(swingEv?.weaponFamily).toBe('sword');
    expect(swingEv?.materialSound).toBe('wood');
    expect(hitEv?.enemyMaterial).toBe('gelatinous');

    // Égide de Ronron (bouclier absorbant) -> blocked & absorbedByShield
    castSpell(player, 'aegis_purr', [], events);
    const shieldEvents: GameEvent[] = [];
    applyDamageToPlayer(player, 10, 2, 0, shieldEvents);
    const blockedPlayerEv = shieldEvents.find((e) => e.type === 'hit_player');
    expect(blockedPlayerEv?.blocked).toBe(true);
    expect(blockedPlayerEv?.absorbedByShield).toBe(true);

    // AudioEngine.handleEvents déclenche impact_gelatinous + impact_crit + impact_blocked
    const engine = new AudioEngine(createMemoryStorage());
    const spy = vi.spyOn(engine, 'playVariant');
    engine.handleEvents([
      {
        type: 'hit_enemy',
        x: 1,
        z: 0,
        isCrit: true,
        blocked: true,
        enemyMaterial: 'dragon_scales',
      },
      {
        type: 'hit_player',
        x: 0,
        z: 0,
        blocked: true,
        absorbedByShield: true,
      },
    ]);
    const playedGroups = spy.mock.calls.map((c) => c[0]);
    expect(playedGroups).toContain('impact_dragon_scales');
    expect(playedGroups).toContain('impact_crit');
    expect(playedGroups).toContain('impact_blocked');
    engine.dispose();
  });

  it('mappe les 13 armes selon weaponFamily et materialSound vers des groupes valides', () => {
    const ids = Object.keys(WEAPON_COMBAT_PROFILES);
    expect(ids).toHaveLength(13);

    for (const id of ids) {
      const profile = WEAPON_COMBAT_PROFILES[id];
      const mapped = mapWeaponToSfxGroups(id);
      expect(AUDIO_SFX_GROUPS[mapped.primary]).toBeDefined();
      if (profile.weaponFamily === 'bow_crossbow') {
        expect(mapped.primary).toBe('weapon_bow_release');
      } else if (profile.weaponFamily === 'staff') {
        expect(mapped.primary).toBe('weapon_staff_cast');
        expect(mapped.layer).toBe(`weapon_swing_${profile.materialSound}`);
      } else if (profile.weaponFamily === 'dagger_claws') {
        expect(mapped.primary).toBe('weapon_swing_dagger');
      } else if (profile.weaponFamily === 'spear') {
        expect(mapped.primary).toBe('weapon_swing_spear');
      } else {
        expect(mapped.primary).toBe(`weapon_swing_${profile.materialSound}`);
      }
    }
  });

  it('émet les attaques monstres en 2 temps (enemy_telegraph -> telegraph_impact)', () => {
    const player = createInitialPlayerState();
    player.x = 0;
    player.z = 0;
    const goblin = createEnemyInstance({
      id: 'g1',
      typeId: 'mouse_goblin',
      x: 1.5,
      z: 0,
    });
    goblin.aggroed = true;
    goblin.state = 'chase';
    goblin.attackCooldown = 0;

    const telegraphs: Parameters<typeof updateEnemies>[2] = [];
    const events: GameEvent[] = [];
    updateEnemies([goblin], player, telegraphs, 'overworld', 0.016, events);

    const step1 = events.find((e) => e.type === 'enemy_telegraph');
    expect(step1).toBeDefined();
    expect(step1?.enemyTypeId).toBe('mouse_goblin');
    expect(step1?.enemyMaterial).toBe('flesh_fur');
    expect(mapMonsterTelegraphGroup(step1?.enemyTypeId)).toBe(
      'monster_goblin_telegraph',
    );

    const step2Events: GameEvent[] = [];
    updateTelegraphs(telegraphs, [goblin], player, 1.0, step2Events);
    const step2 = step2Events.find((e) => e.type === 'telegraph_impact');
    expect(step2).toBeDefined();
    expect(
      mapMonsterAttackGroup(step2?.enemyTypeId, step2?.shape, step2?.patternId),
    ).toBe('monster_goblin_attack');

    // Drak-Miaou : souffle (cone) vs écrasement (circle/ring)
    expect(
      mapMonsterAttackGroup('boss_dragon_claw', 'cone', 'dragon_breath'),
    ).toBe('boss_dragon_flame');
    expect(
      mapMonsterAttackGroup('boss_dragon_claw', 'circle', 'dragon_swoop_crash'),
    ).toBe('boss_dragon_slam');
  });
});

describe('Phase 2 Audio — Pas par terrain, Spatialisation, Musique, UI & PV bas', () => {
  it('résout les 6 surfaces de terrain et émet footstep à la cadence de foulée', () => {
    const surfaces: TerrainSurfaceId[] = [
      resolveFootstepSurface('overworld', 'felingard', 0, 0, true),
      resolveFootstepSurface('dungeon_ghost_cave', 'felingard', 0, 0, false),
      resolveFootstepSurface('overworld', 'felingard', 0, 22, false),
      resolveFootstepSurface('overworld', 'felingard', 10, -30, false),
      resolveFootstepSurface('overworld', 'tropical', 82, 48, false),
      resolveFootstepSurface('overworld', 'felingard', -20, 22, false),
    ];
    expect(surfaces).toEqual([
      'wood_deck',
      'dungeon_tiles',
      'rock',
      'snow_ice',
      'sand',
      'grass',
    ]);
    for (const s of surfaces) {
      expect(AUDIO_SFX_GROUPS[mapTerrainToFootstepGroup(s)]).toBeDefined();
    }

    const engine = new AudioEngine(createMemoryStorage());
    engine.dispose();

    const sim = new GameEngine({ storage: createMemoryStorage() });
    sim.startNewGame();
    sim.state.dialogue.active = false;
    sim.consumeEvents();

    const input = createEmptyInputState();
    input.moveX = 1;
    for (let i = 0; i < 12; i += 1) {
      sim.step(0.05, input);
    }
    const events = sim.consumeEvents();
    const footsteps = events.filter((e) => e.type === 'footstep');
    expect(footsteps.length).toBeGreaterThanOrEqual(1);
    expect(footsteps[0].terrain).toBe('rock'); // Miaou-bourg
    expect(FOOTSTEP_STRIDE_DIST).toBeGreaterThan(1.0);
  });

  it('calcule correctement le panoramique stéréo et l atténuation de distance', () => {
    const center = computeSpatialPanGain(0, 0, 0, 0, 16);
    expect(center.pan).toBe(0);
    expect(center.distanceAtten).toBe(1);

    const right = computeSpatialPanGain(0, 0, 10, 0, 20);
    expect(right.pan).toBeGreaterThan(0.5);
    expect(right.pan).toBeLessThanOrEqual(0.85);
    expect(right.distanceAtten).toBeGreaterThan(0);
    expect(right.distanceAtten).toBeLessThan(1);

    const left = computeSpatialPanGain(0, 0, -25, 0, 30);
    expect(left.pan).toBe(-0.85);

    const far = computeSpatialPanGain(0, 0, 25, 25, 16);
    expect(far.distanceAtten).toBe(0);
  });

  it('sélectionne boss_phase2, victory, configure maritime/victory et mappe les UI + statuts', () => {
    const sim = new GameEngine({ storage: createMemoryStorage() });
    sim.startNewGame();
    sim.loadZone('dungeon_dragon_lair', { x: 0, z: 10 }, false);
    expect(sim.getCurrentMusicTrack()).toBe('boss');

    const dragon = sim.state.enemies.find((e) => e.typeId === 'boss_dragon_claw')!;
    dragon.phase = 2;
    expect(sim.getCurrentMusicTrack()).toBe('boss_phase2');

    sim.state.screen = 'victory';
    expect(sim.getCurrentMusicTrack()).toBe('victory');

    expect(AUDIO_MUSIC_TRACKS.victory.loop).toBe(false);
    expect(AUDIO_MUSIC_TRACKS.maritime.defaultGain).toBeGreaterThan(1);

    const screens = [
      'map',
      'inventory',
      'forge',
      'inn',
      'quests',
      'bestiary',
      'pause',
    ] as const;
    for (const scr of screens) {
      const openGroup = mapModalToUiSfxGroup(scr, 'open')!;
      const closeGroup = mapModalToUiSfxGroup(scr, 'close')!;
      expect(openGroup).not.toBe(closeGroup);
      expect(AUDIO_SFX_GROUPS[openGroup]).toBeDefined();
      expect(AUDIO_SFX_GROUPS[closeGroup]).toBeDefined();
    }

    expect(mapStatusToSfxGroup('burn', 'apply')).toBe('status_burn_apply');
    expect(mapStatusToSfxGroup('poison', 'purge')).toBe('status_purge');
  });

  it('gère l alerte PV bas (< 20 %) avec cooldown non agressif et suppression en dialogue/modale', () => {
    const sim = new GameEngine({ storage: createMemoryStorage() });
    sim.startNewGame();
    sim.state.dialogue.active = false;
    sim.consumeEvents();

    const p = sim.state.player;
    p.hp = Math.floor(p.maxHp * 0.15);

    const input = createEmptyInputState();
    sim.step(0.05, input);
    const firstBatch = sim.consumeEvents();
    expect(firstBatch.filter((e) => e.type === 'low_hp_alert')).toHaveLength(1);

    // Pendant le cooldown (~6.5s) : aucune répétition agressive
    for (let i = 0; i < 40; i += 1) {
      sim.step(0.05, input);
    }
    expect(
      sim.consumeEvents().filter((e) => e.type === 'low_hp_alert'),
    ).toHaveLength(0);

    // Après écoulement du cooldown : déclenchement ponctuel suivant
    const stepsNeeded = Math.ceil((LOW_HP_ALERT_COOLDOWN_SEC + 0.5) / 0.05);
    let laterAlerts = 0;
    for (let i = 0; i < stepsNeeded; i += 1) {
      sim.step(0.05, input);
      laterAlerts += sim
        .consumeEvents()
        .filter((e) => e.type === 'low_hp_alert').length;
    }
    expect(laterAlerts).toBe(1);

    // Supprimé pendant un dialogue actif
    sim.state.dialogue.active = true;
    for (let i = 0; i < stepsNeeded; i += 1) {
      sim.step(0.05, input);
      expect(
        sim.consumeEvents().filter((e) => e.type === 'low_hp_alert'),
      ).toHaveLength(0);
    }
  });

  it('émet gold_pickup et xp_pickup sur coffre et quête et déclenche duckMusic sans erreur', () => {
    const sim = new GameEngine({ storage: createMemoryStorage() });
    sim.startNewGame();
    sim.state.dialogue.active = false;
    sim.consumeEvents();

    const firstChest = sim.state.chests.find((c) => !c.opened && !c.locked);
    expect(firstChest).toBeDefined();
    sim.openChest(firstChest!.id);
    const chestEvents = sim.consumeEvents();
    if (firstChest!.loot.gold > 0) {
      expect(chestEvents.some((e) => e.type === 'gold_pickup')).toBe(true);
    }

    const questEvents: GameEvent[] = [];
    applyQuestReward(
      sim.state.player,
      { gold: 50, xp: 40 },
      questEvents,
    );
    expect(questEvents.some((e) => e.type === 'gold_pickup' && e.value === 50)).toBe(true);
    expect(questEvents.some((e) => e.type === 'xp_pickup' && e.value === 40)).toBe(true);

    const engine = new AudioEngine(createMemoryStorage());
    const duckSpy = vi.spyOn(engine, 'duckMusic');
    engine.handleEvents([
      { type: 'chest_opened', x: 0, z: 0, value: 50 },
      { type: 'level_up', x: 0, z: 0, value: 2 },
      { type: 'boss_phase_two', x: 0, z: 0 },
      { type: 'victory' },
    ]);
    expect(duckSpy).toHaveBeenCalledTimes(4);
    engine.dispose();
  });
});

interface MockAudioStats {
  oscillatorsStarted: number;
  bufferSourcesStarted: number;
  loopingSourcesStarted: number;
  buffersCreated: number;
}

function createMockAudioContext(): {
  ctx: AudioContext;
  stats: MockAudioStats;
} {
  const stats: MockAudioStats = {
    oscillatorsStarted: 0,
    bufferSourcesStarted: 0,
    loopingSourcesStarted: 0,
    buffersCreated: 0,
  };

  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: (v: number) => {
      param.value = v;
    },
    linearRampToValueAtTime: (v: number) => {
      param.value = v;
    },
    exponentialRampToValueAtTime: (v: number) => {
      param.value = v;
    },
    setTargetAtTime: (v: number) => {
      param.value = v;
    },
    cancelScheduledValues: () => {},
  });
  let param: ReturnType<typeof makeParam>;

  const createParam = (initial = 0) => {
    const p = makeParam(initial);
    param = p;
    return p;
  };

  const ctx = {
    state: 'running' as AudioContextState,
    sampleRate: 24000,
    currentTime: 0,
    destination: {} as AudioDestinationNode,
    createGain: () => ({
      gain: createParam(1),
      connect: () => {},
      disconnect: () => {},
    }),
    createDynamicsCompressor: () => ({
      threshold: createParam(-12),
      knee: createParam(16),
      ratio: createParam(4),
      attack: createParam(0.005),
      release: createParam(0.15),
      connect: () => {},
      disconnect: () => {},
    }),
    createBiquadFilter: () => ({
      type: 'lowpass' as BiquadFilterType,
      frequency: createParam(1000),
      Q: createParam(1),
      connect: () => {},
      disconnect: () => {},
    }),
    createStereoPanner: () => ({
      pan: createParam(0),
      connect: () => {},
      disconnect: () => {},
    }),
    createOscillator: () => ({
      type: 'sine' as OscillatorType,
      frequency: createParam(440),
      detune: createParam(0),
      connect: () => {},
      disconnect: () => {},
      start: () => {
        stats.oscillatorsStarted += 1;
      },
      stop: () => {},
    }),
    createBuffer: (channels: number, length: number, sampleRate: number) => {
      stats.buffersCreated += 1;
      const channelData = Array.from(
        { length: channels },
        () => new Float32Array(length),
      );
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (ch: number) => channelData[ch],
      } as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const node = {
        buffer: null as AudioBuffer | null,
        loop: false,
        playbackRate: createParam(1),
        onended: null as (() => void) | null,
        connect: () => {},
        disconnect: () => {},
        start: () => {
          stats.bufferSourcesStarted += 1;
          if (node.loop) {
            stats.loopingSourcesStarted += 1;
          }
        },
        stop: () => {},
      };
      return node;
    },
    decodeAudioData: () => Promise.resolve(null as unknown as AudioBuffer),
    resume: () => Promise.resolve(),
    close: () => Promise.resolve(),
  } as unknown as AudioContext;

  return { ctx, stats };
}

describe('Phase 2 Audio — Remédiation itération 2 (bouclier partiel, fallback 107 groupes & météo)', () => {
  it('joue impact_blocked + combat_player_hurt sur rupture partielle d Égide et uniquement impact_blocked sur blocage total', () => {
    const engine = new AudioEngine(createMemoryStorage());
    const spy = vi.spyOn(engine, 'playVariant');

    // 1. Rupture partielle directe (absorbedByShield: true, value: 28) -> BOTH
    engine.handleEvents([
      {
        type: 'hit_player',
        x: 2,
        z: -3,
        absorbedByShield: true,
        value: 28,
      },
    ]);
    expect(spy.mock.calls.map((c) => c[0])).toEqual([
      'impact_blocked',
      'combat_player_hurt',
    ]);
    expect(spy.mock.calls[0][1]).toMatchObject({ x: 2, z: -3 });
    expect(spy.mock.calls[1][1]).toMatchObject({ x: 2, z: -3 });

    // 2. Blocage total (blocked: true, value: 0) -> ONLY impact_blocked
    spy.mockClear();
    engine.handleEvents([
      {
        type: 'hit_player',
        x: 0,
        z: 0,
        blocked: true,
        absorbedByShield: true,
        value: 0,
        spellId: 'aegis_purr',
      },
    ]);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(['impact_blocked']);

    // 3. Intégration réelle applyDamageToPlayer avec bouclier insuffisant (shieldHp = 5, atk = 40)
    spy.mockClear();
    const player = createInitialPlayerState();
    player.shieldHp = 5;
    player.shieldMaxHp = 30;
    player.shieldTimer = 5;
    const combatEvents: GameEvent[] = [];
    const res = applyDamageToPlayer(player, 40, 2, 0, combatEvents);
    expect(res.absorbedByShield).toBe(5);
    expect(res.damage).toBeGreaterThan(0);
    engine.handleEvents(combatEvents);
    const played = spy.mock.calls.map((c) => c[0]);
    expect(played).toContain('impact_blocked');
    expect(played).toContain('combat_player_hurt');

    engine.dispose();
  });

  it('couvre les 107 AudioSfxGroupId dans resolveFallbackLegacySfx et déclenche sfxSynth si aucun buffer n est chargé', () => {
    const allGroups = Object.keys(AUDIO_SFX_GROUPS) as AudioSfxGroupId[];
    expect(allGroups).toHaveLength(107);

    for (const groupId of allGroups) {
      const legacySfx = resolveFallbackLegacySfx(groupId);
      expect(LOCAL_SFX_FILES[legacySfx]).toBeDefined();
    }

    const { ctx, stats } = createMockAudioContext();
    const FakeAudioCtor = function FakeAudioCtor() {
      return ctx;
    } as unknown as new () => AudioContext;
    vi.stubGlobal('AudioContext', FakeAudioCtor);
    vi.stubGlobal('window', {
      AudioContext: FakeAudioCtor,
      addEventListener: () => {},
      removeEventListener: () => {},
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    );

    const engine = new AudioEngine(createMemoryStorage());
    try {
      engine.unlock();
      expect(engine.isUnlocked()).toBe(true);

      const nonLegacyGroups: AudioSfxGroupId[] = [
        'ui_inventory_open',
        'impact_gelatinous',
        'footstep_sand',
        'status_burn_apply',
        'monster_slime_telegraph',
        'loot_xp_pickup',
        'ambient_seagulls',
      ];
      for (let i = 0; i < nonLegacyGroups.length; i += 1) {
        const beforeOsc = stats.oscillatorsStarted;
        const beforeBuf = stats.bufferSourcesStarted;
        const res = engine.playVariant(nonLegacyGroups[i], {
          bypassInterval: true,
          nowMs: 2000 + i * 50,
        });
        expect(res).not.toBeNull();
        expect(
          stats.oscillatorsStarted + stats.bufferSourcesStarted,
        ).toBeGreaterThan(beforeOsc + beforeBuf);
      }
    } finally {
      engine.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('active le repli procédural de WeatherAudioController quand fetch échoue sous AudioContext mocké', async () => {
    const { ctx, stats } = createMockAudioContext();
    const weatherBus = ctx.createGain();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    );

    const controller = new WeatherAudioController(ctx, weatherBus);
    try {
      controller.startLoading();
      await vi.waitFor(() => {
        expect(controller.getStatus().fallbackTracks).toEqual([
          'ocean',
          'wind',
          'rain',
          'birds',
          'thunder',
        ]);
      });

      expect(stats.loopingSourcesStarted).toBe(4);
      expect(stats.buffersCreated).toBeGreaterThanOrEqual(4);

      controller.update(
        {
          inOverworld: true,
          stormIntensity: 0.75,
          fogIntensity: 0.1,
          rainIntensity: 0.85,
          windIntensity: 0.7,
          seaAgitation: 0.8,
          seaProximity: 1.0,
          shipSpeedRatio: 0.5,
          nightFactor: 0,
          isSailing: false,
          inCombat: false,
        },
        0.5,
      );
      controller.triggerThunder(0.9);

      const status = controller.getStatus();
      expect(status.activeGains.ocean).toBeGreaterThan(0);
      expect(status.activeGains.rain).toBeGreaterThan(0);
      expect(status.activeGains.wind).toBeGreaterThan(0);
      expect(status.thunderCount).toBe(1);
    } finally {
      controller.dispose();
      vi.unstubAllGlobals();
    }
  });
});
