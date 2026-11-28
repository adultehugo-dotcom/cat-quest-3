import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const CACHE_DIR = path.join(os.tmpdir(), 'cat-quest-studio-assets-cache');
const DOWNLOADS_DIR = path.join(CACHE_DIR, 'downloads');
const EXTRACTED_DIR = path.join(CACHE_DIR, 'extracted');
const WORK_DIR = path.join(CACHE_DIR, 'work');

const PUBLIC_AUDIO_DIR = path.join(ROOT, 'public', 'assets', 'audio');
const PUBLIC_VFX_DIR = path.join(ROOT, 'public', 'assets', 'vfx');
const AUDIO_MANIFEST_PATH = path.join(ROOT, 'src', 'audio', 'audioManifest.ts');
const VFX_MANIFEST_PATH = path.join(ROOT, 'src', 'art', 'vfxManifest.ts');
const CREDITS_PATH = path.join(ROOT, 'CREDITS.md');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const WIKIMEDIA_UA = 'CatQuestStudioAssetFetcher/1.0 (https://opengameart.org; CC0-only)';

const args = new Set(process.argv.slice(2));
if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: node scripts/fetch_studio_assets.mjs [options]

Reproducible CC0 audio & realistic VFX acquisition, DSP calibration, and manifest generator.

Options:
  --help, -h        Show this help message and exit without modifying files
  --skip-download   Use cached packs only (fail if any required cache entry is missing)
  --clean-cache     Delete cached downloads/extracted files before fetching fresh packs
`);
  process.exit(0);
}
const CLEAN_CACHE = args.has('--clean-cache');
const SKIP_DOWNLOAD = args.has('--skip-download');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runCmd(cmd, cmdArgs, options = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (res.error) {
    throw new Error(`Failed to spawn ${cmd}: ${res.error.message}`);
  }
  if (res.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${cmd} ${cmdArgs.join(' ')} exited with ${res.status}:\n${res.stderr || res.stdout}`,
    );
  }
  return res;
}

function isValidCachedFile(filePath, expectedKind) {
  if (!fs.existsSync(filePath)) return false;
  const stat = fs.statSync(filePath);
  if (stat.size < 256) return false;
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    const headStr = buf.toString('utf8', 0, 15).toLowerCase();
    if (headStr.includes('<!doc') || headStr.includes('<html')) {
      return false;
    }
    if (expectedKind === 'zip') {
      return buf[0] === 0x50 && buf[1] === 0x4b; // PK
    }
    return true;
  } finally {
    fs.closeSync(fd);
  }
}

function downloadDirect(url, destPath, expectedKind = 'binary', ua = BROWSER_UA) {
  ensureDir(path.dirname(destPath));
  if (isValidCachedFile(destPath, expectedKind)) {
    return;
  }
  if (SKIP_DOWNLOAD) {
    throw new Error(`--skip-download specified but cached file missing/invalid: ${destPath}`);
  }
  console.log(`[download] ${url} -> ${path.basename(destPath)}`);
  const tmpPath = `${destPath}.part`;
  if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  runCmd('curl.exe', [
    '-sSL',
    '--fail',
    '--retry',
    '3',
    '--retry-delay',
    '2',
    '-A',
    ua,
    '-o',
    tmpPath,
    url,
  ]);
  if (!isValidCachedFile(tmpPath, expectedKind)) {
    throw new Error(`Downloaded file failed validation (${expectedKind}): ${url}`);
  }
  fs.renameSync(tmpPath, destPath);
}

function downloadKenneyZip(slug, destPath) {
  ensureDir(path.dirname(destPath));
  if (isValidCachedFile(destPath, 'zip')) {
    return;
  }
  if (SKIP_DOWNLOAD) {
    throw new Error(`--skip-download specified but Kenney ZIP missing: ${destPath}`);
  }
  console.log(`[kenney] Fetching ${slug}...`);
  const cookieJar = path.join(CACHE_DIR, `kenney-cookies-${slug}.txt`);
  const pageUrl = `https://kenney.nl/assets/${slug}`;
  const htmlRes = runCmd('curl.exe', [
    '-sSL',
    '--fail',
    '-A',
    BROWSER_UA,
    '-c',
    cookieJar,
    '-b',
    cookieJar,
    pageUrl,
  ]);
  const match = htmlRes.stdout.match(/data-download-id=['"]([0-9a-fA-F]+)['"]/);
  if (!match) {
    throw new Error(`Could not find data-download-id on Kenney page: ${pageUrl}`);
  }
  const hexId = match[1];
  const linkUrl = `https://kenney.nl/download-link/${hexId}`;
  const jsonRes = runCmd('curl.exe', [
    '-sSL',
    '--fail',
    '-A',
    BROWSER_UA,
    '-H',
    `Referer: ${pageUrl}`,
    '-H',
    'X-Requested-With: XMLHttpRequest',
    '-c',
    cookieJar,
    '-b',
    cookieJar,
    linkUrl,
  ]);
  let parsed;
  try {
    parsed = JSON.parse(jsonRes.stdout);
  } catch (err) {
    throw new Error(`Invalid JSON from ${linkUrl}: ${jsonRes.stdout.slice(0, 200)}`);
  }
  if (!parsed?.url) {
    throw new Error(`Missing download url in ${linkUrl} response`);
  }
  const tmpPath = `${destPath}.part`;
  if (fs.existsSync(tmpPath)) fs.rmSync(tmpPath, { force: true });
  // NEVER HEAD Kenney URLs — GET only
  runCmd('curl.exe', [
    '-sSL',
    '--fail',
    '-A',
    BROWSER_UA,
    '-H',
    `Referer: ${pageUrl}`,
    '-b',
    cookieJar,
    '-o',
    tmpPath,
    parsed.url,
  ]);
  if (!isValidCachedFile(tmpPath, 'zip')) {
    throw new Error(`Kenney ZIP validation failed for ${slug}`);
  }
  fs.renameSync(tmpPath, destPath);
}

function extractZip(zipPath, destDir) {
  const marker = path.join(destDir, '.extracted_ok');
  if (fs.existsSync(marker)) {
    return;
  }
  ensureDir(destDir);
  console.log(`[extract] ${path.basename(zipPath)} -> ${path.basename(destDir)}`);
  runCmd('uv', [
    'run',
    'python',
    '-c',
    'import zipfile, sys; z=zipfile.ZipFile(sys.argv[1]); z.extractall(sys.argv[2])',
    zipPath,
    destDir,
  ]);
  fs.writeFileSync(marker, 'ok\n', 'utf8');
}

function findInDir(baseDir, relOrBaseName) {
  const direct = path.join(baseDir, relOrBaseName);
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return direct;
  }
  const targetNorm = relOrBaseName.replace(/\\/g, '/').toLowerCase();
  const stack = [baseDir];
  const matches = [];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        const rel = path.relative(baseDir, full).replace(/\\/g, '/').toLowerCase();
        if (rel === targetNorm || rel.endsWith(`/${targetNorm}`) || entry.name.toLowerCase() === targetNorm) {
          matches.push(full);
        }
      }
    }
  }
  if (matches.length === 0) {
    throw new Error(`Asset entry not found in ${baseDir}: ${relOrBaseName}`);
  }
  matches.sort();
  return matches[0];
}

