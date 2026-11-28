import { describe, expect, it } from 'vitest';
import { HD_EQUIPMENT_FILES } from '../src/art/hdAssets';
import {
  EQUIPMENT,
  EQUIPMENT_LIST,
  WEAPON_COMBAT_PROFILES,
  getEquipmentDefinition,
  getShopEquipmentList,
  getWeaponCombatProfile,
} from '../src/data/equipmentData';
import { ALL_NEW_ISLANDS, NEW_ISLANDS } from '../src/data/worldIslands';
import { executeMeleeAttack, updatePlayerProjectiles } from '../src/game/combat';
import { createEnemyInstance } from '../src/game/enemyAI';
import { GameEngine } from '../src/game/gameEngine';
import {
  addEquipment,
  buyEquipment,
  createInitialPlayerState,
  equipItem,
  getEquipmentUpgradeCost,
  getScaledEquipmentStats,
  isMaxUpgrade,
  scaleEquipmentStat,
  upgradeEquipment,
} from '../src/game/progression';
import {
  createMemoryStorage,
  loadGame,
  saveGame,
  serializeGameState,
  validateSaveData,
} from '../src/game/saveSystem';
import {
  ALL_EQUIP_SLOTS,
  FORGE_UPGRADE_MULTIPLIERS,
  MAX_FORGE_UPGRADE_LEVEL,
  OPTIONAL_EQUIP_SLOTS,
  SAVE_STORAGE_KEY,
  STARTING_EQUIPMENT,
  type GameEvent,
  type MaterialSound,
  type PlayerProjectile,
  type WeaponFamily,
} from '../src/game/types';
import { getEquipmentIconMarkup } from '../src/ui/modalsController';

interface MinimalNodeFs {
  existsSync(p: string): boolean;
  readdirSync(p: string): string[];
  readFileSync(p: string, enc: string): string;
}

interface MinimalNodePath {
  resolve(...segs: string[]): string;
  join(...segs: string[]): string;
}

async function getNodeFsAndPath(): Promise<{
  fs: MinimalNodeFs;
  path: MinimalNodePath;
  cwd: string;
}> {
  const fs = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as MinimalNodeFs;
  const path = (await import(/* @vite-ignore */ 'node:' + 'path')) as unknown as MinimalNodePath;
  const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
  return { fs, path, cwd: proc ? proc.cwd() : '.' };
}

