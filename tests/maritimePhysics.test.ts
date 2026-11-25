import { describe, expect, it } from 'vitest';
import {
  SHIP_PHYSICS_CONFIG,
  computeTurnSpeedFactor,
  evaluateParabolicJump,
  getShipForward,
  getShipLeft,
  getShipRight,
  headingFromDirection,
  mapInputStateToShipControls,
  shipLocalToWorld,
  stepShipPhysics,
  updateShipIdleBobbing,
  type ShipPhysicsState,
} from '../src/game/shipPhysics';
import { normalizeAngle } from '../src/game/math';

function createOpenSeaShip(
  overrides: Partial<ShipPhysicsState> = {},
): ShipPhysicsState {
  return {
    position: { x: 0, z: 0 },
    angle: 0,
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
    nearestCoastIslandId: null,
    ...overrides,
  };
}

describe('Physique Maritime — Convention Géométrique Canonique (Section 16.A)', () => {
  it('respecte Proue = -Z, Poupe = +Z, Tribord = +X, Bâbord = -X et rotation Three.js +Y', () => {
    // angle = 0 -> Nord (-Z), tribord = Est (+X), bâbord = Ouest (-X)
    expect(getShipForward(0).x).toBeCloseTo(0, 6);
    expect(getShipForward(0).z).toBeCloseTo(-1, 6);
    expect(getShipRight(0).x).toBeCloseTo(1, 6);
    expect(getShipRight(0).z).toBeCloseTo(0, 6);
    expect(getShipLeft(0).x).toBeCloseTo(-1, 6);
    expect(getShipLeft(0).z).toBeCloseTo(0, 6);

    // angle = +π/2 (90° CCW vu du dessus) -> Ouest (-X)
    expect(getShipForward(Math.PI / 2).x).toBeCloseTo(-1, 6);
    expect(getShipForward(Math.PI / 2).z).toBeCloseTo(0, 6);
    expect(getShipRight(Math.PI / 2).x).toBeCloseTo(0, 6);
    expect(getShipRight(Math.PI / 2).z).toBeCloseTo(-1, 6);

    // angle = -π/2 (90° CW vu du dessus) -> Est (+X)
    expect(getShipForward(-Math.PI / 2).x).toBeCloseTo(1, 6);
    expect(getShipForward(-Math.PI / 2).z).toBeCloseTo(0, 6);

    // angle = π -> Sud (+Z)
    expect(getShipForward(Math.PI).x).toBeCloseTo(0, 6);
    expect(getShipForward(Math.PI).z).toBeCloseTo(1, 6);

    // Round-trip headingFromDirection ↔ getShipForward sur 8 caps
    for (let k = 0; k < 8; k++) {
      const a = normalizeAngle((k / 8) * Math.PI * 2);
      const fwd = getShipForward(a);
      const recovered = headingFromDirection(fwd.x, fwd.z);
      expect(Math.abs(normalizeAngle(recovered - a))).toBeLessThan(1e-6);

      // shipLocalToWorld : proue (0, -L) = center + forward * L ; tribord (+W, 0) = center + right * W
      const bow = shipLocalToWorld(10, -5, a, 0, -2.5);
      expect(bow.x).toBeCloseTo(10 + fwd.x * 2.5, 6);
      expect(bow.z).toBeCloseTo(-5 + fwd.z * 2.5, 6);

      const right = getShipRight(a);
      const star = shipLocalToWorld(10, -5, a, 1.4, 0);
      expect(star.x).toBeCloseTo(10 + right.x * 1.4, 6);
      expect(star.z).toBeCloseTo(-5 + right.z * 1.4, 6);
    }
  });

  it('aligne strictement le déplacement avant sur forward(angle) sur 8 caps sans dérive latérale', () => {
    for (let k = 0; k < 8; k++) {
      const heading = normalizeAngle((k / 8) * Math.PI * 2);
      const ship = createOpenSeaShip({ angle: heading });

      for (let i = 0; i < 60; i++) {
        stepShipPhysics(ship, { throttle: 1, steer: 0 }, 1 / 60);
      }

      const fwd = getShipForward(heading);
      const distMoved = Math.hypot(ship.position.x, ship.position.z);
      expect(distMoved).toBeGreaterThan(2.0);
      const dirX = ship.position.x / distMoved;
      const dirZ = ship.position.z / distMoved;
      const alignment = dirX * fwd.x + dirZ * fwd.z;
      expect(alignment).toBeGreaterThan(0.99999);

      // Composante latérale rigoureusement nulle
      const right = getShipRight(heading);
      const lateral = Math.abs(ship.vx * right.x + ship.vz * right.z);
      expect(lateral).toBeLessThan(1e-6);
    }
  });

  it('convertit InputState en commandes navales sans perte en diagonale (Z+Q / Z+D)', () => {
    expect(mapInputStateToShipControls({ moveX: 0, moveZ: -1 })).toEqual({
      throttle: 1,
      steer: 0,
    });
    expect(mapInputStateToShipControls({ moveX: 0, moveZ: 1 })).toEqual({
      throttle: -1,
      steer: 0,
    });
    const steerLeftOnly = mapInputStateToShipControls({ moveX: -1, moveZ: 0 });
    expect(steerLeftOnly.throttle).toBeCloseTo(0, 6);
    expect(steerLeftOnly.steer).toBe(-1);

    const steerRightOnly = mapInputStateToShipControls({ moveX: 1, moveZ: 0 });
    expect(steerRightOnly.throttle).toBeCloseTo(0, 6);
    expect(steerRightOnly.steer).toBe(1);

    // Diagonale normalisée par InputManager -> récupère 100 % throttle + 100 % steer
    const diagLeft = mapInputStateToShipControls({
      moveX: -Math.SQRT1_2,
      moveZ: -Math.SQRT1_2,
    });
    expect(diagLeft.throttle).toBeCloseTo(1, 5);
    expect(diagLeft.steer).toBeCloseTo(-1, 5);

    const diagRight = mapInputStateToShipControls({
      moveX: Math.SQRT1_2,
      moveZ: -Math.SQRT1_2,
    });
    expect(diagRight.throttle).toBeCloseTo(1, 5);
    expect(diagRight.steer).toBeCloseTo(1, 5);
  });
});

