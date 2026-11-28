#!/usr/bin/env node
/**
 * Autonomous 2.5D Orthographic Segmented-Limb Spritesheet Rasterizer
 * Invoked automatically by `tools/bake_animations.py` when Blender CLI (`bpy`)
 * is not installed.
 *
 * Strictly uses ONLY existing PNG assets in `public/assets/` (zero AI generation).
 * Pipeline per spritesheet:
 *  1. Load source RGBA PNG (auto-crops Pose 0 if width >= height * 2.2).
 *  2. Segment source into anatomical cutout layers with feathered masks &
 *     radial-diffusion hidden-joint inpainting on parent torso layers.
 *  3. Evaluate hierarchical Forward Kinematics (FK) at 30 FPS (15/30/45/90 frames),
 *     apply inverse-affine premultiplied bilinear warping + wave mesh deformations,
 *     and composite in strict Z-depth order (+0.002 step) into row-major atlas.
 *  4. Apply procedural pixel-space effects where specified (Phase 2 magma/lava glow
 *     for boss_dragon_claw_p2, swirling runic vortex for portal_exit, multi-harmonic
 *     flame for prop_torch, articulated back-hinged lid rotation for chest_opening).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ============================================================================
// Pure-Node Zero-Dependency RGBA PNG Codec (CRC32 + all 5 scanline filters)
// ============================================================================

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePng(filePath) {
  const buf = fs.readFileSync(filePath);
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIG[i]) throw new Error(`Invalid PNG signature: ${filePath}`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idatChunks = [];

  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (type === 'IHDR') {
      width = buf.readUInt32BE(dataStart);
      height = buf.readUInt32BE(dataStart + 4);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format (${bitDepth}b ct=${colorType}) in ${filePath}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const recon = new Uint8Array(height * stride);

  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const rowOff = y * stride;
    const prevOff = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[inPos++];
      const a = x >= bpp ? recon[rowOff + x - bpp] : 0;
      const b = y > 0 ? recon[prevOff + x] : 0;
      const c = x >= bpp && y > 0 ? recon[prevOff + x - bpp] : 0;
      let out = val;
      if (filter === 1) out = (val + a) & 0xff;
      else if (filter === 2) out = (val + b) & 0xff;
      else if (filter === 3) out = (val + ((a + b) >>> 1)) & 0xff;
      else if (filter === 4) out = (val + paeth(a, b, c)) & 0xff;
      recon[rowOff + x] = out;
    }
  }

  let rgba;
  if (colorType === 6) {
    rgba = new Uint8ClampedArray(recon.buffer, recon.byteOffset, recon.byteLength);
  } else {
    rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
      rgba[j] = recon[i];
      rgba[j + 1] = recon[i + 1];
      rgba[j + 2] = recon[i + 2];
      rgba[j + 3] = 255;
    }
  }

  // Auto-crop Pose 0 if source is a legacy multi-pose horizontal strip (e.g. 4x1)
  if (width >= height * 2.2) {
    const cropW = height;
    const cropped = new Uint8ClampedArray(cropW * height * 4);
    for (let y = 0; y < height; y++) {
      const srcStart = y * width * 4;
      const dstStart = y * cropW * 4;
      cropped.set(rgba.subarray(srcStart, srcStart + cropW * 4), dstStart);
    }
    return { width: cropW, height, data: cropped };
  }

  return { width, height, data: rgba };
}

function makeChunk(type, data) {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(filePath, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Use Sub filter (type 1) per scanline for strong compression & fast encoding
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const rowOut = y * (stride + 1);
    const rowIn = y * stride;
    raw[rowOut] = 1; // Sub filter
    for (let x = 0; x < 4; x++) {
      raw[rowOut + 1 + x] = rgba[rowIn + x];
    }
    for (let x = 4; x < stride; x++) {
      raw[rowOut + 1 + x] = (rgba[rowIn + x] - rgba[rowIn + x - 4]) & 0xff;
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 4 });
  const png = Buffer.concat([
    PNG_SIG,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, png);
}

// ============================================================================
// Image Resampling, Feathered Anatomical Segmentation & Joint Inpainting
// ============================================================================

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Resize an RGBA image cleanly using premultiplied bilinear interpolation
 * (or nearest-neighbor for crisp pixel-art sprites).
 */
function resizeRgba(img, dstW, dstH, nearest = false) {
  if (img.width === dstW && img.height === dstH) {
    return { width: dstW, height: dstH, data: new Uint8ClampedArray(img.data) };
  }
  const out = new Uint8ClampedArray(dstW * dstH * 4);
  const src = img.data;
  const sw = img.width;
  const sh = img.height;
  const scaleX = sw / dstW;
  const scaleY = sh / dstH;

  for (let y = 0; y < dstH; y++) {
    const fy = (y + 0.5) * scaleY - 0.5;
    const y0 = clamp(Math.floor(fy), 0, sh - 1);
    const y1 = clamp(y0 + 1, 0, sh - 1);
    const wy = nearest ? 0 : clamp(fy - y0, 0, 1);
    for (let x = 0; x < dstW; x++) {
      const fx = (x + 0.5) * scaleX - 0.5;
      const x0 = clamp(Math.floor(fx), 0, sw - 1);
      const x1 = clamp(x0 + 1, 0, sw - 1);
      const wx = nearest ? 0 : clamp(fx - x0, 0, 1);

      const dstIdx = (y * dstW + x) * 4;
      if (nearest) {
        const sIdx = (y0 * sw + x0) * 4;
        out[dstIdx] = src[sIdx];
        out[dstIdx + 1] = src[sIdx + 1];
        out[dstIdx + 2] = src[sIdx + 2];
        out[dstIdx + 3] = src[sIdx + 3];
        continue;
      }

      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const w00 = (1 - wx) * (1 - wy);
      const w10 = wx * (1 - wy);
      const w01 = (1 - wx) * wy;
      const w11 = wx * wy;

      const a00 = src[i00 + 3] / 255;
      const a10 = src[i10 + 3] / 255;
      const a01 = src[i01 + 3] / 255;
      const a11 = src[i11 + 3] / 255;
      const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
      if (a > 1e-4) {
        const pr =
          src[i00] * a00 * w00 +
          src[i10] * a10 * w10 +
          src[i01] * a01 * w01 +
          src[i11] * a11 * w11;
        const pg =
          src[i00 + 1] * a00 * w00 +
          src[i10 + 1] * a10 * w10 +
          src[i01 + 1] * a01 * w01 +
          src[i11 + 1] * a11 * w11;
        const pb =
          src[i00 + 2] * a00 * w00 +
          src[i10 + 2] * a10 * w10 +
          src[i01 + 2] * a01 * w01 +
          src[i11 + 2] * a11 * w11;
        out[dstIdx] = clamp(Math.round(pr / a), 0, 255);
        out[dstIdx + 1] = clamp(Math.round(pg / a), 0, 255);
        out[dstIdx + 2] = clamp(Math.round(pb / a), 0, 255);
        out[dstIdx + 3] = clamp(Math.round(a * 255), 0, 255);
      }
    }
  }
  return { width: dstW, height: dstH, data: out };
}

/**
 * Evaluate a soft anatomical mask for normalized coordinate (nx, ny) in [0..1].
 * Supports rounded boxes (`box: [x0, y0, x1, y1]`) and ellipses (`ell: [cx, cy, rx, ry]`).
 */
function evalRegionMask(region, nx, ny, feather = 0.014) {
  if (region.ell) {
    const [cx, cy, rx, ry] = region.ell;
    const dx = (nx - cx) / Math.max(1e-4, rx);
    const dy = (ny - cy) / Math.max(1e-4, ry);
    const d = Math.hypot(dx, dy);
    return 1 - smoothstep(1 - feather * 3, 1 + feather * 2, d);
  }
  const [x0, y0, x1, y1] = region.box;
  const mx =
    smoothstep(x0 - feather, x0 + feather, nx) *
    (1 - smoothstep(x1 - feather, x1 + feather, nx));
  const my =
    smoothstep(y0 - feather, y0 + feather, ny) *
    (1 - smoothstep(y1 - feather, y1 + feather, ny));
  return mx * my;
}

/**
 * Build anatomical layers from a single Pose-0 image.
 * - Each child limb layer gets its feathered cutout + tight bounding box.
 * - The torso/body layer gets the remainder AND radial-diffusion joint inpainting
 *   around detached limb sockets so rotating arms/legs/wings never expose gaps!
 */
