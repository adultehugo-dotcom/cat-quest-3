// Generated & verified by scripts/fetch_studio_assets.mjs via Pillow/NumPy
// ZERO 'three' imports and ZERO DOM references — 100% Node/Vitest safe.

export type VfxCategory =
  | 'flames'
  | 'smoke'
  | 'sparks'
  | 'ice_shards'
  | 'slime_splatter'
  | 'electric_arc'
  | 'spectral_cloud'
  | 'heat_distortion_normal'
  | 'melee_slash_trail'
  | 'crater_fissure_decal'
  | 'debris_fragments';

export const VFX_CATEGORIES: readonly VfxCategory[] = [
  'flames',
  'smoke',
  'sparks',
  'ice_shards',
  'slime_splatter',
  'electric_arc',
  'spectral_cloud',
  'heat_distortion_normal',
  'melee_slash_trail',
  'crater_fissure_decal',
  'debris_fragments',
] as const;

export type VfxAssetKind = 'flipbook' | 'texture' | 'normalMap' | 'decal';

export type VfxAssetId =
  | 'flames'
  | 'fireball'
  | 'smoke'
  | 'steam_puff'
  | 'sparks'
  | 'spark_ember'
  | 'ice_shards'
  | 'ice_crystal'
  | 'slime_splatter'
  | 'slime_decal'
  | 'electric_arc'
  | 'electric_burst'
  | 'spectral_cloud'
  | 'abyssal_vortex'
  | 'heat_distortion_normal'
  | 'melee_slash_trail'
  | 'projectile_trail'
  | 'crater_fissure_decal'
  | 'scorch_decal'
  | 'debris_fragments';

export interface VfxAssetEntry {
  readonly id: VfxAssetId;
  readonly category: VfxCategory;
  readonly path: string;
  readonly kind: VfxAssetKind;
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
  readonly fps: number;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  readonly blending: 'additive' | 'normal';
  readonly dataMap?: boolean;
}

export const VFX_ASSETS: Readonly<Record<VfxAssetId, VfxAssetEntry>> = {
  "flames": {
    "id": "flames",
    "category": "flames",
    "path": "assets/vfx/flames_flipbook.png",
    "kind": "flipbook",
    "cols": 6,
    "rows": 5,
    "frames": 29,
    "fps": 24,
    "durationSec": 1.208,
    "width": 768,
    "height": 640,
    "blending": "additive"
  },
  "fireball": {
    "id": "fireball",
    "category": "flames",
    "path": "assets/vfx/fireball_flipbook.png",
    "kind": "flipbook",
    "cols": 7,
    "rows": 4,
    "frames": 28,
    "fps": 28,
    "durationSec": 1,
    "width": 896,
    "height": 512,
    "blending": "additive"
  },
  "smoke": {
    "id": "smoke",
    "category": "smoke",
    "path": "assets/vfx/smoke_flipbook.png",
    "kind": "flipbook",
    "cols": 8,
    "rows": 8,
    "frames": 59,
    "fps": 24,
    "durationSec": 2.458,
    "width": 1024,
    "height": 1024,
    "blending": "normal"
  },
  "steam_puff": {
    "id": "steam_puff",
    "category": "smoke",
    "path": "assets/vfx/steam_puff_flipbook.png",
    "kind": "flipbook",
    "cols": 5,
    "rows": 5,
    "frames": 25,
    "fps": 24,
    "durationSec": 1.042,
    "width": 1020,
    "height": 1020,
    "blending": "normal"
  },
  "sparks": {
    "id": "sparks",
    "category": "sparks",
    "path": "assets/vfx/sparks_flipbook.png",
    "kind": "flipbook",
    "cols": 8,
    "rows": 8,
    "frames": 62,
    "fps": 30,
    "durationSec": 2.067,
    "width": 1024,
    "height": 1024,
    "blending": "additive"
  },
  "spark_ember": {
    "id": "spark_ember",
    "category": "sparks",
    "path": "assets/vfx/spark_ember.png",
    "kind": "texture",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "additive"
  },
  "ice_shards": {
    "id": "ice_shards",
    "category": "ice_shards",
    "path": "assets/vfx/ice_shards_flipbook.png",
    "kind": "flipbook",
    "cols": 8,
    "rows": 8,
    "frames": 62,
    "fps": 28,
    "durationSec": 2.214,
    "width": 1024,
    "height": 1024,
    "blending": "additive"
  },
  "ice_crystal": {
    "id": "ice_crystal",
    "category": "ice_shards",
    "path": "assets/vfx/ice_crystal_shard.png",
    "kind": "texture",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "normal"
  },
  "slime_splatter": {
    "id": "slime_splatter",
    "category": "slime_splatter",
    "path": "assets/vfx/slime_splatter_flipbook.png",
    "kind": "flipbook",
    "cols": 4,
    "rows": 4,
    "frames": 14,
    "fps": 24,
    "durationSec": 0.583,
    "width": 512,
    "height": 512,
    "blending": "normal"
  },
  "slime_decal": {
    "id": "slime_decal",
    "category": "slime_splatter",
    "path": "assets/vfx/slime_splat_decal.png",
    "kind": "decal",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "normal"
  },
  "electric_arc": {
    "id": "electric_arc",
    "category": "electric_arc",
    "path": "assets/vfx/electric_arc.png",
    "kind": "flipbook",
    "cols": 1,
    "rows": 4,
    "frames": 4,
    "fps": 20,
    "durationSec": 0.2,
    "width": 1024,
    "height": 1024,
    "blending": "additive"
  },
  "electric_burst": {
    "id": "electric_burst",
    "category": "electric_arc",
    "path": "assets/vfx/electric_burst_flipbook.png",
    "kind": "flipbook",
    "cols": 8,
    "rows": 8,
    "frames": 57,
    "fps": 30,
    "durationSec": 1.9,
    "width": 1024,
    "height": 1024,
    "blending": "additive"
  },
  "spectral_cloud": {
    "id": "spectral_cloud",
    "category": "spectral_cloud",
    "path": "assets/vfx/spectral_cloud_flipbook.png",
    "kind": "flipbook",
    "cols": 8,
    "rows": 8,
    "frames": 57,
    "fps": 24,
    "durationSec": 2.375,
    "width": 1024,
    "height": 1024,
    "blending": "normal"
  },
  "abyssal_vortex": {
    "id": "abyssal_vortex",
    "category": "spectral_cloud",
    "path": "assets/vfx/abyssal_vortex_flipbook.png",
    "kind": "flipbook",
    "cols": 8,
    "rows": 4,
    "frames": 31,
    "fps": 24,
    "durationSec": 1.292,
    "width": 1024,
    "height": 512,
    "blending": "additive"
  },
  "heat_distortion_normal": {
    "id": "heat_distortion_normal",
    "category": "heat_distortion_normal",
    "path": "assets/vfx/heat_distortion_normal.png",
    "kind": "normalMap",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "normal",
    "dataMap": true
  },
  "melee_slash_trail": {
    "id": "melee_slash_trail",
    "category": "melee_slash_trail",
    "path": "assets/vfx/melee_slash_trail.png",
    "kind": "texture",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "additive"
  },
  "projectile_trail": {
    "id": "projectile_trail",
    "category": "melee_slash_trail",
    "path": "assets/vfx/projectile_trail.png",
    "kind": "texture",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "additive"
  },
  "crater_fissure_decal": {
    "id": "crater_fissure_decal",
    "category": "crater_fissure_decal",
    "path": "assets/vfx/crater_fissure_decal.png",
    "kind": "decal",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "normal"
  },
  "scorch_decal": {
    "id": "scorch_decal",
    "category": "crater_fissure_decal",
    "path": "assets/vfx/scorch_decal.png",
    "kind": "decal",
    "cols": 1,
    "rows": 1,
    "frames": 1,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "normal"
  },
  "debris_fragments": {
    "id": "debris_fragments",
    "category": "debris_fragments",
    "path": "assets/vfx/debris_fragments.png",
    "kind": "texture",
    "cols": 2,
    "rows": 2,
    "frames": 4,
    "fps": 0,
    "durationSec": 0,
    "width": 512,
    "height": 512,
    "blending": "normal"
  }
} as const;

