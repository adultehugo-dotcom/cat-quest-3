#!/usr/bin/env python3
"""
Pipeline PBR & Props Diorama pour *Les Chroniques de Félingard*.

Usage:
  uv run --with pillow --with numpy python scripts/process_world_assets.py textures
  uv run --with pillow --with numpy python scripts/process_world_assets.py props --raw-dir <dir>
  uv run --with pillow --with numpy python scripts/process_world_assets.py download-prop-materials --out-dir <dir>
"""

from __future__ import annotations

import argparse
import concurrent.futures
import io
import json
import math
import os
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
TEXTURES_OUT = REPO_ROOT / "public" / "assets" / "textures"
PROPS_OUT = REPO_ROOT / "public" / "assets" / "props"
DEFAULT_CACHE = Path(
    r"C:\Users\hugos\.gemini\antigravity\brain\d08fb875-90d0-424e-846e-d1f51a6a3d31\scratch\pbr_raw"
)
DEFAULT_PROOFS = Path(
    r"C:\Users\hugos\.gemini\antigravity\brain\d08fb875-90d0-424e-846e-d1f51a6a3d31\scratch\proofs"
)

REQ_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


# =============================================================================
# Téléchargement CC0 (AmbientCG + PolyHaven)
# =============================================================================


def fetch_bytes(url: str) -> bytes:
    req = urllib.request.Request(url, headers=REQ_HEADERS)
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read()


def ensure_acg(aid: str, cache_dir: Path) -> Path:
    out = cache_dir / f"acg_{aid}"
    if out.exists() and len(list(out.glob("*"))) >= 3:
        return out
    out.mkdir(parents=True, exist_ok=True)
    url = f"https://ambientcg.com/get?file={aid}_1K-JPG.zip"
    data = fetch_bytes(url)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():
            if any(
                k in name
                for k in (
                    "_Color",
                    "_NormalGL",
                    "_Roughness",
                    "_AmbientOcclusion",
                    "_Displacement",
                )
            ):
                (out / os.path.basename(name)).write_bytes(z.read(name))
    return out


def ensure_ph(pid: str, cache_dir: Path, res: str = "1k") -> Path:
    out = cache_dir / f"ph_{pid}"
    if out.exists() and len(list(out.glob("*"))) >= 3:
        return out
    out.mkdir(parents=True, exist_ok=True)
    meta = json.loads(fetch_bytes(f"https://api.polyhaven.com/files/{pid}"))
    for k in ("Diffuse", "nor_gl", "Rough", "AO", "Displacement"):
        if k in meta and res in meta[k]:
            prefer_png = k in ("nor_gl", "Displacement")
            fmt = (
                "png"
                if (prefer_png and "png" in meta[k][res])
                else ("jpg" if "jpg" in meta[k][res] else "png")
            )
            url = meta[k][res][fmt]["url"]
            ext = ".png" if fmt == "png" else ".jpg"
            (out / f"{pid}_{k}{ext}").write_bytes(fetch_bytes(url))
    return out


def find_map(folder: Path, patterns: tuple[str, ...]) -> Path | None:
    files = sorted(folder.iterdir())
    for pat in patterns:
        for f in files:
            if pat.lower() in f.name.lower():
                return f
    return None


