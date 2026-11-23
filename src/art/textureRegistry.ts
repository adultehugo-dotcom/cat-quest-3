import * as THREE from 'three';
import type {
  BuildingDef,
  ChestTier,
  DungeonDefinition,
  EnemyTypeId,
  EquipSlot,
  PropKind,
  SpeakerPortraitId,
} from '../game/types';
import {
  HD_CHARACTER_FILES,
  HD_PROP_FILES,
  HD_SURFACE_FILES,
  type HdCharacterKey,
  type HdLoadSummary,
  type HdPbrChannel,
  type HdPropKey,
  type HdSurfaceImages,
  type HdSurfaceKey,
  type HdTerrainBundle,
  configureDioramaTexture,
  extractHtmlImage,
  loadTextureSafe,
} from './hdAssets';
import {
  OCEAN_PALETTE,
  createCanvas,
  createSeededRandom,
  drawStar,
} from './palette';
import {
  type HeroAnimFrame,
  drawHeroCanvas,
  drawHeroFullPreviewDataUrl,
  drawHeroPortraitDataUrl,
  getHeroArmorHdKey,
  getHeroTextureKey,
} from './spriteHero';
import {
  type HdPortraitImages,
  drawBossDragonPhase2HdCanvas,
  drawCompanionCanvas,
  drawEnemyCanvas,
  drawNpcCanvas,
  drawSpeakerPortraitDataUrl,
} from './spriteEntities';
import {
  drawBuildingCanvas,
  drawChestCanvas,
  drawChestHdCanvas,
  drawDungeonEntranceCanvas,
  drawDungeonEntranceHdCanvas,
  drawDungeonExitPortalCanvas,
  drawHealingCrystalCanvas,
  drawHealingCrystalHdCanvas,
  drawPillarCanvas,
  drawPillarHdCanvas,
  drawPropCanvas,
  drawSnowRockHdCanvas,
  drawTorchCanvas,
  drawTorchHdCanvas,
} from './spriteProps';
import {
  createSeaLabelCanvas,
  generateDungeonPbrCanvases,
  generateDungeonWallPbrCanvases,
  generateOverworldPbrCanvases,
  getOverworldMiniMapDataUrl,
} from './mapTexture';

export interface OverworldPbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

export interface DungeonFloorPbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  emissiveMap: THREE.CanvasTexture;
}

export interface WallPbrTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
}

function drawWaterTileCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(256, 256);
  ctx.fillStyle = OCEAN_PALETTE.deep;
  ctx.fillRect(0, 0, 256, 256);

  const rand = createSeededRandom(12345);
  for (let i = 0; i < 42; i++) {
    const x = rand() * 256;
    const y = rand() * 256;
    const rx = 18 + rand() * 26;
    const ry = 5 + rand() * 6;
    ctx.fillStyle =
      i % 2 === 0 ? 'rgba(62, 164, 204, 0.24)' : 'rgba(205, 245, 255, 0.14)';
    for (const ox of [-256, 0, 256]) {
      for (const oy of [-256, 0, 256]) {
        ctx.beginPath();
        ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return canvas;
}

function drawShadowCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(128, 128);
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 58);
  grad.addColorStop(0, 'rgba(28, 18, 12, 0.56)');
  grad.addColorStop(0.58, 'rgba(28, 18, 12, 0.32)');
  grad.addColorStop(1, 'rgba(28, 18, 12, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return canvas;
}

function drawParticleCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(64, 64);
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 28);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

function drawStarParticleCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = createCanvas(64, 64);
  drawStar(ctx, 32, 32, 4, 28, 9);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  return canvas;
}

/**
 * Registre centralisé hybride des textures du jeu :
 * - Fallback procédural instantané dès le premier rendu (First Paint zéro attente).
 * - Chargement asynchrone de tous les PNG HD (Personnages, Props, PBR) via `loadAllHdAssets()`.
 * - Calibration rigoureuse `SRGBColorSpace` (albedos) vs `NoColorSpace` (normal/roughness),
 *   mipmaps + anisotropie maximale pour un piqué Diorama irréprochable.
 */
export class TextureRegistry {
  private readonly cache = new Map<string, THREE.CanvasTexture>();
  private readonly retiredTextures: THREE.Texture[] = [];

