# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
PrintRecipeV1 resolution for hybrid manufacturing (Phase A).

Shares the locked hardness→% ladder with the TypeScript client via
vertex/shared/print-recipe/hardness-to-infill-pct.json.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

HardnessName = Literal["Extra Soft", "Soft", "Medium", "Hard", "Extra Hard"]

_TABLE_PATH = (
    Path(__file__).resolve().parents[3]
    / "vertex"
    / "shared"
    / "print-recipe"
    / "hardness-to-infill-pct.json"
)


def load_hardness_table() -> dict[str, int]:
    with _TABLE_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    return {str(k): int(v) for k, v in data.items()}


HARDNESS_TO_INFILL_PCT: dict[str, int] = load_hardness_table()

DEFAULT_PRODUCTION_PROFILE_ID = "apex-belt-v2"

GYROID_MANUFACTURING_PRESET_IDS = frozenset(
    {
        "apex-belt-v2",
        "apex-belt-v2-shell",
        "desktop-fdm",
        "apex-belt-v2-45",
        "layerloop-30",
    }
)


class SoleUvFramePayload(BaseModel):
    min_x_mm: float
    min_y_mm: float
    length_mm: float
    width_mm: float


class PrintRecipeV1(BaseModel):
    version: Literal[1] = 1
    pattern: Literal["gyroid"] = "gyroid"
    profile_id: str = Field(default=DEFAULT_PRODUCTION_PROFILE_ID, min_length=1)
    default_hardness: HardnessName = "Medium"
    zones: list[Any] = Field(default_factory=list)
    hardness_to_infill_pct: dict[str, int] | None = None
    override_soft_wins: bool = False
    sole_uv_frame: SoleUvFramePayload | None = None

    def resolved_infill_percent(self) -> int:
        table = self.hardness_to_infill_pct or HARDNESS_TO_INFILL_PCT
        pct = table.get(self.default_hardness)
        if pct is None:
            pct = HARDNESS_TO_INFILL_PCT[self.default_hardness]
        return int(pct)

    def infill_fraction(self) -> float:
        return self.resolved_infill_percent() / 100.0


DEFAULT_PRINT_RECIPE = PrintRecipeV1()


def is_gyroid_manufacturing_preset(preset_id: str) -> bool:
    return preset_id in GYROID_MANUFACTURING_PRESET_IDS


def coerce_print_recipe(raw: PrintRecipeV1 | dict[str, Any] | None) -> PrintRecipeV1:
    if raw is None:
        return DEFAULT_PRINT_RECIPE.model_copy()
    if isinstance(raw, PrintRecipeV1):
        return raw
    data = dict(raw)
    if not str(data.get("profile_id") or "").strip():
        data["profile_id"] = DEFAULT_PRODUCTION_PROFILE_ID
    return PrintRecipeV1.model_validate(data)


def require_gyroid_print_recipe_with_profile(
    preset_id: str, print_recipe: PrintRecipeV1 | None
) -> PrintRecipeV1:
    if not is_gyroid_manufacturing_preset(preset_id):
        raise ValueError("require_gyroid_print_recipe_with_profile called for non-gyroid preset")
    if print_recipe is None:
        raise ValueError(
            "Production gyroid manufacturing requires print_recipe with profile_id (locked printer preset)."
        )
    recipe = coerce_print_recipe(print_recipe)
    if not recipe.profile_id.strip():
        raise ValueError("print_recipe.profile_id is required for gyroid manufacturing.")
    if recipe.profile_id != preset_id:
        raise ValueError("preset_id must match print_recipe.profile_id for production gyroid manufacturing.")
    return recipe
