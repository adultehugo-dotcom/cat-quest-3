// ============================================================================
// Navigation Côtière, SDF Multi-Îles, Collisions Coque & Débarquement Sûr
// Source de vérité géométrique unique partagée entre physique et rendu 3D.
// RÈGLE STRICTE : ZÉRO import 'three', ZÉRO dépendance DOM.
// ============================================================================

import {
  OVERWORLD_DATA,
  clampToIsland,
  getIslandRadiusAtAngle,
  isInsideIsland,
} from '../data/worldData';
import {
  ALL_NEW_ISLANDS,
  NEW_ISLANDS,
  clampToNewIsland,
  getNewIslandRadiusAtAngle,
  isInsideNewIsland,
} from '../data/worldIslands';
import { PLAYER_RADIUS } from './combat';
import {
  TWO_PI,
  circleIntersectsAABB,
  clamp,
  dist,
  normalizeAngle,
} from './math';
import {
  DISEMBARK_MAX_WATER_DIST,
  SHIP_BOARDING_RADIUS,
  SHIP_PHYSICS_CONFIG,
  WATER_LEVEL_Y,
  getShipForward,
  getShipLeft,
  headingFromDirection,
  type ShipCoastCollisionResolution,
  type ShipHullConfig,
  type ShipPhysicsConfig,
} from './shipPhysics';
import type {
  CoastKind,
  EnemyInstance,
  IslandId,
  ShipDisembarkStatus,
  Vec2,
  WallRect,
  ZoneId,
} from './types';

// --- Constantes géométriques alignées au millimètre avec worldRenderer & waterShader ---

/** Liste ordonnée de toutes les îles du monde (Félingard + 5 nouvelles îles) */
export const ALL_ISLAND_IDS: readonly IslandId[] = Object.freeze([
  'felingard',
  ...ALL_NEW_ISLANDS,
]);

/** Décalage radial exact de la ligne d'eau (y = -0.14) par rapport à R_coast */
export const WATERLINE_OFFSET = 0.6;

/** Largeur de la pente sableuse côtière (identique à worldRenderer.ts) */
export const TERRAIN_SLOPE_WIDTH = 3.55;

/** Profondeur des fonds marins sous l'océan (identique à worldRenderer.ts) */
export const TERRAIN_SEABED_DEPTH = -1.85;

/** Marge intérieure minimale de marche sur les îles (identique à worldData/worldIslands) */
export const ISLAND_WALKABLE_MARGIN = 1.8;

/** Pente maximale marchable pour un débarquement sûr (~19.3°) */
export const MAX_WALKABLE_SLOPE = 0.35;

/** Tolérance verticale de terrain plat pour débarquer (y ≈ 0) */
export const MAX_DISEMBARK_ELEVATION = 0.2;

/** Demi-largeur angulaire de transition douce falaise ↔ plage (rad) */
const CLIFF_FEATHER_RAD = 0.18;

// --- Profils côtiers (Plages praticables vs Falaises / Roches) ---

export interface BlockedCoastArc {
  /** Début de l'arc bloqué (radians, sens trigonométrique / CCW dans (x, z)) */
  startAngle: number;
  /** Fin de l'arc bloqué (radians ; gère le passage par ±PI) */
  endAngle: number;
  /** Nature de la côte bloquée */
  kind: Exclude<CoastKind, 'beach'>;
  /** Hauteur visuelle/physique du rebord rocheux au-dessus de y = 0 */
  cliffHeight: number;
}

export interface IslandCoastProfile {
  id: IslandId;
  name: string;
  centerX: number;
  centerZ: number;
  baseRadius: number;
  /** Angle polaire d'une plage ouverte servant de mouillage sûr par défaut */
  defaultAnchorageAngle: number;
  /** Secteurs angulaires escarpés / rocheux où le débarquement est impossible */
  blockedArcs: readonly BlockedCoastArc[];
}

export const ISLAND_COAST_PROFILES: Readonly<Record<IslandId, IslandCoastProfile>> =
  Object.freeze({
    felingard: Object.freeze({
      id: 'felingard',
      name: 'Félingard',
      centerX: 0,
      centerZ: 0,
      baseRadius: 52.5,
      // Plage Sud directement sous Miaou-bourg (allée dégagée sans ennemi ni arbre)
      defaultAnchorageAngle: Math.PI * 0.5,
      // Escarpement glacé au Nord-Nord-Est derrière l'Antre du Dragon-Griffe
      blockedArcs: Object.freeze([
        Object.freeze({
          startAngle: -1.78,
          endAngle: -1.08,
          kind: 'cliff' as const,
          cliffHeight: 2.35,
        }),
      ]),
    }),
    tropical: Object.freeze({
      id: 'tropical',
      name: NEW_ISLANDS.tropical.name,
      centerX: NEW_ISLANDS.tropical.centerX,
      centerZ: NEW_ISLANDS.tropical.centerZ,
      baseRadius: NEW_ISLANDS.tropical.radius,
      // Plage OSO face à Félingard
      defaultAnchorageAngle: -2.66,
      blockedArcs: Object.freeze([]),
    }),
    mountain: Object.freeze({
      id: 'mountain',
      name: NEW_ISLANDS.mountain.name,
      centerX: NEW_ISLANDS.mountain.centerX,
      centerZ: NEW_ISLANDS.mountain.centerZ,
      baseRadius: NEW_ISLANDS.mountain.radius,
      // Crique Sud-Ouest praticable face à Félingard (hors falaises Nord/Est/SE)
      defaultAnchorageAngle: 2.3,
      // Falaises vertigineuses couvrant ~223° sur les faces N, E et SE
      blockedArcs: Object.freeze([
        Object.freeze({
          startAngle: -2.45,
          endAngle: 1.45,
          kind: 'cliff' as const,
          cliffHeight: 3.1,
        }),
      ]),
    }),
    mystic: Object.freeze({
      id: 'mystic',
      name: NEW_ISLANDS.mystic.name,
      centerX: NEW_ISLANDS.mystic.centerX,
      centerZ: NEW_ISLANDS.mystic.centerZ,
      baseRadius: NEW_ISLANDS.mystic.radius,
      // Plage NE face à Félingard
      defaultAnchorageAngle: -0.64,
      // Récif rocheux à l'arrière Sud-Ouest
      blockedArcs: Object.freeze([
        Object.freeze({
          startAngle: 1.85,
          endAngle: 2.85,
          kind: 'rocks' as const,
          cliffHeight: 2.0,
        }),
      ]),
    }),
    wild: Object.freeze({
      id: 'wild',
      name: NEW_ISLANDS.wild.name,
      centerX: NEW_ISLANDS.wild.centerX,
      centerZ: NEW_ISLANDS.wild.centerZ,
      baseRadius: NEW_ISLANDS.wild.radius,
      // Plage SE face à Félingard
      defaultAnchorageAngle: 0.67,
      // Promontoire rocheux à l'arrière ONO
      blockedArcs: Object.freeze([
        Object.freeze({
          startAngle: -2.95,
          endAngle: -1.85,
          kind: 'rocks' as const,
          cliffHeight: 2.2,
        }),
      ]),
    }),
    archipelago: Object.freeze({
      id: 'archipelago',
      name: NEW_ISLANDS.archipelago.name,
      centerX: NEW_ISLANDS.archipelago.centerX,
      centerZ: NEW_ISLANDS.archipelago.centerZ,
      baseRadius: NEW_ISLANDS.archipelago.radius,
      // Plage Sud face à Félingard (à l'écart du détroit étroit Est vers Griffe-de-Roc)
      defaultAnchorageAngle: 1.74,
      blockedArcs: Object.freeze([]),
    }),
  });

