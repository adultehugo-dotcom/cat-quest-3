import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to allocate ephemeral TCP port')));
        return;
      }
      const { port } = addr;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

export function killProcessTree(pid) {
  if (!pid || typeof pid !== 'number') return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 8000,
      });
    } catch {
      // Process may already have exited
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Process may already have exited
    }
  }
}

async function waitForHealth(url, child, getLogs, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let earlyExitCode = null;
  let earlyExitSignal = null;

  const onExit = (code, signal) => {
    earlyExitCode = code;
    earlyExitSignal = signal;
  };
  child.once('exit', onExit);

  try {
    while (Date.now() < deadline) {
      if (earlyExitCode !== null || earlyExitSignal !== null) {
        const err = new Error(
          `Vite exited prematurely (code=${earlyExitCode}, signal=${earlyExitSignal}).\n${getLogs()}`,
        );
        err.earlyExit = true;
        throw err;
      }
      try {
        const res = await fetch(url, { method: 'GET' });
        if (res.ok) {
          return;
        }
      } catch {
        // Not listening yet
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}.\n${getLogs()}`);
  } finally {
    child.removeListener('exit', onExit);
  }
}

/**
 * Starts Vite (`dev` or `preview`) on an ephemeral localhost port with guaranteed Windows tree teardown.
 * If `url` is provided, verifies reachability and returns a no-op controller.
 */
export async function startViteServer({ projectDir, mode = 'dev', url = null }) {
  if (url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Provided --url "${url}" returned HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
    return {
      url,
      port: null,
      pid: null,
      external: true,
      stop: async () => {},
      getLogs: () => '',
    };
  }

  const viteBin = path.join(projectDir, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    const err = new Error(`Vite binary not found at "${viteBin}". Run npm install in "${projectDir}".`);
    err.exitCode = 2;
    throw err;
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const port = await getFreePort('127.0.0.1');
    const serverUrl = `http://127.0.0.1:${port}/`;
    const args =
      mode === 'preview'
        ? [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
        : [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'];

    const logLines = [];
    const pushLogs = (chunk) => {
      const lines = String(chunk).split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        logLines.push(line);
        if (logLines.length > 80) logLines.shift();
      }
    };

    const child = spawn(process.execPath, args, {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    });

    child.stdout?.on('data', pushLogs);
    child.stderr?.on('data', pushLogs);

    let stopped = false;
    const stopSync = () => {
      if (stopped) return;
      stopped = true;
      if (child.pid) {
        killProcessTree(child.pid);
      }
    };

    const onProcessExit = () => stopSync();
    process.on('exit', onProcessExit);

    const unregister = () => {
      process.removeListener('exit', onProcessExit);
    };

    try {
      await waitForHealth(serverUrl, child, () => logLines.join('\n'), 20000);
      return {
        url: serverUrl,
        port,
        pid: child.pid,
        external: false,
        getLogs: () => logLines.join('\n'),
        stop: async () => {
          stopSync();
          unregister();
        },
      };
    } catch (err) {
      lastErr = err;
      stopSync();
      unregister();
      if (!err?.earlyExit || attempt === 3) {
        const fatal = new Error(err?.message || String(err));
        fatal.exitCode = 2;
        throw fatal;
      }
    }
  }

  const fatal = new Error(lastErr?.message || 'Failed to start Vite server');
  fatal.exitCode = 2;
  throw fatal;
}
