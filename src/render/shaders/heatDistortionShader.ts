import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// ============================================================================
// Shaders de Distorsion Thermique CC0 (`heat_distortion_normal.png`)
// 1. Matériau 3D convectif pour le souffle / onde de choc de Drak-Miaou
// 2. ShaderPass Post-Processing actif uniquement quand uIntensity > 0.005
// ============================================================================

export function createHeatDistortionMaterial(
  normalMap: THREE.Texture,
  tintColor: THREE.ColorRepresentation = 0xff6a24,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'HeatDistortion3DShader',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uNormalMap: { value: normalMap },
      uTime: { value: 0 },
      uIntensity: { value: 0.7 },
      uTintColor: { value: new THREE.Color(tintColor) },
    },
    vertexShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPos;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewPos = -mv.xyz;
        vNormalView = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uNormalMap;
      uniform float uTime;
      uniform float uIntensity;
      uniform vec3 uTintColor;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPos;

      void main() {
        vec2 uv1 = vec2(vUv.x * 2.0 + uTime * 0.18, vUv.y * 2.2 - uTime * 0.95);
        vec2 uv2 = vec2(vUv.x * 3.0 - uTime * 0.14, vUv.y * 1.6 - uTime * 1.35);
        vec2 n1 = texture2D(uNormalMap, uv1).xy * 2.0 - 1.0;
        vec2 n2 = texture2D(uNormalMap, uv2).xy * 2.0 - 1.0;
        float ripple = clamp(length((n1 + n2) * 0.5), 0.0, 1.0);

        vec3 V = normalize(vViewPos);
        float fresnel = pow(1.0 - abs(dot(normalize(vNormalView), V)), 1.35);
        float verticalFade = smoothstep(0.0, 0.2, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y));
        float alpha = clamp((0.18 + ripple * 0.55) * fresnel * verticalFade * uIntensity, 0.0, 0.75);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(uTintColor * (1.25 + ripple * 0.75), alpha);
      }
    `,
  });
}

export const HeatDistortionPostShader = {
  name: 'HeatDistortionPostShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uNormalMap: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uIntensity: { value: 0 },
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
    uniform sampler2D uNormalMap;
    uniform float uTime;
    uniform float uIntensity;
    varying vec2 vUv;

    void main() {
      if (uIntensity <= 0.005) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }
      vec2 nUv1 = vec2(vUv.x * 2.2 + uTime * 0.08, vUv.y * 2.2 - uTime * 0.42);
      vec2 nUv2 = vec2(vUv.x * 3.1 - uTime * 0.06, vUv.y * 3.1 - uTime * 0.28);
      vec2 n1 = texture2D(uNormalMap, nUv1).xy * 2.0 - 1.0;
      vec2 n2 = texture2D(uNormalMap, nUv2).xy * 2.0 - 1.0;
      vec2 offset = (n1 + n2) * 0.0065 * clamp(uIntensity, 0.0, 1.0);

      // Plus fort autour de la zone centrale et sur la moitié basse/arène
      float centerWeight = 0.55 + 0.45 * (1.0 - smoothstep(0.05, 0.72, distance(vUv, vec2(0.5, 0.48))));
      vec2 warpedUv = clamp(vUv + offset * centerWeight, 0.001, 0.999);
      vec4 baseCol = texture2D(tDiffuse, warpedUv);
      vec3 warmGlow = vec3(1.0, 0.36, 0.08) * (0.045 * uIntensity * centerWeight);
      gl_FragColor = vec4(baseCol.rgb + warmGlow, baseCol.a);
    }
  `,
};

export function createHeatDistortionPass(normalMap?: THREE.Texture): ShaderPass {
  const pass = new ShaderPass(HeatDistortionPostShader);
  if (normalMap) {
    pass.uniforms.uNormalMap.value = normalMap;
  }
  pass.enabled = false;
  return pass;
}
