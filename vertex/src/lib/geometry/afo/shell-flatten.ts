// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { correctionContextFromAfo } from "./corrections";
import { computeVertexNormals, vertexCount } from "./mesh-ops";
import type { AfoDesignState, AfoFlatPlateSpec, AfoTriMesh, AfoVec3 } from "./types";

/**
 * Blend the flat inner forefoot back into the arch, behind the met line.
 * Not a UI control. Flatness itself is always on for Generate shell.
 */
export const AFO_FOREFOOT_BLEND_MM = 22;

/** Inner forefoot, forward of the met line, stays within this of the contact plane. */
export const AFO_FOREFOOT_PLANAR_MM = 0.1;

export interface AfoContactPlanes {
    /** A point on the contact plane (the plantar heel landmark). */
    origin: AfoVec3;
    /** Unit normal, pointing up (away from the belt). */
    normal: AfoVec3;
    heel: AfoVec3;
    m1: AfoVec3;
    m5: AfoVec3;
    /** Unit vector in the plane, perpendicular to the met line, toward the toes. */
    forward: AfoVec3;
    /** Unit vector along the met line from M1 toward M5, projected into the plane. */
    along: AfoVec3;
    thicknessMm: number;
    blendBehindMm: number;
}

/** Inner-surface lock produced before the shell is thickened. */
export interface FlatPlateLock {
    planes: AfoContactPlanes;
    /** 1 = this inner vertex is on the flat forefoot or the arch blend. */
    flat: Uint8Array;
    /** 1 = the paired outer vertex lies on the bottom plane. */
    sole: Uint8Array;
    /** Target height above the contact plane. Meaningful where `flat` is 1. */
    targetH: Float32Array;
}

/**
 * Contact plane through the plantar heel, M1, and M5.
 * The bottom plane is parallel and exactly one selected thickness below.
 * A low mesh vertex is not an input.
 */
export function contactPlanesFromLandmarks(spec: AfoFlatPlateSpec): AfoContactPlanes {
    const heel = spec.heel;
    const m1 = spec.m1;
    const m5 = spec.m5;
    const thicknessMm = spec.thicknessMm;
    if (!(thicknessMm > 0)) {
        throw new Error("Plate thickness must be the selected shell thickness.");
    }
    let normal = cross(sub(m1, heel), sub(m5, heel));
    const nl = len(normal);
    if (nl < 1e-4) {
        throw new Error("Plantar landmarks are collinear; the contact plane is undefined.");
    }
    normal = scale(normal, 1 / nl);
    const hint = spec.upHint && len(spec.upHint) > 1e-6 ? spec.upHint : { x: 0, y: 0, z: 1 };
    if (dot(normal, hint) < 0) normal = scale(normal, -1);

    let along = sub(m5, m1);
    along = sub(along, scale(normal, dot(along, normal)));
    const al = len(along);
    if (al < 1e-4) {
        throw new Error("M1 and M5 do not define a metatarsal line.");
    }
    along = scale(along, 1 / al);

    let forward = cross(normal, along);
    const fl = len(forward);
    if (fl < 1e-8) {
        throw new Error("The metatarsal line does not define a toe direction.");
    }
    forward = scale(forward, 1 / fl);
    const mid = scale(add(m1, m5), 0.5);
    if (dot(sub(heel, mid), forward) > 0) forward = scale(forward, -1);

    return {
        origin: { x: heel.x, y: heel.y, z: heel.z },
        normal,
        heel: { ...heel },
        m1: { ...m1 },
        m5: { ...m5 },
        forward,
        along,
        thicknessMm,
        blendBehindMm: spec.blendBehindMm ?? AFO_FOREFOOT_BLEND_MM,
    };
}

/** Signed distance ahead of the angled M1–M5 line. Positive is the toe side. */
export function signedAheadOfMetLine(p: AfoVec3, planes: AfoContactPlanes): number {
    return dot(sub(p, planes.m1), planes.forward);
}

export function heightAboveContact(p: AfoVec3, planes: AfoContactPlanes): number {
    return dot(sub(p, planes.origin), planes.normal);
}

/** Height of the belt plane along the contact normal. Negative when up points away from the belt. */
export function bottomPlaneHeight(planes: AfoContactPlanes): number {
    return -planes.thicknessMm;
}

/**
 * Plantar landmarks in the working-mesh frame.
 * Scan-workflow points are unoriented and ride the alignment matrix.
 * Returns null when the tripod has not been placed.
 */
export function flatPlateSpecFromAfo(afo: AfoDesignState, thicknessMm: number): AfoFlatPlateSpec | null {
    const ctx = correctionContextFromAfo(afo);
    if (!ctx.heel || !ctx.m1 || !ctx.m5) return null;
    return {
        heel: ctx.heel,
        m1: ctx.m1,
        m5: ctx.m5,
        thicknessMm,
        blendBehindMm: AFO_FOREFOOT_BLEND_MM,
        upHint: { x: 0, y: 0, z: 1 },
    };
}

/**
 * Fields the shell consumes for flattening. A shell-input fingerprint
 * (cast, corrections, trim, thickness) should spread this in.
 */
