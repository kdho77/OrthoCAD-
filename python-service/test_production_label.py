# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

import unittest

from app.services.print_recipe import PrintRecipeV1
from app.services.production_label import build_production_release_label
from app.services.slicer import emit_gcode


class ProductionLabelTests(unittest.TestCase):
    def test_default_recipe_includes_label_flag(self) -> None:
        recipe = PrintRecipeV1()
        self.assertTrue(recipe.include_production_label)
        self.assertEqual(recipe.profile_id, "apex-belt-v2")

    def test_build_label_contains_side_and_profile(self) -> None:
        text = build_production_release_label(
            side="right",
            recipe=PrintRecipeV1(default_hardness="Soft"),
            profile_display_name="Apex Belt V2 (TPU)",
        )
        self.assertIn("Right", text)
        self.assertIn("Soft", text)
        self.assertIn("Apex Belt V2", text)

    def test_gcode_embeds_release_label_block(self) -> None:
        gcode = emit_gcode(
            [],
            {"name": "test", "nozzleMm": 0.4, "layerHeightMm": 0.3},
            {"productionReleaseLabel": "OrthoCAD belt release · Left · Medium"},
        )
        self.assertIn("PRODUCTION_RELEASE_LABEL", gcode)
        self.assertIn("OrthoCAD belt release", gcode)


if __name__ == "__main__":
    unittest.main()
