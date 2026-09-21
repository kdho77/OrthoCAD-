# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""MaterialZone validation + sole-UV hardness resolution (Phase B)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from pydantic import BaseModel, Field
from shapely.geometry import Point, Polygon
from shapely.validation import make_valid

from app.services.print_recipe import HARDNESS_TO_INFILL_PCT, HardnessName, PrintRecipeV1
from app.services.sole_uv_map import SoleUvFrame

LesionTag = Literal["accommodative", "highRisk"]

MIN_ZONE_AREA_MM2 = 100.0
MIN_CORRIDOR_MM = 1.92  # 4 × w @ w=0.48


class SoleUvPoint(BaseModel):
    u: float = Field(ge=0.0, le=1.0)
    v: float = Field(ge=-1.0, le=1.0)


class MaterialZoneV1(BaseModel):
    zone_id: str
    anatomic_label: str
    hardness_name: HardnessName
    boundary_sole_uv: list[SoleUvPoint] = Field(min_length=3)
    lesion_tags: list[LesionTag] = Field(default_factory=list)


class SoleUvFrameModel(BaseModel):
    min_x_mm: float
    min_y_mm: float
    length_mm: float = Field(gt=0)
    width_mm: float = Field(gt=0)

    def to_frame(self) -> SoleUvFrame:
        return SoleUvFrame(
            min_x_mm=self.min_x_mm,
            min_y_mm=self.min_y_mm,
            length_mm=self.length_mm,
            width_mm=self.width_mm,
        )


@dataclass
class ZoneValidationError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


def _zone_polygon_mm(zone: MaterialZoneV1, frame: SoleUvFrame) -> Polygon:
    pts = [frame.uv_to_foot_xy(p.u, p.v) for p in zone.boundary_sole_uv]
    poly = Polygon(pts)
    if not poly.is_valid:
        poly = make_valid(poly)
    if poly.is_empty or poly.area < 1e-6:
        raise ZoneValidationError(f"Zone {zone.zone_id} has degenerate boundary")
    return poly


def validate_material_zones(
    zones: list[MaterialZoneV1],
    frame: SoleUvFrame,
    extrusion_width_mm: float = 0.48,
) -> None:
    """Reject slivers / tight corridors before manufacture."""
    if not zones:
        return
    min_corridor = 4.0 * extrusion_width_mm
    polys: list[tuple[MaterialZoneV1, Polygon]] = []
    for z in zones:
        poly = _zone_polygon_mm(z, frame)
        area = float(poly.area)
        if area < MIN_ZONE_AREA_MM2:
            raise ZoneValidationError(
                f"Zone {z.zone_id} area {area:.1f} mm² < {MIN_ZONE_AREA_MM2} mm² minimum",
            )
        eroded = poly.buffer(-2.0 * extrusion_width_mm)
        if eroded.is_empty or eroded.area < 1.0:
            raise ZoneValidationError(
                f"Zone {z.zone_id} corridor/core too narrow (erode 2w empty)",
            )
        polys.append((z, poly))

    for i, (_, a) in enumerate(polys):
        for j, (_, b) in enumerate(polys):
            if j <= i:
                continue
            dist = float(a.distance(b))
            if dist < min_corridor - 1e-6 and not a.intersects(b):
                raise ZoneValidationError(
                    f"Corridor between zones {polys[i][0].zone_id} and {polys[j][0].zone_id} "
                    f"is {dist:.2f} mm < {min_corridor:.2f} mm minimum",
                )


def _hardness_pct(recipe: PrintRecipeV1, name: HardnessName) -> int:
    table = recipe.hardness_to_infill_pct or HARDNESS_TO_INFILL_PCT
    return int(table.get(name, HARDNESS_TO_INFILL_PCT[name]))


def resolve_infill_fraction_at_uv(
    recipe: PrintRecipeV1,
    u: float,
    v: float,
) -> float:
    """Return gyroid volume fraction 0..1 at sole UV.

    Overlap policy: explicit zones beat default fill. Untagged overlaps → harder (max %).
    Soft-wins (min %) when any overlapping zone has accommodative/highRisk tags, unless
    override_soft_wins is set (then max vs default, same as override on tagged heel cases).
    """
    zones_raw = recipe.zones or []
    if not zones_raw:
        return recipe.infill_fraction()

    frame = recipe.sole_uv_frame
    if frame is None:
        return recipe.infill_fraction()

    zones = [MaterialZoneV1.model_validate(z) if isinstance(z, dict) else z for z in zones_raw]
    frame_obj = (
        frame.to_frame()
        if isinstance(frame, SoleUvFrameModel)
        else SoleUvFrame(
            min_x_mm=frame.min_x_mm,
            min_y_mm=frame.min_y_mm,
            length_mm=frame.length_mm,
            width_mm=frame.width_mm,
        )
    )

    x_mm, y_mm = frame_obj.uv_to_foot_xy(u, v)
    pt = Point(x_mm, y_mm)
    matching: list[MaterialZoneV1] = []
    for z in zones:
        poly = _zone_polygon_mm(z, frame_obj)
        if poly.contains(pt) or poly.touches(pt):
            matching.append(z)

    default_pct = _hardness_pct(recipe, recipe.default_hardness)
    if not matching:
        return default_pct / 100.0

    pcts = [_hardness_pct(recipe, z.hardness_name) for z in matching]
    tagged = any(
        tag in ("accommodative", "highRisk") for z in matching for tag in (z.lesion_tags or [])
    )
    if recipe.override_soft_wins:
        chosen = max(pcts + [default_pct])
    elif tagged:
        chosen = min(pcts + [default_pct])
    else:
        chosen = max(pcts)
    return chosen / 100.0


def zone_core_polygon_mm(
    zone: MaterialZoneV1,
    frame: SoleUvFrame,
    extrusion_width_mm: float,
) -> Polygon:
    poly = _zone_polygon_mm(zone, frame)
    core = poly.buffer(-2.0 * extrusion_width_mm)
    if core.is_empty:
        raise ZoneValidationError(f"Zone {zone.zone_id} has no measurable core (erode 2w)")
    return core