function buildSegmentedLayers(srcImg, layerSpecs, nearest = false) {
  const w = srcImg.width;
  const h = srcImg.height;
  const src = srcImg.data;
  const n = w * h;
  const feather = nearest ? 0.004 : 0.012;

  const layers = [];
  const childCoverage = new Float32Array(n);
  const deepOverlapCoverage = new Uint8Array(n);

  // 1. Extract all non-base limb layers first
  for (const spec of layerSpecs) {
    if (spec.isBase) continue;
    const data = new Uint8ClampedArray(n * 4);
    let minX = w, minY = h, maxX = -1, maxY = -1;

    for (let y = 0; y < h; y++) {
      const ny = (y + 0.5) / h;
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        const sa = src[p + 3];
        if (sa === 0) continue;
        const nx = (x + 0.5) / w;

        let m = 0;
        for (const r of spec.regions) {
          m = Math.max(m, evalRegionMask(r, nx, ny, feather));
        }
        if (spec.exclude) {
          for (const ex of spec.exclude) {
            m *= 1 - evalRegionMask(ex, nx, ny, feather);
          }
        }
        if (m <= 0.01) continue;

        const outA = Math.round(sa * m);
        if (outA <= 1) continue;
        data[p] = src[p];
        data[p + 1] = src[p + 1];
        data[p + 2] = src[p + 2];
        data[p + 3] = outA;
        if (!spec.keepUnderneath) {
          childCoverage[idx] = Math.min(1, childCoverage[idx] + m);
          if (spec.overlapTorso && m > 0.25) {
            deepOverlapCoverage[idx] = 1;
          }
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    layers.push({
      id: spec.id,
      z: spec.z,
      pivotX: spec.pivot[0] * w,
      pivotY: spec.pivot[1] * h,
      parent: spec.parent || null,
      waveAmp: spec.waveAmp || 0,
      waveFreq: spec.waveFreq || 1,
      waveAxis: spec.waveAxis || 'x',
      nearest,
      width: w,
      height: h,
      data,
      minX: minX <= maxX ? minX : 0,
      minY: minY <= maxY ? minY : 0,
      maxX: minX <= maxX ? maxX : 0,
      maxY: minY <= maxY ? maxY : 0,
      empty: minX > maxX,
    });
  }

  // 2. Build base/torso layer with hidden joint inpainting (radial neighbor diffusion)
  const baseSpec = layerSpecs.find((s) => s.isBase);
  if (baseSpec) {
    const data = new Uint8ClampedArray(n * 4);
    const holeMask = new Uint8Array(n);
    let minX = w, minY = h, maxX = -1, maxY = -1;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        const sa = src[p + 3];
        if (sa === 0) continue;
        const remain = clamp(1 - childCoverage[idx], 0, 1);
        if (remain > 0.35) {
          // Solid torso seed pixel (no moat between seeds and holeMask!)
          const boosted = clamp(remain * 1.45, 0, 1);
          data[p] = src[p];
          data[p + 1] = src[p + 1];
          data[p + 2] = src[p + 2];
          data[p + 3] = Math.round(sa * boosted);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        } else if (sa > 40) {
          holeMask[idx] = deepOverlapCoverage[idx] ? 2 : 1;
        }
      }
    }

    // Dual-depth outline-aware joint-seal inpainting:
    // - holeMask === 1 (protruding limbs like legs/tail/outer wings): 8px socket seal only (zero ghost limbs)
    // - holeMask === 2 (foreground limbs overlapping torso/belly/back): 34px deep fur/scale fill
    const filled = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] > 30) {
        filled[i] = 1;
      }
    }
    const shallowLimit = nearest ? 6 : 8;
    const deepLimit = nearest ? 20 : 34;
    const tmp = new Uint8ClampedArray(data);
    const tmpFilled = new Uint8Array(filled);
    for (let pass = 0; pass < deepLimit; pass++) {
      tmp.set(data);
      tmpFilled.set(filled);
      let anyChanged = false;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = y * w + x;
          const hm = holeMask[idx];
          if (!hm || tmpFilled[idx]) continue;
          if (hm === 1 && pass >= shallowLimit) continue;
          let sr = 0, sg = 0, sb = 0, sw = 0, maxA = 0, cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nCell = (y + dy) * w + (x + dx);
              if (!tmpFilled[nCell]) continue;
              const nIdx = nCell * 4;
              const na = tmp[nIdx + 3];
              if (na > 60) {
                const nr = tmp[nIdx];
                const ng = tmp[nIdx + 1];
                const nb = tmp[nIdx + 2];
                const lum = 0.299 * nr + 0.587 * ng + 0.114 * nb;
                const weight = lum < 55 ? 0.12 : 1.0;
                sr += nr * weight;
                sg += ng * weight;
                sb += nb * weight;
                sw += weight;
                if (na > maxA) maxA = na;
                cnt++;
              }
            }
          }
          if (cnt >= 2 && sw > 0) {
            const p = idx * 4;
            const origA = src[p + 3];
            data[p] = clamp(Math.round(sr / sw), 0, 255);
            data[p + 1] = clamp(Math.round(sg / sw), 0, 255);
            data[p + 2] = clamp(Math.round(sb / sw), 0, 255);
            data[p + 3] = Math.min(origA, maxA);
            filled[idx] = 1;
            anyChanged = true;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (!anyChanged) break;
    }

    layers.push({
      id: baseSpec.id,
      z: baseSpec.z,
      pivotX: baseSpec.pivot[0] * w,
      pivotY: baseSpec.pivot[1] * h,
      parent: baseSpec.parent || null,
      waveAmp: baseSpec.waveAmp || 0,
      waveFreq: baseSpec.waveFreq || 1,
      waveAxis: baseSpec.waveAxis || 'x',
      nearest,
      width: w,
      height: h,
      data,
      minX: minX <= maxX ? minX : 0,
      minY: minY <= maxY ? minY : 0,
      maxX: minX <= maxX ? maxX : 0,
      maxY: minY <= maxY ? maxY : 0,
      empty: minX > maxX,
    });
  }

  // Sort strictly back-to-front by Z depth (+0.002 step convention)
  layers.sort((a, b) => a.z - b.z);
  return layers;
}

// ============================================================================
// Hierarchical 2D Affine Composition with Premultiplied Bilinear Sampling
// ============================================================================

function composeAffine(a, b) {
  // 2x3 matrix [m00, m01, tx, m10, m11, ty]
  return [
    a[0] * b[0] + a[1] * b[3],
    a[0] * b[1] + a[1] * b[4],
    a[0] * b[2] + a[1] * b[5] + a[2],
    a[3] * b[0] + a[4] * b[3],
    a[3] * b[1] + a[4] * b[4],
    a[3] * b[2] + a[4] * b[5] + a[5],
  ];
}

function makeTransformAroundPivot(px, py, tx, ty, rot, sx, sy, shearX = 0) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // T(px + tx, py + ty) * R(rot) * Shear(shearX) * S(sx, sy) * T(-px, -py)
  const a00 = c * sx - s * 0;
  const a01 = c * (shearX * sy) - s * sy;
  const a10 = s * sx;
  const a11 = s * (shearX * sy) + c * sy;
  const otx = px + tx - (a00 * px + a01 * py);
  const oty = py + ty - (a10 * px + a11 * py);
  return [a00, a01, otx, a10, a11, oty];
}

function invertAffine(m) {
  const det = m[0] * m[4] - m[1] * m[3];
  if (Math.abs(det) < 1e-8) return null;
  const inv = 1 / det;
  const i00 = m[4] * inv;
  const i01 = -m[1] * inv;
  const i10 = -m[3] * inv;
  const i11 = m[0] * inv;
  return [
    i00,
    i01,
    -(i00 * m[2] + i01 * m[5]),
    i10,
    i11,
    -(i10 * m[2] + i11 * m[5]),
  ];
}

function renderLayerIntoCell(cellBuf, cellW, cellH, layer, worldMat, wavePhase = 0, extraWaveAmp = 0) {
  if (layer.empty) return;
  const inv = invertAffine(worldMat);
  if (!inv) return;

  // Transform layer's tight bounding box corners to destination cell space for fast culling
  const pad = Math.ceil((layer.waveAmp + extraWaveAmp) * cellW) + 3;
  const corners = [
    [layer.minX - 1, layer.minY - 1],
    [layer.maxX + 1, layer.minY - 1],
    [layer.minX - 1, layer.maxY + 1],
    [layer.maxX + 1, layer.maxY + 1],
  ];
  let dstMinX = cellW, dstMinY = cellH, dstMaxX = -1, dstMaxY = -1;
  for (const [cx, cy] of corners) {
    const dx = worldMat[0] * cx + worldMat[1] * cy + worldMat[2];
    const dy = worldMat[3] * cx + worldMat[4] * cy + worldMat[5];
    if (dx < dstMinX) dstMinX = dx;
    if (dx > dstMaxX) dstMaxX = dx;
    if (dy < dstMinY) dstMinY = dy;
    if (dy > dstMaxY) dstMaxY = dy;
  }

  const x0 = clamp(Math.floor(dstMinX) - pad, 0, cellW - 1);
  const x1 = clamp(Math.ceil(dstMaxX) + pad, 0, cellW - 1);
  const y0 = clamp(Math.floor(dstMinY) - pad, 0, cellH - 1);
  const y1 = clamp(Math.ceil(dstMaxY) + pad, 0, cellH - 1);
  if (x0 > x1 || y0 > y1) return;

  const src = layer.data;
  const sw = layer.width;
  const sh = layer.height;
  const nearest = layer.nearest;
  const waveAmpPx = (layer.waveAmp + extraWaveAmp) * sw;
  const waveFreq = layer.waveFreq;
  const waveAxis = layer.waveAxis;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let sx = inv[0] * x + inv[1] * y + inv[2];
      let sy = inv[3] * x + inv[4] * y + inv[5];

      if (waveAmpPx > 0.01) {
        if (waveAxis === 'x') {
          const distFromPivot = clamp((sy - layer.pivotY) / (sh * 0.45), -1, 1);
          sx += Math.sin(wavePhase + distFromPivot * waveFreq * Math.PI * 2) * waveAmpPx * Math.abs(distFromPivot);
        } else {
          const distFromPivot = clamp((sx - layer.pivotX) / (sw * 0.45), -1, 1);
          sy += Math.sin(wavePhase + distFromPivot * waveFreq * Math.PI * 2) * waveAmpPx * Math.abs(distFromPivot);
        }
      }

      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) continue;

      let sr, sg, sb, sa;
      if (nearest) {
        const ix = Math.round(sx);
        const iy = Math.round(sy);
        const sIdx = (iy * sw + ix) * 4;
        sa = src[sIdx + 3] / 255;
        if (sa <= 0.004) continue;
        sr = src[sIdx];
        sg = src[sIdx + 1];
        sb = src[sIdx + 2];
      } else {
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        const fx = sx - ix;
        const fy = sy - iy;
        const i00 = (iy * sw + ix) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + sw * 4;
        const i11 = i01 + 4;
        const a00 = src[i00 + 3] / 255;
        const a10 = src[i10 + 3] / 255;
        const a01 = src[i01 + 3] / 255;
        const a11 = src[i11 + 3] / 255;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        sa = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
        if (sa <= 0.004) continue;
        sr = (src[i00] * a00 * w00 + src[i10] * a10 * w10 + src[i01] * a01 * w01 + src[i11] * a11 * w11) / sa;
        sg = (src[i00 + 1] * a00 * w00 + src[i10 + 1] * a10 * w10 + src[i01 + 1] * a01 * w01 + src[i11 + 1] * a11 * w11) / sa;
        sb = (src[i00 + 2] * a00 * w00 + src[i10 + 2] * a10 * w10 + src[i01 + 2] * a01 * w01 + src[i11 + 2] * a11 * w11) / sa;
      }

      // Porter-Duff source-over alpha compositing
      const dIdx = (y * cellW + x) * 4;
      const da = cellBuf[dIdx + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA > 1e-4) {
        const invOutA = 1 / outA;
        cellBuf[dIdx] = clamp(Math.round((sr * sa + cellBuf[dIdx] * da * (1 - sa)) * invOutA), 0, 255);
        cellBuf[dIdx + 1] = clamp(Math.round((sg * sa + cellBuf[dIdx + 1] * da * (1 - sa)) * invOutA), 0, 255);
        cellBuf[dIdx + 2] = clamp(Math.round((sb * sa + cellBuf[dIdx + 2] * da * (1 - sa)) * invOutA), 0, 255);
        cellBuf[dIdx + 3] = clamp(Math.round(outA * 255), 0, 255);
      }
    }
  }
}

