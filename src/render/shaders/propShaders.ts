import * as THREE from 'three';

// ============================================================================
// Shaders GLSL sur mesure pour le pipeline d'animation 2.5D/3D :
//  1. Vent vertex-based ancré à la base (arbres, fleurs, panneaux)
//  2. Pulsation émissive / aura runique (armes légendaires, champignons,
//     piliers runiques de donjon, cristaux, fenêtres chaudes de bâtiments)
//  3. Sceau runique rotatif & vortex de portail UV-scroll
//  4. Arc de coupe d'épée séparé (jamais peint dans la texture d'arme)
// ============================================================================

export interface WindSwayUniforms {
  uWindTime: { value: number };
  uWindStrength: { value: number };
  uWindPhase: { value: number };
  uWindFrequency: { value: number };
  uRustleAmp: { value: number };
}

export interface EmissivePulseUniforms {
  uPulseTime: { value: number };
  uPulseColor: { value: THREE.Color };
  uPulseStrength: { value: number };
  uPulseSpeed: { value: number };
  uPulsePhase: { value: number };
}

export interface WindSwayShaderOptions {
  phase?: number;
  strength?: number;
  frequency?: number;
  rustleAmp?: number;
}

/**
 * Uniforme global de vent partagé pour tous les props végétaux & panneaux
 * afin de piloter le vent météo sans recompiler de shader.
 */
export const SHARED_PROP_WIND_UNIFORMS = {
  uGlobalWindTime: { value: 0 },
  uGlobalWindPower: { value: 0.25 },
  uGlobalWindDirX: { value: 0.85 },
};

/**
 * Applique un Vertex Shader de balancement sinusoïdal strictement ancré à la
 * base (`uv.y == 0` => déplacement 0) sur un matériau de sprite 2.5D.
 * Compatible avec `enableSpriteLighting` (chaînage `onBeforeCompile`).
 */
export function applyWindSwayShader(
  material: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  options: WindSwayShaderOptions = {},
): WindSwayUniforms {
  const uniforms: WindSwayUniforms = {
    uWindTime: SHARED_PROP_WIND_UNIFORMS.uGlobalWindTime,
    uWindStrength: { value: options.strength ?? 0.085 },
    uWindPhase: { value: options.phase ?? 0 },
    uWindFrequency: { value: options.frequency ?? 1.8 },
    uRustleAmp: { value: options.rustleAmp ?? 0.014 },
  };

  const prevCompile = material.onBeforeCompile;
  const prevCacheKey = material.customProgramCacheKey?.bind(material);

  material.customProgramCacheKey = () =>
    `${prevCacheKey ? prevCacheKey() : 'base'}|prop-wind-sway-v1`;

  material.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) {
      prevCompile(shader, renderer);
    }

    shader.uniforms.uWindTime = uniforms.uWindTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uWindPhase = uniforms.uWindPhase;
    shader.uniforms.uWindFrequency = uniforms.uWindFrequency;
    shader.uniforms.uRustleAmp = uniforms.uRustleAmp;
    shader.uniforms.uGlobalWindPower = SHARED_PROP_WIND_UNIFORMS.uGlobalWindPower;
    shader.uniforms.uGlobalWindDirX = SHARED_PROP_WIND_UNIFORMS.uGlobalWindDirX;

    shader.vertexShader =
      /* glsl */ `
      uniform float uWindTime;
      uniform float uWindStrength;
      uniform float uWindPhase;
      uniform float uWindFrequency;
      uniform float uRustleAmp;
      uniform float uGlobalWindPower;
      uniform float uGlobalWindDirX;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      #include <begin_vertex>
      {
        // Hauteur normalisée [0..1] : 0 à la racine/base, 1 à la cime
        float h = clamp(uv.y, 0.0, 1.0);
        float bendWeight = h * h;
        float windScale = 0.72 + uGlobalWindPower * 1.85;
        float gust = sin(uWindTime * uWindFrequency + uWindPhase)
          + 0.42 * sin(uWindTime * (uWindFrequency * 2.13) + uWindPhase * 1.7 + uv.x * 3.0);
        float swayX = (gust + uGlobalWindDirX * uGlobalWindPower * 0.45)
          * uWindStrength * windScale * bendWeight;
        // Frémissement haute fréquence des feuilles/fleurs vers la cime
        float rustle = sin(uWindTime * 6.8 + uWindPhase * 2.3 + uv.x * 9.5 + uv.y * 5.0)
          * uRustleAmp * (0.65 + uGlobalWindPower) * smoothstep(0.18, 0.95, h);
        transformed.x += swayX + rustle;
        transformed.y -= abs(swayX) * 0.14 * h;
      }
      `,
    );
  };

  material.needsUpdate = true;
  return uniforms;
}