export function afoFlatPlateInputFields(afo: AfoDesignState): {
    enabled: true;
    blendBehindMm: number;
    thicknessMm: number;
    edgeMm: number;
    heel: AfoVec3 | null;
    m1: AfoVec3 | null;
    m5: AfoVec3 | null;
} {
    const plantar = afo.scanWorkflow.plantar;
    return {
        enabled: true,
        blendBehindMm: AFO_FOREFOOT_BLEND_MM,
        thicknessMm: afo.print.thicknessMm,
        edgeMm: afo.print.edgeMm,
        heel: plantar.heel ?? null,
        m1: plantar.m1p ?? null,
        m5: plantar.m5p ?? null,
    };
}

/**
 * Flatten the inner forefoot of an open keep surface before it is thickened.
 * Forward of the angled met line the plantar sheet, including the toe rim, is
 * put on the contact plane. Behind the line it blends into the arch.
 * Heel-cup walls, malleoli, and the upper brace are left in place.
 */
export function flattenKeepSurface(
    positions: Float32Array,
    indices: Uint32Array,
    boundary: readonly number[],
    spec: AfoFlatPlateSpec,
): FlatPlateLock {
    const planes = contactPlanesFromLandmarks(spec);
    const n = (positions.length / 3) | 0;
    const mesh: AfoTriMesh = { positions, indices };
    const normals = computeVertexNormals(mesh);
    const ahead = new Float32Array(n);
    const height = new Float32Array(n);
    const up = planes.normal;
    for (let i = 0; i < n; i++) {
        const p = at(positions, i);
        ahead[i] = signedAheadOfMetLine(p, planes);
        height[i] = heightAboveContact(p, planes);
    }
    const ndot = (i: number) =>
        (normals[i * 3] ?? 0) * up.x + (normals[i * 3 + 1] ?? 0) * up.y + (normals[i * 3 + 2] ?? 0) * up.z;

    const plantar = new Uint8Array(n);
    const queue: number[] = [];
    for (let i = 0; i < n; i++) {
        const h = height[i] ?? 0;
        if (h < 16 && h > -12 && ndot(i) < -0.2) {
            plantar[i] = 1;
            queue.push(i);
        }
    }
    const adj = adjacency(indices, n);
    const boundarySet = new Set(boundary);
    const blend = planes.blendBehindMm;
    for (let q = 0; q < queue.length; q++) {
        const u = queue[q]!;
        for (const v of adj[u] ?? []) {
            if (plantar[v]) continue;
            const h = height[v] ?? 0;
            const nd = ndot(v);
            const a = ahead[v] ?? 0;
            if (h > 46 || h < -20) continue;
            if (h > 20 && nd > 0.05) continue;
            const nearPlate = a > -blend - 8;
            const lip = nearPlate && h < 40 && nd < 0.85;
            const stillSole = nd < -0.05 && h < 24;
            const toeEdge = boundarySet.has(v) && a > -blend && h < 42;
            if (stillSole || lip || toeEdge) {
                plantar[v] = 1;
                queue.push(v);
            }
        }
    }

    const flat = new Uint8Array(n);
    const sole = new Uint8Array(n);
    const targetH = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const h = height[i] ?? 0;
        const nd = ndot(i);
        if (nd < -0.35 && h < 22 && h > -8) sole[i] = 1;
        if (!plantar[i]) continue;
        const a = ahead[i] ?? 0;
        if (a <= -blend || h > 42) continue;
        flat[i] = 1;
        sole[i] = 1;
        const t = a >= 0 ? 1 : smoothstep((a + blend) / blend);
        targetH[i] = a >= 0 ? 0 : h * (1 - t);
    }

    for (let i = 0; i < n; i++) {
        if (!flat[i]) continue;
        placeAtHeight(positions, i, planes, targetH[i] ?? 0);
    }

    return { planes, flat, sole, targetH };
}

/**
 * Put flattened inner vertices back on their target height after flare and
 * lip repair. The upper trim is not in `lock.flat`, so it stays.
 */
export function reseatInnerForefoot(shell: AfoTriMesh, lock: FlatPlateLock): void {
    const n = shell.outerVertex0 ?? vertexCount(shell);
    const limit = Math.min(n, lock.flat.length);
    for (let i = 0; i < limit; i++) {
        if (!lock.flat[i]) continue;
        placeAtHeight(shell.positions, i, lock.planes, lock.targetH[i] ?? 0);
    }
}

