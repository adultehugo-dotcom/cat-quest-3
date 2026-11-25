import * as THREE from 'three';
import type {
  EnemyInstance,
  EnemyTypeId,
  EquipSlot,
  GameState,
} from '../game/types';
import { ENEMIES } from '../data/enemiesData';
import { getEquipmentDefinition } from '../data/equipmentData';
import {
  type EnemyAnimState,
  type HeroAnimState,
  type NpcAnimState,
  type SpriteAnimCursor,
  type SpriteUvRect,
  advanceSpriteAnimCursor,
  applyUvRectToTexture,
  computeGridFrameUvInto,
  createSpriteAnimCursor,
  createSpriteUvRect,
  sampleOneShotProgressFrame,
} from '../art/hdAssets';
import {
  type ResolvedSpriteClipSource,
  TextureRegistry,
} from '../art/textureRegistry';
import { CapeClothMesh, type CapeWindInput } from './capePhysics';
import { clearSpriteLight, enableSpriteLighting, setSpriteLight } from './spriteLighting';

export interface CapeWeatherWind {
  readonly windDirX: number;
  readonly windDirZ: number;
  readonly windIntensity: number;
  readonly stormIntensity?: number;
  readonly lanternBoost: number;
}

const SPRITE_TILT_X = -0.48;
const HERO_WIDTH = 2.35;
const HERO_HEIGHT = 2.45;
const HP_BAR_WIDTH = 1.45;
const HP_BAR_HEIGHT = 0.16;
const LEGACY_TWO_FRAME_WALK_FPS = 9.5;

export interface DeckAnchorsLike {
  readonly heroWorldPos: { readonly x: number; readonly y: number; readonly z: number };
  readonly companionWorldPos: { readonly x: number; readonly y: number; readonly z: number };
  readonly deckRoll: number;
  readonly deckPitch: number;
  readonly waterY: number;
}

interface UvTextureBinding {
  sourceTex: THREE.Texture | null;
  clonedTex: THREE.Texture | null;
}

interface EnemyVisual {
  id: string;
  typeId: EnemyTypeId;
  phase: 1 | 2;
  registryRevision: number;
  clips: Record<EnemyAnimState, ResolvedSpriteClipSource>;
  uvBinding: UvTextureBinding;
  animCursor: SpriteAnimCursor;
  uvRect: SpriteUvRect;
  activeState: EnemyAnimState;
  stateDuration: number;
  lastStateName: EnemyInstance['state'];
  root: THREE.Group;
  tiltGroup: THREE.Group;
  spriteMesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  fringeMesh: THREE.Mesh | null;
  fringeMat: THREE.MeshBasicMaterial | null;
  auraGlowMesh: THREE.Mesh | null;
  auraGlowMat: THREE.MeshBasicMaterial | null;
  shadowMesh: THREE.Mesh;
  shadowMat: THREE.MeshBasicMaterial;
  hpGroup: THREE.Group;
  hpFillMesh: THREE.Mesh;
  hpFillMat: THREE.MeshBasicMaterial;
  hpBgMat: THREE.MeshBasicMaterial;
  bossAuraRing: THREE.Mesh | null;
  bossAuraMat: THREE.MeshBasicMaterial | null;
  frostRing: THREE.Mesh;
  frostRingMat: THREE.MeshBasicMaterial;
  flipScaleX: number;
  baseScale: number;
  animSeed: number;
}

const ALL_HERO_ANIM_STATES: readonly HeroAnimState[] = [
  'idle',
  'walk',
  'attack',
  'roll',
  'hurt',
  'death',
  'deck_idle',
  'jump',
];

const ALL_ENEMY_ANIM_STATES: readonly EnemyAnimState[] = [
  'idle',
  'move',
  'windup',
  'attack',
  'hurt',
  'death',
];

const ALL_COMPANION_ANIM_STATES: readonly NpcAnimState[] = [
  'idle',
  'move',
  'talk',
];

function approachFlip(current: number, target: number, maxStep: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  const next = current + Math.sign(diff) * maxStep;
  // Évite toute frame à largeur nulle lors du passage par 0
  return Math.abs(next) < 0.18 ? Math.sign(diff) * 0.18 : next;
}

function getEnemyBaseGlow(
  typeId: EnemyTypeId,
): { hex: number; intensity: number } | null {
  switch (typeId) {
    case 'frost_golem':
      return { hex: 0x42ccff, intensity: 0.45 };
    case 'fishbone_skeleton':
      return { hex: 0x8e72ff, intensity: 0.24 };
    case 'boss_rat_king':
      return { hex: 0x9e66ff, intensity: 0.34 };
    case 'boss_dragon_claw':
      return { hex: 0xff5a28, intensity: 0.24 };
    default:
      return null;
  }
}

/**
 * Lie sans allocation par frame la frame active d'un clip (`uv-grid` ou `frame-sequence`)
 * au matériau principal (et éventuellement `emissiveMap` / `fringeMat`).
 * En mode `uv-grid`, un clone léger de `THREE.Texture` partageant la même `Source` GPU
 * est conservé par instance afin que deux entités du même type puissent lire deux
 * frames distinctes simultanément sans écraser mutuellement leurs `offset`/`repeat`.
 */
function bindResolvedFrameToMaterial(
  source: ResolvedSpriteClipSource,
  frameIndex: number,
  uvBinding: UvTextureBinding,
  uvRect: SpriteUvRect,
  material: THREE.MeshStandardMaterial,
  syncEmissive: boolean,
  fringeMat: THREE.MeshBasicMaterial | null,
): void {
  if (source.mode === 'uv-grid' && source.sheetTexture) {
    if (uvBinding.sourceTex !== source.sheetTexture || !uvBinding.clonedTex) {
      uvBinding.clonedTex?.dispose();
      const clone = source.sheetTexture.clone();
      // Filtre bilinéaire sans mip-bleeding inter-cellules sur les planches atlas
      if (source.grid.cols > 1 || source.grid.rows > 1) {
        clone.generateMipmaps = false;
        clone.minFilter = THREE.LinearFilter;
      }
      clone.magFilter = THREE.LinearFilter;
      clone.wrapS = THREE.ClampToEdgeWrapping;
      clone.wrapT = THREE.ClampToEdgeWrapping;
      clone.needsUpdate = true;
      uvBinding.sourceTex = source.sheetTexture;
      uvBinding.clonedTex = clone;
    }

    const activeTex = uvBinding.clonedTex;
    computeGridFrameUvInto(source.grid, frameIndex, uvRect, true);
    applyUvRectToTexture(activeTex, uvRect);

    if (material.map !== activeTex) {
      material.map = activeTex;
      if (syncEmissive) {
        material.emissiveMap = activeTex;
      }
      material.needsUpdate = true;
    }
    if (fringeMat && fringeMat.map !== activeTex) {
      fringeMat.map = activeTex;
      fringeMat.needsUpdate = true;
    }
    return;
  }

  const frames = source.frames;
  if (frames.length === 0) return;
  const clamped = Math.max(0, Math.min(frames.length - 1, frameIndex));
  const nextTex = frames[clamped];

  uvRect.repeatX = 1;
  uvRect.repeatY = 1;
  uvRect.offsetX = 0;
  uvRect.offsetY = 0;
  uvRect.col = clamped;
  uvRect.row = 0;
  uvRect.frameIndex = clamped;

  if (material.map !== nextTex) {
    material.map = nextTex;
    if (syncEmissive) {
      material.emissiveMap = nextTex;
    }
    material.needsUpdate = true;
  }
  if (fringeMat && fringeMat.map !== nextTex) {
    fringeMat.map = nextTex;
    fringeMat.needsUpdate = true;
  }
}

export class EntityRenderer {
  private readonly scene: THREE.Scene;
  private readonly textures: TextureRegistry;
  private readonly rootGroup = new THREE.Group();

  // Géométries partagées
  private readonly spriteGeo: THREE.PlaneGeometry;
  private readonly glowGeo: THREE.PlaneGeometry;
  private readonly shadowGeo: THREE.PlaneGeometry;
  private readonly hpBgGeo: THREE.PlaneGeometry;
  private readonly hpFillGeo: THREE.PlaneGeometry;
  private readonly auraRingGeo: THREE.RingGeometry;

