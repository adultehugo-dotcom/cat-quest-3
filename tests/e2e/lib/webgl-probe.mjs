import zlib from 'node:zlib';

const WEBGL_MSG_RE = /Shader Error|WebGL:|GL_INVALID|INVALID_OPERATION|INVALID_VALUE|THREE\.WebGL/i;

/**
 * Installs init-time WebGL shader/program compilation & linking diagnostic hooks.
 * Does NOT call gl.getError() inside hooks so Three.js error state is never mutated.
 */
export async function installWebglInitHooks(page) {
  await page.addInitScript(() => {
    const diag = {
      shaderErrors: [],
      programErrors: [],
    };
    window.__E2E_WEBGL_DIAG__ = diag;

    const patchContextProto = (proto, apiName) => {
      if (!proto || proto.__e2ePatched) return;
      proto.__e2ePatched = true;

      const origCompile = proto.compileShader;
      const origLink = proto.linkProgram;

      if (typeof origCompile === 'function') {
        proto.compileShader = function patchedCompileShader(shader) {
          origCompile.call(this, shader);
          try {
            const ok = this.getShaderParameter(shader, this.COMPILE_STATUS);
            const infoLog = (this.getShaderInfoLog(shader) || '').trim();
            if (!ok || infoLog.length > 0) {
              const shaderType = this.getShaderParameter(shader, this.SHADER_TYPE);
              diag.shaderErrors.push({
                api: apiName,
                ok: Boolean(ok),
                shaderType: shaderType === this.VERTEX_SHADER ? 'VERTEX_SHADER' : 'FRAGMENT_SHADER',
                infoLog,
              });
            }
          } catch {
            // Ignore context-loss inspection errors
          }
        };
      }

      if (typeof origLink === 'function') {
        proto.linkProgram = function patchedLinkProgram(program) {
          origLink.call(this, program);
          try {
            const ok = this.getProgramParameter(program, this.LINK_STATUS);
            const infoLog = (this.getProgramInfoLog(program) || '').trim();
            if (!ok || infoLog.length > 0) {
              diag.programErrors.push({
                api: apiName,
                ok: Boolean(ok),
                infoLog,
              });
            }
          } catch {
            // Ignore context-loss inspection errors
          }
        };
      }
    };

    if (typeof WebGL2RenderingContext !== 'undefined') {
      patchContextProto(WebGL2RenderingContext.prototype, 'webgl2');
    }
    if (typeof WebGLRenderingContext !== 'undefined') {
      patchContextProto(WebGLRenderingContext.prototype, 'webgl');
    }
  });
}

/**
 * Attaches Playwright console/pageerror/network listeners and tracks cumulative + delta counts.
 */
export function attachPageListeners(page) {
  const store = {
    consoleErrors: [],
    consoleWarnings: [],
    webglWarningsOrErrors: [],
    pageErrors: [],
    requestFailed: [],
    httpErrors: [],
  };

  let cursor = {
    consoleErrors: 0,
    consoleWarnings: 0,
    webglWarningsOrErrors: 0,
    pageErrors: 0,
    requestFailed: 0,
    httpErrors: 0,
  };

  page.on('console', (msg) => {
    const type = msg.type();
    const text = msg.text();
    if (WEBGL_MSG_RE.test(text)) {
      store.webglWarningsOrErrors.push({ type, text });
    }
    if (type === 'error') {
      store.consoleErrors.push(text);
    } else if (type === 'warning') {
      store.consoleWarnings.push(text);
    }
  });

  page.on('pageerror', (err) => {
    store.pageErrors.push(String(err?.stack || err));
  });

  page.on('requestfailed', (req) => {
    store.requestFailed.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      errorText: req.failure()?.errorText || 'requestfailed',
    });
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      store.httpErrors.push({
        url: res.url(),
        status: res.status(),
        statusText: res.statusText(),
      });
    }
  });

  return {
    getAll() {
      return {
        consoleErrors: [...store.consoleErrors],
        consoleWarnings: [...store.consoleWarnings],
        webglWarningsOrErrors: [...store.webglWarningsOrErrors],
        pageErrors: [...store.pageErrors],
        requestFailed: [...store.requestFailed],
        httpErrors: [...store.httpErrors],
      };
    },
    consumeDelta() {
      const delta = {
        consoleErrors: store.consoleErrors.slice(cursor.consoleErrors),
        consoleWarnings: store.consoleWarnings.slice(cursor.consoleWarnings),
        webglWarningsOrErrors: store.webglWarningsOrErrors.slice(cursor.webglWarningsOrErrors),
        pageErrors: store.pageErrors.slice(cursor.pageErrors),
        requestFailed: store.requestFailed.slice(cursor.requestFailed),
        httpErrors: store.httpErrors.slice(cursor.httpErrors),
      };
      cursor = {
        consoleErrors: store.consoleErrors.length,
        consoleWarnings: store.consoleWarnings.length,
        webglWarningsOrErrors: store.webglWarningsOrErrors.length,
        pageErrors: store.pageErrors.length,
        requestFailed: store.requestFailed.length,
        httpErrors: store.httpErrors.length,
      };
      return delta;
    },
  };
}

