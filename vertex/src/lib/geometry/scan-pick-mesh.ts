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
 * Build a continuous coarse pick proxy from the scan's XY upper envelope.
 * Stride-thinning leaves ray holes in triangle soup; a regular heightfield
 * grid stays watertight for top-down marker rays, then refine restores
 * full-resolution accuracy (Amendment L2).
 */
export function buildDecimatedPickGeometry(
    geometry: BufferGeometry,
    targetTriangles = PICK_TARGET_TRIANGLES,
): BufferGeometry {
    const pos = geometry.getAttribute("position");
    if (!pos || pos.count === 0) return geometry.clone();

    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    if (triCount <= targetTriangles) return geometry.clone();

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }
    const spanX = Math.max(maxX - minX, 1e-3);
    const spanY = Math.max(maxY - minY, 1e-3);

    // n×n quads → 2n² triangles. Aim near targetTriangles.
    const n = Math.max(8, Math.ceil(Math.sqrt(targetTriangles / 2)));
    const cellX = spanX / n;
    const cellY = spanY / n;

    // Max-Z per coarse cell (upper envelope for top-down picks).
    const zMax = new Float32Array((n + 1) * (n + 1));
    const filled = new Uint8Array((n + 1) * (n + 1));
    zMax.fill(-Infinity);

    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const ix = Math.min(n, Math.max(0, Math.round(((x - minX) / spanX) * n)));
        const iy = Math.min(n, Math.max(0, Math.round(((y - minY) / spanY) * n)));
        const k = iy * (n + 1) + ix;
        if (z > zMax[k]!) {
            zMax[k] = z;
            filled[k] = 1;
        }
    }

    // Fill empty nodes from nearest filled neighbour (scan footprint is not a rectangle).
    for (let iy = 0; iy <= n; iy++) {
        for (let ix = 0; ix <= n; ix++) {
            const k = iy * (n + 1) + ix;
            if (filled[k]) continue;
            let bestD = Infinity;
            let bestZ = 0;
            for (let dy = -2; dy <= 2; dy++) {
                for (let dx = -2; dx <= 2; dx++) {
                    const jx = ix + dx;
                    const jy = iy + dy;
                    if (jx < 0 || jy < 0 || jx > n || jy > n) continue;
                    const j = jy * (n + 1) + jx;
                    if (!filled[j]) continue;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) {
                        bestD = d;
                        bestZ = zMax[j]!;
                    }
                }
            }
            if (bestD < Infinity) {
                zMax[k] = bestZ;
                filled[k] = 1;
            } else {
                zMax[k] = 0;
            }
        }
    }

    const outPos: number[] = [];
    const pushTri = (
        x0: number,
        y0: number,
        z0: number,
        x1: number,
        y1: number,
        z1: number,
        x2: number,
        y2: number,
        z2: number,
    ) => {
        outPos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
    };

    for (let iy = 0; iy < n; iy++) {
        for (let ix = 0; ix < n; ix++) {
            const x0 = minX + ix * cellX;
            const x1 = minX + (ix + 1) * cellX;
            const y0 = minY + iy * cellY;
            const y1 = minY + (iy + 1) * cellY;
            const z00 = zMax[iy * (n + 1) + ix]!;
            const z10 = zMax[iy * (n + 1) + ix + 1]!;
            const z01 = zMax[(iy + 1) * (n + 1) + ix]!;
            const z11 = zMax[(iy + 1) * (n + 1) + ix + 1]!;
            pushTri(x0, y0, z00, x1, y0, z10, x1, y1, z11);
            pushTri(x0, y0, z00, x1, y1, z11, x0, y1, z01);
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

function readTriangle(
    pos: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
    index: THREE.BufferAttribute | null,
    t: number,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
): void {
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
}

/**
 * First hit of a ray against every triangle in `geometry` (full-resolution reference).
 */
export function intersectRayFullMesh(ray: THREE.Ray, geometry: BufferGeometry): THREE.Vector3 | null {
    const pos = geometry.getAttribute("position");
    if (!pos) return null;
    const index = geometry.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    let bestDist = Infinity;
    let best: THREE.Vector3 | null = null;
    for (let t = 0; t < triCount; t++) {
        readTriangle(pos, index, t, a, b, c);
        const d = rayTriangle(ray, a, b, c, tmp);
        if (d != null && d < bestDist) {
            bestDist = d;
            best = tmp.clone();
        }
    }
    return best;
}

/**
 * After a coarse pick hit, refine against full-resolution triangles near the
 * coarse hit (vertex or centroid within radius — native, allocation-light).
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
        readTriangle(pos, index, t, a, b, c);
        const cx = (a.x + b.x + c.x) / 3;
        const cy = (a.y + b.y + c.y) / 3;
        const cz = (a.z + b.z + c.z) / 3;
        const near =
            a.distanceToSquared(coarseHit) <= r2 ||
            b.distanceToSquared(coarseHit) <= r2 ||
            c.distanceToSquared(coarseHit) <= r2 ||
            (cx - coarseHit.x) ** 2 + (cy - coarseHit.y) ** 2 + (cz - coarseHit.z) ** 2 <= r2;
        if (!near) continue;
        const d = rayTriangle(ray, a, b, c, tmp);
        if (d != null && d < bestDist) {
            bestDist = d;
            best = tmp.clone();
        }
    }
    // One wider pass if the coarse proxy sat in a stride hole.
    if (!best && radiusMm < PICK_REFINE_RADIUS_MM * 2) {
        return refineHitOnFullMesh(ray, fullGeometry, coarseHit, PICK_REFINE_RADIUS_MM * 2);
    }
    return best;
}

/**
 * Production pick path for large scans: raycast decimated proxy, then refine
 * on the full mesh. Returns null when the proxy misses (no spurious hit).
 */
export function pickViaProxyThenRefine(
    ray: THREE.Ray,
    fullGeometry: BufferGeometry,
    proxyGeometry: BufferGeometry,
): { refined: THREE.Vector3 | null; coarse: THREE.Vector3 | null } {
    const proxyMesh = new THREE.Mesh(proxyGeometry);
    proxyMesh.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster(ray.origin.clone(), ray.direction.clone());
    const hits = raycaster.intersectObject(proxyMesh, false);
    if (!hits[0]) return { refined: null, coarse: null };
    const coarse = hits[0].point.clone();
    const refined = refineHitOnFullMesh(ray, fullGeometry, coarse);
    // Clinical path: never return an unrefined proxy hit as placement.
    return { refined, coarse };
}
