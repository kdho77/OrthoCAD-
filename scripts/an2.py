#!/usr/bin/env python3
"""OrthoCAD element-library import (supersedes an.py).

Normalizes an authored GLB into repo-right (+X medial, +Y toe, Z up), writes
`.right.glb` + sidecar + viridis `_thumb.png`.

Anchor basis (Kendon 260):
  u = (y - heelY) / 260   with heelY ≈ -1 on SAMPLE_Top, i.e. (y+1)/260
  v = (x - mid) / halfwidth of unscaled SAMPLE_Top at anchor y, medial +
  LEFT-authored assets are mirrored to right before export.

Usage:
  python3 scripts/an2.py --src met_pad_1.glb --id met-pad-1 --kind met_pad
  python3 scripts/an2.py --src cuboid_pad_1.glb --id cuboid-pad-1 --kind cuboid_pad
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np

try:
    import trimesh
except ImportError as e:  # pragma: no cover
    raise SystemExit("trimesh is required: pip install trimesh") from e

_IMP = Path(__file__).with_name("import-element-library-asset.py")
_spec = importlib.util.spec_from_file_location("element_import", _IMP)
_mod = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(_mod)
raster = _mod.raster
write_heatmap_thumb = _mod.write_heatmap_thumb
H = _mod.H


def _sample_top_path(explicit: str) -> Path:
    p = Path(explicit)
    if p.exists():
        return p
    here = Path(__file__).resolve().parent.parent
    for cand in (here / "tests/fixtures/SAMPLE_Top.glb", Path("tests/fixtures/SAMPLE_Top.glb")):
        if cand.exists():
            return cand
    raise SystemExit("SAMPLE_Top.glb not found (needed for u/v and widthBasis)")


def main() -> int:
    p = argparse.ArgumentParser(description="Import a GLB element (an2 / 260 basis)")
    p.add_argument("--src", required=True, help="Source GLB (authored mm)")
    p.add_argument("--id", required=True)
    p.add_argument("--kind", required=True)
    p.add_argument("--label", default="")
    p.add_argument("--out", default="vertex/public/elements")
    p.add_argument("--ref-top", default="tests/fixtures/SAMPLE_Top.glb")
    p.add_argument("--side", default="", help="authored side; default inferred from centroid X")
    args = p.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    ref = trimesh.load(str(_sample_top_path(args.ref_top))).to_geometry()
    R = ref.vertices.copy()
    heel = float(R[:, 1].min())
    meas = float(R[:, 1].max() - R[:, 1].min())

    m = trimesh.load(str(src)).to_geometry()
    xs, ys, Z = raster(m.vertices, m.faces)
    fp = Z > 0.05
    X, Y = np.meshgrid(xs, ys)
    area = float(fp.sum() * H * H)
    cx, cy = float(X[fp].mean()), float(Y[fp].mean())
    bb = [float(X[fp].min() - H / 2), float(X[fp].max() + H / 2), float(Y[fp].min() - H / 2), float(Y[fp].max() + H / 2)]
    k = int(np.nanargmax(np.where(np.isfinite(Z), Z, -1)))
    pk = (float(X.flat[k]), float(Y.flat[k]), float(Z.flat[k]))

    authored = args.side.lower() if args.side else ("right" if cx < 0 else "left")
    # v from unscaled SAMPLE_Top half-width at anchor y. Right frame = x-mirrored Left.
    Rw = R.copy()
    Rw[:, 0] *= -1
    band = Rw[np.abs(Rw[:, 1] - cy) < 2]
    if len(band) < 8:
        band = Rw
    xl, xh = float(band[:, 0].min()), float(band[:, 0].max())
    mid = (xl + xh) / 2
    hw = max((xh - xl) / 2, 1e-3)
    # After left→right mirror, +X is medial in repo-right.
    v = (cx - mid) / hw if authored == "right" else (mid - cx) / hw
    u = (cy - heel) / 260.0

    N = m.vertices.copy()
    N[:, 0] -= cx
    N[:, 1] -= cy
    faces = m.faces
    if authored == "left":
        N[:, 0] *= -1
        faces = m.faces[:, ::-1]
    N[:, 2] = np.maximum(N[:, 2], 0)
    N[N[:, 2] < 0.05, 2] = 0
    stem = args.id.replace("-", "_")
    glb_name = f"{stem}.right.glb"
    glb_path = out / glb_name
    trimesh.Trimesh(N, faces, process=False).export(str(glb_path))

    xs2, ys2, Z2 = raster(N, faces)
    thumb_name = f"{stem}_thumb.png"
    write_heatmap_thumb(xs2, ys2, Z2, out / thumb_name)

    sidecar = {
        "kind": args.kind,
        "label": args.label or args.id.replace("-", " ").replace("_", " ").title(),
        "nominalPeakMm": round(float(pk[2]), 2),
        "refSizeMm": 260,
        "refMeasuredLengthMm": round(meas, 2),
        "refNote": "u=(y+1)/260 (length-only 260 basis); v=(x-mid)/halfwidth of unscaled SAMPLE_Top at anchor y, medial +",
        "anchor": {"u": round(float(u), 4), "v": round(float(v), 4)},
        "anchorConvention": "v=(x-mid)/halfwidth, medial +",
        "authoredSide": authored,
        "footprintMm": {"w": round(bb[1] - bb[0], 2), "l": round(bb[3] - bb[2], 2), "area": round(area, 1)},
        "featherMm": 2,
        "rotationDeg": 0,
        "category": "add",
        "defaultPlacementMode": "flow",
        "frame": "repo-right (+X medial, +Y toe, Z up)",
        "origin": "footprint centroid, z>=0",
        "anchorMm": {"x": round(cx, 2), "y": round(cy, 2)},
        "source": {"file": src.name, "sha256": hashlib.sha256(src.read_bytes()).hexdigest()},
        "widthBasis": "SAMPLE_Top unscaled",
    }
    side_path = out / f"{stem}.right.json"
    side_path.write_text(json.dumps(sidecar, indent=2) + "\n")

    index_path = out / "index.json"
    index = {"version": 1, "elements": []}
    if index_path.exists():
        index = json.loads(index_path.read_text())
    entry = {
        "id": args.id,
        "kind": args.kind,
        "label": sidecar["label"],
        "glb": glb_name,
        "sidecar": side_path.name,
        "thumb": thumb_name,
    }
    index["elements"] = [e for e in index.get("elements", []) if e.get("id") != args.id] + [entry]
    index_path.write_text(json.dumps(index, indent=4) + "\n")
    print(json.dumps({"glb": str(glb_path), "sidecar": str(side_path), "thumb": thumb_name, **sidecar}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
