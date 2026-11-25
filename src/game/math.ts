// ============================================================================
// Mathématiques 2D (plan x, z), collisions & tests géométriques des télégraphes
// Zéro import Three.js, zéro dépendance DOM.
// ============================================================================

import type { TelegraphZone, Vec2, WallRect } from './types';

export const TWO_PI = Math.PI * 2;

export function vec2(x: number, z: number): Vec2 {
  return { x, z };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, z: a.z + b.z };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, z: a.z - b.z };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, z: v.z * s };
}

export function lengthSq(x: number, z: number): number {
  return x * x + z * z;
}

export function length(x: number, z: number): number {
  return Math.hypot(x, z);
}

export function distSq(x1: number, z1: number, x2: number, z2: number): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  return dx * dx + dz * dz;
}

export function dist(x1: number, z1: number, x2: number, z2: number): number {
  return Math.hypot(x2 - x1, z2 - z1);
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function dot(ax: number, az: number, bx: number, bz: number): number {
  return ax * bx + az * bz;
}

export function normalize(x: number, z: number): Vec2 {
  const len = Math.hypot(x, z);
  if (len < 1e-8) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

export function normalizeVec(v: Vec2): Vec2 {
  return normalize(v.x, v.z);
}

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function angleBetween(x1: number, z1: number, x2: number, z2: number): number {
  return Math.atan2(z2 - z1, x2 - x1);
}

/**
 * Ramène un angle en radians dans [-PI, PI].
 */
export function normalizeAngle(angle: number): number {
  let a = angle % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  if (a < -Math.PI) a += TWO_PI;
  return a;
}

/**
 * Plus petite différence angulaire signée (b - a) dans [-PI, PI].
 */
export function angleDiff(a: number, b: number): number {
  return normalizeAngle(b - a);
}

// ============================================================================
// Collisions Cercle-Cercle & Cercle-AABB
// ============================================================================

export function circlesOverlap(
  x1: number,
  z1: number,
  r1: number,
  x2: number,
  z2: number,
  r2: number,
): boolean {
  const sum = r1 + r2;
  return distSq(x1, z1, x2, z2) < sum * sum;
}

/**
 * Calcule le vecteur de poussée minimal pour sortir le cercle 1 du cercle 2.
 */
export function resolveCircleCircle(
  x1: number,
  z1: number,
  r1: number,
  x2: number,
  z2: number,
  r2: number,
): Vec2 {
  const dx = x1 - x2;
  const dz = z1 - z2;
  const minDist = r1 + r2;
  const dSq = dx * dx + dz * dz;
  if (dSq >= minDist * minDist) {
    return { x: 0, z: 0 };
  }
  const d = Math.sqrt(dSq);
  if (d < 1e-6) {
    return { x: minDist, z: 0 };
  }
  const overlap = minDist - d;
  return {
    x: (dx / d) * overlap,
    z: (dz / d) * overlap,
  };
}

export function pointInRect(
  x: number,
  z: number,
  rect: Pick<WallRect, 'minX' | 'maxX' | 'minZ' | 'maxZ'>,
): boolean {
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

export function circleIntersectsAABB(
  cx: number,
  cz: number,
  r: number,
  rect: Pick<WallRect, 'minX' | 'maxX' | 'minZ' | 'maxZ'>,
): boolean {
  const closestX = clamp(cx, rect.minX, rect.maxX);
  const closestZ = clamp(cz, rect.minZ, rect.maxZ);
  return distSq(cx, cz, closestX, closestZ) < r * r;
}

/**
 * Repousse un cercle (cx, cz, r) hors d'une AABB (mur ou zone interdite).
 * Retourne la nouvelle position corrigée du centre.
 */
export function resolveCircleAABB(
  cx: number,
  cz: number,
  r: number,
  rect: Pick<WallRect, 'minX' | 'maxX' | 'minZ' | 'maxZ'>,
): Vec2 {
  const closestX = clamp(cx, rect.minX, rect.maxX);
  const closestZ = clamp(cz, rect.minZ, rect.maxZ);
  const dx = cx - closestX;
  const dz = cz - closestZ;
  const dSq = dx * dx + dz * dz;

  if (dSq >= r * r) {
    return { x: cx, z: cz };
  }

  // Centre strictement à l'intérieur du rectangle : pousser vers la face la plus proche
  if (dSq < 1e-10) {
    const penLeft = cx - rect.minX;
    const penRight = rect.maxX - cx;
    const penTop = cz - rect.minZ;
    const penBottom = rect.maxZ - cz;
    const minPen = Math.min(penLeft, penRight, penTop, penBottom);

    if (minPen === penLeft) return { x: rect.minX - r, z: cz };
    if (minPen === penRight) return { x: rect.maxX + r, z: cz };
    if (minPen === penTop) return { x: cx, z: rect.minZ - r };
    return { x: cx, z: rect.maxZ + r };
  }

  const d = Math.sqrt(dSq);
  const overlap = r - d;
  return {
    x: cx + (dx / d) * overlap,
    z: cz + (dz / d) * overlap,
  };
}

/**
 * Distance au carré d'un point P au segment [A, B].
 */
export function distPointToSegmentSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const abx = bx - ax;
  const abz = bz - az;
  const abLenSq = abx * abx + abz * abz;
  if (abLenSq < 1e-10) {
    return distSq(px, pz, ax, az);
  }
  const t = clamp(((px - ax) * abx + (pz - az) * abz) / abLenSq, 0, 1);
  const projX = ax + abx * t;
  const projZ = az + abz * t;
  return distSq(px, pz, projX, projZ);
}

// ============================================================================
// Tests géométriques précis pour Télégraphes & Attaques (circle, cone, line, ring)
// ============================================================================

export function isPointInCircle(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  radius: number,
  targetRadius = 0,
): boolean {
  const maxR = radius + Math.max(0, targetRadius);
  return distSq(px, pz, cx, cz) <= maxR * maxR;
}

/**
 * Teste si un cercle (px, pz, targetRadius) touche un secteur circulaire (cône).
 * Pour targetRadius === 0, test exact point-dans-cône.
 */
export function isPointInCone(
  px: number,
  pz: number,
  ox: number,
  oz: number,
  angle: number,
  radius: number,
  arcAngle: number,
  targetRadius = 0,
): boolean {
  const tr = Math.max(0, targetRadius);
  const dx = px - ox;
  const dz = pz - oz;
  const dSq = dx * dx + dz * dz;
  const maxR = radius + tr;

  if (dSq > maxR * maxR) {
    return false;
  }

  // Si la cible recouvre l'origine du cône
  if (dSq <= tr * tr + 1e-8) {
    return true;
  }

  const halfArc = arcAngle * 0.5;
  const targetAngle = Math.atan2(dz, dx);
  const absDiff = Math.abs(angleDiff(angle, targetAngle));

  if (absDiff <= halfArc + 1e-6) {
    return true;
  }

  if (tr <= 0) {
    return false;
  }

  // Intersection exacte cercle-segment avec les deux bords latéraux du cône
  const trSq = tr * tr;
  const leftAngle = angle - halfArc;
  const rightAngle = angle + halfArc;

  const leftEndX = ox + Math.cos(leftAngle) * radius;
  const leftEndZ = oz + Math.sin(leftAngle) * radius;
  if (distPointToSegmentSq(px, pz, ox, oz, leftEndX, leftEndZ) <= trSq) {
    return true;
  }

  const rightEndX = ox + Math.cos(rightAngle) * radius;
  const rightEndZ = oz + Math.sin(rightAngle) * radius;
  return distPointToSegmentSq(px, pz, ox, oz, rightEndX, rightEndZ) <= trSq;
}

/**
 * Teste si un cercle (px, pz, targetRadius) touche une ligne orientée (rectangle orienté)
 * partant de (ox, oz) dans la direction `angle`, de longueur `length` et de largeur `width`.
 */
export function isPointInLine(
  px: number,
  pz: number,
  ox: number,
  oz: number,
  angle: number,
  lineLength: number,
  width: number,
  targetRadius = 0,
): boolean {
  const tr = Math.max(0, targetRadius);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relX = px - ox;
  const relZ = pz - oz;

  // Coordonnées locales : along ∈ [0, lineLength], across ∈ [-halfW, halfW]
  const along = relX * cos + relZ * sin;
  const across = -relX * sin + relZ * cos;
  const halfW = width * 0.5;

  if (tr <= 0) {
    return (
      along >= -1e-6 &&
      along <= lineLength + 1e-6 &&
      Math.abs(across) <= halfW + 1e-6
    );
  }

  const clampedAlong = clamp(along, 0, lineLength);
  const clampedAcross = clamp(across, -halfW, halfW);
  const da = along - clampedAlong;
  const dc = across - clampedAcross;
  return da * da + dc * dc <= tr * tr;
}

/**
 * Teste si un cercle (px, pz, targetRadius) touche un anneau [innerRadius, outerRadius].
 */
export function isPointInRing(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  innerRadius: number,
  outerRadius: number,
  targetRadius = 0,
): boolean {
  const tr = Math.max(0, targetRadius);
  const d = dist(px, pz, cx, cz);
  const minR = Math.max(0, innerRadius - tr);
  const maxR = outerRadius + tr;
  return d >= minR - 1e-6 && d <= maxR + 1e-6;
}

/**
 * Teste si une cible en (px, pz) (avec rayon optionnel) se trouve dans une TelegraphZone.
 */
export function isTargetInTelegraph(
  telegraph: TelegraphZone,
  px: number,
  pz: number,
  targetRadius = 0,
): boolean {
  switch (telegraph.shape) {
    case 'circle':
      return isPointInCircle(px, pz, telegraph.x, telegraph.z, telegraph.radius, targetRadius);
    case 'cone':
      return isPointInCone(
        px,
        pz,
        telegraph.x,
        telegraph.z,
        telegraph.angle,
        telegraph.radius,
        telegraph.arcAngle ?? Math.PI * 0.5,
        targetRadius,
      );
    case 'line':
      return isPointInLine(
        px,
        pz,
        telegraph.x,
        telegraph.z,
        telegraph.angle,
        telegraph.radius,
        telegraph.width ?? 2.0,
        targetRadius,
      );
    case 'ring':
      return isPointInRing(
        px,
        pz,
        telegraph.x,
        telegraph.z,
        telegraph.innerRadius ?? 0,
        telegraph.radius,
        targetRadius,
      );
  }
}
