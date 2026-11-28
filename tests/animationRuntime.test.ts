import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_16_SPRITESHEETS,
  ENEMY_ANIM_CLIPS,
  HD_CAPE_FABRIC_FILES,
  HD_CHARACTER_FILES,
  HD_ENEMY_PHASE2_SHEET_FILES,
  HD_ENEMY_SHEET_FILES,
  HD_ENEMY_STATE_SHEET_FILES,
  HD_EQUIPMENT_FILES,
  HD_EQUIPMENT_SHEET_FILES,
  HD_HERO_SHEET_FILES,
  HD_NPC_SHEET_FILES,
  HD_PROP_FILES,
  HD_SURFACE_FILES,
  HERO_ANIM_CLIPS,
  NPC_ANIM_CLIPS,
  TARGET_ANIMATION_FPS,
  type HdEnemySheetKey,
  type NpcId,
  type SpriteGridSpec,
  advanceSpriteAnimCursor,
  applyUvRectToTexture,
  computeGridFrameUvInto,
  createSpriteAnimCursor,
  createSpriteUvRect,
  resolveActiveSpriteGrid,
  resolveEnemyAtlasStateGrid,
  resolveEnemySixStateGrid,
  sampleOneShotProgressFrame,
} from '../src/art/hdAssets';
import {
  HERO_BODY_EQUIP_SLOTS,
  getHeroBodyTextureKey,
  getHeroEquipmentKey,
  getHeroTextureKey,
} from '../src/art/spriteHero';
import { TextureRegistry } from '../src/art/textureRegistry';
import { EQUIPMENT, EQUIPMENT_LIST } from '../src/data/equipmentData';
import { GameEngine } from '../src/game/gameEngine';
import { addEquipment, equipItem } from '../src/game/progression';
import { ALL_EQUIP_SLOTS, type EnemyInstance } from '../src/game/types';
import { EntityRenderer } from '../src/render/entityRenderer';

interface MinimalNodeFs {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string): Uint8Array;
}

