import * as THREE from 'three';

// ============================================================================
// Shaders GLSL Maritimes — Voilier « Le Patte-au-Vent » & Effets d'Eau
// Calibrés WebGL2 strict (0 warning compileShader/linkProgram) et Bloom-safe
// (voile < 0.80 linéaire, écume < 0.79 linéaire sous UnrealBloomPass 0.85).
// ============================================================================

export interface SailWindUniforms {
  uSailTime: { value: number };
  uSailBillow: { value: number };
  uSailFlutter: { value: number };
  uSailTrim: { value: number };
}

const MARITIME_NOISE_GLSL = /* glsl */ `
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
  float a = 0.52;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.03;
    a *= 0.5;
  }
  return v;
}
`;

/**
 * Patche un `THREE.MeshStandardMaterial` (Three.js 0.174) via `onBeforeCompile`
 * pour animer le gonflement, l'ondulation au vent et la perturbation de normale
 * des voiles & du fanion tout en conservant 100 % l'éclairage PBR + ACES.
 */
export function applySailWindShader(
  material: THREE.MeshStandardMaterial,
  cacheKey = 'felingard_sail_wind_pbr_v1',
): SailWindUniforms {
  const uniforms: SailWindUniforms = {
    uSailTime: { value: 0 },
    uSailBillow: { value: 0.25 },
    uSailFlutter: { value: 0.25 },
    uSailTrim: { value: 0 },
  };

  material.customProgramCacheKey = () => cacheKey;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSailTime = uniforms.uSailTime;
    shader.uniforms.uSailBillow = uniforms.uSailBillow;
    shader.uniforms.uSailFlutter = uniforms.uSailFlutter;
    shader.uniforms.uSailTrim = uniforms.uSailTrim;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `
      #include <common>
      uniform float uSailTime;
      uniform float uSailBillow;
      uniform float uSailFlutter;
      uniform float uSailTrim;
      attribute vec4 aSailFlex;

      void evalSailWind(
        vec3 pos,
        vec4 flex,
        out vec3 dispOut,
        out vec3 normDeltaOut
      ) {
        float billowW = flex.x;
        float flutterW = flex.y;
        vec3 rawDir = vec3(flex.z, 0.05 * billowW, flex.w);
        float dirLen = length(rawDir);
        vec3 dir = dirLen > 0.001 ? (rawDir / dirLen) : vec3(0.0, 0.0, -1.0);

        float belly = billowW * (0.14 + 0.36 * uSailBillow);
        float breath = sin(uSailTime * 2.05 + pos.y * 0.95) * 0.045 * billowW * (0.35 + 0.65 * uSailBillow);

        float speedFreq = 4.2 + 5.8 * uSailFlutter;
        float wavePhase = pos.x * 3.6 + pos.y * 2.5 - uSailTime * speedFreq;
        float wavePhase2 = pos.z * 4.4 - pos.y * 1.9 - uSailTime * (speedFreq * 1.32);
        float ripple = (sin(wavePhase) * 0.64 + sin(wavePhase2 + 1.2) * 0.36)
          * 0.058 * flutterW * (0.28 + 0.78 * uSailFlutter);

        vec3 lateralTrim = vec3(uSailTrim * 0.09 * billowW, 0.0, 0.0);
        dispOut = dir * (belly + breath + ripple) + lateralTrim;

        float dRx = cos(wavePhase) * 0.14 * flutterW * (0.3 + 0.7 * uSailFlutter);
        float dRy = cos(wavePhase) * 0.10 * flutterW * (0.3 + 0.7 * uSailFlutter)
          + cos(uSailTime * 2.05 + pos.y * 0.95) * 0.04 * billowW;
        normDeltaOut = vec3(-dRx, -dRy, 0.0);
      }
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      /* glsl */ `
      vec3 sailWindDisp;
      vec3 sailWindNormDelta;
      evalSailWind(position, aSailFlex, sailWindDisp, sailWindNormDelta);
      #include <beginnormal_vertex>
      objectNormal = normalize(objectNormal + sailWindNormDelta);
      `,
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      transformed += sailWindDisp;
      `,
    );
  };

  material.needsUpdate = true;
  return uniforms;
}

// ============================================================================
// 1. Sillage dynamique en V courbé (marche avant, virage & remous marche arrière)
// ============================================================================

