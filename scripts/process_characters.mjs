#!/usr/bin/env node
/**
 * Surgical Chroma-Key, Despill, Edge-Decontamination & 512x512 Diorama Framing Pipeline
 * for Les Chroniques de Félingard (public/assets/characters/*).
 *
 * Zero external npm dependencies: uses ffmpeg/ffprobe for universal image decoding
 * and a lossless pure-Node RGBA PNG encoder + premultiplied Lanczos-3 resampler.
 *
 * Usage:
 *   node scripts/process_characters.mjs <inputPath> <outputPath> [options]
 *   node scripts/process_characters.mjs --batch <config.json>
 *
 * Options:
 *   --size <512>              Output square size (default 512)
 *   --key <auto|green|magenta|blue|neutral>  Chroma key mode (default auto)
 *   --tol <number>            Chroma distance threshold multiplier (default 1.0)
 *   --despill <0..1.5>        Edge color decontamination strength (default 1.0)
 *   --erode <0..3>            Sub-pixel / 1px matte shrink to kill stubborn fringes (default 0.35)
 *   --feather <0..2>          1px edge alpha smoothing radius (default 0.7)
 *   --padding-bottom <px>     Bottom anchor margin in final output (default 12)
 *   --padding-top <px>        Top margin in final output (default 18)
 *   --padding-side <px>       Left/Right margin in final output (default 20)
 *   --anchor <bottom|center>  Vertical alignment (default bottom; use center for floating spirit)
 *   --keep-sparkles           Keep small disconnected bright alpha islands (magic dust/mist)
 *   --keep-interior           Do not punch interior chroma holes (only exterior border flood-fill)
 *   --shadow-clean <0..1>     Extra suppression for dark chroma-tinted floor shadows under feet
 *   --flip-x                  Mirror horizontally (so sprite faces 3/4 right)
 *   --portrait                Square tight bust crop from upper-center region (for hero_portrait.png)
 *   --qa-out <path>           Write side-by-side QA inspection sheet (checker + dark + grass + alpha)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// ============================================================================
// Pure-Node Lossless RGBA PNG Encoder (CRC32 + zlib)
// ============================================================================

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRGBA(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Sub filter (type 1) per scanline for compact lossless compression
  const rowBytes = width * 4;
  const raw = Buffer.alloc(height * (rowBytes + 1));
  for (let y = 0; y < height; y++) {
    const outRow = y * (rowBytes + 1);
    const inRow = y * rowBytes;
    raw[outRow] = 1; // Filter: Sub
    for (let i = 0; i < rowBytes; i++) {
      const left = i >= 4 ? rgba[inRow + i - 4] : 0;
      raw[outRow + 1 + i] = (rgba[inRow + i] - left) & 0xff;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ============================================================================
// Universal Image Decoder via ffprobe + ffmpeg
// ============================================================================

function decodeImageRGBA(filePath) {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=s=x:p=0',
      filePath,
    ],
    { encoding: 'utf8' },
  );
  if (probe.status !== 0) {
    throw new Error(`ffprobe failed on ${filePath}: ${probe.stderr}`);
  }
  const [wStr, hStr] = probe.stdout.trim().split('x');
  const width = parseInt(wStr, 10);
  const height = parseInt(hStr, 10);
  if (!width || !height) {
    throw new Error(`Invalid dimensions from ffprobe for ${filePath}: ${probe.stdout}`);
  }

  const dec = spawnSync(
    'ffmpeg',
    [
      '-v', 'error',
      '-i', filePath,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      'pipe:1',
    ],
    { maxBuffer: width * height * 4 + 1024 * 1024 },
  );
  if (dec.status !== 0) {
    throw new Error(`ffmpeg decode failed on ${filePath}: ${dec.stderr?.toString()}`);
  }
  const expected = width * height * 4;
  if (dec.stdout.length < expected) {
    throw new Error(`Decoded RGBA too short (${dec.stdout.length} < ${expected}) for ${filePath}`);
  }
  return {
    width,
    height,
    data: new Uint8Array(dec.stdout.buffer, dec.stdout.byteOffset, expected),
  };
}

// ============================================================================
// Color Math (RGB <-> HSV, Chroma Distance, Median)
// ============================================================================

function rgbToHsv(r, g, b) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === rf) h = ((gf - bf) / d + (gf < bf ? 6 : 0)) * 60;
    else if (max === gf) h = ((bf - rf) / d + 2) * 60;
    else h = ((rf - gf) / d + 4) * 60;
  }
  const s = max > 1e-6 ? d / max : 0;
  return [h, s, max];
}

function hueDiff(h1, h2) {
  const d = Math.abs(h1 - h2) % 360;
  return d > 180 ? 360 - d : d;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = Float32Array.from(arr).sort();
  return sorted[Math.floor(sorted.length / 2)];
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function sampleBorderKey(width, height, data, forcedKey) {
  const rs = [];
  const gs = [];
  const bs = [];
  const margin = Math.max(6, Math.min(20, Math.floor(Math.min(width, height) * 0.02)));

  const pushPx = (x, y) => {
    const idx = (y * width + x) * 4;
    if (data[idx + 3] < 200) return;
    rs.push(data[idx]);
    gs.push(data[idx + 1]);
    bs.push(data[idx + 2]);
  };

  for (let x = 0; x < width; x += 2) {
    for (let t = 0; t < margin; t += 3) {
      pushPx(x, t);
      pushPx(x, height - 1 - t);
    }
  }
  for (let y = margin; y < height - margin; y += 2) {
    for (let t = 0; t < margin; t += 3) {
      pushPx(t, y);
      pushPx(width - 1 - t, y);
    }
  }

  // If image already has transparent borders (>40% transparent), mark as already alpha!
  const totalSampledSlots =
    Math.ceil(width / 2) * Math.ceil(margin / 3) * 2 +
    Math.ceil((height - 2 * margin) / 2) * Math.ceil(margin / 3) * 2;
  if (rs.length < totalSampledSlots * 0.5) {
    return { mode: 'already_alpha', kr: 0, kg: 0, kb: 0, kh: 0, ks: 0, kv: 0, spread: 0 };
  }

  const kr = median(rs);
  const kg = median(gs);
  const kb = median(bs);
  const [kh, ks, kv] = rgbToHsv(kr, kg, kb);

  // Compute robust border spread (90th percentile RGB distance from median)
  const dists = new Float32Array(rs.length);
  for (let i = 0; i < rs.length; i++) {
    dists[i] = Math.hypot(rs[i] - kr, gs[i] - kg, bs[i] - kb);
  }
  dists.sort();
  const spread = dists[Math.floor(dists.length * 0.9)] || 8;

  let mode = forcedKey;
  if (mode === 'auto') {
    if (kg > kr + 35 && kg > kb + 35 && ks > 0.35) {
      mode = 'green';
    } else if (kr > kg + 35 && kb > kg + 35 && ks > 0.35) {
      mode = 'magenta';
    } else if (kb > kr + 35 && kb > kg + 35 && ks > 0.35) {
      mode = 'blue';
    } else {
      mode = 'neutral';
    }
  }

  return { mode, kr, kg, kb, kh, ks, kv, spread };
}

/**
 * Computes a normalized "background-ness" score in [0..1] (1 = pure bg, 0 = definitely fg)
 * plus a chroma excess value for green/magenta/blue screens.
 */
