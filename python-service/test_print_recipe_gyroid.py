# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

import unittest

from app.services.gcode_metrology import estimate_extrusion_move_fraction, gcode_declares_gyroid_pattern
from app.services.gyroid_infill import gyroid_cell_period_mm
from app.services.print_recipe import HARDNESS_TO_INFILL_PCT, PrintRecipeV1, coerce_print_recipe
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

    def test_gcode_emits_gyroid_tag(self) -> None:
        box = trimesh.creation.box(extents=(40, 40, 6))
        layers = slice_solid(
            box,
            layer_height_mm=1.0,
            perimeters=1,
            infill_density=0.26,
            extrusion_width_mm=0.48,
            solid_layers=1,
            infill_pattern="gyroid",
        )
        gcode = emit_gcode(layers, {"name": "test", "nozzleMm": 0.4, "layerHeightMm": 1.0})
        self.assertTrue(gcode_declares_gyroid_pattern(gcode))
        self.assertGreater(estimate_extrusion_move_fraction(gcode), 0.0)

    def test_coerce_default_medium(self) -> None:
        self.assertEqual(coerce_print_recipe(None).default_hardness, "Medium")


if __name__ == "__main__":
    unittest.main()