// ============================================================================
// Verified CC0 Source Registry
// ============================================================================
const PACKS = {
  // Kenney CC0 packs
  kenney_rpg_audio: {
    type: 'kenney',
    slug: 'rpg-audio',
    title: 'RPG Audio',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/rpg-audio',
    license: 'CC0 1.0',
  },
  kenney_impact_sounds: {
    type: 'kenney',
    slug: 'impact-sounds',
    title: 'Impact Sounds',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/impact-sounds',
    license: 'CC0 1.0',
  },
  kenney_interface_sounds: {
    type: 'kenney',
    slug: 'interface-sounds',
    title: 'Interface Sounds',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/interface-sounds',
    license: 'CC0 1.0',
  },
  kenney_sci_fi_sounds: {
    type: 'kenney',
    slug: 'sci-fi-sounds',
    title: 'Sci-Fi Sounds',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/sci-fi-sounds',
    license: 'CC0 1.0',
  },
  kenney_digital_audio: {
    type: 'kenney',
    slug: 'digital-audio',
    title: 'Digital Audio',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/digital-audio',
    license: 'CC0 1.0',
  },
  kenney_particle_pack: {
    type: 'kenney',
    slug: 'particle-pack',
    title: 'Particle Pack',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/particle-pack',
    license: 'CC0 1.0',
  },
  kenney_smoke_particles: {
    type: 'kenney',
    slug: 'smoke-particles',
    title: 'Smoke Particles',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/smoke-particles',
    license: 'CC0 1.0',
  },
  kenney_splat_pack: {
    type: 'kenney',
    slug: 'splat-pack',
    title: 'Splat Pack',
    author: 'Kenney',
    url: 'https://kenney.nl/assets/splat-pack',
    license: 'CC0 1.0',
  },

  // OGA CC0 ZIP packs
  oga_rpg_sound_pack: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/rpg_sound_pack.zip',
    title: 'RPG Sound Pack',
    author: 'HaelDB',
    url: 'https://opengameart.org/content/rpg-sound-pack',
    license: 'CC0 1.0',
  },
  oga_80_rpg_sfx: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/80-CC0-RPG-SFX_0.zip',
    title: '80 CC0 RPG SFX',
    author: 'NoirPhantom89',
    url: 'https://opengameart.org/content/80-cc0-rpg-sfx',
    license: 'CC0 1.0',
  },
  oga_80_creature_sfx: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/80-CC0-creature-SFX_0.zip',
    title: '80 CC0 Creature SFX',
    author: 'Chasersgaming',
    url: 'https://opengameart.org/content/80-cc0-creature-sfx',
    license: 'CC0 1.0',
  },
  oga_monster_vol1: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/monster-sounds-volume-2.zip',
    title: 'Monster Sound Pack Volume 1',
    author: 'Ogrebane',
    url: 'https://opengameart.org/content/monster-sound-pack-volume-1',
    license: 'CC0 1.0',
  },
  oga_water_slime: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/water-splash-slime-sfx.zip',
    title: '40 CC0 Water / Splash / Slime SFX',
    author: 'rockseller',
    url: 'https://opengameart.org/content/40-cc0-water-splash-slime-sfx',
    license: 'CC0 1.0',
  },
  oga_100_sfx_v2: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/sfx_100_v2.zip',
    title: '100 CC0 SFX 2',
    author: 'geekygnome',
    url: 'https://opengameart.org/content/100-cc0-sfx-2',
    license: 'CC0 1.0',
  },
  oga_swishes: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/swishes.zip',
    title: 'Swishes Sound Pack',
    author: 'qubodup',
    url: 'https://opengameart.org/content/swishes-sound-pack',
    license: 'CC0 1.0',
  },
  oga_sword_attacks: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/sword_-_starninjas_1.zip',
    title: '20 Sword Sound Effects (Attacks)',
    author: 'MedicineStorm / StarNinjas',
    url: 'https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes',
    license: 'CC0 1.0',
  },
  oga_sword_clashes: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/sword_clash_-_starninjas_0.zip',
    title: '20 Sword Sound Effects (Clashes)',
    author: 'MedicineStorm / StarNinjas',
    url: 'https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes',
    license: 'CC0 1.0',
  },
  oga_ghost_moans: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/qubodup-GhostMoans.zip',
    title: 'Ghost Monster Voice Moaning Growling',
    author: 'shd / qubodup',
    url: 'https://opengameart.org/content/ghost-monster-voice-moaning-growling',
    license: 'CC0 1.0',
  },
  oga_book_flip: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/BookFlip_SFX.zip',
    title: 'Book Flip Sounds',
    author: 'Voltiment555',
    url: 'https://opengameart.org/content/book-flip-sounds',
    license: 'CC0 1.0',
  },
  oga_soundpack01: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/SoundPack01.zip',
    title: 'Level Up, Power Up, Coin Get (13 Sounds)',
    author: 'joaquinton',
    url: 'https://opengameart.org/content/level-up-power-up-coin-get-13-sounds',
    license: 'CC0 1.0',
  },
  oga_rain_ogg: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/Rain%20OGG.zip',
    title: 'Rain Loopable',
    author: 'Snabisch',
    url: 'https://opengameart.org/content/rain-loopable',
    license: 'CC0 1.0',
  },

  // OGA / Wikimedia Direct Audio Files
  oga_magical_1: {
    type: 'file',
    filename: 'magical_1_0.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/magical_1_0.ogg',
    title: 'Magic Spell SFX (magical_1)',
    author: 'Arcanorum',
    url: 'https://opengameart.org/content/magic-spell-sfx',
    license: 'CC0 1.0',
  },
  oga_magical_2: {
    type: 'file',
    filename: 'magical_2_1.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/magical_2_1.ogg',
    title: 'Magic Spell SFX (magical_2)',
    author: 'Arcanorum',
    url: 'https://opengameart.org/content/magic-spell-sfx',
    license: 'CC0 1.0',
  },
  oga_magical_3: {
    type: 'file',
    filename: 'magical_3_1.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/magical_3_1.ogg',
    title: 'Magic Spell SFX (magical_3)',
    author: 'Arcanorum',
    url: 'https://opengameart.org/content/magic-spell-sfx',
    license: 'CC0 1.0',
  },
  oga_magical_4: {
    type: 'file',
    filename: 'magical_4_1.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/magical_4_1.ogg',
    title: 'Magic Spell SFX (magical_4)',
    author: 'Arcanorum',
    url: 'https://opengameart.org/content/magic-spell-sfx',
    license: 'CC0 1.0',
  },
  oga_magical_5: {
    type: 'file',
    filename: 'magical_5_1.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/magical_5_1.ogg',
    title: 'Magic Spell SFX (magical_5)',
    author: 'Arcanorum',
    url: 'https://opengameart.org/content/magic-spell-sfx',
    license: 'CC0 1.0',
  },
  oga_magical_6: {
    type: 'file',
    filename: 'magical_6_0.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/magical_6_0.ogg',
    title: 'Magic Spell SFX (magical_6)',
    author: 'Arcanorum',
    url: 'https://opengameart.org/content/magic-spell-sfx',
    license: 'CC0 1.0',
  },
  oga_freeze: {
    type: 'file',
    filename: 'freeze.wav',
    downloadUrl: 'https://opengameart.org/sites/default/files/freeze.wav',
    title: 'Freeze Spell',
    author: 'StarNinjas',
    url: 'https://opengameart.org/content/freeze-spell-0',
    license: 'CC0 1.0',
  },
  oga_completetask: {
    type: 'file',
    filename: 'completetask_0.mp3',
    downloadUrl: 'https://opengameart.org/sites/default/files/completetask_0.mp3',
    title: 'Completion Sound',
    author: 'manwesulimo2004',
    url: 'https://opengameart.org/content/completion-sound',
    license: 'CC0 1.0',
  },
  oga_seagull_1: {
    type: 'file',
    filename: 'Seagull_Ambient_1.wav',
    downloadUrl: 'https://opengameart.org/sites/default/files/Seagull%20Ambient%201.wav',
    title: 'Solo Seagull Sound Effects (Ambient 1)',
    author: 'Rango Mango',
    url: 'https://opengameart.org/content/solo-seagull-sound-effects',
    license: 'CC0 1.0',
  },
  oga_seagull_2: {
    type: 'file',
    filename: 'Seagull_Ambient_2.wav',
    downloadUrl: 'https://opengameart.org/sites/default/files/Seagull%20Ambient%202.wav',
    title: 'Solo Seagull Sound Effects (Ambient 2)',
    author: 'Rango Mango',
    url: 'https://opengameart.org/content/solo-seagull-sound-effects',
    license: 'CC0 1.0',
  },
  oga_fire_loop: {
    type: 'file',
    filename: 'fire.wav',
    downloadUrl: 'https://opengameart.org/sites/default/files/fire.wav',
    title: 'Fireplace Sound Loop',
    author: 'StarNinjas',
    url: 'https://opengameart.org/content/fireplace-sound-loop',
    license: 'CC0 1.0',
  },
  oga_forger: {
    type: 'file',
    filename: 'forger_0.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/forger_0.ogg',
    title: 'Hammer on Anvil',
    author: 'Snabisch',
    url: 'https://opengameart.org/content/hammer-on-anvil',
    license: 'CC0 1.0',
  },
  oga_blacksmith_hammer: {
    type: 'file',
    filename: 'blacksmithhammer.wav',
    downloadUrl: 'https://opengameart.org/sites/default/files/blacksmithhammer.wav',
    title: "Blacksmith's Hammer",
    author: 'OpenGameArt CC0 Contributor',
    url: 'https://opengameart.org/content/blacksmiths-hammer',
    license: 'CC0 1.0',
  },
  wm_meow_siamese: {
    type: 'file',
    filename: 'Meow_siamese.wav',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/8/81/Meow_of_a_Siamese_cat_-_freemaster2.wav',
    title: 'Meow of a Siamese cat',
    author: 'freemaster2',
    url: 'https://commons.wikimedia.org/wiki/File:Meow_of_a_Siamese_cat_-_freemaster2.wav',
    license: 'CC0 1.0',
    ua: WIKIMEDIA_UA,
  },
  wm_meow_pleading: {
    type: 'file',
    filename: 'Meow_pleading.oga',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/6b/Meow_of_a_pleading_cat.oga',
    title: 'Meow of a pleading cat',
    author: 'Wikimedia Commons Contributor',
    url: 'https://commons.wikimedia.org/wiki/File:Meow_of_a_pleading_cat.oga',
    license: 'Public Domain',
    ua: WIKIMEDIA_UA,
  },

  // Music tracks (CC0 1.0)
  oga_music_menu: {
    type: 'file',
    filename: 'Title_Theme_0.mp3',
    downloadUrl: 'https://opengameart.org/sites/default/files/Title%20Theme_0.mp3',
    title: 'Title Theme',
    author: 'Jonathan So',
    url: 'https://opengameart.org/content/title-theme',
    license: 'CC0 1.0',
  },
  oga_music_overworld: {
    type: 'file',
    filename: 'TownTheme.mp3',
    downloadUrl: 'https://opengameart.org/sites/default/files/TownTheme.mp3',
    title: 'Town Theme RPG',
    author: 'Bonsaiheldin',
    url: 'https://opengameart.org/content/town-theme-rpg',
    license: 'CC0 1.0',
  },
  oga_music_maritime: {
    type: 'file',
    filename: 'Pirates_Orchestra.mp3',
    downloadUrl: 'https://opengameart.org/sites/default/files/Pirate%27s%20Orchestra.mp3',
    title: "Pirate's Orchestra",
    author: 'OpenGameArt Community',
    url: 'https://opengameart.org/content/pirates-orchestra',
    license: 'CC0 1.0',
  },
  oga_music_dungeon: {
    type: 'file',
    filename: 'cave_themeb4.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/cave%20themeb4.ogg',
    title: 'Cave Theme',
    author: 'Clint Bellanger',
    url: 'https://opengameart.org/content/cave-theme',
    license: 'CC0 1.0',
  },
  oga_music_combat: {
    type: 'file',
    filename: 'battleThemeA.mp3',
    downloadUrl: 'https://opengameart.org/sites/default/files/battleThemeA.mp3',
    title: 'Battle Theme A',
    author: 'JaidynReiman',
    url: 'https://opengameart.org/content/battle-theme-a',
    license: 'CC0 1.0',
  },
  oga_music_boss: {
    type: 'file',
    filename: 'CleytonRX_Boss.mp3',
    downloadUrl: 'https://opengameart.org/sites/default/files/CleytonRX%20-%20Battle%20RPG%20Theme_1.mp3',
    title: 'Boss Battle Theme',
    author: 'Ge0 / CleytonRX',
    url: 'https://opengameart.org/content/boss-battle-theme',
    license: 'CC0 1.0',
  },
  oga_music_boss_p2: {
    type: 'file',
    filename: 'CleytonRX_Boss_Var.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/CleytonRX%20-%20Battle%20RPG%20Theme%20Var_0.ogg',
    title: 'Boss Battle Theme (Var)',
    author: 'Ge0 / CleytonRX',
    url: 'https://opengameart.org/content/boss-battle-theme',
    license: 'CC0 1.0',
  },
  oga_music_victory: {
    type: 'file',
    filename: 'Victory1_1.mp3',
    downloadUrl: 'https://opengameart.org/sites/default/files/Victory1_1.mp3',
    title: 'Victory Theme for RPG',
    author: 'Spring Spring',
    url: 'https://opengameart.org/content/victory-theme-for-rpg',
    license: 'CC0 1.0',
  },

  // Weather audio
  oga_wave_01: {
    type: 'file',
    filename: 'wave_01.flac',
    downloadUrl: 'https://opengameart.org/sites/default/files/wave_01_cc0-18363__jasinski__alkaibeach.flac',
    title: 'Beach Ocean Waves (wave_01)',
    author: 'Four Bidden / jasinski',
    url: 'https://opengameart.org/content/beach-ocean-waves',
    license: 'CC0 1.0',
  },
  oga_wave_02: {
    type: 'file',
    filename: 'wave_02.flac',
    downloadUrl: 'https://opengameart.org/sites/default/files/wave_02_cc0-18363__jasinski__alkaibeach.flac',
    title: 'Beach Ocean Waves (wave_02)',
    author: 'Four Bidden / jasinski',
    url: 'https://opengameart.org/content/beach-ocean-waves',
    license: 'CC0 1.0',
  },
  oga_wave_03: {
    type: 'file',
    filename: 'wave_03.flac',
    downloadUrl: 'https://opengameart.org/sites/default/files/wave_03_cc0-18363__jasinski__alkaibeach.flac',
    title: 'Beach Ocean Waves (wave_03)',
    author: 'Four Bidden / jasinski',
    url: 'https://opengameart.org/content/beach-ocean-waves',
    license: 'CC0 1.0',
  },
  oga_wave_04: {
    type: 'file',
    filename: 'wave_04.flac',
    downloadUrl: 'https://opengameart.org/sites/default/files/wave_04_cc0-18363__jasinski__alkaibeach.flac',
    title: 'Beach Ocean Waves (wave_04)',
    author: 'Four Bidden / jasinski',
    url: 'https://opengameart.org/content/beach-ocean-waves',
    license: 'CC0 1.0',
  },
  oga_wind1: {
    type: 'file',
    filename: 'wind1.wav',
    downloadUrl: 'https://opengameart.org/sites/default/files/wind1.wav',
    title: 'Wind1',
    author: 'qubodup',
    url: 'https://opengameart.org/content/wind1',
    license: 'CC0 1.0',
  },
  wm_thunder: {
    type: 'file',
    filename: 'Storm_thunderbolts.ogg',
    downloadUrl: 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Storm_thunderbolts.ogg',
    title: 'Storm thunderbolts',
    author: 'Wikimedia Commons Contributor',
    url: 'https://commons.wikimedia.org/wiki/File:Storm_thunderbolts.ogg',
    license: 'Public Domain',
    ua: WIKIMEDIA_UA,
  },
  oga_birds_day: {
    type: 'file',
    filename: 'birds-isaiah658_0.ogg',
    downloadUrl: 'https://opengameart.org/sites/default/files/birds-isaiah658_0.ogg',
    title: 'Ambient Bird Sounds',
    author: 'FacadeGaikan / isaiah658',
    url: 'https://opengameart.org/content/ambient-bird-sounds',
    license: 'CC0 1.0',
  },

  // VFX CC0 Packs
  oga_blender_vfx: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/blender-volumetric-particles-effects.zip',
    title: '25 Special Effects Rendered With Blender',
    author: 'OpenGameArt CC0 Contributor',
    url: 'https://opengameart.org/content/25-special-effects-rendered-with-blender',
    license: 'CC0 1.0',
  },
  oga_para_fx1: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/para_CC0_particlefx-1.zip',
    title: 'Animated Particle Effects #1',
    author: 'Para',
    url: 'https://opengameart.org/content/animated-particle-effects-1',
    license: 'CC0 1.0',
  },
  oga_para_fx2: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/para_CC0_particlefx-2.zip',
    title: 'Animated Particle Effects #2',
    author: 'Para',
    url: 'https://opengameart.org/content/animated-particle-effects-2',
    license: 'CC0 1.0',
  },
  oga_lightning: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/lightning_0.zip',
    title: 'Lightning',
    author: 'OpenGameArt CC0 Contributor',
    url: 'https://opengameart.org/content/lightning',
    license: 'CC0 1.0',
  },
  oga_slash_collection: {
    type: 'zip',
    downloadUrl: 'https://opengameart.org/sites/default/files/Slash%20Effect%20Collection.zip',
    title: 'Slash Effect Collection',
    author: 'OpenGameArt CC0 Contributor',
    url: 'https://opengameart.org/content/slash-effect-collection',
    license: 'CC0 1.0',
  },
  acg_travertine001: {
    type: 'zip',
    downloadUrl: 'https://ambientcg.com/get?file=Travertine001_1K-PNG.zip',
    title: 'Travertine001 (1K PNG)',
    author: 'AmbientCG (Lennart Demes)',
    url: 'https://ambientcg.com/view?id=Travertine001',
    license: 'CC0 1.0',
  },
  oga_daffodil: {
    type: 'file',
    filename: 'vegetation_daffodil_01.png',
    downloadUrl: 'https://opengameart.org/sites/default/files/vegetation_daffodil_01.png',
    title: "Paramecij's Vegetation Base Texture Pack",
    author: 'paramecij',
    url: 'https://opengameart.org/content/paramecijs-vegetation-base-texture-pack',
    license: 'CC0 1.0',
  },
  acg_ice003: {
    type: 'zip',
    downloadUrl: 'https://ambientcg.com/get?file=Ice003_1K-PNG.zip',
    title: 'Ice003 (1K PNG)',
    author: 'AmbientCG (Lennart Demes)',
    url: 'https://ambientcg.com/view?id=Ice003',
    license: 'CC0 1.0',
  },
  acg_lava004: {
    type: 'zip',
    downloadUrl: 'https://ambientcg.com/get?file=Lava004_1K-PNG.zip',
    title: 'Lava004 (1K PNG)',
    author: 'AmbientCG (Lennart Demes)',
    url: 'https://ambientcg.com/view?id=Lava004',
    license: 'CC0 1.0',
  },
  acg_leafset010: {
    type: 'zip',
    downloadUrl: 'https://ambientcg.com/get?file=LeafSet010_1K-PNG.zip',
    title: 'LeafSet010 (1K PNG)',
    author: 'AmbientCG (Lennart Demes)',
    url: 'https://ambientcg.com/view?id=LeafSet010',
    license: 'CC0 1.0',
  },
  ph_burned_ground: {
    type: 'file',
    filename: 'burned_ground_01_diff_1k.png',
    downloadUrl: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/burned_ground_01/burned_ground_01_diff_1k.png',
    title: 'Burned Ground 01 (1K)',
    author: 'Poly Haven',
    url: 'https://polyhaven.com/a/burned_ground_01',
    license: 'CC0 1.0',
  },
  ph_mud_cracked_diff: {
    type: 'file',
    filename: 'mud_cracked_dry_03_diff_1k.png',
    downloadUrl: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/mud_cracked_dry_03/mud_cracked_dry_03_diff_1k.png',
    title: 'Mud Cracked Dry 03 (1K Diffuse)',
    author: 'Poly Haven',
    url: 'https://polyhaven.com/a/mud_cracked_dry_03',
    license: 'CC0 1.0',
  },
  ph_mud_cracked_nor: {
    type: 'file',
    filename: 'mud_cracked_dry_03_nor_gl_1k.png',
    downloadUrl: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/mud_cracked_dry_03/mud_cracked_dry_03_nor_gl_1k.png',
    title: 'Mud Cracked Dry 03 (1K Normal)',
    author: 'Poly Haven',
    url: 'https://polyhaven.com/a/mud_cracked_dry_03',
    license: 'CC0 1.0',
  },
  ph_aerial_rocks: {
    type: 'file',
    filename: 'aerial_rocks_04_diff_1k.png',
    downloadUrl: 'https://dl.polyhaven.org/file/ph-assets/Textures/png/1k/aerial_rocks_04/aerial_rocks_04_diff_1k.png',
    title: 'Aerial Rocks 04 (1K)',
    author: 'Poly Haven',
    url: 'https://polyhaven.com/a/aerial_rocks_04',
    license: 'CC0 1.0',
  },
};

function fetchAllPacks() {
  const resolved = {};
  for (const [key, pack] of Object.entries(PACKS)) {
    if (pack.type === 'kenney') {
      const zipPath = path.join(DOWNLOADS_DIR, `${key}.zip`);
      const extractDir = path.join(EXTRACTED_DIR, key);
      downloadKenneyZip(pack.slug, zipPath);
      extractZip(zipPath, extractDir);
      resolved[key] = { ...pack, dir: extractDir };
    } else if (pack.type === 'zip') {
      const zipPath = path.join(DOWNLOADS_DIR, `${key}.zip`);
      const extractDir = path.join(EXTRACTED_DIR, key);
      downloadDirect(pack.downloadUrl, zipPath, 'zip');
      extractZip(zipPath, extractDir);
      resolved[key] = { ...pack, dir: extractDir };
    } else if (pack.type === 'file') {
      const filePath = path.join(DOWNLOADS_DIR, pack.filename);
      downloadDirect(pack.downloadUrl, filePath, 'binary', pack.ua || BROWSER_UA);
      resolved[key] = { ...pack, filePath };
    }
  }
  return resolved;
}

function getSourcePath(resolvedPacks, packKey, entryName) {
  const p = resolvedPacks[packKey];
  if (!p) throw new Error(`Unknown pack key: ${packKey}`);
  if (p.type === 'file') return p.filePath;
  return findInDir(p.dir, entryName);
}

// ============================================================================
// 2-Pass ffmpeg/ffprobe Audio DSP Pipeline
// ============================================================================
function ffprobeAudioDuration(filePath) {
  const res = runCmd('ffprobe', [
    '-v',
    'quiet',
    '-select_streams',
    'a:0',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const info = JSON.parse(res.stdout);
  const streamDur = Number.parseFloat(info?.streams?.[0]?.duration ?? '');
  const fmtDur = Number.parseFloat(info?.format?.duration ?? '');
  const dur = Number.isFinite(streamDur) && streamDur > 0 ? streamDur : fmtDur;
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`Invalid ffprobe duration for ${filePath}`);
  }
  return Number(dur.toFixed(3));
}