/**
 * Waits until HD assets are loaded and at least 2 Three.js frames have rendered.
 */
export async function waitForGameReady(page, timeout = 20000) {
  await page.waitForFunction(
    () => {
      const m = window.__CAT_QUEST__?.getMetrics?.();
      return Boolean(m && m.hdAssetsLoaded === true && m.frameCount >= 2);
    },
    null,
    { timeout },
  );
}

/**
 * Queries live WebGL error state, shader/program compilation errors, canvas dimensions, and QA metrics.
 */
export async function inspectWebglRuntime(page) {
  return page.evaluate(() => {
    const metrics = window.__CAT_QUEST__?.getMetrics?.() ?? null;
    const diag = window.__E2E_WEBGL_DIAG__ ?? { shaderErrors: [], programErrors: [] };
    const canvas = document.querySelector('#game-canvas-container canvas');
    if (!canvas) {
      return {
        hasCanvas: false,
        metrics,
        diag,
        glError: null,
        contextLost: null,
        renderer: null,
        canvasRect: null,
      };
    }

    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    let glError = null;
    let contextLost = null;
    let renderer = null;
    if (gl) {
      contextLost = gl.isContextLost();
      glError = gl.getError();
      try {
        renderer = gl.getParameter(gl.RENDERER);
      } catch {
        renderer = null;
      }
    }

    const rect = canvas.getBoundingClientRect();
    return {
      hasCanvas: true,
      metrics,
      diag: {
        shaderErrors: [...diag.shaderErrors],
        programErrors: [...diag.programErrors],
      },
      glError,
      contextLost,
      renderer,
      canvasSize: {
        width: canvas.width,
        height: canvas.height,
        clientWidth: canvas.clientWidth,
        clientHeight: canvas.clientHeight,
        rectWidth: Math.round(rect.width),
        rectHeight: Math.round(rect.height),
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      },
    };
  });
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Pure Node PNG decoder & pixel variance analyzer using built-in `node:zlib`.
 */
export function decodePngAndAnalyze(pngBuf) {
  if (!Buffer.isBuffer(pngBuf) || pngBuf.length < 33) {
    throw new Error('Invalid PNG buffer (too small)');
  }
  const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (pngBuf[i] !== magic[i]) {
      throw new Error('Invalid PNG signature');
    }
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset + 8 <= pngBuf.length) {
    const length = pngBuf.readUInt32BE(offset);
    const type = pngBuf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > pngBuf.length) break;

    if (type === 'IHDR') {
      width = pngBuf.readUInt32BE(dataStart);
      height = pngBuf.readUInt32BE(dataStart + 4);
      bitDepth = pngBuf[dataStart + 8];
      colorType = pngBuf[dataStart + 9];
      interlace = pngBuf[dataStart + 12];
    } else if (type === 'IDAT') {
      idatChunks.push(pngBuf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || interlace !== 0) {
    throw new Error(`Unsupported PNG format: ${width}x${height} bitDepth=${bitDepth} interlace=${interlace}`);
  }

  const channelsMap = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const bpp = channelsMap[colorType];
  if (!bpp) {
    throw new Error(`Unsupported PNG colorType=${colorType}`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * bpp;
  const expectedLen = (stride + 1) * height;
  if (raw.length < expectedLen) {
    throw new Error(`Truncated PNG pixel stream: got ${raw.length}, expected ${expectedLen}`);
  }

  // Unfilter scanlines (hoist filterType branch outside inner x loop for V8 JIT speed)
  const pixels = new Uint8Array(width * height * bpp);
  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const srcRow = y * (stride + 1) + 1;
    const dstRow = y * stride;
    const prevRow = (y - 1) * stride;

    if (filterType === 0) {
      pixels.set(raw.subarray(srcRow, srcRow + stride), dstRow);
    } else if (filterType === 1) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? pixels[dstRow + x - bpp] : 0;
        pixels[dstRow + x] = (raw[srcRow + x] + a) & 0xff;
      }
    } else if (filterType === 2) {
      for (let x = 0; x < stride; x++) {
        const b = y > 0 ? pixels[prevRow + x] : 0;
        pixels[dstRow + x] = (raw[srcRow + x] + b) & 0xff;
      }
    } else if (filterType === 3) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? pixels[dstRow + x - bpp] : 0;
        const b = y > 0 ? pixels[prevRow + x] : 0;
        pixels[dstRow + x] = (raw[srcRow + x] + ((a + b) >> 1)) & 0xff;
      }
    } else if (filterType === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? pixels[dstRow + x - bpp] : 0;
        const b = y > 0 ? pixels[prevRow + x] : 0;
        const c = y > 0 && x >= bpp ? pixels[prevRow + x - bpp] : 0;
        pixels[dstRow + x] = (raw[srcRow + x] + paethPredictor(a, b, c)) & 0xff;
      }
    } else {
      pixels.set(raw.subarray(srcRow, srcRow + stride), dstRow);
    }
  }

  // Sample ~48x48 grid across image
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  let sampleCount = 0;
  let nonZeroAlphaCount = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumSqR = 0;
  let sumSqG = 0;
  let sumSqB = 0;
  const buckets = new Set();

  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * bpp;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 255;
      if (colorType === 0) {
        r = g = b = pixels[idx];
      } else if (colorType === 4) {
        r = g = b = pixels[idx];
        a = pixels[idx + 1];
      } else if (colorType === 2) {
        r = pixels[idx];
        g = pixels[idx + 1];
        b = pixels[idx + 2];
      } else if (colorType === 6) {
        r = pixels[idx];
        g = pixels[idx + 1];
        b = pixels[idx + 2];
        a = pixels[idx + 3];
      }

      sampleCount++;
      if (a > 0) nonZeroAlphaCount++;
      sumR += r;
      sumG += g;
      sumB += b;
      sumSqR += r * r;
      sumSqG += g * g;
      sumSqB += b * b;
      const bucket = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      buckets.add(bucket);
    }
  }

  const varR = Math.max(0, sumSqR / sampleCount - (sumR / sampleCount) ** 2);
  const varG = Math.max(0, sumSqG / sampleCount - (sumG / sampleCount) ** 2);
  const varB = Math.max(0, sumSqB / sampleCount - (sumB / sampleCount) ** 2);
  const rgbStddev = Math.sqrt((varR + varG + varB) / 3);

  return {
    width,
    height,
    sampleCount,
    nonZeroAlphaCount,
    distinctBuckets: buckets.size,
    rgbStddev: Math.round(rgbStddev * 100) / 100,
    isBlank: rgbStddev <= 2.0 || buckets.size < 8 || nonZeroAlphaCount === 0,
  };
}

/**
 * Verifies non-blank rendered pixel variance using an existing Playwright PNG buffer
 * (single-screenshot path) or captures `#game-canvas-container canvas` if none provided.
 */
export async function verifyCanvasNonBlank(page, existingPngBuf = null) {
  let pngBuf = existingPngBuf;
  if (!pngBuf) {
    const canvas = page.locator('#game-canvas-container canvas');
    const count = await canvas.count();
    if (count === 0) {
      return { ok: false, reason: 'Canvas element not found in #game-canvas-container' };
    }
    pngBuf = await canvas.first().screenshot({ type: 'png' });
  }
  const analysis = decodePngAndAnalyze(pngBuf);
  return {
    ok: !analysis.isBlank,
    pngBytes: pngBuf.length,
    ...analysis,
  };
}
