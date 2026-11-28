#!/usr/bin/env python3
"""
Les Chroniques de Félingard — Pipeline Offline « Fausse 2D / Paper-Cutout 3D »
===============================================================================
Convertit les assets PNG sources de `public/assets/` en 16 spritesheets PNG
calibrées à 30 FPS + le manifeste JSON `public/assets/animations_manifest.json`
(coordonnées UV, pivots, plages d'états et positions de sockets par frame).

Étapes du pipeline :
  1. Segmentation & Détection de pose :
     - MediaPipe Pose / DWPose pour les articulations clés (tête, cou, épaules,
       coudes, poignets, hanches, genoux, chevilles, queue, mâchoire, ailes).
     - SAM 2 (Segment Anything 2) pour isoler proprement chaque membre à partir
       du PNG source (zéro génération d'image par IA générative).
  2. Rebouchage des joints cachés :
     - OpenCV (`cv2.inpaint` Telea ou Navier-Stokes) limité exclusivement à la
       bande d'occlusion sous les articulations, sans altérer les pixels visibles.
  3. Conversion Alpha-to-Mesh 3D plat (Blender `bpy`) :
     - Maillage d'épaisseur zéro (Z = 0) subdivisé en grille interne pour
       la flexion et le squash & stretch, mapping UV exact, matériau Double-Sided,
       et micro-décalage Z (+0.002 par calque) supprimant tout Z-fighting.
  4. Auto-Rigging 3D & Courbes Triple A (30 FPS) :
     - Armature 3D alignée sur les joints, skinning automatique, courbes
       d'animation avec poids, anticipation, inertie, impact et retournement
       gauche/droite 180° façon feuille rigide (courbe d'overshoot).
  5. Baking 30 FPS vers les 16 grilles exactes & export du manifeste JSON.

Usage :
  blender --background --python tools/bake_animations.py -- \
      --assets-dir public/assets \
      --output-dir public/assets \
      --inpaint-method telea

Mode manifeste / inspection hors Blender :
  python3 tools/bake_animations.py --manifest-only --assets-dir public/assets
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

# Dépendances optionnelles résolues proprement pour permettre l'exécution
# à la fois dans Blender (`bpy`) et en CLI Python standard.
try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

try:
    import cv2
except ImportError:  # pragma: no cover
    cv2 = None  # type: ignore

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None  # type: ignore

try:
    import mediapipe as mp  # type: ignore
except ImportError:  # pragma: no cover
    mp = None  # type: ignore

try:
    import torch  # type: ignore
    from sam2.build_sam import build_sam2  # type: ignore
    from sam2.sam2_image_predictor import SAM2ImagePredictor  # type: ignore
except ImportError:  # pragma: no cover
    torch = None  # type: ignore
    build_sam2 = None  # type: ignore
    SAM2ImagePredictor = None  # type: ignore

try:
    import bpy  # type: ignore
    import bmesh  # type: ignore
    from mathutils import Euler, Matrix, Vector  # type: ignore
except ImportError:  # pragma: no cover
    bpy = None  # type: ignore
    bmesh = None  # type: ignore
    Euler = Matrix = Vector = None  # type: ignore


# =============================================================================
# 1. CONSTANTES & TABLEAU EXACT DES 16 SPRITESHEETS CIBLES (30 FPS)
# =============================================================================

TARGET_FPS: int = 30
LAYER_Z_STEP: float = 0.002  # Micro-décalage Z anti Z-fighting par couche
DEFAULT_PIVOT: Tuple[float, float] = (0.5, 0.06)

ENEMY_SIX_STATES: Tuple[str, ...] = (
    "idle",
    "move",
    "windup",
    "attack",
    "hurt",
    "death",
)

HERO_SOCKET_IDS: Tuple[str, ...] = (
    "head",
    "torso",
    "leftHand",
    "rightHand",
    "leftFoot",
    "rightFoot",
    "weapon",
    "shield",
    "trinket",
    "cape",
    "lanternBelt",
    "lanternHand",
)


@dataclass(frozen=True)
class StateRangeSpec:
    name: str
    start_frame: int
    frame_count: int
    loop: bool = True


@dataclass(frozen=True)
class SpriteSheetJob:
    id: str
    category: str  # "hero" | "npc" | "enemy" | "boss" | "prop"
    source_png: str  # Chemin relatif depuis public/assets/
    output_sheet: str  # Chemin relatif depuis public/assets/
    cols: int
    rows: int
    cell_width: int
    cell_height: int
    frame_count: int
    fps: int = TARGET_FPS
    pivot_x: float = DEFAULT_PIVOT[0]
    pivot_y: float = DEFAULT_PIVOT[1]
    loop: bool = True
    phase: int = 1
    states: Tuple[StateRangeSpec, ...] = ()
    anatomical_layers: Tuple[str, ...] = ("torso",)


def _six_state_enemy_ranges() -> Tuple[StateRangeSpec, ...]:
    """6 états × 15 frames = 90 frames exactes à 30 FPS."""
    return (
        StateRangeSpec("idle", 0, 15, True),
        StateRangeSpec("move", 15, 15, True),
        StateRangeSpec("windup", 30, 15, False),
        StateRangeSpec("attack", 45, 15, False),
        StateRangeSpec("hurt", 60, 15, False),
        StateRangeSpec("death", 75, 15, False),
    )


TARGET_SHEETS: Tuple[SpriteSheetJob, ...] = (
    # --- Héros (4 feuilles) ---
    SpriteSheetJob(
        id="hero_base_idle",
        category="hero",
        source_png="characters/hero_base_idle.png",
        output_sheet="characters/hero_base_idle_sheet.png",
        cols=6,
        rows=5,
        cell_width=512,
        cell_height=512,
        frame_count=30,
        loop=True,
        states=(StateRangeSpec("idle", 0, 30, True),),
        anatomical_layers=("tail", "left_arm", "left_leg", "torso", "right_leg", "head", "right_arm"),
    ),
    SpriteSheetJob(
        id="hero_base_walk",
        category="hero",
        source_png="characters/hero_base_idle.png",
        output_sheet="characters/hero_base_walk_sheet.png",
        cols=6,
        rows=5,
        cell_width=512,
        cell_height=512,
        frame_count=30,
        loop=True,
        states=(StateRangeSpec("walk", 0, 30, True),),
        anatomical_layers=("tail", "left_arm", "left_leg", "torso", "right_leg", "head", "right_arm"),
    ),
    SpriteSheetJob(
        id="hero_base_attack",
        category="hero",
        source_png="characters/hero_base_idle.png",
        output_sheet="characters/hero_base_attack_sheet.png",
        cols=5,
        rows=3,
        cell_width=512,
        cell_height=512,
        frame_count=15,
        loop=False,
        states=(StateRangeSpec("attack", 0, 15, False),),
        anatomical_layers=("tail", "left_arm", "left_leg", "torso", "right_leg", "head", "right_arm"),
    ),
    SpriteSheetJob(
        id="hero_base_roll",
        category="hero",
        source_png="characters/hero_base_idle.png",
        output_sheet="characters/hero_base_roll_sheet.png",
        cols=5,
        rows=3,
        cell_width=512,
        cell_height=512,
        frame_count=15,
        loop=False,
        states=(StateRangeSpec("roll", 0, 15, False),),
        anatomical_layers=("tail", "left_arm", "left_leg", "torso", "right_leg", "head", "right_arm"),
    ),
    # --- Compagnon & PNJ ---
    SpriteSheetJob(
        id="miaou_sprit",
        category="npc",
        source_png="characters/miaou_sprit.png",
        output_sheet="characters/miaou_sprit_sheet.png",
        cols=6,
        rows=5,
        cell_width=512,
        cell_height=512,
        frame_count=30,
        loop=True,
        states=(
            StateRangeSpec("idle", 0, 15, True),
            StateRangeSpec("move", 15, 10, True),
            StateRangeSpec("talk", 25, 5, True),
        ),
        anatomical_layers=("tail", "wings", "torso", "head"),
    ),
    SpriteSheetJob(
        id="mayor_moustache",
        category="npc",
        source_png="characters/mayor_moustache.png",
        output_sheet="characters/mayor_moustache_sheet.png",
        cols=9,
        rows=5,
        cell_width=384,
        cell_height=384,
        frame_count=45,
        loop=True,
        states=(
            StateRangeSpec("idle", 0, 15, True),
            StateRangeSpec("talk", 15, 15, True),
            StateRangeSpec("greet", 30, 15, False),
        ),
        anatomical_layers=("left_arm", "torso", "head", "jaw", "right_arm"),
    ),
    # --- 5 Ennemis réguliers (10×9, 90 frames = 6 états × 15 frames) ---
    SpriteSheetJob(
        id="slime_yarn",
        category="enemy",
        source_png="characters/slime_yarn.png",
        output_sheet="characters/slime_yarn_sheet.png",
        cols=10,
        rows=9,
        cell_width=256,
        cell_height=256,
        frame_count=90,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("tail", "torso", "head"),
    ),
    SpriteSheetJob(
        id="mouse_goblin",
        category="enemy",
        source_png="characters/mouse_goblin.png",
        output_sheet="characters/mouse_goblin_sheet.png",
        cols=10,
        rows=9,
        cell_width=256,
        cell_height=256,
        frame_count=90,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("tail", "left_arm", "left_leg", "torso", "right_leg", "head", "right_arm"),
    ),
    SpriteSheetJob(
        id="thorn_wolf",
        category="enemy",
        source_png="characters/thorn_wolf.png",
        output_sheet="characters/thorn_wolf_sheet.png",
        cols=10,
        rows=9,
        cell_width=256,
        cell_height=256,
        frame_count=90,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("tail", "left_leg", "torso", "right_leg", "head", "jaw"),
    ),
    SpriteSheetJob(
        id="fishbone_skeleton",
        category="enemy",
        source_png="characters/fishbone_skeleton.png",
        output_sheet="characters/fishbone_skeleton_sheet.png",
        cols=10,
        rows=9,
        cell_width=256,
        cell_height=256,
        frame_count=90,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("tail", "left_arm", "left_leg", "torso", "right_leg", "head", "jaw", "right_arm"),
    ),
    SpriteSheetJob(
        id="frost_golem",
        category="enemy",
        source_png="characters/frost_golem.png",
        output_sheet="characters/frost_golem_sheet.png",
        cols=10,
        rows=9,
        cell_width=384,
        cell_height=384,
        frame_count=90,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("left_arm", "left_leg", "torso", "right_leg", "head", "right_arm"),
    ),
    # --- Boss (10×9, 384×384, 90 frames = 6 états × 15 frames) ---
    SpriteSheetJob(
        id="boss_rat_king",
        category="boss",
        source_png="characters/boss_rat_king.png",
        output_sheet="characters/boss_rat_king_sheet.png",
        cols=10,
        rows=9,
        cell_width=384,
        cell_height=384,
        frame_count=90,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("cape", "tail", "left_arm", "left_leg", "torso", "right_leg", "head", "crown", "right_arm"),
    ),
    SpriteSheetJob(
        id="boss_dragon_claw",
        category="boss",
        source_png="characters/boss_dragon_claw.png",
        output_sheet="characters/boss_dragon_claw_sheet.png",
        cols=10,
        rows=9,
        cell_width=384,
        cell_height=384,
        frame_count=90,
        phase=1,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("wings_back", "tail", "left_leg", "torso", "right_leg", "wings_front", "head", "jaw"),
    ),
    SpriteSheetJob(
        id="boss_dragon_claw_p2",
        category="boss",
        source_png="characters/boss_dragon_claw.png",
        output_sheet="characters/boss_dragon_claw_p2_sheet.png",
        cols=10,
        rows=9,
        cell_width=384,
        cell_height=384,
        frame_count=90,
        phase=2,
        states=_six_state_enemy_ranges(),
        anatomical_layers=("wings_back", "tail", "left_leg", "torso", "right_leg", "wings_front", "head", "jaw"),
    ),
    # --- Props animés ---
    SpriteSheetJob(
        id="portal_exit",
        category="prop",
        source_png="props/portal_dungeon.png",
        output_sheet="props/portal_exit_sheet.png",
        cols=6,
        rows=5,
        cell_width=256,
        cell_height=256,
        frame_count=30,
        pivot_x=0.5,
        pivot_y=0.05,
        loop=True,
        states=(StateRangeSpec("vortex", 0, 30, True),),
        anatomical_layers=("ring_outer", "vortex_core", "runes_front"),
    ),
    SpriteSheetJob(
        id="prop_torch",
        category="prop",
        source_png="props/prop_torch.png",
        output_sheet="props/prop_torch_sheet.png",
        cols=5,
        rows=3,
        cell_width=256,
        cell_height=256,
        frame_count=15,
        pivot_x=0.5,
        pivot_y=0.05,
        loop=True,
        states=(StateRangeSpec("burn", 0, 15, True),),
        anatomical_layers=("sconce", "flame_outer", "flame_inner"),
    ),
)


# =============================================================================
# 2. COURBES TRIPLE A : OVERSHOOT 180° FEUILLE RIGIDE & SOCKETS HIÉRARCHIQUES
# =============================================================================

def eval_paper_flip_overshoot(progress: float) -> float:
    """
    Évalue un retournement 180° façon feuille rigide (0 -> pi radians) avec
    courbe d'overshoot (~12° de dépassement amorti) pour le feeling 2.5D Triple A.
    """
    t = max(0.0, min(1.0, progress))
    # Back-out easing (c1 = 1.70158 -> dépassement naturel avant stabilisation)
    c1 = 1.70158
    c3 = c1 + 1.0
    eased = 1.0 + c3 * ((t - 1.0) ** 3) + c1 * ((t - 1.0) ** 2)
    return eased * math.pi


def sample_hero_frame_sockets(state: str, frame_index: int, frame_count: int) -> Dict[str, Dict[str, float]]:
    """
    Calcule les positions et rotations normalisées (espace local 0..1 autour du
    pivot [0.5, 0.06], +Y vers le haut) des 12 sockets du héros pour une frame.
    """
    phase = (frame_index / max(1, frame_count)) * math.tau
    prog = frame_index / max(1, frame_count - 1) if frame_count > 1 else 0.0

    # Valeurs de repos de base (calibrées sur hero_base_idle.png 512×512)
    breath = math.sin(phase) * 0.012 if state == "idle" else 0.0
    walk_bob = abs(math.sin(phase)) * 0.026 if state == "walk" else 0.0
    walk_stride = math.sin(phase) if state == "walk" else 0.0

    body_y = breath + walk_bob
    body_rot = 0.0
    weapon_dx = 0.21
    weapon_dy = 0.34 + body_y
    weapon_rot = -0.18 + math.sin(phase) * 0.04
    shield_dx = -0.19
    shield_dy = 0.33 + body_y
    shield_rot = 0.05
    head_y = 0.66 + body_y * 1.15
    head_rot = math.sin(phase * 0.5) * 0.03
    lf_x, lf_y = -0.09, 0.08
    rf_x, rf_y = 0.09, 0.08

    if state == "walk":
        body_rot = -0.07 + math.sin(phase * 2.0) * 0.03
        lf_x = -0.08 + walk_stride * 0.11
        lf_y = 0.08 + max(0.0, walk_stride) * 0.05
        rf_x = 0.08 - walk_stride * 0.11
        rf_y = 0.08 + max(0.0, -walk_stride) * 0.05
        weapon_dx = 0.21 + walk_stride * 0.04
        weapon_rot = -0.22 - walk_stride * 0.24
        shield_dx = -0.19 - walk_stride * 0.03
        shield_rot = 0.06 + walk_stride * 0.12
    elif state == "attack":
        # Anticipation (0..0.28) -> Impact violent (0.28..0.58) -> Inertie/Suivi (0.58..1.0)
        if prog < 0.28:
            t = prog / 0.28
            body_rot = 0.18 * t
            weapon_dx = 0.16 - 0.14 * t
            weapon_dy = 0.44 + 0.12 * t
            weapon_rot = 1.25 * t
            shield_dx = -0.22
        elif prog < 0.58:
            t = (prog - 0.28) / 0.30
            snap = 1.0 - (1.0 - t) ** 3
            body_rot = 0.18 - 0.44 * snap
            weapon_dx = 0.02 + 0.36 * snap
            weapon_dy = 0.56 - 0.28 * snap
            weapon_rot = 1.25 - 2.65 * snap
            shield_dx = -0.18 - 0.04 * snap
        else:
            t = (prog - 0.58) / 0.42
            ease = 1.0 - (1.0 - t) ** 2
            body_rot = -0.26 * (1.0 - ease)
            weapon_dx = 0.38 - 0.17 * ease
            weapon_dy = 0.28 + 0.06 * ease
            weapon_rot = -1.40 + 1.22 * ease
    elif state == "roll":
        spin = prog * math.tau
        body_rot = -spin
        body_y = math.sin(prog * math.pi) * 0.14
        head_y = 0.52 + body_y
        weapon_dx = 0.12 * math.cos(spin)
        weapon_dy = 0.34 + body_y + 0.10 * math.sin(spin)
        weapon_rot = -spin - 0.4
        shield_dx = -0.12 * math.cos(spin)
        shield_dy = 0.34 + body_y - 0.10 * math.sin(spin)

    def _s(x: float, y: float, z: float, rot: float = 0.0, sx: float = 1.0, sy: float = 1.0) -> Dict[str, float]:
        return {
            "x": round(x, 4),
            "y": round(y, 4),
            "z": round(z, 4),
            "rot": round(rot, 4),
            "sx": round(sx, 4),
            "sy": round(sy, 4),
        }

    return {
        "head": _s(0.0, head_y, LAYER_Z_STEP * 3, head_rot),
        "torso": _s(0.0, 0.38 + body_y, LAYER_Z_STEP * 1, body_rot),
        "leftHand": _s(shield_dx, shield_dy, LAYER_Z_STEP * 2, shield_rot),
        "rightHand": _s(weapon_dx, weapon_dy, LAYER_Z_STEP * 4, weapon_rot),
        "leftFoot": _s(lf_x, lf_y, LAYER_Z_STEP * 0, walk_stride * 0.18),
        "rightFoot": _s(rf_x, rf_y, LAYER_Z_STEP * 2, -walk_stride * 0.18),
        "weapon": _s(weapon_dx, weapon_dy, LAYER_Z_STEP * 5, weapon_rot),
        "shield": _s(shield_dx, shield_dy, LAYER_Z_STEP * 3, shield_rot),
        "trinket": _s(0.05, 0.46 + body_y, LAYER_Z_STEP * 4, -body_rot * 0.5),
        "cape": _s(-0.04, 0.52 + body_y, -LAYER_Z_STEP * 2, body_rot * 0.4),
        "lanternBelt": _s(-0.14, 0.29 + body_y, LAYER_Z_STEP * 4, walk_stride * 0.15),
        "lanternHand": _s(-0.26, 0.40 + body_y, LAYER_Z_STEP * 6, -0.08 + walk_stride * 0.22),
    }


# =============================================================================
# 3. SEGMENTATION (MEDIAPIPE POSE / DWPOSE + SAM 2) & INPAINTING OPENCV
# =============================================================================

@dataclass
class JointLandmarks:
    points: Dict[str, Tuple[float, float]]  # normalisés [0..1] (x, y depuis le haut)
    backend: str


@dataclass
class SegmentedLayer:
    name: str
    z_offset: float
    rgba: Any  # np.ndarray (H, W, 4) uint8
    pivot_px: Tuple[float, float]
    bbox: Tuple[int, int, int, int]


def detect_pose_landmarks(rgba: Any, job: SpriteSheetJob) -> JointLandmarks:
    """
    Étape 1A : Détecte les articulations avec MediaPipe Pose (ou DWPose si
    disponible) et complète les os non-humanoïdes (queue, oreilles, mâchoire,
    ailes) par analyse de silhouette alpha.
    """
    h, w = rgba.shape[:2]
    points: Dict[str, Tuple[float, float]] = {}
    backend = "silhouette_heuristic"

    if mp is not None and hasattr(mp, "solutions") and hasattr(mp.solutions, "pose"):
        rgb = rgba[:, :, :3]
        with mp.solutions.pose.Pose(
            static_image_mode=True,
            model_complexity=2,
            min_detection_confidence=0.35,
        ) as pose:
            res = pose.process(rgb)
            if res.pose_landmarks:
                lm = res.pose_landmarks.landmark
                p_enum = mp.solutions.pose.PoseLandmark
                mapping = {
                    "head": p_enum.NOSE,
                    "left_shoulder": p_enum.LEFT_SHOULDER,
                    "right_shoulder": p_enum.RIGHT_SHOULDER,
                    "left_hand": p_enum.LEFT_WRIST,
                    "right_hand": p_enum.RIGHT_WRIST,
                    "left_hip": p_enum.LEFT_HIP,
                    "right_hip": p_enum.RIGHT_HIP,
                    "left_foot": p_enum.LEFT_ANKLE,
                    "right_foot": p_enum.RIGHT_ANKLE,
                }
                for key, idx in mapping.items():
                    pt = lm[idx]
                    points[key] = (float(pt.x), float(pt.y))
                backend = "mediapipe_pose"

    # Complément anatomique calibré sur la boîte englobante alpha du sprite
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 20)
    if len(xs) > 0:
        x0, x1 = float(xs.min()) / w, float(xs.max()) / w
        y0, y1 = float(ys.min()) / h, float(ys.max()) / h
    else:
        x0, y0, x1, y1 = 0.2, 0.15, 0.8, 0.94

    cx = 0.5 * (x0 + x1)
    bw = max(0.05, x1 - x0)
    bh = max(0.05, y1 - y0)

    defaults: Dict[str, Tuple[float, float]] = {
        "head": (cx, y0 + bh * 0.24),
        "jaw": (cx + bw * 0.08, y0 + bh * 0.34),
        "crown": (cx, y0 + bh * 0.10),
        "torso": (cx, y0 + bh * 0.56),
        "left_arm": (cx - bw * 0.28, y0 + bh * 0.54),
        "right_arm": (cx + bw * 0.28, y0 + bh * 0.54),
        "left_leg": (cx - bw * 0.14, y0 + bh * 0.84),
        "right_leg": (cx + bw * 0.14, y0 + bh * 0.84),
        "tail": (cx - bw * 0.34, y0 + bh * 0.68),
        "wings_back": (cx - bw * 0.32, y0 + bh * 0.36),
        "wings_front": (cx + bw * 0.32, y0 + bh * 0.36),
        "wings": (cx - bw * 0.28, y0 + bh * 0.40),
        "cape": (cx - bw * 0.20, y0 + bh * 0.58),
        "sconce": (cx, y0 + bh * 0.72),
        "flame_outer": (cx, y0 + bh * 0.32),
        "flame_inner": (cx, y0 + bh * 0.36),
        "ring_outer": (cx, y0 + bh * 0.50),
        "vortex_core": (cx, y0 + bh * 0.50),
        "runes_front": (cx, y0 + bh * 0.50),
    }
    for k, v in defaults.items():
        points.setdefault(k, v)

    return JointLandmarks(points=points, backend=backend)


def segment_limbs_sam2_or_voronoi(
    rgba: Any,
    landmarks: JointLandmarks,
    job: SpriteSheetJob,
    sam2_checkpoint: Optional[str] = None,
    sam2_config: Optional[str] = None,
) -> List[SegmentedLayer]:
    """
    Étape 1B : Segmente chaque calque anatomique via SAM 2 (prompté par les
    points d'articulation détectés) avec repli déterministe Voronoi-alpha afin
    que le script reste 100 % exécutable même sans poids GPU SAM 2 installés.
    """
    h, w = rgba.shape[:2]
    alpha_mask = (rgba[:, :, 3] > 16).astype(np.uint8)
    layer_names = job.anatomical_layers
    masks: Dict[str, Any] = {}

    predictor = None
    if (
        SAM2ImagePredictor is not None
        and build_sam2 is not None
        and sam2_checkpoint
        and sam2_config
        and os.path.exists(sam2_checkpoint)
    ):
        device = "cuda" if (torch is not None and torch.cuda.is_available()) else "cpu"
        sam_model = build_sam2(sam2_config, sam2_checkpoint, device=device)
        predictor = SAM2ImagePredictor(sam_model)
        predictor.set_image(rgba[:, :, :3])

    if predictor is not None:
        all_pts = {
            name: (
                int(landmarks.points.get(name, (0.5, 0.5))[0] * w),
                int(landmarks.points.get(name, (0.5, 0.5))[1] * h),
            )
            for name in layer_names
        }
        for name in layer_names:
            pos = all_pts[name]
            neg = [pt for other, pt in all_pts.items() if other != name]
            coords = np.array([pos] + neg, dtype=np.float32)
            labels = np.array([1] + [0] * len(neg), dtype=np.int32)
            pred_masks, scores, _ = predictor.predict(
                point_coords=coords,
                point_labels=labels,
                multimask_output=True,
            )
            best_idx = int(np.argmax(scores))
            masks[name] = ((pred_masks[best_idx] > 0.5).astype(np.uint8) & alpha_mask)
    else:
        # Partition Voronoi douce pondérée dans le masque alpha existant
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        dist_stack = []
        for name in layer_names:
            jx, jy = landmarks.points.get(name, (0.5, 0.5))
            dx = (xx - jx * w) / max(1.0, w)
            dy = (yy - jy * h) / max(1.0, h)
            # Le torse couvre une zone centrale légèrement plus large
            weight = 0.78 if name == "torso" else 1.0
            dist_stack.append((dx * dx + dy * dy) * weight)
        owner = np.argmin(np.stack(dist_stack, axis=0), axis=0)
        for idx, name in enumerate(layer_names):
            masks[name] = ((owner == idx).astype(np.uint8) & alpha_mask)

    layers: List[SegmentedLayer] = []
    for idx, name in enumerate(layer_names):
        m = masks[name]
        layer_rgba = rgba.copy()
        layer_rgba[:, :, 3] = np.where(m > 0, rgba[:, :, 3], 0)
        jx, jy = landmarks.points.get(name, (0.5, 0.5))
        ys, xs = np.where(m > 0)
        bbox = (
            (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max()))
            if len(xs) > 0
            else (0, 0, w - 1, h - 1)
        )
        layers.append(
            SegmentedLayer(
                name=name,
                z_offset=idx * LAYER_Z_STEP,
                rgba=layer_rgba,
                pivot_px=(jx * w, jy * h),
                bbox=bbox,
            )
        )
    return layers


def inpaint_occluded_joints(
    source_rgba: Any,
    layers: List[SegmentedLayer],
    method: str = "telea",
    joint_radius_px: int = 12,
) -> List[SegmentedLayer]:
    """
    Étape 2 : Comble uniquement les zones masquées sous les articulations
    lors des rotations via OpenCV `cv2.inpaint` (Telea ou Navier-Stokes),
    sans modifier un seul pixel déjà visible du calque.
    """
    if cv2 is None or np is None:
        return layers

    inpaint_flag = cv2.INPAINT_NS if method.lower() == "ns" else cv2.INPAINT_TELEA
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (joint_radius_px * 2 + 1, joint_radius_px * 2 + 1)
    )
    source_bgr = cv2.cvtColor(source_rgba[:, :, :3], cv2.COLOR_RGB2BGR)
    source_alpha = (source_rgba[:, :, 3] > 16).astype(np.uint8)

    # Chaque calque sous-jacent reçoit un léger débord inpainté sous les calques supérieurs
    for i, layer in enumerate(layers):
        own_mask = (layer.rgba[:, :, 3] > 16).astype(np.uint8)
        if not np.any(own_mask):
            continue

        upper_mask = np.zeros_like(own_mask)
        for upper in layers[i + 1 :]:
            upper_mask |= (upper.rgba[:, :, 3] > 16).astype(np.uint8)

        dilated_own = cv2.dilate(own_mask, kernel, iterations=1)
        # Zone strictement cachée sous un membre supérieur et appartenant à la silhouette source
        occluded_band = (dilated_own & upper_mask & source_alpha & (1 - own_mask)).astype(np.uint8) * 255
        if not np.any(occluded_band):
            continue

        # Prépare l'image d'entrée en ne conservant que le calque courant comme référence
        inpainted_bgr = cv2.inpaint(source_bgr, occluded_band, inpaintRadius=5, flags=inpaint_flag)
        inpainted_rgb = cv2.cvtColor(inpainted_bgr, cv2.COLOR_BGR2RGB)

        # Remplit STRICTEMENT les pixels cachés, préservant 100 % des pixels visibles d'origine
        fill_bool = occluded_band > 0
        out = layer.rgba.copy()
        out[fill_bool, :3] = inpainted_rgb[fill_bool]
        out[fill_bool, 3] = 255
        layer.rgba = out

    return layers


# =============================================================================
# 4. BLENDER BPY : ALPHA-TO-MESH 3D PLAT, AUTO-RIGGING & BAKING 30 FPS
# =============================================================================

def _ensure_blender_scene(cell_w: int, cell_h: int) -> Any:
    """Configure une scène Blender orthographique transparente (30 FPS, sRGB)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in dir(bpy.types) else "BLENDER_EEVEE"
    scene.render.fps = TARGET_FPS
    scene.render.resolution_x = cell_w
    scene.render.resolution_y = cell_h
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"  # Préserve les couleurs peintes exactes (sRGB)

    cam_data = bpy.data.cameras.new("OrthoBakeCam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.0
    cam_obj = bpy.data.objects.new("OrthoBakeCam", cam_data)
    scene.collection.objects.link(cam_obj)
    cam_obj.location = (0.0, -4.0, 1.0)
    cam_obj.rotation_euler = (math.pi * 0.5, 0.0, 0.0)
    scene.camera = cam_obj
    return scene


def _build_cutout_mesh_blender(
    layer: SegmentedLayer,
    layer_png_path: Path,
    grid_subdiv: int = 10,
) -> Any:
    """
    Étape 3 : Convertit un calque détouré en maillage 3D d'épaisseur zéro (Z = 0),
    subdivisé en grille interne (flexion + squash & stretch), mapping UV exact,
    matériau Double-Sided et micro-décalage Z (+0.002 par calque).
    """
    mesh = bpy.data.meshes.new(f"Cutout_{layer.name}")
    obj = bpy.data.objects.new(f"Cutout_{layer.name}", mesh)
    bpy.context.scene.collection.objects.link(obj)

    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=grid_subdiv, y_segments=grid_subdiv, size=1.0)

    uv_layer = bm.loops.layers.uv.new("UVMap")
    # Oriente la grille dans le plan XZ (face caméra -Y) et centre le pivot au sol (z = 0..2)
    for v in bm.verts:
        x_local = v.co.x  # [-1, 1]
        y_local = v.co.y  # [-1, 1]
        v.co.x = x_local
        v.co.y = -layer.z_offset  # Micro-décalage profondeur caméra (+0.002 par couche)
        v.co.z = y_local + 1.0  # [0, 2]

    for face in bm.faces:
        for loop in face.loops:
            u = (loop.vert.co.x + 1.0) * 0.5
            v_coord = loop.vert.co.z * 0.5
            loop[uv_layer].uv = (u, v_coord)

    bm.to_mesh(mesh)
    bm.free()

    # Matériau Double-Sided sans spéculaire plastique (fidélité 2D peinture)
    mat = bpy.data.materials.new(name=f"Mat_{layer.name}")
    mat.use_nodes = True
    mat.use_backface_culling = False  # Double-Sided pour flip 180°
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out_node = nodes.new("ShaderNodeOutputMaterial")
    mix_node = nodes.new("ShaderNodeMixShader")
    transp_node = nodes.new("ShaderNodeBsdfTransparent")
    emit_node = nodes.new("ShaderNodeEmission")
    tex_node = nodes.new("ShaderNodeTexImage")

    img = bpy.data.images.load(str(layer_png_path), check_existing=True)
    img.colorspace_settings.name = "sRGB"
    tex_node.image = img
    tex_node.extension = "CLIP"

    links.new(tex_node.outputs["Color"], emit_node.inputs["Color"])
    links.new(tex_node.outputs["Alpha"], mix_node.inputs["Fac"])
    links.new(transp_node.outputs["BSDF"], mix_node.inputs[1])
    links.new(emit_node.outputs["Emission"], mix_node.inputs[2])
    links.new(mix_node.outputs["Shader"], out_node.inputs["Surface"])

    if hasattr(mat, "blend_method"):
        mat.blend_method = "BLEND"
    obj.data.materials.append(mat)
    return obj


def _create_armature_and_skin(
    layers: List[SegmentedLayer],
    mesh_objects: Dict[str, Any],
    img_w: int,
    img_h: int,
) -> Any:
    """Étape 4A : Place une armature 3D alignée sur les articulations et skinne les maillages."""
    arm_data = bpy.data.armatures.new("FelingardRig")
    arm_obj = bpy.data.objects.new("FelingardRig", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="EDIT")

    root_bone = arm_data.edit_bones.new("root")
    root_bone.head = (0.0, 0.0, 0.0)
    root_bone.tail = (0.0, 0.0, 0.35)

    for layer in layers:
        px, py = layer.pivot_px
        bx = (px / max(1, img_w) - 0.5) * 2.0
        bz = (1.0 - py / max(1, img_h)) * 2.0
        eb = arm_data.edit_bones.new(layer.name)
        eb.head = (bx, -layer.z_offset, bz)
        eb.tail = (bx, -layer.z_offset, bz + 0.25)
        eb.parent = root_bone

    bpy.ops.object.mode_set(mode="OBJECT")

    for layer in layers:
        obj = mesh_objects[layer.name]
        vg = obj.vertex_groups.new(name=layer.name)
        all_idx = [v.index for v in obj.data.vertices]
        vg.add(all_idx, 1.0, "REPLACE")
        mod = obj.modifiers.new(name="Armature", type="ARMATURE")
        mod.object = arm_obj
    return arm_obj


def _keyframe_triple_a_animation(arm_obj: Any, job: SpriteSheetJob) -> None:
    """
    Étape 4B : Anime les os de l'armature à 30 FPS avec anticipation, poids,
    squash & stretch, inertie et impacts distincts pour chaque état.
    """
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.object.mode_set(mode="POSE")
    pose_bones = arm_obj.pose.bones

    for state in job.states:
        for local_f in range(state.frame_count):
            global_f = state.start_frame + local_f + 1  # Blender frames 1-indexed
            phase = (local_f / max(1, state.frame_count)) * math.tau
            prog = local_f / max(1, state.frame_count - 1) if state.frame_count > 1 else 0.0

            root = pose_bones.get("root")
            if root is None:
                continue

            # Squash & stretch + dynamique par état
            sx, sz = 1.0, 1.0
            tz = 0.0
            ry = 0.0

            if state.name in ("idle", "vortex", "burn"):
                breath = math.sin(phase) * 0.035
                sx = 1.0 - breath * 0.5
                sz = 1.0 + breath
                tz = abs(math.sin(phase)) * 0.02 if job.id == "miaou_sprit" else 0.0
            elif state.name in ("walk", "move"):
                hop = abs(math.sin(phase))
                sx = 1.04 - hop * 0.08
                sz = 0.96 + hop * 0.09
                tz = hop * 0.08
                ry = math.sin(phase) * 0.08
            elif state.name == "windup":
                # Anticipation lourde vers l'arrière avant frappe
                t = prog * prog
                sx = 1.0 + 0.14 * t
                sz = 1.0 - 0.14 * t
                ry = 0.24 * t
            elif state.name == "attack":
                # Détente explosive + suivi inertiel
                snap = math.sin(min(1.0, prog * 1.4) * math.pi)
                sx = 1.0 - 0.10 * snap
                sz = 1.0 + 0.12 * snap
                ry = -0.32 * snap
            elif state.name == "roll":
                ry = -prog * math.tau
                tz = math.sin(prog * math.pi) * 0.22
                sx = 0.92
                sz = 0.92
            elif state.name == "hurt":
                recoil = math.sin(prog * math.pi)
                sx = 1.12 * recoil + (1.0 - recoil)
                sz = 0.88 * recoil + (1.0 - recoil)
                ry = 0.28 * recoil
            elif state.name == "death":
                collapse = prog * prog
                sx = 1.0 + 0.22 * collapse
                sz = max(0.25, 1.0 - 0.72 * collapse)
                ry = 1.15 * collapse
            elif state.name in ("talk", "greet"):
                nod = math.sin(phase * 2.0) * 0.06
                sz = 1.0 + abs(nod) * 0.4
                ry = nod

            # Phase 2 du Dragon-Chat : pulsation amplifiée de crinière/mâchoire
            if job.phase == 2:
                sz *= 1.0 + math.sin(phase * 2.0) * 0.04

            root.location = (0.0, 0.0, tz)
            root.rotation_mode = "XYZ"
            root.rotation_euler = (0.0, ry, 0.0)
            root.scale = (sx, 1.0, sz)
            root.keyframe_insert(data_path="location", frame=global_f)
            root.keyframe_insert(data_path="rotation_euler", frame=global_f)
            root.keyframe_insert(data_path="scale", frame=global_f)

            # Animation secondaire des membres (bras, jambes, queue, mâchoire, ailes)
            for pb in pose_bones:
                if pb.name == "root":
                    continue
                pb.rotation_mode = "XYZ"
                sub_ry = 0.0
                if "arm" in pb.name:
                    sign = 1.0 if "right" in pb.name else -1.0
                    sub_ry = math.sin(phase) * (0.45 if state.name in ("walk", "move", "attack") else 0.08) * sign
                elif "leg" in pb.name:
                    sign = 1.0 if "right" in pb.name else -1.0
                    sub_ry = -math.sin(phase) * (0.50 if state.name in ("walk", "move") else 0.03) * sign
                elif pb.name == "tail":
                    sub_ry = math.sin(phase - 0.65) * 0.28
                elif pb.name == "jaw":
                    sub_ry = abs(math.sin(phase * 2.0)) * (0.30 if state.name in ("talk", "attack", "windup") else 0.06)
                elif "wings" in pb.name:
                    sign = 1.0 if "front" in pb.name else -1.0
                    sub_ry = math.sin(phase) * 0.34 * sign
                elif pb.name in ("flame_outer", "flame_inner"):
                    sub_ry = math.sin(phase * 2.0 + (0.6 if pb.name == "flame_inner" else 0.0)) * 0.22
                elif pb.name == "vortex_core":
                    sub_ry = prog * math.tau

                pb.rotation_euler = (0.0, sub_ry, 0.0)
                pb.keyframe_insert(data_path="rotation_euler", frame=global_f)

    bpy.ops.object.mode_set(mode="OBJECT")


def _bake_job_in_blender(
    job: SpriteSheetJob,
    assets_dir: Path,
    output_dir: Path,
    inpaint_method: str,
    sam2_checkpoint: Optional[str],
    sam2_config: Optional[str],
) -> None:
    """Exécute les 5 étapes complètes pour un SpriteSheetJob et écrit le PNG final."""
    if bpy is None or Image is None or np is None:
        raise RuntimeError(
            "Le baking complet requiert Blender (`bpy`), Pillow et NumPy. "
            "Utilisez `--manifest-only` hors Blender."
        )

    src_path = assets_dir / job.source_png
    if not src_path.exists():
        raise FileNotFoundError(f"Asset PNG source introuvable : {src_path}")

    rgba = np.array(Image.open(src_path).convert("RGBA"))
    h, w = rgba.shape[:2]

    landmarks = detect_pose_landmarks(rgba, job)
    layers = segment_limbs_sam2_or_voronoi(
        rgba, landmarks, job, sam2_checkpoint=sam2_checkpoint, sam2_config=sam2_config
    )
    layers = inpaint_occluded_joints(rgba, layers, method=inpaint_method)

    tmp_dir = output_dir / ".bake_tmp" / job.id
    tmp_dir.mkdir(parents=True, exist_ok=True)

    scene = _ensure_blender_scene(job.cell_width, job.cell_height)
    mesh_objects: Dict[str, Any] = {}
    for layer in layers:
        layer_png = tmp_dir / f"{layer.name}.png"
        Image.fromarray(layer.rgba, mode="RGBA").save(layer_png)
        mesh_objects[layer.name] = _build_cutout_mesh_blender(layer, layer_png)

    arm_obj = _create_armature_and_skin(layers, mesh_objects, w, h)
    _keyframe_triple_a_animation(arm_obj, job)

    atlas_w = job.cols * job.cell_width
    atlas_h = job.rows * job.cell_height
    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))

    for frame_idx in range(job.frame_count):
        scene.frame_set(frame_idx + 1)
        frame_path = tmp_dir / f"frame_{frame_idx:03d}.png"
        scene.render.filepath = str(frame_path)
        bpy.ops.render.render(write_still=True)

        cell = Image.open(frame_path).convert("RGBA")
        col = frame_idx % job.cols
        row = frame_idx // job.cols
        atlas.paste(cell, (col * job.cell_width, row * job.cell_height))

    out_path = output_dir / job.output_sheet
    out_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(out_path, optimize=True)


