import * as THREE from 'three';

/**
 * Shared, allocation-free dynamic light data used by 2.5D PBR cutout sprites & cloth.
 * Slots:
 * - 0..7 : 8 nearest real world lights (torches, lampposts, forge hearth, portals, crystals, golden chests)
 * - 8    : Hero lantern real PointLight
 * - 9    : Hero luminous weapon real PointLight
 * - 10   : Companion Miaou-sprit real PointLight
 * - 11   : Nearest luminous boss / enemy real PointLight (or transient spell light)
 */
export const SPRITE_LIGHT_COUNT = 12;

export const SPRITE_LIGHT_SLOT = {
  WORLD_START: 0,
  WORLD_COUNT: 8,
  HERO_LANTERN: 8,
  HERO_WEAPON: 9,
  COMPANION: 10,
  ENEMY_OR_SPELL: 11,
} as const;

const positions = Array.from({ length: SPRITE_LIGHT_COUNT }, () => new THREE.Vector4());
const colors = Array.from({ length: SPRITE_LIGHT_COUNT }, () => new THREE.Vector4());

export const SPRITE_LIGHT_UNIFORMS = {
  uSpriteLightPositionRange: { value: positions },
  uSpriteLightColorIntensity: { value: colors },
};

/**
 * Publishes one real Three.js PointLight to the PBR sprite & cloth shaders.
 * Positions and colors are updated in-place so the render loop allocates nothing per frame.
 */
export function setSpriteLight(
  index: number,
  position: THREE.Vector3,
  color: THREE.Color,
  intensity: number,
  distance: number,
): void {
  if (index < 0 || index >= SPRITE_LIGHT_COUNT) return;
  const safeDist = Math.max(0, distance);
  const safeIntensity = Number.isFinite(intensity) && intensity > 0 && safeDist > 0 ? intensity : 0;
  positions[index].set(position.x, position.y, position.z, safeDist);
  colors[index].set(color.r, color.g, color.b, safeIntensity);
}

/** Disable one slot without reallocating uniform arrays. */
export function clearSpriteLight(index: number): void {
  if (index < 0 || index >= SPRITE_LIGHT_COUNT) return;
  colors[index].w = 0;
}

/** Read-only diagnostic accessor for unit tests and QA inspection. */
export function getSpriteLightSlotSnapshot(index: number): {
  x: number;
  y: number;
  z: number;
  distance: number;
  r: number;
  g: number;
  b: number;
  intensity: number;
} | null {
  if (index < 0 || index >= SPRITE_LIGHT_COUNT) return null;
  const p = positions[index];
  const c = colors[index];
  return {
    x: p.x,
    y: p.y,
    z: p.z,
    distance: p.w,
    r: c.x,
    g: c.y,
    b: c.z,
    intensity: c.w,
  };
}

export interface HeroSpriteMaskUniforms {
  /** (centerU, centerV, halfW, halfH) en espace UV cellule [0..1] */
  uHeroTorsoMask: { value: THREE.Vector4 };
  /** (centerU, centerV, halfW, halfH) en espace UV cellule [0..1] */
  uHeroHeadMask: { value: THREE.Vector4 };
  /** (torsoEnabled, headEnabled, torsoRotZ, headRotZ) */
  uHeroMaskMeta: { value: THREE.Vector4 };
}