export function getVfxAsset(id: VfxAssetId): VfxAssetEntry {
  return VFX_ASSETS[id];
}

export function getVfxAssetsByCategory(category: VfxCategory): VfxAssetEntry[] {
  return Object.values(VFX_ASSETS).filter((entry) => entry.category === category);
}

export function getAllVfxAssetPaths(): string[] {
  return Object.values(VFX_ASSETS).map((entry) => entry.path);
}

export interface VfxFlipbookUvRect {
  readonly repeatX: number;
  readonly repeatY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * Calcule le rectangle UV (repeat/offset WebGL avec V=0 en bas) pour une frame de spritesheet VFX.
 */
export function computeVfxFlipbookFrameUv(
  entry: VfxAssetEntry,
  frameIndex: number,
): VfxFlipbookUvRect {
  const cols = Math.max(1, entry.cols);
  const rows = Math.max(1, entry.rows);
  const totalFrames = Math.max(1, entry.frames);
  const safeFrame = Number.isFinite(frameIndex) ? Math.floor(frameIndex) : 0;
  const safeIdx = ((safeFrame % totalFrames) + totalFrames) % totalFrames;
  const col = safeIdx % cols;
  const row = Math.floor(safeIdx / cols);
  const repeatX = 1 / cols;
  const repeatY = 1 / rows;
  const offsetX = col * repeatX;
  const offsetY = 1 - (row + 1) * repeatY;
  return { repeatX, repeatY, offsetX, offsetY };
}

export function getVfxFrameIndexAtTime(
  entry: VfxAssetEntry,
  ageSec: number,
  loop = false,
): number {
  if (!Number.isFinite(ageSec)) return 0;
  const totalFrames = Math.max(1, entry.frames);
  if (totalFrames <= 1 || entry.fps <= 0) return 0;
  const rawFrame = Math.floor(Math.max(0, ageSec) * entry.fps);
  return loop ? rawFrame % totalFrames : Math.min(totalFrames - 1, rawFrame);
}
