// ============================================================================
// Physique Maritime — Les Chroniques de Félingard
// Simulation pure TypeScript (ZÉRO import Three.js, ZÉRO référence DOM).
//
// Convention géométrique canonique partagée avec le rendu 3D Three.js :
//   - Repère local bateau : Proue = -Z, Poupe = +Z, Tribord = +X, Bâbord = -X, Haut = +Y
//   - Rotation monde      : rotation.order = 'YXZ', rotation.y = ship.angle (main droite)
//   - forward(angle)      = (-sin(angle), -cos(angle))
//   - right(angle)        = (+cos(angle), -sin(angle))
//   - left(angle)         = (-cos(angle), +sin(angle))
//   - Tourner à gauche (Q/A/ArrowLeft, steer = -1) => angularVelocity > 0 (CCW vu du dessus)
//   - Tourner à droite (D/ArrowRight,  steer = +1) => angularVelocity < 0 (CW  vu du dessus)
//   - Avancer          (Z/W/ArrowUp,   throttle = +1) => vitesse longitudinale > 0 dans forward
//   - Frein / Arrière  (S/ArrowDown,   throttle = -1) => freinage progressif à 0 puis marche arrière
// ============================================================================

import { TWO_PI, clamp, lerp, normalizeAngle } from './math';
import type { InputState, IslandId, ShipState, Vec2 } from './types';

// --- Constantes spatiales partagées entre simulation et rendu 3D ---

/** Niveau vertical de la surface de l'océan (identique à worldRenderer.ts) */
export const WATER_LEVEL_Y = -0.14;

/** Hauteur du pont principal au-dessus de WATER_LEVEL_Y (soit y = 0.42 au calme) */
export const SHIP_DECK_HEIGHT_Y = 0.56;

/** Ancrage local du héros sur le pont du voilier (right: +X tribord, aft: +Z poupe) */
export const SHIP_HERO_DECK_LOCAL = {
  right: 0.0,
  aft: 0.55,
  y: SHIP_DECK_HEIGHT_Y,
} as const;

/** Ancrage local de Miaou-sprit sur le pont du voilier */
export const SHIP_COMPANION_DECK_LOCAL = {
  right: -0.82,
  aft: 1.25,
  y: 0.70,
} as const;

/**
 * Distance maximale centre-bateau ↔ joueur sur la plage pour embarquer.
 * Un joueur marchable s'arrête à R_coast - 2.42 tandis qu'un navire légalement
 * sur l'eau a son centre à R_coast + 3.0..3.6 (écart 5.4–6.0 u) : 8.4 u garantit
 * un embarquement confortable et fiable depuis toute plage praticable.
 */
export const SHIP_BOARDING_RADIUS = 8.4;

/** Distance minimale maximale entre la coque et la ligne d'eau pour débarquer */
export const DISEMBARK_MAX_WATER_DIST = 5.5;

// --- Configuration centralisée de la physique maritime ---

export interface ShipHullConfig {
  /** Demi-longueur de la coque (centre → proue/poupe, couvre le beaupré) */
  halfLength: number;
  /** Demi-largeur au maître-bau (centre → bâbord/tribord) */
  halfWidth: number;
  /** Rétrécissement des épaules avant (0..1) */
  bowTaper: number;
  /** Rétrécissement des coins arrière (0..1) */
  sternTaper: number;
  /** Marge de sécurité entre la coque et la ligne d'eau (zéro clipping) */
  safetyMargin: number;
}

export interface ShipPhysicsConfig {
  // Pas fixe interne & protection anti-tunneling
  fixedSubstepSec: number;
  maxFrameDtSec: number;
  maxSubstepDisplacement: number;

  // Propulsion longitudinale, freinage & marche arrière progressive
  maxForwardSpeed: number;
  maxReverseSpeed: number;
  forwardAcceleration: number;
  reverseAcceleration: number;
  brakeDeceleration: number;
  reverseEngageDelaySec: number;
  stopSpeedEpsilon: number;