  private readonly hdCharacters = new Map<HdCharacterKey, THREE.Texture>();
  private readonly hdProps = new Map<HdPropKey, THREE.Texture>();
  private readonly hdSurfaces = new Map<
    HdSurfaceKey,
    Partial<Record<HdPbrChannel, THREE.Texture>>
  >();

  private readonly overworldPbrCache = new Map<string, OverworldPbrTextureSet>();
  private readonly dungeonPbrCache = new Map<string, DungeonFloorPbrTextureSet>();
  private readonly wallPbrCache = new Map<string, WallPbrTextureSet>();

  private maxAnisotropy = 8;
  private hdLoaded = false;
  private hdLoadPromise: Promise<HdLoadSummary> | null = null;
  private hdSummary: HdLoadSummary = { loaded: 0, failed: 0, total: 0 };

  public get isHdLoaded(): boolean {
    return this.hdLoaded;
  }

  public get hdLoadSummary(): Readonly<HdLoadSummary> {
    return this.hdSummary;
  }

  public setMaxAnisotropy(value: number): void {
    this.maxAnisotropy = Math.max(1, Math.min(16, value));
    for (const tex of this.cache.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdCharacters.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const tex of this.hdProps.values()) {
      tex.anisotropy = this.maxAnisotropy;
    }
    for (const surf of this.hdSurfaces.values()) {
      for (const tex of Object.values(surf)) {
        if (tex) tex.anisotropy = this.maxAnisotropy;
      }
    }
  }

  /**
   * Charge en parallèle tous les assets HD déclarés dans `hdAssets.ts` via `THREE.TextureLoader`.
   * Sûr à appeler plusieurs fois (mémoïsé).
   */
  public loadAllHdAssets(): Promise<HdLoadSummary> {
    if (this.hdLoadPromise) return this.hdLoadPromise;

    this.hdLoadPromise = this.runLoadAllHdAssets();
    return this.hdLoadPromise;
  }

  private async runLoadAllHdAssets(): Promise<HdLoadSummary> {
    const loader = new THREE.TextureLoader();
    const tasks: Array<Promise<boolean>> = [];

    for (const [key, path] of Object.entries(HD_CHARACTER_FILES) as Array<
      [HdCharacterKey, string | undefined]
    >) {
      if (!path) continue;
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdCharacters.set(key, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [key, path] of Object.entries(HD_PROP_FILES) as Array<
      [HdPropKey, string | undefined]
    >) {
      if (!path) continue;
      tasks.push(
        loadTextureSafe(loader, path, {
          isDataMap: false,
          repeat: false,
          anisotropy: this.maxAnisotropy,
        }).then((tex) => {
          if (tex) {
            this.hdProps.set(key, tex);
            return true;
          }
          return false;
        }),
      );
    }

    for (const [surfKey, channels] of Object.entries(HD_SURFACE_FILES) as Array<
      [HdSurfaceKey, Partial<Record<HdPbrChannel, string>>]
    >) {
      const bucket: Partial<Record<HdPbrChannel, THREE.Texture>> = {};
      this.hdSurfaces.set(surfKey, bucket);
      for (const [channel, path] of Object.entries(channels) as Array<
        [HdPbrChannel, string | undefined]
      >) {
        if (!path) continue;
        const isDataMap = channel !== 'albedo';
        tasks.push(
          loadTextureSafe(loader, path, {
            isDataMap,
            repeat: true,
            anisotropy: this.maxAnisotropy,
          }).then((tex) => {
            if (tex) {
              bucket[channel] = tex;
              return true;
            }
            return false;
          }),
        );
      }
    }

    const results = await Promise.all(tasks);
    const loaded = results.filter(Boolean).length;
    const total = results.length;
    this.hdSummary = { loaded, failed: total - loaded, total };
    this.hdLoaded = true;

    // Retire proprement les anciens caches composites procéduraux afin que les
    // appels suivants retournent immédiatement les composites HD PBR !
    this.invalidateProceduralComposites();
    return this.hdSummary;
  }

  private invalidateProceduralComposites(): void {
    const prefixesToRefresh = [
      'hero_',
      'enemy_',
      'entrance_',
      'chest_',
      'torch_',
      'pillar_',
      'crystal_',
      'prop_snow_rock',
    ];
    for (const [key, tex] of this.cache.entries()) {
      if (prefixesToRefresh.some((p) => key.startsWith(p))) {
        this.retiredTextures.push(tex);
        this.cache.delete(key);
      }
    }
    for (const set of this.overworldPbrCache.values()) {
      this.retiredTextures.push(set.map, set.normalMap, set.roughnessMap);
    }
    this.overworldPbrCache.clear();

    for (const set of this.dungeonPbrCache.values()) {
      this.retiredTextures.push(
        set.map,
        set.normalMap,
        set.roughnessMap,
        set.emissiveMap,
      );
    }
    this.dungeonPbrCache.clear();

    for (const set of this.wallPbrCache.values()) {
      this.retiredTextures.push(set.map, set.normalMap, set.roughnessMap);
    }
    this.wallPbrCache.clear();
  }

  /**
   * Libère les textures procédurales remplacées après que tous les renderers ont
   * basculé leurs matériaux vers les textures HD.
   */
  public flushRetiredTextures(): void {
    for (const tex of this.retiredTextures) {
      tex.dispose();
    }
    this.retiredTextures.length = 0;
  }

  private createCanvasTexture(
    canvas: HTMLCanvasElement,
    options: { isDataMap?: boolean; repeat?: boolean } = {},
  ): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    configureDioramaTexture(tex, {
      isDataMap: options.isDataMap,
      repeat: options.repeat,
      anisotropy: this.maxAnisotropy,
    });
    return tex;
  }

