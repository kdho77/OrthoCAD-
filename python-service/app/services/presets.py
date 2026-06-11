# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Printer / process presets for the hybrid manufacturing pipeline.

These are the server-side equivalent of the client-side presets in
vertex/src/lib/kiri/presets.ts, focused on the belt-printer use cases
(Apex V2 at 45°, LayerLoop-style at 30°).
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

BELT_PRESETS: dict[str, dict[str, Any]] = {
    "apex-belt-v2-45": {
        "name": "Apex V2 (45° belt)",
        "layerHeightMm": 0.30,
        "nozzleMm": 0.40,
        "beltAngleDeg": 45,
        "material": "TPU",
        "infillDensity": 0.15,
        "nozzleTempC": 235,
        "bedTempC": 0,
        "printSpeedMmS": 35,
        "travelSpeedMmS": 80,
        "retractEnable": False,
        "retractDistanceMm": 0.5,
        "retractSpeedMmS": 20,
        "coolingFanSpeed": 0.2,
        "perimeters": 3,
        "solidLayers": 3,
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

# Map client preset IDs (vertex/src/lib/kiri/presets.ts) to server keys.
PRESET_ID_ALIASES: dict[str, str] = {
    "apex-belt-v2": "apex-belt-v2-45",
    "apex-belt-v2-shell": "apex-belt-v2-45",
    "desktop-fdm": "apex-belt-v2-45",
}

DEFAULT_PRESET = BELT_PRESETS["apex-belt-v2-45"]


def is_known_preset(preset_id: str) -> bool:
    """Return True when preset_id resolves to a known Vertex belt/FDM profile."""
    return normalize_preset_id(preset_id) in BELT_PRESETS


def normalize_preset_id(preset_id: str) -> str:
    """Resolve client preset IDs to server keys; log when falling back."""
    if preset_id in BELT_PRESETS:
        return preset_id
    if preset_id in PRESET_ID_ALIASES:
        return PRESET_ID_ALIASES[preset_id]
    logger.warning(
        "Unknown preset_id %r — no explicit alias; using default %s",
        preset_id,
        DEFAULT_PRESET["name"],
    )
    return "apex-belt-v2-45"


def get_preset(preset_id: str) -> dict[str, Any]:
    key = normalize_preset_id(preset_id)
    return BELT_PRESETS.get(key, DEFAULT_PRESET).copy()
