import * as THREE from 'three';

// ============================================================================
// Shaders GLSL sur mesure pour les 4 Sorts VF + Effets Divins & Boussole
// Valeurs HDR > 1.0 calibrées pour déclencher le UnrealBloomPass sélectif
// (threshold: 0.85, strength: 0.48) sans jamais cramer la scène !
// ============================================================================

const SHARED_NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbmNoise(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.05;
    a *= 0.5;
  }
  return v;
}
`;

// ============================================================================
// 1. FLAMME-RONRON : Anneau de feu incandescent + Heat Haze (distorsion chaleur)
// ============================================================================

export const FLAME_RING_VERTEX_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FLAME_RING_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;

varying vec2 vUv;

${SHARED_NOISE_GLSL}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;

  float angle = atan(p.y, p.x);
  float prog = clamp(uProgress, 0.0, 1.0);
  float fadeOut = 1.0 - smoothstep(0.65, 1.0, prog);

  // Vortex de flammes turbulent en expansion radiale
  float spiralAngle = angle + r * 2.4 - uTime * 4.2;
  vec2 polarUv = vec2(spiralAngle * 1.9, r * 5.2 - uTime * 5.5);
  float fireN = fbmNoise(polarUv);
  float tongues = fbmNoise(vec2(angle * 4.5 + uTime * 1.8, r * 6.5 - uTime * 7.2));

  // Anneau principal incandescent + braises internes
  float ringRadius = 0.34 + prog * 0.52;
  float ringWidth = 0.24 + (1.0 - prog) * 0.14;
  float ringDist = abs(r - ringRadius + (fireN - 0.5) * 0.22);
  float flameRing = exp(-pow(ringDist / max(0.08, ringWidth), 2.0));

  // Langues de feu dansantes vers l'extérieur
  float outerLick = smoothstep(1.0, 0.42, r) * smoothstep(0.32, 0.85, tongues) * (0.45 + 0.55 * flameRing);

  // Braises scintillantes au sol à l'intérieur de la zone
  float emberField = pow(vnoise(p * 11.0 + vec2(uTime * 1.4, -uTime * 2.2)), 5.0)
    * smoothstep(0.95, 0.15, r) * (1.0 - prog * 0.4);

  float intensity = clamp(flameRing * 1.15 + outerLick * 0.65 + emberField * 1.4, 0.0, 2.2);

  // Dégradé thermique HDR (> 1.0 sur le cœur blanc-or pour déclencher le Bloom sélectif !)
  vec3 deepCrimson = vec3(0.75, 0.08, 0.02);
  vec3 brightOrange = vec3(1.65, 0.52, 0.06);
  vec3 hotGold = vec3(2.45, 1.72, 0.48);

  vec3 col = mix(deepCrimson, brightOrange, smoothstep(0.15, 0.72, intensity));
  col = mix(col, hotGold, smoothstep(0.72, 1.35, intensity));

  float edgeSoft = 1.0 - smoothstep(0.76, 1.0, r);
  float alpha = clamp(intensity * 0.82 * edgeSoft * fadeOut, 0.0, 0.96);

  gl_FragColor = vec4(col, alpha);
}
`;

export const HEAT_HAZE_VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  // Déformation convective de distorsion de chaleur en ondulations ascendantes
  vec3 pos = position;
  float waveA = sin(pos.y * 4.8 - uTime * 13.0 + pos.x * 2.5);
  float waveB = cos(pos.y * 7.2 - uTime * 16.5 + pos.z * 3.1);
  float env = sin(clamp(uv.y, 0.0, 1.0) * 3.14159);
  float shimmer = (waveA * 0.6 + waveB * 0.4) * 0.14 * env * (1.0 - uProgress * 0.35);
  pos.x += normal.x * shimmer;
  pos.z += normal.z * shimmer;

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

export const HEAT_HAZE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;

${SHARED_NOISE_GLSL}

