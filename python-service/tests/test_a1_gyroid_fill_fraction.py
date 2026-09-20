# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
phaseA-gyroid-hardness-v1 — A1 coupon fill-fraction gate (in-repo).

40×40×6 mm box, locked profile: w=0.48 mm, layer_h=0.3 mm, perimeters=3 (belt preset), solid_layers=1.
Each hardness target φ ∈ {0.14,0.20,0.26,0.32,0.38}: |measured φ − target| ≤ 0.05.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import numpy as np
import trimesh

from app.services.gyroid_infill import _LUT_PATH, _period_multiplier, generate_gyroid_infill_for_layer

from app.services.gcode_metrology import gcode_has_infill_gyroid_blocks, measure_infill_fill_fraction_from_gcode
from app.services.geometry_utils import point_in_polygon
from app.services.gyroid_infill import (
    estimate_fill_fraction,
    pick_infill_boundary,
)
from app.services.print_recipe import HARDNESS_TO_INFILL_PCT
from app.services.slicer import emit_gcode, slice_solid

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "a1_coupon_40x40x6.stl"
EXTRUSION_W = 0.48
LAYER_H = 0.3
PERIMETERS = 3
SOLID_LAYERS = 1
TOL = 0.05
BELT_GANTRY_DEG = 45.0


def _load_coupon() -> trimesh.Trimesh:
    assert FIXTURE.is_file(), f"Missing fixture {FIXTURE}"
    return trimesh.load_mesh(str(FIXTURE))


def _mean_infill_phi(layers: list, extrusion_width: float) -> float:
    phis: list[float] = []
    for layer in layers:
        if layer.get("is_solid"):
            continue
        if layer.get("infill_pattern") != "gyroid":
            continue
        segs = layer.get("infill", [])
        if not segs:
            continue
        walls = layer.get("contours", [])
        phis.append(estimate_fill_fraction(segs, walls, extrusion_width))
    if not phis:
        return 0.0
    return float(np.mean(phis))


class A1GyroidFillFractionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.solid = _load_coupon()

    def _slice_gyroid(self, infill_fraction: float):
        return slice_solid(
            self.solid,
            layer_height_mm=LAYER_H,
            perimeters=PERIMETERS,
            infill_density=infill_fraction,
            extrusion_width_mm=EXTRUSION_W,
            solid_layers=SOLID_LAYERS,
            infill_pattern="gyroid",
            belt_gantry_angle_deg=BELT_GANTRY_DEG,
        )

    def test_all_five_hardnesses_within_tolerance(self) -> None:
        failures: list[str] = []
        for name, pct in HARDNESS_TO_INFILL_PCT.items():
            target = pct / 100.0
            layers = self._slice_gyroid(target)
            measured = _mean_infill_phi(layers, EXTRUSION_W)
            if abs(measured - target) > TOL:
                failures.append(f"{name}: target={target:.2f} measured={measured:.3f}")
        if failures:
            self.fail("A1 fill fraction out of tolerance:\n" + "\n".join(failures))

    def test_gcode_infill_blocks_present(self) -> None:
        layers = self._slice_gyroid(0.26)
        gcode = emit_gcode(layers, {"name": "a1", "nozzleMm": 0.4, "layerHeightMm": LAYER_H})
        self.assertTrue(gcode_has_infill_gyroid_blocks(gcode))

    def test_segments_clipped_inside_boundary(self) -> None:
        layers = self._slice_gyroid(0.26)
        for layer in layers:
            if layer.get("is_solid") or layer.get("infill_pattern") != "gyroid":
                continue
            walls = layer.get("contours", [])
            boundary = pick_infill_boundary(walls)
            poly = [(float(p[0]), float(p[1])) for p in boundary]
            for seg in layer.get("infill", []):
                mid = (seg[0] + seg[1]) * 0.5
                self.assertTrue(
                    point_in_polygon(float(mid[0]), float(mid[1]), poly),
                    "Infill segment midpoint outside wall contour",
                )

    def test_lut_not_mutated_on_manufacture_path(self) -> None:
        _period_multiplier.cache_clear()
        mtime_before = _LUT_PATH.stat().st_mtime
        layers = self._slice_gyroid(0.26)
        layer = next(
            l
            for l in layers
            if not l.get("is_solid") and l.get("infill_pattern") == "gyroid" and l.get("infill")
        )
        generate_gyroid_infill_for_layer(
            layer["contours"],
            float(layer["z"]),
            0.26,
            EXTRUSION_W,
            perimeters=PERIMETERS,
        )
        _period_multiplier.cache_clear()
        # Unknown width forces in-memory fit path (no LUT key for w=0.37)
        generate_gyroid_infill_for_layer(layer["contours"], float(layer["z"]), 0.26, 0.37, perimeters=3)
        self.assertEqual(_LUT_PATH.stat().st_mtime, mtime_before)

    def test_gcode_metrology_matches_layer_estimate(self) -> None:
        target = 0.26
        layers = self._slice_gyroid(target)
        gcode = emit_gcode(layers, {"name": "a1", "nozzleMm": 0.4, "layerHeightMm": LAYER_H})
        infill_layer = next(
            l
            for l in layers
            if not l.get("is_solid") and l.get("infill_pattern") == "gyroid" and l.get("infill")
        )
        boundary = pick_infill_boundary(infill_layer["contours"])
        area = abs(
            0.5
            * float(
                np.dot(boundary[:, 0], np.roll(boundary[:, 1], -1))
                - np.dot(boundary[:, 1], np.roll(boundary[:, 0], -1))
            )
        )
        from_gcode = measure_infill_fill_fraction_from_gcode(gcode, EXTRUSION_W, area)
        from_layers = _mean_infill_phi(layers, EXTRUSION_W)
        self.assertAlmostEqual(from_gcode, from_layers, delta=0.08)


if __name__ == "__main__":
    unittest.main()
