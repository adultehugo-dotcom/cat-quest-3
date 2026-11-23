import { describe, expect, it } from 'vitest';
import {
  OVERWORLD_DATA,
  OVERWORLD_HALF_SIZE,
  OVERWORLD_ROADS,
  VILLAGE_SAFE_ZONE,
  clampToIsland,
  getBiomeAt,
  getIslandRadiusAtAngle,
  isInsideIsland,
  isInsideVillage,
} from '../src/data/worldData';

describe('WorldData — Félingard contour, clamping & biomes', () => {
  it('classifie correctement les 4 biomes (village, plains, forest, frost)', () => {
    expect(getBiomeAt(0, 24)).toBe('village');
    expect(getBiomeAt(20, 24)).toBe('plains');
    expect(getBiomeAt(-30, -10)).toBe('forest');
    expect(getBiomeAt(-35, -18)).toBe('forest');
    expect(getBiomeAt(15, -30)).toBe('frost');
    expect(getBiomeAt(8, -42)).toBe('frost');

    // Vérifie que isInsideVillage coïncide avec la safe zone
    expect(isInsideVillage(VILLAGE_SAFE_ZONE.minX, VILLAGE_SAFE_ZONE.minZ)).toBe(true);
    expect(isInsideVillage(VILLAGE_SAFE_ZONE.maxX + 1, VILLAGE_SAFE_ZONE.maxZ)).toBe(false);
  });

  it('évalue isInsideIsland et clampToIsland par rapport à getIslandRadiusAtAngle', () => {
    expect(isInsideIsland(0, 24)).toBe(true);
    expect(isInsideIsland(80, 0)).toBe(false);
    expect(isInsideIsland(-46, 46)).toBe(false);
    expect(isInsideIsland(46, 46)).toBe(false);

    expect(clampToIsland(0, 0)).toEqual({ x: 0, z: 0 });

    const clampedEast = clampToIsland(80, 0, 1.8);
    const expectedR = getIslandRadiusAtAngle(0) - 1.8;
    expect(clampedEast.x).toBeCloseTo(expectedR, 5);
    expect(clampedEast.z).toBeCloseTo(0, 5);
    expect(Math.abs(clampedEast.x)).toBeLessThan(OVERWORLD_HALF_SIZE);

    // Vérifie le clamping dans 8 directions
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const farX = Math.cos(a) * 120;
      const farZ = Math.sin(a) * 120;
      const c = clampToIsland(farX, farZ, 1.8);
      const rExpected = getIslandRadiusAtAngle(Math.atan2(c.z, c.x)) - 1.8;
      expect(Math.hypot(c.x, c.z)).toBeCloseTo(rExpected, 4);
      expect(Math.abs(c.x)).toBeLessThan(OVERWORLD_HALF_SIZE);
      expect(Math.abs(c.z)).toBeLessThan(OVERWORLD_HALF_SIZE);
    }
  });

  it('contient 100% des entités terrestres OVERWORLD_DATA et routes dans Félingard avec les bons biomes', () => {
    expect(isInsideIsland(OVERWORLD_DATA.playerStart.x, OVERWORLD_DATA.playerStart.z)).toBe(true);
    expect(getBiomeAt(OVERWORLD_DATA.playerStart.x, OVERWORLD_DATA.playerStart.z)).toBe('village');

    for (const b of OVERWORLD_DATA.buildings) {
      expect(isInsideIsland(b.x, b.z, 1.8)).toBe(true);
      expect(isInsideIsland(b.interactX, b.interactZ, 1.8)).toBe(true);
      expect(getBiomeAt(b.x, b.z)).toBe('village');
    }

    for (const npc of OVERWORLD_DATA.npcs) {
      expect(isInsideIsland(npc.x, npc.z, 1.8)).toBe(true);
      expect(getBiomeAt(npc.x, npc.z)).toBe('village');
    }

    for (const portal of OVERWORLD_DATA.dungeonPortals) {
      expect(isInsideIsland(portal.x, portal.z, 1.8)).toBe(true);
    }
    const ghostPortal = OVERWORLD_DATA.dungeonPortals.find((p) => p.id === 'portal_ghost_cave');
    const dragonPortal = OVERWORLD_DATA.dungeonPortals.find((p) => p.id === 'portal_dragon_lair');
    expect(ghostPortal).toBeDefined();
    expect(dragonPortal).toBeDefined();
    expect(getBiomeAt(ghostPortal!.x, ghostPortal!.z)).toBe('plains');
    expect(getBiomeAt(dragonPortal!.x, dragonPortal!.z)).toBe('frost');

    for (const chest of OVERWORLD_DATA.chests) {
      expect(isInsideIsland(chest.x, chest.z, 1.8)).toBe(true);
    }

    for (const camp of OVERWORLD_DATA.camps) {
      expect(isInsideIsland(camp.centerX, camp.centerZ, 1.8)).toBe(true);
      expect(getBiomeAt(camp.centerX, camp.centerZ)).toBe(camp.biome);
      for (const sp of camp.spawns) {
        expect(isInsideIsland(sp.x, sp.z, 1.8)).toBe(true);
        expect(getBiomeAt(sp.x, sp.z)).toBe(camp.biome);
      }
    }

    for (const prop of OVERWORLD_DATA.props) {
      expect(isInsideIsland(prop.x, prop.z, 1.8)).toBe(true);
    }

    for (const road of OVERWORLD_ROADS) {
      for (const pt of road) {
        expect(isInsideIsland(pt.x, pt.z, 1.8)).toBe(true);
      }
    }

    for (const label of OVERWORLD_DATA.mapLabels) {
      expect(Math.abs(label.x)).toBeLessThan(OVERWORLD_HALF_SIZE);
      expect(Math.abs(label.z)).toBeLessThan(OVERWORLD_HALF_SIZE);
      if (label.style === 'sea') {
        expect(isInsideIsland(label.x, label.z, 0)).toBe(false);
      } else {
        expect(isInsideIsland(label.x, label.z, 1.8)).toBe(true);
      }
    }
  });
});
