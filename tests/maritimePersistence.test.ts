import { describe, expect, it } from 'vitest';
import { isInsideIsland } from '../src/data/worldData';
import { NEW_ISLANDS, isInsideNewIsland } from '../src/data/worldIslands';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { normalizeAngle } from '../src/game/math';
import {
  createMemoryStorage,
  loadGame,
  serializeGameState,
} from '../src/game/saveSystem';
import {
  SHIP_BOARDING_RADIUS,
  headingFromDirection,
} from '../src/game/shipPhysics';
import {
  findSafeDisembarkSpot,
  getDefaultAnchorageForIsland,
  getDefaultBoatSpawnOnFelingard,
  getIslandCenter,
  getIslandWaterlineRadius,
  isHullEntirelyOnWater,
} from '../src/game/shorelineNavigation';
import { SAVE_STORAGE_KEY, type SaveData, type ShipMode } from '../src/game/types';

function shipMode(engine: GameEngine): ShipMode {
  return engine.state.ship.mode;
}

function finishMaritimeTransitions(engine: GameEngine, expectedMode: 'sailing' | 'parked'): void {
  const idle = createEmptyInputState();
  for (let i = 0; i < 240 && engine.state.ship.mode !== expectedMode; i++) {
    engine.step(0.05, idle);
  }
  expect(engine.state.ship.mode).toBe(expectedMode);
}

function steerToPoint(
  engine: GameEngine,
  target: { x: number; z: number },
  radius: number,
  maxSteps = 1200,
): void {
  for (let i = 0; i < maxSteps; i++) {
    const ship = engine.state.ship;
    const dx = target.x - ship.position.x;
    const dz = target.z - ship.position.z;
    const d = Math.hypot(dx, dz);
    if (d <= radius) return;

    const desired = headingFromDirection(dx, dz);
    const err = normalizeAngle(desired - ship.angle);
    const input = createEmptyInputState();
    input.moveX = err > 0.08 ? -1 : err < -0.08 ? 1 : 0;
    input.moveZ = Math.abs(err) < 1.1 ? (d > 8 || ship.speed < 5.5 ? -1 : 0) : ship.speed > 4 ? 1 : 0;
    engine.step(0.05, input);
  }
  throw new Error(`Navigation timeout vers (${target.x}, ${target.z})`);
}

