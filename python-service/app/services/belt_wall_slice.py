# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Belt-aware wall / racetrack slicing for the hybrid pipeline.

After belt_transformer shears the solid, planar layers still need Vertex belt SOP
behaviour: belt-plane edge pinning, thin-shell racetrack fusion, and proper
winding-aware insets (not centroid shortcuts). Port of vertex belt-slice.ts.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import trimesh

from app.services.belt_stitch import (
    BeltShellPair,
    classify_belt_rings,
    point_in_poly,
    signed_area,
    stitch_belt_loops,
)
from app.services.planar_mesh import (
    Pt,
    Seg,
    edge_normal,
    extract_triangles,
    infill_segments,
    slice_layer_segments,
)

BELT_ON_EPS = 1e-6
NEAR = 1e-4
RIBBON_WIDTH_BEADS = 2


def slice_belt_layer_contours(
    mesh: trimesh.Trimesh,
    z: float,
    *,
    belt_gantry_angle_deg: float,
    perimeters: int,
    extrusion_width_mm: float,
    infill_density: float,
    layer_index: int,
    include_infill: bool,
) -> tuple[list[np.ndarray], list[np.ndarray]]:
    """Return (wall_contours, infill_lines) for one layer in belt-transformed space."""
    tris = extract_triangles(mesh)
    segs = slice_layer_segments(tris, z)
    if not segs:
        return [], []

    tan = math.tan(math.radians(belt_gantry_angle_deg))
    belt_y = z / tan if abs(tan) > 1e-12 else 0.0
    w = extrusion_width_mm
    stitched = stitch_belt_loops(segs, belt_y=belt_y)

    wall_paths: list[list[Pt]] = []
    infill: list[np.ndarray] = []

    thin_pairs = [p for p in stitched.shell_pairs if shell_pair_width_mm(p) <= RIBBON_WIDTH_BEADS * w]
    for pair in thin_pairs:
        _emit_shell_pair(wall_paths, pair, belt_y, w, perimeters)

    loops = classify_belt_rings(
        [clip_loop_to_belt(loop, belt_y) for loop in stitched.closed if len(loop) >= 3]
    )
    loops = [r for r in loops if len(r.loop) >= 3]

    if not loops:
        for chain in stitched.open:
            poly = clip_open_to_belt(chain, belt_y)
            if len(poly) >= 2:
                wall_paths.append(poly)
    else:
        for ring_info in loops:
            loop = ring_info.loop
            ring = clip_loop_to_belt(inset_loop(loop, w / 2.0, belt_y), belt_y)
            if len(ring) < 3:
                continue
            wall_paths.append(ring)
            for p in range(1, perimeters):
                nxt = try_inset(ring, w, belt_y)
                if nxt:
                    ring = nxt
                    wall_paths.append(ring)
                    continue
                pair = stitched.shell_pairs[0] if stitched.shell_pairs else None
                if not pair or shell_pair_width_mm(pair) <= RIBBON_WIDTH_BEADS * w:
                    break
                open_inner = shell_pair_inner(pair, w / 2.0 + p * w, belt_y)
                if len(open_inner) >= 2:
                    wall_paths.append(open_inner)
                break

    spacing = w / max(0.05, min(1.0, infill_density))
    if include_infill and infill_density > 0 and loops:
        infill_loops: list[list[Pt]] = []
        for ring_info in loops:
            ring = clip_loop_to_belt(inset_loop(ring_info.loop, w / 2.0, belt_y), belt_y)
            for p in range(1, perimeters):
                nxt = try_inset(ring, w, belt_y)
                if not nxt:
                    ring = []
                    break
                ring = nxt
            if len(ring) >= 3:
                inner = try_inset(ring, w / 2.0, belt_y)
                if inner:
                    infill_loops.append(inner)
        fill = infill_segments(infill_loops, spacing, layer_index % 2 == 0)
        infill = [np.array([a, b], dtype=np.float64) for a, b in fill]

    walls = [np.array(p, dtype=np.float64) for p in wall_paths if len(p) >= 2]
    return walls, infill