  private getOrCreate(
    key: string,
    factory: () => HTMLCanvasElement,
    repeat = false,
  ): THREE.CanvasTexture {
    const existing = this.cache.get(key);
    if (existing) return existing;

    const tex = this.createCanvasTexture(factory(), { repeat });
    this.cache.set(key, tex);
    return tex;
  }

  private getHdCharacterImage(key: HdCharacterKey): HTMLImageElement | undefined {
    return extractHtmlImage(this.hdCharacters.get(key));
  }

  private getHdPropImage(key: HdPropKey): HTMLImageElement | undefined {
    return extractHtmlImage(this.hdProps.get(key));
  }

  private getHdSurfaceImages(key: HdSurfaceKey): HdSurfaceImages | undefined {
    const bucket = this.hdSurfaces.get(key);
    if (!bucket) return undefined;
    const albedo = extractHtmlImage(bucket.albedo);
    const normal = extractHtmlImage(bucket.normal);
    const roughness = extractHtmlImage(bucket.roughness);
    if (!albedo && !normal && !roughness) return undefined;
    return { albedo, normal, roughness };
  }

  public getHdTerrainBundle(): HdTerrainBundle {
    return {
      grass: this.getHdSurfaceImages('grass'),
      forest: this.getHdSurfaceImages('forest'),
      snow: this.getHdSurfaceImages('snow'),
      path: this.getHdSurfaceImages('path'),
      dungeon_ghost: this.getHdSurfaceImages('dungeon_ghost'),
      dungeon_dragon: this.getHdSurfaceImages('dungeon_dragon'),
    };
  }

  // ==========================================================================
  // Personnages & Créatures
  // ==========================================================================

  public getHeroTexture(
    equipped: Record<EquipSlot, string>,
    frame: HeroAnimFrame,
  ): THREE.CanvasTexture {
    const armorHdKey = getHeroArmorHdKey(equipped.armor);
    const hdArmorImg = this.getHdCharacterImage(armorHdKey);
    const tag = hdArmorImg ? 'hd' : 'proc';
    const key = `hero_${tag}_${getHeroTextureKey(equipped, frame)}`;
    return this.getOrCreate(key, () => drawHeroCanvas(equipped, frame, hdArmorImg, false));
  }

  public getEnemyTexture(
    typeId: EnemyTypeId,
    phase: 1 | 2 = 1,
  ): THREE.Texture {
    const effectivePhase = typeId === 'boss_dragon_claw' ? phase : 1;
    const hdTex = this.hdCharacters.get(typeId);
    if (hdTex) {
      if (typeId === 'boss_dragon_claw' && effectivePhase === 2) {
        const hdImg = extractHtmlImage(hdTex);
        if (hdImg) {
          return this.getOrCreate('enemy_hd_boss_dragon_claw_p2', () =>
            drawBossDragonPhase2HdCanvas(hdImg),
          );
        }
      }
      return hdTex;
    }

    const key = `enemy_proc_${typeId}_p${effectivePhase}`;
    return this.getOrCreate(key, () => drawEnemyCanvas(typeId, effectivePhase));
  }

