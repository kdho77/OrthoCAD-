# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Kiri:Moto-inspired slicer for the hybrid manufacturing pipeline (Python port).

Belt manufacturing: watertight solid is belt-transformed, then sliced with belt-aware
walls (racetrack / belt-plane pinning) and gyroid or rectilinear infill inside the
wall region. `/manufacture` gcode output requires a belt preset (beltAngleDeg).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import trimesh

from app.services.belt_wall_slice import slice_belt_layer_contours
from app.services.geometry_utils import ensure_watertight
from app.services.gyroid_infill import (
    generate_gyroid_infill_for_layer,
    generate_gyroid_infill_zoned_for_layer,
)
from app.services.print_recipe import PrintRecipeV1
from app.services.sole_uv_map import SoleUvFrame

# ---------------------------------------------------------------------------
# Basic types mirroring the spirit of the TS kiri code
# ---------------------------------------------------------------------------


class GcodeBuilder:
    """Improved G-code emitter with position tracking and accurate extrusion math.
    Suitable for TPU on belt printers (configurable via presets).
    """

    def __init__(
        self,
        filament_dia: float = 1.75,
        extrusion_width: float = 0.48,
        layer_h: float = 0.3,
        print_speed: float = 35,
        travel_speed: float = 80,
    ):
        self.filament_dia = filament_dia
        self.extrusion_width = extrusion_width
        self.layer_h = layer_h
        self.print_speed = print_speed
        self.travel_speed = travel_speed
        self.lines: list[str] = []
        self._e = 0.0
        self._last_x = 0.0
        self._last_y = 0.0
        self._last_z = 0.0
        self.stats = {"layers": 0, "perimeters": 0, "infill": 0, "extrude_dist_mm": 0.0}

    def comment(self, text: str) -> None:
        self.lines.append(f"; {text}")

    def raw(self, cmd: str) -> None:
        self.lines.append(cmd)

    def _update_pos(self, x: float, y: float, z: float) -> float:
        """Return distance traveled since last pos and update internal state."""
        dx = x - self._last_x
        dy = y - self._last_y
        dz = z - self._last_z
        dist = (dx * dx + dy * dy + dz * dz) ** 0.5
        self._last_x, self._last_y, self._last_z = x, y, z
        return dist

    def _e_for_dist(self, dist: float) -> float:
        """Accurate filament length for a move (rect approx cross-section)."""
        if dist <= 0:
            return 0.0
        cross_section = self.extrusion_width * self.layer_h
        vol_mm3 = dist * cross_section
        r = self.filament_dia / 2.0
        filament_area = 3.1415926535 * r * r
        e_delta = vol_mm3 / filament_area
        self.stats["extrude_dist_mm"] += e_delta
        return e_delta

    def _emit_move(self, x: float, y: float, z: float, feed: float, e_delta: float = 0.0) -> None:
        self._e += e_delta
        self.lines.append(f"G1 X{x:.3f} Y{y:.3f} Z{z:.3f} E{self._e:.5f} F{int(feed)}")

    def travel(self, x: float, y: float, z: float, feed: float | None = None) -> None:
        feed = feed or self.travel_speed * 60
        self._update_pos(x, y, z)
        self.lines.append(f"G0 X{x:.3f} Y{y:.3f} Z{z:.3f} F{int(feed)}")

    def extrude_to(self, x: float, y: float, z: float, feed: float | None = None) -> None:
        feed = feed or (self.print_speed * 60)
        dist = self._update_pos(x, y, z)
        e_delta = self._e_for_dist(dist)
        self._emit_move(x, y, z, feed, e_delta)
        self.stats["perimeters"] += 1

    def to_string(self) -> str:
        return "\n".join(self.lines)


# ---------------------------------------------------------------------------
# Core slicing
# ---------------------------------------------------------------------------


