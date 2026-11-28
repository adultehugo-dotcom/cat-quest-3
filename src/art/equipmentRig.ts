import type { EquipSlot } from '../game/types';
import { getEquipmentDefinition } from '../data/equipmentData';
import type { HeroAnimState } from './hdAssets';
import { createCanvas } from './palette';

// ============================================================================
// Système d'Attachement Anatomique Hiérarchique & Calibration des Équipements
// - Calibré sur les coordonnées réelles du héros félin (`hero_base_idle.png`, 512×512).
// - Arbre d'os hiérarchique (`pelvis -> spine -> chest -> { head, leftShoulder -> leftHand,
//   rightShoulder -> rightHand, collar }, waist, leftHip -> leftFoot, rightHip -> rightFoot`).
// - Registre centralisé des équipements (+ lanterne) : os parent, pivot UV exact
//   (ex. garde de l'arme dans la patte, anneau de la lanterne, couronne du casque),
//   dimensions cibles, orientation canonique et profil PBR réel (`roughness`, `metalness`,
//   émissif HDR et lumière réelle éventuelle).
// - Normalisation universelle sans génération d'image : recadrage des marges transparentes
//   et alignement de pivot sur les PNG existants ou canvas procéduraux d'armes.
// ============================================================================

export type HeroBoneId =
  | 'pelvis'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'collar'
  | 'waist'
  | 'leftShoulder'
  | 'leftHand'
  | 'rightShoulder'
  | 'rightHand'
  | 'leftHip'
  | 'leftFoot'
  | 'rightHip'
  | 'rightFoot';

export interface BoneLocalTransform {
  x: number;
  y: number;
  z: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
}

export type HeroSkeletonPose = Record<HeroBoneId, BoneLocalTransform>;

export interface BoneHierarchyNode {
  readonly id: HeroBoneId;
  readonly parent: HeroBoneId | null;
  /** Position de repos relative au parent dans l'espace normalisé héros [-0.5..0.5, 0..1] */
  readonly restX: number;
  readonly restY: number;
  readonly restZ: number;
}

/**
 * Squelette anatomique canonique du héros félin (mesuré pixel par pixel sur 512×512) :
 * - Crâne : centre x ≈ 230 px (`nx = -0.051`), sommet couronne y ≈ 176 px (`ny = 0.656`)
 * - Torse : centre x ≈ 237 px (`nx = -0.037`), centre vertical y ≈ 367 px (`ny = 0.283`)
 * - Patte gauche : x ≈ 175 px (`nx = -0.158`), y ≈ 365 px (`ny = 0.287`)
 * - Patte droite : x ≈ 297 px (`nx = +0.080`), y ≈ 359 px (`ny = 0.299`)
 * - Pied gauche : x ≈ 211 px (`nx = -0.088`), y ≈ 440 px (`ny = 0.141`)
 * - Pied droit : x ≈ 263 px (`nx = +0.014`), y ≈ 440 px (`ny = 0.141`)
 */
export const HERO_SKELETON_SPEC: Readonly<Record<HeroBoneId, BoneHierarchyNode>> = {
  pelvis: { id: 'pelvis', parent: null, restX: -0.037, restY: 0.215, restZ: 0 },
  spine: { id: 'spine', parent: 'pelvis', restX: 0, restY: 0.034, restZ: 0.002 },
  chest: { id: 'chest', parent: 'spine', restX: 0, restY: 0.034, restZ: 0.004 },
  neck: { id: 'neck', parent: 'chest', restX: -0.006, restY: 0.076, restZ: 0.004 },
  head: { id: 'head', parent: 'neck', restX: -0.008, restY: 0.298, restZ: 0.01 },
  collar: { id: 'collar', parent: 'chest', restX: -0.004, restY: 0.074, restZ: -0.012 },
  waist: { id: 'waist', parent: 'pelvis', restX: 0.148, restY: 0.048, restZ: 0.022 },
  leftShoulder: { id: 'leftShoulder', parent: 'chest', restX: -0.068, restY: 0.024, restZ: 0.004 },
  leftHand: { id: 'leftHand', parent: 'leftShoulder', restX: -0.053, restY: -0.02, restZ: 0.008 },
  rightShoulder: { id: 'rightShoulder', parent: 'chest', restX: 0.068, restY: 0.026, restZ: 0.006 },
  rightHand: { id: 'rightHand', parent: 'rightShoulder', restX: 0.049, restY: -0.01, restZ: 0.01 },
  leftHip: { id: 'leftHip', parent: 'pelvis', restX: -0.032, restY: -0.026, restZ: 0.002 },
  leftFoot: { id: 'leftFoot', parent: 'leftHip', restX: -0.019, restY: -0.052, restZ: 0.003 },
  rightHip: { id: 'rightHip', parent: 'pelvis', restX: 0.032, restY: -0.026, restZ: 0.004 },
  rightFoot: { id: 'rightFoot', parent: 'rightHip', restX: 0.019, restY: -0.052, restZ: 0.004 },
};

export const HERO_BONE_ORDER: readonly HeroBoneId[] = [
  'pelvis',
  'spine',
  'chest',
  'neck',
  'head',
  'collar',
  'waist',
  'leftShoulder',
  'leftHand',
  'rightShoulder',
  'rightHand',
  'leftHip',
  'leftFoot',
  'rightHip',
  'rightFoot',
];

export interface EquipmentPbrProfile {
  readonly roughness: number;
  readonly metalness: number;
  readonly emissiveHex?: number;
  readonly emissiveIntensity?: number;
  readonly realLight?: {
    readonly colorHex: number;
    readonly intensity: number;
    readonly distance: number;
  };
}

export interface EquipmentCalibrationEntry {
  readonly itemId: string;
  readonly slot: EquipSlot;
  readonly bone: HeroBoneId;
  /** Dimensions visibles cibles sur le héros normalisé (width, height en fraction de HERO_WIDTH/HEIGHT) */
  readonly targetW: number;
  readonly targetH: number;
  /** Décalage local par rapport à l'os parent (espace normalisé héros) */
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  /** Rotation de repos (radians, sens trigonométrique 3D +Z) */
  readonly baseRotZ: number;
  /**
   * Pivot normalisé dans le contenu recadré [0..1, 0..1] (u=0 gauche -> 1 droite, v=0 haut -> 1 bas).
   * Ex. (0.24, 0.78) place la garde d'une épée exactement sur l'origine du socket `rightHand`.
   */
  readonly pivotU: number;
  readonly pivotV: number;
  /** Miroir horizontal du PNG source pour unifier l'orientation canonique */
  readonly flipContentX?: boolean;
  /** Fraction de bordure extérieure à rogner (supprime un éventuel cadre d'icône source) */
  readonly trimBorderFraction?: number;
  /** Sous-zone source normalisée [0..1] (isole une seule botte ou un seul gant sur les icônes par paire) */
  readonly cropRegion?: {
    readonly u0: number;
    readonly v0: number;
    readonly u1: number;
    readonly v1: number;
  };
  /** Évide l'ombre sombre intérieure des casques ouverts afin que les yeux du chat restent visibles */
  readonly carveOpenFaceMask?: boolean;
  /** Signe miroir gauche/droite optionnel (1 = tel quel, -1 = symétrie horizontale) */
  readonly leftMirrorSign?: 1 | -1;
  readonly rightMirrorSign?: 1 | -1;
  /** Pour les casques/chapeaux : occlusion arrière + visibilité des oreilles félines */
  readonly helmetOcclusion?: {
    readonly earVisibility: number;
    readonly backLayerAlpha: number;
    readonly backTintHex: number;
    readonly backScaleX: number;
    readonly backScaleY: number;
    readonly backOffsetY: number;
  };
  /** Ordre de rendu relatif sur le personnage */
  readonly renderOrder: number;
  /** Profil de matériaux physiques PBR & source lumineuse réelle */
  readonly pbr: EquipmentPbrProfile;
}

