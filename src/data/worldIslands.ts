import type {
  BiomeId,
  ChestDef,
  EnemyCampDef,
  EnemySpawnDef,
  IslandId,
  MapLabelDef,
  Vec2,
  WorldProp,
} from '../game/types';

/**
 * Archipel de Félingard — îles situées au-delà du périmètre
 * de l'île principale (~57 u). Chaque île possède son propre rayon,
 * son biome, ses props, ses camps et ses coffres.
 * Le joueur accède librement à toutes les plages praticables par navigation.
 */
export type { IslandId };
export type NewIslandId = Exclude<IslandId, 'felingard'>;

export interface IslandDef {
  id: IslandId;
  name: string;
  biome: BiomeId;
  centerX: number;
  centerZ: number;
  radius: number; // rayon organique maximal
  description: string;
  // Propriétés de génération organique
  radiusOffset: number; // décalage relatif à getIslandRadiusAtAngle (si -1.6 utilisé)
  macroCount?: number; // nombre de variations organiques de surface
  props: WorldProp[];
  camps: EnemyCampDef[];
  chests: ChestDef[];
}

function createIslandProps(
  islandId: IslandId,
  centerX: number,
  centerZ: number,
  kinds: WorldProp['kind'][],
): WorldProp[] {
  return Array.from({ length: 10 }, (_, index) => {
    const angle = (index / 10) * Math.PI * 2 + 0.23;
    const distance = index % 2 === 0 ? 9 : 13;
    const kind = kinds[index % kinds.length];
    return {
      id: `${islandId}_prop_${index + 1}`,
      kind,
      x: centerX + Math.cos(angle) * distance,
      z: centerZ + Math.sin(angle) * distance,
      scale: 0.8 + (index % 3) * 0.15,
      collidable: kind !== 'flower_patch' && kind !== 'mushroom',
      colliderRadius: kind === 'rock' || kind === 'snow_rock' ? 0.75 : 0.9,
    };
  });
}

function createIslandCamp(
  islandId: IslandId,
  biome: BiomeId,
  centerX: number,
  centerZ: number,
  enemyTypes: EnemySpawnDef['typeId'][],
): EnemyCampDef {
  return {
    id: `${islandId}_camp`,
    biome,
    centerX: centerX + 11,
    centerZ: centerZ - 8,
    spawns: enemyTypes.map((typeId, index) => ({
      id: `${islandId}_enemy_${index + 1}`,
      typeId,
      x: centerX + 9 + index * (islandId === 'archipelago' ? 1.5 : 2.4),
      z: centerZ - 7 - (index % 2) * 1.5,
    })),
  };
}

function createIslandChest(
  islandId: IslandId,
  x: number,
  z: number,
  guaranteedItemId?: string,
): ChestDef {
  return {
    id: `chest_${islandId}_shore`,
    zoneId: 'overworld',
    x,
    z,
    tier: 'rare',
    label: 'Ouvrir le coffre de l’île',
    loot: {
      gold: 90,
      ...(guaranteedItemId ? { guaranteedItemId } : {}),
      rarityWeights: { common: 0.35, rare: 0.55, epic: 0.1 },
    },
  };
}

