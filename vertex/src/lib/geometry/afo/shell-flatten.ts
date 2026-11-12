// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { analyzeManifoldBuffers } from "@/lib/geometry/manifold-core";
import { correctionContextFromAfo } from "./corrections";
import { computeVertexNormals, vertexCount } from "./mesh-ops";
import { countTriangleSelfIntersections } from "./self-intersection";
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
const plateLocks = new WeakMap<AfoTriMesh, FlatPlateLock>();

export function rememberFlatPlate(shell: AfoTriMesh, lock: FlatPlateLock): void {
    plateLocks.set(shell, lock);
}

export function flatPlateLockOf(shell: AfoTriMesh): FlatPlateLock | undefined {
    return plateLocks.get(shell);
}

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
        if (nd < -0.6 && h < 18 && h > -8) sole[i] = 1;
        if (!plantar[i]) continue;
        const a = ahead[i] ?? 0;
        if (a <= -blend || h > 42) continue;
        flat[i] = 1;
        if (h < 14) sole[i] = 1;
        const t = a >= 0 ? 1 : smoothstep((a + blend) / blend);
        // The blend eases to the arch. A dip below the contact plane is filled, not kept.
        targetH[i] = a >= 0 ? 0 : Math.max(0, h * (1 - t));
    }

    for (let i = 0; i < n; i++) {
        if (flat[i]) {
            placeAtHeight(positions, i, planes, targetH[i] ?? 0);
            continue;
        }
        if (heightAboveContact(at(positions, i), planes) < 0) placeAtHeight(positions, i, planes, 0);
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

/**
 * Inner forefoot back on its blend, sole outer skin on the bottom plane
 * (exactly one selected thickness below the contact plane), and the sole rim
 * pulled onto those rulings so the toe lip cannot stay curled.
 */
export function reseatFlatPlate(shell: AfoTriMesh, lock: FlatPlateLock): void {
    reseatInnerForefoot(shell, lock);
    const n = shell.outerVertex0;
    if (n == null) return;
    for (let i = 0; i < n; i++) {
        if (lock.flat[i]) continue;
        if (heightAboveContact(at(shell.positions, i), lock.planes) < 0) {
            placeAtHeight(shell.positions, i, lock.planes, 0);
        }
    }
    const bottom = -lock.planes.thicknessMm;
    const limit = Math.min(n, lock.sole.length);
    for (let i = 0; i < limit; i++) {
        if (!lock.sole[i]) continue;
        const inner = at(shell.positions, i);
        const drop = bottom - heightAboveContact(inner, lock.planes);
        const up = lock.planes.normal;
        const o = n + i;
        shell.positions[o * 3] = inner.x + up.x * drop;
        shell.positions[o * 3 + 1] = inner.y + up.y * drop;
        shell.positions[o * 3 + 2] = inner.z + up.z * drop;
    }
}

export interface FlatPlateValidation {
    openEdges: number;
    nonManifoldEdges: number;
    degenerateFaces: number;
    invertedEdges: number;
    selfIntersections: number;
    forefootPlanarityMm: number;
    bottomPlanarityMm: number;
    plateMinMm: number;
    plateMaxMm: number;
    minWallMm: number;
    footprintComponents: number;
    footprintHoles: number;
    footprintAreaMm2: number;
    toeLipMm: number;
    soleCount: number;
}

/** Closed-solid checks for the finished flat plate. Connectivity alone is not enough. */
export function validateFlatPlate(
    shell: AfoTriMesh,
    lock: FlatPlateLock,
    edgeMm: number,
): FlatPlateValidation {
    const report = analyzeManifoldBuffers(shell.positions, shell.indices);
    const winding = faceWinding(shell);
    const n = shell.outerVertex0 ?? 0;
    const planes = lock.planes;
    let fore = 0;
    let bottom = 0;
    let plateMin = Infinity;
    let plateMax = 0;
    let toeLip = 0;
    let soleCount = 0;
    for (let i = 0; i < n && i < lock.flat.length; i++) {
        const inner = at(shell.positions, i);
        const ahead = signedAheadOfMetLine(inner, planes);
        const h = heightAboveContact(inner, planes);
        if (lock.flat[i] && ahead > 0.5) {
            fore = Math.max(fore, Math.abs(h));
            toeLip = Math.max(toeLip, Math.abs(h));
        }
        if (!lock.sole[i]) continue;
        soleCount++;
        const outer = at(shell.positions, n + i);
        const ho = heightAboveContact(outer, planes);
        const gap = h - ho;
        if (ahead > 0.5 && Math.abs(h) < 0.4) {
            bottom = Math.max(bottom, Math.abs(ho + planes.thicknessMm));
            plateMin = Math.min(plateMin, gap);
            plateMax = Math.max(plateMax, gap);
        }
    }
    const foot = soleFootprint(shell, lock, n);
    return {
        openEdges: report.openEdges,
        nonManifoldEdges: report.nonManifoldEdges,
        degenerateFaces: winding.degenerate,
        invertedEdges: winding.inverted,
        selfIntersections: countTriangleSelfIntersections(shell),
        forefootPlanarityMm: fore,
        bottomPlanarityMm: bottom,
        plateMinMm: Number.isFinite(plateMin) ? plateMin : 0,
        plateMaxMm: plateMax,
        minWallMm: minWallMm(shell, n, edgeMm),
        footprintComponents: foot.components,
        footprintHoles: foot.holes,
        footprintAreaMm2: foot.areaMm2,
        toeLipMm: toeLip,
        soleCount,
    };
}

function faceWinding(shell: AfoTriMesh): { degenerate: number; inverted: number } {
    const t = (shell.indices.length / 3) | 0;
    const dir = new Map<string, number>();
    let degenerate = 0;
    for (let i = 0; i < t; i++) {
        const a = shell.indices[i * 3] ?? 0;
        const b = shell.indices[i * 3 + 1] ?? 0;
        const c = shell.indices[i * 3 + 2] ?? 0;
        const pa = at(shell.positions, a);
        const pb = at(shell.positions, b);
        const pc = at(shell.positions, c);
        const area = Math.hypot(
            (pb.y - pa.y) * (pc.z - pa.z) - (pb.z - pa.z) * (pc.y - pa.y),
            (pb.z - pa.z) * (pc.x - pa.x) - (pb.x - pa.x) * (pc.z - pa.z),
            (pb.x - pa.x) * (pc.y - pa.y) - (pb.y - pa.y) * (pc.x - pa.x),
        );
        if (area < 1e-6) degenerate++;
        for (const [u, v] of [
            [a, b],
            [b, c],
            [c, a],
        ] as const) {
            const k = `${u}>${v}`;
            dir.set(k, (dir.get(k) ?? 0) + 1);
        }
    }
    let inverted = 0;
    for (const count of dir.values()) if (count >= 2) inverted += count - 1;
    return { degenerate, inverted };
}

function minWallMm(shell: AfoTriMesh, n: number, edgeMm: number): number {
    const innerFaces: number[] = [];
    const t = (shell.indices.length / 3) | 0;
    for (let i = 0; i < t; i++) {
        const a = shell.indices[i * 3] ?? 0;
        const b = shell.indices[i * 3 + 1] ?? 0;
        const c = shell.indices[i * 3 + 2] ?? 0;
        if (a < n && b < n && c < n) innerFaces.push(i);
    }
    let min = Infinity;
    const total = Math.min((shell.positions.length / 3) | 0, n * 2);
    const step = total > 4000 ? 2 : 1;
    for (let v = n; v < total; v += step) {
        const p = at(shell.positions, v);
        let best = Infinity;
        for (const f of innerFaces) {
            const d = pointTriDistance(
                p,
                at(shell.positions, shell.indices[f * 3] ?? 0),
                at(shell.positions, shell.indices[f * 3 + 1] ?? 0),
                at(shell.positions, shell.indices[f * 3 + 2] ?? 0),
            );
            if (d < best) best = d;
            if (best < edgeMm * 0.5) break;
        }
        if (best < min) min = best;
    }
    return Number.isFinite(min) ? min : 0;
}

function pointTriDistance(p: AfoVec3, a: AfoVec3, b: AfoVec3, c: AfoVec3): number {
    const ab = sub(b, a);
    const ac = sub(c, a);
    const ap = sub(p, a);
    const d1 = dot(ab, ap);
    const d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return len(ap);
    const bp = sub(p, b);
    const d3 = dot(ab, bp);
    const d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return len(bp);
    const vc = d1 * d4 - d3 * d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        const v = d1 / (d1 - d3);
        return len(sub(p, add(a, scale(ab, v))));
    }
    const cp = sub(p, c);
    const d5 = dot(ab, cp);
    const d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return len(cp);
    const vb = d5 * d2 - d1 * d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        return len(sub(p, add(a, scale(ac, w))));
    }
    const va = d3 * d6 - d5 * d4;
    if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
        const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
        return len(sub(p, add(b, scale(sub(c, b), w))));
    }
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    return len(sub(p, add(a, add(scale(ab, v), scale(ac, w)))));
}

