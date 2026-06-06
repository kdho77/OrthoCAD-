// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import { outlineHalfWidth } from "@/lib/geometry/height-field";
import type { DesignState, DesignTrimlines, Side, TrimlinePoint } from "@/types";

/** Closed insole perimeter curve in local footprint coordinates (x length, y width, z height). */
export interface TrimlineCurve {
    points: THREE.Vector3[];
}

/** Pick tube radius (mm) for idle vs active edit — larger = easier to click. */
export const TRIMLINE_PICK_RADIUS_IDLE = 3.8;
export const TRIMLINE_PICK_RADIUS_EDIT = 4.8;
/** Max distance (mm) from footprint click to polyline for fallback picking. */
export const TRIMLINE_PICK_FALLBACK_MM = 16;

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
 * Raycast against a tube mesh built from the trimline curve, with footprint-plane fallback.
 * Returns the best control-point anchor index for dragging.
 */
export function pickTrimlineWithRaycaster(
    raycaster: THREE.Raycaster,
    curve: TrimlineCurve,
    matrixWorld: THREE.Matrix4,
    tubeRadius = TRIMLINE_PICK_RADIUS_IDLE,
): number | null {
    if (curve.points.length < 2) return null;

    const catmull = trimlineToCurve(curve.points, true);
    const tubeGeo = new THREE.TubeGeometry(catmull, Math.max(48, curve.points.length * 2), tubeRadius, 8, true);
    const pickMesh = new THREE.Mesh(tubeGeo);
    pickMesh.applyMatrix4(matrixWorld);

    const hits = raycaster.intersectObject(pickMesh, false);
    tubeGeo.dispose();

    const worldToLocal = matrixWorld.clone().invert();

    if (hits.length > 0) {
        const localHit = hits[0]!.point.clone().applyMatrix4(worldToLocal);
        return pickTrimlineAnchorIndex(localHit, curve);
    }

    const planeHit = intersectRayWithFootprintPlane(raycaster.ray, matrixWorld);
    if (!planeHit) return null;
    return pickTrimlineAnchorIndex(planeHit, curve);
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

/** JSON-safe trimline for design store / API persistence. */
export function serializeTrimlineCurve(curve: TrimlineCurve): TrimlinePoint[] {
    return curve.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

export function deserializeTrimlineCurve(points: TrimlinePoint[]): TrimlineCurve {
    return { points: points.map((p) => new THREE.Vector3(p.x, p.y, p.z)) };
}

/** Read a side's committed trimline from design state, if any. */
export function getDesignTrimline(design: DesignState, side: Side): TrimlineCurve | null {
    const pts = design.trimlines?.[side];
    if (!pts || pts.length < 4) return null;
    return deserializeTrimlineCurve(pts);
}

/** Merge serialized trimlines into a design patch. */
export function trimlinesToDesignPatch(trimlines: Partial<Record<Side, TrimlineCurve>>): DesignTrimlines {
    const out: DesignTrimlines = {};
    for (const side of ["left", "right"] as Side[]) {
        const curve = trimlines[side];
        if (curve && curve.points.length >= 4) {
            out[side] = serializeTrimlineCurve(curve);
        }
    }
    return out;
}

/** Closest point on segment AB to P (XY footprint). */
function closestPointOnSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): THREE.Vector3 {
    const ab = new THREE.Vector3().subVectors(b, a);
    const lenSq = ab.x * ab.x + ab.y * ab.y;
    if (lenSq < 1e-9) return a.clone();
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y) / lenSq));
    return new THREE.Vector3(a.x + ab.x * t, a.y + ab.y * t, 0);
}

/**
 * Find the best control-point anchor for a footprint click.
 * Uses polyline segment distance first, then falls back to nearest vertex.
 */
export function pickTrimlineAnchorIndex(
    localFootprintPoint: THREE.Vector3,
    curve: TrimlineCurve,
    maxDistMm = TRIMLINE_PICK_FALLBACK_MM,
): number {
    const { points } = curve;
    if (points.length === 0) return 0;

    let bestDist = Infinity;
    let bestIndex = 0;

    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        const proj = closestPointOnSegment(localFootprintPoint, a, b);
        const d = localFootprintPoint.distanceTo(proj);
        if (d < bestDist) {
            bestDist = d;
            bestIndex =
                localFootprintPoint.distanceTo(a) <= localFootprintPoint.distanceTo(b)
                    ? i
                    : (i + 1) % points.length;
        }
    }

    if (bestDist <= maxDistMm) return bestIndex;
    return nearestTrimlinePointIndex(curve, localFootprintPoint);
}

/**
 * Intersect a world-space ray with the insole footprint plane (local z = 0).
 * Used as a fallback when the pick tube mesh is missed.
 */
export function intersectRayWithFootprintPlane(
    ray: THREE.Ray,
    localToWorld: THREE.Matrix4,
): THREE.Vector3 | null {
    const worldToLocal = localToWorld.clone().invert();
    const origin = ray.origin.clone().applyMatrix4(worldToLocal);
    const dir = ray.direction.clone().transformDirection(worldToLocal);

    if (Math.abs(dir.z) < 1e-8) return null;
    const t = -origin.z / dir.z;
    if (t < 0) return null;

    return origin.add(dir.multiplyScalar(t));
}
