# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Geometry utilities for Phase 1 hybrid manufacturing pipeline.

This module re-derives the clinical height field (from vertex/src/lib/geometry/height-field.ts,
heel-lift.ts, wedge.ts, trimline.ts) so corrections applied to a "Top" mesh are semantically
equivalent. It also provides robust boundary extraction, 2D trimline clipping (port of
clipGeometryToOutline + pointInPolygon), resampling, ruled/rounded sidewall generation,
and watertight repair helpers.

All units in mm. Coordinate convention for input GLBs (per spec):
- +Z up (thickness)
- Heel toward negative Y (length runs along Y, increasing Y = heel -> toe)
- X = width (medial/lateral)
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import trimesh

# ---------------------------------------------------------------------------
# Low-level math ports (bump, smoothstep, softFloor, heel lift, outline)
# ---------------------------------------------------------------------------

def bump(t: float, c: float, r: float) -> float:
    """Smooth bump centered at c with radius r. Returns 0..1 (cosine)."""
    d = abs(t - c) / r if r > 0 else 1.0
    if d >= 1.0:
        return 0.0
    return 0.5 * (1.0 + math.cos(math.pi * d))


def smoothstep(e0: float, e1: float, x: float) -> float:
    """Hermite smoothstep (C1). e0 may be > e1 to invert."""
    if e0 == e1:
        return 0.0 if x < e0 else 1.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def soft_floor(value: float, floor: float, smoothing: float = 0.6) -> float:
    """Smooth lower bound. Keeps C1 continuity near the floor."""
    if smoothing <= 0:
        return max(value, floor)
    h = max(smoothing - abs(value - floor), 0.0) / smoothing
    return max(value, floor) + h * h * smoothing * 0.25


def heel_lift_delta_at(u: float, heel_lift_mm: float) -> float:
    """Linear ramp heel lift (full at u=0, zero at and beyond 0.75)."""
    if heel_lift_mm <= 0:
        return 0.0
    HEEL_LIFT_TAPER_END = 0.75
    t = max(0.0, min(1.0, 1.0 - u / HEEL_LIFT_TAPER_END))
    return heel_lift_mm * t


def outline_half_width(u: float) -> float:
    """Default parametric outline half-width factor (0..1) at u (heel=0, toe=1)."""
    heel = 0.55 + 0.25 * bump(u, 0.08, 0.18)
    waist = 0.78 + 0.18 * math.sin(math.pi * min(1.0, u * 1.05))
    toe = max(0.45, 1.0 - (u - 0.88) / 0.12) if u > 0.88 else 1.0
    return min(1.0, heel * waist) * (0.4 + 0.6 * toe)


def trimline_half_width_at_u(u: float, curve_points: list[dict[str, float]],
                             length_mm: float, width_mm: float) -> float:
    """Port of trimlineHalfWidthAtU. curve_points are [{"x": len, "y": wid}, ...]."""
    if not curve_points or length_mm <= 0:
        return outline_half_width(u)
    half_w = width_mm / 2.0
    x = u * length_mm
    tol = length_mm / 32.0
    max_abs_y = 0.0
    found = False
    for p in curve_points:
        if abs(p.get("x", 0.0) - x) <= tol:
            max_abs_y = max(max_abs_y, abs(p.get("y", 0.0)))
            found = True
    if not found:
        return outline_half_width(u)
    return max(0.15, max_abs_y / half_w)


def effective_outline_half_width(u: float, length_mm: float, width_mm: float,
                                  trimline_points: list[dict[str, float]] | None) -> float:
    """Port of effectiveOutlineHalfWidth (uses custom trimline when present)."""
    if trimline_points and len(trimline_points) >= 4:
        return trimline_half_width_at_u(u, trimline_points, length_mm, width_mm)
    return outline_half_width(u)


# ---------------------------------------------------------------------------
# Wedge (rearfoot/forefoot medial/lateral) port
# ---------------------------------------------------------------------------