function detectMaxVolumeDb(wavPath) {
  const res = runCmd(
    'ffmpeg',
    ['-hide_banner', '-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-'],
    { allowFailure: false },
  );
  const combined = `${res.stdout}\n${res.stderr}`;
  const match = combined.match(/max_volume:\s*([-\d.]+)\s*dB/);
  if (!match) return -3.0;
  const val = Number.parseFloat(match[1]);
  return Number.isFinite(val) ? val : -3.0;
}

function processAudioAsset(resolvedPacks, spec) {
  const outAbs = path.join(ROOT, 'public', spec.relPath);
  ensureDir(path.dirname(outAbs));

  const tempTag = spec.relPath.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const pass1Wav = path.join(WORK_DIR, `${tempTag}.pass1.wav`);
  ensureDir(WORK_DIR);

  const channels = spec.channels ?? 1;
  const trimEnd = spec.trimEnd ?? !spec.loop;
  const fadeOutSec = spec.fadeOutSec ?? (spec.loop ? 0.02 : 0.06);
  const fadeInSec = spec.loop ? 0.02 : 0;

  // Build Pass 1 input(s)
  const inputs = [];
  for (const src of spec.sources) {
    inputs.push(getSourcePath(resolvedPacks, src.pack, src.entry));
  }

  let preWav = pass1Wav;
  if (inputs.length > 1) {
    const concatList = path.join(WORK_DIR, `${tempTag}.concat.txt`);
    const partWavs = [];
    for (let i = 0; i < inputs.length; i += 1) {
      const partWav = path.join(WORK_DIR, `${tempTag}.part${i}.wav`);
      const decodeArgs = ['-y', '-hide_banner', '-loglevel', 'error'];
      if (spec.ss && i === 0) decodeArgs.push('-ss', String(spec.ss));
      decodeArgs.push('-i', inputs[i], '-map', '0:a:0', '-ar', '44100', '-ac', String(channels), partWav);
      runCmd('ffmpeg', decodeArgs);
      partWavs.push(partWav);
    }
    fs.writeFileSync(
      concatList,
      partWavs.map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'),
      'utf8',
    );
    const mergedWav = path.join(WORK_DIR, `${tempTag}.merged.wav`);
    runCmd('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatList,
      '-c',
      'copy',
      mergedWav,
    ]);
    const trimFilters = ['silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB'];
    if (trimEnd) {
      trimFilters.push('areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB,areverse');
    }
    runCmd('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      mergedWav,
      '-af',
      trimFilters.join(','),
      '-ar',
      '44100',
      '-ac',
      String(channels),
      pass1Wav,
    ]);
  } else {
    const decodeArgs = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (spec.ss !== undefined) decodeArgs.push('-ss', String(spec.ss));
    if (spec.rawSliceDur !== undefined) decodeArgs.push('-t', String(spec.rawSliceDur));
    decodeArgs.push('-i', inputs[0], '-map', '0:a:0');
    const trimFilters = ['silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB'];
    if (trimEnd) {
      trimFilters.push('areverse,silenceremove=start_periods=1:start_duration=0:start_threshold=-50dB,areverse');
    }
    decodeArgs.push('-af', trimFilters.join(','), '-ar', '44100', '-ac', String(channels), pass1Wav);
    runCmd('ffmpeg', decodeArgs);
  }

  let trimmedDur = ffprobeAudioDuration(preWav);
  // If trimmed duration is super tiny (< 0.05s) because source was very quiet at -45dB, fall back without aggressive end trim
  if (trimmedDur < 0.055) {
    const fallbackArgs = ['-y', '-hide_banner', '-loglevel', 'error'];
    if (spec.ss !== undefined) fallbackArgs.push('-ss', String(spec.ss));
    if (spec.rawSliceDur !== undefined) fallbackArgs.push('-t', String(spec.rawSliceDur));
    fallbackArgs.push(
      '-i',
      inputs[0],
      '-map',
      '0:a:0',
      '-af',
      'silenceremove=start_periods=1:start_duration=0:start_threshold=-58dB',
      '-ar',
      '44100',
      '-ac',
      String(channels),
      pass1Wav,
    );
    runCmd('ffmpeg', fallbackArgs);
    trimmedDur = ffprobeAudioDuration(pass1Wav);
  }

  const maxDur = spec.maxDur ?? trimmedDur;
  const finalDur = Math.max(0.055, Math.min(trimmedDur, maxDur));
  const fadeDur = Math.min(fadeOutSec, finalDur * 0.35);
  const fadeStart = Math.max(0, finalDur - fadeDur);

  const filters = [`atrim=0:${finalDur.toFixed(4)}`, 'asetpts=PTS-STARTPTS'];
  if (finalDur < 0.6) {
    const maxDb = detectMaxVolumeDb(pass1Wav);
    const targetPeakDb = spec.targetPeakDb ?? -2.5;
    const gainDb = Math.max(-18, Math.min(22, targetPeakDb - maxDb));
    filters.push(`volume=${gainDb.toFixed(2)}dB`);
  } else {
    const lufs = spec.targetLufs ?? -16;
    filters.push(`loudnorm=I=${lufs}:TP=-1.5:LRA=11`);
  }
  if (fadeInSec > 0.002) {
    filters.push(`afade=t=in:st=0:d=${Math.min(fadeInSec, finalDur * 0.15).toFixed(4)}`);
  }
  if (fadeDur > 0.004) {
    filters.push(`afade=t=out:st=${fadeStart.toFixed(4)}:d=${fadeDur.toFixed(4)}`);
  }

  runCmd('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    pass1Wav,
    '-af',
    filters.join(','),
    '-ar',
    '44100',
    '-ac',
    String(channels),
    '-c:a',
    'libvorbis',
    '-q:a',
    '5',
    outAbs,
  ]);

  const measuredDur = ffprobeAudioDuration(outAbs);
  const packMeta = resolvedPacks[spec.sources[0].pack];
  return {
    relPath: spec.relPath,
    durationSec: measuredDur,
    sourceTitle: packMeta.title,
    sourceAuthor: packMeta.author,
    sourceUrl: packMeta.url,
    license: packMeta.license,
  };
}

