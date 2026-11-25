import * as THREE from 'three';

// ============================================================================
// Shader GLSL Océan Réaliste & Agité de Félingard
// - 6 trains d'ondes de Gerstner multi-échelles non harmoniques (houle + clapot)
// - Normales micro-vagues 4 couches anisotropes & fluides (0 effet papier froissé)
// - Absorption de profondeur Beer-Lambert (plages claires -> large abyssal)
// - Fresnel Schlick + reflets ciel/nuages/coucher de soleil/lune/éclairs
// - Subsurface scattering dans les crêtes + caustiques côtières
// - Écume organique filandreuse de crêtes, sillons de vent (tempête) & déferlantes
// - Couplage direct coque/sillage du bateau + étanchéité côtière & fond marin (6 îles)
// - WebGL2 strict (0 warning GLSL) & Bloom-safe (diffus/écume <= 0.80 linéaire)
// ============================================================================

export interface OceanCoastIsland {
  x: number;
  z: number;
  radius: number;
  isMain?: boolean;
}

export interface WaterMaterialOptions {
  /** Couleur du lagon peu profond (près du rivage). */
  shallowColor?: THREE.ColorRepresentation;
  /** Couleur intermédiaire de la mer. */
  midColor?: THREE.ColorRepresentation;
  /** Couleur bleu abyssal au large. */
  deepColor?: THREE.ColorRepresentation;
  /** Couleur de l'écume côtière et des crêtes. */
  foamColor?: THREE.ColorRepresentation;
  /** Direction normalisée vers le soleil / la lune. */
  sunDirection?: THREE.Vector3;
  /** Couleur des reflets spéculaires solaires/lunaires. */
  sunColor?: THREE.ColorRepresentation;
  /** Décalage radial par rapport à getIslandRadiusAtAngle (0.6 = bord de plage). */
  coastOffset?: number;
  /** Amplitude globale des ondes Gerstner. */
  waveAmplitude?: number;
  /** Couleur du brouillard d'horizon (doit correspondre à scene.fog). */
  fogColor?: THREE.ColorRepresentation;
  /** Distance de début du brouillard. */
  fogNear?: number;
  /** Distance de fin du brouillard. */
  fogFar?: number;
  /** Masque de côte optionnel (R = distance normalisée ou 0 terre / 1 mer). */
  coastMask?: THREE.Texture | null;
  /** Demi-taille du masque de côte en unités monde (par défaut 60). */
  coastMaskHalfSize?: number;
  /** Centres et rayons des îles dont le rivage doit calmer les vagues. */
  coastIslands?: THREE.Vector4[];
}

export interface WaterDynamicUpdate {
  time: number;
  sunDirection?: THREE.Vector3;
  sunColor?: THREE.Color;
  ambientColor?: THREE.Color;
  skyReflectColor?: THREE.Color;
  horizonReflectColor?: THREE.Color;
  shallowColor?: THREE.Color;
  midColor?: THREE.Color;
  deepColor?: THREE.Color;
  foamColor?: THREE.Color;
  fogColor?: THREE.Color;
  fogNear?: number;
  fogFar?: number;
  waveAmplitude?: number;
  waveChoppiness?: number;
  stormIntensity?: number;
  windDirX?: number;
  windDirZ?: number;
  windIntensity?: number;
  sunGlintIntensity?: number;
  causticsIntensity?: number;
  sunsetFactor?: number;
  nightFactor?: number;
  lightningFlash?: number;
  shipX?: number;
  shipZ?: number;
  shipHeading?: number;
  shipSignedSpeedRatio?: number;
  shipAbsSpeedRatio?: number;
  shipTurnRate?: number;
  shipActive?: boolean;
}

export const WATER_VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uCoastOffset;
uniform float uWaveAmplitude;
uniform float uWaveChoppiness;
uniform float uStormIntensity;
uniform vec4 uIslandCoasts[6];
uniform vec3 uShipPos;     // (x, z, heading)
uniform vec2 uShipForward; // (fwdX, fwdZ)
uniform vec4 uShipMotion;  // (signedSpeedRatio, absSpeedRatio, turnRate, active)

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveHeight;
varying float vCrestFactor;
varying float vDistFromCoast;

float getIslandRadius(float angle, float baseRadius, bool mainIsland) {
  if (mainIsland) {
    return baseRadius
      + 2.2 * cos(angle * 2.0 - 0.5)
      + 1.5 * sin(angle * 3.0 + 0.9)
      + 1.0 * cos(angle * 5.0 - 0.3);
  }
  return baseRadius
    + 2.0 * cos(angle * 2.0 - 0.3)
    + 1.5 * sin(angle * 3.0 + 0.7)
    + 0.8 * cos(angle * 5.0 - 0.1);
}

// Onde de Gerstner : retourne le déplacement xyz, accumule tangente/bitangente et crête
vec3 gerstnerWave(
  vec2 pos,
  vec2 dir,
  float steepness,
  float wavelength,
  float speed,
  float time,
  inout vec3 tangent,
  inout vec3 binormal,
  inout float crestAcc
) {
  float k = 6.2831853 / wavelength;
  float c = sqrt(9.8 / k) * speed;
  vec2 d = normalize(dir);
  float f = k * (dot(d, pos) - c * time);
  float a = steepness / k;

  float sinF = sin(f);
  float cosF = cos(f);

  tangent += vec3(
    -d.x * d.x * (steepness * sinF),
    d.x * (steepness * cosF),
    -d.x * d.y * (steepness * sinF)
  );
  binormal += vec3(
    -d.x * d.y * (steepness * sinF),
    d.y * (steepness * cosF),
    -d.y * d.y * (steepness * sinF)
  );

  // Accumulation sélective sur les sommets raides uniquement (crêtes pincées)
  crestAcc += pow(max(0.0, sinF), 1.65) * steepness;

  return vec3(d.x * (a * cosF), a * sinF, d.y * (a * cosF));
}

