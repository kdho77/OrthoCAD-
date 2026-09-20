# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

import unittest

from app.services.gcode_metrology import gcode_has_infill_gyroid_blocks
from app.services.gyroid_infill import gyroid_cell_period_mm
from app.services.print_recipe import (
    HARDNESS_TO_INFILL_PCT,
    PrintRecipeV1,
    coerce_print_recipe,
    require_gyroid_print_recipe_with_profile,
)
from app.services.slicer import emit_gcode, slice_solid
import trimesh


class PrintRecipeGyroidTests(unittest.TestCase):
    def test_hardness_table_matches_ts_json(self) -> None:
        self.assertEqual(HARDNESS_TO_INFILL_PCT["Medium"], 26)
        self.assertEqual(HARDNESS_TO_INFILL_PCT["Extra Hard"], 38)

    def test_recipe_resolves_fraction(self) -> None:
        recipe = PrintRecipeV1(default_hardness="Soft")
        self.assertAlmostEqual(recipe.infill_fraction(), 0.20)

    def test_cell_period_scales_with_density(self) -> None:
        soft = gyroid_cell_period_mm(0.48, 0.14)
        hard = gyroid_cell_period_mm(0.48, 0.38)
        self.assertGreater(soft, hard)

    def test_gcode_emits_infill_blocks_not_header_tag_only(self) -> None:
        box = trimesh.creation.box(extents=(40, 40, 6))
        layers = slice_solid(
            box,
            layer_height_mm=0.3,
            perimeters=1,
            infill_density=0.26,
            extrusion_width_mm=0.48,
            solid_layers=1,
            infill_pattern="gyroid",
            belt_gantry_angle_deg=45.0,
        )
        gcode = emit_gcode(layers, {"name": "test", "nozzleMm": 0.4, "layerHeightMm": 0.3})
        self.assertTrue(gcode_has_infill_gyroid_blocks(gcode))
        self.assertNotIn(";infill_pattern=gyroid", gcode.lower())

    def test_coerce_default_medium(self) -> None:
        self.assertEqual(coerce_print_recipe(None).default_hardness, "Medium")
        self.assertEqual(coerce_print_recipe(None).profile_id, "apex-belt-v2")

    def test_legacy_recipe_without_profile_id_migrates(self) -> None:
        legacy = {
            "version": 1,
            "pattern": "gyroid",
            "default_hardness": "Soft",
            "zones": [],
        }
        recipe = coerce_print_recipe(legacy)
        self.assertEqual(recipe.profile_id, "apex-belt-v2")
        self.assertEqual(recipe.default_hardness, "Soft")

    def test_require_gyroid_profile_rejects_missing_print_recipe(self) -> None:
        with self.assertRaises(ValueError):
            require_gyroid_print_recipe_with_profile("apex-belt-v2", None)


if __name__ == "__main__":
    unittest.main()
