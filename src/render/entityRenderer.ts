import * as THREE from 'three';
import type {
  EnemyInstance,
  EnemyTypeId,
  EquipSlot,
  GameState,
} from '../game/types';
import { hasStatus } from '../game/statusEffects';
import { ENEMIES } from '../data/enemiesData';
import { getEquipmentDefinition, getWeaponCombatProfile } from '../data/equipmentData';
import {
  type EnemyAnimState,
  type HeroAnimState,
  type NpcAnimState,
  type SpriteAnimCursor,
  type SpriteUvRect,
  advanceSpriteAnimCursor,
  applyUvRectToTexture,
  computeGridFrameUvInto,
  createFixedStepAnimClock,
  createSpriteAnimCursor,
  createSpriteUvRect,
  sampleOneShotProgressFrame,
  stepFixed30FpsClock,
} from '../art/hdAssets';
import {
  type HeroBeltLanternState,
  type PaperFlipOvershootState,
  createHeroBeltLanternState,
  createPaperFlipOvershootState,
  sampleHeroFrameSockets,
  stepHeroBeltLantern,
  stepPaperFlipOvershoot,
} from '../art/spriteHero';
import {
  type EquipmentCalibrationEntry,
  HERO_BONE_ORDER,
  HERO_SKELETON_SPEC,
  type HeroBoneId,
  type HeroEquipmentMaskState,
  type HeroSkeletonPose,
  type NormalizedEquipmentFit,
  computeHeroEquipmentMaskState,
  createHeroSkeletonPose,
  solveHeroBoneTransformsInto,
  solveHeroEarPose,
} from '../art/equipmentRig';
import {
  type ResolvedSpriteClipSource,
  TextureRegistry,
} from '../art/textureRegistry';
import { CapeClothMesh, type CapeWindInput } from './capePhysics';
import {
  type HeroSpriteMaskUniforms,
  SPRITE_LIGHT_SLOT,
  clearSpriteLight,
  createHeroMaskUniforms,
  enableSpriteLighting,
  setSpriteLight,
} from './spriteLighting';

export interface CapeWeatherWind {
  readonly windDirX: number;
  readonly windDirZ: number;
  readonly windIntensity: number;
  readonly stormIntensity?: number;
  readonly lanternBoost: number;
  readonly nightFactor?: number;
}

const SPRITE_TILT_X = -0.48;
const HERO_WIDTH = 3.05;
const HERO_HEIGHT = 3.18;
const HP_BAR_WIDTH = 1.45;
const HP_BAR_HEIGHT = 0.16;

type HeroEquipCutoutKey =
  | 'armor'
  | 'helmet'
  | 'shield'
  | 'weapon';

interface HeroEquipCutoutEntry {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  boneId: HeroBoneId;
  mirrorMode: 'none' | 'left' | 'right';
  lastItemId: string;
  lastRevision: number;
  calibration: EquipmentCalibrationEntry | null;
  fit: NormalizedEquipmentFit | null;
}

export interface DeckAnchorsLike {
  readonly heroWorldPos: { readonly x: number; readonly y: number; readonly z: number };
  readonly companionWorldPos: { readonly x: number; readonly y: number; readonly z: number };
  readonly deckRoll: number;
  readonly deckPitch: number;
  readonly waterY: number;
}

interface UvTextureBinding {
  clones: Map<THREE.Texture, THREE.Texture>;
}

function createUvTextureBinding(): UvTextureBinding {
  return { clones: new Map() };
}