describe('Physique Maritime — Accélération, Freinage, Marche Arrière & Glisse', () => {
  it('accélère progressivement (jamais instantanément) et respecte le plafond maxForwardSpeed', () => {
    const ship = createOpenSeaShip();
    let prevSpeed = 0;

    // 1re frame : accélération douce, très loin de maxForwardSpeed
    stepShipPhysics(ship, { throttle: 1, steer: 0 }, 1 / 60);
    expect(ship.speed).toBeGreaterThan(0);
    expect(ship.speed).toBeLessThan(SHIP_PHYSICS_CONFIG.maxForwardSpeed * 0.1);
    prevSpeed = ship.speed;

    // 6 secondes plein gaz -> progression monotone puis stabilisation sous le plafond
    for (let i = 0; i < 360; i++) {
      stepShipPhysics(ship, { throttle: 1, steer: 0 }, 1 / 60);
      expect(ship.speed).toBeGreaterThanOrEqual(prevSpeed - 1e-6);
      expect(ship.speed).toBeLessThanOrEqual(
        SHIP_PHYSICS_CONFIG.maxForwardSpeed + 1e-6,
      );
      prevSpeed = ship.speed;
    }

    // Atteint une vitesse de croisière élevée (> 80 % de V_max)
    expect(ship.speed).toBeGreaterThan(SHIP_PHYSICS_CONFIG.maxForwardSpeed * 0.8);
  });

  it('freine jusqu’à 0 avec pause reverseEngageDelaySec avant d’enclencher la marche arrière', () => {
    const ship = createOpenSeaShip({ speed: 10.0 });
    const coastShip = createOpenSeaShip({ speed: 10.0 });

    // Vérifie que le freinage décélère nettement plus vite que la simple glisse
    for (let i = 0; i < 10; i++) {
      stepShipPhysics(ship, { throttle: -1, steer: 0 }, 1 / 60);
      stepShipPhysics(coastShip, { throttle: 0, steer: 0 }, 1 / 60);
    }
    expect(ship.speed).toBeLessThan(coastShip.speed - 1.0);
    expect(ship.speed).toBeGreaterThan(0);

    // Continue à freiner jusqu'à atteindre 0 : ne doit JAMAIS sauter directement en négatif
    let hitZero = false;
    let zeroHoldFrames = 0;
    let reversed = false;
    for (let i = 0; i < 240; i++) {
      const before = ship.speed;
      stepShipPhysics(ship, { throttle: -1, steer: 0 }, 1 / 60);
      if (before > 0) {
        expect(ship.speed).toBeGreaterThanOrEqual(0);
      }
      if (ship.speed === 0) {
        hitZero = true;
        zeroHoldFrames++;
      }
      if (ship.speed < 0) {
        reversed = true;
        break;
      }
    }

    expect(hitZero).toBe(true);
    // Doit maintenir v = 0 sur la durée reverseEngageDelaySec (~0.18s => ~10 frames à 60 Hz)
    expect(zeroHoldFrames).toBeGreaterThanOrEqual(8);
    expect(reversed).toBe(true);

    // Maintient la marche arrière 3 s -> plafonnée à -maxReverseSpeed (< maxForwardSpeed)
    for (let i = 0; i < 180; i++) {
      stepShipPhysics(ship, { throttle: -1, steer: 0 }, 1 / 60);
      expect(ship.speed).toBeGreaterThanOrEqual(
        -SHIP_PHYSICS_CONFIG.maxReverseSpeed - 1e-6,
      );
      expect(ship.speed).toBeLessThanOrEqual(0);
    }
    expect(ship.speed).toBeLessThan(-2.5);
    expect(SHIP_PHYSICS_CONFIG.maxReverseSpeed).toBeLessThan(
      SHIP_PHYSICS_CONFIG.maxForwardSpeed,
    );
  });

  it('glisse naturellement par inertie quand les gaz sont relâchés jusqu’à l’arrêt complet', () => {
    const ship = createOpenSeaShip({ speed: 10.0 });
    const startZ = ship.position.z;

    let prev = ship.speed;
    for (let i = 0; i < 60; i++) {
      stepShipPhysics(ship, { throttle: 0, steer: 0 }, 1 / 60);
      expect(ship.speed).toBeLessThanOrEqual(prev);
      prev = ship.speed;
    }

    // A continué à glisser vers -Z tout en ralentissant
    expect(ship.position.z).toBeLessThan(startZ - 4.0);
    expect(ship.speed).toBeGreaterThan(1.0);
    expect(ship.speed).toBeLessThan(8.5);

    // Fin de glisse -> s'arrête proprement à 0
    for (let i = 0; i < 600; i++) {
      stepShipPhysics(ship, { throttle: 0, steer: 0 }, 1 / 60);
    }
    expect(ship.speed).toBe(0);
    expect(Math.abs(ship.vx)).toBe(0);
    expect(Math.abs(ship.vz)).toBe(0);
    expect(ship.wakeIntensity).toBe(0);
  });
});

