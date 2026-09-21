# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""Belt production release label helpers (Track 3a)."""

from __future__ import annotations

from app.services.print_recipe import HARDNESS_TO_INFILL_PCT, PrintRecipeV1


def build_production_release_label(
    *,
    side: str | None,
    recipe: PrintRecipeV1,
    profile_display_name: str,
    client_label: str | None = None,
    design_id: str | None = None,
) -> str:
    side_text = "Left" if side == "left" else "Right" if side == "right" else "Side"
    table = recipe.hardness_to_infill_pct or HARDNESS_TO_INFILL_PCT
    pct = table.get(recipe.default_hardness, HARDNESS_TO_INFILL_PCT[recipe.default_hardness])
    parts = [
        "OrthoCAD belt release",
        side_text,
        recipe.default_hardness,
        f"{pct}% gyroid (experimental)",
        profile_display_name,
    ]
    if client_label and client_label.strip():
        parts.append(client_label.strip())
    if design_id:
        parts.append(f"design {design_id[:8]}")
    return " · ".join(parts)