  // Hydrodynamique & glisse naturelle par inertie
  linearWaterDrag: number;
  quadraticWaterDrag: number;
  coastLinearDrag: number;
  turnSpeedDragFactor: number;

  // Gouvernail & dynamique de virage
  maxTurnRateRad: number;
  lowSpeedTurnFactor: number;
  optimalTurnSpeedRatio: number;
  highSpeedTurnFactor: number;
  reverseTurnFactor: number;
  rudderResponseRate: number;
  rudderCenteringRate: number;
  angularAccelRate: number;
  angularDampingRate: number;
  invertSteerInReverse: boolean;

  // Assiette visuelle (gîte, tangage, houle)
  maxRollRad: number;
  rollResponseRate: number;
  maxPitchRad: number;
  pitchResponseRate: number;
  bobAmplitude: number;
  bobFrequencyRad: number;
  speedBobSuppression: number;

  // Dimensions de coque, glisse côtière & limites de l'océan
  hull: ShipHullConfig;
  collisionSpeedDamping: number;
  coastSlideFriction: number;
  collisionAngularBounce: number;
  maxCollisionResolveIterations: number;
  oceanBoundaryLimit: number;
  oceanBoundarySoftZone: number;
}

export const SHIP_PHYSICS_CONFIG: Readonly<ShipPhysicsConfig> = Object.freeze({
  fixedSubstepSec: 1 / 120,
  maxFrameDtSec: 0.05,
  maxSubstepDisplacement: 0.30,

  maxForwardSpeed: 13.5,
  maxReverseSpeed: 4.2,
  forwardAcceleration: 9.5,
  reverseAcceleration: 5.0,
  brakeDeceleration: 16.0,
  reverseEngageDelaySec: 0.18,
  stopSpeedEpsilon: 0.06,

  linearWaterDrag: 0.24,
  quadraticWaterDrag: 0.034,
  coastLinearDrag: 0.52,
  turnSpeedDragFactor: 0.22,

  maxTurnRateRad: 2.25,
  lowSpeedTurnFactor: 0.62,
  optimalTurnSpeedRatio: 0.55,
  highSpeedTurnFactor: 0.86,
  reverseTurnFactor: 0.68,
  rudderResponseRate: 9.5,
  rudderCenteringRate: 11.0,
  angularAccelRate: 8.5,
  angularDampingRate: 9.0,
  invertSteerInReverse: false,

  maxRollRad: 0.18,
  rollResponseRate: 6.5,
  maxPitchRad: 0.09,
  pitchResponseRate: 5.5,
  bobAmplitude: 0.075,
  bobFrequencyRad: 2.15,
  speedBobSuppression: 0.35,

  hull: Object.freeze({
    halfLength: 2.55,
    halfWidth: 1.40,
    bowTaper: 0.44,
    sternTaper: 0.74,
    safetyMargin: 0.45,
  }),

  collisionSpeedDamping: 0.78,
  coastSlideFriction: 0.12,
  collisionAngularBounce: 0.35,
  maxCollisionResolveIterations: 4,
  oceanBoundaryLimit: 152,
  oceanBoundarySoftZone: 6.0,
});

// --- Types d'entrée, état minimal de simulation & résolution côtière ---

export interface ShipControlInput {
  /** [-1..+1] : +1 avancer (Z/W/Up), -1 freiner / marche arrière (S/Down) */
  throttle: number;
  /** [-1..+1] : -1 gauche / bâbord (Q/A/Left), +1 droite / tribord (D/Right) */
  steer: number;
}

export type ShipPhysicsState = Pick<
  ShipState,
  | 'position'
  | 'angle'
  | 'vx'
  | 'vz'
  | 'speed'
  | 'angularVelocity'
  | 'rudder'
  | 'roll'
  | 'pitch'
  | 'bobPhase'
  | 'bobY'
  | 'wakeIntensity'
  | 'reverseEngageTimer'
  | 'isCollidingShore'
  | 'nearestCoastIslandId'
>;