def _get_rearfoot_factor(u: float) -> float:
    return 1.0 - smoothstep(0.3, 0.45, u)


def _get_forefoot_factor(u: float) -> float:
    return smoothstep(0.55, 0.7, u)


def wedge_delta_at(u: float, v_signed: float, side: str, corrections: dict[str, Any],
                   length_mm: float, width_mm: float,
                   trimline_points: list[dict[str, float]] | None) -> float:
    """Port of wedgeDeltaAt + zoneWedgeDelta. Supports mm and deg units."""
    d = 0.0
    for zone_key, zone_name in [("rearfootWedge", "rearfoot"), ("forefootWedge", "forefoot")]:
        wedge = corrections.get(zone_key)
        if not wedge:
            continue
        zone_factor = _get_rearfoot_factor(u) if zone_name == "rearfoot" else _get_forefoot_factor(u)
        if zone_factor <= 0:
            continue

        half_width_factor = effective_outline_half_width(u, length_mm, width_mm, trimline_points)
        local_full_width = 2.0 * half_width_factor * (width_mm / 2.0)

        if local_full_width <= 0 and wedge.get("unit") == "deg":
            continue

        if wedge.get("unit") == "mm":
            max_raise = max(0.0, float(wedge.get("value", 0.0)))
        else:
            deg = max(0.0, min(45.0, float(wedge.get("value", 0.0))))
            max_raise = local_full_width * math.tan(math.radians(deg))

        medial_sign = -1.0 if side == "left" else 1.0
        v_clamped = max(-1.0, min(1.0, v_signed))
        m = -(v_clamped * medial_sign)
        cross = max(0.0, min(1.0, (1.0 - m) / 2.0))

        is_medial = str(wedge.get("side", "medial")).lower() == "medial"
        taper = (1.0 - cross) if is_medial else cross

        d += max_raise * taper * zone_factor
    return d


# ---------------------------------------------------------------------------
# Full clinical top height (heightAt port)
# Baseline anatomical + all corrections, feather, posting, wedges, heel lift.
# Bottom is always ~0 by design (caller keeps Bottom verts stable).
# ---------------------------------------------------------------------------