describe('Phase 1 — Refonte 5 emplacements, Migration Sauvegarde, 6 Familles & Forge +3', () => {
  it('applique strictement les 5 emplacements actifs sans aucun résidu de boots/gloves/trinket', () => {
    expect(ALL_EQUIP_SLOTS).toEqual(['weapon', 'shield', 'helmet', 'armor', 'cape']);
    expect(OPTIONAL_EQUIP_SLOTS).toEqual(['shield', 'cape']);
    expect(Object.keys(STARTING_EQUIPMENT).sort()).toEqual([
      'armor',
      'cape',
      'helmet',
      'shield',
      'weapon',
    ]);

    for (const def of EQUIPMENT_LIST) {
      expect(['weapon', 'shield', 'helmet', 'armor', 'cape']).toContain(def.slot);
      expect(def.id).not.toMatch(/^(boots_|gloves_|trinket_|dagger_fang)/);
    }

    const player = createInitialPlayerState();
    expect(Object.keys(player.equipped).sort()).toEqual([
      'armor',
      'cape',
      'helmet',
      'shield',
      'weapon',
    ]);
    for (const owned of Object.values(player.inventory)) {
      expect(owned.upgradeLevel).toBe(0);
    }
  });

  it('migre silencieusement les anciennes sauvegardes v1/v2 (boots/gloves/trinket/dagger_fang) sans perte de progression', () => {
    const engine = new GameEngine({ storage: createMemoryStorage() });
    engine.startNewGame();
    engine.state.player.level = 5;
    engine.state.player.xp = 42;
    engine.state.player.gold = 777;
    engine.state.player.hasRunicKey = true;
    addEquipment(engine.state.player, 'sword_steel');
    addEquipment(engine.state.player, 'sword_steel');
    equipItem(engine.state.player, 'sword_steel');

    const v2Snap = serializeGameState(engine.state);
    const { ship: _ship, ...withoutShip } = v2Snap;
    const legacyV1 = {
      ...withoutShip,
      version: 1 as const,
      player: {
        ...withoutShip.player,
        equipped: {
          ...withoutShip.player.equipped,
          boots: 'boots_dragon',
          gloves: 'gloves_arcane',
          trinket: 'trinket_yarn',
          secondary_weapon: 'dagger_fang',
        },
        inventory: {
          sword_wood: { id: 'sword_wood', level: 1 },
          sword_steel: { id: 'sword_steel', level: 2 },
          helm_bandana: { id: 'helm_bandana', level: 1 },
          armor_tunic: { id: 'armor_tunic', level: 1 },
          boots_dragon: { id: 'boots_dragon', level: 3 },
          gloves_arcane: { id: 'gloves_arcane', level: 2 },
          trinket_yarn: { id: 'trinket_yarn', level: 1 },
          dagger_fang: { id: 'dagger_fang', level: 2 },
        },
      },
    };

    const migrated = validateSaveData(legacyV1);
    expect(migrated).not.toBeNull();
    expect(migrated?.version).toBe(1);
    expect(migrated?.player.level).toBe(5);
    expect(migrated?.player.xp).toBe(42);
    expect(migrated?.player.gold).toBe(777);
    expect(migrated?.player.hasRunicKey).toBe(true);
    expect(migrated?.player.equipped.weapon).toBe('sword_steel');
    expect(migrated?.player.equipped).not.toHaveProperty('boots');
    expect(migrated?.player.equipped).not.toHaveProperty('gloves');
    expect(migrated?.player.equipped).not.toHaveProperty('trinket');
    expect(migrated?.player.equipped).not.toHaveProperty('secondary_weapon');
    expect(migrated?.player.inventory.boots_dragon).toBeUndefined();
    expect(migrated?.player.inventory.gloves_arcane).toBeUndefined();
    expect(migrated?.player.inventory.trinket_yarn).toBeUndefined();
    expect(migrated?.player.inventory.dagger_fang).toBeUndefined();
    expect(migrated?.player.inventory.sword_steel).toEqual({
      id: 'sword_steel',
      level: 2,
      upgradeLevel: 0,
    });

    // Si un slot actif conservé contenait un ID supprimé (ex: dagger_fang), repli silencieux vers STARTING_EQUIPMENT
    const legacyEquippedRemoved = {
      ...v2Snap,
      player: {
        ...v2Snap.player,
        equipped: {
          ...v2Snap.player.equipped,
          weapon: 'dagger_fang',
        },
      },
    };
    const migratedFallback = validateSaveData(legacyEquippedRemoved);
    expect(migratedFallback?.player.equipped.weapon).toBe(STARTING_EQUIPMENT.weapon);

    // En revanche un ID inconnu corrompu doit toujours être rejeté
    const corrupt = {
      ...v2Snap,
      player: {
        ...v2Snap.player,
        equipped: {
          ...v2Snap.player.equipped,
          weapon: 'non_existent_sword',
        },
      },
    };
    expect(validateSaveData(corrupt)).toBeNull();

    // Un upgradeLevel hors borne [0..3] doit être rejeté
    const badUpgrade = {
      ...v2Snap,
      player: {
        ...v2Snap.player,
        inventory: {
          ...v2Snap.player.inventory,
          sword_wood: { id: 'sword_wood', level: 1, upgradeLevel: 4 },
        },
      },
    };
    expect(validateSaveData(badUpgrade)).toBeNull();
  });

  it('couvre les 6 familles d’armes, les 8 matériaux sonores, les profils étendus et l’obtention en jeu', () => {
    const families: WeaponFamily[] = [
      'sword',
      'axe_hammer',
      'dagger_claws',
      'spear',
      'staff',
      'bow_crossbow',
    ];
    const materials: MaterialSound[] = [
      'wood',
      'steel',
      'iron_heavy',
      'bone',
      'arcane',
      'draconic',
      'flame',
      'frost',
    ];

    const weapons = EQUIPMENT_LIST.filter((item) => item.slot === 'weapon');
    expect(weapons.length).toBeGreaterThanOrEqual(12);

    for (const family of families) {
      const members = weapons.filter((w) => w.weaponFamily === family);
      expect(members.length, `Famille ${family} doit avoir >= 2 armes`).toBeGreaterThanOrEqual(2);
    }

    const seenMaterials = new Set<MaterialSound>();
    let procCount = 0;
    for (const w of weapons) {
      expect(w.weaponFamily).toBeDefined();
      expect(w.materialSound).toBeDefined();
      if (w.materialSound) seenMaterials.add(w.materialSound);

      const profile = getWeaponCombatProfile(w.id);
      expect(WEAPON_COMBAT_PROFILES[w.id]).toBe(profile);
      expect(w.combatProfile).toBe(profile);
      expect(profile.weaponFamily).toBe(w.weaponFamily);
      expect(profile.materialSound).toBe(w.materialSound);
      expect(profile.range).toBeGreaterThan(1.5);
      expect(profile.attackCooldown).toBeGreaterThan(0.1);
      expect(profile.comboSteps).toBeGreaterThanOrEqual(3);
      expect(profile.comboMultipliers.length).toBeGreaterThanOrEqual(3);
      expect(profile.hitstopSec).toBeGreaterThan(0);
      expect(profile.staggerPower).toBeGreaterThan(0);
      if (w.statusProc) {
        procCount += 1;
        expect(w.statusProc.chance).toBeGreaterThan(0);
        expect(w.statusProc.chance).toBeLessThanOrEqual(0.5);
        expect(w.statusProc.durationSec).toBeGreaterThan(0);
      }
    }

    for (const mat of materials) {
      expect(seenMaterials.has(mat), `MaterialSound manquant : ${mat}`).toBe(true);
    }
    // Minorité cohérente (~25-35%) d'armes avec statusProc
    expect(procCount).toBeGreaterThanOrEqual(3);
    expect(procCount).toBeLessThanOrEqual(Math.ceil(weapons.length * 0.4));

    // Armes disponibles à l'Armurerie de Kit-Chat ET dans les coffres des îles
    const shopIds = getShopEquipmentList().map((d) => d.id);
    expect(shopIds.length).toBeGreaterThanOrEqual(8);
    const islandChestItems = ALL_NEW_ISLANDS.map(
      (id) => NEW_ISLANDS[id].chests[0].loot.guaranteedItemId,
    ).filter((id): id is string => Boolean(id));
    expect(islandChestItems.length).toBe(5);
    for (const itemId of islandChestItems) {
      expect(EQUIPMENT[itemId]?.slot).toBe('weapon');
    }

    // Combat réel avec une nouvelle arme à distance (bow_hunter génère un PlayerProjectile)
    const player = createInitialPlayerState(0, 0);
    player.aimAngle = 0;
    addEquipment(player, 'bow_hunter');
    equipItem(player, 'bow_hunter');
    const farEnemy = createEnemyInstance({ id: 'far', typeId: 'slime_yarn', x: 5.0, z: 0 });
    const events: GameEvent[] = [];
    const projectiles: PlayerProjectile[] = [];
    const hit = executeMeleeAttack(player, [farEnemy], events, {
      rng: () => 0.5,
      applyDash: () => {},
      projectiles,
    });
    expect(hit.executed).toBe(true);
    expect(hit.hitEnemies).toHaveLength(0);
    expect(projectiles).toHaveLength(1);
    expect(events[0]?.weaponId).toBe('bow_hunter');

    let totalHits = 0;
    for (let i = 0; i < 20; i += 1) {
      const pRes = updatePlayerProjectiles(projectiles, [farEnemy], player, events, {
        dt: 0.03,
        rng: () => 0.5,
      });
      totalHits += pRes.hitEnemies.length;
      if (totalHits > 0) break;
    }
    expect(totalHits).toBe(1);
    expect(farEnemy.hp).toBeLessThan(farEnemy.maxHp);
  });

  it('implémente la Forge de Kit-Chat +1 à +3 (+15%/+32%/+55%), isMaxUpgrade, coût progressif, Armurerie et persistance', () => {
    expect(MAX_FORGE_UPGRADE_LEVEL).toBe(3);
    expect(FORGE_UPGRADE_MULTIPLIERS).toEqual({
      0: 1.0,
      1: 1.15,
      2: 1.32,
      3: 1.55,
    });

    expect(scaleEquipmentStat(20, 1, 0)).toBe(20);
    expect(scaleEquipmentStat(20, 1, 1)).toBe(23);
    expect(scaleEquipmentStat(20, 1, 2)).toBe(26);
    expect(scaleEquipmentStat(20, 1, 3)).toBe(31);

    const storage = createMemoryStorage();
    const engine = new GameEngine({ storage });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    const p = engine.state.player;
    p.gold = 3000;

    // Achat à l'Armurerie de Kit-Chat
    const buyFail = buyEquipment(createInitialPlayerState(), 'hammer_frost');
    expect(buyFail.success).toBe(false);
    expect(buyFail.reason).toBe('insufficient_gold');

    const bought = engine.buyEquipment('hammer_frost');
    expect(bought.success).toBe(true);
    expect(p.inventory.hammer_frost).toEqual({
      id: 'hammer_frost',
      level: 1,
      upgradeLevel: 0,
    });
    expect(equipItem(p, 'hammer_frost')).toBe(true);
    const atk0 = p.stats.atk;

    const c0 = getEquipmentUpgradeCost('hammer_frost', 0);
    const c1 = getEquipmentUpgradeCost('hammer_frost', 1);
    const c2 = getEquipmentUpgradeCost('hammer_frost', 2);
    expect(c0).toBeGreaterThan(0);
    expect(c1).toBeGreaterThan(c0);
    expect(c2).toBeGreaterThan(c1);
    expect(getEquipmentUpgradeCost('hammer_frost', 3)).toBe(0);

    // +0 -> +1 (+15%)
    const u1 = engine.upgradeEquipment('hammer_frost');
    expect(u1.success).toBe(true);
    expect(u1.newUpgradeLevel).toBe(1);
    expect(u1.isMaxUpgrade).toBe(false);
    expect(isMaxUpgrade(p.inventory.hammer_frost)).toBe(false);
    expect(p.stats.atk).toBeGreaterThan(atk0);
    expect(getScaledEquipmentStats('hammer_frost', 1, 1).atk).toBe(
      scaleEquipmentStat(EQUIPMENT.hammer_frost.baseStats.atk!, 1, 1),
    );

    // +1 -> +2 (+32%)
    const u2 = engine.upgradeEquipment('hammer_frost');
    expect(u2.success).toBe(true);
    expect(u2.newUpgradeLevel).toBe(2);
    expect(u2.isMaxUpgrade).toBe(false);

    // +2 -> +3 (+55%, MAX)
    const u3 = engine.upgradeEquipment('hammer_frost');
    expect(u3.success).toBe(true);
    expect(u3.newUpgradeLevel).toBe(3);
    expect(u3.isMaxUpgrade).toBe(true);
    expect(isMaxUpgrade(p.inventory.hammer_frost)).toBe(true);

    // Bloqué au-delà de +3
    const u4 = upgradeEquipment(p, 'hammer_frost');
    expect(u4.success).toBe(false);
    expect(u4.reason).toBe('max_upgrade');

    // Sauvegarde et rechargement complets conservent upgradeLevel = 3
    expect(engine.saveCurrentGame()).toBe(true);
    const rawSaved = loadGame(storage);
    expect(rawSaved?.player.inventory.hammer_frost?.upgradeLevel).toBe(3);
    expect(storage.getItem(SAVE_STORAGE_KEY)).toContain('"upgradeLevel":3');

    const engine2 = new GameEngine({ storage });
    expect(engine2.continueSavedGame()).toBe(true);
    expect(engine2.state.player.inventory.hammer_frost?.upgradeLevel).toBe(3);
    expect(engine2.state.player.stats.atk).toBe(p.stats.atk);
    saveGame(serializeGameState(engine2.state), storage);
  });

  it('supprime les 20 PNG orphelins, évite tout chemin /assets/ et garantit zéro 404 UI pour les nouvelles armes', async () => {
    const { fs, path, cwd } = await getNodeFsAndPath();
    const equipDir = path.resolve(cwd, 'public', 'assets', 'equipment');
    const iconsDir = path.resolve(cwd, 'public', 'assets', 'icons', 'equip');

    const equipFiles = fs.readdirSync(equipDir).filter((f) => f.endsWith('.png'));
    const iconFiles = fs.readdirSync(iconsDir).filter((f) => f.endsWith('.png'));
    expect(equipFiles).toHaveLength(18);
    expect(iconFiles).toHaveLength(18);

    for (const removed of [
      'boots_leather.png',
      'boots_iron.png',
      'boots_arcane.png',
      'boots_dragon.png',
      'gloves_leather.png',
      'gloves_iron.png',
      'gloves_arcane.png',
      'gloves_dragon.png',
      'trinket_yarn.png',
      'dagger_fang.png',
    ]) {
      expect(equipFiles).not.toContain(removed);
      expect(iconFiles).not.toContain(removed);
    }

    for (const rel of Object.values(HD_EQUIPMENT_FILES)) {
      expect(fs.existsSync(path.resolve(cwd, 'public', rel))).toBe(true);
    }

    // Aucune nouvelle arme ne doit générer un <img src="/assets/..."> ou un PNG manquant
    for (const def of EQUIPMENT_LIST) {
      const markup = getEquipmentIconMarkup(def);
      expect(markup).not.toContain('src="/assets/');
      if (markup.includes('<img')) {
        expect(markup).toContain('src="./assets/');
        const match = markup.match(/src="\.\/([^"]+)"/);
        expect(match).not.toBeNull();
        expect(fs.existsSync(path.resolve(cwd, 'public', match![1]))).toBe(true);
      } else {
        expect(markup).toContain('<svg');
      }
    }

    // Vérifie l'isolation stricte de src/game/ (zéro import three, zéro DOM sauf input.ts gardé)
    const gameDir = path.resolve(cwd, 'src', 'game');
    const gameFiles = fs.readdirSync(gameDir).filter((f) => f.endsWith('.ts'));
    for (const file of gameFiles) {
      const src = fs.readFileSync(path.join(gameDir, file), 'utf8');
      expect(src).not.toMatch(/from\s+['"]three/);
      if (file !== 'input.ts') {
        expect(src).not.toMatch(/\b(document\.|window\.|HTMLElement)\b/);
      }
    }
    expect(getEquipmentDefinition('hammer_frost')?.slot).toBe('weapon');
  });
});