describe('Persistance Maritime — Cycle Complet 11 Étapes (Section 16.E)', () => {
  it('exécute et valide intégralement le cycle 11 étapes avec 2 rechargements réels sans téléportation du bateau', () => {
    const storage = createMemoryStorage();

    // Étape 1 : Nouvelle partie — bateau amarré plage Sud Félingard, héros à Miaou-bourg
    const engine1 = new GameEngine({ storage, rng: () => 0.5 });
    engine1.startNewGame();
    while (engine1.state.dialogue.active) engine1.advanceDialogue();
    const initialSpawn = getDefaultBoatSpawnOnFelingard();
    expect(engine1.state.islandId).toBe('felingard');
    expect(engine1.state.ship.mode).toBe('parked');
    expect(engine1.state.ship.position.x).toBeCloseTo(initialSpawn.position.x, 4);
    expect(engine1.state.ship.position.z).toBeCloseTo(initialSpawn.position.z, 4);

    // Étape 2 : Rejoindre le bateau à pied & embarquer (boarding -> sailing)
    const felingardBeach = findSafeDisembarkSpot(
      engine1.state.ship.position.x,
      engine1.state.ship.position.z,
      engine1.state.ship.angle,
    ).landingPos!;
    for (let step = 0; step < 300; step++) {
      const dx = felingardBeach.x - engine1.state.player.x;
      const dz = felingardBeach.z - engine1.state.player.z;
      const d = Math.hypot(dx, dz);
      if (d <= 1.0) break;
      const walk = createEmptyInputState();
      walk.moveX = dx / d;
      walk.moveZ = dz / d;
      engine1.step(0.05, walk);
    }
    expect(engine1.state.nearestInteractable?.type).toBe('ship_board');
    expect(engine1.triggerInteraction()).toBe(true);
    finishMaritimeTransitions(engine1, 'sailing');

    // Étape 3 : Naviguer en haute mer vers le large
    steerToPoint(engine1, { x: 42, z: 68 }, 4.0);
    expect(engine1.state.ship.isSailing).toBe(true);
    expect(engine1.state.ship.position.x).toBeGreaterThan(35);

    // Étape 4 : Approcher la plage de Plage des Ronrons Dorés (tropical)
    const tropAnch = getDefaultAnchorageForIsland('tropical');
    steerToPoint(engine1, tropAnch.position, 2.2);

    // Étape 5 : Débarquer sur tropical (docking -> disembarking -> parked)
    expect(engine1.state.ship.disembarkStatus.canDisembark).toBe(true);
    expect(engine1.state.ship.disembarkStatus.nearestIslandId).toBe('tropical');
    const pressE = createEmptyInputState();
    pressE.interactPressed = true;
    engine1.step(0.05, pressE);
    finishMaritimeTransitions(engine1, 'parked');
    expect(engine1.state.islandId).toBe('tropical');

    // Étape 6 : Enregistrer la pose exacte P1 du bateau amarré
    const p1Pos = { ...engine1.state.ship.position };
    const p1Angle = engine1.state.ship.angle;
    const p1Landing = { x: engine1.state.player.x, z: engine1.state.player.z };
    expect(isHullEntirelyOnWater(p1Pos.x, p1Pos.z, p1Angle)).toBe(true);

    // Étape 7 : S'éloigner sur tropical (> 10 u) et ouvrir le coffre local
    const tropChest = NEW_ISLANDS.tropical.chests[0];
    for (let step = 0; step < 200; step++) {
      const dx = tropChest.x - engine1.state.player.x;
      const dz = tropChest.z - engine1.state.player.z;
      const d = Math.hypot(dx, dz);
      if (d <= 2.1) break;
      const walk = createEmptyInputState();
      walk.moveX = dx / d;
      walk.moveZ = dz / d;
      engine1.step(0.05, walk);
    }
    expect(engine1.triggerInteraction()).toBe(true);
    expect(engine1.state.openedChestIds).toContain(tropChest.id);
    const goldAfterChest = engine1.state.player.gold;
    expect(goldAfterChest).toBeGreaterThan(0);

    // Vérifie non-téléportation du bateau avant sauvegarde
    expect(engine1.state.ship.position.x).toBeCloseTo(p1Pos.x, 5);
    expect(engine1.state.ship.position.z).toBeCloseTo(p1Pos.z, 5);

    // Étape 8 : Sauvegarde explicite
    const savedPlayerPos = { x: engine1.state.player.x, z: engine1.state.player.z };
    expect(engine1.saveCurrentGame()).toBe(true);
    expect(loadGame(storage)?.version).toBe(2);

    // Étape 9 : Rechargement #1 dans une nouvelle instance GameEngine
    const engine2 = new GameEngine({ storage, rng: () => 0.5 });
    expect(engine2.continueSavedGame()).toBe(true);

    // Étape 10 : Vérification intégrale de l'état restauré (zéro téléportation bateau !)
    expect(engine2.state.islandId).toBe('tropical');
    expect(engine2.state.ship.mode).toBe('parked');
    expect(engine2.state.ship.dockedIslandId).toBe('tropical');
    expect(engine2.state.ship.position.x).toBeCloseTo(p1Pos.x, 4);
    expect(engine2.state.ship.position.z).toBeCloseTo(p1Pos.z, 4);
    expect(engine2.state.ship.angle).toBeCloseTo(p1Angle, 4);
    expect(engine2.state.player.x).toBeCloseTo(savedPlayerPos.x, 4);
    expect(engine2.state.player.z).toBeCloseTo(savedPlayerPos.z, 4);
    expect(engine2.state.player.gold).toBe(goldAfterChest);
    expect(engine2.state.openedChestIds).toContain(tropChest.id);

    // Étape 11 : Revenir à pied au bateau à P1, ré-embarquer, rentrer à Félingard en un point P2 distinct,
    // débarquer, sauvegarder et recharger dans une 3e instance GameEngine !
    for (let step = 0; step < 260; step++) {
      const distShip = Math.hypot(
        engine2.state.player.x - p1Pos.x,
        engine2.state.player.z - p1Pos.z,
      );
      if (distShip <= SHIP_BOARDING_RADIUS - 0.5) break;
      const dx = p1Landing.x - engine2.state.player.x;
      const dz = p1Landing.z - engine2.state.player.z;
      const d = Math.hypot(dx, dz) || 1;
      const walk = createEmptyInputState();
      walk.moveX = dx / d;
      walk.moveZ = dz / d;
      engine2.step(0.05, walk);
    }
    expect(engine2.state.nearestInteractable?.type).toBe('ship_board');
    expect(engine2.triggerInteraction()).toBe(true);
    finishMaritimeTransitions(engine2, 'sailing');

    // Navigue vers une plage EST de Félingard (distincte du mouillage Sud initial)
    const eastAngle = 0.25;
    const felCenter = getIslandCenter('felingard');
    const eastWlR = getIslandWaterlineRadius('felingard', eastAngle);
    const p2Target = {
      x: felCenter.x + Math.cos(eastAngle) * (eastWlR + 2.8),
      z: felCenter.z + Math.sin(eastAngle) * (eastWlR + 2.8),
    };
    steerToPoint(engine2, { x: 64, z: 36 }, 5.0);
    steerToPoint(engine2, p2Target, 2.2);

    expect(engine2.state.ship.disembarkStatus.canDisembark).toBe(true);
    expect(engine2.state.ship.disembarkStatus.nearestIslandId).toBe('felingard');
    engine2.step(0.05, pressE);
    finishMaritimeTransitions(engine2, 'parked');

    const p2Pos = { ...engine2.state.ship.position };
    const p2Angle = engine2.state.ship.angle;
    expect(
      Math.hypot(
        p2Pos.x - initialSpawn.position.x,
        p2Pos.z - initialSpawn.position.z,
      ),
    ).toBeGreaterThan(20);
    expect(engine2.saveCurrentGame()).toBe(true);

    // Rechargement #2
    const engine3 = new GameEngine({ storage, rng: () => 0.5 });
    expect(engine3.continueSavedGame()).toBe(true);
    expect(engine3.state.islandId).toBe('felingard');
    expect(engine3.state.ship.mode).toBe('parked');
    expect(engine3.state.ship.dockedIslandId).toBe('felingard');
    expect(engine3.state.ship.position.x).toBeCloseTo(p2Pos.x, 4);
    expect(engine3.state.ship.position.z).toBeCloseTo(p2Pos.z, 4);
    expect(engine3.state.ship.angle).toBeCloseTo(p2Angle, 4);
    expect(
      isInsideIsland(engine3.state.player.x, engine3.state.player.z, 1.8),
    ).toBe(true);
  });
});

