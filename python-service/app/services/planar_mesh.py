# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""Planar mesh intersection helpers (port of vertex/src/lib/kiri/slicer.ts)."""

from __future__ import annotations

import math
from typing import NamedTuple

import numpy as np
import trimesh

from app.services.belt_stitch import Pt, Seg

_EPS = 1e-4


class Tri(NamedTuple):
    ax: float
    ay: float
    az: float
    bx: float
    by: float
    bz: float
    cx: float
    cy: float
    cz: float


def extract_triangles(mesh: trimesh.Trimesh) -> list[Tri]:
    v = mesh.vertices
    out: list[Tri] = []
    for a, b, c in mesh.faces:
        out.append(
            Tri(
                float(v[a][0]),
                float(v[a][1]),
                float(v[a][2]),
                float(v[b][0]),
                float(v[b][1]),
                float(v[b][2]),
                float(v[c][0]),
                float(v[c][1]),
                float(v[c][2]),
            )
        )
    return out


def slice_layer_segments(tris: list[Tri], z: float) -> list[Seg]:
    segs: list[Seg] = []
    for t in tris:
        pts: list[Pt] = []
        edges = (
            (t.ax, t.ay, t.az, t.bx, t.by, t.bz),
            (t.bx, t.by, t.bz, t.cx, t.cy, t.cz),
            (t.cx, t.cy, t.cz, t.ax, t.ay, t.az),
        )
        for x0, y0, z0, x1, y1, z1 in edges:
            d0 = z0 - z
            d1 = z1 - z
            if (d0 < 0 and d1 >= 0) or (d1 < 0 and d0 >= 0):
                s = d0 / (d0 - d1) if d0 != d1 else 0.0
                pts.append((x0 + (x1 - x0) * s, y0 + (y1 - y0) * s))
        if len(pts) == 2:
            segs.append((pts[0], pts[1]))
    return segs


def edge_normal(a: Pt, b: Pt) -> Pt:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    length = math.hypot(dx, dy) or 1.0
    return (-dy / length, dx / length)


def offset_loop(loop: list[Pt], d: float) -> list[Pt]:
    n = len(loop)
    out: list[Pt] = []
    for i in range(n):
        prev = loop[(i - 1 + n) % n]
        cur = loop[i]
        nxt = loop[(i + 1) % n]
        n1 = edge_normal(prev, cur)
        n2 = edge_normal(cur, nxt)
        nx = n1[0] + n2[0]
        ny = n1[1] + n2[1]
        length = math.hypot(nx, ny) or 1.0
        nx /= length
        ny /= length
        out.append((cur[0] + nx * d, cur[1] + ny * d))
    return out


def infill_segments(loops: list[list[Pt]], spacing: float, vertical: bool) -> list[Seg]:
    min_v = float("inf")
    max_v = -float("inf")
    for loop in loops:
        for p in loop:
            v = p[0] if vertical else p[1]
            min_v = min(min_v, v)
            max_v = max(max_v, v)
    if not math.isfinite(min_v):
        return []

    out: list[Seg] = []
    line = min_v + spacing
    while line < max_v:
        xs: list[float] = []
        for loop in loops:
            for i in range(len(loop)):
                a = loop[i]
                b = loop[(i + 1) % len(loop)]
                av = a[0] if vertical else a[1]
                bv = b[0] if vertical else b[1]
                if (av <= line and bv > line) or (bv <= line and av > line):
                    s = (line - av) / (bv - av) if bv != av else 0.0
                    cross = a[1] + (b[1] - a[1]) * s if vertical else a[0] + (b[0] - a[0]) * s
                    xs.append(cross)
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            if vertical:
                out.append(((line, xs[i]), (line, xs[i + 1])))
            else:
                out.append(((xs[i], line), (xs[i + 1], line)))
        line += spacing
    return out


def loops_to_ndarray(contours: list[list[Pt]]) -> list[np.ndarray]:
    return [np.array(c, dtype=np.float64) for c in contours if len(c) >= 2]
