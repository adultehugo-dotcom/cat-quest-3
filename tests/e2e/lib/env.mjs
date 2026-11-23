import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export class FatalEnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FatalEnvError';
    this.exitCode = 2;
  }
}

function isPlaywrightDir(dirPath) {
  if (!dirPath) return false;
  try {
    const pkgPath = path.join(dirPath, 'package.json');
    return fs.existsSync(pkgPath);
  } catch {
    return false;
  }
}

function tryLoadFromPath(candidate) {
  try {
    const resolved = require.resolve(candidate);
    return { mod: require(resolved), resolved };
  } catch {
    return null;
  }
}

/**
 * Multi-tier discovery for `playwright-core` (or `playwright`) without requiring it in package.json.
 */
export function resolvePlaywrightCore() {
  // Tier 1: Explicit env override
  const envPath = process.env.PLAYWRIGHT_CORE_PATH;
  if (envPath) {
    if (!fs.existsSync(envPath)) {
      throw new FatalEnvError(
        `PLAYWRIGHT_CORE_PATH="${envPath}" does not exist. Unset it or point to a valid playwright-core directory/file.`,
      );
    }
    const loaded = tryLoadFromPath(envPath);
    if (loaded) {
      return { playwright: loaded.mod, sourcePath: loaded.resolved, tier: 'env:PLAYWRIGHT_CORE_PATH' };
    }
    throw new FatalEnvError(`Failed to load playwright-core from PLAYWRIGHT_CORE_PATH="${envPath}".`);
  }

  // Tier 2: Standard Node resolution
  for (const pkgName of ['playwright-core', 'playwright']) {
    const loaded = tryLoadFromPath(pkgName);
    if (loaded) {
      return { playwright: loaded.mod, sourcePath: loaded.resolved, tier: `node_resolve:${pkgName}` };
    }
  }

  // Tier 3: Global node_modules locations
  const globalCandidates = [];
  if (process.env.APPDATA) {
    globalCandidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', 'playwright-core'));
  }
  if (process.env.LOCALAPPDATA) {
    globalCandidates.push(path.join(process.env.LOCALAPPDATA, 'hermes', 'node', 'node_modules', 'playwright-core'));
  }
  try {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const npmRoot = execFileSync(npmCmd, ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    if (npmRoot) {
      globalCandidates.push(path.join(npmRoot, 'playwright-core'));
    }
  } catch {
    // Ignore if npm root -g is unavailable
  }

  for (const dir of globalCandidates) {
    if (isPlaywrightDir(dir)) {
      const loaded = tryLoadFromPath(dir);
      if (loaded) {
        return { playwright: loaded.mod, sourcePath: loaded.resolved, tier: 'global_node_modules' };
      }
    }
  }

  // Tier 4: npx cache (%LOCALAPPDATA%\npm-cache\_npx\*\node_modules\playwright-core)
  const cacheRoots = [];
  if (process.env.npm_config_cache) {
    cacheRoots.push(path.join(process.env.npm_config_cache, '_npx'));
  }
  if (process.env.LOCALAPPDATA) {
    cacheRoots.push(path.join(process.env.LOCALAPPDATA, 'npm-cache', '_npx'));
  }
  cacheRoots.push(path.join(os.homedir(), '.npm', '_npx'));

  const npxMatches = [];
  for (const npxRoot of cacheRoots) {
    if (!fs.existsSync(npxRoot)) continue;
    try {
      for (const entry of fs.readdirSync(npxRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pwDir = path.join(npxRoot, entry.name, 'node_modules', 'playwright-core');
        if (isPlaywrightDir(pwDir)) {
          const stat = fs.statSync(path.join(pwDir, 'package.json'));
          npxMatches.push({ dir: pwDir, mtimeMs: stat.mtimeMs });
        }
      }
    } catch {
      // Ignore unreadable cache dirs
    }
  }

  npxMatches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const match of npxMatches) {
    const loaded = tryLoadFromPath(match.dir);
    if (loaded) {
      return { playwright: loaded.mod, sourcePath: loaded.resolved, tier: 'npx_cache' };
    }
  }

  // Tier 5: Actionable fatal error
  throw new FatalEnvError(
    [
      'Could not locate "playwright-core". Checked PLAYWRIGHT_CORE_PATH, Node module resolution, global node_modules, and npm _npx cache.',
      'To fix on Windows/POSIX without modifying package.json:',
      '  1. Set PLAYWRIGHT_CORE_PATH to an existing playwright-core directory, OR',
      '  2. Run `npx --yes playwright-core --version` once to populate the npx cache, OR',
      '  3. Install globally: `npm install -g playwright-core`.',
    ].join('\n'),
  );
}

function findMsPlaywrightExecutables() {
  const roots = [];
  if (process.env.PLAYWRIGHT_BROWSERS_PATH && process.env.PLAYWRIGHT_BROWSERS_PATH !== '0') {
    roots.push(process.env.PLAYWRIGHT_BROWSERS_PATH);
  }
  if (process.env.LOCALAPPDATA) {
    roots.push(path.join(process.env.LOCALAPPDATA, 'ms-playwright'));
  }
  roots.push(path.join(os.homedir(), '.cache', 'ms-playwright'));

  const fullRevisions = [];
  const shellRevisions = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const matchFull = /^chromium-(\d+)$/.exec(entry.name);
      if (matchFull) {
        const rev = Number(matchFull[1]);
        const candidates =
          process.platform === 'win32'
            ? [path.join(root, entry.name, 'chrome-win64', 'chrome.exe'), path.join(root, entry.name, 'chrome-win', 'chrome.exe')]
            : [path.join(root, entry.name, 'chrome-linux64', 'chrome'), path.join(root, entry.name, 'chrome-linux', 'chrome')];
        for (const exe of candidates) {
          if (fs.existsSync(exe)) fullRevisions.push({ rev, exe });
        }
      }
      const matchShell = /^chromium_headless_shell-(\d+)$/.exec(entry.name);
      if (matchShell) {
        const rev = Number(matchShell[1]);
        const candidates =
          process.platform === 'win32'
            ? [path.join(root, entry.name, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')]
            : [path.join(root, entry.name, 'chrome-headless-shell-linux64', 'chrome-headless-shell')];
        for (const exe of candidates) {
          if (fs.existsSync(exe)) shellRevisions.push({ rev, exe });
        }
      }
    }
  }

  fullRevisions.sort((a, b) => b.rev - a.rev);
  shellRevisions.sort((a, b) => b.rev - a.rev);
  return [...fullRevisions.map((x) => x.exe), ...shellRevisions.map((x) => x.exe)];
}

/**
 * Multi-tier discovery for Chromium / Google Chrome / Microsoft Edge executable.
 */
export function resolveBrowserExecutable(chromium) {
  // Tier 1: CHROME_PATH
  const envChrome = process.env.CHROME_PATH;
  if (envChrome) {
    if (!fs.existsSync(envChrome)) {
      throw new FatalEnvError(`CHROME_PATH="${envChrome}" does not exist.`);
    }
    return { executablePath: envChrome, tier: 'env:CHROME_PATH' };
  }

  // Tier 2: Playwright default executablePath()
  try {
    const pwExe = chromium.executablePath();
    if (pwExe && fs.existsSync(pwExe)) {
      return { executablePath: pwExe, tier: 'playwright_default' };
    }
  } catch {
    // Ignore
  }

  // Tier 3: ms-playwright folder scan (highest revision first)
  const msExes = findMsPlaywrightExecutables();
  if (msExes.length > 0) {
    return { executablePath: msExes[0], tier: 'ms-playwright' };
  }

  // Tier 4 & 5: System Chrome / Edge
  const systemCandidates = [];
  if (process.platform === 'win32') {
    systemCandidates.push(
      { exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', tier: 'system_chrome' },
      { exe: 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', tier: 'system_chrome' },
    );
    if (process.env.LOCALAPPDATA) {
      systemCandidates.push({
        exe: path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        tier: 'system_chrome',
      });
    }
    systemCandidates.push(
      { exe: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', tier: 'system_edge' },
      { exe: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe', tier: 'system_edge' },
    );
  } else {
    systemCandidates.push(
      { exe: '/usr/bin/google-chrome', tier: 'system_chrome' },
      { exe: '/usr/bin/chromium', tier: 'system_chromium' },
      { exe: '/usr/bin/chromium-browser', tier: 'system_chromium' },
    );
  }

  for (const candidate of systemCandidates) {
    if (fs.existsSync(candidate.exe)) {
      return { executablePath: candidate.exe, tier: candidate.tier };
    }
  }

  throw new FatalEnvError(
    'No Chromium/Chrome/Edge browser executable found. Set CHROME_PATH or run `npx playwright-core install chromium`.',
  );
}

/**
 * Build Playwright launch options with deterministic SwiftShader WebGL2 flags by default,
 * or hardware GPU flags when --gpu / E2E_USE_GPU=1 is specified.
 */
export function getLaunchOptions({ gpu = false, executablePath }) {
  const useGpu = Boolean(gpu || process.env.E2E_USE_GPU === '1');
  const args = useGpu
    ? ['--enable-webgl', '--ignore-gpu-blocklist']
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];

  return {
    headless: true,
    executablePath,
    args,
  };
}