function evaluateBgSimilarity(r, g, b, key, tol, shadowClean) {
  const rgbDist = Math.hypot(r - key.kr, g - key.kg, b - key.kb);

  if (key.mode === 'green') {
    const [h, s, v] = rgbToHsv(r, g, b);
    const maxRB = Math.max(r, b);
    const greenDominance = g - maxRB; // positive when green dominates
    const hErr = hueDiff(h, key.kh);

    // Pure chroma green or slightly shaded green backdrop
    const distTol = Math.max(58, key.spread * 2.2 + 42) * tol;
    const isGreenHue = hErr < 44 * tol && s > 0.24 && greenDominance > 14;
    const isDarkGreenShadow =
      shadowClean > 0 &&
      hErr < 48 &&
      s > 0.24 &&
      v > 0.05 &&
      greenDominance > 14 * (1.2 - 0.55 * shadowClean);

    if (rgbDist < distTol && greenDominance > 12) {
      return { isBg: true, isHardBg: rgbDist < distTol * 0.72 && greenDominance > 38, excess: greenDominance / 255 };
    }
    if (isGreenHue && rgbDist < distTol * 1.95 && greenDominance > 36 / tol) {
      return { isBg: true, isHardBg: greenDominance > 68 && hErr < 28, excess: greenDominance / 255 };
    }
    if (isDarkGreenShadow) {
      return { isBg: true, isHardBg: false, excess: greenDominance / 255 };
    }
    // Near-boundary soft matte metric
    const soft =
      greenDominance > 4 && hErr < 50
        ? clamp((greenDominance / 95) * (1 - hErr / 55), 0, 1)
        : 0;
    return { isBg: false, isHardBg: false, excess: Math.max(0, greenDominance / 255), soft };
  }

  if (key.mode === 'magenta') {
    const [h, s, v] = rgbToHsv(r, g, b);
    const minRB = Math.min(r, b);
    const avgRB = 0.5 * (r + b);
    const magDominance = minRB - g;
    const magAvgDom = avgRB - g;
    const hErr = hueDiff(h, key.kh);

    const distTol = Math.max(58, key.spread * 2.2 + 42) * tol;
    const isMagHue = hErr < 42 * tol && s > 0.24 && magDominance > 14;
    const isDarkMagShadow =
      shadowClean > 0 &&
      hErr < 44 &&
      s > 0.28 &&
      v > 0.14 &&
      magDominance > 18 * (1.2 - 0.5 * shadowClean);

    if (rgbDist < distTol && magAvgDom > 18) {
      return { isBg: true, isHardBg: rgbDist < distTol * 0.72 && magDominance > 38, excess: magAvgDom / 255 };
    }
    if (isMagHue && rgbDist < distTol * 1.95 && magDominance > 36 / tol) {
      return { isBg: true, isHardBg: magDominance > 68 && hErr < 26, excess: magAvgDom / 255 };
    }
    if (isDarkMagShadow) {
      return { isBg: true, isHardBg: false, excess: magAvgDom / 255 };
    }
    const soft =
      magDominance > 4 && hErr < 48
        ? clamp((magDominance / 95) * (1 - hErr / 52), 0, 1)
        : 0;
    return { isBg: false, isHardBg: false, excess: Math.max(0, magAvgDom / 255), soft };
  }

  if (key.mode === 'blue') {
    const [h, s] = rgbToHsv(r, g, b);
    const maxRG = Math.max(r, g);
    const blueDominance = b - maxRG;
    const hErr = hueDiff(h, key.kh);
    const distTol = Math.max(58, key.spread * 2.2 + 42) * tol;
    if (rgbDist < distTol && blueDominance > 14) {
      return { isBg: true, isHardBg: rgbDist < distTol * 0.72 && blueDominance > 38, excess: blueDominance / 255 };
    }
    if (hErr < 40 * tol && s > 0.26 && blueDominance > 38 / tol && rgbDist < distTol * 1.9) {
      return { isBg: true, isHardBg: blueDominance > 68 && hErr < 26, excess: blueDominance / 255 };
    }
    const soft =
      blueDominance > 4 && hErr < 46
        ? clamp((blueDominance / 95) * (1 - hErr / 50), 0, 1)
        : 0;
    return { isBg: false, isHardBg: false, excess: Math.max(0, blueDominance / 255), soft };
  }

  // Neutral fallback (flat white/gray/black backdrop)
  const distTol = Math.max(30, key.spread * 2.0 + 18) * tol;
  const isBg = rgbDist < distTol;
  return {
    isBg,
    isHardBg: rgbDist < distTol * 0.65,
    excess: 0,
    soft: isBg ? 1 : clamp(1 - (rgbDist - distTol) / (distTol * 0.8), 0, 1),
  };
}

