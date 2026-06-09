# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Printer / process presets for the hybrid manufacturing pipeline.

These are the server-side equivalent of the client-side presets in
vertex/src/lib/kiri/presets.ts, focused on the belt-printer use cases
(Apex V2 at 45°, LayerLoop-style at 30°).
"""

from __future__ import annotations

from typing import Any

BELT_PRESETS: dict[str, dict[str, Any]] = {
    "apex-belt-v2-45": {
        "name": "Apex V2 (45° belt)",
        "layerHeightMm": 0.30,
        "nozzleMm": 0.40,
        "beltAngleDeg": 45,
        "material": "TPU",
        "infillDensity": 0.15,
        # TPU on belt (continuous print) — typical values; tune per machine/filament
        "nozzleTempC": 235,
        "bedTempC": 0,  # many belt setups run bed off or very low
        "printSpeedMmS": 35,
        "travelSpeedMmS": 80,
        "retractEnable": False,  # TPU often prints better with minimal/no retraction
        "retractDistanceMm": 0.5,
        "retractSpeedMmS": 20,
        "coolingFanSpeed": 0.2,  # low to avoid layer adhesion issues on TPU
        "perimeters": 3,
        "solidLayers": 3,  # top + bottom solid for better surface/strength on insoles
        "infillAngleDeg": 45,
    },
    "layerloop-30": {
        "name": "LayerLoop (30° belt)",
        "layerHeightMm": 0.28,
        "nozzleMm": 0.40,
        "beltAngleDeg": 30,
        "material": "TPU",
        "infillDensity": 0.18,
        "nozzleTempC": 230,
        "bedTempC": 0,
        "printSpeedMmS": 30,
        "travelSpeedMmS": 70,
        "retractEnable": False,
        "retractDistanceMm": 0.4,
        "retractSpeedMmS": 15,
        "coolingFanSpeed": 0.15,
        "perimeters": 3,
        "solidLayers": 4,
        "infillAngleDeg": 30,
    },
}

DEFAULT_PRESET = BELT_PRESETS["apex-belt-v2-45"]


def get_preset(preset_id: str) -> dict[str, Any]:
    return BELT_PRESETS.get(preset_id, DEFAULT_PRESET).copy()