def load_rgb(path: Path, size: int = 1024) -> np.ndarray:
    im = Image.open(path).convert("RGB")
    if im.size != (size, size):
        im = im.resize((size, size), Image.Resampling.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def load_gray(path: Path, size: int = 1024) -> np.ndarray:
    im = Image.open(path).convert("L")
    if im.size != (size, size):
        im = im.resize((size, size), Image.Resampling.LANCZOS)
    return np.asarray(im, dtype=np.float32) / 255.0


def save_rgb(arr: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(clipped, mode="RGB").save(path, format="PNG", optimize=True)


def save_gray(arr: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    clipped = np.clip(arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(clipped, mode="L").save(path, format="PNG", optimize=True)


# =============================================================================
# Utilitaires PBR / Normal Map / Sobel Périodique (100% Seamless)
# =============================================================================


def rgb_to_luma(rgb: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def periodic_sobel_normal(height: np.ndarray, strength: float = 2.5) -> np.ndarray:
    """Calcule une Normal Map OpenGL (+X droite, +Y haut, +Z extérieur) 100% seamless."""
    h = height.astype(np.float32)
    # Sobel 3x3 avec wrap périodique (np.roll) -> zéro couture aux bords !
    tl = np.roll(np.roll(h, 1, axis=0), 1, axis=1)
    tc = np.roll(h, 1, axis=0)
    tr = np.roll(np.roll(h, 1, axis=0), -1, axis=1)
    ml = np.roll(h, 1, axis=1)
    mr = np.roll(h, -1, axis=1)
    bl = np.roll(np.roll(h, -1, axis=0), 1, axis=1)
    bc = np.roll(h, -1, axis=0)
    br = np.roll(np.roll(h, -1, axis=0), -1, axis=1)

    dx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl)
    dy = (bl + 2.0 * bc + br) - (tl + 2.0 * tc + tr)

    nx = -dx * strength
    ny = dy * strength  # Convention OpenGL (+Y vers le haut de l'image)
    nz = np.ones_like(nx, dtype=np.float32)

    inv_len = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz + 1e-8)
    nx *= inv_len
    ny *= inv_len
    nz *= inv_len
    return np.stack([nx * 0.5 + 0.5, ny * 0.5 + 0.5, nz * 0.5 + 0.5], axis=-1)


def decode_normal(rgb: np.ndarray) -> np.ndarray:
    v = rgb * 2.0 - 1.0
    norm = np.linalg.norm(v, axis=-1, keepdims=True) + 1e-8
    return v / norm


def encode_normal(v: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(v, axis=-1, keepdims=True) + 1e-8
    vn = v / norm
    return np.clip(vn * 0.5 + 0.5, 0.0, 1.0)


def blend_normals_rnm(base_rgb: np.ndarray, detail_rgb: np.ndarray, detail_weight: float = 0.5) -> np.ndarray:
    """Reoriented Normal Mapping (RNM) pour fusionner normal scannée + micro-relief Sobel."""
    t = decode_normal(base_rgb)
    u = decode_normal(detail_rgb)
    # Atténue le détail avant composition
    u_scaled = np.stack([u[..., 0] * detail_weight, u[..., 1] * detail_weight, np.ones_like(u[..., 2])], axis=-1)
    u_scaled /= np.linalg.norm(u_scaled, axis=-1, keepdims=True) + 1e-8

    t_mod = np.stack([t[..., 0], t[..., 1], t[..., 2] + 1.0], axis=-1)
    u_mod = np.stack([-u_scaled[..., 0], -u_scaled[..., 1], u_scaled[..., 2]], axis=-1)
    dot = np.sum(t_mod * u_mod, axis=-1, keepdims=True)
    r = t_mod * dot / (t_mod[..., 2:3] + 1e-6) - u_mod
    return encode_normal(r)


def scale_normal_strength(rgb: np.ndarray, strength: float) -> np.ndarray:
    v = decode_normal(rgb)
    v[..., 0] *= strength
    v[..., 1] *= strength
    return encode_normal(v)


def periodic_blur(arr: np.ndarray, radius: int) -> np.ndarray:
    """Flou gaussien périodique (sans artefact de bord)."""
    h, w = arr.shape[:2]
    pad = min(radius * 3 + 4, w // 4)
    if arr.ndim == 2:
        padded = np.pad(arr, ((pad, pad), (pad, pad)), mode="wrap")
        im = Image.fromarray(np.clip(padded * 255.0, 0, 255).astype(np.uint8), mode="L")
        im = im.filter(ImageFilter.GaussianBlur(radius=radius))
        out = np.asarray(im, dtype=np.float32) / 255.0
        return out[pad : pad + h, pad : pad + w]
    else:
        padded = np.pad(arr, ((pad, pad), (pad, pad), (0, 0)), mode="wrap")
        im = Image.fromarray(np.clip(padded * 255.0, 0, 255).astype(np.uint8), mode="RGB")
        im = im.filter(ImageFilter.GaussianBlur(radius=radius))
        out = np.asarray(im, dtype=np.float32) / 255.0
        return out[pad : pad + h, pad : pad + w, :]


def sharpen_seamless(rgb: np.ndarray, amount: float = 0.35, radius: int = 2) -> np.ndarray:
    blur = periodic_blur(rgb, radius)
    return np.clip(rgb + (rgb - blur) * amount, 0.0, 1.0)


def periodic_fbm(size: int, seed: int = 42, octaves: int = 4, base_freq: int = 4) -> np.ndarray:
    """Bruit sinusoïdal multi-octave 100% périodique sur [0, 1]."""
    rng = np.random.default_rng(seed)
    y = np.linspace(0, 2 * math.pi, size, endpoint=False, dtype=np.float32)
    x = np.linspace(0, 2 * math.pi, size, endpoint=False, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)
    acc = np.zeros((size, size), dtype=np.float32)
    amp = 1.0
    norm = 0.0
    for o in range(octaves):
        freq = base_freq * (2**o)
        for _ in range(3):
            kx = int(rng.integers(-freq, freq + 1))
            ky = int(rng.integers(-freq, freq + 1))
            if kx == 0 and ky == 0:
                kx = freq
            phase = float(rng.uniform(0, 2 * math.pi))
            acc += amp * np.sin(kx * xx + ky * yy + phase)
            norm += amp
        amp *= 0.55
    acc = (acc / (norm + 1e-6)) * 0.5 + 0.5
    return np.clip(acc, 0.0, 1.0)


def adjust_saturation(rgb: np.ndarray, sat: float) -> np.ndarray:
    l = rgb_to_luma(rgb)[..., None]
    return np.clip(l + (rgb - l) * sat, 0.0, 1.0)


def grade_to_palette(
    rgb: np.ndarray,
    shadow_col: tuple[float, float, float],
    mid_col: tuple[float, float, float],
    hi_col: tuple[float, float, float],
    blend_strength: float = 0.65,
) -> np.ndarray:
    """Color-grade organique préservant le micro-contraste naturel de la texture."""
    l = rgb_to_luma(rgb)
    p5, p95 = np.percentile(l, [4, 96])
    t = np.clip((l - p5) / max(p95 - p5, 1e-4), 0.0, 1.0)[..., None]
    s_arr = np.array(shadow_col, dtype=np.float32)
    m_arr = np.array(mid_col, dtype=np.float32)
    h_arr = np.array(hi_col, dtype=np.float32)

    low_part = s_arr + (m_arr - s_arr) * np.clip(t * 2.0, 0.0, 1.0)
    hi_part = m_arr + (h_arr - m_arr) * np.clip((t - 0.5) * 2.0, 0.0, 1.0)
    mapped = np.where(t < 0.5, low_part, hi_part)

    # Garde les micro-écarts chromatiques relatifs de la photo d'origine
    chroma_delta = rgb - l[..., None]
    graded = np.clip(mapped + chroma_delta * (1.0 - blend_strength * 0.65), 0.0, 1.0)
    return np.clip(rgb * (1.0 - blend_strength) + graded * blend_strength, 0.0, 1.0)


def build_basalt_flagstone_masks(size: int = 1024) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Génère des masques 100% seamless de dalles volcaniques sculptées (basalte taillé) :
    - height_mask : hauteur des dalles [0..1] (joints profonds + biseaux + variations par dalle)
    - mortar_mask : [0..1] où 1 = joint/fissure profond
    - slab_tint   : variation tonale subtile par dalle [0..1]
    """
    rows = 6
    cols = 4
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    # Perturbation organique périodique pour arêtes taillées à la main (non mécaniques)
    wx = (periodic_fbm(size, seed=701, octaves=3, base_freq=6) - 0.5) * 14.0
    wy = (periodic_fbm(size, seed=702, octaves=3, base_freq=6) - 0.5) * 14.0
    u = (xx + wx) % size
    v = (yy + wy) % size

    row_h = size / rows
    col_w = size / cols
    row_idx = np.floor(v / row_h).astype(np.int32) % rows
    u_shifted = (u + (row_idx % 2) * (col_w * 0.5)) % size
    col_idx = np.floor(u_shifted / col_w).astype(np.int32) % cols

    local_y = (v % row_h) / row_h
    local_x = (u_shifted % col_w) / col_w

    dist_edge_y = np.minimum(local_y, 1.0 - local_y) * row_h
    dist_edge_x = np.minimum(local_x, 1.0 - local_x) * col_w
    dist_edge = np.minimum(dist_edge_x, dist_edge_y)

    # Joint de mortier volcanique + biseau sculpté
    mortar_w = 5.5
    bevel_w = 18.0
    mortar = 1.0 - np.clip((dist_edge - mortar_w) / 4.5, 0.0, 1.0)
    bevel = np.clip((dist_edge - mortar_w) / bevel_w, 0.0, 1.0)
    bevel = bevel * bevel * (3.0 - 2.0 * bevel)  # smoothstep

    # Variation déterministe par dalle (hauteur et teinte)
    rng = np.random.default_rng(1337)
    slab_h_lut = rng.uniform(0.76, 1.0, size=(rows, cols)).astype(np.float32)
    slab_t_lut = rng.uniform(0.0, 1.0, size=(rows, cols)).astype(np.float32)
    slab_h = slab_h_lut[row_idx, col_idx]
    slab_tint = slab_t_lut[row_idx, col_idx]

    # Micro-fissures volcaniques organiques traversant certaines dalles
    crack_noise = periodic_fbm(size, seed=999, octaves=4, base_freq=5)
    cracks = np.clip(1.0 - np.abs(crack_noise - 0.5) * 28.0, 0.0, 1.0) * 0.55

    height = np.clip(slab_h * bevel * (1.0 - cracks * 0.45), 0.0, 1.0)
    mortar_full = np.clip(mortar + cracks * 0.35, 0.0, 1.0)
    return height, mortar_full, slab_tint


# =============================================================================
# Génération des 6 sets PBR (1024x1024 seamless)
# =============================================================================


def build_all_textures(cache_dir: Path, proofs_dir: Path) -> None:
    TEXTURES_OUT.mkdir(parents=True, exist_ok=True)
    proofs_dir.mkdir(parents=True, exist_ok=True)

    # Télécharge si non encore en cache
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = [
            ex.submit(ensure_acg, "Grass004", cache_dir),
            ex.submit(ensure_acg, "Moss002", cache_dir),
            ex.submit(ensure_acg, "Ground037", cache_dir),
            ex.submit(ensure_acg, "Snow006", cache_dir),
            ex.submit(ensure_acg, "Gravel023", cache_dir),
            ex.submit(ensure_acg, "Rock058", cache_dir),
            ex.submit(ensure_ph, "dirt_floor", cache_dir),
            ex.submit(ensure_ph, "cobblestone_floor_07", cache_dir),
        ]
        for f in futs:
            f.result()

    sets_info = []

    # --- 1. GRASS : Herbe dense semi-réaliste lumineuse (Plaines de Miaou-Vert) ---
    d = cache_dir / "acg_Grass004"
    g_alb = load_rgb(find_map(d, ("_Color",)))
    g_nrm = load_rgb(find_map(d, ("_NormalGL",)))
    g_rgh = load_gray(find_map(d, ("_Roughness",)))
    g_ao = load_gray(find_map(d, ("_AmbientOcclusion",)))

    # Palette lumineuse diorama Félingard (#528c30 -> #79ba46 -> #a6db60)
    g_alb = grade_to_palette(
        g_alb,
        shadow_col=(0.24, 0.46, 0.16),
        mid_col=(0.45, 0.72, 0.26),
        hi_col=(0.68, 0.88, 0.39),
        blend_strength=0.68,
    )
    # Variation organique douce anti-répétition
    macro = periodic_fbm(1024, seed=101, octaves=3, base_freq=2)
    g_alb = np.clip(g_alb * (0.93 + 0.14 * macro[..., None]) * (0.86 + 0.14 * g_ao[..., None]), 0.0, 1.0)
    g_alb = sharpen_seamless(g_alb, amount=0.38, radius=1)
    g_alb = adjust_saturation(g_alb, 1.08)

    g_sobel = periodic_sobel_normal(rgb_to_luma(g_alb), strength=2.6)
    g_nrm_final = blend_normals_rnm(scale_normal_strength(g_nrm, 1.25), g_sobel, detail_weight=0.55)
    g_rgh_final = np.clip(0.60 + (g_rgh - 0.5) * 0.42 + (1.0 - g_ao) * 0.12, 0.52, 0.94)

    save_rgb(g_alb, TEXTURES_OUT / "grass_albedo.png")
    save_rgb(g_nrm_final, TEXTURES_OUT / "grass_normal.png")
    save_gray(g_rgh_final, TEXTURES_OUT / "grass_roughness.png")
    sets_info.append(("grass", g_alb, g_nrm_final, g_rgh_final))
    print("[OK] grass PBR (1024x1024)")

    # --- 2. FOREST : Mousse et sous-bois émeraude sombre (Bois Griffu) ---
    dm = cache_dir / "acg_Moss002"
    dg = cache_dir / "acg_Ground037"
    m_alb = load_rgb(find_map(dm, ("_Color",)))
    m_nrm = load_rgb(find_map(dm, ("_NormalGL",)))
    m_rgh = load_gray(find_map(dm, ("_Roughness",)))
    m_ao = load_gray(find_map(dm, ("_AmbientOcclusion",)))

    u_alb = load_rgb(find_map(dg, ("_Color",)))
    u_nrm = load_rgb(find_map(dg, ("_NormalGL",)))
    u_rgh = load_gray(find_map(dg, ("_Roughness",)))

    # Homogénéise la luminance basse fréquence de Moss002 pour éliminer tout motif répétitif en 2x2
    m_luma = rgb_to_luma(m_alb)
    m_low = periodic_blur(m_luma, 48)
    m_alb_even = np.clip(m_alb * (float(np.mean(m_luma)) / np.maximum(m_low, 0.08))[..., None], 0.0, 1.0)

    # Homogénéise Ground037 et extrait sa micro-texture de sous-bois (brindilles, feuilles, mousse fine)
    u_luma = rgb_to_luma(u_alb)
    u_low = periodic_blur(u_luma, 36)
    u_alb_even = np.clip(u_alb * (float(np.mean(u_luma)) / np.maximum(u_low, 0.08))[..., None], 0.0, 1.0)

    # Mélange haute-fréquence homogène (sans taches basse fréquence répétitives)
    micro_mix = np.clip(0.24 + (periodic_fbm(1024, seed=212, octaves=4, base_freq=7) - 0.5) * 0.28, 0.08, 0.42)
    f_alb_raw = m_alb_even * (1.0 - micro_mix[..., None]) + u_alb_even * micro_mix[..., None]

    # Palette Bois Griffu : émeraude sombre riche, profond et velouté
    f_alb = grade_to_palette(
        f_alb_raw,
        shadow_col=(0.09, 0.22, 0.16),
        mid_col=(0.19, 0.39, 0.26),
        hi_col=(0.34, 0.56, 0.35),
        blend_strength=0.76,
    )
    # Micro-touches organiques d'humus et aiguilles dans les creux
    crevice = np.clip((0.88 - m_ao) * 1.8, 0.0, 1.0)
    humus_col = np.array([0.16, 0.17, 0.13], dtype=np.float32)
    f_alb = np.clip(f_alb * (1.0 - crevice[..., None] * 0.40) + humus_col * (crevice[..., None] * 0.40), 0.0, 1.0)
    f_alb = sharpen_seamless(f_alb, amount=0.42, radius=1)

    f_nrm_base = blend_normals_rnm(scale_normal_strength(m_nrm, 1.05), scale_normal_strength(u_nrm, 1.15), detail_weight=0.55)
    f_sobel = periodic_sobel_normal(rgb_to_luma(f_alb), strength=2.6)
    f_nrm_final = blend_normals_rnm(f_nrm_base, f_sobel, detail_weight=0.50)
    f_rgh_final = np.clip(
        (m_rgh * 0.55 + u_rgh * 0.45) * 0.48 + 0.44 + crevice * 0.10, 0.52, 0.94
    )

    save_rgb(f_alb, TEXTURES_OUT / "forest_albedo.png")
    save_rgb(f_nrm_final, TEXTURES_OUT / "forest_normal.png")
    save_gray(f_rgh_final, TEXTURES_OUT / "forest_roughness.png")
    sets_info.append(("forest", f_alb, f_nrm_final, f_rgh_final))
    print("[OK] forest PBR (1024x1024)")

    # --- 3. SNOW : Neige fraîche texturée cristalline (Monts Prr-Glacés) ---
    ds = cache_dir / "acg_Snow006"
    s_alb = load_rgb(find_map(ds, ("_Color",)))
    s_nrm = load_rgb(find_map(ds, ("_NormalGL",)))
    s_rgh = load_gray(find_map(ds, ("_Roughness",)))
    s_disp = load_gray(find_map(ds, ("_Displacement",)))

    # Adoucit les quelques petits creux/taches trop marqués de Snow006 pour un tapis neigeux homogène sans répétition
    s_luma = rgb_to_luma(s_alb)
    s_low = periodic_blur(s_luma, 32)
    s_alb_even = np.clip(s_alb + (float(np.mean(s_luma)) - s_low)[..., None] * 0.55, 0.0, 1.0)
    # Clamping doux des micro-trous sombres dans la neige
    s_disp_smooth = periodic_blur(np.clip(s_disp, 0.34, 0.92), 3)

    # Palette neige fraîche lumineuse + ombres bleutées cristallines (Monts Prr-Glacés)
    drift = periodic_fbm(1024, seed=313, octaves=4, base_freq=4)
    s_mix = np.clip(s_alb_even * 0.72 + (0.78 + 0.22 * drift)[..., None] * 0.28, 0.0, 1.0)
    s_alb_final = grade_to_palette(
        s_mix,
        shadow_col=(0.78, 0.88, 0.96),
        mid_col=(0.91, 0.96, 0.995),
        hi_col=(0.985, 0.995, 1.00),
        blend_strength=0.84,
    )
    # Micro-cristaux scintillants de givre
    rng = np.random.default_rng(303)
    sparkle = (rng.random((1024, 1024)).astype(np.float32) > 0.968).astype(np.float32)
    crystal_grain = rng.normal(0.0, 0.012, (1024, 1024)).astype(np.float32)
    s_alb_final = np.clip(s_alb_final + crystal_grain[..., None] + sparkle[..., None] * 0.05, 0.0, 1.0)

    # Normal map de neige fraîche : ondulations douces de congères + fin grain cristallin (pas rocailleux !)
    s_drift_h = s_disp_smooth * 0.55 + drift * 0.45
    s_soft_nrm = periodic_sobel_normal(periodic_blur(s_drift_h, 2), strength=1.55)
    s_micro_nrm = periodic_sobel_normal(s_disp_smooth + crystal_grain * 1.5, strength=0.85)
    s_nrm_final = blend_normals_rnm(
        blend_normals_rnm(scale_normal_strength(s_nrm, 0.42), s_soft_nrm, detail_weight=0.75),
        s_micro_nrm,
        detail_weight=0.45,
    )
    # Roughness : poudre soyeuse (0.45-0.68) ponctuée de micro-cristaux brillants (0.14)
    s_rgh_final = np.clip(0.46 + (s_rgh - 0.5) * 0.30 + (1.0 - drift) * 0.12 - sparkle * 0.34, 0.14, 0.78)

    save_rgb(s_alb_final, TEXTURES_OUT / "snow_albedo.png")
    save_rgb(s_nrm_final, TEXTURES_OUT / "snow_normal.png")
    save_gray(s_rgh_final, TEXTURES_OUT / "snow_roughness.png")
    sets_info.append(("snow", s_alb_final, s_nrm_final, s_rgh_final))
    print("[OK] snow PBR (1024x1024)")

    # --- 4. PATH : Chemin de gravier/terre battue ocre (Routes de Félingard) ---
    dp = cache_dir / "ph_dirt_floor"
    dgr = cache_dir / "acg_Gravel023"
    p_alb = load_rgb(find_map(dp, ("Diffuse",)))
    p_nrm = load_rgb(find_map(dp, ("nor_gl",)))
    p_rgh = load_gray(find_map(dp, ("Rough",)))
    gr_alb = load_rgb(find_map(dgr, ("_Color",)))
    gr_nrm = load_rgb(find_map(dgr, ("_NormalGL",)))
    gr_rgh = load_gray(find_map(dgr, ("_Roughness",)))

    # Injection de micro-graviers dans la terre battue ocre
    gr_luma = rgb_to_luma(gr_alb)
    gr_high = gr_luma - periodic_blur(gr_luma, 6)
    p_alb_mix = np.clip(p_alb + gr_high[..., None] * 0.35, 0.0, 1.0)
    p_alb_final = grade_to_palette(
        p_alb_mix,
        shadow_col=(0.56, 0.40, 0.24),
        mid_col=(0.82, 0.66, 0.44),
        hi_col=(0.93, 0.80, 0.58),
        blend_strength=0.62,
    )
    p_alb_final = sharpen_seamless(p_alb_final, amount=0.40, radius=1)

    p_nrm_mix = blend_normals_rnm(scale_normal_strength(p_nrm, 1.35), gr_nrm, detail_weight=0.42)
    p_sobel = periodic_sobel_normal(rgb_to_luma(p_alb_final), strength=2.6)
    p_nrm_final = blend_normals_rnm(p_nrm_mix, p_sobel, detail_weight=0.45)
    p_rgh_final = np.clip(p_rgh * 0.65 + gr_rgh * 0.25 + 0.14, 0.62, 0.96)

    save_rgb(p_alb_final, TEXTURES_OUT / "path_albedo.png")
    save_rgb(p_nrm_final, TEXTURES_OUT / "path_normal.png")
    save_gray(p_rgh_final, TEXTURES_OUT / "path_roughness.png")
    sets_info.append(("path", p_alb_final, p_nrm_final, p_rgh_final))
    print("[OK] path PBR (1024x1024)")

    # --- 5. DUNGEON GHOST : Dallage pierre taillée gris-violet usée ---
    dc = cache_dir / "ph_cobblestone_floor_07"
    c_alb = load_rgb(find_map(dc, ("Diffuse",)))
    c_nrm = load_rgb(find_map(dc, ("nor_gl",)))
    c_rgh = load_gray(find_map(dc, ("Rough",)))
    c_ao = load_gray(find_map(dc, ("AO",)))
    c_disp = load_gray(find_map(dc, ("Displacement",)))

    # Neutralise le vert de la mousse dans les joints puis grade en pierre gris-violet usée
    c_neutral = adjust_saturation(c_alb, 0.18)
    # Variation subtile de teinte entre pavés + arêtes usées
    c_graded = grade_to_palette(
        c_neutral,
        shadow_col=(0.13, 0.10, 0.19),  # joints sombres #211a30
        mid_col=(0.31, 0.26, 0.40),     # pierre gris-violet #4f4266
        hi_col=(0.46, 0.40, 0.56),      # arêtes usées #75668f
        blend_strength=0.92,
    )
    # Creuse l'occlusion dans les joints pour un relief spectaculaire
    c_graded = np.clip(c_graded * (0.68 + 0.36 * c_ao[..., None]), 0.0, 1.0)
    c_graded = sharpen_seamless(c_graded, amount=0.38, radius=1)

    c_sobel = periodic_sobel_normal(c_disp * 0.75 + rgb_to_luma(c_graded) * 0.25, strength=3.2)
    c_nrm_final = blend_normals_rnm(scale_normal_strength(c_nrm, 1.45), c_sobel, detail_weight=0.50)
    # Pierre polie au centre des dalles (roughness ~0.46), joints rugueux (~0.88)
    c_rgh_final = np.clip(0.42 + c_rgh * 0.35 + (1.0 - c_ao) * 0.22, 0.38, 0.92)

    save_rgb(c_graded, TEXTURES_OUT / "dungeon_ghost_albedo.png")
    save_rgb(c_nrm_final, TEXTURES_OUT / "dungeon_ghost_normal.png")
    save_gray(c_rgh_final, TEXTURES_OUT / "dungeon_ghost_roughness.png")
    sets_info.append(("dungeon_ghost", c_graded, c_nrm_final, c_rgh_final))
    print("[OK] dungeon_ghost PBR (1024x1024)")

    # --- 6. DUNGEON DRAGON : Basalte volcanique sculpté sombre ---
    dr = cache_dir / "acg_Rock058"
    r_alb = load_rgb(find_map(dr, ("_Color",)))
    r_nrm = load_rgb(find_map(dr, ("_NormalGL",)))
    r_rgh = load_gray(find_map(dr, ("_Roughness",)))
    r_disp = load_gray(find_map(dr, ("_Displacement",)))

    slab_h, mortar, slab_tint = build_basalt_flagstone_masks(1024)

    # Extraire les veines minérales chaudes naturelles de Rock058
    warm_veins = np.clip((r_alb[..., 0] - r_alb[..., 2]) * 2.2, 0.0, 1.0)
    r_base = grade_to_palette(
        r_alb,
        shadow_col=(0.11, 0.09, 0.12),   # obsidienne sombre
        mid_col=(0.24, 0.20, 0.24),      # basalte volcanique #3d333d
        hi_col=(0.36, 0.30, 0.34),       # arêtes basalte
        blend_strength=0.85,
    )
    # Variation subtile par dalle sculptée + lueur cuivrée/braise subtile dans les veines
    r_base = r_base * (0.86 + 0.24 * slab_tint[..., None])
    ember_vein_col = np.array([0.48, 0.23, 0.20], dtype=np.float32)
    r_base = r_base * (1.0 - warm_veins[..., None] * 0.45) + ember_vein_col * (warm_veins[..., None] * 0.45)
    # Assombrit profondément les joints sculptés entre dalles + très légère bordure claire d'usure
    bevel_rim = np.clip((slab_h - 0.35) * (0.85 - slab_h) * 4.0, 0.0, 1.0)
    r_base = r_base * (1.0 - mortar[..., None] * 0.68) + bevel_rim[..., None] * np.array([0.07, 0.055, 0.06], dtype=np.float32)
    r_base = np.clip(sharpen_seamless(r_base, amount=0.42, radius=1), 0.0, 1.0)

    # Normal map combinée : géométrie sculptée des dalles + micro-relief volcanique scanné
    slab_normal = periodic_sobel_normal(slab_h * 0.8 + r_disp * 0.2, strength=4.2)
    r_nrm_final = blend_normals_rnm(slab_normal, scale_normal_strength(r_nrm, 1.4), detail_weight=0.72)
    # Basalte poli satiné sur les faces (0.36-0.58), très rugueux dans les joints (0.88)
    r_rgh_final = np.clip(0.36 + r_rgh * 0.32 + mortar * 0.30, 0.32, 0.94)

    save_rgb(r_base, TEXTURES_OUT / "dungeon_dragon_albedo.png")
    save_rgb(r_nrm_final, TEXTURES_OUT / "dungeon_dragon_normal.png")
    save_gray(r_rgh_final, TEXTURES_OUT / "dungeon_dragon_roughness.png")
    sets_info.append(("dungeon_dragon", r_base, r_nrm_final, r_rgh_final))
    print("[OK] dungeon_dragon PBR (1024x1024)")

    # --- Planches de vérification visuelle 2x2 Seamless + Shaded PBR Preview ---
    for name, alb, nrm, rgh in sets_info:
        tile = 320
        # 2x2 Albedo (pour vérifier visuellement ZÉRO raccord !)
        a_sm = np.asarray(
            Image.fromarray((alb * 255).astype(np.uint8)).resize((tile, tile), Image.Resampling.LANCZOS),
            dtype=np.uint8,
        )
        a_2x2 = np.tile(a_sm, (2, 2, 1))

        # 2x2 Normal
        n_sm = np.asarray(
            Image.fromarray((nrm * 255).astype(np.uint8)).resize((tile, tile), Image.Resampling.LANCZOS),
            dtype=np.uint8,
        )
        n_2x2 = np.tile(n_sm, (2, 2, 1))

        # Roughness 1x1 agrandi
        r_sm = np.asarray(
            Image.fromarray((rgh * 255).astype(np.uint8)).resize((tile * 2, tile * 2), Image.Resampling.LANCZOS),
            dtype=np.uint8,
        )
        r_rgb = np.stack([r_sm, r_sm, r_sm], axis=-1)

        # Aperçu rendu PBR éclairé par soleil haut-droite (Lambert + Blinn-Phong selon roughness)
        nv = decode_normal(nrm)
        L = np.array([0.55, 0.55, 0.62], dtype=np.float32)
        L /= np.linalg.norm(L)
        V = np.array([0.0, -0.35, 0.93], dtype=np.float32)
        V /= np.linalg.norm(V)
        H = L + V
        H /= np.linalg.norm(H)
        ndotl = np.clip(np.sum(nv * L, axis=-1), 0.0, 1.0)[..., None]
        ndoth = np.clip(np.sum(nv * H, axis=-1), 0.0, 1.0)
        shininess = np.clip((1.0 - rgh) ** 2 * 64.0 + 4.0, 4.0, 80.0)
        spec = (ndoth ** shininess) * (1.0 - rgh) * 0.45
        lit = np.clip(alb * (0.34 + 0.88 * ndotl) + spec[..., None] * np.array([1.0, 0.96, 0.88]), 0.0, 1.0)
        lit_sm = np.asarray(
            Image.fromarray((lit * 255).astype(np.uint8)).resize((tile, tile), Image.Resampling.LANCZOS),
            dtype=np.uint8,
        )
        lit_2x2 = np.tile(lit_sm, (2, 2, 1))

        panel = Image.new("RGB", (tile * 4 + 30, tile * 4 + 70), (20, 20, 24))
        panel.paste(Image.fromarray(a_2x2), (10, 30))
        panel.paste(Image.fromarray(lit_2x2), (tile * 2 + 20, 30))
        panel.paste(Image.fromarray(n_2x2), (10, tile * 2 + 56))
        panel.paste(Image.fromarray(r_rgb), (tile * 2 + 20, tile * 2 + 56))
        draw = ImageDraw.Draw(panel)
        draw.text((14, 8), f"{name} — ALBEDO (2x2 seamless check)", fill=(245, 245, 245))
        draw.text((tile * 2 + 24, 8), f"{name} — LIT PBR PREVIEW (2x2)", fill=(255, 230, 160))
        draw.text((14, tile * 2 + 36), f"{name} — NORMAL MAP (2x2 OpenGL)", fill=(160, 200, 255))
        draw.text((tile * 2 + 24, tile * 2 + 36), f"{name} — ROUGHNESS MAP", fill=(210, 210, 210))
        panel.save(proofs_dir / f"proof_tex_{name}.png")

    print(f"All 6 PBR texture sets saved to {TEXTURES_OUT} and proofs to {proofs_dir}")


# =============================================================================
# Téléchargement des matériaux PBR CC0 pour le Studio 3D Props Diorama
# =============================================================================


def download_prop_materials(out_dir: Path, cache_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    ph_mats = {
        "roof_red": "clay_roof_tiles_02",
        "roof_slate": "grey_roof_tiles_02",
        "stone_wall": "medieval_wall_01",
        "stone_mossy": "mossy_stone_wall",
        "plaster": "clay_plaster",
        "wood_dark": "dark_wooden_planks",
        "wood_oak": "brown_planks_03",
        "bark_oak": "jolcham_oak_bark_01",
        "bark_pine": "knotted_pine_bark",
        "bark_dark": "bark_brown_01",
        "rock_mossy": "mossy_rock",
        "metal": "metal_plate_02",
    }
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {alias: ex.submit(ensure_ph, pid, cache_dir, "1k") for alias, pid in ph_mats.items()}
        for alias, fut in futs.items():
            folder = fut.result()
            diff = find_map(folder, ("Diffuse",))
            nrm = find_map(folder, ("nor_gl",))
            rgh = find_map(folder, ("Rough",))
            # Copie/convertit en PNG/JPG 512px pour chargement ultra-rapide dans le studio WebGL
            if diff:
                Image.open(diff).convert("RGB").resize((512, 512), Image.Resampling.LANCZOS).save(
                    out_dir / f"{alias}_diff.jpg", quality=92
                )
            if nrm:
                Image.open(nrm).convert("RGB").resize((512, 512), Image.Resampling.LANCZOS).save(
                    out_dir / f"{alias}_nrm.png"
                )
            if rgh:
                Image.open(rgh).convert("L").resize((512, 512), Image.Resampling.LANCZOS).save(
                    out_dir / f"{alias}_rgh.jpg", quality=90
                )
            print(f"[MAT] {alias} ({ph_mats[alias]}) ready")

    # Réutilise aussi snow + moss + rock058 déjà en cache
    for alias, src_name in [
        ("snow", "snow"),
        ("grass", "grass"),
        ("forest", "forest"),
        ("dungeon_ghost", "dungeon_ghost"),
        ("dungeon_dragon", "dungeon_dragon"),
    ]:
        alb_p = TEXTURES_OUT / f"{src_name}_albedo.png"
        nrm_p = TEXTURES_OUT / f"{src_name}_normal.png"
        rgh_p = TEXTURES_OUT / f"{src_name}_roughness.png"
        if alb_p.exists():
            Image.open(alb_p).convert("RGB").resize((512, 512), Image.Resampling.LANCZOS).save(
                out_dir / f"{alias}_diff.jpg", quality=92
            )
            Image.open(nrm_p).convert("RGB").resize((512, 512), Image.Resampling.LANCZOS).save(
                out_dir / f"{alias}_nrm.png"
            )
            Image.open(rgh_p).convert("L").resize((512, 512), Image.Resampling.LANCZOS).save(
                out_dir / f"{alias}_rgh.jpg", quality=90
            )


# =============================================================================
# Post-traitement chirurgical des Props 1024x1024 RGBA -> 512x512 RGBA zéro halo
# =============================================================================


def dilate_rgb_into_transparent(rgba: np.ndarray, iters: int = 8) -> np.ndarray:
    """
    Propage la couleur RGB des pixels opaques dans les pixels transparents voisins
    pour éliminer à 100% tout halo sombre/clair lors du filtrage bilinéaire/mipmaps Three.js !
    """
    rgb = rgba[..., :3].copy()
    alpha = rgba[..., 3]
    valid = alpha > 0.12

    for _ in range(iters):
        need = ~valid
        if not np.any(need):
            break
        acc = np.zeros_like(rgb)
        cnt = np.zeros(alpha.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            sv = np.roll(np.roll(valid, dy, axis=0), dx, axis=1)
            sr = np.roll(np.roll(rgb, dy, axis=0), dx, axis=1)
            w = sv.astype(np.float32)
            acc += sr * w[..., None]
            cnt += w
        fill = need & (cnt > 0)
        rgb[fill] = acc[fill] / cnt[fill, None]
        valid = valid | fill

    out = rgba.copy()
    out[..., :3] = rgb
    return out


def process_single_prop(raw_path: Path, out_path: Path, target_size: int = 512) -> dict:
    im = Image.open(raw_path).convert("RGBA")
    arr = np.asarray(im, dtype=np.float32) / 255.0

    # 1. Nettoyage alpha chirurgical : supprime micro-résidus < 2%
    alpha = arr[..., 3]
    alpha = np.where(alpha < 0.02, 0.0, alpha)
    arr[..., 3] = alpha

    # 2. Dé-prémultiplication propre & dilatation RGB des bords pour ZERO halo
    arr = dilate_rgb_into_transparent(arr, iters=10)

    # 3. Micro-polish diorama (légère netteté micro-textures + richesse chromatique)
    rgb_img = Image.fromarray(np.clip(arr[..., :3] * 255.0, 0, 255).astype(np.uint8), mode="RGB")
    sharp_rgb = np.asarray(
        rgb_img.filter(ImageFilter.UnsharpMask(radius=1.4, percent=75, threshold=2)),
        dtype=np.float32,
    ) / 255.0
    # Légère richesse chromatique chaleureuse (alignée sur le style figurine Félingard)
    sharp_rgb = adjust_saturation(sharp_rgb, 1.07)
    arr[..., :3] = np.clip(sharp_rgb, 0.0, 1.0)

    # 4. Recadrage serré centré horizontalement et ancré en bas (base stable au sol)
    ys, xs = np.where(alpha > 0.08)
    if len(xs) == 0:
        raise RuntimeError(f"Empty transparent render for {raw_path.name}")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1

    crop = arr[y0:y1, x0:x1, :]
    ch, cw = crop.shape[:2]

    # Dimensions utiles dans le 512x512 : marges latérales/haut 18px, marge bas 10px
    pad_side = 18
    pad_top = 18
    pad_bottom = 10
    max_w = target_size - 2 * pad_side
    max_h = target_size - pad_top - pad_bottom

    scale = min(max_w / cw, max_h / ch)
    new_w = max(1, int(round(cw * scale)))
    new_h = max(1, int(round(ch * scale)))

    # Redimensionnement séparé RGB (sur RGB dilaté!) + Alpha pour zéro halo noir/blanc au Lanczos
    crop_rgb_im = Image.fromarray(np.clip(crop[..., :3] * 255.0, 0, 255).astype(np.uint8), mode="RGB")
    crop_a_im = Image.fromarray(np.clip(crop[..., 3] * 255.0, 0, 255).astype(np.uint8), mode="L")

    res_rgb = crop_rgb_im.resize((new_w, new_h), Image.Resampling.LANCZOS)
    res_a = crop_a_im.resize((new_w, new_h), Image.Resampling.LANCZOS)

    canvas_rgb = np.zeros((target_size, target_size, 3), dtype=np.uint8)
    canvas_a = np.zeros((target_size, target_size), dtype=np.uint8)

    dx = (target_size - new_w) // 2
    dy = target_size - pad_bottom - new_h
    canvas_rgb[dy : dy + new_h, dx : dx + new_w] = np.asarray(res_rgb, dtype=np.uint8)
    canvas_a[dy : dy + new_h, dx : dx + new_w] = np.asarray(res_a, dtype=np.uint8)

    # Dilate une dernière fois en 512px pour mipmaps Three.js parfaitement propres
    final_arr = np.zeros((target_size, target_size, 4), dtype=np.float32)
    final_arr[..., :3] = canvas_rgb.astype(np.float32) / 255.0
    final_arr[..., 3] = np.where(canvas_a < 4, 0, canvas_a).astype(np.float32) / 255.0
    final_arr = dilate_rgb_into_transparent(final_arr, iters=6)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_u8 = np.clip(final_arr * 255.0 + 0.5, 0, 255).astype(np.uint8)
    Image.fromarray(out_u8, mode="RGBA").save(out_path, format="PNG", optimize=True)

    opaque_ratio = float(np.mean(out_u8[..., 3] > 200))
    border_alpha = int(
        max(
            out_u8[0, :, 3].max(),
            out_u8[-1, :, 3].max(),
            out_u8[:, 0, 3].max(),
            out_u8[:, -1, 3].max(),
        )
    )
    return {
        "name": out_path.name,
        "size": f"{target_size}x{target_size}",
        "fit": f"{new_w}x{new_h}",
        "opaque_pct": round(opaque_ratio * 100, 1),
        "border_max_alpha": border_alpha,
    }


def build_props_from_raw(raw_dir: Path, proofs_dir: Path) -> None:
    PROPS_OUT.mkdir(parents=True, exist_ok=True)
    proofs_dir.mkdir(parents=True, exist_ok=True)

    raw_files = sorted(raw_dir.glob("*.png"))
    if not raw_files:
        raise SystemExit(f"No raw PNGs found in {raw_dir}")

    stats = []
    for rp in raw_files:
        op = PROPS_OUT / rp.name
        st = process_single_prop(rp, op, target_size=512)
        stats.append(st)
        print(f"[PROP] {st['name']} fit={st['fit']} opaque={st['opaque_pct']}% borderAlpha={st['border_max_alpha']}")

    # Crée 2 planches de vérification : sur fond damier neutre + sur fond herbe diorama sombre/clair
    cols = 4
    rows = (len(raw_files) + cols - 1) // cols
    cell = 280
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 26)), (30, 34, 38))
    draw = ImageDraw.Draw(sheet)

    # Damier de contrôle anti-halo
    chk = Image.new("RGB", (cell - 16, cell - 16))
    cd = ImageDraw.Draw(chk)
    sq = 16
    for y in range(0, cell - 16, sq):
        for x in range(0, cell - 16, sq):
            c = (56, 62, 70) if ((x // sq + y // sq) % 2 == 0) else (88, 96, 108)
            cd.rectangle([x, y, x + sq, y + sq], fill=c)

    for i, rp in enumerate(raw_files):
        op = PROPS_OUT / rp.name
        r, c = divmod(i, cols)
        ox, oy = c * cell + 8, r * (cell + 26) + 8
        bg = chk.copy()
        fg = Image.open(op).convert("RGBA").resize((cell - 16, cell - 16), Image.Resampling.LANCZOS)
        bg.paste(fg, (0, 0), fg)
        sheet.paste(bg, (ox, oy))
        draw.text((ox + 4, oy + cell - 12), rp.stem, fill=(245, 240, 225))

    sheet.save(proofs_dir / "proof_props_sheet.png")
    print(f"Saved prop proof sheet to {proofs_dir / 'proof_props_sheet.png'}")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_tex = sub.add_parser("textures")
    p_tex.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)
    p_tex.add_argument("--proofs-dir", type=Path, default=DEFAULT_PROOFS)

    p_mat = sub.add_parser("download-prop-materials")
    p_mat.add_argument("--out-dir", type=Path, required=True)
    p_mat.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE)

    p_props = sub.add_parser("props")
    p_props.add_argument("--raw-dir", type=Path, required=True)
    p_props.add_argument("--proofs-dir", type=Path, default=DEFAULT_PROOFS)

    args = parser.parse_args()
    if args.cmd == "textures":
        build_all_textures(args.cache_dir, args.proofs_dir)
    elif args.cmd == "download-prop-materials":
        download_prop_materials(args.out_dir, args.cache_dir)
    elif args.cmd == "props":
        build_props_from_raw(args.raw_dir, args.proofs_dir)


if __name__ == "__main__":
    main()