  // Joueur (PBR éclairé dynamiquement + ombre portée + cape 2D physique, ZÉRO halo global)
  private readonly playerRoot = new THREE.Group();
  private readonly playerTiltGroup = new THREE.Group();
  private readonly playerMesh: THREE.Mesh;
  private readonly playerMat: THREE.MeshStandardMaterial;
  private readonly playerLanternLight: THREE.PointLight;
  private readonly playerLanternWorldPosition = new THREE.Vector3();
  private readonly capeCloth: CapeClothMesh;
  private readonly capeInputScratch: CapeWindInput = {
    vx: 0,
    vz: 0,
    vy: 0,
    worldX: 0,
    worldY: 0,
    worldZ: 0,
    facingX: 1,
    windDirX: 0.85,
    windDirZ: 0.52,
    windIntensity: 0.2,
    stormIntensity: 0,
    isRolling: false,
    isAttacking: false,
    attackProgress: 0,
    isJumping: false,
    isOnDeck: false,
    bounceY: 0,
    elevationY: 0,
    speed: 0,
  };
  private lastCapeId = '';
  private lastCapeRevision = -1;
  private prevHeroWorldY = 0;
  private hasPrevHeroWorldY = false;
  private lastPlayerBounceY = 0;
  private readonly playerShadow: THREE.Mesh;
  private readonly playerShadowMat: THREE.MeshBasicMaterial;
  private readonly playerRegenRing: THREE.Mesh;
  private readonly playerRegenMat: THREE.MeshBasicMaterial;
  private readonly playerShieldRing: THREE.Mesh;
  private readonly playerShieldMat: THREE.MeshBasicMaterial;
  private playerFlipX = 1;
  private walkClock = 0;

  // État d'animation 30 FPS zéro-allocation du héros (7 slots corps suivis par référence)
  private heroClipsCache: Record<HeroAnimState, ResolvedSpriteClipSource> | null = null;
  private lastHeroWeapon = '';
  private lastHeroShield = '';
  private lastHeroHelmet = '';
  private lastHeroArmor = '';
  private lastHeroBoots = '';
  private lastHeroGloves = '';
  private lastHeroTrinket = '';
  private lastHeroRevision = -1;
  private readonly heroAnimCursor = createSpriteAnimCursor('hero_idle');
  private readonly heroUvRect = createSpriteUvRect();
  private readonly heroUvBinding: UvTextureBinding = { sourceTex: null, clonedTex: null };
  private activeHeroState: HeroAnimState = 'idle';
  private activeAttackTotalDuration = 0.22;
  private prevAttackAnimTimer = 0;
  private prevComboStep: 0 | 1 | 2 = 0;
  private activeDodgeTotalDuration = 0.28;
  private prevDodgeTimer = 0;
  private activeHurtTotalDuration = 0.14;
  private prevHitFlashTimer = 0;

  // Compagnon Miaou-sprit (émissif HDR pour UnrealBloomPass sélectif !)
  private readonly companionRoot = new THREE.Group();
  private readonly companionMesh: THREE.Mesh;
  private readonly companionMat: THREE.MeshStandardMaterial;
  private readonly companionShadow: THREE.Mesh;
  private readonly companionShadowMat: THREE.MeshBasicMaterial;
  private companionFlipX = 1;
  private companionClipsCache: Record<NpcAnimState, ResolvedSpriteClipSource> | null = null;
  private lastCompanionRevision = -1;
  private readonly companionAnimCursor = createSpriteAnimCursor('miaou_sprit_idle');
  private readonly companionUvRect = createSpriteUvRect();
  private readonly companionUvBinding: UvTextureBinding = { sourceTex: null, clonedTex: null };
  private activeCompanionState: NpcAnimState = 'idle';
  private prevCompX = 0;
  private prevCompZ = 0;
  private hasPrevCompPos = false;

  // Ennemis dynamiques par ID (Set réutilisé pour zéro allocation par frame)
  private readonly enemies = new Map<string, EnemyVisual>();
  private readonly seenEnemyIds = new Set<string>();
  private animTime = 0;

  constructor(scene: THREE.Scene, textures: TextureRegistry) {
    this.scene = scene;
    this.textures = textures;
    this.rootGroup.name = 'EntitiesRoot';
    this.scene.add(this.rootGroup);

    // Plan unitaire avec pivot au bas-centre (pieds à y = 0)
    this.spriteGeo = new THREE.PlaneGeometry(1, 1);
    this.spriteGeo.translate(0, 0.5, 0);

    // Plan unitaire centré pour halos/auras additifs
    this.glowGeo = new THREE.PlaneGeometry(1, 1);

    // Ombre elliptique de contact douce au sol
    this.shadowGeo = new THREE.PlaneGeometry(2, 2);
    this.shadowGeo.rotateX(-Math.PI / 2);

    // Géométries barres de PV discrètes
    this.hpBgGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH + 0.08, HP_BAR_HEIGHT + 0.08);
    this.hpFillGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
    this.hpFillGeo.translate(HP_BAR_WIDTH * 0.5, 0, 0);

    // Anneau au sol pour auras (Boss Phase 2 / Glace / Regen)
    this.auraRingGeo = new THREE.RingGeometry(0.75, 1.05, 32);
    this.auraRingGeo.rotateX(-Math.PI / 2);

    // --- Construction du Héros ---
    this.playerTiltGroup.rotation.x = SPRITE_TILT_X;
    this.playerRoot.add(this.playerTiltGroup);

    this.playerMat = new THREE.MeshStandardMaterial({
      roughness: 0.72,
      metalness: 0.1,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0,
    });
    enableSpriteLighting(this.playerMat);
    this.playerMesh = new THREE.Mesh(this.spriteGeo, this.playerMat);
    this.playerMesh.scale.set(HERO_WIDTH, HERO_HEIGHT, 1);
    this.playerMesh.castShadow = true;
    this.playerMesh.receiveShadow = false;
    this.playerMesh.userData.skipSSAO = true;
    this.playerMesh.userData.isSprite25D = true;
    this.playerTiltGroup.add(this.playerMesh);

    this.playerLanternLight = new THREE.PointLight(0xffb65c, 0, 9, 2);
    this.playerLanternLight.castShadow = false;
    this.playerLanternLight.visible = false;
    this.playerLanternLight.position.set(0.64, 1.32, 0.68);
    this.playerLanternLight.userData.skipSSAO = true;
    this.playerRoot.add(this.playerLanternLight);

    this.capeCloth = new CapeClothMesh();
    // Attachée directement à playerRoot (repère vertical monde) pour vraie gravité,
    // plancher anti-sol exact et barrière dorsale derrière le plan incliné du héros.
    this.capeCloth.mesh.position.set(0, 0, 0);
    this.playerRoot.add(this.capeCloth.mesh);

    this.playerShadowMat = new THREE.MeshBasicMaterial({
      map: this.textures.getShadowTexture(),
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
    });
    this.playerShadow = new THREE.Mesh(this.shadowGeo, this.playerShadowMat);
    this.playerShadow.position.y = 0.03;
    this.playerShadow.scale.set(0.82, 1, 0.56);
    this.playerShadow.renderOrder = 1;
    this.playerShadow.userData.skipSSAO = true;
    this.playerRoot.add(this.playerShadow);