// --- Types publics de requête côtière, coque, collision & débarquement ---

export interface ShorelineSample {
  /** Distance signée exacte à la ligne d'eau la plus proche (> 0 : eau, 0 : rivage, < 0 : terre) */
  signedDistance: number;
  /** Île la plus proche */
  nearestIslandId: IslandId;
  /** Normale côtière unitaire sortante (terre → eau) */
  normalX: number;
  normalZ: number;
  /** Point le plus proche sur la ligne d'eau */
  shoreX: number;
  shoreZ: number;
  /** Angle polaire de ce point par rapport au centre de l'île */
  islandAngle: number;
  /** Nature de la côte ('beach' | 'cliff' | 'rocks') */
  coastKind: CoastKind;
  /** Vrai si cette section côtière est une plage potentiellement débarquable */
  isAccessibleShore: boolean;
}

export type HullPointTag =
  | 'bow'
  | 'bow_starboard'
  | 'bow_port'
  | 'fore_starboard'
  | 'fore_port'
  | 'aft_starboard'
  | 'aft_port'
  | 'stern_starboard'
  | 'stern_port'
  | 'stern'
  | 'center';

export interface HullControlPoint {
  tag: HullPointTag;
  x: number;
  z: number;
  localRight: number;
  localAft: number;
}

export interface CoastCollisionResult extends ShipCoastCollisionResolution {
  /** Pénétration maximale résolue durant ce sous-pas */
  maxPenetration: number;
  /** Normale moyenne de contact (0, 0 si aucune collision) */
  contactNormalX: number;
  contactNormalZ: number;
  /** Vrai si la collision impliquait la limite extérieure de l'océan */
  hitOceanBoundary: boolean;
}

export interface DisembarkCheckContext {
  /** Zone active ; si différente de 'overworld', refuse avec 'not_in_overworld' */
  zoneId?: ZoneId;
  /** Île actuellement chargée dans state.islandId */
  currentIslandId?: IslandId;
  /** Ennemis vivants actuellement instanciés */
  enemies?: readonly EnemyInstance[];
  /** Murs AABB éventuels à éviter */
  walls?: readonly WallRect[];
  /** Rayon du joueur (défaut : PLAYER_RADIUS) */
  playerRadius?: number;
  /** Distance maximale coque ↔ ligne d'eau autorisant le débarquement */
  maxWaterDistance?: number;
  /** Dimensions de coque */
  hull?: ShipHullConfig;
}

export type DisembarkCheckResult = ShipDisembarkStatus;

export interface BoatAnchorage {
  position: Vec2;
  angle: number;
}

export interface BoatRecoveryResult {
  position: Vec2;
  angle: number;
  relocated: boolean;
}

// --- Accesseurs géométriques unifiés sur les 6 îles ---

export function getIslandCenter(islandId: IslandId): Vec2 {
  const profile = ISLAND_COAST_PROFILES[islandId];
  return { x: profile.centerX, z: profile.centerZ };
}

export function getIslandName(islandId: IslandId): string {
  return ISLAND_COAST_PROFILES[islandId].name;
}

export function getIslandCoastRadius(islandId: IslandId, angle: number): number {
  if (islandId === 'felingard') {
    return getIslandRadiusAtAngle(angle);
  }
  return getNewIslandRadiusAtAngle(islandId, angle);
}

/** Dérivée analytique exacte dR/dθ du contour organique de l'île. */
export function getIslandCoastRadiusDerivative(
  islandId: IslandId,
  angle: number,
): number {
  if (islandId === 'felingard') {
    return (
      -4.4 * Math.sin(angle * 2 - 0.5) +
      4.5 * Math.cos(angle * 3 + 0.9) -
      5.0 * Math.sin(angle * 5 - 0.3)
    );
  }
  return (
    -4.0 * Math.sin(angle * 2 - 0.3) +
    4.5 * Math.cos(angle * 3 + 0.7) -
    4.0 * Math.sin(angle * 5 - 0.1)
  );
}

/** Dérivée seconde analytique d²R/dθ² (utilisée pour le raffinement Newton du SDF). */
function getIslandCoastRadiusSecondDerivative(
  islandId: IslandId,
  angle: number,
): number {
  if (islandId === 'felingard') {
    return (
      -8.8 * Math.cos(angle * 2 - 0.5) -
      13.5 * Math.sin(angle * 3 + 0.9) -
      25.0 * Math.cos(angle * 5 - 0.3)
    );
  }
  return (
    -8.0 * Math.cos(angle * 2 - 0.3) -
    13.5 * Math.sin(angle * 3 + 0.7) -
    20.0 * Math.cos(angle * 5 - 0.1)
  );
}

export function getIslandWaterlineRadius(
  islandId: IslandId,
  angle: number,
): number {
  return getIslandCoastRadius(islandId, angle) + WATERLINE_OFFSET;
}

/** Teste si un angle (radians) appartient à l'arc CCW [startAngle, endAngle] et retourne sa distance signée. */
function evaluateArcSignedMargin(
  angle: number,
  startAngle: number,
  endAngle: number,
): { inside: boolean; signedDistFromBoundary: number } {
  const a = normalizeAngle(angle);
  const start = normalizeAngle(startAngle);
  const end = normalizeAngle(endAngle);

  let span = end - start;
  if (span <= 0) span += TWO_PI;

  let rel = a - start;
  if (rel < 0) rel += TWO_PI;

  if (rel <= span) {
    const inward = Math.min(rel, span - rel);
    return { inside: true, signedDistFromBoundary: inward };
  }
  const outward = Math.min(rel - span, TWO_PI - rel);
  return { inside: false, signedDistFromBoundary: -outward };
}

