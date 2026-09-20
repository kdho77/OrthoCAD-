# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Gyroid TPMS infill (Phase A): marching squares isocontours + Shapely clip.

Field: f(x,y,z) = sin(kx)cos(ky) + sin(ky)cos(kz) + sin(kz)cos(kx) - t,  k = 2π/L,  t = 0.

Cell period law (seed): L₀ = GYROID_CELL_K * w / sqrt(φ).
Per-target multiplier μ from LUT (fitted on A1 40×40×6 coupon, w=0.48 mm) so planar fill
matches 14/20/26/32/38% ±5 points on infill layers.
"""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Iterable

import numpy as np
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry

GYROID_CELL_K = 2.4

_LUT_PATH = Path(__file__).resolve().parent / "gyroid_period_lut.json"

# Marching-squares edge order: bottom, right, top, left
_MS_CASES: dict[int, list[tuple[int, int]]] = {
    0: [],
    1: [(0, 3)],
    2: [(0, 1)],
    3: [(1, 3)],
    4: [(1, 2)],
    5: [(0, 3), (1, 2)],
    6: [(0, 2)],
    7: [(2, 3)],
    8: [(2, 3)],
    9: [(0, 2)],
    10: [(0, 1), (2, 3)],
    11: [(1, 2)],
    12: [(1, 3)],
    13: [(0, 1)],
    14: [(0, 3)],
    15: [],
}


def gyroid_cell_period_mm(extrusion_width_mm: float, infill_fraction: float) -> float:
    phi = max(0.05, min(0.5, infill_fraction))
    return GYROID_CELL_K * extrusion_width_mm / math.sqrt(phi)


def _lut_lookup_key(target_percent: int, extrusion_width_mm: float) -> str:
    """LUT keys are hardness % + line width; wall inset is taken from sliced contours."""
    return f"{target_percent}:{extrusion_width_mm:.4f}"


def _load_period_lut() -> dict[str, float]:
    if not _LUT_PATH.is_file():
        return {}
    with _LUT_PATH.open(encoding="utf-8") as f:
        raw = json.load(f)
    return {str(k): float(v) for k, v in raw.items() if not str(k).startswith("_")}


def _gyroid_field_grid(
    xs: np.ndarray,
    ys: np.ndarray,
    z: float,
    period: float,
    iso_level: float = 0.0,
) -> np.ndarray:
    k = 2.0 * math.pi / period
    return (
        np.sin(k * xs[:, None]) * np.cos(k * ys[None, :])
        + np.sin(k * ys[None, :]) * np.cos(k * z)
        + np.sin(k * z) * np.cos(k * xs[:, None])
        - iso_level
    )


def _polygon_area_xy(contour: np.ndarray) -> float:
    x, y = contour[:, 0], contour[:, 1]
    return 0.5 * float(abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1))))


def pick_infill_boundary(wall_contours: list[np.ndarray]) -> np.ndarray:
    valid = [c for c in wall_contours if len(c) >= 3]
    if not valid:
        raise ValueError("No valid wall contours for infill")
    return min(valid, key=lambda c: abs(_polygon_area_xy(c)))


def _interp_on_edge(v0: float, v1: float, p0: np.ndarray, p1: np.ndarray) -> np.ndarray:
    if abs(v1 - v0) < 1e-12:
        return (p0 + p1) * 0.5
    t = (0.0 - v0) / (v1 - v0)
    t = max(0.0, min(1.0, t))
    return p0 + t * (p1 - p0)


def marching_squares_segments(
    field: np.ndarray,
    xs: np.ndarray,
    ys: np.ndarray,
) -> list[np.ndarray]:
    """Extract f=0 isocontour segments from a scalar grid (marching squares)."""
    segments: list[np.ndarray] = []
    nx, ny = field.shape
    for i in range(nx - 1):
        for j in range(ny - 1):
            v00 = float(field[i, j])
            v10 = float(field[i + 1, j])
            v11 = float(field[i + 1, j + 1])
            v01 = float(field[i, j + 1])
            idx = 0
            if v00 > 0:
                idx |= 1
            if v10 > 0:
                idx |= 2
            if v11 > 0:
                idx |= 4
            if v01 > 0:
                idx |= 8
            if idx in (5, 10):
                vc = (v00 + v10 + v11 + v01) * 0.25
                if idx == 5:
                    idx = 1 if vc > 0 else 14
                else:
                    idx = 2 if vc > 0 else 13
            if idx in (0, 15):
                continue
            p00 = np.array([xs[i], ys[j]])
            p10 = np.array([xs[i + 1], ys[j]])
            p11 = np.array([xs[i + 1], ys[j + 1]])
            p01 = np.array([xs[i], ys[j + 1]])
            edges = [
                _interp_on_edge(v00, v10, p00, p10),
                _interp_on_edge(v10, v11, p10, p11),
                _interp_on_edge(v11, v01, p11, p01),
                _interp_on_edge(v01, v00, p01, p00),
            ]
            for e0, e1 in _MS_CASES.get(idx, []):
                segments.append(np.stack([edges[e0], edges[e1]]))
    return segments


def _geometry_to_segments(geom: BaseGeometry) -> list[np.ndarray]:
    out: list[np.ndarray] = []
    if geom.is_empty:
        return out
    if geom.geom_type == "LineString":
        coords = np.asarray(geom.coords, dtype=float)
        for i in range(len(coords) - 1):
            out.append(np.stack([coords[i], coords[i + 1]]))
    elif geom.geom_type == "MultiLineString":
        for part in geom.geoms:
            out.extend(_geometry_to_segments(part))
    elif geom.geom_type == "GeometryCollection":
        for part in geom.geoms:
            out.extend(_geometry_to_segments(part))
    return out


def clip_segments_to_contours(
    segments: Iterable[np.ndarray],
    wall_contours: list[np.ndarray],
) -> list[np.ndarray]:
    """Clip line segments to the inner infill region (Shapely intersection)."""
    boundary = pick_infill_boundary(wall_contours)
    poly = Polygon(boundary)
    if not poly.is_valid:
        poly = poly.buffer(0)
    clipped: list[np.ndarray] = []
    for seg in segments:
        if len(seg) < 2:
            continue
        line = LineString([(float(seg[0][0]), float(seg[0][1])), (float(seg[1][0]), float(seg[1][1]))])
        inter = line.intersection(poly)
        clipped.extend(_geometry_to_segments(inter))
    return clipped


def _segment_length(seg: np.ndarray) -> float:
    return float(np.linalg.norm(seg[1] - seg[0]))


def estimate_fill_fraction(
    segments: list[np.ndarray],
    wall_contours: list[np.ndarray],
    extrusion_width_mm: float,
) -> float:
    """Planar fill fraction φ = (Σ |segment| × w) / A_inner on infill layers."""
    boundary = pick_infill_boundary(wall_contours)
    area = abs(_polygon_area_xy(boundary))
    if area < 1e-6 or not segments:
        return 0.0
    total_len = sum(_segment_length(s) for s in segments)
    return (total_len * extrusion_width_mm) / area


def _grid_step_mm(period: float, extrusion_width_mm: float) -> float:
    return max(period / 12.0, 0.5 * extrusion_width_mm)


def _raw_gyroid_segments(
    boundary: np.ndarray,
    z: float,
    period: float,
    extrusion_width_mm: float,
) -> list[np.ndarray]:
    min_x, min_y = boundary.min(0)
    max_x, max_y = boundary.max(0)
    pad = period * 0.2
    min_x -= pad
    min_y -= pad
    max_x += pad
    max_y += pad
    step = _grid_step_mm(period, extrusion_width_mm)
    nx = max(12, int((max_x - min_x) / step) + 1)
    ny = max(12, int((max_y - min_y) / step) + 1)
    xs = np.linspace(min_x, max_x, nx)
    ys = np.linspace(min_y, max_y, ny)
    field = _gyroid_field_grid(xs, ys, z, period)
    return marching_squares_segments(field, xs, ys)


def _coupon_inner_boundary(extrusion_width_mm: float, perimeters: int) -> np.ndarray:
    inset = perimeters * extrusion_width_mm * 0.85
    half = 20.0 - inset
    return np.array([[-half, -half], [half, -half], [half, half], [-half, half]], dtype=float)


def _fit_period_multiplier(
    target_percent: int,
    extrusion_width_mm: float,
    perimeters: int,
    z: float,
) -> float:
    target_phi = target_percent / 100.0
    boundary = _coupon_inner_boundary(extrusion_width_mm, perimeters)
    wall = [boundary]
    lo, hi = 0.2, 8.0
    for _ in range(32):
        mid = (lo + hi) * 0.5
        period = mid * gyroid_cell_period_mm(extrusion_width_mm, target_phi)
        raw = _raw_gyroid_segments(boundary, z, period, extrusion_width_mm)
        segs = clip_segments_to_contours(raw, wall)
        measured = estimate_fill_fraction(segs, wall, extrusion_width_mm)
        if measured > target_phi:
            lo = mid
        else:
            hi = mid
    return (lo + hi) * 0.5


@lru_cache(maxsize=32)
def _period_multiplier(target_percent: int, extrusion_width_mm: float) -> float:
    """
    Read μ from checked-in LUT. On cache miss, fit in-memory for this call only (no disk write).
    Persist LUT updates via python-service/scripts/calibrate_gyroid_lut.py only.
    """
    lut = _load_period_lut()
    key = _lut_lookup_key(target_percent, extrusion_width_mm)
    if key in lut:
        return lut[key]
    return _fit_period_multiplier(target_percent, extrusion_width_mm, 3, z=3.0)


def generate_gyroid_infill_for_layer(
    wall_contours: list[np.ndarray],
    z: float,
    infill_fraction: float,
    extrusion_width_mm: float,
    perimeters: int = 3,  # noqa: ARG001 — wall inset comes from wall_contours at slice time
) -> list[np.ndarray]:
    if not wall_contours or infill_fraction <= 0.01:
        return []
    target_pct = int(round(infill_fraction * 100.0))
    target_pct = max(1, min(99, target_pct))
    mu = _period_multiplier(target_pct, round(extrusion_width_mm, 4))
    period = mu * gyroid_cell_period_mm(extrusion_width_mm, infill_fraction)
    boundary = pick_infill_boundary(wall_contours)
    raw = _raw_gyroid_segments(boundary, z, period, extrusion_width_mm)
    return clip_segments_to_contours(raw, wall_contours)


def measure_layer_planar_fill_percent(
    infill_segments: list[np.ndarray],
    wall_contours: list[np.ndarray],
    extrusion_width_mm: float,
) -> float:
    return estimate_fill_fraction(infill_segments, wall_contours, extrusion_width_mm) * 100.0