    this.playerRegenMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.45 * 1.4, 1.0 * 1.4, 0.58 * 1.4),
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.playerRegenRing = new THREE.Mesh(this.auraRingGeo, this.playerRegenMat);
    this.playerRegenRing.position.y = 0.05;
    this.playerRegenRing.renderOrder = 2;
    this.playerRegenRing.visible = false;
    this.playerRegenRing.userData.skipSSAO = true;
    this.playerRoot.add(this.playerRegenRing);

    this.playerShieldMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1.45, 1.15, 0.42),
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.playerShieldRing = new THREE.Mesh(this.auraRingGeo, this.playerShieldMat);
    this.playerShieldRing.position.y = 0.08;
    this.playerShieldRing.renderOrder = 3;
    this.playerShieldRing.visible = false;
    this.playerShieldRing.userData.skipSSAO = true;
    this.playerRoot.add(this.playerShieldRing);

    this.rootGroup.add(this.playerRoot);

    // --- Construction du Compagnon Miaou-sprit (émissif HDR > 1.2 pour Bloom !) ---
    const compTex = this.textures.getCompanionTexture();
    this.companionMat = new THREE.MeshStandardMaterial({
      map: compTex,
      emissiveMap: compTex,
      emissive: new THREE.Color(0x9beeff),
      emissiveIntensity: 1.38,
      roughness: 0.35,
      metalness: 0.05,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    enableSpriteLighting(this.companionMat);
    this.companionMesh = new THREE.Mesh(this.spriteGeo, this.companionMat);
    this.companionMesh.scale.set(1.3, 1.3, 1);
    this.companionMesh.rotation.x = SPRITE_TILT_X;
    this.companionMesh.renderOrder = 4;
    this.companionMesh.castShadow = false;
    this.companionMesh.receiveShadow = false;
    this.companionMesh.userData.skipSSAO = true;
    this.companionMesh.userData.isSprite25D = true;
    this.companionRoot.add(this.companionMesh);

    this.companionShadowMat = new THREE.MeshBasicMaterial({
      map: this.textures.getShadowTexture(),
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.companionShadow = new THREE.Mesh(this.shadowGeo, this.companionShadowMat);
    this.companionShadow.position.y = 0.03;
    this.companionShadow.scale.set(0.42, 1, 0.28);
    this.companionShadow.renderOrder = 1;
    this.companionShadow.userData.skipSSAO = true;
    this.companionRoot.add(this.companionShadow);

    this.rootGroup.add(this.companionRoot);
  }

  private buildEnemyClipTable(
    typeId: EnemyTypeId,
    phase: 1 | 2,
  ): Record<EnemyAnimState, ResolvedSpriteClipSource> {
    const out = {} as Record<EnemyAnimState, ResolvedSpriteClipSource>;
    for (let i = 0; i < ALL_ENEMY_ANIM_STATES.length; i++) {
      const st = ALL_ENEMY_ANIM_STATES[i];
      out[st] = this.textures.resolveEnemyClip(typeId, st, phase);
    }
    return out;
  }

  private ensureHeroClipTable(
    equipped: Record<EquipSlot, string>,
  ): Record<HeroAnimState, ResolvedSpriteClipSource> {
    const rev = this.textures.revision;
    if (
      this.heroClipsCache &&
      this.lastHeroRevision === rev &&
      this.lastHeroWeapon === equipped.weapon &&
      this.lastHeroShield === equipped.shield &&
      this.lastHeroHelmet === equipped.helmet &&
      this.lastHeroArmor === equipped.armor &&
      this.lastHeroBoots === equipped.boots &&
      this.lastHeroGloves === equipped.gloves &&
      this.lastHeroTrinket === equipped.trinket
    ) {
      return this.heroClipsCache;
    }

    this.lastHeroRevision = rev;
    this.lastHeroWeapon = equipped.weapon;
    this.lastHeroShield = equipped.shield;
    this.lastHeroHelmet = equipped.helmet;
    this.lastHeroArmor = equipped.armor;
    this.lastHeroBoots = equipped.boots;
    this.lastHeroGloves = equipped.gloves;
    this.lastHeroTrinket = equipped.trinket;

    const table = {} as Record<HeroAnimState, ResolvedSpriteClipSource>;
    for (let i = 0; i < ALL_HERO_ANIM_STATES.length; i++) {
      const st = ALL_HERO_ANIM_STATES[i];
      table[st] = this.textures.resolveHeroClip(equipped, st);
    }
    this.heroClipsCache = table;
    return table;
  }

  private ensureCompanionClipTable(): Record<NpcAnimState, ResolvedSpriteClipSource> {
    const rev = this.textures.revision;
    if (this.companionClipsCache && this.lastCompanionRevision === rev) {
      return this.companionClipsCache;
    }
    this.lastCompanionRevision = rev;
    const table = {} as Record<NpcAnimState, ResolvedSpriteClipSource>;
    for (let i = 0; i < ALL_COMPANION_ANIM_STATES.length; i++) {
      const st = ALL_COMPANION_ANIM_STATES[i];
      table[st] = this.textures.resolveNpcClip('miaou_sprit', st);
    }
    this.companionClipsCache = table;
    return table;
  }

  private createEnemyVisual(enemy: EnemyInstance): EnemyVisual {
    const def = ENEMIES[enemy.typeId];
    const baseScale = def.spriteScale;
    const animSeed = enemy.homeX * 0.31 + enemy.homeZ * 0.47;

    const root = new THREE.Group();
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.x = SPRITE_TILT_X;
    root.add(tiltGroup);

    const clips = this.buildEnemyClipTable(enemy.typeId, enemy.phase);
    const uvBinding: UvTextureBinding = { sourceTex: null, clonedTex: null };
    const uvRect = createSpriteUvRect();
    const animCursor = createSpriteAnimCursor(clips.idle.clip.id);
    // Léger déphasage temporel par spawn pour éviter un synchronisme mécanique des meutes
    animCursor.elapsed = Math.abs(animSeed) % 0.97;

    const initialTex = clips.idle.sheetTexture ?? clips.idle.frames[0] ?? this.textures.getEnemyTexture(enemy.typeId, enemy.phase);
    const baseGlow = getEnemyBaseGlow(enemy.typeId);
    const material = new THREE.MeshStandardMaterial({
      map: initialTex,
      emissiveMap: baseGlow ? initialTex : null,
      roughness: 0.74,
      metalness: 0.08,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(baseGlow ? baseGlow.hex : 0x000000),
      emissiveIntensity: baseGlow ? baseGlow.intensity : 0,
    });
    enableSpriteLighting(material);
    const spriteMesh = new THREE.Mesh(this.spriteGeo, material);
    const flipScaleX = enemy.facingX < 0 ? -1 : 1;
    spriteMesh.scale.set(baseScale * flipScaleX, baseScale, 1);
    spriteMesh.castShadow = true;
    spriteMesh.receiveShadow = false;
    spriteMesh.userData.skipSSAO = true;
    spriteMesh.userData.isSprite25D = true;
    tiltGroup.add(spriteMesh);

    // Passe douce arrière (z = -0.01) pour les brumes/volutes semi-transparentes des PNGs
    let fringeMesh: THREE.Mesh | null = null;
    let fringeMat: THREE.MeshBasicMaterial | null = null;
    if (enemy.typeId === 'boss_rat_king' || enemy.typeId === 'frost_golem') {
      fringeMat = new THREE.MeshBasicMaterial({
        map: initialTex,
        color: 0xffffff,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        alphaTest: 0,
        side: THREE.DoubleSide,
      });
      fringeMesh = new THREE.Mesh(this.spriteGeo, fringeMat);
      fringeMesh.position.set(0, 0, -0.01);
      fringeMesh.scale.set(baseScale * flipScaleX, baseScale, 1);
      fringeMesh.castShadow = false;
      fringeMesh.receiveShadow = false;
      fringeMesh.renderOrder = 3;
      fringeMesh.userData.skipSSAO = true;
      tiltGroup.add(fringeMesh);
    }

    bindResolvedFrameToMaterial(
      clips.idle,
      0,
      uvBinding,
      uvRect,
      material,
      Boolean(baseGlow),
      fringeMat,
    );

    // Billboard d'aura additive derrière les ennemis & boss lumineux
    let auraGlowMesh: THREE.Mesh | null = null;
    let auraGlowMat: THREE.MeshBasicMaterial | null = null;
    if (baseGlow) {
      auraGlowMat = new THREE.MeshBasicMaterial({
        map: this.textures.getParticleTexture(),
        color: new THREE.Color(baseGlow.hex),
        transparent: true,
        opacity: 0.36,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      auraGlowMesh = new THREE.Mesh(this.glowGeo, auraGlowMat);
      auraGlowMesh.position.set(0, baseScale * 0.5, -0.04);
      auraGlowMesh.scale.set(baseScale * 1.35, baseScale * 1.3, 1);
      auraGlowMesh.castShadow = false;
      auraGlowMesh.receiveShadow = false;
      auraGlowMesh.renderOrder = 2;
      auraGlowMesh.userData.skipSSAO = true;
      tiltGroup.add(auraGlowMesh);
    }

    // Ombre de contact douce au sol (complète l'ombre portée directionnelle réelle)
    const shadowMat = new THREE.MeshBasicMaterial({
      map: this.textures.getShadowTexture(),
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(this.shadowGeo, shadowMat);
    shadowMesh.position.y = 0.03;
    shadowMesh.scale.set(enemy.radius * 1.05, 1, enemy.radius * 0.72);
    shadowMesh.renderOrder = 1;
    shadowMesh.userData.skipSSAO = true;
    root.add(shadowMesh);

    // Anneau givre si ralenti par Patte-givrée
    const frostRingMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.55 * 1.35, 0.94 * 1.35, 1.0 * 1.35),
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const frostRing = new THREE.Mesh(this.auraRingGeo, frostRingMat);
    frostRing.position.y = 0.05;
    frostRing.scale.set(enemy.radius * 1.15, 1, enemy.radius * 1.15);
    frostRing.renderOrder = 2;
    frostRing.visible = false;
    frostRing.userData.skipSSAO = true;
    root.add(frostRing);

    // Aura rouge cramoisie HDR pour Boss Phase 2
    let bossAuraRing: THREE.Mesh | null = null;
    let bossAuraMat: THREE.MeshBasicMaterial | null = null;
    if (enemy.isBoss) {
      bossAuraMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(1.45, 0.22, 0.3),
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      bossAuraRing = new THREE.Mesh(this.auraRingGeo, bossAuraMat);
      bossAuraRing.position.y = 0.055;
      bossAuraRing.scale.set(enemy.radius * 1.55, 1, enemy.radius * 1.55);
      bossAuraRing.renderOrder = 2;
      bossAuraRing.visible = false;
      bossAuraRing.userData.skipSSAO = true;
      root.add(bossAuraRing);
    }

    // Barre de vie discrète placée dans tiltGroup juste au-dessus du sprite (y_local = baseScale)
    const hpGroup = new THREE.Group();
    hpGroup.position.set(0, baseScale + 0.3, 0.02);

    const hpBgMat = new THREE.MeshBasicMaterial({
      color: 0x2b1e16,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hpBgMesh = new THREE.Mesh(this.hpBgGeo, hpBgMat);
    hpBgMesh.renderOrder = 10;
    hpBgMesh.userData.skipSSAO = true;
    hpGroup.add(hpBgMesh);

    const hpFillMat = new THREE.MeshBasicMaterial({
      color: 0xe63946,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const hpFillMesh = new THREE.Mesh(this.hpFillGeo, hpFillMat);
    hpFillMesh.position.set(-HP_BAR_WIDTH * 0.5, 0, 0.01);
    hpFillMesh.renderOrder = 11;
    hpFillMesh.userData.skipSSAO = true;
    hpGroup.add(hpFillMesh);

    hpGroup.visible = false;
    tiltGroup.add(hpGroup);

    spriteMesh.rotation.y = 0;
    root.position.set(enemy.x, 0, enemy.z);

    this.rootGroup.add(root);

    return {
      id: enemy.id,
      typeId: enemy.typeId,
      phase: enemy.phase,
      registryRevision: this.textures.revision,
      clips,
      uvBinding,
      animCursor,
      uvRect,
      activeState: 'idle',
      stateDuration: 0.5,
      lastStateName: enemy.state,
      root,
      tiltGroup,
      spriteMesh,
      material,
      fringeMesh,
      fringeMat,
      auraGlowMesh,
      auraGlowMat,
      shadowMesh,
      shadowMat,
      hpGroup,
      hpFillMesh,
      hpFillMat,
      hpBgMat,
      bossAuraRing,
      bossAuraMat,
      frostRing,
      frostRingMat,
      flipScaleX,
      baseScale,
      animSeed,
    };
  }

  private disposeEnemyVisual(vis: EnemyVisual): void {
    this.rootGroup.remove(vis.root);
    vis.uvBinding.clonedTex?.dispose();
    vis.uvBinding.clonedTex = null;
    vis.uvBinding.sourceTex = null;
    vis.material.dispose();
    vis.fringeMat?.dispose();
    vis.auraGlowMat?.dispose();
    vis.shadowMat.dispose();
    vis.hpBgMat.dispose();
    vis.hpFillMat.dispose();
    vis.frostRingMat.dispose();
    vis.bossAuraMat?.dispose();
  }

  /**
   * Rafraîchit à chaud toutes les textures d'entités (appelé dès que
   * `textures.loadAllHdAssets()` termine son chargement asynchrone).
   */
  public refreshTextures(state?: GameState): void {
    this.heroClipsCache = null;
    this.companionClipsCache = null;
    this.lastHeroRevision = -1;
    this.lastCompanionRevision = -1;
    this.lastCapeRevision = -1;

    for (const vis of this.enemies.values()) {
      vis.registryRevision = -1;
    }

    if (state) {
      this.updatePlayer(state, 0);
      this.updateCompanion(state, 0);
      this.updateEnemies(state, 0);
    } else {
      const compClips = this.ensureCompanionClipTable();
      bindResolvedFrameToMaterial(
        compClips[this.activeCompanionState],
        this.companionAnimCursor.frameIndex,
        this.companionUvBinding,
        this.companionUvRect,
        this.companionMat,
        true,
        null,
      );
    }
  }

  private updatePlayer(
    state: GameState,
    dt: number,
    shipDeck?: DeckAnchorsLike | null,
    weather?: CapeWeatherWind,
  ): void {
    const p = state.player;
    this.playerRoot.visible = true;

    const shipMode = state.ship.mode;
    const isOnDeck =
      state.zoneId === 'overworld' &&
      (Boolean(p.onShipDeck) || shipMode === 'sailing' || shipMode === 'docking');
    const isShipJumping =
      state.zoneId === 'overworld' &&
      (shipMode === 'boarding' || shipMode === 'disembarking');

    // Petite lumière chaude portée par le héros à l'extérieur quand la météo
    // ou le cycle nuit/aube le justifient; aucun coût d'ombre secondaire.
    const lanternPower = weather?.lanternBoost ?? 0;
    const lanternActive = state.zoneId === 'overworld' && !isOnDeck && lanternPower > 0.04;
    this.playerLanternLight.visible = lanternActive;
    this.playerLanternLight.intensity = lanternActive ? 1.55 * lanternPower : 0;

    const speed = Math.hypot(p.vx, p.vz);
    const isDead = p.hp <= 0 || state.screen === 'defeat';
    const isMoving = !isDead && !isOnDeck && !isShipJumping && speed > 0.35;
    if (isMoving) {
      this.walkClock += dt * LEGACY_TWO_FRAME_WALK_FPS;
    }

    // Suivi sans allocation de la durée totale des actions ponctuelles (combo, roulade, impact)
    if (
      p.attackAnimTimer > this.prevAttackAnimTimer + 1e-4 ||
      (p.attackAnimTimer > 0 && p.comboStep !== this.prevComboStep)
    ) {
      this.activeAttackTotalDuration = Math.max(0.08, p.attackAnimTimer);
      this.heroAnimCursor.elapsed = 0;
      this.heroAnimCursor.frameIndex = 0;
      this.heroAnimCursor.finished = false;
    }
    this.prevAttackAnimTimer = p.attackAnimTimer;
    this.prevComboStep = p.comboStep;

    if (p.dodgeTimer > this.prevDodgeTimer + 1e-4) {
      this.activeDodgeTotalDuration = Math.max(0.08, p.dodgeTimer);
      this.heroAnimCursor.elapsed = 0;
      this.heroAnimCursor.frameIndex = 0;
      this.heroAnimCursor.finished = false;
    }
    this.prevDodgeTimer = p.dodgeTimer;

    if (p.hitFlashTimer > this.prevHitFlashTimer + 1e-4) {
      this.activeHurtTotalDuration = Math.max(0.06, p.hitFlashTimer);
      this.heroAnimCursor.elapsed = 0;
      this.heroAnimCursor.frameIndex = 0;
      this.heroAnimCursor.finished = false;
    }
    this.prevHitFlashTimer = p.hitFlashTimer;

    // Sélection de l'état d'animation sémantique 30 FPS du héros
    let heroState: HeroAnimState = 'idle';
    if (isDead) {
      heroState = 'death';
    } else if (isOnDeck) {
      heroState = 'deck_idle';
    } else if (isShipJumping) {
      heroState = 'jump';
    } else if (p.dodgeTimer > 0) {
      heroState = 'roll';
    } else if (p.attackAnimTimer > 0) {
      heroState = 'attack';
    } else if (p.hitFlashTimer > 0 && !isMoving) {
      heroState = 'hurt';
    } else if (isMoving) {
      heroState = 'walk';
    }
    this.activeHeroState = heroState;

    const heroClips = this.ensureHeroClipTable(p.equipped);
    const activeClipSource = heroClips[heroState];

    let frameIdx = 0;
    if (heroState === 'roll') {
      const rollProgress = Math.max(
        0,
        Math.min(1, 1 - p.dodgeTimer / this.activeDodgeTotalDuration),
      );
      this.heroAnimCursor.clipId = activeClipSource.clip.id;
      this.heroAnimCursor.elapsed =
        (rollProgress * activeClipSource.frameCount) / activeClipSource.clip.fps;
      frameIdx = sampleOneShotProgressFrame(rollProgress, activeClipSource.frameCount);
      this.heroAnimCursor.frameIndex = frameIdx;
      this.heroAnimCursor.finished = rollProgress >= 1 - 1e-4;
    } else if (heroState === 'attack') {
      const atkProgress = Math.max(
        0,
        Math.min(1, 1 - p.attackAnimTimer / this.activeAttackTotalDuration),
      );
      this.heroAnimCursor.clipId = activeClipSource.clip.id;
      this.heroAnimCursor.elapsed =
        (atkProgress * activeClipSource.frameCount) / activeClipSource.clip.fps;
      frameIdx = sampleOneShotProgressFrame(atkProgress, activeClipSource.frameCount);
      this.heroAnimCursor.frameIndex = frameIdx;
      this.heroAnimCursor.finished = atkProgress >= 1 - 1e-4;
    } else if (heroState === 'hurt') {
      const hurtProgress = Math.max(
        0,
        Math.min(1, 1 - p.hitFlashTimer / this.activeHurtTotalDuration),
      );
      this.heroAnimCursor.clipId = activeClipSource.clip.id;
      frameIdx = sampleOneShotProgressFrame(hurtProgress, activeClipSource.frameCount);
      this.heroAnimCursor.frameIndex = frameIdx;
      this.heroAnimCursor.finished = hurtProgress >= 1 - 1e-4;
    } else if (heroState === 'jump') {
      const tr = state.ship.transition;
      const jumpProgress = tr
        ? Math.max(0, Math.min(1, tr.elapsed / Math.max(0.01, tr.duration)))
        : 0.5;
      this.heroAnimCursor.clipId = activeClipSource.clip.id;
      frameIdx = sampleOneShotProgressFrame(jumpProgress, activeClipSource.frameCount);
      this.heroAnimCursor.frameIndex = frameIdx;
      this.heroAnimCursor.finished = jumpProgress >= 1 - 1e-4;
    } else if (heroState === 'walk' && activeClipSource.frameCount <= 2) {
      // Préserve la cadence naturelle 9.5 Hz tant que la marche utilise les 2 poses legacy
      frameIdx = advanceSpriteAnimCursor(
        this.heroAnimCursor,
        activeClipSource.clip,
        activeClipSource.frameCount,
        dt,
        LEGACY_TWO_FRAME_WALK_FPS,
      );
    } else {
      frameIdx = advanceSpriteAnimCursor(
        this.heroAnimCursor,
        activeClipSource.clip,
        activeClipSource.frameCount,
        dt,
      );
    }

    bindResolvedFrameToMaterial(
      activeClipSource,
      frameIdx,
      this.heroUvBinding,
      this.heroUvRect,
      this.playerMat,
      false,
      null,
    );

    // Position ancrée au sol, au pont du voilier (repère local transformé) ou sur l'arc de saut
    if (isOnDeck && shipDeck) {
      this.playerRoot.position.set(
        shipDeck.heroWorldPos.x,
        shipDeck.heroWorldPos.y,
        shipDeck.heroWorldPos.z,
      );
      this.playerTiltGroup.rotation.z = -shipDeck.deckRoll * 0.35;
      this.playerShadow.visible = true;
      this.playerShadow.position.y = 0.028;
      this.playerShadow.scale.set(0.76, 1, 0.52);
    } else if (isShipJumping) {
      const elevY = p.elevationY ?? 0;
      this.playerRoot.position.set(p.x, elevY, p.z);
      this.playerTiltGroup.rotation.z = 0;
      // Masque l'ombre sol pendant la traversée aérienne au-dessus de l'eau
      this.playerShadow.visible = elevY < 0.25;
      this.playerShadow.position.y = Math.max(0.03, -elevY + 0.03);
      const sScale = Math.max(0.35, 1 - elevY * 0.22);
      this.playerShadow.scale.set(0.82 * sScale, 1, 0.56 * sScale);
    } else {
      this.playerRoot.position.set(p.x, p.elevationY ?? 0, p.z);
      this.playerTiltGroup.rotation.z = 0;
      this.playerShadow.visible = true;
      this.playerShadow.position.y = 0.03;
      this.playerShadow.scale.set(0.82, 1, 0.56);
    }

    // Flip horizontal fluide sans jamais passer de profil (scale.x signé, DoubleSide)
    const targetFlip = p.facingX < 0 ? -1 : 1;
    this.playerFlipX = approachFlip(this.playerFlipX, targetFlip, dt * 16);
    this.playerMesh.rotation.y = 0;

    // Squash & stretch expressif selon l'action (ligne de sol pieds préservée)
    let sx = HERO_WIDTH;
    let sy = HERO_HEIGHT;
    let bounceY = 0;

    if (isOnDeck) {
      const seaBreath = Math.sin(this.animTime * 2.8) * 0.022;
      sx = HERO_WIDTH * (1 - seaBreath * 0.45);
      sy = HERO_HEIGHT * (1 + seaBreath);
      bounceY = 0;
    } else if (isShipJumping) {
      const tr = state.ship.transition;
      const t = tr ? Math.min(1, tr.elapsed / Math.max(0.01, tr.duration)) : 0.5;
      const stretch = Math.sin(t * Math.PI) * 0.14;
      sx = HERO_WIDTH * (1 - stretch * 0.55);
      sy = HERO_HEIGHT * (1 + stretch);
      bounceY = 0;
    } else if (heroState === 'death') {
      sx = HERO_WIDTH * 1.04;
      sy = HERO_HEIGHT * 0.84;
      bounceY = 0;
    } else if (heroState === 'roll') {
      const sq = 1 + Math.sin(this.animTime * 28) * 0.1;
      sx = HERO_WIDTH * 0.96 * sq;
      sy = (HERO_HEIGHT * 0.88) / sq;
      bounceY = 0.22;
    } else if (heroState === 'attack') {
      sx = HERO_WIDTH * 1.1;
      sy = HERO_HEIGHT * 0.94;
      bounceY = 0.06;
    } else if (heroState === 'hurt') {
      sx = HERO_WIDTH * 1.05;
      sy = HERO_HEIGHT * 0.95;
      bounceY = 0.03;
    } else if (isMoving) {
      const hop = Math.abs(Math.sin(this.walkClock * Math.PI * 0.5));
      sx = HERO_WIDTH * (1.06 - hop * 0.1);
      sy = HERO_HEIGHT * (0.94 + hop * 0.12);
      bounceY = hop * 0.14;
    } else {
      const breath = Math.sin(this.animTime * 3.2) * 0.025;
      sx = HERO_WIDTH * (1 - breath * 0.5);
      sy = HERO_HEIGHT * (1 + breath);
    }

    this.playerMesh.scale.set(sx * this.playerFlipX, sy, 1);
    this.playerTiltGroup.position.y = bounceY;
    this.lastPlayerBounceY = bounceY;

    // Position fluide de la lanterne du héros + synchronisation du slot 8 du shader local
    this.playerLanternLight.position.set(0.62 * this.playerFlipX, 1.38 + bounceY * 0.5, 0.44);
    if (lanternActive) {
      this.playerLanternWorldPosition
        .copy(this.playerRoot.position)
        .add(this.playerLanternLight.position);
      setSpriteLight(
        8,
        this.playerLanternWorldPosition,
        this.playerLanternLight.color,
        this.playerLanternLight.intensity,
        this.playerLanternLight.distance,
      );
    } else {
      clearSpriteLight(8);
    }

    // Simulation de la cape en tissu souple (uniquement couche de rendu, zéro alloc/frame,
    // support non destructif d'une texture plane de cape séparée si fournie)
    const texRev = this.textures.revision;
    if (this.lastCapeId !== p.equipped.cape || this.lastCapeRevision !== texRev) {
      const capeChanged = this.lastCapeId !== p.equipped.cape;
      this.lastCapeId = p.equipped.cape;
      this.lastCapeRevision = texRev;
      const cape = getEquipmentDefinition(p.equipped.cape);
      if (cape) {
        this.capeCloth.setCapeAppearance({
          id: cape.id,
          primaryColor: cape.visualStyle.primaryColor,
          secondaryColor: cape.visualStyle.secondaryColor,
          accentColor: cape.visualStyle.accentColor,
          luminous: cape.visualStyle.luminous,
          glowColor: cape.visualStyle.glowColor,
          fabricTexture: this.textures.getCapeFabricTexture(cape.id),
        });
      } else {
        this.capeCloth.setCapeAppearance(null);
        if (capeChanged) {
          this.capeCloth.reset();
        }
      }
    }

    const currWorldY = this.playerRoot.position.y;
    const heroVy =
      this.hasPrevHeroWorldY && dt > 0.0001
        ? (currWorldY - this.prevHeroWorldY) / dt
        : 0;
    this.prevHeroWorldY = currWorldY;
    this.hasPrevHeroWorldY = true;

    this.capeInputScratch.vx = isDead ? 0 : p.vx;
    this.capeInputScratch.vz = isDead ? 0 : p.vz;
    this.capeInputScratch.vy = heroVy;
    this.capeInputScratch.worldX = this.playerRoot.position.x;
    this.capeInputScratch.worldY = currWorldY;
    this.capeInputScratch.worldZ = this.playerRoot.position.z;
    this.capeInputScratch.facingX = this.playerFlipX;
    this.capeInputScratch.windDirX = weather?.windDirX ?? 0.85;
    this.capeInputScratch.windDirZ = weather?.windDirZ ?? 0.52;
    this.capeInputScratch.windIntensity = weather?.windIntensity ?? 0.2;
    this.capeInputScratch.stormIntensity = weather?.stormIntensity ?? 0;
    this.capeInputScratch.speed = isDead ? 0 : speed;
    this.capeInputScratch.isRolling = heroState === 'roll';
    this.capeInputScratch.isAttacking = heroState === 'attack';
    this.capeInputScratch.attackProgress =
      p.attackAnimTimer > 0
        ? Math.max(0, Math.min(1, 1 - p.attackAnimTimer / this.activeAttackTotalDuration))
        : 0;
    this.capeInputScratch.isJumping = isShipJumping || (p.elevationY ?? 0) > 0.06;
    this.capeInputScratch.isOnDeck = isOnDeck;
    this.capeInputScratch.bounceY = bounceY;
    this.capeInputScratch.elevationY = isOnDeck ? 0 : (p.elevationY ?? 0);
    this.capeCloth.update(dt, this.capeInputScratch);

    // Flash blanc HDR sur impact & clignotement i-frames post-coup
    if (p.hitFlashTimer > 0) {
      this.playerMat.emissive.setHex(0xffffff);
      this.playerMat.emissiveIntensity = 1.25;
      this.playerMat.color.setHex(0xffffff);
    } else if (p.invulnTimer > 0 && p.dodgeTimer <= 0) {
      const pulse = Math.sin(this.animTime * 32) > 0 ? 0.42 : 0;
      this.playerMat.emissive.setHex(0xffe9b0);
      this.playerMat.emissiveIntensity = pulse;
      this.playerMat.color.setHex(0xffffff);
    } else {
      this.playerMat.emissive.setHex(0x000000);
      this.playerMat.emissiveIntensity = 0;
      this.playerMat.color.setHex(0xffffff);
    }

    // Aura verte HDR de régénération (Soin-velours)
    if (p.regenTimer > 0) {
      this.playerRegenRing.visible = true;
      const rPulse = 1.05 + Math.sin(this.animTime * 7) * 0.12;
      this.playerRegenRing.scale.set(rPulse, 1, rPulse);
      this.playerRegenRing.rotation.y = this.animTime * 2.2;
      this.playerRegenMat.opacity = 0.48 + Math.sin(this.animTime * 7) * 0.2;
    } else {
      this.playerRegenRing.visible = false;
    }

    // Aura dorée-cyan persistante du bouclier (Égide de Ronron)
    if ((p.shieldHp ?? 0) > 0 && (p.shieldTimer ?? 0) > 0 && !isOnDeck) {
      this.playerShieldRing.visible = true;
      const sPulse = 1.24 + Math.sin(this.animTime * 6.5) * 0.09;
      this.playerShieldRing.scale.set(sPulse, 1, sPulse);
      this.playerShieldRing.rotation.y = -this.animTime * 1.8;
      this.playerShieldMat.opacity = 0.52 + Math.sin(this.animTime * 9) * 0.16;
    } else {
      this.playerShieldRing.visible = false;
    }
  }

  private updateCompanion(
    state: GameState,
    dt: number,
    shipDeck?: DeckAnchorsLike | null,
  ): void {
    this.companionRoot.visible = true;

    const p = state.player;
    const comp = state.companion;
    const shipMode = state.ship.mode;
    const isOnDeck =
      state.zoneId === 'overworld' &&
      (Boolean(comp.onShipDeck) || shipMode === 'sailing' || shipMode === 'docking');
    const isShipJumping =
      state.zoneId === 'overworld' &&
      (shipMode === 'boarding' || shipMode === 'disembarking');

    let bobY = 1.45 + Math.sin(this.animTime * 4.0 + comp.bobPhase) * 0.24;

    if (isOnDeck && shipDeck) {
      this.companionRoot.position.set(
        shipDeck.companionWorldPos.x,
        shipDeck.companionWorldPos.y,
        shipDeck.companionWorldPos.z,
      );
      bobY = 0.42 + Math.sin(this.animTime * 3.6 + comp.bobPhase) * 0.14;
      this.companionMesh.position.y = bobY;
      this.companionShadow.visible = true;
      this.companionShadow.position.y = -0.11;
      this.companionShadow.scale.set(0.32, 1, 0.22);
    } else if (isShipJumping) {
      const compY = comp.y ?? 0;
      this.companionRoot.position.set(comp.x, compY, comp.z);
      bobY = 0.72 + Math.sin(this.animTime * 4.2 + comp.bobPhase) * 0.12;
      this.companionMesh.position.y = bobY;
      this.companionShadow.visible = false;
    } else {
      const distToPlayer = Math.hypot(comp.x - p.x, comp.z - p.z);
      const cx = distToPlayer < 16 ? comp.x : p.x - p.facingX * 1.4;
      const cz = distToPlayer < 16 ? comp.z : p.z - 0.8;

      this.companionRoot.position.set(cx, 0, cz);
      this.companionMesh.position.y = bobY;
      this.companionShadow.visible = true;
      this.companionShadow.position.y = 0.03;

      const shadowScale = 0.42 - (bobY - 1.2) * 0.1;
      this.companionShadow.scale.set(
        Math.max(0.24, shadowScale),
        1,
        Math.max(0.18, shadowScale * 0.65),
      );
    }

    // Sélection d'état 30 FPS de Miaou-sprit (idle / move / talk lors d'un dialogue actif)
    let compSpeed = 0;
    const curX = this.companionRoot.position.x;
    const curZ = this.companionRoot.position.z;
    if (this.hasPrevCompPos && dt > 1e-4) {
      compSpeed = Math.hypot(curX - this.prevCompX, curZ - this.prevCompZ) / dt;
    }
    this.prevCompX = curX;
    this.prevCompZ = curZ;
    this.hasPrevCompPos = true;

    const currentDialogueLine = state.dialogue.active
      ? state.dialogue.lines[state.dialogue.currentIndex]
      : undefined;
    const isCompanionSpeaking = Boolean(
      currentDialogueLine && currentDialogueLine.portraitId === 'miaou_sprit',
    );

    let compState: NpcAnimState = 'idle';
    if (isCompanionSpeaking) {
      compState = 'talk';
    } else if (!isOnDeck && compSpeed > 0.45) {
      compState = 'move';
    }
    this.activeCompanionState = compState;

    const compClips = this.ensureCompanionClipTable();
    const activeCompClip = compClips[compState];
    const compFrameIdx = advanceSpriteAnimCursor(
      this.companionAnimCursor,
      activeCompClip.clip,
      activeCompClip.frameCount,
      dt,
    );
    bindResolvedFrameToMaterial(
      activeCompClip,
      compFrameIdx,
      this.companionUvBinding,
      this.companionUvRect,
      this.companionMat,
      true,
      null,
    );

    // Pulsation astrale HDR (> 1.2) pour un Bloom doux autour de Miaou-sprit !
    this.companionMat.emissiveIntensity =
      1.36 + Math.sin(this.animTime * 3.4 + comp.bobPhase) * 0.16;

    const targetFlip = p.facingX < 0 ? -1 : 1;
    this.companionFlipX = approachFlip(this.companionFlipX, targetFlip, dt * 10);
    this.companionMesh.rotation.y = 0;
    this.companionMesh.scale.set(1.3 * this.companionFlipX, 1.3, 1);
  }

  private updateEnemies(state: GameState, dt: number): void {
    const seenIds = this.seenEnemyIds;
    seenIds.clear();
    const texRev = this.textures.revision;

    for (let idx = 0; idx < state.enemies.length; idx++) {
      const enemy = state.enemies[idx];
      seenIds.add(enemy.id);
      let vis = this.enemies.get(enemy.id);
      if (!vis) {
        vis = this.createEnemyVisual(enemy);
        this.enemies.set(enemy.id, vis);
      }

      // Mise à jour Phase 2 du Boss Dragon ou rechargement d'assets -> rafraîchit la table de clips
      if (vis.phase !== enemy.phase || vis.registryRevision !== texRev) {
        vis.phase = enemy.phase;
        vis.registryRevision = texRev;
        vis.clips = this.buildEnemyClipTable(enemy.typeId, enemy.phase);
      }

      const isDead = enemy.state === 'dead' || enemy.hp <= 0;
      if (isDead) {
        const deathClip = vis.clips.death;
        if (deathClip.isDedicatedAsset && deathClip.frameCount > 1) {
          vis.activeState = 'death';
          const deathFrame = advanceSpriteAnimCursor(
            vis.animCursor,
            deathClip.clip,
            deathClip.frameCount,
            dt,
          );
          if (vis.animCursor.finished) {
            vis.root.visible = false;
            continue;
          }
          vis.root.visible = true;
          vis.hpGroup.visible = false;
          bindResolvedFrameToMaterial(
            deathClip,
            deathFrame,
            vis.uvBinding,
            vis.uvRect,
            vis.material,
            Boolean(getEnemyBaseGlow(enemy.typeId)),
            vis.fringeMat,
          );
          continue;
        }
        vis.root.visible = false;
        continue;
      }
      vis.root.visible = true;
      vis.root.position.set(enemy.x, 0, enemy.z);

      // Suivi de la durée d'état (`windup` / `recover`) lors des transitions IA
      if (vis.lastStateName !== enemy.state) {
        vis.lastStateName = enemy.state;
        if (enemy.state === 'windup' || enemy.state === 'recover') {
          vis.stateDuration = Math.max(0.08, enemy.stateTimer);
          vis.animCursor.elapsed = 0;
          vis.animCursor.frameIndex = 0;
          vis.animCursor.finished = false;
        }
      } else if (
        (enemy.state === 'windup' || enemy.state === 'recover') &&
        enemy.stateTimer > vis.stateDuration
      ) {
        vis.stateDuration = enemy.stateTimer;
      }

      const moveSpeed = Math.hypot(enemy.vx ?? 0, enemy.vz ?? 0);
      let enemyState: EnemyAnimState = 'idle';
      if (enemy.state === 'windup') {
        enemyState = 'windup';
      } else if (enemy.state === 'recover') {
        enemyState = 'attack';
      } else if (enemy.hitFlashTimer > 0 && enemy.state === 'idle' && moveSpeed <= 0.25) {
        enemyState = 'hurt';
      } else if (enemy.state === 'chase' || moveSpeed > 0.25) {
        enemyState = 'move';
      }
      vis.activeState = enemyState;

      const clipSource = vis.clips[enemyState];
      let enemyFrame = 0;
      if (enemyState === 'windup' || enemyState === 'attack') {
        const progress = Math.max(
          0,
          Math.min(1, 1 - enemy.stateTimer / Math.max(0.08, vis.stateDuration)),
        );
        vis.animCursor.clipId = clipSource.clip.id;
        vis.animCursor.elapsed = (progress * clipSource.frameCount) / clipSource.clip.fps;
        enemyFrame = sampleOneShotProgressFrame(progress, clipSource.frameCount);
        vis.animCursor.frameIndex = enemyFrame;
        vis.animCursor.finished = progress >= 1 - 1e-4;
      } else {
        enemyFrame = advanceSpriteAnimCursor(
          vis.animCursor,
          clipSource.clip,
          clipSource.frameCount,
          dt,
        );
      }

      const baseGlow = getEnemyBaseGlow(enemy.typeId);
      bindResolvedFrameToMaterial(
        clipSource,
        enemyFrame,
        vis.uvBinding,
        vis.uvRect,
        vis.material,
        Boolean(baseGlow) && enemy.hitFlashTimer <= 0,
        vis.fringeMat,
      );

      const targetFlip = enemy.facingX < 0 ? -1 : 1;
      vis.flipScaleX = approachFlip(vis.flipScaleX, targetFlip, dt * 14);
      vis.spriteMesh.rotation.y = 0;

      // Squash & stretch selon l'état d'IA & le type de monstre
      let sx = vis.baseScale;
      let sy = vis.baseScale;
      let hopY = 0;

      if (enemy.state === 'windup') {
        const pulse = 1 + Math.sin(this.animTime * 22) * 0.05;
        sx = vis.baseScale * 1.12 * pulse;
        sy = (vis.baseScale * 0.88) / pulse;
      } else if (enemy.state === 'chase') {
        const pace = enemy.typeId === 'slime_yarn' ? 7.5 : 9.5;
        const hop = Math.abs(Math.sin(this.animTime * pace + vis.animSeed));
        const amp = enemy.typeId === 'slime_yarn' ? 0.28 : 0.1;
        sx = vis.baseScale * (1.07 - hop * 0.12);
        sy = vis.baseScale * (0.93 + hop * 0.14);
        hopY = hop * amp;
      } else {
        const breath = Math.sin(this.animTime * 2.8 + vis.animSeed) * 0.03;
        sx = vis.baseScale * (1 - breath * 0.5);
        sy = vis.baseScale * (1 + breath);
      }

      vis.spriteMesh.scale.set(sx * vis.flipScaleX, sy, 1);
      if (vis.fringeMesh) {
        vis.fringeMesh.scale.set(sx * vis.flipScaleX, sy, 1);
      }
      vis.tiltGroup.position.y = hopY;

      // Couleur / Emissive HDR : Flash blanc > Givre > Boss Phase 2 > Lueur magique naturelle
      if (enemy.hitFlashTimer > 0) {
        if (vis.material.emissiveMap !== null) {
          vis.material.emissiveMap = null;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xffffff);
        vis.material.emissive.setHex(0xffffff);
        vis.material.emissiveIntensity = 1.25;
      } else if (enemy.slowTimer > 0) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0x88dcff);
        vis.material.emissive.setHex(0x2884c8);
        vis.material.emissiveIntensity = 0.52;
      } else if (enemy.isBoss && enemy.phase === 2) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        const rage = 0.85 + Math.sin(this.animTime * 9) * 0.28;
        vis.material.color.setHex(0xffd8d0);
        vis.material.emissive.setHex(0xff3822);
        vis.material.emissiveIntensity = rage;
      } else if (baseGlow) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xffffff);
        vis.material.emissive.setHex(baseGlow.hex);
        vis.material.emissiveIntensity =
          baseGlow.intensity * (0.9 + Math.sin(this.animTime * 3.5 + vis.animSeed) * 0.12);
      } else {
        vis.material.color.setHex(0xffffff);
        vis.material.emissive.setHex(0x000000);
        vis.material.emissiveIntensity = 0;
      }

      // Aura additive derrière les ennemis lumineux & Boss Dragon Phase 2
      if (vis.auraGlowMesh && vis.auraGlowMat && baseGlow) {
        if (enemy.isBoss && enemy.phase === 2) {
          vis.auraGlowMat.color.setHex(0xff4822);
          vis.auraGlowMat.opacity = 0.54 + Math.sin(this.animTime * 7.5) * 0.14;
          const p2Glow = 1.55 + Math.sin(this.animTime * 7.5) * 0.08;
          vis.auraGlowMesh.scale.set(vis.baseScale * p2Glow, vis.baseScale * p2Glow, 1);
        } else {
          vis.auraGlowMat.color.setHex(baseGlow.hex);
          vis.auraGlowMat.opacity = 0.34 + Math.sin(this.animTime * 3.5 + vis.animSeed) * 0.06;
          vis.auraGlowMesh.scale.set(vis.baseScale * 1.35, vis.baseScale * 1.3, 1);
        }
      }

      // Anneau de givre au sol si ralenti
      vis.frostRing.visible = enemy.slowTimer > 0;
      if (enemy.slowTimer > 0) {
        vis.frostRing.rotation.y = -this.animTime * 1.8;
      }

      // Aura cramoisie palpitante sous le Boss Dragon en Phase 2
      if (vis.bossAuraRing && vis.bossAuraMat) {
        const showPhase2 = enemy.isBoss && enemy.phase === 2;
        vis.bossAuraRing.visible = showPhase2;
        if (showPhase2) {
          const p2Scale =
            enemy.radius * (1.48 + Math.sin(this.animTime * 8) * 0.14);
          vis.bossAuraRing.scale.set(p2Scale, 1, p2Scale);
          vis.bossAuraRing.rotation.y = this.animTime * 1.5;
          vis.bossAuraMat.opacity = 0.58 + Math.sin(this.animTime * 8) * 0.22;
        }
      }

      // Barre de vie discrète au-dessus des ennemis blessés
      const isActiveHudBoss = enemy.isBoss && state.activeBossId === enemy.id;
      const showHpBar =
        !isActiveHudBoss && enemy.hp > 0 && enemy.hp < enemy.maxHp;
      vis.hpGroup.visible = showHpBar;
      if (showHpBar) {
        const ratio = Math.max(0.02, Math.min(1, enemy.hp / enemy.maxHp));
        vis.hpFillMesh.scale.x = ratio;
        vis.hpFillMat.color.setHex(ratio > 0.35 ? 0xe63946 : 0xff7b29);
      }
    }

    for (const [id, vis] of this.enemies.entries()) {
      if (!seenIds.has(id)) {
        this.disposeEnemyVisual(vis);
        this.enemies.delete(id);
      }
    }
  }

  public update(
    state: GameState,
    dt: number,
    shipDeck?: DeckAnchorsLike | null,
    weather?: CapeWeatherWind,
  ): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    this.animTime += safeDt;

    this.updatePlayer(state, safeDt, shipDeck, weather);
    this.updateCompanion(state, safeDt, shipDeck);
    this.updateEnemies(state, safeDt);
  }

  public getCapeDiagnostics(): {
    visible: boolean;
    activeCapeId: string;
    hasCustomFabricTexture: boolean;
    vertexCount: number;
    minWorldY: number;
    maxZViolation: number;
    hemOffsetX: number;
    hemOffsetZ: number;
    lanternActive: boolean;
    lanternIntensity: number;
  } {
    const s = this.capeCloth.solver;
    const rootY = this.playerRoot.position.y;
    const tanTilt = Math.tan(Math.abs(SPRITE_TILT_X));
    let minWorldY = Number.POSITIVE_INFINITY;
    let maxZViolation = 0;
    for (let i = 0; i < s.vertexCount; i++) {
      const wy = rootY + s.posY[i];
      if (wy < minWorldY) minWorldY = wy;
      const heroPlaneZ = -Math.max(0, s.posY[i] - this.lastPlayerBounceY) * tanTilt;
      const zDiff = s.posZ[i] - heroPlaneZ;
      if (zDiff > maxZViolation) maxZViolation = zDiff;
    }
    const bottomCenterIdx = (s.rows - 1) * s.cols + Math.floor(s.cols / 2);
    return {
      visible: this.capeCloth.mesh.visible,
      activeCapeId: this.capeCloth.getActiveCapeId(),
      hasCustomFabricTexture: this.capeCloth.hasCustomFabricTexture(),
      vertexCount: s.vertexCount,
      minWorldY: Number.isFinite(minWorldY) ? Math.round(minWorldY * 1000) / 1000 : 0,
      maxZViolation: Math.round(maxZViolation * 1000) / 1000,
      hemOffsetX: Math.round(s.posX[bottomCenterIdx] * 1000) / 1000,
      hemOffsetZ: Math.round(s.posZ[bottomCenterIdx] * 1000) / 1000,
      lanternActive: this.playerLanternLight.visible,
      lanternIntensity: Math.round(this.playerLanternLight.intensity * 100) / 100,
    };
  }

  /**
   * Diagnostic en lecture seule de l'état d'animation 30 FPS (héros, compagnon et ennemis).
   */
  public getAnimationDiagnostics(): {
    hero: {
      state: HeroAnimState;
      frameIndex: number;
      frameCount: number;
      finished: boolean;
      uv: Readonly<SpriteUvRect>;
      textureUuid: string;
    };
    companion: {
      state: NpcAnimState;
      frameIndex: number;
      frameCount: number;
      uv: Readonly<SpriteUvRect>;
      textureUuid: string;
    };
    enemies: Record<
      string,
      {
        typeId: EnemyTypeId;
        phase: 1 | 2;
        visible: boolean;
        state: EnemyAnimState;
        frameIndex: number;
        frameCount: number;
        finished: boolean;
        uv: Readonly<SpriteUvRect>;
        textureUuid: string;
      }
    >;
  } {
    const heroClip = this.heroClipsCache?.[this.activeHeroState];
    const compClip = this.companionClipsCache?.[this.activeCompanionState];
    const enemiesOut: Record<
      string,
      {
        typeId: EnemyTypeId;
        phase: 1 | 2;
        visible: boolean;
        state: EnemyAnimState;
        frameIndex: number;
        frameCount: number;
        finished: boolean;
        uv: Readonly<SpriteUvRect>;
        textureUuid: string;
      }
    > = {};

    for (const [id, vis] of this.enemies.entries()) {
      const c = vis.clips[vis.activeState];
      enemiesOut[id] = {
        typeId: vis.typeId,
        phase: vis.phase,
        visible: vis.root.visible,
        state: vis.activeState,
        frameIndex: vis.animCursor.frameIndex,
        frameCount: c.frameCount,
        finished: vis.animCursor.finished,
        uv: { ...vis.uvRect },
        textureUuid: vis.material.map?.uuid ?? '',
      };
    }

    return {
      hero: {
        state: this.activeHeroState,
        frameIndex: this.heroAnimCursor.frameIndex,
        frameCount: heroClip?.frameCount ?? 1,
        finished: this.heroAnimCursor.finished,
        uv: { ...this.heroUvRect },
        textureUuid: this.playerMat.map?.uuid ?? '',
      },
      companion: {
        state: this.activeCompanionState,
        frameIndex: this.companionAnimCursor.frameIndex,
        frameCount: compClip?.frameCount ?? 1,
        uv: { ...this.companionUvRect },
        textureUuid: this.companionMat.map?.uuid ?? '',
      },
      enemies: enemiesOut,
    };
  }

  public clear(): void {
    for (const vis of this.enemies.values()) {
      this.disposeEnemyVisual(vis);
    }
    this.enemies.clear();
    this.seenEnemyIds.clear();
    this.hasPrevHeroWorldY = false;
    this.hasPrevCompPos = false;
    this.capeCloth.reset();
  }

  public dispose(): void {
    this.clear();
    this.heroUvBinding.clonedTex?.dispose();
    this.heroUvBinding.clonedTex = null;
    this.heroUvBinding.sourceTex = null;
    this.companionUvBinding.clonedTex?.dispose();
    this.companionUvBinding.clonedTex = null;
    this.companionUvBinding.sourceTex = null;
    this.scene.remove(this.rootGroup);
    this.spriteGeo.dispose();
    this.glowGeo.dispose();
    this.shadowGeo.dispose();
    this.hpBgGeo.dispose();
    this.hpFillGeo.dispose();
    this.auraRingGeo.dispose();
    this.playerMat.dispose();
    this.capeCloth.dispose();
    this.playerShadowMat.dispose();
    this.playerRegenMat.dispose();
    this.playerShieldMat.dispose();
    this.companionMat.dispose();
    this.companionShadowMat.dispose();
  }
}