function smoothstep01(t: number): number {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

/**
 * Classifie la nature côtière à un angle donné d'une île :
 * - `'beach'` : plage praticable (débarquement autorisé si terrain dégagé)
 * - `'cliff'` : falaise escarpée (débarquement interdit)
 * - `'rocks'` : paroi / récif rocheux (débarquement interdit)
 */
export function getCoastKindAtAngle(islandId: IslandId, angle: number): CoastKind {
  const profile = ISLAND_COAST_PROFILES[islandId];
  for (const arc of profile.blockedArcs) {
    if (evaluateArcSignedMargin(angle, arc.startAngle, arc.endAngle).inside) {
      return arc.kind;
    }
  }
  return 'beach';
}

/**
 * Calcule le facteur de mélange lissé [0..1] et la hauteur de falaise en un angle d'île.
 */
function sampleCliffInfluenceAtAngle(
  islandId: IslandId,
  angle: number,
): { weight: number; cliffHeight: number } {
  const profile = ISLAND_COAST_PROFILES[islandId];
  let bestWeight = 0;
  let bestHeight = 0;

  for (const arc of profile.blockedArcs) {
    const { signedDistFromBoundary } = evaluateArcSignedMargin(
      angle,
      arc.startAngle,
      arc.endAngle,
    );
    // Transition continue sur [-CLIFF_FEATHER_RAD, +CLIFF_FEATHER_RAD] autour des bornes d'arc
    const t = (signedDistFromBoundary + CLIFF_FEATHER_RAD) / (CLIFF_FEATHER_RAD * 2);
    const w = smoothstep01(t);
    if (w > bestWeight) {
      bestWeight = w;
      bestHeight = arc.cliffHeight;
    }
  }

  return { weight: bestWeight, cliffHeight: bestHeight };
}

/**
 * Hauteur exacte du terrain en coordonnées LOCALES centrées sur l'île (`localX, localZ`).
 * Utilisable directement par `worldRenderer.ts` pour sculpter les maillages 3D des 6 îles :
 * - Strictement plat `y = 0` sur toute la surface marchable (`r <= R_coast - 2.15`).
 * - Sur plage : pente douce `0 → -1.85` sur `3.55 u` passant par `y = -0.14` à `R_coast + 0.60`.
 * - Sur falaise / rochers : rebord rocheux s'élevant jusqu'à `+cliffHeight` puis tombant à pic
 *   jusqu'à `y = -0.14` EXACTEMENT à `R_coast + 0.60`, garantissant un alignement millimétrique
 *   avec le shader d'océan et le SDF physique !
 */
export function getIslandTerrainHeightLocal(
  islandId: IslandId,
  localX: number,
  localZ: number,
): number {
  const r = Math.hypot(localX, localZ);
  const angle = r < 1e-6 ? 0 : Math.atan2(localZ, localX);
  const coastR = getIslandCoastRadius(islandId, angle);

  // Profil plage standard (identique au maillage diorama original)
  let beachY: number;
  if (r <= coastR) {
    beachY = 0;
  } else if (r >= coastR + TERRAIN_SLOPE_WIDTH) {
    beachY = TERRAIN_SEABED_DEPTH;
  } else {
    const t = (r - coastR) / TERRAIN_SLOPE_WIDTH;
    beachY = TERRAIN_SEABED_DEPTH * smoothstep01(t);
  }

  const { weight, cliffHeight } = sampleCliffInfluenceAtAngle(islandId, angle);
  if (weight <= 1e-4) {
    return beachY;
  }

  // Profil falaise : reste à y = 0 dans la zone jouable (r <= coastR - 2.15),
  // monte en crête rocheuse à coastR - 0.35, plonge à pic jusqu'à WATER_LEVEL_Y à coastR + 0.60.
  const ridgeInner = coastR - 2.15;
  const ridgeCrest = coastR - 0.35;
  const waterlineR = coastR + WATERLINE_OFFSET;
  const cliffFootR = coastR + 2.2;

  let cliffY: number;
  if (r <= ridgeInner) {
    cliffY = 0;
  } else if (r <= ridgeCrest) {
    const t = (r - ridgeInner) / (ridgeCrest - ridgeInner);
    cliffY = cliffHeight * smoothstep01(t);
  } else if (r <= waterlineR) {
    const t = (r - ridgeCrest) / (waterlineR - ridgeCrest);
    cliffY = cliffHeight + (WATER_LEVEL_Y - cliffHeight) * smoothstep01(t);
  } else if (r <= cliffFootR) {
    const t = (r - waterlineR) / (cliffFootR - waterlineR);
    cliffY =
      WATER_LEVEL_Y + (TERRAIN_SEABED_DEPTH - WATER_LEVEL_Y) * smoothstep01(t);
  } else {
    cliffY = TERRAIN_SEABED_DEPTH;
  }

  return beachY + (cliffY - beachY) * weight;
}

/**
 * Hauteur exacte du terrain d'une île en coordonnées MONDE `(worldX, worldZ)`.
 */
export function getIslandTerrainHeight(
  islandId: IslandId,
  worldX: number,
  worldZ: number,
): number {
  const profile = ISLAND_COAST_PROFILES[islandId];
  return getIslandTerrainHeightLocal(
    islandId,
    worldX - profile.centerX,
    worldZ - profile.centerZ,
  );
}

/**
 * Amplitude de la pente locale ||∇h(x, z)|| sur une île (différences finies centrées).
 */
export function getTerrainSlopeAt(
  islandId: IslandId,
  worldX: number,
  worldZ: number,
): number {
  const eps = 0.25;
  const hxPos = getIslandTerrainHeight(islandId, worldX + eps, worldZ);
  const hxNeg = getIslandTerrainHeight(islandId, worldX - eps, worldZ);
  const hzPos = getIslandTerrainHeight(islandId, worldX, worldZ + eps);
  const hzNeg = getIslandTerrainHeight(islandId, worldX, worldZ - eps);
  const dhdx = (hxPos - hxNeg) / (2 * eps);
  const dhdz = (hzPos - hzNeg) / (2 * eps);
  return Math.hypot(dhdx, dhdz);
}

// --- SDF exact multi-îles & normale côtière sortante ---

/**
 * Évalue la distance signée exacte et la normale sortante vis-à-vis d'une seule île.
 * Utilise 3 itérations de Newton sauvegardé sur la courbe polaire R_wl(φ) près de la côte
 * pour obtenir une véritable distance euclidienne (|∇SDF| = 1) et une normale exacte.
 */
function sampleSingleIslandShoreline(
  islandId: IslandId,
  x: number,
  z: number,
): ShorelineSample {
  const profile = ISLAND_COAST_PROFILES[islandId];
  const dx = x - profile.centerX;
  const dz = z - profile.centerZ;
  const radialDist = Math.hypot(dx, dz);

  if (radialDist < 1e-6) {
    const r0 = getIslandWaterlineRadius(islandId, 0);
    const kind = getCoastKindAtAngle(islandId, 0);
    return {
      signedDistance: -r0,
      nearestIslandId: islandId,
      normalX: 1,
      normalZ: 0,
      shoreX: profile.centerX + r0,
      shoreZ: profile.centerZ,
      islandAngle: 0,
      coastKind: kind,
      isAccessibleShore: kind === 'beach',
    };
  }

  const theta = Math.atan2(dz, dx);
  const rAtTheta = getIslandWaterlineRadius(islandId, theta);
  const isWater = radialDist > rAtTheta;

  let phi = theta;
  if (Math.abs(radialDist - rAtTheta) < 16) {
    for (let iter = 0; iter < 3; iter++) {
      const r = getIslandWaterlineRadius(islandId, phi);
      const r1 = getIslandCoastRadiusDerivative(islandId, phi);
      const r2 = getIslandCoastRadiusSecondDerivative(islandId, phi);
      const cosP = Math.cos(phi);
      const sinP = Math.sin(phi);

      const cx = r * cosP;
      const cz = r * sinP;
      const px = dx - cx;
      const pz = dz - cz;

      const c1x = r1 * cosP - r * sinP;
      const c1z = r1 * sinP + r * cosP;
      const c2x = (r2 - r) * cosP - 2 * r1 * sinP;
      const c2z = (r2 - r) * sinP + 2 * r1 * cosP;

      const gradDot = px * c1x + pz * c1z;
      const c1LenSq = c1x * c1x + c1z * c1z;
      const curvatureTerm = px * c2x + pz * c2z;
      const denom = Math.max(c1LenSq - curvatureTerm, c1LenSq * 0.5, 1e-4);

      const step = clamp(gradDot / denom, -0.25, 0.25);
      phi = normalizeAngle(phi + step);
      if (Math.abs(step) < 1e-5) break;
    }
  }

  const finalR = getIslandWaterlineRadius(islandId, phi);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const shoreRelX = finalR * cosPhi;
  const shoreRelZ = finalR * sinPhi;
  const shoreX = profile.centerX + shoreRelX;
  const shoreZ = profile.centerZ + shoreRelZ;

  const diffX = dx - shoreRelX;
  const diffZ = dz - shoreRelZ;
  const euclidDist = Math.hypot(diffX, diffZ);

  let normalX: number;
  let normalZ: number;
  if (euclidDist > 1e-5) {
    const sign = isWater ? 1 : -1;
    normalX = (sign * diffX) / euclidDist;
    normalZ = (sign * diffZ) / euclidDist;
  } else {
    // Point exactement sur la ligne d'eau : normale analytique sortante orthogonale à C'(φ)
    const r1 = getIslandCoastRadiusDerivative(islandId, phi);
    const tx = r1 * cosPhi - finalR * sinPhi;
    const tz = r1 * sinPhi + finalR * cosPhi;
    const tLen = Math.hypot(tx, tz) || 1;
    normalX = tz / tLen;
    normalZ = -tx / tLen;
  }

  const coastKind = getCoastKindAtAngle(islandId, phi);
  return {
    signedDistance: isWater ? euclidDist : -euclidDist,
    nearestIslandId: islandId,
    normalX,
    normalZ,
    shoreX,
    shoreZ,
    islandAngle: phi,
    coastKind,
    isAccessibleShore: coastKind === 'beach',
  };
}

/**
 * Échantillonne le champ de distance signée côtier agrégé sur les 6 îles :
 * - `signedDistance > 0` : en eau libre
 * - `signedDistance = 0` : sur la ligne d'eau (`R_coast + 0.60`)
 * - `signedDistance < 0` : sur la terre ferme
 */
export function sampleShorelineField(x: number, z: number): ShorelineSample {
  let best = sampleSingleIslandShoreline(ALL_ISLAND_IDS[0], x, z);
  for (let i = 1; i < ALL_ISLAND_IDS.length; i++) {
    const candidate = sampleSingleIslandShoreline(ALL_ISLAND_IDS[i], x, z);
    if (candidate.signedDistance < best.signedDistance) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Retourne la distance signée à la côte la plus proche parmi les 6 îles
 * (> 0 : eau libre, < 0 : terre ferme).
 */
export function getWaterSignedDistance(x: number, z: number): number {
  return sampleShorelineField(x, z).signedDistance;
}

// --- Points de contrôle de coque orientée (10 périmétriques + centre) ---

/**
 * Calcule les 11 points de contrôle (10 points périmétriques + centre) de la coque orientée
 * dans le plan monde (x, z), alignés sur la convention Proue = -Z, Tribord = +X.
 */
export function getHullControlPoints(
  x: number,
  z: number,
  angle: number,
  hull: ShipHullConfig = SHIP_PHYSICS_CONFIG.hull,
): HullControlPoint[] {
  const L = hull.halfLength;
  const W = hull.halfWidth;
  const bowW = W * hull.bowTaper;
  const sternW = W * hull.sternTaper;

  const specs: ReadonlyArray<readonly [HullPointTag, number, number]> = [
    ['bow', 0, -L],
    ['bow_starboard', bowW, -L * 0.72],
    ['bow_port', -bowW, -L * 0.72],
    ['fore_starboard', W * 0.9, -L * 0.25],
    ['fore_port', -W * 0.9, -L * 0.25],
    ['aft_starboard', W, L * 0.3],
    ['aft_port', -W, L * 0.3],
    ['stern_starboard', sternW, L * 0.85],
    ['stern_port', -sternW, L * 0.85],
    ['stern', 0, L],
    ['center', 0, 0],
  ];

  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const out: HullControlPoint[] = new Array(specs.length);

  for (let i = 0; i < specs.length; i++) {
    const [tag, localRight, localAft] = specs[i];
    out[i] = {
      tag,
      x: x + localRight * cos + localAft * sin,
      z: z - localRight * sin + localAft * cos,
      localRight,
      localAft,
    };
  }
  return out;
}

/**
 * Vérifie que les 11 points de contrôle de la coque sont intégralement en eau libre
 * avec au moins `hull.safetyMargin` d'écart par rapport à toute île et aux limites de l'océan.
 */
export function isHullEntirelyOnWater(
  x: number,
  z: number,
  angle: number,
  hull: ShipHullConfig = SHIP_PHYSICS_CONFIG.hull,
  oceanBoundaryLimit: number = SHIP_PHYSICS_CONFIG.oceanBoundaryLimit,
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(angle)) {
    return false;
  }
  const margin = hull.safetyMargin - 1e-3;
  const points = getHullControlPoints(x, z, angle, hull);
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (
      Math.abs(pt.x) > oceanBoundaryLimit - margin ||
      Math.abs(pt.z) > oceanBoundaryLimit - margin
    ) {
      return false;
    }
    if (getWaterSignedDistance(pt.x, pt.z) < margin) {
      return false;
    }
  }
  return true;
}

// --- Résolution multi-passes des collisions côtières & limites océan ---

interface DeepestHullContact {
  penetration: number;
  normalX: number;
  normalZ: number;
  nearestIslandId: IslandId;
  fromOceanBoundary: boolean;
}

/**
 * Trouve le contact le plus profond parmi les 11 points de coque vis-à-vis
 * des 6 îles et des 4 frontières extérieures de l'océan.
 */
function findDeepestHullContact(
  x: number,
  z: number,
  angle: number,
  hull: ShipHullConfig,
  oceanLimit: number,
): DeepestHullContact | null {
  const points = getHullControlPoints(x, z, angle, hull);
  const margin = hull.safetyMargin;

  let deepestPen = 0;
  let bestNx = 0;
  let bestNz = 0;
  let bestIslandId: IslandId = 'felingard';
  let fromBoundary = false;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];

    // 1. Côtes des 6 îles
    const sample = sampleShorelineField(pt.x, pt.z);
    const islandPen = margin - sample.signedDistance;
    if (islandPen > deepestPen) {
      deepestPen = islandPen;
      bestNx = sample.normalX;
      bestNz = sample.normalZ;
      bestIslandId = sample.nearestIslandId;
      fromBoundary = false;
    }

    // 2. Frontières extérieures de l'océan (±oceanLimit)
    const eastPen = pt.x + margin - oceanLimit;
    if (eastPen > deepestPen) {
      deepestPen = eastPen;
      bestNx = -1;
      bestNz = 0;
      bestIslandId = sample.nearestIslandId;
      fromBoundary = true;
    }
    const westPen = -oceanLimit - (pt.x - margin);
    if (westPen > deepestPen) {
      deepestPen = westPen;
      bestNx = 1;
      bestNz = 0;
      bestIslandId = sample.nearestIslandId;
      fromBoundary = true;
    }
    const southPen = pt.z + margin - oceanLimit;
    if (southPen > deepestPen) {
      deepestPen = southPen;
      bestNx = 0;
      bestNz = -1;
      bestIslandId = sample.nearestIslandId;
      fromBoundary = true;
    }
    const northPen = -oceanLimit - (pt.z - margin);
    if (northPen > deepestPen) {
      deepestPen = northPen;
      bestNx = 0;
      bestNz = 1;
      bestIslandId = sample.nearestIslandId;
      fromBoundary = true;
    }
  }

  if (deepestPen <= 1e-4) {
    return null;
  }

  return {
    penetration: deepestPen,
    normalX: bestNx,
    normalZ: bestNz,
    nearestIslandId: bestIslandId,
    fromOceanBoundary: fromBoundary,
  };
}

