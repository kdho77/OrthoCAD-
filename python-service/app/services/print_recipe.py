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

GYROID_MANUFACTURING_PRESET_IDS = frozenset(
    {
        "apex-belt-v2",
        "apex-belt-v2-shell",
        "desktop-fdm",
        "apex-belt-v2-45",
        "layerloop-30",
    }
)


class PrintRecipeV1(BaseModel):
    version: Literal[1] = 1
    pattern: Literal["gyroid"] = "gyroid"
    default_hardness: HardnessName = "Medium"
    zones: list[Any] = Field(default_factory=list)
    hardness_to_infill_pct: dict[str, int] | None = None

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
    return PrintRecipeV1.model_validate(raw)