  public getCompanionTexture(): THREE.Texture {
    const hd = this.hdCharacters.get('miaou_sprit');
    if (hd) return hd;
    return this.getOrCreate('companion_miaou_sprit', () => drawCompanionCanvas());
  }

  public getNpcTexture(npcId: string): THREE.Texture {
    if (npcId === 'mayor_moustache') {
      const hd = this.hdCharacters.get('mayor_moustache');
      if (hd) return hd;
    }
    return this.getOrCreate(`npc_${npcId}`, () => drawNpcCanvas(npcId));
  }

  // ==========================================================================
  // Bâtiments, Props & Accessoires de Donjon
  // ==========================================================================

  public getPropTexture(kind: PropKind): THREE.Texture {
    if (kind === 'oak_tree') {
      const hd = this.hdProps.get('tree_oak');
      if (hd) return hd;
    } else if (kind === 'twisted_tree') {
      const hd = this.hdProps.get('tree_dark');
      if (hd) return hd;
    } else if (kind === 'snow_pine') {
      const hd = this.hdProps.get('tree_pine_snow');
      if (hd) return hd;
    } else if (kind === 'rock') {
      const hd = this.hdProps.get('prop_rock');
      if (hd) return hd;
    } else if (kind === 'snow_rock') {
      const rockImg = this.getHdPropImage('prop_rock');
      if (rockImg) {
        return this.getOrCreate('prop_snow_rock_hd', () =>
          drawSnowRockHdCanvas(rockImg),
        );
      }
    } else if (kind === 'house_cat') {
      const hd = this.hdProps.get('house_village');
      if (hd) return hd;
    }

    return this.getOrCreate(`prop_${kind}`, () => drawPropCanvas(kind));
  }

  public getBuildingTexture(kind: BuildingDef['kind']): THREE.Texture {
    const hdKey: HdPropKey =
      kind === 'inn'
        ? 'building_inn'
        : kind === 'forge'
          ? 'building_forge'
          : kind === 'quest_board'
            ? 'prop_quest_board'
            : 'house_village';
    const hd = this.hdProps.get(hdKey);
    if (hd) return hd;
    return this.getOrCreate(`building_${kind}`, () => drawBuildingCanvas(kind));
  }

  public getDungeonEntranceTexture(
    theme: 'ghost_cave' | 'dragon_lair',
    levelLabel: string,
    sealed: boolean,
  ): THREE.CanvasTexture {
    const hdImg = this.getHdPropImage('portal_dungeon');
    const tag = hdImg ? 'hd' : 'proc';
    const key = `entrance_${tag}_${theme}_${levelLabel}_${sealed ? 'sealed' : 'open'}`;
    return this.getOrCreate(key, () =>
      hdImg
        ? drawDungeonEntranceHdCanvas(hdImg, theme, levelLabel, sealed)
        : drawDungeonEntranceCanvas(theme, levelLabel, sealed),
    );
  }

  public getDungeonExitPortalTexture(
    theme: 'ghost_cave' | 'dragon_lair',
  ): THREE.CanvasTexture {
    return this.getOrCreate(`exit_portal_${theme}`, () =>
      drawDungeonExitPortalCanvas(theme),
    );
  }

  public getChestTexture(
    tier: ChestTier,
    state: 'closed' | 'open' | 'locked',
  ): THREE.Texture {
    const hdKey: HdPropKey = state === 'open' ? 'chest_open' : 'chest_closed';
    const hdImg = this.getHdPropImage(hdKey);
    if (hdImg) {
      const key = `chest_hd_${tier}_${state}`;
      return this.getOrCreate(key, () => drawChestHdCanvas(hdImg, tier, state));
    }
    const key = `chest_proc_${tier}_${state}`;
    return this.getOrCreate(key, () => drawChestCanvas(tier, state));
  }

  public getTorchTexture(frame: 0 | 1): THREE.Texture {
    const hdImg = this.getHdPropImage('prop_torch');
    if (hdImg) {
      return this.getOrCreate(`torch_hd_${frame}`, () =>
        drawTorchHdCanvas(hdImg, frame),
      );
    }
    return this.getOrCreate(`torch_proc_${frame}`, () => drawTorchCanvas(frame));
  }