// ============================================================================
// Surgical Matting: Border Flood-Fill + Interior Chroma Holes + Despill + Bleed
// ============================================================================

function computeDistanceField(width, height, seedMask, maxDist) {
  const n = width * height;
  const dist = new Float32Array(n);
  dist.fill(1e6);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let head = 0;
  let tail = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (seedMask[idx]) {
        dist[idx] = 0;
        qx[tail] = x;
        qy[tail] = y;
        tail++;
      }
    }
  }

  const dirs = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, 1.414],
    [1, -1, 1.414],
    [-1, 1, 1.414],
    [1, 1, 1.414],
  ];

  while (head < tail) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const d0 = dist[y * width + x];
    if (d0 >= maxDist) continue;
    for (let k = 0; k < dirs.length; k++) {
      const nx = x + dirs[k][0];
      const ny = y + dirs[k][1];
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nd = d0 + dirs[k][2];
      const nIdx = ny * width + nx;
      if (nd < dist[nIdx]) {
        dist[nIdx] = nd;
        qx[tail] = nx;
        qy[tail] = ny;
        tail++;
      }
    }
  }
  return dist;
}

function keyAndCleanSprite(width, height, srcData, opts) {
  const n = width * height;
  const key = sampleBorderKey(width, height, srcData, opts.key);
  const out = new Uint8Array(srcData); // copy RGBA

  if (key.mode === 'already_alpha') {
    return { key, data: out };
  }

  // 1. Precompute per-pixel bg classification
  const bgCand = new Uint8Array(n);
  const hardBg = new Uint8Array(n);
  const softVal = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    if (out[p + 3] < 20) {
      bgCand[i] = 1;
      hardBg[i] = 1;
      softVal[i] = 1;
      continue;
    }
    const ev = evaluateBgSimilarity(
      out[p],
      out[p + 1],
      out[p + 2],
      key,
      opts.tol,
      opts.shadowClean,
    );
    bgCand[i] = ev.isBg ? 1 : 0;
    hardBg[i] = ev.isHardBg ? 1 : 0;
    softVal[i] = ev.isBg ? 1 : (ev.soft || 0);
  }

  // 2. Exterior 4-connected flood-fill from image borders
  const isBg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;

  const trySeed = (idx) => {
    if (!isBg[idx] && bgCand[idx]) {
      isBg[idx] = 1;
      queue[tail++] = idx;
    }
  };

  for (let x = 0; x < width; x++) {
    trySeed(x);
    trySeed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    trySeed(y * width);
    trySeed(y * width + (width - 1));
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % width;
    const y = (idx - x) / width;
    if (x > 0) trySeed(idx - 1);
    if (x + 1 < width) trySeed(idx + 1);
    if (y > 0) trySeed(idx - width);
    if (y + 1 < height) trySeed(idx + width);
  }

  // 3. Interior chroma-hole removal (gaps between legs, arms, tail, wings, ribs)
  // Only for strongly chromatic screens (green / magenta / blue) unless --keep-interior
  if (!opts.keepInterior && key.mode !== 'neutral') {
    if (opts.globalChroma) {
      for (let i = 0; i < n; i++) {
        if (isBg[i]) continue;
        const p = i * 4;
        const r = out[p];
        const g = out[p + 1];
        const b = out[p + 2];
        const [h, s] = rgbToHsv(r, g, b);
        const hErr = hueDiff(h, key.kh);
        if (bgCand[i]) {
          isBg[i] = 1;
        } else if (key.mode === 'magenta' && hErr < 48 && s > 0.24 && Math.min(r, b) - g > 20) {
          isBg[i] = 1;
        } else if (key.mode === 'green' && hErr < 48 && s > 0.24 && g - Math.max(r, b) > 20) {
          isBg[i] = 1;
        }
      }
    } else {
      const visited = new Uint8Array(n);
      const compBuf = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        if (isBg[i] || visited[i] || !hardBg[i]) continue;
        let cHead = 0;
        let cTail = 0;
        visited[i] = 1;
        compBuf[cTail++] = i;
        let hardCount = 0;
        while (cHead < cTail) {
          const cur = compBuf[cHead++];
          if (hardBg[cur]) hardCount++;
          const x = cur % width;
          const y = (cur - x) / width;
          const neighbors = [
            x > 0 ? cur - 1 : -1,
            x + 1 < width ? cur + 1 : -1,
            y > 0 ? cur - width : -1,
            y + 1 < height ? cur + width : -1,
          ];
          for (let k = 0; k < 4; k++) {
            const nb = neighbors[k];
            if (nb >= 0 && !isBg[nb] && !visited[nb] && bgCand[nb]) {
              visited[nb] = 1;
              compBuf[cTail++] = nb;
            }
          }
        }
        // Accept interior pocket as background if majority is unmistakably pure chroma
        if (cTail >= 3 && hardCount / cTail >= 0.42) {
          for (let k = 0; k < cTail; k++) {
            isBg[compBuf[k]] = 1;
          }
        }
      }
    }
  }

  // 4. Remove tiny stray foreground specks (unless --keep-sparkles)
  if (!opts.keepSparkles) {
    const visited = new Uint8Array(n);
    const compBuf = new Int32Array(n);
    const comps = [];
    let maxSize = 0;
    for (let i = 0; i < n; i++) {
      if (isBg[i] || visited[i]) continue;
      let cHead = 0;
      let cTail = 0;
      visited[i] = 1;
      compBuf[cTail++] = i;
      while (cHead < cTail) {
        const cur = compBuf[cHead++];
        const x = cur % width;
        const y = (cur - x) / width;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            const nb = ny * width + nx;
            if (!isBg[nb] && !visited[nb]) {
              visited[nb] = 1;
              compBuf[cTail++] = nb;
            }
          }
        }
      }
      if (cTail > maxSize) maxSize = cTail;
      comps.push(Int32Array.from(compBuf.subarray(0, cTail)));
    }
    const minKeep = Math.max(24, Math.floor(maxSize * 0.002));
    for (const comp of comps) {
      if (comp.length < minKeep) {
        for (let k = 0; k < comp.length; k++) isBg[comp[k]] = 1;
      }
    }
  }

  // 5. Distance from background into foreground (for surgical edge ramp, erode & despill)
  const distToBg = computeDistanceField(width, height, isBg, 10);

  // Build float alpha [0..1]
  const alpha = new Float32Array(n);
  const erodePx = opts.erode;
  const bandPx = Math.max(1.5, erodePx + 2.2);

  for (let i = 0; i < n; i++) {
    if (isBg[i]) {
      alpha[i] = 0;
      continue;
    }
    const d = distToBg[i];
    if (d <= erodePx) {
      alpha[i] = 0;
    } else if (d <= bandPx) {
      // Soft matte transition modulated by remaining chroma similarity
      const geomA = clamp((d - erodePx) / Math.max(0.85, bandPx - erodePx), 0, 1);
      const chromaPenalty = softVal[i];
      // Pixels very close to bg with high chroma excess get attenuated cleanly
      const a = clamp(geomA * (1 - chromaPenalty * 0.85), 0, 1);
      alpha[i] = a;
    } else {
      alpha[i] = 1;
    }
  }

  // 6. Optional 1px gentle alpha feathering on the boundary only (smooths stair-stepping)
  if (opts.feather > 0) {
    const tmpA = new Float32Array(alpha);
    const wCenter = 1.0;
    const wOrtho = 0.35 * opts.feather;
    const wDiag = 0.15 * opts.feather;
    const wSum = wCenter + 4 * wOrtho + 4 * wDiag;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        const d = distToBg[i];
        if (d > bandPx + 1.5) continue;
        if (d === 0 && alpha[i - 1] === 0 && alpha[i + 1] === 0 && alpha[i - width] === 0 && alpha[i + width] === 0) {
          continue;
        }
        const blurred =
          (alpha[i] * wCenter +
            (alpha[i - 1] + alpha[i + 1] + alpha[i - width] + alpha[i + width]) * wOrtho +
            (alpha[i - width - 1] + alpha[i - width + 1] + alpha[i + width - 1] + alpha[i + width + 1]) * wDiag) /
          wSum;
        // Never inflate background far out, only smooth the active edge
        tmpA[i] = alpha[i] === 0 ? Math.min(blurred * 0.5, 0.25) : blurred;
      }
    }
    // Clean ultra-low alpha tail so bounding box is crisp
    for (let i = 0; i < n; i++) {
      alpha[i] = tmpA[i] < 0.04 ? 0 : tmpA[i] > 0.97 ? 1 : tmpA[i];
    }
  }

  // 7. Color Decontamination / Despill (ZERO chroma fringe on fur/wool/metal edges!)
  const despillStrength = opts.despill;
  if (despillStrength > 0 && key.mode !== 'neutral') {
    for (let i = 0; i < n; i++) {
      const a = alpha[i];
      if (a <= 0) continue;
      const d = distToBg[i];
      // Strong despill near edges (d <= 8px), subtle global spill protection on bounce-lit areas
      const edgeFactor = d <= 3.5 ? 1.0 : d <= 9.0 ? clamp(1 - (d - 3.5) / 5.5, 0, 1) : 0.25;
      const strength = clamp(despillStrength * edgeFactor, 0, 1.35);
      if (strength <= 0.01) continue;

      const p = i * 4;
      let r = out[p];
      let g = out[p + 1];
      let b = out[p + 2];

      // Step 7a: Unmix chroma background from semi-transparent edge pixels
      if (a < 0.96 && a > 0.18) {
        const invA = 1 / a;
        const mixWeight = clamp((1 - a) * 0.75, 0, 0.75);
        const ur = clamp((r - (1 - a) * key.kr) * invA, 0, 255);
        const ug = clamp((g - (1 - a) * key.kg) * invA, 0, 255);
        const ub = clamp((b - (1 - a) * key.kb) * invA, 0, 255);
        r = r * (1 - mixWeight) + ur * mixWeight;
        g = g * (1 - mixWeight) + ug * mixWeight;
        b = b * (1 - mixWeight) + ub * mixWeight;
      }

      // Step 7b: Keylight luminance-preserving despill
      if (key.mode === 'green') {
        const limit = Math.max(r, b) * 0.85 + 0.5 * (r + b) * 0.15;
        if (g > limit) {
          const spill = (g - limit) * Math.min(1, strength);
          g -= spill;
          // Slight warm luminance recovery prevents purple cast on white fur/bones
          r = clamp(r + spill * 0.22, 0, 255);
          b = clamp(b + spill * 0.16, 0, 255);
        }
        // Extra fire-edge despill: turns chartreuse/olive orange+green flame blends into pure molten gold-orange
        if (opts.fireDespill && d <= 12 && b < 100 && r > 65 && g > r * 0.54) {
          const excess = g - r * 0.46;
          const w = clamp(1.15 - d / 12, 0.35, 1);
          g = clamp(g - excess * 0.92 * w, 0, 255);
          r = clamp(r + excess * 0.45 * w, 0, 255);
        }
      } else if (key.mode === 'magenta') {
        const avgRB = 0.5 * (r + b);
        const minRB = Math.min(r, b);
        const limit = g * 1.08 + 8;
        if (minRB > limit) {
          const spill = (minRB - limit) * Math.min(1, strength);
          // Suppress both R and B symmetrically where magenta bounce exists
          r = clamp(r - spill * 0.85, 0, 255);
          b = clamp(b - spill * 0.85, 0, 255);
          g = clamp(g + spill * 0.12, 0, 255);
        } else if (d <= 4 && avgRB > g + 22 && Math.abs(r - b) < 40) {
          const spill = (avgRB - g - 22) * Math.min(1, strength) * 0.65;
          r = clamp(r - spill, 0, 255);
          b = clamp(b - spill, 0, 255);
        }
      } else if (key.mode === 'blue') {
        const limit = Math.max(r, g) * 0.85 + 0.5 * (r + g) * 0.15;
        if (b > limit) {
          const spill = (b - limit) * Math.min(1, strength);
          b -= spill;
          r = clamp(r + spill * 0.14, 0, 255);
          g = clamp(g + spill * 0.14, 0, 255);
        }
      }

      out[p] = Math.round(clamp(r, 0, 255));
      out[p + 1] = Math.round(clamp(g, 0, 255));
      out[p + 2] = Math.round(clamp(b, 0, 255));
    }
  }

  // 8. Replace RGB on very semi-transparent edge pixels (0 < a < 0.75) by diffusing
  // clean interior opaque foreground colors outward! Eliminates any residual fringe!
  // Also bleeds 4px into alpha=0 so WebGL bilinear filtering & mipmaps stay 100% halo-free!
  const solidMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    solidMask[i] = alpha[i] >= 0.88 && distToBg[i] >= 2.2 ? 1 : 0;
  }

  // Iterative outward RGB diffusion (6 passes)
  let valid = new Uint8Array(solidMask);
  const rgbWork = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    rgbWork[i * 3] = out[i * 4];
    rgbWork[i * 3 + 1] = out[i * 4 + 1];
    rgbWork[i * 3 + 2] = out[i * 4 + 2];
  }

  for (let pass = 0; pass < 7; pass++) {
    const nextValid = new Uint8Array(valid);
    const nextRgb = new Float32Array(rgbWork);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (valid[i]) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nb = (y + dy) * width + (x + dx);
            if (valid[nb]) {
              const w = dx === 0 || dy === 0 ? 1.0 : 0.7;
              sr += rgbWork[nb * 3] * w;
              sg += rgbWork[nb * 3 + 1] * w;
              sb += rgbWork[nb * 3 + 2] * w;
              cnt += w;
            }
          }
        }
        if (cnt > 0) {
          nextRgb[i * 3] = sr / cnt;
          nextRgb[i * 3 + 1] = sg / cnt;
          nextRgb[i * 3 + 2] = sb / cnt;
          nextValid[i] = 1;
        }
      }
    }
    valid = nextValid;
    rgbWork.set(nextRgb);
  }

  // Write final alpha + color-decontaminated edge RGB
  for (let i = 0; i < n; i++) {
    const a = alpha[i];
    const p = i * 4;
    if (a <= 0) {
      // Mipmap-safe transparent pixel: keep bled foreground RGB if close to silhouette, else 0
      if (valid[i]) {
        out[p] = Math.round(rgbWork[i * 3]);
        out[p + 1] = Math.round(rgbWork[i * 3 + 1]);
        out[p + 2] = Math.round(rgbWork[i * 3 + 2]);
      } else {
        out[p] = 0;
        out[p + 1] = 0;
        out[p + 2] = 0;
      }
      out[p + 3] = 0;
    } else if (a < 0.88 && valid[i]) {
      // Blend edge RGB strongly toward diffused clean interior foreground color
      const blend = clamp((0.88 - a) / 0.65, 0, 0.92);
      out[p] = Math.round(out[p] * (1 - blend) + rgbWork[i * 3] * blend);
      out[p + 1] = Math.round(out[p + 1] * (1 - blend) + rgbWork[i * 3 + 1] * blend);
      out[p + 2] = Math.round(out[p + 2] * (1 - blend) + rgbWork[i * 3 + 2] * blend);
      out[p + 3] = Math.round(clamp(a * 255, 0, 255));
    } else {
      out[p + 3] = Math.round(clamp(a * 255, 0, 255));
    }
  }

  return { key, data: out };
}

