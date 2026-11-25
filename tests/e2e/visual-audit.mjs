#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FatalEnvError, getLaunchOptions, resolveBrowserExecutable, resolvePlaywrightCore } from './lib/env.mjs';
import { buildReportSummary, writeAuditReports } from './lib/report.mjs';
import { SCENARIO_IDS, VIEWPORTS, runAllScenarios } from './lib/scenarios.mjs';
import { startViteServer } from './lib/server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_DIR = path.resolve(__dirname, '..', '..');

function printUsage() {
  console.log(`Usage: node tests/e2e/visual-audit.mjs [options]

Options:
  --out <dir>            Output directory for screenshots & reports (default: <tmp>/cat-quest-e2e-<timestamp>)
  --verify               Fail with exit code 1 if any check fails (default)
  --capture-only         Exit 0 if harness ran cleanly and captured all views/reports, even on visual/DOM failures
  --viewport <WxH,...>   Comma-separated subset of viewports (e.g. 1280x720,375x667)
  --scenario <id,...>    Comma-separated scenario IDs (${SCENARIO_IDS.join(',')}) or "all"
  --preview              Start "vite preview" instead of "vite" dev server
  --url <url>            Attach to an already-running server URL
  --gpu                  Use hardware GPU WebGL flags instead of SwiftShader
  -h, --help             Show this help message
`);
}

function parseArgs(argv) {
  const opts = {
    outDir: null,
    mode: 'verify',
    viewportRaw: null,
    scenarioRaw: 'all',
    serverMode: 'dev',
    url: null,
    gpu: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
    } else if (arg === '--verify') {
      opts.mode = 'verify';
    } else if (arg === '--capture-only') {
      opts.mode = 'capture-only';
    } else if (arg === '--preview') {
      opts.serverMode = 'preview';
    } else if (arg === '--gpu') {
      opts.gpu = true;
    } else if (arg === '--out') {
      const val = argv[++i];
      if (!val) throw new FatalEnvError('Missing value for --out');
      opts.outDir = path.resolve(val);
    } else if (arg.startsWith('--out=')) {
      opts.outDir = path.resolve(arg.slice('--out='.length));
    } else if (arg === '--viewport') {
      const val = argv[++i];
      if (!val) throw new FatalEnvError('Missing value for --viewport');
      opts.viewportRaw = val;
    } else if (arg.startsWith('--viewport=')) {
      opts.viewportRaw = arg.slice('--viewport='.length);
    } else if (arg === '--scenario') {
      const val = argv[++i];
      if (!val) throw new FatalEnvError('Missing value for --scenario');
      opts.scenarioRaw = val;
    } else if (arg.startsWith('--scenario=')) {
      opts.scenarioRaw = arg.slice('--scenario='.length);
    } else if (arg === '--url') {
      const val = argv[++i];
      if (!val) throw new FatalEnvError('Missing value for --url');
      opts.url = val;
    } else if (arg.startsWith('--url=')) {
      opts.url = arg.slice('--url='.length);
    } else {
      throw new FatalEnvError(`Unknown argument: ${arg}`);
    }
  }

  if (!opts.outDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    opts.outDir = path.join(os.tmpdir(), `cat-quest-e2e-${stamp}`);
  }

  let activeViewports = VIEWPORTS;
  if (opts.viewportRaw) {
    const parts = opts.viewportRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) throw new FatalEnvError('Empty --viewport list');
    activeViewports = parts.map((p) => {
      const m = /^(\d+)x(\d+)$/i.exec(p);
      if (!m) throw new FatalEnvError(`Invalid viewport "${p}". Expected WxH (e.g. 1280x720).`);
      const width = Number(m[1]);
      const height = Number(m[2]);
      if (width < 200 || height < 200) {
        throw new FatalEnvError(`Viewport "${p}" is too small (minimum 200x200).`);
      }
      return { name: `${width}x${height}`, width, height };
    });
  }

  let scenarioIds = SCENARIO_IDS;
  if (opts.scenarioRaw && opts.scenarioRaw !== 'all') {
    const parts = opts.scenarioRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) throw new FatalEnvError('Empty --scenario list');
    for (const id of parts) {
      if (!SCENARIO_IDS.includes(id)) {
        throw new FatalEnvError(`Unknown scenario "${id}". Valid scenarios: ${SCENARIO_IDS.join(', ')}, all`);
      }
    }
    scenarioIds = parts;
  }

  return { ...opts, activeViewports, scenarioIds };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printUsage();
    process.exit(0);
  }

  const { playwright, sourcePath, tier: pwTier } = resolvePlaywrightCore();
  const { chromium } = playwright;
  const { executablePath, tier: browserTier } = resolveBrowserExecutable(chromium);
  const launchOptions = getLaunchOptions({ gpu: opts.gpu, executablePath });

  console.log(`[e2e] playwright-core: ${sourcePath} (${pwTier})`);
  console.log(`[e2e] browser: ${executablePath} (${browserTier})`);
  console.log(`[e2e] output dir: ${opts.outDir}`);

  let server = null;
  let browser = null;
  let cleaning = false;

  const cleanup = async () => {
    if (cleaning) return;
    cleaning = true;
    if (browser) {
      await browser.close().catch(() => {});
      browser = null;
    }
    if (server) {
      await server.stop().catch(() => {});
      server = null;
    }
  };

  const onSignal = (sig) => {
    console.error(`[e2e] Received ${sig}, cleaning up...`);
    cleanup().finally(() => process.exit(2));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    server = await startViteServer({
      projectDir: PROJECT_DIR,
      mode: opts.serverMode,
      url: opts.url,
    });
    console.log(`[e2e] server ready: ${server.url} (external=${server.external})`);

    browser = await chromium.launch(launchOptions);

    const { results, sessionErrors } = await runAllScenarios({
      browser,
      url: server.url,
      outDir: opts.outDir,
      activeViewports: opts.activeViewports,
      scenarioIds: opts.scenarioIds,
    });

    const report = buildReportSummary({
      meta: {
        generatedAt: new Date().toISOString(),
        mode: opts.mode,
        gpu: opts.gpu,
        serverMode: opts.url ? 'external' : opts.serverMode,
        url: server.url,
        viewports: opts.activeViewports.map((v) => v.name),
        scenarios: opts.scenarioIds,
        playwrightTier: pwTier,
        browserTier,
      },
      results,
      sessionErrors,
    });

    const { jsonPath, mdPath } = writeAuditReports(opts.outDir, report);
    console.log(`[e2e] Audit report written: ${jsonPath}`);
    console.log(`[e2e] Audit summary written: ${mdPath}`);
    console.log(
      `[e2e] Summary: ${report.summary.passedChecks}/${report.summary.totalChecks} checks passed, ${report.summary.totalIssues} total issues, ${report.summary.sessionErrorCount} session errors`,
    );

    if (opts.mode === 'verify' && !report.summary.overallPassed) {
      process.exitCode = 1;
    } else {
      process.exitCode = 0;
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await cleanup();
  }
}

main().catch((err) => {
  console.error(`[e2e] FATAL: ${err?.stack || err}`);
  process.exit(err?.exitCode === 2 ? 2 : 2);
});