  public getPillarTexture(
    theme: 'ghost_cave' | 'dragon_lair',
  ): THREE.Texture {
    const hdImg = this.getHdPropImage('prop_pillar');
    if (hdImg) {
      return this.getOrCreate(`pillar_hd_${theme}`, () =>
        drawPillarHdCanvas(hdImg, theme),
      );
    }
    return this.getOrCreate(`pillar_proc_${theme}`, () =>
      drawPillarCanvas(theme),
    );
  }

  public getHealingCrystalTexture(used: boolean): THREE.Texture {
    const hdImg = this.getHdPropImage('prop_crystal');
    if (hdImg) {
      return this.getOrCreate(`crystal_hd_${used ? 'used' : 'active'}`, () =>
        drawHealingCrystalHdCanvas(hdImg, used),
      );
    }
    return this.getOrCreate(`crystal_proc_${used ? 'used' : 'active'}`, () =>
      drawHealingCrystalCanvas(used),
    );
  }

  // ==========================================================================
  // Terrains PBR & Cartes Composites (Overworld + Donjons + Murs)
  // ==========================================================================

  public getOverworldPbrTextures(): OverworldPbrTextureSet {
    const cacheKey = this.hdLoaded ? 'overworld_pbr_hd' : 'overworld_pbr_proc';
    const existing = this.overworldPbrCache.get(cacheKey);
    if (existing) return existing;

    const canvases = generateOverworldPbrCanvases(this.getHdTerrainBundle());
    const set: OverworldPbrTextureSet = {
      map: this.createCanvasTexture(canvases.albedo, { isDataMap: false }),
      normalMap: this.createCanvasTexture(canvases.normal, { isDataMap: true }),
      roughnessMap: this.createCanvasTexture(canvases.roughness, { isDataMap: true }),
    };
    this.overworldPbrCache.set(cacheKey, set);
    return set;
  }

  public getOverworldMapTexture(): THREE.CanvasTexture {
    return this.getOverworldPbrTextures().map;
  }

  public getDungeonFloorPbrTextures(
    dungeon: DungeonDefinition,
  ): DungeonFloorPbrTextureSet {
    const cacheKey = `${dungeon.id}_${this.hdLoaded ? 'hd' : 'proc'}`;
    const existing = this.dungeonPbrCache.get(cacheKey);
    if (existing) return existing;

    const surfKey: HdSurfaceKey =
      dungeon.theme === 'dragon_lair' ? 'dungeon_dragon' : 'dungeon_ghost';
    const canvases = generateDungeonPbrCanvases(
      dungeon,
      this.getHdSurfaceImages(surfKey),
    );
    const set: DungeonFloorPbrTextureSet = {
      map: this.createCanvasTexture(canvases.albedo, { isDataMap: false }),
      normalMap: this.createCanvasTexture(canvases.normal, { isDataMap: true }),
      roughnessMap: this.createCanvasTexture(canvases.roughness, { isDataMap: true }),
      emissiveMap: this.createCanvasTexture(canvases.emissive, { isDataMap: false }),
    };
    this.dungeonPbrCache.set(cacheKey, set);
    return set;
  }

  public getDungeonFloorTexture(
    dungeon: DungeonDefinition,
  ): THREE.CanvasTexture {
    return this.getDungeonFloorPbrTextures(dungeon).map;
  }

  public getWallPbrTextures(
    theme: 'ghost_cave' | 'dragon_lair',
  ): WallPbrTextureSet {
    const cacheKey = `wall_${theme}_${this.hdLoaded ? 'hd' : 'proc'}`;
    const existing = this.wallPbrCache.get(cacheKey);
    if (existing) return existing;

    const surfKey: HdSurfaceKey =
      theme === 'dragon_lair' ? 'dungeon_dragon' : 'dungeon_ghost';
    const canvases = generateDungeonWallPbrCanvases(
      theme,
      this.getHdSurfaceImages(surfKey),
    );
    const set: WallPbrTextureSet = {
      map: this.createCanvasTexture(canvases.albedo, { isDataMap: false, repeat: true }),
      normalMap: this.createCanvasTexture(canvases.normal, { isDataMap: true, repeat: true }),
      roughnessMap: this.createCanvasTexture(canvases.roughness, { isDataMap: true, repeat: true }),
    };
    for (const tex of [set.map, set.normalMap, set.roughnessMap]) {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
    }
    this.wallPbrCache.set(cacheKey, set);
    return set;
  }