void main() {
  float prog = clamp(uProgress, 0.0, 1.0);
  float fade = sin(clamp(prog, 0.0, 1.0) * 3.14159);

  // Effet mirage / distorsion thermique ascendante + franges chromatiques chaudes
  vec2 riseUv = vec2(vUv.x * 7.0, vUv.y * 3.2 - uTime * 3.6);
  float n1 = fbmNoise(riseUv);
  float n2 = fbmNoise(riseUv * 1.8 + vec2(2.3, -uTime * 2.2));
  float ripple = sin((vUv.y * 16.0 - uTime * 14.0) + n1 * 5.0) * 0.5 + 0.5;

  // Fresnel inversé doux pour éviter toute arête dure sur le cylindre
  float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
  float edgeFade = smoothstep(0.05, 0.58, ndv);
  float vFade = smoothstep(0.0, 0.22, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));

  // Flammèches et micro-braises HDR intégrées au panache thermique
  float wisps = smoothstep(0.42, 0.86, n1 * 0.65 + n2 * 0.35) * (0.55 + 0.45 * ripple);
  float sparks = pow(vnoise(vec2(vUv.x * 26.0 + n1 * 2.0, vUv.y * 14.0 - uTime * 5.8)), 9.0);

  vec3 mirageTint = mix(vec3(1.25, 0.38, 0.06), vec3(1.95, 1.15, 0.32), ripple * n2);
  vec3 sparkCol = vec3(2.8, 1.85, 0.55);
  vec3 col = mirageTint * (0.45 + wisps * 0.85) + sparkCol * sparks * 2.2;

  float alpha = clamp((wisps * 0.32 + sparks * 0.92) * edgeFade * vFade * fade, 0.0, 0.85);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createFlameRingMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'FlamePurrRingShader',
    vertexShader: FLAME_RING_VERTEX_SHADER,
    fragmentShader: FLAME_RING_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
    },
  });
}

export function createHeatHazeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'FlamePurrHeatHazeShader',
    vertexShader: HEAT_HAZE_VERTEX_SHADER,
    fragmentShader: HEAT_HAZE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
    },
  });
}

// ============================================================================
// 2. ÉCLAIR-MIAOU : Arcs électriques fractals HDR + Brûlure runique au sol
// ============================================================================

export const LIGHTNING_BEAM_VERTEX_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const LIGHTNING_BEAM_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;
uniform float uSeed;

varying vec2 vUv;

${SHARED_NOISE_GLSL}

// Arc brisé fractal 1D animé par paliers rapides (~24 Hz)
float boltPath(float x, float seed, float freq) {
  float tStep = floor(uTime * 24.0) * 1.37 + seed;
  float n1 = vnoise(vec2(x * freq, tStep)) - 0.5;
  float n2 = (vnoise(vec2(x * freq * 2.4 + 13.7, tStep * 1.3)) - 0.5) * 0.45;
  float n3 = (vnoise(vec2(x * freq * 5.2 + 29.1, tStep * 1.7)) - 0.5) * 0.2;
  // Atténuation aux extrémités du faisceau (point de départ & pointe)
  float pinch = sin(clamp(x, 0.0, 1.0) * 3.14159);
  return (n1 + n2 + n3) * (0.22 + 0.78 * pinch);
}

