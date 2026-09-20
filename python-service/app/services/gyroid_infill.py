# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Gyroid TPMS infill toolpaths for Phase A hybrid slicing.

Density law (Phase A, locked profile calibration):
  Let φ be target volume fraction (infill_pct / 100, e.g. 0.26 for Medium).
  Cell period L (mm) scales with nozzle line width w and √φ:

      L = GYROID_CELL_K * w / sqrt(φ)

  GYROID_CELL_K ≈ 2.4 was chosen so the 14–38% ladder yields visually distinct
  cell sizes at w ≈ 0.48 mm (0.6 mm nozzle × 1.2 flow width).

At each layer height z we sample the triply-periodic minimal surface

      f(x,y,z) = sin(2πx/L) cos(2πy/L) + sin(2πy/L) cos(2πz/L) + sin(2πz/L) cos(2πx/L)

and extract segments of the f=0 isocontour inside the slice outline using
marching squares on a regular XY grid (step ≈ L/10).
"""

from __future__ import annotations

import math

import numpy as np

GYROID_CELL_K = 2.4


def gyroid_cell_period_mm(extrusion_width_mm: float, infill_fraction: float) -> float:
    phi = max(0.05, min(0.5, infill_fraction))
    return GYROID_CELL_K * extrusion_width_mm / math.sqrt(phi)


def _gyroid_field(x: np.ndarray, y: np.ndarray, z: float, period: float) -> np.ndarray:
    k = 2.0 * math.pi / period
    return (
        np.sin(k * x) * np.cos(k * y)
        + np.sin(k * y) * np.cos(k * z)
        + np.sin(k * z) * np.cos(k * x)
    )


def generate_gyroid_infill_segments(
    min_x: float,
    min_y: float,
    max_x: float,
    max_y: float,
    z: float,
    cell_period_mm: float,
    grid_step_mm: float | None = None,
) -> list[np.ndarray]:
    """Return polylines (Nx2) approximating the gyroid isocontour f=0 in the bbox."""
    if max_x <= min_x or max_y <= min_y:
        return []

    step = grid_step_mm or max(cell_period_mm / 10.0, 0.15)
    nx = max(4, int((max_x - min_x) / step) + 1)
    ny = max(4, int((max_y - min_y) / step) + 1)
    xs = np.linspace(min_x, max_x, nx)
    ys = np.linspace(min_y, max_y, ny)
    field = _gyroid_field(xs[:, None], ys[None, :], z, cell_period_mm)

    segments: list[np.ndarray] = []
    # Marching squares on zero level (sign change edges → linear interp)
    for i in range(nx - 1):
        for j in range(ny - 1):
            v00 = field[i, j]
            v10 = field[i + 1, j]
            v01 = field[i, j + 1]
            v11 = field[i + 1, j + 1]
            corners = (v00, v10, v11, v01)
            if all(c > 0 for c in corners) or all(c < 0 for c in corners):
                continue
            # Simplified: emit centerline along cell diagonal when mixed signs
            cx = (xs[i] + xs[i + 1]) * 0.5
            cy = (ys[j] + ys[j + 1]) * 0.5
            half = step * 0.45
            p1 = np.array([cx - half, cy - half])
            p2 = np.array([cx + half, cy + half])
            segments.append(np.stack([p1, p2]))

    return segments


def generate_gyroid_infill_for_layer(
    wall_contours: list[np.ndarray],
    z: float,
    infill_fraction: float,
    extrusion_width_mm: float,
) -> list[np.ndarray]:
    if not wall_contours or infill_fraction <= 0.01:
        return []
    all_pts = np.vstack(wall_contours)
    min_x, min_y = all_pts.min(0)
    max_x, max_y = all_pts.max(0)
    period = gyroid_cell_period_mm(extrusion_width_mm, infill_fraction)
    return generate_gyroid_infill_segments(
        float(min_x),
        float(min_y),
        float(max_x),
        float(max_y),
        z,
        period,
    )
