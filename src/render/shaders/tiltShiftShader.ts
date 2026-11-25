import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// ============================================================================
// Post-Processing ShaderPass Custom : Tilt-Shift Diorama + Vignette Douce
// Flou vertical progressif façon objectif macro en haut & en bas, préservant
// une large bande centrale 100 % nette pour la lisibilité du gameplay !
// ============================================================================

export interface TiltShiftVignetteOptions {
  /** Position verticale du plan de netteté [0..1] (0.48 = zone centrale gameplay). */
  focusY?: number;
  /** Demi-hauteur de la bande centrale parfaitement nette [0..0.5]. */
  focusWidth?: number;
  /** Largeur de la transition progressive vers le flou maximal. */
  falloff?: number;
  /** Rayon maximal du bokeh en pixels (subtil pour garder une maquette précise). */
  maxBlur?: number;
  /** Intensité de la vignette cinématographique douce [0..1]. */
  vignetteStrength?: number;
  /** Rayon de départ de la vignette. */
  vignetteRadius?: number;
  /** Léger rehaussement de saturation diorama (1.0 = neutre). */
  saturation?: number;
}

export const TiltShiftVignetteShader = {
  name: 'TiltShiftVignetteShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1280, 720) },
    uFocusY: { value: 0.48 },
    uFocusWidth: { value: 0.24 },
    uFalloff: { value: 0.28 },
    uMaxBlur: { value: 3.4 },
    uVignetteStrength: { value: 0.24 },
    uVignetteRadius: { value: 0.76 },
    uSaturation: { value: 1.04 },
    uTime: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uFocusY;
    uniform float uFocusWidth;
    uniform float uFalloff;
    uniform float uMaxBlur;
    uniform float uVignetteStrength;
    uniform float uVignetteRadius;
    uniform float uSaturation;

    varying vec2 vUv;

    void main() {
      // Distance verticale à la bande centrale nette (légèrement plus doux en bas pour le premier plan)
      float dy = vUv.y - uFocusY;
      float asymDist = dy < 0.0 ? abs(dy) * 0.92 : abs(dy) * 1.08;
      float blurMask = smoothstep(uFocusWidth, uFocusWidth + uFalloff, asymDist);

      vec4 centerSample = texture2D(tDiffuse, vUv);
      vec3 color = centerSample.rgb;

      // Zone centrale 100 % nette : 0 échantillon supplémentaire (max FPS + piqué parfait)
      if (blurMask > 0.005 && uMaxBlur > 0.05) {
        vec2 texel = (uMaxBlur * blurMask) / max(uResolution, vec2(1.0));

        // Noyau bokeh circulaire 12 taps (2 anneaux concentriques) — doux, sans banding
        vec3 acc = color * 1.6;
        float weightSum = 1.6;

        // Anneau interne (r = 0.52)
        acc += texture2D(tDiffuse, vUv + vec2( 0.52,  0.00) * texel).rgb * 1.0;
        acc += texture2D(tDiffuse, vUv + vec2(-0.52,  0.00) * texel).rgb * 1.0;
        acc += texture2D(tDiffuse, vUv + vec2( 0.26,  0.45) * texel).rgb * 1.0;
        acc += texture2D(tDiffuse, vUv + vec2(-0.26,  0.45) * texel).rgb * 1.0;
        acc += texture2D(tDiffuse, vUv + vec2( 0.26, -0.45) * texel).rgb * 1.0;
        acc += texture2D(tDiffuse, vUv + vec2(-0.26, -0.45) * texel).rgb * 1.0;
        weightSum += 6.0;

        // Anneau externe (r = 1.0, légèrement étiré verticalement pour bokeh maquette)
        vec2 outerTexel = texel * vec2(0.95, 1.15);
        acc += texture2D(tDiffuse, vUv + vec2( 0.00,  1.00) * outerTexel).rgb * 0.72;
        acc += texture2D(tDiffuse, vUv + vec2( 0.00, -1.00) * outerTexel).rgb * 0.72;
        acc += texture2D(tDiffuse, vUv + vec2( 0.866,  0.50) * outerTexel).rgb * 0.72;
        acc += texture2D(tDiffuse, vUv + vec2(-0.866,  0.50) * outerTexel).rgb * 0.72;
        acc += texture2D(tDiffuse, vUv + vec2( 0.866, -0.50) * outerTexel).rgb * 0.72;
        acc += texture2D(tDiffuse, vUv + vec2(-0.866, -0.50) * outerTexel).rgb * 0.72;
        weightSum += 4.32;

        color = acc / weightSum;
      }

      // Micro-rehaussement de vibrance diorama en espace linéaire
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);

      // Vignette optique douce aux coins (préserve parfaitement la lisibilité centrale)
      vec2 centered = (vUv - 0.5) * vec2(1.06, 1.0);
      float radial = length(centered) * 1.4142;
      float vig = smoothstep(uVignetteRadius, uVignetteRadius + 0.62, radial);
      // Teinte de vignette très légèrement chaude/cinématographique
      vec3 vigTint = mix(vec3(1.0), vec3(0.94, 0.92, 0.96), vig * uVignetteStrength);
      color *= mix(1.0, 1.0 - uVignetteStrength, vig) * vigTint;

      gl_FragColor = vec4(max(color, vec3(0.0)), centerSample.a);
    }
  `,
};

export function createTiltShiftVignettePass(
  options: TiltShiftVignetteOptions = {},
): ShaderPass {
  const pass = new ShaderPass(TiltShiftVignetteShader);
  if (options.focusY !== undefined) pass.uniforms.uFocusY.value = options.focusY;
  if (options.focusWidth !== undefined) pass.uniforms.uFocusWidth.value = options.focusWidth;
  if (options.falloff !== undefined) pass.uniforms.uFalloff.value = options.falloff;
  if (options.maxBlur !== undefined) pass.uniforms.uMaxBlur.value = options.maxBlur;
  if (options.vignetteStrength !== undefined) {
    pass.uniforms.uVignetteStrength.value = options.vignetteStrength;
  }
  if (options.vignetteRadius !== undefined) {
    pass.uniforms.uVignetteRadius.value = options.vignetteRadius;
  }
  if (options.saturation !== undefined) {
    pass.uniforms.uSaturation.value = options.saturation;
  }
  return pass;
}

export function updateTiltShiftResolution(
  pass: ShaderPass,
  width: number,
  height: number,
): void {
  if (pass.uniforms.uResolution) {
    (pass.uniforms.uResolution.value as THREE.Vector2).set(
      Math.max(1, width),
      Math.max(1, height),
    );
  }
}