void main() {
  float prog = clamp(uProgress, 0.0, 1.0);
  float fade = pow(1.0 - prog, 1.15);

  // Coordonnée transversale centrée y ∈ [-1, 1]
  float y = (vUv.y - 0.5) * 2.0;
  float x = vUv.x;

  // 3 branches électriques fractales (tronc central + 2 arcs secondaires fourchus)
  float mainY = boltPath(x, uSeed + 1.0, 9.5) * 0.65;
  float branch1Y = boltPath(x, uSeed + 7.3, 14.0) * 0.95 + sin(x * 8.0 + uSeed) * 0.16;
  float branch2Y = boltPath(x, uSeed + 19.8, 17.5) * 0.92 - sin(x * 6.5 - uSeed) * 0.18;

  float dMain = abs(y - mainY);
  float dB1 = abs(y - branch1Y);
  float dB2 = abs(y - branch2Y);

  float coreMain = 0.035 / (dMain + 0.022);
  float coreB1 = (0.018 / (dB1 + 0.024)) * smoothstep(0.08, 0.32, x) * smoothstep(1.0, 0.72, x);
  float coreB2 = (0.015 / (dB2 + 0.026)) * smoothstep(0.15, 0.45, x) * smoothstep(0.95, 0.65, x);

  float glowField = exp(-dMain * 3.6) * 0.55 + exp(-abs(y) * 2.4) * 0.22;
  float endCaps = smoothstep(0.0, 0.05, x) * smoothstep(1.0, 0.92, x);

  // Crépitement stroboscopique électrique
  float crackle = 0.85 + 0.25 * sin(uTime * 95.0 + uSeed * 5.0);
  float boltEnergy = (coreMain + coreB1 * 0.85 + coreB2 * 0.75) * endCaps * crackle;

  // Couleurs HDR très lumineuses pour un Bloom électrique spectaculaire !
  vec3 cyanArc = vec3(0.38, 1.55, 2.55);
  vec3 goldZap = vec3(2.85, 2.55, 0.95);
  vec3 whiteHot = vec3(3.4, 3.35, 2.75);

  vec3 col = cyanArc * (glowField + clamp(boltEnergy * 0.45, 0.0, 1.4));
  col += goldZap * clamp((coreMain * 0.55 + coreB1 * 0.45) * endCaps, 0.0, 1.6);
  col = mix(col, whiteHot, smoothstep(0.95, 2.1, boltEnergy));

  float alpha = clamp((boltEnergy * 0.58 + glowField * 0.5) * fade * endCaps, 0.0, 1.0);
  gl_FragColor = vec4(col * fade, alpha);
}
`;

export const LIGHTNING_SCORCH_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uFade;

varying vec2 vUv;

${SHARED_NOISE_GLSL}

void main() {
  float x = vUv.x;
  float y = (vUv.y - 0.5) * 2.0;

  float n = fbmNoise(vec2(x * 8.0, y * 4.5));
  float crackN = fbmNoise(vec2(x * 16.0 + 3.2, y * 10.0));

  // Silhouette allongée de la trace de brûlure au sol
  float endMask = smoothstep(0.0, 0.10, x) * smoothstep(1.0, 0.86, x);
  float radial = abs(y) + (n - 0.5) * 0.42;
  float scorchMask = (1.0 - smoothstep(0.28, 0.88, radial)) * endMask;

  // Glyphes runiques incandescents qui refroidissent le long de l'impact
  float runeCell = fract(x * 9.0);
  float runeBar = smoothstep(0.14, 0.03, abs(runeCell - 0.5)) * smoothstep(0.55, 0.1, abs(y));
  float runeDiamond = smoothstep(0.32, 0.16, abs(runeCell - 0.5) * 1.4 + abs(y) * 0.85);
  float fissure = smoothstep(0.62, 0.82, crackN) * smoothstep(0.65, 0.08, abs(y));

  float emberHeat = clamp((runeBar * 0.75 + runeDiamond * 0.65 + fissure * 0.85) * uFade * uFade, 0.0, 1.0);
  float residualSpark = pow(vnoise(vec2(x * 22.0, y * 12.0 + floor(uTime * 14.0))), 8.0) * scorchMask * uFade;

  vec3 charColor = vec3(0.05, 0.04, 0.07);
  vec3 coolingRune = mix(vec3(0.65, 0.24, 0.95), vec3(1.85, 1.35, 0.35), emberHeat);
  vec3 sparkCol = vec3(1.2, 2.2, 3.0);

  vec3 col = mix(charColor, coolingRune, emberHeat * 0.9) + sparkCol * residualSpark * 1.5;
  float alpha = clamp((scorchMask * 0.68 + emberHeat * 0.45) * smoothstep(0.0, 0.25, uFade), 0.0, 0.88);
  if (alpha < 0.01) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

export function createLightningBeamMaterial(seed = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'LightnyanBeamShader',
    vertexShader: LIGHTNING_BEAM_VERTEX_SHADER,
    fragmentShader: LIGHTNING_BEAM_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uSeed: { value: seed },
    },
  });
}

export function createLightningScorchMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'LightnyanScorchShader',
    vertexShader: LIGHTNING_BEAM_VERTEX_SHADER,
    fragmentShader: LIGHTNING_SCORCH_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: {
      uTime: { value: 0 },
      uFade: { value: 1 },
    },
  });
}

// ============================================================================
// 3. PATTE-GIVRÉE : Cristaux de glace 3D spéculaires + Brume froide au sol
// ============================================================================

export const ICE_CRYSTAL_VERTEX_SHADER = /* glsl */ `
precision highp float;

