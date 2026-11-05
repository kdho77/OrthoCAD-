// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { nearestVertex, vertexCount } from "./mesh-ops";
import { polylineSelfIntersects } from "./trim-loop";
import type { AfoDesignState, AfoLandmark, AfoTriMesh, AfoVec3 } from "./types";

export interface SurfaceSpline {
    ok: boolean;
    reasons: string[];
    /** Curve samples on the mesh, at least one per 2 mm. */
    curve: AfoVec3[];
    maxTurnDeg: number;
    maxChordErrorMm: number;
    maxSurfaceErrorMm: number;
}

function sub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(a: AfoVec3, s: number): AfoVec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function lerp(a: AfoVec3, b: AfoVec3, t: number): AfoVec3 {
    return add(scale(a, 1 - t), scale(b, t));
}

function len(a: AfoVec3): number {
    return Math.hypot(a.x, a.y, a.z);
}

function dist(a: AfoVec3, b: AfoVec3): number {
    return len(sub(a, b));
}

/** Closed centripetal-ish cubic through the pins. */
export function catmullRomClosed(points: AfoVec3[], t: number, i: number): AfoVec3 {
    const n = points.length;
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i % n]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    const t2 = t * t;
    const t3 = t2 * t;
    return {
        x:
            0.5 *
            (2 * p1.x +
                (-p0.x + p2.x) * t +
                (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
                (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y:
            0.5 *
            (2 * p1.y +
                (-p0.y + p2.y) * t +
                (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
                (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        z:
            0.5 *
            (2 * p1.z +
                (-p0.z + p2.z) * t +
                (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
                (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
    };
}

export function snapPointToMesh(
    mesh: AfoTriMesh,
    p: AfoVec3,
): { point: AfoVec3; vertexIndex: number; errorMm: number } {
    const face = closestOnMesh(mesh, p);
    const vertex = nearestVertex(mesh, face.point);
    const v = {
        x: mesh.positions[vertex.index * 3] ?? 0,
        y: mesh.positions[vertex.index * 3 + 1] ?? 0,
        z: mesh.positions[vertex.index * 3 + 2] ?? 0,
    };
    if (dist(v, face.point) <= 0.1) return { point: v, vertexIndex: vertex.index, errorMm: face.errorMm };
    return { point: face.point, vertexIndex: vertex.index, errorMm: face.errorMm };
}

function closestOnMesh(mesh: AfoTriMesh, p: AfoVec3): { point: AfoVec3; errorMm: number } {
    const t = (mesh.indices.length / 3) | 0;
    let best = p;
    let bestD = Infinity;
    for (let i = 0; i < t; i++) {
        const a = at(mesh, mesh.indices[i * 3] ?? 0);
        const b = at(mesh, mesh.indices[i * 3 + 1] ?? 0);
        const c = at(mesh, mesh.indices[i * 3 + 2] ?? 0);
        const q = closestOnTriangle(p, a, b, c);
        const d = dist(p, q);
        if (d < bestD) {
            bestD = d;
            best = q;
        }
    }
    return { point: best, errorMm: bestD };
}

function at(mesh: AfoTriMesh, i: number): AfoVec3 {
    return {
        x: mesh.positions[i * 3] ?? 0,
        y: mesh.positions[i * 3 + 1] ?? 0,
        z: mesh.positions[i * 3 + 2] ?? 0,
    };
}

function closestOnTriangle(p: AfoVec3, a: AfoVec3, b: AfoVec3, c: AfoVec3): AfoVec3 {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub(p, a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return a;
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return b;
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) return lerp(a, b, d1 / (d1 - d3 || 1));
    const cp = sub(p, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return c;
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) return lerp(a, c, d2 / (d2 - d6 || 1));
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return lerp(b, c, (d4 - d3) / (d4 - d3 + (d5 - d6) || 1));
    const denom = 1 / (va + vb + vc || 1);
    return add(a, add(scale(ab, vb * denom), scale(ac, vc * denom)));
}

function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function fitSurfaceSpline(mesh: AfoTriMesh, pins: AfoVec3[], spacingMm = 2): SurfaceSpline {
    const reasons: string[] = [];
    if (pins.length < 3) {
        return {
            ok: false,
            reasons: ["Need at least 3 trim pins."],
            curve: [],
            maxTurnDeg: 0,
            maxChordErrorMm: 0,
            maxSurfaceErrorMm: 0,
        };
    }
    const snapped = pins.map((p) => snapPointToMesh(mesh, p).point);
    const raw: AfoVec3[] = [];
    for (let i = 0; i < snapped.length; i++) {
        const a = snapped[i]!;
        const b = snapped[(i + 1) % snapped.length]!;
        const steps = Math.max(2, Math.ceil(dist(a, b) / spacingMm));
        for (let s = 0; s < steps; s++) raw.push(catmullRomClosed(snapped, s / steps, i));
    }
    const curve = raw.map((p) => closestOnMesh(mesh, p).point);
    let maxSurface = 0;
    for (const p of curve) maxSurface = Math.max(maxSurface, closestOnMesh(mesh, p).errorMm);
    let maxTurn = 0;
    let maxChord = 0;
    for (let i = 0; i < curve.length; i++) {
        const prev = curve[(i - 1 + curve.length) % curve.length]!;
        const cur = curve[i]!;
        const next = curve[(i + 1) % curve.length]!;
        const v1 = sub(cur, prev);
        const v2 = sub(next, cur);
        const l1 = len(v1) || 1;
        const l2 = len(v2) || 1;
        const c = Math.min(1, Math.max(-1, dot(v1, v2) / (l1 * l2)));
        maxTurn = Math.max(maxTurn, (Math.acos(c) * 180) / Math.PI);
        const mid = lerp(prev, next, 0.5);
        maxChord = Math.max(maxChord, dist(cur, mid));
    }
    if (maxTurn > 25) reasons.push(`Trim turning ${maxTurn.toFixed(1)}° exceeds 25°.`);
    if (maxChord > 0.5) reasons.push(`Chord error ${maxChord.toFixed(2)} mm exceeds 0.5 mm.`);
    if (maxSurface > 0.1) reasons.push(`Curve leaves the surface by ${maxSurface.toFixed(2)} mm.`);
    if (polylineSelfIntersects(curve) || segmentsCrowd(curve)) reasons.push("Trim loop self-intersects.");
    return {
        ok: reasons.length === 0,
        reasons,
        curve,
        maxTurnDeg: maxTurn,
        maxChordErrorMm: maxChord,
        maxSurfaceErrorMm: maxSurface,
    };
}

function segmentsCrowd(points: AfoVec3[]): boolean {
    const n = points.length;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        for (let j = i + 2; j < n; j++) {
            if (i === 0 && j >= n - 2) continue;
            const c = points[j]!;
            const d = points[(j + 1) % n]!;
            if (segmentDistance(a, b, c, d) < 0.2) return true;
        }
    }
    return false;
}

function segmentDistance(a: AfoVec3, b: AfoVec3, c: AfoVec3, d: AfoVec3): number {
    const samples = 4;
    let best = Infinity;
    for (let i = 0; i <= samples; i++) {
        const p = lerp(a, b, i / samples);
        for (let j = 0; j <= samples; j++) best = Math.min(best, dist(p, lerp(c, d, j / samples)));
    }
    return best;
}

export interface BalanceBrace {
    pins: AfoVec3[];
    reasons: string[];
}

/**
 * Low uprights, anterior edge ~10 mm in front of each malleolus, posterior
 * shell over the Achilles, top 110 mm above the malleoli, footplate to the
 * sulcus, heel cup at least 10 mm off the plantar plane.
 */
export function balanceBracePins(mesh: AfoTriMesh, afo: AfoDesignState): BalanceBrace {
    const reasons: string[] = [];
    const n = vertexCount(mesh);
    let yMax = -Infinity;
    let zMin = Infinity;
    let zMax = -Infinity;
    for (let i = 0; i < n; i++) {
        yMax = Math.max(yMax, mesh.positions[i * 3 + 1] ?? 0);
        zMin = Math.min(zMin, mesh.positions[i * 3 + 2] ?? 0);
        zMax = Math.max(zMax, mesh.positions[i * 3 + 2] ?? 0);
    }
    const med = afo.landmarks.find((l) => l.id === "malleolus_medial")?.point ?? { x: 25, y: 40, z: 70 };
    const lat = afo.landmarks.find((l) => l.id === "malleolus_lateral")?.point ?? { x: -25, y: 40, z: 70 };
    const midZ = (med.z + lat.z) * 0.5;
    const fib =
        afo.clinicalMarkers.find((m) => m.id === "fibular_head")?.point ??
        afo.scanWorkflow.landmarks.fibular_head;
    let topZ = midZ + 110;
    if (fib) topZ = Math.min(topZ, fib.z - 15);
    if (topZ - midZ < 100) reasons.push("Balance-brace top is under 100 mm above the malleoli.");
    const distal = afo.landmarks.find((l) => l.id === "distal")?.point ?? {
        x: 0,
        y: yMax * 0.72,
        z: zMin + 18,
    };
    const heelZ = Math.max(zMin + 10, 10);
    const pins = [
        { x: med.x, y: med.y + 10, z: topZ },
        { x: med.x, y: med.y + 10, z: med.z },
        { x: med.x * 0.6, y: 12, z: heelZ },
        distal,
        { x: lat.x * 0.6, y: 12, z: heelZ },
        { x: lat.x, y: lat.y + 10, z: lat.z },
        { x: lat.x, y: lat.y + 10, z: topZ },
        { x: 0, y: Math.min(med.y, lat.y) - 18, z: topZ },
    ].map((p) => snapPointToMesh(mesh, p).point);
    if (fib && topZ > fib.z - 15) reasons.push("Proximal pin is closer than 15 mm to the fibular head.");
    if (pins[2]!.z < zMin + 10 - 0.5 || pins[4]!.z < zMin + 10 - 0.5) {
        reasons.push("Heel cup edge is under 10 mm above the plantar plane.");
    }
    void zMax;
    return { pins, reasons };
}

export function landmarksFromPins(pins: AfoVec3[], mesh: AfoTriMesh): AfoLandmark[] {
    const ids = [
        "proximal_medial",
        "malleolus_medial",
        "distal",
        "malleolus_lateral",
        "proximal_lateral",
    ] as const;
    const pick = [0, 1, 3, 5, 6];
    return ids.map((id, i) => {
        const point = pins[pick[i]!] ?? pins[0]!;
        return { id, point, vertexIndex: nearestVertex(mesh, point).index };
    });
}