/**
 * Résout de manière fluide et multi-passes les collisions de la coque orientée
 * contre les 6 îles et la limite océanique (±152 u avec tampon doux 146..152 u) :
 * - Projection positionnelle douce garantissant zéro pénétration proue/poupe/flancs.
 * - Décomposition tangentielle pour longer naturellement les côtes sans tremblement.
 * - Amortissement continu indépendant du pas `substepDt` (20 FPS == 60 FPS == 120 FPS).
 */
export function resolveShipCoastCollision(
  x: number,
  z: number,
  angle: number,
  speed: number,
  angularVelocity: number,
  config: ShipPhysicsConfig = SHIP_PHYSICS_CONFIG,
  substepDt: number = config.fixedSubstepSec,
): CoastCollisionResult {
  let curX = x;
  let curZ = z;
  let curAngle = normalizeAngle(angle);
  let curSpeed = speed;
  let curAngVel = angularVelocity;

  const dt = Number.isFinite(substepDt)
    ? clamp(substepDt, 1e-4, config.maxFrameDtSec)
    : config.fixedSubstepSec;
  const hull = config.hull;
  const oceanLimit = config.oceanBoundaryLimit;
  const softStart = oceanLimit - Math.max(0, config.oceanBoundarySoftZone);

  // 1. Zone tampon de courant doux près du bord du monde (146..152 u)
  const forward0 = getShipForward(curAngle);
  if (Math.abs(curX) > softStart || Math.abs(curZ) > softStart) {
    const pushX =
      curX > softStart
        ? -clamp((curX - softStart) / Math.max(config.oceanBoundarySoftZone, 1e-4), 0, 1)
        : curX < -softStart
          ? clamp((-softStart - curX) / Math.max(config.oceanBoundarySoftZone, 1e-4), 0, 1)
          : 0;
    const pushZ =
      curZ > softStart
        ? -clamp((curZ - softStart) / Math.max(config.oceanBoundarySoftZone, 1e-4), 0, 1)
        : curZ < -softStart
          ? clamp((-softStart - curZ) / Math.max(config.oceanBoundarySoftZone, 1e-4), 0, 1)
          : 0;

    const pushLen = Math.hypot(pushX, pushZ);
    if (pushLen > 1e-4) {
      const inwardNx = pushX / pushLen;
      const inwardNz = pushZ / pushLen;
      const vnSoft = (curSpeed * forward0.x) * inwardNx + (curSpeed * forward0.z) * inwardNz;
      if (vnSoft < 0) {
        const softStrength = clamp(pushLen, 0, 1);
        curSpeed *= Math.exp(-3.8 * softStrength * dt);
      }
      // Courant de rappel très doux évitant de s'écraser sur le bord invisible
      curX += pushX * 1.2 * dt;
      curZ += pushZ * 1.2 * dt;
    }
  }

  // 2. Projection positionnelle itérative (converge même dans le détroit étroit mountain ↔ archipelago)
  let collided = false;
  let hitOceanBoundary = false;
  let maxPenetration = 0;
  let accumNx = 0;
  let accumNz = 0;
  let contactCount = 0;

  const maxIter = Math.max(1, config.maxCollisionResolveIterations);
  for (let iter = 0; iter < maxIter; iter++) {
    const contact = findDeepestHullContact(curX, curZ, curAngle, hull, oceanLimit);
    if (!contact) break;

    collided = true;
    if (contact.fromOceanBoundary) hitOceanBoundary = true;
    if (contact.penetration > maxPenetration) {
      maxPenetration = contact.penetration;
    }

    const push = contact.penetration + 1e-4;
    curX += contact.normalX * push;
    curZ += contact.normalZ * push;
    accumNx += contact.normalX * contact.penetration;
    accumNz += contact.normalZ * contact.penetration;
    contactCount += 1;
  }

  const centerSample = sampleShorelineField(curX, curZ);

  if (!collided || contactCount === 0) {
    return {
      x: curX,
      z: curZ,
      angle: curAngle,
      speed: curSpeed,
      angularVelocity: curAngVel,
      collided: false,
      impactIntensity: 0,
      nearestIslandId: centerSample.nearestIslandId,
      maxPenetration: 0,
      contactNormalX: 0,
      contactNormalZ: 0,
      hitOceanBoundary: false,
    };
  }

  const nLen = Math.hypot(accumNx, accumNz) || 1;
  const contactNx = accumNx / nLen;
  const contactNz = accumNz / nLen;

  // 3. Réponse vitesse & glisse tangentielle côtière (substep-invariant)
  const forward = getShipForward(curAngle);
  const vx = forward.x * curSpeed;
  const vz = forward.z * curSpeed;
  const vn = vx * contactNx + vz * contactNz;
  let impactIntensity = 0;

  if (vn < 0) {
    impactIntensity = clamp(
      -vn / Math.max(config.maxForwardSpeed, 1e-4),
      0,
      1,
    );
    const normalDot = Math.abs(forward.x * contactNx + forward.z * contactNz);

    // Friction de glisse douce (rasage) + absorption franche sur impact frontal (accostage)
    const slideFrictionRate = config.coastSlideFriction * 6.5;
    const headOnBrakeRate = config.collisionSpeedDamping * 34.0;
    const normalSq = normalDot * normalDot;
    const effectiveBrakeRate =
      slideFrictionRate + headOnBrakeRate * normalSq * normalSq;

    curSpeed *= Math.exp(-effectiveBrakeRate * dt);
    if (Math.abs(curSpeed) < config.stopSpeedEpsilon && normalDot > 0.85) {
      curSpeed = 0;
    }

    // Couple naturel d'alignement tangentiel sur choc oblique (pas sur accostage frontal 90°)
    if (normalDot > 0.08 && normalDot < 0.9 && Math.abs(curSpeed) > 0.5) {
      const travelSign = curSpeed >= 0 ? 1 : -1;
      const dirX = forward.x * travelSign;
      const dirZ = forward.z * travelSign;
      const dirDotN = dirX * contactNx + dirZ * contactNz;
      const tanX = dirX - dirDotN * contactNx;
      const tanZ = dirZ - dirDotN * contactNz;
      const tanLen = Math.hypot(tanX, tanZ);

      if (tanLen > 1e-4) {
        const utx = tanX / tanLen;
        const utz = tanZ / tanLen;
        const left = getShipLeft(curAngle);
        const alignSign =
          (utx * left.x + utz * left.z) * travelSign;
        const angleDelta = clamp(
          alignSign * Math.abs(vn) * (config.collisionAngularBounce * 1.8) * dt,
          -0.06,
          0.06,
        );
        curAngle = normalizeAngle(curAngle + angleDelta);
        curAngVel *= Math.exp(-2.5 * dt);

        // Passe de sécurité post-rotation : garantit zéro pénétration après micro-déviation
        const postContact = findDeepestHullContact(
          curX,
          curZ,
          curAngle,
          hull,
          oceanLimit,
        );
        if (postContact) {
          const postPush = postContact.penetration + 1e-4;
          curX += postContact.normalX * postPush;
          curZ += postContact.normalZ * postPush;
        }
      }
    }
  }

  return {
    x: curX,
    z: curZ,
    angle: curAngle,
    speed: curSpeed,
    angularVelocity: curAngVel,
    collided: true,
    impactIntensity,
    nearestIslandId: centerSample.nearestIslandId,
    maxPenetration,
    contactNormalX: contactNx,
    contactNormalZ: contactNz,
    hitOceanBoundary,
  };
}

