import type { EquipSlot, EquipmentDefinition, Rarity } from '../game/types';

export const MYSTERY_CHEST_WEIGHTS: Record<Rarity, number> = {
  common: 0.55,
  rare: 0.35,
  epic: 0.1,
};

export const EQUIPMENT_LIST: EquipmentDefinition[] = [
  {
    id: 'shield_wood',
    name: 'Bouclier de Griffoir',
    slot: 'shield',
    rarity: 'common',
    description: 'Un petit bouclier rond qui améliore la défense et les roulades.',
    baseStats: { def: 2, hp: 10 },
    visualStyle: {
      shape: 'wood_shield',
      primaryColor: '#b57b45',
      secondaryColor: '#7d4f25',
      accentColor: '#e0b379',
    },
  },
  {
    id: 'trinket_yarn',
    name: 'Pelote Porte-Bonheur',
    slot: 'trinket',
    rarity: 'common',
    description: 'Une babiole familière qui apporte un peu de courage.',
    baseStats: { critChance: 0.02 },
    visualStyle: {
      shape: 'yarn_trinket',
      primaryColor: '#d93d78',
      secondaryColor: '#7b3157',
      accentColor: '#ffd8e7',
    },
  },
  // --- ARMES (4) ---
  {
    id: 'sword_wood',
    name: 'Épée en Bois de Griffoir',
    slot: 'weapon',
    rarity: 'common',
    description: 'Taillée dans un arbre à chat centenaire. Idéale pour faire ses griffes.',
    baseStats: { atk: 6 },
    visualStyle: {
      shape: 'wood_sword',
      primaryColor: '#b57b45',
      secondaryColor: '#7d4f25',
      accentColor: '#e0b379',
    },
  },
  {
    id: 'sword_steel',
    name: 'Sabre de Miaou-Acier',
    slot: 'weapon',
    rarity: 'common',
    description: 'Une lame d’acier finement aiguisée à la Forge de Kit-Chat.',
    baseStats: { atk: 13, critChance: 0.03 },
    visualStyle: {
      shape: 'steel_saber',
      primaryColor: '#dce6f2',
      secondaryColor: '#3a78c2',
      accentColor: '#f7c948',
    },
  },
  {
    id: 'staff_arcane',
    name: 'Bâton de Ronron-Étoile',
    slot: 'weapon',
    rarity: 'rare',
    description: 'Sceptre astral qui amplifie chaque sort d’un éclat stellaire.',
    baseStats: { atk: 8, mag: 20 },
    visualStyle: {
      shape: 'arcane_staff',
      primaryColor: '#6d3fb5',
      secondaryColor: '#3d1f73',
      accentColor: '#56f0ff',
      glowColor: '#68f3ff',
    },
  },
  {
    id: 'blade_dragon',
    name: 'Grande Lame Draconique',
    slot: 'weapon',
    rarity: 'epic',
    description: 'Forgée dans la braise d’un ancien dragon. Elle ronronne de puissance pure.',
    baseStats: { atk: 24, mag: 16, critChance: 0.08 },
    visualStyle: {
      shape: 'dragon_blade',
      primaryColor: '#c92a3e',
      secondaryColor: '#f4c542',
      accentColor: '#ff8a2b',
      glowColor: '#ff5e2b',
    },
  },

  // --- CASQUES (4) ---
  {
    id: 'helm_bandana',
    name: "Bandeau d'Aventurier",
    slot: 'helmet',
    rarity: 'common',
    description: 'Un bandeau rouge vif noué sous les oreilles. Simple mais plein de panache.',
    baseStats: { hp: 15, def: 2 },
    visualStyle: {
      shape: 'bandana',
      primaryColor: '#d93d3d',
      secondaryColor: '#992020',
      accentColor: '#ffd466',
    },
  },
  {
    id: 'helm_knight',
    name: 'Heaume de Chat-valier',
    slot: 'helmet',
    rarity: 'common',
    description: 'Casque d’acier brillant doté d’encoches sur mesure pour oreilles félines.',
    baseStats: { hp: 35, def: 6 },
    visualStyle: {
      shape: 'knight_helm',
      primaryColor: '#cfd9e6',
      secondaryColor: '#7c8ca3',
      accentColor: '#3d7cd6',
    },
  },
  {
    id: 'helm_mage',
    name: "Chapeau d'Archimiaou",
    slot: 'helmet',
    rarity: 'rare',
    description: 'Un chapeau pointu indigo brodé d’étoiles qui crépite de mana pur.',
    baseStats: { hp: 25, mag: 16, mp: 15 },
    visualStyle: {
      shape: 'mage_hat',
      primaryColor: '#352f8a',
      secondaryColor: '#211c5c',
      accentColor: '#66ecff',
      glowColor: '#7be8ff',
    },
  },
  {
    id: 'helm_dragon',
    name: 'Couronne du Sang-Dragon',
    slot: 'helmet',
    rarity: 'epic',
    description: 'Diadème royal serti de rubis et de petites cornes dorées légendaires.',
    baseStats: { hp: 60, atk: 12, mag: 12, def: 10 },
    visualStyle: {
      shape: 'dragon_crown',
      primaryColor: '#f5c242',
      secondaryColor: '#b87616',
      accentColor: '#e63244',
      glowColor: '#ffd966',
    },
  },

  // --- ARMURES (4) ---
  {
    id: 'armor_tunic',
    name: 'Tunique de Miaou-Vert',
    slot: 'armor',
    rarity: 'common',
    description: 'Tunique légère tissée à Miaou-bourg avec ceinture en cuir souple.',
    baseStats: { hp: 20, def: 3 },
    visualStyle: {
      shape: 'tunic',
      primaryColor: '#4e9e48',
      secondaryColor: '#336e30',
      accentColor: '#9c6234',
    },
  },
  {
    id: 'armor_mail',
    name: 'Cotte de Mailles Féline',
    slot: 'armor',
    rarity: 'common',
    description: 'Mailles argentées et tabard bleu royal : solide sans gêner les roulades.',
    baseStats: { hp: 50, def: 8 },
    visualStyle: {
      shape: 'mail',
      primaryColor: '#c3d0de',
      secondaryColor: '#2f65ad',
      accentColor: '#e6b84c',
    },
  },
  {
    id: 'armor_robe',
    name: 'Robe des Étoiles',
    slot: 'armor',
    rarity: 'rare',
    description: 'Robe bleu nuit brodée de fil d’or, prisée des mages de Félingard.',
    baseStats: { hp: 35, mag: 18, mp: 25 },
    visualStyle: {
      shape: 'star_robe',
      primaryColor: '#263278',
      secondaryColor: '#192052',
      accentColor: '#ffd452',
      glowColor: '#7be3ff',
    },
  },
  {
    id: 'armor_dragon',
    name: "Armure d'Écailles d'Or",
    slot: 'armor',
    rarity: 'epic',
    description: 'Plastron pourpre et or accompagné d’une cape royale draconique.',
    baseStats: { hp: 90, def: 14, atk: 10, mag: 10 },
    visualStyle: {
      shape: 'dragon_plate',
      primaryColor: '#7d204f',
      secondaryColor: '#f2be38',
      accentColor: '#ff5247',
      glowColor: '#ffae38',
      hasCape: true,
      capeColor: '#b82534',
    },
  },
];

export const EQUIPMENT: Record<string, EquipmentDefinition> = Object.fromEntries(
  EQUIPMENT_LIST.map((item) => [item.id, item]),
);

export const EQUIPMENT_BY_RARITY: Record<Rarity, EquipmentDefinition[]> = {
  common: EQUIPMENT_LIST.filter((item) => item.rarity === 'common'),
  rare: EQUIPMENT_LIST.filter((item) => item.rarity === 'rare'),
  epic: EQUIPMENT_LIST.filter((item) => item.rarity === 'epic'),
};

export function getEquipmentDefinition(id: string): EquipmentDefinition | undefined {
  return EQUIPMENT[id];
}

export function getEquipmentBySlot(slot: EquipSlot): EquipmentDefinition[] {
  return EQUIPMENT_LIST.filter((item) => item.slot === slot);
}