/**
 * Applique un shader de pulsation lumineuse / émissive sur un matériau
 * (ex : `staff_arcane`, `blade_dragon`, `prop_mushroom`, `prop_pillar`, `prop_crystal`).
 */
export function applyEmissivePulseShader(
  material: THREE.MeshLambertMaterial | THREE.MeshStandardMaterial,
  colorHex: number,
  strength = 0.42,
  speed = 3.2,
  phase = 0,
): EmissivePulseUniforms {
  const uniforms: EmissivePulseUniforms = {
    uPulseTime: SHARED_PROP_WIND_UNIFORMS.uGlobalWindTime,
    uPulseColor: { value: new THREE.Color(colorHex) },
    uPulseStrength: { value: strength },
    uPulseSpeed: { value: speed },
    uPulsePhase: { value: phase },
  };

  const prevCompile = material.onBeforeCompile;
  const prevCacheKey = material.customProgramCacheKey?.bind(material);

  material.customProgramCacheKey = () =>
    `${prevCacheKey ? prevCacheKey() : 'base'}|emissive-pulse-v1`;

  material.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) {
      prevCompile(shader, renderer);
    }

    shader.uniforms.uPulseTime = uniforms.uPulseTime;
    shader.uniforms.uPulseColor = uniforms.uPulseColor;
    shader.uniforms.uPulseStrength = uniforms.uPulseStrength;
    shader.uniforms.uPulseSpeed = uniforms.uPulseSpeed;
    shader.uniforms.uPulsePhase = uniforms.uPulsePhase;

    shader.fragmentShader =
      /* glsl */ `
      uniform float uPulseTime;
      uniform vec3 uPulseColor;
      uniform float uPulseStrength;
      uniform float uPulseSpeed;
      uniform float uPulsePhase;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      /* glsl */ `
      #include <emissivemap_fragment>
      {
        float wave = 0.5 + 0.5 * sin(uPulseTime * uPulseSpeed + uPulsePhase);
        float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        float mask = smoothstep(0.28, 0.85, luma);
        totalEmissiveRadiance += uPulseColor * (uPulseStrength * (0.45 + 0.55 * wave) * (0.35 + 0.65 * mask));
      }
      `,
    );
  };

  material.needsUpdate = true;
  return uniforms;
}

/**
 * Sceau runique rotatif et pulsant pour `portal_dungeon.png` (entrée de donjon).
 */
export function createPortalRunicSealMaterial(
  primaryColor: THREE.ColorRepresentation = 0x9b66ff,
  accentColor: THREE.ColorRepresentation = 0xffe485,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'PortalRunicSealShader',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uSealed: { value: 0 },
      uPrimaryColor: { value: new THREE.Color(primaryColor) },
      uAccentColor: { value: new THREE.Color(accentColor) },
    },
    vertexShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uSealed;
      uniform vec3 uPrimaryColor;
      uniform vec3 uAccentColor;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        float a = atan(p.y, p.x);
        float rotA = a + uTime * (0.85 + uSealed * 0.45);
        float rotB = a - uTime * 1.15;

        float outerRing = exp(-pow((r - 0.84) / 0.055, 2.0));
        float innerRing = exp(-pow((r - 0.56) / 0.045, 2.0));
        float runes = pow(0.5 + 0.5 * cos(rotA * 12.0), 8.0)
          * smoothstep(0.60, 0.70, r) * (1.0 - smoothstep(0.79, 0.86, r));
        float innerGlyphs = pow(0.5 + 0.5 * sin(rotB * 8.0 + r * 8.0), 6.0)
          * smoothstep(0.22, 0.52, r) * (1.0 - smoothstep(0.54, 0.62, r));
        float corePulse = exp(-r * r * 6.5) * (0.55 + 0.45 * sin(uTime * 3.8));

        float pulse = 0.82 + 0.24 * sin(uTime * 3.2);
        vec3 baseCol = mix(uPrimaryColor, uAccentColor, clamp(runes + innerRing * 0.5 + uSealed * 0.4, 0.0, 1.0));
        vec3 col = baseCol * (1.15 * pulse);
        float alpha = clamp((outerRing * 0.82 + innerRing * 0.58 + runes * 0.88 + innerGlyphs * 0.55 + corePulse * 0.42) * (1.0 - smoothstep(0.88, 1.0, r)), 0.0, 0.92);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Vortex animé pour le portail de sortie (`portal_exit_sheet.png` — 30 frames / 6×5
 * ou spirale procédurale GLSL UV-scroll en repli sans 404).
 */
export function createPortalExitVortexMaterial(
  colorA: THREE.ColorRepresentation = 0x56f0d8,
  colorB: THREE.ColorRepresentation = 0xfff099,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'PortalExitVortexShader',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uFrameNorm: { value: 0 },
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
    },
    vertexShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime;
      uniform float uFrameNorm;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying vec2 vUv;

      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        if (r > 1.0) discard;

        float a = atan(p.y, p.x);
        float swirl = a + r * 5.2 - uFrameNorm * 6.2831853 - uTime * 0.6;
        float arms = pow(0.5 + 0.5 * sin(swirl * 3.0), 3.0);
        float rings = 0.5 + 0.5 * sin(r * 16.0 - uFrameNorm * 6.2831853 * 2.0);
        float rim = exp(-pow((r - 0.80) / 0.09, 2.0));
        float core = exp(-r * r * 5.0);

        vec3 col = mix(uColorA, uColorB, clamp(arms * 0.55 + core * 0.85, 0.0, 1.0)) * 1.25;
        float alpha = clamp((arms * 0.52 + rings * 0.18 + rim * 0.72 + core * 0.82) * (1.0 - smoothstep(0.84, 1.0, r)), 0.0, 0.92);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Arc de coupe mêlée séparé des textures d'armes (contrainte stricte du pipeline :
 * les armes ne peignent jamais leur arc de coupe dans la texture).
 */
export function createWeaponSlashArcMaterial(
  primaryColor: THREE.ColorRepresentation = 0xfff0b8,
  edgeColor: THREE.ColorRepresentation = 0xffa83e,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'WeaponSlashArcShader',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uProgress: { value: 0 },
      uPrimaryColor: { value: new THREE.Color(primaryColor) },
      uEdgeColor: { value: new THREE.Color(edgeColor) },
    },
    vertexShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uProgress;
      uniform vec3 uPrimaryColor;
      uniform vec3 uEdgeColor;
      varying vec2 vUv;

      void main() {
        float prog = clamp(uProgress, 0.0, 1.0);
        // vUv.x = progression le long du croissant, vUv.y = épaisseur radiale
        float head = clamp(prog * 1.45, 0.0, 1.0);
        float tail = max(0.0, head - 0.62);
        float along = smoothstep(tail, head, vUv.x) * (1.0 - smoothstep(head, min(1.0, head + 0.09), vUv.x));
        float blade = exp(-pow((vUv.y - 0.55) / 0.24, 2.0));
        float core = exp(-pow((vUv.y - 0.62) / 0.11, 2.0));
        float fade = 1.0 - smoothstep(0.65, 1.0, prog);

        vec3 col = mix(uEdgeColor, uPrimaryColor, core) * 1.45;
        float alpha = clamp(along * blade * fade, 0.0, 0.96);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}