// ============================================================================
// Audio Catalog Specification (9 SFX Subdirs, 8 Music, 5 Weather)
// ============================================================================
const SFX_GROUP_SPECS = [
  // 1. weapons/ (12 groups)
  {
    id: 'weapon_swing_wood', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-1.wav' },
      { pack: 'oga_swishes', entry: 'swish-2.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'swing.wav' },
    ],
  },
  {
    id: 'weapon_swing_steel', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.78, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.48,
    variants: [
      { pack: 'oga_sword_attacks', entry: 'sword.1.ogg' },
      { pack: 'oga_sword_attacks', entry: 'sword.2.ogg' },
      { pack: 'oga_sword_attacks', entry: 'sword.3.ogg' },
    ],
  },
  {
    id: 'weapon_swing_iron_heavy', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.58,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-7.wav' },
      { pack: 'oga_swishes', entry: 'swish-8.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'swing2.wav' },
    ],
  },
  {
    id: 'weapon_swing_bone', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.48,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-4.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'swing3.wav' },
    ],
  },
  {
    id: 'weapon_swing_arcane', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.74, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.52,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-10.wav' },
      { pack: 'oga_magical_1', entry: 'magical_1_0.ogg' },
    ],
  },
  {
    id: 'weapon_swing_draconic', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.88, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.62,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-11.wav' },
      { pack: 'oga_sword_attacks', entry: 'sword.8.ogg' },
    ],
  },
  {
    id: 'weapon_swing_flame', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.80, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.55,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_01.ogg' },
      { pack: 'oga_swishes', entry: 'swish-9.wav' },
    ],
  },
  {
    id: 'weapon_swing_frost', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.50,
    variants: [
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_air_01.ogg' },
      { pack: 'oga_swishes', entry: 'swish-5.wav' },
    ],
  },
  {
    id: 'weapon_swing_dagger', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.70, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.35,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'drawKnife1.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'drawKnife2.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'knifeSlice.ogg' },
    ],
  },
  {
    id: 'weapon_swing_spear', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.42,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-3.wav' },
      { pack: 'oga_swishes', entry: 'swish-6.wav' },
    ],
  },
  {
    id: 'weapon_bow_release', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.40,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-12.wav' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_air_02.ogg' },
    ],
  },
  {
    id: 'weapon_staff_cast', category: 'weapons', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 0, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.65,
    variants: [
      { pack: 'oga_rpg_sound_pack', entry: 'magic1.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'spell.wav' },
    ],
  },

  // 2. impacts/ (11 groups)
  {
    id: 'impact_generic', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.82, minIntervalMs: 35, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.42,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactGeneric_light_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactGeneric_light_001.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_hit_01.ogg' },
    ],
  },
  {
    id: 'impact_gelatinous', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.78, minIntervalMs: 35, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'oga_water_slime', entry: 'slime_01.ogg' },
      { pack: 'oga_water_slime', entry: 'slime_02.ogg' },
      { pack: 'oga_water_slime', entry: 'slime_03.ogg' },
    ],
  },
  {
    id: 'impact_flesh_fur', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.82, minIntervalMs: 35, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.42,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactPunch_medium_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactPunch_medium_001.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactPunch_heavy_000.ogg' },
    ],
  },
  {
    id: 'impact_bone', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.80, minIntervalMs: 35, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactPlate_medium_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactPlate_medium_001.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'chop.ogg' },
    ],
  },
  {
    id: 'impact_stone_ice', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 35, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.50,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactMining_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactMining_001.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_glass_01.ogg' },
    ],
  },
  {
    id: 'impact_spectral', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.78, minIntervalMs: 35, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.52,
    variants: [
      { pack: 'kenney_sci_fi_sounds', entry: 'laserSmall_000.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_air_03.ogg' },
    ],
  },
  {
    id: 'impact_dragon_scales', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.88, minIntervalMs: 35, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.55,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactMetal_heavy_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactPlate_heavy_000.ogg' },
    ],
  },
  {
    id: 'impact_crit', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.88, minIntervalMs: 40, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.65,
    variants: [
      { pack: 'oga_sword_clashes', entry: 'sword_clash.1.ogg' },
      { pack: 'oga_sword_clashes', entry: 'sword_clash.2.ogg' },
    ],
  },
  {
    id: 'impact_blocked', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.78, minIntervalMs: 40, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactMetal_light_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactPlate_light_000.ogg' },
    ],
  },
  {
    id: 'impact_prop_wood', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.74, minIntervalMs: 45, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.42,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactPlank_medium_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactPlank_medium_001.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_wood_hit_01.ogg' },
    ],
  },
  {
    id: 'impact_prop_stone', category: 'impacts', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 45, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_stones_01.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_stones_02.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactMining_002.ogg' },
    ],
  },

  // 3. footsteps/ (7 groups)
  {
    id: 'footstep_grass', category: 'footsteps', bus: 'sfx', loop: false, defaultGain: 0.42, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.30,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'footstep_grass_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_grass_001.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_grass_002.ogg' },
    ],
  },
  {
    id: 'footstep_sand', category: 'footsteps', bus: 'sfx', loop: false, defaultGain: 0.42, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.30,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'footstep_carpet_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_carpet_001.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_carpet_003.ogg' },
    ],
  },
  {
    id: 'footstep_rock', category: 'footsteps', bus: 'sfx', loop: false, defaultGain: 0.45, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.30,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'footstep00.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'footstep01.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'footstep02.ogg' },
    ],
  },
  {
    id: 'footstep_snow_ice', category: 'footsteps', bus: 'sfx', loop: false, defaultGain: 0.44, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.32,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'footstep_snow_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_snow_001.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_snow_002.ogg' },
    ],
  },
  {
    id: 'footstep_ship_wood', category: 'footsteps', bus: 'sfx', loop: false, defaultGain: 0.48, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.30,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'footstep_wood_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_wood_001.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_wood_002.ogg' },
    ],
  },
  {
    id: 'footstep_dungeon_stone', category: 'footsteps', bus: 'sfx', loop: false, defaultGain: 0.46, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.30,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'footstep_concrete_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_concrete_001.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'footstep_concrete_002.ogg' },
    ],
  },
  {
    id: 'footstep_water_shore', category: 'footsteps', bus: 'sfx', loop: false, defaultGain: 0.45, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.36,
    variants: [
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_footstep_wet_01.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_footstep_wet_02.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_footstep_wet_03.ogg' },
    ],
  },

  // 4. monsters/ (21 groups)
  {
    id: 'monster_hurt', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.45, minIntervalMs: 75, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.55,
    variants: [
      { pack: 'oga_80_creature_sfx', entry: 'hurt_01.ogg' },
      { pack: 'oga_80_creature_sfx', entry: 'hurt_02.ogg' },
      { pack: 'oga_80_creature_sfx', entry: 'hurt_03.ogg' },
    ],
  },
  {
    id: 'monster_death', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.68, minIntervalMs: 60, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.90,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'creature_die_01.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_hit_02.ogg' },
    ],
  },
  {
    id: 'monster_slime_telegraph', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.62, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.70,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'creature_slime_01.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'creature_slime_02.ogg' },
    ],
  },
  {
    id: 'monster_slime_attack', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.70, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.65,
    variants: [
      { pack: 'oga_water_slime', entry: 'slime_04.ogg' },
      { pack: 'oga_water_slime', entry: 'slime_05.ogg' },
    ],
  },
  {
    id: 'monster_goblin_telegraph', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.64, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.70,
    variants: [
      { pack: 'oga_80_creature_sfx', entry: 'cute_01.ogg' },
      { pack: 'oga_80_creature_sfx', entry: 'cute_02.ogg' },
    ],
  },
  {
    id: 'monster_goblin_attack', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.65,
    variants: [
      { pack: 'oga_rpg_sound_pack', entry: 'bite-small.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'bite-small2.wav' },
    ],
  },
  {
    id: 'monster_wolf_telegraph', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.68, minIntervalMs: 140, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.90,
    variants: [
      { pack: 'oga_80_creature_sfx', entry: 'howl.ogg' },
      { pack: 'oga_80_creature_sfx', entry: 'barking_01.ogg' },
    ],
  },
  {
    id: 'monster_wolf_attack', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.74, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.65,
    variants: [
      { pack: 'oga_80_creature_sfx', entry: 'grunt_01.ogg' },
      { pack: 'oga_80_creature_sfx', entry: 'grunt_02.ogg' },
    ],
  },
  {
    id: 'monster_skeleton_telegraph', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.66, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.75,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'chain_01.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'chain_02.ogg' },
    ],
  },
  {
    id: 'monster_skeleton_attack', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.74, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.60,
    variants: [
      { pack: 'oga_sword_attacks', entry: 'sword.4.ogg' },
      { pack: 'oga_sword_attacks', entry: 'sword.5.ogg' },
    ],
  },
  {
    id: 'monster_golem_telegraph', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.78, minIntervalMs: 160, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.10,
    variants: [
      { pack: 'oga_rpg_sound_pack', entry: 'giant1.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'giant2.wav' },
    ],
  },
  {
    id: 'monster_golem_attack', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 150, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.90,
    variants: [
      { pack: 'kenney_impact_sounds', entry: 'impactBell_heavy_000.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactBell_heavy_001.ogg' },
    ],
  },
  {
    id: 'boss_rat_telegraph', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.80, minIntervalMs: 180, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.20,
    variants: [
      { pack: 'oga_rpg_sound_pack', entry: 'shade1.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'shade2.wav' },
    ],
  },
  {
    id: 'boss_rat_attack', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.82, minIntervalMs: 160, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.10,
    variants: [
      { pack: 'oga_monster_vol1', entry: 'Monster-1.wav' },
      { pack: 'oga_monster_vol1', entry: 'Monster-2.wav' },
    ],
  },
  {
    id: 'boss_rat_death', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.90, minIntervalMs: 250, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 2.60,
    variants: [
      { pack: 'oga_ghost_moans', entry: 'qubodup-GhostMoan01.wav' },
    ],
  },
  {
    id: 'boss_dragon_roar', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.92, minIntervalMs: 200, pitchJitter: 0.03, gainJitter: 0.05, maxDur: 2.20,
    variants: [
      { pack: 'oga_80_creature_sfx', entry: 'roar_01.ogg' },
      { pack: 'oga_80_creature_sfx', entry: 'roar_02.ogg' },
    ],
  },
  {
    id: 'boss_dragon_telegraph', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 180, pitchJitter: 0.03, gainJitter: 0.05, maxDur: 1.30,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'creature_roar_01.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'creature_roar_02.ogg' },
    ],
  },
  {
    id: 'boss_dragon_flame', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 160, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.60,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_02.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_03.ogg' },
    ],
  },
  {
    id: 'boss_dragon_slam', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.90, minIntervalMs: 160, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.40,
    variants: [
      { pack: 'kenney_sci_fi_sounds', entry: 'lowFrequency_explosion_000.ogg' },
      { pack: 'kenney_sci_fi_sounds', entry: 'explosionCrunch_000.ogg' },
    ],
  },
  {
    id: 'boss_dragon_death', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.94, minIntervalMs: 300, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 2.80,
    variants: [
      { pack: 'oga_80_creature_sfx', entry: 'roar_03.ogg' },
    ],
  },
  {
    id: 'boss_stagger_break', category: 'monsters', bus: 'sfx', loop: false, defaultGain: 0.88, minIntervalMs: 150, pitchJitter: 0.03, gainJitter: 0.05, maxDur: 1.10,
    variants: [
      { pack: 'kenney_sci_fi_sounds', entry: 'explosionCrunch_001.ogg' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_glass_02.ogg' },
    ],
  },

  // 5. ui/ (20 groups)
  {
    id: 'ui_menu_open', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.65, minIntervalMs: 50, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 0.35,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'open_001.ogg' },
      { pack: 'kenney_interface_sounds', entry: 'open_002.ogg' },
    ],
  },
  {
    id: 'ui_menu_close', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.58, minIntervalMs: 50, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 0.32,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'close_001.ogg' },
      { pack: 'kenney_interface_sounds', entry: 'close_002.ogg' },
    ],
  },
  {
    id: 'ui_map_open', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.78, minIntervalMs: 50, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 0.55,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'bookOpen.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'bookFlip1.ogg' },
    ],
  },
  {
    id: 'ui_map_close', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.66, minIntervalMs: 50, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 0.45,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'bookClose.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'bookFlip2.ogg' },
    ],
  },
  {
    id: 'ui_inventory_open', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.70, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.45,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'cloth1.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'cloth2.ogg' },
    ],
  },
  {
    id: 'ui_inventory_close', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.60, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.40,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'cloth3.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'cloth4.ogg' },
    ],
  },
  {
    id: 'ui_forge_open', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.45,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'metalLatch.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'metalClick.ogg' },
    ],
  },
  {
    id: 'ui_forge_close', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.62, minIntervalMs: 50, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 0.35,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'back_001.ogg' },
      { pack: 'kenney_interface_sounds', entry: 'back_002.ogg' },
    ],
  },
  {
    id: 'ui_forge_upgrade', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.85, minIntervalMs: 80, pitchJitter: 0.03, gainJitter: 0.05, maxDur: 1.20,
    variants: [
      { pack: 'oga_forger', entry: 'forger_0.ogg' },
      { pack: 'oga_blacksmith_hammer', entry: 'blacksmithhammer.wav' },
    ],
  },
  {
    id: 'ui_inn_open', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.60,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'doorOpen_1.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'doorOpen_2.ogg' },
    ],
  },
  {
    id: 'ui_inn_close', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.62, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.55,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'doorClose_1.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'doorClose_2.ogg' },
    ],
  },
  {
    id: 'ui_quests_open', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.50,
    variants: [
      { pack: 'oga_book_flip', entry: 'BookFlip1.wav' },
      { pack: 'oga_book_flip', entry: 'BookFlip2.wav' },
    ],
  },
  {
    id: 'ui_quests_close', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.62, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.45,
    variants: [
      { pack: 'oga_book_flip', entry: 'BookFlip3.wav' },
      { pack: 'oga_book_flip', entry: 'BookFlip4.wav' },
    ],
  },
  {
    id: 'ui_bestiary_open', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.50,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'book_01.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'book_02.ogg' },
    ],
  },
  {
    id: 'ui_bestiary_close', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.62, minIntervalMs: 50, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.45,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'book_03.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'book_04.ogg' },
    ],
  },
  {
    id: 'ui_npc_talk', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 80, pitchJitter: 0.04, gainJitter: 0.05, maxDur: 0.75,
    variants: [
      { pack: 'wm_meow_siamese', entry: 'Meow_siamese.wav' },
      { pack: 'wm_meow_pleading', entry: 'Meow_pleading.oga' },
    ],
  },
  {
    id: 'ui_interact', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.58, minIntervalMs: 40, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 0.30,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'click_001.ogg' },
      { pack: 'oga_rpg_sound_pack', entry: 'interface1.wav' },
    ],
  },
  {
    id: 'ui_special_interact', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 60, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 0.65,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'confirmation_001.ogg' },
      { pack: 'kenney_interface_sounds', entry: 'confirmation_002.ogg' },
    ],
  },
  {
    id: 'ui_meow', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.55, minIntervalMs: 80, pitchJitter: 0.04, gainJitter: 0.05, maxDur: 0.65,
    variants: [
      { pack: 'wm_meow_pleading', entry: 'Meow_pleading.oga' },
      { pack: 'wm_meow_siamese', entry: 'Meow_siamese.wav' },
    ],
  },
  {
    id: 'ui_portal_vortex', category: 'ui', bus: 'sfx', loop: false, defaultGain: 0.80, minIntervalMs: 300, pitchJitter: 0.02, gainJitter: 0.04, maxDur: 1.55, fadeOutSec: 0.28,
    variants: [
      { pack: 'oga_magical_2', entry: 'magical_2_1.ogg' },
    ],
  },

  // 6. status/ (11 groups)
  {
    id: 'status_burn_apply', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 80, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.75,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_04.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_05.ogg' },
    ],
  },
  {
    id: 'status_burn_tick', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.50, minIntervalMs: 180, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_06.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_07.ogg' },
    ],
  },
  {
    id: 'status_chill_apply', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 80, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.75,
    variants: [
      { pack: 'oga_freeze', entry: 'freeze.wav' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_glass_03.ogg' },
    ],
  },
  {
    id: 'status_poison_apply', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.68, minIntervalMs: 80, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.65,
    variants: [
      { pack: 'oga_water_slime', entry: 'bubble_01.ogg' },
      { pack: 'oga_water_slime', entry: 'bubble_02.ogg' },
    ],
  },
  {
    id: 'status_poison_tick', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.48, minIntervalMs: 180, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.42,
    variants: [
      { pack: 'oga_water_slime', entry: 'bubble_03.ogg' },
      { pack: 'oga_water_slime', entry: 'slime_06.ogg' },
    ],
  },
  {
    id: 'status_bleed_apply', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.70, minIntervalMs: 80, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.50,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'knifeSlice2.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'drawKnife3.ogg' },
    ],
  },
  {
    id: 'status_bleed_tick', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.48, minIntervalMs: 180, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.35,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'drop_001.ogg' },
      { pack: 'kenney_interface_sounds', entry: 'drop_002.ogg' },
    ],
  },
  {
    id: 'status_stun_apply', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.74, minIntervalMs: 100, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.75,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'bong_001.ogg' },
      { pack: 'kenney_impact_sounds', entry: 'impactBell_heavy_002.ogg' },
    ],
  },
  {
    id: 'status_shock_apply', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.72, minIntervalMs: 80, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.65,
    variants: [
      { pack: 'kenney_digital_audio', entry: 'zap1.ogg' },
      { pack: 'kenney_digital_audio', entry: 'zap2.ogg' },
    ],
  },
  {
    id: 'status_curse_apply', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.74, minIntervalMs: 100, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.95,
    variants: [
      { pack: 'oga_ghost_moans', entry: 'qubodup-GhostMoan02.wav' },
      { pack: 'oga_ghost_moans', entry: 'qubodup-GhostMoan03.wav' },
    ],
  },
  {
    id: 'status_purge', category: 'status', bus: 'sfx', loop: false, defaultGain: 0.76, minIntervalMs: 100, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.80,
    variants: [
      { pack: 'kenney_digital_audio', entry: 'highUp.ogg' },
      { pack: 'kenney_digital_audio', entry: 'powerUp1.ogg' },
    ],
  },

  // 7. combat/ (13 groups)
  {
    id: 'combat_dodge_whoosh', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.68, minIntervalMs: 60, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'oga_swishes', entry: 'swish-13.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'cloth-heavy.wav' },
      { pack: 'oga_rpg_sound_pack', entry: 'cloth.wav' },
    ],
  },
  {
    id: 'combat_perfect_dodge', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 120, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 0.75,
    variants: [
      { pack: 'kenney_digital_audio', entry: 'phaseJump1.ogg' },
      { pack: 'kenney_digital_audio', entry: 'phaseJump2.ogg' },
    ],
  },
  {
    id: 'combat_player_hurt', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.86, minIntervalMs: 120, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.55,
    variants: [
      { pack: 'oga_80_creature_sfx', entry: 'hurt_04.ogg' },
      { pack: 'oga_80_creature_sfx', entry: 'hurt_05.ogg' },
    ],
  },
  {
    id: 'combat_hero_death', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.92, minIntervalMs: 300, pitchJitter: 0.0, gainJitter: 0.0, maxDur: 2.10,
    variants: [
      { pack: 'oga_soundpack01', entry: 'Downer01.aif' },
    ],
  },
  {
    id: 'combat_low_hp_alert', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.55, minIntervalMs: 900, pitchJitter: 0.0, gainJitter: 0.0, maxDur: 0.45,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'error_001.ogg' },
    ],
  },
  {
    id: 'combat_spell_flamepurr', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.82, minIntervalMs: 60, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.00,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_01.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'spell_fire_02.ogg' },
    ],
  },
  {
    id: 'combat_spell_lightnyan', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.82, minIntervalMs: 60, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.25,
    variants: [
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_thunder_01.ogg' },
      { pack: 'kenney_digital_audio', entry: 'zap1.ogg' },
    ],
  },
  {
    id: 'combat_spell_freezepaw', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.82, minIntervalMs: 60, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.05,
    variants: [
      { pack: 'oga_freeze', entry: 'freeze.wav' },
      { pack: 'oga_100_sfx_v2', entry: 'sfx100v2_glass_04.ogg' },
    ],
  },
  {
    id: 'combat_spell_healing_paw', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.80, minIntervalMs: 60, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 1.20,
    variants: [
      { pack: 'oga_magical_3', entry: 'magical_3_1.ogg' },
      { pack: 'kenney_digital_audio', entry: 'powerUp2.ogg' },
    ],
  },
  {
    id: 'combat_spell_aegis_purr', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.80, minIntervalMs: 60, pitchJitter: 0.03, gainJitter: 0.04, maxDur: 1.10,
    variants: [
      { pack: 'kenney_sci_fi_sounds', entry: 'forceField_001.ogg' },
      { pack: 'oga_magical_4', entry: 'magical_4_1.ogg' },
    ],
  },
  {
    id: 'combat_spell_pounce_dash', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.78, minIntervalMs: 60, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.75,
    variants: [
      { pack: 'kenney_digital_audio', entry: 'phaseJump3.ogg' },
      { pack: 'oga_swishes', entry: 'swish-9.wav' },
    ],
  },
  {
    id: 'combat_spell_meteor_paw', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 80, pitchJitter: 0.03, gainJitter: 0.05, maxDur: 1.35,
    variants: [
      { pack: 'oga_magical_5', entry: 'magical_5_1.ogg' },
      { pack: 'oga_soundpack01', entry: 'Rise01.aif' },
    ],
  },
  {
    id: 'combat_spell_meteor_fall', category: 'combat', bus: 'sfx', loop: false, defaultGain: 0.66, minIntervalMs: 90, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 1.25,
    variants: [
      { pack: 'kenney_sci_fi_sounds', entry: 'explosionCrunch_002.ogg' },
      { pack: 'kenney_sci_fi_sounds', entry: 'explosionCrunch_003.ogg' },
    ],
  },

  // 8. loot/ (7 groups)
  {
    id: 'loot_chest_creak', category: 'loot', bus: 'sfx', loop: false, defaultGain: 0.84, minIntervalMs: 120, pitchJitter: 0.03, gainJitter: 0.05, maxDur: 0.85,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'creak1.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'creak2.ogg' },
    ],
  },
  {
    id: 'loot_chest_open', category: 'loot', bus: 'sfx', loop: false, defaultGain: 0.88, minIntervalMs: 150, pitchJitter: 0.0, gainJitter: 0.0, maxDur: 2.20, fadeOutSec: 0.45,
    variants: [
      { pack: 'oga_completetask', entry: 'completetask_0.mp3' },
    ],
  },
  {
    id: 'loot_coin_pickup', category: 'loot', bus: 'sfx', loop: false, defaultGain: 0.66, minIntervalMs: 45, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'kenney_rpg_audio', entry: 'handleCoins.ogg' },
      { pack: 'kenney_rpg_audio', entry: 'handleCoins2.ogg' },
      { pack: 'oga_soundpack01', entry: 'Coin01.aif' },
    ],
  },
  {
    id: 'loot_xp_pickup', category: 'loot', bus: 'sfx', loop: false, defaultGain: 0.64, minIntervalMs: 45, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.48,
    variants: [
      { pack: 'oga_80_rpg_sfx', entry: 'item_gem_01.ogg' },
      { pack: 'oga_80_rpg_sfx', entry: 'item_gem_02.ogg' },
      { pack: 'kenney_digital_audio', entry: 'powerUp3.ogg' },
    ],
  },
  {
    id: 'loot_item_drop', category: 'loot', bus: 'sfx', loop: false, defaultGain: 0.70, minIntervalMs: 50, pitchJitter: 0.04, gainJitter: 0.06, maxDur: 0.45,
    variants: [
      { pack: 'kenney_interface_sounds', entry: 'drop_003.ogg' },
      { pack: 'kenney_interface_sounds', entry: 'drop_004.ogg' },
    ],
  },
  {
    id: 'loot_level_up', category: 'loot', bus: 'sfx', loop: false, defaultGain: 0.90, minIntervalMs: 250, pitchJitter: 0.0, gainJitter: 0.0, maxDur: 2.40, fadeOutSec: 0.35,
    variants: [
      { pack: 'oga_soundpack01', entry: 'Upper01.aif' },
    ],
  },
  {
    id: 'loot_victory_fanfare', category: 'loot', bus: 'sfx', loop: false, defaultGain: 0.92, minIntervalMs: 400, pitchJitter: 0.0, gainJitter: 0.0, maxDur: 3.40, fadeOutSec: 0.50,
    variants: [
      { pack: 'oga_soundpack01', entry: 'Rise02.aif' },
    ],
  },

  // 9. ambient/ (5 groups, loop: true, bus: 'ambience', 2.00-35.00 s)
  {
    id: 'ambient_torch_fire', category: 'ambient', bus: 'ambience', loop: true, defaultGain: 0.55, minIntervalMs: 0, pitchJitter: 0.02, gainJitter: 0.04, channels: 2, targetLufs: -18, ss: 0, rawSliceDur: 12.0, maxDur: 12.0, fadeOutSec: 0.03,
    variants: [
      { pack: 'oga_fire_loop', entry: 'fire.wav' },
    ],
  },
  {
    id: 'ambient_forge_hearth', category: 'ambient', bus: 'ambience', loop: true, defaultGain: 0.58, minIntervalMs: 0, pitchJitter: 0.02, gainJitter: 0.04, channels: 2, targetLufs: -18, ss: 12.0, rawSliceDur: 10.0, maxDur: 10.0, fadeOutSec: 0.03,
    variants: [
      { pack: 'oga_fire_loop', entry: 'fire.wav' },
    ],
  },
  {
    id: 'ambient_shore_surf', category: 'ambient', bus: 'ambience', loop: true, defaultGain: 0.54, minIntervalMs: 0, pitchJitter: 0.02, gainJitter: 0.04, channels: 2, targetLufs: -18, maxDur: 12.0, fadeOutSec: 0.03,
    variants: [
      {
        concat: [
          { pack: 'oga_wave_01', entry: 'wave_01.flac' },
          { pack: 'oga_wave_02', entry: 'wave_02.flac' },
          { pack: 'oga_wave_03', entry: 'wave_03.flac' },
        ],
      },
    ],
  },
  {
    id: 'ambient_seagulls', category: 'ambient', bus: 'ambience', loop: true, defaultGain: 0.45, minIntervalMs: 200, pitchJitter: 0.04, gainJitter: 0.06, channels: 2, targetLufs: -18, maxDur: 4.5, fadeOutSec: 0.03,
    variants: [
      {
        concat: [
          { pack: 'oga_seagull_1', entry: 'Seagull_Ambient_1.wav' },
          { pack: 'oga_seagull_2', entry: 'Seagull_Ambient_2.wav' },
        ],
      },
      {
        concat: [
          { pack: 'oga_seagull_2', entry: 'Seagull_Ambient_2.wav' },
          { pack: 'oga_seagull_1', entry: 'Seagull_Ambient_1.wav' },
        ],
      },
    ],
  },
  {
    id: 'ambient_crystal_hum', category: 'ambient', bus: 'ambience', loop: true, defaultGain: 0.45, minIntervalMs: 0, pitchJitter: 0.02, gainJitter: 0.04, channels: 2, targetLufs: -18, maxDur: 8.0, fadeOutSec: 0.04,
    variants: [
      {
        concat: [
          { pack: 'oga_magical_6', entry: 'magical_6_0.ogg' },
          { pack: 'oga_magical_6', entry: 'magical_6_0.ogg' },
        ],
      },
    ],
  },
];

