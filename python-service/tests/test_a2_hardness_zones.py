# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Phase B — A2 hardness zone fixtures on 40×40×6 coupon (belt + sole-UV spatial gyroid).

Gates: zone validation (area/corridor), per-zone core (erode 2w) fill ±5 pp.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

import numpy as np
import trimesh
from shapely.geometry import Point

from app.services.belt_transformer import apply_belt_transform
from app.services.gyroid_infill import estimate_fill_fraction
from app.services.material_zones import (
    MaterialZoneV1,
    ZoneValidationError,
    resolve_infill_fraction_at_uv,
    validate_material_zones,
    zone_core_polygon_mm,
)
from app.services.print_recipe import PrintRecipeV1, coerce_print_recipe
from app.services.sole_uv_map import SoleUvFrame, belt_slice_xy_to_sole_uv
from app.services.slicer import slice_solid

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures"
COUPON = FIXTURE_DIR / "a1_coupon_40x40x6.stl"
EXTRUSION_W = 0.48
LAYER_H = 0.3
PERIMETERS = 3
SOLID_LAYERS = 1
TOL = 0.05


def _load_coupon() -> trimesh.Trimesh:
    return trimesh.load_mesh(str(COUPON))


def _load_fixture(name: str) -> dict:
    path = FIXTURE_DIR / name
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _frame_from_fixture(data: dict) -> SoleUvFrame:
    sf = data["sole_uv_frame"]
    return SoleUvFrame(
        min_x_mm=sf["min_x_mm"],
        min_y_mm=sf["min_y_mm"],
        length_mm=sf["length_mm"],
        width_mm=sf["width_mm"],
    )


def _mean_core_phi(
    layers: list,
    zone: MaterialZoneV1,
    frame: SoleUvFrame,
    belt_angle: float,
    extrusion_width: float,
) -> float:
    core = zone_core_polygon_mm(zone, frame, extrusion_width)
    phis: list[float] = []
    for layer in layers:
        if layer.get("is_solid"):
            continue
        if layer.get("infill_pattern") != "gyroid":
            continue
        segs = layer.get("infill", [])
        if not segs:
            continue
        z = float(layer["z"])
        filtered: list[np.ndarray] = []
        for seg in segs:
            mid = (seg[0] + seg[1]) * 0.5
            u, v = belt_slice_xy_to_sole_uv(float(mid[0]), float(mid[1]), z, belt_angle, frame)
            xf, yf = frame.uv_to_foot_xy(u, v)
            if core.contains(Point(xf, yf)):
                filtered.append(seg)
        if not filtered:
            continue
        core_area = float(core.area)
        if core_area <= 0:
            continue
        total_len = sum(float(np.linalg.norm(s[1] - s[0])) for s in filtered)
        phis.append((total_len * extrusion_width) / core_area)
    if not phis:
        return 0.0
    return float(np.mean(phis))


class A2HardnessZoneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.solid = _load_coupon()

    def _slice_fixture(self, fixture_name: str) -> tuple[list, PrintRecipeV1, SoleUvFrame, float]:
        data = _load_fixture(fixture_name)
        recipe = coerce_print_recipe(data["print_recipe"])
        frame = _frame_from_fixture(data)
        belt = float(data.get("belt_angle_deg", 45))
        transformed = apply_belt_transform(self.solid, belt)
        layers = slice_solid(
            transformed,
            layer_height_mm=LAYER_H,
            perimeters=PERIMETERS,
            infill_density=recipe.infill_fraction(),
            extrusion_width_mm=EXTRUSION_W,
            solid_layers=SOLID_LAYERS,
            infill_pattern="gyroid",
            print_recipe=recipe,
            belt_gantry_angle_deg=belt,
            sole_uv_frame=frame,
        )
        return layers, recipe, frame, belt

    def test_a2_f1_midline_zones(self) -> None:
        layers, recipe, frame, belt = self._slice_fixture("a2_f1_midline.json")
        zones = [MaterialZoneV1.model_validate(z) for z in recipe.zones]
        validate_material_zones(zones, frame, EXTRUSION_W)
        for exp in _load_fixture("a2_f1_midline.json")["expected_zones"]:
            zone = next(z for z in zones if z.zone_id == exp["zone_id"])
            target = exp["target_pct"] / 100.0
            measured = _mean_core_phi(layers, zone, frame, belt, EXTRUSION_W)
            self.assertLessEqual(
                abs(measured - target),
                TOL,
                f"{exp['zone_id']}: measured φ={measured:.3f} target={target:.3f}",
            )

    def test_a2_f2_soft_wins_in_heel(self) -> None:
        data = _load_fixture("a2_f2_heel_softwins.json")
        recipe = coerce_print_recipe(data["print_recipe"])
        u, v = 0.15, 0.0
        phi = resolve_infill_fraction_at_uv(recipe, u, v)
        self.assertAlmostEqual(phi, 0.14, places=2)
        layers, recipe, frame, belt = self._slice_fixture("a2_f2_heel_softwins.json")
        zone = MaterialZoneV1.model_validate(recipe.zones[0])
        measured = _mean_core_phi(layers, zone, frame, belt, EXTRUSION_W)
        self.assertLessEqual(abs(measured - 0.14), TOL)

    def test_a2_f2b_override_soft_wins(self) -> None:
        data = _load_fixture("a2_f2b_override_softwins.json")
        recipe = coerce_print_recipe(data["print_recipe"])
        phi = resolve_infill_fraction_at_uv(recipe, 0.15, 0.0)
        self.assertAlmostEqual(phi, 0.26, places=2)
        layers, recipe, frame, belt = self._slice_fixture("a2_f2b_override_softwins.json")
        zone = MaterialZoneV1.model_validate(recipe.zones[0])
        measured = _mean_core_phi(layers, zone, frame, belt, EXTRUSION_W)
        self.assertLessEqual(abs(measured - 0.26), TOL)

    def test_a2_f3_med_lat_gap(self) -> None:
        layers, recipe, frame, belt = self._slice_fixture("a2_f3_med_lat_gap.json")
        zones = [MaterialZoneV1.model_validate(z) for z in recipe.zones]
        for exp in _load_fixture("a2_f3_med_lat_gap.json")["expected_zones"]:
            if exp["zone_id"] == "gap-medium":
                phi = resolve_infill_fraction_at_uv(recipe, exp["sample_uv"]["u"], exp["sample_uv"]["v"])
                self.assertAlmostEqual(phi, 0.26, places=2)
                continue
            zone = next(z for z in zones if z.zone_id == exp["zone_id"])
            target = exp["target_pct"] / 100.0
            measured = _mean_core_phi(layers, zone, frame, belt, EXTRUSION_W)
            self.assertLessEqual(abs(measured - target), TOL, msg=exp["zone_id"])

    def test_corridor_reject_sliver(self) -> None:
        frame = SoleUvFrame(-20, -20, 40, 40)
        tiny = MaterialZoneV1(
            zone_id="sliver",
            anatomic_label="Sliver",
            hardness_name="Soft",
            boundary_sole_uv=[
                {"u": 0.5, "v": -0.01},
                {"u": 0.52, "v": -0.01},
                {"u": 0.52, "v": 0.01},
                {"u": 0.5, "v": 0.01},
            ],
        )
        with self.assertRaises(ZoneValidationError):
            validate_material_zones([tiny], frame, EXTRUSION_W)


if __name__ == "__main__":
    unittest.main()
