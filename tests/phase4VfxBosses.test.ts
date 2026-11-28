import { describe, expect, it } from 'vitest';
import {
  VFX_ASSETS,
  computeVfxFlipbookFrameUv,
  getVfxFrameIndexAtTime,
  type VfxAssetId,
} from '../src/art/vfxManifest';

interface MinimalNodeFs {
  readFileSync(filePath: string, encoding: 'utf8'): string;
  readdirSync(dirPath: string): string[];
}

interface MinimalNodePath {
  join(...segments: string[]): string;
}

async function loadNodeHelpers(): Promise<{
  fs: MinimalNodeFs;
  path: MinimalNodePath;
  rootDir: string;
}> {
  const fsMod = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as MinimalNodeFs;
  const pathMod = (await import(/* @vite-ignore */ 'node:' + 'path')) as unknown as MinimalNodePath;
  const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
  return { fs: fsMod, path: pathMod, rootDir: proc ? proc.cwd() : '.' };
}
import { AUDIO_SFX_GROUPS } from '../src/audio/audioManifest';
import { ENEMIES } from '../src/data/enemiesData';
import {
  checkBossPhaseTransition,
  createEnemyInstance,
  spawnTelegraphsForPattern,
  updateEnemies,
  updateEnemyProjectiles,
  updateHazardZones,
  updateTelegraphs,
} from '../src/game/enemyAI';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { createInitialPlayerState } from '../src/game/progression';
import { createMemoryStorage } from '../src/game/saveSystem';
import { hasStatus } from '../src/game/statusEffects';
import type {
  EnemyProjectile,
  GameEvent,
  HazardZone,
  TelegraphElement,
  TelegraphZone,
} from '../src/game/types';
import { resolveTelegraphPalette } from '../src/render/shaders/telegraphShader';

const zeroRng = () => 0.0;

function makeTestPlayer(x = 0, z = 0) {
  const p = createInitialPlayerState();
  p.x = x;
  p.z = z;
  p.invulnTimer = 0;
  p.hp = 500;
  p.maxHp = 500;
  return p;
}