const MUSIC_SPECS = [
  { id: 'menu', pack: 'oga_music_menu', entry: 'Title_Theme_0.mp3', loop: true, defaultGain: 0.92, maxDur: 90 },
  { id: 'overworld', pack: 'oga_music_overworld', entry: 'TownTheme.mp3', loop: true, defaultGain: 1.0, maxDur: 110 },
  { id: 'maritime', pack: 'oga_music_maritime', entry: 'Pirates_Orchestra.mp3', loop: true, defaultGain: 1.05, maxDur: 135 },
  { id: 'dungeon', pack: 'oga_music_dungeon', entry: 'cave_themeb4.ogg', loop: true, defaultGain: 0.96, maxDur: 120 },
  { id: 'combat', pack: 'oga_music_combat', entry: 'battleThemeA.mp3', loop: true, defaultGain: 0.95, maxDur: 105 },
  { id: 'boss', pack: 'oga_music_boss', entry: 'CleytonRX_Boss.mp3', loop: true, defaultGain: 1.0, maxDur: 180 },
  { id: 'boss_phase2', pack: 'oga_music_boss_p2', entry: 'CleytonRX_Boss_Var.ogg', loop: true, defaultGain: 1.02, maxDur: 125 },
  { id: 'victory', pack: 'oga_music_victory', entry: 'Victory1_1.mp3', loop: false, defaultGain: 1.0, maxDur: 60 },
];

const WEATHER_SPECS = [
  {
    id: 'ocean_waves',
    loop: true,
    maxDur: 16.0,
    sources: [
      { pack: 'oga_wave_01', entry: 'wave_01.flac' },
      { pack: 'oga_wave_02', entry: 'wave_02.flac' },
      { pack: 'oga_wave_03', entry: 'wave_03.flac' },
      { pack: 'oga_wave_04', entry: 'wave_04.flac' },
    ],
  },
  {
    id: 'wind_gale',
    loop: true,
    ss: 0,
    rawSliceDur: 24.0,
    maxDur: 24.0,
    sources: [{ pack: 'oga_wind1', entry: 'wind1.wav' }],
  },
  {
    id: 'rain_storm',
    loop: true,
    maxDur: 27.0,
    sources: [{ pack: 'oga_rain_ogg', entry: '1.ogg' }],
  },
  {
    id: 'thunder_clap',
    loop: false,
    ss: 10.0,
    rawSliceDur: 4.5,
    maxDur: 4.2,
    fadeOutSec: 0.35,
    targetLufs: -15,
    sources: [{ pack: 'wm_thunder', entry: 'Storm_thunderbolts.ogg' }],
  },
  {
    id: 'birds_day',
    loop: true,
    maxDur: 30.0,
    sources: [{ pack: 'oga_birds_day', entry: 'birds-isaiah658_0.ogg' }],
  },
];

