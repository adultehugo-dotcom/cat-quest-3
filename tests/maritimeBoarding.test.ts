import { describe, expect, it } from 'vitest';
import { isInsideIsland } from '../src/data/worldData';
import { isInsideNewIsland } from '../src/data/worldIslands';
import { PLAYER_RADIUS } from '../src/game/combat';
import { createEnemyInstance } from '../src/game/enemyAI';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { createMemoryStorage } from '../src/game/saveSystem';
import {
  SHIP_BOARDING_RADIUS,
  SHIP_COMPANION_DECK_LOCAL,
  SHIP_HERO_DECK_LOCAL,
  shipLocalToWorld,
} from '../src/game/shipPhysics';
import {
  ALL_ISLAND_IDS,
  findSafeDisembarkSpot,
  getDefaultAnchorageForIsland,
  getIslandCenter,
  getIslandWaterlineRadius,
  isHullEntirelyOnWater,
} from '../src/game/shorelineNavigation';
import type { IslandId, ShipMode, WallRect } from '../src/game/types';

function shipMode(engine: GameEngine): ShipMode {
  return engine.state.ship.mode;
}

function createReadyEngine(): GameEngine {
  const engine = new GameEngine({
    storage: createMemoryStorage(),
    rng: () => 0.5,
  });
  engine.startNewGame();
  while (engine.state.dialogue.active) engine.advanceDialogue();
  return engine;
}

function isOnIslandLand(islandId: IslandId, x: number, z: number): boolean {
  return islandId === 'felingard'
    ? isInsideIsland(x, z, 1.8)
    : isInsideNewIsland(islandId, x, z, 1.8);
}