function disposeUvTextureBinding(binding: UvTextureBinding): void {
  for (const tex of binding.clones.values()) {
    tex.dispose();
  }
  binding.clones.clear();
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
  phase2TransitionTimer: number;
  cinematicPropGroup?: THREE.Group;
  cinematicPropDisposables?: Array<{ dispose(): void }>;
  cinematicMice?: THREE.Mesh[];
  cinematicCheese?: THREE.Mesh[];
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
    let activeTex = uvBinding.clones.get(source.sheetTexture);
    if (!activeTex) {
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
      uvBinding.clones.set(source.sheetTexture, clone);
      activeTex = clone;
    }

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

  // Joueur (PBR éclairé dynamiquement + squelette hiérarchique d'os + cape physique, ZÉRO faux halo)
  private readonly playerRoot = new THREE.Group();
  private readonly playerTiltGroup = new THREE.Group();
  private readonly playerMesh: THREE.Mesh;
  private readonly playerMat: THREE.MeshStandardMaterial;
  private readonly heroMaskUniforms: HeroSpriteMaskUniforms = createHeroMaskUniforms();
  private readonly heroMaskScratch: HeroEquipmentMaskState = computeHeroEquipmentMaskState({
    equipped: {},
  });
  private readonly heroRigRoot = new THREE.Group();
  private readonly heroBones: Record<HeroBoneId, THREE.Group>;
  private readonly heroPoseScratch: HeroSkeletonPose = createHeroSkeletonPose();
  private readonly lanternBeltAnchor = new THREE.Group();
  private readonly lanternHandAnchor = new THREE.Group();
  private readonly playerLanternLight: THREE.PointLight;
  private readonly playerWeaponLight: THREE.PointLight;
  private readonly companionLight: THREE.PointLight;
  private readonly enemyDynamicLight: THREE.PointLight;
  private readonly scratchWorldPosA = new THREE.Vector3();
  private readonly scratchWorldPosC = new THREE.Vector3();
  private readonly lanternGeo: THREE.PlaneGeometry;
  private readonly playerLanternMat: THREE.MeshStandardMaterial;
  private readonly playerLanternMesh: THREE.Mesh;
  private lanternTexLit = false;
  private readonly beltLantern: HeroBeltLanternState = createHeroBeltLanternState();
  private readonly helmetBackPivot = new THREE.Group();
  private readonly helmetBackMesh: THREE.Mesh;
  private readonly helmetBackMat: THREE.MeshStandardMaterial;
  private readonly heroDeathSpiritMesh: THREE.Mesh;
  private readonly heroDeathSpiritMat: THREE.MeshBasicMaterial;
  private readonly playerFlipOvershoot: PaperFlipOvershootState = createPaperFlipOvershootState(1);
  private readonly animClock30Fps = createFixedStepAnimClock();
  private readonly equipCutouts: Record<HeroEquipCutoutKey, HeroEquipCutoutEntry>;
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
    collarSocketOffsetX: 0,
    collarSocketOffsetY: 0,
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
  private walkStridePhase = 0;
  private walkSheetPhase = 0;
  private smoothedSpeedRatio = 0;
  private idleBreathClock = 0;
  private idleTwitchCooldown = 3.8;
  private idleTwitchProgress = -1;
  private idleCycleCounter = 0;

  // État d'animation 30 FPS zéro-allocation du héros (4 slots corps suivis par référence)
  private heroClipsCache: Record<HeroAnimState, ResolvedSpriteClipSource> | null = null;
  private lastHeroWeapon = '';
  private lastHeroShield = '';
  private lastHeroHelmet = '';
  private lastHeroArmor = '';
  private lastHeroRevision = -1;
  private readonly heroAnimCursor = createSpriteAnimCursor('hero_idle');
  private readonly heroUvRect = createSpriteUvRect();
  private readonly heroUvBinding: UvTextureBinding = createUvTextureBinding();
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
  private readonly companionHaloMesh: THREE.Mesh;
  private readonly companionHaloMat: THREE.MeshBasicMaterial;
  private readonly companionShadow: THREE.Mesh;
  private readonly companionShadowMat: THREE.MeshBasicMaterial;
  private companionFlipX = 1;
  private companionClipsCache: Record<NpcAnimState, ResolvedSpriteClipSource> | null = null;
  private lastCompanionRevision = -1;
  private readonly companionAnimCursor = createSpriteAnimCursor('miaou_sprit_idle');
  private readonly companionUvRect = createSpriteUvRect();
  private readonly companionUvBinding: UvTextureBinding = createUvTextureBinding();
  private activeCompanionState: NpcAnimState = 'idle';
  private prevCompX = 0;
  private prevCompZ = 0;
  private hasPrevCompPos = false;
  private companionTeleportTimer = 0;

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
    enableSpriteLighting(this.playerMat, {
      heroMaskUniforms: this.heroMaskUniforms,
    });
    this.playerMesh = new THREE.Mesh(this.spriteGeo, this.playerMat);
    this.playerMesh.scale.set(HERO_WIDTH, HERO_HEIGHT, 1);
    this.playerMesh.castShadow = true;
    this.playerMesh.receiveShadow = false;
    this.playerMesh.frustumCulled = false;
    this.playerMesh.userData.skipSSAO = true;
    this.playerMesh.userData.isSprite25D = true;
    this.playerTiltGroup.add(this.playerMesh);

    // Squelette hiérarchique 3D du héros (`pelvis -> spine -> chest -> head/arms, legs`)
    // Hérite exactement du squash/stretch et du flip du corps sans aucune dérive
    this.heroRigRoot.name = 'HeroSkeletonRig';
    this.playerTiltGroup.add(this.heroRigRoot);

    const bones = {} as Record<HeroBoneId, THREE.Group>;
    for (const boneId of HERO_BONE_ORDER) {
      const g = new THREE.Group();
      g.name = `Bone_${boneId}`;
      bones[boneId] = g;
    }
    for (const boneId of HERO_BONE_ORDER) {
      const spec = HERO_SKELETON_SPEC[boneId];
      const g = bones[boneId];
      g.position.set(spec.restX, spec.restY, spec.restZ);
      if (spec.parent) {
        bones[spec.parent].add(g);
      } else {
        this.heroRigRoot.add(g);
      }
    }
    this.heroBones = bones;

    // Ancres hiérarchiques de la lanterne (strictement sur la DROITE du héros : ceinture & main droite)
    this.lanternBeltAnchor.name = 'LanternBeltAnchor';
    this.lanternBeltAnchor.position.set(0.015, 0.012, 0.012);
    this.heroBones.waist.add(this.lanternBeltAnchor);

    this.lanternHandAnchor.name = 'LanternHandAnchor';
    this.lanternHandAnchor.position.set(0.115, 0.045, 0.018);
    this.heroBones.rightHand.add(this.lanternHandAnchor);

    // 9 couches d'équipement PBR parentées à leurs os anatomiques avec pivot mécanique dédié
    const createEquipCutout = (
      boneId: HeroBoneId,
      renderOrder: number,
      mirrorMode: 'none' | 'left' | 'right' = 'none',
    ): HeroEquipCutoutEntry => {
      const pivot = new THREE.Group();
      pivot.name = `Socket_${boneId}_${renderOrder}`;
      pivot.visible = false;
      this.heroBones[boneId].add(pivot);

      const material = new THREE.MeshStandardMaterial({
        roughness: 0.62,
        metalness: 0.18,
        transparent: true,
        alphaTest: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0,
      });
      enableSpriteLighting(material);
      const mesh = new THREE.Mesh(this.glowGeo, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = renderOrder;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.userData.skipSSAO = true;
      mesh.userData.isSprite25D = true;
      pivot.add(mesh);
      return {
        pivot,
        mesh,
        material,
        boneId,
        mirrorMode,
        lastItemId: '',
        lastRevision: -1,
        calibration: null,
        fit: null,
      };
    };
    this.equipCutouts = {
      armor: createEquipCutout('chest', 4, 'none'),
      helmet: createEquipCutout('head', 8, 'none'),
      shield: createEquipCutout('leftHand', 9, 'none'),
      weapon: createEquipCutout('rightHand', 10, 'none'),
    };

    // Couche d'occlusion arrière du casque/chapeau (passe derrière la tête pour entourer
    // naturellement le crâne et masquer proprement l'arrière des oreilles sans déborder)
    this.helmetBackPivot.name = 'Socket_head_back_occlusion';
    this.helmetBackPivot.visible = false;
    this.heroBones.head.add(this.helmetBackPivot);
    this.helmetBackMat = new THREE.MeshStandardMaterial({
      roughness: 0.78,
      metalness: 0.14,
      color: new THREE.Color(0x2c3442),
      transparent: true,
      opacity: 0.78,
      alphaTest: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    enableSpriteLighting(this.helmetBackMat);
    this.helmetBackMesh = new THREE.Mesh(this.glowGeo, this.helmetBackMat);
    this.helmetBackMesh.frustumCulled = false;
    this.helmetBackMesh.renderOrder = 1;
    this.helmetBackMesh.userData.skipSSAO = true;
    this.helmetBackMesh.userData.isSprite25D = true;
    this.helmetBackPivot.add(this.helmetBackMesh);

    // Vraies sources lumineuses PointLight (atténuation quadratique physique decay = 2)
    // Remplacent TOUS les anciens faux halos additifs (lanterne, arme, bijou, compagnon, boss)
    this.playerLanternLight = new THREE.PointLight(0xffb454, 0, 12.5, 2);
    this.playerLanternLight.castShadow = false;
    this.playerLanternLight.visible = false;
    this.playerLanternLight.position.set(0.55, 1.15, 0.45);
    this.playerLanternLight.userData.skipSSAO = true;
    this.rootGroup.add(this.playerLanternLight);

    this.playerWeaponLight = new THREE.PointLight(0x5ce6ff, 0, 8.0, 2);
    this.playerWeaponLight.castShadow = false;
    this.playerWeaponLight.visible = false;
    this.playerWeaponLight.userData.skipSSAO = true;
    this.rootGroup.add(this.playerWeaponLight);

    this.companionLight = new THREE.PointLight(0x78e8ff, 2.0, 7.0, 2);
    this.companionLight.castShadow = false;
    this.companionLight.visible = true;
    this.companionLight.userData.skipSSAO = true;
    this.rootGroup.add(this.companionLight);

    this.enemyDynamicLight = new THREE.PointLight(0xff4c24, 0, 13.0, 2);
    this.enemyDynamicLight.castShadow = false;
    this.enemyDynamicLight.visible = false;
    this.enemyDynamicLight.userData.skipSSAO = true;
    this.rootGroup.add(this.enemyDynamicLight);

    // Lanterne 2.5D du héros montée dans `heroRigRoot` avec pivot suspendu sur l'anneau supérieur
    this.lanternGeo = new THREE.PlaneGeometry(1, 1);
    this.lanternGeo.translate(0, -0.5, 0);
    this.playerLanternMat = new THREE.MeshStandardMaterial({
      map: this.textures.getHeroLanternTexture(false),
      emissive: new THREE.Color(0xffb648),
      emissiveIntensity: 0,
      roughness: 0.38,
      metalness: 0.48,
      transparent: true,
      alphaTest: 0.25,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    enableSpriteLighting(this.playerLanternMat);
    this.playerLanternMesh = new THREE.Mesh(this.lanternGeo, this.playerLanternMat);
    this.playerLanternMesh.frustumCulled = false;
    this.playerLanternMesh.renderOrder = 11;
    this.playerLanternMesh.userData.skipSSAO = true;
    this.heroRigRoot.add(this.playerLanternMesh);

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
    this.playerShadow.scale.set(1.04, 1, 0.72);
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

    // Esprit félin doré-cyan s'élevant doucement lors de la séquence de mort du héros
    this.heroDeathSpiritMat = new THREE.MeshBasicMaterial({
      map: this.textures.getStarParticleTexture(),
      color: new THREE.Color(1.4, 1.85, 2.2),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.heroDeathSpiritMesh = new THREE.Mesh(this.glowGeo, this.heroDeathSpiritMat);
    this.heroDeathSpiritMesh.rotation.x = SPRITE_TILT_X;
    this.heroDeathSpiritMesh.visible = false;
    this.heroDeathSpiritMesh.renderOrder = 12;
    this.heroDeathSpiritMesh.userData.skipSSAO = true;
    this.playerRoot.add(this.heroDeathSpiritMesh);

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

    this.companionHaloMat = new THREE.MeshBasicMaterial({
      map: this.textures.getParticleTexture(),
      color: new THREE.Color(0x78e8ff),
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.companionHaloMesh = new THREE.Mesh(this.glowGeo, this.companionHaloMat);
    this.companionHaloMesh.scale.set(2.1, 2.1, 1);
    this.companionHaloMesh.rotation.x = SPRITE_TILT_X;
    this.companionHaloMesh.renderOrder = 3;
    this.companionHaloMesh.userData.skipSSAO = true;
    this.companionRoot.add(this.companionHaloMesh);

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
      this.lastHeroArmor === equipped.armor
    ) {
      return this.heroClipsCache;
    }

    this.lastHeroRevision = rev;
    this.lastHeroWeapon = equipped.weapon;
    this.lastHeroShield = equipped.shield;
    this.lastHeroHelmet = equipped.helmet;
    this.lastHeroArmor = equipped.armor;

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
    const uvBinding: UvTextureBinding = createUvTextureBinding();
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
    spriteMesh.frustumCulled = false;
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
      fringeMesh.frustumCulled = false;
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

    // Ombre de contact douce au sol (l'éclairage des ennemis lumineux passe par enemyDynamicLight)
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
      phase2TransitionTimer: 0,
    };
  }

  private disposeEnemyVisual(vis: EnemyVisual): void {
    this.rootGroup.remove(vis.root);
    disposeUvTextureBinding(vis.uvBinding);
    vis.material.dispose();
    vis.fringeMat?.dispose();
    vis.shadowMat.dispose();
    vis.hpBgMat.dispose();
    vis.hpFillMat.dispose();
    vis.frostRingMat.dispose();
    vis.bossAuraMat?.dispose();
    if (vis.cinematicPropDisposables) {
      for (const d of vis.cinematicPropDisposables) {
        d.dispose();
      }
    }
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

    for (const eq of Object.values(this.equipCutouts)) {
      eq.lastRevision = -1;
      eq.calibration = null;
      eq.fit = null;
    }

    const lanternTex = this.textures.getHeroLanternTexture(this.lanternTexLit);
    this.playerLanternMat.map = lanternTex;
    this.playerLanternMat.emissiveMap = this.lanternTexLit ? lanternTex : null;
    this.playerLanternMat.needsUpdate = true;

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

    const inDungeon = state.zoneId !== 'overworld';
    const portalTr = state.portalTransition;
    const isPortalWalking = Boolean(portalTr);

    const speed = Math.hypot(p.vx, p.vz);
    const isDeathSequence = Boolean(state.deathSequence);
    const isDead = isDeathSequence || p.hp <= 0 || state.screen === 'defeat';
    const deathProgress = state.deathSequence
      ? Math.max(0, Math.min(1, state.deathSequence.elapsed / Math.max(0.1, state.deathSequence.duration)))
      : isDead
        ? 1
        : 0;
    const isMoving =
      !isDead &&
      !isOnDeck &&
      !isShipJumping &&
      (speed > 0.35 || isPortalWalking);

    // Synchronise finement la cadence de foulée à la vitesse réelle au sol (plus posée et naturelle)
    const maxWalkSpeed = 7.4;
    const effectiveSpeed = isPortalWalking ? Math.max(speed, 4.2) : speed;
    const rawSpeedRatio = isMoving ? Math.max(0.22, Math.min(1.15, effectiveSpeed / maxWalkSpeed)) : 0;
    this.smoothedSpeedRatio += (rawSpeedRatio - this.smoothedSpeedRatio) * Math.min(1, dt * 10);
    if (isMoving) {
      this.walkClock += dt * (4.6 * Math.max(0.35, this.smoothedSpeedRatio));
      this.walkStridePhase += dt * (effectiveSpeed * 1.12);
      this.walkSheetPhase += dt * (11.5 * Math.max(0.35, this.smoothedSpeedRatio));
    } else {
      this.idleBreathClock += dt;
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
    } else if (heroState === 'death') {
      this.heroAnimCursor.clipId = activeClipSource.clip.id;
      frameIdx = sampleOneShotProgressFrame(deathProgress, activeClipSource.frameCount);
      this.heroAnimCursor.frameIndex = frameIdx;
      this.heroAnimCursor.finished = deathProgress >= 1 - 1e-4;
    } else if (heroState === 'jump') {
      const tr = state.ship.transition;
      const jumpProgress = tr
        ? Math.max(0, Math.min(1, tr.elapsed / Math.max(0.01, tr.duration)))
        : 0.5;
      this.heroAnimCursor.clipId = activeClipSource.clip.id;
      frameIdx = sampleOneShotProgressFrame(jumpProgress, activeClipSource.frameCount);
      this.heroAnimCursor.frameIndex = frameIdx;
      this.heroAnimCursor.finished = jumpProgress >= 1 - 1e-4;
    } else {
      frameIdx = advanceSpriteAnimCursor(
        this.heroAnimCursor,
        activeClipSource.clip,
        activeClipSource.frameCount,
        dt,
      );
    }

    // Sur les planches HD chargées en jeu réel :
    // - au repos : cadence plus calme et variée (pauses naturelles avant un léger mouvement d'oreilles)
    // - en marche : cadence des jambes/pieds plus posée et synchronisée à la vitesse réelle
    let renderedFrameIdx = frameIdx;
    if (
      this.textures.isHdLoaded &&
      activeClipSource.mode === 'uv-grid' &&
      activeClipSource.frameCount > 8
    ) {
      if (heroState === 'idle' || heroState === 'deck_idle') {
        if (this.idleTwitchProgress >= 0) {
          this.idleTwitchProgress += dt * 0.56;
          if (this.idleTwitchProgress >= 1) {
            this.idleTwitchProgress = -1;
            this.idleCycleCounter += 1;
            // Pause variable (~4.2 s à 7.1 s) pour éviter toute boucle nerveuse/répétitive
            const variedGap = 4.2 + ((this.idleCycleCounter * 1.37) % 2.9);
            this.idleTwitchCooldown = variedGap;
          } else {
            renderedFrameIdx = Math.min(
              activeClipSource.frameCount - 1,
              Math.floor(this.idleTwitchProgress * activeClipSource.frameCount),
            );
          }
        } else {
          this.idleTwitchCooldown -= dt;
          if (this.idleTwitchCooldown <= 0) {
            this.idleTwitchProgress = 0;
          }
          // Respiration très lente sur les premières frames calmes (sans tic répété d'oreilles)
          const calmSpan = Math.min(6, activeClipSource.frameCount - 1);
          const wave = 0.5 - 0.5 * Math.cos(this.idleBreathClock * 1.15);
          renderedFrameIdx = Math.round(wave * calmSpan);
        }
      } else if (heroState === 'walk') {
        renderedFrameIdx =
          Math.floor(this.walkSheetPhase) % Math.max(1, activeClipSource.frameCount);
      }
    }

    bindResolvedFrameToMaterial(
      activeClipSource,
      renderedFrameIdx,
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
      this.playerShadow.scale.set(0.96, 1, 0.66);
    } else if (isShipJumping) {
      const elevY = p.elevationY ?? 0;
      this.playerRoot.position.set(p.x, elevY, p.z);
      this.playerTiltGroup.rotation.z = 0;
      // Masque l'ombre sol pendant la traversée aérienne au-dessus de l'eau
      this.playerShadow.visible = elevY < 0.25;
      this.playerShadow.position.y = Math.max(0.03, -elevY + 0.03);
      const sScale = Math.max(0.35, 1 - elevY * 0.22);
      this.playerShadow.scale.set(1.04 * sScale, 1, 0.72 * sScale);
    } else {
      this.playerRoot.position.set(p.x, p.elevationY ?? 0, p.z);
      this.playerTiltGroup.rotation.z = 0;
      this.playerShadow.visible = true;
      this.playerShadow.position.y = 0.03;
      this.playerShadow.scale.set(1.04, 1, 0.72);
    }

    // Retournement 180° façon feuille rigide avec courbe d'overshoot amortie
    const targetFlip: 1 | -1 = p.facingX < 0 ? -1 : 1;
    stepPaperFlipOvershoot(this.playerFlipOvershoot, targetFlip, dt, 0.18);
    this.playerFlipX = this.playerFlipOvershoot.scaleX;
    this.playerMesh.rotation.y = 0;

    // Squash & stretch expressif selon l'action (ligne de sol pieds préservée)
    let sx = HERO_WIDTH;
    let sy = HERO_HEIGHT;
    let bounceY = 0;
    let portalScale = 1;

    if (portalTr) {
      const pt = Math.max(0, Math.min(1, portalTr.elapsed / Math.max(0.05, portalTr.duration)));
      if (portalTr.phase === 'entering') {
        portalScale = Math.max(0.28, 1 - pt * pt * 0.68);
      } else {
        const emerge = 1 - Math.pow(1 - pt, 2);
        portalScale = 0.35 + emerge * 0.65;
      }
    }

    if (isOnDeck) {
      const seaBreath = Math.sin(this.animTime * 2.4) * 0.02;
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
      // Séquence de mort du héros (~2.0 s) : choc -> bascule latérale -> affaissement au sol
      const stagger = deathProgress < 0.25 ? Math.sin((deathProgress / 0.25) * Math.PI) * 0.08 : 0;
      const fallT = Math.max(0, Math.min(1, (deathProgress - 0.18) / 0.58));
      const fallEase = fallT * fallT * (3 - 2 * fallT);
      sx = HERO_WIDTH * (1.0 + fallEase * 0.1 + stagger);
      sy = HERO_HEIGHT * (1.0 - fallEase * 0.26 - stagger * 0.5);
      bounceY = stagger * 0.16 - fallEase * 0.18;
      this.playerTiltGroup.rotation.z = -fallEase * 1.18 * targetFlip;
      this.playerShadow.scale.set(1.04 + fallEase * 0.55, 1, 0.72 + fallEase * 0.25);
    } else if (heroState === 'roll') {
      const sq = 1 + Math.sin(this.animTime * 28) * 0.1;
      sx = HERO_WIDTH * 0.96 * sq;
      sy = (HERO_HEIGHT * 0.88) / sq;
      bounceY = 0.22;
    } else if (heroState === 'attack') {
      const weaponProfile = getWeaponCombatProfile(p.equipped.weapon);
      const isHeavyWeapon =
        weaponProfile.attackShape === 'cleave' ||
        weaponProfile.weaponFamily === 'axe_hammer' ||
        p.equipped.weapon === 'blade_dragon';
      const isArcaneWeapon =
        weaponProfile.weaponFamily === 'staff' ||
        weaponProfile.weaponFamily === 'bow_crossbow';
      sx = HERO_WIDTH * (isHeavyWeapon ? 1.14 : isArcaneWeapon ? 1.07 : 1.1);
      sy = HERO_HEIGHT * (isHeavyWeapon ? 0.92 : 0.95);
      bounceY = isHeavyWeapon ? 0.08 : 0.05;
    } else if (heroState === 'hurt') {
      sx = HERO_WIDTH * 1.05;
      sy = HERO_HEIGHT * 0.95;
      bounceY = 0.03;
    } else if (isMoving) {
      const hop = Math.abs(Math.sin(this.walkStridePhase)) * Math.min(1, this.smoothedSpeedRatio);
      sx = HERO_WIDTH * (1.03 - hop * 0.055);
      sy = HERO_HEIGHT * (0.97 + hop * 0.07);
      bounceY = hop * 0.09;
    } else {
      const breath = Math.sin(this.animTime * 1.9) * 0.018;
      sx = HERO_WIDTH * (1 - breath * 0.45);
      sy = HERO_HEIGHT * (1 + breath);
    }

    sx *= portalScale;
    sy *= portalScale;

    this.playerMesh.scale.set(sx * this.playerFlipX, sy, 1);
    this.heroRigRoot.scale.set(sx * this.playerFlipX, sy, 1);
    this.playerTiltGroup.position.y = bounceY;
    this.lastPlayerBounceY = bounceY;

    // Esprit félin s'élevant à la fin de la séquence de mort du héros
    if (heroState === 'death' && deathProgress > 0.42) {
      const soulT = Math.min(1, (deathProgress - 0.42) / 0.58);
      this.heroDeathSpiritMesh.visible = true;
      this.heroDeathSpiritMesh.position.set(
        Math.sin(soulT * Math.PI * 3) * 0.22,
        0.55 + soulT * 2.1,
        0.2,
      );
      const soulScale = 0.55 + Math.sin(soulT * Math.PI) * 0.45;
      this.heroDeathSpiritMesh.scale.set(soulScale, soulScale, 1);
      this.heroDeathSpiritMat.opacity = Math.sin(soulT * Math.PI) * 0.88;
    } else {
      this.heroDeathSpiritMesh.visible = false;
      this.heroDeathSpiritMat.opacity = 0;
    }

    // 1. Résolution de la pose hiérarchique des 16 os du squelette (zéro allocation)
    const isBlocking = (p.shieldHp ?? 0) > 0 && (p.shieldTimer ?? 0) > 0;
    const bonePose = solveHeroBoneTransformsInto(
      this.heroPoseScratch,
      heroState,
      frameIdx,
      activeClipSource.frameCount,
      {
        blocking: isBlocking,
        time: this.animTime,
        weaponId: p.equipped.weapon,
        comboStep: p.comboStep,
        stridePhase: this.walkStridePhase,
        speedRatio: Math.max(0.2, this.smoothedSpeedRatio),
        deathProgress,
      },
    );
    const earPose = solveHeroEarPose(this.animTime, heroState, p.equipped.helmet);
    for (const boneId of HERO_BONE_ORDER) {
      const b = bonePose[boneId];
      const node = this.heroBones[boneId];
      node.position.set(b.x, b.y, b.z);
      const extraHeadTilt = boneId === 'head' ? (earPose.leftRotZ + earPose.rightRotZ) * 0.14 : 0;
      node.rotation.z = b.rotZ + extraHeadTilt;
      node.scale.set(b.scaleX, b.scaleY, 1);
    }

    // 2. Synchronisation des 9 couches d'équipement PBR parentées à leurs os anatomiques
    // Restent visibles & articulées pendant TOUTES les animations (roulade & séquence de mort incluses)
    const showSocketEquip = activeClipSource.mode === 'uv-grid';
    const rev = this.textures.revision;
    const syncBoneEquipment = (key: HeroEquipCutoutKey, itemId: string): void => {
      const entry = this.equipCutouts[key];
      if (!showSocketEquip || !itemId) {
        entry.pivot.visible = false;
        return;
      }
      if (entry.lastItemId !== itemId || entry.lastRevision !== rev) {
        entry.lastItemId = itemId;
        entry.lastRevision = rev;
        const resolved = this.textures.getNormalizedEquipmentOverlay(itemId);
        if (resolved) {
          entry.calibration = resolved.calibration;
          entry.fit = resolved.fit;
          entry.material.map = resolved.texture;
          entry.material.roughness = resolved.calibration.pbr.roughness;
          entry.material.metalness = resolved.calibration.pbr.metalness;
          entry.material.emissiveMap =
            resolved.calibration.pbr.emissiveHex !== undefined ? resolved.texture : null;
          entry.material.needsUpdate = true;
        } else {
          entry.calibration = null;
          entry.fit = null;
          entry.material.map = null;
          entry.material.emissiveMap = null;
          entry.material.needsUpdate = true;
        }
      }
      if (!entry.material.map || !entry.calibration || !entry.fit) {
        entry.pivot.visible = false;
        return;
      }
      const cal = entry.calibration;
      const fit = entry.fit;
      const mirrorSign =
        entry.mirrorMode === 'left'
          ? (cal.leftMirrorSign ?? 1)
          : entry.mirrorMode === 'right'
            ? (cal.rightMirrorSign ?? 1)
            : 1;

      entry.pivot.visible = true;
      entry.pivot.position.set(cal.offsetX, cal.offsetY, cal.offsetZ);
      entry.pivot.rotation.z = cal.baseRotZ;
      entry.pivot.scale.set(mirrorSign, 1, 1);

      // Positionne le quad de façon à ce que le pivot mécanique (ex. poignée d'épée)
      // coïncide exactement avec l'origine (0, 0) du socket de l'os parent !
      entry.mesh.position.set(fit.meshOffsetX, fit.meshOffsetY, 0);
      entry.mesh.scale.set(fit.quadW, fit.quadH, 1);
    };

    syncBoneEquipment('armor', p.equipped.armor);
    syncBoneEquipment('helmet', p.equipped.helmet);
    syncBoneEquipment('shield', p.equipped.shield);
    syncBoneEquipment('weapon', p.equipped.weapon);

    // Masquage anatomique 3D (torse sous plastron + haut du crâne/oreilles sous heaume fermé)
    const mask = computeHeroEquipmentMaskState(
      {
        equipped: p.equipped,
        heroState,
        bonePose,
        showSocketEquip: showSocketEquip && (this.equipCutouts.armor.pivot.visible || this.equipCutouts.helmet.pivot.visible),
      },
      this.heroMaskScratch,
    );
    const torsoActive = mask.torsoMasked && this.equipCutouts.armor.pivot.visible;
    const headActive = mask.headMaskEnabled && this.equipCutouts.helmet.pivot.visible;
    this.heroMaskUniforms.uHeroTorsoMask.value.set(
      mask.torsoCenterU,
      mask.torsoCenterV,
      mask.torsoHalfW,
      mask.torsoHalfH,
    );
    this.heroMaskUniforms.uHeroHeadMask.value.set(
      mask.headCenterU,
      mask.headCenterV,
      mask.headHalfW,
      mask.headHalfH,
    );
    this.heroMaskUniforms.uHeroMaskMeta.value.set(
      torsoActive ? 1 : 0,
      headActive ? 1 : 0,
      mask.torsoRotZ,
      mask.headRotZ,
    );

    // Couche d'occlusion arrière du casque/chapeau (derrière la tête pour un port cohérent)
    const helmEntry = this.equipCutouts.helmet;
    const helmOcc = helmEntry.calibration?.helmetOcclusion;
    if (helmEntry.pivot.visible && helmEntry.material.map && helmEntry.calibration && helmEntry.fit && helmOcc) {
      this.helmetBackPivot.visible = true;
      this.helmetBackPivot.position.set(
        helmEntry.calibration.offsetX,
        helmEntry.calibration.offsetY + helmOcc.backOffsetY,
        -0.018,
      );
      this.helmetBackPivot.rotation.z = helmEntry.calibration.baseRotZ;
      if (this.helmetBackMat.map !== helmEntry.material.map) {
        this.helmetBackMat.map = helmEntry.material.map;
        this.helmetBackMat.needsUpdate = true;
      }
      this.helmetBackMat.color.setHex(helmOcc.backTintHex);
      this.helmetBackMat.opacity = helmOcc.backLayerAlpha;
      this.helmetBackMesh.position.set(helmEntry.fit.meshOffsetX, helmEntry.fit.meshOffsetY, 0);
      this.helmetBackMesh.scale.set(
        helmEntry.fit.quadW * helmOcc.backScaleX,
        helmEntry.fit.quadH * helmOcc.backScaleY,
        1,
      );
    } else {
      this.helmetBackPivot.visible = false;
    }

    // 3. Lanterne de CEINTURE permanente (JAMAIS en main) :
    // - Rangée et invisible dans les lieux lumineux
    // - Dans les lieux sombres (nuit, tempête, brouillard, donjon) : commence ÉTEINTE à la
    //   ceinture puis s'allume progressivement en ~2.0 secondes
    const sockets = sampleHeroFrameSockets(
      heroState,
      frameIdx,
      activeClipSource.frameCount,
      { blocking: isBlocking, facingSign: targetFlip },
    );
    stepHeroBeltLantern(
      this.beltLantern,
      {
        lanternBoost: weather?.lanternBoost ?? 0,
        inDungeon,
        isOnDeck,
        isDead,
        vx: isDead ? 0 : p.vx,
        vz: isDead ? 0 : p.vz,
        facingSign: targetFlip,
        windIntensity: weather?.windIntensity ?? 0.2,
      },
      dt,
    );

    const lanternLit = this.beltLantern.visible && this.beltLantern.lightLevel > 0.06;
    if (this.lanternTexLit !== lanternLit) {
      this.lanternTexLit = lanternLit;
      const nextLanternTex = this.textures.getHeroLanternTexture(lanternLit);
      this.playerLanternMat.map = nextLanternTex;
      this.playerLanternMat.emissiveMap = lanternLit ? nextLanternTex : null;
      this.playerLanternMat.needsUpdate = true;
    }

    // Met à jour la matrice monde de l'arbre d'os pour ancrer la lanterne STRICTEMENT sur la ceinture
    this.playerRoot.updateMatrixWorld(true);
    this.lanternBeltAnchor.getWorldPosition(this.scratchWorldPosA);
    this.heroRigRoot.worldToLocal(this.scratchWorldPosA);
    const deploySmooth =
      this.beltLantern.deploy * this.beltLantern.deploy * (3 - 2 * this.beltLantern.deploy);

    this.playerLanternMesh.visible = this.beltLantern.visible;
    this.playerLanternMesh.position.set(
      this.scratchWorldPosA.x,
      this.scratchWorldPosA.y - (1 - deploySmooth) * 0.028,
      this.scratchWorldPosA.z + 0.022,
    );
    this.playerLanternMesh.rotation.z = this.beltLantern.swingAngle * targetFlip;
    const lanternWorldScale = 0.42 * (0.28 + 0.72 * deploySmooth);
    this.playerLanternMesh.scale.set(
      lanternWorldScale / HERO_WIDTH,
      lanternWorldScale / HERO_HEIGHT,
      1,
    );
    // Vitre de lanterne émissive HDR synchronisée à la montée progressive 2.0 s
    this.playerLanternMat.emissiveIntensity = lanternLit
      ? 0.1 +
        this.beltLantern.effectiveIntensity * 0.92 +
        Math.sin(this.animTime * 9.5) * 0.06 * this.beltLantern.lightLevel
      : 0;

    // 4. Vraie PointLight de la lanterne de ceinture (slot 8 du shader PBR, strictement synchronisée)
    this.playerLanternMesh.updateMatrixWorld(true);
    this.playerLanternMesh.getWorldPosition(this.scratchWorldPosC);
    this.scratchWorldPosC.y = Math.max(0.82, this.scratchWorldPosC.y - 0.14);
    this.scratchWorldPosC.z += 0.36;
    this.playerLanternLight.position.copy(this.scratchWorldPosC);
    if (this.beltLantern.visible && this.beltLantern.effectiveIntensity > 0.015) {
      const flicker = 0.94 + Math.sin(this.animTime * 11.4) * 0.06;
      const baseLanternInt = inDungeon ? 6.8 : 5.9;
      this.playerLanternLight.visible = true;
      this.playerLanternLight.intensity =
        baseLanternInt * this.beltLantern.effectiveIntensity * flicker;
      this.playerLanternLight.distance = 8.4 + 3.2 * this.beltLantern.lightLevel;
      setSpriteLight(
        SPRITE_LIGHT_SLOT.HERO_LANTERN,
        this.playerLanternLight.position,
        this.playerLanternLight.color,
        this.playerLanternLight.intensity,
        this.playerLanternLight.distance,
      );
    } else {
      this.playerLanternLight.visible = false;
      this.playerLanternLight.intensity = 0;
      clearSpriteLight(SPRITE_LIGHT_SLOT.HERO_LANTERN);
    }

    // 5. Vraie PointLight de l'arme lumineuse (`staff_arcane`, `blade_dragon`, etc.) (slot 9)
    const weaponRealLight = this.equipCutouts.weapon.calibration?.pbr.realLight;
    if (!isDead && weaponRealLight && this.equipCutouts.weapon.pivot.visible) {
      this.equipCutouts.weapon.mesh.getWorldPosition(this.scratchWorldPosC);
      this.scratchWorldPosC.y += 0.18;
      this.scratchWorldPosC.z += 0.25;
      const wWave = 0.88 + Math.sin(this.animTime * 4.6) * 0.12;
      this.playerWeaponLight.visible = true;
      this.playerWeaponLight.color.setHex(weaponRealLight.colorHex);
      this.playerWeaponLight.intensity = weaponRealLight.intensity * wWave;
      this.playerWeaponLight.distance = weaponRealLight.distance;
      this.playerWeaponLight.position.copy(this.scratchWorldPosC);
      setSpriteLight(
        SPRITE_LIGHT_SLOT.HERO_WEAPON,
        this.playerWeaponLight.position,
        this.playerWeaponLight.color,
        this.playerWeaponLight.intensity,
        this.playerWeaponLight.distance,
      );
    } else {
      this.playerWeaponLight.visible = false;
      this.playerWeaponLight.intensity = 0;
      clearSpriteLight(SPRITE_LIGHT_SLOT.HERO_WEAPON);
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
    this.capeInputScratch.collarSocketOffsetX = sockets.cape.x * 0.35;
    this.capeInputScratch.collarSocketOffsetY = (sockets.cape.y - 0.52) * 0.55;
    this.capeCloth.update(dt, this.capeInputScratch);

    // Flash blanc HDR sur impact & clignotement i-frames post-coup (synchronisé sur les couches d'équipement)
    if (p.hitFlashTimer > 0) {
      this.playerMat.emissive.setHex(0xffffff);
      this.playerMat.emissiveIntensity = 1.25;
      this.playerMat.color.setHex(0xffffff);
    } else if (p.invulnTimer > 0 && p.dodgeTimer <= 0) {
      const pulse = Math.sin(this.animTime * 32) > 0 ? 0.42 : 0;
      this.playerMat.emissive.setHex(0xffe9b0);
      this.playerMat.emissiveIntensity = pulse;
      this.playerMat.color.setHex(0xffffff);
    } else if ((p.perfectDodgeBuffTimer ?? 0) > 0) {
      this.playerMat.emissive.setHex(0xffd859);
      this.playerMat.emissiveIntensity = 0.28 + Math.sin(this.animTime * 10) * 0.12;
      this.playerMat.color.setHex(0xffffff);
    } else if (hasStatus(p, 'burn')) {
      this.playerMat.emissive.setHex(0xff5e1a);
      this.playerMat.emissiveIntensity = 0.42 + Math.sin(this.animTime * 10) * 0.14;
      this.playerMat.color.setHex(0xffd0b0);
    } else if (hasStatus(p, 'chill')) {
      this.playerMat.emissive.setHex(0x2884c8);
      this.playerMat.emissiveIntensity = 0.45;
      this.playerMat.color.setHex(0x88dcff);
    } else if (hasStatus(p, 'poison')) {
      this.playerMat.emissive.setHex(0x46b830);
      this.playerMat.emissiveIntensity = 0.38;
      this.playerMat.color.setHex(0xc8ffb8);
    } else if (hasStatus(p, 'bleed')) {
      this.playerMat.emissive.setHex(0xc91e3a);
      this.playerMat.emissiveIntensity = 0.38 + Math.sin(this.animTime * 12) * 0.12;
      this.playerMat.color.setHex(0xffb8c2);
    } else if (hasStatus(p, 'stun')) {
      this.playerMat.emissive.setHex(0xffcf40);
      this.playerMat.emissiveIntensity = 0.44 + Math.sin(this.animTime * 18) * 0.16;
      this.playerMat.color.setHex(0xfff4c2);
    } else if (hasStatus(p, 'shock')) {
      this.playerMat.emissive.setHex(0xffe042);
      this.playerMat.emissiveIntensity = 0.46;
      this.playerMat.color.setHex(0xfff6b8);
    } else if (hasStatus(p, 'curse')) {
      this.playerMat.emissive.setHex(0x7e22ce);
      this.playerMat.emissiveIntensity = 0.46 + Math.sin(this.animTime * 8) * 0.14;
      this.playerMat.color.setHex(0xd8b4fe);
    } else {
      this.playerMat.emissive.setHex(0x000000);
      this.playerMat.emissiveIntensity = 0;
      this.playerMat.color.setHex(0xffffff);
    }
    const eqEmissiveHex = this.playerMat.emissive.getHex();
    const eqEmissiveInt = this.playerMat.emissiveIntensity;
    for (const eq of Object.values(this.equipCutouts)) {
      if (!eq.pivot.visible) continue;
      if (eqEmissiveInt > 0.01) {
        eq.material.emissive.setHex(eqEmissiveHex);
        eq.material.emissiveIntensity = eqEmissiveInt;
      } else {
        const pbr = eq.calibration?.pbr;
        if (pbr?.emissiveHex !== undefined && pbr.emissiveIntensity) {
          const pulse = 0.88 + Math.sin(this.animTime * 4.2) * 0.12;
          eq.material.emissive.setHex(pbr.emissiveHex);
          eq.material.emissiveIntensity = pbr.emissiveIntensity * pulse;
        } else {
          eq.material.emissive.setHex(0x000000);
          eq.material.emissiveIntensity = 0;
        }
      }
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
    weather?: CapeWeatherWind,
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

    // Réactions animées du compagnon (critique, esquive parfaite, victoire de boss)
    const reactTimer = comp.reactionTimer ?? 0;
    const reactDur = Math.max(0.01, comp.reactionDuration ?? 0.5);
    const reactProgress = reactTimer > 0 ? 1 - reactTimer / reactDur : 0;
    let reactBounceY = 0;
    let reactSpinZ = 0;
    let reactScale = 1;
    let reactEmissiveBoost = 0;
    if (reactTimer > 0 && comp.reactionKind) {
      if (comp.reactionKind === 'crit') {
        reactBounceY = Math.abs(Math.sin(reactProgress * Math.PI * 2)) * 0.42;
        reactScale = 1 + Math.sin(reactProgress * Math.PI) * 0.22;
        reactEmissiveBoost = 0.55 * (1 - reactProgress);
      } else if (comp.reactionKind === 'perfect_dodge') {
        reactBounceY = Math.sin(reactProgress * Math.PI) * 0.48;
        reactSpinZ = reactProgress * Math.PI * 2;
        reactScale = 1 + Math.sin(reactProgress * Math.PI) * 0.28;
        reactEmissiveBoost = 0.85 * Math.sin(reactProgress * Math.PI);
      } else if (comp.reactionKind === 'boss_victory') {
        reactBounceY = Math.abs(Math.sin(reactProgress * Math.PI * 3)) * 0.65;
        reactSpinZ = Math.sin(reactProgress * Math.PI * 4) * 0.28;
        reactScale = 1 + Math.sin(reactProgress * Math.PI) * 0.34;
        reactEmissiveBoost = 1.05 * (0.5 + 0.5 * Math.sin(reactProgress * Math.PI * 3));
      }
    }

    let bobY = 1.45 + Math.sin(this.animTime * 4.0 + comp.bobPhase) * 0.24 + reactBounceY;

    if (isOnDeck && shipDeck) {
      this.companionRoot.position.set(
        shipDeck.companionWorldPos.x,
        shipDeck.companionWorldPos.y,
        shipDeck.companionWorldPos.z,
      );
      bobY = 0.42 + Math.sin(this.animTime * 3.6 + comp.bobPhase) * 0.14 + reactBounceY;
      this.companionMesh.position.y = bobY;
      this.companionShadow.visible = true;
      this.companionShadow.position.y = -0.11;
      this.companionShadow.scale.set(0.32, 1, 0.22);
    } else if (isShipJumping) {
      const compY = comp.y ?? 0;
      this.companionRoot.position.set(comp.x, compY, comp.z);
      bobY = 0.72 + Math.sin(this.animTime * 4.2 + comp.bobPhase) * 0.12 + reactBounceY;
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
      const jumpDist = Math.hypot(curX - this.prevCompX, curZ - this.prevCompZ);
      if (jumpDist > 5.5) {
        this.companionTeleportTimer = 0.36;
      }
      compSpeed = jumpDist / dt;
    }
    this.prevCompX = curX;
    this.prevCompZ = curZ;
    this.hasPrevCompPos = true;
    if (this.companionTeleportTimer > 0) {
      this.companionTeleportTimer = Math.max(0, this.companionTeleportTimer - dt);
    }

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

    // Pulsation astrale HDR (> 1.2) + sursaut de téléportation / prise de parole / réactions
    const tpRatio = this.companionTeleportTimer > 0 ? this.companionTeleportTimer / 0.36 : 0;
    const talkBoost = isCompanionSpeaking ? 0.24 + Math.abs(Math.sin(this.animTime * 11.5)) * 0.2 : 0;
    const isGuiding = comp.guideKind === 'chest' || comp.guideKind === 'quest';
    const guideBoost = isGuiding ? 0.18 + Math.sin(this.animTime * 5.2) * 0.12 : 0;
    this.companionMat.emissiveIntensity =
      1.36 +
      Math.sin(this.animTime * 3.4 + comp.bobPhase) * 0.16 +
      talkBoost +
      guideBoost +
      reactEmissiveBoost +
      tpRatio * 1.15;

    const targetFlip = p.facingX < 0 ? -1 : 1;
    this.companionFlipX = approachFlip(this.companionFlipX, targetFlip, dt * 10);
    this.companionMesh.rotation.y = 0;
    this.companionMesh.rotation.z = reactSpinZ;
    const talkScaleY = isCompanionSpeaking ? 1 + Math.sin(this.animTime * 12) * 0.055 : 1;
    const tpPop = tpRatio > 0 ? 1 + Math.sin((1 - tpRatio) * Math.PI) * 0.32 : 1;
    this.companionMesh.scale.set(
      1.3 * this.companionFlipX * tpPop * reactScale,
      1.3 * talkScaleY * tpPop * reactScale,
      1,
    );

    // Lumière chaude dynamique dans les donjons et la nuit + halo lumineux discret (slot 10)
    const inDungeon = state.zoneId !== 'overworld';
    const nightDarkness = Math.max(
      weather?.nightFactor ?? 0,
      (weather?.lanternBoost ?? 0) * 0.85,
    );
    const warmthBlend = inDungeon ? 1.0 : Math.max(0, Math.min(1, nightDarkness));
    // Cyan astral (#78e8ff) -> Ambre doré chaud (#ffc878)
    this.companionLight.color.setRGB(
      0.47 + (1.0 - 0.47) * warmthBlend,
      0.91 + (0.78 - 0.91) * warmthBlend,
      1.0 + (0.47 - 1.0) * warmthBlend,
    );
    this.companionLight.distance = 7.0 + warmthBlend * 3.5;

    const compLightPulse =
      0.9 +
      Math.sin(this.animTime * 3.4 + comp.bobPhase) * 0.12 +
      tpRatio * 0.8 +
      reactEmissiveBoost * 0.45;
    this.companionLight.position.set(
      this.companionRoot.position.x,
      this.companionRoot.position.y + bobY + 0.35,
      this.companionRoot.position.z + 0.18,
    );
    this.companionLight.intensity = (2.0 + warmthBlend * 1.4) * compLightPulse;
    this.companionLight.visible = true;

    // Halo lumineux autour de Miaou-sprit (renforcé en guidage, donjon/nuit et réaction)
    this.companionHaloMesh.position.set(0, bobY + 0.48, -0.05);
    const haloScale =
      (1.85 + warmthBlend * 0.55 + (isGuiding ? 0.35 : 0) + reactEmissiveBoost * 0.45) *
      (1 + Math.sin(this.animTime * 4.2) * 0.08);
    this.companionHaloMesh.scale.set(haloScale, haloScale, 1);
    this.companionHaloMat.color.copy(this.companionLight.color);
    if (comp.guideKind === 'chest' && warmthBlend < 0.5) {
      this.companionHaloMat.color.lerp(this.companionLight.color.setHex(0xffdf7a), 0.35);
      // Restore companionLight color after temporary lerp
      this.companionLight.color.setRGB(
        0.47 + (1.0 - 0.47) * warmthBlend,
        0.91 + (0.78 - 0.91) * warmthBlend,
        1.0 + (0.47 - 1.0) * warmthBlend,
      );
    }
    this.companionHaloMat.opacity = Math.min(
      0.56,
      0.16 + warmthBlend * 0.18 + (isGuiding ? 0.12 : 0) + reactEmissiveBoost * 0.15,
    );

    setSpriteLight(
      SPRITE_LIGHT_SLOT.COMPANION,
      this.companionLight.position,
      this.companionLight.color,
      this.companionLight.intensity,
      this.companionLight.distance,
    );
  }

  private updateEnemies(state: GameState, dt: number): void {
    const seenIds = this.seenEnemyIds;
    seenIds.clear();
    const texRev = this.textures.revision;
    let bestEnemyLightDistSq = Number.POSITIVE_INFINITY;
    let bestEnemyLightX = 0;
    let bestEnemyLightY = 1.4;
    let bestEnemyLightZ = 0;
    let bestEnemyLightHex = 0xff4822;
    let bestEnemyLightInt = 0;
    let bestEnemyLightRange = 10;

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
        if (vis.phase === 1 && enemy.phase === 2 && enemy.typeId === 'boss_dragon_claw') {
          vis.phase2TransitionTimer = 0.95;
        }
        vis.phase = enemy.phase;
        vis.registryRevision = texRev;
        vis.clips = this.buildEnemyClipTable(enemy.typeId, enemy.phase);
      }
      if (vis.phase2TransitionTimer > 0) {
        vis.phase2TransitionTimer = Math.max(0, vis.phase2TransitionTimer - dt);
      }

      const isDead = enemy.state === 'dead' || enemy.hp <= 0;
      const cin = state.cinematic;
      const isBossInDeathCin =
        isDead && cin && cin.kind === 'boss_death' && cin.bossId === enemy.id;
      const isBossInIntroCin =
        !isDead && cin && cin.kind === 'boss_intro' && cin.bossId === enemy.id;

      // Mise en scène spécifique Boss Cinématiques (Trône/Souris/Fromage Roi Rat & Descente/Craquelures Drak-Miaou)
      if (enemy.typeId === 'boss_rat_king' && (isBossInIntroCin || isBossInDeathCin)) {
        if (!vis.cinematicPropGroup) {
          const propGroup = new THREE.Group();
          const disposables: Array<{ dispose(): void }> = [];
          const mice: THREE.Mesh[] = [];
          const cheese: THREE.Mesh[] = [];

          const throneGeo = new THREE.BoxGeometry(2.1, 0.32, 1.5);
          const throneMat = new THREE.MeshStandardMaterial({ color: 0x5c3a8c, roughness: 0.65 });
          const throne = new THREE.Mesh(throneGeo, throneMat);
          throne.position.y = 0.42;
          propGroup.add(throne);
          disposables.push(throneGeo, throneMat);

          const mouseGeo = new THREE.SphereGeometry(0.24, 10, 8);
          const mouseMat = new THREE.MeshStandardMaterial({ color: 0x383246, roughness: 0.8 });
          disposables.push(mouseGeo, mouseMat);
          for (let m = 0; m < 4; m++) {
            const mesh = new THREE.Mesh(mouseGeo, mouseMat);
            const side = m < 2 ? -0.95 : 0.95;
            const front = m % 2 === 0 ? 0.65 : -0.65;
            mesh.position.set(side, 0.24, front);
            propGroup.add(mesh);
            mice.push(mesh);
          }

          const cheeseGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.22, 12);
          const cheeseMat = new THREE.MeshStandardMaterial({ color: 0xf5c542, roughness: 0.45, emissive: 0x7a5210, emissiveIntensity: 0.25 });
          disposables.push(cheeseGeo, cheeseMat);
          for (let c = 0; c < 3; c++) {
            const cMesh = new THREE.Mesh(cheeseGeo, cheeseMat);
            cMesh.position.set((c - 1) * 1.15, 0.2, 1.1);
            propGroup.add(cMesh);
            cheese.push(cMesh);
          }

          vis.root.add(propGroup);
          vis.cinematicPropGroup = propGroup;
          vis.cinematicPropDisposables = disposables;
          vis.cinematicMice = mice;
          vis.cinematicCheese = cheese;
        }
        vis.cinematicPropGroup.visible = true;
        const cProg = cin ? Math.min(1, cin.elapsed / Math.max(0.1, cin.duration)) : 0;
        if (vis.cinematicMice && vis.cinematicCheese) {
          for (let m = 0; m < vis.cinematicMice.length; m++) {
            const side = m < 2 ? -0.95 : 0.95;
            const front = m % 2 === 0 ? 0.65 : -0.65;
            if (isBossInDeathCin) {
              const flee = cProg * 4.5;
              vis.cinematicMice[m].position.set(side * (1 + flee), 0.24, front * (1 + flee));
            } else {
              vis.cinematicMice[m].position.set(side, 0.24 + Math.abs(Math.sin(this.animTime * 10 + m)) * 0.1, front);
            }
          }
          for (let c = 0; c < vis.cinematicCheese.length; c++) {
            if (isBossInDeathCin) {
              const scatter = cProg * 3.8;
              vis.cinematicCheese[c].position.set((c - 1) * (1.15 + scatter), 0.2 + Math.abs(Math.sin(cProg * Math.PI * 2 + c)) * 0.4, 1.1 + scatter * 0.6);
              vis.cinematicCheese[c].rotation.y += dt * 6;
            } else {
              vis.cinematicCheese[c].position.set((c - 1) * 1.15, 0.2, 1.1);
            }
          }
        }
      } else if (vis.cinematicPropGroup) {
        vis.cinematicPropGroup.visible = false;
      }

      if (isDead) {
        if (isBossInDeathCin && cin) {
          const cProg = Math.min(1, cin.elapsed / Math.max(0.1, cin.duration));
          vis.root.visible = true;
          vis.root.position.set(enemy.x, 0, enemy.z);
          vis.hpGroup.visible = false;
          if (enemy.typeId === 'boss_dragon_claw') {
            const crackPulse = 0.65 + Math.abs(Math.sin(this.animTime * 16)) * 1.15;
            vis.material.emissiveMap = vis.material.map;
            vis.material.emissive.setHex(cin.stage === 'cracks' || cin.stage === 'double_shockwave' ? 0xff5a1f : 0xffcc66);
            vis.material.emissiveIntensity = crackPulse * (1 - cProg * 0.45);
            vis.material.transparent = true;
            vis.material.opacity = cProg > 0.68 ? Math.max(0, 1 - (cProg - 0.68) / 0.32) : 1;
            vis.tiltGroup.position.y = Math.sin(cProg * Math.PI) * 0.3;
          } else {
            vis.material.transparent = true;
            vis.material.opacity = Math.max(0, 1 - cProg * 0.85);
            vis.spriteMesh.rotation.z = cProg * 0.35 * (vis.flipScaleX >= 0 ? -1 : 1);
          }
          continue;
        }

        const deathClip = vis.clips.death;
        if (deathClip.isDedicatedAsset && deathClip.frameCount > 1) {
          vis.activeState = 'death';
          const deathFrame = advanceSpriteAnimCursor(
            vis.animCursor,
            deathClip.clip,
            deathClip.frameCount,
            dt,
          );
          if (vis.animCursor.finished && (enemy.deathTimer ?? 0) <= 0) {
            vis.root.visible = false;
            continue;
          }
          vis.root.visible = true;
          vis.root.position.set(enemy.x, 0, enemy.z);
          vis.hpGroup.visible = false;
          if ((enemy.deathTimer ?? 0) > 0 && (enemy.deathDuration ?? 0) > 0) {
            const dProg = 1 - (enemy.deathTimer ?? 0) / Math.max(0.05, enemy.deathDuration ?? 0.35);
            vis.material.transparent = true;
            vis.material.opacity = Math.max(0, 1 - dProg * 0.85);
            vis.spriteMesh.rotation.z = dProg * 0.45 * (vis.flipScaleX >= 0 ? -1 : 1);
          }
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

        if ((enemy.deathTimer ?? 0) > 0 && (enemy.deathDuration ?? 0) > 0) {
          const dProg = 1 - (enemy.deathTimer ?? 0) / Math.max(0.05, enemy.deathDuration ?? 0.35);
          vis.root.visible = true;
          vis.root.position.set(enemy.x, 0, enemy.z);
          vis.hpGroup.visible = false;
          vis.material.transparent = true;
          vis.material.opacity = Math.max(0, 1 - dProg);
          vis.spriteMesh.rotation.z = dProg * 0.55 * (vis.flipScaleX >= 0 ? -1 : 1);
          vis.tiltGroup.position.y = Math.sin(dProg * Math.PI) * 0.45;
          continue;
        }

        vis.root.visible = false;
        vis.material.emissiveIntensity = 0;
        vis.tiltGroup.position.y = 0;
        continue;
      }

      if (vis.material.opacity !== 1) {
        vis.material.opacity = 1;
        vis.material.transparent = false;
      }
      vis.spriteMesh.rotation.z = 0;
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
      if (enemy.state === 'staggered' || (enemy.staggeredTimer ?? 0) > 0) {
        enemyState = 'hurt';
      } else if (enemy.state === 'windup') {
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

      const isStaggered = enemy.state === 'staggered' || (enemy.staggeredTimer ?? 0) > 0;
      const isChilled = enemy.slowTimer > 0 || hasStatus(enemy, 'chill');

      if (isStaggered) {
        const wobble = Math.sin(this.animTime * 16) * 0.06;
        sx = vis.baseScale * (1.1 + wobble);
        sy = vis.baseScale * (0.84 - wobble * 0.5);
      } else if (enemy.state === 'windup') {
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

      if (vis.phase2TransitionTimer > 0) {
        const tr = vis.phase2TransitionTimer / 0.95;
        const roarSwell = 1 + Math.sin(tr * Math.PI) * 0.16;
        sx *= roarSwell;
        sy *= roarSwell * (1 + Math.sin(this.animTime * 24) * 0.04);
      }

      if (isBossInIntroCin && cin) {
        if (enemy.typeId === 'boss_dragon_claw') {
          const cProg = Math.min(1, cin.elapsed / Math.max(0.1, cin.duration));
          const desc = cProg < 0.55 ? 1 - cProg / 0.55 : 0;
          hopY = desc * desc * 10.5;
          vis.shadowMesh.scale.set(
            enemy.radius * (1.05 - desc * 0.55),
            1,
            enemy.radius * (0.72 - desc * 0.35),
          );
        } else if (enemy.typeId === 'boss_rat_king') {
          hopY = 0.52 + Math.sin(this.animTime * 8) * 0.06;
        }
      } else {
        vis.shadowMesh.scale.set(enemy.radius * 1.05, 1, enemy.radius * 0.72);
      }

      vis.spriteMesh.scale.set(sx * vis.flipScaleX, sy, 1);
      if (vis.fringeMesh) {
        vis.fringeMesh.scale.set(sx * vis.flipScaleX, sy, 1);
      }
      vis.tiltGroup.position.y = hopY;

      // Couleur / Emissive HDR : Flash blanc > Stagger > Givre > Statuts > Boss Phase 2 > Lueur magique naturelle
      if (enemy.hitFlashTimer > 0) {
        if (vis.material.emissiveMap !== null) {
          vis.material.emissiveMap = null;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xffffff);
        vis.material.emissive.setHex(0xffffff);
        vis.material.emissiveIntensity = 1.25;
      } else if (isStaggered) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xffe8b0);
        vis.material.emissive.setHex(0xffaa2b);
        vis.material.emissiveIntensity = 0.68 + Math.sin(this.animTime * 14) * 0.24;
      } else if (isChilled) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0x88dcff);
        vis.material.emissive.setHex(0x2884c8);
        vis.material.emissiveIntensity = 0.52;
      } else if (hasStatus(enemy, 'burn')) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xffd0b0);
        vis.material.emissive.setHex(0xff5e1a);
        vis.material.emissiveIntensity = 0.45 + Math.sin(this.animTime * 10) * 0.14;
      } else if (hasStatus(enemy, 'poison')) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xc8ffb8);
        vis.material.emissive.setHex(0x46b830);
        vis.material.emissiveIntensity = 0.4;
      } else if (hasStatus(enemy, 'shock')) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xfff6b8);
        vis.material.emissive.setHex(0xffe042);
        vis.material.emissiveIntensity = 0.48;
      } else if (hasStatus(enemy, 'bleed')) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xffb8c2);
        vis.material.emissive.setHex(0xc91e3a);
        vis.material.emissiveIntensity = 0.42 + Math.sin(this.animTime * 12) * 0.14;
      } else if (hasStatus(enemy, 'stun')) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xfff4c2);
        vis.material.emissive.setHex(0xffcf40);
        vis.material.emissiveIntensity = 0.46 + Math.sin(this.animTime * 18) * 0.16;
      } else if (hasStatus(enemy, 'curse')) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        vis.material.color.setHex(0xd8b4fe);
        vis.material.emissive.setHex(0x7e22ce);
        vis.material.emissiveIntensity = 0.48 + Math.sin(this.animTime * 8) * 0.14;
      } else if (enemy.isBoss && enemy.phase === 2) {
        if (vis.material.emissiveMap !== vis.material.map) {
          vis.material.emissiveMap = vis.material.map;
          vis.material.needsUpdate = true;
        }
        const surge = vis.phase2TransitionTimer > 0 ? 0.65 * (vis.phase2TransitionTimer / 0.95) : 0;
        const rage = 0.85 + Math.sin(this.animTime * 9) * 0.28 + surge;
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

      // Enregistre l'ennemi/boss lumineux le plus proche pour la vraie PointLight dynamique (slot 11)
      if (baseGlow || (enemy.isBoss && enemy.phase === 2)) {
        const dSq =
          (enemy.x - state.player.x) * (enemy.x - state.player.x) +
          (enemy.z - state.player.z) * (enemy.z - state.player.z);
        const isPhase2Boss = enemy.isBoss && enemy.phase === 2;
        const effectiveDistSq = isPhase2Boss ? dSq * 0.25 : dSq;
        if (effectiveDistSq < bestEnemyLightDistSq && dSq < 26 * 26) {
          bestEnemyLightDistSq = effectiveDistSq;
          bestEnemyLightX = enemy.x;
          bestEnemyLightY = Math.max(1.2, vis.baseScale * 0.52);
          bestEnemyLightZ = enemy.z + 0.35;
          if (isPhase2Boss) {
            bestEnemyLightHex = 0xff441e;
            bestEnemyLightInt = 11.5 + Math.sin(this.animTime * 8.0) * 2.2;
            bestEnemyLightRange = 14.5;
          } else if (baseGlow) {
            bestEnemyLightHex = baseGlow.hex;
            bestEnemyLightInt = (enemy.isBoss ? 8.5 : 5.2) * (0.9 + Math.sin(this.animTime * 3.5 + vis.animSeed) * 0.12);
            bestEnemyLightRange = enemy.isBoss ? 12.0 : 8.5;
          }
        }
      }

      // Anneau de givre au sol si ralenti
      vis.frostRing.visible = isChilled;
      if (isChilled) {
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

    if (bestEnemyLightInt > 0.05) {
      this.enemyDynamicLight.visible = true;
      this.enemyDynamicLight.position.set(bestEnemyLightX, bestEnemyLightY, bestEnemyLightZ);
      this.enemyDynamicLight.color.setHex(bestEnemyLightHex);
      this.enemyDynamicLight.intensity = bestEnemyLightInt;
      this.enemyDynamicLight.distance = bestEnemyLightRange;
      setSpriteLight(
        SPRITE_LIGHT_SLOT.ENEMY_OR_SPELL,
        this.enemyDynamicLight.position,
        this.enemyDynamicLight.color,
        this.enemyDynamicLight.intensity,
        this.enemyDynamicLight.distance,
      );
    } else {
      this.enemyDynamicLight.visible = false;
      this.enemyDynamicLight.intensity = 0;
      clearSpriteLight(SPRITE_LIGHT_SLOT.ENEMY_OR_SPELL);
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
    stepFixed30FpsClock(this.animClock30Fps, safeDt);

    this.updatePlayer(state, safeDt, shipDeck, weather);
    this.updateCompanion(state, safeDt, shipDeck, weather);
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
    lanternSocket: 'belt' | 'hand';
    lanternHandBlend: number;
    lanternSwingAngle: number;
    lanternVisible: boolean;
    lanternLightLevel: number;
    flipOvershootRad: number;
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
      lanternSocket: this.beltLantern.socket,
      lanternHandBlend: 0,
      lanternSwingAngle: Math.round(this.beltLantern.swingAngle * 1000) / 1000,
      lanternVisible: this.playerLanternMesh.visible,
      lanternLightLevel: Math.round(this.beltLantern.lightLevel * 1000) / 1000,
      flipOvershootRad: Math.round(this.playerFlipOvershoot.overshootRad * 1000) / 1000,
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
    clearSpriteLight(SPRITE_LIGHT_SLOT.HERO_LANTERN);
    clearSpriteLight(SPRITE_LIGHT_SLOT.HERO_WEAPON);
    clearSpriteLight(SPRITE_LIGHT_SLOT.COMPANION);
    clearSpriteLight(SPRITE_LIGHT_SLOT.ENEMY_OR_SPELL);
    disposeUvTextureBinding(this.heroUvBinding);
    disposeUvTextureBinding(this.companionUvBinding);
    this.scene.remove(this.rootGroup);
    this.spriteGeo.dispose();
    this.lanternGeo.dispose();
    this.glowGeo.dispose();
    this.shadowGeo.dispose();
    this.hpBgGeo.dispose();
    this.hpFillGeo.dispose();
    this.auraRingGeo.dispose();
    this.playerMat.dispose();
    for (const eq of Object.values(this.equipCutouts)) {
      eq.material.dispose();
    }
    this.helmetBackMat.dispose();
    this.heroDeathSpiritMat.dispose();
    this.playerLanternMat.dispose();
    this.capeCloth.dispose();
    this.playerShadowMat.dispose();
    this.playerRegenMat.dispose();
    this.playerShieldMat.dispose();
    this.companionMat.dispose();
    this.companionHaloMat.dispose();
    this.companionShadowMat.dispose();
  }
}
