import type {
  BiomeId,
  OverworldData,
  SafeZoneRect,
  Vec2,
  WorldProp,
} from '../game/types';

export const OVERWORLD_HALF_SIZE = 60;
/** Zone sûre de Miaou-bourg (padding incluse) */
export const VILLAGE_SAFE_ZONE: SafeZoneRect = {
  name: 'Miaou-bourg',
  minX: -14,
  maxX: 14,
  minZ: 12,
  maxZ: 34,
};

/**
 * Rayon organique de l'île de Félingard à un angle donné (radians dans le plan x,z).
 * Oscille doucement entre ~49.5 et ~57.0 unités, toujours bien à l'intérieur de [-60, 60].
 */
export function getIslandRadiusAtAngle(angle: number): number {
  return (
    52.5 +
    2.2 * Math.cos(angle * 2 - 0.5) +
    1.5 * Math.sin(angle * 3 + 0.9) +
    1.0 * Math.cos(angle * 5 - 0.3)
  );
}

/**
 * Indique si le point (x, z) se trouve sur la terre ferme navigable de l'île.
 * `margin` retire une bande de plage côtière (1.8 u par défaut pour les collisions).
 */
export function isInsideIsland(x: number, z: number, margin = 1.8): boolean {
  const angle = Math.atan2(z, x);
  const maxR = Math.max(0, getIslandRadiusAtAngle(angle) - margin);
  return Math.hypot(x, z) <= maxR;
}

/**
 * Projette proprement une position hors-limite sur la bordure navigable de l'île.
 */
export function clampToIsland(x: number, z: number, margin = 1.8): Vec2 {
  const dist = Math.hypot(x, z);
  if (dist < 1e-6) return { x: 0, z: 0 };
  const angle = Math.atan2(z, x);
  const maxR = Math.max(0, getIslandRadiusAtAngle(angle) - margin);
  if (dist <= maxR) return { x, z };
  const scale = maxR / dist;
  return { x: x * scale, z: z * scale };
}

/**
 * Vérifie si (x, z) est dans la zone sûre de Miaou-bourg (avec padding optionnel).
 */
export function isInsideVillage(x: number, z: number, padding = 0): boolean {
  return (
    x >= VILLAGE_SAFE_ZONE.minX - padding &&
    x <= VILLAGE_SAFE_ZONE.maxX + padding &&
    z >= VILLAGE_SAFE_ZONE.minZ - padding &&
    z <= VILLAGE_SAFE_ZONE.maxZ + padding
  );
}

/**
 * Détermine le biome logique & visuel en (x, z).
 * Partagé entre le moteur de jeu et le générateur de texture de carte 2048×2048.
 */
export function getBiomeAt(x: number, z: number): BiomeId {
  if (isInsideVillage(x, z)) {
    return 'village';
  }
  const westBorderX = -10 + 2.0 * Math.sin(z * 0.11);
  const forestSouthZ = 12 + 2.0 * Math.sin(x * 0.12);
  if (x < westBorderX && z < forestSouthZ) {
    return 'forest';
  }
  const frostSouthZ = -12 + 2.2 * Math.cos(x * 0.1);
  if (x >= westBorderX && z < frostSouthZ) {
    return 'frost';
  }
  return 'plains';
}

/**
 * Sentiers peints sur la carte Overworld (reliant Miaou-bourg aux 3 biomes et 2 donjons).
 */
export const OVERWORLD_ROADS: Vec2[][] = [
  // Route principale Miaou-bourg -> Nord -> Monts Prr-Glacés -> Antre du Dragon-Griffe
  [
    { x: 0, z: 24 },
    { x: 0, z: 14 },
    { x: -1, z: 4 },
    { x: 2, z: -8 },
    { x: 5, z: -20 },
    { x: 8, z: -32 },
    { x: 8, z: -40 },
  ],
  // Route Est Miaou-bourg -> Plaines Est -> Grotte des Souris-Fantômes
  [
    { x: 8, z: 22 },
    { x: 15, z: 18 },
    { x: 22, z: 13 },
    { x: 29, z: 8 },
    { x: 30, z: 5 },
  ],
  // Route Ouest Miaou-bourg -> Orée du Bois Griffu -> Profondeurs du Bois
  [
    { x: -7, z: 22 },
    { x: -15, z: 16 },
    { x: -20, z: 6 },
    { x: -28, z: -4 },
    { x: -34, z: -14 },
    { x: -37, z: -20 },
  ],
  // Boucle de la place de Miaou-bourg
  [
    { x: -7, z: 23 },
    { x: 0, z: 21 },
    { x: 8, z: 23 },
  ],
];

