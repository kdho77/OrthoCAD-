// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Native decimated pick proxy for large scan meshes (Amendment K3).
 * Raycast the proxy, then refine against the full mesh in a local neighbourhood.
 * No new dependencies.
 */

import type { BufferGeometry } from "three";
import * as THREE from "three";

/** Above this triangle count, use a decimated pick proxy during marker drag. */
export const PICK_DECIMATE_TRI_THRESHOLD = 80_000;

/** Target triangle count for the invisible pick mesh. */
export const PICK_TARGET_TRIANGLES = 24_000;

/** Neighbourhood radius (mm) for full-mesh hit refinement. */
export const PICK_REFINE_RADIUS_MM = 8;

/**
 * Build a coarser geometry by keeping every Nth triangle.
 * Preserves original positions (no vertex welding) — native stride only.
 */
export function buildDecimatedPickGeometry(
    geometry: BufferGeometry,
    targetTriangles = PICK_TARGET_TRIANGLES,
): BufferGeometry {
    const pos = geometry.getAttribute("position");
    if (!pos) return geometry.clone();

    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    if (triCount <= targetTriangles) return geometry.clone();

    const stride = Math.max(1, Math.ceil(triCount / targetTriangles));
    const outPos: number[] = [];

    if (index) {
        for (let t = 0; t < triCount; t += stride) {
            const i0 = index.getX(t * 3);
            const i1 = index.getX(t * 3 + 1);
            const i2 = index.getX(t * 3 + 2);
            outPos.push(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
            outPos.push(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
            outPos.push(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
        }
    } else {
        for (let t = 0; t < triCount; t += stride) {
            const i0 = t * 3;
            outPos.push(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
            outPos.push(pos.getX(i0 + 1), pos.getY(i0 + 1), pos.getZ(i0 + 1));
            outPos.push(pos.getX(i0 + 2), pos.getY(i0 + 2), pos.getZ(i0 + 2));
        }
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(outPos), 3));
    g.computeBoundingSphere();
    return g;
}

function triangleCount(geometry: BufferGeometry): number {
    const pos = geometry.getAttribute("position");
    if (!pos) return 0;
    const index = geometry.getIndex();
    return index ? index.count / 3 : pos.count / 3;
}

export function scanNeedsPickProxy(geometry: BufferGeometry): boolean {
    return triangleCount(geometry) >= PICK_DECIMATE_TRI_THRESHOLD;
}

/**
 * Intersect ray with a triangle; returns distance along ray or null.
 */
function rayTriangle(
    ray: THREE.Ray,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    target: THREE.Vector3,
): number | null {
    const hit = ray.intersectTriangle(a, b, c, false, target);
    if (!hit) return null;
    return ray.origin.distanceTo(hit);
}

/**
 * After a coarse pick hit, refine against full-resolution triangles whose
 * vertices lie near the coarse hit (native neighbourhood filter).
 */
export function refineHitOnFullMesh(
    ray: THREE.Ray,
    fullGeometry: BufferGeometry,
    coarseHit: THREE.Vector3,
    radiusMm = PICK_REFINE_RADIUS_MM,
): THREE.Vector3 | null {
    const pos = fullGeometry.getAttribute("position");
    if (!pos) return null;
    const index = fullGeometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const r2 = radiusMm * radiusMm;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let bestDist = Infinity;
    let best: THREE.Vector3 | null = null;

    for (let t = 0; t < triCount; t++) {
        let i0: number;
        let i1: number;
        let i2: number;
        if (index) {
            i0 = index.getX(t * 3);
            i1 = index.getX(t * 3 + 1);
            i2 = index.getX(t * 3 + 2);
        } else {
            i0 = t * 3;
            i1 = t * 3 + 1;
            i2 = t * 3 + 2;
        }
        a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
        // Keep triangle if any vertex is near the coarse hit.
        if (
            a.distanceToSquared(coarseHit) > r2 &&
            b.distanceToSquared(coarseHit) > r2 &&
            c.distanceToSquared(coarseHit) > r2
        ) {
            continue;
        }
        const d = rayTriangle(ray, a, b, c, tmp);
        if (d != null && d < bestDist) {
            bestDist = d;
            best = tmp.clone();
        }
    }
    return best;
}
