import { describe, expect, it } from 'vitest';
import {
  SHIP_PHYSICS_CONFIG,
  WATER_LEVEL_Y,
  getShipForward,
  headingFromDirection,
  stepShipPhysics,
  type ShipPhysicsState,
} from '../src/game/shipPhysics';
import {
  ALL_ISLAND_IDS,
  ISLAND_COAST_PROFILES,
  findSafeDisembarkSpot,
  getCoastKindAtAngle,
  getDefaultAnchorageForIsland,
  getHullControlPoints,
  getIslandCenter,
  getIslandCoastRadius,
  getIslandTerrainHeight,
  getIslandWaterlineRadius,
  getWaterSignedDistance,
  isHullEntirelyOnWater,
  resolveShipCoastCollision,
  sampleShorelineField,
} from '../src/game/shorelineNavigation';
import { normalizeAngle } from '../src/game/math';

function createSeaShip(x: number, z: number, angle: number, speed = 0): ShipPhysicsState {
  const fwd = getShipForward(angle);
  return {
    position: { x, z },
    angle: normalizeAngle(angle),
    vx: fwd.x * speed,
    vz: fwd.z * speed,
    speed,
    angularVelocity: 0,
    rudder: 0,
    roll: 0,
    pitch: 0,
    bobPhase: 0,
    bobY: 0,
    wakeIntensity: 0,
    reverseEngageTimer: 0,
    isCollidingShore: false,
    nearestCoastIslandId: null,
  };
}

function stepWithCoast(
  ship: ShipPhysicsState,
  throttle: number,
  steer: number,
  dt = 1 / 60,
) {
  return stepShipPhysics(
    ship,
    { throttle, steer },
    dt,
    SHIP_PHYSICS_CONFIG,
    (x, z, angle, speed, angVel, cfg, substepDt) =>
      resolveShipCoastCollision(x, z, angle, speed, angVel, cfg, substepDt),
  );
}

describe('Collisions Côtières — SDF Multi-Îles & Profils Terrain / Falaises (Section 16.B)', () => {
  it('évalue un champ SDF cohérent et des normales sortantes unitaires sur chacune des 6 îles', () => {
    expect(ALL_ISLAND_IDS).toHaveLength(6);

    for (const islandId of ALL_ISLAND_IDS) {
      const center = getIslandCenter(islandId);
      const centerSample = sampleShorelineField(center.x, center.z);
      expect(centerSample.nearestIslandId).toBe(islandId);
      expect(centerSample.signedDistance).toBeLessThan(-10);

      for (let k = 0; k < 8; k++) {
        const theta = normalizeAngle((k / 8) * Math.PI * 2);
        const wlR = getIslandWaterlineRadius(islandId, theta);
        const shoreX = center.x + Math.cos(theta) * wlR;
        const shoreZ = center.z + Math.sin(theta) * wlR;

        const onShore = sampleShorelineField(shoreX, shoreZ);
        expect(Math.abs(onShore.signedDistance)).toBeLessThan(0.08);
        expect(Math.hypot(onShore.normalX, onShore.normalZ)).toBeCloseTo(1, 4);
        // Normale pointe vers l'extérieur de l'île
        const radialDot =
          onShore.normalX * Math.cos(theta) + onShore.normalZ * Math.sin(theta);
        expect(radialDot).toBeGreaterThan(0.75);
      }
    }
  });

  it('aligne la hauteur des falaises (mountain, felingard) à WATER_LEVEL_Y sur la ligne d’eau tout en gardant l’intérieur plat', () => {
    // Griffe-de-Roc possède de vastes falaises à l'Est (angle 0) et une crique plage au SO (angle 2.3)
    expect(getCoastKindAtAngle('mountain', 0)).toBe('cliff');
    expect(getCoastKindAtAngle('mountain', ISLAND_COAST_PROFILES.mountain.defaultAnchorageAngle)).toBe(
      'beach',
    );
    expect(getCoastKindAtAngle('felingard', -1.4)).toBe('cliff');
    expect(getCoastKindAtAngle('mystic', 2.3)).toBe('rocks');
    expect(getCoastKindAtAngle('wild', -2.4)).toBe('rocks');

    for (const [islandId, cliffAngle] of [
      ['mountain', 0],
      ['felingard', -1.4],
    ] as const) {
      const center = getIslandCenter(islandId);
      const coastR = getIslandCoastRadius(islandId, cliffAngle);
      const wlR = getIslandWaterlineRadius(islandId, cliffAngle);
      const cosA = Math.cos(cliffAngle);
      const sinA = Math.sin(cliffAngle);

      // Intérieur jouable strictement plat à y = 0
      const innerY = getIslandTerrainHeight(
        islandId,
        center.x + cosA * (coastR - 3.0),
        center.z + sinA * (coastR - 3.0),
      );
      expect(innerY).toBeCloseTo(0, 5);

      // Crête rocheuse nettement surélevée
      const crestY = getIslandTerrainHeight(
        islandId,
        center.x + cosA * (coastR - 0.35),
        center.z + sinA * (coastR - 0.35),
      );
      expect(crestY).toBeGreaterThan(1.8);

      // Ligne d'eau exactement au niveau de l'océan
      const waterlineY = getIslandTerrainHeight(
        islandId,
        center.x + cosA * wlR,
        center.z + sinA * wlR,
      );
      expect(waterlineY).toBeCloseTo(WATER_LEVEL_Y, 4);
    }
  });
});

