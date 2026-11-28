import { describe, expect, it } from 'vitest';
import rawManifest from '../public/assets/animations_manifest.json';
import {
  CANONICAL_16_SPRITESHEETS,
  ENEMY_SIX_STATE_ORDER,
  FIXED_ANIM_STEP_SEC,
  createFixedStepAnimClock,
  resolveEnemySixStateGrid,
  resolveMayorMoustacheGrid,
  stepFixed30FpsClock,
  type AnimationManifest,
  type CanonicalSheetId,
  type HdEnemySheetKey,
} from '../src/art/hdAssets';
import {
  HERO_27_EQUIPMENT_LAYERS,
  HERO_LANTERN_HAND_THRESHOLD,
  HERO_TORSO_ENVELOPE,
  computeIdealArmorFit,
  createHeroLanternRigState,
  createPaperFlipOvershootState,
  measureArmorImageMetrics,
  sampleHeroFrameSockets,
  stepHeroLanternRig,
  stepPaperFlipOvershoot,
} from '../src/art/spriteHero';
import { DragonPortraitFacialController } from '../src/ui/modalsController';

interface MinimalNodeFs {
  existsSync(filePath: string): boolean;
  readFileSync(filePath: string): Uint8Array;
}

interface MinimalNodePath {
  resolve(...segments: string[]): string;
}

async function createPngSizeReader(): Promise<
  (relAssetPath: string) => { width: number; height: number }
> {
  const fsMod = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as MinimalNodeFs;
  const pathMod = (await import(/* @vite-ignore */ 'node:' + 'path')) as unknown as MinimalNodePath;
  const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
  const cwd = proc ? proc.cwd() : '.';

  return (relAssetPath: string): { width: number; height: number } => {
    const fullPath = pathMod.resolve(cwd, 'public', relAssetPath);
    expect(fsMod.existsSync(fullPath), `Feuille bakée manquante : ${fullPath}`).toBe(true);
    const bytes = fsMod.readFileSync(fullPath);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      width: view.getUint32(16, false),
      height: view.getUint32(20, false),
    };
  };
}