def _read_png_dimensions(png_path: Path) -> Optional[Tuple[int, int]]:
    """Lit les dimensions (width, height) depuis l'en-tête IHDR d'un PNG sans dépendance externe."""
    if not png_path.exists():
        return None
    try:
        with png_path.open("rb") as fh:
            header = fh.read(24)
        if len(header) < 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
            return None
        width, height = struct.unpack(">II", header[16:24])
        return (int(width), int(height))
    except Exception:
        return None


def _bake_jobs_autonomous_25d(
    jobs: Sequence[SpriteSheetJob],
    assets_dir: Path,
    output_dir: Path,
    include_chest_sheet: bool = True,
) -> List[str]:
    """
    Moteur autonome 2.5D orthographique (fallback automatique hors Blender CLI).
    Exécute la segmentation anatomique, le rebouchage des joints cachés, la cinématique
    hiérarchique 30 FPS et l'export RGBA PNG exact des planches.
    """
    node_bin = shutil.which("node")
    rasterizer_script = Path(__file__).resolve().parent / "bake_25d_rasterizer.mjs"
    if not node_bin or not rasterizer_script.exists():
        raise RuntimeError(
            "Aucun moteur de rendu disponible : installez Blender (`bpy`) ou Node.js "
            f"avec {rasterizer_script}."
        )

    payload: List[Dict[str, Any]] = []
    for job in jobs:
        src_path = (assets_dir / job.source_png).resolve()
        if not src_path.exists():
            raise FileNotFoundError(f"Asset PNG source introuvable : {src_path}")
        out_path = (output_dir / job.output_sheet).resolve()
        payload.append(
            {
                "id": job.id,
                "sourcePath": str(src_path),
                "outputPath": str(out_path),
                "cols": job.cols,
                "rows": job.rows,
                "cellWidth": job.cell_width,
                "cellHeight": job.cell_height,
                "frameCount": job.frame_count,
            }
        )

    if include_chest_sheet:
        chest_closed = (assets_dir / "props/chest_closed.png").resolve()
        chest_open = (assets_dir / "props/chest_open.png").resolve()
        if chest_closed.exists() and chest_open.exists():
            payload.append(
                {
                    "id": "chest_opening",
                    "sourcePath": str(chest_closed),
                    "secondarySourcePath": str(chest_open),
                    "outputPath": str((output_dir / "props/chest_opening_sheet.png").resolve()),
                    "cols": 5,
                    "rows": 3,
                    "cellWidth": 256,
                    "cellHeight": 256,
                    "frameCount": 15,
                }
            )

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
        json.dump(payload, tmp, indent=2)
        tmp_path = Path(tmp.name)

    try:
        subprocess.run([node_bin, str(rasterizer_script), str(tmp_path)], check=True)
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    baked_ids: List[str] = []
    for job in jobs:
        dims = _read_png_dimensions(output_dir / job.output_sheet)
        expected = (job.cols * job.cell_width, job.rows * job.cell_height)
        if dims != expected:
            raise RuntimeError(
                f"Dimensions invalides après baking pour {job.id} : {dims} != {expected}"
            )
        baked_ids.append(job.id)
    return baked_ids