// --- Vérification de marchabilité & obstacles par île ---

interface CircleObstacle {
  x: number;
  z: number;
  radius: number;
}

function isInsideIslandWalkable(
  islandId: IslandId,
  x: number,
  z: number,
  extraMargin = PLAYER_RADIUS + 0.15,
): boolean {
  const totalMargin = ISLAND_WALKABLE_MARGIN + extraMargin;
  if (islandId === 'felingard') {
    return isInsideIsland(x, z, totalMargin);
  }
  return isInsideNewIsland(islandId, x, z, totalMargin);
}

function collectIslandStaticObstacles(islandId: IslandId): CircleObstacle[] {
  const obstacles: CircleObstacle[] = [];

  if (islandId === 'felingard') {
    for (const b of OVERWORLD_DATA.buildings) {
      obstacles.push({ x: b.x, z: b.z, radius: b.colliderRadius + 0.35 });
    }
    for (const npc of OVERWORLD_DATA.npcs) {
      obstacles.push({ x: npc.x, z: npc.z, radius: npc.radius + 0.3 });
    }
    for (const portal of OVERWORLD_DATA.dungeonPortals) {
      obstacles.push({ x: portal.x, z: portal.z, radius: portal.radius * 0.65 });
    }
    for (const chest of OVERWORLD_DATA.chests) {
      obstacles.push({ x: chest.x, z: chest.z, radius: 1.05 });
    }
    for (const prop of OVERWORLD_DATA.props) {
      if (!prop.collidable || !prop.colliderRadius) continue;
      obstacles.push({ x: prop.x, z: prop.z, radius: prop.colliderRadius + 0.25 });
    }
    return obstacles;
  }

  const def = NEW_ISLANDS[islandId];
  for (const prop of def.props) {
    if (!prop.collidable || !prop.colliderRadius) continue;
    obstacles.push({ x: prop.x, z: prop.z, radius: prop.colliderRadius + 0.25 });
  }
  for (const chest of def.chests) {
    obstacles.push({ x: chest.x, z: chest.z, radius: 1.05 });
  }
  return obstacles;
}