describe('Persistance Maritime — Pleine Mer, États Transitoires & Migration v1', () => {
  it('sauvegarde et recharge proprement une partie en pleine mer (mode sailing, vitesse remise à 0)', () => {
    const storage = createMemoryStorage();
    const engine1 = new GameEngine({ storage, rng: () => 0.5 });
    engine1.startNewGame();
    while (engine1.state.dialogue.active) engine1.advanceDialogue();

    const seaPos = { x: 58.5, z: 72.25 };
    const seaAngle = 1.15;
    expect(isHullEntirelyOnWater(seaPos.x, seaPos.z, seaAngle)).toBe(true);

    engine1.state.ship.mode = 'sailing';
    engine1.state.ship.isSailing = true;
    engine1.state.ship.dockedIslandId = null;
    engine1.state.ship.position = { ...seaPos };
    engine1.state.ship.angle = seaAngle;
    engine1.state.ship.speed = 11.0;

    expect(engine1.saveCurrentGame()).toBe(true);

    const engine2 = new GameEngine({ storage, rng: () => 0.5 });
    expect(engine2.continueSavedGame()).toBe(true);
    expect(engine2.state.ship.mode).toBe('sailing');
    expect(engine2.state.ship.isSailing).toBe(true);
    expect(engine2.state.ship.dockedIslandId).toBeNull();
    expect(engine2.state.ship.position.x).toBeCloseTo(seaPos.x, 4);
    expect(engine2.state.ship.position.z).toBeCloseTo(seaPos.z, 4);
    expect(engine2.state.ship.angle).toBeCloseTo(seaAngle, 4);
    expect(engine2.state.ship.speed).toBe(0);
    expect(engine2.state.player.onShipDeck).toBe(true);
    expect(engine2.state.companion.onShipDeck).toBe(true);

    // Contrôles immédiatement opérationnels après rechargement en mer
    const thrust = createEmptyInputState();
    thrust.moveZ = -1;
    for (let i = 0; i < 15; i++) {
      engine2.step(1 / 60, thrust);
    }
    expect(engine2.state.ship.speed).toBeGreaterThan(1.0);
  });

  it('normalise proprement toute fermeture/sauvegarde en pleine transition (boarding, docking, disembarking)', () => {
    // 1. Sauvegarde pendant boarding -> recharge 'parked' sur terre ferme contrôlable
    {
      const storage = createMemoryStorage();
      const e1 = new GameEngine({ storage });
      e1.startNewGame();
      while (e1.state.dialogue.active) e1.advanceDialogue();
      const beach = findSafeDisembarkSpot(
        e1.state.ship.position.x,
        e1.state.ship.position.z,
        e1.state.ship.angle,
      ).landingPos!;
      e1.loadZone('overworld', beach);
      expect(e1.triggerInteraction()).toBe(true);
      e1.step(0.1, createEmptyInputState());
      expect(e1.state.ship.mode).toBe('boarding');
      expect(e1.saveCurrentGame()).toBe(true);

      const e2 = new GameEngine({ storage });
      expect(e2.continueSavedGame()).toBe(true);
      expect(e2.state.ship.mode).toBe('parked');
      expect(e2.state.ship.transition).toBeNull();
      expect(e2.state.player.onShipDeck).toBe(false);
      expect(isInsideIsland(e2.state.player.x, e2.state.player.z, 1.8)).toBe(true);
    }

    // 2. Sauvegarde pendant docking -> recharge 'sailing' sur l'eau contrôlable
    {
      const storage = createMemoryStorage();
      const e1 = new GameEngine({ storage });
      e1.startNewGame();
      while (e1.state.dialogue.active) e1.advanceDialogue();
      const anch = getDefaultAnchorageForIsland('tropical');
      e1.state.ship.mode = 'sailing';
      e1.state.ship.isSailing = true;
      e1.state.ship.position = { ...anch.position };
      e1.state.ship.angle = anch.angle;
      e1.state.ship.speed = 9.0;
      e1.step(1 / 60, createEmptyInputState());
      const pressE = createEmptyInputState();
      pressE.interactPressed = true;
      e1.step(1 / 60, pressE);
      expect(e1.state.ship.mode).toBe('docking');
      expect(e1.saveCurrentGame()).toBe(true);

      const e2 = new GameEngine({ storage });
      expect(e2.continueSavedGame()).toBe(true);
      expect(e2.state.ship.mode).toBe('sailing');
      expect(e2.state.ship.transition).toBeNull();
      expect(
        isHullEntirelyOnWater(
          e2.state.ship.position.x,
          e2.state.ship.position.z,
          e2.state.ship.angle,
        ),
      ).toBe(true);
    }

    // 3. Sauvegarde pendant disembarking -> recharge 'parked' sur l'île cible
    {
      const storage = createMemoryStorage();
      const e1 = new GameEngine({ storage });
      e1.startNewGame();
      while (e1.state.dialogue.active) e1.advanceDialogue();
      const anch = getDefaultAnchorageForIsland('tropical');
      e1.state.ship.mode = 'sailing';
      e1.state.ship.isSailing = true;
      e1.state.ship.position = { ...anch.position };
      e1.state.ship.angle = anch.angle;
      e1.state.ship.speed = 0;
      e1.step(1 / 60, createEmptyInputState());
      const pressE = createEmptyInputState();
      pressE.interactPressed = true;
      e1.step(1 / 60, pressE);
      for (let i = 0; i < 60 && shipMode(e1) !== 'disembarking'; i++) {
        e1.step(1 / 60, createEmptyInputState());
      }
      expect(shipMode(e1)).toBe('disembarking');
      expect(e1.saveCurrentGame()).toBe(true);

      const e2 = new GameEngine({ storage });
      expect(e2.continueSavedGame()).toBe(true);
      expect(e2.state.ship.mode).toBe('parked');
      expect(e2.state.islandId).toBe('tropical');
      expect(e2.state.ship.dockedIslandId).toBe('tropical');
      expect(
        isInsideNewIsland('tropical', e2.state.player.x, e2.state.player.z, 1.8),
      ).toBe(true);
      expect(
        isHullEntirelyOnWater(
          e2.state.ship.position.x,
          e2.state.ship.position.z,
          e2.state.ship.angle,
        ),
      ).toBe(true);
    }
  });

  it('migre proprement les sauvegardes v1 (Félingard & tropical) et récupère un bateau sauvé illégalement dans une île', () => {
    // 1. Migration v1 Félingard sans champ ship
    {
      const storage = createMemoryStorage();
      const seed = new GameEngine({ storage });
      seed.startNewGame();
      while (seed.state.dialogue.active) seed.advanceDialogue();
      seed.state.player.gold = 777;
      seed.state.player.hasRunicKey = true;
      const v2 = serializeGameState(seed.state);
      const { ship: _drop, ...rest } = v2;
      const v1: SaveData = { ...rest, version: 1, islandId: 'felingard' };
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v1));

      const restored = new GameEngine({ storage });
      expect(restored.continueSavedGame()).toBe(true);
      expect(restored.state.islandId).toBe('felingard');
      expect(restored.state.player.gold).toBe(777);
      expect(restored.state.player.hasRunicKey).toBe(true);
      expect(restored.state.ship.mode).toBe('parked');
      expect(restored.state.ship.dockedIslandId).toBe('felingard');
      expect(
        isHullEntirelyOnWater(
          restored.state.ship.position.x,
          restored.state.ship.position.z,
          restored.state.ship.angle,
        ),
      ).toBe(true);
    }

    // 2. Migration v1 tropical sans champ ship
    {
      const storage = createMemoryStorage();
      const seed = new GameEngine({ storage });
      const v2 = serializeGameState(seed.state);
      const { ship: _drop, ...rest } = v2;
      const v1Tropical: SaveData = {
        ...rest,
        version: 1,
        islandId: 'tropical',
        player: {
          ...rest.player,
          position: { x: 92, z: 48 },
        },
      };
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(v1Tropical));

      const restored = new GameEngine({ storage });
      expect(restored.continueSavedGame()).toBe(true);
      expect(restored.state.islandId).toBe('tropical');
      expect(restored.state.ship.dockedIslandId).toBe('tropical');
      expect(
        isInsideNewIsland(
          'tropical',
          restored.state.player.x,
          restored.state.player.z,
          1.8,
        ),
      ).toBe(true);
      expect(
        isHullEntirelyOnWater(
          restored.state.ship.position.x,
          restored.state.ship.position.z,
          restored.state.ship.angle,
        ),
      ).toBe(true);
    }

    // 3. Sauvegarde v2 avec bateau échoué au milieu de Félingard (0, 0) -> récupéré sur l'eau libre
    {
      const storage = createMemoryStorage();
      const seed = new GameEngine({ storage });
      const v2 = serializeGameState(seed.state);
      const stranded: SaveData = {
        ...v2,
        ship: {
          ...v2.ship!,
          mode: 'sailing',
          position: { x: 0, z: 0 },
          dockedIslandId: null,
        },
      };
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(stranded));

      const restored = new GameEngine({ storage });
      expect(restored.continueSavedGame()).toBe(true);
      expect(
        isHullEntirelyOnWater(
          restored.state.ship.position.x,
          restored.state.ship.position.z,
          restored.state.ship.angle,
        ),
      ).toBe(true);
    }
  });
});