function renderRigFrame(cellBuf, cellW, cellH, layers, poseMap, wavePhase = 0) {
  cellBuf.fill(0);
  const worldMats = new Map();

  // Compute root matrix first (applied to all layers)
  const rootP = poseMap.root || {};
  const rootPivotX = (rootP.px ?? 0.5) * cellW;
  const rootPivotY = (rootP.py ?? 0.88) * cellH;
  const rootMat = makeTransformAroundPivot(
    rootPivotX,
    rootPivotY,
    (rootP.tx ?? 0) * cellW,
    (rootP.ty ?? 0) * cellH,
    rootP.rot ?? 0,
    rootP.sx ?? 1,
    rootP.sy ?? 1,
    rootP.shearX ?? 0,
  );
  worldMats.set('root', rootMat);

  function resolveWorld(layer) {
    if (worldMats.has(layer.id)) return worldMats.get(layer.id);
    const parentId = layer.parent || 'root';
    let parentMat = rootMat;
    if (parentId !== 'root') {
      const parentLayer = layers.find((l) => l.id === parentId);
      if (parentLayer) parentMat = resolveWorld(parentLayer);
    }
    const p = poseMap[layer.id] || {};
    const localMat = makeTransformAroundPivot(
      layer.pivotX,
      layer.pivotY,
      (p.tx ?? 0) * cellW,
      (p.ty ?? 0) * cellH,
      p.rot ?? 0,
      p.sx ?? 1,
      p.sy ?? 1,
      p.shearX ?? 0,
    );
    const world = composeAffine(parentMat, localMat);
    worldMats.set(layer.id, world);
    return world;
  }

  for (const layer of layers) {
    const worldMat = resolveWorld(layer);
    const p = poseMap[layer.id] || {};
    renderLayerIntoCell(cellBuf, cellW, cellH, layer, worldMat, wavePhase, p.extraWaveAmp || 0);
  }
}

function blitCell(atlas, atlasW, cellBuf, cellW, cellH, col, row) {
  const ox = col * cellW;
  const oy = row * cellH;
  for (let y = 0; y < cellH; y++) {
    const srcStart = y * cellW * 4;
    const dstStart = ((oy + y) * atlasW + ox) * 4;
    atlas.set(cellBuf.subarray(srcStart, srcStart + cellW * 4), dstStart);
  }
}

// ============================================================================
// Anatomical Segment Specifications (calibrated to real source PNG pixels)
// ============================================================================

const HERO_SEGMENTS = [
  { id: 'tail', z: 0.000, pivot: [0.37, 0.74], parent: 'torso', waveAmp: 0.012, waveFreq: 1.2, waveAxis: 'y', regions: [{ box: [0.23, 0.69, 0.375, 0.83] }] },
  { id: 'left_arm', z: 0.002, pivot: [0.395, 0.66], parent: 'torso', regions: [{ box: [0.29, 0.63, 0.402, 0.75] }] },
  { id: 'left_leg', z: 0.004, pivot: [0.42, 0.785], parent: 'root', regions: [{ box: [0.35, 0.77, 0.46, 0.93] }] },
  { id: 'torso', z: 0.006, pivot: [0.46, 0.77], parent: 'root', isBase: true, regions: [] },
  { id: 'right_leg', z: 0.008, pivot: [0.50, 0.785], parent: 'root', regions: [{ box: [0.46, 0.77, 0.58, 0.93] }] },
  { id: 'right_arm', z: 0.010, pivot: [0.535, 0.66], parent: 'torso', overlapTorso: true, regions: [{ box: [0.528, 0.63, 0.64, 0.76] }] },
  { id: 'head', z: 0.012, pivot: [0.47, 0.635], parent: 'torso', regions: [{ box: [0.20, 0.34, 0.70, 0.645] }] },
  { id: 'left_ear', z: 0.014, pivot: [0.36, 0.41], parent: 'head', regions: [{ box: [0.24, 0.20, 0.43, 0.43] }] },
  { id: 'right_ear', z: 0.014, pivot: [0.54, 0.40], parent: 'head', regions: [{ box: [0.46, 0.22, 0.65, 0.42] }] },
];

const MIAOU_SEGMENTS = [
  { id: 'spectral_tail', z: 0.000, pivot: [0.48, 0.52], parent: 'body', waveAmp: 0.028, waveFreq: 1.4, waveAxis: 'x', regions: [{ box: [0.24, 0.48, 0.78, 0.96] }] },
  { id: 'body', z: 0.004, pivot: [0.46, 0.44], parent: 'root', isBase: true, regions: [] },
  { id: 'right_paw', z: 0.006, pivot: [0.53, 0.40], parent: 'body', regions: [{ box: [0.53, 0.35, 0.70, 0.49] }] },
  { id: 'left_paw', z: 0.008, pivot: [0.37, 0.44], parent: 'body', overlapTorso: true, regions: [{ box: [0.32, 0.41, 0.45, 0.54] }] },
  { id: 'head', z: 0.010, pivot: [0.43, 0.37], parent: 'body', regions: [{ box: [0.22, 0.04, 0.58, 0.38] }] },
];

const MAYOR_SEGMENTS = [
  { id: 'tail', z: 0.000, pivot: [0.27, 0.61], parent: 'torso', waveAmp: 0.014, waveFreq: 1.1, waveAxis: 'x', regions: [{ box: [0.15, 0.43, 0.275, 0.66] }] },
  { id: 'legs', z: 0.002, pivot: [0.50, 0.85], parent: 'root', regions: [{ box: [0.32, 0.84, 0.70, 0.98] }] },
  { id: 'torso', z: 0.004, pivot: [0.50, 0.74], parent: 'root', isBase: true, regions: [] },
  { id: 'left_arm', z: 0.008, pivot: [0.30, 0.62], parent: 'torso', regions: [{ ell: [0.25, 0.71, 0.095, 0.145] }] },
  { id: 'scroll_arm', z: 0.010, pivot: [0.68, 0.62], parent: 'torso', overlapTorso: true, regions: [{ ell: [0.76, 0.67, 0.14, 0.145] }] },
  { id: 'head', z: 0.012, pivot: [0.51, 0.56], parent: 'torso', overlapTorso: true, regions: [{ box: [0.22, 0.07, 0.78, 0.59] }] },
];

const SLIME_SEGMENTS = [
  { id: 'body', z: 0.004, pivot: [0.50, 0.86], parent: 'root', isBase: true, regions: [] },
  { id: 'top_crest', z: 0.008, pivot: [0.50, 0.42], parent: 'body', keepUnderneath: true, regions: [{ ell: [0.50, 0.36, 0.36, 0.26] }] },
];

const GOBLIN_SEGMENTS = [
  { id: 'legs', z: 0.002, pivot: [0.31, 0.76], parent: 'root', regions: [{ box: [0.04, 0.75, 0.55, 0.97] }] },
  { id: 'torso', z: 0.004, pivot: [0.31, 0.62], parent: 'root', isBase: true, regions: [] },
  { id: 'head', z: 0.008, pivot: [0.31, 0.45], parent: 'torso', regions: [{ box: [0.04, 0.24, 0.47, 0.47] }] },
  { id: 'spear_banner', z: 0.012, pivot: [0.53, 0.42], parent: 'torso', waveAmp: 0.018, waveFreq: 1.5, waveAxis: 'x', regions: [{ box: [0.51, 0.10, 0.98, 0.72] }] },
];

const WOLF_SEGMENTS = [
  { id: 'tail', z: 0.000, pivot: [0.27, 0.76], parent: 'torso', waveAmp: 0.018, waveFreq: 1.2, waveAxis: 'x', regions: [{ box: [0.02, 0.48, 0.275, 0.86] }] },
  { id: 'back_legs', z: 0.002, pivot: [0.37, 0.79], parent: 'root', regions: [{ box: [0.27, 0.78, 0.47, 0.97] }] },
  { id: 'torso', z: 0.004, pivot: [0.47, 0.74], parent: 'root', isBase: true, regions: [] },
  { id: 'front_legs', z: 0.006, pivot: [0.56, 0.79], parent: 'root', regions: [{ box: [0.47, 0.78, 0.69, 0.97] }] },
  { id: 'head', z: 0.010, pivot: [0.55, 0.66], parent: 'torso', regions: [{ box: [0.44, 0.34, 0.98, 0.80] }] },
];

const SKELETON_SEGMENTS = [
  { id: 'left_leg', z: 0.002, pivot: [0.39, 0.73], parent: 'root', regions: [{ box: [0.28, 0.72, 0.43, 0.96] }] },
  { id: 'right_leg', z: 0.004, pivot: [0.45, 0.73], parent: 'root', regions: [{ box: [0.42, 0.72, 0.56, 0.96] }] },
  { id: 'torso', z: 0.006, pivot: [0.43, 0.62], parent: 'root', isBase: true, regions: [] },
  { id: 'left_arm', z: 0.008, pivot: [0.36, 0.54], parent: 'torso', regions: [{ box: [0.20, 0.52, 0.365, 0.79] }] },
  { id: 'right_arm_sword', z: 0.010, pivot: [0.50, 0.55], parent: 'torso', regions: [{ box: [0.485, 0.52, 0.80, 0.96] }] },
  { id: 'skull', z: 0.012, pivot: [0.42, 0.50], parent: 'torso', regions: [{ box: [0.22, 0.03, 0.60, 0.52] }] },
];

const GOLEM_SEGMENTS = [
  { id: 'frost_jet', z: 0.000, pivot: [0.53, 0.88], parent: 'root', waveAmp: 0.022, waveFreq: 1.8, waveAxis: 'x', regions: [{ box: [0.38, 0.78, 0.68, 0.97] }] },
  { id: 'torso', z: 0.004, pivot: [0.52, 0.50], parent: 'root', isBase: true, regions: [] },
  { id: 'head', z: 0.006, pivot: [0.52, 0.37], parent: 'torso', regions: [{ box: [0.38, 0.22, 0.68, 0.39] }] },
  { id: 'left_fist', z: 0.010, pivot: [0.22, 0.68], parent: 'torso', regions: [{ box: [0.02, 0.54, 0.34, 0.88] }] },
  { id: 'right_fist', z: 0.010, pivot: [0.82, 0.70], parent: 'torso', regions: [{ box: [0.68, 0.56, 0.98, 0.88] }] },
];

const RAT_KING_SEGMENTS = [
  { id: 'left_cloak', z: 0.000, pivot: [0.24, 0.48], parent: 'torso', waveAmp: 0.018, waveFreq: 1.2, waveAxis: 'x', regions: [{ box: [0.06, 0.44, 0.25, 0.96] }] },
  { id: 'right_cloak', z: 0.000, pivot: [0.76, 0.48], parent: 'torso', waveAmp: 0.018, waveFreq: 1.2, waveAxis: 'x', regions: [{ box: [0.75, 0.44, 0.94, 0.96] }] },
  { id: 'feet', z: 0.002, pivot: [0.50, 0.85], parent: 'root', regions: [{ box: [0.24, 0.84, 0.76, 0.97] }] },
  { id: 'torso', z: 0.006, pivot: [0.50, 0.68], parent: 'root', isBase: true, regions: [] },
  { id: 'crown_head', z: 0.010, pivot: [0.50, 0.48], parent: 'torso', regions: [{ box: [0.18, 0.02, 0.82, 0.50] }] },
];