export function createHeroMaskUniforms(): HeroSpriteMaskUniforms {
  return {
    uHeroTorsoMask: { value: new THREE.Vector4(0.463, 0.283, 0.068, 0.072) },
    uHeroHeadMask: { value: new THREE.Vector4(0.449, 0.745, 0.178, 0.158) },
    uHeroMaskMeta: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

export interface EnableSpriteLightingOptions {
  heroMaskUniforms?: HeroSpriteMaskUniforms;
}

/**
 * Injects real shader-based dynamic lighting (physical inverse-square attenuation,
 * wrapped normal diffuse, and roughness/metalness-driven specular highlights) into
 * 2.5D PBR MeshStandardMaterial sprites. Replaces fake additive halo billboards.
 */
export function enableSpriteLighting(
  material: THREE.MeshStandardMaterial,
  options?: EnableSpriteLightingOptions,
): void {
  const heroMaskUniforms = options?.heroMaskUniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SPRITE_LIGHT_UNIFORMS);
    if (heroMaskUniforms) {
      Object.assign(shader.uniforms, heroMaskUniforms);
    }

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSpriteWorldPosition;
        varying vec3 vSpriteWorldNormal;${
          heroMaskUniforms ? '\n        varying vec2 vHeroCellUv;' : ''
        }`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vSpriteWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vSpriteWorldNormal = normalize(mat3(modelMatrix) * objectNormal);${
          heroMaskUniforms ? '\n        vHeroCellUv = uv;' : ''
        }`,
      );

    let fragShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSpriteWorldPosition;
        varying vec3 vSpriteWorldNormal;
        uniform vec4 uSpriteLightPositionRange[${SPRITE_LIGHT_COUNT}];
        uniform vec4 uSpriteLightColorIntensity[${SPRITE_LIGHT_COUNT}];${
          heroMaskUniforms
            ? `\n        varying vec2 vHeroCellUv;
        uniform vec4 uHeroTorsoMask;
        uniform vec4 uHeroHeadMask;
        uniform vec4 uHeroMaskMeta;`
            : ''
        }`,
      );

    if (heroMaskUniforms) {
      fragShader = fragShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (uHeroMaskMeta.x > 0.5) {
          vec2 td = vHeroCellUv - uHeroTorsoMask.xy;
          float tc = cos(-uHeroMaskMeta.z);
          float ts = sin(-uHeroMaskMeta.z);
          vec2 tLocal = vec2(td.x * tc - td.y * ts, td.x * ts + td.y * tc);
          vec2 tNorm = tLocal / max(uHeroTorsoMask.zw, vec2(0.0001));
          // Superellipse ajustée au torse : zéro découpe des épaules, bras ou queue
          if (pow(abs(tNorm.x), 2.4) + pow(abs(tNorm.y), 2.4) <= 1.0) {
            discard;
          }
        }
        if (uHeroMaskMeta.y > 0.5) {
          vec2 hd = vHeroCellUv - uHeroHeadMask.xy;
          float hc = cos(-uHeroMaskMeta.w);
          float hs = sin(-uHeroMaskMeta.w);
          vec2 hLocal = vec2(hd.x * hc - hd.y * hs, hd.x * hs + hd.y * hc);
          vec2 hNorm = hLocal / max(uHeroHeadMask.zw, vec2(0.0001));
          // Masque le haut du crâne + oreilles tout en préservant les yeux et le museau
          if (hLocal.y >= -uHeroHeadMask.w * 0.77 && dot(hNorm, hNorm) <= 1.0) {
            discard;
          }
        }`,
      );
    }

    shader.fragmentShader = fragShader
      .replace(
        '#include <opaque_fragment>',
        `// Plancher doux de lisibilité nocturne (préserve le contraste réel lumière/ombre)
        outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.24);

        vec3 spriteN = normalize(vSpriteWorldNormal);
        if (!gl_FrontFacing) {
          spriteN = -spriteN;
        }
        vec3 spriteV = normalize(cameraPosition - vSpriteWorldPosition);
        float spriteRough = clamp(roughnessFactor, 0.08, 1.0);
        float spriteMetal = clamp(metalnessFactor, 0.0, 1.0);
        float spriteShininess = mix(64.0, 6.0, spriteRough);
        float spriteSpecWeight = mix(0.08, 0.50, spriteMetal) * (1.0 - spriteRough * 0.68);
        vec3 spriteSpecTint = mix(vec3(1.0), diffuseColor.rgb, spriteMetal);

        vec3 spriteLightAdd = vec3(0.0);
        for (int i = 0; i < ${SPRITE_LIGHT_COUNT}; i++) {
          vec4 positionRange = uSpriteLightPositionRange[i];
          vec4 colorIntensity = uSpriteLightColorIntensity[i];
          if (colorIntensity.w <= 0.0 || positionRange.w <= 0.001) continue;

          vec3 toLight = positionRange.xyz - vSpriteWorldPosition;
          float dist = length(toLight);
          float rangeRatio = clamp(dist / positionRange.w, 0.0, 1.0);
          float windowAtt = pow(max(1.0 - rangeRatio * rangeRatio, 0.0), 2.0);
          float physAtt = windowAtt / (1.0 + 0.28 * dist * dist);

          vec3 L = toLight / max(dist, 0.0001);
          // Lambert enveloppé réaliste adapté aux plans 2.5D inclinés
          float ndl = clamp(dot(spriteN, L) * 0.56 + 0.44, 0.0, 1.0);

          // Spéculaire Blinn-Phong piloté par roughness & metalness PBR réels
          vec3 H = normalize(L + spriteV);
          float ndh = max(dot(spriteN, H), 0.0);
          float spec = pow(ndh, spriteShininess) * spriteSpecWeight;

          vec3 radiance = colorIntensity.rgb * min(colorIntensity.w * 0.042, 0.44) * physAtt;
          vec3 diffuseTerm = diffuseColor.rgb * (1.0 - spriteMetal * 0.42) * ndl;
          spriteLightAdd += (diffuseTerm + spriteSpecTint * spec) * radiance;
        }
        // Compression douce des hautes lumières pour éviter tout écrêtage blanc quand plusieurs lampes se croisent
        outgoingLight += spriteLightAdd / (vec3(1.0) + spriteLightAdd * 0.65);
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () =>
    heroMaskUniforms ? 'fel-ingard-hero-masked-pbr-v1' : 'fel-ingard-sprite-lighting-pbr-v4';
  material.needsUpdate = true;
}
