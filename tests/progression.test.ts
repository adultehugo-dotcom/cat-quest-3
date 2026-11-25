import { describe, expect, it } from 'vitest';
import { getEquipmentDefinition } from '../src/data/equipmentData';
import { getSpellUpgradeCost } from '../src/data/spellsData';
import {
  MAX_PLAYER_LEVEL,
  MAX_SPELL_LEVEL,
  MYSTERY_CHEST_COST,
  type GameEvent,
} from '../src/game/types';
import {
  addEquipment,
  buyMysteryChest,
  createInitialPlayerState,
  equipItem,
  getBasePlayerStats,
  getScaledEquipmentStats,
  getXpToNextLevel,
  grantXp,
  scaleEquipmentStat,
  upgradeSpell,
} from '../src/game/progression';

describe('Progression — Courbe XP & Level-Up', () => {
  it('suit la formule exacte Math.round(80 * Math.pow(1.45, N - 1))', () => {
    expect(getXpToNextLevel(1)).toBe(80);
    expect(getXpToNextLevel(2)).toBe(116);
    expect(getXpToNextLevel(3)).toBe(168);
    expect(getXpToNextLevel(4)).toBe(244);
    expect(getXpToNextLevel(5)).toBe(Math.round(80 * Math.pow(1.45, 4)));
  });

  it('calcule correctement les stats de base par niveau', () => {
    expect(getBasePlayerStats(1)).toEqual({
      maxHp: 100,
      maxMp: 100,
      atk: 14,
      mag: 14,
      def: 4,
      critChance: 0.1,
    });
    expect(getBasePlayerStats(4)).toEqual({
      maxHp: 172,
      maxMp: 130,
      atk: 26,
      mag: 26,
      def: 10,
      critChance: 0.1,
    });
  });

  it('monte de niveau avec soin complet PV/PM, report du surplus XP et plafonne au Niv. 10', () => {
    const player = createInitialPlayerState();
    player.hp = 15;
    player.mp = 5;
    const events: GameEvent[] = [];

    // 80 XP (Niv 1->2) + 20 XP de surplus
    const res = grantXp(player, 100, events);
    expect(res.leveledUp).toBe(true);
    expect(res.levelsGained).toBe(1);
    expect(player.level).toBe(2);
    expect(player.xp).toBe(20);
    expect(player.xpToNext).toBe(116);
    // Soin complet garanti au level-up
    expect(player.hp).toBe(player.maxHp);
    expect(player.mp).toBe(player.maxMp);
    expect(events.some((e) => e.type === 'level_up' && e.value === 2)).toBe(true);

    // Gain massif d'XP : plafonne proprement au niveau max (10)
    grantXp(player, 100_000, events);
    expect(player.level).toBe(MAX_PLAYER_LEVEL);
    expect(player.xp).toBe(0);
  });
});