def inset_loop(loop: list[Pt], d: float, belt_y: float | None = None) -> list[Pt]:
    ring = closed_ring(loop)
    n = len(ring)
    if n < 3:
        return ring[:]
    sign = 1 if signed_area(ring) >= 0 else -1
    probe = edge_normal(ring[0], ring[1])
    mid: Pt = (
        (ring[0][0] + ring[1][0]) / 2 + probe[0] * sign * 1e-3,
        (ring[0][1] + ring[1][1]) / 2 + probe[1] * sign * 1e-3,
    )
    if not point_in_poly(ring, mid):
        sign = -sign

    lines: list[tuple[Pt, Pt]] = []
    for i in range(n):
        a = ring[i]
        b = ring[(i + 1) % n]
        nn = edge_normal(a, b)
        on_belt = (
            belt_y is not None
            and abs(a[1] - belt_y) <= BELT_ON_EPS
            and abs(b[1] - belt_y) <= BELT_ON_EPS
        )
        dist = 0.0 if on_belt else d * sign
        lines.append(((a[0] + nn[0] * dist, a[1] + nn[1] * dist), (b[0] - a[0], b[1] - a[1])))

    out: list[Pt] = []
    miter = max(4 * d, 1e-3)
    for i in range(n):
        prev_p, prev_d = lines[(i - 1 + n) % n]
        cur_p, cur_d = lines[i]
        hit = intersect_lines(prev_p, prev_d, cur_p, cur_d)
        if hit and math.hypot(hit[0] - ring[i][0], hit[1] - ring[i][1]) <= miter:
            out.append(hit)
        else:
            out.append((cur_p[0], cur_p[1]))
    return closed_ring(out)


def try_inset(ring: list[Pt], d: float, belt_y: float) -> list[Pt] | None:
    nxt = inset_loop(ring, d)
    if len(nxt) < 3:
        return None
    if signed_area(nxt) * signed_area(ring) <= 0:
        return None
    if any(p[1] > belt_y + BELT_ON_EPS for p in nxt):
        return None
    clamp_to(nxt, aabb_of(ring))
    return nxt


