#!/usr/bin/env python3
"""HARD STL gates: watertight, winding-consistent, one body. Reports volume vs STRAIGHT."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import trimesh


def load_mesh(path: str) -> trimesh.Trimesh:
    mesh = trimesh.load(path, force="mesh")
    if not isinstance(mesh, trimesh.Trimesh):
        raise SystemExit(f"not a single mesh: {path}")
    return mesh


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: stl-gates.py STYLE PATH [STRAIGHT_PATH]", file=sys.stderr)
        return 2
    style = sys.argv[1]
    path = sys.argv[2]
    ref_path = sys.argv[3] if len(sys.argv) > 3 else None
    mesh = load_mesh(path)
    bodies = mesh.split(only_watertight=False)
    volume = float(mesh.volume) if mesh.is_watertight else None
    ref_vol = float(load_mesh(ref_path).volume) if ref_path else None
    delta = None if volume is None or ref_vol is None else volume - ref_vol
    pct = None if delta is None or not ref_vol else 100.0 * delta / ref_vol
    out = {
        "style": style,
        "path": str(Path(path).name),
        "watertight": bool(mesh.is_watertight),
        "winding": bool(mesh.is_winding_consistent),
        "bodies": len(bodies),
        "volume": volume,
        "straightVolume": ref_vol,
        "volumeDelta": delta,
        "volumeDeltaPct": pct,
        "faces": int(len(mesh.faces)),
        "verts": int(len(mesh.vertices)),
    }
    print(json.dumps(out))
    ok = out["watertight"] and out["winding"] and out["bodies"] == 1
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