// ============================================================================
// VFX Processing via uv + Pillow + NumPy (ZERO AI generation)
// ============================================================================
function processAllVfx(resolvedPacks) {
  ensureDir(PUBLIC_VFX_DIR);

  const sourcesJson = {
    blenderDir: resolvedPacks.oga_blender_vfx.dir,
    paraFx1Dir: resolvedPacks.oga_para_fx1.dir,
    paraFx2Dir: resolvedPacks.oga_para_fx2.dir,
    lightningDir: resolvedPacks.oga_lightning.dir,
    slashDir: resolvedPacks.oga_slash_collection.dir,
    travertineDir: resolvedPacks.acg_travertine001.dir,
    kenneyParticleDir: resolvedPacks.kenney_particle_pack.dir,
    kenneySmokeDir: resolvedPacks.kenney_smoke_particles.dir,
    kenneySplatDir: resolvedPacks.kenney_splat_pack.dir,
    ice003Dir: resolvedPacks.acg_ice003.dir,
    lava004Dir: resolvedPacks.acg_lava004.dir,
    leafSet010Dir: resolvedPacks.acg_leafset010.dir,
    daffodilPath: resolvedPacks.oga_daffodil.filePath,
    burnedGroundPath: resolvedPacks.ph_burned_ground.filePath,
    mudCrackedDiffPath: resolvedPacks.ph_mud_cracked_diff.filePath,
    mudCrackedNorPath: resolvedPacks.ph_mud_cracked_nor.filePath,
    aerialRocksPath: resolvedPacks.ph_aerial_rocks.filePath,
    outDir: PUBLIC_VFX_DIR,
  };

  const pyScriptPath = path.join(WORK_DIR, 'pack_vfx.py');
  const pyCode = `
import json, os, sys, math
import numpy as np
from PIL import Image, ImageFilter

cfg = json.load(open(sys.argv[1], 'r', encoding='utf-8'))
out_dir = cfg['outDir']

def find_file(root, name_sub):
    name_low = name_sub.lower().replace('\\\\', '/')
    matches = []
    for dp, _, files in os.walk(root):
        for fn in files:
            full = os.path.join(dp, fn)
            rel = os.path.relpath(full, root).replace('\\\\', '/').lower()
            if rel == name_low or rel.endswith('/' + name_low) or fn.lower() == name_low:
                matches.append(full)
    if not matches:
        raise FileNotFoundError(f"Missing {name_sub} in {root}")
    matches.sort()
    return matches[0]

def find_dir(root, suffix):
    suf_low = suffix.lower().replace('\\\\', '/')
    for dp, _, _ in os.walk(root):
        rel = os.path.relpath(dp, root).replace('\\\\', '/').lower()
        if rel == suf_low or rel.endswith('/' + suf_low):
            return dp
    raise FileNotFoundError(f"Missing dir {suffix} in {root}")

def save_rgba(img, filename, cols=1, rows=1, frames=1):
    path = os.path.join(out_dir, filename)
    img.save(path, format='PNG', optimize=True)
    return {
        'file': filename,
        'width': img.width,
        'height': img.height,
        'cols': int(cols),
        'rows': int(rows),
        'frames': int(frames),
    }

def slice_sheet(img, cols, rows):
    cw = img.width // cols
    ch = img.height // rows
    out = []
    for idx in range(cols * rows):
        r = idx // cols
        c = idx % cols
        out.append(img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)))
    return out

def filter_non_empty_frames(frames, min_alpha=10):
    active = []
    for fr in frames:
        arr = np.array(fr.convert('RGBA'))
        if int(arr[:, :, 3].max()) >= min_alpha:
            active.append(fr.convert('RGBA'))
    return active

def pack_frames(frames, cols, rows, cell_size=None):
    if not frames:
        raise ValueError("Cannot pack empty frame list")
    if cell_size is None:
        cw, ch = frames[0].width, frames[0].height
    else:
        cw, ch = cell_size
    sheet = Image.new('RGBA', (cols * cw, rows * ch), (0, 0, 0, 0))
    for idx, fr in enumerate(frames[:cols * rows]):
        if fr.size != (cw, ch):
            fr = fr.resize((cw, ch), Image.Resampling.LANCZOS)
        r = idx // cols
        c = idx % cols
        sheet.paste(fr, (c * cw, r * ch))
    return sheet, len(frames[:cols * rows])

def pack_sequence(frame_paths, cols, rows, cell_size=None, min_alpha=10):
    raw_frames = [Image.open(p).convert('RGBA') for p in frame_paths]
    active = filter_non_empty_frames(raw_frames, min_alpha=min_alpha)
    return pack_frames(active, cols, rows, cell_size=cell_size)

def ensure_transparent_from_luma(img):
    # Some flipbooks (like lightning or black-bg particlefx) have black RGB and opaque alpha=255.
    # Only apply when alpha is fully opaque (>= 254), using a gentle black cutoff so faint glow frames survive.
    arr = np.array(img.convert('RGBA'), dtype=np.float32)
    alpha = arr[:, :, 3]
    if float(alpha.min()) >= 254.0:
        luma = np.max(arr[:, :, :3], axis=2)
        new_alpha = np.clip((luma - 2.0) / 253.0 * 255.0, 0.0, 255.0)
        arr[:, :, 3] = new_alpha
    return Image.fromarray(arr.astype(np.uint8), mode='RGBA')

results = {}

# 1. Flames: Blender volumetric fire (active frames -> 6x5 = 768x640) + Blender volumetric fireball explosion (active frames -> 7x4 = 896x512)
flame_dir = find_dir(cfg['blenderDir'], 'flame/fire')
flame_frames = sorted([os.path.join(flame_dir, f) for f in os.listdir(flame_dir) if f.endswith('.png')])
flames_sheet, flames_count = pack_sequence(flame_frames, 6, 5, (128, 128), min_alpha=10)
results['flames'] = save_rgba(flames_sheet, 'flames_flipbook.png', cols=6, rows=5, frames=flames_count)

fireball_dir = find_dir(cfg['blenderDir'], 'explosion/fire')
fireball_frames = sorted([os.path.join(fireball_dir, f) for f in os.listdir(fireball_dir) if f.endswith('.png')])
fireball_active = filter_non_empty_frames([Image.open(p).convert('RGBA') for p in fireball_frames], min_alpha=10)
fb_cols = 7 if len(fireball_active) <= 28 else 6
fb_rows = 4 if len(fireball_active) <= 28 else 5
fireball_sheet, fireball_count = pack_frames(fireball_active, fb_cols, fb_rows, (128, 128))
results['fireball'] = save_rgba(fireball_sheet, 'fireball_flipbook.png', cols=fb_cols, rows=fb_rows, frames=fireball_count)

# 2. Smoke: para_fx1 particlefx_02.png (dense volumetric smoke, trimmed & repacked 8x8) + Kenney whitePuff (25 -> 5x5)
smoke_02 = ensure_transparent_from_luma(Image.open(find_file(cfg['paraFx1Dir'], 'particlefx_02.png')).convert('RGBA'))
smoke_active = filter_non_empty_frames(slice_sheet(smoke_02, 8, 8), min_alpha=10)
smoke_sheet, smoke_count = pack_frames(smoke_active, 8, 8, (128, 128))
results['smoke'] = save_rgba(smoke_sheet, 'smoke_flipbook.png', cols=8, rows=8, frames=smoke_count)

puff_frames = [find_file(cfg['kenneySmokeDir'], f'whitePuff{i:02d}.png') for i in range(25)]
steam_sheet, steam_count = pack_sequence(puff_frames, 5, 5, (204, 204), min_alpha=10)
results['steam_puff'] = save_rgba(steam_sheet, 'steam_puff_flipbook.png', cols=5, rows=5, frames=steam_count)

# 3. Sparks: para_fx1 particlefx_01.png (trimmed & repacked 8x8) + Kenney spark_04.png (512x512)
sparks_01 = ensure_transparent_from_luma(Image.open(find_file(cfg['paraFx1Dir'], 'particlefx_01.png')).convert('RGBA'))
sparks_active = filter_non_empty_frames(slice_sheet(sparks_01, 8, 8), min_alpha=10)
sparks_sheet, sparks_count = pack_frames(sparks_active, 8, 8, (128, 128))
results['sparks'] = save_rgba(sparks_sheet, 'sparks_flipbook.png', cols=8, rows=8, frames=sparks_count)

spark_04 = Image.open(find_file(cfg['kenneyParticleDir'], 'PNG (Transparent)/spark_04.png')).convert('RGBA')
results['spark_ember'] = save_rgba(spark_04, 'spark_ember.png')

# 4. Ice Shards: para_fx1 particlefx_07.png (trimmed & repacked 8x8) + AmbientCG Ice003 crystal shard (512x512)
frost_07 = ensure_transparent_from_luma(Image.open(find_file(cfg['paraFx1Dir'], 'particlefx_07.png')).convert('RGBA'))
frost_active = filter_non_empty_frames(slice_sheet(frost_07, 8, 8), min_alpha=10)
frost_sheet, frost_count = pack_frames(frost_active, 8, 8, (128, 128))
results['ice_shards'] = save_rgba(frost_sheet, 'ice_shards_flipbook.png', cols=8, rows=8, frames=frost_count)

ice_color = Image.open(find_file(cfg['ice003Dir'], 'Ice003_1K-PNG_Color.png')).convert('RGBA').resize((512, 512), Image.Resampling.LANCZOS)
# Create a crisp faceted crystal shard alpha mask over the real Ice003 PBR texture
h, w = 512, 512
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
nx = (xx - w * 0.5) / (w * 0.5)
ny = (yy - h * 0.5) / (h * 0.5)
diamond = np.abs(nx) * 1.45 + np.abs(ny) * 0.92
shard_alpha = np.clip((1.0 - diamond) * 3.5, 0.0, 1.0) * 255.0
ice_arr = np.array(ice_color, dtype=np.uint8)
ice_arr[:, :, 3] = shard_alpha.astype(np.uint8)
results['ice_crystal'] = save_rgba(Image.fromarray(ice_arr, mode='RGBA'), 'ice_crystal_shard.png')

# 5. Slime / Organic Splatter: para_fx2 blood_hit_01.png (4x4 green/cyan-tinted, trimmed) + textured PBR Slime Decal (512x512)
blood_01 = Image.open(find_file(cfg['paraFx2Dir'], 'blood_hit_01.png')).convert('RGBA')
# Shift organic hit splatter toward vibrant chartreuse/emerald slime while preserving shading & alpha
slime_arr = np.array(ensure_transparent_from_luma(blood_01), dtype=np.float32)
r, g, b, a = slime_arr[:, :, 0], slime_arr[:, :, 1], slime_arr[:, :, 2], slime_arr[:, :, 3]
lum = np.maximum(r, np.maximum(g, b))
slime_arr[:, :, 0] = np.clip(lum * 0.45, 0, 255)
slime_arr[:, :, 1] = np.clip(lum * 1.05, 0, 255)
slime_arr[:, :, 2] = np.clip(lum * 0.25, 0, 255)
slime_arr[:, :, 3] = a
slime_tinted = Image.fromarray(slime_arr.astype(np.uint8), mode='RGBA')
slime_active = filter_non_empty_frames(slice_sheet(slime_tinted, 4, 4), min_alpha=10)
slime_sheet, slime_count = pack_frames(slime_active, 4, 4, (128, 128))
results['slime_splatter'] = save_rgba(slime_sheet, 'slime_splatter_flipbook.png', cols=4, rows=4, frames=slime_count)

# Use Kenney splat01.png strictly as an alpha cutout mask over shaded CC0 organic PBR surfaces (Lava004 + Ice003)
splat_mask_img = Image.open(find_file(cfg['kenneySplatDir'], 'PNG/Double (512px)/splat01.png')).convert('RGBA')
splat_alpha = np.array(splat_mask_img, dtype=np.float32)[:, :, 3]
# Compute blurred alpha heightfield for 3D viscous dome meniscus & rim shading
alpha_blur = np.array(Image.fromarray(splat_alpha.astype(np.uint8), mode='L').filter(ImageFilter.GaussianBlur(radius=10.0)), dtype=np.float32) / 255.0
gy, gx = np.gradient(alpha_blur)
lava_disp = np.array(Image.open(find_file(cfg['lava004Dir'], 'Lava004_1K-PNG_Displacement.png')).convert('L').resize((512, 512), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
ice_rough = np.array(Image.open(find_file(cfg['ice003Dir'], 'Ice003_1K-PNG_Roughness.png')).convert('L').resize((512, 512), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0
ice_norm_arr = (np.array(Image.open(find_file(cfg['ice003Dir'], 'Ice003_1K-PNG_NormalGL.png')).convert('RGB').resize((512, 512), Image.Resampling.LANCZOS), dtype=np.float32) / 255.0) * 2.0 - 1.0

# Combine organic PBR normal + meniscus dome slope for realistic wet gelatinous specular lighting
nx_s = np.clip(-gx * 7.5 + ice_norm_arr[:, :, 0] * 0.45, -1.0, 1.0)
ny_s = np.clip(-gy * 7.5 + ice_norm_arr[:, :, 1] * 0.45, -1.0, 1.0)
nz_s = np.sqrt(np.maximum(0.05, 1.0 - nx_s * nx_s - ny_s * ny_s))
# Top-left directional light
lx, ly, lz = -0.45, -0.55, 0.70
ndotl = np.clip(nx_s * lx + ny_s * ly + nz_s * lz, 0.0, 1.0)
# Half-vector specular for wet glossy slime sheen
hx, hy, hz = -0.24, -0.29, 0.926
ndoth = np.clip(nx_s * hx + ny_s * hy + nz_s * hz, 0.0, 1.0)
spec = (ndoth ** 26.0) * (0.45 + 0.55 * (1.0 - ice_rough))

# Rich chartreuse-emerald gradient modulated by viscous Lava004 cells, rim darkening, and glossy highlights
cell_tex = 0.58 + 0.42 * lava_disp
dome_depth = 0.42 + 0.58 * np.clip(alpha_blur * 1.35, 0.0, 1.0)
base_r = (36.0 + 72.0 * cell_tex * ndotl) * dome_depth + spec * 195.0
base_g = (105.0 + 135.0 * cell_tex * (0.45 + 0.55 * ndotl)) * dome_depth + spec * 245.0
base_b = (18.0 + 38.0 * (1.0 - ice_rough) * ndotl) * dome_depth + spec * 155.0

slime_decal_arr = np.zeros((512, 512, 4), dtype=np.uint8)
slime_decal_arr[:, :, 0] = np.clip(base_r, 0.0, 255.0).astype(np.uint8)
slime_decal_arr[:, :, 1] = np.clip(base_g, 0.0, 255.0).astype(np.uint8)
slime_decal_arr[:, :, 2] = np.clip(base_b, 0.0, 255.0).astype(np.uint8)
slime_decal_arr[:, :, 3] = np.clip(splat_alpha * (0.86 + 0.14 * dome_depth), 0.0, 255.0).astype(np.uint8)
results['slime_decal'] = save_rgba(Image.fromarray(slime_decal_arr, mode='RGBA'), 'slime_splat_decal.png')

# 6. Electric Arcs: OGA lightning (4 distinct arcs stacked 1x4 -> 1024x1024) + para_fx1 particlefx_08.png (trimmed 8x8 burst)
arc_files = [
    find_file(cfg['lightningDir'], 'lightning_b.png'),
    find_file(cfg['lightningDir'], 'lightning1_b.png'),
    find_file(cfg['lightningDir'], 'lightning2_b.png'),
    find_file(cfg['lightningDir'], 'lightning3_b.png'),
]
arc_frames = filter_non_empty_frames([ensure_transparent_from_luma(Image.open(p).convert('RGBA')) for p in arc_files], min_alpha=10)
arc_sheet, arc_count = pack_frames(arc_frames, 1, 4, (1024, 256))
results['electric_arc'] = save_rgba(arc_sheet, 'electric_arc.png', cols=1, rows=4, frames=arc_count)

shock_08 = ensure_transparent_from_luma(Image.open(find_file(cfg['paraFx1Dir'], 'particlefx_08.png')).convert('RGBA'))
shock_active = filter_non_empty_frames(slice_sheet(shock_08, 8, 8), min_alpha=10)
shock_sheet, shock_count = pack_frames(shock_active, 8, 8, (128, 128))
results['electric_burst'] = save_rgba(shock_sheet, 'electric_burst_flipbook.png', cols=8, rows=8, frames=shock_count)

# 7. Spectral / Abyssal Clouds: para_fx1 particlefx_12.png (trimmed 8x8 violet spectral) + Blender volumetric ring/magic (31 active -> 8x4)
spectral_12 = ensure_transparent_from_luma(Image.open(find_file(cfg['paraFx1Dir'], 'particlefx_12.png')).convert('RGBA'))
spectral_active = filter_non_empty_frames(slice_sheet(spectral_12, 8, 8), min_alpha=10)
spectral_sheet, spectral_count = pack_frames(spectral_active, 8, 8, (128, 128))
results['spectral_cloud'] = save_rgba(spectral_sheet, 'spectral_cloud_flipbook.png', cols=8, rows=8, frames=spectral_count)

vortex_dir = find_dir(cfg['blenderDir'], 'ring/magic')
vortex_frames = sorted([os.path.join(vortex_dir, f) for f in os.listdir(vortex_dir) if f.endswith('.png')])
vortex_active = filter_non_empty_frames([Image.open(p).convert('RGBA') for p in vortex_frames], min_alpha=10)
vx_cols = 8
vx_rows = max(1, (len(vortex_active) + vx_cols - 1) // vx_cols)
vortex_sheet, vortex_count = pack_frames(vortex_active, vx_cols, vx_rows, (128, 128))
results['abyssal_vortex'] = save_rgba(vortex_sheet, 'abyssal_vortex_flipbook.png', cols=vx_cols, rows=vx_rows, frames=vortex_count)

# 8. Heat Distortion Normal Map: AmbientCG Ice003 NormalGL smoothed for refractive shimmer (512x512 RGB)
ice_norm = Image.open(find_file(cfg['ice003Dir'], 'Ice003_1K-PNG_NormalGL.png')).convert('RGB').resize((512, 512), Image.Resampling.LANCZOS)
ice_norm = ice_norm.filter(ImageFilter.GaussianBlur(radius=1.8))
results['heat_distortion_normal'] = save_rgba(ice_norm.convert('RGBA'), 'heat_distortion_normal.png')

# 9. Melee Slash Trail & Projectile Trail: Kenney PNG (Transparent) slash_01.png + trace_01.png (512x512 RGBA)
slash_01 = Image.open(find_file(cfg['kenneyParticleDir'], 'PNG (Transparent)/slash_01.png')).convert('RGBA')
results['melee_slash_trail'] = save_rgba(slash_01, 'melee_slash_trail.png')

trace_01 = Image.open(find_file(cfg['kenneyParticleDir'], 'PNG (Transparent)/trace_01.png')).convert('RGBA')
results['projectile_trail'] = save_rgba(trace_01, 'projectile_trail.png')

# 10. Crater / Fissure / Scorch Decal: PolyHaven mud_cracked_dry_03 + Lava004 Emission radially feathered + burned_ground_01
mud_diff = Image.open(cfg['mudCrackedDiffPath']).convert('RGBA').resize((512, 512), Image.Resampling.LANCZOS)
lava_emit = Image.open(find_file(cfg['lava004Dir'], 'Lava004_1K-PNG_Emission.png')).convert('RGBA').resize((512, 512), Image.Resampling.LANCZOS)
yy, xx = np.mgrid[0:512, 0:512].astype(np.float32)
dist = np.sqrt(((xx - 256.0) / 245.0) ** 2 + ((yy - 256.0) / 245.0) ** 2)
radial_alpha = np.clip((1.0 - dist) * 2.2, 0.0, 1.0)
mud_arr = np.array(mud_diff, dtype=np.float32)
lava_arr = np.array(lava_emit, dtype=np.float32)
core_glow = np.clip((1.0 - dist * 1.25), 0.0, 1.0)[:, :, None]
crater_rgb = np.clip(mud_arr[:, :, :3] * 0.72 + lava_arr[:, :, :3] * core_glow * 0.85, 0, 255)
crater_out = np.zeros((512, 512, 4), dtype=np.uint8)
crater_out[:, :, :3] = crater_rgb.astype(np.uint8)
crater_out[:, :, 3] = (radial_alpha * 255.0).astype(np.uint8)
results['crater_fissure_decal'] = save_rgba(Image.fromarray(crater_out, mode='RGBA'), 'crater_fissure_decal.png')

burned = Image.open(cfg['burnedGroundPath']).convert('RGBA').resize((512, 512), Image.Resampling.LANCZOS)
burned_arr = np.array(burned, dtype=np.float32)
burned_arr[:, :, 3] = (radial_alpha * 235.0).astype(np.uint8)
results['scorch_decal'] = save_rgba(Image.fromarray(burned_arr.astype(np.uint8), mode='RGBA'), 'scorch_decal.png')

# 11. Debris Fragments (2x2 atlas: Single LeafSet010 leaf, unclipped Daffodil petals, Aerial Rocks, Travertine001 bone) + 512x512 atlas
def fit_centered_in_quadrant(rgba_img, box_size=256, pad=12):
    bbox = rgba_img.getbbox()
    cropped = rgba_img.crop(bbox) if bbox else rgba_img
    max_dim = box_size - pad * 2
    cw, ch = cropped.size
    scale = min(max_dim / max(1, cw), max_dim / max(1, ch))
    nw = max(1, int(round(cw * scale)))
    nh = max(1, int(round(ch * scale)))
    resized = cropped.resize((nw, nh), Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (box_size, box_size), (0, 0, 0, 0))
    ox = (box_size - nw) // 2
    oy = (box_size - nh) // 2
    cell.paste(resized, (ox, oy), resized)
    return cell

# 11a: Single crisp leaf cutout from top-left leaf of LeafSet010 (1024x1024 -> 512x512 quadrant)
leaf_col_full = Image.open(find_file(cfg['leafSet010Dir'], 'LeafSet010_1K-PNG_Color.png')).convert('RGB')
leaf_op_full = Image.open(find_file(cfg['leafSet010Dir'], 'LeafSet010_1K-PNG_Opacity.png')).convert('L')
lw, lh = leaf_col_full.size
leaf_single_col = leaf_col_full.crop((0, 0, lw // 2, lh // 2))
leaf_single_op = leaf_op_full.crop((0, 0, lw // 2, lh // 2))
leaf_single = leaf_single_col.copy()
leaf_single.putalpha(leaf_single_op)
leaf_rgba = fit_centered_in_quadrant(leaf_single, 256, pad=10)

# 11b: Full unclipped daffodil flower head centered proportionally inside 256x256
daf = Image.open(cfg['daffodilPath']).convert('RGBA')
daf_crop = fit_centered_in_quadrant(daf, 256, pad=10)

# 11c: Rock chip cutout from Aerial Rocks + jagged alpha
rock_src = Image.open(cfg['aerialRocksPath']).convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS)
ry, rx = np.mgrid[0:256, 0:256].astype(np.float32)
ang = np.arctan2(ry - 128.0, rx - 128.0)
rdist = np.sqrt((rx - 128.0) ** 2 + (ry - 128.0) ** 2) / 110.0
poly_mod = 0.78 + 0.18 * np.cos(ang * 5.0 + 0.4) + 0.1 * np.sin(ang * 3.0)
rock_arr = np.array(rock_src, dtype=np.uint8)
rock_arr[:, :, 3] = (np.clip((poly_mod - rdist) * 8.0, 0.0, 1.0) * 255.0).astype(np.uint8)
rock_rgba = Image.fromarray(rock_arr, mode='RGBA')

# 11d: Porous ivory bone fragment from AmbientCG Travertine001 PBR scan
bone_tex = Image.open(find_file(cfg['travertineDir'], 'Travertine001_1K-PNG_Color.png')).convert('RGBA').resize((256, 256), Image.Resampling.LANCZOS)
bone_arr = np.array(bone_tex, dtype=np.float32)
# Brighten slightly toward warm ivory bone and carve a realistic femur/bone splinter silhouette
bone_arr[:, :, 0] = np.clip(bone_arr[:, :, 0] * 1.15 + 32.0, 0, 255)
bone_arr[:, :, 1] = np.clip(bone_arr[:, :, 1] * 1.12 + 26.0, 0, 255)
bone_arr[:, :, 2] = np.clip(bone_arr[:, :, 2] * 1.04 + 14.0, 0, 255)
bx = (rx - 128.0) / 102.0
by = (ry - 128.0) / 34.0
# Bone shaft + flared condyle ends
flare = 1.0 + 0.55 * np.exp(-((np.abs(bx) - 0.82) / 0.22) ** 2)
bone_dist = np.sqrt((bx * 0.92) ** 2 + (by / flare) ** 2)
bone_arr[:, :, 3] = (np.clip((1.0 - bone_dist) * 8.0, 0.0, 1.0) * 255.0).astype(np.float32)
bone_rgba = Image.fromarray(bone_arr.astype(np.uint8), mode='RGBA')

debris_atlas = Image.new('RGBA', (512, 512), (0, 0, 0, 0))
debris_atlas.paste(leaf_rgba, (0, 0))
debris_atlas.paste(daf_crop, (256, 0))
debris_atlas.paste(rock_rgba, (0, 256))
debris_atlas.paste(bone_rgba, (256, 256))
results['debris_fragments'] = save_rgba(debris_atlas, 'debris_fragments.png')

print(json.dumps(results))
`;
  fs.writeFileSync(pyScriptPath, pyCode, 'utf8');
  const cfgPath = path.join(WORK_DIR, 'vfx_cfg.json');
  fs.writeFileSync(cfgPath, JSON.stringify(sourcesJson, null, 2), 'utf8');

  const res = runCmd('uv', ['run', '--with', 'pillow', '--with', 'numpy', 'python', pyScriptPath, cfgPath]);
  const vfxMeta = JSON.parse(res.stdout.trim().split('\n').pop());
  return vfxMeta;
}