varying vec3 vNormalWorld;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vLocalY;

void main() {
  vUv = uv;
  vLocalY = position.y;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vNormalWorld = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ICE_CRYSTAL_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;
uniform vec3 uSunDirection;

varying vec3 vNormalWorld;
varying vec3 vWorldPos;
varying vec2 vUv;
varying float vLocalY;

${SHARED_NOISE_GLSL}

void main() {
  float prog = clamp(uProgress, 0.0, 1.0);
  vec3 N = normalize(vNormalWorld);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDirection);
  vec3 H = normalize(L + V);

  // Fresnel glacé sur les arêtes cristallines
  float ndv = abs(dot(N, V));
  float fresnel = pow(1.0 - ndv, 2.3);

  // Reflets spéculaires vifs sur les facettes taillées
  float ndl = max(dot(N, L), 0.0);
  float specSharp = pow(max(dot(N, H), 0.0), 54.0);
  float specBroad = pow(max(dot(N, H), 0.0), 14.0) * 0.35;

  // Gradient interne réfractif (bleu glacier profond à la base -> cyan cristallin à la pointe)
  float tipFactor = clamp(vUv.y, 0.0, 1.0);
  float internalFacet = vnoise(vWorldPos.xz * 4.5 + vec2(vLocalY * 3.0, uTime * 0.4));

  vec3 deepGlacier = vec3(0.08, 0.36, 0.68);
  vec3 brightCyan = vec3(0.45, 0.88, 1.15);
  vec3 frostTip = vec3(1.15, 1.55, 1.85); // HDR léger -> éclat cristallin au Bloom !

  vec3 col = mix(deepGlacier, brightCyan, 0.35 + tipFactor * 0.65);
  col *= (0.68 + 0.42 * ndl + internalFacet * 0.18);
  col = mix(col, frostTip, fresnel * 0.82);
  col += vec3(1.65, 1.95, 2.35) * (specSharp * 1.15 + specBroad * 0.45);

  // Apparition jaillissante rapide puis fonte cristalline douce
  float appear = smoothstep(0.0, 0.14, prog);
  float melt = 1.0 - smoothstep(0.68, 1.0, prog);
  float dissolve = smoothstep(prog - 0.12, prog + 0.08, 1.0 - internalFacet * 0.45 + (1.0 - prog));
  float alpha = clamp((0.62 + fresnel * 0.34) * appear * melt * dissolve, 0.0, 0.94);

  gl_FragColor = vec4(col, alpha);
}
`;

export const FROST_MIST_VERTEX_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FROST_MIST_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;

varying vec2 vUv;

${SHARED_NOISE_GLSL}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;

  float angle = atan(p.y, p.x);
  float prog = clamp(uProgress, 0.0, 1.0);
  float fade = 1.0 - smoothstep(0.55, 1.0, prog);

  // Nappe de brume glacée tourbillonnante au ras du sol
  vec2 swirlUv = vec2(p.x * cos(r * 1.6 - uTime * 0.9) - p.y * sin(r * 1.6 - uTime * 0.9),
                      p.x * sin(r * 1.6 - uTime * 0.9) + p.y * cos(r * 1.6 - uTime * 0.9));
  float mistA = fbmNoise(swirlUv * 3.4 + vec2(uTime * 0.45, -uTime * 0.32));
  float mistB = fbmNoise(swirlUv * 6.2 - vec2(uTime * 0.6, uTime * 0.4));

  // Onde de choc radiale + motifs cristallins hexagonaux (flocon à 6 branches)
  float waveFront = exp(-pow((r - (0.2 + prog * 0.76)) / 0.085, 2.0));
  float hexRays = pow(abs(cos(angle * 3.0)), 14.0) * smoothstep(0.95, 0.1, r);
  float innerHex = smoothstep(0.06, 0.01, abs(r - (0.35 + prog * 0.35) + abs(cos(angle * 3.0)) * 0.05));

  float radialMask = (1.0 - smoothstep(0.65, 1.0, r)) * smoothstep(0.0, 0.14, r + 0.08);
  float mistDensity = (mistA * 0.6 + mistB * 0.4) * radialMask;

  vec3 mistCol = mix(vec3(0.28, 0.74, 0.96), vec3(0.82, 0.96, 1.05), mistB);
  vec3 waveCol = vec3(1.15, 1.78, 2.25); // HDR cristallin pour Bloom subtil

  vec3 col = mistCol * (0.75 + 0.45 * mistA)
    + waveCol * (waveFront * 1.15 + hexRays * 0.42 + innerHex * 0.55);

  float alpha = clamp((mistDensity * 0.62 + waveFront * 0.72 + hexRays * 0.25 + innerHex * 0.35) * fade, 0.0, 0.92);
  gl_FragColor = vec4(col, alpha);
}
`;