export const EQUIPMENT_NORMALIZED_FILL = 0.88;

const MAT_CLOTH: EquipmentPbrProfile = { roughness: 0.86, metalness: 0.04 };
const MAT_WOOD: EquipmentPbrProfile = { roughness: 0.84, metalness: 0.05 };
const MAT_IRON: EquipmentPbrProfile = { roughness: 0.30, metalness: 0.76 };
const MAT_STEEL: EquipmentPbrProfile = { roughness: 0.26, metalness: 0.82 };
const MAT_ARCANE_CLOTH: EquipmentPbrProfile = {
  roughness: 0.56,
  metalness: 0.16,
  emissiveHex: 0x5cd4ff,
  emissiveIntensity: 0.42,
};
const MAT_DRAGON_PLATE: EquipmentPbrProfile = {
  roughness: 0.28,
  metalness: 0.74,
  emissiveHex: 0xff5a24,
  emissiveIntensity: 0.32,
};

/**
 * Registre centralisé et extensible des pièces d'équipement du héros.
 * Chaque pièce a sa calibration morphologique, son pivot mécanique et ses paramètres PBR.
 */
export const EQUIPMENT_CALIBRATION_REGISTRY: Readonly<Record<string, EquipmentCalibrationEntry>> = {
  // --- ARMURES (Torse — attachées à `chest`, coupe ajustée près du corps) ---
  armor_tunic: {
    itemId: 'armor_tunic',
    slot: 'armor',
    bone: 'chest',
    targetW: 0.214,
    targetH: 0.198,
    offsetX: 0,
    offsetY: 0.002,
    offsetZ: 0.005,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.5,
    renderOrder: 4,
    pbr: MAT_CLOTH,
  },
  armor_mail: {
    itemId: 'armor_mail',
    slot: 'armor',
    bone: 'chest',
    targetW: 0.286,
    targetH: 0.194,
    offsetX: 0,
    offsetY: 0.004,
    offsetZ: 0.005,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.5,
    renderOrder: 4,
    pbr: MAT_IRON,
  },
  armor_robe: {
    itemId: 'armor_robe',
    slot: 'armor',
    bone: 'chest',
    targetW: 0.222,
    targetH: 0.208,
    offsetX: 0,
    offsetY: -0.002,
    offsetZ: 0.005,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.5,
    renderOrder: 4,
    pbr: MAT_ARCANE_CLOTH,
  },
  armor_dragon: {
    itemId: 'armor_dragon',
    slot: 'armor',
    bone: 'chest',
    targetW: 0.206,
    targetH: 0.196,
    offsetX: 0,
    offsetY: 0.002,
    offsetZ: 0.005,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.5,
    renderOrder: 4,
    pbr: MAT_DRAGON_PLATE,
  },

  // --- CASQUES / COIFFES (Tête — ajustés au crâne avec occlusion arrière & gestion oreilles) ---
  helm_bandana: {
    itemId: 'helm_bandana',
    slot: 'helmet',
    bone: 'head',
    targetW: 0.345,
    targetH: 0.158,
    offsetX: -0.006,
    offsetY: -0.058,
    offsetZ: 0.009,
    baseRotZ: 0.015,
    pivotU: 0.5,
    pivotV: 0.50,
    trimBorderFraction: 0.08,
    helmetOcclusion: {
      earVisibility: 1.0,
      backLayerAlpha: 0.58,
      backTintHex: 0x3b1f1a,
      backScaleX: 0.94,
      backScaleY: 0.72,
      backOffsetY: -0.006,
    },
    renderOrder: 8,
    pbr: MAT_CLOTH,
  },
  helm_knight: {
    itemId: 'helm_knight',
    slot: 'helmet',
    bone: 'head',
    targetW: 0.402,
    targetH: 0.336,
    offsetX: -0.006,
    offsetY: -0.066,
    offsetZ: 0.009,
    baseRotZ: 0,
    pivotU: 0.52,
    pivotV: 0.38,
    carveOpenFaceMask: true,
    helmetOcclusion: {
      earVisibility: 0,
      backLayerAlpha: 0.82,
      backTintHex: 0x2c3442,
      backScaleX: 0.96,
      backScaleY: 0.90,
      backOffsetY: -0.01,
    },
    renderOrder: 8,
    pbr: MAT_STEEL,
  },
  helm_mage: {
    itemId: 'helm_mage',
    slot: 'helmet',
    bone: 'head',
    targetW: 0.434,
    targetH: 0.308,
    offsetX: -0.004,
    offsetY: -0.052,
    offsetZ: 0.009,
    baseRotZ: 0.025,
    pivotU: 0.5,
    pivotV: 0.80,
    helmetOcclusion: {
      earVisibility: 1.0,
      backLayerAlpha: 0.86,
      backTintHex: 0x1d264a,
      backScaleX: 1.02,
      backScaleY: 0.68,
      backOffsetY: -0.016,
    },
    renderOrder: 8,
    pbr: MAT_ARCANE_CLOTH,
  },
  helm_dragon: {
    itemId: 'helm_dragon',
    slot: 'helmet',
    bone: 'head',
    targetW: 0.414,
    targetH: 0.354,
    offsetX: -0.006,
    offsetY: -0.062,
    offsetZ: 0.009,
    baseRotZ: 0,
    pivotU: 0.52,
    pivotV: 0.44,
    carveOpenFaceMask: true,
    helmetOcclusion: {
      earVisibility: 0,
      backLayerAlpha: 0.85,
      backTintHex: 0x3b1814,
      backScaleX: 0.98,
      backScaleY: 0.92,
      backOffsetY: -0.01,
    },
    renderOrder: 8,
    pbr: MAT_DRAGON_PLATE,
  },

  // --- BOUCLIERS (Main gauche — attachés à `leftHand`) ---
  shield_wood: {
    itemId: 'shield_wood',
    slot: 'shield',
    bone: 'leftHand',
    targetW: 0.162,
    targetH: 0.194,
    offsetX: -0.012,
    offsetY: -0.004,
    offsetZ: 0.012,
    baseRotZ: 0.08,
    pivotU: 0.54,
    pivotV: 0.52,
    renderOrder: 9,
    pbr: MAT_WOOD,
  },
  shield_knight: {
    itemId: 'shield_knight',
    slot: 'shield',
    bone: 'leftHand',
    targetW: 0.172,
    targetH: 0.198,
    offsetX: -0.014,
    offsetY: -0.004,
    offsetZ: 0.012,
    baseRotZ: 0.08,
    pivotU: 0.54,
    pivotV: 0.52,
    renderOrder: 9,
    pbr: MAT_STEEL,
  },

  // --- ARMES (Main droite — pivot mécanique exact sur la poignée / garde dans la patte !) ---
  sword_wood: {
    itemId: 'sword_wood',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.275,
    targetH: 0.270,
    offsetX: 0.014,
    offsetY: 0.002,
    offsetZ: 0.014,
    baseRotZ: -0.22,
    pivotU: 0.27,
    pivotV: 0.74,
    flipContentX: true,
    renderOrder: 10,
    pbr: MAT_WOOD,
  },
  sword_steel: {
    itemId: 'sword_steel',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.285,
    targetH: 0.282,
    offsetX: 0.014,
    offsetY: 0.002,
    offsetZ: 0.014,
    baseRotZ: -0.22,
    pivotU: 0.24,
    pivotV: 0.77,
    renderOrder: 10,
    pbr: MAT_STEEL,
  },
  staff_arcane: {
    itemId: 'staff_arcane',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.305,
    targetH: 0.305,
    offsetX: 0.018,
    offsetY: 0.006,
    offsetZ: 0.014,
    baseRotZ: -0.26,
    pivotU: 0.32,
    pivotV: 0.68,
    flipContentX: true,
    renderOrder: 10,
    pbr: {
      roughness: 0.34,
      metalness: 0.38,
      emissiveHex: 0x5ce6ff,
      emissiveIntensity: 0.48,
      realLight: { colorHex: 0x5ce6ff, intensity: 2.0, distance: 6.5 },
    },
  },
  blade_dragon: {
    itemId: 'blade_dragon',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.312,
    targetH: 0.308,
    offsetX: 0.016,
    offsetY: 0.004,
    offsetZ: 0.014,
    baseRotZ: -0.24,
    pivotU: 0.24,
    pivotV: 0.77,
    renderOrder: 10,
    pbr: {
      roughness: 0.26,
      metalness: 0.78,
      emissiveHex: 0xff6220,
      emissiveIntensity: 0.44,
      realLight: { colorHex: 0xff6828, intensity: 2.1, distance: 7.0 },
    },
  },
  axe_iron: {
    itemId: 'axe_iron',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.295,
    targetH: 0.295,
    offsetX: 0.015,
    offsetY: 0.004,
    offsetZ: 0.014,
    baseRotZ: -0.22,
    pivotU: 0.26,
    pivotV: 0.76,
    renderOrder: 10,
    pbr: MAT_IRON,
  },
  hammer_frost: {
    itemId: 'hammer_frost',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.305,
    targetH: 0.302,
    offsetX: 0.016,
    offsetY: 0.004,
    offsetZ: 0.014,
    baseRotZ: -0.24,
    pivotU: 0.26,
    pivotV: 0.76,
    renderOrder: 10,
    pbr: {
      roughness: 0.32,
      metalness: 0.48,
      emissiveHex: 0x68e3ff,
      emissiveIntensity: 0.45,
      realLight: { colorHex: 0x68e3ff, intensity: 1.8, distance: 6.2 },
    },
  },
  claws_lynx: {
    itemId: 'claws_lynx',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.215,
    targetH: 0.215,
    offsetX: 0.012,
    offsetY: 0.0,
    offsetZ: 0.014,
    baseRotZ: -0.18,
    pivotU: 0.28,
    pivotV: 0.74,
    renderOrder: 10,
    pbr: MAT_STEEL,
  },
  dagger_viper: {
    itemId: 'dagger_viper',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.225,
    targetH: 0.225,
    offsetX: 0.012,
    offsetY: 0.0,
    offsetZ: 0.014,
    baseRotZ: -0.18,
    pivotU: 0.28,
    pivotV: 0.74,
    renderOrder: 10,
    pbr: {
      roughness: 0.38,
      metalness: 0.34,
      emissiveHex: 0x6be854,
      emissiveIntensity: 0.42,
      realLight: { colorHex: 0x6be854, intensity: 1.5, distance: 5.5 },
    },
  },
  spear_fishbone: {
    itemId: 'spear_fishbone',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.315,
    targetH: 0.315,
    offsetX: 0.018,
    offsetY: 0.005,
    offsetZ: 0.014,
    baseRotZ: -0.25,
    pivotU: 0.30,
    pivotV: 0.70,
    renderOrder: 10,
    pbr: { roughness: 0.62, metalness: 0.16 },
  },
  halberd_royal: {
    itemId: 'halberd_royal',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.325,
    targetH: 0.325,
    offsetX: 0.018,
    offsetY: 0.006,
    offsetZ: 0.014,
    baseRotZ: -0.25,
    pivotU: 0.30,
    pivotV: 0.70,
    renderOrder: 10,
    pbr: MAT_STEEL,
  },
  staff_ember: {
    itemId: 'staff_ember',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.310,
    targetH: 0.310,
    offsetX: 0.018,
    offsetY: 0.006,
    offsetZ: 0.014,
    baseRotZ: -0.26,
    pivotU: 0.30,
    pivotV: 0.70,
    renderOrder: 10,
    pbr: {
      roughness: 0.34,
      metalness: 0.42,
      emissiveHex: 0xff6e24,
      emissiveIntensity: 0.50,
      realLight: { colorHex: 0xff6e24, intensity: 2.0, distance: 6.5 },
    },
  },
  bow_hunter: {
    itemId: 'bow_hunter',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.255,
    targetH: 0.275,
    offsetX: 0.016,
    offsetY: 0.002,
    offsetZ: 0.014,
    baseRotZ: -0.10,
    pivotU: 0.48,
    pivotV: 0.52,
    renderOrder: 10,
    pbr: MAT_WOOD,
  },
  crossbow_storm: {
    itemId: 'crossbow_storm',
    slot: 'weapon',
    bone: 'rightHand',
    targetW: 0.265,
    targetH: 0.265,
    offsetX: 0.016,
    offsetY: 0.002,
    offsetZ: 0.014,
    baseRotZ: -0.10,
    pivotU: 0.45,
    pivotV: 0.55,
    renderOrder: 10,
    pbr: {
      roughness: 0.30,
      metalness: 0.68,
      emissiveHex: 0x66d9ff,
      emissiveIntensity: 0.44,
      realLight: { colorHex: 0x66d9ff, intensity: 1.7, distance: 6.0 },
    },
  },

  // --- CAPES (Col — simulées en 3D par `CapeClothMesh` via l'ancre `collar`) ---
  cape_traveler: {
    itemId: 'cape_traveler',
    slot: 'cape',
    bone: 'collar',
    targetW: 0.36,
    targetH: 0.30,
    offsetX: 0,
    offsetY: -0.10,
    offsetZ: -0.02,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.12,
    renderOrder: 1,
    pbr: MAT_CLOTH,
  },
  cape_knight: {
    itemId: 'cape_knight',
    slot: 'cape',
    bone: 'collar',
    targetW: 0.37,
    targetH: 0.31,
    offsetX: 0,
    offsetY: -0.10,
    offsetZ: -0.02,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.12,
    renderOrder: 1,
    pbr: { roughness: 0.74, metalness: 0.10 },
  },
  cape_starlight: {
    itemId: 'cape_starlight',
    slot: 'cape',
    bone: 'collar',
    targetW: 0.38,
    targetH: 0.32,
    offsetX: 0,
    offsetY: -0.10,
    offsetZ: -0.02,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.12,
    renderOrder: 1,
    pbr: MAT_ARCANE_CLOTH,
  },
  cape_dragon: {
    itemId: 'cape_dragon',
    slot: 'cape',
    bone: 'collar',
    targetW: 0.38,
    targetH: 0.32,
    offsetX: 0,
    offsetY: -0.10,
    offsetZ: -0.02,
    baseRotZ: 0,
    pivotU: 0.5,
    pivotV: 0.12,
    renderOrder: 1,
    pbr: { roughness: 0.60, metalness: 0.16, emissiveHex: 0xff4c22, emissiveIntensity: 0.24 },
  },
};