describe('Débarquement — Plages des 6 Îles & Freinage Automatique (Section 16.C)', () => {
  it('débarque proprement avec freinage automatique (docking -> disembarking -> parked) sur les 6 îles', () => {
    for (const islandId of ALL_ISLAND_IDS) {
      const engine = createReadyEngine();
      const anchorage = getDefaultAnchorageForIsland(islandId);

      // Place le navire en croisière près de la plage cible
      engine.state.ship.mode = 'sailing';
      engine.state.ship.isSailing = true;
      engine.state.ship.dockedIslandId = null;
      engine.state.ship.position = { ...anchorage.position };
      engine.state.ship.angle = anchorage.angle;
      engine.state.ship.speed = 7.5;
      engine.state.player.onShipDeck = true;
      engine.state.companion.onShipDeck = true;

      // 1 tick de mise à jour statut débarquement
      engine.step(1 / 60, createEmptyInputState());
      expect(engine.state.ship.disembarkStatus.canDisembark, islandId).toBe(true);
      expect(engine.state.ship.disembarkStatus.nearestIslandId).toBe(islandId);
      expect(engine.state.nearestInteractable?.type).toBe('ship_disembark');

      // Déclenche [E] -> passe en 'docking' (freinage auto)
      const pressE = createEmptyInputState();
      pressE.interactPressed = true;
      engine.step(1 / 60, pressE);
      expect(engine.state.ship.mode).toBe('docking');
      expect(engine.state.nearestInteractable).toBeNull();

      let sawDockingDecel = false;
      let sawDisembarkingArc = false;
      let maxHeroY = 0;
      let maxCompY = 0;
      let prevSpeed = engine.state.ship.speed;

      for (let i = 0; i < 240 && shipMode(engine) !== 'parked'; i++) {
        engine.step(1 / 60, createEmptyInputState());
        if (shipMode(engine) === 'docking') {
          // Freinage monotone sans basculer en marche arrière !
          expect(engine.state.ship.speed).toBeGreaterThanOrEqual(0);
          if (engine.state.ship.speed < prevSpeed) {
            sawDockingDecel = true;
          }
          prevSpeed = engine.state.ship.speed;
        }
        if (shipMode(engine) === 'disembarking') {
          maxHeroY = Math.max(maxHeroY, engine.state.player.elevationY ?? 0);
          maxCompY = Math.max(maxCompY, engine.state.companion.y ?? 0);
          if (maxHeroY > 0.6) sawDisembarkingArc = true;
        }
      }

      expect(sawDockingDecel, `${islandId}: docking must decelerate`).toBe(true);
      expect(sawDisembarkingArc, `${islandId}: disembarking must jump parabolically`).toBe(
        true,
      );
      expect(maxCompY).toBeGreaterThan(0.5);

      expect(engine.state.ship.mode).toBe('parked');
      expect(engine.state.ship.isSailing).toBe(false);
      expect(engine.state.ship.speed).toBe(0);
      expect(engine.state.ship.dockedIslandId).toBe(islandId);
      expect(engine.state.islandId).toBe(islandId);
      expect(engine.state.player.elevationY).toBe(0);
      expect(engine.state.player.onShipDeck).toBe(false);
      expect(engine.state.companion.onShipDeck).toBe(false);

      // Héros & compagnon strictement sur terre marchable
      expect(
        isOnIslandLand(islandId, engine.state.player.x, engine.state.player.z),
        `${islandId}: player must land on walkable ground`,
      ).toBe(true);
      expect(
        isOnIslandLand(islandId, engine.state.companion.x, engine.state.companion.z),
        `${islandId}: companion must land on walkable ground`,
      ).toBe(true);
      expect(
        isHullEntirelyOnWater(
          engine.state.ship.position.x,
          engine.state.ship.position.z,
          engine.state.ship.angle,
        ),
      ).toBe(true);

      // Vérifie que le héros peut immédiatement marcher vers l'intérieur de l'île (non coincé)
      const startX = engine.state.player.x;
      const startZ = engine.state.player.z;
      const center = getIslandCenter(islandId);
      const dx = center.x - startX;
      const dz = center.z - startZ;
      const len = Math.hypot(dx, dz) || 1;
      const walkIn = createEmptyInputState();
      walkIn.moveX = dx / len;
      walkIn.moveZ = dz / len;
      for (let i = 0; i < 30; i++) {
        engine.step(0.05, walkIn);
      }
      expect(
        Math.hypot(engine.state.player.x - startX, engine.state.player.z - startZ),
      ).toBeGreaterThan(2.5);
    }
  });

  it('refuse le débarquement en haute mer, près des falaises, hors overworld ou si la plage est entièrement obstruée', () => {
    const engine = createReadyEngine();

    // 1. Haute mer -> too_far_from_shore + événement ship_refused
    engine.state.ship.mode = 'sailing';
    engine.state.ship.isSailing = true;
    engine.state.ship.position = { x: 40, z: 95 };
    engine.state.ship.angle = 0;
    engine.step(1 / 60, createEmptyInputState());
    expect(engine.state.ship.disembarkStatus.canDisembark).toBe(false);
    expect(engine.state.ship.disembarkStatus.reason).toBe('too_far_from_shore');
    expect(engine.state.nearestInteractable).toBeNull();

    engine.consumeEvents();
    const pressE = createEmptyInputState();
    pressE.interactPressed = true;
    engine.step(1 / 60, pressE);
    expect(engine.state.ship.mode).toBe('sailing');
    expect(
      engine.consumeEvents().some((e) => e.type === 'ship_refused'),
    ).toBe(true);

    // 2. Falaises (Griffe-de-Roc face Est & Félingard falaise NNE) -> inaccessible_cliff
    for (const [islandId, cliffAngle] of [
      ['mountain', 0],
      ['felingard', -1.4],
      ['mystic', 2.3],
      ['wild', -2.4],
    ] as const) {
      const center = getIslandCenter(islandId);
      const wlR = getIslandWaterlineRadius(islandId, cliffAngle);
      const shipX = center.x + Math.cos(cliffAngle) * (wlR + 2.4);
      const shipZ = center.z + Math.sin(cliffAngle) * (wlR + 2.4);
      const res = findSafeDisembarkSpot(shipX, shipZ, 0);
      expect(res.canDisembark, `${islandId} cliff must refuse`).toBe(false);
      expect(res.reason).toBe('inaccessible_cliff');
    }

    // 3. Hors Overworld -> not_in_overworld
    const dungeonRes = findSafeDisembarkSpot(0, 0, 0, {
      zoneId: 'dungeon_ghost_cave',
    });
    expect(dungeonRes.canDisembark).toBe(false);
    expect(dungeonRes.reason).toBe('not_in_overworld');

    // 4. Plage encombrée : mur couvrant toute la zone -> no_safe_spot
    const tropAnch = getDefaultAnchorageForIsland('tropical');
    const baseline = findSafeDisembarkSpot(
      tropAnch.position.x,
      tropAnch.position.z,
      tropAnch.angle,
    );
    expect(baseline.canDisembark).toBe(true);
    expect(baseline.landingPos).toBeDefined();

    const giantBlocker: WallRect = {
      minX: baseline.landingPos!.x - 25,
      maxX: baseline.landingPos!.x + 25,
      minZ: baseline.landingPos!.z - 25,
      maxZ: baseline.landingPos!.z + 25,
    };
    const blockedRes = findSafeDisembarkSpot(
      tropAnch.position.x,
      tropAnch.position.z,
      tropAnch.angle,
      { walls: [giantBlocker] },
    );
    expect(blockedRes.canDisembark).toBe(false);
    expect(blockedRes.reason).toBe('no_safe_spot');

    // 5. Ennemi placé pile sur le point de débarquement préféré -> esquivé vers un spot sûr
    const blockingEnemy = createEnemyInstance({
      id: 'beach_blocker',
      typeId: 'frost_golem',
      x: baseline.landingPos!.x,
      z: baseline.landingPos!.z,
    });
    const enemyAware = findSafeDisembarkSpot(
      tropAnch.position.x,
      tropAnch.position.z,
      tropAnch.angle,
      {
        currentIslandId: 'tropical',
        enemies: [blockingEnemy],
      },
    );
    expect(enemyAware.canDisembark).toBe(true);
    expect(enemyAware.landingPos).toBeDefined();
    expect(
      Math.hypot(
        enemyAware.landingPos!.x - blockingEnemy.x,
        enemyAware.landingPos!.z - blockingEnemy.z,
      ),
    ).toBeGreaterThanOrEqual(blockingEnemy.radius + PLAYER_RADIUS + 1.1);
  });
});

