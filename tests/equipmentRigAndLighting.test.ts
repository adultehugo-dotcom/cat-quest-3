import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  EQUIPMENT_CALIBRATION_REGISTRY,
  EQUIPMENT_NORMALIZED_FILL,
  HERO_BONE_ORDER,
  HERO_SKELETON_SPEC,
  type HeroBoneId,
  computeNormalizedEquipmentFit,
  computePivotMeshOffset,
  createHeroSkeletonPose,
  getBoneRestWorldPosition,
  getEquipmentCalibration,
  solveHeroBoneTransformsInto,
} from '../src/art/equipmentRig';
import type { HeroAnimState } from '../src/art/hdAssets';
import { EQUIPMENT_LIST } from '../src/data/equipmentData';
import {
  SPRITE_LIGHT_COUNT,
  SPRITE_LIGHT_SLOT,
  clearSpriteLight,
  getSpriteLightSlotSnapshot,
  setSpriteLight,
} from '../src/render/spriteLighting';
import { OVERWORLD_LAMP_LIGHTS } from '../src/render/worldRenderer';

describe('Priorité 1 — Squelette hiérarchique 15 os & calibration centralisée des 27 accessoires', () => {
  it('définit un squelette acyclique à racine unique (pelvis) avec une morphologie cohérente', () => {
    expect(HERO_BONE_ORDER.length).toBe(15);
    const roots = HERO_BONE_ORDER.filter((id) => HERO_SKELETON_SPEC[id].parent === null);
    expect(roots).toEqual(['pelvis']);

    // Vérifie l'absence de cycle et que chaque parent précède son enfant dans HERO_BONE_ORDER
    for (let i = 0; i < HERO_BONE_ORDER.length; i++) {
      const id = HERO_BONE_ORDER[i];
      const spec = HERO_SKELETON_SPEC[id];
      if (spec.parent !== null) {
        const parentIdx = HERO_BONE_ORDER.indexOf(spec.parent);
        expect(parentIdx).toBeGreaterThanOrEqual(0);
        expect(parentIdx).toBeLessThan(i);
      }
      const visited = new Set<HeroBoneId>([id]);
      let cur = spec.parent;
      while (cur !== null) {
        expect(visited.has(cur)).toBe(false);
        visited.add(cur);
        cur = HERO_SKELETON_SPEC[cur].parent;
      }
    }

    // Morphologie anatomique cohérente (calibrée sur hero_base_idle.png)
    const head = getBoneRestWorldPosition('head');
    const chest = getBoneRestWorldPosition('chest');
    const pelvis = getBoneRestWorldPosition('pelvis');
    const leftFoot = getBoneRestWorldPosition('leftFoot');
    const rightFoot = getBoneRestWorldPosition('rightFoot');
    const leftHand = getBoneRestWorldPosition('leftHand');
    const rightHand = getBoneRestWorldPosition('rightHand');

    expect(head.y).toBeGreaterThan(chest.y);
    expect(chest.y).toBeGreaterThan(pelvis.y);
    expect(pelvis.y).toBeGreaterThan(leftFoot.y);
    expect(leftFoot.x).toBeLessThan(rightFoot.x);
    expect(leftHand.x).toBeLessThan(rightHand.x);
  });

  it('couvre les 27 équipements du jeu avec un os valide, des pivots mécaniques, des bornes et un profil PBR valides', () => {
    expect(EQUIPMENT_LIST.length).toBe(27);

    for (const item of EQUIPMENT_LIST) {
      const cal = getEquipmentCalibration(item.id);
      expect(cal, `Calibration manquante pour ${item.id}`).not.toBeNull();
      if (!cal) continue;

      expect(EQUIPMENT_CALIBRATION_REGISTRY[item.id]).toBe(cal);
      expect(HERO_SKELETON_SPEC[cal.bone]).toBeDefined();
      expect(Number.isFinite(cal.targetW) && cal.targetW > 0).toBe(true);
      expect(Number.isFinite(cal.targetH) && cal.targetH > 0).toBe(true);
      expect(cal.pivotU).toBeGreaterThanOrEqual(0);
      expect(cal.pivotU).toBeLessThanOrEqual(1);
      expect(cal.pivotV).toBeGreaterThanOrEqual(0);
      expect(cal.pivotV).toBeLessThanOrEqual(1);
      expect(cal.pbr.roughness).toBeGreaterThanOrEqual(0);
      expect(cal.pbr.roughness).toBeLessThanOrEqual(1);
      expect(cal.pbr.metalness).toBeGreaterThanOrEqual(0);
      expect(cal.pbr.metalness).toBeLessThanOrEqual(1);

      if (cal.pbr.realLight) {
        expect(cal.pbr.realLight.intensity).toBeGreaterThan(0);
        expect(cal.pbr.realLight.distance).toBeGreaterThan(2);
      }
    }

    // Orientation canonique des accessoires inversés d'origine
    expect(getEquipmentCalibration('sword_wood')?.flipContentX).toBe(true);
    expect(getEquipmentCalibration('staff_arcane')?.flipContentX).toBe(true);
  });

  it('aligne exactement le pivot mécanique (poignée, sommet, semelle) sur l’origine (0, 0) de l’os parent', () => {
    const quadW = 0.6;
    const quadH = 0.8;
    const pivotU = 0.22;
    const pivotV = 0.18;
    const offset = computePivotMeshOffset(quadW, quadH, pivotU, pivotV, 1.0);

    // Un point (u, v) canvas (v=0 haut, v=1 bas) sur un quad Three.js (Y+ haut, Y- bas)
    // centré en (meshOffsetX, meshOffsetY) tombe exactement sur (0, 0) de l'os parent
    expect(offset.meshOffsetX + (pivotU - 0.5) * quadW).toBeCloseTo(0, 6);
    expect(offset.meshOffsetY + (0.5 - pivotV) * quadH).toBeCloseTo(0, 6);

    // Vérifie computeNormalizedEquipmentFit avec fillRatio = EQUIPMENT_NORMALIZED_FILL
    const cal = getEquipmentCalibration('sword_steel')!;
    const fit = computeNormalizedEquipmentFit(cal, {
      minX: 40,
      maxX: 440,
      minY: 30,
      maxY: 470,
      contentW: 400,
      contentH: 440,
      sourceWidth: 512,
      sourceHeight: 512,
    });
    expect(fit.quadW).toBeGreaterThan(0);
    expect(fit.quadH).toBeGreaterThan(0);
    const pad = (1 - EQUIPMENT_NORMALIZED_FILL) * 0.5;
    const normU = pad + cal.pivotU * EQUIPMENT_NORMALIZED_FILL;
    const normV = pad + cal.pivotV * EQUIPMENT_NORMALIZED_FILL;
    expect(fit.meshOffsetX + (normU - 0.5) * fit.quadW).toBeCloseTo(0, 6);
    expect(fit.meshOffsetY + (0.5 - normV) * fit.quadH).toBeCloseTo(0, 6);
  });

  it('résout des poses valides, finies et articulées sur les 8 états d’animation (y compris roll & garde bouclier)', () => {
    const states: readonly HeroAnimState[] = [
      'idle',
      'walk',
      'jump',
      'attack',
      'roll',
      'hurt',
      'death',
      'deck_idle',
    ];
    const pose = createHeroSkeletonPose();

    for (const st of states) {
      const frameCount = st === 'attack' ? 14 : 16;
      for (let f = 0; f < frameCount; f++) {
        solveHeroBoneTransformsInto(pose, st, f, frameCount, { time: f * 0.05 });
        for (const boneId of HERO_BONE_ORDER) {
          const b = pose[boneId];
          expect(Number.isFinite(b.x)).toBe(true);
          expect(Number.isFinite(b.y)).toBe(true);
          expect(Number.isFinite(b.z)).toBe(true);
          expect(Number.isFinite(b.rotZ)).toBe(true);
          expect(Number.isFinite(b.scaleX) && b.scaleX > 0).toBe(true);
          expect(Number.isFinite(b.scaleY) && b.scaleY > 0).toBe(true);
        }
      }
    }

    // Pendant la roulade, le pelvis effectue une rotation complète (les accessoires roulent avec le héros)
    solveHeroBoneTransformsInto(pose, 'roll', 8, 16, { time: 0.4 });
    expect(Math.abs(pose.pelvis.rotZ)).toBeGreaterThan(1.5);

    // Pendant l'attaque, le bras droit effectue un arc de frappe ample
    solveHeroBoneTransformsInto(pose, 'attack', 2, 14, { time: 0.1 });
    const windupRot = pose.rightShoulder.rotZ + pose.rightHand.rotZ;
    solveHeroBoneTransformsInto(pose, 'attack', 8, 14, { time: 0.3 });
    const strikeRot = pose.rightShoulder.rotZ + pose.rightHand.rotZ;
    expect(Math.abs(windupRot - strikeRot)).toBeGreaterThan(0.9);

    // En garde bouclier, l'épaule gauche s'avance/se lève
    const restLeftShoulder = HERO_SKELETON_SPEC.leftShoulder;
    solveHeroBoneTransformsInto(pose, 'idle', 0, 16, { blocking: true, time: 0 });
    expect(pose.leftShoulder.y).toBeGreaterThan(restLeftShoulder.restY);
  });
});

