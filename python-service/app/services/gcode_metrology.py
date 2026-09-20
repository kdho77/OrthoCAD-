# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
A1 G-code fill-fraction metrology (infill band only).

Parses BEGIN_INFILL_GYROID … END_INFILL_GYROID blocks emitted by the slicer.
Fill φ = (Σ extruded path length × extrusion_width) / A_inner, averaged over infill layers.
"""

from __future__ import annotations

import re

_BEGIN = re.compile(r"; BEGIN_INFILL_GYROID\b")
_END = re.compile(r"; END_INFILL_GYROID\b")
_MOVE_XY = re.compile(
    r"^G[01]\s+X([\d.+-]+)\s+Y([\d.+-]+)",
    re.IGNORECASE,
)


def _parse_xy(line: str) -> tuple[float, float] | None:
    m = _MOVE_XY.match(line.strip())
    if not m:
        return None
    return float(m.group(1)), float(m.group(2))


def measure_infill_fill_fraction_from_gcode(
    gcode: str,
    extrusion_width_mm: float,
    inner_area_mm2: float,
) -> float:
    """
    Mean planar fill fraction across infill gyroid blocks.
    Returns φ in 0..1 (not percent).
    """
    if inner_area_mm2 <= 0:
        return 0.0
    in_block = False
    pos: tuple[float, float] | None = None
    block_len = 0.0
    block_phis: list[float] = []

    for line in gcode.splitlines():
        if _BEGIN.search(line):
            in_block = True
            pos = None
            block_len = 0.0
            continue
        if _END.search(line):
            if in_block and block_len > 0:
                block_phis.append((block_len * extrusion_width_mm) / inner_area_mm2)
            in_block = False
            pos = None
            block_len = 0.0
            continue
        if not in_block or not (line.startswith("G0") or line.startswith("G1")):
            continue
        xy = _parse_xy(line)
        if xy is None:
            continue
        is_extrude = line.startswith("G1") and " E" in line.upper()
        if is_extrude and pos is not None:
            dx = xy[0] - pos[0]
            dy = xy[1] - pos[1]
            block_len += (dx * dx + dy * dy) ** 0.5
        pos = xy

    if not block_phis:
        return 0.0
    return sum(block_phis) / len(block_phis)


def gcode_has_infill_gyroid_blocks(gcode: str) -> bool:
    return "BEGIN_INFILL_GYROID" in gcode and "END_INFILL_GYROID" in gcode