def compute_top_height(
    u: float,
    v_signed: float,
    corrections: dict[str, Any],
    length_mm: float,
    width_mm: float,
    thickness_mm: float,
    heel_lift_mm: float = 0.0,
    heel_cup_width_mm: float = 0.0,
    side: str = "left",
) -> float:
    """Re-derived heightAt(u, vSigned, ...). Returns top z (mm)."""
    half_w = width_mm / 2.0
    medial_sign = -1.0 if side == "left" else 1.0
    av = abs(v_signed)
    m = -(v_signed * medial_sign)
    medial_blend = smoothstep(-0.2, 0.45, m)
    lateral_blend = smoothstep(-0.2, 0.45, -m)

    # Merge caller-provided special fields into corrections for unified access
    c = dict(corrections)  # shallow copy
    c["heelCupWidthMm"] = heel_cup_width_mm
    c["heelLiftMm"] = heel_lift_mm

    # --- Baseline anatomical shell (vacuum-formed dish + rims) ---
    heel_env = smoothstep(0.26, 0.04, u)
    arch_env = bump(u, 0.4, 0.32)
    toe_env = smoothstep(0.7, 1.0, u)
    dish = smoothstep(0.12, 1.0, av)
    medial_rim = 12.0 * heel_env + 16.0 * arch_env
    lateral_rim = 12.0 * heel_env + 5.0 * arch_env
    baseline = dish * (medial_rim * medial_blend + lateral_rim * lateral_blend) + 4.0 * toe_env

    shaped = 0.0

    # Arch dome + fill
    apex_center = 0.42 + float(c.get("apexMoveMm", 0.0)) / max(length_mm, 1.0)
    arch = bump(u, apex_center, 0.36)
    arch_across = medial_blend * (0.45 + 0.55 * smoothstep(0.05, 0.9, av))
    shaped += (float(c.get("archHeightMm", 0.0)) + float(c.get("archFillMm", 0.0))) * arch * arch_across

    heel = bump(u, 0.1, 0.18)

    # Heel cup (true U: medial + posterior + lateral walls + floor relief)
    # width tightens the cup (higher value -> walls move inboard + independent raise)
    rim = smoothstep(0.18, 0.95, av)
    shaped += float(c.get("heelCupHeightMm", 0.0)) * heel * rim

    width_frac = max(0.0, min(1.0, heel_cup_width_mm / 10.0))
    wall_inner = 0.55 - 0.3 * width_frac
    side_wall = smoothstep(wall_inner, 0.92, av)
    shaped += float(c.get("heelCupDepthMm", 0.0)) * heel * side_wall * 0.65
    shaped += heel_cup_width_mm * heel * side_wall * 0.35

    # Posterior wall (back lip of U)
    posterior = smoothstep(0.07, 0.0, u) * (1.0 - smoothstep(0.7, 0.95, av))
    shaped += float(c.get("heelCupDepthMm", 0.0)) * posterior * 0.85

    # Cup floor relief (deeper seat)
    floor_seat = bump(u, 0.13, 0.12)
    floor_center = 1.0 - smoothstep(0.35, 0.75, av)
    shaped -= float(c.get("heelCupDepthMm", 0.0)) * 0.35 * floor_seat * floor_center

    # Skives (subtractive, medial/lateral heel) — applied in field for this pipeline
    shaped -= float(c.get("medialSkiveMm", 0.0)) * heel * medial_blend * smoothstep(0.1, 0.85, av)
    shaped -= float(c.get("lateralSkiveMm", 0.0)) * heel * lateral_blend * smoothstep(0.1, 0.85, av)

    # Flanges (midfoot raised walls)
    edge = smoothstep(0.55, 1.0, av)
    flange_region = bump(u, 0.45, 0.42)
    shaped += (float(c.get("medialFlangeMm", 0.0)) * medial_blend +
               float(c.get("lateralFlangeMm", 0.0)) * lateral_blend) * flange_region * edge

    # Edge feathering (thins additive features at perimeter)
    edge_feather = smoothstep(1.0, 0.86, av)
    shaped *= 0.35 + 0.65 * edge_feather

    # Posting (planar tilt, full strength at edge, not feathered)
    post = v_signed * medial_sign * half_w
    posting = math.tan(math.radians(float(c.get("rearfootPostingDeg", 0.0)))) * post * heel
    fore = bump(u, 0.82, 0.24)
    posting += math.tan(math.radians(float(c.get("forefootPostingDeg", 0.0)))) * post * fore

    # Wedges (medial/lateral surface ramps)
    wedge = wedge_delta_at(u, v_signed, side, c, length_mm, width_mm, trimline_points=None)

    # Heel lift (full-width structural ramp, not feathered)
    heel_lift = heel_lift_delta_at(u, heel_lift_mm)

    h = soft_floor(thickness_mm + baseline + shaped + posting + wedge + heel_lift, 0.8)

    return float(h)


# ---------------------------------------------------------------------------
# 2D polygon helpers (port of pointInPolygonXY + inflation for clip)
# ---------------------------------------------------------------------------

