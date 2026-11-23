import * as THREE from 'three';

// ============================================================================
// Shader GLSL Océan & Rivage de Félingard — Ondes Gerstner, Profondeur,
// Caustiques, Écume Organique Côtière & Reflets Solaires Scintillants
// ============================================================================

export interface WaterMaterialOptions {
  /** Couleur du lagon peu profond (près du rivage). */
  shallowColor?: THREE.ColorRepresentation;
  /** Couleur intermédiaire de la mer. */
  midColor?: THREE.ColorRepresentation;
  /** Couleur bleu abyssal au large. */
  deepColor?: THREE.ColorRepresentation;
  /** Couleur de l'écume côtière et des crêtes. */
  foamColor?: THREE.ColorRepresentation;
  /** Direction normalisée vers le soleil. */
  sunDirection?: THREE.Vector3;
  /** Couleur des reflets spéculaires solaires. */
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

export const WATER_VERTEX_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uCoastOffset;
uniform float uWaveAmplitude;
uniform vec4 uIslandCoasts[6];

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveHeight;
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

// Déplacement d'une onde de Gerstner (retourne xyz déplacement + accumule tangente/bitangente)
vec3 gerstnerWave(
  vec2 pos,
  vec2 dir,
  float steepness,
  float wavelength,
  float speed,
  float time,
  inout vec3 tangent,
  inout vec3 binormal
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

  return vec3(d.x * (a * cosF), a * sinF, d.y * (a * cosF));
}

void main() {
  vec4 worldBase = modelMatrix * vec4(position, 1.0);
  vec2 xz = worldBase.xz;

  float distFromCoast = 1.0e6;
  for (int i = 0; i < 6; i++) {
    vec4 island = uIslandCoasts[i];
    vec2 fromCenter = xz - island.xy;
    float angle = atan(fromCenter.y, fromCenter.x);
    float coastRadius = getIslandRadius(angle, island.z, i == 0) + uCoastOffset;
    distFromCoast = min(distFromCoast, length(fromCenter) - coastRadius);
  }

  // Atténuation douce des vagues près de la plage pour éviter de couper le sable à y = 0
  float shoreDamp = smoothstep(0.2, 10.0, distFromCoast);
  float amp = uWaveAmplitude * mix(0.02, 1.0, shoreDamp);

  vec3 tangent = vec3(1.0, 0.0, 0.0);
  vec3 binormal = vec3(0.0, 0.0, 1.0);
  vec3 offset = vec3(0.0);

  offset += gerstnerWave(xz, vec2(0.84, 0.54), 0.14 * amp, 22.0, 0.42, uTime, tangent, binormal);
  offset += gerstnerWave(xz, vec2(-0.52, 0.85), 0.11 * amp, 14.5, 0.48, uTime * 1.08, tangent, binormal);
  offset += gerstnerWave(xz, vec2(0.32, -0.94), 0.08 * amp, 9.2, 0.55, uTime * 1.15, tangent, binormal);
  offset += gerstnerWave(xz, vec2(-0.91, -0.41), 0.06 * amp, 6.4, 0.62, uTime * 1.24, tangent, binormal);

  vec3 displacedWorld = worldBase.xyz + offset;
  // Borne verticale près du rivage afin que la vague reste élégamment sous le sable (y = 0)
  displacedWorld.y = min(displacedWorld.y, worldBase.y + mix(0.005, 0.36, shoreDamp));

  vec3 normal = normalize(cross(binormal, tangent));

  vWorldPos = displacedWorld;
  vNormal = normal;
  vWaveHeight = offset.y;
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
uniform float uCoastOffset;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform sampler2D uCoastMask;
uniform float uUseCoastMask;
uniform float uCoastMaskHalfSize;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying float vWaveHeight;
varying float vDistFromCoast;

// --- Simplex Noise 2D (Ashima / Gustavson, ultra rapide & organique) ---
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
    p = rot * p * 2.04;
    amp *= 0.5;
  }
  return val;
}

float getIslandRadius(float angle) {
  return 52.5
    + 2.2 * cos(angle * 2.0 - 0.5)
    + 1.5 * sin(angle * 3.0 + 0.9)
    + 1.0 * cos(angle * 5.0 - 0.3);
}

// Caustiques lumineuses organiques dans les hauts-fonds turquoise
float computeCaustics(vec2 p, float t) {
  vec2 uv1 = p * 0.24 + vec2(t * 0.14, -t * 0.10);
  vec2 uv2 = p * 0.31 + vec2(-t * 0.12, t * 0.16);
  float n1 = snoise(uv1 + vec2(snoise(uv2 * 0.8), snoise(uv1 * 0.8)));
  float n2 = snoise(uv2 - vec2(snoise(uv1 * 0.7), snoise(uv2 * 0.7)));
  float ridge = 1.0 - abs(n1 + n2) * 0.55;
  return pow(clamp(ridge, 0.0, 1.0), 4.5);
}