function soleFootprint(
    shell: AfoTriMesh,
    lock: FlatPlateLock,
    n: number,
): { components: number; holes: number; areaMm2: number } {
    const cell = 2;
    const occupied = new Set<string>();
    const t = (shell.indices.length / 3) | 0;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const onSole = (v: number) => v >= n && v < n * 2 && lock.sole[v - n] === 1;
    for (let i = 0; i < t; i++) {
        const a = shell.indices[i * 3] ?? 0;
        const b = shell.indices[i * 3 + 1] ?? 0;
        const c = shell.indices[i * 3 + 2] ?? 0;
        if (!onSole(a) || !onSole(b) || !onSole(c)) continue;
        const pa = at(shell.positions, a);
        const pb = at(shell.positions, b);
        const pc = at(shell.positions, c);
        const x0 = Math.min(pa.x, pb.x, pc.x);
        const x1 = Math.max(pa.x, pb.x, pc.x);
        const y0 = Math.min(pa.y, pb.y, pc.y);
        const y1 = Math.max(pa.y, pb.y, pc.y);
        for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) {
            for (let y = Math.floor(y0 / cell); y <= Math.floor(y1 / cell); y++) {
                const cx = (x + 0.5) * cell;
                const cy = (y + 0.5) * cell;
                if (!pointInTri(cx, cy, pa, pb, pc)) continue;
                occupied.add(`${x}|${y}`);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    const components = floodCount(occupied);
    let holes = 0;
    if (occupied.size > 0) {
        const outside = new Set<string>();
        const stack: Array<[number, number]> = [];
        const push = (x: number, y: number) => {
            const k = `${x}|${y}`;
            if (x < minX || x > maxX || y < minY || y > maxY) return;
            if (occupied.has(k) || outside.has(k)) return;
            outside.add(k);
            stack.push([x, y]);
        };
        for (let x = minX; x <= maxX; x++) {
            push(x, minY);
            push(x, maxY);
        }
        for (let y = minY; y <= maxY; y++) {
            push(minX, y);
            push(maxX, y);
        }
        while (stack.length) {
            const [x, y] = stack.pop()!;
            push(x + 1, y);
            push(x - 1, y);
            push(x, y + 1);
            push(x, y - 1);
        }
        const interior = new Set<string>();
        for (let x = minX; x <= maxX; x++) {
            for (let y = minY; y <= maxY; y++) {
                const k = `${x}|${y}`;
                if (!occupied.has(k) && !outside.has(k)) interior.add(k);
            }
        }
        holes = floodCount(interior);
    }
    return { components, holes, areaMm2: occupied.size * cell * cell };
}

function floodCount(cells: Set<string>): number {
    const seen = new Set<string>();
    let components = 0;
    for (const start of cells) {
        if (seen.has(start)) continue;
        components++;
        const stack = [start];
        seen.add(start);
        while (stack.length) {
            const cur = stack.pop()!;
            const [xs, ys] = cur.split("|");
            const x = Number(xs);
            const y = Number(ys);
            for (const nxt of [`${x + 1}|${y}`, `${x - 1}|${y}`, `${x}|${y + 1}`, `${x}|${y - 1}`]) {
                if (!cells.has(nxt) || seen.has(nxt)) continue;
                seen.add(nxt);
                stack.push(nxt);
            }
        }
    }
    return components;
}

function pointInTri(x: number, y: number, a: AfoVec3, b: AfoVec3, c: AfoVec3): boolean {
    const sign = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
        (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    const d1 = sign(x, y, a.x, a.y, b.x, b.y);
    const d2 = sign(x, y, b.x, b.y, c.x, c.y);
    const d3 = sign(x, y, c.x, c.y, a.x, a.y);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
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
