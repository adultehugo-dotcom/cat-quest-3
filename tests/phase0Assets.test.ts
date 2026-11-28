import { describe, expect, it } from 'vitest';
import { LOCAL_SFX_FILES } from '../src/audio/audioEngine';
import {
  AUDIO_DURATION_BOUNDS,
  AUDIO_MUSIC_TRACKS,
  AUDIO_SFX_CATEGORIES,
  AUDIO_SFX_GROUPS,
  AUDIO_WEATHER_TRACKS,
  LEGACY_SFX_TO_GROUP,
  getAllAudioAssetPaths,
  getLegacySfxPath,
} from '../src/audio/audioManifest';
import {
  VFX_ASSETS,
  VFX_CATEGORIES,
  getAllVfxAssetPaths,
  getVfxAsset,
  getVfxAssetsByCategory,
} from '../src/art/vfxManifest';
import type { SfxId } from '../src/game/types';

interface MinimalDirent {
  name: string;
  isDirectory(): boolean;
}

interface MinimalNodeFs {
  existsSync(filePath: string): boolean;
  statSync(filePath: string): { size: number };
  readFileSync(filePath: string): Uint8Array;
  readFileSync(filePath: string, encoding: 'utf8'): string;
  readdirSync(dirPath: string): string[];
  readdirSync(dirPath: string, options: { withFileTypes: true }): MinimalDirent[];
}

interface MinimalNodePath {
  join(...segments: string[]): string;
  relative(from: string, to: string): string;
}

interface MinimalNodeZlib {
  inflateSync(data: Uint8Array): Uint8Array;
}

