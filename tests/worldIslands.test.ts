import { describe, expect, it } from 'vitest';
import { isInsideIsland } from '../src/data/worldData';
import {
  ALL_NEW_ISLANDS,
  NEW_ISLANDS,
  isInsideNewIsland,
  type IslandId,
} from '../src/data/worldIslands';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { normalizeAngle } from '../src/game/math';
import { createMemoryStorage } from '../src/game/saveSystem';
import {
  SHIP_BOARDING_RADIUS,
  getShipForward,
  headingFromDirection,
} from '../src/game/shipPhysics';
import {
  getCoastKindAtAngle,
  getDefaultAnchorageForIsland,
  getDefaultBoatSpawnOnFelingard,
  getIslandCenter,
  getIslandWaterlineRadius,
  findSafeDisembarkSpot,
  isHullEntirelyOnWater,
} from '../src/game/shorelineNavigation';

function completeBoarding(engine: GameEngine): void {
  const idle = createEmptyInputState();
  for (let i = 0; i < 60 && engine.state.ship.mode === 'boarding'; i++) {
    engine.step(0.05, idle);
  }
  expect(engine.state.ship.mode).toBe('sailing');
}

function completeDisembarking(engine: GameEngine): void {
  const idle = createEmptyInputState();
  for (
    let i = 0;
    i < 160 &&
    (engine.state.ship.mode === 'docking' ||
      engine.state.ship.mode === 'disembarking');
    i++
  ) {
    engine.step(0.05, idle);
  }
  expect(engine.state.ship.mode).toBe('parked');
}

/**
 * Pilote le voilier vers un waypoint maritime donné avec les vraies commandes
 * (gaz/frein `moveZ` et gouvernail `moveX`) afin d'éviter toute triche/téléportation.
 */
function steerShipToward(
  engine: GameEngine,
  target: { x: number; z: number },
  arrivalRadius: number,
  maxSteps = 1200,
): void {
  for (let step = 0; step < maxSteps; step++) {
    const ship = engine.state.ship;
    const dx = target.x - ship.position.x;
    const dz = target.z - ship.position.z;
    const distToTarget = Math.hypot(dx, dz);
    if (distToTarget <= arrivalRadius) {
      return;
    }

    const desiredHeading = headingFromDirection(dx, dz);
    // angleError > 0 => la cible est à gauche (CCW), il faut steer = -1
    const angleError = normalizeAngle(desiredHeading - ship.angle);

    const input = createEmptyInputState();
    if (angleError > 0.08) {
      input.moveX = -1;
    } else if (angleError < -0.08) {
      input.moveX = 1;
    }

    if (Math.abs(angleError) < 1.15) {
      input.moveZ = distToTarget > 8 || ship.speed < 5.5 ? -1 : 0;
    } else if (ship.speed > 4.0) {
      input.moveZ = 1; // freine pour virer plus court
    }

    engine.step(0.05, input);
  }

  throw new Error(
    `Le voilier n'a pas atteint (${target.x.toFixed(1)}, ${target.z.toFixed(1)}) — position actuelle (${engine.state.ship.position.x.toFixed(1)}, ${engine.state.ship.position.z.toFixed(1)}).`,
  );
}

/**
 * Navigue proprement vers une plage accostable de `targetIslandId` en contournant
 * les îles intermédiaires par un point intermédiaire au large si nécessaire, puis débarque.
 */
function sailAndLandOnIsland(
  engine: GameEngine,
  targetIslandId: IslandId,
): void {
  const anchorage = getDefaultAnchorageForIsland(targetIslandId);
  const center = getIslandCenter(targetIslandId);
  const outDx = anchorage.position.x - center.x;
  const outDz = anchorage.position.z - center.z;
  const outLen = Math.hypot(outDx, outDz) || 1;
  const approachPoint = {
    x: anchorage.position.x + (outDx / outLen) * 6.5,
    z: anchorage.position.z + (outDz / outLen) * 6.5,
  };

  // Contourne Félingard si la ligne droite passe près du centre (0, 0)
  const sx = engine.state.ship.position.x;
  const sz = engine.state.ship.position.z;
  const midX = (sx + approachPoint.x) * 0.5;
  const midZ = (sz + approachPoint.z) * 0.5;
  if (Math.hypot(midX, midZ) < 62) {
    // Choisit un point d'évitement Est ou Ouest autour de Félingard à rayon 68 u
    const sideSign = sx + approachPoint.x >= 0 ? 1 : -1;
    const detour = { x: sideSign * 68, z: 0 };
    steerShipToward(engine, detour, 8.0, 900);
  }

  steerShipToward(engine, approachPoint, 5.5, 1400);
  steerShipToward(engine, anchorage.position, 2.2, 700);

  // Déclenche le débarquement dès que la plage est à portée
  for (let attempt = 0; attempt < 40; attempt++) {
    if (
      engine.state.ship.disembarkStatus.canDisembark &&
      engine.state.ship.disembarkStatus.nearestIslandId === targetIslandId
    ) {
      const interact = createEmptyInputState();
      interact.interactPressed = true;
      engine.step(0.05, interact);
      break;
    }
    const dx = center.x - engine.state.ship.position.x;
    const dz = center.z - engine.state.ship.position.z;
    const desiredHeading = headingFromDirection(dx, dz);
    const angleError = normalizeAngle(desiredHeading - engine.state.ship.angle);
    const input = createEmptyInputState();
    input.moveX = angleError > 0.08 ? -1 : angleError < -0.08 ? 1 : 0;
    input.moveZ = Math.abs(angleError) < 0.7 ? -0.5 : 0;
    engine.step(0.05, input);
  }

  expect(
    engine.state.ship.mode === 'docking' ||
      engine.state.ship.mode === 'disembarking',
  ).toBe(true);
  completeDisembarking(engine);
}

