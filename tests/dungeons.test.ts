import { describe, expect, it } from 'vitest';
import {
  DUNGEON_DRAGON_LAIR,
  DUNGEON_GHOST_CAVE,
  DUNGEON_PILLAR_RADIUS,
} from '../src/data/dungeonsData';
import { getHeroEquipmentKey } from '../src/art/spriteHero';
import { PLAYER_RADIUS } from '../src/game/combat';
import { GameEngine } from '../src/game/gameEngine';
import { createEmptyInputState } from '../src/game/input';
import { createMemoryStorage } from '../src/game/saveSystem';
import { STARTING_EQUIPMENT } from '../src/game/types';
import { computeResponsiveFov } from '../src/render/sceneManager';

describe('Donjons M2 — Piliers, Collisions, Torches, FOV & Clé Équipement', () => {
  it('déduplique les piliers de Dragon Lair et évite tout chevauchement mur/pilier', () => {
    expect(
      DUNGEON_DRAGON_LAIR.walls.some((w) => w.id?.startsWith('dl_pillar')),
    ).toBe(false);

    for (const dungeon of [DUNGEON_GHOST_CAVE, DUNGEON_DRAGON_LAIR]) {
      expect(dungeon.pillars.length).toBe(4);
      for (const pillar of dungeon.pillars) {
        for (const wall of dungeon.walls) {
          const overlapsWall =
            pillar.x + DUNGEON_PILLAR_RADIUS > wall.minX &&
            pillar.x - DUNGEON_PILLAR_RADIUS < wall.maxX &&
            pillar.z + DUNGEON_PILLAR_RADIUS > wall.minZ &&
            pillar.z - DUNGEON_PILLAR_RADIUS < wall.maxZ;
          expect(overlapsWall).toBe(false);
        }
      }
    }
  });

  it('résout les collisions contre les piliers dans Grotte et Antre du Dragon tout en laissant le passage latéral libre', () => {
    const storage = createMemoryStorage();
    const engine = new GameEngine({ storage, rng: () => 0.5 });
    engine.startNewGame();
    while (engine.state.dialogue.active) engine.advanceDialogue();

    for (const [zoneId, pillar] of [
      ['dungeon_ghost_cave', DUNGEON_GHOST_CAVE.pillars[0]],
      ['dungeon_dragon_lair', DUNGEON_DRAGON_LAIR.pillars[0]],
    ] as const) {
      engine.loadZone(zoneId, { x: pillar.x + 2.0, z: pillar.z });

      // Marche droit vers le pilier (-X)
      const moveInput = createEmptyInputState();
      moveInput.moveX = -1;
      for (let i = 0; i < 40; i++) {
        engine.step(0.016, moveInput);
      }

      const distToPillar = Math.hypot(
        engine.state.player.x - pillar.x,
        engine.state.player.z - pillar.z,
      );
      expect(distToPillar).toBeGreaterThanOrEqual(
        DUNGEON_PILLAR_RADIUS + PLAYER_RADIUS - 0.02,
      );

      // Le passage de 3.1 unités entre le pilier et le mur extérieur reste franchissable
      const outerGapX = pillar.x - 2.0;
      engine.loadZone(zoneId, { x: outerGapX, z: pillar.z + 2.0 });
      const northInput = createEmptyInputState();
      northInput.moveZ = -1;
      for (let i = 0; i < 50; i++) {
        engine.step(0.016, northInput);
      }
      expect(engine.state.player.z).toBeLessThan(pillar.z - 1.0);
    }
  });

  it('place toutes les torches au clair des murs hauts (z-tilt) et du mur sud abaissé', () => {
    for (const dungeon of [DUNGEON_GHOST_CAVE, DUNGEON_DRAGON_LAIR]) {
      const southLimitZ = dungeon.depth * 0.5 - 3.5;

      for (const torch of dungeon.torches) {
        expect(Math.abs(torch.x)).toBeLessThan(dungeon.width * 0.5);
        expect(Math.abs(torch.z)).toBeLessThan(dungeon.depth * 0.5);

        for (const wall of dungeon.walls) {
          const insideWall =
            torch.x >= wall.minX &&
            torch.x <= wall.maxX &&
            torch.z >= wall.minZ &&
            torch.z <= wall.maxZ;
          expect(insideWall).toBe(false);

          const inWallXSpan = torch.x > wall.minX && torch.x < wall.maxX;
          const isSouthEdge = wall.minZ >= southLimitZ;

          if (inWallXSpan && !isSouthEdge && torch.z > wall.maxZ) {
            // Pour un sprite incliné de -0.48 rad (Δz ≈ -0.854), garder >= 0.9u au sud du mur haut
            const distSouthOfWall = torch.z - wall.maxZ;
            if (distSouthOfWall < 2.0) {
              expect(distSouthOfWall).toBeGreaterThanOrEqual(0.9);
            }
          }

          if (inWallXSpan && isSouthEdge && torch.z < wall.minZ) {
            // Dégagement par rapport au mur sud abaissé
            expect(wall.minZ - torch.z).toBeGreaterThanOrEqual(1.5);
          }
        }
      }
    }
  });

  it('reflète les 6 EquipSlots dans getHeroEquipmentKey et compense la FOV sur écran étroit', () => {
    const baseKey = getHeroEquipmentKey(STARTING_EQUIPMENT);
    const withShield = getHeroEquipmentKey({
      ...STARTING_EQUIPMENT,
      shield: 'shield_wood',
    });
    const withTrinket = getHeroEquipmentKey({
      ...STARTING_EQUIPMENT,
      trinket: 'trinket_yarn',
    });
    const withSecondary = getHeroEquipmentKey({
      ...STARTING_EQUIPMENT,
      secondary_weapon: 'sword_steel',
    });

    expect(withShield).not.toBe(baseKey);
    expect(withTrinket).not.toBe(baseKey);
    expect(withSecondary).not.toBe(baseKey);
    expect(new Set([baseKey, withShield, withTrinket, withSecondary]).size).toBe(4);

    expect(computeResponsiveFov(16 / 9)).toBe(38);
    expect(computeResponsiveFov(1.2)).toBe(38);
    expect(computeResponsiveFov(768 / 1024)).toBeCloseTo(57.7, 0);
    expect(computeResponsiveFov(375 / 667)).toBe(62);
  });
});
