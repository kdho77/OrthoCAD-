#!/usr/bin/env python3
"""Library import tool for OrthoCAD GLB element assets.

Normalizes an open surface (centroid at origin, z>=0) in the repo-right frame
(+X medial, +Y toe, Z up), writes the GLB + sidecar, rasters a 0.25 mm
upper envelope (triangle, cell-centre) for QA, and writes a viridis height
heatmap thumbnail (transparent background, red + at the placement origin).

Usage:
  python3 scripts/import-element-library-asset.py \\
      --src met_pad_1.glb --id met-pad-1 --kind met_pad \\
      --out vertex/public/elements
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import zlib
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


# Matplotlib viridis stops (t = 0..1). Dark purple at low, yellow at peak.
_VIRIDIS = np.array(
    [
        [0.267004, 0.004874, 0.329415],
        [0.282623, 0.140926, 0.457517],
        [0.253935, 0.265254, 0.529983],
        [0.206756, 0.371758, 0.553117],
        [0.163625, 0.471133, 0.558148],
        [0.127568, 0.566949, 0.550556],
        [0.134692, 0.658636, 0.517649],
        [0.266941, 0.748751, 0.440573],
        [0.477504, 0.821444, 0.318195],
        [0.741388, 0.873449, 0.149561],
        [0.993248, 0.906157, 0.143936],
    ],
    dtype=np.float64,
)


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png_rgba(path: Path, rgba: np.ndarray) -> None:
    h, w = int(rgba.shape[0]), int(rgba.shape[1])
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, 9))
        + _png_chunk(b"IEND", b"")
    )


def viridis_rgb(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    x = t * (_VIRIDIS.shape[0] - 1)
    i = np.minimum(x.astype(np.int32), _VIRIDIS.shape[0] - 2)
    f = (x - i)[..., None]
    return _VIRIDIS[i] * (1.0 - f) + _VIRIDIS[i + 1] * f


def write_heatmap_thumb(
    xs: np.ndarray,
    ys: np.ndarray,
    Z: np.ndarray,
    path: Path,
    size: int = 256,
    origin_xy: tuple[float, float] = (0.0, 0.0),
    z_floor: float = 0.05,
) -> None:
    """Top-down viridis height heatmap from the 0.25 mm raster.

    Transparent outside the occupied footprint. +Y (toe) is up. The red + marks
    the placement origin (footprint centroid after import centering).
    """
    occ = np.isfinite(Z) & (Z > z_floor)
    if not np.any(occ):
        raise SystemExit("height field has no occupied cells for thumbnail")
    ji = np.argwhere(occ)
    j0, i0 = ji.min(0)
    j1, i1 = ji.max(0)
    pad = 4
    i0 = max(0, int(i0) - pad)
    i1 = min(len(xs) - 1, int(i1) + pad)
    j0 = max(0, int(j0) - pad)
    j1 = min(len(ys) - 1, int(j1) + pad)
    xmin, xmax = float(xs[i0] - H / 2), float(xs[i1] + H / 2)
    ymin, ymax = float(ys[j0] - H / 2), float(ys[j1] + H / 2)
    span_x, span_y = max(xmax - xmin, H), max(ymax - ymin, H)
    if span_y >= span_x:
        h = int(size)
        w = max(32, int(round(size * span_x / span_y)))
    else:
        w = int(size)
        h = max(32, int(round(size * span_y / span_x)))
    # Pixel centres in authored XY; image +Y (toe) is up.
    px = xmin + (np.arange(w) + 0.5) * span_x / w
    py = ymax - (np.arange(h) + 0.5) * span_y / h
    XX, YY = np.meshgrid(px, py)
    ix = (XX - xs[0]) / H
    iy = (YY - ys[0]) / H
    i_lo = np.clip(np.floor(ix).astype(np.int32), 0, len(xs) - 2)
    j_lo = np.clip(np.floor(iy).astype(np.int32), 0, len(ys) - 2)
    fx = np.clip(ix - i_lo, 0.0, 1.0)
    fy = np.clip(iy - j_lo, 0.0, 1.0)
    z00 = Z[j_lo, i_lo]
    z10 = Z[j_lo, i_lo + 1]
    z01 = Z[j_lo + 1, i_lo]
    z11 = Z[j_lo + 1, i_lo + 1]
    valid = np.isfinite(z00) & np.isfinite(z10) & np.isfinite(z01) & np.isfinite(z11)
    z00s = np.where(np.isfinite(z00), z00, 0.0)
    z10s = np.where(np.isfinite(z10), z10, 0.0)
    z01s = np.where(np.isfinite(z01), z01, 0.0)
    z11s = np.where(np.isfinite(z11), z11, 0.0)
    z_samp = np.where(
        valid,
        (1 - fx) * (1 - fy) * z00s + fx * (1 - fy) * z10s + (1 - fx) * fy * z01s + fx * fy * z11s,
        -np.inf,
    )
    mask = valid & (z_samp > z_floor)
    zmax = float(np.nanmax(Z[occ]))
    t = np.where(mask, np.clip(z_samp / max(zmax, 1e-6), 0.0, 1.0), 0.0)
    rgb = viridis_rgb(t)
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = np.where(mask[..., None], np.clip(np.round(rgb * 255.0), 0, 255), 0).astype(np.uint8)
    rgba[..., 3] = np.where(mask, 255, 0).astype(np.uint8)

    ox, oy = origin_xy
    cx = int(round((ox - xmin) / span_x * w - 0.5))
    cy = int(round((ymax - oy) / span_y * h - 0.5))
    _draw_red_plus(rgba, cx, cy)
    write_png_rgba(path, rgba)


def _draw_red_plus(rgba: np.ndarray, cx: int, cy: int, arm: int = 5, half: int = 0) -> None:
    h, w = rgba.shape[:2]
    ink = np.array([220, 38, 38, 255], dtype=np.uint8)
    outline = np.array([80, 10, 20, 255], dtype=np.uint8)

    def put(x: int, y: int, color: np.ndarray) -> None:
        if 0 <= x < w and 0 <= y < h:
            rgba[y, x] = color

    for dx in range(-arm - 1, arm + 2):
        for t in range(-half - 1, half + 2):
            put(cx + dx, cy + t, outline)
    for dy in range(-arm - 1, arm + 2):
        for t in range(-half - 1, half + 2):
            put(cx + t, cy + dy, outline)
    for dx in range(-arm, arm + 1):
        for t in range(-half, half + 1):
            put(cx + dx, cy + t, ink)
    for dy in range(-arm, arm + 1):
        for t in range(-half, half + 1):
            put(cx + t, cy + dy, ink)


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

    u = 0.5473
    v = 0.0722
    ref_size = 260.0
    ref_measured = 271.93
    ref_top = Path(args.ref_top)
    if ref_top.exists():
        ref = trimesh.load(str(ref_top)).to_geometry()
        R = ref.vertices.copy()
        R[:, 0] *= -1
        ymin, ymax = float(R[:, 1].min()), float(R[:, 1].max())
        # Kendon 260 mm basis: u = distance-from-heel / 260, not / measured length.
        u = (cy - ymin) / ref_size
        s = R[np.abs(R[:, 1] - cy) < 2]
        xl, xh = float(s[:, 0].min()), float(s[:, 0].max())
        mid = (xl + xh) / 2
        hw = (xh - xl) / 2
        v = (cx - mid) / hw
        ref_measured = ymax - ymin

    N = m.vertices.copy()
    N[:, 0] -= cx
    N[:, 1] -= cy
    N[:, 2] = np.maximum(N[:, 2], 0)
    N[N[:, 2] < 0.05, 2] = 0
    nm = trimesh.Trimesh(N, m.faces, process=False)
    glb_name = f"{args.id.replace('-', '_')}.right.glb" if args.side.upper() == "RIGHT" else f"{args.id}.glb"
    glb_path = out / glb_name
    nm.export(str(glb_path))
    xs2, ys2, Z2 = raster(N, m.faces)
    thumb_name = f"{args.id.replace('-', '_')}_thumb.png"
    thumb_path = out / thumb_name
    write_heatmap_thumb(xs2, ys2, Z2, thumb_path)

    sha = hashlib.sha256(src.read_bytes()).hexdigest()
    sidecar = {
        "kind": args.kind,
        "label": args.label,
        "nominalPeakMm": round(float(pk[2]), 2),
        "refSizeMm": 260,
        "anchor": {"u": round(float(u), 4), "v": round(float(v), 4)},
        "defaultAnchorU": round(float(u), 4),
        "defaultAnchorV": round(float(v), 4),
        "anchorConvention": "u heel0->toe1 over 260 mm refSizeMm; v=(x-mid)/halfwidth at anchor Y, medial +",
        "authoredSide": args.side.lower(),
        "footprintMm": {"w": round(bb[1] - bb[0], 2), "l": round(bb[3] - bb[2], 2), "area": round(area, 1)},
        "featherMm": 2,
        "rotationDeg": 0,
        "category": "add",
        "defaultPlacementMode": "flow",
        "frame": "repo-right (+X medial, +Y toe, Z up)",
        "refMeasuredLengthMm": round(float(ref_measured), 2),
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
    entry = {
        "id": args.id,
        "kind": args.kind,
        "label": args.label,
        "glb": glb_name,
        "sidecar": side_path.name,
        "thumb": thumb_name,
    }
    index["elements"] = [e for e in index.get("elements", []) if e.get("id") != args.id] + [entry]
    index_path.write_text(json.dumps(index, indent=4) + "\n")
    print(json.dumps({"glb": str(glb_path), "sidecar": str(side_path), "thumb": str(thumb_path), **sidecar}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