const DRAGON_SEGMENTS = [
  { id: 'right_wing', z: 0.000, pivot: [0.58, 0.43], parent: 'torso', regions: [{ box: [0.52, 0.02, 0.82, 0.44] }] },
  { id: 'tail', z: 0.002, pivot: [0.28, 0.64], parent: 'torso', waveAmp: 0.016, waveFreq: 1.1, waveAxis: 'x', regions: [{ box: [0.05, 0.52, 0.46, 0.97] }], exclude: [{ box: [0.28, 0.52, 0.50, 0.85] }] },
  { id: 'torso', z: 0.004, pivot: [0.55, 0.72], parent: 'root', isBase: true, regions: [] },
  { id: 'left_wing', z: 0.008, pivot: [0.47, 0.48], parent: 'torso', overlapTorso: true, regions: [{ box: [0.08, 0.10, 0.49, 0.53] }] },
  { id: 'head', z: 0.012, pivot: [0.66, 0.54], parent: 'torso', overlapTorso: true, regions: [{ box: [0.63, 0.28, 0.96, 0.69] }] },
];

// ============================================================================
// 30 FPS Kinematic Motion Generators (Hero, NPC, 6-State Enemies & Bosses)
// ============================================================================

function heroIdlePose(i, total) {
  const ph = (i / total) * Math.PI * 2;
  const breath = Math.sin(ph);
  const earTwitch = Math.pow(Math.max(0, Math.sin(ph * 2 - 0.8)), 8) * 0.16;
  return {
    root: { px: 0.46, py: 0.88, sx: 1 - breath * 0.012, sy: 1 + breath * 0.018 },
    torso: { ty: -breath * 0.007, rot: Math.sin(ph * 0.5) * 0.018 },
    head: { ty: -breath * 0.006, rot: Math.sin(ph - 0.5) * 0.045 },
    left_ear: { rot: -0.04 - earTwitch },
    right_ear: { rot: 0.04 + earTwitch * 0.7 },
    left_arm: { rot: 0.08 + Math.sin(ph) * 0.08 },
    right_arm: { rot: -0.08 - Math.sin(ph) * 0.08 },
    tail: { rot: Math.sin(ph * 2) * 0.24 },
  };
}

function heroWalkPose(i, total) {
  const ph = (i / total) * Math.PI * 2;
  const stride = Math.sin(ph);
  const bob = Math.abs(stride);
  const liftL = Math.max(0, stride);
  const liftR = Math.max(0, -stride);
  return {
    root: { px: 0.46, py: 0.89, ty: -bob * 0.026, sx: 1.02 - bob * 0.03, sy: 0.98 + bob * 0.035 },
    torso: { rot: 0.07 + Math.sin(ph * 2) * 0.035 },
    head: { ty: -bob * 0.008, rot: -0.05 + Math.sin(ph * 2 - 0.6) * 0.055 },
    left_ear: { rot: -0.09 - bob * 0.08 },
    right_ear: { rot: -0.05 - bob * 0.07 },
    left_leg: { tx: stride * 0.032, ty: -liftL * 0.036, rot: -stride * 0.44 },
    right_leg: { tx: -stride * 0.032, ty: -liftR * 0.036, rot: stride * 0.44 },
    left_arm: { rot: stride * 0.46 },
    right_arm: { rot: -stride * 0.46 },
    tail: { rot: -0.18 + Math.sin(ph * 2 + 0.5) * 0.34 },
  };
}

function heroAttackPose(i, total) {
  const t = total > 1 ? i / (total - 1) : 0;
  let bodyRot = 0, bodyTx = 0, bodyTy = 0, rArmRot = 0, lArmRot = 0, headRot = 0, lLegRot = 0, rLegRot = 0, sx = 1, sy = 1;
  if (t < 0.28) {
    // Anticipation windup
    const u = smoothstep(0, 0.28, t);
    bodyRot = -0.22 * u;
    bodyTx = -0.032 * u;
    bodyTy = 0.015 * u;
    rArmRot = -1.25 * u;
    lArmRot = 0.45 * u;
    headRot = -0.12 * u;
    lLegRot = 0.25 * u;
    rLegRot = -0.15 * u;
    sx = 1 + 0.04 * u;
    sy = 1 - 0.04 * u;
  } else if (t < 0.62) {
    // Explosive forward slash lunge
    const u = smoothstep(0.28, 0.62, t);
    bodyRot = -0.22 + 0.56 * u;
    bodyTx = -0.032 + 0.088 * u;
    bodyTy = 0.015 - 0.025 * Math.sin(u * Math.PI);
    rArmRot = -1.25 + 2.55 * u;
    lArmRot = 0.45 - 0.85 * u;
    headRot = -0.12 + 0.24 * u;
    lLegRot = 0.25 - 0.65 * u;
    rLegRot = -0.15 + 0.55 * u;
    sx = 1.06;
    sy = 0.95;
  } else {
    // Snappy follow-through & settle
    const u = smoothstep(0.62, 1.0, t);
    bodyRot = 0.34 * (1 - u);
    bodyTx = 0.056 * (1 - u);
    rArmRot = 1.30 * (1 - u);
    lArmRot = -0.40 * (1 - u);
    headRot = 0.12 * (1 - u);
    lLegRot = -0.40 * (1 - u);
    rLegRot = 0.40 * (1 - u);
    sx = 1 + 0.06 * (1 - u);
    sy = 1 - 0.05 * (1 - u);
  }
  return {
    root: { px: 0.46, py: 0.88, tx: bodyTx, ty: bodyTy, sx, sy },
    torso: { rot: bodyRot },
    head: { rot: headRot },
    left_ear: { rot: -bodyRot * 0.5 - 0.12 },
    right_ear: { rot: -bodyRot * 0.5 - 0.08 },
    right_arm: { rot: rArmRot },
    left_arm: { rot: lArmRot },
    left_leg: { rot: lLegRot },
    right_leg: { rot: rLegRot },
    tail: { rot: -bodyRot * 1.4 - 0.2 },
  };
}

function heroRollPose(i, total) {
  const t = total > 1 ? i / (total - 1) : 0;
  if (t < 0.15) {
    const u = t / 0.15;
    return {
      root: { px: 0.46, py: 0.86, ty: 0.04 * u, sx: 1 + 0.1 * u, sy: 1 - 0.16 * u },
      torso: { rot: 0.35 * u },
      head: { ty: 0.04 * u, rot: 0.25 * u },
      left_arm: { rot: 0.7 * u },
      right_arm: { rot: -0.7 * u },
      left_leg: { rot: -0.5 * u },
      right_leg: { rot: 0.5 * u },
      tail: { rot: -0.4 * u },
    };
  }
  if (t < 0.85) {
    const u = (t - 0.15) / 0.70;
    const spin = u * Math.PI * 2;
    const arcY = -Math.sin(u * Math.PI) * 0.10;
    return {
      root: { px: 0.47, py: 0.62, ty: 0.06 + arcY, rot: spin, sx: 0.90, sy: 0.86 },
      torso: { rot: 0 },
      head: { ty: 0.05, rot: 0.18 },
      left_arm: { rot: 0.9 },
      right_arm: { rot: -0.9 },
      left_leg: { ty: -0.05, rot: -0.8 },
      right_leg: { ty: -0.05, rot: 0.8 },
      tail: { rot: -0.6 },
    };
  }
  const u = (t - 0.85) / 0.15;
  const inv = 1 - u;
  return {
    root: { px: 0.46, py: 0.88, ty: 0.03 * inv, sx: 1 + 0.12 * inv, sy: 1 - 0.14 * inv },
    torso: { rot: 0.18 * inv },
    head: { rot: -0.1 * inv },
    left_arm: { rot: 0.4 * inv },
    right_arm: { rot: -0.4 * inv },
    tail: { rot: 0.3 * inv },
  };
}

function miaouPose(i, total) {
  const ph = (i / total) * Math.PI * 2;
  const hover = Math.sin(ph) * 0.035;
  return {
    root: { px: 0.46, py: 0.50, ty: hover, rot: Math.sin(ph * 0.5) * 0.04 },
    body: { sx: 1 - Math.sin(ph) * 0.025, sy: 1 + Math.sin(ph) * 0.03 },
    head: { ty: Math.sin(ph - 0.5) * 0.012, rot: Math.sin(ph - 0.4) * 0.09 },
    left_paw: { ty: Math.sin(ph + 0.8) * 0.015, rot: Math.sin(ph + 0.8) * 0.18 },
    right_paw: { ty: Math.sin(ph - 0.6) * 0.015, rot: -0.06 + Math.sin(ph - 0.6) * 0.24 },
    spectral_tail: { rot: Math.sin(ph - 0.9) * 0.16, extraWaveAmp: 0.012 },
  };
}

function mayorPose(i) {
  // 45 frames: 0..14 idle, 15..29 talk, 30..44 greet
  const stateIdx = Math.floor(i / 15);
  const local = i % 15;
  const ph = (local / 15) * Math.PI * 2;
  if (stateIdx === 0) {
    // idle
    const b = Math.sin(ph);
    return {
      root: { px: 0.50, py: 0.94, sx: 1 - b * 0.014, sy: 1 + b * 0.022 },
      head: { ty: -b * 0.008, rot: Math.sin(ph - 0.5) * 0.045 },
      left_arm: { rot: Math.sin(ph) * 0.06 },
      scroll_arm: { rot: -Math.sin(ph) * 0.07 },
      tail: { rot: Math.sin(ph) * 0.22 },
    };
  }
  if (stateIdx === 1) {
    // talk: enthusiastic speaking nod & scroll gesture
    const talk = Math.abs(Math.sin(ph * 2));
    return {
      root: { px: 0.50, py: 0.94, ty: -talk * 0.018, sx: 1.02 - talk * 0.03, sy: 0.98 + talk * 0.04 },
      torso: { rot: Math.sin(ph) * 0.05 },
      head: { ty: -talk * 0.014, rot: Math.sin(ph * 2) * 0.11 },
      left_arm: { rot: 0.15 + Math.sin(ph * 2) * 0.22 },
      scroll_arm: { ty: -0.02 - talk * 0.02, rot: -0.25 - Math.sin(ph * 2) * 0.28 },
      tail: { rot: Math.sin(ph * 2) * 0.32 },
    };
  }
  // greet: warm welcoming wave with left paw + proud scroll flourish
  const wave = Math.sin(ph * 2);
  return {
    root: { px: 0.50, py: 0.94, ty: -Math.abs(Math.sin(ph)) * 0.022 },
    torso: { rot: -0.05 + Math.sin(ph) * 0.04 },
    head: { rot: 0.08 + Math.sin(ph) * 0.07 },
    left_arm: { ty: -0.02, rot: 0.38 + wave * 0.22 },
    scroll_arm: { rot: -0.22 + Math.sin(ph) * 0.16 },
    tail: { rot: Math.sin(ph * 2) * 0.36 },
  };
}