const OVERWORLD_PROPS: WorldProp[] = [
  // --- Plaines de Miaou-Vert : chênes, fleurs, panneaux ---
  { id: 'prop_oak_1', kind: 'oak_tree', x: -18, z: 28, scale: 1.1, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_oak_2', kind: 'oak_tree', x: -26, z: 26, scale: 1.25, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_oak_3', kind: 'oak_tree', x: -35, z: 19, scale: 1.15, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_oak_4', kind: 'oak_tree', x: -32, z: 12, scale: 1.05, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_oak_5', kind: 'oak_tree', x: -16, z: 36, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_oak_6', kind: 'oak_tree', x: 17, z: 37, scale: 1.15, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_oak_7', kind: 'oak_tree', x: 25, z: 32, scale: 1.25, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_oak_8', kind: 'oak_tree', x: 34, z: 24, scale: 1.1, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_oak_9', kind: 'oak_tree', x: 38, z: 12, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_oak_10', kind: 'oak_tree', x: 36, z: -2, scale: 1.1, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_oak_11', kind: 'oak_tree', x: 18, z: -4, scale: 1.15, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_oak_12', kind: 'oak_tree', x: -6, z: 6, scale: 1.0, collidable: true, colliderRadius: 0.85 },
  { id: 'prop_oak_13', kind: 'oak_tree', x: 13, z: 8, scale: 1.05, collidable: true, colliderRadius: 0.85 },
  { id: 'prop_oak_14', kind: 'oak_tree', x: 28, z: 17, scale: 1.05, collidable: true, colliderRadius: 0.85 },
  { id: 'prop_oak_15', kind: 'oak_tree', x: -20, z: 35, scale: 1.15, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_oak_16', kind: 'oak_tree', x: 23, z: 37, scale: 1.1, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_rock_1', kind: 'rock', x: 33, z: 7, scale: 1.0, collidable: true, colliderRadius: 0.85 },
  { id: 'prop_rock_2', kind: 'rock', x: 25, z: 2, scale: 0.9, collidable: true, colliderRadius: 0.8 },
  { id: 'prop_rock_3', kind: 'rock', x: -16, z: 22, scale: 0.9, collidable: true, colliderRadius: 0.8 },
  { id: 'prop_flower_1', kind: 'flower_patch', x: -5, z: 29, scale: 1.0, collidable: false },
  { id: 'prop_flower_2', kind: 'flower_patch', x: 6, z: 28, scale: 1.0, collidable: false },
  { id: 'prop_flower_3', kind: 'flower_patch', x: 16, z: 26, scale: 1.1, collidable: false },
  { id: 'prop_flower_4', kind: 'flower_patch', x: -19, z: 14, scale: 1.0, collidable: false },
  { id: 'prop_flower_5', kind: 'flower_patch', x: 9, z: 4, scale: 1.1, collidable: false },
  { id: 'prop_flower_6', kind: 'flower_patch', x: 25, z: 21, scale: 1.0, collidable: false },
  { id: 'prop_sign_1', kind: 'signpost', x: 13.5, z: 16.5, scale: 1.0, collidable: true, colliderRadius: 0.45 },
  { id: 'prop_sign_2', kind: 'signpost', x: -13.5, z: 15.5, scale: 1.0, collidable: true, colliderRadius: 0.45 },
  { id: 'prop_sign_3', kind: 'signpost', x: 2.5, z: 12.2, scale: 1.0, collidable: true, colliderRadius: 0.45 },
  { id: 'prop_bush_1', kind: 'bush', x: -12.5, z: 25, scale: 1.0, collidable: false },
  { id: 'prop_bush_2', kind: 'bush', x: 13.5, z: 25, scale: 1.05, collidable: false },
  { id: 'prop_bush_3', kind: 'bush', x: -21, z: 4, scale: 1.1, collidable: false },
  { id: 'prop_barrel_1', kind: 'barrel', x: 11.8, z: 20.5, scale: 1.0, collidable: false },
  { id: 'prop_barrel_2', kind: 'barrel', x: -11.5, z: 20.5, scale: 1.0, collidable: false },

  // --- Bois Griffu : arbres tordus, champignons, rochers ---
  { id: 'prop_twist_1', kind: 'twisted_tree', x: -15, z: 8, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_twist_2', kind: 'twisted_tree', x: -27, z: 8, scale: 1.3, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_twist_3', kind: 'twisted_tree', x: -38, z: 4, scale: 1.25, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_twist_4', kind: 'twisted_tree', x: -44, z: -5, scale: 1.3, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_twist_5', kind: 'twisted_tree', x: -43, z: -16, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_twist_6', kind: 'twisted_tree', x: -31, z: -15, scale: 1.15, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_twist_7', kind: 'twisted_tree', x: -24, z: -15, scale: 1.25, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_twist_8', kind: 'twisted_tree', x: -14, z: -15.5, scale: 1.15, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_twist_9', kind: 'twisted_tree', x: -14, z: -20, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_twist_10', kind: 'twisted_tree', x: -28, z: -36.5, scale: 1.25, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_twist_11', kind: 'twisted_tree', x: -39, z: -30, scale: 1.15, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_twist_12', kind: 'twisted_tree', x: -17, z: -35.5, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_twist_13', kind: 'twisted_tree', x: -16, z: -2, scale: 1.1, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_twist_14', kind: 'twisted_tree', x: -40, z: -26, scale: 1.15, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_mush_1', kind: 'mushroom', x: -23, z: 2, scale: 1.0, collidable: false },
  { id: 'prop_mush_2', kind: 'mushroom', x: -32, z: -5.5, scale: 1.15, collidable: false },
  { id: 'prop_mush_3', kind: 'mushroom', x: -39, z: -19, scale: 1.1, collidable: false },
  { id: 'prop_mush_4', kind: 'mushroom', x: -22, z: -22, scale: 1.0, collidable: false },
  { id: 'prop_mush_5', kind: 'mushroom', x: -16, z: -14, scale: 0.95, collidable: false },

  // --- Monts Prr-Glacés : pins enneigés, rochers de givre ---
  { id: 'prop_pine_1', kind: 'snow_pine', x: -6, z: -16, scale: 1.25, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_pine_2', kind: 'snow_pine', x: -8, z: -28, scale: 1.3, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_pine_3', kind: 'snow_pine', x: -4, z: -38, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_pine_4', kind: 'snow_pine', x: 3, z: -15, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_pine_5', kind: 'snow_pine', x: 21, z: -32.5, scale: 1.15, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_pine_6', kind: 'snow_pine', x: 39, z: -17, scale: 1.25, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_pine_7', kind: 'snow_pine', x: 40, z: -23, scale: 1.2, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_pine_8', kind: 'snow_pine', x: 33, z: -33, scale: 1.2, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_pine_9', kind: 'snow_pine', x: 22, z: -39, scale: 1.3, collidable: true, colliderRadius: 1.0 },
  { id: 'prop_pine_10', kind: 'snow_pine', x: 16, z: -43, scale: 1.15, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_pine_11', kind: 'snow_pine', x: 0, z: -44, scale: 1.25, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_pine_12', kind: 'snow_pine', x: 14, z: -35, scale: 1.1, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_srock_1', kind: 'snow_rock', x: 0, z: -28, scale: 1.1, collidable: true, colliderRadius: 0.95 },
  { id: 'prop_srock_2', kind: 'snow_rock', x: 14, z: -38, scale: 1.05, collidable: true, colliderRadius: 0.9 },
  { id: 'prop_srock_3', kind: 'snow_rock', x: 29, z: -29, scale: 1.0, collidable: true, colliderRadius: 0.85 },
  { id: 'prop_srock_4', kind: 'snow_rock', x: -2, z: -26, scale: 1.0, collidable: true, colliderRadius: 0.85 },
  { id: 'prop_srock_5', kind: 'snow_rock', x: 36, z: -29, scale: 0.95, collidable: true, colliderRadius: 0.85 },
];

export const OVERWORLD_DATA: OverworldData = {
  halfSize: OVERWORLD_HALF_SIZE,
  playerStart: { x: 0, z: 24 },
  villageSafeZone: VILLAGE_SAFE_ZONE,

  buildings: [
    {
      id: 'building_inn',
      kind: 'inn',
      name: 'Auberge du Coussin Doux',
      x: -7,
      z: 20,
      interactX: -7,
      interactZ: 22.3,
      colliderRadius: 2.0,
      interactableType: 'inn',
      interactLabel: "Se reposer à l'Auberge (PV/PM + Sauvegarde)",
    },
    {
      id: 'building_quest_board',
      kind: 'quest_board',
      name: 'Panneau de Quêtes',
      x: 0,
      z: 18,
      interactX: 0,
      interactZ: 19.3,
      colliderRadius: 0.9,
      interactableType: 'quest_board',
      interactLabel: 'Consulter le Panneau de Quêtes',
    },
    {
      id: 'building_forge',
      kind: 'forge',
      name: 'Forge de Kit-Chat',
      x: 8,
      z: 20,
      interactX: 8,
      interactZ: 22.3,
      colliderRadius: 2.0,
      interactableType: 'forge',
      interactLabel: 'Ouvrir la Forge de Kit-Chat',
    },
    {
      id: 'building_house_west',
      kind: 'house',
      name: 'Chaumière Moustache',
      x: -10.5,
      z: 29,
      interactX: -10.5,
      interactZ: 31,
      colliderRadius: 1.85,
    },
    {
      id: 'building_house_east',
      kind: 'house',
      name: 'Maison des Ronrons',
      x: 10.5,
      z: 29,
      interactX: 10.5,
      interactZ: 31,
      colliderRadius: 1.85,
    },
  ],

  npcs: [
    {
      id: 'mayor_moustache',
      name: 'Maire Moustache',
      portraitId: 'mayor_moustache',
      x: -2,
      z: 26,
      radius: 0.75,
      interactLabel: 'Parler au Maire Moustache',
    },
  ],

  dungeonPortals: [
    {
      id: 'portal_ghost_cave',
      label: 'Entrer — Grotte des Souris-Fantômes (Niv. 2)',
      shortLabel: 'Niv. 2',
      x: 30,
      z: 4,
      radius: 3.0,
      targetZoneId: 'dungeon_ghost_cave',
      targetSpawn: { x: 0, z: 19.5 },
      recommendedLevel: 2,
      requiresRunicKey: false,
    },
    {
      id: 'portal_dragon_lair',
      label: "Entrer — Antre du Dragon-Griffe (Niv. 5)",
      shortLabel: 'Niv. 5',
      x: 8,
      z: -42,
      radius: 3.2,
      targetZoneId: 'dungeon_dragon_lair',
      targetSpawn: { x: 0, z: 21 },
      recommendedLevel: 5,
      requiresRunicKey: true,
    },
  ],

  camps: [
    // --- Plaines de Miaou-Vert (4 camps, Niv. 1–2) ---
    {
      id: 'camp_plains_se',
      biome: 'plains',
      centerX: 20,
      centerZ: 24,
      spawns: [
        { id: 'ow_slime_1', typeId: 'slime_yarn', x: 18.5, z: 23 },
        { id: 'ow_slime_2', typeId: 'slime_yarn', x: 22, z: 25.5 },
      ],
    },
    {
      id: 'camp_plains_east',
      biome: 'plains',
      centerX: 22,
      centerZ: 10,
      spawns: [
        { id: 'ow_slime_3', typeId: 'slime_yarn', x: 20.5, z: 11 },
        { id: 'ow_slime_4', typeId: 'slime_yarn', x: 23.5, z: 9 },
        { id: 'ow_goblin_1', typeId: 'mouse_goblin', x: 23, z: 12.5 },
      ],
    },
    {
      id: 'camp_plains_center',
      biome: 'plains',
      centerX: 4,
      centerZ: 0,
      spawns: [
        { id: 'ow_slime_5', typeId: 'slime_yarn', x: 2.5, z: 1.5 },
        { id: 'ow_slime_6', typeId: 'slime_yarn', x: 5.5, z: -1 },
        { id: 'ow_goblin_2', typeId: 'mouse_goblin', x: 6, z: 2 },
      ],
    },
    {
      id: 'camp_plains_sw',
      biome: 'plains',
      centerX: -24,
      centerZ: 18,
      spawns: [
        { id: 'ow_slime_7', typeId: 'slime_yarn', x: -23, z: 19.5 },
        { id: 'ow_goblin_3', typeId: 'mouse_goblin', x: -25.5, z: 17 },
        { id: 'ow_goblin_4', typeId: 'mouse_goblin', x: -22, z: 16 },
      ],
    },

    // --- Bois Griffu (4 camps, Niv. 2–4) ---
    {
      id: 'camp_forest_edge',
      biome: 'forest',
      centerX: -20,
      centerZ: 4,
      spawns: [
        { id: 'ow_wolf_1', typeId: 'thorn_wolf', x: -19, z: 5 },
        { id: 'ow_wolf_2', typeId: 'thorn_wolf', x: -22, z: 2.5 },
      ],
    },
    {
      id: 'camp_forest_marsh',
      biome: 'forest',
      centerX: -34,
      centerZ: -4,
      spawns: [
        { id: 'ow_wolf_3', typeId: 'thorn_wolf', x: -32.5, z: -3 },
        { id: 'ow_skel_1', typeId: 'fishbone_skeleton', x: -35.5, z: -5.5 },
        { id: 'ow_skel_2', typeId: 'fishbone_skeleton', x: -33, z: -6.5 },
      ],
    },
    {
      id: 'camp_forest_deep',
      biome: 'forest',
      centerX: -35,
      centerZ: -18,
      spawns: [
        { id: 'ow_wolf_4', typeId: 'thorn_wolf', x: -34, z: -17 },
        { id: 'ow_wolf_5', typeId: 'thorn_wolf', x: -37, z: -19 },
        { id: 'ow_skel_3', typeId: 'fishbone_skeleton', x: -33, z: -20.5 },
      ],
    },
    {
      id: 'camp_forest_north',
      biome: 'forest',
      centerX: -20,
      centerZ: -23,
      spawns: [
        { id: 'ow_wolf_6', typeId: 'thorn_wolf', x: -19, z: -22 },
        { id: 'ow_skel_4', typeId: 'fishbone_skeleton', x: -22, z: -24 },
        { id: 'ow_skel_5', typeId: 'fishbone_skeleton', x: -18.5, z: -24.5 },
      ],
    },

    // --- Monts Prr-Glacés (3 camps, Niv. 4–6) ---
    {
      id: 'camp_frost_pass',
      biome: 'frost',
      centerX: 2,
      centerZ: -20,
      spawns: [
        { id: 'ow_golem_1', typeId: 'frost_golem', x: 1, z: -20 },
        { id: 'ow_skel_6', typeId: 'fishbone_skeleton', x: 4, z: -19 },
        { id: 'ow_skel_7', typeId: 'fishbone_skeleton', x: -1.5, z: -21.5 },
      ],
    },
    {
      id: 'camp_frost_ridge',
      biome: 'frost',
      centerX: 29,
      centerZ: -31,
      spawns: [
        { id: 'ow_golem_2', typeId: 'frost_golem', x: 27.5, z: -30.5 },
        { id: 'ow_golem_3', typeId: 'frost_golem', x: 30.5, z: -32 },
        { id: 'ow_skel_8', typeId: 'fishbone_skeleton', x: 26, z: -32.5 },
      ],
    },
    {
      id: 'camp_frost_summit',
      biome: 'frost',
      centerX: 12,
      centerZ: -31,
      spawns: [
        { id: 'ow_golem_4', typeId: 'frost_golem', x: 10, z: -30.5 },
        { id: 'ow_golem_5', typeId: 'frost_golem', x: 14.5, z: -31.5 },
        { id: 'ow_skel_9', typeId: 'fishbone_skeleton', x: 12, z: -28.5 },
      ],
    },
  ],

  chests: [
    {
      id: 'chest_plains_east',
      zoneId: 'overworld',
      x: 28,
      z: 22,
      tier: 'wood',
      label: 'Ouvrir le coffre en bois',
      loot: {
        gold: 60,
        guaranteedItemId: 'armor_mail',
      },
    },
    {
      id: 'chest_plains_west',
      zoneId: 'overworld',
      x: -30,
      z: 16,
      tier: 'wood',
      label: 'Ouvrir le coffre en bois',
      loot: {
        gold: 65,
        guaranteedItemId: 'helm_mage',
      },
    },
    {
      id: 'chest_forest_lost_blade',
      zoneId: 'overworld',
      x: -38,
      z: -22,
      tier: 'rare',
      label: 'Ouvrir le coffre ancien du Bois Griffu',
      loot: {
        gold: 110,
        guaranteedItemId: 'armor_robe',
        questId: 'side_lost_blade',
      },
    },
    {
      id: 'chest_frost_epic',
      zoneId: 'overworld',
      x: 34,
      z: -26,
      tier: 'epic',
      label: 'Ouvrir le coffre épique givré',
      loot: {
        gold: 180,
        guaranteedItemId: 'helm_dragon',
      },
    },
  ],

  props: OVERWORLD_PROPS,

  mapLabels: [
    {
      text: 'PLAINES DE MIAOU-VERT',
      x: 2,
      z: 41.5,
      rotation: -0.02,
      size: 'large',
      style: 'land',
    },
    {
      text: 'MIAOU-BOURG',
      x: 0,
      z: 32,
      rotation: 0,
      size: 'medium',
      style: 'village',
    },
    {
      text: 'BOIS GRIFFU',
      x: -25.5,
      z: -31.5,
      rotation: -0.07,
      size: 'large',
      style: 'land',
    },
    {
      text: 'MONTS PRR-GLACÉS',
      x: 23.0,
      z: -23.5,
      rotation: 0.03,
      size: 'large',
      style: 'land',
    },
    {
      text: 'MER DES RONRONS',
      x: -46,
      z: 46,
      rotation: 0.68,
      size: 'small',
      style: 'sea',
    },
    {
      text: 'MER DES RONRONS',
      x: 46,
      z: 46,
      rotation: -0.68,
      size: 'small',
      style: 'sea',
    },
  ],
};