export const SHIP_WAKE_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute float aWakeStrength;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vWakeStrength;

void main() {
  vUv = uv;
  vWakeStrength = aWakeStrength;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

export const SHIP_WAKE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uIntensity;
uniform float uTurnBias;
uniform float uReverseMode;
uniform vec3 uFoamColor;
uniform vec3 uTurquoiseColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec2 vUv;
varying vec3 vWorldPos;
varying float vWakeStrength;

${MARITIME_NOISE_GLSL}

void main() {
  float localPower = clamp(vWakeStrength * max(uIntensity, 0.2), 0.0, 1.0);
  if (localPower < 0.012) discard;

  float uSigned = (vUv.x - 0.5) * 2.0;
  float absU = abs(uSigned);
  float age = clamp(vUv.y, 0.0, 1.0);

  // Bruit d'écume ancré dans l'espace monde pour que les bulles restent figées dans l'eau
  float lace = fbmNoise(vWorldPos.xz * 0.78 + vec2(uTime * 0.09, -uTime * 0.07));
  float bubbles = vnoise(vWorldPos.xz * 2.75 - vec2(uTime * 0.18, uTime * 0.14));
  float foamTex = lace * 0.60 + bubbles * 0.40;

  // Double bras de Kelvin en V (marche avant) vs bouillonnement large centré (marche arrière)
  float armCenter = mix(0.34, 0.78, pow(age, 0.66));
  float armWidth = mix(0.24, 0.18, age) + abs(uTurnBias) * 0.04;
  float warpedAbsU = absU + (lace - 0.5) * 0.15;
  float vArms = exp(-pow((warpedAbsU - armCenter) / max(0.08, armWidth), 2.0));

  // Renforcement dissymétrique sur l'arc extérieur lors des virages
  float outerBoost = 1.0 + clamp(uSigned * uTurnBias, 0.0, 1.0) * 0.55;
  vArms *= outerBoost;

  // Ondes secondaires fines juste à l'intérieur des bras V
  float innerRipples = smoothstep(0.46, 0.92, sin((absU * 12.0 - age * 9.0) + lace * 3.2))
    * smoothstep(0.86, 0.22, absU)
    * (1.0 - smoothstep(0.15, 0.82, age))
    * (0.36 + abs(uTurnBias) * 0.22);

  // Remous central bouillonnant derrière le gouvernail (renforcé en virage et marche arrière)
  float centerWidth = mix(0.34, 0.52, uReverseMode) + abs(uTurnBias) * 0.08;
  float centerChurn = exp(-pow(warpedAbsU / centerWidth, 2.0))
    * (1.0 - smoothstep(0.05, mix(0.70, 0.85, uReverseMode), age))
    * mix(0.76, 1.05, uReverseMode);

  float forwardPattern = vArms * 0.96 + centerChurn + innerRipples;
  float reversePattern = centerChurn * 0.92 + vArms * 0.34;
  float pattern = mix(forwardPattern, reversePattern, uReverseMode);

  // Enveloppes douces (0 coupure géométrique visible aux extrémités et sur les côtés)
  float headFade = smoothstep(0.0, 0.06, age);
  float tailFade = 1.0 - smoothstep(0.28, 1.0, age);
  float sideFade = 1.0 - smoothstep(0.75, 1.0, absU);

  // Dissolution progressive en dentelle d'écume organique
  float laceCut = smoothstep(age * 0.56 - 0.12, age * 0.56 + 0.34, foamTex);
  float foamMask = pattern * (0.40 + 0.60 * laceCut);
  float alpha = clamp(foamMask * headFade * tailFade * sideFade * localPower * 0.82, 0.0, 0.84);

  if (alpha < 0.015) discard;

  // Transition eau turquoise aérée -> écume plafonnée sous le seuil Bloom (0.85)
  float crestWhite = smoothstep(0.26, 0.76, vArms * 0.82 + centerChurn * 0.58 + bubbles * 0.24);
  vec3 col = min(mix(uTurquoiseColor, uFoamColor, crestWhite), vec3(0.79));

  // Fondu brouillard raccord avec la scène
  float camDist = length(cameraPosition - vWorldPos);
  float fogFactor = clamp((camDist - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fogFactor);
  alpha *= 1.0 - fogFactor * 0.82;
  if (alpha < 0.012) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

export function createShipWakeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'ShipWakeRibbonShader',
    vertexShader: SHIP_WAKE_VERTEX_SHADER,
    fragmentShader: SHIP_WAKE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uTurnBias: { value: 0 },
      uReverseMode: { value: 0 },
      uFoamColor: { value: new THREE.Color(0xcce4ec) },
      uTurquoiseColor: { value: new THREE.Color(0x3ba8b5) },
      uFogColor: { value: new THREE.Color(0x3f8cb3) },
      uFogNear: { value: 115 },
      uFogFar: { value: 265 },
    },
  });
}