interface MinimalNodePath {
  resolve(...segments: string[]): string;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function getNodePngReader(): Promise<
  (relAssetPath: string) => { width: number; height: number }
> {
  const fsModName = 'node:' + 'fs';
  const pathModName = 'node:' + 'path';
  const fsMod = (await import(/* @vite-ignore */ fsModName)) as unknown as MinimalNodeFs;
  const pathMod = (await import(/* @vite-ignore */ pathModName)) as unknown as MinimalNodePath;
  const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
  const cwd = proc ? proc.cwd() : '.';

  return (relAssetPath: string): { width: number; height: number } => {
    const fullPath = pathMod.resolve(cwd, 'public', relAssetPath);
    expect(fsMod.existsSync(fullPath), `Fichier manquant sur disque : ${fullPath}`).toBe(true);
    const bytes = fsMod.readFileSync(fullPath);
    for (let i = 0; i < PNG_SIGNATURE.length; i++) {
      expect(bytes[i]).toBe(PNG_SIGNATURE[i]);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
    };
  };
}

function makeSyntheticSheetTexture(
  width: number,
  height: number,
  label: string,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.image = { data: new Uint8Array(4), width, height };
  tex.name = label;
  tex.needsUpdate = true;
  return tex;
}

function makeEnemyInstance(
  id: string,
  typeId: HdEnemySheetKey,
  x: number,
  z: number,
  phase: 1 | 2 = 1,
): EnemyInstance {
  const isBoss = typeId === 'boss_rat_king' || typeId === 'boss_dragon_claw';
  return {
    id,
    typeId,
    name: id,
    level: 3,
    x,
    z,
    homeX: x,
    homeZ: z,
    facingX: 1,
    hp: 200,
    maxHp: 200,
    radius: isBoss ? 1.5 : 0.9,
    state: 'idle',
    stateTimer: 0,
    attackCooldown: 0,
    slowTimer: 0,
    hitFlashTimer: 0,
    phase,
    isBoss,
    respawnTimer: 0,
    vx: 0,
    vz: 0,
  };
}

describe('Runtime Animations 2D Multi-Frames 30 FPS — Cadences & Nombres Variables de Frames', () => {
  it.each([
    { frameCount: 15, cols: 5, rows: 3, expectedDuration: 0.5 },
    { frameCount: 24, cols: 6, rows: 4, expectedDuration: 0.8 },
    { frameCount: 30, cols: 6, rows: 5, expectedDuration: 1.0 },
    { frameCount: 45, cols: 9, rows: 5, expectedDuration: 1.5 },
  ])(
    'lit exactement $frameCount frames distinctes à 30 FPS ($expectedDuration s) en boucle et en ponctuel',
    ({ frameCount, cols, rows, expectedDuration }) => {
      expect(TARGET_ANIMATION_FPS).toBe(30);
      const dt = 1 / 30;
      const grid: SpriteGridSpec = { cols, rows, frameCount, cellWidth: 256, cellHeight: 256 };

      // 1. Mode boucle (loop: true) : visite chaque frame 0 .. frameCount-1 puis reboucle à 0
      const loopCursor = createSpriteAnimCursor('test_loop');
      const loopVisited: number[] = [loopCursor.frameIndex];
      for (let step = 1; step <= frameCount + 3; step++) {
        loopVisited.push(
          advanceSpriteAnimCursor(
            loopCursor,
            { id: 'test_loop', fps: 30, loop: true },
            grid.frameCount,
            dt,
          ),
        );
        expect(loopCursor.finished).toBe(false);
      }
      for (let i = 0; i < frameCount; i++) {
        expect(loopVisited[i]).toBe(i);
      }
      expect(loopVisited[frameCount]).toBe(0);
      expect(loopVisited[frameCount + 1]).toBe(1);
      expect(loopVisited[frameCount + 2]).toBe(2);
      expect(loopVisited[frameCount + 3]).toBe(3);

      // 2. Mode ponctuel (loop: false) : progresse de 0 à frameCount-1 puis s'arrête net sans reboucler
      const onceCursor = createSpriteAnimCursor('test_once');
      for (let step = 1; step < frameCount; step++) {
        const idx = advanceSpriteAnimCursor(
          onceCursor,
          { id: 'test_once', fps: 30, loop: false },
          grid.frameCount,
          dt,
        );
        expect(idx).toBe(step);
        if (step < frameCount - 1) {
          expect(onceCursor.finished).toBe(false);
        }
      }
      const endIdx = advanceSpriteAnimCursor(
        onceCursor,
        { id: 'test_once', fps: 30, loop: false },
        grid.frameCount,
        dt,
      );
      expect(endIdx).toBe(frameCount - 1);
      expect(onceCursor.finished).toBe(true);
      expect(onceCursor.elapsed).toBeCloseTo(expectedDuration, 5);

      for (let extra = 0; extra < 20; extra++) {
        expect(
          advanceSpriteAnimCursor(
            onceCursor,
            { id: 'test_once', fps: 30, loop: false },
            grid.frameCount,
            dt,
          ),
        ).toBe(frameCount - 1);
        expect(onceCursor.finished).toBe(true);
      }
    },
  );

  it('échantillonne de façon monotone la progression normalisée [0..1] des actions ponctuelles (attaque, roulade, impact)', () => {
    for (const count of [15, 30, 45]) {
      expect(sampleOneShotProgressFrame(0, count)).toBe(0);
      expect(sampleOneShotProgressFrame(-0.5, count)).toBe(0);
      expect(sampleOneShotProgressFrame(0.5, count)).toBe(Math.floor(count * 0.5));
      expect(sampleOneShotProgressFrame(0.999, count)).toBe(count - 1);
      expect(sampleOneShotProgressFrame(1, count)).toBe(count - 1);
      expect(sampleOneShotProgressFrame(2.5, count)).toBe(count - 1);

      let prev = 0;
      for (let i = 0; i <= count; i++) {
        const cur = sampleOneShotProgressFrame(i / count, count);
        expect(cur).toBeGreaterThanOrEqual(prev);
        expect(cur).toBeLessThan(count);
        prev = cur;
      }
    }
  });
});

describe('Parcours de Grille Multi-Lignes (col, row) & Paramètres UV Three.js Zéro-Allocation', () => {
  it('parcourt les cellules (col, row) dans l’ordre ligne-majeure exact et respecte frameCount < cols * rows', () => {
    const grid: SpriteGridSpec = { cols: 4, rows: 4, frameCount: 15 };
    const uv = createSpriteUvRect();
    const visitedCoords: Array<[number, number]> = [];

    for (let f = 0; f < 15; f++) {
      const ref = computeGridFrameUvInto(grid, f, uv, true);
      expect(ref).toBe(uv);
      visitedCoords.push([uv.col, uv.row]);
      expect(uv.repeatX).toBeCloseTo(0.25, 6);
      expect(uv.repeatY).toBeCloseTo(0.25, 6);
      expect(uv.offsetX).toBeCloseTo(uv.col * 0.25, 6);
      expect(uv.offsetY).toBeCloseTo((3 - uv.row) * 0.25, 6);
    }

    expect(visitedCoords).toEqual([
      [0, 0], [1, 0], [2, 0], [3, 0],
      [0, 1], [1, 1], [2, 1], [3, 1],
      [0, 2], [1, 2], [2, 2], [3, 2],
      [0, 3], [1, 3], [2, 3],
    ]);

    computeGridFrameUvInto(grid, 99, uv, true);
    expect([uv.col, uv.row]).toEqual([2, 3]);
    expect(uv.frameIndex).toBe(14);
  });

  it('supporte les atlas multi-lignes (15×4 uniforme ET 90 frames empaquetées 30+30+15+15) sans allouer de Vector2', () => {
    // 1. Atlas uniforme 15 colonnes × 4 lignes
    const w = 15 * 256;
    const h = 4 * 256;
    const idleGrid = resolveEnemyAtlasStateGrid('thorn_wolf', 'idle', w, h);
    const moveGrid = resolveEnemyAtlasStateGrid('thorn_wolf', 'move', w, h);
    const windupGrid = resolveEnemyAtlasStateGrid('thorn_wolf', 'windup', w, h);
    const attackGrid = resolveEnemyAtlasStateGrid('thorn_wolf', 'attack', w, h);

    expect(idleGrid).toMatchObject({ cols: 15, rows: 4, frameCount: 15, startFrame: 0 });
    expect(moveGrid).toMatchObject({ cols: 15, rows: 4, frameCount: 15, startFrame: 15 });
    expect(windupGrid).toMatchObject({ cols: 15, rows: 4, frameCount: 15, startFrame: 30 });
    expect(attackGrid).toMatchObject({ cols: 15, rows: 4, frameCount: 15, startFrame: 45 });

    // 2. Atlas 90 frames empaqueté (10×9 = 30f idle + 30f move + 15f windup + 15f attack)
    const w90 = 10 * 256;
    const h90 = 9 * 256;
    expect(resolveEnemyAtlasStateGrid('boss_dragon_claw', 'idle', w90, h90)).toMatchObject({
      cols: 10,
      rows: 9,
      frameCount: 30,
      startFrame: 0,
    });
    expect(resolveEnemyAtlasStateGrid('boss_dragon_claw', 'move', w90, h90)).toMatchObject({
      cols: 10,
      rows: 9,
      frameCount: 30,
      startFrame: 30,
    });
    expect(resolveEnemyAtlasStateGrid('boss_dragon_claw', 'windup', w90, h90)).toMatchObject({
      cols: 10,
      rows: 9,
      frameCount: 15,
      startFrame: 60,
    });
    expect(resolveEnemyAtlasStateGrid('boss_dragon_claw', 'attack', w90, h90)).toMatchObject({
      cols: 10,
      rows: 9,
      frameCount: 15,
      startFrame: 75,
    });

    const tex = makeSyntheticSheetTexture(w, h, 'wolf_atlas');
    const repeatRef = tex.repeat;
    const offsetRef = tex.offset;
    const rect = createSpriteUvRect();

    computeGridFrameUvInto(windupGrid, 7, rect, true);
    expect(rect.row).toBe(2);
    expect(rect.col).toBe(7);
    applyUvRectToTexture(tex, rect);

    expect(tex.repeat).toBe(repeatRef);
    expect(tex.offset).toBe(offsetRef);
    expect(tex.repeat.x).toBeCloseTo(1 / 15, 6);
    expect(tex.repeat.y).toBeCloseTo(0.25, 6);
    expect(tex.offset.x).toBeCloseTo(7 / 15, 6);
    expect(tex.offset.y).toBeCloseTo((4 - 1 - 2) * 0.25, 6);
    tex.dispose();
  });
});

describe('Couches Modulaires Indépendantes du Héros & Intégrité de la Cape Verlet', () => {
  it('maintient exactement 5 emplacements indépendants sans arme secondaire et isole la cape du cache corps 3D', () => {
    expect(ALL_EQUIP_SLOTS).toEqual([
      'weapon',
      'shield',
      'helmet',
      'armor',
      'cape',
    ]);
    expect(HERO_BODY_EQUIP_SLOTS).toEqual([
      'weapon',
      'shield',
      'helmet',
      'armor',
    ]);
    expect((ALL_EQUIP_SLOTS as readonly string[]).includes('secondary_weapon')).toBe(false);
    expect(EQUIPMENT['dagger_fang']).toBeUndefined();
    expect(EQUIPMENT_LIST.some((e) => (e.slot as string) === 'secondary_weapon')).toBe(false);

    const engine = new GameEngine();
    engine.startNewGame();
    const p = engine.state.player;
    for (const id of [
      'armor_dragon',
      'helm_mage',
      'cape_starlight',
      'cape_dragon',
      'shield_knight',
      'hammer_frost',
      'bow_hunter',
      'blade_dragon',
    ]) {
      addEquipment(p, id);
    }

    const textures = new TextureRegistry();
    const idleClipBeforeCape = textures.resolveHeroClip(p.equipped, 'idle');
    const bodyKeyBeforeCape = getHeroBodyTextureKey(p.equipped, 'idle');
    const previewKeyBeforeCape = getHeroTextureKey(p.equipped, 'idle');

    // Équiper/changer une cape NE modifie NI la clé 3D du corps NI la référence ResolvedSpriteClipSource
    expect(equipItem(p, 'cape_starlight')).toBe(true);
    expect(getHeroBodyTextureKey(p.equipped, 'idle')).toBe(bodyKeyBeforeCape);
    expect(textures.resolveHeroClip(p.equipped, 'idle')).toBe(idleClipBeforeCape);
    expect(getHeroTextureKey(p.equipped, 'idle')).not.toBe(previewKeyBeforeCape);
    expect(getHeroEquipmentKey(p.equipped)).toContain('cape_starlight');

    // Changer l'armure modifie uniquement le slot armor
    expect(equipItem(p, 'armor_dragon')).toBe(true);
    expect(p.equipped.armor).toBe('armor_dragon');
    expect(p.equipped.helmet).toBe('helm_bandana');
    expect(p.equipped.cape).toBe('cape_starlight');
    expect(p.equipped.weapon).toBe('sword_wood');
    const afterArmorKey = getHeroBodyTextureKey(p.equipped, 'idle');
    expect(afterArmorKey).not.toBe(bodyKeyBeforeCape);

    // Changer le casque modifie uniquement le slot helmet
    expect(equipItem(p, 'helm_mage')).toBe(true);
    expect(p.equipped.helmet).toBe('helm_mage');
    expect(p.equipped.armor).toBe('armor_dragon');
    expect(p.equipped.cape).toBe('cape_starlight');
    expect(getHeroBodyTextureKey(p.equipped, 'idle')).not.toBe(afterArmorKey);

    textures.dispose();
  });

  it('pilote EntityRenderer à 30 FPS sur séquences variables (15/30/45 frames), préserve la cape Verlet et branche une texture de cape dédiée', () => {
    const scene = new THREE.Scene();
    const textures = new TextureRegistry();

    const heroIdleSheet = makeSyntheticSheetTexture(6 * 512, 5 * 512, 'hero_idle_30');
    const heroAttackSheet = makeSyntheticSheetTexture(5 * 512, 3 * 512, 'hero_attack_15');
    const heroRollSheet = makeSyntheticSheetTexture(5 * 512, 3 * 512, 'hero_roll_15');
    const walkSequence = Array.from({ length: 30 }, (_, i) =>
      makeSyntheticSheetTexture(512, 512, `hero_walk_f${i}`),
    );
    const companionSheet45 = makeSyntheticSheetTexture(9 * 512, 5 * 512, 'miaou_45');
    const capeFabricTex = makeSyntheticSheetTexture(512, 512, 'cape_starlight_fabric');

    textures.registerHeroSpriteSheet('idle', heroIdleSheet);
    textures.registerHeroFrameSequence('walk', walkSequence);
    textures.registerHeroSpriteSheet('attack', heroAttackSheet);
    textures.registerHeroSpriteSheet('roll', heroRollSheet);
    textures.registerNpcSpriteSheet('miaou_sprit', companionSheet45, {
      grid: { cols: 9, rows: 5, frameCount: 45, cellWidth: 512, cellHeight: 512 },
    });
    textures.registerCapeFabricTexture('cape_starlight', capeFabricTex);

    const renderer = new EntityRenderer(scene, textures);
    const engine = new GameEngine();
    engine.startNewGame();
    engine.state.dialogue.active = false;

    const p = engine.state.player;
    addEquipment(p, 'cape_starlight');
    equipItem(p, 'cape_starlight');

    // 1. Idle 30 frames à 30 FPS
    renderer.update(engine.state, 0);
    let diag = renderer.getAnimationDiagnostics();
    expect(diag.hero.state).toBe('idle');
    expect(diag.hero.frameCount).toBe(30);
    expect(diag.hero.frameIndex).toBe(0);
    expect(diag.companion.frameCount).toBe(45);

    for (let i = 0; i < 12; i++) {
      renderer.update(engine.state, 1 / 30);
    }
    diag = renderer.getAnimationDiagnostics();
    expect(diag.hero.frameIndex).toBe(12);
    expect(diag.hero.uv.row).toBe(2);
    expect(diag.hero.uv.col).toBe(0);
    expect(diag.companion.frameIndex).toBe(12);

    // 2. Marche sur séquence préchargée de 30 textures
    p.vx = 6.5;
    p.vz = 0;
    renderer.update(engine.state, 0);
    for (let i = 0; i < 19; i++) {
      p.x += p.vx * (1 / 30);
      renderer.update(engine.state, 1 / 30);
    }
    diag = renderer.getAnimationDiagnostics();
    expect(diag.hero.state).toBe('walk');
    expect(diag.hero.frameCount).toBe(30);
    expect(diag.hero.frameIndex).toBe(19);
    expect(diag.hero.textureUuid).toBe(walkSequence[19].uuid);

    // 3. Attaque ponctuelle 15 frames (loop: false, progresse de 0 à 14 sans boucler)
    p.vx = 0;
    p.attackAnimTimer = 0.5;
    renderer.update(engine.state, 0);
    expect(renderer.getAnimationDiagnostics().hero.state).toBe('attack');
    expect(renderer.getAnimationDiagnostics().hero.frameIndex).toBe(0);

    p.attackAnimTimer = 0.25;
    renderer.update(engine.state, 1 / 30);
    expect(renderer.getAnimationDiagnostics().hero.frameIndex).toBe(7);

    p.attackAnimTimer = 0.001;
    renderer.update(engine.state, 1 / 30);
    expect(renderer.getAnimationDiagnostics().hero.frameIndex).toBe(14);

    // 4. Roulade ponctuelle 15 frames + intégrité complète de la cape Verlet + texture dédiée
    p.attackAnimTimer = 0;
    p.dodgeTimer = 0.3;
    p.vx = 14;
    renderer.update(engine.state, 1 / 30);
    expect(renderer.getAnimationDiagnostics().hero.state).toBe('roll');

    p.dodgeTimer = 0.01;
    renderer.update(engine.state, 1 / 30);
    expect(renderer.getAnimationDiagnostics().hero.frameIndex).toBe(14);

    const capeDiag = renderer.getCapeDiagnostics();
    expect(capeDiag.visible).toBe(true);
    expect(capeDiag.activeCapeId).toBe('cape_starlight');
    expect(capeDiag.hasCustomFabricTexture).toBe(true);
    expect(capeDiag.vertexCount).toBe(143);
    expect(capeDiag.maxZViolation).toBeLessThanOrEqual(0);
    expect(capeDiag.minWorldY).toBeGreaterThanOrEqual(0.08);

    renderer.dispose();
    textures.dispose();
    for (const t of walkSequence) t.dispose();
  });

  it('isole les UV de plusieurs ennemis simultanés partageant la même spritesheet et gère Drak-Miaou Phase 1 & Phase 2', () => {
    const scene = new THREE.Scene();
    const textures = new TextureRegistry();

    const slimeAtlas = makeSyntheticSheetTexture(15 * 256, 4 * 256, 'slime_15x4');
    const dragonP1 = makeSyntheticSheetTexture(9 * 256, 5 * 256, 'dragon_p1_45');
    const dragonP2 = makeSyntheticSheetTexture(9 * 256, 5 * 256, 'dragon_p2_45');

    textures.registerEnemySpriteSheet('slime_yarn', slimeAtlas);
    textures.registerEnemySpriteSheet('boss_dragon_claw', dragonP1, {
      phase: 1,
      grid: { cols: 9, rows: 5, frameCount: 45, cellWidth: 256, cellHeight: 256 },
    });
    textures.registerEnemySpriteSheet('boss_dragon_claw', dragonP2, {
      phase: 2,
      grid: { cols: 9, rows: 5, frameCount: 45, cellWidth: 256, cellHeight: 256 },
    });

    const renderer = new EntityRenderer(scene, textures);
    const engine = new GameEngine();
    engine.startNewGame();
    engine.state.dialogue.active = false;

    const slimeA = makeEnemyInstance('slime_a', 'slime_yarn', 0, 0);
    slimeA.state = 'idle';
    const slimeB = makeEnemyInstance('slime_b', 'slime_yarn', 10, 10);
    slimeB.state = 'chase';
    slimeB.vx = 3.5;

    const dragon = makeEnemyInstance('dragon_boss', 'boss_dragon_claw', 0, -20, 1);
    engine.state.enemies = [slimeA, slimeB, dragon];

    renderer.update(engine.state, 1 / 30);
    for (let i = 0; i < 5; i++) {
      renderer.update(engine.state, 1 / 30);
    }

    const diag1 = renderer.getAnimationDiagnostics();
    expect(diag1.enemies.slime_a.state).toBe('idle');
    expect(diag1.enemies.slime_b.state).toBe('move');
    expect(diag1.enemies.slime_a.textureUuid).not.toBe(diag1.enemies.slime_b.textureUuid);
    expect(diag1.enemies.slime_a.uv.row).toBe(0);
    expect(diag1.enemies.slime_b.uv.row).toBe(1);

    const p1TexUuid = diag1.enemies.dragon_boss.textureUuid;
    expect(diag1.enemies.dragon_boss.phase).toBe(1);
    expect(diag1.enemies.dragon_boss.frameCount).toBe(45);

    dragon.phase = 2;
    renderer.update(engine.state, 1 / 30);
    const diag2 = renderer.getAnimationDiagnostics();
    expect(diag2.enemies.dragon_boss.phase).toBe(2);
    expect(diag2.enemies.dragon_boss.frameCount).toBe(45);
    expect(diag2.enemies.dragon_boss.textureUuid).not.toBe(p1TexUuid);

    renderer.dispose();
    textures.dispose();
  });
});

describe('Rétrocompatibilité 100 % Transparente avec public/assets/ (Zéro 404, Pivots Constants)', () => {
  it('vérifie que tous les chemins déclarés dans les manifestes actifs existent sur disque et que les registres optionnels sont vides par défaut', async () => {
    const readPngHeaderSize = await getNodePngReader();

    expect(Object.keys(HD_HERO_SHEET_FILES)).toHaveLength(0);
    expect(Object.keys(HD_EQUIPMENT_SHEET_FILES)).toHaveLength(0);
    expect(Object.keys(HD_NPC_SHEET_FILES)).toHaveLength(0);
    expect(Object.keys(HD_ENEMY_STATE_SHEET_FILES)).toHaveLength(0);
    expect(Object.keys(HD_ENEMY_PHASE2_SHEET_FILES)).toHaveLength(0);
    expect(Object.keys(HD_CAPE_FABRIC_FILES)).toHaveLength(0);

    for (const rel of Object.values(HD_CHARACTER_FILES)) {
      if (rel) readPngHeaderSize(rel);
    }
    for (const rel of Object.values(HD_ENEMY_SHEET_FILES)) {
      readPngHeaderSize(rel);
    }
    for (const rel of Object.values(HD_EQUIPMENT_FILES)) {
      readPngHeaderSize(rel);
    }
    for (const rel of Object.values(HD_PROP_FILES)) {
      if (rel) readPngHeaderSize(rel);
    }
    for (const surf of Object.values(HD_SURFACE_FILES)) {
      for (const rel of Object.values(surf)) {
        if (rel) readPngHeaderSize(rel);
      }
    }
  });

  it('résout exactement les dimensions réelles actuelles des PNG de public/assets/characters sans régression visuelle', async () => {
    const readPngHeaderSize = await getNodePngReader();

    for (const key of [
      'hero_base_idle',
      'hero_base_walk1',
      'hero_base_walk2',
      'hero_base_attack',
      'hero_base_roll',
    ] as const) {
      const size = readPngHeaderSize(HD_CHARACTER_FILES[key]!);
      expect(size).toEqual({ width: 512, height: 512 });
    }
    const heroIdleLegacy = resolveActiveSpriteGrid(HERO_ANIM_CLIPS.idle, 512, 512);
    expect(heroIdleLegacy).toMatchObject({ cols: 1, rows: 1, frameCount: 1 });

    const refPivot = HERO_ANIM_CLIPS.idle.pivot;
    for (const clip of Object.values(HERO_ANIM_CLIPS)) {
      expect(clip.pivot).toEqual(refPivot);
      expect(clip.lateralFlipOnly).toBe(true);
      if (clip.sharedFrom) {
        expect(clip.sharedReason?.length).toBeGreaterThan(10);
      }
    }

    for (const npcId of [
      'miaou_sprit',
      'mayor_moustache',
      'kit_chat',
      'innkeeper',
    ] as readonly NpcId[]) {
      const size = readPngHeaderSize(HD_CHARACTER_FILES[npcId]!);
      expect(size).toEqual({ width: 512, height: 512 });
      const resolved = resolveActiveSpriteGrid(
        NPC_ANIM_CLIPS[npcId].idle,
        size.width,
        size.height,
      );
      expect(resolved).toMatchObject({ cols: 1, rows: 1, frameCount: 1 });
    }

    expect(HERO_ANIM_CLIPS.walk.frameSequenceKeys).toBeUndefined();

    const allEnemies: readonly HdEnemySheetKey[] = [
      'slime_yarn',
      'mouse_goblin',
      'thorn_wolf',
      'fishbone_skeleton',
      'frost_golem',
      'boss_rat_king',
      'boss_dragon_claw',
    ];
    for (const enemyId of allEnemies) {
      const spec = CANONICAL_16_SPRITESHEETS[enemyId];
      const size = readPngHeaderSize(HD_ENEMY_SHEET_FILES[enemyId]);
      expect(size).toEqual({
        width: spec.cols * spec.cellWidth,
        height: spec.rows * spec.cellHeight,
      });
      expect(ENEMY_ANIM_CLIPS[enemyId].idle.fps).toBe(30);
      expect(ENEMY_ANIM_CLIPS[enemyId].windup.loop).toBe(false);
      expect(ENEMY_ANIM_CLIPS[enemyId].attack.loop).toBe(false);

      expect(resolveEnemySixStateGrid(enemyId, 'idle', size.width, size.height)).toMatchObject({
        cols: 10,
        rows: 9,
        frameCount: 15,
        startFrame: 0,
      });
      expect(resolveEnemySixStateGrid(enemyId, 'move', size.width, size.height)).toMatchObject({
        cols: 10,
        rows: 9,
        frameCount: 15,
        startFrame: 15,
      });
      expect(resolveEnemySixStateGrid(enemyId, 'windup', size.width, size.height)).toMatchObject({
        cols: 10,
        rows: 9,
        frameCount: 15,
        startFrame: 30,
      });
      expect(resolveEnemySixStateGrid(enemyId, 'attack', size.width, size.height)).toMatchObject({
        cols: 10,
        rows: 9,
        frameCount: 15,
        startFrame: 45,
      });
      expect(resolveEnemySixStateGrid(enemyId, 'hurt', size.width, size.height)).toMatchObject({
        cols: 10,
        rows: 9,
        frameCount: 15,
        startFrame: 60,
      });
      expect(resolveEnemySixStateGrid(enemyId, 'death', size.width, size.height)).toMatchObject({
        cols: 10,
        rows: 9,
        frameCount: 15,
        startFrame: 75,
      });
    }
  });
});