/** Toutes les nouvelles îles accessibles depuis Félingard par navigation libre */
export const NEW_ISLANDS: Record<NewIslandId, IslandDef> = {
  tropical: {
    id: 'tropical',
    name: 'Plage des Ronrons Dorés',
    biome: 'tropical',
    centerX: 92,
    centerZ: 48,
    radius: 28,
    description: 'Un paradis tropical aux eaux cristallines et au sable fin.',
    radiusOffset: -1.6,
    macroCount: 600,
    props: [
      ...createIslandProps('tropical', 92, 48, ['oak_tree', 'flower_patch', 'rock']),
      { id: 'tropical_bush_1', kind: 'bush', x: 86, z: 54, scale: 1.05, collidable: false },
      { id: 'tropical_barrel_1', kind: 'barrel', x: 83, z: 46, scale: 0.95, collidable: false },
    ],
    camps: [createIslandCamp('tropical', 'tropical', 92, 48, ['slime_yarn', 'mouse_goblin'])],
    chests: [createIslandChest('tropical', 82, 43, 'claws_lynx')],
  },
  mountain: {
    id: 'mountain',
    name: 'Griffe-de-Roc',
    biome: 'mountain',
    centerX: 75,
    centerZ: -85,
    radius: 26,
    description: 'Des sommets escarpés et des falaises vertigineuses.',
    radiusOffset: -1.6,
    macroCount: 500,
    props: createIslandProps('mountain', 75, -85, ['snow_pine', 'snow_rock', 'flower_patch']),
    camps: [createIslandCamp('mountain', 'mountain', 75, -85, ['fishbone_skeleton', 'frost_golem'])],
    chests: [createIslandChest('mountain', 65, -80, 'hammer_frost')],
  },
  mystic: {
    id: 'mystic',
    name: 'Sanctuaire des Ronrons Oubliés',
    biome: 'mystic',
    centerX: -80,
    centerZ: 60,
    radius: 24,
    description: 'Des ruines anciennes enveloppées de brume mystique.',
    radiusOffset: -1.6,
    macroCount: 550,
    props: createIslandProps('mystic', -80, 60, ['twisted_tree', 'mushroom', 'rock']),
    camps: [createIslandCamp('mystic', 'mystic', -80, 60, ['mouse_goblin', 'fishbone_skeleton'])],
    chests: [createIslandChest('mystic', -70, 55, 'staff_ember')],
  },
  wild: {
    id: 'wild',
    name: 'Terres des Griffes Sauvages',
    biome: 'wild',
    centerX: -95,
    centerZ: -75,
    radius: 30,
    description: 'Une jungle dense et inexplorée où la nature règne en maître.',
    radiusOffset: -1.6,
    macroCount: 700,
    props: [
      ...createIslandProps('wild', -95, -75, ['twisted_tree', 'oak_tree', 'mushroom']),
      { id: 'wild_bush_1', kind: 'bush', x: -89, z: -69, scale: 1.1, collidable: false },
    ],
    camps: [createIslandCamp('wild', 'wild', -95, -75, ['thorn_wolf', 'thorn_wolf', 'mouse_goblin'])],
    chests: [createIslandChest('wild', -85, -70, 'bow_hunter')],
  },
  archipelago: {
    id: 'archipelago',
    name: 'Archipel des Moustaches',
    biome: 'wild',
    centerX: 18,
    centerZ: -108,
    radius: 18,
    description: "Un groupe d'îles petites et verdoyantes reliant le monde.",
    radiusOffset: -1.6,
    macroCount: 400,
    props: createIslandProps('archipelago', 18, -108, ['oak_tree', 'flower_patch', 'rock']),
    camps: [createIslandCamp('archipelago', 'wild', 18, -108, ['slime_yarn', 'mouse_goblin'])],
    chests: [createIslandChest('archipelago', 11, -103, 'spear_fishbone')],
  },
};

/** Rayon organique maximal pour chaque île (identique à getIslandRadiusAtAngle mais centré) */
export function getNewIslandRadiusAtAngle(islandId: NewIslandId, angle: number): number {
  const def = NEW_ISLANDS[islandId];
  if (!def) return 0;
  const base = def.radius;
  // Forme organique similaire à l'île principale mais indépendante
  return (
    base +
    2.0 * Math.cos(angle * 2.0 - 0.3) +
    1.5 * Math.sin(angle * 3.0 + 0.7) +
    0.8 * Math.cos(angle * 5.0 - 0.1)
  );
}