// ============================================================================
// 2. Mousse de proue (Croissant d'écume dynamique autour de l'étrave)
// ============================================================================

export const BOW_FOAM_VERTEX_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const BOW_FOAM_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uSpeedRatio;
uniform float uTurnBias;
uniform float uShoreFade;
uniform float uStormBoost;
uniform vec3 uFoamColor;
uniform vec3 uTurquoiseColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec2 vUv;
varying vec3 vWorldPos;

${MARITIME_NOISE_GLSL}

void main() {
  float power = uSpeedRatio * uShoreFade;
  if (power < 0.025) discard;

  // vUv.x : 0 (bâbord) -> 0.5 (pointe d'étrave) -> 1 (tribord)
  // vUv.y : 0 (contact coque) -> 1 (bord externe de la gerbe)
  float sideSigned = (vUv.x - 0.5) * 2.0;
  float bowCenter = 1.0 - abs(sideSigned);
  float arcEnvelope = smoothstep(0.0, 0.42, bowCenter);
  float turnWeight = 1.0 + clamp(sideSigned * uTurnBias, -0.25, 0.55);

  float flow = fbmNoise(vec2(vUv.x * 8.4, vUv.y * 4.5 - uTime * (2.6 + 3.1 * uSpeedRatio)));
  float froth = vnoise(vec2(vUv.x * 18.0, vUv.y * 10.0 - uTime * 5.2));

  float radialOut = 1.0 - smoothstep(0.08, 0.94, vUv.y + (flow - 0.5) * 0.28);
  float innerSoft = smoothstep(0.0, 0.14, vUv.y);
  float crest = smoothstep(0.22, 0.78, flow * 0.62 + froth * 0.38 + (1.0 - vUv.y) * (0.34 + 0.14 * uStormBoost));

  float intensity = smoothstep(0.03, 0.85, power) * (1.0 + 0.24 * uStormBoost) * turnWeight;
  float alpha = clamp(arcEnvelope * radialOut * innerSoft * crest * intensity * 0.86, 0.0, 0.88);
  if (alpha < 0.015) discard;

  vec3 col = min(mix(uTurquoiseColor, uFoamColor, smoothstep(0.2, 0.74, crest)), vec3(0.79));

  float camDist = length(cameraPosition - vWorldPos);
  float fogFactor = clamp((camDist - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fogFactor);
  alpha *= 1.0 - fogFactor * 0.82;
  if (alpha < 0.012) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

export function createBowFoamMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'ShipBowFoamShader',
    vertexShader: BOW_FOAM_VERTEX_SHADER,
    fragmentShader: BOW_FOAM_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSpeedRatio: { value: 0 },
      uTurnBias: { value: 0 },
      uShoreFade: { value: 1 },
      uStormBoost: { value: 0 },
      uFoamColor: { value: new THREE.Color(0xcde6ee) },
      uTurquoiseColor: { value: new THREE.Color(0x42b4be) },
      uFogColor: { value: new THREE.Color(0x3f8cb3) },
      uFogNear: { value: 115 },
      uFogFar: { value: 265 },
    },
  });
}

// ============================================================================
// 3. Ondulations concentriques autour de la coque (arrêt, freinage, marche arrière)
// ============================================================================

