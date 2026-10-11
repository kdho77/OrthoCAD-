# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""Time manufacturing pipeline stages against the AppSail 30s request timeout.

Run from repo root or python-service:

    PYTHONPATH=python-service python3 python-service/scripts/measure_appsail_timeout.py

Prints TSV-ish rows and a JSON summary. Does not require network or secrets.
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import trimesh

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.services.belt_transformer import apply_belt_transform
from app.services.belt_wall_slice import slice_belt_layer_contours
from app.services.presets import get_preset
from app.services.slicer import generate_gcode_from_solid
from app.services.stl_loader import load_watertight_stl


APPSAIL_TIMEOUT_S = 30.0
NEAR_TIMEOUT_S = 20.0


def timed(fn, *args, **kwargs):
    t0 = time.perf_counter()
    result = fn(*args, **kwargs)
    return result, time.perf_counter() - t0


def make_box_stl(path: str, size: tuple[float, float, float] = (40.0, 40.0, 6.0)) -> None:
    mesh = trimesh.creation.box(extents=size)
    mesh.export(path)


def make_insole_like_mesh(length: float = 250.0, width: float = 90.0, density: int = 36) -> trimesh.Trimesh:
    """Procedural closed insole-ish solid (heel/forefoot taper + arch)."""
    y0 = -length * 0.48
    nx, ny = density, max(8, density // 3)
    top, bot = [], []

    def half_width(u: float) -> float:
        base = 0.48 + 0.12 * math.sin(math.pi * u)
        heel = 0.55 if u < 0.15 else 1.0
        toe = max(0.6, 1.0 - (u - 0.85) / 0.2) if u > 0.82 else 1.0
        return width / 2 * base * heel * toe

    for i in range(nx + 1):
        u = i / nx
        y = y0 + u * length
        hw = half_width(u)
        for j in range(ny + 1):
            v = (j / ny) * 2 - 1
            x = v * hw
            arch = 7.5 * math.exp(-((u - 0.40) ** 2) / 0.07) * max(0.0, 1.0 - abs(v) * 0.65)
            cup = 4.2 * math.exp(-((u - 0.08) ** 2) / 0.06) * max(0.0, 1.0 - abs(v) * 0.4)
            top.append([x, y, 2.8 + arch + cup + 1.5 * (u**1.8)])
            bot.append([x, y, -0.8 * math.exp(-((u - 0.12) ** 2) / 0.09)])

    faces = []
    for i in range(nx):
        for j in range(ny):
            a = i * (ny + 1) + j
            b = a + 1
            c = (i + 1) * (ny + 1) + j
            d = c + 1
            faces.extend([[a, b, d], [a, d, c]])

    top_m = trimesh.Trimesh(vertices=np.array(top), faces=np.array(faces), process=False)
    bot_m = trimesh.Trimesh(vertices=np.array(bot), faces=np.array(faces), process=False)
    bot_m.invert()
    solid = trimesh.util.concatenate([top_m, bot_m])
    try:
        solid = trimesh.Trimesh(vertices=solid.vertices, faces=solid.faces, process=True)
    except Exception:
        pass
    return solid


def flag_for(seconds: float) -> str:
    if seconds >= APPSAIL_TIMEOUT_S:
        return "OVER_30S"
    if seconds >= NEAR_TIMEOUT_S:
        return "NEAR_30S"
    return "OK"


def main() -> int:
    rows: list[dict[str, object]] = []

    def record(name: str, seconds: float, notes: str, measured: bool = True) -> None:
        rows.append(
            {
                "endpoint_or_stage": name,
                "seconds": round(seconds, 3),
                "flag": flag_for(seconds),
                "measured": measured,
                "notes": notes,
            }
        )
        print(f"{name:48s} {seconds:8.3f}s  {flag_for(seconds):8s}  {notes}")

    record("GET /health", 0.002, "constant JSON liveness probe; no geometry", measured=False)

    coupon = ROOT / "tests" / "fixtures" / "a1_coupon_40x40x6.stl"
    stl_path = str(coupon) if coupon.exists() else None
    if stl_path is None:
        tmp = tempfile.NamedTemporaryFile(suffix=".stl", delete=False)
        tmp.close()
        make_box_stl(tmp.name)
        stl_path = tmp.name

    solid, load_s = timed(load_watertight_stl, stl_path)
    record("POST /manufacture (stl load+repair, 40x40x6 coupon)", load_s, f"faces={len(solid.faces)}")

    _, export_s = timed(lambda: solid.export(file_type="stl"))
    record("POST /manufacture output=stl (coupon export)", load_s + export_s, "validate + STL passthrough")

    transformed, belt_s = timed(apply_belt_transform, solid, 45.0)
    record("belt_transform (coupon)", belt_s, "45 deg shear")

    z_mid = float(transformed.bounds[0][2] + transformed.extents[2] * 0.5)
    _, layer_s = timed(
        slice_belt_layer_contours,
        transformed,
        z_mid,
        belt_gantry_angle_deg=45.0,
        perimeters=3,
        extrusion_width_mm=0.48,
        infill_density=0.15,
        layer_index=5,
        include_infill=True,
    )
    record("belt_wall_slice one layer (coupon)", layer_s, "procedural wall reconstruct analog")

    preset = get_preset("apex-belt-v2-45")
    preset["beltAngleDeg"] = 45.0
    # Thick layers keep the coupon G-code path short enough to measure.
    _, gcode_s = timed(
        generate_gcode_from_solid,
        transformed,
        preset,
        {"layerHeightMm": 1.0, "perimeters": 2, "infillDensity": 0.1, "infillPattern": "rectilinear"},
    )
    record("POST /manufacture output=gcode (coupon, 1.0mm layers)", load_s + belt_s + gcode_s, "end-to-end coupon")

    dense = trimesh.creation.box(extents=(250.0, 90.0, 12.0))
    for _ in range(5):
        dense = dense.subdivide()
    dense_xf, dense_belt_s = timed(apply_belt_transform, dense, 45.0)
    record(
        "belt_transform (subdivided 250x90x12, ~production faces)",
        dense_belt_s,
        f"faces={len(dense.faces)}",
    )

    z0d, z1d = float(dense_xf.bounds[0][2]), float(dense_xf.bounds[1][2])
    _, dense_layer_s = timed(
        slice_belt_layer_contours,
        dense_xf,
        z0d + (z1d - z0d) * 0.45,
        belt_gantry_angle_deg=45.0,
        perimeters=3,
        extrusion_width_mm=0.48,
        infill_density=0.15,
        layer_index=10,
        include_infill=True,
    )
    record(
        "belt_wall_slice one layer (subdivided foot-size solid)",
        dense_layer_s,
        f"faces={len(dense.faces)} z-span={z1d - z0d:.1f}mm",
    )
    dense_layers = max(1, int(math.ceil((z1d - z0d) / 0.30)))
    est_dense = dense_belt_s + dense_layer_s * dense_layers + 2.0
    record(
        "POST /manufacture output=gcode (est. dense one foot, 0.3mm)",
        est_dense,
        f"~{dense_layers} layers × {dense_layer_s:.3f}s/layer on {len(dense.faces)} faces",
        measured=False,
    )

    default_glb = ROOT.parent / "tests" / "fixtures" / "Default.glb"
    if default_glb.exists():
        loaded = trimesh.load(str(default_glb), force="mesh")
        if isinstance(loaded, trimesh.Scene):
            meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
            loaded = trimesh.util.concatenate(meshes) if meshes else None
        if isinstance(loaded, trimesh.Trimesh):
            _, glb_belt_s = timed(apply_belt_transform, loaded, 45.0)
            record(
                "belt_transform (Default.glb production mesh)",
                glb_belt_s,
                f"faces={len(loaded.faces)} verts={len(loaded.vertices)}",
            )
            glb_xf = apply_belt_transform(loaded, 45.0)
            zg0, zg1 = float(glb_xf.bounds[0][2]), float(glb_xf.bounds[1][2])
            _, glb_layer_s = timed(
                slice_belt_layer_contours,
                glb_xf,
                zg0 + (zg1 - zg0) * 0.4,
                belt_gantry_angle_deg=45.0,
                perimeters=3,
                extrusion_width_mm=0.48,
                infill_density=0.15,
                layer_index=10,
                include_infill=True,
            )
            record(
                "belt_wall_slice one layer (Default.glb)",
                glb_layer_s,
                f"z-span={zg1 - zg0:.1f}mm",
            )
            glb_layers = max(1, int(math.ceil((zg1 - zg0) / 0.30)))
            est_glb = glb_belt_s + glb_layer_s * glb_layers + 2.0
            record(
                "POST /manufacture output=gcode (est. Default.glb, 0.3mm)",
                est_glb,
                f"~{glb_layers} layers × {glb_layer_s:.3f}s/layer",
                measured=False,
            )

    insole = make_insole_like_mesh(250.0, 90.0, density=28)
    insole_xf, insole_belt_s = timed(apply_belt_transform, insole, 45.0)
    record("belt_transform (procedural foot ~250mm)", insole_belt_s, f"faces={len(insole.faces)}")

    z0, z1 = float(insole_xf.bounds[0][2]), float(insole_xf.bounds[1][2])
    sample_layers = 4
    layer_times: list[float] = []
    for i in range(sample_layers):
        z = z0 + (z1 - z0) * (0.2 + 0.15 * i)
        _, ls = timed(
            slice_belt_layer_contours,
            insole_xf,
            z,
            belt_gantry_angle_deg=45.0,
            perimeters=3,
            extrusion_width_mm=0.48,
            infill_density=0.15,
            layer_index=i,
            include_infill=True,
        )
        layer_times.append(ls)
    mean_layer = sum(layer_times) / len(layer_times)
    record(
        "belt_wall_slice one layer (procedural foot)",
        mean_layer,
        f"n={sample_layers} z-span={z1 - z0:.1f}mm",
    )

    # Preview claim from the approved plan: ~25s/foot for procedural wall reconstruct.
    record(
        "preview procedural wall reconstruct (per foot)",
        25.0,
        "plan/preview figure — browser worker today, not AppSail",
        measured=False,
    )

    layer_h = 0.30
    n_layers = max(1, int(math.ceil((z1 - z0) / layer_h)))
    est_gcode = insole_belt_s + mean_layer * n_layers + 1.5
    record(
        "POST /manufacture output=gcode (est. one foot, 0.3mm)",
        est_gcode,
        f"~{n_layers} layers × {mean_layer:.3f}s/layer + belt + emit",
        measured=False,
    )
    record(
        "POST /manufacture output=gcode (est. pair / two feet)",
        est_gcode * 2,
        "if both feet run in one request",
        measured=False,
    )

    # tRPC wrappers around /manufacture
    record("manufacturing.prepareManufacturingStlUpload", 0.4, "Supabase signed URL only", measured=False)
    record("manufacturing.uploadManufacturingStl", 2.5, "inline ≤8MB to Supabase Storage", measured=False)
    record(
        "manufacturing.generateSolid → /manufacture",
        est_dense + 1.5,
        "lower-bound: dense 12k-face solid + token RPC + storage; Default.glb-scale is OVER_30S",
        measured=False,
    )
    record("manufacturing.getGcodeDownloadUrl", 0.3, "signed download URL", measured=False)

    summary = {
        "appsail_timeout_s": APPSAIL_TIMEOUT_S,
        "near_threshold_s": NEAR_TIMEOUT_S,
        "host": os.uname().nodename,
        "rows": rows,
    }
    print("\n" + json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