describe('Collisions Côtières — 6 Îles × 8 Azimuts (Frontal, Diagonal, Rasant, Lente & Max)', () => {
  it('empêche toute pénétration de la coque et de la proue en approche frontale (vitesse lente et max) sur les 6 îles × 8 azimuts', () => {
    const hull = SHIP_PHYSICS_CONFIG.hull;

    for (const islandId of ALL_ISLAND_IDS) {
      const center = getIslandCenter(islandId);

      for (let k = 0; k < 8; k++) {
        const theta = normalizeAngle((k / 8) * Math.PI * 2);
        const wlR = getIslandWaterlineRadius(islandId, theta);
        // Choisit un dégagement de départ entièrement en eau libre (tient compte du détroit Est/Ouest)
        const startOffset = hull.halfLength + hull.safetyMargin + 4.0;
        const startX = center.x + Math.cos(theta) * (wlR + startOffset);
        const startZ = center.z + Math.sin(theta) * (wlR + startOffset);
        const inwardHeading = headingFromDirection(
          center.x - startX,
          center.z - startZ,
        );

        if (!isHullEntirelyOnWater(startX, startZ, inwardHeading)) {
          continue;
        }

        // 1. Approche frontale à vitesse MAX
        const fastShip = createSeaShip(
          startX,
          startZ,
          inwardHeading,
          SHIP_PHYSICS_CONFIG.maxForwardSpeed,
        );
        let fastCollided = false;
        for (let step = 0; step < 90; step++) {
          const res = stepWithCoast(fastShip, 1, 0, 1 / 60);
          if (res.collided) fastCollided = true;

          expect(
            isHullEntirelyOnWater(
              fastShip.position.x,
              fastShip.position.z,
              fastShip.angle,
            ),
            `${islandId} az=${k} step=${step} fast head-on hull violated water invariant`,
          ).toBe(true);

          const pts = getHullControlPoints(
            fastShip.position.x,
            fastShip.position.z,
            fastShip.angle,
          );
          const bow = pts.find((p) => p.tag === 'bow')!;
          expect(getWaterSignedDistance(bow.x, bow.z)).toBeGreaterThanOrEqual(
            hull.safetyMargin - 0.02,
          );
        }
        expect(fastCollided, `${islandId} az=${k} should hit coast`).toBe(true);
        // Impact frontal amortit nettement la vitesse
        expect(fastShip.speed).toBeLessThan(SHIP_PHYSICS_CONFIG.maxForwardSpeed * 0.65);

        // 2. Approche frontale à vitesse LENTE
        const slowShip = createSeaShip(startX, startZ, inwardHeading, 2.2);
        let slowCollided = false;
        for (let step = 0; step < 180; step++) {
          const res = stepWithCoast(slowShip, 0.25, 0, 1 / 60);
          if (res.collided) slowCollided = true;
          expect(
            isHullEntirelyOnWater(
              slowShip.position.x,
              slowShip.position.z,
              slowShip.angle,
            ),
          ).toBe(true);
        }
        expect(slowCollided).toBe(true);
      }
    }
  });

  it('permet un glissement fluide en approche diagonale (40°) et en longement rasant sur les 6 îles', () => {
    const hull = SHIP_PHYSICS_CONFIG.hull;

    for (const islandId of ALL_ISLAND_IDS) {
      const anchorage = getDefaultAnchorageForIsland(islandId);
      const center = getIslandCenter(islandId);
      const shoreAngle = Math.atan2(
        anchorage.position.z - center.z,
        anchorage.position.x - center.x,
      );
      const wlR = getIslandWaterlineRadius(islandId, shoreAngle);

      // Approche oblique : 42° d'écart par rapport à la direction vers le centre
      const startX =
        center.x + Math.cos(shoreAngle) * (wlR + hull.halfLength + 4.5);
      const startZ =
        center.z + Math.sin(shoreAngle) * (wlR + hull.halfLength + 4.5);
      const inwardHeading = headingFromDirection(
        center.x - startX,
        center.z - startZ,
      );
      const obliqueHeading = normalizeAngle(inwardHeading + 0.72);
      const ship = createSeaShip(startX, startZ, obliqueHeading, 9.0);

      let collided = false;
      for (let step = 0; step < 120; step++) {
        const res = stepWithCoast(ship, 1, 0, 1 / 60);
        if (res.collided) collided = true;
        expect(
          isHullEntirelyOnWater(ship.position.x, ship.position.z, ship.angle),
          `${islandId} oblique step=${step}`,
        ).toBe(true);
      }

      expect(collided).toBe(true);
      // Doit avoir glissé nettement le long de la côte sans rester scotché
      const tangentialAngleDelta = Math.abs(
        normalizeAngle(
          Math.atan2(ship.position.z - center.z, ship.position.x - center.x) -
            shoreAngle,
        ),
      );
      expect(tangentialAngleDelta).toBeGreaterThan(0.08);

      // Longement rasant (cap tangent à la plage d'ancrage)
      const grazeShip = createSeaShip(
        anchorage.position.x,
        anchorage.position.z,
        anchorage.angle,
        6.0,
      );
      for (let step = 0; step < 90; step++) {
        stepWithCoast(grazeShip, 0.8, 0.25, 1 / 60);
        expect(
          isHullEntirelyOnWater(
            grazeShip.position.x,
            grazeShip.position.z,
            grazeShip.angle,
          ),
        ).toBe(true);
      }
      expect(
        Math.hypot(
          grazeShip.position.x - anchorage.position.x,
          grazeShip.position.z - anchorage.position.z,
        ),
      ).toBeGreaterThan(4.0);
    }
  });
});

