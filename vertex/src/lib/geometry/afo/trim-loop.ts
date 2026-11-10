// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    AFO_TRIM_CLOSE_MM,
    AFO_TRIM_CLOSE_PX,
    AFO_TRIM_DEDUPE_MM,
    AFO_TRIM_MIN_AREA_MM2,
    AFO_TRIM_MIN_LENGTH_MM,
    AFO_TRIM_MIN_POINTS,
} from "./defaults";
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

function sub3(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot3(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function clamp01(v: number): number {
    return Math.min(1, Math.max(0, v));
}

/** Distance from point `p` to segment `a`–`b`. */
function pointSegmentDistance(p: AfoVec3, a: AfoVec3, b: AfoVec3): number {
    const ab = sub3(b, a);
    const ab2 = dot3(ab, ab);
    const t = ab2 < 1e-12 ? 0 : clamp01(dot3(sub3(p, a), ab) / ab2);
    return Math.hypot(a.x + ab.x * t - p.x, a.y + ab.y * t - p.y, a.z + ab.z * t - p.z);
}

/**
 * Shortest distance between two 3D segments. Endpoint-to-segment distances cover
 * collinear overlaps that a single clamped parameter pair can miss.
 */
function segmentSegmentDistance(a: AfoVec3, b: AfoVec3, c: AfoVec3, d: AfoVec3): number {
    const u = sub3(b, a);
    const v = sub3(d, c);
    const w = sub3(a, c);
    const uu = dot3(u, u);
    const uv = dot3(u, v);
    const vv = dot3(v, v);
    const uw = dot3(u, w);
    const vw = dot3(v, w);
    const eps = 1e-8;
    let s = 0;
    let t = 0;
    const denom = uu * vv - uv * uv;
    if (uu <= eps && vv <= eps) {
        return Math.hypot(a.x - c.x, a.y - c.y, a.z - c.z);
    } else if (uu <= eps) {
        t = clamp01(vw / vv);
    } else if (vv <= eps) {
        s = clamp01(-uw / uu);
    } else {
        s = denom > eps ? clamp01((uv * vw - vv * uw) / denom) : 0;
        t = (uv * s + vw) / vv;
        if (t < 0) {
            t = 0;
            s = clamp01(-uw / uu);
        } else if (t > 1) {
            t = 1;
            s = clamp01((uv - uw) / uu);
        }
    }
    const analytic = Math.hypot(
        a.x + u.x * s - (c.x + v.x * t),
        a.y + u.y * s - (c.y + v.y * t),
        a.z + u.z * s - (c.z + v.z * t),
    );
    return Math.min(
        analytic,
        pointSegmentDistance(a, c, d),
        pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b),
        pointSegmentDistance(d, a, b),
    );
}

function arcBetween(from: number, to: number, prefix: number[], total: number): number {
    if (to >= from) return (prefix[to] ?? 0) - (prefix[from] ?? 0);
    return total - ((prefix[from] ?? 0) - (prefix[to] ?? 0));
}

/**
 * Non-local 3D self-intersection. Uprights that only cross in the XY projection
 * (separated along the leg) do not count. Segments within `localArcMm` of each
 * other along the loop are a corner, not a crossing.
 */
export function polylineSelfIntersects(points: AfoVec3[], epsilonMm = 0.3, localArcMm = 4): boolean {
    const n = points.length;
    if (n < 4) return false;
    const prefix = [0];
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        prefix.push(prefix[i]! + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
    }
    const total = prefix[n] ?? 0;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        for (let j = i + 1; j < n; j++) {
            const adjacent = j === i + 1 || (i === 0 && j === n - 1);
            if (adjacent) continue;
            const forward = arcBetween(i + 1, j, prefix, total);
            const backward = arcBetween((j + 1) % n, i, prefix, total);
            if (Math.min(forward, backward) < localArcMm) continue;
            const c = points[j]!;
            const d = points[(j + 1) % n]!;
            if (segmentSegmentDistance(a, b, c, d) <= epsilonMm) return true;
        }
    }
    return false;
}

export function countDistinctPoints(points: AfoVec3[], minSeparationMm = AFO_TRIM_DEDUPE_MM): number {
    const kept: AfoVec3[] = [];
    for (const p of points) {
        if (kept.every((q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) >= minSeparationMm)) kept.push(p);
    }
    return kept.length;
}

export function validateTrimLoop(
    mesh: AfoTriMesh,
    vertexIndices: number[],
    closed: boolean,
    options: { skipGeodesic?: boolean; points?: AfoVec3[] } = {},
): TrimLoopValidation {
    const reasons: string[] = [];
    const hitPoints = options.points;
    if (hitPoints && hitPoints.length > 0) {
        if (countDistinctPoints(hitPoints) < AFO_TRIM_MIN_POINTS) {
            reasons.push(`Need at least ${AFO_TRIM_MIN_POINTS} distinct trim points.`);
        }
    } else {
        const unique = new Set(vertexIndices);
        if (unique.size < AFO_TRIM_MIN_POINTS) {
            reasons.push(`Need at least ${AFO_TRIM_MIN_POINTS} distinct vertices.`);
        }
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
    const pts =
        hitPoints && hitPoints.length > 0
            ? hitPoints
            : vertexIndices.map((i) => ({
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
export function isCloseClick(first: AfoVec3, click: AfoVec3, radiusMm = AFO_TRIM_CLOSE_MM): boolean {
    return Math.hypot(click.x - first.x, click.y - first.y, click.z - first.z) <= radiusMm;
}

export function isCloseOnScreen(px: number | null | undefined, limitPx = AFO_TRIM_CLOSE_PX): boolean {
    return px != null && px <= limitPx;
}

/**
 * Record one trim click as a hit point. Pins closer than 1 mm are ignored.
 * The first pin closes the loop within 3 mm or when the caller reports a
 * screen distance inside 10 px. Vertex ids are not used.
 */
export function registerTrimClick(
    pins: AfoVec3[],
    hit: AfoVec3,
    screenPx: number | null = null,
): { pins: AfoVec3[]; closed: boolean; added: boolean } {
    if (
        pins.length >= AFO_TRIM_MIN_POINTS &&
        pins[0] &&
        (isCloseClick(pins[0], hit) || isCloseOnScreen(screenPx))
    ) {
        return { pins, closed: true, added: false };
    }
    if (pins.some((p) => Math.hypot(hit.x - p.x, hit.y - p.y, hit.z - p.z) < AFO_TRIM_DEDUPE_MM)) {
        return { pins, closed: false, added: false };
    }
    return { pins: [...pins, { x: hit.x, y: hit.y, z: hit.z }], closed: false, added: true };
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
