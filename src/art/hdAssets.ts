import * as THREE from 'three';

// ============================================================================
// Manifeste & chargeur asynchrone des assets HD (Personnages, Props, PBR)
// ============================================================================

export type HdCharacterKey =
  | 'hero_tunic'
  | 'hero_mail'
  | 'hero_robe'
  | 'hero_dragon'
  | 'hero_portrait'
  | 'miaou_sprit'
  | 'mayor_moustache'
  | 'slime_yarn'
  | 'mouse_goblin'
  | 'thorn_wolf'
  | 'fishbone_skeleton'
  | 'frost_golem'
  | 'boss_rat_king'
  | 'boss_dragon_claw';

export type HdPropKey =
  | 'house_village'
  | 'building_inn'
  | 'building_forge'
  | 'prop_quest_board'
  | 'tree_oak'
  | 'tree_dark'
  | 'tree_pine_snow'
  | 'portal_dungeon'
  | 'chest_closed'
  | 'chest_open'
  | 'prop_torch'
  | 'prop_pillar'
  | 'prop_crystal'
  | 'prop_rock';

export type HdSurfaceKey =
  | 'grass'
  | 'forest'
  | 'snow'
  | 'path'
  | 'dungeon_ghost'
  | 'dungeon_dragon';

export type HdPbrChannel = 'albedo' | 'normal' | 'roughness';

export interface HdSurfaceImages {
  albedo?: HTMLImageElement;
  normal?: HTMLImageElement;
  roughness?: HTMLImageElement;
}

export interface HdTerrainBundle {
  grass?: HdSurfaceImages;
  forest?: HdSurfaceImages;
  snow?: HdSurfaceImages;
  path?: HdSurfaceImages;
  dungeon_ghost?: HdSurfaceImages;
  dungeon_dragon?: HdSurfaceImages;
}

export interface HdLoadSummary {
  loaded: number;
  failed: number;
  total: number;
}

/**
 * Fichiers attendus dans `public/assets/`.
 * Stage 2 verrouillera strictement ce manifeste sur les fichiers réellement
 * présents sur disque afin de garantir 0 requête 404.
 */
export const HD_CHARACTER_FILES: Partial<Record<HdCharacterKey, string>> = {
  hero_tunic: 'assets/characters/hero_tunic.png',
  hero_mail: 'assets/characters/hero_mail.png',
  hero_robe: 'assets/characters/hero_robe.png',
  hero_dragon: 'assets/characters/hero_dragon.png',
  hero_portrait: 'assets/characters/hero_portrait.png',
  miaou_sprit: 'assets/characters/miaou_sprit.png',
  mayor_moustache: 'assets/characters/mayor_moustache.png',
  slime_yarn: 'assets/characters/slime_yarn.png',
  mouse_goblin: 'assets/characters/mouse_goblin.png',
  thorn_wolf: 'assets/characters/thorn_wolf.png',
  fishbone_skeleton: 'assets/characters/fishbone_skeleton.png',
  frost_golem: 'assets/characters/frost_golem.png',
  boss_rat_king: 'assets/characters/boss_rat_king.png',
  boss_dragon_claw: 'assets/characters/boss_dragon_claw.png',
};

export const HD_PROP_FILES: Partial<Record<HdPropKey, string>> = {
  house_village: 'assets/props/house_village.png',
  building_inn: 'assets/props/building_inn.png',
  building_forge: 'assets/props/building_forge.png',
  prop_quest_board: 'assets/props/prop_quest_board.png',
  tree_oak: 'assets/props/tree_oak.png',
  tree_dark: 'assets/props/tree_dark.png',
  tree_pine_snow: 'assets/props/tree_pine_snow.png',
  portal_dungeon: 'assets/props/portal_dungeon.png',
  chest_closed: 'assets/props/chest_closed.png',
  chest_open: 'assets/props/chest_open.png',
  prop_torch: 'assets/props/prop_torch.png',
  prop_pillar: 'assets/props/prop_pillar.png',
  prop_crystal: 'assets/props/prop_crystal.png',
  prop_rock: 'assets/props/prop_rock.png',
};

export const HD_SURFACE_FILES: Record<
  HdSurfaceKey,
  Partial<Record<HdPbrChannel, string>>
> = {
  grass: {
    albedo: 'assets/textures/grass_albedo.png',
    normal: 'assets/textures/grass_normal.png',
    roughness: 'assets/textures/grass_roughness.png',
  },
  forest: {
    albedo: 'assets/textures/forest_albedo.png',
    normal: 'assets/textures/forest_normal.png',
    roughness: 'assets/textures/forest_roughness.png',
  },
  snow: {
    albedo: 'assets/textures/snow_albedo.png',
    normal: 'assets/textures/snow_normal.png',
    roughness: 'assets/textures/snow_roughness.png',
  },
  path: {
    albedo: 'assets/textures/path_albedo.png',
    normal: 'assets/textures/path_normal.png',
    roughness: 'assets/textures/path_roughness.png',
  },
  dungeon_ghost: {
    albedo: 'assets/textures/dungeon_ghost_albedo.png',
    normal: 'assets/textures/dungeon_ghost_normal.png',
    roughness: 'assets/textures/dungeon_ghost_roughness.png',
  },
  dungeon_dragon: {
    albedo: 'assets/textures/dungeon_dragon_albedo.png',
    normal: 'assets/textures/dungeon_dragon_normal.png',
    roughness: 'assets/textures/dungeon_dragon_roughness.png',
  },
};

export function resolveAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base =
    metaEnv && typeof metaEnv.BASE_URL === 'string' ? metaEnv.BASE_URL : './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${clean}`;
}

export function configureDioramaTexture(
  tex: THREE.Texture,
  options: {
    isDataMap?: boolean;
    repeat?: boolean;
    anisotropy: number;
  },
): THREE.Texture {
  tex.colorSpace = options.isDataMap ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.max(1, options.anisotropy);
  if (options.repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  } else {
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

export function extractHtmlImage(tex: THREE.Texture | undefined): HTMLImageElement | undefined {
  if (!tex) return undefined;
  const img = tex.image as unknown;
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return img.complete && img.naturalWidth > 0 ? img : undefined;
  }
  return undefined;
}

/**
 * Charge une texture Three.js sans jamais faire échouer le démarrage si un asset manque.
 */
export async function loadTextureSafe(
  loader: THREE.TextureLoader,
  relativePath: string,
  options: { isDataMap?: boolean; repeat?: boolean; anisotropy: number },
): Promise<THREE.Texture | null> {
  const url = resolveAssetUrl(relativePath);
  try {
    const tex = await loader.loadAsync(url);
    return configureDioramaTexture(tex, options);
  } catch {
    return null;
  }
}