def _section_wall_contours_for_layer(
    solid: trimesh.Trimesh,
    z: float,
    perimeters: int,
    extrusion_width_mm: float,
) -> list[np.ndarray]:
    """Planar section walls for zoned gyroid clip (A2 coupon gates / sole-UV field)."""
    plane_normal = np.array([0.0, 0.0, 1.0])
    try:
        path = solid.section(plane_origin=[0, 0, z], plane_normal=plane_normal)
    except Exception:
        path = None

    contours: list[np.ndarray] = []
    if path is not None and len(getattr(path, "entities", [])) > 0:
        for entity in getattr(path, "entities", []):
            pts = path.vertices[entity.points]
            if len(pts) >= 3:
                contours.append(pts[:, :2])

    wall_contours: list[np.ndarray] = []
    if contours:
        for c in contours:
            if len(c) < 3:
                continue
            wall_contours.append(c)
            cx, cy = float(c[:, 0].mean()), float(c[:, 1].mean())
            for w in range(1, max(1, perimeters)):
                inset = extrusion_width_mm * 0.85 * w
                dirs = np.stack([cx - c[:, 0], cy - c[:, 1]], axis=1)
                norms = np.linalg.norm(dirs, axis=1, keepdims=True) + 1e-9
                wall_contours.append(c - (dirs / norms) * inset)
    return wall_contours


def slice_solid(
    solid: trimesh.Trimesh,
    layer_height_mm: float = 0.30,
    perimeters: int = 3,
    infill_density: float = 0.15,
    extrusion_width_mm: float = 0.48,
    solid_layers: int = 3,
    infill_angle_deg: float = 45.0,
    infill_pattern: str = "rectilinear",
    belt_gantry_angle_deg: float | None = None,
    print_recipe: PrintRecipeV1 | None = None,
    sole_uv_frame: SoleUvFrame | None = None,
) -> list[dict[str, Any]]:
    """
    Belt TPU slicer: racetrack-aware walls first, then infill inside the wall region.

    - Walls: triangle intersection + belt stitch / inset (Vertex belt SOP).
    - Infill: gyroid (PrintRecipe) or polygon-clipped rectilinear inside inset region.
    """
    if not solid.is_watertight:
        solid = ensure_watertight(solid, label="slice_input")
    if not solid.is_watertight:
        raise ValueError(
            "Cannot slice: mesh is not watertight after repair "
            f"(faces={len(solid.faces)}, verts={len(solid.vertices)})"
        )

    belt_angle = belt_gantry_angle_deg
    if belt_angle is None or belt_angle <= 0:
        raise ValueError(
            "slice_solid requires belt_gantry_angle_deg; hybrid gcode is belt-printer only"
        )

    bounds = solid.bounds
    min_z = float(bounds[0][2])
    max_z = float(bounds[1][2])

    layers: list[dict[str, Any]] = []
    z = min_z + layer_height_mm / 2.0
    layer_idx = 0
    total_layers = max(1, int((max_z - min_z) / layer_height_mm) + 1)

    while z <= max_z + 1e-6:
        is_solid = (layer_idx < solid_layers) or (layer_idx >= total_layers - solid_layers)
        eff_density = 0.92 if is_solid else infill_density

        use_rectilinear_infill = infill_pattern != "gyroid" or is_solid
        wall_contours, rect_infill = slice_belt_layer_contours(
            solid,
            z,
            belt_gantry_angle_deg=belt_angle,
            perimeters=perimeters,
            extrusion_width_mm=extrusion_width_mm,
            infill_density=eff_density,
            layer_index=layer_idx,
            include_infill=use_rectilinear_infill and eff_density > 0.01,
        )

        infill: list[np.ndarray] = []
        if wall_contours and eff_density > 0.01:
            if infill_pattern == "gyroid" and not is_solid:
                use_zones = bool(print_recipe and print_recipe.zones and sole_uv_frame)
                if use_zones and print_recipe is not None and sole_uv_frame is not None:
                    clip_contours = _section_wall_contours_for_layer(
                        solid,
                        z,
                        perimeters,
                        extrusion_width_mm,
                    )
                    if not clip_contours:
                        clip_contours = wall_contours
                    infill = generate_gyroid_infill_zoned_for_layer(
                        clip_contours,
                        z,
                        extrusion_width_mm,
                        print_recipe,
                        sole_uv_frame,
                        belt_angle,
                    )
                else:
                    infill = generate_gyroid_infill_for_layer(
                        wall_contours,
                        z,
                        eff_density,
                        extrusion_width_mm,
                        perimeters=perimeters,
                    )
            else:
                infill = rect_infill
                if not infill and not is_solid:
                    # Solid-top/bottom rectilinear fallback when no inset loops (open racetrack layers).
                    all_pts = np.vstack(wall_contours)
                    min_x, min_y = all_pts.min(0)
                    max_x, max_y = all_pts.max(0)
                    cx, cy = (min_x + max_x) * 0.5, (min_y + max_y) * 0.5
                    step = extrusion_width_mm / max(eff_density, 0.04)
                    ang = math.radians(infill_angle_deg + (layer_idx % 2) * 90.0)
                    dx, dy = math.cos(ang), math.sin(ang)
                    px, py = -dy, dx
                    length = max(max_x - min_x, max_y - min_y) * 1.6
                    off = -length
                    while off < length:
                        x0 = cx + px * off
                        y0 = cy + py * off
                        p1 = np.array([x0 - dx * length, y0 - dy * length])
                        p2 = np.array([x0 + dx * length, y0 + dy * length])
                        infill.append(np.stack([p1, p2]))
                        off += step

        layers.append(
            {
                "z": z,
                "contours": wall_contours,
                "infill": infill,
                "is_solid": is_solid,
                "infill_pattern": (
                    "gyroid"
                    if infill_pattern == "gyroid" and not is_solid and len(infill) > 0
                    else "rectilinear"
                ),
            }
        )
        z += layer_height_mm
        layer_idx += 1

    return layers