describe('Collisions Côtières — Marche Arrière, Pivot 360° & Falaises', () => {
  it('bloque proprement la poupe en marche arrière contre la côte sur les 6 îles', () => {
    const hull = SHIP_PHYSICS_CONFIG.hull;

    for (const islandId of ALL_ISLAND_IDS) {
      const anchorage = getDefaultAnchorageForIsland(islandId);
      const center = getIslandCenter(islandId);
      const outDx = anchorage.position.x - center.x;
      const outDz = anchorage.position.z - center.z;
      const outLen = Math.hypot(outDx, outDz) || 1;
      // Oriente la proue vers le large => poupe face à l'île
      const outwardHeading = headingFromDirection(outDx, outDz);
      const startX = anchorage.position.x + (outDx / outLen) * 3.0;
      const startZ = anchorage.position.z + (outDz / outLen) * 3.0;

      const ship = createSeaShip(startX, startZ, outwardHeading, -3.5);
      let hitStern = false;

      for (let step = 0; step < 120; step++) {
        const res = stepWithCoast(ship, -1, 0, 1 / 60);
        if (res.collided) hitStern = true;

        expect(
          isHullEntirelyOnWater(ship.position.x, ship.position.z, ship.angle),
          `${islandId} reverse step=${step}`,
        ).toBe(true);
        const stern = getHullControlPoints(
          ship.position.x,
          ship.position.z,
          ship.angle,
        ).find((p) => p.tag === 'stern')!;
        expect(getWaterSignedDistance(stern.x, stern.z)).toBeGreaterThanOrEqual(
          hull.safetyMargin - 0.02,
        );
      }

      expect(hitStern).toBe(true);
    }
  });

  it('empêche la proue et la poupe de pénétrer la plage lors d’un pivot complet 360° collé au rivage', () => {
    for (const islandId of ['felingard', 'mountain'] as const) {
      const anchorage = getDefaultAnchorageForIsland(islandId);

      for (const steer of [-1, 1] as const) {
        const ship = createSeaShip(
          anchorage.position.x,
          anchorage.position.z,
          anchorage.angle,
          0,
        );
        let accumulatedTurn = 0;
        let prevAngle = ship.angle;

        for (let step = 0; step < 320; step++) {
          stepWithCoast(ship, 0, steer, 1 / 60);
          accumulatedTurn += Math.abs(normalizeAngle(ship.angle - prevAngle));
          prevAngle = ship.angle;

          expect(
            isHullEntirelyOnWater(ship.position.x, ship.position.z, ship.angle),
            `${islandId} pivot steer=${steer} step=${step}`,
          ).toBe(true);
        }

        expect(accumulatedTurn).toBeGreaterThan(Math.PI * 1.8);
      }
    }
  });

  it('bloque l’accès aux falaises de Griffe-de-Roc et refuse le débarquement', () => {
    const center = getIslandCenter('mountain');
    const cliffAngle = 0; // Face Est = falaise vertigineuse
    const wlR = getIslandWaterlineRadius('mountain', cliffAngle);
    const startX = center.x + wlR + 7.0;
    const startZ = center.z;
    const towardCliff = headingFromDirection(center.x - startX, center.z - startZ);

    const ship = createSeaShip(startX, startZ, towardCliff, 10.0);
    let collided = false;
    for (let step = 0; step < 100; step++) {
      const res = stepWithCoast(ship, 1, 0, 1 / 60);
      if (res.collided) collided = true;
      expect(
        isHullEntirelyOnWater(ship.position.x, ship.position.z, ship.angle),
      ).toBe(true);
    }

    expect(collided).toBe(true);
    const disembark = findSafeDisembarkSpot(
      ship.position.x,
      ship.position.z,
      ship.angle,
    );
    expect(disembark.canDisembark).toBe(false);
    expect(disembark.reason).toBe('inaccessible_cliff');
  });
});

