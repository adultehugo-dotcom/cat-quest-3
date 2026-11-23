import * as THREE from 'three';
import type { EnemyInstance, EnemyTypeId, GameState } from '../game/types';
import { ENEMIES } from '../data/enemiesData';
import { getEquipmentDefinition } from '../data/equipmentData';
import { TextureRegistry } from '../art/textureRegistry';
import type { HeroAnimFrame } from '../art/spriteHero';

const SPRITE_TILT_X = -0.48;
const HERO_WIDTH = 2.35;
const HERO_HEIGHT = 2.45;
const HP_BAR_WIDTH = 1.45;
const HP_BAR_HEIGHT = 0.16;

interface EnemyVisual {
  id: string;
  typeId: EnemyTypeId;
  phase: 1 | 2;
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

  // Joueur (PBR éclairé dynamiquement + ombre portée silhouette exacte)
  private readonly playerRoot = new THREE.Group();
  private readonly playerTiltGroup = new THREE.Group();
  private readonly playerMesh: THREE.Mesh;
  private readonly playerMat: THREE.MeshStandardMaterial;
  private readonly playerAuraMesh: THREE.Mesh;
  private readonly playerAuraMat: THREE.MeshBasicMaterial;
  private readonly playerShadow: THREE.Mesh;
  private readonly playerShadowMat: THREE.MeshBasicMaterial;
  private readonly playerRegenRing: THREE.Mesh;
  private readonly playerRegenMat: THREE.MeshBasicMaterial;
  private playerFlipX = 1;
  private walkClock = 0;
  private lastHeroTexKey = '';

  // Compagnon Miaou-sprit (émissif HDR pour UnrealBloomPass sélectif !)
  private readonly companionRoot = new THREE.Group();
  private readonly companionMesh: THREE.Mesh;
  private readonly companionMat: THREE.MeshStandardMaterial;
  private readonly companionShadow: THREE.Mesh;
  private readonly companionShadowMat: THREE.MeshBasicMaterial;
  private companionFlipX = 1;

  // Ennemis dynamiques par ID
  private readonly enemies = new Map<string, EnemyVisual>();
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
    this.playerMesh = new THREE.Mesh(this.spriteGeo, this.playerMat);
    this.playerMesh.scale.set(HERO_WIDTH, HERO_HEIGHT, 1);
    this.playerMesh.castShadow = true;
    this.playerMesh.receiveShadow = false;
    this.playerMesh.userData.skipSSAO = true;
    this.playerMesh.userData.isSprite25D = true;
    this.playerTiltGroup.add(this.playerMesh);