describe('Physique Maritime — Gouvernail & Convention Gauche / Droite', () => {
  it('tourne strictement à bâbord (angle > 0, CCW) pour steer = -1 et à tribord (angle < 0, CW) pour steer = +1', () => {
    const shipLeft = createOpenSeaShip({ angle: 0, speed: 6.0 });
    for (let i = 0; i < 30; i++) {
      stepShipPhysics(shipLeft, { throttle: 1, steer: -1 }, 1 / 60);
    }
    expect(shipLeft.rudder).toBeLessThan(-0.5);
    expect(shipLeft.angularVelocity).toBeGreaterThan(0.5);
    expect(shipLeft.angle).toBeGreaterThan(0.2);
    // Depuis Nord (0, -1), tourner à gauche amène vers Ouest (-X)
    expect(getShipForward(shipLeft.angle).x).toBeLessThan(-0.15);

    const shipRight = createOpenSeaShip({ angle: 0, speed: 6.0 });
    for (let i = 0; i < 30; i++) {
      stepShipPhysics(shipRight, { throttle: 1, steer: 1 }, 1 / 60);
    }
    expect(shipRight.rudder).toBeGreaterThan(0.5);
    expect(shipRight.angularVelocity).toBeLessThan(-0.5);
    expect(shipRight.angle).toBeLessThan(-0.2);
    // Depuis Nord (0, -1), tourner à droite amène vers Est (+X)
    expect(getShipForward(shipRight.angle).x).toBeGreaterThan(0.15);
  });

  it('reste manœuvrable à l’arrêt, atteint sa meilleure maniabilité à mi-vitesse et recentre le gouvernail au relâchement', () => {
    const idleFactor = computeTurnSpeedFactor(0);
    const midFactor = computeTurnSpeedFactor(
      SHIP_PHYSICS_CONFIG.maxForwardSpeed *
        SHIP_PHYSICS_CONFIG.optimalTurnSpeedRatio,
    );
    const topFactor = computeTurnSpeedFactor(SHIP_PHYSICS_CONFIG.maxForwardSpeed);

    expect(idleFactor).toBeGreaterThan(0.4);
    expect(midFactor).toBeGreaterThan(idleFactor);
    expect(midFactor).toBeGreaterThan(topFactor);

    // Pivot à l'arrêt
    const parkedPivot = createOpenSeaShip({ speed: 0 });
    for (let i = 0; i < 45; i++) {
      stepShipPhysics(parkedPivot, { throttle: 0, steer: -1 }, 1 / 60);
    }
    expect(parkedPivot.angle).toBeGreaterThan(0.5);
    expect(parkedPivot.speed).toBe(0);

    // Relâchement -> recentrage gouvernail + amortissement vitesse angulaire
    for (let i = 0; i < 90; i++) {
      stepShipPhysics(parkedPivot, { throttle: 0, steer: 0 }, 1 / 60);
    }
    expect(parkedPivot.rudder).toBe(0);
    expect(parkedPivot.angularVelocity).toBe(0);
  });
});

