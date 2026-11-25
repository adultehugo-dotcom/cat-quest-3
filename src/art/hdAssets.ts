import * as THREE from 'three';

// ============================================================================
// Manifeste, descripteurs d'animations multi-frames 30 FPS & chargeur HD local
// - Zéro URL distante, zéro 404 : seules les ressources réellement présentes
//   dans `public/assets/` sont chargées par défaut.
// - Rétrocompatibilité 100 % transparente : tant qu'un PNG actuel (ex: 512×512
//   unitaire ou 1024×256 4 colonnes) n'est pas remplacé par une planche
//   multi-frames, `resolveActiveSpriteGrid` lit exactement sa géométrie legacy.
// - Zéro allocation par frame : tous les calculs de curseur temporel et d'UV
//   (`repeat`/`offset`) mutent des structures pré-allouées réutilisables.
// ============================================================================

export const TARGET_ANIMATION_FPS = 30;

export type HdCharacterKey =
  | 'hero_base_idle'
  | 'hero_base_walk1'
  | 'hero_base_walk2'
  | 'hero_base_attack'
  | 'hero_base_roll'
  | 'hero_portrait'
  | 'miaou_sprit'
  | 'mayor_moustache'
  | 'kit_chat'
  | 'innkeeper'
  | 'slime_yarn'
  | 'mouse_goblin'
  | 'thorn_wolf'
  | 'fishbone_skeleton'
  | 'frost_golem'
  | 'boss_rat_king'
  | 'boss_dragon_claw';

export type HdEnemySheetKey =
  | 'slime_yarn'
  | 'mouse_goblin'
  | 'thorn_wolf'
  | 'fishbone_skeleton'
  | 'frost_golem'
  | 'boss_rat_king'
  | 'boss_dragon_claw';

export type HdEquipmentKey =
  | 'armor_tunic'
  | 'armor_mail'
  | 'armor_robe'
  | 'armor_dragon'
  | 'helm_bandana'
  | 'helm_knight'
  | 'helm_mage'
  | 'helm_dragon'
  | 'sword_wood'
  | 'sword_steel'
  | 'staff_arcane'
  | 'blade_dragon'
  | 'shield_wood'
  | 'shield_knight'
  | 'trinket_yarn'
  | 'boots_leather'
  | 'boots_iron'
  | 'boots_arcane'
  | 'boots_dragon'
  | 'gloves_leather'
  | 'gloves_iron'
  | 'gloves_arcane'
  | 'gloves_dragon'
  | 'cape_traveler'
  | 'cape_knight'
  | 'cape_starlight'
  | 'cape_dragon';

export type HdCapeKey =
  | 'cape_traveler'
  | 'cape_knight'
  | 'cape_starlight'
  | 'cape_dragon';

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
  | 'prop_rock'
  | 'prop_rock_snow'
  | 'prop_flower_patch'
  | 'prop_mushroom'
  | 'prop_signpost'
  | 'prop_fence';

export type HdSurfaceKey =
  | 'grass'
  | 'forest'
  | 'snow'
  | 'path'
  | 'dungeon_ghost'
  | 'dungeon_dragon';

export type HdPbrChannel = 'albedo' | 'normal' | 'roughness';

export type HeroAnimState =
  | 'idle'
  | 'walk'
  | 'attack'
  | 'roll'
  | 'hurt'
  | 'death'
  | 'deck_idle'
  | 'jump';

export type NpcId = 'miaou_sprit' | 'mayor_moustache' | 'kit_chat' | 'innkeeper';

export type NpcAnimState = 'idle' | 'move' | 'talk';

export type EnemyAnimState =
  | 'idle'
  | 'move'
  | 'windup'
  | 'attack'
  | 'hurt'
  | 'death';

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

// ============================================================================
// Contrats du lecteur d'animations 2D multi-frames (grilles régulières & séquences)
// ============================================================================

export interface SpriteGridSpec {
  /** Nombre de colonnes de la planche (>= 1) */
  readonly cols: number;
  /** Nombre de lignes de la planche (>= 1) */
  readonly rows: number;
  /** Nombre exact de frames distinctes utiles (<= cols * rows - startFrame) */
  readonly frameCount: number;
  /** Indice de cellule initial dans la grille en ordre ligne-majeure (défaut: 0) */
  readonly startFrame?: number;
  /** Largeur nominale d'une cellule en pixels (ex: 256 ou 512) */
  readonly cellWidth?: number;
  /** Hauteur nominale d'une cellule en pixels (ex: 256 ou 512) */
  readonly cellHeight?: number;
}

export interface SpritePivotFootprint {
  /** Pivot horizontal normalisé [0..1] (0.5 = centré) */
  readonly pivotX: number;
  /** Pivot vertical géométrique [0..1] (0.0 = base du quad posée au sol y=0) */
  readonly pivotY: number;
  /** Ligne de contact des pieds normalisée depuis le haut de la cellule [0..1] */
  readonly groundLineRatio: number;
}