void main() {
  vec4 worldBase = modelMatrix * vec4(position, 1.0);
  vec2 xz = worldBase.xz;

  float distFromCoast = 1.0e6;
  for (int i = 0; i < 6; i++) {
    vec4 island = uIslandCoasts[i];
    if (island.w < 0.5) continue;
    vec2 fromCenter = xz - island.xy;
    float angle = atan(fromCenter.y, fromCenter.x);
    float coastRadius = getIslandRadius(angle, island.z, i == 0) + uCoastOffset;
    distFromCoast = min(distFromCoast, length(fromCenter) - coastRadius);
  }

  // Atténuation côtière étanche : les vagues s'apaisent complètement avant le rivage
  float shoreDamp = smoothstep(0.2, 12.0, distFromCoast);
  float amp = uWaveAmplitude * mix(0.015, 1.0, shoreDamp);
  float chopScale = mix(0.62, 1.28, clamp(uWaveChoppiness, 0.0, 1.2));

  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 offset = vec3(0.0);
  float crestAcc = 0.0;

  // 6 trains d'ondes non harmoniques (somme des raideurs <= 0.84 même en tempête -> zéro repli)
  offset += gerstnerWave(xz, vec2(0.86, 0.51), 0.092 * amp, 27.0, 0.60, uTime * 1.00, tangent, binormal, crestAcc);
  offset += gerstnerWave(xz, vec2(-0.48, 0.88), 0.080 * amp, 18.7, 0.66, uTime * 1.07, tangent, binormal, crestAcc);
  offset += gerstnerWave(xz, vec2(0.27, -0.96), 0.068 * amp, 13.1, 0.74, uTime * 1.13, tangent, binormal, crestAcc);
  offset += gerstnerWave(xz, vec2(-0.92, -0.39), 0.056 * amp * chopScale, 8.6, 0.82, uTime * 1.21, tangent, binormal, crestAcc);
  offset += gerstnerWave(xz, vec2(0.62, -0.78), 0.044 * amp * chopScale, 5.5, 0.90, uTime * 1.31, tangent, binormal, crestAcc);
  offset += gerstnerWave(xz, vec2(-0.24, -0.97), 0.036 * amp * chopScale * (0.72 + 0.58 * uStormIntensity), 3.9, 1.00, uTime * 1.43, tangent, binormal, crestAcc);

  // Couplage hydrodynamique subtil autour du voilier (onde d'étrave & onde de Kelvin)
  if (uShipMotion.w > 0.5 && shoreDamp > 0.08) {
    vec2 rel = xz - uShipPos.xy;
    // Repère local canonique Three.js : proue = -Z, poupe = +Z, tribord = +X
    vec2 fwd = uShipForward;
    vec2 right = vec2(-fwd.y, fwd.x);
    float localZ = -dot(rel, fwd);
    float localX = dot(rel, right);

    float signedSpd = uShipMotion.x;
    float fwdSpd = max(0.0, signedSpd);
    float revSpd = max(0.0, -signedSpd);

    float bowWave = exp(-pow((localZ + 2.85) / 1.15, 2.0) - pow(localX / 1.85, 2.0)) * fwdSpd * 0.12;
    float behindMask = smoothstep(1.8, 3.6, localZ) * (1.0 - smoothstep(10.0, 22.0, localZ));
    float kelvinX = abs(localX) - (1.0 + max(0.0, localZ - 2.0) * 0.28);
    float kelvinRidge = exp(-pow(kelvinX / 1.1, 2.0)) * behindMask * fwdSpd * 0.09;
    float sternSurge = exp(-pow((localZ - 2.75) / 1.1, 2.0) - pow(localX / 1.7, 2.0)) * revSpd * 0.08;

    float shipDisp = (bowWave + kelvinRidge + sternSurge) * shoreDamp;
    offset.y += shipDisp;
    crestAcc += shipDisp * 0.85;
  }

  vec3 displacedWorld = worldBase.xyz + offset;
  // Bornes verticale HAUTE et BASSE progressives :
  // - Haut : ne traverse jamais les plages (y = 0)
  // - Bas  : ne descend jamais sous le fond marin des îles (TERRAIN_SEABED_DEPTH = -1.85) même en forte tempête !
  float maxOffshorePeak = mix(0.46, 0.96, clamp(uStormIntensity, 0.0, 1.0));
  float maxOffshoreTrough = mix(0.42, 0.88, clamp(uStormIntensity, 0.0, 1.0));
  float maxY = worldBase.y + mix(0.004, maxOffshorePeak, shoreDamp);
  float minY = worldBase.y - mix(0.015, maxOffshoreTrough, shoreDamp);
  displacedWorld.y = clamp(displacedWorld.y, minY, maxY);

  vec3 normal = normalize(cross(binormal, tangent));

  vWorldPos = displacedWorld;
  vNormal = normal;
  vWaveHeight = displacedWorld.y - worldBase.y;
  vCrestFactor = clamp(crestAcc * 1.55, 0.0, 1.6);
  vDistFromCoast = distFromCoast;

  gl_Position = projectionMatrix * viewMatrix * vec4(displacedWorld, 1.0);
}
`;

export const WATER_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3 uShallowColor;
uniform vec3 uMidColor;
uniform vec3 uDeepColor;
uniform vec3 uFoamColor;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform vec3 uSkyReflectColor;
uniform vec3 uHorizonReflectColor;
uniform float uCoastOffset;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform sampler2D uCoastMask;
uniform float uUseCoastMask;
uniform float uCoastMaskHalfSize;
uniform vec4 uIslandCoasts[6];

uniform float uStormIntensity;
uniform float uWaveChoppiness;
uniform vec2 uWindDir;
uniform float uWindIntensity;
uniform float uSunGlintIntensity;
uniform float uCausticsIntensity;
uniform float uSunsetFactor;
uniform float uNightFactor;
uniform float uLightningFlash;

uniform vec3 uShipPos;     // (x, z, heading)
uniform vec2 uShipForward; // (fwdX, fwdZ)
uniform vec4 uShipMotion;  // (signedSpeedRatio, absSpeedRatio, turnRate, active)

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveHeight;
varying float vCrestFactor;
varying float vDistFromCoast;

// --- Simplex Noise 2D (Ashima / Gustavson) ---
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

float snoise(vec2 v) {
  const vec4 C = vec4(
    0.211324865405187,
    0.366025403784439,
    -0.577350269189626,
    0.024390243902439
  );
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float val = 0.0;
  float amp = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    val += amp * snoise(p);
    p = rot * p * 2.07;
    amp *= 0.5;
  }
  return val;
}

float getIslandRadius(float angle, float baseRadius, bool mainIsland) {
  if (mainIsland) {
    return baseRadius
      + 2.2 * cos(angle * 2.0 - 0.5)
      + 1.5 * sin(angle * 3.0 + 0.9)
      + 1.0 * cos(angle * 5.0 - 0.3);
  }
  return baseRadius
    + 2.0 * cos(angle * 2.0 - 0.3)
    + 1.5 * sin(angle * 3.0 + 0.7)
    + 0.8 * cos(angle * 5.0 - 0.1);
}

// Hauteur micro-vagues fluides et anisotropes (étirées le long des crêtes comme de vraies vagues marines)
float sampleDetailWaveHeight(vec2 p, float t, vec2 windDir, float chop) {
  vec2 windPerp = vec2(-windDir.y, windDir.x);
  // Repère aligné au vent (x = direction de propagation, y = le long des crêtes)
  vec2 wCoord = vec2(dot(p, windDir), dot(p, windPerp));

  // Rotations secondaires non harmoniques pour croiser la houle sans jamais répéter
  const mat2 rotB = mat2(0.8387, -0.5446, 0.5446, 0.8387);
  const mat2 rotC = mat2(0.4695, 0.8829, -0.8829, 0.4695);

  // Couche 1 : ondulations gravitaires douces étirées le long des crêtes (ratio 2.2:1)
  vec2 p1 = vec2(wCoord.x * 0.24 - t * (0.42 + 0.28 * chop), wCoord.y * 0.11 + t * 0.05);
  float n1 = snoise(p1);
  // Profil trochoïdal doux (crêtes légèrement plus bombées, creux larges)
  float w1 = n1 - 0.18 * n1 * n1;

  // Couche 2 : houle secondaire croisée avec léger domain-warp organique
  vec2 q2 = rotB * p;
  vec2 p2 = vec2(q2.x * 0.36 + t * 0.34, q2.y * 0.18 - t * 0.16) + vec2(n1 * 0.28, -n1 * 0.22);
  float w2 = snoise(p2);

  // Couche 3 : rides capillaires directionnelles fines portées par le vent
  vec2 p3 = vec2(wCoord.x * 0.74 - t * (0.78 + 0.55 * chop), wCoord.y * 0.38 + t * 0.14);
  float w3 = snoise(p3);

  // Couche 4 : micro-clapot croisé très fin (renforcé pendant les rafales de tempête)
  vec2 q4 = rotC * p;
  vec2 p4 = vec2(q4.x * 1.35 + t * 0.65, q4.y * 0.85 - t * 0.52);
  float w4 = snoise(p4);

  return w1 * 0.48 + w2 * 0.30 + w3 * (0.14 + 0.07 * chop) + w4 * (0.06 + 0.07 * chop);
}

// Caustiques solaires sous-marines organiques dans les hauts-fonds clairs
float computeCaustics(vec2 p, float t) {
  vec2 uv1 = p * 0.28 + vec2(t * 0.14, -t * 0.10);
  vec2 uv2 = p * 0.36 + vec2(-t * 0.12, t * 0.16);
  float warpA = snoise(uv2 * 0.85);
  float warpB = snoise(uv1 * 0.85);
  float n1 = snoise(uv1 + vec2(warpA, warpB) * 0.6);
  float n2 = snoise(uv2 - vec2(warpB, warpA) * 0.6);
  float ridge = 1.0 - abs(n1 + n2) * 0.62;
  return pow(clamp(ridge, 0.0, 1.0), 5.0);
}

void main() {
  vec2 xz = vWorldPos.xz;

  // 1. Distance exacte au rivage des 6 îles
  float distCoast = 1.0e6;
  float nearestAngle = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 island = uIslandCoasts[i];
    if (island.w < 0.5) continue;
    vec2 fromCenter = xz - island.xy;
    float islAngle = atan(fromCenter.y, fromCenter.x);
    float coastRadius = getIslandRadius(islAngle, island.z, i == 0) + uCoastOffset;
    float d = length(fromCenter) - coastRadius;
    if (d < distCoast) {
      distCoast = d;
      nearestAngle = islAngle;
    }
  }
  if (distCoast > 1.0e5) {
    distCoast = vDistFromCoast;
  }

  if (uUseCoastMask > 0.5) {
    vec2 maskUv = (xz / (uCoastMaskHalfSize * 2.0)) + 0.5;
    maskUv.y = 1.0 - maskUv.y;
    if (maskUv.x >= 0.0 && maskUv.x <= 1.0 && maskUv.y >= 0.0 && maskUv.y <= 1.0) {
      float maskVal = texture2D(uCoastMask, maskUv).r;
      distCoast = mix(distCoast, (maskVal - 0.5) * 20.0, 0.5);
    }
  }

  // Perturbation organique du fond marin / trait de côte
  float shoreNoise = fbm(xz * 0.14 + vec2(uTime * 0.05, -uTime * 0.04));
  float organicDist = distCoast + shoreNoise * 1.1;
  float shoreCalm = smoothstep(0.15, 7.5, distCoast);

  // 2. Normales micro-vagues fluides et réalistes (calibrées pour un aspect liquide soyeux, 0 effet aluminium)
  float camDist = length(cameraPosition - vWorldPos);
  float detailFade = 1.0 - smoothstep(46.0, 155.0, camDist);
  float eps = mix(0.26, 0.52, 1.0 - detailFade);
  float chop = clamp(uWaveChoppiness, 0.25, 1.15);

  float hC = sampleDetailWaveHeight(xz, uTime, uWindDir, chop);
  float hX = sampleDetailWaveHeight(xz + vec2(eps, 0.0), uTime, uWindDir, chop);
  float hZ = sampleDetailWaveHeight(xz + vec2(0.0, eps), uTime, uWindDir, chop);

  // Pente réaliste d'eau liquide : ~0.20 en mer calme -> ~0.34 en tempête
  float normalStrength = mix(0.11, 0.21 + 0.13 * uStormIntensity, shoreCalm) * (0.45 + 0.55 * detailFade);
  vec3 microSlope = vec3((hC - hX) / eps * normalStrength, 0.0, (hC - hZ) / eps * normalStrength);

  // 3. Interaction directe eau <-> bateau (ondulations au mouillage, remous de virage, recul, ombre de coque)
  float shipHullShadow = 1.0;
  float shipWaterFoam = 0.0;
  float shipTurbulence = 0.0;
  vec3 shipRippleSlope = vec3(0.0);

  if (uShipMotion.w > 0.5 && distCoast > 0.05) {
    vec2 rel = xz - uShipPos.xy;
    float relDistSq = dot(rel, rel);
    if (relDistSq < 380.0) {
      vec2 fwd = uShipForward;
      vec2 right = vec2(-fwd.y, fwd.x);
      // Repère Three.js : proue = -Z, poupe = +Z, tribord = +X, bâbord = -X
      float localZ = -dot(rel, fwd);
      float localX = dot(rel, right);

      float signedSpd = uShipMotion.x;
      float absSpd = uShipMotion.y;
      float turnRate = uShipMotion.z;
      float fwdSpd = max(0.0, signedSpd);
      float revSpd = max(0.0, -signedSpd);
      float waterMask = smoothstep(0.15, 1.6, distCoast);

      // Ombre / contact doux sous la coque elliptique pour ancrer le bateau dans l'eau
      float hullEllip = length(vec2(localX / 1.52, localZ / 2.65));
      float underHull = 1.0 - smoothstep(0.58, 1.28, hullEllip);
      shipHullShadow = 1.0 - underHull * 0.42 * waterMask;

      // Ondulations concentriques autour de la coque (bien lisibles à l'arrêt & à basse vitesse)
      float ringDist = max(0.0, hullEllip - 0.92);
      float idleWeight = mix(0.92, 0.32, clamp(absSpd, 0.0, 1.0));
      float ringEnv = smoothstep(0.0, 0.16, ringDist) * (1.0 - smoothstep(0.35, 2.45, ringDist)) * waterMask;
      float ringPhase = ringDist * 14.5 - uTime * (3.0 + 1.8 * absSpd);
      float ringSlopeMag = cos(ringPhase) * ringEnv * idleWeight * 0.16;
      vec2 radialDir = normalize(rel + vec2(0.0001));
      shipRippleSlope += vec3(radialDir.x * ringSlopeMag, 0.0, radialDir.y * ringSlopeMag);

      // Coussinet d'eau aérée à l'étrave & remous proche du gouvernail (se fond dans le ruban ShipRenderer sans double sillage)
      if (fwdSpd > 0.04) {
        float churnNoise = snoise(xz * 2.2 - fwd * uTime * 2.6);
        float fineLaceShip = clamp(0.5 + 0.5 * churnNoise, 0.0, 1.0);
        // Coussinet d'étrave doux collé à la proue
        float bowZone = exp(-pow((localZ + 2.45) / 0.95, 2.0) - pow(localX / 1.4, 2.0)) * fwdSpd * waterMask;
        // Remous turbulent juste derrière l'étambot (z ∈ [1.8..4.8]) qui rejoint la tête du ruban
        float sternChurn = exp(-pow((localZ - 2.65) / 1.35, 2.0) - pow(localX / (1.05 + abs(turnRate) * 0.35), 2.0)) * fwdSpd * waterMask;
        float closeSignal = bowZone * 0.72 + sternChurn * 0.65;
        shipWaterFoam += closeSignal * smoothstep(0.28, 0.85, fineLaceShip) * 0.42;
        shipTurbulence += closeSignal * 0.78;

        // Micro-perturbation des normales le long de la coque et du gouvernail
        float wakeRipple = snoise(xz * 2.4 + vec2(uTime * 1.2, -uTime * 0.9));
        shipRippleSlope += vec3(right.x, 0.0, right.y) * (wakeRipple * closeSignal * 0.18);
      }

      // Marche arrière : bouillonnement organique concentré à la poupe
      if (revSpd > 0.04) {
        float revChurn = exp(-pow((localZ - 2.35) / 1.25, 2.0) - pow(localX / 1.5, 2.0)) * revSpd * waterMask;
        float churnNoise = snoise(xz * 2.4 + fwd * uTime * 2.1);
        shipWaterFoam += revChurn * smoothstep(-0.05, 0.68, churnNoise + 0.25) * 0.48;
        shipTurbulence += revChurn * 0.72;
      }
    }
  }

  vec3 N = normalize(vec3(
    vNormal.x + microSlope.x + shipRippleSlope.x,
    max(0.45, vNormal.y),
    vNormal.z + microSlope.z + shipRippleSlope.z
  ));
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDirection);

  // 4. Absorption de profondeur Beer-Lambert (plages claires turquoise -> azur -> bleu dense au large)
  float shallowFactor = exp(-max(0.0, organicDist) * 0.185);
  float midFactor = exp(-max(0.0, organicDist) * 0.055);
  vec3 waterBody = mix(uDeepColor, uMidColor, clamp(midFactor, 0.0, 1.0));
  waterBody = mix(waterBody, uShallowColor, clamp(shallowFactor, 0.0, 1.0));

  // Subtile variation organique des courants et bancs marins
  float depthVar = snoise(xz * 0.05) * 0.5 + 0.5;
  waterBody = mix(waterBody, uMidColor * 0.9, depthVar * 0.14 * (1.0 - shallowFactor));

  // Translucidité sableuse douce juste au bord de la plage
  float sandEdge = (1.0 - smoothstep(-0.3, 2.5, organicDist)) * smoothstep(-1.2, 0.15, distCoast);
  vec3 wetSandColor = mix(vec3(0.48, 0.49, 0.37), vec3(0.14, 0.22, 0.25), clamp(uNightFactor * 0.85 + uStormIntensity * 0.55, 0.0, 1.0));
  waterBody = mix(waterBody, wetSandColor, sandEdge * 0.44);

  // Eau aérée turquoise dans les remous du bateau
  vec3 aeratedTint = mix(uShallowColor, uFoamColor, 0.32);
  waterBody = mix(waterBody, aeratedTint, clamp(shipTurbulence * 0.45, 0.0, 0.55));

  // 5. Caustiques solaires lumineuses dans les hauts-fonds clairs
  float shallowMask = (1.0 - smoothstep(0.4, 13.0, organicDist)) * smoothstep(-0.8, 0.35, distCoast);
  float caustics = computeCaustics(xz, uTime);
  vec3 causticColor = mix(vec3(0.24, 0.44, 0.40), uSunColor * 0.52, 0.42 + 0.35 * uSunsetFactor);
  waterBody += causticColor * caustics * shallowMask * uCausticsIntensity * 0.54;

  // 6. Éclairage diffus fluide + Subsurface Scattering (translucidité émeraude/dorée dans les crêtes)
  float NdotL = max(dot(N, L), 0.0);
  vec3 directDiff = uSunColor * (0.34 + 0.66 * NdotL) * mix(0.62, 0.38, uStormIntensity);
  vec3 hemiDiff = mix(uAmbientColor * 0.54, uSkyReflectColor * 0.48, 0.5);
  vec3 litWater = waterBody * (0.50 + directDiff * 0.52 + hemiDiff * 0.42);

  // Contraste creux sombres / crêtes plus claires pour une houle 3D immédiatement lisible
  float troughShade = clamp(0.84 + vWaveHeight * 0.42, 0.68, 1.22);
  litWater *= troughShade * shipHullShadow;

  // Subsurface scattering émeraude/doré à travers les crêtes rétro-éclairées
  vec3 sssDir = normalize(L + N * 0.42);
  float backLight = pow(clamp(dot(V, -sssDir), 0.0, 1.0), 2.8);
  float crestThinness = clamp(vWaveHeight * 1.55 + vCrestFactor * 0.45 + 0.14, 0.0, 1.0);
  float sssStrength = (0.36 * NdotL + 0.64 * backLight) * crestThinness * (1.0 - uNightFactor * 0.80);
  vec3 sssTint = mix(vec3(0.05, 0.34, 0.33), vec3(0.30, 0.24, 0.11), uSunsetFactor * 0.68);
  sssTint = mix(sssTint, vec3(0.07, 0.21, 0.24), uStormIntensity * 0.72);
  litWater += sssTint * sssStrength * (0.52 + 0.30 * uStormIntensity);

  // 7. Fresnel Schlick + Reflet du ciel, nuages mouvants et lueur d'horizon
  float NdotV = max(dot(N, V), 0.0);
  float fresnel = 0.024 + 0.976 * pow(1.0 - NdotV, 4.6);
  vec3 R = reflect(-V, N);
  float skyGrad = smoothstep(-0.08, 0.65, R.y);
  vec3 skyReflect = mix(uHorizonReflectColor, uSkyReflectColor, skyGrad);

  // Nuages doux reflétés sur le miroir de l'océan
  vec2 cloudUv = (xz * 0.016 + R.xz * 0.42) - uWindDir * (uTime * 0.035);
  float clouds = smoothstep(-0.18, 0.70, fbm(cloudUv));
  vec3 cloudReflectTint = mix(uHorizonReflectColor * 1.08, uSkyReflectColor * 0.86, uStormIntensity * 0.65);
  skyReflect = mix(skyReflect, cloudReflectTint, clouds * (0.20 + 0.22 * uStormIntensity));

  // Reflet doré rasant au coucher de soleil
  float sunAlign = pow(max(dot(R, L), 0.0), 5.5);
  skyReflect += uSunColor * sunAlign * (0.20 + 0.48 * uSunsetFactor) * (1.0 - uStormIntensity * 0.72);

  // Reflet électrique bref pendant les éclairs
  skyReflect += vec3(0.45, 0.56, 0.72) * uLightningFlash * (0.55 + 0.45 * clouds);

  float reflectMix = clamp(fresnel * mix(0.62, 0.76, uStormIntensity * 0.4 + uSunsetFactor * 0.3), 0.0, 0.82);
  vec3 color = mix(litWater, skyReflect, reflectMix);

  // 8. Reflets solaires / lunaires réalistes, soyeux & mobiles (zéro bruit métallique)
  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);

  // Lobe large soyeux (chemin doré du soleil ou reflet lunaire argenté sur les pentes de houle)
  float roughPower = mix(96.0, 38.0, uStormIntensity * 0.75);
  float broadSpec = pow(NdotH, roughPower) * mix(0.46, 0.16, uStormIntensity) * uSunGlintIntensity;

  // Étincelles fines et sélectives uniquement sur les facettes alignées avec le soleil/lune
  float glintNoiseA = snoise(xz * 1.4 + vec2(uTime * 1.05, -uTime * 0.82));
  float glintNoiseB = snoise(xz * 2.6 + vec2(-uTime * 1.25, uTime * 0.95));
  float microMask = smoothstep(0.32, 0.84, glintNoiseA * 0.58 + glintNoiseB * 0.42);
  float sharpGlint = pow(NdotH, 320.0) * microMask * 1.32 * uSunGlintIntensity;

  vec3 specContrib = min(uSunColor * (broadSpec + sharpGlint), vec3(0.88));
  color += specContrib;

  // 9. Écume organique filandreuse (rivage + crêtes cassées + sillons de vent tempête + bateau)
  vec2 windPerp = vec2(-uWindDir.y, uWindDir.x);
  vec2 windCoords = vec2(dot(xz, uWindDir), dot(xz, windPerp));

  // Dentelle fine multi-échelle (filaments déchirés par le vent, 0 mur blanc uniforme)
  float laceA = snoise(xz * 1.45 - uWindDir * (uTime * 0.35));
  float laceB = snoise(xz * 3.4 + vec2(uTime * 0.28, -uTime * 0.24));
  float laceC = snoise(vec2(windCoords.x * 0.55 - uTime * 0.22, windCoords.y * 2.1));
  float wispyLace = clamp(0.45 + 0.30 * laceA + 0.22 * laceB + 0.28 * laceC, 0.0, 1.0);
  float streakNoise = fbm(vec2(windCoords.x * 0.11 - uTime * 0.16, windCoords.y * 0.62));

  // 9a. Déferlantes et liseré d'écume côtière (strictement côté mer, atténué sur la plage)
  float seaSideMask = smoothstep(-0.2, 0.22, distCoast);
  float tidePulse = sin(uTime * 1.8 + nearestAngle * 5.0 + shoreNoise * 2.4) * (0.26 + 0.20 * uStormIntensity);
  float shoreContact = (1.0 - smoothstep(-0.12, 1.35 + tidePulse, distCoast + laceA * 0.38))
    * seaSideMask
    * smoothstep(0.20, 0.72, wispyLace + (1.0 - smoothstep(0.0, 0.85, distCoast)) * 0.55);

  float swashPhase = distCoast * 1.95 - uTime * (2.25 + 0.75 * uStormIntensity) + shoreNoise * 2.8;
  float swashCrest = smoothstep(0.70, 0.96, sin(swashPhase));
  float swashEnv = smoothstep(0.25, 1.15, distCoast) * (1.0 - smoothstep(1.9, 5.2 + uStormIntensity * 1.4, distCoast));
  float shoreSwash = swashCrest * swashEnv * smoothstep(0.32, 0.80, wispyLace) * (0.58 + 0.24 * uStormIntensity);

  // 9b. Moutons / crêtes d'écume organiques (fragmentés sur les sommets raides uniquement !)
  float offshoreMask = smoothstep(3.8, 13.0, distCoast);
  float crestSignal = vCrestFactor * 0.62 + max(0.0, vWaveHeight) * 0.72 + (laceA * 0.12);
  float crestLo = mix(0.56, 0.44, uStormIntensity);
  float crestHi = crestLo + mix(0.34, 0.46, uStormIntensity);
  float whitecapBase = smoothstep(crestLo, crestHi, crestSignal);
  // Perforation en filaments d'écume pour garder l'eau sombre visible entre les crêtes blanches
  float filamentCut = smoothstep(0.46, 0.86, wispyLace) * smoothstep(-0.15, 0.55, laceC + 0.22);
  float whitecaps = whitecapBase * filamentCut * offshoreMask * mix(0.52, 0.86, uStormIntensity);

  // 9c. Sillons fins d'écume poussés par le vent pendant les tempêtes (Langmuir windrows)
  float windRow = smoothstep(0.46, 0.88, streakNoise)
    * smoothstep(0.48, 0.86, wispyLace)
    * smoothstep(5.5, 16.0, distCoast)
    * uStormIntensity * uWindIntensity * 0.34;

  float totalFoam = clamp(
    shoreContact * 0.86 + shoreSwash * 0.64 + whitecaps + windRow + shipWaterFoam * 0.80,
    0.0,
    0.90
  );

  // Éclairage cohérent de l'écume (strictement <= 0.79 linéaire sous seuil Bloom 0.85)
  vec3 foamLight = min(uFoamColor * (0.72 + 0.22 * NdotL + uLightningFlash * 0.22), vec3(0.79));
  color = mix(color, foamLight, totalFoam);

  // Plafonne la base diffuse hors micro-étincelles pour respecter strictement le seuil Bloom 0.85
  color = min(color, vec3(0.80) + specContrib * 0.20);

  // 10. Brouillard atmosphérique aligné exactement sur THREE.Fog de la scène
  float fogFactor = clamp((camDist - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  color = mix(color, uFogColor, fogFactor);

  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

export function createWaterMaterial(
  options: WaterMaterialOptions = {},
): THREE.ShaderMaterial {
  const sunDir = (options.sunDirection ?? new THREE.Vector3(20, 44, -14)).clone().normalize();

  return new THREE.ShaderMaterial({
    name: 'FelingardWaterShader',
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    transparent: false,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uShallowColor: { value: new THREE.Color(options.shallowColor ?? 0x29bab5) },
      uMidColor: { value: new THREE.Color(options.midColor ?? 0x126e9e) },
      uDeepColor: { value: new THREE.Color(options.deepColor ?? 0x072e54) },
      uFoamColor: { value: new THREE.Color(options.foamColor ?? 0xd5e6ec) },
      uSunDirection: { value: sunDir },
      uSunColor: { value: new THREE.Color(options.sunColor ?? 0xfff6dc) },
      uAmbientColor: { value: new THREE.Color(0xfff5e4) },
      uSkyReflectColor: { value: new THREE.Color(0x307ab8) },
      uHorizonReflectColor: { value: new THREE.Color(0x8fcbe0) },
      uCoastOffset: { value: options.coastOffset ?? 0.6 },
      uWaveAmplitude: { value: options.waveAmplitude ?? 1.18 },
      uWaveChoppiness: { value: 0.48 },
      uStormIntensity: { value: 0.0 },
      uWindDir: { value: new THREE.Vector2(0.86, 0.51) },
      uWindIntensity: { value: 0.2 },
      uSunGlintIntensity: { value: 1.05 },
      uCausticsIntensity: { value: 0.9 },
      uSunsetFactor: { value: 0.0 },
      uNightFactor: { value: 0.0 },
      uLightningFlash: { value: 0.0 },
      uFogColor: { value: new THREE.Color(options.fogColor ?? 0x3f8cb3) },
      uFogNear: { value: options.fogNear ?? 115 },
      uFogFar: { value: options.fogFar ?? 265 },
      uCoastMask: { value: options.coastMask ?? null },
      uUseCoastMask: { value: options.coastMask ? 1.0 : 0.0 },
      uCoastMaskHalfSize: { value: options.coastMaskHalfSize ?? 60.0 },
      uIslandCoasts: {
        value:
          options.coastIslands ??
          [
            new THREE.Vector4(0, 0, 52.5, 1),
            new THREE.Vector4(10000, 10000, 0, 0),
            new THREE.Vector4(10000, 10000, 0, 0),
            new THREE.Vector4(10000, 10000, 0, 0),
            new THREE.Vector4(10000, 10000, 0, 0),
            new THREE.Vector4(10000, 10000, 0, 0),
          ],
      },
      uShipPos: { value: new THREE.Vector3(0, 53.03, 0) },
      uShipForward: { value: new THREE.Vector2(0, -1) },
      uShipMotion: { value: new THREE.Vector4(0, 0, 0, 0) },
    },
  });
}

/**
 * Met à jour les uniforms du shader océanique en place (0 allocation par frame).
 * Compatible avec l'ancienne signature `(material, time, sunDirection?)` et le paquet `WaterDynamicUpdate`.
 */
export function updateWaterMaterial(
  material: THREE.ShaderMaterial,
  timeOrUpdate: number | WaterDynamicUpdate,
  sunDirection?: THREE.Vector3,
): void {
  const u = material.uniforms;
  if (typeof timeOrUpdate === 'number') {
    if (u.uTime) u.uTime.value = timeOrUpdate;
    if (sunDirection && u.uSunDirection) {
      (u.uSunDirection.value as THREE.Vector3).copy(sunDirection).normalize();
    }
    return;
  }

  const p = timeOrUpdate;
  if (u.uTime) u.uTime.value = p.time;
  if (p.sunDirection && u.uSunDirection) {
    (u.uSunDirection.value as THREE.Vector3).copy(p.sunDirection).normalize();
  }
  if (p.sunColor && u.uSunColor) (u.uSunColor.value as THREE.Color).copy(p.sunColor);
  if (p.ambientColor && u.uAmbientColor) {
    (u.uAmbientColor.value as THREE.Color).copy(p.ambientColor);
  }
  if (p.skyReflectColor && u.uSkyReflectColor) {
    (u.uSkyReflectColor.value as THREE.Color).copy(p.skyReflectColor);
  }
  if (p.horizonReflectColor && u.uHorizonReflectColor) {
    (u.uHorizonReflectColor.value as THREE.Color).copy(p.horizonReflectColor);
  }
  if (p.shallowColor && u.uShallowColor) {
    (u.uShallowColor.value as THREE.Color).copy(p.shallowColor);
  }
  if (p.midColor && u.uMidColor) (u.uMidColor.value as THREE.Color).copy(p.midColor);
  if (p.deepColor && u.uDeepColor) (u.uDeepColor.value as THREE.Color).copy(p.deepColor);
  if (p.foamColor && u.uFoamColor) (u.uFoamColor.value as THREE.Color).copy(p.foamColor);
  if (p.fogColor && u.uFogColor) (u.uFogColor.value as THREE.Color).copy(p.fogColor);
  if (p.fogNear !== undefined && u.uFogNear) u.uFogNear.value = p.fogNear;
  if (p.fogFar !== undefined && u.uFogFar) u.uFogFar.value = p.fogFar;
  if (p.waveAmplitude !== undefined && u.uWaveAmplitude) u.uWaveAmplitude.value = p.waveAmplitude;
  if (p.waveChoppiness !== undefined && u.uWaveChoppiness) {
    u.uWaveChoppiness.value = p.waveChoppiness;
  }
  if (p.stormIntensity !== undefined && u.uStormIntensity) {
    u.uStormIntensity.value = p.stormIntensity;
  }
  if (p.windDirX !== undefined && p.windDirZ !== undefined && u.uWindDir) {
    (u.uWindDir.value as THREE.Vector2).set(p.windDirX, p.windDirZ);
  }
  if (p.windIntensity !== undefined && u.uWindIntensity) u.uWindIntensity.value = p.windIntensity;
  if (p.sunGlintIntensity !== undefined && u.uSunGlintIntensity) {
    u.uSunGlintIntensity.value = p.sunGlintIntensity;
  }
  if (p.causticsIntensity !== undefined && u.uCausticsIntensity) {
    u.uCausticsIntensity.value = p.causticsIntensity;
  }
  if (p.sunsetFactor !== undefined && u.uSunsetFactor) u.uSunsetFactor.value = p.sunsetFactor;
  if (p.nightFactor !== undefined && u.uNightFactor) u.uNightFactor.value = p.nightFactor;
  if (p.lightningFlash !== undefined && u.uLightningFlash) {
    u.uLightningFlash.value = p.lightningFlash;
  }

  if (p.shipActive !== undefined && u.uShipMotion) {
    const active = p.shipActive ? 1.0 : 0.0;
    const heading = p.shipHeading ?? 0;
    if (u.uShipPos && p.shipX !== undefined && p.shipZ !== undefined) {
      (u.uShipPos.value as THREE.Vector3).set(p.shipX, p.shipZ, heading);
    }
    if (u.uShipForward) {
      // Convention canonique Three.js : forward(angle) = (-sin(angle), -cos(angle))
      (u.uShipForward.value as THREE.Vector2).set(-Math.sin(heading), -Math.cos(heading));
    }
    (u.uShipMotion.value as THREE.Vector4).set(
      p.shipSignedSpeedRatio ?? 0,
      p.shipAbsSpeedRatio ?? 0,
      p.shipTurnRate ?? 0,
      active,
    );
  }
}

/**
 * Crée une géométrie océanique densément subdivisée pour animer les 6 trains de Gerstner en vertex.
 */
export function createWaterGeometry(size = 480, segments = 288): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Helper prêt à l'emploi créant le Mesh complet de l'océan de Félingard (exclu du SSAO).
 */
export function createWaterMesh(
  options: WaterMaterialOptions & { size?: number; segments?: number; y?: number } = {},
): THREE.Mesh {
  const geo = createWaterGeometry(options.size ?? 480, options.segments ?? 288);
  const mat = createWaterMaterial(options);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'FelingardOcean';
  mesh.position.set(0, options.y ?? -0.14, 0);
  mesh.renderOrder = -1;
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.userData.skipSSAO = true;
  return mesh;
}

const DEFAULT_COAST_ISLANDS: readonly OceanCoastIsland[] = [
  { x: 0, z: 0, radius: 52.5, isMain: true },
];

// Miroir mathématique EXACT des 6 trains d'ondes de WATER_VERTEX_SHADER
const GERSTNER_WAVES = [
  { dx: 0.86, dz: 0.51, steepness: 0.092, wavelength: 27.0, speed: 0.6, timeScale: 1.0, usesChop: false, stormBoost: false },
  { dx: -0.48, dz: 0.88, steepness: 0.08, wavelength: 18.7, speed: 0.66, timeScale: 1.07, usesChop: false, stormBoost: false },
  { dx: 0.27, dz: -0.96, steepness: 0.068, wavelength: 13.1, speed: 0.74, timeScale: 1.13, usesChop: false, stormBoost: false },
  { dx: -0.92, dz: -0.39, steepness: 0.056, wavelength: 8.6, speed: 0.82, timeScale: 1.21, usesChop: true, stormBoost: false },
  { dx: 0.62, dz: -0.78, steepness: 0.044, wavelength: 5.5, speed: 0.9, timeScale: 1.31, usesChop: true, stormBoost: false },
  { dx: -0.24, dz: -0.97, steepness: 0.036, wavelength: 3.9, speed: 1.0, timeScale: 1.43, usesChop: true, stormBoost: true },
].map((w) => {
  const len = Math.hypot(w.dx, w.dz) || 1;
  const k = 6.2831853 / w.wavelength;
  const c = Math.sqrt(9.8 / k) * w.speed;
  return {
    dx: w.dx / len,
    dz: w.dz / len,
    steepness: w.steepness,
    k,
    c,
    timeScale: w.timeScale,
    usesChop: w.usesChop,
    stormBoost: w.stormBoost,
  };
});

function sampleIslandRadiusJs(angle: number, baseRadius: number, mainIsland: boolean): number {
  if (mainIsland) {
    return (
      baseRadius +
      2.2 * Math.cos(angle * 2.0 - 0.5) +
      1.5 * Math.sin(angle * 3.0 + 0.9) +
      1.0 * Math.cos(angle * 5.0 - 0.3)
    );
  }
  return (
    baseRadius +
    2.0 * Math.cos(angle * 2.0 - 0.3) +
    1.5 * Math.sin(angle * 3.0 + 0.7) +
    0.8 * Math.cos(angle * 5.0 - 0.1)
  );
}

function glslSmoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Calcule la distance signée minimale (en unités monde) entre `(x, z)` et la ligne d'eau des 6 îles.
 * > 0 en mer, <= 0 sur terre.
 */
export function sampleOceanCoastDistance(
  x: number,
  z: number,
  coastIslands?: ReadonlyArray<OceanCoastIsland>,
  coastOffset = 0.6,
): number {
  const islands =
    coastIslands && coastIslands.length > 0 ? coastIslands : DEFAULT_COAST_ISLANDS;

  let distFromCoast = 1.0e6;
  for (let i = 0; i < islands.length; i++) {
    const isl = islands[i];
    const fx = x - isl.x;
    const fz = z - isl.z;
    const angle = Math.atan2(fz, fx);
    const coastR =
      sampleIslandRadiusJs(angle, isl.radius, isl.isMain ?? i === 0) + coastOffset;
    const d = Math.hypot(fx, fz) - coastR;
    if (d < distFromCoast) {
      distFromCoast = d;
    }
  }
  return distFromCoast;
}

/**
 * Échantillonne en TypeScript pur la hauteur verticale (offset Y autour de `WATER_LEVEL_Y`)
 * produite par les 6 ondes de Gerstner + atténuation côtière `shoreDamp` de `WATER_VERTEX_SHADER`.
 * Permet au voilier et à son sillage de suivre la houle visuelle en phase exacte (calme & tempête).
 */
export function sampleOceanWaveHeight(
  x: number,
  z: number,
  time: number,
  coastIslands?: ReadonlyArray<OceanCoastIsland>,
  coastOffset = 0.6,
  waveAmplitude = 1.0,
  waveChoppiness = 0.48,
  stormIntensity = 0.0,
): number {
  const distFromCoast = sampleOceanCoastDistance(x, z, coastIslands, coastOffset);
  const shoreDamp = glslSmoothstep(0.2, 12.0, distFromCoast);
  const amp = waveAmplitude * (0.015 + 0.985 * shoreDamp);
  const clampedChop = Math.max(0, Math.min(1.2, waveChoppiness));
  const chopScale = 0.62 + (1.28 - 0.62) * clampedChop;
  const clampedStorm = Math.max(0, Math.min(1, stormIntensity));

  let offsetY = 0;
  for (let i = 0; i < GERSTNER_WAVES.length; i++) {
    const w = GERSTNER_WAVES[i];
    const f = w.k * (w.dx * x + w.dz * z - w.c * (time * w.timeScale));
    let steep = w.steepness * amp;
    if (w.usesChop) steep *= chopScale;
    if (w.stormBoost) steep *= 0.72 + 0.58 * clampedStorm;
    const a = steep / w.k;
    offsetY += a * Math.sin(f);
  }

  const maxOffshorePeak = 0.46 + (0.96 - 0.46) * clampedStorm;
  const maxOffshoreTrough = 0.42 + (0.88 - 0.42) * clampedStorm;
  const maxY = 0.004 + (maxOffshorePeak - 0.004) * shoreDamp;
  const minY = -(0.015 + (maxOffshoreTrough - 0.015) * shoreDamp);
  return Math.max(minY, Math.min(offsetY, maxY));
}