function startSailingFromFelingard(storage = createMemoryStorage()): GameEngine {
  const engine = new GameEngine({ storage, rng: () => 0.5 });
  engine.startNewGame();
  while (engine.state.dialogue.active) engine.advanceDialogue();

  const boat = engine.state.ship.position;
  // Place le joueur sur la plage Sud juste devant le bateau amarré
  const beachSpot = findSafeDisembarkSpot(
    boat.x,
    boat.z,
    engine.state.ship.angle,
  );
  expect(beachSpot.canDisembark).toBe(true);
  expect(beachSpot.landingPos).toBeDefined();

  engine.loadZone('overworld', beachSpot.landingPos!);
  expect(engine.state.nearestInteractable?.type).toBe('ship_board');
  expect(engine.triggerInteraction()).toBe(true);
  expect(engine.state.ship.mode).toBe('boarding');
  completeBoarding(engine);

  // S'écarte légèrement du rivage pour manœuvrer confortablement
  const fwd = getShipForward(engine.state.ship.angle);
  expect(Math.hypot(fwd.x, fwd.z)).toBeCloseTo(1, 5);
  return engine;
}

describe('Voyage et exploration des îles', () => {
  it('place le voilier sur une plage accessible de Félingard et permet de le rejoindre depuis le départ', () => {
    const defaultBoat = getDefaultBoatSpawnOnFelingard();
    expect(
      isHullEntirelyOnWater(
        defaultBoat.position.x,
        defaultBoat.position.z,
        defaultBoat.angle,
      ),
    ).toBe(true);

    const shoreAngle = Math.atan2(defaultBoat.position.z, defaultBoat.position.x);
    expect(getCoastKindAtAngle('felingard', shoreAngle)).toBe('beach');
    const landingPreview = findSafeDisembarkSpot(
      defaultBoat.position.x,
      defaultBoat.position.z,
      defaultBoat.angle,
    );
    expect(landingPreview.canDisembark).toBe(true);
    expect(landingPreview.landingPos).toBeDefined();
    expect(
      isInsideIsland(
        landingPreview.landingPos!.x,
        landingPreview.landingPos!.z,
        1.8,
      ),
    ).toBe(true);

    const engine = new GameEngine({
      storage: createMemoryStorage(),
      rng: () => 0.5,
    });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    const target = landingPreview.landingPos!;
    const input = createEmptyInputState();
    for (let frame = 0; frame < 320; frame++) {
      const dx = target.x - engine.state.player.x;
      const dz = target.z - engine.state.player.z;
      const distance = Math.hypot(dx, dz);
      if (distance <= 1.0) break;
      input.moveX = dx / distance;
      input.moveZ = dz / distance;
      engine.step(0.05, input);
    }

    expect(engine.state.player.hp).toBeGreaterThan(0);
    expect(
      isInsideIsland(engine.state.player.x, engine.state.player.z, 1.8),
    ).toBe(true);
    const distToShip = Math.hypot(
      engine.state.player.x - engine.state.ship.position.x,
      engine.state.player.z - engine.state.ship.position.z,
    );
    expect(
      distToShip,
      `player stopped at (${engine.state.player.x.toFixed(2)}, ${engine.state.player.z.toFixed(2)}), ship at (${engine.state.ship.position.x.toFixed(2)}, ${engine.state.ship.position.z.toFixed(2)})`,
    ).toBeLessThanOrEqual(SHIP_BOARDING_RADIUS);
    expect(engine.state.nearestInteractable?.type).toBe('ship_board');
  });

  it('définit des plages accostables sûres, du terrain, des ennemis et un coffre pour chacune des cinq îles', () => {
    expect(ALL_NEW_ISLANDS).toHaveLength(5);
    for (const islandId of ALL_NEW_ISLANDS) {
      const island = NEW_ISLANDS[islandId];
      expect(island.name.length).toBeGreaterThan(0);

      const anchorage = getDefaultAnchorageForIsland(islandId);
      expect(
        isHullEntirelyOnWater(
          anchorage.position.x,
          anchorage.position.z,
          anchorage.angle,
        ),
        `${islandId}: default anchorage must be entirely on water`,
      ).toBe(true);

      const shoreAngle = Math.atan2(
        anchorage.position.z - island.centerZ,
        anchorage.position.x - island.centerX,
      );
      expect(getCoastKindAtAngle(islandId, shoreAngle)).toBe('beach');
      expect(
        Math.hypot(
          anchorage.position.x - island.centerX,
          anchorage.position.z - island.centerZ,
        ),
      ).toBeGreaterThan(getIslandWaterlineRadius(islandId, shoreAngle));

      const disembark = findSafeDisembarkSpot(
        anchorage.position.x,
        anchorage.position.z,
        anchorage.angle,
      );
      expect(disembark.canDisembark, `${islandId}: must allow beach disembark`).toBe(
        true,
      );
      expect(disembark.nearestIslandId).toBe(islandId);
      expect(disembark.landingPos).toBeDefined();
      expect(
        isInsideNewIsland(
          islandId,
          disembark.landingPos!.x,
          disembark.landingPos!.z,
          1.8,
        ),
      ).toBe(true);

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

  it('permet de rejoindre chacune des îles par navigation réelle, de les explorer, puis de revenir à Félingard', () => {
    for (const islandId of ALL_NEW_ISLANDS) {
      const engine = startSailingFromFelingard();
      const island = NEW_ISLANDS[islandId];

      sailAndLandOnIsland(engine, islandId);
      expect(engine.state.islandId).toBe(islandId);
      expect(engine.state.zoneId).toBe('overworld');
      expect(engine.state.ship.mode).toBe('parked');
      expect(engine.state.ship.dockedIslandId).toBe(islandId);
      expect(
        isHullEntirelyOnWater(
          engine.state.ship.position.x,
          engine.state.ship.position.z,
          engine.state.ship.angle,
        ),
      ).toBe(true);
      expect(
        isInsideNewIsland(
          islandId,
          engine.state.player.x,
          engine.state.player.z,
          1.8,
        ),
      ).toBe(true);
      expect(engine.state.enemies.length).toBeGreaterThan(0);
      expect(engine.state.chests.map((chest) => chest.id)).toContain(
        island.chests[0].id,
      );

      const goldAtLanding = engine.state.player.gold;
      // Ré-embarque directement depuis la plage où le bateau est amarré
      expect(engine.state.nearestInteractable?.type).toBe('ship_board');
      expect(engine.triggerInteraction()).toBe(true);
      completeBoarding(engine);

      sailAndLandOnIsland(engine, 'felingard');
      expect(engine.state.islandId).toBe('felingard');
      expect(engine.state.ship.mode).toBe('parked');
      expect(
        isInsideIsland(engine.state.player.x, engine.state.player.z, 1.8),
      ).toBe(true);
      expect(engine.state.player.gold).toBe(goldAtLanding);
    }
  });

  it('garde le joueur sur chaque île, bloque les arbres et permet d’ouvrir les coffres locaux', () => {
    for (const islandId of ALL_NEW_ISLANDS) {
      const island = NEW_ISLANDS[islandId];
      const engine = new GameEngine({
        storage: createMemoryStorage(),
        rng: () => 0.5,
      });
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

  it('sauvegarde et recharge l’île, la position terrestre et le mouillage exact du bateau après le débarquement', () => {
    const storage = createMemoryStorage();
    const engine = startSailingFromFelingard(storage);
    const destination = NEW_ISLANDS.tropical;

    sailAndLandOnIsland(engine, 'tropical');
    const mooredPos = { ...engine.state.ship.position };
    const mooredAngle = engine.state.ship.angle;
    const landedPlayerPos = {
      x: engine.state.player.x,
      z: engine.state.player.z,
    };

    const loadedEngine = new GameEngine({ storage });
    expect(loadedEngine.continueSavedGame()).toBe(true);
    expect(loadedEngine.state.islandId).toBe('tropical');
    expect(loadedEngine.state.ship.mode).toBe('parked');
    expect(loadedEngine.state.ship.dockedIslandId).toBe('tropical');
    expect(loadedEngine.state.ship.position.x).toBeCloseTo(mooredPos.x, 4);
    expect(loadedEngine.state.ship.position.z).toBeCloseTo(mooredPos.z, 4);
    expect(loadedEngine.state.ship.angle).toBeCloseTo(mooredAngle, 4);
    expect(loadedEngine.state.player.x).toBeCloseTo(landedPlayerPos.x, 4);
    expect(loadedEngine.state.player.z).toBeCloseTo(landedPlayerPos.z, 4);
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