export function getEquipmentCalibration(itemId: string): EquipmentCalibrationEntry | null {
  if (!itemId) return null;
  const direct = EQUIPMENT_CALIBRATION_REGISTRY[itemId];
  if (direct) return direct;

  // Fallback extensible si un nouvel équipement est ajouté dans equipmentData.ts
  const def = getEquipmentDefinition(itemId);
  if (!def) return null;
  const slotDefaults: Record<EquipSlot, Omit<EquipmentCalibrationEntry, 'itemId' | 'slot'>> = {
    armor: {
      bone: 'chest',
      targetW: 0.19,
      targetH: 0.176,
      offsetX: 0,
      offsetY: 0,
      offsetZ: 0.006,
      baseRotZ: 0,
      pivotU: 0.5,
      pivotV: 0.5,
      renderOrder: 4,
      pbr: MAT_CLOTH,
    },
    helmet: {
      bone: 'head',
      targetW: 0.27,
      targetH: 0.24,
      offsetX: 0,
      offsetY: 0.012,
      offsetZ: 0.01,
      baseRotZ: 0,
      pivotU: 0.5,
      pivotV: 0.66,
      renderOrder: 8,
      pbr: MAT_IRON,
    },
    shield: {
      bone: 'leftHand',
      targetW: 0.168,
      targetH: 0.196,
      offsetX: -0.012,
      offsetY: -0.004,
      offsetZ: 0.012,
      baseRotZ: 0.08,
      pivotU: 0.54,
      pivotV: 0.52,
      renderOrder: 9,
      pbr: MAT_WOOD,
    },
    weapon: {
      bone: 'rightHand',
      targetW: 0.285,
      targetH: 0.282,
      offsetX: 0.014,
      offsetY: 0.002,
      offsetZ: 0.014,
      baseRotZ: -0.22,
      pivotU: 0.25,
      pivotV: 0.76,
      renderOrder: 10,
      pbr: MAT_STEEL,
    },
    cape: {
      bone: 'collar',
      targetW: 0.36,
      targetH: 0.3,
      offsetX: 0,
      offsetY: -0.1,
      offsetZ: -0.02,
      baseRotZ: 0,
      pivotU: 0.5,
      pivotV: 0.12,
      renderOrder: 1,
      pbr: MAT_CLOTH,
    },
  };
  return { itemId, slot: def.slot, ...slotDefaults[def.slot] };
}