def emit_gcode(
    layers: list[dict[str, Any]],
    preset: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> str:
    """Production-oriented G-code emission for belt TPU."""
    o = overrides or {}
    layer_h = float(o.get("layerHeightMm", preset.get("layerHeightMm", 0.3)))
    nozzle = float(preset.get("nozzleMm", 0.4))
    width = nozzle * 1.2

    print_speed = float(preset.get("printSpeedMmS", 35))
    travel_speed = float(preset.get("travelSpeedMmS", 80))
    nozzle_temp = int(preset.get("nozzleTempC", 235))
    bed_temp = int(preset.get("bedTempC", 0))
    fan = float(preset.get("coolingFanSpeed", 0.2))
    retract = bool(preset.get("retractEnable", False))

    g = GcodeBuilder(
        filament_dia=1.75,
        extrusion_width=width,
        layer_h=layer_h,
        print_speed=print_speed,
        travel_speed=travel_speed,
    )

    belt = preset.get("beltAngleDeg")
    g.comment("OrthoCAD Hybrid Manufacturing — belt-aware slicer (walls + gyroid/rectilinear infill)")
    g.comment(f"preset={preset.get('name','unknown')} layerH={layer_h}mm nozzle={nozzle}mm belt={belt}° material=TPU")
    g.raw("G21")
    g.raw("G90")
    g.raw("M82")
    g.raw(f"M104 S{nozzle_temp}")
    g.raw(f"M109 S{nozzle_temp}")
    if bed_temp > 0:
        g.raw(f"M140 S{bed_temp}")
        g.raw(f"M190 S{bed_temp}")
    g.raw("G92 E0")

    g.comment("start prime")
    g.travel(5, 5, layer_h * 0.5, travel_speed * 60)
    g.extrude_to(30, 5, layer_h * 0.5, print_speed * 60)
    g.raw("G92 E0")

    for li, layer in enumerate(layers):
        z = layer["z"]
        g.comment(f"LAYER {li} Z={z:.3f} {'SOLID' if layer.get('is_solid') else ''}")
        for contour in layer.get("contours", []):
            if len(contour) < 2:
                continue
            first = contour[0]
            g.travel(float(first[0]), float(first[1]), z, travel_speed * 60)
            for pt in contour[1:]:
                g.extrude_to(float(pt[0]), float(pt[1]), z, print_speed * 60)
            g.extrude_to(float(contour[0][0]), float(contour[0][1]), z, print_speed * 60)
            g.stats["perimeters"] += 1

        infill_lines = layer.get("infill", [])
        pat = layer.get("infill_pattern", "rectilinear")
        if infill_lines and pat == "gyroid":
            g.comment("BEGIN_INFILL_GYROID")
        for line in infill_lines:
            if len(line) < 2:
                continue
            g.travel(float(line[0][0]), float(line[0][1]), z, travel_speed * 60)
            g.extrude_to(float(line[1][0]), float(line[1][1]), z, print_speed * 60)
            g.stats["infill"] += 1
        if infill_lines and pat == "gyroid":
            g.comment("END_INFILL_GYROID")

        g.stats["layers"] += 1

    if retract:
        g.raw(f"G1 E-{preset.get('retractDistanceMm', 0.5):.1f} F{preset.get('retractSpeedMmS', 20)*60:.0f}")
    g.raw("M104 S0")
    g.raw("M140 S0")
    g.raw(f"M106 S{int(fan * 255)}")
    g.raw("G91")
    g.raw("G1 Z5 F3000")
    g.raw("G90")
    g.comment("end of hybrid belt TPU print")
    g.comment(f"; total_layers={len(layers)}")

    return g.to_string()


def build_slice_overrides(
    preset: dict[str, Any],
    *,
    layer_height_mm: float | None = None,
    infill_density: float | None = None,
    perimeters: int | None = None,
    print_recipe: PrintRecipeV1 | None = None,
) -> dict[str, Any]:
    """Merge request overrides on top of preset defaults (recipe wins over scalar infill)."""
    overrides: dict[str, Any] = {
        "layerHeightMm": preset.get("layerHeightMm", 0.30),
        "perimeters": preset.get("perimeters", 3),
        "infillDensity": preset.get("infillDensity", 0.15),
        "infillPattern": "rectilinear",
    }
    if layer_height_mm is not None:
        overrides["layerHeightMm"] = layer_height_mm
    if perimeters is not None:
        overrides["perimeters"] = perimeters
    if print_recipe is not None:
        overrides["infillDensity"] = print_recipe.infill_fraction()
        overrides["infillPattern"] = "gyroid"
        overrides["printRecipe"] = print_recipe
        frame: SoleUvFrame | None = None
        if print_recipe.sole_uv_frame is not None:
            sf = print_recipe.sole_uv_frame
            frame = SoleUvFrame(
                min_x_mm=sf.min_x_mm,
                min_y_mm=sf.min_y_mm,
                length_mm=sf.length_mm,
                width_mm=sf.width_mm,
            )
        if frame is not None and print_recipe.zones:
            zones = [
                MaterialZoneV1.model_validate(z) if isinstance(z, dict) else z
                for z in print_recipe.zones
            ]
            validate_material_zones(zones, frame, extrusion_width_mm=0.48)
        overrides["soleUvFrame"] = frame
    elif infill_density is not None:
        overrides["infillDensity"] = infill_density
    return overrides


def generate_gcode_from_solid(
    transformed_solid: trimesh.Trimesh,
    preset: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> str:
    """High-level entry point. Expects pre belt-transformed solid."""
    o = overrides or {}
    if not transformed_solid.is_watertight:
        transformed_solid = ensure_watertight(transformed_solid, label="gcode_input")
    belt_angle = float(preset.get("beltAngleDeg") or 45.0)
    layers = slice_solid(
        transformed_solid,
        layer_height_mm=float(o.get("layerHeightMm", preset.get("layerHeightMm", 0.3))),
        perimeters=int(o.get("perimeters", preset.get("perimeters", 3))),
        infill_density=float(o.get("infillDensity", preset.get("infillDensity", 0.15))),
        extrusion_width_mm=float(preset.get("nozzleMm", 0.4)) * 1.2,
        solid_layers=int(preset.get("solidLayers", 3)),
        infill_angle_deg=float(preset.get("infillAngleDeg", 45)),
        infill_pattern=str(o.get("infillPattern", "rectilinear")),
        belt_gantry_angle_deg=belt_angle,
        print_recipe=o.get("printRecipe"),
        sole_uv_frame=o.get("soleUvFrame"),
    )
    return emit_gcode(layers, preset, overrides)