/** Vérifie si (x, z) se trouve sur une île nouvelle (au-delà de l'île principale) */
export function isInsideNewIsland(
  islandId: NewIslandId,
  x: number,
  z: number,
  margin = 1.8,
): boolean {
  const def = NEW_ISLANDS[islandId];
  if (!def) return false;
  const angle = Math.atan2(z - def.centerZ, x - def.centerX);
  const maxR = Math.max(0, getNewIslandRadiusAtAngle(islandId, angle) - margin);
  return Math.hypot(x - def.centerX, z - def.centerZ) <= maxR;
}

/** Projecte une position hors-limite sur la bordure navigable de l'île nouvelle */
export function clampToNewIsland(
  islandId: NewIslandId,
  x: number,
  z: number,
  margin = 1.8,
): Vec2 {
  const def = NEW_ISLANDS[islandId];
  if (!def) return { x, z };
  const dx = x - def.centerX;
  const dz = z - def.centerZ;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return { x: def.centerX, z: def.centerZ };
  const angle = Math.atan2(dz, dx);
  const maxR = Math.max(0, getNewIslandRadiusAtAngle(islandId, angle) - margin);
  if (dist <= maxR) return { x: def.centerX + dx, z: def.centerZ + dz };
  const scale = maxR / dist;
  return { x: def.centerX + dx * scale, z: def.centerZ + dz * scale };
}

/** Biome lookup pour les nouvelles îles (partagé entre moteur et générateur de texture) */
export function getBiomeAtNewIsland(islandId: NewIslandId, x: number, z: number): BiomeId {
  const def = NEW_ISLANDS[islandId];
  if (!def) return 'plains';
  // Vérifie d'abord si on est dans la zone sûre du village (ne devrait pas arriver)
  // puis dans le biome propre à l'île via sa fonction radius
  if (isInsideVillageGlobal(x, z)) return 'village';

  // Détermine le biome selon la distance angulaire par rapport au centre de l'île
  const islandBiomeDef = def.biome;
  return islandBiomeDef;
}

/** Vérifie si un point est dans la zone sûre de Miaou-bourg (pour les nouvelles îles aussi) */
export function isInsideVillageGlobal(x: number, z: number, padding = 0): boolean {
  return (
    x >= -14 - padding && x <= 14 + padding && z >= 12 - padding && z <= 34 + padding
  );
}

// Export toutes les îles (sauf felingard) en ordre arbitraire pour l'itération
export const ALL_NEW_ISLANDS: NewIslandId[] = ['tropical', 'mountain', 'mystic', 'wild', 'archipelago'];

/** Centre mondial approximatif de toutes les nouvelles îles (pour la caméra globale / minimap) */
export function getNewIslandsCenters(): Vec2 {
  let sumX = 0,
    sumZ = 0;
  for (const id of ALL_NEW_ISLANDS) {
    const def = NEW_ISLANDS[id];
    sumX += def.centerX;
    sumZ += def.centerZ;
  }
  return { x: sumX / ALL_NEW_ISLANDS.length, z: sumZ / ALL_NEW_ISLANDS.length };
}

/** Étiquettes cartographiques pour les nouvelles îles (rendu séparé hors OVERWORLD_DATA) */
export const NEW_ISLAND_LABELS: MapLabelDef[] = [
  {
    text: 'PLAGE DES RONRONS DORÉS',
    x: 92,
    z: 48,
    rotation: 0,
    size: 'medium',
    style: 'land',
  },
  {
    text: 'GRIFFE-DE-ROC',
    x: 75,
    z: -85,
    rotation: 0,
    size: 'medium',
    style: 'land',
  },
  {
    text: 'SANCTUAIRE DES RONRONS OUBLIÉS',
    x: -80,
    z: 60,
    rotation: 0,
    size: 'medium',
    style: 'land',
  },
  {
    text: 'TERRES DES GRIFFES SAUVAGES',
    x: -95,
    z: -75,
    rotation: 0,
    size: 'medium',
    style: 'land',
  },
  {
    text: 'ARCHIPEL DES MOUSTACHES',
    x: 18,
    z: -108,
    rotation: 0,
    size: 'small',
    style: 'land',
  },
];