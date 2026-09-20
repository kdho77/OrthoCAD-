# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
G-code fill-fraction metrology hooks for phaseA-gyroid-hardness-v1 fixtures.

Phase A: lightweight parser stub — counts extrusion moves tagged as gyroid infill
in comments and estimates relative extrusion duty cycle vs. layer count.
Full coupon metrology (40×40×6 mm, infill band only) is exercised in fixture
manifests outside this repo; this module provides the in-repo hook.
"""

from __future__ import annotations

import re

_GYROID_TAG = re.compile(r";.*infill_pattern=gyroid", re.IGNORECASE)
_EXTRUDE = re.compile(r"^G1\s+.*\s+E[\d.+-]+", re.IGNORECASE)


def gcode_declares_gyroid_pattern(gcode: str) -> bool:
    return any(_GYROID_TAG.search(line) for line in gcode.splitlines())


def estimate_extrusion_move_fraction(gcode: str) -> float:
    """Ratio of G1 extrusion lines to all G1/G0 lines (coarse fill proxy)."""
    moves = [ln for ln in gcode.splitlines() if ln.startswith("G0") or ln.startswith("G1")]
    if not moves:
        return 0.0
    extrude = sum(1 for ln in moves if _EXTRUDE.match(ln))
    return extrude / len(moves)
