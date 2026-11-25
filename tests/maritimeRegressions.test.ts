import { describe, expect, it } from 'vitest';
import { isInsideIsland } from '../src/data/worldData';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { createMemoryStorage } from '../src/game/saveSystem';
import {
  SHIP_PHYSICS_CONFIG,
  stepShipPhysics,
  type ShipPhysicsState,
} from '../src/game/shipPhysics';
import {
  findSafeDisembarkSpot,
  getDefaultAnchorageForIsland,
  getDefaultBoatSpawnOnFelingard,
  getIslandWaterlineRadius,
  isHullEntirelyOnWater,
  resolveShipCoastCollision,
} from '../src/game/shorelineNavigation';
import type { ShipMode } from '../src/game/types';

function shipMode(engine: GameEngine): ShipMode {
  return engine.state.ship.mode;
}

function createReadyEngine(storage = createMemoryStorage()): GameEngine {
  const engine = new GameEngine({ storage, rng: () => 0.5 });
  engine.startNewGame();
  while (engine.state.dialogue.active) engine.advanceDialogue();
  return engine;
}

describe('Régressions Gameplay & Intégration Maritime (Section 16.F)', () => {
  it('préserve exactement le mouillage personnalisé du bateau sur Félingard après un aller-retour en Donjon', () => {
    const engine = createReadyEngine();

    // Place le bateau sur la côte Est de Félingard (distinct du mouillage Sud par défaut)
    const eastAngle = 0.22;
    const wlR = getIslandWaterlineRadius('felingard', eastAngle);
    const customPos = {
      x: Math.cos(eastAngle) * (wlR + 2.8),
      z: Math.sin(eastAngle) * (wlR + 2.8),
    };
    const customAngle = 0.15;
    expect(isHullEntirelyOnWater(customPos.x, customPos.z, customAngle)).toBe(true);

    engine.state.ship.position = { ...customPos };
    engine.state.ship.angle = customAngle;
    engine.state.ship.dockedIslandId = 'felingard';

    // Entre dans la Grotte des Souris-Fantômes
    engine.loadZone('overworld', { x: 30, z: 4.5 });
    expect(engine.triggerInteraction()).toBe(true);
    expect(engine.state.zoneId).toBe('dungeon_ghost_cave');
    // Aucun interactable bateau dans un donjon
    expect(
      engine.state.interactables.some((i) => i.type === 'ship_board'),
    ).toBe(false);

    // Sort du donjon vers l'Overworld
    engine.loadZone('overworld', { x: 30, z: 6.5 });
    expect(engine.state.zoneId).toBe('overworld');
    expect(engine.state.ship.mode).toBe('parked');
    expect(engine.state.ship.position.x).toBeCloseTo(customPos.x, 5);
    expect(engine.state.ship.position.z).toBeCloseTo(customPos.z, 5);
    expect(engine.state.ship.angle).toBeCloseTo(customAngle, 5);
  });

  it('gère respawnAtInn() sans soft-lock depuis une île distante, depuis la haute mer, et conserve le bateau si déjà sur Félingard', () => {
    const defaultFelingard = getDefaultBoatSpawnOnFelingard();

    // 1. Mort sur une île distante (tropical) -> rapatriement joueur + bateau sur Félingard sans perte d'or/niveau
    {
      const engine = createReadyEngine();
      const tropAnch = getDefaultAnchorageForIsland('tropical');
      const tropLand = findSafeDisembarkSpot(
        tropAnch.position.x,
        tropAnch.position.z,
        tropAnch.angle,
      ).landingPos!;
      engine.state.islandId = 'tropical';
      engine.state.ship.position = { ...tropAnch.position };
      engine.state.ship.angle = tropAnch.angle;
      engine.state.ship.dockedIslandId = 'tropical';
      engine.loadZone('overworld', tropLand);
      engine.state.player.gold = 320;

      engine.state.player.hp = 0;
      engine.state.screen = 'defeat';
      engine.respawnAtInn();

      expect(engine.state.screen).toBe('playing');
      expect(engine.state.islandId).toBe('felingard');
      expect(engine.state.player.hp).toBe(engine.state.player.maxHp);
      expect(engine.state.player.gold).toBe(320);
      expect(engine.state.player.onShipDeck).toBe(false);
      expect(engine.state.player.elevationY).toBe(0);
      expect(engine.state.ship.mode).toBe('parked');
      expect(engine.state.ship.dockedIslandId).toBe('felingard');
      expect(engine.state.ship.position.x).toBeCloseTo(
        defaultFelingard.position.x,
        4,
      );
      expect(engine.state.ship.position.z).toBeCloseTo(
        defaultFelingard.position.z,
        4,
      );
      expect(
        isHullEntirelyOnWater(
          engine.state.ship.position.x,
          engine.state.ship.position.z,
          engine.state.ship.angle,
        ),
      ).toBe(true);
    }

    // 2. Mort simulée en pleine mer -> réveil propre à l'Auberge, onShipDeck = false, bateau rapatrié
    {
      const engine = createReadyEngine();
      engine.state.ship.mode = 'sailing';
      engine.state.ship.isSailing = true;
      engine.state.ship.dockedIslandId = null;
      engine.state.ship.position = { x: 65, z: 75 };
      engine.state.player.onShipDeck = true;
      engine.state.player.elevationY = 0.5;
      engine.state.player.hp = 0;
      engine.state.screen = 'defeat';

      engine.respawnAtInn();
      expect(engine.state.screen).toBe('playing');
      expect(engine.state.islandId).toBe('felingard');
      expect(engine.state.ship.mode).toBe('parked');
      expect(engine.state.ship.isSailing).toBe(false);
      expect(engine.state.player.onShipDeck).toBe(false);
      expect(engine.state.player.elevationY).toBe(0);
      expect(engine.state.companion.onShipDeck).toBe(false);
      expect(isInsideIsland(engine.state.player.x, engine.state.player.z, 1.8)).toBe(
        true,
      );
    }

    // 3. Mort sur Félingard avec bateau ancré à une plage Est personnalisée -> conserve ce mouillage
    {
      const engine = createReadyEngine();
      const eastAngle = 0.2;
      const wlR = getIslandWaterlineRadius('felingard', eastAngle);
      const customPos = {
        x: Math.cos(eastAngle) * (wlR + 2.9),
        z: Math.sin(eastAngle) * (wlR + 2.9),
      };
      engine.state.ship.mode = 'parked';
      engine.state.ship.dockedIslandId = 'felingard';
      engine.state.ship.position = { ...customPos };
      engine.state.ship.angle = -0.3;

      engine.state.player.hp = 0;
      engine.state.screen = 'defeat';
      engine.respawnAtInn();

      expect(engine.state.ship.position.x).toBeCloseTo(customPos.x, 4);
      expect(engine.state.ship.position.z).toBeCloseTo(customPos.z, 4);
      expect(engine.state.ship.angle).toBeCloseTo(-0.3, 4);
    }
  });

  it('réinitialise proprement le bateau sur returnToTitle() et startNewGame()', () => {
    const engine = createReadyEngine();
    const defaultSpawn = getDefaultBoatSpawnOnFelingard();

    engine.state.ship.mode = 'sailing';
    engine.state.ship.isSailing = true;
    engine.state.ship.position = { x: 80, z: -20 };
    engine.state.ship.speed = 10;
    engine.state.player.onShipDeck = true;
    engine.state.islandId = 'mountain';

    engine.returnToTitle();
    expect(engine.state.screen).toBe('title');
    expect(engine.state.islandId).toBe('felingard');
    expect(engine.state.ship.mode).toBe('parked');
    expect(engine.state.ship.isSailing).toBe(false);
    expect(engine.state.player.onShipDeck).toBe(false);
    expect(engine.state.ship.position.x).toBeCloseTo(defaultSpawn.position.x, 4);
    expect(engine.state.ship.position.z).toBeCloseTo(defaultSpawn.position.z, 4);

    engine.startNewGame();
    expect(engine.state.screen).toBe('playing');
    expect(engine.state.ship.mode).toBe('parked');
    expect(engine.state.ship.dockedIslandId).toBe('felingard');
    expect(engine.state.ship.position.x).toBeCloseTo(defaultSpawn.position.x, 4);
  });

  it('conserve un combat terrestre complet (mêlée + sort + loot) après débarquement sur une île distante', () => {
    const engine = createReadyEngine();
    const tropAnch = getDefaultAnchorageForIsland('tropical');

    engine.state.ship.mode = 'sailing';
    engine.state.ship.isSailing = true;
    engine.state.ship.position = { ...tropAnch.position };
    engine.state.ship.angle = tropAnch.angle;
    engine.state.ship.speed = 0;

    engine.step(1 / 60, createEmptyInputState());
    const pressE = createEmptyInputState();
    pressE.interactPressed = true;
    engine.step(1 / 60, pressE);
    for (let i = 0; i < 180 && shipMode(engine) !== 'parked'; i++) {
      engine.step(1 / 60, createEmptyInputState());
    }
    expect(shipMode(engine)).toBe('parked');
    expect(engine.state.islandId).toBe('tropical');

    const parkedBoatPos = { ...engine.state.ship.position };
    const enemy = engine.state.enemies[0];
    expect(enemy).toBeDefined();

    // Place le héros à portée de combat et lance Flamme-ronron puis coup mêlée fatal
    engine.state.player.x = enemy.x - 1.5;
    engine.state.player.z = enemy.z;
    engine.state.player.aimAngle = 0;
    const goldBefore = engine.state.player.gold;
    const xpBefore = engine.state.player.xp;

    expect(engine.castSpellById('flamepurr')).toBe(true);
    enemy.hp = 1;
    const atk = createEmptyInputState();
    atk.attackPressed = true;
    engine.step(1 / 60, atk);

    expect(enemy.state).toBe('dead');
    expect(engine.state.player.gold).toBeGreaterThan(goldBefore);
    expect(engine.state.player.xp).toBeGreaterThan(xpBefore);
    // Le bateau n'a pas bougé d'un millimètre pendant le combat
    expect(engine.state.ship.position.x).toBeCloseTo(parkedBoatPos.x, 5);
    expect(engine.state.ship.position.z).toBeCloseTo(parkedBoatPos.z, 5);
  });

  it('exécute 10 000 ticks maritimes avec collisions côtières actives sous budget CPU strict (< 1,500 ms)', () => {
    const spawn = getDefaultBoatSpawnOnFelingard();
    const ship: ShipPhysicsState = {
      position: { x: spawn.position.x, z: spawn.position.z + 5 },
      angle: spawn.angle,
      vx: 0,
      vz: 0,
      speed: 0,
      angularVelocity: 0,
      rudder: 0,
      roll: 0,
      pitch: 0,
      bobPhase: 0,
      bobY: 0,
      wakeIntensity: 0,
      reverseEngageTimer: 0,
      isCollidingShore: false,
      nearestCoastIslandId: 'felingard',
    };

    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const steer = Math.sin(i * 0.015) > 0.3 ? -1 : Math.sin(i * 0.015) < -0.3 ? 1 : 0;
      const throttle = i % 500 < 420 ? 1 : -1;
      stepShipPhysics(
        ship,
        { throttle, steer },
        1 / 60,
        SHIP_PHYSICS_CONFIG,
        (x, z, angle, speed, angVel, cfg, substepDt) =>
          resolveShipCoastCollision(x, z, angle, speed, angVel, cfg, substepDt),
      );
    }
    const elapsedMs = performance.now() - t0;

    // 10,000 frames simulate 166s; 1.5s still leaves over 100x real-time headroom on CI runners.
    expect(elapsedMs).toBeLessThan(1500);
    expect(Number.isFinite(ship.position.x)).toBe(true);
    expect(Number.isFinite(ship.position.z)).toBe(true);
    expect(Number.isFinite(ship.angle)).toBe(true);
    expect(isHullEntirelyOnWater(ship.position.x, ship.position.z, ship.angle)).toBe(
      true,
    );
  });
});
