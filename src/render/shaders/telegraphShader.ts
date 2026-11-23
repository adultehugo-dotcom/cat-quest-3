import * as THREE from 'three';
import type { TelegraphShape } from '../../game/types';

// ============================================================================
// Shader GLSL Télégraphes Ennemis en Hologramme Runique
// Compatible circle (0), cone (1), line (2), ring (3) sur un mesh unique
// -> ZÉRO z-fighting, bordure runique ornée pulsante, damier énergétique
//    interne qui se gorge de lumière de 0 % à 100 % jusqu'au flash d'impact !
// ============================================================================

export interface TelegraphShaderOptions {
  /** Rayon (circle/cone/ring) ou longueur (line). */
  radius: number;
  /** Rayon interne pour la forme 'ring'. */
  innerRadius?: number;
  /** Largeur pour la forme 'line'. */
  width?: number;
  /** Angle d'ouverture en radians pour la forme 'cone'. */
  arcAngle?: number;
  /** Couleur principale de l'hologramme (par défaut rouge cramoisi Cat Quest). */
  color?: THREE.ColorRepresentation;
  /** Couleur vive de la bordure runique et du front de charge. */
  brightColor?: THREE.ColorRepresentation;
}

const SHAPE_TO_INT: Record<TelegraphShape, number> = {
  circle: 0,
  cone: 1,
  line: 2,
  ring: 3,
};