describe('Collisions Côtières — Anti-Tunneling, Détroit Étroit & Bornes Océaniques', () => {
  it('empêche tout tunneling à vitesse extrême + dt max (0.05 s) vers la plus petite île (archipelago)', () => {
    const center = getIslandCenter('archipelago');
    const wlR = getIslandWaterlineRadius('archipelago', Math.PI * 0.5);
    const startX = center.x;
    const startZ = center.z + wlR + 5.0;
    const towardNorth = headingFromDirection(0, -1);

    // Injecte une vitesse extrême (2.5x V_max) avec dt maximal 0.05 s
    const ship = createSeaShip(startX, startZ, towardNorth, 34.0);
    for (let step = 0; step < 40; step++) {
      stepWithCoast(ship, 1, 0, 0.05);
      expect(
        isHullEntirelyOnWater(ship.position.x, ship.position.z, ship.angle),
      ).toBe(true);
      // Ne doit JAMAIS avoir traversé le centre vers le Nord de l'île
      expect(ship.position.z).toBeGreaterThan(center.z);
    }
  });

  it('permet de traverser le détroit étroit entre Griffe-de-Roc (mountain) et Archipel des Moustaches (archipelago)', () => {
    const mCenter = getIslandCenter('mountain');
    const aCenter = getIslandCenter('archipelago');
    // Point médian du détroit entre les deux côtes (pondéré par les rayons 26 vs 18)
    const tMid = 18 / (18 + 26);
    const midX = aCenter.x + (mCenter.x - aCenter.x) * tMid;
    const midZ = aCenter.z + (mCenter.z - aCenter.z) * tMid;

    // Direction du chenal perpendiculaire à l'axe mountain <-> archipelago (du Sud-Est vers le Nord-Ouest)
    const axisX = mCenter.x - aCenter.x;
    const axisZ = mCenter.z - aCenter.z;
    const axisLen = Math.hypot(axisX, axisZ);
    const channelDirX = -axisZ / axisLen;
    const channelDirZ = axisX / axisLen;
    // Choisit le sens vers le Nord (-Z)
    const dirSign = channelDirZ < 0 ? 1 : -1;
    const dirX = channelDirX * dirSign;
    const dirZ = channelDirZ * dirSign;

    const startX = midX - dirX * 26;
    const startZ = midZ - dirZ * 26;
    const heading = headingFromDirection(dirX, dirZ);
    expect(isHullEntirelyOnWater(startX, startZ, heading)).toBe(true);

    const ship = createSeaShip(startX, startZ, heading, 8.0);
    for (let step = 0; step < 300; step++) {
      stepWithCoast(ship, 1, 0, 1 / 60);
      expect(
        isHullEntirelyOnWater(ship.position.x, ship.position.z, ship.angle),
      ).toBe(true);
    }

    // Doit avoir franchi le point médian du détroit d'au moins 15 u au-delà
    const progressPastMid =
      (ship.position.x - midX) * dirX + (ship.position.z - midZ) * dirZ;
    expect(progressPastMid).toBeGreaterThan(15);
  });

  it('retient doucement le bateau dans les limites extérieures de l’océan (±152 u) dans les 8 directions', () => {
    const limit = SHIP_PHYSICS_CONFIG.oceanBoundaryLimit;
    const directions: ReadonlyArray<readonly [number, number]> = [
      [0, -1],
      [0, 1],
      [1, 0],
      [-1, 0],
      [1, -1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ];

    for (const [dx, dz] of directions) {
      const len = Math.hypot(dx, dz);
      const ux = dx / len;
      const uz = dz / len;
      const heading = headingFromDirection(ux, uz);
      // Départ à 138 u dans la direction cible (en mer libre loin des îles)
      const ship = createSeaShip(
        ux * 138,
        uz * 138,
        heading,
        SHIP_PHYSICS_CONFIG.maxForwardSpeed,
      );

      for (let step = 0; step < 180; step++) {
        stepWithCoast(ship, 1, 0, 1 / 60);
        const pts = getHullControlPoints(
          ship.position.x,
          ship.position.z,
          ship.angle,
        );
        for (const pt of pts) {
          expect(Math.abs(pt.x)).toBeLessThanOrEqual(limit);
          expect(Math.abs(pt.z)).toBeLessThanOrEqual(limit);
        }
      }
    }
  });
});