async function loadNodeHelpers(): Promise<{
  fs: MinimalNodeFs;
  path: MinimalNodePath;
  zlib: MinimalNodeZlib;
  root: string;
  publicDir: string;
}> {
  const fsMod = (await import(/* @vite-ignore */ 'node:' + 'fs')) as unknown as MinimalNodeFs;
  const pathMod = (await import(/* @vite-ignore */ 'node:' + 'path')) as unknown as MinimalNodePath;
  const zlibMod = (await import(/* @vite-ignore */ 'node:' + 'zlib')) as unknown as MinimalNodeZlib;
  const proc = (globalThis as unknown as { process?: { cwd(): string } }).process;
  const root = proc ? proc.cwd() : '.';
  return {
    fs: fsMod,
    path: pathMod,
    zlib: zlibMod,
    root,
    publicDir: pathMod.join(root, 'public'),
  };
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngRgba(
  buf: Uint8Array,
  inflateSync: (data: Uint8Array) => Uint8Array,
): { width: number; height: number; rgba: Uint8Array } {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatParts: Uint8Array[] = [];

  let offset = 8;
  while (offset + 8 <= buf.length) {
    const length = view.getUint32(offset, false);
    const chunkType = readAscii(buf, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (chunkType === 'IHDR') {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (chunkType === 'IDAT') {
      idatParts.push(buf.subarray(dataStart, dataEnd));
    } else if (chunkType === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  expect(bitDepth).toBe(8);
  expect(colorType === 2 || colorType === 6).toBe(true);
  const bpp = colorType === 6 ? 4 : 3;

  const totalIdatLen = idatParts.reduce((acc, p) => acc + p.length, 0);
  const compressed = new Uint8Array(totalIdatLen);
  let pos = 0;
  for (const part of idatParts) {
    compressed.set(part, pos);
    pos += part.length;
  }
  const raw = inflateSync(compressed);
  const stride = width * bpp;
  const unfiltered = new Uint8Array(height * stride);

  for (let y = 0; y < height; y += 1) {
    const rowIn = y * (stride + 1);
    const filterType = raw[rowIn];
    const rowOut = y * stride;
    const prevOut = (y - 1) * stride;

    for (let x = 0; x < stride; x += 1) {
      const val = raw[rowIn + 1 + x];
      const left = x >= bpp ? unfiltered[rowOut + x - bpp] : 0;
      const up = y > 0 ? unfiltered[prevOut + x] : 0;
      const upLeft = y > 0 && x >= bpp ? unfiltered[prevOut + x - bpp] : 0;

      let recon = val;
      if (filterType === 1) recon = val + left;
      else if (filterType === 2) recon = val + up;
      else if (filterType === 3) recon = val + ((left + up) >> 1);
      else if (filterType === 4) recon = val + paethPredictor(left, up, upLeft);
      unfiltered[rowOut + x] = recon & 0xff;
    }
  }

  if (colorType === 6) {
    return { width, height, rgba: unfiltered };
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < unfiltered.length; i += 3, j += 4) {
    rgba[j] = unfiltered[i];
    rgba[j + 1] = unfiltered[i + 1];
    rgba[j + 2] = unfiltered[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

function walkFiles(fsMod: MinimalNodeFs, pathMod: MinimalNodePath, dir: string): string[] {
  const out: string[] = [];
  for (const entry of fsMod.readdirSync(dir, { withFileTypes: true })) {
    const full = pathMod.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(fsMod, pathMod, full));
    } else {
      out.push(full);
    }
  }
  return out;
}

function readAscii(bytes: Uint8Array, start: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i += 1) {
    out += String.fromCharCode(bytes[start + i]);
  }
  return out;
}

describe('Phase 0 — Studio CC0 Audio & VFX Asset Pipeline', () => {
  it('enforces relative asset paths without leading slashes or traversal', async () => {
    const { fs, path, root } = await loadNodeHelpers();
    const audioPaths = getAllAudioAssetPaths();
    const vfxPaths = getAllVfxAssetPaths();

    expect(audioPaths.length).toBeGreaterThanOrEqual(200);
    expect(vfxPaths.length).toBeGreaterThanOrEqual(11);

    for (const relPath of audioPaths) {
      expect(relPath.startsWith('/')).toBe(false);
      expect(relPath).not.toContain('://');
      expect(relPath).not.toContain('..');
      expect(relPath.startsWith('assets/audio/')).toBe(true);
      expect(relPath.endsWith('.ogg')).toBe(true);
    }

    for (const relPath of vfxPaths) {
      expect(relPath.startsWith('/')).toBe(false);
      expect(relPath).not.toContain('://');
      expect(relPath).not.toContain('..');
      expect(relPath.startsWith('assets/vfx/')).toBe(true);
      expect(relPath.endsWith('.png')).toBe(true);
    }

    const viteConfig = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    expect(viteConfig).toContain("base: './'");
  });

  it('verifies 100% disk existence, non-empty sizes, OggS/PNG magic headers, and PNG IHDR dimensions', async () => {
    const { fs, path, publicDir } = await loadNodeHelpers();
    const audioPaths = getAllAudioAssetPaths();

    for (const relPath of audioPaths) {
      const abs = path.join(publicDir, relPath);
      expect(fs.existsSync(abs), `Missing audio asset: ${relPath}`).toBe(true);
      const stat = fs.statSync(abs);
      expect(stat.size, `Audio asset too small: ${relPath}`).toBeGreaterThanOrEqual(1024);

      const buf = fs.readFileSync(abs);
      const magic = readAscii(buf, 0, 4);
      expect(magic, `Invalid OggS header in ${relPath}`).toBe('OggS');
    }

    for (const entry of Object.values(VFX_ASSETS)) {
      const abs = path.join(publicDir, entry.path);
      expect(fs.existsSync(abs), `Missing VFX asset: ${entry.path}`).toBe(true);
      const stat = fs.statSync(abs);
      expect(stat.size, `VFX asset too small: ${entry.path}`).toBeGreaterThanOrEqual(512);

      const buf = fs.readFileSync(abs);
      expect(buf[0], `PNG magic byte 0 mismatch in ${entry.path}`).toBe(0x89);
      expect(buf[1], `PNG magic byte 1 mismatch in ${entry.path}`).toBe(0x50);
      expect(buf[2], `PNG magic byte 2 mismatch in ${entry.path}`).toBe(0x4e);
      expect(buf[3], `PNG magic byte 3 mismatch in ${entry.path}`).toBe(0x47);

      const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const ihdrWidth = view.getUint32(16, false);
      const ihdrHeight = view.getUint32(20, false);
      expect(ihdrWidth).toBe(entry.width);
      expect(ihdrHeight).toBe(entry.height);
      expect(ihdrWidth).toBeGreaterThanOrEqual(64);
      expect(ihdrHeight).toBeGreaterThanOrEqual(64);
    }

    // Ensure no orphan files sit untracked under public/assets/audio or public/assets/vfx
    const audioOnDisk = walkFiles(fs, path, path.join(publicDir, 'assets', 'audio')).map((p) =>
      path.relative(publicDir, p).replace(/\\/g, '/'),
    );
    const vfxOnDisk = walkFiles(fs, path, path.join(publicDir, 'assets', 'vfx')).map((p) =>
      path.relative(publicDir, p).replace(/\\/g, '/'),
    );
    expect(new Set(audioOnDisk)).toEqual(new Set(audioPaths));
    expect(new Set(vfxOnDisk)).toEqual(new Set(getAllVfxAssetPaths()));
  });

  it('covers all 9 SFX subdirectories, 38 legacy SfxId, 7+ music tracks, 5 weather tracks, and calibrated durations', async () => {
    const { fs, path, publicDir } = await loadNodeHelpers();
    const sfxSubdirs = [
      'weapons',
      'impacts',
      'footsteps',
      'monsters',
      'ui',
      'status',
      'combat',
      'loot',
      'ambient',
    ] as const;
    expect(AUDIO_SFX_CATEGORIES).toEqual(sfxSubdirs);

    for (const sub of sfxSubdirs) {
      const dirPath = path.join(publicDir, 'assets', 'audio', 'sfx', sub);
      expect(fs.existsSync(dirPath), `Missing SFX subdir: ${sub}`).toBe(true);
      const groupsInCat = Object.values(AUDIO_SFX_GROUPS).filter((g) => g.category === sub);
      expect(groupsInCat.length).toBeGreaterThan(0);
    }

    const legacyKeys = Object.keys(LEGACY_SFX_TO_GROUP) as SfxId[];
    expect(legacyKeys.length).toBe(38);
    expect(Object.keys(LOCAL_SFX_FILES).length).toBe(38);
    for (const id of legacyKeys) {
      const pathFromFn = getLegacySfxPath(id);
      expect(LOCAL_SFX_FILES[id]).toBe(pathFromFn);
      expect(fs.existsSync(path.join(publicDir, pathFromFn))).toBe(true);
    }

    // Music tracks (7 required + optional boss_phase2)
    for (const trackId of [
      'menu',
      'overworld',
      'maritime',
      'dungeon',
      'combat',
      'boss',
      'victory',
    ] as const) {
      expect(AUDIO_MUSIC_TRACKS[trackId].path).toBe(`assets/audio/music/${trackId}.ogg`);
      expect(fs.existsSync(path.join(publicDir, AUDIO_MUSIC_TRACKS[trackId].path))).toBe(true);
    }
    const musicFiles = fs.readdirSync(path.join(publicDir, 'assets', 'audio', 'music'));
    expect(musicFiles.some((f: string) => f.endsWith('.wav') || f.endsWith('.mp3'))).toBe(false);

    // Weather tracks
    for (const weatherId of [
      'ocean_waves',
      'wind_gale',
      'rain_storm',
      'thunder_clap',
      'birds_day',
    ] as const) {
      expect(AUDIO_WEATHER_TRACKS[weatherId].path).toBe(`assets/audio/weather/${weatherId}.ogg`);
      expect(fs.existsSync(path.join(publicDir, AUDIO_WEATHER_TRACKS[weatherId].path))).toBe(true);
    }

    // Multi-variant groups
    expect(AUDIO_SFX_GROUPS.combat_dodge_whoosh.variants.length).toBeGreaterThanOrEqual(2);
    expect(AUDIO_SFX_GROUPS.combat_player_hurt.variants.length).toBeGreaterThanOrEqual(2);
    expect(AUDIO_SFX_GROUPS.loot_coin_pickup.variants.length).toBeGreaterThanOrEqual(2);
    expect(AUDIO_SFX_GROUPS.loot_xp_pickup.variants.length).toBeGreaterThanOrEqual(2);
    expect(AUDIO_SFX_GROUPS.monster_hurt.variants.length).toBeGreaterThanOrEqual(2);
    for (const group of Object.values(AUDIO_SFX_GROUPS)) {
      if (group.category === 'footsteps') {
        expect(group.variants.length).toBeGreaterThanOrEqual(3);
      }
      if (group.category === 'weapons' || group.category === 'impacts') {
        expect(group.variants.length).toBeGreaterThanOrEqual(2);
      }
    }

    // Calibrated duration bounds
    for (const group of Object.values(AUDIO_SFX_GROUPS)) {
      const bounds = AUDIO_DURATION_BOUNDS[group.category];
      for (const variant of group.variants) {
        expect(Number.isFinite(variant.durationSec)).toBe(true);
        expect(variant.durationSec, `${variant.path} below min`).toBeGreaterThanOrEqual(bounds.minSec);
        expect(variant.durationSec, `${variant.path} above max`).toBeLessThanOrEqual(bounds.maxSec);
      }
    }
    for (const track of Object.values(AUDIO_MUSIC_TRACKS)) {
      const bounds = AUDIO_DURATION_BOUNDS.music;
      expect(track.durationSec).toBeGreaterThanOrEqual(bounds.minSec);
      expect(track.durationSec).toBeLessThanOrEqual(bounds.maxSec);
    }
    for (const track of Object.values(AUDIO_WEATHER_TRACKS)) {
      const bounds = AUDIO_DURATION_BOUNDS.weather;
      expect(track.durationSec).toBeGreaterThanOrEqual(bounds.minSec);
      expect(track.durationSec).toBeLessThanOrEqual(bounds.maxSec);
    }
  });

  it('covers all 11 VFX categories and validates flipbook/normalMap invariants', () => {
    expect(VFX_CATEGORIES.length).toBe(11);
    for (const cat of VFX_CATEGORIES) {
      expect(getVfxAssetsByCategory(cat).length, `Empty VFX category: ${cat}`).toBeGreaterThanOrEqual(1);
    }

    for (const entry of Object.values(VFX_ASSETS)) {
      expect(getVfxAsset(entry.id)).toEqual(entry);
      expect(entry.cols).toBeGreaterThanOrEqual(1);
      expect(entry.rows).toBeGreaterThanOrEqual(1);
      expect(entry.frames).toBeGreaterThanOrEqual(1);
      expect(entry.frames).toBeLessThanOrEqual(entry.cols * entry.rows);

      if (entry.kind === 'flipbook') {
        expect(entry.frames).toBeGreaterThanOrEqual(4);
        expect(entry.fps).toBeGreaterThan(0);
        expect(entry.durationSec).toBeGreaterThan(0);
        expect(Math.abs(entry.durationSec - entry.frames / entry.fps)).toBeLessThan(0.05);
      }
      if (entry.kind === 'normalMap') {
        expect(entry.dataMap).toBe(true);
      }
    }
  });

  it('verifies non-flat RGB variance on VFX PNGs and zero dead active flipbook frames', async () => {
    const { fs, path, zlib, publicDir } = await loadNodeHelpers();

    for (const entry of Object.values(VFX_ASSETS)) {
      const buf = fs.readFileSync(path.join(publicDir, entry.path));
      const { width, height, rgba } = decodePngRgba(buf, zlib.inflateSync);
      expect(width).toBe(entry.width);
      expect(height).toBe(entry.height);

      if (entry.kind !== 'normalMap') {
        let count = 0;
        let sumRgb = 0;
        let sumRgbSq = 0;
        let sumLuma = 0;
        let sumLumaSq = 0;

        for (let i = 0; i < rgba.length; i += 4) {
          if (rgba[i + 3] >= 16) {
            const r = rgba[i];
            const g = rgba[i + 1];
            const b = rgba[i + 2];
            sumRgb += r + g + b;
            sumRgbSq += r * r + g * g + b * b;
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            sumLuma += luma;
            sumLumaSq += luma * luma;
            count += 1;
          }
        }

        expect(count, `No visible pixels in ${entry.path}`).toBeGreaterThanOrEqual(16);
        const meanRgb = sumRgb / (count * 3);
        const rgbStd = Math.sqrt(Math.max(0, sumRgbSq / (count * 3) - meanRgb * meanRgb));
        expect(rgbStd, `Flat RGB silhouette detected in ${entry.path} (rgbStd=${rgbStd.toFixed(2)})`).toBeGreaterThanOrEqual(12);

        if (entry.kind === 'decal') {
          const meanLuma = sumLuma / count;
          const lumaStd = Math.sqrt(Math.max(0, sumLumaSq / count - meanLuma * meanLuma));
          expect(lumaStd, `Unshaded flat decal detected in ${entry.path} (lumaStd=${lumaStd.toFixed(2)})`).toBeGreaterThanOrEqual(12);
        }
      }

      if (entry.kind === 'flipbook') {
        const cw = Math.floor(width / entry.cols);
        const ch = Math.floor(height / entry.rows);
        expect(cw * entry.cols).toBe(width);
        expect(ch * entry.rows).toBe(height);

        for (let frameIdx = 0; frameIdx < entry.frames; frameIdx += 1) {
          const row = Math.floor(frameIdx / entry.cols);
          const col = frameIdx % entry.cols;
          let maxAlpha = 0;
          for (let y = row * ch; y < (row + 1) * ch; y += 1) {
            const rowOffset = y * width * 4;
            for (let x = col * cw; x < (col + 1) * cw; x += 1) {
              const a = rgba[rowOffset + x * 4 + 3];
              if (a > maxAlpha) maxAlpha = a;
            }
          }
          expect(maxAlpha, `Dead active frame ${frameIdx} in ${entry.path}`).toBeGreaterThanOrEqual(10);
        }
      }
    }
  });

  it('verifies script, root CREDITS.md 100% CC0/PD coverage, and deletion of stale audio metadata', async () => {
    const { fs, path, root, publicDir } = await loadNodeHelpers();
    const scriptPath = path.join(root, 'scripts', 'fetch_studio_assets.mjs');
    expect(fs.existsSync(scriptPath)).toBe(true);
    expect(fs.statSync(scriptPath).size).toBeGreaterThan(1000);

    const creditsPath = path.join(root, 'CREDITS.md');
    expect(fs.existsSync(creditsPath)).toBe(true);
    const credits = fs.readFileSync(creditsPath, 'utf8');
    expect(credits.length).toBeGreaterThan(1000);
    expect(credits).toMatch(/CC0|Public Domain/);
    expect(credits).not.toMatch(/\bGPL\b/i);
    expect(credits).not.toMatch(/\bCC-BY\b/i);

    for (const relPath of [...getAllAudioAssetPaths(), ...getAllVfxAssetPaths()]) {
      expect(credits, `CREDITS.md missing entry for ${relPath}`).toContain(relPath);
    }

    // Composite VFX assets must credit all contributing CC0 URLs
    const slimeRow = credits.split('\n').find((l: string) => l.includes('slime_splat_decal.png')) ?? '';
    expect(slimeRow).toContain('https://kenney.nl/assets/splat-pack');
    expect(slimeRow).toContain('https://ambientcg.com/view?id=Lava004');
    expect(slimeRow).toContain('https://ambientcg.com/view?id=Ice003');

    const craterRow = credits.split('\n').find((l: string) => l.includes('crater_fissure_decal.png')) ?? '';
    expect(craterRow).toContain('https://polyhaven.com/a/mud_cracked_dry_03');
    expect(craterRow).toContain('https://ambientcg.com/view?id=Lava004');

    const debrisRow = credits.split('\n').find((l: string) => l.includes('debris_fragments.png')) ?? '';
    expect(debrisRow).toContain('https://ambientcg.com/view?id=LeafSet010');
    expect(debrisRow).toContain('https://opengameart.org/content/paramecijs-vegetation-base-texture-pack');
    expect(debrisRow).toContain('https://polyhaven.com/a/aerial_rocks_04');
    expect(debrisRow).toContain('https://ambientcg.com/view?id=Travertine001');

    // Stale files removed
    expect(fs.existsSync(path.join(publicDir, 'assets', 'audio', 'AUDIO_MANIFEST.md'))).toBe(false);
    expect(fs.existsSync(path.join(publicDir, 'assets', 'audio', 'music', 'CREDITS.md'))).toBe(false);
    expect(fs.existsSync(path.join(publicDir, 'assets', 'audio', 'weather', 'CREDITS.md'))).toBe(false);
    expect(fs.existsSync(path.join(publicDir, 'assets', 'audio', 'music', 'overworld.wav'))).toBe(false);
    expect(fs.existsSync(path.join(publicDir, 'assets', 'audio', 'music', 'boss.mp3'))).toBe(false);
  });

  it('keeps audioManifest.ts and vfxManifest.ts free of three imports and DOM references', async () => {
    const { fs, path, root } = await loadNodeHelpers();
    for (const rel of ['src/audio/audioManifest.ts', 'src/art/vfxManifest.ts']) {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(src).not.toMatch(/from\s+['"]three['"]/);
      expect(src).not.toMatch(/\bwindow\b|\bdocument\b|\bHTMLCanvasElement\b/);
    }
  });
});
