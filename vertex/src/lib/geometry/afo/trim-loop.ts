// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AFO_TRIM_MIN_AREA_MM2, AFO_TRIM_MIN_LENGTH_MM, AFO_TRIM_MIN_POINTS } from "./defaults";
import { geodesicVertexPath } from "./geodesic";
import type { AfoTriMesh, AfoVec3, TrimLoopValidation } from "./types";

export function polylineLength(points: AfoVec3[]): number {
    let s = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % points.length]!;
        s += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }
    return s;
}

/** XY projected polygon area (shoelace). */
export function projectedAreaXy(points: AfoVec3[]): number {
    let a = 0;
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const p = points[i]!;
        const q = points[(i + 1) % n]!;
        a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) * 0.5;
}

function segmentsIntersect(a: AfoVec3, b: AfoVec3, c: AfoVec3, d: AfoVec3): boolean {
    const orient = (p: AfoVec3, q: AfoVec3, r: AfoVec3) =>
        Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    const o1 = orient(a, b, c);
    const o2 = orient(a, b, d);
    const o3 = orient(c, d, a);
    const o4 = orient(c, d, b);
    if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4) return true;
    return false;
}

export function polylineSelfIntersects(points: AfoVec3[]): boolean {
    const n = points.length;
    if (n < 4) return false;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            const c = points[j]!;
            const d = points[(j + 1) % n]!;
            if (segmentsIntersect(a, b, c, d)) return true;
        }
    }
    return false;
}

export function validateTrimLoop(
    mesh: AfoTriMesh,
    vertexIndices: number[],
    closed: boolean,
    options: { skipGeodesic?: boolean } = {},
): TrimLoopValidation {
    const reasons: string[] = [];
    const unique = new Set(vertexIndices);
    if (unique.size < AFO_TRIM_MIN_POINTS) {
        reasons.push(`Need at least ${AFO_TRIM_MIN_POINTS} distinct vertices.`);
    }
    if (!closed) {
        reasons.push("Loop is not closed (click the first point).");
    }
    const n = vertexCountSafe(mesh);
    for (const v of vertexIndices) {
        if (v < 0 || v >= n) reasons.push(`Vertex ${v} is outside the mesh.`);
    }
    if (!options.skipGeodesic && closed && vertexIndices.length >= 2) {
        for (let i = 0; i < vertexIndices.length; i++) {
            const a = vertexIndices[i]!;
            const b = vertexIndices[(i + 1) % vertexIndices.length]!;
            if (geodesicVertexPath(mesh, a, b) == null) {
                reasons.push("A geodesic segment is disconnected.");
                break;
            }
        }
    }
    const pts = vertexIndices.map((i) => ({
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    }));
    if (closed && pts.length >= 3) {
        if (polylineLength(pts) < AFO_TRIM_MIN_LENGTH_MM) {
            reasons.push(`Loop shorter than ${AFO_TRIM_MIN_LENGTH_MM} mm.`);
        }
        if (projectedAreaXy(pts) < AFO_TRIM_MIN_AREA_MM2) {
            reasons.push(`Enclosed area below ${AFO_TRIM_MIN_AREA_MM2} mm².`);
        }
        if (polylineSelfIntersects(pts)) {
            reasons.push("Trim loop self-intersects.");
        }
    }
    return { ok: reasons.length === 0, reasons };
}

function vertexCountSafe(mesh: AfoTriMesh): number {
    return (mesh.positions.length / 3) | 0;
}

/** Click is a close if it lands on the first handle (within radius mm). */
export function isCloseClick(first: AfoVec3, click: AfoVec3, radiusMm = 12): boolean {
    return Math.hypot(click.x - first.x, click.y - first.y, click.z - first.z) <= radiusMm;
}

/** Angularly ordered vertex loop near a target Z (brace opening). */
export function loopNearZ(mesh: AfoTriMesh, zMm: number, count = 16): number[] {
    const n = (mesh.positions.length / 3) | 0;
    const band: { i: number; d: number; ang: number }[] = [];
    for (let i = 0; i < n; i++) {
        const z = mesh.positions[i * 3 + 2] ?? 0;
        band.push({
            i,
            d: Math.abs(z - zMm),
            ang: Math.atan2(mesh.positions[i * 3 + 1] ?? 0, mesh.positions[i * 3] ?? 0),
        });
    }
    band.sort((a, b) => a.d - b.d);
    const d0 = band[0]?.d ?? 0;
    const near = band.filter((b) => b.d <= Math.max(d0 + 12, 16));
    let cx = 0;
    let cy = 0;
    for (const b of near) {
        cx += mesh.positions[b.i * 3] ?? 0;
        cy += mesh.positions[b.i * 3 + 1] ?? 0;
    }
    const nNear = near.length || 1;
    cx /= nNear;
    cy /= nNear;
    const ring = near
        .map((b) => ({
            ...b,
            ang: Math.atan2((mesh.positions[b.i * 3 + 1] ?? 0) - cy, (mesh.positions[b.i * 3] ?? 0) - cx),
        }))
        .sort((a, b) => a.ang - b.ang);
    if (ring.length === 0) return [];
    const step = Math.max(1, Math.floor(ring.length / count));
    const out: number[] = [];
    const seen = new Set<number>();
    for (let k = 0; k < ring.length && out.length < count; k += step) {
        const i = ring[k]?.i;
        if (i == null || seen.has(i)) continue;
        seen.add(i);
        out.push(i);
    }
    if (out.length < 3) {
        return ring.slice(0, Math.min(ring.length, Math.max(count, 8))).map((r) => r.i);
    }
    return out;
}
