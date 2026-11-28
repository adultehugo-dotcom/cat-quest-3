import * as THREE from 'three';

// ============================================================================
// Shaders CC0 pour Arcs de Slash 3D, Traînées de Projectiles & Flipbooks Poolés
// Utilisent melee_slash_trail.png, projectile_trail.png et les spritesheets VFX
// ============================================================================

export interface SlashTrailShaderOptions {
  texture: THREE.Texture;
  primaryColor?: THREE.ColorRepresentation;
  edgeColor?: THREE.ColorRepresentation;
  isThrust?: boolean;
}

export function createSlashTrailShaderMaterial(
  options: SlashTrailShaderOptions,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Cc0WeaponSlashShader',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: options.texture },
      uProgress: { value: 0 },
      uPrimaryColor: { value: new THREE.Color(options.primaryColor ?? 0xfff0b8) },
      uEdgeColor: { value: new THREE.Color(options.edgeColor ?? 0xffa83e) },
      uIsThrust: { value: options.isThrust ? 1.0 : 0.0 },
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
      uniform sampler2D uMap;
      uniform float uProgress;
      uniform vec3 uPrimaryColor;
      uniform vec3 uEdgeColor;
      uniform float uIsThrust;
      varying vec2 vUv;

      void main() {
        float prog = clamp(uProgress, 0.0, 1.0);
        vec2 sampleUv = uIsThrust > 0.5
          ? vec2(clamp(vUv.x - prog * 0.25, 0.0, 1.0), vUv.y)
          : vec2(vUv.x, vUv.y);
        vec4 tex = texture2D(uMap, sampleUv);
        float texLum = max(tex.a, max(tex.r, max(tex.g, tex.b)));

        float head = clamp(prog * 1.48, 0.0, 1.0);
        float tail = max(0.0, head - 0.68);
        float along = smoothstep(tail, head, vUv.x) * (1.0 - smoothstep(head, min(1.0, head + 0.1), vUv.x));
        float radialBand = uIsThrust > 0.5
          ? exp(-pow((vUv.y - 0.5) / 0.26, 2.0))
          : exp(-pow((vUv.y - 0.56) / 0.25, 2.0));
        float core = exp(-pow((vUv.y - (uIsThrust > 0.5 ? 0.5 : 0.62)) / 0.11, 2.0));
        float fade = 1.0 - smoothstep(0.62, 1.0, prog);

        float detailMask = mix(0.45, 1.15, clamp(texLum, 0.0, 1.0));
        vec3 col = mix(uEdgeColor, uPrimaryColor, clamp(core + texLum * 0.35, 0.0, 1.0)) * (1.55 + core * 0.45);
        float alpha = clamp(along * radialBand * detailMask * fade, 0.0, 0.96);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export interface ProjectileTrailOptions {
  texture: THREE.Texture;
  primaryColor?: THREE.ColorRepresentation;
  edgeColor?: THREE.ColorRepresentation;
}

export function createProjectileTrailMaterial(
  options: ProjectileTrailOptions,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Cc0ProjectileTrailShader',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: options.texture },
      uTime: { value: 0 },
      uOpacity: { value: 0.9 },
      uPrimaryColor: { value: new THREE.Color(options.primaryColor ?? 0xffffff) },
      uEdgeColor: { value: new THREE.Color(options.edgeColor ?? 0xff9f40) },
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
      uniform sampler2D uMap;
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uPrimaryColor;
      uniform vec3 uEdgeColor;
      varying vec2 vUv;

      void main() {
        vec2 scrollUv = vec2(fract(vUv.x * 1.4 - uTime * 3.8), vUv.y);
        vec4 tex = texture2D(uMap, scrollUv);
        float lum = max(tex.a, max(tex.r, max(tex.g, tex.b)));
        float taper = smoothstep(0.0, 0.85, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
        float core = exp(-pow((vUv.y - 0.5) / 0.24, 2.0));
        vec3 col = mix(uEdgeColor, uPrimaryColor, core) * (1.35 + lum * 0.4);
        float alpha = clamp(taper * core * mix(0.4, 1.0, lum) * uOpacity, 0.0, 0.92);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createFlipbookVfxMaterial(
  texture: THREE.Texture,
  additive = true,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'Cc0FlipbookVfxShader',
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: texture },
      uUvRect: { value: new THREE.Vector4(1, 1, 0, 0) },
      uColor: { value: new THREE.Color(0xffffff) },
      uOpacity: { value: 1.0 },
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
      uniform sampler2D uMap;
      uniform vec4 uUvRect;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;

      void main() {
        vec2 uv = vUv * uUvRect.xy + uUvRect.zw;
        vec4 tex = texture2D(uMap, uv);
        float alpha = tex.a * uOpacity;
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(tex.rgb * uColor, alpha);
      }
    `,
  });
}
