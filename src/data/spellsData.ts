import type { SpellDefinition, SpellId } from '../game/types';

export const SPELL_ORDER: SpellId[] = [
  'flamepurr',
  'lightnyan',
  'freezepaw',
  'healing_paw',
  'aegis_purr',
  'pounce_dash',
  'meteor_paw',
];

export const SPELLS: Record<SpellId, SpellDefinition> = {
  flamepurr: {
    id: 'flamepurr',
    name: 'Flamme-ronron',
    shortDesc: 'Anneau de feu AoE',
    description:
      'Déchaîne un tourbillon de flammes félines tout autour du héros, brûlant les ennemis proches.',
    hotkeyLabel: '1 / A',
    geometry: 'circle_aoe',
    mpCost: 25,
    cooldown: 1.2,
    maxLevel: 5,
    radius: 4.2,
    baseMagMult: 1.6,
    magMultPerLevel: 0.35,
    upgradeBaseCost: 80,
    color: '#ff6b2b',
    secondaryColor: '#ffd166',
  },
  lightnyan: {
    id: 'lightnyan',
    name: 'Éclair-miaou',
    shortDesc: 'Foudre perçante en ligne',
    description:
      'Projette un trait de foudre perçant dans la direction visée, foudroyant tous les ennemis alignés.',
    hotkeyLabel: '2 / E',
    geometry: 'line_pierce',
    mpCost: 30,
    cooldown: 1.5,
    maxLevel: 5,
    radius: 9.0,
    width: 2.0,
    baseMagMult: 1.9,
    magMultPerLevel: 0.4,
    upgradeBaseCost: 90,
    color: '#ffe44d',
    secondaryColor: '#7be3ff',
  },
  freezepaw: {
    id: 'freezepaw',
    name: 'Patte-givrée',
    shortDesc: 'Nova de glace + Ralentissement',
    description:
      'Libère une nova glaciale qui blesse les ennemis alentour et réduit leur vitesse de 40 % pendant 3,5 s.',
    hotkeyLabel: '3 / R',
    geometry: 'frost_nova',
    mpCost: 28,
    cooldown: 2.0,
    maxLevel: 5,
    radius: 4.8,
    baseMagMult: 1.2,
    magMultPerLevel: 0.3,
    upgradeBaseCost: 85,
    slowFactor: 0.4,
    slowDuration: 3.5,
    color: '#5edbff',
    secondaryColor: '#d9f7ff',
  },
  healing_paw: {
    id: 'healing_paw',
    name: 'Soin-velours',
    shortDesc: 'Soin instantané + Régénération',
    description:
      'Enveloppe le héros d’un ronronnement apaisant : soin instantané puis 3 vagues de régénération sur 3 s.',
    hotkeyLabel: '4 / F',
    geometry: 'self_heal',
    mpCost: 35,
    cooldown: 4.0,
    maxLevel: 5,
    radius: 2.6,
    baseMagMult: 0.8,
    magMultPerLevel: 0.25,
    upgradeBaseCost: 100,
    instantHealPct: 0.25,
    regenTicks: 3,
    regenTickPct: 0.08,
    regenDuration: 3.0,
    color: '#5ce67a',
    secondaryColor: '#d8ffdf',
  },
  aegis_purr: {
    id: 'aegis_purr',
    name: 'Égide de Ronron',
    shortDesc: 'Bouclier runique protecteur',
    description:
      'Invoque une barrière dorée autour du héros pendant 5,5 s qui absorbe les dégâts ennemis avant vos PV.',
    hotkeyLabel: '5 / C',
    geometry: 'self_shield',
    mpCost: 26,
    cooldown: 6.0,
    maxLevel: 5,
    radius: 2.3,
    baseMagMult: 1.4,
    magMultPerLevel: 0.45,
    upgradeBaseCost: 95,
    shieldHpPct: 0.24,
    shieldDuration: 5.5,
    color: '#ffd166',
    secondaryColor: '#66f2ff',
  },
  pounce_dash: {
    id: 'pounce_dash',
    name: 'Bond Foudroyant',
    shortDesc: 'Ruée féline + Esquive',
    description:
      'Propulse le héros sur une courte distance avec invulnérabilité brève, tranchant les ennemis traversés.',
    hotkeyLabel: '6 / V',
    geometry: 'mobility_dash',
    mpCost: 20,
    cooldown: 2.8,
    maxLevel: 5,
    radius: 6.2,
    width: 2.1,
    baseMagMult: 1.15,
    magMultPerLevel: 0.28,
    upgradeBaseCost: 85,
    dashIframes: 0.28,
    color: '#4de8d6',
    secondaryColor: '#fff3a8',
  },
  meteor_paw: {
    id: 'meteor_paw',
    name: "Chute d'Étoiles",
    shortDesc: 'Pluie stellaire ciblée au curseur',
    description:
      'Invoque une pluie prolongée d’étoiles filantes à l’emplacement du curseur, déclenchant plusieurs vagues d’impacts cosmiques.',
    hotkeyLabel: '7 / X',
    geometry: 'target_meteor_aoe',
    mpCost: 42,
    cooldown: 4.5,
    maxLevel: 5,
    radius: 5.4,
    castRange: 12.0,
    baseMagMult: 2.35,
    magMultPerLevel: 0.45,
    upgradeBaseCost: 110,
    color: '#c95bff',
    secondaryColor: '#ffbe4d',
  },
};

export const SPELL_LIST: SpellDefinition[] = SPELL_ORDER.map((id) => SPELLS[id]);

export function getSpellDefinition(id: SpellId): SpellDefinition {
  return SPELLS[id];
}

/**
 * Coût en or pour améliorer un sort du niveau `currentLevel` vers `currentLevel + 1`.
 * Retourne 0 si le sort est déjà au niveau maximum.
 */
export function getSpellUpgradeCost(id: SpellId, currentLevel: number): number {
  const def = SPELLS[id];
  if (currentLevel >= def.maxLevel) return 0;
  return def.upgradeBaseCost * Math.max(1, currentLevel);
}

/**
 * Puissance magique brute (hors bonus %PV de Soin-velours) pour un sort donné.
 */
export function getSpellPower(id: SpellId, level: number, mag: number): number {
  const def = SPELLS[id];
  const clampedLevel = Math.max(1, Math.min(def.maxLevel, level));
  const mult = def.baseMagMult + def.magMultPerLevel * (clampedLevel - 1);
  return Math.round(mag * mult);
}