def point_in_polygon(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    """Even-odd (ray casting) point-in-polygon test. Matches TS implementation."""
    inside = False
    n = len(poly)
    if n < 3:
        return False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def inflate_polygon(poly: list[tuple[float, float]], margin: float) -> list[tuple[float, float]]:
    """Inflate closed poly outward from its centroid (matches clipGeometryToOutline margin)."""
    if not poly or margin <= 0:
        return poly
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    out: list[tuple[float, float]] = []
    for px, py in poly:
        dx = px - cx
        dy = py - cy
        length = math.hypot(dx, dy) or 1.0
        k = (length + margin) / length
        out.append((cx + dx * k, cy + dy * k))
    return out


# ---------------------------------------------------------------------------
# Trimline parsing + length/width derivation + (u, v) mapping for a 3D point
# ---------------------------------------------------------------------------

def extract_trimline_points(trimlines: dict[str, Any]) -> list[dict[str, float]]:
    """Best-effort extraction of a list of {"x": length, "y": width} points.
    Supports {"points": [...]}, {"left": {"points": ...}}, or flat list under common keys.
    """
    candidates: list[Any] = []
    if isinstance(trimlines, dict):
        if "points" in trimlines:
            candidates.append(trimlines["points"])
        for key in ("left", "right", "curve", "trimline"):
            val = trimlines.get(key)
            if isinstance(val, dict) and "points" in val:
                candidates.append(val["points"])
            elif isinstance(val, list):
                candidates.append(val)
    elif isinstance(trimlines, list):
        candidates.append(trimlines)

    for cand in candidates:
        if isinstance(cand, list) and cand:
            pts: list[dict[str, float]] = []
            for p in cand:
                if isinstance(p, dict):
                    x = float(p.get("x", p.get("length", p.get("u", 0.0))))
                    y = float(p.get("y", p.get("width", p.get("v", 0.0))))
                    pts.append({"x": x, "y": y})
                elif isinstance(p, (list, tuple)) and len(p) >= 2:
                    pts.append({"x": float(p[0]), "y": float(p[1])})
            if len(pts) >= 3:
                return pts
    return []


def derive_length_width(trimline_points: list[dict[str, float]],
                        top_mesh: trimesh.Trimesh | None = None,
                        bottom_mesh: trimesh.Trimesh | None = None) -> tuple[float, float]:
    """Derive length (Y dir) and width (X dir) in mm from trimline or mesh bounds."""
    if trimline_points:
        xs = [p["x"] for p in trimline_points]
        ys = [p["y"] for p in trimline_points]
        l = max(xs) - min(xs) if xs else 0.0
        w = 2.0 * (max(abs(y) for y in ys) if ys else 0.0)
        if l > 1.0 and w > 1.0:
            return max(l, 1.0), max(w, 1.0)

    # Fallback to mesh (Y length per convention, X width)
    meshes = [m for m in (top_mesh, bottom_mesh) if m is not None]
    if not meshes:
        return 200.0, 80.0  # sensible default
    all_verts = np.vstack([m.vertices for m in meshes])
    y_min, y_max = all_verts[:, 1].min(), all_verts[:, 1].max()
    x_min, x_max = all_verts[:, 0].min(), all_verts[:, 0].max()
    l = max(y_max - y_min, 1.0)
    w = max(x_max - x_min, 1.0)
    return l, w


def vertex_to_uv(vertex: np.ndarray, length_mm: float, width_mm: float,
                 y_heel: float, trimline_points: list[dict[str, float]] | None) -> tuple[float, float]:
    """Map a 3D vertex (X=width, Y=length, Z=up) to normalized (u, v_signed)."""
    y = float(vertex[1])
    x = float(vertex[0])
    u = max(0.0, min(1.0, (y - y_heel) / max(length_mm, 1e-6)))

    # Local half-width factor from trimline (or default)
    hw_factor = effective_outline_half_width(u, length_mm, width_mm, trimline_points)
    local_half = hw_factor * (width_mm / 2.0)
    if local_half < 1e-3:
        v = 0.0
    else:
        v = x / local_half
    v = max(-1.0, min(1.0, v))
    return u, v


# ---------------------------------------------------------------------------
# Mesh clipping to trimline (XY footprint, port of clipGeometryToOutline)
# ---------------------------------------------------------------------------

def clip_mesh_to_trimline(mesh: trimesh.Trimesh,
                          trimline_points: list[dict[str, float]],
                          length_mm: float,
                          width_mm: float,
                          y_heel: float,
                          margin_mm: float = 1.5) -> trimesh.Trimesh:
    """Keep only triangles whose XY (Y=length, X=width) centroid is inside the (inflated) trimline.
    Returns a new mesh (may be non-manifold at the cut; repair happens at solid level).
    """
    if mesh is None or len(trimline_points) < 4:
        return mesh.copy() if mesh is not None else mesh

    # Build 2D poly in (length, width) == (mesh_y, mesh_x) space for test
    raw_poly: list[tuple[float, float]] = []
    for p in trimline_points:
        # trim "x" = length param (0 heel), "y" = width
        len_coord = p["x"]
        wid_coord = p["y"]
        mesh_y = y_heel + len_coord
        mesh_x = wid_coord
        raw_poly.append((mesh_y, mesh_x))

    poly = inflate_polygon(raw_poly, margin_mm)

    verts = mesh.vertices
    faces = mesh.faces
    kept: list[int] = []
    for f in faces:
        a, b, c = f
        mx = (verts[a, 0] + verts[b, 0] + verts[c, 0]) / 3.0   # width (X)
        my = (verts[a, 1] + verts[b, 1] + verts[c, 1]) / 3.0   # length (Y)
        if point_in_polygon(my, mx, poly):  # note order (len, wid) matches poly
            kept.extend([int(a), int(b), int(c)])

    if not kept:
        return mesh.copy()

    # Rebuild mesh while preserving triangle structure and sharing vertices via map.
    # kept is flat [a0,b0,c0, a1,b1,c1, ...] — groups of 3 per original kept triangle.
    new_positions: list[float] = []
    new_faces: list[list[int]] = []
    idx_map: dict[int, int] = {}
    for i in range(0, len(kept), 3):
        tri_old = kept[i:i + 3]
        if len(tri_old) != 3:
            continue
        tri_new = []
        for old in tri_old:
            if old not in idx_map:
                idx_map[old] = len(new_positions) // 3
                new_positions.extend(verts[old])
            tri_new.append(idx_map[old])
        new_faces.append(tri_new)

    if not new_faces:
        return mesh.copy()

    new_verts = np.array(new_positions, dtype=np.float64).reshape(-1, 3)
    new_f = np.array(new_faces, dtype=np.int64)
    clipped = trimesh.Trimesh(vertices=new_verts, faces=new_f, process=False)
    # Normals are best-effort (may need scipy in some trimesh versions); final solid repairs anyway.
    try:
        clipped.fix_normals()
    except Exception:
        pass
    return clipped


# ---------------------------------------------------------------------------
# Boundary extraction + resampling (for sidewall generation)
# ---------------------------------------------------------------------------

def extract_boundary_loop(mesh: trimesh.Trimesh) -> np.ndarray | None:
    """Extract the largest closed outer boundary loop as (N, 3) array.
    Uses face-adjacency boundary edge walk. Prefers longest loop.
    """
    if mesh is None or len(mesh.faces) == 0:
        return None

    # Build edge -> face count
    edge_count: dict[tuple[int, int], int] = {}
    for f in mesh.faces:
        for e in [(f[0], f[1]), (f[1], f[2]), (f[2], f[0])]:
            e_sorted = tuple(sorted(e))
            edge_count[e_sorted] = edge_count.get(e_sorted, 0) + 1

    boundary_edges = [e for e, cnt in edge_count.items() if cnt == 1]
    if not boundary_edges:
        return None

    adj: dict[int, list[int]] = {}
    for a, b in boundary_edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    loops: list[np.ndarray] = []
    visited: set[int] = set()
    for start in list(adj.keys()):
        if start in visited:
            continue
        # Walk cycle
        path: list[int] = [start]
        visited.add(start)
        prev = start
        curr = adj[start][0] if adj[start] else start
        while curr != start and curr not in visited:
            path.append(curr)
            visited.add(curr)
            candidates = [n for n in adj.get(curr, []) if n != prev]
            if not candidates:
                break
            prev = curr
            curr = candidates[0]
        if len(path) >= 4:
            loop_verts = mesh.vertices[path]
            # Ensure closed
            if not np.allclose(loop_verts[0], loop_verts[-1]):
                loop_verts = np.vstack([loop_verts, loop_verts[0]])
            loops.append(loop_verts)

    if not loops:
        return None
    # Largest by vertex count (good proxy for main outer perimeter)
    main = max(loops, key=lambda arr: len(arr))
    return main


def resample_closed_polyline(pts: np.ndarray, n: int) -> np.ndarray:
    """Resample a closed polyline (N,3) to exactly n points using arc-length."""
    if len(pts) < 2 or n < 2:
        return pts
    # Make sure closed
    if not np.allclose(pts[0], pts[-1]):
        pts = np.vstack([pts, pts[0]])
    diffs = np.diff(pts, axis=0)
    seg_len = np.linalg.norm(diffs, axis=1)
    cum_len = np.concatenate([[0.0], np.cumsum(seg_len)])
    total = cum_len[-1]
    if total < 1e-9:
        return np.tile(pts[0:1], (n, 1))
    targets = np.linspace(0.0, total, n, endpoint=False)

    resampled = np.zeros((n, 3), dtype=np.float64)
    for dim in range(3):
        resampled[:, dim] = np.interp(targets, cum_len, pts[:, dim])
    return resampled


def compute_outward_normals_2d(pts: np.ndarray) -> np.ndarray:
    """Return (N, 2) outward unit normals for a closed 2D polyline (X=width, Y=length)."""
    n = len(pts)
    if n < 3:
        return np.zeros((n, 2))
    normals = np.zeros((n, 2))
    for i in range(n):
        p0 = pts[i - 1, :2]
        p1 = pts[i, :2]
        p2 = pts[(i + 1) % n, :2]
        # tangent approx
        t = p2 - p0
        t_len = np.linalg.norm(t) or 1.0
        t = t / t_len
        # rotate 90 deg CW or CCW; we pick "outward" via centroid test later
        nrm = np.array([-t[1], t[0]])  # rotate 90 CCW
        normals[i] = nrm
    # Normalize
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    norms[norms < 1e-9] = 1.0
    normals /= norms

    # Flip if not consistently outward (test against centroid)
    centroid = pts[:, :2].mean(axis=0)
    # Sample one normal direction
    test_i = n // 2
    test_p = pts[test_i, :2]
    if np.dot(normals[test_i], (test_p - centroid)) < 0:
        normals = -normals
    return normals


# ---------------------------------------------------------------------------
# Sidewall creation (straight with draft + rounded fillet)
# ---------------------------------------------------------------------------

def create_ruled_strip(upper: np.ndarray, lower: np.ndarray) -> trimesh.Trimesh:
    """Create a strip of quads (two tris each) connecting two (possibly unequal-length) loops.

    If cardinalities differ we resample the *shorter* one to the longer so that the
    attachment rings on the denser original boundary keep as many exact vertex
    matches as possible. This greatly helps the downstream merge + repair produce
    a watertight solid.
    """
    u = np.asarray(upper, dtype=np.float64)
    l = np.asarray(lower, dtype=np.float64)
    # Ensure closed for resampling safety
    if len(u) > 2 and not np.allclose(u[0], u[-1]):
        u = np.vstack([u, u[0]])
    if len(l) > 2 and not np.allclose(l[0], l[-1]):
        l = np.vstack([l, l[0]])

    nu = max(3, len(u) - 1)
    nl = max(3, len(l) - 1)
    target = max(nu, nl)

    if nu != target:
        u = resample_closed_polyline(u, target)
    if nl != target:
        l = resample_closed_polyline(l, target)

    n = target
    verts = np.vstack([u, l])
    faces: list[list[int]] = []
    for i in range(n):
        i1 = (i + 1) % n
        faces.append([i, i1, n + i1])
        faces.append([i, n + i1, n + i])
    m = trimesh.Trimesh(vertices=verts, faces=np.array(faces, dtype=np.int64), process=False)
    m.fix_normals()
    return m


def create_sidewall(top_loop: np.ndarray, bottom_loop: np.ndarray,
                    grinding_style: dict[str, Any]) -> trimesh.Trimesh:
    """Generate the Grinding Style connecting band.

    - "straight": ruled, with optional constant draft via horizontal offset of upper
      attachment + small bottom-closing shelf so we still terminate exactly on the
      Bottom outer boundary.
    - "rounded": direct ruled + approximate constant-radius fillet at the top/side junction
      by inserting arc-sampled rings (exterior fillet).
    """
    # Use the *exact* extracted boundary vertices from the source meshes for the
    # attachment rings. This guarantees that the upper ring of the sidewall shares
    # identical coordinates with vertices already present in the (clipped) Top mesh,
    # and likewise for Bottom. After concatenate + merge_vertices the junctions
    # become shared edges and the solid can become watertight.
    # (We accept the native density of the extracted loops; they are typically
    # well-sampled from the originating tessellation.)
    t_loop = np.asarray(top_loop, dtype=np.float64)
    b_loop = np.asarray(bottom_loop, dtype=np.float64)
    # Ensure both are treated as closed for the strip generator
    if len(t_loop) > 2 and not np.allclose(t_loop[0], t_loop[-1]):
        t_loop = np.vstack([t_loop, t_loop[0]])
    if len(b_loop) > 2 and not np.allclose(b_loop[0], b_loop[-1]):
        b_loop = np.vstack([b_loop, b_loop[0]])

    style_type = str(grinding_style.get("type", "straight")).lower()

    if style_type == "straight":
        angle = float(grinding_style.get("angle_degrees") or 8.0)
        angle = max(1.0, min(30.0, angle))
        h_avg = float(np.mean(t_loop[:, 2] - b_loop[:, 2]))
        run = (h_avg / math.tan(math.radians(angle))) if angle > 0 and h_avg > 0 else 0.0

        normals2d = compute_outward_normals_2d(t_loop)
        land = t_loop.copy()
        land[:, :2] += normals2d * max(0.0, run)
        # Land at bottom Z (preserve per-point bottom height if varying)
        land[:, 2] = b_loop[:, 2]

        wall_main = create_ruled_strip(t_loop, land)   # drafted main side
        wall_close = create_ruled_strip(land, b_loop)  # small shelf/closer to exact bottom boundary
        wall = trimesh.util.concatenate([wall_main, wall_close])
        wall.process()
        return wall

    elif style_type == "rounded":
        r = float(grinding_style.get("radius_mm") or 3.0)
        r = max(0.5, min(12.0, r))
        steps = 6  # arc resolution

        # Build multiple rings for the fillet + main lower wall
        rings: list[np.ndarray] = [t_loop]  # ring 0 = exact top boundary (will attach to Top mesh)
        for k in range(1, steps):
            a = (k / steps) * (math.pi / 2.0)
            # Outward + down arc (exterior fillet/round over)
            off = r * (1.0 - math.cos(a))
            dz = -r * math.sin(a)
            ring = t_loop.copy()
            nrm = compute_outward_normals_2d(ring)
            ring[:, :2] += nrm * off
            ring[:, 2] += dz
            rings.append(ring)

        # Final ring of the fillet becomes the "top" of the straight-ish lower wall
        fillet_end = rings[-1]
        # Lower wall from fillet_end down to actual bottom boundary (can be near vertical or slight draft)
        lower_wall = create_ruled_strip(fillet_end, b_loop)

        # Skin the fillet rings
        fillet_faces: list[list[int]] = []
        n_pts = len(t_loop)
        for r_idx in range(len(rings) - 1):
            r0 = rings[r_idx]
            r1 = rings[r_idx + 1]
            base0 = r_idx * n_pts
            base1 = (r_idx + 1) * n_pts
            for i in range(n_pts):
                i1 = (i + 1) % n_pts
                # two tris
                fillet_faces.append([base0 + i, base0 + i1, base1 + i1])
                fillet_faces.append([base0 + i, base1 + i1, base1 + i])

        fillet_verts = np.vstack(rings)
        fillet_mesh = trimesh.Trimesh(vertices=fillet_verts,
                                      faces=np.array(fillet_faces, dtype=np.int64),
                                      process=False)
        fillet_mesh.fix_normals()

        wall = trimesh.util.concatenate([fillet_mesh, lower_wall])
        wall.process()
        return wall

    else:
        raise ValueError(f"Unsupported grinding style type: {style_type}")


# ---------------------------------------------------------------------------
# Watertight / manifold validation and repair
# ---------------------------------------------------------------------------

def ensure_watertight(mesh: trimesh.Trimesh, *, label: str = "solid") -> trimesh.Trimesh:
    """Aggressive repair pass. Raises on failure."""
    if mesh is None:
        raise ValueError(f"{label}: mesh is None")

    m = mesh.copy()
    # Defensive degenerate / infinite cleanup (API varies slightly across trimesh versions)
    try:
        m.update_faces(m.nondegenerate_faces())
    except Exception:
        pass
    try:
        # Some versions expose this on the module
        trimesh.repair.remove_infinite_values(m)  # type: ignore[attr-defined]
    except Exception:
        pass
    m.merge_vertices()
    try:
        trimesh.repair.stitch(m)
    except Exception:
        pass
    try:
        trimesh.repair.fill_holes(m)
    except Exception:
        pass
    try:
        trimesh.repair.fix_inversion(m)
        m.fix_normals()
    except Exception:
        pass

    # Second merge after potential hole fills
    m.merge_vertices()
    try:
        m.update_faces(m.nondegenerate_faces())
    except Exception:
        pass

    if not m.is_watertight:
        # Last attempt: convex hull is too destructive for clinical shape; just fail loudly
        raise ValueError(
            f"{label}: result is not watertight after repair "
            f"(is_winding_consistent={m.is_winding_consistent}, "
            f"faces={len(m.faces)}, verts={len(m.vertices)})"
        )
    if not m.is_winding_consistent:
        # Try to flip / unify
        m.fix_normals()
        if not m.is_winding_consistent:
            raise ValueError(f"{label}: winding not consistent after repair")

    return m


# ---------------------------------------------------------------------------
# Phase 3: Small watertight polish for synthetic / low-resolution paths
# (Must not affect production data behavior)
# ---------------------------------------------------------------------------

def force_watertight_sidewall_junction(
    combined: trimesh.Trimesh,
    top_loop: np.ndarray,
    bottom_loop: np.ndarray,
    tol: float = 1e-5,
) -> trimesh.Trimesh:
    """
    Phase 3 polish: aggressively snap the sidewall attachment rings to the exact
    boundary vertices extracted from Top and Bottom.

    This guarantees that even low-resolution synthetic grids + clip produce
    a mesh that passes is_watertight after the normal repair passes.

    The tolerance is intentionally tiny (1e-5 mm). On real clinical bases the
    coordinates coming out of create_sidewall (which receives the exact extracted
    loops) will already be identical within float precision, so this is a no-op
    for production data.
    """
    if combined is None or len(top_loop) < 3 or len(bottom_loop) < 3:
        return combined

    m = combined.copy()
    m.merge_vertices()

    verts = m.vertices
    # For every point in the authoritative extracted loops, force any vertex
    # within the tiny tol to the exact coordinate. Then merge again.
    def snap_ring(loop: np.ndarray) -> None:
        for p in loop:
            dists = np.linalg.norm(verts - p, axis=1)
            mask = dists <= tol
            if np.any(mask):
                verts[mask] = p

    snap_ring(np.asarray(top_loop))
    snap_ring(np.asarray(bottom_loop))

    m.vertices = verts
    m.merge_vertices()

    return m