// ============================================================================
// Premultiplied-Alpha Lanczos-3 Resampling + Mipmap Bleed + Framing (512x512)
// ============================================================================

function lanczos3(x) {
  const ax = Math.abs(x);
  if (ax < 1e-6) return 1;
  if (ax >= 3) return 0;
  const pix = Math.PI * ax;
  return (Math.sin(pix) / pix) * (Math.sin(pix / 3) / (pix / 3));
}

function flipHorizontal(width, height, rgba) {
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 4;
      const di = (y * width + (width - 1 - x)) * 4;
      out[di] = rgba[si];
      out[di + 1] = rgba[si + 1];
      out[di + 2] = rgba[si + 2];
      out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

function findAlphaBounds(width, height, rgba, alphaThresh = 16) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] >= alphaThresh) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1 };
  }
  return { minX, minY, maxX, maxY };
}

function resamplePremulLanczos(srcW, srcH, srcRgba, cropX, cropY, cropW, cropH, dstW, dstH) {
  // Separable 2-pass premultiplied-alpha Lanczos-3
  // Pass 1: Horizontal cropW -> dstW (height = cropH)
  const tmp = new Float32Array(dstW * cropH * 4);
  const scaleX = cropW / dstW;
  const supportX = Math.max(3, 3 * scaleX);
  const invScaleX = scaleX > 1 ? 1 / scaleX : 1;

  for (let dx = 0; dx < dstW; dx++) {
    const center = (dx + 0.5) * scaleX - 0.5;
    const left = Math.max(0, Math.floor(center - supportX));
    const right = Math.min(cropW - 1, Math.ceil(center + supportX));
    const weights = [];
    let wSum = 0;
    for (let sx = left; sx <= right; sx++) {
      const w = lanczos3((sx - center) * invScaleX);
      weights.push([sx, w]);
      wSum += w;
    }
    const invW = wSum !== 0 ? 1 / wSum : 1;

    for (let row = 0; row < cropH; row++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      const sy = cropY + row;
      for (let k = 0; k < weights.length; k++) {
        const sx = cropX + weights[k][0];
        const w = weights[k][1] * invW;
        const idx = (sy * srcW + sx) * 4;
        const a = srcRgba[idx + 3] / 255;
        pr += srcRgba[idx] * a * w;
        pg += srcRgba[idx + 1] * a * w;
        pb += srcRgba[idx + 2] * a * w;
        pa += a * w;
      }
      const ti = (row * dstW + dx) * 4;
      tmp[ti] = pr;
      tmp[ti + 1] = pg;
      tmp[ti + 2] = pb;
      tmp[ti + 3] = pa;
    }
  }

  // Pass 2: Vertical cropH -> dstH
  const out = new Uint8Array(dstW * dstH * 4);
  const scaleY = cropH / dstH;
  const supportY = Math.max(3, 3 * scaleY);
  const invScaleY = scaleY > 1 ? 1 / scaleY : 1;

  for (let dy = 0; dy < dstH; dy++) {
    const center = (dy + 0.5) * scaleY - 0.5;
    const top = Math.max(0, Math.floor(center - supportY));
    const bot = Math.min(cropH - 1, Math.ceil(center + supportY));
    const weights = [];
    let wSum = 0;
    for (let sy = top; sy <= bot; sy++) {
      const w = lanczos3((sy - center) * invScaleY);
      weights.push([sy, w]);
      wSum += w;
    }
    const invW = wSum !== 0 ? 1 / wSum : 1;

    for (let dx = 0; dx < dstW; dx++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let k = 0; k < weights.length; k++) {
        const sy = weights[k][0];
        const w = weights[k][1] * invW;
        const ti = (sy * dstW + dx) * 4;
        pr += tmp[ti] * w;
        pg += tmp[ti + 1] * w;
        pb += tmp[ti + 2] * w;
        pa += tmp[ti + 3] * w;
      }
      const oi = (dy * dstW + dx) * 4;
      const a = clamp(pa, 0, 1);
      if (a > 0.015) {
        out[oi] = Math.round(clamp(pr / a, 0, 255));
        out[oi + 1] = Math.round(clamp(pg / a, 0, 255));
        out[oi + 2] = Math.round(clamp(pb / a, 0, 255));
        out[oi + 3] = Math.round(clamp(a * 255, 0, 255));
      } else {
        out[oi] = 0;
        out[oi + 1] = 0;
        out[oi + 2] = 0;
        out[oi + 3] = 0;
      }
    }
  }
  return out;
}