export interface SpriteAnimClipDescriptor {
  readonly id: string;
  /** Cadence cible en images/seconde (30 FPS standard) */
  readonly fps: number;
  /** true = boucle continue, false = lecture ponctuelle s'arrêtant sur la dernière frame */
  readonly loop: boolean;
  /** Grille cible pour les nouvelles spritesheets multi-frames (15, 24, 30, 45 frames) */
  readonly targetGrid: SpriteGridSpec;
  /** Grille legacy correspondant aux PNG actuellement présents sur disque */
  readonly legacyGrid: SpriteGridSpec;
  /** Séquence explicite de clés unitaires si l'état assemble plusieurs fichiers (ex: walk1/walk2) */
  readonly frameSequenceKeys?: readonly HdCharacterKey[];
  /** État source explicite lorsqu'un état partage volontairement l'animation d'un autre */
  readonly sharedFrom?: string;
  /** Justification documentée du partage d'état ou du repli visuel */
  readonly sharedReason?: string;
  /** Pivot et ligne de sol constants sur toutes les frames de l'entité */
  readonly pivot: SpritePivotFootprint;
  /** Vrai lorsque la direction gauche/droite est gérée par flipX (`scale.x` signé) */
  readonly lateralFlipOnly: boolean;
}

export interface SpriteUvRect {
  repeatX: number;
  repeatY: number;
  offsetX: number;
  offsetY: number;
  col: number;
  row: number;
  frameIndex: number;
}

export interface SpriteAnimCursor {
  clipId: string;
  elapsed: number;
  frameIndex: number;
  finished: boolean;
}

const HERO_PIVOT: SpritePivotFootprint = {
  pivotX: 0.5,
  pivotY: 0,
  groundLineRatio: 446 / 512,
};

const NPC_PIVOT: SpritePivotFootprint = {
  pivotX: 0.5,
  pivotY: 0,
  groundLineRatio: 472 / 512,
};

const COMPANION_PIVOT: SpritePivotFootprint = {
  pivotX: 0.5,
  pivotY: 0,
  groundLineRatio: 0.5,
};

const ENEMY_PIVOT: SpritePivotFootprint = {
  pivotX: 0.5,
  pivotY: 0,
  groundLineRatio: 238 / 256,
};

/**
 * Descripteurs d'animation 30 FPS du héros Chat-valier.
 * Note sur l'éclairage extérieur : la lanterne est une source dynamique `PointLight`
 * + uniforme local slot 8 (`EntityRenderer.playerLanternLight`) indépendante du sprite,
 * garantissant zéro halo peint dans la fourrure.
 */