describe('Progression — Équipement, Scaling & Doublons (+1 niveau)', () => {
  it('applique la formule de scaling Math.round(base * (1 + 0.25 * (L - 1)))', () => {
    expect(scaleEquipmentStat(24, 1)).toBe(24);
    expect(scaleEquipmentStat(24, 2)).toBe(30);
    expect(scaleEquipmentStat(24, 3)).toBe(36);
    expect(scaleEquipmentStat(13, 2)).toBe(Math.round(13 * 1.25)); // 16

    // Vérifie que critChance fractionnaire ne s'arrondit jamais à 0
    const scaledBlade = getScaledEquipmentStats('blade_dragon', 2);
    expect(scaledBlade.atk).toBe(30);
    expect(scaledBlade.mag).toBe(20);
    expect(scaledBlade.critChance).toBeCloseTo(0.1, 4);
  });

  it('améliore automatiquement un équipement de +1 niveau sur doublon et met à jour les stats agrégées', () => {
    const player = createInitialPlayerState();
    const events: GameEvent[] = [];

    // État initial : sword_wood Niv 1 (+6 ATK) -> base 14 + 6 = 20 ATK
    expect(player.inventory.sword_wood.level).toBe(1);
    expect(player.stats.atk).toBe(20);

    // Doublon sur sword_wood (déjà équipé) -> Niv 2 (+8 ATK) -> 14 + 8 = 22 ATK
    const dup1 = addEquipment(player, 'sword_wood', events);
    expect(dup1?.isUpgrade).toBe(true);
    expect(dup1?.newLevel).toBe(2);
    expect(player.inventory.sword_wood.level).toBe(2);
    expect(player.stats.atk).toBe(14 + scaleEquipmentStat(6, 2));
    expect(
      events.some(
        (e) =>
          e.type === 'item_upgraded' &&
          e.itemId === 'sword_wood' &&
          e.itemLevel === 2,
      ),
    ).toBe(true);

    // Nouvel objet sword_steel puis équipement
    const added = addEquipment(player, 'sword_steel', events);
    expect(added?.isUpgrade).toBe(false);
    expect(added?.newLevel).toBe(1);
    expect(equipItem(player, 'sword_steel')).toBe(true);
    expect(player.stats.atk).toBe(14 + 13);
    expect(player.stats.critChance).toBeCloseTo(0.13, 4);

    // Doublon sur sword_steel -> Niv 2
    const dupSteel = addEquipment(player, 'sword_steel', events);
    expect(dupSteel?.isUpgrade).toBe(true);
    expect(dupSteel?.newLevel).toBe(2);
    expect(player.stats.atk).toBe(14 + scaleEquipmentStat(13, 2));
  });
});

describe('Progression — Forge (Coffre Mystère 120 Or & Upgrade Sorts 1->5)', () => {
  it('vend le Coffre Mystère à 120 Or en respectant la distribution 55/35/10 %', () => {
    const player = createInitialPlayerState();
    player.gold = 100;
    expect(buyMysteryChest(player)).toBeNull();

    // Tirage Commun (rng < 0.55)
    player.gold = MYSTERY_CHEST_COST * 3;
    const cRes = buyMysteryChest(player, [], () => 0.1);
    expect(cRes?.rarity).toBe('common');
    expect(player.gold).toBe(MYSTERY_CHEST_COST * 2);

    // Tirage Rare (0.55 <= rng < 0.90)
    const rRes = buyMysteryChest(player, [], () => 0.7);
    expect(rRes?.rarity).toBe('rare');
    expect(getEquipmentDefinition(rRes!.itemId)?.rarity).toBe('rare');

    // Tirage Épique (rng >= 0.90)
    const eRes = buyMysteryChest(player, [], () => 0.95);
    expect(eRes?.rarity).toBe('epic');
    expect(getEquipmentDefinition(eRes!.itemId)?.rarity).toBe('epic');
    expect(player.gold).toBe(0);
  });

  it('améliore les sorts du Niveau 1 au Niveau 5 selon le coût L*base puis bloque au max', () => {
    const player = createInitialPlayerState();
    player.gold = 50;

    // Or insuffisant (Flamme-ronron Niv 1->2 coûte 80 Or)
    const fail = upgradeSpell(player, 'flamepurr');
    expect(fail.success).toBe(false);
    expect(fail.reason).toBe('insufficient_gold');

    // Amélioration 1 -> 5 : coûts 80 + 160 + 240 + 320 = 800 Or
    player.gold = 800;
    for (let lv = 1; lv < MAX_SPELL_LEVEL; lv++) {
      const expectedCost = getSpellUpgradeCost('flamepurr', lv);
      const res = upgradeSpell(player, 'flamepurr');
      expect(res.success).toBe(true);
      expect(res.cost).toBe(expectedCost);
      expect(res.newLevel).toBe(lv + 1);
    }
    expect(player.spellLevels.flamepurr).toBe(5);
    expect(player.gold).toBe(0);

    // Bloqué au niveau 5
    player.gold = 9999;
    const maxed = upgradeSpell(player, 'flamepurr');
    expect(maxed.success).toBe(false);
    expect(maxed.reason).toBe('max_level');
  });
});