/**
 * 6-state enemy/boss 90-frame kinematic generator:
 *   0..14 idle, 15..29 move, 30..44 windup, 45..59 attack, 60..74 hurt, 75..89 death
 */
function enemySixStatePose(kind, frameIdx) {
  const stateIdx = Math.floor(frameIdx / 15);
  const local = frameIdx % 15;
  const ph = (local / 15) * Math.PI * 2;
  const t = local / 14;

  // Common hurt/death curves
  const hurtRecoil = Math.sin(t * Math.PI);
  const deathT = smoothstep(0, 1, t);

  if (kind === 'slime_yarn') {
    if (stateIdx === 0) {
      const s = Math.sin(ph);
      return {
        root: { px: 0.50, py: 0.92, sx: 1 + s * 0.08, sy: 1 - s * 0.08, shearX: Math.sin(ph + 0.7) * 0.04 },
        top_crest: { tx: Math.sin(ph) * 0.015, rot: Math.sin(ph) * 0.06 },
      };
    }
    if (stateIdx === 1) {
      const hop = Math.abs(Math.sin(ph));
      const squash = Math.cos(ph * 2);
      return {
        root: { px: 0.50, py: 0.92, ty: -hop * 0.14, sx: 1 - hop * 0.12 + squash * 0.05, sy: 1 + hop * 0.14 - squash * 0.05 },
        top_crest: { rot: Math.sin(ph) * 0.12 },
      };
    }
    if (stateIdx === 2) {
      // windup coil
      const coil = smoothstep(0, 1, t);
      return {
        root: { px: 0.50, py: 0.92, tx: -0.05 * coil, sx: 1 + 0.24 * coil, sy: 1 - 0.26 * coil, shearX: -0.14 * coil },
      };
    }
    if (stateIdx === 3) {
      // attack pounce
      const lunge = Math.sin(t * Math.PI);
      return {
        root: { px: 0.50, py: 0.92, tx: 0.12 * lunge, ty: -0.11 * lunge, sx: 1 + 0.16 * lunge, sy: 1 - 0.08 * lunge, shearX: 0.22 * lunge },
      };
    }
    if (stateIdx === 4) {
      return {
        root: { px: 0.50, py: 0.92, tx: -0.09 * hurtRecoil, sx: 1 - 0.14 * hurtRecoil, sy: 1 + 0.16 * hurtRecoil, rot: -0.18 * hurtRecoil },
      };
    }
    // death: melts into flat yarn puddle
    return {
      root: { px: 0.50, py: 0.93, ty: 0.06 * deathT, sx: 1 + 0.45 * deathT, sy: Math.max(0.18, 1 - 0.80 * deathT) },
    };
  }

  if (kind === 'mouse_goblin') {
    if (stateIdx === 0) {
      const b = Math.sin(ph);
      return {
        root: { px: 0.35, py: 0.92, sx: 1 - b * 0.02, sy: 1 + b * 0.025 },
        head: { rot: Math.sin(ph - 0.4) * 0.06 },
        spear_banner: { rot: Math.sin(ph) * 0.07, extraWaveAmp: 0.012 },
      };
    }
    if (stateIdx === 1) {
      const st = Math.sin(ph);
      const bob = Math.abs(st);
      return {
        root: { px: 0.35, py: 0.92, ty: -bob * 0.045 },
        torso: { rot: 0.08 + Math.sin(ph * 2) * 0.04 },
        legs: { tx: st * 0.03, rot: st * 0.16 },
        head: { rot: -0.04 + Math.sin(ph * 2) * 0.06 },
        spear_banner: { tx: st * 0.02, rot: -0.12 + st * 0.14, extraWaveAmp: 0.022 },
      };
    }
    if (stateIdx === 2) {
      const u = smoothstep(0, 1, t);
      return {
        root: { px: 0.35, py: 0.92, tx: -0.05 * u, sx: 1 + 0.05 * u, sy: 1 - 0.06 * u },
        torso: { rot: -0.20 * u },
        spear_banner: { tx: -0.08 * u, ty: -0.04 * u, rot: -0.45 * u },
      };
    }
    if (stateIdx === 3) {
      const u = Math.sin(t * Math.PI);
      return {
        root: { px: 0.35, py: 0.92, tx: 0.10 * u },
        torso: { rot: 0.24 * u },
        head: { rot: 0.10 * u },
        spear_banner: { tx: 0.14 * u, rot: 0.48 * u, extraWaveAmp: 0.02 },
      };
    }
    if (stateIdx === 4) {
      return {
        root: { px: 0.35, py: 0.92, tx: -0.07 * hurtRecoil },
        torso: { rot: -0.28 * hurtRecoil },
        head: { rot: -0.22 * hurtRecoil },
        spear_banner: { rot: -0.35 * hurtRecoil },
      };
    }
    return {
      root: { px: 0.40, py: 0.90, ty: 0.14 * deathT, rot: -1.35 * deathT, sy: 1 - 0.18 * deathT },
      spear_banner: { rot: 0.55 * deathT },
    };
  }

  if (kind === 'thorn_wolf') {
    if (stateIdx === 0) {
      const b = Math.sin(ph);
      return {
        root: { px: 0.48, py: 0.94, sx: 1 - b * 0.02, sy: 1 + b * 0.025 },
        head: { ty: -b * 0.01, rot: Math.sin(ph - 0.4) * 0.06 },
        tail: { rot: Math.sin(ph * 2) * 0.22 },
      };
    }
    if (stateIdx === 1) {
      // bounding gallop
      const g = Math.sin(ph);
      const hop = Math.max(0, Math.sin(ph + 0.4));
      return {
        root: { px: 0.48, py: 0.94, ty: -hop * 0.065 },
        torso: { rot: g * 0.10 },
        head: { rot: -g * 0.08, ty: -hop * 0.015 },
        front_legs: { tx: g * 0.04, ty: -Math.max(0, g) * 0.04, rot: -g * 0.38 },
        back_legs: { tx: -g * 0.04, ty: -Math.max(0, -g) * 0.04, rot: g * 0.38 },
        tail: { rot: -0.22 + Math.sin(ph + 0.8) * 0.28 },
      };
    }
    if (stateIdx === 2) {
      // crouched pounce windup
      const u = smoothstep(0, 1, t);
      return {
        root: { px: 0.48, py: 0.94, tx: -0.06 * u, ty: 0.04 * u, sx: 1 + 0.08 * u, sy: 1 - 0.14 * u },
        head: { ty: 0.03 * u, rot: -0.18 * u },
        tail: { rot: 0.35 * u },
      };
    }
    if (stateIdx === 3) {
      // fierce lunge bite
      const u = Math.sin(t * Math.PI);
      return {
        root: { px: 0.48, py: 0.94, tx: 0.11 * u, ty: -0.07 * u },
        torso: { rot: 0.14 * u },
        head: { tx: 0.05 * u, rot: 0.26 * u },
        front_legs: { rot: -0.45 * u },
        back_legs: { rot: 0.45 * u },
        tail: { rot: -0.35 * u },
      };
    }
    if (stateIdx === 4) {
      return {
        root: { px: 0.48, py: 0.94, tx: -0.08 * hurtRecoil },
        torso: { rot: -0.20 * hurtRecoil },
        head: { rot: -0.28 * hurtRecoil },
        tail: { rot: -0.30 * hurtRecoil },
      };
    }
    return {
      root: { px: 0.48, py: 0.93, ty: 0.12 * deathT, rot: -1.15 * deathT, sy: 1 - 0.22 * deathT },
      head: { rot: 0.35 * deathT },
      tail: { rot: -0.4 * deathT },
    };
  }

  if (kind === 'fishbone_skeleton') {
    if (stateIdx === 0) {
      const b = Math.sin(ph);
      return {
        root: { px: 0.43, py: 0.94 },
        torso: { ty: -b * 0.012, rot: Math.sin(ph) * 0.03 },
        skull: { ty: -b * 0.014, rot: Math.sin(ph * 2) * 0.08 },
        left_arm: { rot: 0.08 + Math.sin(ph) * 0.10 },
        right_arm_sword: { rot: -0.06 - Math.sin(ph) * 0.12 },
      };
    }
    if (stateIdx === 1) {
      const st = Math.sin(ph);
      const bob = Math.abs(st);
      return {
        root: { px: 0.43, py: 0.94, ty: -bob * 0.03 },
        torso: { rot: 0.06 + Math.sin(ph * 2) * 0.04 },
        skull: { rot: -0.06 + Math.sin(ph * 2) * 0.10 },
        left_leg: { tx: st * 0.035, ty: -Math.max(0, st) * 0.035, rot: -st * 0.42 },
        right_leg: { tx: -st * 0.035, ty: -Math.max(0, -st) * 0.035, rot: st * 0.42 },
        left_arm: { rot: st * 0.40 },
        right_arm_sword: { rot: -st * 0.36 },
      };
    }
    if (stateIdx === 2) {
      const u = smoothstep(0, 1, t);
      return {
        root: { px: 0.43, py: 0.94, tx: -0.04 * u },
        torso: { rot: -0.18 * u },
        skull: { rot: -0.15 * u },
        right_arm_sword: { ty: -0.05 * u, rot: -1.35 * u },
        left_arm: { rot: 0.38 * u },
      };
    }
    if (stateIdx === 3) {
      const u = Math.sin(t * Math.PI);
      return {
        root: { px: 0.43, py: 0.94, tx: 0.08 * u },
        torso: { rot: 0.25 * u },
        skull: { rot: 0.16 * u },
        right_arm_sword: { rot: 1.25 * u },
        left_arm: { rot: -0.45 * u },
      };
    }
    if (stateIdx === 4) {
      return {
        root: { px: 0.43, py: 0.94, tx: -0.07 * hurtRecoil },
        torso: { rot: -0.24 * hurtRecoil },
        skull: { tx: -0.03 * hurtRecoil, rot: -0.38 * hurtRecoil },
        right_arm_sword: { rot: -0.42 * hurtRecoil },
      };
    }
    // death: skeleton crumbles into scattered bones!
    return {
      root: { px: 0.43, py: 0.94, ty: 0.18 * deathT },
      torso: { ty: 0.16 * deathT, rot: 0.85 * deathT },
      skull: { tx: -0.12 * deathT, ty: 0.26 * deathT, rot: -1.45 * deathT },
      left_arm: { tx: -0.10 * deathT, ty: 0.14 * deathT, rot: 1.15 * deathT },
      right_arm_sword: { tx: 0.12 * deathT, ty: 0.12 * deathT, rot: -1.1 * deathT },
      left_leg: { rot: -0.75 * deathT },
      right_leg: { rot: 0.75 * deathT },
    };
  }

  if (kind === 'frost_golem') {
    if (stateIdx === 0) {
      const b = Math.sin(ph);
      return {
        root: { px: 0.52, py: 0.88 },
        torso: { ty: b * 0.022, rot: Math.sin(ph * 0.5) * 0.025 },
        head: { ty: b * 0.008 },
        left_fist: { ty: Math.sin(ph + 0.9) * 0.035, rot: Math.sin(ph) * 0.08 },
        right_fist: { ty: Math.sin(ph - 0.9) * 0.035, rot: -Math.sin(ph) * 0.08 },
        frost_jet: { sx: 1 + Math.sin(ph * 2) * 0.10, sy: 1 - Math.sin(ph * 2) * 0.12 },
      };
    }
    if (stateIdx === 1) {
      const st = Math.sin(ph);
      return {
        root: { px: 0.52, py: 0.88 },
        torso: { ty: -Math.abs(st) * 0.032, rot: 0.06 + st * 0.05 },
        left_fist: { tx: st * 0.055, ty: -Math.max(0, st) * 0.045, rot: st * 0.22 },
        right_fist: { tx: -st * 0.055, ty: -Math.max(0, -st) * 0.045, rot: -st * 0.22 },
        frost_jet: { sx: 1.12, sy: 1 + Math.sin(ph * 3) * 0.18 },
      };
    }
    if (stateIdx === 2) {
      // double fist overhead windup!
      const u = smoothstep(0, 1, t);
      return {
        root: { px: 0.52, py: 0.88 },
        torso: { ty: -0.04 * u, sx: 1 + 0.04 * u, sy: 1 + 0.04 * u },
        left_fist: { tx: 0.04 * u, ty: -0.18 * u, rot: 0.45 * u },
        right_fist: { tx: -0.04 * u, ty: -0.18 * u, rot: -0.45 * u },
        frost_jet: { sx: 1 + 0.25 * u, sy: 1 + 0.28 * u },
      };
    }
    if (stateIdx === 3) {
      // thunderous dual-fist ground slam!
      const u = Math.sin(t * Math.PI);
      return {
        root: { px: 0.52, py: 0.88 },
        torso: { ty: 0.06 * u, sx: 1 + 0.08 * u, sy: 1 - 0.08 * u },
        left_fist: { tx: -0.03 * u, ty: 0.14 * u, rot: -0.35 * u },
        right_fist: { tx: 0.03 * u, ty: 0.14 * u, rot: 0.35 * u },
        frost_jet: { sx: 1.35 * u + 0.85, sy: 0.7 },
      };
    }
    if (stateIdx === 4) {
      return {
        root: { px: 0.52, py: 0.88, tx: -0.06 * hurtRecoil },
        torso: { rot: -0.18 * hurtRecoil },
        left_fist: { tx: -0.06 * hurtRecoil, ty: -0.05 * hurtRecoil, rot: -0.3 * hurtRecoil },
        right_fist: { tx: 0.06 * hurtRecoil, ty: -0.05 * hurtRecoil, rot: 0.3 * hurtRecoil },
      };
    }
    // death: floating stones lose magic and drop to ground!
    return {
      root: { px: 0.52, py: 0.88 },
      torso: { ty: 0.24 * deathT, rot: 0.38 * deathT },
      head: { ty: 0.14 * deathT, rot: -0.45 * deathT },
      left_fist: { tx: -0.10 * deathT, ty: 0.16 * deathT, rot: -0.8 * deathT },
      right_fist: { tx: 0.10 * deathT, ty: 0.16 * deathT, rot: 0.8 * deathT },
      frost_jet: { sy: Math.max(0.05, 1 - deathT * 0.95), sx: Math.max(0.05, 1 - deathT * 0.95) },
    };
  }

  if (kind === 'boss_rat_king') {
    if (stateIdx === 0) {
      const b = Math.sin(ph);
      return {
        root: { px: 0.50, py: 0.94, sx: 1 - b * 0.02, sy: 1 + b * 0.025 },
        crown_head: { ty: -b * 0.012, rot: Math.sin(ph - 0.5) * 0.05 },
        left_cloak: { rot: Math.sin(ph) * 0.09 },
        right_cloak: { rot: -Math.sin(ph) * 0.09 },
      };
    }
    if (stateIdx === 1) {
      const st = Math.sin(ph);
      const bob = Math.abs(st);
      return {
        root: { px: 0.50, py: 0.94, ty: -bob * 0.045 },
        torso: { rot: st * 0.07 },
        crown_head: { ty: -bob * 0.015, rot: -st * 0.06 },
        left_cloak: { rot: 0.14 + st * 0.18, extraWaveAmp: 0.018 },
        right_cloak: { rot: -0.14 + st * 0.18, extraWaveAmp: 0.018 },
        feet: { tx: st * 0.025 },
      };
    }
    if (stateIdx === 2) {
      const u = smoothstep(0, 1, t);
      return {
        root: { px: 0.50, py: 0.94, ty: -0.03 * u, sx: 1 + 0.08 * u, sy: 1 + 0.05 * u },
        crown_head: { ty: -0.025 * u, rot: -0.10 * u },
        left_cloak: { rot: 0.42 * u },
        right_cloak: { rot: -0.42 * u },
      };
    }
    if (stateIdx === 3) {
      const u = Math.sin(t * Math.PI);
      return {
        root: { px: 0.50, py: 0.94, tx: 0.08 * u, ty: 0.02 * u, sx: 1.08, sy: 0.94 },
        torso: { rot: 0.16 * u },
        crown_head: { tx: 0.03 * u, rot: 0.14 * u },
        left_cloak: { rot: -0.35 * u },
        right_cloak: { rot: 0.35 * u },
      };
    }
    if (stateIdx === 4) {
      return {
        root: { px: 0.50, py: 0.94, tx: -0.07 * hurtRecoil },
        torso: { rot: -0.20 * hurtRecoil },
        crown_head: { ty: -0.03 * hurtRecoil, rot: -0.26 * hurtRecoil },
        left_cloak: { rot: 0.25 * hurtRecoil },
        right_cloak: { rot: -0.25 * hurtRecoil },
      };
    }
    return {
      root: { px: 0.50, py: 0.93, ty: 0.16 * deathT, rot: -1.25 * deathT, sy: 1 - 0.20 * deathT },
      crown_head: { tx: 0.08 * deathT, ty: -0.06 * deathT, rot: 0.65 * deathT },
    };
  }

  // boss_dragon_claw & boss_dragon_claw_p2
  const rage = kind === 'boss_dragon_claw_p2' ? 1.32 : 1.0;
  if (stateIdx === 0) {
    const b = Math.sin(ph);
    return {
      root: { px: 0.55, py: 0.92, sx: 1 - b * 0.018 * rage, sy: 1 + b * 0.022 * rage },
      left_wing: { rot: -0.08 + Math.sin(ph) * 0.20 * rage },
      right_wing: { rot: 0.08 - Math.sin(ph) * 0.20 * rage },
      head: { ty: -b * 0.014 * rage, rot: Math.sin(ph - 0.5) * 0.08 * rage },
      tail: { rot: Math.sin(ph + 0.6) * 0.16 * rage, extraWaveAmp: 0.014 * rage },
    };
  }
  if (stateIdx === 1) {
    // sweeping dragon wingbeats + forward stalk
    const flap = Math.sin(ph);
    const lift = Math.max(0, -flap);
    return {
      root: { px: 0.55, py: 0.92, ty: -lift * 0.055 * rage },
      torso: { rot: 0.05 * rage + flap * 0.04 },
      left_wing: { rot: -0.18 + flap * 0.42 * rage },
      right_wing: { rot: 0.18 - flap * 0.42 * rage },
      head: { tx: 0.02 * rage, rot: -flap * 0.09 * rage },
      tail: { rot: -0.12 + Math.sin(ph - 0.8) * 0.24 * rage, extraWaveAmp: 0.02 * rage },
    };
  }
  if (stateIdx === 2) {
    // majestic wings-wide fiery roar windup
    const u = smoothstep(0, 1, t);
    return {
      root: { px: 0.55, py: 0.92, tx: -0.05 * u, ty: -0.03 * u, sx: 1 + 0.04 * u, sy: 1 + 0.06 * u },
      torso: { rot: -0.14 * u * rage },
      left_wing: { rot: -0.58 * u * rage },
      right_wing: { rot: 0.55 * u * rage },
      head: { ty: -0.05 * u, rot: -0.30 * u * rage },
      tail: { rot: 0.34 * u * rage },
    };
  }
  if (stateIdx === 3) {
    // ferocious forward bite / claw lunge
    const u = Math.sin(t * Math.PI);
    return {
      root: { px: 0.55, py: 0.92, tx: 0.09 * u * rage },
      torso: { rot: 0.18 * u * rage },
      left_wing: { rot: 0.36 * u * rage },
      right_wing: { rot: -0.32 * u * rage },
      head: { tx: 0.06 * u * rage, ty: 0.02 * u, rot: 0.28 * u * rage },
      tail: { rot: -0.30 * u * rage },
    };
  }
  if (stateIdx === 4) {
    return {
      root: { px: 0.55, py: 0.92, tx: -0.07 * hurtRecoil },
      torso: { rot: -0.20 * hurtRecoil },
      left_wing: { rot: -0.35 * hurtRecoil },
      right_wing: { rot: 0.35 * hurtRecoil },
      head: { rot: -0.32 * hurtRecoil },
    };
  }
  // death: epic dragon collapse
  return {
    root: { px: 0.55, py: 0.93, ty: 0.16 * deathT, rot: -0.68 * deathT, sy: 1 - 0.28 * deathT },
    left_wing: { ty: 0.10 * deathT, rot: 0.72 * deathT },
    right_wing: { ty: 0.10 * deathT, rot: -0.72 * deathT },
    head: { ty: 0.12 * deathT, rot: 0.45 * deathT },
    tail: { rot: -0.45 * deathT },
  };
}

