import type { DungeonDefinition, ZoneId } from '../game/types';

export const DUNGEON_PILLAR_RADIUS = 0.9;

export const DUNGEON_GHOST_CAVE: DungeonDefinition = {
  id: 'dungeon_ghost_cave',
  name: 'Grotte des Souris-Fantômes',
  subtitle: 'Donjon — Niv. 2 recommandé',
  recommendedLevel: 2,
  width: 36,
  depth: 52,
  theme: 'ghost_cave',
  floorColor: '#483d5c',
  floorAccentColor: '#362d47',
  wallColor: '#2a2238',
  ambientLightColor: 0x9aa8e8,
  ambientLightIntensity: 0.65,
  playerSpawn: { x: 0, z: 19.5 },
  exitPortal: {
    id: 'exit_ghost_cave',
    label: 'Sortir vers les Plaines de Miaou-Vert',
    shortLabel: 'Sortie',
    x: 0,
    z: 22,
    radius: 2.8,
    targetZoneId: 'overworld',
    targetSpawn: { x: 30, z: 8 },
  },
  rooms: [
    {
      id: 'ghost_room_antechamber',
      name: 'Antichambre',
      minX: -16,
      maxX: 16,
      minZ: 6.5,
      maxZ: 24,
    },
    {
      id: 'ghost_room_corridor',
      name: 'Couloir des Ossements',
      minX: -11,
      maxX: 11,
      minZ: -8.5,
      maxZ: 4.5,
    },
    {
      id: 'ghost_room_throne',
      name: 'Salle du Trône Poussiéreux',
      minX: -16,
      maxX: 16,
      minZ: -24,
      maxZ: -10.5,
      isBossArena: true,
    },
  ],
  walls: [
    // Enceinte extérieure (36 × 52 : x ∈ [-18, 18], z ∈ [-26, 26])
    { id: 'gc_wall_n', minX: -18, maxX: 18, minZ: -26, maxZ: -24, height: 3.4 },
    { id: 'gc_wall_s', minX: -18, maxX: 18, minZ: 24, maxZ: 26, height: 3.4 },
    { id: 'gc_wall_w', minX: -18, maxX: -16, minZ: -26, maxZ: 26, height: 3.4 },
    { id: 'gc_wall_e', minX: 16, maxX: 18, minZ: -26, maxZ: 26, height: 3.4 },

    // Cloison Salle 1 -> Salle 2 (arche centrale x ∈ [-4.5, 4.5])
    { id: 'gc_div1_w', minX: -16, maxX: -4.5, minZ: 4.5, maxZ: 6.5, height: 3.2 },
    { id: 'gc_div1_e', minX: 4.5, maxX: 16, minZ: 4.5, maxZ: 6.5, height: 3.2 },

    // Rétrécissement latéral du Couloir des Ossements (Salle 2)
    { id: 'gc_corridor_w', minX: -16, maxX: -11, minZ: -8.5, maxZ: 4.5, height: 3.2 },
    { id: 'gc_corridor_e', minX: 11, maxX: 16, minZ: -8.5, maxZ: 4.5, height: 3.2 },

    // Cloison Salle 2 -> Salle 3 (arche centrale x ∈ [-4.5, 4.5])
    { id: 'gc_div2_w', minX: -16, maxX: -4.5, minZ: -10.5, maxZ: -8.5, height: 3.2 },
    { id: 'gc_div2_e', minX: 4.5, maxX: 16, minZ: -10.5, maxZ: -8.5, height: 3.2 },
  ],
  torches: [
    { x: -4.5, z: 22.0 },
    { x: 4.5, z: 22.0 },
    { x: -15.5, z: 14 },
    { x: 15.5, z: 14 },
    { x: -5.0, z: 7.5 },
    { x: 5.0, z: 7.5 },
    { x: -10.6, z: -2 },
    { x: 10.6, z: -2 },
    { x: -5.0, z: -7.5 },
    { x: 5.0, z: -7.5 },
    { x: -15.5, z: -18 },
    { x: 15.5, z: -18 },
    { x: -6.0, z: -23.0 },
    { x: 6.0, z: -23.0 },
  ],
  pillars: [
    { x: -12, z: 17 },
    { x: 12, z: 17 },
    { x: -12, z: -16 },
    { x: 12, z: -16 },
  ],
  spawns: [
    // Salle 1 : Antichambre (2 Gobelins-Souris + 1 Slime-Pelote)
    { id: 'gc_goblin_1', typeId: 'mouse_goblin', x: -5.5, z: 11.5 },
    { id: 'gc_goblin_2', typeId: 'mouse_goblin', x: 5.5, z: 11.5 },
    { id: 'gc_slime_1', typeId: 'slime_yarn', x: 0, z: 13.5 },

    // Salle 2 : Couloir des Ossements (2 Squelettes-Arêtes)
    { id: 'gc_skel_1', typeId: 'fishbone_skeleton', x: -5.5, z: -3.0 },
    { id: 'gc_skel_2', typeId: 'fishbone_skeleton', x: 5.5, z: -3.0 },

    // Salle 3 : Salle du Trône Poussiéreux (Mini-Boss Roi Rat-Spectre)
    { id: 'gc_boss_rat_king', typeId: 'boss_rat_king', x: 0, z: -18 },
  ],
  traps: [
    // Piège périodique de 2 cercles télégraphés au sol dans le Couloir des Ossements
    {
      id: 'trap_ghost_1',
      x: -3.2,
      z: 0.2,
      radius: 2.5,
      interval: 3.6,
      initialDelay: 1.0,
      windupDuration: 1.05,
      damage: 16,
    },
    {
      id: 'trap_ghost_2',
      x: 3.2,
      z: -4.2,
      radius: 2.5,
      interval: 3.6,
      initialDelay: 2.8,
      windupDuration: 1.05,
      damage: 16,
    },
  ],
  chests: [
    {
      id: 'chest_ghost_cave_key',
      zoneId: 'dungeon_ghost_cave',
      x: 0,
      z: -22,
      tier: 'golden',
      label: 'Ouvrir le Coffre Doré (Clé Runique)',
      lockedUntilBossDefeated: 'boss_rat_king',
      loot: {
        gold: 180,
        grantsRunicKey: true,
        rarityWeights: { common: 0, rare: 1, epic: 0 },
      },
    },
  ],
  healingCrystals: [],
  bossTypeId: 'boss_rat_king',
  bossArenaCenter: { x: 0, z: -17 },
  musicTrack: 'dungeon',
};