/**
 * Bleed foreground RGB 4px outward into alpha=0 pixels on final canvas so WebGL
 * linear filtering and mipmaps NEVER sample dark/black transparent border RGB.
 */
function mipmapBleedRGBA(size, rgba, passes = 4) {
  const n = size * size;
  let valid = new Uint8Array(n);
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] >= 64) {
      valid[i] = 1;
      rgb[i * 3] = rgba[i * 4];
      rgb[i * 3 + 1] = rgba[i * 4 + 1];
      rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }
  }
  for (let p = 0; p < passes; p++) {
    const nextValid = new Uint8Array(valid);
    const nextRgb = new Float32Array(rgb);
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        const i = y * size + x;
        if (valid[i]) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let cnt = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nb = (y + dy) * size + (x + dx);
            if (valid[nb]) {
              sr += rgb[nb * 3];
              sg += rgb[nb * 3 + 1];
              sb += rgb[nb * 3 + 2];
              cnt++;
            }
          }
        }
        if (cnt > 0) {
          nextRgb[i * 3] = sr / cnt;
          nextRgb[i * 3 + 1] = sg / cnt;
          nextRgb[i * 3 + 2] = sb / cnt;
          nextValid[i] = 1;
        }
      }
    }
    valid = nextValid;
    rgb.set(nextRgb);
  }
  for (let i = 0; i < n; i++) {
    if (rgba[i * 4 + 3] === 0 && valid[i]) {
      rgba[i * 4] = Math.round(rgb[i * 3]);
      rgba[i * 4 + 1] = Math.round(rgb[i * 3 + 1]);
      rgba[i * 4 + 2] = Math.round(rgb[i * 3 + 2]);
    }
  }
}

