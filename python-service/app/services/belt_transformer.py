# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
belt_transformer.py — Phase 1 3D belt-printer pre-transform for the hybrid pipeline.

Accepts a watertight solid and a belt angle (30° for LayerLoop, 45° for Apex V2).
Applies the true 3D geometric equivalent of the 2D per-move beltTransform found in:

    vertex/src/lib/kiri/engine.ts

    function beltTransform(x, y, z, angleDeg) {
        const t = angleDeg * DEG;
        return [x, y - z / Math.tan(t), z / Math.sin(t)];
    }

After this transform, a downstream planar slicer (0° inclination / "flat" layers)
produces contours whose extruded paths, when executed on the physical belt printer,
yield the identical 3D geometry that would result from slicing the untransformed
solid and then applying the per-move kinematic compensation.

The transform is an affine shear + scale in the YZ plane (X unchanged). It
preserves watertightness and manifoldness for well-formed input.
"""

from __future__ import annotations

import logging
import math
from typing import Any

import numpy as np
import trimesh

logger = logging.getLogger("manufacturing.belt")


def apply_belt_transform(
    solid: trimesh.Trimesh,
    angle_degrees: float,
) -> trimesh.Trimesh:
    """Apply 3D belt pre-transform. Supports 30° and 45° (and other sensible angles).

    Returns a new Trimesh with vertices transformed in-place (copied). The result
    is re-merged and validated for watertightness.
    """
    if solid is None or len(solid.vertices) == 0:
        raise ValueError("apply_belt_transform: empty or None solid")

    input_watertight = bool(solid.is_watertight)
    angle = float(angle_degrees)
    if not (5.0 < angle < 80.0):
        raise ValueError(f"Unsupported belt angle {angle}° (expected ~30 or 45)")

    t = math.radians(angle)
    sin_t = math.sin(t)
    tan_t = math.tan(t)
    if sin_t < 1e-9 or tan_t < 1e-9:
        raise ValueError(f"Degenerate trig for angle {angle}°")

    verts = solid.vertices.copy().astype(np.float64)
    # Vectorized equivalent of the TS per-point transform
    # y' = y - z / tan(t)
    # z' = z / sin(t)
    # x' = x
    verts[:, 1] = verts[:, 1] - verts[:, 2] / tan_t
    verts[:, 2] = verts[:, 2] / sin_t

    out = solid.copy()
    out.vertices = verts

    # Maintain quality (defensive for trimesh API variance across versions)
    out.merge_vertices()
    try:
        out.update_faces(out.nondegenerate_faces())
    except Exception:
        pass
    out.fix_normals()

    # The shear/scale is linear and orientation-preserving; watertightness should survive
    # numerical noise on real clinical meshes. We still run a light repair.
    try:
        trimesh.repair.stitch(out)
        trimesh.repair.fill_holes(out)
    except Exception:
        pass

    if not out.is_watertight:
        # The belt transform is a linear shear+scale in YZ: it preserves topology
        # and therefore cannot turn a watertight solid into a leaky one. So a
        # non-watertight result here only matters if the INPUT was watertight —
        # that would signal numerical degeneracy introduced by the transform.
        if input_watertight:
            raise ValueError(
                f"apply_belt_transform({angle}°): a watertight solid became non-watertight "
                "after the transform. Check for near-degenerate faces or extreme aspect ratio."
            )
        # Input was already non-watertight (e.g. best-effort solid from a
        # low-resolution/synthetic base). The planar slicer tolerates small leaks
        # via trimesh.section, so proceed instead of failing the whole job.
        logger.warning(
            "apply_belt_transform(%.1f°): input solid was not watertight; proceeding with "
            "best-effort transformed mesh (slicing tolerates minor leaks).",
            angle,
        )

    return out


# ----------------------------------------------------------------------
# Minimal smoke test (run directly from python-service/: py -3 app/services/belt_transformer.py )
# ----------------------------------------------------------------------

if __name__ == "__main__":
    print("=== belt_transformer smoke test ===")

    # Tiny closed box as a "solid"
    box = trimesh.creation.box(extents=[40, 80, 12])
    box = box.subdivide()  # a few more faces
    print(f"  input box: watertight={box.is_watertight}, faces={len(box.faces)}")

    for ang in (30.0, 45.0):
        transformed = apply_belt_transform(box, ang)
        print(f"  {ang}°: watertight={transformed.is_watertight}, "
              f"winding={transformed.is_winding_consistent}, "
              f"z_range=[{transformed.vertices[:, 2].min():.1f}, {transformed.vertices[:, 2].max():.1f}]")
        if not transformed.is_watertight:
            raise RuntimeError(f"Belt transform at {ang}° destroyed watertightness")

    print("=== belt_transformer smoke test PASSED ===")
