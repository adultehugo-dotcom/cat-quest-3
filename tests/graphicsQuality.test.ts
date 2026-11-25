import { describe, expect, it } from 'vitest';
import { isSoftwareRendererName } from '../src/render/sceneManager';

describe('isSoftwareRendererName', () => {
  it.each([
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)',
    'ANGLE (LLVMpipe, Mesa 24.0)',
    'Software Rasterizer',
    'ANGLE (Microsoft Basic Render Driver)',
    'ANGLE (D3D11 WARP)',
  ])('recognizes software renderer "%s"', (rendererName) => {
    expect(isSoftwareRendererName(rendererName)).toBe(true);
  });

  it.each([
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 5070, Direct3D11)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, Direct3D11)',
    '',
  ])('keeps hardware or unknown renderer "%s" on the normal path', (rendererName) => {
    expect(isSoftwareRendererName(rendererName)).toBe(false);
  });
});