export interface ShipCoastCollisionResolution {
  x: number;
  z: number;
  angle: number;
  speed: number;
  angularVelocity: number;
  collided: boolean;
  impactIntensity: number;
  nearestIslandId: IslandId | null;
}

export type ShipCoastCollisionResolver = (
  x: number,
  z: number,
  angle: number,
  speed: number,
  angularVelocity: number,
  config: ShipPhysicsConfig,
  substepDt: number,
) => ShipCoastCollisionResolution;

export interface ShipPhysicsStepResult {
  vx: number;
  vz: number;
  collided: boolean;
  impactIntensity: number;
  nearestIslandId: IslandId | null;
  substeps: number;
}

export interface WorldPoint3D {
  x: number;
  y: number;
  z: number;
}

// --- Helpers géométriques canoniques Three.js (Proue = -Z, Tribord = +X) ---

/** Vecteur unitaire de la proue dans le plan (x, z) pour une rotation Three.js `rotation.y = angle`. */
export function getShipForward(angle: number): Vec2 {
  return {
    x: -Math.sin(angle),
    z: -Math.cos(angle),
  };
}

/** Vecteur unitaire tribord (droite du navire) dans le plan (x, z). */
export function getShipRight(angle: number): Vec2 {
  return {
    x: Math.cos(angle),
    z: -Math.sin(angle),
  };
}

/** Vecteur unitaire bâbord (gauche du navire) dans le plan (x, z). */
export function getShipLeft(angle: number): Vec2 {
  return {
    x: -Math.cos(angle),
    z: Math.sin(angle),
  };
}

/**
 * Calcule le cap canonique `angle` (rotation.y Three.js) tel que `getShipForward(angle)`
 * pointe dans la direction (dx, dz).
 */
export function headingFromDirection(dx: number, dz: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return 0;
  if (Math.hypot(dx, dz) < 1e-8) return 0;
  return normalizeAngle(Math.atan2(-dx, -dz));
}

/**
 * Transforme des coordonnées locales du navire (`localRightX` = +X tribord, `localAftZ` = +Z poupe)
 * vers le plan monde (x, z) en appliquant exactement la matrice Three.js R_y(angle).
 */
export function shipLocalToWorld(
  x: number,
  z: number,
  angle: number,
  localRightX: number,
  localAftZ: number,
): Vec2 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: x + localRightX * cos + localAftZ * sin,
    z: z - localRightX * sin + localAftZ * cos,
  };
}

/**
 * Calcule la position monde 3D d'un point ancré sur le pont (héros ou compagnon).
 */
export function getShipDeckWorldAnchor(
  ship: Pick<ShipState, 'position' | 'angle' | 'bobY'>,
  localAnchor: { readonly right: number; readonly aft: number; readonly y: number },
): WorldPoint3D {
  const xz = shipLocalToWorld(
    ship.position.x,
    ship.position.z,
    ship.angle,
    localAnchor.right,
    localAnchor.aft,
  );
  return {
    x: xz.x,
    y: WATER_LEVEL_Y + ship.bobY + localAnchor.y,
    z: xz.z,
  };
}

/**
 * Évalue un saut parabolique fluide entre deux points 3D (embarquement / débarquement).
 * À t = 0 : (startPos, startY) ; à t = 0.5 : sommet surélevé de +arcHeight ; à t = 1 : (targetPos, targetY).
 */
export function evaluateParabolicJump(
  startPos: Vec2,
  targetPos: Vec2,
  startY: number,
  targetY: number,
  arcHeight: number,
  t: number,
): WorldPoint3D {
  const u = Number.isFinite(t) ? clamp(t, 0, 1) : 0;
  const arc = 4 * arcHeight * u * (1 - u);
  return {
    x: lerp(startPos.x, targetPos.x, u),
    y: lerp(startY, targetY, u) + arc,
    z: lerp(startPos.z, targetPos.z, u),
  };
}

/**
 * Convertit l'état d'entrée générique (`moveX`, `moveZ`) en commandes navales indépendantes
 * (`throttle`, `steer`), en compensant la normalisation circulaire diagonale d'InputManager
 * afin que Z+Q ou Z+D conservent 100 % de poussée et 100 % de braquage.
 */
