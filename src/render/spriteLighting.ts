import * as THREE from 'three';

/** Shared, allocation-free light data used by 2.5D cutout sprites. */
export const SPRITE_LIGHT_COUNT = 9;

const positions = Array.from({ length: SPRITE_LIGHT_COUNT }, () => new THREE.Vector4());
const colors = Array.from({ length: SPRITE_LIGHT_COUNT }, () => new THREE.Vector4());
export const SPRITE_LIGHT_UNIFORMS = {
  uSpriteLightPositionRange: { value: positions },
  uSpriteLightColorIntensity: { value: colors },
};

/**
 * Publishes one nearby PointLight to the sprite shader. Positions and colors are
 * updated in-place so the render loop doesn't allocate vectors or uniform arrays.
 */
export function setSpriteLight(
  index: number,
  position: THREE.Vector3,
  color: THREE.Color,
  intensity: number,
  distance: number,
): void {
  if (index < 0 || index >= SPRITE_LIGHT_COUNT) return;
  positions[index].set(position.x, position.y, position.z, Math.max(0, distance));
  colors[index].set(color.r, color.g, color.b, intensity > 0 && distance > 0 ? intensity : 0);
}

/** Disable one slot without reallocating the shader uniform data. */
export function clearSpriteLight(index: number): void {
  if (index < 0 || index >= SPRITE_LIGHT_COUNT) return;
  colors[index].w = 0;
}

/** Adds a color-preserving floor and nearby warm/cool lights to cutout sprites. */
export function enableSpriteLighting(material: THREE.MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, SPRITE_LIGHT_UNIFORMS);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vSpriteWorldPosition;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvSpriteWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vSpriteWorldPosition;
        uniform vec4 uSpriteLightPositionRange[${SPRITE_LIGHT_COUNT}];
        uniform vec4 uSpriteLightColorIntensity[${SPRITE_LIGHT_COUNT}];`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// Keep sprite colors readable even when the environment is dark.
        outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.34);
        for (int i = 0; i < ${SPRITE_LIGHT_COUNT}; i++) {
          vec4 positionRange = uSpriteLightPositionRange[i];
          vec4 colorIntensity = uSpriteLightColorIntensity[i];
          if (colorIntensity.w <= 0.0) continue;
          vec3 toLight = positionRange.xyz - vSpriteWorldPosition;
          float distanceToLight = length(toLight);
          float normalizedDistance = distanceToLight / max(positionRange.w, 0.001);
          float attenuation = pow(max(1.0 - normalizedDistance, 0.0), 2.0);
          float localStrength = min(colorIntensity.w * 0.11, 0.72) * attenuation;
          outgoingLight += diffuseColor.rgb * colorIntensity.rgb * localStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => 'fel-ingard-sprite-lighting-v1';
  material.needsUpdate = true;
}