/** Translate so the bottom plane lies on Z = 0. Rotation is only the plantar normal onto +Z. */
export function seatBottomPlaneAtZ0(shell: AfoTriMesh, planes: AfoContactPlanes): AfoContactPlanes {
    const up = { x: 0, y: 0, z: 1 };
    const axis = cross(planes.normal, up);
    const axisLen = len(axis);
    const cos = Math.min(1, Math.max(-1, dot(planes.normal, up)));
    const angle = Math.atan2(axisLen, cos);
    const origin = planes.origin;
    if (angle > 1e-6 && axisLen > 1e-8) {
        const unitAxis = scale(axis, 1 / axisLen);
        rotatePositions(shell.positions, origin, unitAxis, angle);
    }
    const seatedOrigin = rotatePoint(origin, origin, axisLen > 1e-8 ? scale(axis, 1 / axisLen) : up, angle);
    const bottomZ = seatedOrigin.z - planes.thicknessMm;
    if (Number.isFinite(bottomZ) && Math.abs(bottomZ) > 1e-9) {
        const n = (shell.positions.length / 3) | 0;
        for (let i = 0; i < n; i++) {
            shell.positions[i * 3 + 2] = (shell.positions[i * 3 + 2] ?? 0) - bottomZ;
        }
    }
    const dz = Number.isFinite(bottomZ) ? bottomZ : 0;
    return {
        ...planes,
        origin: { x: seatedOrigin.x, y: seatedOrigin.y, z: seatedOrigin.z - dz },
        normal: { x: 0, y: 0, z: 1 },
        forward: horizontalUnit(
            rotatePoint(
                add(origin, planes.forward),
                origin,
                axisLen > 1e-8 ? scale(axis, 1 / axisLen) : up,
                angle,
            ),
            seatedOrigin,
        ),
        along: horizontalUnit(
            rotatePoint(
                add(origin, planes.along),
                origin,
                axisLen > 1e-8 ? scale(axis, 1 / axisLen) : up,
                angle,
            ),
            seatedOrigin,
        ),
        heel: translateZ(
            rotatePoint(planes.heel, origin, axisLen > 1e-8 ? scale(axis, 1 / axisLen) : up, angle),
            -dz,
        ),
        m1: translateZ(
            rotatePoint(planes.m1, origin, axisLen > 1e-8 ? scale(axis, 1 / axisLen) : up, angle),
            -dz,
        ),
        m5: translateZ(
            rotatePoint(planes.m5, origin, axisLen > 1e-8 ? scale(axis, 1 / axisLen) : up, angle),
            -dz,
        ),
    };
}

function horizontalUnit(p: AfoVec3, origin: AfoVec3): AfoVec3 {
    const v = { x: p.x - origin.x, y: p.y - origin.y, z: 0 };
    const l = len(v) || 1;
    return scale(v, 1 / l);
}

function translateZ(p: AfoVec3, dz: number): AfoVec3 {
    return { x: p.x, y: p.y, z: p.z + dz };
}

function placeAtHeight(
    positions: Float32Array,
    index: number,
    planes: AfoContactPlanes,
    hTarget: number,
): void {
    const p = at(positions, index);
    const h = heightAboveContact(p, planes);
    const d = hTarget - h;
    positions[index * 3] = p.x + planes.normal.x * d;
    positions[index * 3 + 1] = p.y + planes.normal.y * d;
    positions[index * 3 + 2] = p.z + planes.normal.z * d;
}

function rotatePositions(positions: Float32Array, origin: AfoVec3, axis: AfoVec3, angle: number): void {
    const n = (positions.length / 3) | 0;
    for (let i = 0; i < n; i++) {
        const p = rotatePoint(at(positions, i), origin, axis, angle);
        positions[i * 3] = p.x;
        positions[i * 3 + 1] = p.y;
        positions[i * 3 + 2] = p.z;
    }
}

function rotatePoint(p: AfoVec3, origin: AfoVec3, axis: AfoVec3, angle: number): AfoVec3 {
    if (Math.abs(angle) < 1e-8) return { ...p };
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const vx = p.x - origin.x;
    const vy = p.y - origin.y;
    const vz = p.z - origin.z;
    const cx = axis.y * vz - axis.z * vy;
    const cy = axis.z * vx - axis.x * vz;
    const cz = axis.x * vy - axis.y * vx;
    const d = axis.x * vx + axis.y * vy + axis.z * vz;
    return {
        x: origin.x + vx * c + cx * s + axis.x * d * (1 - c),
        y: origin.y + vy * c + cy * s + axis.y * d * (1 - c),
        z: origin.z + vz * c + cz * s + axis.z * d * (1 - c),
    };
}

function adjacency(indices: Uint32Array, n: number): number[][] {
    const adj: number[][] = Array.from({ length: n }, () => []);
    const add = (a: number, b: number) => {
        if (a < 0 || b < 0 || a >= n || b >= n) return;
        if (!adj[a]!.includes(b)) adj[a]!.push(b);
        if (!adj[b]!.includes(a)) adj[b]!.push(a);
    };
    const t = (indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const a = indices[i * 3] ?? 0;
        const b = indices[i * 3 + 1] ?? 0;
        const c = indices[i * 3 + 2] ?? 0;
        add(a, b);
        add(b, c);
        add(c, a);
    }
    return adj;
}

function at(positions: Float32Array, i: number): AfoVec3 {
    return {
        x: positions[i * 3] ?? 0,
        y: positions[i * 3 + 1] ?? 0,
        z: positions[i * 3 + 2] ?? 0,
    };
}

function smoothstep(t: number): number {
    const x = Math.min(1, Math.max(0, t));
    return x * x * (3 - 2 * x);
}

function add(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: AfoVec3, s: number): AfoVec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function len(a: AfoVec3): number {
    return Math.hypot(a.x, a.y, a.z);
}