describe('Embarquement, Stabilité sur le Pont & Non-Téléportation (Section 16.D)', () => {
  it('embarque avec saut parabolique depuis les 6 îles et maintient héros + compagnon verrouillés au pont en virage', () => {
    for (const islandId of ALL_ISLAND_IDS) {
      const engine = createReadyEngine();
      const anchorage = getDefaultAnchorageForIsland(islandId);
      const beachSpot = findSafeDisembarkSpot(
        anchorage.position.x,
        anchorage.position.z,
        anchorage.angle,
      );
      expect(beachSpot.canDisembark).toBe(true);

      engine.state.islandId = islandId;
      engine.state.ship.position = { ...anchorage.position };
      engine.state.ship.angle = anchorage.angle;
      engine.state.ship.dockedIslandId = islandId;
      engine.loadZone('overworld', beachSpot.landingPos!);

      expect(engine.state.nearestInteractable?.type).toBe('ship_board');
      expect(engine.triggerInteraction()).toBe(true);
      expect(engine.state.ship.mode).toBe('boarding');

      let peakHeroY = 0;
      for (let i = 0; i < 60 && engine.state.ship.mode === 'boarding'; i++) {
        engine.step(1 / 60, createEmptyInputState());
        peakHeroY = Math.max(peakHeroY, engine.state.player.elevationY ?? 0);
      }

      expect(peakHeroY).toBeGreaterThan(1.0);
      expect(engine.state.ship.mode).toBe('sailing');
      expect(engine.state.player.onShipDeck).toBe(true);
      expect(engine.state.companion.onShipDeck).toBe(true);

      // Virages agressifs à pleine vitesse : héros et compagnon suivent l'ancrage local exact du pont
      const turnInput = createEmptyInputState();
      turnInput.moveZ = -1;
      turnInput.moveX = -1;
      for (let frame = 0; frame < 45; frame++) {
        engine.step(1 / 60, turnInput);
        const ship = engine.state.ship;
        const expectedHero = shipLocalToWorld(
          ship.position.x,
          ship.position.z,
          ship.angle,
          SHIP_HERO_DECK_LOCAL.right,
          SHIP_HERO_DECK_LOCAL.aft,
        );
        const expectedComp = shipLocalToWorld(
          ship.position.x,
          ship.position.z,
          ship.angle,
          SHIP_COMPANION_DECK_LOCAL.right,
          SHIP_COMPANION_DECK_LOCAL.aft,
        );
        expect(engine.state.player.x).toBeCloseTo(expectedHero.x, 4);
        expect(engine.state.player.z).toBeCloseTo(expectedHero.z, 4);
        expect(engine.state.companion.x).toBeCloseTo(expectedComp.x, 4);
        expect(engine.state.companion.z).toBeCloseTo(expectedComp.z, 4);
      }
    }
  });

  it('ne téléporte jamais le bateau après éloignement > 20 u et permet de revenir ré-embarquer au point exact', () => {
    const engine = createReadyEngine();

    // Place le bateau sur la plage OUEST de Félingard (très loin du mouillage Sud par défaut)
    const westAngle = Math.PI * 0.92;
    const wlR = getIslandWaterlineRadius('felingard', westAngle);
    const customShipPos = {
      x: Math.cos(westAngle) * (wlR + 2.8),
      z: Math.sin(westAngle) * (wlR + 2.8),
    };
    const customShipAngle = 0.25;
    expect(
      isHullEntirelyOnWater(customShipPos.x, customShipPos.z, customShipAngle),
    ).toBe(true);

    engine.state.ship.mode = 'sailing';
    engine.state.ship.isSailing = true;
    engine.state.ship.position = { ...customShipPos };
    engine.state.ship.angle = customShipAngle;
    engine.state.ship.speed = 0;

    engine.step(1 / 60, createEmptyInputState());
    expect(engine.state.ship.disembarkStatus.canDisembark).toBe(true);

    // Débarque sur cette plage personnalisée
    const pressE = createEmptyInputState();
    pressE.interactPressed = true;
    engine.step(1 / 60, pressE);
    for (let i = 0; i < 180 && shipMode(engine) !== 'parked'; i++) {
      engine.step(1 / 60, createEmptyInputState());
    }
    expect(shipMode(engine)).toBe('parked');

    const parkedPos = { ...engine.state.ship.position };
    const parkedAngle = engine.state.ship.angle;
    const landedPos = { x: engine.state.player.x, z: engine.state.player.z };

    // Marche vers le centre de l'île sur > 22 u (éloignement réel)
    for (let step = 0; step < 120; step++) {
      const dx = 0 - engine.state.player.x;
      const dz = 24 - engine.state.player.z;
      const d = Math.hypot(dx, dz);
      if (d < 2) break;
      const walk = createEmptyInputState();
      walk.moveX = dx / d;
      walk.moveZ = dz / d;
      engine.step(0.05, walk);
    }

    const walkedAwayDist = Math.hypot(
      engine.state.player.x - parkedPos.x,
      engine.state.player.z - parkedPos.z,
    );
    expect(walkedAwayDist).toBeGreaterThan(22);
    // Hors de portée -> aucun prompt d'embarquement
    expect(engine.state.nearestInteractable?.type).not.toBe('ship_board');
    // ZÉRO téléportation du bateau !
    expect(engine.state.ship.position.x).toBeCloseTo(parkedPos.x, 5);
    expect(engine.state.ship.position.z).toBeCloseTo(parkedPos.z, 5);
    expect(engine.state.ship.angle).toBeCloseTo(parkedAngle, 5);

    // Revient à pied jusqu'à la plage où le bateau est resté amarré
    for (let step = 0; step < 260; step++) {
      const dx = landedPos.x - engine.state.player.x;
      const dz = landedPos.z - engine.state.player.z;
      const d = Math.hypot(dx, dz);
      if (
        Math.hypot(
          engine.state.player.x - parkedPos.x,
          engine.state.player.z - parkedPos.z,
        ) <=
        SHIP_BOARDING_RADIUS - 0.5
      ) {
        break;
      }
      const walk = createEmptyInputState();
      walk.moveX = dx / (d || 1);
      walk.moveZ = dz / (d || 1);
      engine.step(0.05, walk);
    }

    expect(engine.state.nearestInteractable?.type).toBe('ship_board');
    expect(engine.triggerInteraction()).toBe(true);
    for (let i = 0; i < 60 && shipMode(engine) === 'boarding'; i++) {
      engine.step(1 / 60, createEmptyInputState());
    }
    expect(shipMode(engine)).toBe('sailing');
  });

  it('verrouille combat/sorts/roulade en mer & transitions, respecte la priorité [E] (0 MP) et désengage les ennemis', () => {
    const engine = createReadyEngine();
    const boat = engine.state.ship.position;
    const beachSpot = findSafeDisembarkSpot(boat.x, boat.z, engine.state.ship.angle);
    engine.loadZone('overworld', beachSpot.landingPos!);

    // Ennemi en poursuite près de la plage
    const chaser = createEnemyInstance({
      id: 'beach_chaser',
      typeId: 'slime_yarn',
      x: beachSpot.landingPos!.x + 2,
      z: beachSpot.landingPos!.z - 2,
    });
    chaser.aggroed = true;
    chaser.state = 'chase';
    engine.state.enemies.push(chaser);

    // Appui simultané [E] (interactPressed + spellPressed.lightnyan) -> embarque sans dépenser 1 seul PM !
    const mpBefore = engine.state.player.mp;
    const eInput = createEmptyInputState();
    eInput.interactPressed = true;
    eInput.spellPressed.lightnyan = true;
    engine.step(1 / 60, eInput);

    expect(engine.state.ship.mode).toBe('boarding');
    expect(engine.state.player.mp).toBe(mpBefore);
    expect(chaser.aggroed).toBe(false);
    expect(chaser.state).toBe('idle');

    // Pendant 'boarding', spam attaque + roulade + 4 sorts + interactPressed + castSpellById -> tout bloqué
    const spam = createEmptyInputState();
    spam.attackPressed = true;
    spam.dodgePressed = true;
    spam.interactPressed = true;
    spam.spellPressed.flamepurr = true;
    spam.spellPressed.lightnyan = true;
    spam.spellPressed.freezepaw = true;
    spam.spellPressed.healing_paw = true;

    for (let i = 0; i < 10; i++) {
      engine.step(1 / 60, spam);
      expect(engine.castSpellById('flamepurr')).toBe(false);
      expect(engine.state.player.mp).toBe(mpBefore);
      expect(engine.state.player.dodgeTimer).toBe(0);
      expect(engine.state.player.attackAnimTimer).toBe(0);
    }

    // Termine le boarding -> passe en 'sailing' -> combat/sorts/roulade restent strictement verrouillés
    for (let i = 0; i < 50 && engine.state.ship.mode === 'boarding'; i++) {
      engine.step(1 / 60, createEmptyInputState());
    }
    expect(engine.state.ship.mode).toBe('sailing');

    const seaSpam = createEmptyInputState();
    seaSpam.attackPressed = true;
    seaSpam.dodgePressed = true;
    seaSpam.spellPressed.flamepurr = true;
    seaSpam.spellPressed.lightnyan = true;
    seaSpam.spellPressed.freezepaw = true;
    seaSpam.spellPressed.healing_paw = true;
    engine.step(1 / 60, seaSpam);

    expect(engine.castSpellById('flamepurr')).toBe(false);
    expect(engine.castSpellById('lightnyan')).toBe(false);
    expect(engine.state.player.mp).toBe(mpBefore);
    expect(engine.state.player.dodgeTimer).toBe(0);
    expect(engine.state.player.attackAnimTimer).toBe(0);
  });
});