/**
 * Résout la position de repos absolue d'un os (en espace normalisé héros) par
 * accumulation dans l'arbre hiérarchique.
 */
export function getBoneRestWorldPosition(boneId: HeroBoneId): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  let cursor: HeroBoneId | null = boneId;
  while (cursor) {
    const node: BoneHierarchyNode = HERO_SKELETON_SPEC[cursor];
    x += node.restX;
    y += node.restY;
    z += node.restZ;
    cursor = node.parent;
  }
  return { x, y, z };
}

/**
 * Calcule le décalage local `(dx, dy)` à appliquer au mesh d'accessoire à l'intérieur
 * de son nœud pivot pour que le point `(pivotU, pivotV)` du contenu recadré coïncide
 * exactement avec l'origine `(0, 0)` du socket/os parent.
 */
export function computePivotMeshOffset(
  quadW: number,
  quadH: number,
  pivotU: number,
  pivotV: number,
  contentFill = EQUIPMENT_NORMALIZED_FILL,
): { meshOffsetX: number; meshOffsetY: number } {
  // Dans un canvas recadré avec marge (1 - fill)/2 autour du contenu :
  const pad = (1 - contentFill) * 0.5;
  const normU = pad + pivotU * contentFill; // 0 gauche .. 1 droite
  const normV = pad + pivotV * contentFill; // 0 haut .. 1 bas
  // En Three.js PlaneGeometry centré : gauche = -0.5, droite = +0.5, haut = +0.5, bas = -0.5
  const meshOffsetX = (0.5 - normU) * quadW;
  const meshOffsetY = (normV - 0.5) * quadH;
  return { meshOffsetX, meshOffsetY };
}

export interface EquipmentContentBounds {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly contentW: number;
  readonly contentH: number;
}

export function measureEquipmentBounds(
  img: HTMLImageElement | HTMLCanvasElement | undefined,
): EquipmentContentBounds {
  const fallback: EquipmentContentBounds = {
    sourceWidth: 256,
    sourceHeight: 256,
    minX: 20,
    maxX: 235,
    minY: 20,
    maxY: 235,
    contentW: 216,
    contentH: 216,
  };
  if (!img || typeof document === 'undefined') return fallback;
  const isImgEl = typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement;
  const w = isImgEl ? img.naturalWidth || img.width : img.width;
  const h = isImgEl ? img.naturalHeight || img.height : img.height;
  if (w <= 0 || h <= 0) return fallback;

  try {
    const { ctx } = createCanvas(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    const alphaMin = 48;
    const minRowPx = Math.max(2, Math.floor(w * 0.012));
    const minColPx = Math.max(2, Math.floor(h * 0.012));

    let minY = h;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      let c = 0;
      const off = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[off + x * 4 + 3] >= alphaMin) c++;
      }
      if (c >= minRowPx) {
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxY < minY) return fallback;

    let minX = w;
    let maxX = -1;
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let y = minY; y <= maxY; y++) {
        if (data[(y * w + x) * 4 + 3] >= alphaMin) c++;
      }
      if (c >= minColPx) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX < minX) return fallback;

    return {
      sourceWidth: w,
      sourceHeight: h,
      minX,
      maxX,
      minY,
      maxY,
      contentW: maxX - minX + 1,
      contentH: maxY - minY + 1,
    };
  } catch {
    return fallback;
  }
}

export interface NormalizedEquipmentFit {
  readonly quadW: number;
  readonly quadH: number;
  readonly visibleW: number;
  readonly visibleH: number;
  readonly meshOffsetX: number;
  readonly meshOffsetY: number;
}

const normalizedEquipCanvasCache = new WeakMap<
  HTMLImageElement | HTMLCanvasElement,
  Map<string, { canvas: HTMLCanvasElement; bounds: EquipmentContentBounds }>
>();

/**
 * Recadre proprement tout accessoire PNG ou canvas procédural (casque, arme, bouclier)
 * autour de ses pixels opaques réels, applique la normalisation d'orientation
 * canonique (`flipContentX`), sans aucune génération d'image IA.
 */