// ============================================================================
// Specialized Pixel-Space Animators (Dragon P2, Torch, Exit Portal, Chest)
// ============================================================================

function applyDragonPhase2MagmaShader(cellBuf, w, h, frameIdx) {
  const pulse = 0.65 + 0.35 * Math.sin((frameIdx / 15) * Math.PI * 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = cellBuf[i + 3];
      if (a < 20) continue;
      let r = cellBuf[i];
      let g = cellBuf[i + 1];
      let b = cellBuf[i + 2];

      // Check silhouette rim for volcanic crimson-orange aura
      const isEdge =
        x > 1 && x < w - 2 && y > 1 && y < h - 2 &&
        (cellBuf[i - 8 + 3] < 40 || cellBuf[i + 8 + 3] < 40 || cellBuf[i - w * 8 + 3] < 40 || cellBuf[i + w * 8 + 3] < 40);

      // Animated magma veins on bright golden scales
      const luma = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
      const vein = Math.sin(x * 0.11 + y * 0.09 - frameIdx * 0.42) * Math.cos(x * 0.07 - y * 0.12 + frameIdx * 0.25);
      const magma = vein > 0.55 && luma > 0.32 ? (vein - 0.55) * 2.2 * pulse : 0;

      // Deepen crimson & ignite incandescent magma highlights
      r = clamp(Math.round(r * 1.18 + 36 * pulse + magma * 140 + (isEdge ? 95 * pulse : 0)), 0, 255);
      g = clamp(Math.round(g * 0.72 + magma * 85 + (isEdge ? 24 * pulse : 0)), 0, 255);
      b = clamp(Math.round(b * 0.55 + (isEdge ? 8 : 0)), 0, 255);
      cellBuf[i] = r;
      cellBuf[i + 1] = g;
      cellBuf[i + 2] = b;
    }
  }
}