def shell_pair_width_mm(pair: BeltShellPair) -> float:
    samples: list[float] = []
    step = max(1, len(pair.a) // 40)
    for i in range(0, len(pair.a), step):
        samples.append(dist_to_polyline(pair.a[i], pair.b))
    if not samples:
        return 0.0
    samples.sort()
    return samples[len(samples) // 2]


def clip_loop_to_belt(loop: list[Pt], belt_y: float) -> list[Pt]:
    pts = closed_ring(loop)
    if len(pts) < 3:
        return []

    def inside(p: Pt) -> bool:
        return p[1] <= belt_y + BELT_ON_EPS

    out: list[Pt] = []
    for i in range(len(pts)):
        s = pts[i]
        e = pts[(i + 1) % len(pts)]
        s_in, e_in = inside(s), inside(e)
        if e_in:
            if not s_in:
                out.append(intersect_belt(s, e, belt_y))
            out.append(e)
        elif s_in:
            out.append(intersect_belt(s, e, belt_y))
    return closed_ring(out)


def clip_open_to_belt(chain: list[Pt], belt_y: float) -> list[Pt]:
    if not chain:
        return []

    def inside(p: Pt) -> bool:
        return p[1] <= belt_y + 1e-6

    out: list[Pt] = []
    for i in range(len(chain) - 1):
        s, e = chain[i], chain[i + 1]
        s_in, e_in = inside(s), inside(e)
        if s_in and not out:
            out.append(s)
        if s_in and e_in:
            out.append(e)
        elif s_in and not e_in:
            out.append(intersect_belt(s, e, belt_y))
        elif not s_in and e_in:
            out.append(intersect_belt(s, e, belt_y))
            out.append(e)
    return out


def _emit_shell_pair(
    wall_paths: list[list[Pt]],
    pair: BeltShellPair,
    belt_y: float,
    w: float,
    perimeters: int,
) -> None:
    a_on = any(abs(p[1] - belt_y) <= BELT_ON_EPS for p in pair.a)
    b_on = any(abs(p[1] - belt_y) <= BELT_ON_EPS for p in pair.b)
    outer = (
        pair.a
        if (a_on == b_on and x_span(pair.a) >= x_span(pair.b))
        or (a_on and not b_on)
        else pair.b
    )
    other = pair.b if outer is pair.a else pair.a
    width = shell_pair_width_mm(pair)
    ring = clip_open_to_belt(offset_open_toward(outer, w / 2.0, other, belt_y), belt_y)
    if len(ring) < 2:
        return
    wall_paths.append(ring)
    if width <= RIBBON_WIDTH_BEADS * w:
        return
    for p in range(1, perimeters):
        nxt = clip_open_to_belt(offset_open_toward(outer, w / 2.0 + p * w, other), belt_y)
        if len(nxt) < 2:
            break
        wall_paths.append(nxt)


def offset_open_toward(chain: list[Pt], d: float, toward: list[Pt], belt_y: float | None = None) -> list[Pt]:
    if len(chain) < 2:
        return chain[:]
    out: list[Pt] = []
    for i in range(len(chain)):
        prev = chain[max(0, i - 1)]
        cur = chain[i]
        nxt = chain[min(len(chain) - 1, i + 1)]
        n1 = edge_normal(cur, nxt) if i == 0 else edge_normal(prev, cur)
        n2 = n1 if i == len(chain) - 1 else edge_normal(cur, nxt)
        nx = n1[0] + n2[0]
        ny = n1[1] + n2[1]
        length = math.hypot(nx, ny) or 1.0
        nx /= length
        ny /= length
        q = nearest_on_polyline(cur, toward)
        if nx * (q[0] - cur[0]) + ny * (q[1] - cur[1]) < 0:
            nx, ny = -nx, -ny
        on_belt = belt_y is not None and abs(cur[1] - belt_y) <= BELT_ON_EPS
        dist = 0.0 if on_belt else d
        out.append((cur[0] + nx * dist, cur[1] + ny * dist))
    return out


def shell_pair_inner(pair: BeltShellPair, d: float, belt_y: float) -> list[Pt]:
    a_on = any(abs(p[1] - belt_y) <= BELT_ON_EPS for p in pair.a)
    b_on = any(abs(p[1] - belt_y) <= BELT_ON_EPS for p in pair.b)
    outer = (
        pair.a
        if (a_on == b_on and x_span(pair.a) >= x_span(pair.b))
        or (a_on and not b_on)
        else pair.b
    )
    other = pair.b if outer is pair.a else pair.a
    return clip_open_to_belt(offset_open_toward(outer, d, other), belt_y)


def closed_ring(loop: list[Pt]) -> list[Pt]:
    pts: list[Pt] = []
    for p in loop:
        if pts and _near(pts[-1], p):
            continue
        pts.append(p)
    if len(pts) >= 2 and _near(pts[0], pts[-1]):
        pts.pop()
    return pts


def intersect_belt(s: Pt, e: Pt, belt_y: float) -> Pt:
    dy = e[1] - s[1]
    t = 0.0 if abs(dy) < 1e-12 else (belt_y - s[1]) / dy
    return (s[0] + (e[0] - s[0]) * t, belt_y)


def intersect_lines(p1: Pt, d1: Pt, p2: Pt, d2: Pt) -> Pt | None:
    cross = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(cross) < 1e-12:
        return None
    t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / cross
    return (p1[0] + t * d1[0], p1[1] + t * d1[1])


def aabb_of(loop: list[Pt]) -> dict[str, float]:
    xs = [p[0] for p in loop]
    ys = [p[1] for p in loop]
    return {"minX": min(xs), "maxX": max(xs), "minY": min(ys), "maxY": max(ys)}


def clamp_to(loop: list[Pt], box: dict[str, float]) -> None:
    for i in range(len(loop)):
        x, y = loop[i]
        if x < box["minX"]:
            x = box["minX"]
        if x > box["maxX"]:
            x = box["maxX"]
        if y < box["minY"]:
            y = box["minY"]
        if y > box["maxY"]:
            y = box["maxY"]
        loop[i] = (x, y)


def x_span(chain: list[Pt]) -> float:
    return max(p[0] for p in chain) - min(p[0] for p in chain)


def dist_to_polyline(p: Pt, chain: list[Pt]) -> float:
    if not chain:
        return float("inf")
    if len(chain) == 1:
        return math.hypot(p[0] - chain[0][0], p[1] - chain[0][1])
    best = float("inf")
    for i in range(len(chain) - 1):
        best = min(best, dist_to_seg(p, chain[i], chain[i + 1]))
    return best


def nearest_on_polyline(p: Pt, chain: list[Pt]) -> Pt:
    if not chain:
        return p
    if len(chain) == 1:
        return chain[0]
    best = chain[0]
    best_d = float("inf")
    for i in range(len(chain) - 1):
        q = project_on_seg(p, chain[i], chain[i + 1])
        d = math.hypot(p[0] - q[0], p[1] - q[1])
        if d < best_d:
            best_d = d
            best = q
    return best


def project_on_seg(p: Pt, a: Pt, b: Pt) -> Pt:
    dx = b[0] - a[0]
    dy = b[1] - a[1]
    den = dx * dx + dy * dy
    if den < 1e-24:
        return a
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / den))
    return (a[0] + t * dx, a[1] + t * dy)


def dist_to_seg(p: Pt, a: Pt, b: Pt) -> float:
    q = project_on_seg(p, a, b)
    return math.hypot(p[0] - q[0], p[1] - q[1])


def _near(a: Pt, b: Pt) -> bool:
    return abs(a[0] - b[0]) < NEAR and abs(a[1] - b[1]) < NEAR