describe('Physique Maritime — Stabilité Multi-Fréquence (30/60/120 Hz), Spikes & Assiette', () => {
  it('produit une trajectoire quasi-identique à 30 Hz, 60 Hz et 120 Hz', () => {
    const runAtHz = (hz: number) => {
      const ship = createOpenSeaShip();
      const dt = 1 / hz;
      // 2 s accélération droite + 1.5 s virage gauche + 1.5 s glisse
      for (let i = 0; i < Math.round(2.0 * hz); i++) {
        stepShipPhysics(ship, { throttle: 1, steer: 0 }, dt);
      }
      for (let i = 0; i < Math.round(1.5 * hz); i++) {
        stepShipPhysics(ship, { throttle: 1, steer: -1 }, dt);
      }
      for (let i = 0; i < Math.round(1.5 * hz); i++) {
        stepShipPhysics(ship, { throttle: 0, steer: 0 }, dt);
      }
      return ship;
    };

    const s30 = runAtHz(30);
    const s60 = runAtHz(60);
    const s120 = runAtHz(120);

    expect(
      Math.hypot(s30.position.x - s120.position.x, s30.position.z - s120.position.z),
    ).toBeLessThan(0.25);
    expect(
      Math.hypot(s60.position.x - s120.position.x, s60.position.z - s120.position.z),
    ).toBeLessThan(0.15);
    expect(Math.abs(normalizeAngle(s30.angle - s120.angle))).toBeLessThan(0.03);
    expect(Math.abs(s30.speed - s120.speed)).toBeLessThan(0.15);
  });

  it('résiste aux spikes de dt, dt <= 0, NaN/Infinity et évalue proprement le saut parabolique', () => {
    const ship = createOpenSeaShip();
    for (const badDt of [0, -0.05, Number.NaN, Number.POSITIVE_INFINITY, 0.25, 2.5]) {
      const res = stepShipPhysics(ship, { throttle: 1, steer: -1 }, badDt);
      expect(Number.isFinite(ship.position.x)).toBe(true);
      expect(Number.isFinite(ship.position.z)).toBe(true);
      expect(Number.isFinite(ship.angle)).toBe(true);
      expect(Number.isFinite(ship.speed)).toBe(true);
      expect(Number.isFinite(ship.roll)).toBe(true);
      expect(Number.isFinite(ship.pitch)).toBe(true);
      expect(Number.isFinite(res.vx)).toBe(true);
      expect(Number.isFinite(res.vz)).toBe(true);
    }

    // Assainissement de champs corrompus + idle bobbing
    ship.angle = Number.NaN;
    ship.speed = Number.POSITIVE_INFINITY;
    ship.rudder = Number.NaN;
    stepShipPhysics(ship, { throttle: 0, steer: 0 }, 1 / 60);
    expect(Number.isFinite(ship.angle)).toBe(true);
    expect(Number.isFinite(ship.speed)).toBe(true);
    expect(Number.isFinite(ship.rudder)).toBe(true);

    updateShipIdleBobbing(ship, 0.05);
    expect(ship.speed).toBe(0);
    expect(ship.wakeIntensity).toBe(0);
    expect(Number.isFinite(ship.bobY)).toBe(true);

    // Saut parabolique exact
    const p0 = evaluateParabolicJump({ x: 0, z: 0 }, { x: 4, z: 2 }, 0, 0.5, 1.5, 0);
    const pMid = evaluateParabolicJump({ x: 0, z: 0 }, { x: 4, z: 2 }, 0, 0.5, 1.5, 0.5);
    const p1 = evaluateParabolicJump({ x: 0, z: 0 }, { x: 4, z: 2 }, 0, 0.5, 1.5, 1);
    expect(p0).toEqual({ x: 0, y: 0, z: 0 });
    expect(pMid.x).toBeCloseTo(2, 6);
    expect(pMid.z).toBeCloseTo(1, 6);
    expect(pMid.y).toBeCloseTo(0.25 + 1.5, 6);
    expect(p1).toEqual({ x: 4, y: 0.5, z: 2 });
  });
});