function renderTorchFrame(cellBuf, w, h, srcImg, frameIdx, totalFrames) {
  cellBuf.fill(0);
  const src = srcImg.data;
  const sw = srcImg.width;
  const sh = srcImg.height;
  const ph = (frameIdx / totalFrames) * Math.PI * 2;
  const flick = 1 + Math.sin(ph * 2) * 0.07 + Math.cos(ph * 3) * 0.04;

  for (let y = 0; y < h; y++) {
    const ny = y / h;
    // Handle stays rock solid below ny = 0.50; flame dances seamlessly above!
    const flameWeight = 1 - smoothstep(0.36, 0.54, ny);
    const tipWeight = 1 - smoothstep(0.06, 0.46, ny);
    const waveX =
      flameWeight *
      (Math.sin(ph + ny * 9.5) * 0.042 + Math.sin(ph * 2 - ny * 15.0) * 0.018) *
      (0.35 + tipWeight * 0.95);
    const stretchY = flameWeight * (Math.sin(ph * 2 + 0.5) * 0.025 + Math.cos(ph) * 0.018);

    for (let x = 0; x < w; x++) {
      const nx = x / w;
      const sx = clamp((nx - waveX) * sw, 0, sw - 1.001);
      const sy = clamp((ny + stretchY * (0.52 - ny)) * sh, 0, sh - 1.001);

      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      const fx = sx - ix;
      const fy = sy - iy;
      const i00 = (iy * sw + ix) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const a00 = src[i00 + 3] / 255;
      const a10 = src[i10 + 3] / 255;
      const a01 = src[i01 + 3] / 255;
      const a11 = src[i11 + 3] / 255;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const sa = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
      if (sa <= 0.005) continue;

      let r = (src[i00] * a00 * w00 + src[i10] * a10 * w10 + src[i01] * a01 * w01 + src[i11] * a11 * w11) / sa;
      let g = (src[i00 + 1] * a00 * w00 + src[i10 + 1] * a10 * w10 + src[i01 + 1] * a01 * w01 + src[i11 + 1] * a11 * w11) / sa;
      let b = (src[i00 + 2] * a00 * w00 + src[i10 + 2] * a10 * w10 + src[i01 + 2] * a01 * w01 + src[i11 + 2] * a11 * w11) / sa;

      if (flameWeight > 0.05) {
        const boost = 1 + (flick - 1) * flameWeight * 1.4;
        r = clamp(Math.round(r * boost + 12 * flameWeight * Math.max(0, Math.sin(ph * 2))), 0, 255);
        g = clamp(Math.round(g * (0.96 + 0.12 * Math.sin(ph + ny * 6))), 0, 255);
        b = clamp(Math.round(b), 0, 255);
      }
      const dIdx = (y * w + x) * 4;
      cellBuf[dIdx] = r;
      cellBuf[dIdx + 1] = g;
      cellBuf[dIdx + 2] = b;
      cellBuf[dIdx + 3] = clamp(Math.round(sa * 255), 0, 255);
    }
  }

  // Rising golden ember sparks (seamless 15-frame loop)
  for (let e = 0; e < 5; e++) {
    const et = ((frameIdx / totalFrames) + e * 0.2) % 1;
    const ex = (0.56 + Math.sin(et * Math.PI * 2 + e * 2.1) * 0.10 + (e - 2) * 0.03) * w;
    const ey = (0.42 - et * 0.36) * h;
    const eAlpha = Math.sin(et * Math.PI) * 0.92;
    const rad = Math.max(2, w * (0.015 * (1 - et * 0.5)));
    const x0 = clamp(Math.floor(ex - rad - 1), 0, w - 1);
    const x1 = clamp(Math.ceil(ex + rad + 1), 0, w - 1);
    const y0 = clamp(Math.floor(ey - rad - 1), 0, h - 1);
    const y1 = clamp(Math.ceil(ey + rad + 1), 0, h - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - ex, y - ey) / rad;
        if (d >= 1) continue;
        const sa = (1 - d * d) * eAlpha;
        const dIdx = (y * w + x) * 4;
        const da = cellBuf[dIdx + 3] / 255;
        const outA = Math.min(1, da + sa);
        cellBuf[dIdx] = clamp(Math.round(cellBuf[dIdx] * (1 - sa) + 255 * sa), 0, 255);
        cellBuf[dIdx + 1] = clamp(Math.round(cellBuf[dIdx + 1] * (1 - sa) + 210 * sa), 0, 255);
        cellBuf[dIdx + 2] = clamp(Math.round(cellBuf[dIdx + 2] * (1 - sa) + 80 * sa), 0, 255);
        cellBuf[dIdx + 3] = clamp(Math.round(outA * 255), 0, 255);
      }
    }
  }
}

function renderPortalExitFrame(cellBuf, w, h, srcImg, frameIdx, totalFrames) {
  // Base stone archway from portal_dungeon.png + swirling runic turquoise/gold vortex inside
  cellBuf.set(srcImg.data);
  const ph = (frameIdx / totalFrames) * Math.PI * 2;
  const cx = w * 0.50;
  const cy = h * 0.57;
  const rx = w * 0.25;
  const ry = h * 0.27;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const r = Math.hypot(dx, dy);
      if (r > 1.15) continue;

      const angle = Math.atan2(dy, dx);
      // Spiral vortex arms rotating smoothly at 30 FPS
      const swirl1 = Math.sin(angle * 4 - r * 7.5 + ph * 2) * 0.5 + 0.5;
      const swirl2 = Math.sin(angle * 6 + r * 5.0 - ph * 3) * 0.5 + 0.5;
      // Counter-rotating outer runic ring
      const ringDist = Math.abs(r - 0.82);
      const runeTick = Math.sin(angle * 12 - ph * 2) > 0.25 ? 1 : 0.2;
      const ringGlow = Math.exp(-ringDist * ringDist * 95) * runeTick;
      // Bright arcane core
      const coreGlow = Math.exp(-r * r * 3.8) * (0.85 + 0.15 * Math.sin(ph * 2));
      const apertureMask = 1 - smoothstep(0.76, 1.05, r);

      const intensity = clamp(
        apertureMask * (0.35 + swirl1 * 0.45 + swirl2 * 0.25 + coreGlow * 0.75) + ringGlow * 0.9,
        0,
        1,
      );
      if (intensity <= 0.02) continue;

      // Turquoise-cyan vortex with golden arcane runes & bright white-gold center
      const vr = clamp(Math.round(52 + coreGlow * 200 + ringGlow * 210 + swirl2 * 40), 0, 255);
      const vg = clamp(Math.round(218 + coreGlow * 37 + ringGlow * 35), 0, 255);
      const vb = clamp(Math.round(230 + swirl1 * 25 - ringGlow * 90), 0, 255);

      const dIdx = (y * w + x) * 4;
      const blend = clamp(intensity * (0.85 * apertureMask + 0.75 * ringGlow), 0, 0.96);
      const da = cellBuf[dIdx + 3] / 255;
      const outA = Math.min(1, da + blend * (1 - da));
      cellBuf[dIdx] = clamp(Math.round(cellBuf[dIdx] * (1 - blend) + vr * blend), 0, 255);
      cellBuf[dIdx + 1] = clamp(Math.round(cellBuf[dIdx + 1] * (1 - blend) + vg * blend), 0, 255);
      cellBuf[dIdx + 2] = clamp(Math.round(cellBuf[dIdx + 2] * (1 - blend) + vb * blend), 0, 255);
      cellBuf[dIdx + 3] = clamp(Math.round(outA * 255), 0, 255);
    }
  }
}

/**
 * Smooth 15-frame 30 FPS articulated chest opening (`chest_opening_sheet.png`)
 * strictly derived from `chest_closed.png` & `chest_open.png`.
 */
