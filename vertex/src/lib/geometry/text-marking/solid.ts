// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import type { BufferGeometry } from "three";
import { buildTextCutterMesh } from "./cutter";
import type { MapTextPoint, TextGlyphGroup } from "./types";

export type { MapTextPoint };

/**
 * Closed prism / lofted shell: CDT caps with Steiner points, then map every
 * vertex. `t` is the offset parameter (0 at the inner cap, 1 at the outer).
 */
export function extrudeTextSolid(groups: TextGlyphGroup[], mapPoint: MapTextPoint): BufferGeometry {
    return buildTextCutterMesh(groups, mapPoint);
}

export function planarBottomMap(z0: number, z1: number): MapTextPoint {
    return (p, t) => ({ x: p.x, y: p.y, z: z0 + (z1 - z0) * t });
}