function collectRelevantEnemies(
  targetIslandId: IslandId,
  context?: DisembarkCheckContext,
): CircleObstacle[] {
  const threats: CircleObstacle[] = [];
  const sameLoadedIsland =
    context?.enemies !== undefined &&
    (context.currentIslandId === undefined ||
      context.currentIslandId === targetIslandId);

  if (sameLoadedIsland && context?.enemies) {
    for (const enemy of context.enemies) {
      if (enemy.state === 'dead' || enemy.hp <= 0) continue;
      threats.push({ x: enemy.x, z: enemy.z, radius: enemy.radius });
    }
    return threats;
  }

  // Lors d'un changement d'île (ou appel sans état live), vérifier les camps statiques de l'île cible !
  const camps =
    targetIslandId === 'felingard'
      ? OVERWORLD_DATA.camps
      : NEW_ISLANDS[targetIslandId].camps;
  for (const camp of camps) {
    for (const sp of camp.spawns) {
      threats.push({ x: sp.x, z: sp.z, radius: 0.95 });
    }
  }
  return threats;
}

function isSpotClearOfStaticObstacles(
  x: number,
  z: number,
  playerRadius: number,
  obstacles: readonly CircleObstacle[],
  walls: readonly WallRect[],
): boolean {
  for (let i = 0; i < obstacles.length; i++) {
    const obs = obstacles[i];
    const minDist = obs.radius + playerRadius;
    const dx = x - obs.x;
    const dz = z - obs.z;
    if (dx * dx + dz * dz < minDist * minDist) {
      return false;
    }
  }
  for (let i = 0; i < walls.length; i++) {
    if (circleIntersectsAABB(x, z, playerRadius + 0.3, walls[i])) {
      return false;
    }
  }
  return true;
}

// --- Algorithme complet de recherche de point de débarquement sûr ---

const DISEMBARK_ANGLE_OFFSETS: readonly number[] = [
  0, 0.05, -0.05, 0.1, -0.1, 0.16, -0.16, 0.22, -0.22,
];

const DISEMBARK_INLAND_DEPTHS: readonly number[] = [
  2.65, 3.25, 3.9, 4.65, 5.5, 6.5,
];

/**
 * Évalue si le voilier peut débarquer à sa position actuelle et recherche le meilleur
 * point terrestre sûr sur la plage la plus proche.
 *
 * Vérifie :
 * 1. Zone overworld & proximité coque ↔ ligne d'eau (`<= maxWaterDistance`).
 * 2. Nature côtière (`'beach'` vs `'cliff'` / `'rocks'`).
 * 3. Marchabilité réelle (`isInsideIsland` / `isInsideNewIsland`), hauteur plate & pente douce.
 * 4. Absence totale de collision avec props, bâtiments, PNJ, portails, coffres et murs.
 * 5. Distance de sécurité avec les ennemis vivants (et camps statiques si changement d'île).
 */