# =============================================================================
# 5. GÉNÉRATION DU MANIFESTE JSON (`public/assets/animations_manifest.json`)
# =============================================================================

def compute_row_major_uv(cols: int, rows: int, frame_index: int) -> Dict[str, float]:
    col = frame_index % cols
    row = frame_index // cols
    inv_cols = 1.0 / cols
    inv_rows = 1.0 / rows
    return {
        "col": col,
        "row": row,
        "repeatX": round(inv_cols, 6),
        "repeatY": round(inv_rows, 6),
        "offsetX": round(col * inv_cols, 6),
        "offsetY": round((rows - 1 - row) * inv_rows, 6),
    }


def build_manifest(assets_dir: Path, baked_ids: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    baked_set = set(baked_ids or ())
    sheets_payload: Dict[str, Any] = {}

    for job in TARGET_SHEETS:
        sheet_disk_path = assets_dir / job.output_sheet
        is_exact_baked = job.id in baked_set
        if not is_exact_baked:
            dims = _read_png_dimensions(sheet_disk_path)
            if dims is not None:
                is_exact_baked = dims == (job.cols * job.cell_width, job.rows * job.cell_height)

        states_dict: Dict[str, Any] = {}
        for st in job.states:
            states_dict[st.name] = {
                "startFrame": st.start_frame,
                "frameCount": st.frame_count,
                "loop": st.loop,
                "uvStart": compute_row_major_uv(job.cols, job.rows, st.start_frame),
            }

        entry: Dict[str, Any] = {
            "id": job.id,
            "category": job.category,
            "file": f"assets/{job.output_sheet}",
            "sourceFile": f"assets/{job.source_png}",
            "baked": is_exact_baked,
            "fps": job.fps,
            "cols": job.cols,
            "rows": job.rows,
            "cellWidth": job.cell_width,
            "cellHeight": job.cell_height,
            "atlasWidth": job.cols * job.cell_width,
            "atlasHeight": job.rows * job.cell_height,
            "frameCount": job.frame_count,
            "pivot": {"x": job.pivot_x, "y": job.pivot_y},
            "loop": job.loop,
            "phase": job.phase,
            "zLayerStep": LAYER_Z_STEP,
            "states": states_dict,
        }

        if job.category == "hero":
            hero_state = job.states[0].name
            entry["sockets"] = [
                sample_hero_frame_sockets(hero_state, f, job.frame_count)
                for f in range(job.frame_count)
            ]

        sheets_payload[job.id] = entry

    chest_sheet_dims = _read_png_dimensions(assets_dir / "props/chest_opening_sheet.png")
    return {
        "version": 1,
        "pipeline": "paper-cutout-3d-false-2d",
        "fps": TARGET_FPS,
        "fixedStepSec": round(1.0 / TARGET_FPS, 6),
        "zLayerOffset": LAYER_Z_STEP,
        "paperFlipOvershootDeg": 12.0,
        "sheetCount": len(TARGET_SHEETS),
        "socketIds": list(HERO_SOCKET_IDS),
        "chestOpeningSheet": {
            "file": "assets/props/chest_opening_sheet.png",
            "baked": chest_sheet_dims == (5 * 256, 3 * 256),
            "cols": 5,
            "rows": 3,
            "cellWidth": 256,
            "cellHeight": 256,
            "frameCount": 15,
            "fps": TARGET_FPS,
            "loop": False,
        },
        "sheets": sheets_payload,
    }


def parse_args(argv: Sequence[str]) -> argparse.Namespace:
    # Blender transmet ses propres flags avant `--`
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    parser = argparse.ArgumentParser(
        description="Baking offline 30 FPS Paper-Cutout 3D pour Les Chroniques de Félingard"
    )
    parser.add_argument("--assets-dir", type=Path, default=Path("public/assets"))
    parser.add_argument("--output-dir", type=Path, default=Path("public/assets"))
    parser.add_argument(
        "--inpaint-method", choices=("telea", "ns"), default="telea",
        help="Algorithme OpenCV cv2.inpaint pour les joints cachés"
    )
    parser.add_argument("--sam2-checkpoint", type=str, default=None)
    parser.add_argument("--sam2-config", type=str, default=None)
    parser.add_argument("--only", nargs="*", default=None, help="Filtrer par id de spritesheet")
    parser.add_argument("--manifest-only", action="store_true", help="Génère uniquement animations_manifest.json")
    parser.add_argument("--dry-run", action="store_true", help="Affiche le plan sans écrire sur disque")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    selected = [
        job for job in TARGET_SHEETS
        if not args.only or job.id in set(args.only)
    ]

    baked_ids: List[str] = []
    if not args.manifest_only:
        if args.dry_run:
            for job in selected:
                print(
                    f"[DRY-RUN] {job.id}: {job.source_png} -> {job.output_sheet} "
                    f"({job.cols}x{job.rows}, {job.cell_width}x{job.cell_height}, {job.frame_count}f @ {job.fps}fps)"
                )
        elif bpy is not None and Image is not None and np is not None:
            for job in selected:
                _bake_job_in_blender(
                    job=job,
                    assets_dir=args.assets_dir,
                    output_dir=args.output_dir,
                    inpaint_method=args.inpaint_method,
                    sam2_checkpoint=args.sam2_checkpoint,
                    sam2_config=args.sam2_config,
                )
                baked_ids.append(job.id)
        else:
            print("[INFO] Blender CLI absent -> bascule automatique sur le moteur 2.5D orthographique autonome.")
            baked_ids = _bake_jobs_autonomous_25d(
                jobs=selected,
                assets_dir=args.assets_dir,
                output_dir=args.output_dir,
                include_chest_sheet=(not args.only),
            )

    manifest = build_manifest(args.output_dir, baked_ids=baked_ids)
    manifest_path = args.output_dir / "animations_manifest.json"
    if not args.dry_run:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        baked_count = sum(1 for s in manifest["sheets"].values() if s.get("baked"))
        print(
            f"[OK] Manifeste 30 FPS écrit : {manifest_path} "
            f"({baked_count}/{len(TARGET_SHEETS)} feuilles baked=true)"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