export function mapInputStateToShipControls(
  input: Pick<InputState, 'moveX' | 'moveZ'>,
): ShipControlInput {
  const rawMx = Number.isFinite(input.moveX) ? clamp(input.moveX, -1, 1) : 0;
  const rawMz = Number.isFinite(input.moveZ) ? clamp(input.moveZ, -1, 1) : 0;
  const mag = Math.hypot(rawMx, rawMz);
  if (mag < 1e-4) {
    return { throttle: 0, steer: 0 };
  }
  const maxComp = Math.max(Math.abs(rawMx), Math.abs(rawMz));
  const expand = maxComp > 1e-6 ? Math.min(Math.SQRT2, mag / maxComp) : 1;
  return {
    steer: clamp(rawMx * expand, -1, 1),
    throttle: clamp(-rawMz * expand, -1, 1),
  };
}

/**
 * Facteur C¹ de maniabilité du gouvernail selon la vitesse longitudinale :
 * - À l'arrêt / très basse vitesse : pivot fluide (lowSpeedTurnFactor = 0.62)
 * - À mi-vitesse (optimalTurnSpeedRatio = 0.55) : virages les plus serrés (1.08×)
 * - À pleine vitesse : stabilité directionnelle naturelle (highSpeedTurnFactor = 0.86)
 * - En marche arrière : rotation maîtrisée (lowSpeedTurnFactor → reverseTurnFactor)
 */
export function computeTurnSpeedFactor(
  speed: number,
  config: ShipPhysicsConfig = SHIP_PHYSICS_CONFIG,
): number {
  if (speed < 0) {
    const revRatio = clamp(-speed / Math.max(config.maxReverseSpeed, 1e-4), 0, 1);
    return lerp(config.lowSpeedTurnFactor, config.reverseTurnFactor, revRatio);
  }
  const ratio = clamp(speed / Math.max(config.maxForwardSpeed, 1e-4), 0, 1);
  const opt = clamp(config.optimalTurnSpeedRatio, 0.05, 0.95);
  if (ratio <= opt) {
    const t = ratio / opt;
    const smooth = t * t * (3 - 2 * t);
    return lerp(config.lowSpeedTurnFactor, 1.08, smooth);
  }
  const t = (ratio - opt) / (1 - opt);
  const smooth = t * t * (3 - 2 * t);
  return lerp(1.08, config.highSpeedTurnFactor, smooth);
}

/**
 * Calcule le bobbing vertical doux du navire à partir de sa phase de houle et de sa vitesse.
 */
function computeBobOffset(
  bobPhase: number,
  speedNorm: number,
  config: ShipPhysicsConfig,
): number {
  const waveAmp = config.bobAmplitude * (1 - config.speedBobSuppression * speedNorm);
  return (
    Math.sin(bobPhase) * waveAmp +
    Math.sin(bobPhase * 1.67 + 0.8) * (waveAmp * 0.35)
  );
}

/**
 * Anime la flottaison douce d'un navire à l'ancre / immobile (mode 'parked')
 * et ramène progressivement gouvernail, gîte, tangage et vitesse à l'équilibre.
 */
export function updateShipIdleBobbing(
  ship: ShipPhysicsState,
  rawDt: number,
  config: ShipPhysicsConfig = SHIP_PHYSICS_CONFIG,
): void {
  const dt = Number.isFinite(rawDt) ? clamp(rawDt, 0, config.maxFrameDtSec) : 0;
  if (dt <= 0) return;

  ship.bobPhase = (ship.bobPhase + config.bobFrequencyRad * dt) % TWO_PI;
  ship.bobY = computeBobOffset(ship.bobPhase, 0, config);

  const settleAlpha = 1 - Math.exp(-config.rollResponseRate * dt);
  const waveRoll = Math.sin(ship.bobPhase * 0.73 + 1.1) * 0.025;
  const wavePitch = Math.cos(ship.bobPhase * 0.91) * 0.015;

  ship.roll += (waveRoll - ship.roll) * settleAlpha;
  ship.pitch += (wavePitch - ship.pitch) * settleAlpha;
  ship.rudder += (0 - ship.rudder) * (1 - Math.exp(-config.rudderCenteringRate * dt));
  if (Math.abs(ship.rudder) < 1e-3) ship.rudder = 0;

  ship.speed = 0;
  ship.angularVelocity = 0;
  ship.vx = 0;
  ship.vz = 0;
  ship.wakeIntensity = 0;
  ship.reverseEngageTimer = 0;
  ship.isCollidingShore = false;
}

