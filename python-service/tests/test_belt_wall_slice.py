# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""Integration tests for belt wall contours on transformed solids."""

from __future__ import annotations

import math
import unittest

import numpy as np
import trimesh

from app.services.belt_transformer import apply_belt_transform
from app.services.belt_wall_slice import slice_belt_layer_contours


def _polyline_length(pts: np.ndarray) -> float:
    if len(pts) < 2:
        return 0.0
    d = np.diff(pts[:, :2], axis=0)
    return float(np.linalg.norm(d, axis=1).sum())


def _min_separation_mm(a: np.ndarray, b: np.ndarray, samples: int = 24) -> float:
    """Minimum distance between two polylines (sampled)."""
    ta = np.linspace(0, len(a) - 1, num=min(samples, len(a)))
    tb = np.linspace(0, len(b) - 1, num=min(samples, len(b)))
    pa = np.array([a[int(round(t))][:2] for t in ta])
    pb = np.array([b[int(round(t))][:2] for t in tb])
    best = float("inf")
    for p in pa:
        for q in pb:
            best = min(best, float(np.linalg.norm(p - q)))
    return best


def _x_span(pts: np.ndarray) -> float:
    return float(pts[:, 0].max() - pts[:, 0].min())


class BeltWallSliceTests(unittest.TestCase):
    def test_thin_shell_emits_single_outer_wall_chain(self) -> None:
        """Fused racetrack: one dominant wall chain, not twin rims separated by shell thickness."""
        shell_thickness_mm = 0.9
        box = trimesh.creation.box(extents=[90.0, shell_thickness_mm, 8.0])
        transformed = apply_belt_transform(box, 45.0)
        z = float(transformed.vertices[:, 2].mean())
        walls, _ = slice_belt_layer_contours(
            transformed,
            z,
            belt_gantry_angle_deg=45.0,
            perimeters=1,
            extrusion_width_mm=0.48,
            infill_density=0.2,
            layer_index=0,
            include_infill=False,
        )
        self.assertGreaterEqual(len(walls), 1)

        lengths = [_polyline_length(w) for w in walls]
        total_len = sum(lengths)
        self.assertGreater(total_len, 1e-6)
        dominant = max(lengths)
        self.assertGreaterEqual(dominant / total_len, 0.72, "expected one dominant fused racetrack chain")

        long_walls = [w for w in walls if _polyline_length(w) >= 0.35 * dominant and len(w) >= 4]
        for i in range(len(long_walls)):
            for j in range(i + 1, len(long_walls)):
                sep = _min_separation_mm(long_walls[i], long_walls[j])
                y_med_a = float(np.median(long_walls[i][:, 1]))
                y_med_b = float(np.median(long_walls[j][:, 1]))
                span = min(_x_span(long_walls[i]), _x_span(long_walls[j]))
                looks_like_twin_rims = (
                    span > 20.0
                    and 0.25 * shell_thickness_mm <= sep <= 2.5 * shell_thickness_mm
                    and abs(y_med_a - y_med_b) >= 0.2 * shell_thickness_mm
                )
                self.assertFalse(
                    looks_like_twin_rims,
                    f"twin rim walls detected (separation={sep:.3f} mm, dy={abs(y_med_a - y_med_b):.3f})",
                )

    def test_belt_plane_edges_pinned_on_box(self) -> None:
        """Outer wall on belt contact should keep y at belt_y within tolerance."""
        box = trimesh.creation.box(extents=[40.0, 20.0, 12.0])
        transformed = apply_belt_transform(box, 30.0)
        z = 0.0
        belt_y = z / math.tan(math.radians(30.0))
        walls, _ = slice_belt_layer_contours(
            transformed,
            z,
            belt_gantry_angle_deg=30.0,
            perimeters=1,
            extrusion_width_mm=0.48,
            infill_density=0.0,
            layer_index=0,
            include_infill=False,
        )
        self.assertGreaterEqual(len(walls), 1)
        outer = walls[0]
        belt_pts = outer[abs(outer[:, 1] - belt_y) < 1e-3]
        self.assertGreater(len(belt_pts), 0)


if __name__ == "__main__":
    unittest.main()