export const TELEGRAPH_VERTEX_SHADER = /* glsl */ `
precision highp float;

varying vec2 vLocalPos;
varying vec3 vWorldPos;

void main() {
  vLocalPos = position.xz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TELEGRAPH_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uProgress;
uniform int uShapeType;
uniform float uRadius;
uniform float uInnerRadius;
uniform float uWidth;
uniform float uArcAngle;
uniform vec3 uColor;
uniform vec3 uBrightColor;

varying vec2 vLocalPos;
varying vec3 vWorldPos;

// Générateur procédural de glyphes runiques géométriques le long d'une bande (u = périmètre, v ∈ [0,1])
float runicGlyphBand(float u, float v) {
  float cellId = floor(u);
  vec2 f = vec2(fract(u), v);
  float h = fract(sin(cellId * 127.1 + 311.7) * 43758.5453);
  float h2 = fract(sin(cellId * 269.5 + 183.3) * 28461.7131);

  // Marges entre glyphes
  if (f.x < 0.14 || f.x > 0.86 || f.y < 0.12 || f.y > 0.88) return 0.0;

  vec2 p = (f - 0.5) * 2.0; // [-1, 1]
  float stroke = 0.0;

  // Hampe verticale ou diagonale principale
  float stem = smoothstep(0.18, 0.05, abs(p.x - (h - 0.5) * 0.45));
  stroke = max(stroke, stem);

  // Barre oblique / chevron runique
  float diag1 = smoothstep(0.20, 0.06, abs(p.y - p.x * (h > 0.5 ? 0.9 : -0.9)));
  float diag2 = smoothstep(0.20, 0.06, abs(p.y + (h2 - 0.5) * 0.85));
  stroke = max(stroke, diag1 * step(0.0, p.x * (h2 > 0.5 ? 1.0 : -1.0) + 0.35));
  stroke = max(stroke, diag2 * step(abs(p.x), 0.55));

  // Losange / point sacré sur certains glyphes
  float diamond = smoothstep(0.32, 0.16, abs(p.x) + abs(p.y));
  stroke = max(stroke, diamond * step(0.55, h2));

  return clamp(stroke, 0.0, 1.0);
}

void main() {
  float safeRadius = max(0.15, uRadius);
  float dist = length(vLocalPos);
  float safeX = (abs(vLocalPos.x) < 1e-5 && abs(vLocalPos.y) < 1e-5) ? 1e-5 : vLocalPos.x;
  float angle = atan(vLocalPos.y, safeX);

  float fillCoord = 0.0;
  float edgeDist = 1.0;       // distance en unités monde vers la bordure la plus proche
  float perimeterU = 0.0;     // coordonnée métrique le long de la bordure pour les runes
  float bandV = 0.0;          // coordonnée radiale dans la bande runique

  if (uShapeType == 0) {
    // CIRCLE
    fillCoord = clamp(dist / safeRadius, 0.0, 1.0);
    edgeDist = max(0.0, safeRadius - dist);
    perimeterU = angle * safeRadius;
    bandV = clamp(edgeDist / 0.34, 0.0, 1.0);
  } else if (uShapeType == 1) {
    // CONE
    float halfArc = max(0.1, uArcAngle * 0.5);
    fillCoord = clamp(dist / safeRadius, 0.0, 1.0);
    float outerEdge = max(0.0, safeRadius - dist);
    float sideEdge = sin(max(0.0, halfArc - abs(angle))) * dist;
    edgeDist = min(outerEdge, sideEdge);
    perimeterU = (outerEdge < sideEdge) ? angle * safeRadius : dist;
    bandV = clamp(edgeDist / 0.32, 0.0, 1.0);
  } else if (uShapeType == 2) {
    // LINE
    float halfW = max(0.15, uWidth * 0.5);
    fillCoord = clamp(vLocalPos.x / safeRadius, 0.0, 1.0);
    float edgeX = min(max(0.0, vLocalPos.x), max(0.0, safeRadius - vLocalPos.x));
    float edgeZ = max(0.0, halfW - abs(vLocalPos.y));
    edgeDist = min(edgeX, edgeZ);
    perimeterU = (edgeZ < edgeX) ? vLocalPos.x : vLocalPos.y;
    bandV = clamp(edgeDist / 0.32, 0.0, 1.0);
  } else {
    // RING
    float innerR = clamp(uInnerRadius, 0.05, safeRadius - 0.1);
    float span = max(0.1, safeRadius - innerR);
    fillCoord = clamp((dist - innerR) / span, 0.0, 1.0);
    float outerEdge = max(0.0, safeRadius - dist);
    float innerEdge = max(0.0, dist - innerR);
    edgeDist = min(outerEdge, innerEdge);
    perimeterU = angle * ((outerEdge < innerEdge) ? safeRadius : innerR);
    bandV = clamp(edgeDist / 0.32, 0.0, 1.0);
  }

  float prog = clamp(uProgress, 0.01, 1.0);

  // 1. Bordure runique ornée pulsante (liseré extérieur + filet intérieur + glyphes défilants)
  float borderPulse = 0.82 + 0.18 * sin(uTime * 8.0);
  float outerRim = smoothstep(0.13, 0.015, edgeDist);
  float innerFiligree = smoothstep(0.045, 0.008, abs(edgeDist - 0.33));

  float runeScroll = perimeterU * 1.65 + uTime * (1.2 + prog * 1.4);
  float inRuneBand = smoothstep(0.06, 0.11, edgeDist) * (1.0 - smoothstep(0.28, 0.33, edgeDist));
  float runes = runicGlyphBand(runeScroll, bandV) * inRuneBand;

  // 2. Motif interne en damier / losanges énergétiques animés (style hologramme arcanique)
  vec2 gridPos = vLocalPos * 1.65;
  // Rotation à 45° pour un damier de losanges élégant
  vec2 rotGrid = vec2(gridPos.x - gridPos.y, gridPos.x + gridPos.y);
  vec2 cellUv = fract(rotGrid) - 0.5;
  vec2 cellId = floor(rotGrid);
  float checker = mod(cellId.x + cellId.y, 2.0);
  float latticeLine = max(
    smoothstep(0.42, 0.49, abs(cellUv.x)),
    smoothstep(0.42, 0.49, abs(cellUv.y))
  );
  float energyWave = 0.5 + 0.5 * sin(fillCoord * 14.0 - uTime * 7.5);
  float energyPattern = mix(0.32, 0.72, checker) * (0.75 + 0.25 * energyWave) + latticeLine * 0.55;

  // Lignes radiales / de visée discrètes pour guider l'œil
  float radialSpokes = 0.0;
  if (uShapeType == 0 || uShapeType == 3) {
    float spokeWave = abs(sin(angle * 6.0 + uTime * 0.8));
    radialSpokes = smoothstep(0.96, 0.995, spokeWave) * 0.35;
  } else if (uShapeType == 2) {
    float chev = fract(vLocalPos.x * 0.9 - uTime * 2.8 + abs(vLocalPos.y) * 0.65);
    radialSpokes = smoothstep(0.86, 0.96, chev) * 0.32;
  }

  // 3. Remplissage progressif 0% -> 100% avec front de charge incandescent
  float filledMask = 1.0 - smoothstep(prog - 0.035, prog + 0.015, fillCoord);
  float waveFront = exp(-pow((fillCoord - prog) / 0.045, 2.0)) * smoothstep(0.02, 0.08, prog);

  // Montée en urgence & flash imminent au-delà de 82%
  float urgency = smoothstep(0.80, 1.0, prog);
  float flash = 0.5 + 0.5 * sin(uTime * 46.0);
  float imminentBoost = urgency * (0.35 + 0.65 * flash);

  // 4. Composition chromatique HDR calibrée pour déclencher un Bloom sélectif propre
  vec3 baseDark = uColor * (0.55 + 0.25 * energyPattern);
  vec3 filledCol = mix(uColor * 0.95, uBrightColor * 1.25, prog * 0.65 + imminentBoost * 0.45)
    * (0.78 + 0.42 * energyPattern + radialSpokes);
  vec3 borderCol = mix(uBrightColor, vec3(1.0, 0.86, 0.65), 0.32 + imminentBoost * 0.5)
    * (1.15 + 0.45 * prog + imminentBoost * 0.65) * borderPulse;
  vec3 frontCol = mix(uBrightColor, vec3(1.0, 0.92, 0.72), 0.55) * (1.55 + imminentBoost * 0.7);

  vec3 color = mix(baseDark, filledCol, filledMask);
  color += frontCol * waveFront * 0.95;
  color = mix(color, borderCol, clamp(outerRim + innerFiligree * 0.75 + runes * 0.92, 0.0, 1.0));

  // 5. Transparence lisible sur neige claire comme sur donjon sombre
  float baseAlpha = 0.16 + latticeLine * 0.10 + radialSpokes * 0.08;
  float filledAlpha = (0.32 + prog * 0.26 + imminentBoost * 0.18) * (0.82 + 0.25 * energyPattern);
  float borderAlpha = clamp(outerRim * 0.96 + innerFiligree * 0.68 + runes * 0.88, 0.0, 0.98);
  float frontAlpha = waveFront * 0.75;

  float alpha = max(mix(baseAlpha, filledAlpha, filledMask), max(borderAlpha, frontAlpha));
  alpha = clamp(alpha, 0.0, 0.98);

  gl_FragColor = vec4(color, alpha);
}
`;