/**
 * Avance la simulation physique du voilier sur `rawDt` secondes à pas fixe / sous-steppé.
 *
 * Garanties :
 * - Indépendance au framerate (sous-pas `h <= fixedSubstepSec` et déplacement `<= maxSubstepDisplacement`).
 * - ZÉRO vitesse latérale artificielle en mer libre (`velocity = forward * speed`).
 * - Freinage progressif obligatoire jusqu'à `v = 0` + temporisation `reverseEngageDelaySec`
 *   avant tout passage en marche arrière.
 * - Détection continue de collision côtière à chaque sous-pas si `collisionResolver` est fourni.
 */
export function stepShipPhysics(
  ship: ShipPhysicsState,
  controls: ShipControlInput,
  rawDt: number,
  config: ShipPhysicsConfig = SHIP_PHYSICS_CONFIG,
  collisionResolver?: ShipCoastCollisionResolver,
): ShipPhysicsStepResult {
  const dt = Number.isFinite(rawDt) ? clamp(rawDt, 0, config.maxFrameDtSec) : 0;
  const throttle = Number.isFinite(controls.throttle)
    ? clamp(controls.throttle, -1, 1)
    : 0;
  const steer = Number.isFinite(controls.steer)
    ? clamp(controls.steer, -1, 1)
    : 0;

  // Assainissement défensif de l'état numérique
  if (!Number.isFinite(ship.angle)) ship.angle = 0;
  if (!Number.isFinite(ship.speed)) ship.speed = 0;
  if (!Number.isFinite(ship.angularVelocity)) ship.angularVelocity = 0;
  if (!Number.isFinite(ship.rudder)) ship.rudder = 0;
  if (!Number.isFinite(ship.roll)) ship.roll = 0;
  if (!Number.isFinite(ship.pitch)) ship.pitch = 0;
  if (!Number.isFinite(ship.bobPhase)) ship.bobPhase = 0;
  if (!Number.isFinite(ship.reverseEngageTimer)) ship.reverseEngageTimer = 0;

  if (dt <= 0) {
    const fwd = getShipForward(ship.angle);
    ship.vx = fwd.x * ship.speed;
    ship.vz = fwd.z * ship.speed;
    ship.wakeIntensity = clamp(
      Math.abs(ship.speed) / Math.max(config.maxForwardSpeed, 1e-4),
      0,
      1,
    );
    return {
      vx: ship.vx,
      vz: ship.vz,
      collided: ship.isCollidingShore,
      impactIntensity: 0,
      nearestIslandId: ship.nearestCoastIslandId,
      substeps: 0,
    };
  }

  const upperSpeed =
    Math.abs(ship.speed) +
    Math.max(config.forwardAcceleration, config.brakeDeceleration) * dt;
  const timeSteps = Math.ceil(dt / Math.max(config.fixedSubstepSec, 1e-4));
  const dispSteps = Math.ceil(
    (upperSpeed * dt) / Math.max(config.maxSubstepDisplacement, 0.05),
  );
  const substeps = Math.max(1, timeSteps, dispSteps);
  const h = dt / substeps;

  let anyCollided = false;
  let maxImpactIntensity = 0;
  let nearestIslandId: IslandId | null = ship.nearestCoastIslandId;

  for (let stepIdx = 0; stepIdx < substeps; stepIdx++) {
    const prevSpeed = ship.speed;

    // 1. Gouvernail (filtrage exponentiel fluide)
    const targetRudder = Math.abs(steer) > 0.02 ? steer : 0;
    const rudderRate =
      targetRudder !== 0 ? config.rudderResponseRate : config.rudderCenteringRate;
    const rudderAlpha = 1 - Math.exp(-rudderRate * h);
    ship.rudder += (targetRudder - ship.rudder) * rudderAlpha;
    if (targetRudder === 0 && Math.abs(ship.rudder) < 1e-3) {
      ship.rudder = 0;
    }

    // 2. Dynamique angulaire : Q (steer=-1) => angularVelocity > 0 (gauche / CCW)
    const turnFactor = computeTurnSpeedFactor(ship.speed, config);
    const reverseSign =
      config.invertSteerInReverse && ship.speed < -0.25 ? -1 : 1;
    const targetAngularVelocity =
      -ship.rudder * reverseSign * config.maxTurnRateRad * turnFactor;
    const angRate =
      Math.abs(targetRudder) > 0.02
        ? config.angularAccelRate
        : config.angularDampingRate;
    const angAlpha = 1 - Math.exp(-angRate * h);
    ship.angularVelocity += (targetAngularVelocity - ship.angularVelocity) * angAlpha;
    if (targetRudder === 0 && Math.abs(ship.angularVelocity) < 1e-4) {
      ship.angularVelocity = 0;
    }

    ship.angle = normalizeAngle(ship.angle + ship.angularVelocity * h);

    // 3. Propulsion longitudinale, traînée hydrodynamique & freinage progressif
    const turnNorm = clamp(
      Math.abs(ship.angularVelocity) / Math.max(config.maxTurnRateRad, 1e-4),
      0,
      1,
    );
    const absV = Math.abs(ship.speed);
    const signV = ship.speed > 0 ? 1 : ship.speed < 0 ? -1 : 0;

    if (throttle > 0.05) {
      // Marche avant (ou freinage depuis la marche arrière)
      ship.reverseEngageTimer = 0;
      if (ship.speed < -config.stopSpeedEpsilon) {
        const brakeAccel =
          config.brakeDeceleration * throttle +
          config.linearWaterDrag * absV +
          config.quadraticWaterDrag * absV * absV;
        const nextV = ship.speed + brakeAccel * h;
        ship.speed = nextV > 0 ? 0 : nextV;
      } else {
        const drag =
          config.linearWaterDrag * absV +
          config.quadraticWaterDrag * absV * absV +
          config.turnSpeedDragFactor * absV * turnNorm * turnNorm;
        const netAccel = config.forwardAcceleration * throttle - drag;
        ship.speed = clamp(ship.speed + netAccel * h, 0, config.maxForwardSpeed);
      }
    } else if (throttle < -0.05) {
      // Freinage progressif puis marche arrière après passage obligé par v = 0
      const revInput = -throttle;
      if (ship.speed > config.stopSpeedEpsilon) {
        const brakeDecel =
          config.brakeDeceleration * revInput +
          config.linearWaterDrag * absV +
          config.quadraticWaterDrag * absV * absV;
        const nextV = ship.speed - brakeDecel * h;
        if (nextV <= 0) {
          ship.speed = 0;
          ship.reverseEngageTimer = config.reverseEngageDelaySec;
        } else {
          ship.speed = nextV;
        }
      } else if (ship.reverseEngageTimer > 0) {
        ship.speed = 0;
        ship.reverseEngageTimer = Math.max(0, ship.reverseEngageTimer - h);
      } else {
        const drag =
          config.linearWaterDrag * absV +
          config.quadraticWaterDrag * absV * absV +
          config.turnSpeedDragFactor * absV * turnNorm * turnNorm;
        const netAccel = -config.reverseAcceleration * revInput + drag;
        ship.speed = clamp(ship.speed + netAccel * h, -config.maxReverseSpeed, 0);
      }
    } else {
      // Glisse naturelle par inertie sur l'eau
      ship.reverseEngageTimer = 0;
      if (absV <= config.stopSpeedEpsilon) {
        ship.speed = 0;
      } else {
        const coastDrag =
          config.coastLinearDrag * absV +
          config.quadraticWaterDrag * absV * absV +
          config.turnSpeedDragFactor * absV * turnNorm * turnNorm;
        const nextAbs = absV - coastDrag * h;
        ship.speed =
          nextAbs <= config.stopSpeedEpsilon ? 0 : signV * nextAbs;
      }
    }

    // 4. Intégration purement le long de la quille (ZÉRO vitesse latérale artificielle)
    const forward = getShipForward(ship.angle);
    const nextX = ship.position.x + forward.x * ship.speed * h;
    const nextZ = ship.position.z + forward.z * ship.speed * h;

    // 5. Résolution continue des collisions côtières & limites océan
    if (collisionResolver) {
      const resolved = collisionResolver(
        nextX,
        nextZ,
        ship.angle,
        ship.speed,
        ship.angularVelocity,
        config,
        h,
      );
      ship.position.x = resolved.x;
      ship.position.z = resolved.z;
      ship.angle = normalizeAngle(resolved.angle);
      ship.speed = resolved.speed;
      ship.angularVelocity = resolved.angularVelocity;
      nearestIslandId = resolved.nearestIslandId;
      if (resolved.collided) {
        anyCollided = true;
        if (resolved.impactIntensity > maxImpactIntensity) {
          maxImpactIntensity = resolved.impactIntensity;
        }
      }
    } else {
      ship.position.x = nextX;
      ship.position.z = nextZ;
    }

    // 6. Assiette visuelle (gîte centrifuge en virage, tangage accélération/freinage, bobbing houle)
    const speedNorm = clamp(
      Math.abs(ship.speed) / Math.max(config.maxForwardSpeed, 1e-4),
      0,
      1,
    );
    ship.bobPhase = (ship.bobPhase + config.bobFrequencyRad * h) % TWO_PI;
    ship.bobY = computeBobOffset(ship.bobPhase, speedNorm, config);

    const turnRatio = clamp(
      ship.angularVelocity / Math.max(config.maxTurnRateRad, 1e-4),
      -1,
      1,
    );
    // Virage à gauche (ω > 0) => gîte centrifuge douce vers tribord (roll < 0)
    const waveRoll = Math.sin(ship.bobPhase * 0.73 + 1.1) * 0.025;
    const targetRoll =
      -turnRatio * config.maxRollRad * (0.45 + 0.55 * speedNorm) + waveRoll;
    ship.roll += (targetRoll - ship.roll) * (1 - Math.exp(-config.rollResponseRate * h));

    const longitudinalAccel = (ship.speed - prevSpeed) / Math.max(h, 1e-5);
    const accelNorm = clamp(
      longitudinalAccel / Math.max(config.forwardAcceleration, 1e-4),
      -1,
      1,
    );
    const wavePitch = Math.cos(ship.bobPhase * 0.91) * 0.015;
    const cruiseBowRise =
      ship.speed > 0 ? speedNorm * (config.maxPitchRad * 0.34) : 0;
    const targetPitch =
      clamp(accelNorm * config.maxPitchRad * 0.72 + cruiseBowRise, -config.maxPitchRad, config.maxPitchRad) +
      wavePitch;
    ship.pitch += (targetPitch - ship.pitch) * (1 - Math.exp(-config.pitchResponseRate * h));
  }

  // Synchronisation finale du vecteur vitesse monde & télémétrie
  const finalForward = getShipForward(ship.angle);
  ship.vx = finalForward.x * ship.speed;
  ship.vz = finalForward.z * ship.speed;
  ship.wakeIntensity = clamp(
    Math.abs(ship.speed) / Math.max(config.maxForwardSpeed, 1e-4),
    0,
    1,
  );
  ship.isCollidingShore = anyCollided;
  ship.nearestCoastIslandId = nearestIslandId;

  return {
    vx: ship.vx,
    vz: ship.vz,
    collided: anyCollided,
    impactIntensity: maxImpactIntensity,
    nearestIslandId,
    substeps,
  };
}