    this.playerAuraMat = new THREE.MeshBasicMaterial({
      map: this.textures.getParticleTexture(),
      color: new THREE.Color(0xffae38),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.playerAuraMesh = new THREE.Mesh(this.glowGeo, this.playerAuraMat);
    this.playerAuraMesh.position.set(0, HERO_HEIGHT * 0.52, -0.04);
    this.playerAuraMesh.scale.set(HERO_WIDTH * 1.38, HERO_HEIGHT * 1.28, 1);
    this.playerAuraMesh.renderOrder = 2;
    this.playerAuraMesh.castShadow = false;
    this.playerAuraMesh.receiveShadow = false;
    this.playerAuraMesh.visible = false;
    this.playerAuraMesh.userData.skipSSAO = true;
    this.playerTiltGroup.add(this.playerAuraMesh);

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

  private createEnemyVisual(enemy: EnemyInstance): EnemyVisual {
    const def = ENEMIES[enemy.typeId];
    const baseScale = def.spriteScale;

    const root = new THREE.Group();
    const tiltGroup = new THREE.Group();
    tiltGroup.rotation.x = SPRITE_TILT_X;
    root.add(tiltGroup);

    const enemyTex = this.textures.getEnemyTexture(enemy.typeId, enemy.phase);
    const baseGlow = getEnemyBaseGlow(enemy.typeId);
    const material = new THREE.MeshStandardMaterial({
      map: enemyTex,
      emissiveMap: baseGlow ? enemyTex : null,
      roughness: 0.74,
      metalness: 0.08,
      transparent: false,
      alphaTest: 0.5,
      depthWrite: true,
      side: THREE.DoubleSide,
      emissive: new THREE.Color(baseGlow ? baseGlow.hex : 0x000000),
      emissiveIntensity: baseGlow ? baseGlow.intensity : 0,
    });
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
        map: enemyTex,
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
      animSeed: enemy.homeX * 0.31 + enemy.homeZ * 0.47,
    };
  }

  private disposeEnemyVisual(vis: EnemyVisual): void {
    this.rootGroup.remove(vis.root);
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
    this.lastHeroTexKey = '';

    const compTex = this.textures.getCompanionTexture();
    this.companionMat.map = compTex;
    this.companionMat.emissiveMap = compTex;
    this.companionMat.needsUpdate = true;

    for (const vis of this.enemies.values()) {
      const nextTex = this.textures.getEnemyTexture(vis.typeId, vis.phase);
      vis.material.map = nextTex;
      if (getEnemyBaseGlow(vis.typeId)) {
        vis.material.emissiveMap = nextTex;
      }
      vis.material.needsUpdate = true;
      if (vis.fringeMat) {
        vis.fringeMat.map = nextTex;
        vis.fringeMat.needsUpdate = true;
      }
    }

    if (state) {
      this.updatePlayer(state, 0);
    }
  }

  private updatePlayer(state: GameState, dt: number): void {
    const p = state.player;
    this.playerRoot.visible = true;

    const speed = Math.hypot(p.vx, p.vz);
    const isMoving = speed > 0.35;
    if (isMoving) {
      this.walkClock += dt * 9.5;
    }

    // Sélection de la frame d'animation du chat chevalier
    let frame: HeroAnimFrame = 'idle';
    if (p.dodgeTimer > 0) {
      frame = 'roll';
    } else if (p.attackAnimTimer > 0) {
      frame = 'attack';
    } else if (isMoving) {
      frame = Math.floor(this.walkClock) % 2 === 0 ? 'walk1' : 'walk2';
    }

    const hdTag = this.textures.isHdLoaded ? 'hd' : 'proc';
    const texKey = `${hdTag}_${p.equipped.weapon}_${p.equipped.secondary_weapon}_${p.equipped.shield}_${p.equipped.helmet}_${p.equipped.armor}_${p.equipped.trinket}_${frame}`;
    if (texKey !== this.lastHeroTexKey) {
      this.lastHeroTexKey = texKey;
      this.playerMat.map = this.textures.getHeroTexture(p.equipped, frame);
      this.playerMat.needsUpdate = true;
    }

    // Position ancrée au sol
    this.playerRoot.position.set(p.x, 0, p.z);

    // Flip horizontal fluide sans jamais passer de profil (scale.x signé, DoubleSide)
    const targetFlip = p.facingX < 0 ? -1 : 1;
    this.playerFlipX = approachFlip(this.playerFlipX, targetFlip, dt * 16);
    this.playerMesh.rotation.y = 0;

    // Squash & stretch expressif selon l'action
    let sx = HERO_WIDTH;
    let sy = HERO_HEIGHT;
    let bounceY = 0;

    if (frame === 'roll') {
      const sq = 1 + Math.sin(this.animTime * 28) * 0.1;
      sx = HERO_WIDTH * 0.96 * sq;
      sy = (HERO_HEIGHT * 0.88) / sq;
      bounceY = 0.22;
    } else if (frame === 'attack') {
      sx = HERO_WIDTH * 1.1;
      sy = HERO_HEIGHT * 0.94;
      bounceY = 0.06;
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

    // Halo additif doux si équipement épique / magique équipé (hors roulade)
    const auraColorHex =
      getEquipmentDefinition(p.equipped.weapon)?.visualStyle.glowColor ??
      getEquipmentDefinition(p.equipped.helmet)?.visualStyle.glowColor ??
      getEquipmentDefinition(p.equipped.armor)?.visualStyle.glowColor;
    if (auraColorHex && frame !== 'roll') {
      this.playerAuraMesh.visible = true;
      this.playerAuraMat.color.set(auraColorHex);
      this.playerAuraMat.opacity = 0.36 + Math.sin(this.animTime * 3.8) * 0.08;
    } else {
      this.playerAuraMesh.visible = false;
    }

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
  }

  private updateCompanion(state: GameState, dt: number): void {
    this.companionRoot.visible = true;

    const p = state.player;
    const comp = state.companion;

    const distToPlayer = Math.hypot(comp.x - p.x, comp.z - p.z);
    const cx = distToPlayer < 16 ? comp.x : p.x - p.facingX * 1.4;
    const cz = distToPlayer < 16 ? comp.z : p.z - 0.8;
    const bobY = 1.45 + Math.sin(this.animTime * 4.0 + comp.bobPhase) * 0.24;

    this.companionRoot.position.set(cx, 0, cz);
    this.companionMesh.position.y = bobY;

    // Pulsation astrale HDR (> 1.2) pour un Bloom doux autour de Miaou-sprit !
    this.companionMat.emissiveIntensity =
      1.36 + Math.sin(this.animTime * 3.4 + comp.bobPhase) * 0.16;

    const targetFlip = p.facingX < 0 ? -1 : 1;
    this.companionFlipX = approachFlip(this.companionFlipX, targetFlip, dt * 10);
    this.companionMesh.rotation.y = 0;
    this.companionMesh.scale.set(1.3 * this.companionFlipX, 1.3, 1);

    const shadowScale = 0.42 - (bobY - 1.2) * 0.1;
    this.companionShadow.scale.set(
      Math.max(0.24, shadowScale),
      1,
      Math.max(0.18, shadowScale * 0.65),
    );
  }

  private updateEnemies(state: GameState, dt: number): void {
    const seenIds = new Set<string>();

    for (const enemy of state.enemies) {
      seenIds.add(enemy.id);
      let vis = this.enemies.get(enemy.id);
      if (!vis) {
        vis = this.createEnemyVisual(enemy);
        this.enemies.set(enemy.id, vis);
      }

      if (enemy.state === 'dead' || enemy.hp <= 0) {
        vis.root.visible = false;
        continue;
      }
      vis.root.visible = true;

      // Passage Phase 2 du Boss Dragon -> bascule vers la variante enflammée !
      if (vis.phase !== enemy.phase) {
        vis.phase = enemy.phase;
        const phaseTex = this.textures.getEnemyTexture(enemy.typeId, enemy.phase);
        vis.material.map = phaseTex;
        if (getEnemyBaseGlow(enemy.typeId)) {
          vis.material.emissiveMap = phaseTex;
        }
        vis.material.needsUpdate = true;
        if (vis.fringeMat) {
          vis.fringeMat.map = phaseTex;
          vis.fringeMat.needsUpdate = true;
        }
      }

      vis.root.position.set(enemy.x, 0, enemy.z);

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
      const baseGlow = getEnemyBaseGlow(enemy.typeId);
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

  public update(state: GameState, dt: number): void {
    const safeDt = Math.min(Math.max(dt, 0), 0.05);
    this.animTime += safeDt;

    this.updatePlayer(state, safeDt);
    this.updateCompanion(state, safeDt);
    this.updateEnemies(state, safeDt);
  }

  public clear(): void {
    for (const vis of this.enemies.values()) {
      this.disposeEnemyVisual(vis);
    }
    this.enemies.clear();
  }

  public dispose(): void {
    this.clear();
    this.scene.remove(this.rootGroup);
    this.spriteGeo.dispose();
    this.glowGeo.dispose();
    this.shadowGeo.dispose();
    this.hpBgGeo.dispose();
    this.hpFillGeo.dispose();
    this.auraRingGeo.dispose();
    this.playerMat.dispose();
    this.playerAuraMat.dispose();
    this.playerShadowMat.dispose();
    this.playerRegenMat.dispose();
    this.companionMat.dispose();
    this.companionShadowMat.dispose();
  }
}