function frameToSquare(width, height, rgba, opts) {
  const size = opts.size;
  const bounds = findAlphaBounds(width, height, rgba, 20);
  let cropX = bounds.minX;
  let cropY = bounds.minY;
  let cropW = bounds.maxX - bounds.minX + 1;
  let cropH = bounds.maxY - bounds.minY + 1;

  if (opts.cropBox) {
    // Normalized [fx0, fy0, fw, fh] relative to foreground bounding box
    const [fx0, fy0, fw, fh] = opts.cropBox;
    const fgW = bounds.maxX - bounds.minX + 1;
    const fgH = bounds.maxY - bounds.minY + 1;
    cropX = clamp(Math.round(bounds.minX + fx0 * fgW), 0, width - 1);
    cropY = clamp(Math.round(bounds.minY + fy0 * fgH), 0, height - 1);
    cropW = clamp(Math.round(fw * fgW), 1, width - cropX);
    cropH = clamp(Math.round(fh * fgH), 1, height - cropY);
  } else if (opts.portrait) {
    // Tight heroic bust portrait: upper ~56% of character height, square centered around head/shoulders
    const bustH = Math.round(cropH * 0.56);
    const side = Math.max(bustH, Math.round(cropW * 0.72));
    const cx = Math.round((bounds.minX + bounds.maxX) * 0.5);
    cropX = clamp(Math.round(cx - side * 0.5), 0, Math.max(0, width - side));
    cropY = clamp(Math.max(0, bounds.minY - Math.round(side * 0.06)), 0, Math.max(0, height - side));
    cropW = Math.min(side, width - cropX);
    cropH = Math.min(side, height - cropY);
  }

  const padSide = opts.portrait ? 16 : opts.paddingSide;
  const padTop = opts.portrait ? 16 : opts.paddingTop;
  const padBot = opts.portrait ? 0 : opts.paddingBottom;

  const availW = size - 2 * padSide;
  const availH = size - padTop - padBot;
  const scale = Math.min(availW / cropW, availH / cropH);
  const dstW = Math.max(1, Math.round(cropW * scale));
  const dstH = Math.max(1, Math.round(cropH * scale));

  const resized = resamplePremulLanczos(width, height, rgba, cropX, cropY, cropW, cropH, dstW, dstH);

  const canvas = new Uint8Array(size * size * 4);
  const offsetX = Math.round((size - dstW) * 0.5);
  const offsetY =
    opts.anchor === 'center'
      ? Math.round((size - dstH) * 0.5)
      : size - padBot - dstH;

  for (let y = 0; y < dstH; y++) {
    const ty = offsetY + y;
    if (ty < 0 || ty >= size) continue;
    for (let x = 0; x < dstW; x++) {
      const tx = offsetX + x;
      if (tx < 0 || tx >= size) continue;
      const si = (y * dstW + x) * 4;
      const di = (ty * size + tx) * 4;
      canvas[di] = resized[si];
      canvas[di + 1] = resized[si + 1];
      canvas[di + 2] = resized[si + 2];
      canvas[di + 3] = resized[si + 3];
    }
  }

  mipmapBleedRGBA(size, canvas, 4);
  return { canvas, bounds, dstW, dstH, offsetX, offsetY };
}