// ============================================================================
// Manifest & CREDITS.md Writers
// ============================================================================
function writeAudioManifest(sfxResults, musicResults, weatherResults) {
  const sfxGroupsObj = {};
  for (const g of sfxResults) {
    sfxGroupsObj[g.id] = {
      id: g.id,
      category: g.category,
      bus: g.bus,
      loop: g.loop,
      defaultGain: g.defaultGain,
      minIntervalMs: g.minIntervalMs,
      pitchJitter: g.pitchJitter,
      gainJitter: g.gainJitter,
      variants: g.variants.map((v) => ({ path: v.relPath, durationSec: v.durationSec })),
    };
  }

  const musicObj = {};
  for (const m of musicResults) {
    musicObj[m.id] = {
      id: m.id,
      path: m.relPath,
      durationSec: m.durationSec,
      loop: m.loop,
      defaultGain: m.defaultGain,
    };
  }

  const weatherObj = {};
  for (const w of weatherResults) {
    weatherObj[w.id] = {
      id: w.id,
      path: w.relPath,
      durationSec: w.durationSec,
      loop: w.loop,
    };
  }

  const groupIds = sfxResults.map((g) => `  | '${g.id}'`).join('\n');

  const content = `// Generated & calibrated by scripts/fetch_studio_assets.mjs via ffprobe 8.1.2
// ZERO 'three' imports and ZERO DOM references — 100% Node/Vitest safe.
import type { MusicTrackId, SfxId } from '../game/types';

export type AudioBusId = 'master' | 'music' | 'sfx' | 'ambience';

export type AudioSfxCategory =
  | 'weapons'
  | 'impacts'
  | 'footsteps'
  | 'monsters'
  | 'ui'
  | 'status'
  | 'combat'
  | 'loot'
  | 'ambient';

export const AUDIO_SFX_CATEGORIES: readonly AudioSfxCategory[] = [
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

export type AudioSfxGroupId =
${groupIds};

export type AudioMusicCategoryId = MusicTrackId | 'boss_phase2' | 'victory';

export type AudioWeatherCategoryId =
  | 'ocean_waves'
  | 'wind_gale'
  | 'rain_storm'
  | 'thunder_clap'
  | 'birds_day';

export interface AudioVariantEntry {
  readonly path: string;
  readonly durationSec: number;
}

export interface AudioSfxGroupEntry {
  readonly id: AudioSfxGroupId;
  readonly category: AudioSfxCategory;
  readonly bus: 'sfx' | 'ambience';
  readonly loop: boolean;
  readonly defaultGain: number;
  readonly minIntervalMs: number;
  readonly pitchJitter: number;
  readonly gainJitter: number;
  readonly variants: readonly AudioVariantEntry[];
}

export interface AudioMusicTrackEntry {
  readonly id: AudioMusicCategoryId;
  readonly path: string;
  readonly durationSec: number;
  readonly loop: boolean;
  readonly defaultGain: number;
}

export interface AudioWeatherTrackEntry {
  readonly id: AudioWeatherCategoryId;
  readonly path: string;
  readonly durationSec: number;
  readonly loop: boolean;
}

export const AUDIO_DURATION_BOUNDS: Readonly<
  Record<AudioSfxCategory | 'music' | 'weather', { readonly minSec: number; readonly maxSec: number }>
> = {
  weapons: { minSec: 0.05, maxSec: 0.90 },
  impacts: { minSec: 0.05, maxSec: 0.85 },
  footsteps: { minSec: 0.05, maxSec: 0.45 },
  monsters: { minSec: 0.06, maxSec: 3.20 },
  ui: { minSec: 0.05, maxSec: 1.80 },
  status: { minSec: 0.06, maxSec: 1.20 },
  combat: { minSec: 0.06, maxSec: 2.50 },
  loot: { minSec: 0.06, maxSec: 3.80 },
  ambient: { minSec: 2.00, maxSec: 35.00 },
  music: { minSec: 5.00, maxSec: 240.00 },
  weather: { minSec: 1.50, maxSec: 60.00 },
} as const;

export const AUDIO_SFX_GROUPS: Readonly<Record<AudioSfxGroupId, AudioSfxGroupEntry>> = ${JSON.stringify(sfxGroupsObj, null, 2)} as const;

export const AUDIO_MUSIC_TRACKS: Readonly<Record<AudioMusicCategoryId, AudioMusicTrackEntry>> = ${JSON.stringify(musicObj, null, 2)} as const;

export const AUDIO_WEATHER_TRACKS: Readonly<Record<AudioWeatherCategoryId, AudioWeatherTrackEntry>> = ${JSON.stringify(weatherObj, null, 2)} as const;

export const LEGACY_SFX_TO_GROUP: Readonly<Record<SfxId, AudioSfxGroupId>> = {
  sword_swing: 'weapon_swing_wood',
  swing_wood: 'weapon_swing_wood',
  swing_steel: 'weapon_swing_steel',
  swing_staff: 'weapon_swing_arcane',
  swing_dragon: 'weapon_swing_draconic',
  sword_hit: 'impact_generic',
  crit_hit: 'impact_crit',
  enemy_hurt: 'monster_hurt',
  dodge_whoosh: 'combat_dodge_whoosh',
  spell_fire: 'combat_spell_flamepurr',
  spell_lightning: 'combat_spell_lightnyan',
  spell_ice: 'combat_spell_freezepaw',
  spell_heal: 'combat_spell_healing_paw',
  spell_flamepurr: 'combat_spell_flamepurr',
  spell_lightnyan: 'combat_spell_lightnyan',
  spell_freezepaw: 'combat_spell_freezepaw',
  spell_healing_paw: 'combat_spell_healing_paw',
  spell_aegis_purr: 'combat_spell_aegis_purr',
  spell_pounce_dash: 'combat_spell_pounce_dash',
  spell_meteor_paw: 'combat_spell_meteor_paw',
  spell_meteor_fall: 'combat_spell_meteor_fall',
  player_hurt: 'combat_player_hurt',
  chest_creak: 'loot_chest_creak',
  chest_open: 'loot_chest_open',
  level_up: 'loot_level_up',
  coin_pickup: 'loot_coin_pickup',
  menu_open: 'ui_menu_open',
  menu_close: 'ui_menu_close',
  map_open: 'ui_map_open',
  npc_talk: 'ui_npc_talk',
  interact: 'ui_interact',
  special_interact: 'ui_special_interact',
  meow_ui: 'ui_meow',
  boss_roar: 'boss_dragon_roar',
  boss_dragon_flame: 'boss_dragon_flame',
  boss_dragon_slam: 'boss_dragon_slam',
  boss_rat_attack: 'boss_rat_attack',
  hero_death: 'combat_hero_death',
} as const;

export function getLegacySfxPath(id: SfxId): string {
  const groupId = LEGACY_SFX_TO_GROUP[id];
  return AUDIO_SFX_GROUPS[groupId].variants[0].path;
}

export function getAllAudioAssetPaths(): string[] {
  const paths: string[] = [];
  for (const group of Object.values(AUDIO_SFX_GROUPS)) {
    for (const variant of group.variants) {
      paths.push(variant.path);
    }
  }
  for (const track of Object.values(AUDIO_MUSIC_TRACKS)) {
    paths.push(track.path);
  }
  for (const track of Object.values(AUDIO_WEATHER_TRACKS)) {
    paths.push(track.path);
  }
  return paths;
}
`;
  fs.writeFileSync(AUDIO_MANIFEST_PATH, content, 'utf8');
}

function writeVfxManifest(vfxMeta) {
  const entries = {
    flames: {
      id: 'flames',
      category: 'flames',
      path: `assets/vfx/${vfxMeta.flames.file}`,
      kind: 'flipbook',
      cols: vfxMeta.flames.cols,
      rows: vfxMeta.flames.rows,
      frames: vfxMeta.flames.frames,
      fps: 24,
      durationSec: Number((vfxMeta.flames.frames / 24).toFixed(3)),
      width: vfxMeta.flames.width,
      height: vfxMeta.flames.height,
      blending: 'additive',
    },
    fireball: {
      id: 'fireball',
      category: 'flames',
      path: `assets/vfx/${vfxMeta.fireball.file}`,
      kind: 'flipbook',
      cols: vfxMeta.fireball.cols,
      rows: vfxMeta.fireball.rows,
      frames: vfxMeta.fireball.frames,
      fps: 28,
      durationSec: Number((vfxMeta.fireball.frames / 28).toFixed(3)),
      width: vfxMeta.fireball.width,
      height: vfxMeta.fireball.height,
      blending: 'additive',
    },
    smoke: {
      id: 'smoke',
      category: 'smoke',
      path: `assets/vfx/${vfxMeta.smoke.file}`,
      kind: 'flipbook',
      cols: vfxMeta.smoke.cols,
      rows: vfxMeta.smoke.rows,
      frames: vfxMeta.smoke.frames,
      fps: 24,
      durationSec: Number((vfxMeta.smoke.frames / 24).toFixed(3)),
      width: vfxMeta.smoke.width,
      height: vfxMeta.smoke.height,
      blending: 'normal',
    },
    steam_puff: {
      id: 'steam_puff',
      category: 'smoke',
      path: `assets/vfx/${vfxMeta.steam_puff.file}`,
      kind: 'flipbook',
      cols: vfxMeta.steam_puff.cols,
      rows: vfxMeta.steam_puff.rows,
      frames: vfxMeta.steam_puff.frames,
      fps: 24,
      durationSec: Number((vfxMeta.steam_puff.frames / 24).toFixed(3)),
      width: vfxMeta.steam_puff.width,
      height: vfxMeta.steam_puff.height,
      blending: 'normal',
    },
    sparks: {
      id: 'sparks',
      category: 'sparks',
      path: `assets/vfx/${vfxMeta.sparks.file}`,
      kind: 'flipbook',
      cols: vfxMeta.sparks.cols,
      rows: vfxMeta.sparks.rows,
      frames: vfxMeta.sparks.frames,
      fps: 30,
      durationSec: Number((vfxMeta.sparks.frames / 30).toFixed(3)),
      width: vfxMeta.sparks.width,
      height: vfxMeta.sparks.height,
      blending: 'additive',
    },
    spark_ember: {
      id: 'spark_ember',
      category: 'sparks',
      path: `assets/vfx/${vfxMeta.spark_ember.file}`,
      kind: 'texture',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.spark_ember.width,
      height: vfxMeta.spark_ember.height,
      blending: 'additive',
    },
    ice_shards: {
      id: 'ice_shards',
      category: 'ice_shards',
      path: `assets/vfx/${vfxMeta.ice_shards.file}`,
      kind: 'flipbook',
      cols: vfxMeta.ice_shards.cols,
      rows: vfxMeta.ice_shards.rows,
      frames: vfxMeta.ice_shards.frames,
      fps: 28,
      durationSec: Number((vfxMeta.ice_shards.frames / 28).toFixed(3)),
      width: vfxMeta.ice_shards.width,
      height: vfxMeta.ice_shards.height,
      blending: 'additive',
    },
    ice_crystal: {
      id: 'ice_crystal',
      category: 'ice_shards',
      path: `assets/vfx/${vfxMeta.ice_crystal.file}`,
      kind: 'texture',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.ice_crystal.width,
      height: vfxMeta.ice_crystal.height,
      blending: 'normal',
    },
    slime_splatter: {
      id: 'slime_splatter',
      category: 'slime_splatter',
      path: `assets/vfx/${vfxMeta.slime_splatter.file}`,
      kind: 'flipbook',
      cols: vfxMeta.slime_splatter.cols,
      rows: vfxMeta.slime_splatter.rows,
      frames: vfxMeta.slime_splatter.frames,
      fps: 24,
      durationSec: Number((vfxMeta.slime_splatter.frames / 24).toFixed(3)),
      width: vfxMeta.slime_splatter.width,
      height: vfxMeta.slime_splatter.height,
      blending: 'normal',
    },
    slime_decal: {
      id: 'slime_decal',
      category: 'slime_splatter',
      path: `assets/vfx/${vfxMeta.slime_decal.file}`,
      kind: 'decal',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.slime_decal.width,
      height: vfxMeta.slime_decal.height,
      blending: 'normal',
    },
    electric_arc: {
      id: 'electric_arc',
      category: 'electric_arc',
      path: `assets/vfx/${vfxMeta.electric_arc.file}`,
      kind: 'flipbook',
      cols: vfxMeta.electric_arc.cols,
      rows: vfxMeta.electric_arc.rows,
      frames: vfxMeta.electric_arc.frames,
      fps: 20,
      durationSec: Number((vfxMeta.electric_arc.frames / 20).toFixed(3)),
      width: vfxMeta.electric_arc.width,
      height: vfxMeta.electric_arc.height,
      blending: 'additive',
    },
    electric_burst: {
      id: 'electric_burst',
      category: 'electric_arc',
      path: `assets/vfx/${vfxMeta.electric_burst.file}`,
      kind: 'flipbook',
      cols: vfxMeta.electric_burst.cols,
      rows: vfxMeta.electric_burst.rows,
      frames: vfxMeta.electric_burst.frames,
      fps: 30,
      durationSec: Number((vfxMeta.electric_burst.frames / 30).toFixed(3)),
      width: vfxMeta.electric_burst.width,
      height: vfxMeta.electric_burst.height,
      blending: 'additive',
    },
    spectral_cloud: {
      id: 'spectral_cloud',
      category: 'spectral_cloud',
      path: `assets/vfx/${vfxMeta.spectral_cloud.file}`,
      kind: 'flipbook',
      cols: vfxMeta.spectral_cloud.cols,
      rows: vfxMeta.spectral_cloud.rows,
      frames: vfxMeta.spectral_cloud.frames,
      fps: 24,
      durationSec: Number((vfxMeta.spectral_cloud.frames / 24).toFixed(3)),
      width: vfxMeta.spectral_cloud.width,
      height: vfxMeta.spectral_cloud.height,
      blending: 'normal',
    },
    abyssal_vortex: {
      id: 'abyssal_vortex',
      category: 'spectral_cloud',
      path: `assets/vfx/${vfxMeta.abyssal_vortex.file}`,
      kind: 'flipbook',
      cols: vfxMeta.abyssal_vortex.cols,
      rows: vfxMeta.abyssal_vortex.rows,
      frames: vfxMeta.abyssal_vortex.frames,
      fps: 24,
      durationSec: Number((vfxMeta.abyssal_vortex.frames / 24).toFixed(3)),
      width: vfxMeta.abyssal_vortex.width,
      height: vfxMeta.abyssal_vortex.height,
      blending: 'additive',
    },
    heat_distortion_normal: {
      id: 'heat_distortion_normal',
      category: 'heat_distortion_normal',
      path: `assets/vfx/${vfxMeta.heat_distortion_normal.file}`,
      kind: 'normalMap',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.heat_distortion_normal.width,
      height: vfxMeta.heat_distortion_normal.height,
      blending: 'normal',
      dataMap: true,
    },
    melee_slash_trail: {
      id: 'melee_slash_trail',
      category: 'melee_slash_trail',
      path: `assets/vfx/${vfxMeta.melee_slash_trail.file}`,
      kind: 'texture',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.melee_slash_trail.width,
      height: vfxMeta.melee_slash_trail.height,
      blending: 'additive',
    },
    projectile_trail: {
      id: 'projectile_trail',
      category: 'melee_slash_trail',
      path: `assets/vfx/${vfxMeta.projectile_trail.file}`,
      kind: 'texture',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.projectile_trail.width,
      height: vfxMeta.projectile_trail.height,
      blending: 'additive',
    },
    crater_fissure_decal: {
      id: 'crater_fissure_decal',
      category: 'crater_fissure_decal',
      path: `assets/vfx/${vfxMeta.crater_fissure_decal.file}`,
      kind: 'decal',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.crater_fissure_decal.width,
      height: vfxMeta.crater_fissure_decal.height,
      blending: 'normal',
    },
    scorch_decal: {
      id: 'scorch_decal',
      category: 'crater_fissure_decal',
      path: `assets/vfx/${vfxMeta.scorch_decal.file}`,
      kind: 'decal',
      cols: 1,
      rows: 1,
      frames: 1,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.scorch_decal.width,
      height: vfxMeta.scorch_decal.height,
      blending: 'normal',
    },
    debris_fragments: {
      id: 'debris_fragments',
      category: 'debris_fragments',
      path: `assets/vfx/${vfxMeta.debris_fragments.file}`,
      kind: 'texture',
      cols: 2,
      rows: 2,
      frames: 4,
      fps: 0,
      durationSec: 0,
      width: vfxMeta.debris_fragments.width,
      height: vfxMeta.debris_fragments.height,
      blending: 'normal',
    },
  };

  const ids = Object.keys(entries).map((k) => `  | '${k}'`).join('\n');
  const content = `// Generated & verified by scripts/fetch_studio_assets.mjs via Pillow/NumPy
// ZERO 'three' imports and ZERO DOM references — 100% Node/Vitest safe.

export type VfxCategory =
  | 'flames'
  | 'smoke'
  | 'sparks'
  | 'ice_shards'
  | 'slime_splatter'
  | 'electric_arc'
  | 'spectral_cloud'
  | 'heat_distortion_normal'
  | 'melee_slash_trail'
  | 'crater_fissure_decal'
  | 'debris_fragments';

export const VFX_CATEGORIES: readonly VfxCategory[] = [
  'flames',
  'smoke',
  'sparks',
  'ice_shards',
  'slime_splatter',
  'electric_arc',
  'spectral_cloud',
  'heat_distortion_normal',
  'melee_slash_trail',
  'crater_fissure_decal',
  'debris_fragments',
] as const;

export type VfxAssetKind = 'flipbook' | 'texture' | 'normalMap' | 'decal';

export type VfxAssetId =
${ids};

export interface VfxAssetEntry {
  readonly id: VfxAssetId;
  readonly category: VfxCategory;
  readonly path: string;
  readonly kind: VfxAssetKind;
  readonly cols: number;
  readonly rows: number;
  readonly frames: number;
  readonly fps: number;
  readonly durationSec: number;
  readonly width: number;
  readonly height: number;
  readonly blending: 'additive' | 'normal';
  readonly dataMap?: boolean;
}

export const VFX_ASSETS: Readonly<Record<VfxAssetId, VfxAssetEntry>> = ${JSON.stringify(entries, null, 2)} as const;

export function getVfxAsset(id: VfxAssetId): VfxAssetEntry {
  return VFX_ASSETS[id];
}

export function getVfxAssetsByCategory(category: VfxCategory): VfxAssetEntry[] {
  return Object.values(VFX_ASSETS).filter((entry) => entry.category === category);
}

export function getAllVfxAssetPaths(): string[] {
  return Object.values(VFX_ASSETS).map((entry) => entry.path);
}
`;
  fs.writeFileSync(VFX_MANIFEST_PATH, content, 'utf8');
}