export function findSafeDisembarkSpot(
  shipX: number,
  shipZ: number,
  shipAngle: number,
  context?: DisembarkCheckContext,
): DisembarkCheckResult {
  if (context?.zoneId && context.zoneId !== 'overworld') {
    return {
      canDisembark: false,
      nearestIslandId: null,
      coastDistance: Infinity,
      coastKind: 'beach',
      reason: 'not_in_overworld',
    };
  }

  const hull = context?.hull ?? SHIP_PHYSICS_CONFIG.hull;
  const playerRadius = context?.playerRadius ?? PLAYER_RADIUS;
  const maxWaterDist = context?.maxWaterDistance ?? DISEMBARK_MAX_WATER_DIST;
  const walls = context?.walls ?? [];

  // 1. Trouve le point de coque le plus proche d'un rivage
  const hullPoints = getHullControlPoints(shipX, shipZ, shipAngle, hull);
  let closestSample = sampleShorelineField(hullPoints[0].x, hullPoints[0].z);
  for (let i = 1; i < hullPoints.length; i++) {
    const sample = sampleShorelineField(hullPoints[i].x, hullPoints[i].z);
    if (sample.signedDistance < closestSample.signedDistance) {
      closestSample = sample;
    }
  }

  const coastDistance = Math.max(0, closestSample.signedDistance);
  const islandId = closestSample.nearestIslandId;
  const shorePoint: Vec2 = { x: closestSample.shoreX, z: closestSample.shoreZ };

  if (coastDistance > maxWaterDist) {
    return {
      canDisembark: false,
      nearestIslandId: islandId,
      coastDistance,
      coastKind: closestSample.coastKind,
      reason: 'too_far_from_shore',
      shorePoint,
    };
  }

  // 2. Vérifie l'accessibilité de la section côtière (plage vs falaise/rochers)
  const baseAngle = closestSample.islandAngle;
  let hasNearbyBeach = closestSample.isAccessibleShore;
  if (!hasNearbyBeach) {
    for (const dA of [0.06, -0.06, 0.12, -0.12, 0.16, -0.16]) {
      if (getCoastKindAtAngle(islandId, normalizeAngle(baseAngle + dA)) === 'beach') {
        hasNearbyBeach = true;
        break;
      }
    }
  }

  if (!hasNearbyBeach) {
    return {
      canDisembark: false,
      nearestIslandId: islandId,
      coastDistance,
      coastKind: closestSample.coastKind,
      reason: 'inaccessible_cliff',
      shorePoint,
    };
  }

  // 3. Recherche sur grille structurée vers l'intérieur de la plage
  const center = getIslandCenter(islandId);
  const staticObstacles = collectIslandStaticObstacles(islandId);
  const enemies = collectRelevantEnemies(islandId, context);

  let bestTier1: { pos: Vec2; score: number } | null = null;
  let bestTier2: { pos: Vec2; minEnemyMargin: number; score: number } | null = null;

  for (const dAngle of DISEMBARK_ANGLE_OFFSETS) {
    const testAngle = normalizeAngle(baseAngle + dAngle);
    if (getCoastKindAtAngle(islandId, testAngle) !== 'beach') {
      continue;
    }

    const coastR = getIslandCoastRadius(islandId, testAngle);
    const cosA = Math.cos(testAngle);
    const sinA = Math.sin(testAngle);

    // Vérifie que le couloir d'approche depuis la plage est plat et sans falaise
    const approachX = center.x + cosA * (coastR - 1.2);
    const approachZ = center.z + sinA * (coastR - 1.2);
    if (
      Math.abs(getIslandTerrainHeight(islandId, approachX, approachZ)) >
        MAX_DISEMBARK_ELEVATION ||
      getTerrainSlopeAt(islandId, approachX, approachZ) > MAX_WALKABLE_SLOPE
    ) {
      continue;
    }

    for (const depth of DISEMBARK_INLAND_DEPTHS) {
      const r = coastR - depth;
      if (r <= 1) continue;
      const cx = center.x + cosA * r;
      const cz = center.z + sinA * r;

      if (!isInsideIslandWalkable(islandId, cx, cz, playerRadius + 0.15)) {
        continue;
      }
      if (
        Math.abs(getIslandTerrainHeight(islandId, cx, cz)) >
          MAX_DISEMBARK_ELEVATION ||
        getTerrainSlopeAt(islandId, cx, cz) > MAX_WALKABLE_SLOPE
      ) {
        continue;
      }
      if (!isSpotClearOfStaticObstacles(cx, cz, playerRadius, staticObstacles, walls)) {
        continue;
      }

      // Contrôle de sécurité vis-à-vis des ennemis
      let hardBlockedByEnemy = false;
      let minEnemyClearance = Infinity;
      for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        const d = dist(cx, cz, e.x, e.z);
        const hardMin = e.radius + playerRadius + 1.1;
        if (d < hardMin) {
          hardBlockedByEnemy = true;
          break;
        }
        const safeMargin = d - (e.radius + playerRadius + 3.0);
        if (safeMargin < minEnemyClearance) {
          minEnemyClearance = safeMargin;
        }
      }
      if (hardBlockedByEnemy) continue;

      const distToShip = dist(cx, cz, shipX, shipZ);
      const boardingPenalty =
        distToShip > SHIP_BOARDING_RADIUS - 0.5 ? (distToShip - (SHIP_BOARDING_RADIUS - 0.5)) * 4.0 : 0;
      const score =
        Math.abs(dAngle) * 18.0 +
        (depth - 2.65) * 1.4 +
        distToShip * 0.4 +
        boardingPenalty;

      if (minEnemyClearance >= 0) {
        if (!bestTier1 || score < bestTier1.score) {
          bestTier1 = { pos: { x: cx, z: cz }, score };
        }
      } else {
        if (
          !bestTier2 ||
          minEnemyClearance > bestTier2.minEnemyMargin + 0.25 ||
          (Math.abs(minEnemyClearance - bestTier2.minEnemyMargin) <= 0.25 &&
            score < bestTier2.score)
        ) {
          bestTier2 = {
            pos: { x: cx, z: cz },
            minEnemyMargin: minEnemyClearance,
            score,
          };
        }
      }
    }
  }

  const chosen = bestTier1?.pos ?? bestTier2?.pos ?? null;
  if (!chosen) {
    return {
      canDisembark: false,
      nearestIslandId: islandId,
      coastDistance,
      coastKind: 'beach',
      reason: 'no_safe_spot',
      shorePoint,
    };
  }

  return {
    canDisembark: true,
    nearestIslandId: islandId,
    coastDistance,
    coastKind: 'beach',
    landingPos: chosen,
    shorePoint,
  };
}

// --- Mouillages par défaut, récupération sécurisée & restauration terrestre ---

/**
 * Calcule un mouillage sûr garanti sur l'eau face à une plage accessible de l'île demandée.
 * Le voilier est orienté parallèlement au rivage et les 11 points de coque sont validés.
 */
export function getDefaultAnchorageForIsland(islandId: IslandId): BoatAnchorage {
  const profile = ISLAND_COAST_PROFILES[islandId];
  const hull = SHIP_PHYSICS_CONFIG.hull;
  const shoreAngle = profile.defaultAnchorageAngle;

  // Direction tangente le long de la plage (pour Sud π/2 => (+1, 0) Est, cap -π/2)
  const tangentX = Math.sin(shoreAngle);
  const tangentZ = -Math.cos(shoreAngle);
  const angle = headingFromDirection(tangentX, tangentZ);

  const cosA = Math.cos(shoreAngle);
  const sinA = Math.sin(shoreAngle);
  const wlR = getIslandWaterlineRadius(islandId, shoreAngle);

  // Commence juste au-delà du maître-bau + marge, puis ajuste vers le large jusqu'à validation complète
  const minOffset = hull.halfWidth + hull.safetyMargin + 0.65;
  for (let offset = minOffset; offset <= minOffset + 4.0; offset += 0.25) {
    const pos: Vec2 = {
      x: profile.centerX + cosA * (wlR + offset),
      z: profile.centerZ + sinA * (wlR + offset),
    };
    if (isHullEntirelyOnWater(pos.x, pos.z, angle, hull)) {
      return { position: pos, angle };
    }
  }

  const fallbackOffset = hull.halfLength + hull.safetyMargin + 0.6;
  return {
    position: {
      x: profile.centerX + cosA * (wlR + fallbackOffset),
      z: profile.centerZ + sinA * (wlR + fallbackOffset),
    },
    angle,
  };
}