void main() {
  vec2 xz = vWorldPos.xz;

  // 1. Calcul précis de la distance au rivage de l'île (analytique + option masque)
  float angle = atan(xz.y, xz.x);
  float coastRadius = getIslandRadius(angle) + uCoastOffset;
  float distCoast = length(xz) - coastRadius;

  if (uUseCoastMask > 0.5) {
    vec2 maskUv = (xz / (uCoastMaskHalfSize * 2.0)) + 0.5;
    maskUv.y = 1.0 - maskUv.y;
    if (maskUv.x >= 0.0 && maskUv.x <= 1.0 && maskUv.y >= 0.0 && maskUv.y <= 1.0) {
      float maskVal = texture2D(uCoastMask, maskUv).r;
      distCoast = mix(distCoast, (maskVal - 0.5) * 20.0, 0.5);
    }
  }

  // Perturbation organique du rivage pour des courbes naturelles vivantes
  float shoreNoise = fbm(xz * 0.11 + vec2(uTime * 0.08, -uTime * 0.06));
  float organicDist = distCoast + shoreNoise * 1.35;

  // 2. Normales micro-vagues animées (double couche Simplex croisée)
  vec2 rippleUvA = xz * 0.19 + vec2(uTime * 0.28, uTime * 0.16);
  vec2 rippleUvB = xz * 0.34 + vec2(-uTime * 0.22, uTime * 0.31);
  float eps = 0.28;
  float hC = snoise(rippleUvA) * 0.65 + snoise(rippleUvB) * 0.35;
  float hX = snoise(rippleUvA + vec2(eps, 0.0)) * 0.65 + snoise(rippleUvB + vec2(eps, 0.0)) * 0.35;
  float hZ = snoise(rippleUvA + vec2(0.0, eps)) * 0.65 + snoise(rippleUvB + vec2(0.0, eps)) * 0.35;

  vec3 rippleNormal = normalize(vec3((hC - hX) * 0.28, 1.0, (hC - hZ) * 0.28));
  vec3 N = normalize(mix(vNormal, rippleNormal, 0.55));
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDirection);

  // 3. Dégradé de profondeur réaliste (sable mouillé -> turquoise cristallin -> azur -> abysse)
  float shallowToMid = smoothstep(0.0, 9.5, organicDist);
  float midToDeep = smoothstep(7.0, 38.0, organicDist);
  vec3 waterColor = mix(uShallowColor, uMidColor, shallowToMid);
  waterColor = mix(waterColor, uDeepColor, midToDeep);

  // Légère chaleur sableuse translucide juste au bord de la plage (espace linéaire)
  float sandTint = 1.0 - smoothstep(-0.6, 2.4, organicDist);
  waterColor = mix(waterColor, vec3(0.28, 0.56, 0.48), sandTint * 0.36);

  // 4. Caustiques solaires sous-marines dans le lagon peu profond
  float shallowMask = (1.0 - smoothstep(0.5, 14.0, organicDist)) * smoothstep(-1.5, 0.4, distCoast);
  float caustics = computeCaustics(xz, uTime);
  waterColor += vec3(0.14, 0.28, 0.26) * caustics * shallowMask * 0.65;

  // 5. Éclairage diffus doux + Subsurface Scattering turquoise dans les crêtes
  float NdotL = max(dot(N, L), 0.0);
  float diffuse = 0.72 + 0.28 * NdotL;
  waterColor *= diffuse;

  float sss = pow(clamp(vWaveHeight * 3.0 + 0.35, 0.0, 1.0), 2.0) * (0.4 + 0.6 * NdotL);
  waterColor += vec3(0.05, 0.22, 0.24) * sss * (1.0 - midToDeep * 0.55);

  // 6. Fresnel ciel & reflets spéculaires scintillants du soleil (Sun Glare)
  float NdotV = max(dot(N, V), 0.0);
  float fresnel = pow(1.0 - NdotV, 3.8);
  vec3 skyReflect = mix(vec3(0.16, 0.42, 0.68), vec3(0.46, 0.72, 0.88), fresnel);
  waterColor = mix(waterColor, skyReflect, fresnel * 0.40);

  vec3 H = normalize(L + V);
  float NdotH = max(dot(N, H), 0.0);
  float broadSpec = pow(NdotH, 36.0) * 0.34;
  // Micro-étincelles HDR localisées (déclenchent un subtil scintillement au UnrealBloomPass)
  float sparkleNoise = snoise(xz * 0.92 + vec2(uTime * 0.95, -uTime * 0.78));
  float sharpGlint = pow(NdotH, 190.0) * smoothstep(0.12, 0.75, sparkleNoise) * 1.55;
  waterColor += uSunColor * (broadSpec + sharpGlint);

  // 7. Bandeau d'écume blanche organique pulsante le long du rivage
  float foamNoise = fbm(xz * 0.45 - vec2(uTime * 0.22, uTime * 0.18));
  float foamLace = snoise(xz * 1.15 + vec2(uTime * 0.35, -uTime * 0.25));

  // Liseré principal collé à la plage qui respire avec la houle
  float tidePulse = sin(uTime * 1.7 + angle * 4.0 + shoreNoise * 2.0) * 0.38;
  float shoreBand = 1.0 - smoothstep(-0.35, 2.35 + tidePulse, distCoast + foamNoise * 0.85);
  float shoreCutout = smoothstep(-0.22, 0.35, foamLace + (1.0 - smoothstep(-0.2, 1.4, distCoast)) * 0.65);
  float primaryFoam = shoreBand * shoreCutout;

  // Vaguelettes d'écume secondaires qui déferlent vers la côte
  float wavePhase = distCoast * 1.55 - uTime * 2.25 + foamNoise * 2.6;
  float rollingFoam = smoothstep(0.62, 0.92, sin(wavePhase));
  float rollingEnvelope = smoothstep(0.3, 1.6, distCoast) * (1.0 - smoothstep(2.2, 6.2, distCoast));
  float secondaryFoam = rollingFoam * rollingEnvelope * smoothstep(-0.15, 0.45, foamLace);

  // Légères crêtes blanches au large sur les houles les plus hautes
  float crestFoam = smoothstep(0.16, 0.28, vWaveHeight + foamNoise * 0.08)
    * smoothstep(8.0, 22.0, distCoast)
    * smoothstep(0.15, 0.65, foamLace)
    * 0.42;

  float totalFoam = clamp(primaryFoam * 0.92 + secondaryFoam * 0.72 + crestFoam, 0.0, 1.0);
  // Garde l'écume lumineuse mais juste sous le seuil Bloom (0.85) pour rester nette et soyeuse
  vec3 litFoam = uFoamColor * (0.78 + 0.16 * NdotL);
  waterColor = mix(waterColor, litFoam, totalFoam);

  // 8. Brume d'horizon parfaitement raccord avec scene.fog
  float camDist = length(cameraPosition - vWorldPos);
  float fogFactor = smoothstep(uFogNear, uFogFar, camDist);
  waterColor = mix(waterColor, uFogColor, fogFactor);

  gl_FragColor = vec4(waterColor, 1.0);
}
`;

export function createWaterMaterial(
  options: WaterMaterialOptions = {},
): THREE.ShaderMaterial {
  const sunDir = (options.sunDirection ?? new THREE.Vector3(26, 42, 22)).clone().normalize();

  return new THREE.ShaderMaterial({
    name: 'FelingardWaterShader',
    vertexShader: WATER_VERTEX_SHADER,
    fragmentShader: WATER_FRAGMENT_SHADER,
    transparent: false,
    depthWrite: true,
    uniforms: {
      uTime: { value: 0 },
      uShallowColor: { value: new THREE.Color(options.shallowColor ?? 0x35c7c4) },
      uMidColor: { value: new THREE.Color(options.midColor ?? 0x1e7fb0) },
      uDeepColor: { value: new THREE.Color(options.deepColor ?? 0x0d3d66) },
      uFoamColor: { value: new THREE.Color(options.foamColor ?? 0xe8f9ff) },
      uSunDirection: { value: sunDir },
      uSunColor: { value: new THREE.Color(options.sunColor ?? 0xfff1c9) },
      uCoastOffset: { value: options.coastOffset ?? 0.6 },
      uWaveAmplitude: { value: options.waveAmplitude ?? 1.0 },
      uFogColor: { value: new THREE.Color(options.fogColor ?? 0x216b94) },
      uFogNear: { value: options.fogNear ?? 95 },
      uFogFar: { value: options.fogFar ?? 210 },
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
    },
  });
}

export function updateWaterMaterial(
  material: THREE.ShaderMaterial,
  time: number,
  sunDirection?: THREE.Vector3,
): void {
  if (material.uniforms.uTime) {
    material.uniforms.uTime.value = time;
  }
  if (sunDirection && material.uniforms.uSunDirection) {
    (material.uniforms.uSunDirection.value as THREE.Vector3).copy(sunDirection).normalize();
  }
}

/**
 * Crée une géométrie océanique suffisamment subdivisée pour animer les ondes Gerstner en vertex.
 */
export function createWaterGeometry(size = 320, segments = 256): THREE.PlaneGeometry {
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
  const geo = createWaterGeometry(options.size ?? 320, options.segments ?? 256);
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