export function createNormalizedEquipmentCanvas(
  img: HTMLImageElement | HTMLCanvasElement,
  calibration: EquipmentCalibrationEntry,
): { canvas: HTMLCanvasElement; bounds: EquipmentContentBounds } {
  const cropKey = calibration.cropRegion
    ? `${calibration.cropRegion.u0},${calibration.cropRegion.v0},${calibration.cropRegion.u1},${calibration.cropRegion.v1}`
    : 'full';
  const key = `${calibration.itemId}|${calibration.flipContentX ? 'fx' : 'id'}|${calibration.trimBorderFraction ?? 0}|${calibration.carveOpenFaceMask ? 'cf' : 'nc'}|${cropKey}`;
  let byKey = normalizedEquipCanvasCache.get(img);
  if (!byKey) {
    byKey = new Map();
    normalizedEquipCanvasCache.set(img, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached;

  let bounds = measureEquipmentBounds(img);
  if (calibration.cropRegion) {
    const cr = calibration.cropRegion;
    const subMinX = bounds.minX + Math.round(bounds.contentW * cr.u0);
    const subMaxX = bounds.minX + Math.round(bounds.contentW * cr.u1);
    const subMinY = bounds.minY + Math.round(bounds.contentH * cr.v0);
    const subMaxY = bounds.minY + Math.round(bounds.contentH * cr.v1);
    const nextW = Math.max(4, subMaxX - subMinX);
    const nextH = Math.max(4, subMaxY - subMinY);
    bounds = {
      ...bounds,
      minX: subMinX,
      maxX: subMinX + nextW - 1,
      minY: subMinY,
      maxY: subMinY + nextH - 1,
      contentW: nextW,
      contentH: nextH,
    };
  }
  if (calibration.trimBorderFraction && calibration.trimBorderFraction > 0) {
    const trimX = Math.round(bounds.contentW * calibration.trimBorderFraction);
    const trimY = Math.round(bounds.contentH * calibration.trimBorderFraction);
    const nextW = Math.max(4, bounds.contentW - trimX * 2);
    const nextH = Math.max(4, bounds.contentH - trimY * 2);
    bounds = {
      ...bounds,
      minX: bounds.minX + trimX,
      maxX: bounds.minX + trimX + nextW - 1,
      minY: bounds.minY + trimY,
      maxY: bounds.minY + trimY + nextH - 1,
      contentW: nextW,
      contentH: nextH,
    };
  }

  const outSize = 256;
  const { canvas, ctx } = createCanvas(outSize, outSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const padPx = outSize * ((1 - EQUIPMENT_NORMALIZED_FILL) * 0.5);
  const inner = outSize * EQUIPMENT_NORMALIZED_FILL;

  ctx.clearRect(0, 0, outSize, outSize);
  ctx.save();
  if (calibration.flipContentX) {
    ctx.translate(outSize, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    img,
    bounds.minX,
    bounds.minY,
    bounds.contentW,
    bounds.contentH,
    padPx,
    padPx,
    inner,
    inner,
  );
  ctx.restore();

  // Évide l'intérieur sombre creux des casques à joue ouverte (helm_knight, helm_dragon)
  // sans toucher aux plaques métalliques, bordures dorées ni gemmes frontales
  if (calibration.carveOpenFaceMask) {
    try {
      const imgData = ctx.getImageData(0, 0, outSize, outSize);
      const data = imgData.data;
      const uMin = Math.floor(padPx + inner * 0.34);
      const uMax = Math.ceil(padPx + inner * 0.88);
      const vMin = Math.floor(padPx + inner * 0.45);
      const vMax = Math.ceil(padPx + inner * 0.94);
      for (let py = vMin; py < vMax; py++) {
        for (let px = uMin; px < uMax; px++) {
          const i = (py * outSize + px) * 4;
          const a = data[i + 3];
          if (a < 10) continue;
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          if (luma < 66 && maxC - minC < 30) {
            data[i + 3] = 0;
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } catch {
      // Fallback sécurisé sans ImageData
    }
  }

  const res = { canvas, bounds };
  byKey.set(key, res);
  return res;
}

/**
 * Calcule la taille exacte du quad et le décalage de pivot d'un équipement normalisé.
 */
export function computeNormalizedEquipmentFit(
  calibration: EquipmentCalibrationEntry,
  bounds?: EquipmentContentBounds,
): NormalizedEquipmentFit {
  let visibleW = calibration.targetW;
  let visibleH = calibration.targetH;

  // Préserve le ratio naturel de l'objet dans une enveloppe contrôlée (évite tout écrasement)
  if (bounds && bounds.contentW > 0 && bounds.contentH > 0 && calibration.slot !== 'armor') {
    const naturalAspect = bounds.contentW / bounds.contentH;
    const targetAspect = visibleW / Math.max(0.001, visibleH);
    const ratio = targetAspect / naturalAspect;
    if (ratio > 1.24) {
      visibleW = visibleH * naturalAspect * 1.24;
    } else if (ratio < 0.80) {
      visibleH = visibleW / (naturalAspect * 0.80);
    }
  }

  const quadW = visibleW / EQUIPMENT_NORMALIZED_FILL;
  const quadH = visibleH / EQUIPMENT_NORMALIZED_FILL;
  const { meshOffsetX, meshOffsetY } = computePivotMeshOffset(
    quadW,
    quadH,
    calibration.pivotU,
    calibration.pivotV,
    EQUIPMENT_NORMALIZED_FILL,
  );

  return { quadW, quadH, visibleW, visibleH, meshOffsetX, meshOffsetY };
}

/**
 * Crée une pose squelettique vide/repos réutilisable (zéro allocation par frame).
 */
export function createHeroSkeletonPose(): HeroSkeletonPose {
  const pose = {} as HeroSkeletonPose;
  for (const id of HERO_BONE_ORDER) {
    const spec = HERO_SKELETON_SPEC[id];
    pose[id] = {
      x: spec.restX,
      y: spec.restY,
      z: spec.restZ,
      rotZ: 0,
      scaleX: 1,
      scaleY: 1,
    };
  }
  return pose;
}

export type HeroWeaponAttackStyle =
  | 'wood_slash'
  | 'steel_thrust'
  | 'arcane_sweep'
  | 'dragon_cleave';

export function resolveWeaponAttackStyle(weaponId?: string): HeroWeaponAttackStyle {
  switch (weaponId) {
    case 'sword_steel':
      return 'steel_thrust';
    case 'staff_arcane':
      return 'arcane_sweep';
    case 'blade_dragon':
      return 'dragon_cleave';
    case 'sword_wood':
      return 'wood_slash';
    default: {
      const def = weaponId ? getEquipmentDefinition(weaponId) : undefined;
      switch (def?.weaponFamily) {
        case 'axe_hammer':
          return 'dragon_cleave';
        case 'spear':
        case 'bow_crossbow':
          return 'steel_thrust';
        case 'staff':
          return 'arcane_sweep';
        case 'dagger_claws':
        case 'sword':
        default:
          return 'wood_slash';
      }
    }
  }
}

export interface HeroEarPose {
  leftRotZ: number;
  rightRotZ: number;
  leftScaleY: number;
  rightScaleY: number;
  visibility: number;
}

/**
 * Calcule une animation d'oreilles lente, calme et variée au repos (sans jamais
 * paraître nerveuse ou répétitive), modulée par l'état du héros et par le casque porté.
 */
export function solveHeroEarPose(
  time: number,
  state: HeroAnimState,
  helmetId?: string,
): HeroEarPose {
  const cal = helmetId ? getEquipmentCalibration(helmetId) : null;
  const visibility = cal?.helmetOcclusion?.earVisibility ?? 1.0;

  if (state === 'death') {
    return {
      leftRotZ: 0.34,
      rightRotZ: -0.34,
      leftScaleY: 0.82,
      rightScaleY: 0.82,
      visibility,
    };
  }
  if (state === 'attack' || state === 'roll' || state === 'hurt') {
    // Oreilles légèrement couchées en arrière pendant l'effort / esquive
    return {
      leftRotZ: 0.22,
      rightRotZ: -0.22,
      leftScaleY: 0.9,
      rightScaleY: 0.9,
      visibility,
    };
  }

  // Cadence très lente et asymétrique au repos : cycles longs (~6.5s / 9.2s) + pauses naturelles
  const slowBreath = Math.sin(time * 0.78) * 0.045;
  // Micro-pivot lent d'une seule oreille toutes les ~7 secondes (jamais un tic rapide)
  const leftWindow = Math.max(0, Math.sin(time * 0.43 + 0.6) - 0.72) / 0.28;
  const rightWindow = Math.max(0, Math.sin(time * 0.34 + 3.1) - 0.75) / 0.25;
  const smoothL = leftWindow * leftWindow * (3 - 2 * leftWindow);
  const smoothR = rightWindow * rightWindow * (3 - 2 * rightWindow);

  const walkDamp = state === 'walk' ? 0.55 : 1.0;
  return {
    leftRotZ: (slowBreath + smoothL * 0.14) * walkDamp,
    rightRotZ: (-slowBreath - smoothR * 0.13) * walkDamp,
    leftScaleY: 1 - smoothL * 0.05,
    rightScaleY: 1 - smoothR * 0.05,
    visibility,
  };
}

/**
 * Résout en place les transformations locales hiérarchiques des 16 os du squelette
 * du héros pour tous les états d'animation (`idle`, `walk`, `jump`, `attack`, `roll`,
 * `hurt`, `death`) — zéro allocation par frame.
 * Les rotations sont exprimées dans le repère non-miroir (facing right) ; le miroir
 * gauche/droite est géré proprement par le nœud `rigRoot` parent.
 */
export function solveHeroBoneTransformsInto(
  out: HeroSkeletonPose,
  state: HeroAnimState,
  frameIndex: number,
  frameCount: number,
  options?: {
    blocking?: boolean;
    time?: number;
    weaponId?: string;
    weaponStyle?: HeroWeaponAttackStyle;
    comboStep?: 0 | 1 | 2;
    stridePhase?: number;
    speedRatio?: number;
    deathProgress?: number;
  },
): HeroSkeletonPose {
  const safeCount = Math.max(1, Math.floor(frameCount));
  const clampedFrame = Math.max(0, Math.min(safeCount - 1, Math.floor(frameIndex)));
  const phase = (clampedFrame / safeCount) * Math.PI * 2;
  const prog = safeCount > 1 ? clampedFrame / (safeCount - 1) : 0;
  const blocking = Boolean(options?.blocking);

  // 1. Réinitialisation aux positions de repos exactes de l'arbre d'os
  for (const id of HERO_BONE_ORDER) {
    const spec = HERO_SKELETON_SPEC[id];
    const b = out[id];
    b.x = spec.restX;
    b.y = spec.restY;
    b.z = spec.restZ;
    b.rotZ = 0;
    b.scaleX = 1;
    b.scaleY = 1;
  }

  // 2. Animation hiérarchique par état (chaque enfant hérite naturellement de son parent !)
  if (state === 'idle' || state === 'deck_idle') {
    const idleT = options?.time ?? phase;
    const breath = Math.sin(idleT * 1.85);
    out.pelvis.y += breath * 0.0035;
    out.spine.y += breath * 0.0035;
    out.chest.rotZ = breath * 0.012;
    out.head.rotZ = Math.sin(idleT * 0.72) * 0.022;
    out.rightShoulder.rotZ = breath * 0.026;
    out.rightHand.rotZ = breath * 0.02;
    out.leftShoulder.rotZ = -breath * 0.022;
  } else if (state === 'walk') {
    // Foulée synchronisée à la vitesse réelle de déplacement (plus posée et fluide)
    const walkPhase = options?.stridePhase ?? phase;
    const spd = Math.max(0.15, Math.min(1.15, options?.speedRatio ?? 1.0));
    const stride = Math.sin(walkPhase) * spd;
    const bounce = Math.abs(Math.sin(walkPhase)) * spd;
    out.pelvis.y += bounce * 0.013;
    out.pelvis.rotZ = (-0.032 + Math.sin(walkPhase * 2) * 0.014) * spd;
    out.spine.rotZ = -0.02 * spd;
    out.chest.rotZ = Math.sin(walkPhase) * 0.026 * spd;
    out.head.rotZ = (0.022 - Math.sin(walkPhase) * 0.016) * spd;

    // Foulées alternées des jambes & pieds (cadence naturelle sans agitation excessive)
    out.leftHip.x += stride * 0.028;
    out.leftHip.y += Math.max(0, stride) * 0.02;
    out.leftFoot.rotZ = stride * 0.17;

    out.rightHip.x -= stride * 0.028;
    out.rightHip.y += Math.max(0, -stride) * 0.02;
    out.rightFoot.rotZ = -stride * 0.17;

    // Balancier opposé des bras (bras droit avec jambe gauche)
    out.rightShoulder.x += stride * 0.013;
    out.rightShoulder.rotZ = -0.04 * spd - stride * 0.13;
    out.rightHand.rotZ = -stride * 0.06;

    out.leftShoulder.x -= stride * 0.011;
    out.leftShoulder.rotZ = 0.03 * spd + stride * 0.10;
    out.waist.rotZ = stride * 0.09;
  } else if (state === 'jump') {
    const arc = Math.sin(prog * Math.PI);
    out.pelvis.y += 0.025 + arc * 0.045;
    out.pelvis.rotZ = -0.04 * arc;
    out.chest.rotZ = -0.05 * arc;
    out.head.rotZ = 0.05 * arc;
    out.leftHip.x -= 0.016 * arc;
    out.leftHip.y += 0.032 * arc;
    out.leftFoot.rotZ = -0.22 * arc;
    out.rightHip.x += 0.012 * arc;
    out.rightHip.y += 0.022 * arc;
    out.rightFoot.rotZ = 0.18 * arc;
    out.rightShoulder.y += 0.028 * arc;
    out.rightShoulder.rotZ = 0.34 * arc;
    out.leftShoulder.y += 0.022 * arc;
    out.leftShoulder.rotZ = -0.22 * arc;
  } else if (state === 'attack') {
    const style = options?.weaponStyle ?? resolveWeaponAttackStyle(options?.weaponId);
    const isFinisher = options?.comboStep === 2;

    if (style === 'steel_thrust' && !isFinisher) {
      // Épée d'acier : estoc vif & précis vers l'avant (garde tirée -> pointe projetée)
      if (prog < 0.24) {
        const t = prog / 0.24;
        const ease = t * t;
        out.pelvis.x -= 0.016 * ease;
        out.pelvis.rotZ = 0.05 * ease;
        out.chest.rotZ = 0.07 * ease;
        out.rightShoulder.x -= 0.044 * ease;
        out.rightShoulder.y += 0.018 * ease;
        out.rightShoulder.rotZ = 0.42 * ease;
        out.rightHand.rotZ = 0.62 * ease;
        out.leftShoulder.x -= 0.018 * ease;
      } else if (prog < 0.56) {
        const t = (prog - 0.24) / 0.32;
        const snap = 1 - Math.pow(1 - t, 3);
        out.pelvis.x += -0.016 + 0.052 * snap;
        out.pelvis.rotZ = 0.05 - 0.14 * snap;
        out.spine.rotZ = -0.08 * snap;
        out.chest.rotZ = 0.07 - 0.18 * snap;
        out.head.rotZ = 0.06 * snap;
        out.rightShoulder.x += -0.044 + 0.145 * snap;
        out.rightShoulder.y += 0.018 - 0.016 * snap;
        out.rightShoulder.rotZ = 0.42 - 1.26 * snap;
        out.rightHand.rotZ = 0.62 - 1.18 * snap;
        out.rightFoot.x += 0.036 * snap;
        out.leftFoot.x -= 0.022 * snap;
      } else {
        const t = (prog - 0.56) / 0.44;
        const rem = 1 - (1 - Math.pow(1 - t, 2));
        out.pelvis.x += 0.036 * rem;
        out.pelvis.rotZ = -0.09 * rem;
        out.chest.rotZ = -0.11 * rem;
        out.rightShoulder.x += 0.101 * rem;
        out.rightShoulder.rotZ = -0.84 * rem;
        out.rightHand.rotZ = -0.56 * rem;
        out.rightFoot.x += 0.036 * rem;
        out.leftFoot.x -= 0.022 * rem;
      }
    } else if (style === 'arcane_sweep') {
      // Bâton arcanique : élévation mystique puis balayage large en croissant d'énergie
      if (prog < 0.30) {
        const t = prog / 0.30;
        const ease = t * t;
        out.pelvis.y += 0.018 * ease;
        out.pelvis.rotZ = 0.09 * ease;
        out.chest.rotZ = 0.11 * ease;
        out.head.rotZ = -0.08 * ease;
        out.rightShoulder.x -= 0.022 * ease;
        out.rightShoulder.y += 0.072 * ease;
        out.rightShoulder.rotZ = 0.92 * ease;
        out.rightHand.rotZ = 0.72 * ease;
        out.leftShoulder.y += 0.034 * ease;
        out.leftShoulder.rotZ = -0.26 * ease;
      } else if (prog < 0.64) {
        const t = (prog - 0.30) / 0.34;
        const snap = 1 - Math.pow(1 - t, 2.6);
        out.pelvis.y += 0.018 * (1 - snap * 0.6);
        out.pelvis.x += 0.026 * snap;
        out.pelvis.rotZ = 0.09 - 0.20 * snap;
        out.chest.rotZ = 0.11 - 0.24 * snap;
        out.rightShoulder.x += -0.022 + 0.118 * snap;
        out.rightShoulder.y += 0.072 - 0.068 * snap;
        out.rightShoulder.rotZ = 0.92 - 1.92 * snap;
        out.rightHand.rotZ = 0.72 - 1.38 * snap;
        out.leftShoulder.y += 0.034 * (1 - snap);
      } else {
        const t = (prog - 0.64) / 0.36;
        const rem = 1 - (1 - Math.pow(1 - t, 2));
        out.pelvis.x += 0.026 * rem;
        out.pelvis.rotZ = -0.11 * rem;
        out.chest.rotZ = -0.13 * rem;
        out.rightShoulder.x += 0.096 * rem;
        out.rightShoulder.rotZ = -1.0 * rem;
        out.rightHand.rotZ = -0.66 * rem;
      }
    } else if (style === 'dragon_cleave') {
      // Lame draconique : armement lourd au-dessus de la tête puis grand fendoir enflammé
      if (prog < 0.34) {
        const t = prog / 0.34;
        const ease = t * t;
        out.pelvis.x -= 0.018 * ease;
        out.pelvis.y += 0.012 * ease;
        out.pelvis.rotZ = 0.14 * ease;
        out.spine.rotZ = 0.12 * ease;
        out.chest.rotZ = 0.14 * ease;
        out.head.rotZ = -0.1 * ease;
        out.rightShoulder.x -= 0.048 * ease;
        out.rightShoulder.y += 0.088 * ease;
        out.rightShoulder.rotZ = 1.18 * ease;
        out.rightHand.rotZ = 0.85 * ease;
        out.leftShoulder.x -= 0.022 * ease;
        out.leftShoulder.rotZ = 0.28 * ease;
      } else if (prog < 0.62) {
        const t = (prog - 0.34) / 0.28;
        const snap = 1 - Math.pow(1 - t, 3.4);
        out.pelvis.x += -0.018 + 0.062 * snap;
        out.pelvis.y += 0.012 - 0.028 * snap;
        out.pelvis.rotZ = 0.14 - 0.30 * snap;
        out.spine.rotZ = 0.12 - 0.28 * snap;
        out.chest.rotZ = 0.14 - 0.32 * snap;
        out.head.rotZ = -0.1 + 0.16 * snap;
        out.rightShoulder.x += -0.048 + 0.148 * snap;
        out.rightShoulder.y += 0.088 - 0.126 * snap;
        out.rightShoulder.rotZ = 1.18 - 2.38 * snap;
        out.rightHand.rotZ = 0.85 - 1.62 * snap;
        out.rightFoot.x += 0.042 * snap;
        out.leftFoot.x -= 0.024 * snap;
      } else {
        const t = (prog - 0.62) / 0.38;
        const rem = 1 - (1 - Math.pow(1 - t, 2));
        out.pelvis.x += 0.044 * rem;
        out.pelvis.y -= 0.016 * rem;
        out.pelvis.rotZ = -0.16 * rem;
        out.spine.rotZ = -0.16 * rem;
        out.chest.rotZ = -0.18 * rem;
        out.rightShoulder.x += 0.10 * rem;
        out.rightShoulder.y -= 0.038 * rem;
        out.rightShoulder.rotZ = -1.20 * rem;
        out.rightHand.rotZ = -0.77 * rem;
        out.rightFoot.x += 0.042 * rem;
        out.leftFoot.x -= 0.024 * rem;
      }
    } else if (prog < 0.28) {
      // Épée en bois / coupe classique : préparation arrière
      const t = prog / 0.28;
      const ease = t * t;
      out.pelvis.rotZ = 0.06 * ease;
      out.spine.rotZ = 0.07 * ease;
      out.chest.rotZ = 0.08 * ease;
      out.head.rotZ = -0.06 * ease;
      out.rightShoulder.x -= 0.032 * ease;
      out.rightShoulder.y += 0.046 * ease;
      out.rightShoulder.rotZ = 0.65 * ease;
      out.rightHand.rotZ = 0.55 * ease;
      out.leftShoulder.x -= 0.016 * ease;
      out.leftShoulder.rotZ = 0.14 * ease;
    } else if (prog < 0.58) {
      // Frappe tranchante avant (arc rapide autour du poignet/poignée)
      const t = (prog - 0.28) / 0.30;
      const snap = 1 - Math.pow(1 - t, 3);
      out.pelvis.x += 0.022 * snap;
      out.pelvis.rotZ = 0.06 - 0.14 * snap;
      out.spine.rotZ = 0.07 - 0.15 * snap;
      out.chest.rotZ = 0.08 - 0.16 * snap;
      out.head.rotZ = -0.06 + 0.10 * snap;
      out.rightShoulder.x += -0.032 + 0.095 * snap;
      out.rightShoulder.y += 0.046 - 0.058 * snap;
      out.rightShoulder.rotZ = 0.65 - 1.45 * snap;
      out.rightHand.rotZ = 0.55 - 1.05 * snap;
      out.leftShoulder.x -= 0.016 + 0.014 * snap;
      out.leftShoulder.rotZ = 0.14 - 0.22 * snap;
      out.rightFoot.x += 0.024 * snap;
      out.leftFoot.x -= 0.016 * snap;
    } else {
      // Retour fluide en garde
      const t = (prog - 0.58) / 0.42;
      const ease = 1 - Math.pow(1 - t, 2);
      const rem = 1 - ease;
      out.pelvis.x += 0.022 * rem;
      out.pelvis.rotZ = -0.08 * rem;
      out.spine.rotZ = -0.08 * rem;
      out.chest.rotZ = -0.08 * rem;
      out.head.rotZ = 0.04 * rem;
      out.rightShoulder.x += 0.063 * rem;
      out.rightShoulder.y -= 0.012 * rem;
      out.rightShoulder.rotZ = -0.80 * rem;
      out.rightHand.rotZ = -0.50 * rem;
      out.leftShoulder.x -= 0.030 * rem;
      out.leftShoulder.rotZ = -0.08 * rem;
      out.rightFoot.x += 0.024 * rem;
      out.leftFoot.x -= 0.016 * rem;
    }
  } else if (state === 'roll') {
    // Roulade complète : tous les accessoires tournent en bloc avec le bassin (plus d'objets cachés !)
    const spin = prog * Math.PI * 2;
    const tuck = Math.sin(prog * Math.PI);
    out.pelvis.y += 0.11 * tuck;
    out.pelvis.rotZ = -spin;
    out.pelvis.scaleX = 1 - 0.08 * tuck;
    out.pelvis.scaleY = 1 - 0.10 * tuck;
    out.spine.y -= 0.012 * tuck;
    out.head.y -= 0.06 * tuck;
    out.rightShoulder.x -= 0.03 * tuck;
    out.rightShoulder.rotZ = -0.35 * tuck;
    out.leftShoulder.x += 0.03 * tuck;
    out.leftShoulder.rotZ = 0.35 * tuck;
    out.leftHip.y += 0.03 * tuck;
    out.rightHip.y += 0.03 * tuck;
  } else if (state === 'hurt') {
    const recoil = Math.sin(prog * Math.PI);
    out.pelvis.x -= 0.022 * recoil;
    out.pelvis.rotZ = 0.12 * recoil;
    out.spine.rotZ = 0.09 * recoil;
    out.head.rotZ = 0.14 * recoil;
    out.rightShoulder.rotZ = 0.28 * recoil;
    out.leftShoulder.rotZ = -0.22 * recoil;
  } else if (state === 'death') {
    // Animation de mort travaillée en 3 temps : chancèlement -> chute -> repos au sol
    const dp = Math.max(0, Math.min(1, options?.deathProgress ?? prog));
    if (dp < 0.30) {
      const t = dp / 0.30;
      const ease = 1 - Math.pow(1 - t, 2);
      out.pelvis.x -= 0.024 * ease;
      out.pelvis.y -= 0.026 * ease;
      out.pelvis.rotZ = 0.22 * ease;
      out.chest.rotZ = 0.14 * ease;
      out.head.rotZ = 0.18 * ease;
      out.rightShoulder.rotZ = -0.28 * ease;
      out.leftShoulder.rotZ = 0.24 * ease;
    } else if (dp < 0.72) {
      const t = (dp - 0.30) / 0.42;
      const fall = t * t * (3 - 2 * t);
      out.pelvis.x -= 0.024 + 0.032 * fall;
      out.pelvis.y -= 0.026 + 0.095 * fall;
      out.pelvis.rotZ = 0.22 + 1.12 * fall;
      out.chest.rotZ = 0.14 + 0.10 * fall;
      out.head.rotZ = 0.18 + 0.08 * fall;
      out.rightShoulder.rotZ = -0.28 - 0.68 * fall;
      out.rightHand.rotZ = -0.45 * fall;
      out.leftShoulder.rotZ = 0.24 + 0.34 * fall;
    } else {
      const t = (dp - 0.72) / 0.28;
      const settle = Math.sin(t * Math.PI) * 0.012;
      out.pelvis.x -= 0.056;
      out.pelvis.y -= 0.121 + settle;
      out.pelvis.rotZ = 1.34;
      out.chest.rotZ = 0.24;
      out.head.rotZ = 0.26;
      out.rightShoulder.rotZ = -0.96;
      out.rightHand.rotZ = -0.45;
      out.leftShoulder.rotZ = 0.58;
    }
  }

  // Posture défensive de bouclier (Égide active)
  if (blocking && state !== 'roll' && state !== 'death') {
    out.leftShoulder.x += 0.085;
    out.leftShoulder.y += 0.034;
    out.leftShoulder.z += 0.012;
    out.leftHand.rotZ -= 0.18;
  }

  return out;
}

export type HeroHeadMaskMode = 'none' | 'open_helmet' | 'closed_helmet';

export interface HeroEquipmentMaskState {
  torsoMasked: boolean;
  torsoCenterU: number;
  torsoCenterV: number;
  torsoHalfW: number;
  torsoHalfH: number;
  torsoRotZ: number;
  headMaskMode: HeroHeadMaskMode;
  headMaskEnabled: boolean;
  earVisibility: number;
  headCenterU: number;
  headCenterV: number;
  headHalfW: number;
  headHalfH: number;
  headRotZ: number;
  headBoneV: number;
}

function resolveBoneWorld2D(
  pose: HeroSkeletonPose | undefined,
  chain: readonly HeroBoneId[],
): { x: number; y: number; rotZ: number } {
  let wx = 0;
  let wy = 0;
  let wRot = 0;
  let wScaleX = 1;
  let wScaleY = 1;
  for (let i = 0; i < chain.length; i++) {
    const id = chain[i];
    const b = pose ? pose[id] : undefined;
    const spec = HERO_SKELETON_SPEC[id];
    const lx = b ? b.x : spec.restX;
    const ly = b ? b.y : spec.restY;
    const lRot = b ? b.rotZ : 0;
    const lsx = b ? b.scaleX : 1;
    const lsy = b ? b.scaleY : 1;
    const c = Math.cos(wRot);
    const s = Math.sin(wRot);
    const sx = lx * wScaleX;
    const sy = ly * wScaleY;
    wx += sx * c - sy * s;
    wy += sx * s + sy * c;
    wRot += lRot;
    wScaleX *= lsx;
    wScaleY *= lsy;
  }
  return { x: wx, y: wy, rotZ: wRot };
}

const CHEST_BONE_CHAIN: readonly HeroBoneId[] = ['pelvis', 'spine', 'chest'];
const HEAD_BONE_CHAIN: readonly HeroBoneId[] = ['pelvis', 'spine', 'chest', 'neck', 'head'];

/**
 * Calcule l'état déterministe du masquage anatomique (torse sous plastron,
 * haut du crâne + oreilles sous heaume fermé, oreilles préservées sous casque ouvert).
 * Coordonnées exprimées en espace UV normalisé de cellule [0..1, 0..1] (u gauche->droite, v bas->haut).
 */
export function computeHeroEquipmentMaskState(
  options: {
    equipped: Partial<Record<EquipSlot, string>>;
    heroState?: HeroAnimState;
    bonePose?: HeroSkeletonPose;
    showSocketEquip?: boolean;
  },
  out?: HeroEquipmentMaskState,
): HeroEquipmentMaskState {
  const target: HeroEquipmentMaskState = out ?? {
    torsoMasked: false,
    torsoCenterU: 0.463,
    torsoCenterV: 0.283,
    torsoHalfW: 0.068,
    torsoHalfH: 0.072,
    torsoRotZ: 0,
    headMaskMode: 'none',
    headMaskEnabled: false,
    earVisibility: 1.0,
    headCenterU: 0.449,
    headCenterV: 0.745,
    headHalfW: 0.178,
    headHalfH: 0.158,
    headRotZ: 0,
    headBoneV: 0.657,
  };

  const socketsActive = options.showSocketEquip ?? true;
  const poseUsable = socketsActive;

  const chestW = resolveBoneWorld2D(options.bonePose, CHEST_BONE_CHAIN);
  const headW = resolveBoneWorld2D(options.bonePose, HEAD_BONE_CHAIN);

  const hasArmor = Boolean(options.equipped.armor && getEquipmentCalibration(options.equipped.armor));
  target.torsoMasked = poseUsable && hasArmor;
  target.torsoCenterU = 0.5 + chestW.x;
  target.torsoCenterV = chestW.y;
  target.torsoHalfW = 0.068;
  target.torsoHalfH = 0.072;
  target.torsoRotZ = chestW.rotZ;

  const helmetId = options.equipped.helmet ?? '';
  const helmCal = helmetId ? getEquipmentCalibration(helmetId) : null;
  if (!helmetId || !helmCal) {
    target.headMaskMode = 'none';
    target.headMaskEnabled = false;
    target.earVisibility = 1.0;
  } else {
    const earVis = helmCal.helmetOcclusion?.earVisibility ?? 1.0;
    const isClosed = Boolean(helmCal.carveOpenFaceMask && earVis < 0.5);
    target.headMaskMode = isClosed ? 'closed_helmet' : 'open_helmet';
    target.earVisibility = isClosed ? 0 : earVis;
    target.headMaskEnabled = poseUsable && isClosed;
  }

  // Centre de l'ellipse de masquage décalé vers le haut du crâne + oreilles le long de l'axe de tête
  const headCapLocalY = 0.088;
  const hc = Math.cos(headW.rotZ);
  const hs = Math.sin(headW.rotZ);
  target.headCenterU = 0.5 + headW.x - headCapLocalY * hs;
  target.headCenterV = headW.y + headCapLocalY * hc;
  target.headHalfW = 0.178;
  target.headHalfH = 0.158;
  target.headRotZ = headW.rotZ;
  target.headBoneV = headW.y;

  return target;
}