  public getWallTexture(
    theme: 'ghost_cave' | 'dragon_lair',
  ): THREE.CanvasTexture {
    return this.getWallPbrTextures(theme).map;
  }

  public getSeaLabelTexture(text: string): THREE.CanvasTexture {
    return this.getOrCreate(`sea_label_${text}`, () => createSeaLabelCanvas(text));
  }

  // ==========================================================================
  // Utilitaires (Eau fallback, Ombres de contact, Particules & Portraits UI)
  // ==========================================================================

  public getWaterTexture(): THREE.CanvasTexture {
    return this.getOrCreate('water_tile', () => drawWaterTileCanvas(), true);
  }

  public getShadowTexture(): THREE.CanvasTexture {
    return this.getOrCreate('shadow_ellipse', () => drawShadowCanvas());
  }

  public getParticleTexture(): THREE.CanvasTexture {
    return this.getOrCreate('particle_orb', () => drawParticleCanvas());
  }

  public getStarParticleTexture(): THREE.CanvasTexture {
    return this.getOrCreate('particle_star', () => drawStarParticleCanvas());
  }

  public getHeroPortraitUrl(equipped: Record<EquipSlot, string>): string {
    const hdArmorImg = this.getHdCharacterImage(getHeroArmorHdKey(equipped.armor));
    const hdPortraitImg = this.getHdCharacterImage('hero_portrait');
    return drawHeroPortraitDataUrl(equipped, hdArmorImg, hdPortraitImg);
  }

  public getHeroFullPreviewUrl(equipped: Record<EquipSlot, string>): string {
    const hdArmorImg = this.getHdCharacterImage(getHeroArmorHdKey(equipped.armor));
    return drawHeroFullPreviewDataUrl(equipped, hdArmorImg);
  }

  public getSpeakerPortraitUrl(
    portraitId: SpeakerPortraitId,
    equipped?: Record<EquipSlot, string>,
  ): string {
    const hdPortraits: HdPortraitImages = {
      miaou_sprit: this.getHdCharacterImage('miaou_sprit'),
      mayor_moustache: this.getHdCharacterImage('mayor_moustache'),
      boss_rat_king: this.getHdCharacterImage('boss_rat_king'),
      boss_dragon_claw: this.getHdCharacterImage('boss_dragon_claw'),
      hero_armor: equipped
        ? this.getHdCharacterImage(getHeroArmorHdKey(equipped.armor))
        : undefined,
      hero_portrait: this.getHdCharacterImage('hero_portrait'),
    };
    return drawSpeakerPortraitDataUrl(portraitId, equipped, hdPortraits);
  }

  public getMiniMapUrl(): string {
    return getOverworldMiniMapDataUrl(this.getHdTerrainBundle());
  }

  public get size(): number {
    let surfaceCount = 0;
    for (const s of this.hdSurfaces.values()) {
      surfaceCount += Object.values(s).filter(Boolean).length;
    }
    return (
      this.cache.size +
      this.hdCharacters.size +
      this.hdProps.size +
      surfaceCount +
      this.overworldPbrCache.size * 3 +
      this.dungeonPbrCache.size * 4 +
      this.wallPbrCache.size * 3
    );
  }

  public dispose(): void {
    this.flushRetiredTextures();
    for (const tex of this.cache.values()) {
      tex.dispose();
    }
    this.cache.clear();
    for (const tex of this.hdCharacters.values()) {
      tex.dispose();
    }
    this.hdCharacters.clear();
    for (const tex of this.hdProps.values()) {
      tex.dispose();
    }
    this.hdProps.clear();
    for (const surf of this.hdSurfaces.values()) {
      for (const tex of Object.values(surf)) {
        tex?.dispose();
      }
    }
    this.hdSurfaces.clear();
    for (const set of this.overworldPbrCache.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
    }
    this.overworldPbrCache.clear();
    for (const set of this.dungeonPbrCache.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
      set.emissiveMap.dispose();
    }
    this.dungeonPbrCache.clear();
    for (const set of this.wallPbrCache.values()) {
      set.map.dispose();
      set.normalMap.dispose();
      set.roughnessMap.dispose();
    }
    this.wallPbrCache.clear();
  }
}
