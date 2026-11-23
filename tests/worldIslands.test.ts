import { describe, expect, it } from 'vitest';
import {
  ALL_NEW_ISLANDS,
  FELINGARD_DOCK_POS,
  NEW_ISLANDS,
  isInsideNewIsland,
} from '../src/data/worldIslands';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { createMemoryStorage } from '../src/game/saveSystem';
import { isInsideIsland } from '../src/data/worldData';

function sailTo(engine: GameEngine, target: { x: number; z: number }): void {
  const input = createEmptyInputState();
  for (let step = 0; step < 3000; step++) {
    const dx = target.x - engine.state.ship.position.x;
    const dz = target.z - engine.state.ship.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 2.5) {
      input.moveX = 0;
      input.moveZ = 0;
    } else {
      input.moveX = dx / distance;
      input.moveZ = dz / distance;
    }
    engine.step(0.05, input);
    if (!engine.state.ship.isSailing) return;
  }
  throw new Error(`Le bateau n'a pas atteint le quai (${target.x}, ${target.z}).`);
}

function startFromFelingard(storage = createMemoryStorage()): GameEngine {
  const engine = new GameEngine({ storage, rng: () => 0.5 });
  engine.startNewGame();
  while (engine.state.dialogue.active) engine.advanceDialogue();
  engine.loadZone('overworld', FELINGARD_DOCK_POS);
  expect(engine.triggerInteraction()).toBe(true);
  expect(engine.state.ship.isSailing).toBe(true);
  expect(engine.state.nearestInteractable).toBeNull();
  return engine;
}

describe('Voyage et exploration des îles', () => {
  it('place le quai de Félingard sur la côte et permet de le rejoindre depuis le départ', () => {
    expect(
      isInsideIsland(FELINGARD_DOCK_POS.x, FELINGARD_DOCK_POS.z, 1.8),
    ).toBe(true);

    const engine = new GameEngine({ storage: createMemoryStorage(), rng: () => 0.5 });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    const input = createEmptyInputState();
    for (let frame = 0; frame < 240; frame++) {
      const dx = FELINGARD_DOCK_POS.x - engine.state.player.x;
      const dz = FELINGARD_DOCK_POS.z - engine.state.player.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 1.5) break;
      input.moveX = dx / distance;
      input.moveZ = dz / distance;
      engine.step(0.05, input);
    }

    expect(engine.state.player.hp).toBeGreaterThan(0);
    const remainingDistance = Math.hypot(
        engine.state.player.x - FELINGARD_DOCK_POS.x,
        engine.state.player.z - FELINGARD_DOCK_POS.z,
      );
    expect(
      remainingDistance,
      `player stopped at (${engine.state.player.x}, ${engine.state.player.z})`,
    ).toBeLessThanOrEqual(3.2);
    expect(engine.state.nearestInteractable?.type).toBe('dock');
  });

  it('définit un quai sûr, du terrain, des ennemis et un coffre pour chacune des cinq îles', () => {
    expect(ALL_NEW_ISLANDS).toHaveLength(5);
    for (const islandId of ALL_NEW_ISLANDS) {
      const island = NEW_ISLANDS[islandId];
      expect(island.name.length).toBeGreaterThan(0);
      expect(isInsideNewIsland(islandId, island.dockPos.x, island.dockPos.z)).toBe(true);
      expect(island.props.length).toBeGreaterThan(0);
      expect(island.camps.flatMap((camp) => camp.spawns).length).toBeGreaterThan(0);
      expect(island.chests.length).toBeGreaterThan(0);
      for (const prop of island.props) {
        expect(isInsideNewIsland(islandId, prop.x, prop.z, 1.8)).toBe(true);
      }
      for (const spawn of island.camps.flatMap((camp) => camp.spawns)) {
        expect(
          isInsideNewIsland(islandId, spawn.x, spawn.z, 1.8),
          `${islandId}: ${spawn.id} must spawn on land`,
        ).toBe(true);
      }
    }
  });

  it('permet de rejoindre chacune des îles, de les explorer, puis de revenir à Félingard', () => {
    for (const islandId of ALL_NEW_ISLANDS) {
      const engine = startFromFelingard();
      const island = NEW_ISLANDS[islandId];

      sailTo(engine, island.dockPos);
      expect(engine.state.islandId).toBe(islandId);
      expect(engine.state.zoneId).toBe('overworld');
      expect(
        isInsideNewIsland(
          islandId,
          engine.state.player.x,
          engine.state.player.z,
          1.8,
        ),
      ).toBe(true);
      expect(
        Math.hypot(
          engine.state.player.x - island.dockPos.x,
          engine.state.player.z - island.dockPos.z,
        ),
      ).toBeCloseTo(2.9, 4);
      expect(engine.state.enemies.length).toBeGreaterThan(0);
      expect(engine.state.chests.map((chest) => chest.id)).toContain(
        island.chests[0].id,
      );

      const goldAtLanding = engine.state.player.gold;
      expect(engine.triggerInteraction()).toBe(true);
      sailTo(engine, FELINGARD_DOCK_POS);
      expect(engine.state.islandId).toBe('felingard');
      expect(engine.state.player.gold).toBe(goldAtLanding);
    }
  });

  it('garde le joueur sur chaque île, bloque les arbres et permet d’ouvrir les coffres locaux', () => {
    for (const islandId of ALL_NEW_ISLANDS) {
      const island = NEW_ISLANDS[islandId];
      const engine = new GameEngine({ storage: createMemoryStorage(), rng: () => 0.5 });
      engine.startNewGame();
      while (engine.state.dialogue.active) engine.advanceDialogue();

      const obstacle = island.props.find(
        (prop) => prop.collidable && prop.colliderRadius,
      );
      expect(obstacle).toBeDefined();
      engine.state.islandId = islandId;
      engine.loadZone('overworld', {
        x: obstacle!.x - 2,
        z: obstacle!.z,
      });

      const move = createEmptyInputState();
      move.moveX = 1;
      for (let frame = 0; frame < 30; frame++) {
        engine.step(0.05, move);
      }
      expect(
        Math.hypot(
          engine.state.player.x - obstacle!.x,
          engine.state.player.z - obstacle!.z,
        ),
      ).toBeGreaterThanOrEqual((obstacle!.colliderRadius ?? 0) + 0.35);
      expect(
        isInsideNewIsland(
          islandId,
          engine.state.player.x,
          engine.state.player.z,
          1.8,
        ),
      ).toBe(true);

      engine.state.player.x = island.chests[0].x;
      engine.state.player.z = island.chests[0].z;
      expect(engine.triggerInteraction()).toBe(true);
      expect(engine.state.openedChestIds).toContain(island.chests[0].id);
    }
  });

  it('sauvegarde et recharge l’île et la position après le débarquement', () => {
    const storage = createMemoryStorage();
    const engine = startFromFelingard(storage);
    const destination = NEW_ISLANDS.tropical;
    sailTo(engine, destination.dockPos);

    const loadedEngine = new GameEngine({ storage });
    expect(loadedEngine.continueSavedGame()).toBe(true);
    expect(loadedEngine.state.islandId).toBe('tropical');
    expect(loadedEngine.state.player.x).not.toBe(destination.dockPos.x);
    expect(loadedEngine.state.player.z).not.toBe(destination.dockPos.z);
    expect(
      isInsideNewIsland(
        'tropical',
        loadedEngine.state.player.x,
        loadedEngine.state.player.z,
        1.8,
      ),
    ).toBe(true);
    expect(loadedEngine.state.chests.map((chest) => chest.id)).toContain(
      destination.chests[0].id,
    );
  });
});
