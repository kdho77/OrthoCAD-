#!/usr/bin/env python3
# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Offline gyroid period LUT calibration (writes gyroid_period_lut.json).

Run from repo root:
  python3 python-service/scripts/calibrate_gyroid_lut.py

Keys: "{target_percent}:{extrusion_width_mm:.4f}" (perimeters are applied at slice time via wall inset).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.gyroid_infill import (  # noqa: E402
    GYROID_CELL_K,
    _fit_period_multiplier,
)
from app.services.print_recipe import HARDNESS_TO_INFILL_PCT  # noqa: E402

LUT_PATH = ROOT / "app" / "services" / "gyroid_period_lut.json"
EXTRUSION_W = 0.48
# Production belt preset default (walls already define infill boundary at slice time).
CALIB_PERIMETERS = 3


def main() -> None:
    lut: dict[str, float] = {}
    for _name, pct in HARDNESS_TO_INFILL_PCT.items():
        mu = _fit_period_multiplier(pct, EXTRUSION_W, CALIB_PERIMETERS, z=3.0)
        key = f"{pct}:{EXTRUSION_W:.4f}"
        lut[key] = mu
        print(f"{_name:12} {pct}%  mu={mu:.6f}")

    meta = {
        "_meta": {
            "extrusion_width_mm": EXTRUSION_W,
            "calibration_perimeters": CALIB_PERIMETERS,
            "cell_law": "L = mu * GYROID_CELL_K * w / sqrt(phi)",
            "gyroid_cell_k": GYROID_CELL_K,
        },
        **lut,
    }
    with LUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2, sort_keys=True)
    print(f"Wrote {LUT_PATH}")


if __name__ == "__main__":
    main()