// ============================================================================
// QA Composite Sheet Generator (Checkerboard | Dark Navy | Grass Green)
// ============================================================================

function writeQaComposite(size, spriteRgba, outPath) {
  const panels = 3;
  const w = size * panels;
  const h = size;
  const out = new Uint8Array(w * h * 4);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const sr = spriteRgba[si];
      const sg = spriteRgba[si + 1];
      const sb = spriteRgba[si + 2];
      const sa = spriteRgba[si + 3] / 255;

      // Panel 0: Checkerboard (classic transparency check)
      const chk = ((x >> 4) + (y >> 4)) & 1 ? 215 : 170;
      const bg0 = [chk, chk, chk];
      // Panel 1: Dark slate/navy (exposes white/light/green halos immediately)
      const bg1 = [24, 28, 42];
      // Panel 2: Warm diorama meadow green (exposes magenta/dark fringes immediately)
      const bg2 = [118, 158, 78];

      const bgs = [bg0, bg1, bg2];
      for (let p = 0; p < panels; p++) {
        const di = (y * w + (p * size + x)) * 4;
        const [br, bg, bb] = bgs[p];
        out[di] = Math.round(sr * sa + br * (1 - sa));
        out[di + 1] = Math.round(sg * sa + bg * (1 - sa));
        out[di + 2] = Math.round(sb * sa + bb * (1 - sa));
        out[di + 3] = 255;
      }
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, encodePngRGBA(w, h, out));
}

// ============================================================================
// Quantitative Fringe & Matte Metrics (helps catch subtle halos automatically)
// ============================================================================