export function createIceCrystalMaterial(
  sunDirection = new THREE.Vector3(26, 42, 22),
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'FreezePawCrystalShader',
    vertexShader: ICE_CRYSTAL_VERTEX_SHADER,
    fragmentShader: ICE_CRYSTAL_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uSunDirection: { value: sunDirection.clone().normalize() },
    },
  });
}

export function createFrostMistMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'FreezePawMistShader',
    vertexShader: FROST_MIST_VERTEX_SHADER,
    fragmentShader: FROST_MIST_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
    },
  });
}

// ============================================================================
// 4. SOIN-VELOURS (& LEVEL-UP) : Colonne de lumière divine volumétrique +
//    Anneaux dorés pulsants
// ============================================================================

export const HEAL_BEAM_VERTEX_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;

void main() {
  vUv = uv;
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vNormalView = normalize(normalMatrix * normal);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

export const HEAL_BEAM_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;
uniform vec3 uPrimaryColor;
uniform vec3 uAccentColor;

varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewDir;

${SHARED_NOISE_GLSL}

void main() {
  float prog = clamp(uProgress, 0.0, 1.0);
  // Apparition rapide et extinction douce
  float envelope = smoothstep(0.0, 0.14, prog) * (1.0 - smoothstep(0.68, 1.0, prog));

  // Fondu Fresnel volumétrique sur les bords du cylindre (aucune silhouette dure)
  float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
  float volumetricEdge = pow(ndv, 1.45);

  // Fondu vertical : brillant au niveau du héros puis diffus vers le ciel
  float verticalFade = smoothstep(0.0, 0.12, vUv.y) * pow(1.0 - vUv.y, 1.25);

  // Rayons divins verticaux (god rays) animés
  float rayA = 0.5 + 0.5 * sin(vUv.x * 6.2831853 * 6.0 + uTime * 1.4);
  float rayB = 0.5 + 0.5 * sin(vUv.x * 6.2831853 * 11.0 - uTime * 2.1);
  float godRays = 0.45 + 0.35 * rayA + 0.25 * rayB;

  // Double hélice ascendante dorée dans la colonne
  float helix1 = exp(-pow(sin((vUv.x * 2.0 - vUv.y * 2.6 + uTime * 1.8) * 3.14159), 2.0) * 18.0);
  float helix2 = exp(-pow(sin((vUv.x * 2.0 + vUv.y * 2.2 - uTime * 1.5) * 3.14159), 2.0) * 22.0);
  float helices = (helix1 + helix2 * 0.75) * (1.0 - vUv.y * 0.65);

  // Étoiles scintillantes ascendantes intégrées
  float starSpark = pow(vnoise(vec2(vUv.x * 22.0, vUv.y * 14.0 - uTime * 3.2)), 9.5);

  vec3 col = mix(uPrimaryColor, uAccentColor, 0.38 + 0.45 * rayA) * godRays;
  col += uAccentColor * (helices * 1.35 + starSpark * 2.4);

  float alpha = clamp(
    (0.42 * godRays + helices * 0.52 + starSpark * 0.85) * volumetricEdge * verticalFade * envelope,
    0.0,
    0.92
  );

  gl_FragColor = vec4(col, alpha);
}
`;

export const HEAL_RING_VERTEX_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const HEAL_RING_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;
uniform vec3 uPrimaryColor;
uniform vec3 uAccentColor;

varying vec2 vUv;

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;

  float angle = atan(p.y, p.x);
  float prog = clamp(uProgress, 0.0, 1.0);
  float fade = smoothstep(0.0, 0.12, prog) * (1.0 - smoothstep(0.65, 1.0, prog));

  // Anneau principal doré + anneau intérieur émeraude + crans étoilés sacrés
  float outerBand = exp(-pow((r - 0.84) / 0.075, 2.0));
  float innerBand = exp(-pow((r - 0.62) / 0.045, 2.0)) * 0.8;
  float sacredTicks = pow(0.5 + 0.5 * cos(angle * 12.0 + uTime * 2.6), 6.0)
    * smoothstep(0.56, 0.64, r) * (1.0 - smoothstep(0.84, 0.92, r));
  float innerGlow = smoothstep(0.75, 0.0, r) * 0.25;

  float pulse = 0.86 + 0.22 * sin(uTime * 11.0);
  vec3 col = mix(uPrimaryColor, uAccentColor, clamp(outerBand + sacredTicks * 0.8, 0.0, 1.0)) * pulse;
  float alpha = clamp((outerBand * 0.92 + innerBand * 0.65 + sacredTicks * 0.72 + innerGlow) * fade, 0.0, 0.96);

  gl_FragColor = vec4(col, alpha);
}
`;

export function createHealBeamMaterial(
  primaryColor: THREE.ColorRepresentation = 0x5ce67a,
  accentColor: THREE.ColorRepresentation = 0xffe570,
): THREE.ShaderMaterial {
  // Boost HDR doux pour faire rayonner la colonne divine au UnrealBloomPass
  const pCol = new THREE.Color(primaryColor).multiplyScalar(1.25);
  const aCol = new THREE.Color(accentColor).multiplyScalar(1.65);

  return new THREE.ShaderMaterial({
    name: 'HealingPawBeamShader',
    vertexShader: HEAL_BEAM_VERTEX_SHADER,
    fragmentShader: HEAL_BEAM_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPrimaryColor: { value: pCol },
      uAccentColor: { value: aCol },
    },
  });
}