function renderChestOpeningFrame(cellBuf, w, h, closedImg, openImg, frameIdx, totalFrames) {
  cellBuf.fill(0);
  const t = totalFrames > 1 ? frameIdx / (totalFrames - 1) : 1;

  // Phase 1 (0..0.20): anticipation squash & tiny latch rattle on chest_closed
  // Phase 2 (0.20..0.82): segmented lid smoothly lifts & pivots open around back hinge while treasure reveals
  // Phase 3 (0.82..1.00): springy bounce settle onto chest_open
  let squashX = 1, squashY = 1, rattleX = 0, lidOpen = 0, burst = 0;
  if (t < 0.22) {
    const u = t / 0.22;
    const s = Math.sin(u * Math.PI);
    squashX = 1 + 0.08 * s;
    squashY = 1 - 0.10 * s;
    rattleX = Math.sin(u * Math.PI * 4) * 0.012;
  } else if (t < 0.84) {
    const u = (t - 0.22) / 0.62;
    // Smooth back-out easing for lid opening
    const ease = 1 - Math.pow(1 - u, 3);
    lidOpen = ease;
    const pop = Math.sin(u * Math.PI);
    squashX = 1 - 0.05 * pop;
    squashY = 1 + 0.08 * pop;
    burst = Math.sin(u * Math.PI) * 0.95;
  } else {
    const u = (t - 0.84) / 0.16;
    const settle = Math.sin(u * Math.PI) * (1 - u);
    lidOpen = 1;
    squashX = 1 + 0.04 * settle;
    squashY = 1 - 0.05 * settle;
    burst = (1 - u) * 0.35;
  }

  // Build segmented chest layers on the fly:
  // - Base of chest_open (bottom body + treasure) revealed progressively as lid lifts
  // - Lid of chest_closed lifting & tilting back smoothly up to mid-transition, seamlessly morphing into chest_open's open lid!
  const openBaseMat = makeTransformAroundPivot(w * 0.5, h * 0.92, rattleX * w, 0, 0, squashX, squashY);
  const invBase = invertAffine(openBaseMat);
  const lidAngle = -lidOpen * 0.52;
  const lidLiftY = -lidOpen * 0.16 * h;
  const lidMat = makeTransformAroundPivot(w * 0.32, h * 0.44, rattleX * w - lidOpen * 0.04 * w, lidLiftY, lidAngle, squashX, squashY * (1 - lidOpen * 0.15));
  const invLid = invertAffine(lidMat);

  const cData = closedImg.data;
  const oData = openImg.data;

  function sample(data, sx, sy) {
    if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) return [0, 0, 0, 0];
    const ix = Math.floor(sx), iy = Math.floor(sy);
    const fx = sx - ix, fy = sy - iy;
    const i00 = (iy * w + ix) * 4, i10 = i00 + 4, i01 = i00 + w * 4, i11 = i01 + 4;
    const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
    const a00 = data[i00 + 3] / 255, a10 = data[i10 + 3] / 255, a01 = data[i01 + 3] / 255, a11 = data[i11 + 3] / 255;
    const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
    if (a <= 0.004) return [0, 0, 0, 0];
    const r = (data[i00] * a00 * w00 + data[i10] * a10 * w10 + data[i01] * a01 * w01 + data[i11] * a11 * w11) / a;
    const g = (data[i00 + 1] * a00 * w00 + data[i10 + 1] * a10 * w10 + data[i01 + 1] * a01 * w01 + data[i11 + 1] * a11 * w11) / a;
    const b = (data[i00 + 2] * a00 * w00 + data[i10 + 2] * a10 * w10 + data[i01 + 2] * a01 * w01 + data[i11 + 2] * a11 * w11) / a;
    return [r, g, b, a];
  }

  function over(dst, idx, r, g, b, sa) {
    if (sa <= 0.004) return;
    const da = dst[idx + 3] / 255;
    const outA = sa + da * (1 - sa);
    if (outA <= 1e-4) return;
    dst[idx] = clamp(Math.round((r * sa + dst[idx] * da * (1 - sa)) / outA), 0, 255);
    dst[idx + 1] = clamp(Math.round((g * sa + dst[idx + 1] * da * (1 - sa)) / outA), 0, 255);
    dst[idx + 2] = clamp(Math.round((b * sa + dst[idx + 2] * da * (1 - sa)) / outA), 0, 255);
    dst[idx + 3] = clamp(Math.round(outA * 255), 0, 255);
  }

  const openReveal = smoothstep(0.02, 0.62, lidOpen);
  const closedLidFade = 1 - smoothstep(0.24, 0.72, lidOpen);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const bx = invBase[0] * x + invBase[1] * y + invBase[2];
      const by = invBase[3] * x + invBase[4] * y + invBase[5];
      const nby = by / h;

      // 1. Open chest (interior + treasure + open lid) reveals immediately behind the rising lid
      if (openReveal > 0.01) {
        const [or, og, ob, oa] = sample(oData, bx, by);
        over(cellBuf, idx, or, og, ob, oa * openReveal);
      }

      // 2. Closed chest lower body (y >= 0.46) transitions seamlessly to open chest body
      if (1 - openReveal > 0.01) {
        const bodyMask = smoothstep(0.42, 0.50, nby);
        if (bodyMask > 0.01) {
          const [cr, cg, cb, ca] = sample(cData, bx, by);
          over(cellBuf, idx, cr, cg, cb, ca * bodyMask * (1 - openReveal));
        }
      }

      // 3. Articulated closed chest lid rotating upward around back hinge
      if (closedLidFade > 0.01) {
        const lx = invLid[0] * x + invLid[1] * y + invLid[2];
        const ly = invLid[3] * x + invLid[4] * y + invLid[5];
        const nly = ly / h;
        const lidMask = 1 - smoothstep(0.47, 0.54, nly);
        if (lidMask > 0.01) {
          const [lr, lg, lb, la] = sample(cData, lx, ly);
          over(cellBuf, idx, lr, lg, lb, la * lidMask * closedLidFade);
        }
      }

      // 4. Golden treasure burst light rising out of the opening seam!
      if (burst > 0.02) {
        const gx = (x / w - 0.52) / 0.28;
        const gy = (y / h - (0.48 - lidOpen * 0.12)) / 0.22;
        const gd = Math.hypot(gx, gy);
        if (gd < 1.0) {
          const glow = Math.pow(1 - gd, 2.2) * burst * 0.72;
          over(cellBuf, idx, 255, 232, 128, glow);
        }
      }
    }
  }
}

// ============================================================================
// Main Job Runner (reads JSON spec list from argv[2])
// ============================================================================

function getRigSpecForSheet(sheetId) {
  switch (sheetId) {
    case 'hero_base_idle':
    case 'hero_base_walk':
    case 'hero_base_attack':
    case 'hero_base_roll':
      return { segments: HERO_SEGMENTS, nearest: false };
    case 'miaou_sprit':
      return { segments: MIAOU_SEGMENTS, nearest: false };
    case 'mayor_moustache':
      return { segments: MAYOR_SEGMENTS, nearest: false };
    case 'slime_yarn':
      return { segments: SLIME_SEGMENTS, nearest: true };
    case 'mouse_goblin':
      return { segments: GOBLIN_SEGMENTS, nearest: true };
    case 'thorn_wolf':
      return { segments: WOLF_SEGMENTS, nearest: false };
    case 'fishbone_skeleton':
      return { segments: SKELETON_SEGMENTS, nearest: false };
    case 'frost_golem':
      return { segments: GOLEM_SEGMENTS, nearest: false };
    case 'boss_rat_king':
      return { segments: RAT_KING_SEGMENTS, nearest: true };
    case 'boss_dragon_claw':
    case 'boss_dragon_claw_p2':
      return { segments: DRAGON_SEGMENTS, nearest: true };
    default:
      return null;
  }
}

function getPoseForSheet(sheetId, frameIdx, totalFrames) {
  if (sheetId === 'hero_base_idle') return heroIdlePose(frameIdx, totalFrames);
  if (sheetId === 'hero_base_walk') return heroWalkPose(frameIdx, totalFrames);
  if (sheetId === 'hero_base_attack') return heroAttackPose(frameIdx, totalFrames);
  if (sheetId === 'hero_base_roll') return heroRollPose(frameIdx, totalFrames);
  if (sheetId === 'miaou_sprit') return miaouPose(frameIdx, totalFrames);
  if (sheetId === 'mayor_moustache') return mayorPose(frameIdx);
  return enemySixStatePose(sheetId, frameIdx);
}

function main() {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error('Usage: node bake_25d_rasterizer.mjs <jobs.json>');
    process.exit(1);
  }
  const jobs = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
  const t0 = Date.now();
  const decodedCache = new Map();

  function loadSource(srcPath) {
    if (!decodedCache.has(srcPath)) {
      decodedCache.set(srcPath, decodePng(srcPath));
    }
    return decodedCache.get(srcPath);
  }

  for (const job of jobs) {
    const jStart = Date.now();
    const { id, sourcePath, secondarySourcePath, outputPath, cols, rows, cellWidth, cellHeight, frameCount } = job;
    const atlasW = cols * cellWidth;
    const atlasH = rows * cellHeight;
    const atlas = new Uint8ClampedArray(atlasW * atlasH * 4);
    const cellBuf = new Uint8ClampedArray(cellWidth * cellHeight * 4);

    if (id === 'prop_torch') {
      const src = resizeRgba(loadSource(sourcePath), cellWidth, cellHeight, false);
      for (let f = 0; f < frameCount; f++) {
        renderTorchFrame(cellBuf, cellWidth, cellHeight, src, f, frameCount);
        blitCell(atlas, atlasW, cellBuf, cellWidth, cellHeight, f % cols, Math.floor(f / cols));
      }
    } else if (id === 'portal_exit') {
      const src = resizeRgba(loadSource(sourcePath), cellWidth, cellHeight, false);
      for (let f = 0; f < frameCount; f++) {
        renderPortalExitFrame(cellBuf, cellWidth, cellHeight, src, f, frameCount);
        blitCell(atlas, atlasW, cellBuf, cellWidth, cellHeight, f % cols, Math.floor(f / cols));
      }
    } else if (id === 'chest_opening') {
      const closedImg = resizeRgba(loadSource(sourcePath), cellWidth, cellHeight, false);
      const openImg = resizeRgba(loadSource(secondarySourcePath), cellWidth, cellHeight, false);
      for (let f = 0; f < frameCount; f++) {
        renderChestOpeningFrame(cellBuf, cellWidth, cellHeight, closedImg, openImg, f, frameCount);
        blitCell(atlas, atlasW, cellBuf, cellWidth, cellHeight, f % cols, Math.floor(f / cols));
      }
    } else {
      const rigSpec = getRigSpecForSheet(id);
      if (!rigSpec) throw new Error(`No rig spec for sheet id: ${id}`);
      const resized = resizeRgba(loadSource(sourcePath), cellWidth, cellHeight, rigSpec.nearest);
      const layers = buildSegmentedLayers(resized, rigSpec.segments, rigSpec.nearest);

      for (let f = 0; f < frameCount; f++) {
        const pose = getPoseForSheet(id, f, frameCount);
        const wavePhase = ((f % 15) / 15) * Math.PI * 2;
        renderRigFrame(cellBuf, cellWidth, cellHeight, layers, pose, wavePhase);
        if (id === 'boss_dragon_claw_p2') {
          applyDragonPhase2MagmaShader(cellBuf, cellWidth, cellHeight, f);
        }
        blitCell(atlas, atlasW, cellBuf, cellWidth, cellHeight, f % cols, Math.floor(f / cols));
      }
    }

    encodePng(outputPath, atlasW, atlasH, atlas);
    const ms = Date.now() - jStart;
    console.log(`[2.5D-BAKE] ${id}: ${atlasW}x${atlasH} (${cols}x${rows}=${frameCount}f) -> ${path.relative(process.cwd(), outputPath)} (${ms} ms)`);
  }

  console.log(`[2.5D-BAKE] Completed ${jobs.length} spritesheets in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
}

main();