export function createTelegraphMaterial(
  shape: TelegraphShape,
  options: TelegraphShaderOptions,
): THREE.ShaderMaterial {
  const baseColor = new THREE.Color(options.color ?? '#ff3b30');
  const brightColor = new THREE.Color(options.brightColor ?? '#ff8866');

  return new THREE.ShaderMaterial({
    name: `TelegraphRuneShader_${shape}`,
    vertexShader: TELEGRAPH_VERTEX_SHADER,
    fragmentShader: TELEGRAPH_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0.01 },
      uShapeType: { value: SHAPE_TO_INT[shape] },
      uRadius: { value: Math.max(0.15, options.radius) },
      uInnerRadius: { value: options.innerRadius ?? Math.max(0.4, options.radius * 0.45) },
      uWidth: { value: options.width ?? 2.0 },
      uArcAngle: { value: options.arcAngle ?? Math.PI * 0.45 },
      uColor: { value: baseColor },
      uBrightColor: { value: brightColor },
    },
  });
}

export function updateTelegraphMaterial(
  material: THREE.ShaderMaterial,
  progress: number,
  time: number,
): void {
  if (material.uniforms.uProgress) {
    material.uniforms.uProgress.value = Math.max(0.01, Math.min(1, progress));
  }
  if (material.uniforms.uTime) {
    material.uniforms.uTime.value = time;
  }
}
