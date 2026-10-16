#!/usr/bin/env python3
"""Library import tool for OrthoCAD GLB element assets.

Normalizes an open surface (centroid at origin, z>=0) in the repo-right frame
(+X medial, +Y toe, Z up), writes the GLB + sidecar, and rasters a 0.25 mm
upper envelope (triangle, cell-centre) for QA.

Usage:
  python3 scripts/import-element-library-asset.py \\
      --src met_pad_1.glb --id met-pad-1 --kind met_pad \\
      --out vertex/public/elements
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np

try:
    import trimesh
except ImportError as e:  # pragma: no cover
    raise SystemExit("trimesh is required: pip install trimesh") from e


H = 0.25


def raster(V: np.ndarray, F: np.ndarray, b=None):
    lo = V[:, :2].min(0) - 1 if b is None else b[0]
    hi = V[:, :2].max(0) + 1 if b is None else b[1]
    xs = np.arange(lo[0] + H / 2, hi[0], H)
    ys = np.arange(lo[1] + H / 2, hi[1], H)
    Z = np.full((len(ys), len(xs)), -np.inf)
    for t in V[F]:
        a, b2, c = t
        x0, y0 = t[:, :2].min(0)
        x1, y1 = t[:, :2].max(0)
        i0 = max(0, int(np.ceil((x0 - xs[0]) / H)))
        i1 = min(len(xs) - 1, int(np.floor((x1 - xs[0]) / H)))
        j0 = max(0, int(np.ceil((y0 - ys[0]) / H)))
        j1 = min(len(ys) - 1, int(np.floor((y1 - ys[0]) / H)))
        if i1 < i0 or j1 < j0:
            continue
        X, Y = np.meshgrid(xs[i0 : i1 + 1], ys[j0 : j1 + 1])
        d = (b2[1] - c[1]) * (a[0] - c[0]) + (c[0] - b2[0]) * (a[1] - c[1])
        if abs(d) < 1e-12:
            continue
        l1 = ((b2[1] - c[1]) * (X - c[0]) + (c[0] - b2[0]) * (Y - c[1])) / d
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
        l3 = 1 - l1 - l2
        ins = (l1 >= -1e-9) & (l2 >= -1e-9) & (l3 >= -1e-9)
        z = l1 * a[2] + l2 * b2[2] + l3 * c[2]
        sub = Z[j0 : j1 + 1, i0 : i1 + 1]
        Z[j0 : j1 + 1, i0 : i1 + 1] = np.where(ins, np.maximum(sub, z), sub)
    return xs, ys, Z


def main() -> int:
    p = argparse.ArgumentParser(description="Import a GLB element into the OrthoCAD library")
    p.add_argument("--src", required=True, help="Source GLB (authored mm)")
    p.add_argument("--id", default="met-pad-1")
    p.add_argument("--kind", default="met_pad")
    p.add_argument("--label", default="Met pad 1")
    p.add_argument("--out", default="vertex/public/elements")
    p.add_argument("--ref-top", default="tests/fixtures/SAMPLE_Top.glb")
    p.add_argument("--side", default="RIGHT")
    args = p.parse_args()

    src = Path(args.src)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    m = trimesh.load(str(src)).to_geometry()
    xs, ys, Z = raster(m.vertices, m.faces)
    fp = Z > 0.05
    X, Y = np.meshgrid(xs, ys)
    area = float(fp.sum() * H * H)
    cx, cy = float(X[fp].mean()), float(Y[fp].mean())
    bb = [float(X[fp].min() - H / 2), float(X[fp].max() + H / 2), float(Y[fp].min() - H / 2), float(Y[fp].max() + H / 2)]
    k = int(np.nanargmax(np.where(np.isfinite(Z), Z, -1)))
    pk = (float(X.flat[k]), float(Y.flat[k]), float(Z.flat[k]))

    u = 0.5233
    v = 0.0722
    ref_len = 271.93
    ref_top = Path(args.ref_top)
    if ref_top.exists():
        ref = trimesh.load(str(ref_top)).to_geometry()
        R = ref.vertices.copy()
        R[:, 0] *= -1
        ymin, ymax = float(R[:, 1].min()), float(R[:, 1].max())
        u = (cy - ymin) / (ymax - ymin)
        s = R[np.abs(R[:, 1] - cy) < 2]
        xl, xh = float(s[:, 0].min()), float(s[:, 0].max())
        mid = (xl + xh) / 2
        hw = (xh - xl) / 2
        v = (cx - mid) / hw
        ref_len = ymax - ymin

    N = m.vertices.copy()
    N[:, 0] -= cx
    N[:, 1] -= cy
    N[:, 2] = np.maximum(N[:, 2], 0)
    N[N[:, 2] < 0.05, 2] = 0
    nm = trimesh.Trimesh(N, m.faces, process=False)
    glb_name = f"{args.id.replace('-', '_')}.right.glb" if args.side.upper() == "RIGHT" else f"{args.id}.glb"
    glb_path = out / glb_name
    nm.export(str(glb_path))

    sha = hashlib.sha256(src.read_bytes()).hexdigest()
    sidecar = {
        "kind": args.kind,
        "label": args.label,
        "nominalPeakMm": round(float(pk[2]), 2),
        "refSizeMm": 260,
        "anchor": {"u": round(float(u), 4), "v": round(float(v), 4)},
        "defaultAnchorU": round(float(u), 4),
        "defaultAnchorV": round(float(v), 4),
        "anchorConvention": "u heel0->toe1 over ref Y extent; v=(x-mid)/halfwidth at anchor Y, medial +",
        "authoredSide": args.side.lower(),
        "footprintMm": {"w": round(bb[1] - bb[0], 2), "l": round(bb[3] - bb[2], 2), "area": round(area, 1)},
        "featherMm": 2,
        "rotationDeg": 0,
        "category": "add",
        "defaultPlacementMode": "flow",
        "frame": "repo-right (+X medial, +Y toe, Z up)",
        "refMeasuredLengthMm": round(float(ref_len), 2),
        "origin": "footprint centroid, z>=0",
        "source": {"file": src.name, "sha256": sha},
        "anchorMm": {"x": round(cx, 2), "y": round(cy, 2)},
    }
    side_path = out / glb_name.replace(".glb", ".json")
    side_path.write_text(json.dumps(sidecar, indent=2) + "\n")

    index_path = out / "index.json"
    index = {"version": 1, "elements": []}
    if index_path.exists():
        index = json.loads(index_path.read_text())
    entry = {"id": args.id, "kind": args.kind, "glb": glb_name, "sidecar": side_path.name}
    index["elements"] = [e for e in index.get("elements", []) if e.get("id") != args.id] + [entry]
    index_path.write_text(json.dumps(index, indent=4) + "\n")
    print(json.dumps({"glb": str(glb_path), "sidecar": str(side_path), **sidecar}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