function analyzeSpriteMetrics(size, rgba, keyMode) {
  let opaquePx = 0;
  let semiPx = 0;
  let edgePx = 0;
  let greenHaloPx = 0;
  let magentaHaloPx = 0;
  let borderTouchPx = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const a = rgba[i * 4 + 3];
      if (a >= 220) opaquePx++;
      else if (a >= 16) semiPx++;
      if (a >= 16 && (x === 0 || x === size - 1 || y === 0 || y === size - 1)) {
        borderTouchPx++;
      }

      if (a >= 90 && x > 0 && x < size - 1 && y > 0 && y < size - 1) {
        const hasTransNeighbor =
          rgba[((y - 1) * size + x) * 4 + 3] < 40 ||
          rgba[((y + 1) * size + x) * 4 + 3] < 40 ||
          rgba[(y * size + (x - 1)) * 4 + 3] < 40 ||
          rgba[(y * size + (x + 1)) * 4 + 3] < 40;
        if (hasTransNeighbor) {
          edgePx++;
          const r = rgba[i * 4];
          const g = rgba[i * 4 + 1];
          const b = rgba[i * 4 + 2];
          if (g > Math.max(r, b) + 35) greenHaloPx++;
          if (Math.min(r, b) > g + 35) magentaHaloPx++;
        }
      }
    }
  }

  const coveragePct = ((opaquePx + semiPx) / (size * size)) * 100;
  const greenEdgePct = edgePx ? (greenHaloPx / edgePx) * 100 : 0;
  const magEdgePct = edgePx ? (magentaHaloPx / edgePx) * 100 : 0;
  return {
    keyMode,
    coveragePct: Number(coveragePct.toFixed(1)),
    opaquePx,
    semiPx,
    edgePx,
    greenEdgePct: Number(greenEdgePct.toFixed(1)),
    magEdgePct: Number(magEdgePct.toFixed(1)),
    borderTouchPx,
  };
}

// ============================================================================
// Single File Processing & CLI
// ============================================================================

export function processOne(inputPath, outputPath, rawOpts = {}) {
  const opts = {
    size: 512,
    key: 'auto',
    tol: 1.0,
    despill: 1.0,
    erode: 0.35,
    feather: 0.7,
    paddingBottom: 12,
    paddingTop: 18,
    paddingSide: 20,
    anchor: 'bottom',
    keepSparkles: false,
    keepInterior: false,
    globalChroma: false,
    fireDespill: false,
    shadowClean: 0.65,
    flipX: false,
    portrait: false,
    cropBox: null,
    qaOut: null,
    ...rawOpts,
  };

  const decoded = decodeImageRGBA(inputPath);
  const keyed = keyAndCleanSprite(decoded.width, decoded.height, decoded.data, opts);
  const oriented = opts.flipX
    ? flipHorizontal(decoded.width, decoded.height, keyed.data)
    : keyed.data;
  const framed = frameToSquare(decoded.width, decoded.height, oriented, opts);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, encodePngRGBA(opts.size, opts.size, framed.canvas));

  if (opts.qaOut) {
    writeQaComposite(opts.size, framed.canvas, opts.qaOut);
  }

  const metrics = analyzeSpriteMetrics(opts.size, framed.canvas, keyed.key.mode);
  return {
    inputPath,
    outputPath,
    srcDim: `${decoded.width}x${decoded.height}`,
    outDim: `${opts.size}x${opts.size}`,
    detectedKey: {
      mode: keyed.key.mode,
      rgb: [Math.round(keyed.key.kr), Math.round(keyed.key.kg), Math.round(keyed.key.kb)],
      spread: Number(keyed.key.spread.toFixed(1)),
    },
    framedDim: `${framed.dstW}x${framed.dstH}`,
    metrics,
  };
}

function parseCli(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: node scripts/process_characters.mjs <input> <output> [options] | --batch <config.json>');
    process.exit(0);
  }

  if (args[0] === '--batch') {
    const cfgPath = args[1];
    const items = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const results = [];
    for (const item of items) {
      const res = processOne(item.input, item.output, item.options || {});
      results.push(res);
      console.log(
        `[OK] ${path.basename(res.outputPath)} (${res.srcDim} -> ${res.outDim}, key=${res.detectedKey.mode} rgb=${res.detectedKey.rgb.join(',')}, cov=${res.metrics.coveragePct}%, gEdge=${res.metrics.greenEdgePct}%, mEdge=${res.metrics.magEdgePct}%)`,
      );
    }
    return;
  }

  const inputPath = args[0];
  const outputPath = args[1];
  const opts = {};
  for (let i = 2; i < args.length; i++) {
    const flag = args[i];
    switch (flag) {
      case '--size': opts.size = parseInt(args[++i], 10); break;
      case '--key': opts.key = args[++i]; break;
      case '--tol': opts.tol = parseFloat(args[++i]); break;
      case '--despill': opts.despill = parseFloat(args[++i]); break;
      case '--erode': opts.erode = parseFloat(args[++i]); break;
      case '--feather': opts.feather = parseFloat(args[++i]); break;
      case '--padding-bottom': opts.paddingBottom = parseInt(args[++i], 10); break;
      case '--padding-top': opts.paddingTop = parseInt(args[++i], 10); break;
      case '--padding-side': opts.paddingSide = parseInt(args[++i], 10); break;
      case '--anchor': opts.anchor = args[++i]; break;
      case '--keep-sparkles': opts.keepSparkles = true; break;
      case '--keep-interior': opts.keepInterior = true; break;
      case '--global-chroma': opts.globalChroma = true; break;
      case '--fire-despill': opts.fireDespill = true; break;
      case '--shadow-clean': opts.shadowClean = parseFloat(args[++i]); break;
      case '--flip-x': opts.flipX = true; break;
      case '--portrait': opts.portrait = true; break;
      case '--crop': opts.cropBox = args[++i].split(',').map(Number); break;
      case '--qa-out': opts.qaOut = args[++i]; break;
      default:
        throw new Error(`Unknown CLI flag: ${flag}`);
    }
  }
  const res = processOne(inputPath, outputPath, opts);
  console.log(JSON.stringify(res, null, 2));
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('process_characters.mjs')) {
  parseCli(process.argv);
}