/**
 * Position initiale sûre du voilier sur l'eau près de la plage Sud accessible de Félingard
 * (directement au sud de Miaou-bourg, sans quai, zéro obstacle, atteignable à pied).
 */
export function getDefaultBoatSpawnOnFelingard(): BoatAnchorage {
  return getDefaultAnchorageForIsland('felingard');
}

/**
 * Garantit qu'une position de bateau (notamment issue d'une sauvegarde v1 ou corrompue)
 * repose intégralement sur l'eau libre, hors de toute île et dans les limites de l'océan.
 * Gère les détroits (ne repousse jamais le navire d'une île A dans une île B).
 */
export function ensureBoatOnWater(
  position: Vec2,
  angle: number,
  preferredIslandId?: IslandId,
): BoatRecoveryResult {
  const hull = SHIP_PHYSICS_CONFIG.hull;
  const oceanLimit = SHIP_PHYSICS_CONFIG.oceanBoundaryLimit;
  const safeAngle = Number.isFinite(angle) ? normalizeAngle(angle) : 0;

  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) {
    const fallback = getDefaultAnchorageForIsland(preferredIslandId ?? 'felingard');
    return {
      position: fallback.position,
      angle: fallback.angle,
      relocated: true,
    };
  }

  const boundMargin = hull.halfLength + hull.safetyMargin + 0.5;
  const clampedPos: Vec2 = {
    x: clamp(position.x, -(oceanLimit - boundMargin), oceanLimit - boundMargin),
    z: clamp(position.z, -(oceanLimit - boundMargin), oceanLimit - boundMargin),
  };
  const wasClamped =
    Math.abs(clampedPos.x - position.x) > 1e-4 ||
    Math.abs(clampedPos.z - position.z) > 1e-4;

  if (isHullEntirelyOnWater(clampedPos.x, clampedPos.z, safeAngle, hull, oceanLimit)) {
    return {
      position: clampedPos,
      angle: safeAngle,
      relocated: wasClamped,
    };
  }

  // Projette vers l'eau libre à partir de l'île la plus proche en privilégiant une plage accessible
  const sample = sampleShorelineField(clampedPos.x, clampedPos.z);
  const islandId = sample.nearestIslandId;
  const profile = ISLAND_COAST_PROFILES[islandId];
  const dx = clampedPos.x - profile.centerX;
  const dz = clampedPos.z - profile.centerZ;
  const baseAngle =
    Math.hypot(dx, dz) < 1e-4 ? profile.defaultAnchorageAngle : Math.atan2(dz, dx);

  const offsets = [
    hull.halfWidth + hull.safetyMargin + 0.75,
    hull.halfLength + hull.safetyMargin + 0.55,
    hull.halfLength + hull.safetyMargin + 1.4,
  ];
  const angleDeltas = [0, 0.15, -0.15, 0.3, -0.3, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2];

  // Passe 1 : cherche d'abord une plage accessible proche
  for (const preferBeach of [true, false]) {
    for (const dA of angleDeltas) {
      const a = normalizeAngle(baseAngle + dA);
      if (preferBeach && getCoastKindAtAngle(islandId, a) !== 'beach') {
        continue;
      }
      const wlR = getIslandWaterlineRadius(islandId, a);
      const tangentAngle = headingFromDirection(Math.sin(a), -Math.cos(a));

      for (const radialOut of offsets) {
        const candX = profile.centerX + Math.cos(a) * (wlR + radialOut);
        const candZ = profile.centerZ + Math.sin(a) * (wlR + radialOut);
        if (isHullEntirelyOnWater(candX, candZ, tangentAngle, hull, oceanLimit)) {
          return {
            position: { x: candX, z: candZ },
            angle: tangentAngle,
            relocated: true,
          };
        }
      }
    }
  }

  // Fallback garanti : mouillage canonique de l'île préférée ou de l'île la plus proche
  const anchored = getDefaultAnchorageForIsland(preferredIslandId ?? islandId);
  return {
    position: anchored.position,
    angle: anchored.angle,
    relocated: true,
  };
}

/**
 * Garantit une position terrestre marchable et dégagée d'obstacles sur l'île demandée
 * (utile lors de la restauration d'une sauvegarde ou d'un repli de sécurité).
 */
export function findSafeLandPositionOnIsland(
  islandId: IslandId,
  desiredPos?: Vec2,
): Vec2 {
  const staticObstacles = collectIslandStaticObstacles(islandId);

  const isValidLandPoint = (x: number, z: number): boolean => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    if (!isInsideIslandWalkable(islandId, x, z, PLAYER_RADIUS + 0.1)) return false;
    if (Math.abs(getIslandTerrainHeight(islandId, x, z)) > MAX_DISEMBARK_ELEVATION) {
      return false;
    }
    if (getTerrainSlopeAt(islandId, x, z) > MAX_WALKABLE_SLOPE) {
      return false;
    }
    return isSpotClearOfStaticObstacles(x, z, PLAYER_RADIUS, staticObstacles, []);
  };

  if (desiredPos && Number.isFinite(desiredPos.x) && Number.isFinite(desiredPos.z)) {
    if (isValidLandPoint(desiredPos.x, desiredPos.z)) {
      return { x: desiredPos.x, z: desiredPos.z };
    }

    const clamped =
      islandId === 'felingard'
        ? clampToIsland(desiredPos.x, desiredPos.z, ISLAND_WALKABLE_MARGIN + PLAYER_RADIUS + 0.6)
        : clampToNewIsland(
            islandId,
            desiredPos.x,
            desiredPos.z,
            ISLAND_WALKABLE_MARGIN + PLAYER_RADIUS + 0.6,
          );

    if (isValidLandPoint(clamped.x, clamped.z)) {
      return clamped;
    }

    // Spirale locale autour du point ramené sur l'île
    for (const radius of [1.2, 2.4, 3.8, 5.4, 7.2]) {
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TWO_PI;
        const cx = clamped.x + Math.cos(a) * radius;
        const cz = clamped.z + Math.sin(a) * radius;
        if (isValidLandPoint(cx, cz)) {
          return { x: cx, z: cz };
        }
      }
    }
  }

  // Fallback canonique par île : Miaou-bourg sur Félingard, plage d'ancrage sur les autres îles
  if (islandId === 'felingard') {
    return { ...OVERWORLD_DATA.playerStart };
  }

  const anchorage = getDefaultAnchorageForIsland(islandId);
  const disembark = findSafeDisembarkSpot(
    anchorage.position.x,
    anchorage.position.z,
    anchorage.angle,
  );
  if (disembark.canDisembark && disembark.landingPos) {
    return disembark.landingPos;
  }

  // Repli ultime autour du centre de l'île
  const center = getIslandCenter(islandId);
  if (isValidLandPoint(center.x, center.z)) {
    return center;
  }
  for (const radius of [2, 4, 6]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * TWO_PI;
      const cx = center.x + Math.cos(a) * radius;
      const cz = center.z + Math.sin(a) * radius;
      if (isValidLandPoint(cx, cz)) {
        return { x: cx, z: cz };
      }
    }
  }
  return center;
}