export const DUNGEON_DRAGON_LAIR: DungeonDefinition = {
  id: 'dungeon_dragon_lair',
  name: 'Antre du Dragon-Griffe',
  subtitle: 'Donjon Final — Niv. 5 recommandé',
  recommendedLevel: 5,
  width: 44,
  depth: 56,
  theme: 'dragon_lair',
  floorColor: '#3d333c',
  floorAccentColor: '#592c34',
  wallColor: '#261d24',
  ambientLightColor: 0xffb894,
  ambientLightIntensity: 0.68,
  playerSpawn: { x: 0, z: 21 },
  exitPortal: {
    id: 'exit_dragon_lair',
    label: 'Sortir vers les Monts Prr-Glacés',
    shortLabel: 'Sortie',
    x: 0,
    z: 24,
    radius: 3.0,
    targetZoneId: 'overworld',
    targetSpawn: { x: 8, z: -37 },
  },
  rooms: [
    {
      id: 'dragon_room_approach',
      name: "Couloir d'Approche",
      minX: -10,
      maxX: 10,
      minZ: 6,
      maxZ: 26,
    },
    {
      id: 'dragon_room_arena',
      name: 'Arène du Dragon-Griffe',
      minX: -20,
      maxX: 20,
      minZ: -26,
      maxZ: 6,
      isBossArena: true,
    },
  ],
  walls: [
    // Enceinte extérieure (44 × 56 : x ∈ [-22, 22], z ∈ [-28, 28])
    { id: 'dl_wall_n', minX: -22, maxX: 22, minZ: -28, maxZ: -26, height: 4.0 },
    { id: 'dl_wall_s', minX: -22, maxX: 22, minZ: 26, maxZ: 28, height: 4.0 },
    { id: 'dl_wall_w', minX: -22, maxX: -20, minZ: -28, maxZ: 28, height: 4.0 },
    { id: 'dl_wall_e', minX: 20, maxX: 22, minZ: -28, maxZ: 28, height: 4.0 },

    // Murs du couloir d'approche (x ∈ [-10, 10], z ∈ [6, 26])
    { id: 'dl_corridor_w', minX: -20, maxX: -10, minZ: 6, maxZ: 26, height: 3.8 },
    { id: 'dl_corridor_e', minX: 10, maxX: 20, minZ: 6, maxZ: 26, height: 3.8 },
  ],
  torches: [
    { x: -9.5, z: 22 },
    { x: 9.5, z: 22 },
    { x: -9.5, z: 12 },
    { x: 9.5, z: 12 },
    { x: -19.5, z: 2 },
    { x: 19.5, z: 2 },
    { x: -19.5, z: -10 },
    { x: 19.5, z: -10 },
    { x: -19.5, z: -22 },
    { x: 19.5, z: -22 },
    { x: -8, z: -25.0 },
    { x: 8, z: -25.0 },
  ],
  pillars: [
    { x: -16, z: -2 },
    { x: 16, z: -2 },
    { x: -16, z: -18 },
    { x: 16, z: -18 },
  ],
  spawns: [
    { id: 'dl_boss_dragon', typeId: 'boss_dragon_claw', x: 0, z: -11 },
  ],
  traps: [],
  chests: [
    {
      id: 'chest_dragon_supply',
      zoneId: 'dungeon_dragon_lair',
      x: -6.5,
      z: 12,
      tier: 'epic',
      label: 'Ouvrir le coffre de ravitaillement',
      loot: {
        gold: 120,
        guaranteedItemId: 'armor_dragon',
      },
    },
    {
      id: 'chest_dragon_victory',
      zoneId: 'dungeon_dragon_lair',
      x: 0,
      z: -23,
      tier: 'golden',
      label: 'Ouvrir le Trésor Légendaire de Drak-Miaou',
      lockedUntilBossDefeated: 'boss_dragon_claw',
      loot: {
        gold: 300,
        rarityWeights: { common: 0, rare: 0, epic: 1 },
      },
    },
  ],
  healingCrystals: [
    {
      id: 'crystal_dragon_lair',
      x: 6.5,
      z: 12,
      label: 'Toucher le Cristal de Soin (100 % PV & PM)',
    },
  ],
  bossTypeId: 'boss_dragon_claw',
  bossArenaCenter: { x: 0, z: -10 },
  musicTrack: 'boss',
};

export const DUNGEONS: Record<Exclude<ZoneId, 'overworld'>, DungeonDefinition> = {
  dungeon_ghost_cave: DUNGEON_GHOST_CAVE,
  dungeon_dragon_lair: DUNGEON_DRAGON_LAIR,
};

export function getDungeonDefinition(
  id: Exclude<ZoneId, 'overworld'>,
): DungeonDefinition {
  return DUNGEONS[id];
}