describe('Priorité 2 — Pipeline d’éclairage réel PBR/GLSL (12 slots dynamiques & lampes physiques)', () => {
  it('expose 12 slots de lumières dynamiques synchronisés au shader sans NaN ni débordement', () => {
    expect(SPRITE_LIGHT_COUNT).toBe(12);
    expect(SPRITE_LIGHT_SLOT.WORLD_START).toBe(0);
    expect(SPRITE_LIGHT_SLOT.WORLD_COUNT).toBe(8);
    expect(SPRITE_LIGHT_SLOT.HERO_LANTERN).toBe(8);
    expect(SPRITE_LIGHT_SLOT.HERO_WEAPON).toBe(9);
    expect(SPRITE_LIGHT_SLOT.COMPANION).toBe(10);
    expect(SPRITE_LIGHT_SLOT.ENEMY_OR_SPELL).toBe(11);

    const pos = new THREE.Vector3(3.5, 1.4, -2.25);
    const col = new THREE.Color(0xffb85c);
    setSpriteLight(SPRITE_LIGHT_SLOT.HERO_LANTERN, pos, col, 14.0, 12.5);

    const snap = getSpriteLightSlotSnapshot(SPRITE_LIGHT_SLOT.HERO_LANTERN);
    expect(snap).not.toBeNull();
    expect(snap?.x).toBeCloseTo(3.5, 5);
    expect(snap?.y).toBeCloseTo(1.4, 5);
    expect(snap?.z).toBeCloseTo(-2.25, 5);
    expect(snap?.intensity).toBeCloseTo(14.0, 5);
    expect(snap?.distance).toBeCloseTo(12.5, 5);

    clearSpriteLight(SPRITE_LIGHT_SLOT.HERO_LANTERN);
    const cleared = getSpriteLightSlotSnapshot(SPRITE_LIGHT_SLOT.HERO_LANTERN);
    expect(cleared?.intensity).toBe(0);

    // Hors bornes sans crash
    expect(getSpriteLightSlotSnapshot(-1)).toBeNull();
    expect(getSpriteLightSlotSnapshot(99)).toBeNull();
  });

  it('calibre les lampadaires extérieurs avec une intensité physique adaptée au decay = 2 et un mode lamp', () => {
    expect(OVERWORLD_LAMP_LIGHTS.length).toBeGreaterThanOrEqual(13);
    for (const lamp of OVERWORLD_LAMP_LIGHTS) {
      expect(lamp.intensity ?? 0).toBeGreaterThanOrEqual(10);
      expect(lamp.distance ?? 0).toBeGreaterThanOrEqual(12);
      expect(lamp.color).toBeDefined();
      expect(lamp.flickerMode).toBe('lamp');
    }
  });

  it('associe de vraies PointLights (sans faux halos) aux armes lumineuses dans le registre PBR', () => {
    const arcaneStaff = getEquipmentCalibration('staff_arcane');
    const dragonBlade = getEquipmentCalibration('blade_dragon');
    const frostHammer = getEquipmentCalibration('hammer_frost');
    const emberStaff = getEquipmentCalibration('staff_ember');
    const steelSword = getEquipmentCalibration('sword_steel');

    expect(arcaneStaff?.pbr.realLight).toBeDefined();
    expect(dragonBlade?.pbr.realLight).toBeDefined();
    expect(frostHammer?.pbr.realLight).toBeDefined();
    expect(emberStaff?.pbr.realLight).toBeDefined();
    // Une épée en acier est métallique mais non émissive
    expect(steelSword?.pbr.realLight).toBeUndefined();
    expect(steelSword?.pbr.metalness ?? 0).toBeGreaterThan(0.6);
  });
});