export function createHealRingMaterial(
  primaryColor: THREE.ColorRepresentation = 0x5ce67a,
  accentColor: THREE.ColorRepresentation = 0xffe570,
): THREE.ShaderMaterial {
  const pCol = new THREE.Color(primaryColor).multiplyScalar(1.25);
  const aCol = new THREE.Color(accentColor).multiplyScalar(1.65);

  return new THREE.ShaderMaterial({
    name: 'HealingPawRingShader',
    vertexShader: HEAL_RING_VERTEX_SHADER,
    fragmentShader: HEAL_RING_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPrimaryColor: { value: pCol },
      uAccentColor: { value: aCol },
    },
  });
}

// ============================================================================
// 5. FLÈCHE DORÉE LUMINEUSE DE QUÊTE (Sheen animé + léger glow HDR)
// ============================================================================

export function createQuestArrowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'QuestArrowGoldShader',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    uniforms: {
      uTime: { value: 0 },
      uGoldCore: { value: new THREE.Color(0xffe570).multiplyScalar(0.98) },
      uGoldHighlight: { value: new THREE.Color(0xfff8cf).multiplyScalar(1.18) },
    },
    vertexShader: /* glsl */ `
      precision highp float;
      varying vec2 vLocal;
      void main() {
        vLocal = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform vec3 uGoldCore;
      uniform vec3 uGoldHighlight;
      varying vec2 vLocal;
      void main() {
        // Reflet lumineux glissant de la queue vers la pointe (+X)
        float sweep = sin(vLocal.x * 3.6 - uTime * 5.2) * 0.5 + 0.5;
        float tipBoost = smoothstep(-0.4, 0.85, vLocal.x);
        vec3 col = mix(uGoldCore, uGoldHighlight, pow(sweep, 3.0) * 0.65 + tipBoost * 0.25);
        gl_FragColor = vec4(col, 0.98);
      }
    `,
  });
}
