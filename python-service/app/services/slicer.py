# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Kiri:Moto-inspired slicer for the hybrid manufacturing pipeline (Python port).

This is a focused, belt-printer-oriented implementation:
- Input: a watertight, belt-transformed solid (the output of belt_transformer).
- The 3D belt compensation has already been applied to the mesh geometry.
- Therefore the slicer can treat the transformed solid as a "flat" print and
  generate normal planar layers (Z = const) at the desired layer height.
- Produces perimeters + simple infill and emits G-code with proper start/end
  scripts, temperatures, and metadata.

It draws structural inspiration and naming from the existing TS implementation
in vertex/src/lib/kiri/ (engine.ts, slicer.ts, gcode.ts) but is a clean Python
re-implementation using trimesh for robust geometry.

Improved for belt TPU insoles (multi-wall, solid top/bottom, accurate E, TPU material
profiles, angled infill, better start/end). Node layer owns final storage + download.
Further features (advanced seams, variable speed, etc.) can be added iteratively.
"""

from __future__ import annotations

import math
from typing import Any, Iterable

import numpy as np
import trimesh

from app.services.belt_transformer import apply_belt_transform  # only for type reference

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
        # volume per mm of toolpath
        cross_section = self.extrusion_width * self.layer_h
        vol_mm3 = dist * cross_section
        # filament cross section
        r = self.filament_dia / 2.0
        filament_area = 3.1415926535 * r * r
        e_delta = vol_mm3 / filament_area
        self.stats["extrude_dist_mm"] += e_delta
        return e_delta

    def _emit_move(self, x: float, y: float, z: float, feed: float, e_delta: float = 0.0) -> None:
        self._e += e_delta
        self.lines.append(f"G1 X{x:.3f} Y{y:.3f} Z{z:.3f} E{self._e:.5f} F{int(feed)}")

    def travel(self, x: float, y: float, z: float, feed: float | None = None) -> None:
        feed = feed or self.travel_speed * 60  # mm/s -> mm/min
        dist = self._update_pos(x, y, z)
        self.lines.append(f"G0 X{x:.3f} Y{y:.3f} Z{z:.3f} F{int(feed)}")

    def extrude_to(self, x: float, y: float, z: float, feed: float | None = None) -> None:
        feed = feed or (self.print_speed * 60)
        dist = self._update_pos(x, y, z)
        e_delta = self._e_for_dist(dist)
        self._emit_move(x, y, z, feed, e_delta)
        self.stats["perimeters"] += 1  # caller decides if perimeter or infill

    def to_string(self) -> str:
        return "\n".join(self.lines)


# ---------------------------------------------------------------------------
# Core slicing
# ---------------------------------------------------------------------------

def slice_solid(
    solid: trimesh.Trimesh,
    layer_height_mm: float = 0.30,
    perimeters: int = 3,
    infill_density: float = 0.15,
    extrusion_width_mm: float = 0.48,
    solid_layers: int = 3,
    infill_angle_deg: float = 45.0,
) -> list[dict[str, Any]]:
    """
    Improved slicer for belt TPU insoles (Kiri-inspired but focused and maintainable).

    - Reliable contours via trimesh.section on the pre-belt-transformed solid.
    - Multi-wall perimeters (outer + inset inners via centroid-directed offset).
    - Angle-aware infill + high-density "solid" top/bottom layers for insole surface/strength.
    - Returns data ready for high-quality emit_gcode (per-preset temps/speeds etc).
    """
    if not solid.is_watertight:
        pass

    bounds = solid.bounds
    min_z = float(bounds[0][2])
    max_z = float(bounds[1][2])

    layers: list[dict[str, Any]] = []
    z = min_z + layer_height_mm / 2.0
    layer_idx = 0
    plane_normal = np.array([0.0, 0.0, 1.0])

    total_layers = max(1, int((max_z - min_z) / layer_height_mm) + 1)

    while z <= max_z + 1e-6:
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

        # Multi-perimeter walls (inset toward centroid for demo; good for typical insole outlines)
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

        # Infill (angle + density). Solid layers get near-100% for top/bottom quality.
        infill: list[np.ndarray] = []
        is_solid = (layer_idx < solid_layers) or (layer_idx >= total_layers - solid_layers)
        eff_density = 0.92 if is_solid else infill_density

        if wall_contours and eff_density > 0.01:
            all_pts = np.vstack(wall_contours)
            min_x, min_y = all_pts.min(0)
            max_x, max_y = all_pts.max(0)
            cx, cy = (min_x + max_x) * 0.5, (min_y + max_y) * 0.5
            step = extrusion_width_mm / max(eff_density, 0.04)
            ang = math.radians(infill_angle_deg)
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

        layers.append({
            "z": z,
            "contours": wall_contours or contours,
            "infill": infill,
            "is_solid": is_solid,
        })
        z += layer_height_mm
        layer_idx += 1

    return layers


def emit_gcode(
    layers: list[dict[str, Any]],
    preset: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> str:
    """
    Production-oriented G-code emission for belt TPU.

    Uses preset for material (TPU) + machine (belt angle/speeds/temps).
    Respects solid layers, multi-wall, angled infill from slice_solid.
    Accurate E via GcodeBuilder. Good start/end scripts.
    """
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
    g.comment("OrthoCAD Hybrid Manufacturing — improved Kiri-style slicer for belt TPU")
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

    # Prime / skirt hint (simple line for belt setups)
    g.comment("start prime")
    g.travel(5, 5, layer_h * 0.5, travel_speed * 60)
    g.extrude_to(30, 5, layer_h * 0.5, print_speed * 60)
    g.raw("G92 E0")

    for li, layer in enumerate(layers):
        z = layer["z"]
        g.comment(f"LAYER {li} Z={z:.3f} {'SOLID' if layer.get('is_solid') else ''}")
        # Walls (multi-perimeter already expanded in slice)
        for contour in layer.get("contours", []):
            if len(contour) < 2:
                continue
            first = contour[0]
            g.travel(float(first[0]), float(first[1]), z, travel_speed * 60)
            for pt in contour[1:]:
                g.extrude_to(float(pt[0]), float(pt[1]), z, print_speed * 60)
            # close
            g.extrude_to(float(contour[0][0]), float(contour[0][1]), z, print_speed * 60)
            g.stats["perimeters"] += 1

        # Infill (angle + density already prepared; solid layers denser)
        for line in layer.get("infill", []):
            if len(line) < 2:
                continue
            g.travel(float(line[0][0]), float(line[0][1]), z, travel_speed * 60)
            g.extrude_to(float(line[1][0]), float(line[1][1]), z, print_speed * 60)
            g.stats["infill"] += 1

        g.stats["layers"] += 1

    # End
    if retract:
        g.raw(f"G1 E-{preset.get('retractDistanceMm', 0.5):.1f} F{preset.get('retractSpeedMmS', 20)*60:.0f}")
    g.raw("M104 S0")
    g.raw("M140 S0")
    g.raw(f"M106 S{int(fan * 255)}")  # ensure fan state
    g.raw("G91")
    g.raw("G1 Z5 F3000")
    g.raw("G90")
    g.comment("end of hybrid belt TPU print")
    g.comment(f"; total_layers={len(layers)}")

    return g.to_string()


# Public API used by the manufacturing endpoint
def generate_gcode_from_solid(
    transformed_solid: trimesh.Trimesh,
    preset: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> str:
    """
    High-level entry point. Expects pre belt-transformed solid.
    Now consumes richer preset (TPU temps/speeds/perimeters/solids/angle) for quality.
    """
    o = overrides or {}
    layers = slice_solid(
        transformed_solid,
        layer_height_mm=float(o.get("layerHeightMm", preset.get("layerHeightMm", 0.3))),
        perimeters=int(o.get("perimeters", preset.get("perimeters", 3))),
        infill_density=float(o.get("infillDensity", preset.get("infillDensity", 0.15))),
        extrusion_width_mm=float(preset.get("nozzleMm", 0.4)) * 1.2,
        solid_layers=int(preset.get("solidLayers", 3)),
        infill_angle_deg=float(preset.get("infillAngleDeg", 45)),
    )
    return emit_gcode(layers, preset, overrides)