export const HULL_RIPPLE_VERTEX_SHADER = /* glsl */ `
precision highp float;

varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const HULL_RIPPLE_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uActivity;
uniform float uSignedSpeed;
uniform float uShoreFade;
uniform vec3 uFoamColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;

varying vec2 vUv;
varying vec3 vWorldPos;

${MARITIME_NOISE_GLSL}

void main() {
  if (uShoreFade < 0.02) discard;

  // vUv.x : tour complet [0..1] (cos(angle) = +1 à la poupe +Z, -1 à la proue -Z)
  // vUv.y : distance radiale depuis la coque [0..1]
  float angle = vUv.x * 6.2831853;
  float sternBias = cos(angle); // +1 poupe, -1 proue
  vec2 ringCoord = vec2(cos(angle), sin(angle)) * (1.9 + vUv.y * 1.5);
  float warp = fbmNoise(ringCoord + vec2(uTime * 0.20, -uTime * 0.16));

  // Anneaux concentriques rayonnant depuis la coque (sens légèrement modulé en marche arrière)
  float revFactor = max(0.0, -uSignedSpeed);
  float fwdFactor = max(0.0, uSignedSpeed);
  float wavePhase = vUv.y * 14.5 - uTime * (2.2 + 1.8 * uActivity) + warp * 2.3;
  float rings = smoothstep(0.46, 0.96, sin(wavePhase));

  // Accentuation douce à la poupe lors de la marche arrière / freinage, et sur les flancs en croisière
  float dirMask = 1.0
    + revFactor * smoothstep(-0.1, 0.85, sternBias) * 0.65
    - fwdFactor * smoothstep(0.35, 1.0, -sternBias) * 0.35;

  // Liseré doux collé à la ligne de flottaison
  float waterlineHug = (1.0 - smoothstep(0.0, 0.26, vUv.y)) * (0.55 + 0.45 * warp);

  float innerFade = smoothstep(0.0, 0.06, vUv.y);
  float outerFade = 1.0 - smoothstep(0.34, 1.0, vUv.y);

  float strength = mix(0.38, 0.64, clamp(uActivity, 0.0, 1.0)) * uShoreFade;
  float alpha = clamp((rings * 0.60 * outerFade * innerFade + waterlineHug * 0.56) * strength * dirMask, 0.0, 0.72);
  if (alpha < 0.015) discard;

  vec3 col = min(uFoamColor, vec3(0.78));
  float camDist = length(cameraPosition - vWorldPos);
  float fogFactor = clamp((camDist - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  col = mix(col, uFogColor, fogFactor);
  alpha *= 1.0 - fogFactor * 0.82;
  if (alpha < 0.012) discard;

  gl_FragColor = vec4(col, alpha);
}
`;

export function createHullRippleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'ShipHullRippleShader',
    vertexShader: HULL_RIPPLE_VERTEX_SHADER,
    fragmentShader: HULL_RIPPLE_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0 },
      uSignedSpeed: { value: 0 },
      uShoreFade: { value: 1 },
      uFoamColor: { value: new THREE.Color(0xc2e2ea) },
      uFogColor: { value: new THREE.Color(0x3f8cb3) },
      uFogNear: { value: 115 },
      uFogFar: { value: 265 },
    },
  });
}

// ============================================================================
// 4. Filets de vent stylisés (ambiance navigation & rafales de tempête)
// ============================================================================

export const WIND_STREAK_VERTEX_SHADER = /* glsl */ `
precision highp float;

attribute float aStreakSeed;
varying vec2 vUv;
varying float vSeed;

void main() {
  vUv = uv;
  vSeed = aStreakSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const WIND_STREAK_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uOpacity;
uniform vec3 uColor;

varying vec2 vUv;
varying float vSeed;

void main() {
  if (uOpacity < 0.01) discard;

  float travel = fract(vUv.x * 1.15 - uTime * (0.95 + vSeed * 0.35) + vSeed * 3.7);
  float dash = smoothstep(0.0, 0.22, travel) * (1.0 - smoothstep(0.55, 0.92, travel));
  float endFade = smoothstep(0.0, 0.14, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
  float crossProfile = 1.0 - abs(vUv.y - 0.5) * 2.0;
  crossProfile = smoothstep(0.0, 0.75, crossProfile);

  float alpha = dash * endFade * crossProfile * uOpacity * 0.20;
  if (alpha < 0.008) discard;

  gl_FragColor = vec4(min(uColor, vec3(0.78)), alpha);
}
`;

export function createWindStreakMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'ShipWindStreakShader',
    vertexShader: WIND_STREAK_VERTEX_SHADER,
    fragmentShader: WIND_STREAK_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(0xb8d4dc) },
    },
  });
}