describe('Pipeline Animation 2.5D/3D (30 FPS, 16 Spritesheets, Sockets, Lanterne & Dragon)', () => {
  it('maintient un pas fixe exact à 30 FPS découplé du framerate WebGL (60/120/144 Hz et variable)', () => {
    expect(FIXED_ANIM_STEP_SEC).toBeCloseTo(1 / 30, 6);

    for (const renderHz of [60, 120, 144]) {
      const clock = createFixedStepAnimClock();
      const dt = 1 / renderHz;
      let totalSteps = 0;
      for (let i = 0; i < renderHz; i++) {
        totalSteps += stepFixed30FpsClock(clock, dt);
      }
      expect(totalSteps).toBe(30);
      expect(clock.tickCount).toBe(30);
    }

    // Variable dt sur exactement 2.0 secondes -> 60 ticks
    const varClock = createFixedStepAnimClock();
    const pattern = [0.008, 0.017, 0.025, 0.011, 0.039]; // somme = 0.100 s
    let varSteps = 0;
    for (let cycle = 0; cycle < 20; cycle++) {
      for (const dt of pattern) {
        varSteps += stepFixed30FpsClock(varClock, dt);
      }
    }
    expect(varSteps).toBe(60);
    expect(varClock.alpha).toBeGreaterThanOrEqual(0);
    expect(varClock.alpha).toBeLessThanOrEqual(1);
  });

  it('référence exactement les 16 spritesheets canoniques synchronisées avec animations_manifest.json', async () => {
    const manifest = rawManifest as unknown as AnimationManifest;
    const readPngSize = await createPngSizeReader();

    const canonicalIds = Object.keys(CANONICAL_16_SPRITESHEETS) as CanonicalSheetId[];
    expect(canonicalIds).toHaveLength(16);
    expect(manifest.sheetCount).toBe(16);
    expect(Object.keys(manifest.sheets)).toHaveLength(16);
    expect(manifest.fps).toBe(30);

    for (const id of canonicalIds) {
      const spec = CANONICAL_16_SPRITESHEETS[id];
      const entry = manifest.sheets[id];
      expect(entry).toBeDefined();
      expect(entry.cols).toBe(spec.cols);
      expect(entry.rows).toBe(spec.rows);
      expect(entry.cellWidth).toBe(spec.cellWidth);
      expect(entry.cellHeight).toBe(spec.cellHeight);
      expect(entry.frameCount).toBe(spec.frameCount);
      expect(entry.cols * entry.rows).toBe(entry.frameCount);
      expect(entry.atlasWidth).toBe(entry.cols * entry.cellWidth);
      expect(entry.atlasHeight).toBe(entry.rows * entry.cellHeight);
      expect(entry.fps).toBe(30);
      // Toutes les 16 feuilles canoniques doivent être physiquement bakées sur disque
      expect(entry.baked).toBe(true);
      const dims = readPngSize(entry.file);
      expect(dims.width).toBe(entry.atlasWidth);
      expect(dims.height).toBe(entry.atlasHeight);
    }

    // Feuille d'ouverture fluide du coffre (15 frames 5×3 à 30 FPS)
    expect(manifest.chestOpeningSheet).toBeDefined();
    expect(manifest.chestOpeningSheet?.baked).toBe(true);
    expect(manifest.chestOpeningSheet?.frameCount).toBe(15);
    const chestDims = readPngSize(manifest.chestOpeningSheet!.file);
    expect(chestDims.width).toBe(1280);
    expect(chestDims.height).toBe(768);

    // Vérification des décomptes exacts par famille (30 / 45 / 90 / 15)
    expect(CANONICAL_16_SPRITESHEETS.hero_base_idle.frameCount).toBe(30);
    expect(CANONICAL_16_SPRITESHEETS.hero_base_walk.frameCount).toBe(30);
    expect(CANONICAL_16_SPRITESHEETS.hero_base_attack.frameCount).toBe(15);
    expect(CANONICAL_16_SPRITESHEETS.hero_base_roll.frameCount).toBe(15);
    expect(CANONICAL_16_SPRITESHEETS.miaou_sprit.frameCount).toBe(30);
    expect(CANONICAL_16_SPRITESHEETS.mayor_moustache.frameCount).toBe(45);
    expect(CANONICAL_16_SPRITESHEETS.portal_exit.frameCount).toBe(30);
    expect(CANONICAL_16_SPRITESHEETS.prop_torch.frameCount).toBe(15);
  });

  it('découpe les feuilles ennemies/boss 10×9 (90 frames) en 6 états contigus de 15 frames sans aucun repli legacy 4×1', () => {
    const enemyKeys: HdEnemySheetKey[] = [
      'slime_yarn',
      'mouse_goblin',
      'thorn_wolf',
      'fishbone_skeleton',
      'frost_golem',
      'boss_rat_king',
      'boss_dragon_claw',
    ];

    for (const key of enemyKeys) {
      const spec = CANONICAL_16_SPRITESHEETS[key];
      const atlasW = spec.cols * spec.cellWidth;
      const atlasH = spec.rows * spec.cellHeight;
      const starts: number[] = [];

      for (const state of ENEMY_SIX_STATE_ORDER) {
        const grid = resolveEnemySixStateGrid(key, state, atlasW, atlasH);
        expect(grid.cols).toBe(10);
        expect(grid.rows).toBe(9);
        expect(grid.frameCount).toBe(15);
        expect(grid.cellWidth).toBe(spec.cellWidth);
        expect(grid.cellHeight).toBe(spec.cellHeight);
        starts.push(grid.startFrame ?? -1);
      }

      expect(starts).toEqual([0, 15, 30, 45, 60, 75]);

      // Zéro repli legacy 4×1 : toute dimension non-10×9 renvoie une cellule statique sûre 1×1
      const nonBaked = resolveEnemySixStateGrid(key, 'windup', 1024, 256);
      expect(nonBaked.cols).toBe(1);
      expect(nonBaked.rows).toBe(1);
      expect(nonBaked.frameCount).toBe(1);
      expect(nonBaked.startFrame).toBe(0);
    }

    // Maire Moustache 9×5 (3456×1920) -> 3 états de 15 frames
    const mayorIdle = resolveMayorMoustacheGrid('idle', 9 * 384, 5 * 384);
    const mayorTalk = resolveMayorMoustacheGrid('talk', 9 * 384, 5 * 384);
    const mayorGreet = resolveMayorMoustacheGrid('greet', 9 * 384, 5 * 384);
    expect(mayorIdle.startFrame).toBe(0);
    expect(mayorTalk.startFrame).toBe(15);
    expect(mayorGreet.startFrame).toBe(30);
    expect(mayorGreet.frameCount).toBe(15);
  });

  it('expose les 27 couches d’équipement sans arc peint sur les armes, sockets hiérarchiques et flip 180° avec overshoot', () => {
    const layerEntries = Object.entries(HERO_27_EQUIPMENT_LAYERS);
    expect(layerEntries).toHaveLength(27);

    const weapons = layerEntries.filter(([, meta]) => meta.slot === 'weapon');
    expect(weapons).toHaveLength(13);
    for (const [, meta] of weapons) {
      expect(meta.noBakedSlashArc).toBe(true);
    }

    const idleSockets = sampleHeroFrameSockets('idle', 0, 30, { facingSign: 1 });
    const attackPeakSockets = sampleHeroFrameSockets('attack', 7, 15, { facingSign: 1 });
    const blockedSockets = sampleHeroFrameSockets('idle', 0, 30, {
      facingSign: 1,
      blocking: true,
    });

    expect(Object.keys(idleSockets)).toHaveLength(11);
    // Durant l'attaque, l'arme s'avance et pivote fortement par rapport à idle
    expect(attackPeakSockets.weapon.x).toBeGreaterThan(idleSockets.weapon.x);
    expect(attackPeakSockets.weapon.rot).not.toBeCloseTo(idleSockets.weapon.rot, 2);
    // En posture de blocage / Égide, le bouclier se lève vers l'avant
    expect(blockedSockets.shield.y).toBeGreaterThan(idleSockets.shield.y);
    expect(blockedSockets.shield.x).toBeGreaterThan(idleSockets.shield.x);

    // Retournement 180° façon feuille rigide : overshoot > PI au pic puis stabilisation exacte à PI
    const flip = createPaperFlipOvershootState(1);
    let maxRotY = 0;
    let minAbsScaleX = Infinity;
    for (let i = 0; i < 24; i++) {
      stepPaperFlipOvershoot(flip, -1, 0.01, 0.18);
      maxRotY = Math.max(maxRotY, flip.rotationY);
      minAbsScaleX = Math.min(minAbsScaleX, Math.abs(flip.scaleX));
    }
    expect(maxRotY).toBeGreaterThan(Math.PI + 0.15);
    expect(flip.rotationY).toBeCloseTo(Math.PI, 4);
    expect(minAbsScaleX).toBeGreaterThanOrEqual(0.14 - 1e-6);
  });

  it('bascule la lanterne du héros entre ceinture et main selon weather.lanternBoost avec pendule physique', () => {
    const rig = createHeroLanternRigState();
    const sockets = sampleHeroFrameSockets('walk', 5, 30, { facingSign: 1 });

    // Jour clair -> reste accrochée à la ceinture
    for (let i = 0; i < 20; i++) {
      stepHeroLanternRig(
        rig,
        sockets,
        { lanternBoost: HERO_LANTERN_HAND_THRESHOLD - 0.1, vx: 0, vz: 0, facingSign: 1 },
        1 / 60,
      );
    }
    expect(rig.socket).toBe('belt');
    expect(rig.handBlend).toBeCloseTo(0, 2);
    expect(rig.haloIntensity).toBeLessThan(0.1);

    // Nuit / Tempête + marche rapide -> passage en main + balancement pendulaire + halo actif
    for (let i = 0; i < 60; i++) {
      stepHeroLanternRig(
        rig,
        sockets,
        {
          lanternBoost: 0.92,
          vx: 5.5,
          vz: 0.6,
          facingSign: 1,
          windIntensity: 0.8,
        },
        1 / 60,
      );
    }
    expect(rig.socket).toBe('hand');
    expect(rig.handBlend).toBeGreaterThan(0.95);
    expect(Math.abs(rig.swingAngle)).toBeGreaterThan(0.08);
    expect(rig.haloIntensity).toBeGreaterThan(0.75);

    // Retour en plein jour -> rangement à la ceinture
    for (let i = 0; i < 90; i++) {
      stepHeroLanternRig(
        rig,
        sockets,
        { lanternBoost: 0, vx: 0, vz: 0, facingSign: 1, windIntensity: 0 },
        1 / 60,
      );
    }
    expect(rig.socket).toBe('belt');
    expect(rig.handBlend).toBeLessThan(0.05);
  });

  it('anime le portrait du Dragon-Griffe (clignement périodique et ouverture buccale en dialogue)', () => {
    const facial = new DragonPortraitFacialController();
    let sawBlink = false;
    let sawMouthPeak = false;
    let sawMouthLow = false;

    for (let i = 0; i < 240; i++) {
      const sample = facial.step(1 / 60, true);
      if (sample.blinking) sawBlink = true;
      if (sample.mouthOpen > 0.7) sawMouthPeak = true;
      if (sample.mouthOpen < 0.3) sawMouthLow = true;
      expect(sample.mouthOpen).toBeGreaterThanOrEqual(0);
      expect(sample.mouthOpen).toBeLessThanOrEqual(1);
    }

    expect(sawBlink).toBe(true);
    expect(sawMouthPeak).toBe(true);
    expect(sawMouthLow).toBe(true);

    // Silencieux -> bouche fermée
    const silent = facial.step(1 / 60, false);
    expect(silent.mouthOpen).toBe(0);
  });

  it('place la lanterne du héros sur sa droite (+X en orientation par défaut) à la ceinture comme en main', () => {
    const rightSockets = sampleHeroFrameSockets('idle', 0, 30, { facingSign: 1 });
    expect(rightSockets.lanternBelt.x).toBeGreaterThan(0.1);
    expect(rightSockets.lanternHand.x).toBeGreaterThan(rightSockets.lanternBelt.x);

    const rig = createHeroLanternRigState();
    expect(rig.localX).toBeGreaterThan(0.1);

    // En nuit/donjon, la lanterne sort en main toujours sur la droite du héros
    for (let i = 0; i < 60; i++) {
      stepHeroLanternRig(
        rig,
        rightSockets,
        { lanternBoost: 0.9, vx: 0, vz: 0, facingSign: 1 },
        1 / 60,
      );
    }
    expect(rig.localX).toBeGreaterThan(0.2);

    // Retournement à gauche : symétrie miroir propre
    const leftSockets = sampleHeroFrameSockets('idle', 0, 30, { facingSign: -1 });
    expect(leftSockets.lanternBelt.x).toBeCloseTo(-rightSockets.lanternBelt.x, 4);
    expect(leftSockets.lanternHand.x).toBeCloseTo(-rightSockets.lanternHand.x, 4);
  });

  it('ajuste automatiquement les armures au torse du héros (agrandit les trop petites, rapetisse les trop grandes)', () => {
    // 1. Toutes les 4 armures du jeu sont alignées sur le centre exact du torse du chat-valier
    for (const shape of ['tunic', 'mail', 'star_robe', 'dragon_plate'] as const) {
      const metrics = measureArmorImageMetrics(undefined, shape);
      const fit = computeIdealArmorFit(metrics, shape);
      expect(fit.normX).toBeCloseTo(HERO_TORSO_ENVELOPE.centerX, 4);
      expect(fit.visibleH).toBeGreaterThanOrEqual(0.165);
      expect(fit.visibleH).toBeLessThanOrEqual(0.232);
      expect(fit.visibleW).toBeGreaterThanOrEqual(0.175);
      expect(fit.visibleW).toBeLessThanOrEqual(0.340);
    }

    // 2. Armure minuscule/étroite -> agrandie automatiquement pour couvrir le tronc
    const tinyFit = computeIdealArmorFit({
      sourceWidth: 256,
      sourceHeight: 256,
      minX: 100,
      maxX: 155,
      minY: 96,
      maxY: 165,
      contentW: 56,
      contentH: 70,
      coreW: 48,
      coreCx: 128,
      halfSpanX: 28,
    });
    expect(tinyFit.visibleW).toBeGreaterThanOrEqual(0.175);
    expect(tinyFit.visibleH).toBeGreaterThanOrEqual(0.165);

    // 3. Armure gigantesque occupant presque toute la texture -> rapetissée dans l'enveloppe idéale
    const hugeFit = computeIdealArmorFit({
      sourceWidth: 256,
      sourceHeight: 256,
      minX: 2,
      maxX: 253,
      minY: 2,
      maxY: 253,
      contentW: 252,
      contentH: 252,
      coreW: 240,
      coreCx: 128,
      halfSpanX: 126,
    });
    expect(hugeFit.visibleW).toBeLessThanOrEqual(0.252);
    expect(hugeFit.visibleH).toBeLessThanOrEqual(0.232);
  });
});