describe('Phase 4 — Double-Layer Telegraphs, Reworked Enemy/Boss Skills & Cinematics', () => {
  it('resolveTelegraphPalette maps all 5 elements to distinct double-layer colors', () => {
    const expected: Record<TelegraphElement, { color: string; brightColor: string }> = {
      physical: { color: '#ff3b30', brightColor: '#ff8f70' },
      frost: { color: '#2998e6', brightColor: '#9ae6ff' },
      fire: { color: '#ff5e14', brightColor: '#ffd166' },
      poison: { color: '#38c754', brightColor: '#b9ff8a' },
      spectral: { color: '#9333ea', brightColor: '#e9b8ff' },
    };
    for (const [el, pal] of Object.entries(expected)) {
      expect(resolveTelegraphPalette(el as TelegraphElement)).toEqual(pal);
    }

    // Verify ENEMIES patterns expose element metadata cleanly
    expect(ENEMIES.frost_golem.patterns.find((p) => p.id === 'frost_ring')?.element).toBe('frost');
    expect(ENEMIES.boss_dragon_claw.patterns.find((p) => p.id === 'dragon_breath')?.element).toBe('fire');
    expect(ENEMIES.mouse_goblin.patterns.find((p) => p.id === 'goblin_poison_throw')?.element).toBe('poison');
    expect(ENEMIES.boss_rat_king.patterns.find((p) => p.id === 'rat_homing_orbs')?.element).toBe('spectral');
  });

  it('Slime-Pelote spawns slow/damage slime_puddle HazardZone on impact', () => {
    const def = ENEMIES.slime_yarn;
    const slime = createEnemyInstance({ id: 'slime_1', typeId: 'slime_yarn', x: 0, z: 0 });
    const player = makeTestPlayer(0.5, 0);
    const pattern = def.patterns.find((p) => p.id === 'yarn_bounce')!;
    const telegraphs: TelegraphZone[] = [];
    const hazards: HazardZone[] = [];
    const events: GameEvent[] = [];

    spawnTelegraphsForPattern(slime, def, pattern, player, telegraphs, { rng: zeroRng });
    expect(telegraphs).toHaveLength(1);

    updateTelegraphs(telegraphs, [slime], player, telegraphs[0].duration + 0.01, events, {
      rng: zeroRng,
      hazardZones: hazards,
    });
    expect(hazards).toHaveLength(1);
    expect(hazards[0].kind).toBe('slime_puddle');
    expect(hazards[0].slowFactor).toBeGreaterThan(0);

    player.invulnTimer = 0;
    const hpBefore = player.hp;
    const hRes = updateHazardZones(hazards, player, 0.7, events, { rng: zeroRng });
    expect(hRes.slowFactor).toBeGreaterThan(0);
    expect(hRes.playerHit).toBe(true);
    expect(player.hp).toBeLessThan(hpBefore);
  });

  it('Gobelin-Souris throws poison dagger EnemyProjectile applying poison on hit', () => {
    const def = ENEMIES.mouse_goblin;
    const goblin = createEnemyInstance({ id: 'gob_1', typeId: 'mouse_goblin', x: 0, z: 0 });
    const player = makeTestPlayer(5, 0);
    const pattern = def.patterns.find((p) => p.id === 'goblin_poison_throw')!;
    const telegraphs: TelegraphZone[] = [];
    const projectiles: EnemyProjectile[] = [];
    const events: GameEvent[] = [];

    spawnTelegraphsForPattern(goblin, def, pattern, player, telegraphs, { rng: zeroRng });
    updateTelegraphs(telegraphs, [goblin], player, telegraphs[0].duration + 0.01, events, {
      rng: zeroRng,
      enemyProjectiles: projectiles,
    });

    expect(projectiles).toHaveLength(1);
    expect(projectiles[0].kind).toBe('dagger');
    expect(projectiles[0].statusProc?.statusId).toBe('poison');
    expect(events.some((e) => e.type === 'enemy_projectile_spawned')).toBe(true);

    // Step projectile until it hits player at x=5
    player.invulnTimer = 0;
    for (let i = 0; i < 30; i++) {
      const res = updateEnemyProjectiles(projectiles, [goblin], player, 0.03, events, {
        rng: zeroRng,
      });
      if (res.playerHit) break;
    }
    expect(hasStatus(player, 'poison')).toBe(true);
  });

  it('Loup-Épine spawns thorn_patch HazardZone with bleed proc', () => {
    const def = ENEMIES.thorn_wolf;
    const wolf = createEnemyInstance({ id: 'wolf_1', typeId: 'thorn_wolf', x: 0, z: 0 });
    const player = makeTestPlayer(2.5, 0);
    const pattern = def.patterns.find((p) => p.id === 'wolf_thorn_burst')!;
    const telegraphs: TelegraphZone[] = [];
    const hazards: HazardZone[] = [];
    const events: GameEvent[] = [];

    spawnTelegraphsForPattern(wolf, def, pattern, player, telegraphs, { rng: zeroRng });
    updateTelegraphs(telegraphs, [wolf], player, telegraphs[0].duration + 0.01, events, {
      rng: zeroRng,
      hazardZones: hazards,
    });

    expect(hazards).toHaveLength(1);
    expect(hazards[0].kind).toBe('thorn_patch');
    expect(hazards[0].statusProc?.statusId).toBe('bleed');

    player.x = hazards[0].x;
    player.z = hazards[0].z;
    player.invulnTimer = 0;
    updateHazardZones(hazards, player, 0.6, events, { rng: zeroRng });
    expect(hasStatus(player, 'bleed')).toBe(true);
  });

  it('Squelette-Arête bone_throw launches a boomerang fishbone that reverses at maxRange and returns', () => {
    const def = ENEMIES.fishbone_skeleton;
    const skel = createEnemyInstance({ id: 'skel_1', typeId: 'fishbone_skeleton', x: 0, z: 0 });
    const player = makeTestPlayer(8, 0);
    const pattern = def.patterns.find((p) => p.id === 'bone_throw')!;
    const telegraphs: TelegraphZone[] = [];
    const projectiles: EnemyProjectile[] = [];
    const events: GameEvent[] = [];

    spawnTelegraphsForPattern(skel, def, pattern, player, telegraphs, { rng: zeroRng });
    updateTelegraphs(telegraphs, [skel], player, telegraphs[0].duration + 0.01, events, {
      rng: zeroRng,
      enemyProjectiles: projectiles,
    });

    expect(projectiles).toHaveLength(1);
    const bone = projectiles[0];
    expect(bone.kind).toBe('fishbone');
    expect(bone.isBoomerang).toBe(true);
    expect(bone.returning).toBe(false);

    // Move player aside so outbound completes full maxRange and reverses
    player.z = 12;
    let sawReturning = false;
    for (let i = 0; i < 80; i++) {
      updateEnemyProjectiles(projectiles, [skel], player, 0.04, events, { rng: zeroRng });
      if (projectiles[0]?.returning) {
        sawReturning = true;
      }
      if (projectiles.length === 0) break;
    }
    expect(sawReturning).toBe(true);
    expect(projectiles).toHaveLength(0); // Caught back by skeleton
  });

  it('Golem de Givre golem_ice_spikes spawns 3 sequential delayed telegraphs resolving into frost_patch hazards', () => {
    const def = ENEMIES.frost_golem;
    const golem = createEnemyInstance({ id: 'golem_1', typeId: 'frost_golem', x: 0, z: 0 });
    const player = makeTestPlayer(7, 0);
    const pattern = def.patterns.find((p) => p.id === 'golem_ice_spikes')!;
    const telegraphs: TelegraphZone[] = [];
    const hazards: HazardZone[] = [];
    const events: GameEvent[] = [];

    spawnTelegraphsForPattern(golem, def, pattern, player, telegraphs, { rng: zeroRng });
    expect(telegraphs).toHaveLength(3);
    expect(telegraphs.map((t) => t.delaySec)).toEqual([0, 0.24, 0.48]);

    // Step 1.0s in 0.05s ticks -> spike 1 resolves (delay 0, dur 0.95)
    for (let i = 0; i < 20; i++) {
      updateTelegraphs(telegraphs, [golem], player, 0.05, events, {
        rng: zeroRng,
        hazardZones: hazards,
      });
    }
    expect(hazards.length).toBe(1);
    expect(hazards[0].kind).toBe('frost_patch');

    // Step another 0.3s -> spike 2 resolves (delay 0.24 + dur 0.95 = 1.19s)
    for (let i = 0; i < 6; i++) {
      updateTelegraphs(telegraphs, [golem], player, 0.05, events, {
        rng: zeroRng,
        hazardZones: hazards,
      });
    }
    expect(hazards.length).toBe(2);

    // Step another 0.3s -> spike 3 resolves (delay 0.48 + dur 0.95 = 1.43s)
    for (let i = 0; i < 6; i++) {
      updateTelegraphs(telegraphs, [golem], player, 0.05, events, {
        rng: zeroRng,
        hazardZones: hazards,
      });
    }
    expect(hazards.length).toBe(3);
    expect(telegraphs).toHaveLength(0);
  });

  it('Roi Rat-Spectre spawns cheese wheels, toxic miasma, homing orbs, spectral scythes, fissures & 100% curse ring', () => {
    const def = ENEMIES.boss_rat_king;
    const rat = createEnemyInstance({ id: 'rat_1', typeId: 'boss_rat_king', x: 0, z: 0 });
    const player = makeTestPlayer(6, 0);

    // 1. Cheese wheels
    const tgCheese: TelegraphZone[] = [];
    const projCheese: EnemyProjectile[] = [];
    spawnTelegraphsForPattern(rat, def, def.patterns.find((p) => p.id === 'rat_cheese_roll')!, player, tgCheese, { rng: zeroRng });
    updateTelegraphs(tgCheese, [rat], player, 2.0, [], { rng: zeroRng, enemyProjectiles: projCheese });
    expect(projCheese.length).toBe(2);
    expect(projCheese[0].kind).toBe('cheese_wheel');
    expect(projCheese[0].piercing).toBe(true);

    // 2. Toxic debris -> persistent toxic_miasma hazards
    const tgTox: TelegraphZone[] = [];
    const hazTox: HazardZone[] = [];
    spawnTelegraphsForPattern(rat, def, def.patterns.find((p) => p.id === 'rat_toxic_debris')!, player, tgTox, { rng: zeroRng });
    expect(tgTox).toHaveLength(3);
    updateTelegraphs(tgTox, [rat], player, 2.0, [], { rng: zeroRng, hazardZones: hazTox });
    expect(hazTox).toHaveLength(3);
    expect(hazTox[0].kind).toBe('toxic_miasma');

    // 3. Homing orbs steer toward off-axis player
    const tgOrb: TelegraphZone[] = [];
    const projOrb: EnemyProjectile[] = [];
    spawnTelegraphsForPattern(rat, def, def.patterns.find((p) => p.id === 'rat_homing_orbs')!, player, tgOrb, { rng: zeroRng });
    updateTelegraphs(tgOrb, [rat], player, 2.0, [], { rng: zeroRng, enemyProjectiles: projOrb });
    expect(projOrb.length).toBe(2);
    expect(projOrb[0].kind).toBe('spectral_orb');
    expect(projOrb[0].homingTurnRate).toBeGreaterThan(0);
    player.x = 6;
    player.z = 8;
    const vzBefore = projOrb[0].vz;
    updateEnemyProjectiles(projOrb, [rat], player, 0.2, [], { rng: zeroRng });
    expect(projOrb[0].vz).toBeGreaterThan(vzBefore);

    // 4. Spectral scythe
    const tgScythe: TelegraphZone[] = [];
    const projScythe: EnemyProjectile[] = [];
    spawnTelegraphsForPattern(rat, def, def.patterns.find((p) => p.id === 'rat_spectral_scythe')!, player, tgScythe, { rng: zeroRng });
    updateTelegraphs(tgScythe, [rat], player, 2.0, [], { rng: zeroRng, enemyProjectiles: projScythe });
    expect(projScythe[0].kind).toBe('spectral_scythe');
    expect(projScythe[0].piercing).toBe(true);

    // 5. Abyssal fissure
    const tgFis: TelegraphZone[] = [];
    const hazFis: HazardZone[] = [];
    spawnTelegraphsForPattern(rat, def, def.patterns.find((p) => p.id === 'rat_abyssal_fissure')!, player, tgFis, { rng: zeroRng });
    updateTelegraphs(tgFis, [rat], player, 2.0, [], { rng: zeroRng, hazardZones: hazFis });
    expect(hazFis[0].kind).toBe('abyssal_fissure');
    expect(hazFis[0].length).toBeGreaterThan(0);

    // 6. Preserved 100% curse miasma ring
    expect(def.patterns.find((p) => p.id === 'rat_miasma_ring')?.statusProc).toEqual({
      statusId: 'curse',
      chance: 1.0,
      durationSec: 5.0,
      potency: 1,
    });
  });

  it('Drak-Miaou Phase 1 & Phase 2 (<50% HP): sweeping flame jet, 3->5 meteors + craters, seismic ring & inferno cross', () => {
    const def = ENEMIES.boss_dragon_claw;
    const dragon = createEnemyInstance({ id: 'drag_1', typeId: 'boss_dragon_claw', x: 0, z: 0 });
    const player = makeTestPlayer(6, 0);

    // Phase 1 sweeping flame jet
    const tgBreath: TelegraphZone[] = [];
    spawnTelegraphsForPattern(dragon, def, def.patterns.find((p) => p.id === 'dragon_breath')!, player, tgBreath, { rng: zeroRng });
    updateTelegraphs(tgBreath, [dragon], player, 2.0, [], { rng: zeroRng });
    expect(dragon.activeSweepDuration).toBeGreaterThan(0);

    // Phase 1 meteor rain -> 3 telegraphs & 3 scorch_crater hazards
    const tgMet1: TelegraphZone[] = [];
    const hazMet1: HazardZone[] = [];
    spawnTelegraphsForPattern(dragon, def, def.patterns.find((p) => p.id === 'dragon_meteors')!, player, tgMet1, { rng: zeroRng });
    expect(tgMet1).toHaveLength(3);
    updateTelegraphs(tgMet1, [dragon], player, 2.0, [], { rng: zeroRng, hazardZones: hazMet1 });
    expect(hazMet1).toHaveLength(3);
    expect(hazMet1[0].kind).toBe('scorch_crater');

    // Phase 2 transition at <= 50% HP
    dragon.hp = Math.floor(dragon.maxHp * 0.45);
    const p2Events: GameEvent[] = [];
    expect(checkBossPhaseTransition(dragon, p2Events)).toBe(true);
    expect(dragon.phase).toBe(2);
    expect(p2Events.some((e) => e.type === 'boss_phase_two')).toBe(true);

    // Phase 2 meteor rain -> 5 telegraphs
    const tgMet2: TelegraphZone[] = [];
    spawnTelegraphsForPattern(dragon, def, def.patterns.find((p) => p.id === 'dragon_meteors')!, player, tgMet2, { rng: zeroRng });
    expect(tgMet2).toHaveLength(5);

    // Phase 2 thermal shockwave (burn 100%)
    const ringPat = def.patterns.find((p) => p.id === 'dragon_seismic_ring')!;
    expect(ringPat.statusProc?.statusId).toBe('burn');
    expect(ringPat.statusProc?.chance).toBe(1.0);

    // Phase 2 inferno cross -> 4 orthogonal line telegraphs -> 4 scorch craters
    const tgCross: TelegraphZone[] = [];
    const hazCross: HazardZone[] = [];
    spawnTelegraphsForPattern(dragon, def, def.patterns.find((p) => p.id === 'dragon_inferno_cross')!, player, tgCross, { rng: zeroRng });
    expect(tgCross).toHaveLength(4);
    updateTelegraphs(tgCross, [dragon], player, 2.0, [], { rng: zeroRng, hazardZones: hazCross });
    expect(hazCross).toHaveLength(4);
    expect(hazCross[0].kind).toBe('scorch_crater');
  });

  it('Regular enemy death triggers hitstop, knockback projection & enriched enemy_died payload', () => {
    const engine = new GameEngine({ storage: createMemoryStorage(), rng: () => 0.5 });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    const slime = engine.state.enemies.find((e) => e.typeId === 'slime_yarn')!;
    expect(slime).toBeDefined();
    slime.hp = 1;
    engine.state.player.x = slime.x - 1.2;
    engine.state.player.z = slime.z;
    engine.state.player.aimAngle = 0;

    const atk = createEmptyInputState();
    atk.attackPressed = true;
    engine.step(0.016, atk);

    expect(slime.state).toBe('dead');
    expect(slime.deathTimer ?? 0).toBeGreaterThan(0);
    expect(engine.state.hitstopTimer).toBeGreaterThan(0);

    const events = engine.consumeEvents();
    const diedEv = events.find((e) => e.type === 'enemy_died' && e.enemyId === slime.id);
    expect(diedEv).toBeDefined();
    expect(diedEv?.enemyMaterial).toBe('gelatinous');
    expect(diedEv?.color).toBe(ENEMIES.slime_yarn.primaryColor);
    expect(diedEv?.accentColor).toBe(ENEMIES.slime_yarn.accentColor);

    const xBefore = slime.x;
    slime.knockbackVx = 10;
    updateEnemies([slime], engine.state.player, [], 'overworld', 0.1, []);
    expect(slime.x).toBeGreaterThan(xBefore);
    expect(slime.deathTimer!).toBeLessThan(0.35);
  });

  it('Boss intro & death cinematics lock controls, grant invulnerability, play victory music for Drak-Miaou, clear deathTimer & enforce maxDuration watchdog', () => {
    const engine = new GameEngine({ storage: createMemoryStorage(), rng: () => 0.5 });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    // 1. Roi Rat-Spectre intro + death cinematic
    engine.loadZone('dungeon_ghost_cave', { x: 0, z: -9.0 });
    const idle = createEmptyInputState();
    engine.step(0.016, idle);

    expect(engine.state.cinematic?.kind).toBe('boss_intro');
    expect(engine.state.cinematic?.bossTypeId).toBe('boss_rat_king');
    expect(engine.state.player.invulnTimer).toBeGreaterThan(0);

    // Controls are locked during cinematic
    const moveInput = createEmptyInputState();
    moveInput.moveX = 1;
    const xStart = engine.state.player.x;
    engine.step(0.05, moveInput);
    expect(engine.state.player.x).toBe(xStart);

    // Step until intro completes
    for (let i = 0; i < 80 && engine.state.cinematic !== null; i++) {
      engine.step(0.05, idle);
    }
    expect(engine.state.cinematic).toBeNull();

    // Kill Rat King -> slow-mo death cinematic -> clears deathTimer on completion
    const ratKing = engine.state.enemies.find((e) => e.typeId === 'boss_rat_king')!;
    ratKing.hp = 1;
    engine.state.player.x = ratKing.x - 1.2;
    engine.state.player.z = ratKing.z;
    engine.state.player.aimAngle = 0;
    const atk = createEmptyInputState();
    atk.attackPressed = true;
    engine.step(0.016, atk);

    expect(engine.state.cinematic?.kind).toBe('boss_death');
    expect(engine.state.timeScale).toBeLessThan(1);
    for (let i = 0; i < 80 && engine.state.cinematic !== null; i++) {
      engine.step(0.05, idle);
    }
    expect(engine.state.cinematic).toBeNull();
    expect(engine.state.timeScale).toBe(1);
    expect(ratKing.deathTimer).toBe(0);
    expect(ratKing.deathDuration).toBe(0);

    // 2. Drak-Miaou intro + death cinematic -> 'victory' music + lairBrighten + VICTORY_DIALOGUE
    engine.loadZone('dungeon_dragon_lair', { x: 0, z: 5.5 });
    engine.step(0.016, idle);
    expect(engine.state.cinematic?.kind).toBe('boss_intro');
    expect(engine.state.cinematic?.bossTypeId).toBe('boss_dragon_claw');
    for (let i = 0; i < 80 && engine.state.cinematic !== null; i++) {
      engine.step(0.05, idle);
    }
    expect(engine.state.cinematic).toBeNull();

    const dragon = engine.state.enemies.find((e) => e.typeId === 'boss_dragon_claw')!;
    dragon.hp = 1;
    engine.state.player.x = dragon.x - 1.5;
    engine.state.player.z = dragon.z;
    engine.state.player.aimAngle = 0;
    engine.state.player.attackCooldown = 0;
    engine.step(0.016, atk);

    expect(engine.state.cinematic?.kind).toBe('boss_death');
    expect(engine.state.cinematic?.bossTypeId).toBe('boss_dragon_claw');
    expect(engine.getCurrentMusicTrack()).toBe('victory');
    expect(engine.state.player.invulnTimer).toBeGreaterThan(0);

    // Verify anti-softlock watchdog even with artificially huge duration & slow timeScale
    engine.state.cinematic!.duration = 999;
    engine.state.cinematic!.maxDuration = 2.0;
    engine.state.timeScale = 0.1;
    for (let i = 0; i < 50 && engine.state.cinematic !== null; i++) {
      engine.step(0.05, idle);
    }
    expect(engine.state.cinematic).toBeNull();
    expect(engine.state.timeScale).toBe(1);
    expect(dragon.deathTimer).toBe(0);
    expect(dragon.deathDuration).toBe(0);
    expect(engine.state.dialogue.active).toBe(true);
    while (engine.state.dialogue.active) engine.advanceDialogue();
    expect(engine.state.screen).toBe('victory');
  });

  it('All 20 CC0 VFX assets are used in renderers, AUDIO_SFX_GROUPS stays 107, and src/game has 0 three/DOM leaks', async () => {
    const { fs, path, rootDir } = await loadNodeHelpers();
    const effectsSrc = fs.readFileSync(path.join(rootDir, 'src/render/effectsRenderer.ts'), 'utf8');
    const sceneSrc = fs.readFileSync(path.join(rootDir, 'src/render/sceneManager.ts'), 'utf8');
    const mainSrc = fs.readFileSync(path.join(rootDir, 'src/main.ts'), 'utf8');
    const combinedRenderSrc = `${effectsSrc}\n${sceneSrc}\n${mainSrc}`;

    const allVfxIds = Object.keys(VFX_ASSETS) as VfxAssetId[];
    expect(allVfxIds).toHaveLength(20);
    for (const id of allVfxIds) {
      expect(combinedRenderSrc).toContain(`'${id}'`);
    }

    expect(Object.keys(AUDIO_SFX_GROUPS)).toHaveLength(107);

    const gameFiles = fs.readdirSync(path.join(rootDir, 'src/game')).filter((f) => f.endsWith('.ts'));
    for (const file of gameFiles) {
      const content = fs.readFileSync(path.join(rootDir, 'src/game', file), 'utf8');
      expect(content).not.toMatch(/from\s+['"]three['"]/);
      expect(content).not.toMatch(/\bdocument\./);
    }
  });

  it('Squelette-Arête boomerang hits at most once inbound (even running alongside) and at most once outbound + once inbound over a full round-trip', () => {
    // 1. Exact inbound running-alongside reproduction in GameEngine.step()
    const engine = new GameEngine({ storage: createMemoryStorage(), rng: () => 0.5 });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    const skel = createEnemyInstance({ id: 'skel_boom', typeId: 'fishbone_skeleton', x: 35, z: 20 });
    skel.aggroed = false;
    skel.attackCooldown = 99;
    engine.state.enemies = [skel];
    engine.state.telegraphs = [];
    engine.state.hazardZones = [];
    engine.state.player.x = 20.0;
    engine.state.player.z = 20;
    engine.state.player.invulnTimer = 0;
    engine.state.player.hp = 500;
    engine.state.player.maxHp = 500;
    engine.state.enemyProjectiles = [
      {
        id: 'eproj_inbound_test',
        ownerId: skel.id,
        ownerTypeId: 'fishbone_skeleton',
        patternId: 'bone_throw',
        kind: 'fishbone',
        x: 18.73,
        z: 20,
        startX: 35,
        startZ: 20,
        vx: 13.5,
        vz: 0,
        speed: 12.5,
        returnSpeed: 13.5,
        radius: 0.55,
        distanceTraveled: 0,
        maxRange: 10.2,
        age: 0.8,
        maxAge: 3.8,
        damage: 18,
        element: 'spectral',
        color: '#e8e4d5',
        accentColor: '#a855f7',
        isBoomerang: true,
        returning: true,
        hitPlayerOnOutbound: false,
        hitPlayerOnInbound: false,
        piercing: true,
      },
    ];
    engine.consumeEvents();

    const runRight = createEmptyInputState();
    runRight.moveX = 1;
    let inboundEngineHits = 0;
    for (let i = 0; i < 30; i++) {
      engine.step(0.05, runRight);
      const evs = engine.consumeEvents();
      inboundEngineHits += evs.filter((e) => e.type === 'hit_player').length;
    }
    expect(inboundEngineHits).toBe(1);
    expect(engine.state.enemyProjectiles.every((p) => p.hitPlayerOnInbound === true)).toBe(true);

    // 2. Full round-trip: 1 outbound hit + 1 inbound hit = 2 total max hits
    const def = ENEMIES.fishbone_skeleton;
    const skelRt = createEnemyInstance({ id: 'skel_rt', typeId: 'fishbone_skeleton', x: 0, z: 0 });
    const player = makeTestPlayer(4, 0);
    const pattern = def.patterns.find((p) => p.id === 'bone_throw')!;
    const telegraphs: TelegraphZone[] = [];
    const projectiles: EnemyProjectile[] = [];
    const events: GameEvent[] = [];

    spawnTelegraphsForPattern(skelRt, def, pattern, player, telegraphs, { rng: zeroRng });
    updateTelegraphs(telegraphs, [skelRt], player, telegraphs[0].duration + 0.01, events, {
      rng: zeroRng,
      enemyProjectiles: projectiles,
    });
    expect(projectiles).toHaveLength(1);
    expect(projectiles[0].hitPlayerOnOutbound).toBe(false);
    expect(projectiles[0].hitPlayerOnInbound).toBe(false);
    expect(projectiles[0].returnSpeed).toBe(13.5);

    let outboundHits = 0;
    let inboundHits = 0;
    for (let i = 0; i < 80 && projectiles.length > 0; i++) {
      player.invulnTimer = 0; // Stress-test every tick without iframe shielding
      const wasReturning = Boolean(projectiles[0]?.returning);
      const evCountBefore = events.length;
      updateEnemyProjectiles(projectiles, [skelRt], player, 0.03, events, { rng: zeroRng });
      const newHits = events.slice(evCountBefore).filter((e) => e.type === 'hit_player').length;
      const isReturningNow = Boolean(projectiles[0]?.returning);
      if (wasReturning || isReturningNow) {
        inboundHits += newHits;
      } else {
        outboundHits += newHits;
      }
    }
    expect(outboundHits).toBe(1);
    expect(inboundHits).toBe(1);
    expect(projectiles).toHaveLength(0);
  });

  it('VFX manifest helpers return finite [0, 1) UVs and finite frame indices on NaN / Infinity inputs', () => {
    const entries = Object.values(VFX_ASSETS);
    expect(entries).toHaveLength(20);

    const nonFiniteInputs = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    for (const entry of entries) {
      for (const bad of nonFiniteInputs) {
        const uv = computeVfxFlipbookFrameUv(entry, bad);
        expect(Number.isFinite(uv.repeatX)).toBe(true);
        expect(Number.isFinite(uv.repeatY)).toBe(true);
        expect(Number.isFinite(uv.offsetX)).toBe(true);
        expect(Number.isFinite(uv.offsetY)).toBe(true);
        expect(uv.offsetX).toBeGreaterThanOrEqual(0);
        expect(uv.offsetX).toBeLessThan(1);
        expect(uv.offsetY).toBeGreaterThanOrEqual(0);
        expect(uv.offsetY).toBeLessThan(1);

        expect(getVfxFrameIndexAtTime(entry, bad, false)).toBe(0);
        expect(getVfxFrameIndexAtTime(entry, bad, true)).toBe(0);
      }
    }
  });
});
