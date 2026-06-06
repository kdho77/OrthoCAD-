// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import { outlineHalfWidth } from "@/lib/geometry/height-field";

/** Closed insole perimeter curve in local footprint coordinates (x length, y width, z height). */
export interface TrimlineCurve {
    points: THREE.Vector3[];
}

export function cloneTrimline(curve: TrimlineCurve): TrimlineCurve {
    return { points: curve.points.map((p) => p.clone()) };
}

/** Sample the parametric insole outline as a closed polyline suitable for editing. */
export function sampleDefaultOutline(
    lengthMm: number,
    widthMm: number,
    segmentsPerEdge = 20,
): TrimlineCurve {
    const nx = segmentsPerEdge;
    const ny = segmentsPerEdge;
    const halfW = widthMm / 2;
    const points: THREE.Vector3[] = [];

    // Medial edge (heel → toe), v = −1
    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        const hw = outlineHalfWidth(u) * halfW;
        points.push(new THREE.Vector3(u * lengthMm, -hw, 0));
    }
    // Toe cap, u = 1
    for (let j = 1; j <= ny; j++) {
        const vSigned = (j / ny) * 2 - 1;
        const hw = outlineHalfWidth(1) * halfW;
        points.push(new THREE.Vector3(lengthMm, vSigned * hw, 0));
    }
    // Lateral edge (toe → heel), v = +1
    for (let i = nx - 1; i >= 0; i--) {
        const u = i / nx;
        const hw = outlineHalfWidth(u) * halfW;
        points.push(new THREE.Vector3(u * lengthMm, hw, 0));
    }
    // Heel cap, u = 0
    for (let j = ny - 1; j >= 1; j--) {
        const vSigned = (j / ny) * 2 - 1;
        const hw = outlineHalfWidth(0) * halfW;
        points.push(new THREE.Vector3(0, vSigned * hw, 0));
    }

    return { points };
}

/** Half-width multiplier (0..1) at normalized length u from a custom trimline. */
export function trimlineHalfWidthAtU(
    u: number,
    curve: TrimlineCurve,
    lengthMm: number,
    widthMm: number,
): number {
    const halfW = widthMm / 2;
    const x = u * lengthMm;
    const tolerance = lengthMm / 32;
    let maxAbsY = 0;
    let found = false;

    for (const p of curve.points) {
        if (Math.abs(p.x - x) <= tolerance) {
            maxAbsY = Math.max(maxAbsY, Math.abs(p.y));
            found = true;
        }
    }

    if (!found) return outlineHalfWidth(u);
    return Math.max(0.15, maxAbsY / halfW);
}

/** Resolve outline half-width using an optional custom trimline override. */
export function effectiveOutlineHalfWidth(
    u: number,
    lengthMm: number,
    widthMm: number,
    trimline?: TrimlineCurve | null,
): number {
    if (trimline && trimline.points.length >= 4) {
        return trimlineHalfWidthAtU(u, trimline, lengthMm, widthMm);
    }
    return outlineHalfWidth(u);
}

/** Index of the nearest control point on a closed trimline loop. */
export function nearestTrimlinePointIndex(curve: TrimlineCurve, localPoint: THREE.Vector3): number {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < curve.points.length; i++) {
        const p = curve.points[i]!;
        const dx = p.x - localPoint.x;
        const dy = p.y - localPoint.y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = i;
        }
    }
    return best;
}

/**
 * Deform a section of the trimline around `anchorIndex` by `delta` with Gaussian falloff.
 * Returns new point array (does not mutate input).
 */
export function deformTrimlineSection(
    points: THREE.Vector3[],
    anchorIndex: number,
    delta: THREE.Vector3,
    influenceRadius = 10,
): THREE.Vector3[] {
    const n = points.length;
    if (n === 0) return [];

    return points.map((p, i) => {
        const direct = Math.abs(i - anchorIndex);
        const wrapped = Math.min(direct, n - direct);
        const weight = Math.exp(-(wrapped * wrapped) / (2 * influenceRadius * influenceRadius));
        return new THREE.Vector3(
            p.x + delta.x * weight,
            p.y + delta.y * weight,
            p.z,
        );
    });
}

/** Build a smooth Catmull-Rom curve through trimline control points (closed loop). */
export function trimlineToCurve(points: THREE.Vector3[], closed = true): THREE.CatmullRomCurve3 {
    const pts = points.map((p) => p.clone());
    if (closed && pts.length > 2) {
        pts.push(pts[0]!.clone());
    }
    return new THREE.CatmullRomCurve3(pts, closed);
}

/**
 * Raycast against a tube mesh built from the trimline curve.
 * Returns the nearest control-point index, or null if no hit.
 */
export function pickTrimlineWithRaycaster(
    raycaster: THREE.Raycaster,
    curve: TrimlineCurve,
    matrixWorld: THREE.Matrix4,
    tubeRadius = 3,
): number | null {
    if (curve.points.length < 2) return null;

    const catmull = trimlineToCurve(curve.points, true);
    const tubeGeo = new THREE.TubeGeometry(catmull, Math.max(32, curve.points.length * 2), tubeRadius, 6, true);
    const pickMesh = new THREE.Mesh(tubeGeo);
    pickMesh.applyMatrix4(matrixWorld);

    const hits = raycaster.intersectObject(pickMesh, false);
    tubeGeo.dispose();

    if (hits.length === 0) return null;

    const localHit = hits[0]!.point.clone().applyMatrix4(matrixWorld.clone().invert());
    return nearestTrimlinePointIndex(curve, localHit);
}

/** Project a world-space point onto the insole footprint plane (z = 0 in local space). */
export function projectToFootprintPlane(
    worldPoint: THREE.Vector3,
    localToWorld: THREE.Matrix4,
): THREE.Vector3 {
    const inv = localToWorld.clone().invert();
    const local = worldPoint.clone().applyMatrix4(inv);
    local.z = 0;
    return local;
}