export const HERO_ANIM_CLIPS: Readonly<Record<HeroAnimState, SpriteAnimClipDescriptor>> = {
  idle: {
    id: 'hero_idle',
    fps: TARGET_ANIMATION_FPS,
    loop: true,
    targetGrid: { cols: 6, rows: 5, frameCount: 30, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
  walk: {
    id: 'hero_walk',
    fps: TARGET_ANIMATION_FPS,
    loop: true,
    targetGrid: { cols: 6, rows: 5, frameCount: 30, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    frameSequenceKeys: ['hero_base_walk1', 'hero_base_walk2'],
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
  attack: {
    id: 'hero_attack',
    fps: TARGET_ANIMATION_FPS,
    loop: false,
    targetGrid: { cols: 5, rows: 3, frameCount: 15, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
  roll: {
    id: 'hero_roll',
    fps: TARGET_ANIMATION_FPS,
    loop: false,
    targetGrid: { cols: 5, rows: 3, frameCount: 15, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
  hurt: {
    id: 'hero_hurt',
    fps: TARGET_ANIMATION_FPS,
    loop: false,
    targetGrid: { cols: 5, rows: 3, frameCount: 15, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    sharedFrom: 'idle',
    sharedReason:
      'Partage explicite avec idle accompagné du flash HDR hitFlashTimer tant qu’aucune planche hero_base_hurt dédiée n’est chargée.',
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
  death: {
    id: 'hero_death',
    fps: TARGET_ANIMATION_FPS,
    loop: false,
    targetGrid: { cols: 6, rows: 5, frameCount: 30, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    sharedFrom: 'roll',
    sharedReason:
      'Partage explicite avec la posture basse roll maintenue sur sa dernière frame en écran défaite tant qu’aucune planche hero_base_death dédiée n’est chargée.',
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
  deck_idle: {
    id: 'hero_deck_idle',
    fps: TARGET_ANIMATION_FPS,
    loop: true,
    targetGrid: { cols: 6, rows: 5, frameCount: 30, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    sharedFrom: 'idle',
    sharedReason:
      'Posture marine à la barre réutilisant idle avec compensation du roulis de pont.',
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
  jump: {
    id: 'hero_jump',
    fps: TARGET_ANIMATION_FPS,
    loop: false,
    targetGrid: { cols: 5, rows: 3, frameCount: 15, cellWidth: 512, cellHeight: 512 },
    legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
    sharedFrom: 'walk',
    sharedReason:
      'Arc parabolique embarquement/débarquement réutilisant la foulée dynamique walk.',
    pivot: HERO_PIVOT,
    lateralFlipOnly: true,
  },
};

function buildNpcClipSet(
  npcId: NpcId,
  isFloatingCompanion: boolean,
  movesInWorld: boolean,
): Readonly<Record<NpcAnimState, SpriteAnimClipDescriptor>> {
  const pivot = isFloatingCompanion ? COMPANION_PIVOT : NPC_PIVOT;
  return {
    idle: {
      id: `${npcId}_idle`,
      fps: TARGET_ANIMATION_FPS,
      loop: true,
      targetGrid: { cols: 6, rows: 5, frameCount: 30, cellWidth: 512, cellHeight: 512 },
      legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
      pivot,
      lateralFlipOnly: true,
    },
    move: {
      id: `${npcId}_move`,
      fps: TARGET_ANIMATION_FPS,
      loop: true,
      targetGrid: { cols: 6, rows: 4, frameCount: 24, cellWidth: 512, cellHeight: 512 },
      legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
      sharedFrom: 'idle',
      sharedReason: movesInWorld
        ? 'Flottaison de suivi réutilisant idle tant qu’aucune planche move séparée n’est fournie.'
        : 'PNJ stationnaire dans le monde (aucun déplacement locomoteur actif).',
      pivot,
      lateralFlipOnly: true,
    },
    talk: {
      id: `${npcId}_talk`,
      fps: TARGET_ANIMATION_FPS,
      loop: true,
      targetGrid: { cols: 6, rows: 5, frameCount: 30, cellWidth: 512, cellHeight: 512 },
      legacyGrid: { cols: 1, rows: 1, frameCount: 1, cellWidth: 512, cellHeight: 512 },
      sharedFrom: 'idle',
      sharedReason:
        'Dialogue interactif réutilisant idle tant qu’aucune planche talk dédiée n’est fournie.',
      pivot,
      lateralFlipOnly: true,
    },
  };
}

/**
 * Descripteurs d'animation 30 FPS des PNJ & du compagnon :
 * - `miaou_sprit` : compagnon flottant 3D + interlocuteur de dialogue (idle, suivi move, parole talk).
 * - `mayor_moustache` : PNJ 3D stationnaire à Miaou-bourg + portrait dialogue.
 * - `kit_chat` & `innkeeper` : interlocuteurs Forge / Auberge + support sprite PNJ 3D.
 */
export const NPC_ANIM_CLIPS: Readonly<
  Record<NpcId, Readonly<Record<NpcAnimState, SpriteAnimClipDescriptor>>>
> = {
  miaou_sprit: buildNpcClipSet('miaou_sprit', true, true),
  mayor_moustache: buildNpcClipSet('mayor_moustache', false, false),
  kit_chat: buildNpcClipSet('kit_chat', false, false),
  innkeeper: buildNpcClipSet('innkeeper', false, false),
};

function buildEnemyClipSet(
  typeId: HdEnemySheetKey,
  isBoss: boolean,
): Readonly<Record<EnemyAnimState, SpriteAnimClipDescriptor>> {
  const idleFrames = isBoss ? 45 : 30;
  const idleGrid: SpriteGridSpec = isBoss
    ? { cols: 9, rows: 5, frameCount: 45, cellWidth: 256, cellHeight: 256 }
    : { cols: 6, rows: 5, frameCount: 30, cellWidth: 256, cellHeight: 256 };
  const moveGrid: SpriteGridSpec = isBoss
    ? { cols: 6, rows: 5, frameCount: 30, cellWidth: 256, cellHeight: 256 }
    : { cols: 6, rows: 4, frameCount: 24, cellWidth: 256, cellHeight: 256 };
  const actionGrid: SpriteGridSpec = isBoss
    ? { cols: 6, rows: 5, frameCount: 30, cellWidth: 256, cellHeight: 256 }
    : { cols: 5, rows: 3, frameCount: 15, cellWidth: 256, cellHeight: 256 };
  const deathGrid: SpriteGridSpec = isBoss
    ? { cols: 9, rows: 5, frameCount: 45, cellWidth: 256, cellHeight: 256 }
    : { cols: 6, rows: 5, frameCount: idleFrames, cellWidth: 256, cellHeight: 256 };

  return {
    idle: {
      id: `${typeId}_idle`,
      fps: TARGET_ANIMATION_FPS,
      loop: true,
      targetGrid: idleGrid,
      legacyGrid: {
        cols: 4,
        rows: 1,
        frameCount: 1,
        startFrame: 0,
        cellWidth: 256,
        cellHeight: 256,
      },
      pivot: ENEMY_PIVOT,
      lateralFlipOnly: true,
    },
    move: {
      id: `${typeId}_move`,
      fps: TARGET_ANIMATION_FPS,
      loop: true,
      targetGrid: moveGrid,
      legacyGrid: {
        cols: 4,
        rows: 1,
        frameCount: 1,
        startFrame: 1,
        cellWidth: 256,
        cellHeight: 256,
      },
      pivot: ENEMY_PIVOT,
      lateralFlipOnly: true,
    },
    windup: {
      id: `${typeId}_windup`,
      fps: TARGET_ANIMATION_FPS,
      loop: false,
      targetGrid: actionGrid,
      legacyGrid: {
        cols: 4,
        rows: 1,
        frameCount: 1,
        startFrame: 2,
        cellWidth: 256,
        cellHeight: 256,
      },
      pivot: ENEMY_PIVOT,
      lateralFlipOnly: true,
    },
    attack: {
      id: `${typeId}_attack`,
      fps: TARGET_ANIMATION_FPS,
      loop: false,
      targetGrid: actionGrid,
      legacyGrid: {
        cols: 4,
        rows: 1,
        frameCount: 1,
        startFrame: 3,
        cellWidth: 256,
        cellHeight: 256,
      },
      pivot: ENEMY_PIVOT,
      lateralFlipOnly: true,
    },
    hurt: {
      id: `${typeId}_hurt`,
      fps: TARGET_ANIMATION_FPS,
      loop: false,
      targetGrid: { cols: 5, rows: 3, frameCount: 15, cellWidth: 256, cellHeight: 256 },
      legacyGrid: {
        cols: 4,
        rows: 1,
        frameCount: 1,
        startFrame: 0,
        cellWidth: 256,
        cellHeight: 256,
      },
      sharedFrom: 'idle',
      sharedReason:
        'Partage explicite avec idle accompagné du flash blanc HDR hitFlashTimer tant qu’aucune planche hurt dédiée n’est fournie.',
      pivot: ENEMY_PIVOT,
      lateralFlipOnly: true,
    },
    death: {
      id: `${typeId}_death`,
      fps: TARGET_ANIMATION_FPS,
      loop: false,
      targetGrid: deathGrid,
      legacyGrid: {
        cols: 4,
        rows: 1,
        frameCount: 1,
        startFrame: 3,
        cellWidth: 256,
        cellHeight: 256,
      },
      sharedFrom: 'attack',
      sharedReason:
        'Masquage immédiat à PV <= 0 tant qu’aucune séquence death dédiée multi-frames n’est fournie.',
      pivot: ENEMY_PIVOT,
      lateralFlipOnly: true,
    },
  };
}

/**
 * Descripteurs d'animation 30 FPS pour les 7 archétypes d'ennemis et boss
 * (incluant `boss_dragon_claw` compatible Phase 1 & Phase 2).
 */
export const ENEMY_ANIM_CLIPS: Readonly<
  Record<HdEnemySheetKey, Readonly<Record<EnemyAnimState, SpriteAnimClipDescriptor>>>
> = {
  slime_yarn: buildEnemyClipSet('slime_yarn', false),
  mouse_goblin: buildEnemyClipSet('mouse_goblin', false),
  thorn_wolf: buildEnemyClipSet('thorn_wolf', false),
  fishbone_skeleton: buildEnemyClipSet('fishbone_skeleton', false),
  frost_golem: buildEnemyClipSet('frost_golem', false),
  boss_rat_king: buildEnemyClipSet('boss_rat_king', true),
  boss_dragon_claw: buildEnemyClipSet('boss_dragon_claw', true),
};

// ============================================================================
// Manifestes de fichiers locaux (public/assets/) — Zéro 404
// ============================================================================

export const HD_CHARACTER_FILES: Partial<Record<HdCharacterKey, string>> = {
  hero_base_idle: 'assets/characters/hero_base_idle.png',
  hero_base_walk1: 'assets/characters/hero_base_walk1.png',
  hero_base_walk2: 'assets/characters/hero_base_walk2.png',
  hero_base_attack: 'assets/characters/hero_base_attack.png',
  hero_base_roll: 'assets/characters/hero_base_roll.png',
  hero_portrait: 'assets/characters/hero_portrait.png',
  miaou_sprit: 'assets/characters/miaou_sprit.png',
  mayor_moustache: 'assets/characters/mayor_moustache.png',
  kit_chat: 'assets/characters/kit_chat.png',
  innkeeper: 'assets/characters/innkeeper.png',
  slime_yarn: 'assets/characters/slime_yarn.png',
  mouse_goblin: 'assets/characters/mouse_goblin.png',
  thorn_wolf: 'assets/characters/thorn_wolf.png',
  fishbone_skeleton: 'assets/characters/fishbone_skeleton.png',
  frost_golem: 'assets/characters/frost_golem.png',
  boss_rat_king: 'assets/characters/boss_rat_king.png',
  boss_dragon_claw: 'assets/characters/boss_dragon_claw.png',
};

/** Spritesheets d'ennemis (legacy 1024×256 4×1 ou atlas multi-frames 30 FPS) */
export const HD_ENEMY_SHEET_FILES: Record<HdEnemySheetKey, string> = {
  slime_yarn: 'assets/characters/slime_yarn_sheet.png',
  mouse_goblin: 'assets/characters/mouse_goblin_sheet.png',
  thorn_wolf: 'assets/characters/thorn_wolf_sheet.png',
  fishbone_skeleton: 'assets/characters/fishbone_skeleton_sheet.png',
  frost_golem: 'assets/characters/frost_golem_sheet.png',
  boss_rat_king: 'assets/characters/boss_rat_king_sheet.png',
  boss_dragon_claw: 'assets/characters/boss_dragon_claw_sheet.png',
};

/** Planches multi-frames dédiées par état du héros (vide tant que non générées -> zéro 404) */
export const HD_HERO_SHEET_FILES: Partial<Record<HeroAnimState, string>> = {};

/** Planches multi-frames dédiées par pièce d'équipement (vide tant que non générées -> zéro 404) */
export const HD_EQUIPMENT_SHEET_FILES: Partial<
  Record<HdEquipmentKey, Partial<Record<HeroAnimState, string>>>
> = {};

/** Planches multi-frames dédiées par PNJ/état (vide tant que non générées -> zéro 404) */
export const HD_NPC_SHEET_FILES: Partial<
  Record<NpcId, Partial<Record<NpcAnimState, string>>>
> = {};

/** Planches multi-frames dédiées par ennemi/état (vide tant que non générées -> zéro 404) */
export const HD_ENEMY_STATE_SHEET_FILES: Partial<
  Record<HdEnemySheetKey, Partial<Record<EnemyAnimState, string>>>
> = {};

/** Planche Phase 2 dédiée optionnelle pour les boss à transformation (ex: boss_dragon_claw) */
export const HD_ENEMY_PHASE2_SHEET_FILES: Partial<Record<HdEnemySheetKey, string>> = {};

/** Textures planes de tissu de cape dédiées au maillage Verlet 3D (vide par défaut -> zéro 404) */
export const HD_CAPE_FABRIC_FILES: Partial<Record<HdCapeKey, string>> = {};

/** Pièces d'équipement modulaires externes séparées (8 emplacements actifs, aucune arme secondaire) */
export const HD_EQUIPMENT_FILES: Record<HdEquipmentKey, string> = {
  armor_tunic: 'assets/equipment/armor_tunic.png',
  armor_mail: 'assets/equipment/armor_mail.png',
  armor_robe: 'assets/equipment/armor_robe.png',
  armor_dragon: 'assets/equipment/armor_dragon.png',
  helm_bandana: 'assets/equipment/helm_bandana.png',
  helm_knight: 'assets/equipment/helm_knight.png',
  helm_mage: 'assets/equipment/helm_mage.png',
  helm_dragon: 'assets/equipment/helm_dragon.png',
  sword_wood: 'assets/equipment/sword_wood.png',
  sword_steel: 'assets/equipment/sword_steel.png',
  staff_arcane: 'assets/equipment/staff_arcane.png',
  blade_dragon: 'assets/equipment/blade_dragon.png',
  shield_wood: 'assets/equipment/shield_wood.png',
  shield_knight: 'assets/equipment/shield_knight.png',
  trinket_yarn: 'assets/equipment/trinket_yarn.png',
  boots_leather: 'assets/equipment/boots_leather.png',
  boots_iron: 'assets/equipment/boots_iron.png',
  boots_arcane: 'assets/equipment/boots_arcane.png',
  boots_dragon: 'assets/equipment/boots_dragon.png',
  gloves_leather: 'assets/equipment/gloves_leather.png',
  gloves_iron: 'assets/equipment/gloves_iron.png',
  gloves_arcane: 'assets/equipment/gloves_arcane.png',
  gloves_dragon: 'assets/equipment/gloves_dragon.png',
  cape_traveler: 'assets/equipment/cape_traveler.png',
  cape_knight: 'assets/equipment/cape_knight.png',
  cape_starlight: 'assets/equipment/cape_starlight.png',
  cape_dragon: 'assets/equipment/cape_dragon.png',
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
  prop_rock_snow: 'assets/props/prop_rock_snow.png',
  prop_flower_patch: 'assets/props/prop_flower_patch.png',
  prop_mushroom: 'assets/props/prop_mushroom.png',
  prop_signpost: 'assets/props/prop_signpost.png',
  prop_fence: 'assets/props/prop_fence.png',
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

// ============================================================================
// Fonctions pures sans allocation pour la lecture de grilles & séquences 30 FPS
// ============================================================================

export function normalizeSpriteGridSpec(grid: SpriteGridSpec): SpriteGridSpec {
  const cols = Math.max(1, Math.floor(grid.cols));
  const rows = Math.max(1, Math.floor(grid.rows));
  const capacity = cols * rows;
  const startFrame = Math.max(0, Math.min(capacity - 1, Math.floor(grid.startFrame ?? 0)));
  const maxFrames = Math.max(1, capacity - startFrame);
  const frameCount = Math.max(1, Math.min(maxFrames, Math.floor(grid.frameCount)));
  return {
    cols,
    rows,
    frameCount,
    startFrame,
    cellWidth: grid.cellWidth,
    cellHeight: grid.cellHeight,
  };
}

/**
 * Lit les dimensions `(width, height)` d'une `THREE.Texture` quelle que soit la nature
 * de son image sous-jacente (`HTMLImageElement`, `HTMLCanvasElement`, `DataTexture`, etc.).
 */
export function getTextureDimensions(
  tex: THREE.Texture | null | undefined,
): { width: number; height: number } | null {
  if (!tex || !tex.image) return null;
  const img = tex.image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const width = img.naturalWidth || img.width || 0;
  const height = img.naturalHeight || img.height || 0;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/**
 * Détermine automatiquement la grille active d'un clip selon les dimensions réelles
 * de la texture chargée, garantissant une rétrocompatibilité 100 % transparente avec
 * les PNG existants tant qu'une spritesheet multi-frames ne les a pas remplacés.
 */
export function resolveActiveSpriteGrid(
  clip: SpriteAnimClipDescriptor,
  imageWidth: number,
  imageHeight: number,
  explicitOverride?: SpriteGridSpec,
): SpriteGridSpec {
  if (explicitOverride) {
    return normalizeSpriteGridSpec(explicitOverride);
  }

  const legacy = normalizeSpriteGridSpec(clip.legacyGrid);
  if (imageWidth <= 0 || imageHeight <= 0) {
    return legacy;
  }

  const target = normalizeSpriteGridSpec(clip.targetGrid);
  const legCellW = legacy.cellWidth ?? 256;
  const legCellH = legacy.cellHeight ?? 256;

  // 1. Détection exacte des formats legacy sur disque (ex: 512×512 unitaire ou 1024×256 4×1)
  if (
    imageWidth === legacy.cols * legCellW &&
    imageHeight === legacy.rows * legCellH &&
    (legacy.cols !== target.cols || legacy.rows !== target.rows)
  ) {
    return legacy;
  }
  if (
    legacy.cols === 1 &&
    legacy.rows === 1 &&
    imageWidth === imageHeight &&
    target.cols * target.rows > 1
  ) {
    return {
      cols: 1,
      rows: 1,
      frameCount: 1,
      startFrame: 0,
      cellWidth: imageWidth,
      cellHeight: imageHeight,
    };
  }
  if (
    legacy.cols === 4 &&
    legacy.rows === 1 &&
    imageHeight > 0 &&
    imageWidth === imageHeight * 4 &&
    target.rows > 1
  ) {
    return {
      ...legacy,
      cellWidth: Math.floor(imageWidth / 4),
      cellHeight: imageHeight,
    };
  }

  // 2. Correspondance directe avec la grille cible (conserve frameCount exact, ex: 15 dans 5×3 ou 4×4)
  if (
    imageWidth % target.cols === 0 &&
    imageHeight % target.rows === 0 &&
    imageWidth / target.cols === imageHeight / target.rows
  ) {
    return {
      ...target,
      cellWidth: imageWidth / target.cols,
      cellHeight: imageHeight / target.rows,
    };
  }

  // 3. Inférence générique à partir de la taille nominale de cellule (ex: cellules 512×512 ou 256×256)
  const nomW = target.cellWidth ?? legCellW;
  const nomH = target.cellHeight ?? legCellH;
  if (nomW > 0 && nomH > 0 && imageWidth % nomW === 0 && imageHeight % nomH === 0) {
    const inferredCols = Math.max(1, imageWidth / nomW);
    const inferredRows = Math.max(1, imageHeight / nomH);
    const capacity = inferredCols * inferredRows;
    if (capacity >= 2) {
      const desiredFrames =
        inferredCols === target.cols && inferredRows === target.rows
          ? target.frameCount
          : capacity;
      return {
        cols: inferredCols,
        rows: inferredRows,
        frameCount: Math.min(capacity, desiredFrames),
        startFrame: 0,
        cellWidth: nomW,
        cellHeight: nomH,
      };
    }
  }

  return legacy;
}

const ENEMY_ATLAS_ROW_ORDER: readonly EnemyAnimState[] = [
  'idle',
  'move',
  'windup',
  'attack',
  'hurt',
  'death',
];

/**
 * Résout la sous-grille d'un état ennemi sur une spritesheet partagée :
 * - Planche legacy `1024×256` (`4×1`) -> 1 colonne dédiée par état (`idle=0, move=1, windup=2, attack=3`).
 * - Planche atlas multi-lignes (`rows >= 4, cols >= 2` à cellules carrées) -> 1 ligne complète par état.
 * - Planche mono-séquence -> déléguée à `resolveActiveSpriteGrid`.
 */
export function resolveEnemyAtlasStateGrid(
  typeId: HdEnemySheetKey,
  state: EnemyAnimState,
  imageWidth: number,
  imageHeight: number,
  explicitOverride?: SpriteGridSpec,
): SpriteGridSpec {
  if (explicitOverride) {
    return normalizeSpriteGridSpec(explicitOverride);
  }
  const clip = ENEMY_ANIM_CLIPS[typeId][state];
  const resolvedState: EnemyAnimState =
    clip.sharedFrom && clip.sharedFrom in ENEMY_ANIM_CLIPS[typeId]
      ? (clip.sharedFrom as EnemyAnimState)
      : state;
  const effectiveClip = ENEMY_ANIM_CLIPS[typeId][resolvedState];

  if (imageWidth <= 0 || imageHeight <= 0) {
    return normalizeSpriteGridSpec(effectiveClip.legacyGrid);
  }

  // Bande horizontale legacy 4 poses (1024×256 ou équivalent 4:1)
  if (imageWidth === imageHeight * 4) {
    const cell = imageHeight;
    return {
      ...normalizeSpriteGridSpec(effectiveClip.legacyGrid),
      cellWidth: cell,
      cellHeight: cell,
    };
  }

  // Atlas 90 cellules empaqueté (30f idle + 30f move + 15f windup + 15f attack, ex: 10×9 ou 15×6)
  for (const candidateCell of [512, 256, 192, 128, 64]) {
    if (imageWidth % candidateCell === 0 && imageHeight % candidateCell === 0) {
      const cols = imageWidth / candidateCell;
      const rows = imageHeight / candidateCell;
      if (cols * rows === 90) {
        const sliceMap: Record<EnemyAnimState, { startFrame: number; frameCount: number }> = {
          idle: { startFrame: 0, frameCount: 30 },
          move: { startFrame: 30, frameCount: 30 },
          windup: { startFrame: 60, frameCount: 15 },
          attack: { startFrame: 75, frameCount: 15 },
          hurt: { startFrame: 0, frameCount: 15 },
          death: { startFrame: 75, frameCount: 15 },
        };
        const slice = sliceMap[state];
        return {
          cols,
          rows,
          frameCount: slice.frameCount,
          startFrame: slice.startFrame,
          cellWidth: candidateCell,
          cellHeight: candidateCell,
        };
      }
      if (cols >= 2 && rows >= 4) {
        const requestedIdx = ENEMY_ATLAS_ROW_ORDER.indexOf(state);
        const fallbackIdx = ENEMY_ATLAS_ROW_ORDER.indexOf(resolvedState);
        const rowIdx =
          requestedIdx >= 0 && requestedIdx < rows
            ? requestedIdx
            : Math.max(0, Math.min(rows - 1, fallbackIdx));
        return {
          cols,
          rows,
          frameCount: cols,
          startFrame: rowIdx * cols,
          cellWidth: candidateCell,
          cellHeight: candidateCell,
        };
      }
    }
  }

  return resolveActiveSpriteGrid(effectiveClip, imageWidth, imageHeight);
}

export function createSpriteAnimCursor(initialClipId = 'idle'): SpriteAnimCursor {
  return {
    clipId: initialClipId,
    elapsed: 0,
    frameIndex: 0,
    finished: false,
  };
}

export function createSpriteUvRect(): SpriteUvRect {
  return {
    repeatX: 1,
    repeatY: 1,
    offsetX: 0,
    offsetY: 0,
    col: 0,
    row: 0,
    frameIndex: 0,
  };
}

/**
 * Avance un curseur d'animation sans aucune allocation mémoire :
 * - `loop: true` : boucle proprement modulo la durée du cycle complet.
 * - `loop: false` : progresse jusqu'à `frameCount - 1`, s'y arrête net et lève `finished = true`.
 */
export function advanceSpriteAnimCursor(
  cursor: SpriteAnimCursor,
  clip: Pick<SpriteAnimClipDescriptor, 'id' | 'fps' | 'loop'>,
  activeFrameCount: number,
  dt: number,
  fpsOverride?: number,
): number {
  const count = Math.max(1, Math.floor(activeFrameCount));
  const fps =
    fpsOverride !== undefined && fpsOverride > 0
      ? fpsOverride
      : clip.fps > 0
        ? clip.fps
        : TARGET_ANIMATION_FPS;

  if (cursor.clipId !== clip.id) {
    cursor.clipId = clip.id;
    cursor.elapsed = 0;
    cursor.frameIndex = 0;
    cursor.finished = false;
  }

  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0;
  cursor.elapsed += safeDt;

  const cycleDuration = count / fps;
  if (clip.loop) {
    if (cycleDuration > 0 && cursor.elapsed >= cycleDuration) {
      cursor.elapsed %= cycleDuration;
    }
    const rawIdx = Math.floor(cursor.elapsed * fps + 1e-6);
    cursor.frameIndex = count > 1 ? ((rawIdx % count) + count) % count : 0;
    cursor.finished = false;
    return cursor.frameIndex;
  }

  // Mode ponctuel (loop: false) : progression monotone jusqu'à la dernière frame incluse
  const rawIdx = Math.floor(cursor.elapsed * fps + 1e-6);
  if (rawIdx >= count - 1) {
    cursor.frameIndex = count - 1;
    cursor.finished = cursor.elapsed >= cycleDuration - 1e-6;
  } else {
    cursor.frameIndex = Math.max(0, rawIdx);
    cursor.finished = false;
  }
  return cursor.frameIndex;
}

/**
 * Échantillonne sans allocation une frame ponctuelle (`loop: false`) pilotée par une
 * progression normalisée `[0..1]` (attaque, roulade, impact, télégraphe).
 */
export function sampleOneShotProgressFrame(
  progress01: number,
  activeFrameCount: number,
): number {
  const count = Math.max(1, Math.floor(activeFrameCount));
  if (count <= 1) return 0;
  const p = Number.isFinite(progress01) ? Math.max(0, Math.min(1, progress01)) : 0;
  if (p >= 1) return count - 1;
  return Math.max(0, Math.min(count - 1, Math.floor(p * count + 1e-6)));
}

/**
 * Calcule sans allocation les coordonnées `(col, row)` en ordre ligne-majeure exact
 * (gauche -> droite, haut -> bas) et les paramètres UV Three.js (`repeat`, `offset`) dans `out`.
 */
export function computeGridFrameUvInto(
  grid: SpriteGridSpec,
  localFrameIndex: number,
  out: SpriteUvRect,
  flipY = true,
): SpriteUvRect {
  const cols = Math.max(1, Math.floor(grid.cols));
  const rows = Math.max(1, Math.floor(grid.rows));
  const capacity = cols * rows;
  const start = Math.max(0, Math.min(capacity - 1, Math.floor(grid.startFrame ?? 0)));
  const count = Math.max(1, Math.min(capacity - start, Math.floor(grid.frameCount)));
  const clampedLocal = Number.isFinite(localFrameIndex)
    ? Math.max(0, Math.min(count - 1, Math.floor(localFrameIndex)))
    : 0;

  const absCell = start + clampedLocal;
  const col = absCell % cols;
  const row = Math.floor(absCell / cols);
  const repeatX = 1 / cols;
  const repeatY = 1 / rows;

  out.repeatX = repeatX;
  out.repeatY = repeatY;
  out.offsetX = col * repeatX;
  out.offsetY = flipY ? (rows - 1 - row) * repeatY : row * repeatY;
  out.col = col;
  out.row = row;
  out.frameIndex = clampedLocal;
  return out;
}

/**
 * Applique un `SpriteUvRect` sur les `Vector2` existants d'une `THREE.Texture`
 * uniquement en cas de variation (zéro allocation `Vector2` par frame).
 */
export function applyUvRectToTexture(
  tex: THREE.Texture,
  rect: Readonly<SpriteUvRect>,
): void {
  if (tex.repeat.x !== rect.repeatX || tex.repeat.y !== rect.repeatY) {
    tex.repeat.set(rect.repeatX, rect.repeatY);
  }
  if (tex.offset.x !== rect.offsetX || tex.offset.y !== rect.offsetY) {
    tex.offset.set(rect.offsetX, rect.offsetY);
  }
}

// ============================================================================
// Utilitaires d'URL & chargement sécurisé Three.js
// ============================================================================

export function resolveAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  const metaEnv = (import.meta as unknown as { env?: { BASE_URL?: string } }).env;
  const base =
    metaEnv && typeof metaEnv.BASE_URL === 'string' ? metaEnv.BASE_URL : './';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${clean}`;
}

export function getEquipmentIconUrl(itemId: string): string {
  return resolveAssetUrl(`assets/icons/equip/${itemId}.png`);
}

export function getSpellIconUrl(spellId: string): string {
  return resolveAssetUrl(`assets/icons/spells/${spellId}.png`);
}

export function getHudIconUrl(
  iconId: 'inventory' | 'map' | 'quests' | 'gold' | 'key',
): string {
  return resolveAssetUrl(`assets/icons/ui/${iconId}.png`);
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

export function extractHtmlImage(
  tex: THREE.Texture | undefined,
): HTMLImageElement | undefined {
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