function writeRootCredits(audioRows, vfxMeta) {
  const vfxCreditMap = [
    {
      path: `assets/vfx/${vfxMeta.flames.file}`,
      title: '25 Special Effects Rendered With Blender (flame/fire)',
      author: 'OpenGameArt CC0 Contributor',
      url: 'https://opengameart.org/content/25-special-effects-rendered-with-blender',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.fireball.file}`,
      title: '25 Special Effects Rendered With Blender (explosion/fire)',
      author: 'OpenGameArt CC0 Contributor',
      url: 'https://opengameart.org/content/25-special-effects-rendered-with-blender',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.smoke.file}`,
      title: 'Animated Particle Effects #1 (particlefx_02.png)',
      author: 'Para',
      url: 'https://opengameart.org/content/animated-particle-effects-1',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.steam_puff.file}`,
      title: 'Smoke Particles (whitePuff00..24)',
      author: 'Kenney',
      url: 'https://kenney.nl/assets/smoke-particles',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.sparks.file}`,
      title: 'Animated Particle Effects #1 (particlefx_01.png)',
      author: 'Para',
      url: 'https://opengameart.org/content/animated-particle-effects-1',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.spark_ember.file}`,
      title: 'Particle Pack (spark_04.png)',
      author: 'Kenney',
      url: 'https://kenney.nl/assets/particle-pack',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.ice_shards.file}`,
      title: 'Animated Particle Effects #1 (particlefx_07.png)',
      author: 'Para',
      url: 'https://opengameart.org/content/animated-particle-effects-1',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.ice_crystal.file}`,
      title: 'Ice003 (1K PNG Color)',
      author: 'AmbientCG (Lennart Demes)',
      url: 'https://ambientcg.com/view?id=Ice003',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.slime_splatter.file}`,
      title: 'Animated Particle Effects #2 (blood_hit_01.png)',
      author: 'Para',
      url: 'https://opengameart.org/content/animated-particle-effects-2',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.slime_decal.file}`,
      title: 'Splat Pack (splat01.png mask) + Lava004 Displacement + Ice003 NormalGL/Roughness',
      author: 'Kenney & AmbientCG (Lennart Demes)',
      url: 'https://kenney.nl/assets/splat-pack ; https://ambientcg.com/view?id=Lava004 ; https://ambientcg.com/view?id=Ice003',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.electric_arc.file}`,
      title: 'Lightning (lightning_b.png)',
      author: 'OpenGameArt CC0 Contributor',
      url: 'https://opengameart.org/content/lightning',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.electric_burst.file}`,
      title: 'Animated Particle Effects #1 (particlefx_08.png)',
      author: 'Para',
      url: 'https://opengameart.org/content/animated-particle-effects-1',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.spectral_cloud.file}`,
      title: 'Animated Particle Effects #1 (particlefx_12.png)',
      author: 'Para',
      url: 'https://opengameart.org/content/animated-particle-effects-1',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.abyssal_vortex.file}`,
      title: '25 Special Effects Rendered With Blender (ring/magic)',
      author: 'OpenGameArt CC0 Contributor',
      url: 'https://opengameart.org/content/25-special-effects-rendered-with-blender',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.heat_distortion_normal.file}`,
      title: 'Ice003 (1K PNG NormalGL)',
      author: 'AmbientCG (Lennart Demes)',
      url: 'https://ambientcg.com/view?id=Ice003',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.melee_slash_trail.file}`,
      title: 'Particle Pack (slash_01.png)',
      author: 'Kenney',
      url: 'https://kenney.nl/assets/particle-pack',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.projectile_trail.file}`,
      title: 'Particle Pack (trace_01.png)',
      author: 'Kenney',
      url: 'https://kenney.nl/assets/particle-pack',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.crater_fissure_decal.file}`,
      title: 'Mud Cracked Dry 03 + Lava004 Emission',
      author: 'Poly Haven & AmbientCG (Lennart Demes)',
      url: 'https://polyhaven.com/a/mud_cracked_dry_03 ; https://ambientcg.com/view?id=Lava004',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.scorch_decal.file}`,
      title: 'Burned Ground 01',
      author: 'Poly Haven',
      url: 'https://polyhaven.com/a/burned_ground_01',
      license: 'CC0 1.0',
    },
    {
      path: `assets/vfx/${vfxMeta.debris_fragments.file}`,
      title: 'LeafSet010 + Daffodil Vegetation + Aerial Rocks 04 + Travertine001 (2x2 Debris Atlas)',
      author: 'AmbientCG / paramecij / Poly Haven',
      url: 'https://ambientcg.com/view?id=LeafSet010 ; https://opengameart.org/content/paramecijs-vegetation-base-texture-pack ; https://polyhaven.com/a/aerial_rocks_04 ; https://ambientcg.com/view?id=Travertine001',
      license: 'CC0 1.0',
    },
  ];

  const lines = [
    '# CREDITS — Cat Quest 3 : Les Chroniques de Félingard (Studio Assets)',
    '',
    'All audio and VFX assets under `public/assets/audio/` and `public/assets/vfx/` are strictly **CC0 1.0 Universal (Public Domain Dedication)** or **Public Domain**, fetched and processed reproducibly via `scripts/fetch_studio_assets.mjs`.',
    '',
    '## Audio Assets (`public/assets/audio/`)',
    '',
    '| Local Path | Duration (s) | Source Title | Author | Source URL | License |',
    '|---|---:|---|---|---|---|',
    ...audioRows.map(
      (r) =>
        `| \`${r.relPath}\` | ${r.durationSec.toFixed(3)} | ${r.sourceTitle} | ${r.sourceAuthor} | ${r.sourceUrl} | ${r.license} |`,
    ),
    '',
    '## VFX Textures & Flipbooks (`public/assets/vfx/`)',
    '',
    '| Local Path | Source Title | Author | Source URL | License |',
    '|---|---|---|---|---|',
    ...vfxCreditMap.map(
      (v) => `| \`${v.path}\` | ${v.title} | ${v.author} | ${v.url} | ${v.license} |`,
    ),
    '',
  ];

  fs.writeFileSync(CREDITS_PATH, lines.join('\n'), 'utf8');
}

// ============================================================================
// Main Pipeline
// ============================================================================
async function main() {
  if (CLEAN_CACHE && fs.existsSync(CACHE_DIR)) {
    console.log(`[clean] Removing cache ${CACHE_DIR}`);
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  }
  ensureDir(DOWNLOADS_DIR);
  ensureDir(EXTRACTED_DIR);
  ensureDir(WORK_DIR);

  const resolvedPacks = fetchAllPacks();

  // Wipe public/assets/audio/ and public/assets/vfx/ completely
  if (fs.existsSync(PUBLIC_AUDIO_DIR)) {
    fs.rmSync(PUBLIC_AUDIO_DIR, { recursive: true, force: true });
  }
  if (fs.existsSync(PUBLIC_VFX_DIR)) {
    fs.rmSync(PUBLIC_VFX_DIR, { recursive: true, force: true });
  }
  ensureDir(PUBLIC_AUDIO_DIR);
  ensureDir(PUBLIC_VFX_DIR);

  const audioCreditRows = [];

  // Process SFX (9 subdirectories)
  const sfxResults = [];
  for (const group of SFX_GROUP_SPECS) {
    const processedVariants = [];
    for (let i = 0; i < group.variants.length; i += 1) {
      const v = group.variants[i];
      const relPath = `assets/audio/sfx/${group.category}/${group.id}_v${i + 1}.ogg`;
      const sources = v.concat ? v.concat : [{ pack: v.pack, entry: v.entry }];
      const res = processAudioAsset(resolvedPacks, {
        relPath,
        sources,
        loop: group.loop,
        channels: group.channels ?? 1,
        maxDur: group.maxDur,
        ss: group.ss,
        rawSliceDur: group.rawSliceDur,
        fadeOutSec: group.fadeOutSec ?? (group.loop ? 0.025 : 0.06),
        targetLufs: group.targetLufs ?? -16,
      });
      processedVariants.push(res);
      audioCreditRows.push(res);
    }
    sfxResults.push({ ...group, variants: processedVariants });
  }

  // Process Music (8 tracks)
  const musicResults = [];
  for (const m of MUSIC_SPECS) {
    const relPath = `assets/audio/music/${m.id}.ogg`;
    const res = processAudioAsset(resolvedPacks, {
      relPath,
      sources: [{ pack: m.pack, entry: m.entry }],
      loop: m.loop,
      channels: 2,
      maxDur: m.maxDur,
      fadeOutSec: m.loop ? 0.03 : 0.5,
      targetLufs: -16,
      trimEnd: !m.loop,
    });
    musicResults.push({ ...m, ...res });
    audioCreditRows.push(res);
  }

  // Process Weather (5 tracks)
  const weatherResults = [];
  for (const w of WEATHER_SPECS) {
    const relPath = `assets/audio/weather/${w.id}.ogg`;
    const res = processAudioAsset(resolvedPacks, {
      relPath,
      sources: w.sources,
      loop: w.loop,
      channels: 2,
      ss: w.ss,
      rawSliceDur: w.rawSliceDur,
      maxDur: w.maxDur,
      fadeOutSec: w.fadeOutSec ?? 0.03,
      targetLufs: w.targetLufs ?? -18,
      trimEnd: !w.loop,
    });
    weatherResults.push({ ...w, ...res });
    audioCreditRows.push(res);
  }

  // Process VFX (11 categories)
  console.log('[vfx] Packing realistic CC0 VFX textures & flipbooks...');
  const vfxMeta = processAllVfx(resolvedPacks);

  // Generate manifests & root CREDITS.md
  writeAudioManifest(sfxResults, musicResults, weatherResults);
  writeVfxManifest(vfxMeta);
  writeRootCredits(audioCreditRows, vfxMeta);

  console.log(
    `[done] Generated ${audioCreditRows.length} CC0 audio files, ${Object.keys(vfxMeta).length} CC0 VFX assets, manifests, and CREDITS.md.`,
  );
}

main().catch((err) => {
  console.error('[error]', err);
  process.exit(1);
});
