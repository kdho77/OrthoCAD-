// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { medialSign } from "@/lib/geometry/handedness";
import {
    AFO_FLAT_TRIM_BLEND_MM,
    AFO_FLAT_TRIM_HEEL_INSET_MM,
    AFO_FLAT_TRIM_LATERAL_INSET_RATIO,
    AFO_FLAT_TRIM_MEDIAL_INSET_MM,
    AFO_FLAT_TRIM_MIN_RADIUS_MM,
    AFO_FLAT_TRIM_TOE_INSET_MM,
    AFO_TRIM_DISPLAY_NORMAL_MM,
    AFO_TRIM_DRAW_OFFSET_MM,
    AFO_TRIM_PLANE_MAX_MM,
    AFO_TRIM_PROJECT_MAX_MM,
    AFO_TRIM_SAMPLE_MAX_MM,
    AFO_TRIM_SAMPLE_MM,
} from "./defaults";
import { type MeshProjector, meshProjector, nearestVertex, vertexCount } from "./mesh-ops";
import { contactPlanesFromLandmarks, heightAboveContact } from "./shell-flatten";
import { polylineSelfIntersects } from "./trim-loop";
import type {
    AfoDesignState,
    AfoFlatPlateSpec,
    AfoLandmark,
    AfoTriMesh,
    AfoTrimPoint,
    AfoVec3,
} from "./types";

export interface SurfaceSpline {
    ok: boolean;
    reasons: string[];
    /** Curve samples on the mesh. */
    curve: AfoVec3[];
    /** Same samples lifted ~0.3 mm along the normal for drawing. */
    display: AfoVec3[];
    /** One array per pin-to-pin span. Clean spans keep their identity across a local drag. */
    segments: AfoVec3[][];
    maxTurnDeg: number;
    maxChordErrorMm: number;
    maxSurfaceErrorMm: number;
}

export interface SurfaceSplineFitOptions {
    spacingMm?: number;
    /** Closed loop. Open placement still projects a contour through the pins. */
    closed?: boolean;
    /** Recompute only the spans that use this pin. */
    dragIndex?: number;
    previousSegments?: AfoVec3[][];
    /** Skip the dense self-intersection sweep (live hover). */
    quick?: boolean;
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
    const face = meshProjector(mesh).closest(p);
    const vertex = nearestVertex(mesh, face.point);
    return { point: face.point, vertexIndex: vertex.index, errorMm: face.errorMm };
}

/**
 * Accept a front-face hit. The stored pin is the surface point, never a vertex id.
 * A miss farther than 3 mm is rejected. Between 3 mm and 5 mm, a local plane of
 * nearby vertices is used. Farther than that, the click is dropped.
 */
export function acceptTrimHit(mesh: AfoTriMesh, hit: AfoVec3): AfoVec3 | null {
    const near = meshProjector(mesh).closest(hit);
    if (near.errorMm <= AFO_TRIM_PROJECT_MAX_MM) return near.point;
    if (near.errorMm > AFO_TRIM_PLANE_MAX_MM) return null;
    return localPlaneFit(mesh, hit, AFO_TRIM_PLANE_MAX_MM);
}

export function trimPinFromHit(mesh: AfoTriMesh, hit: AfoVec3): AfoTrimPoint | null {
    const point = acceptTrimHit(mesh, hit);
    if (!point) return null;
    return { point, vertexIndex: nearestVertex(mesh, point).index };
}

/** Move stored pins back onto the mesh. Pins already within 0.1 mm stay put. */
export function reprojectTrimPins(mesh: AfoTriMesh, pins: AfoTrimPoint[]): AfoTrimPoint[] {
    const projector = meshProjector(mesh);
    return pins.map((pin) => {
        const face = projector.closest(pin.point);
        if (face.errorMm > AFO_TRIM_PLANE_MAX_MM) return pin;
        const point = face.errorMm <= 0.1 ? pin.point : face.point;
        return { point, vertexIndex: nearestVertex(mesh, point).index };
    });
}

function localPlaneFit(mesh: AfoTriMesh, p: AfoVec3, radiusMm: number): AfoVec3 | null {
    const n = vertexCount(mesh);
    const found: AfoVec3[] = [];
    const r2 = radiusMm * radiusMm;
    let nearest = Infinity;
    for (let i = 0; i < n; i++) {
        const v = {
            x: mesh.positions[i * 3] ?? 0,
            y: mesh.positions[i * 3 + 1] ?? 0,
            z: mesh.positions[i * 3 + 2] ?? 0,
        };
        const d2 = dist(v, p) ** 2;
        if (d2 < nearest) nearest = d2;
        if (d2 <= r2) found.push(v);
        if (found.length >= 24) break;
    }
    if (Math.sqrt(nearest) > AFO_TRIM_PROJECT_MAX_MM && found.length < 3) return null;
    if (found.length < 3) return null;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const c = { x: 0, y: 0, z: 0 };
    for (const v of found) {
        c.x += v.x;
        c.y += v.y;
        c.z += v.z;
    }
    c.x /= found.length;
    c.y /= found.length;
    c.z /= found.length;
    for (let i = 0; i < found.length; i++) {
        const a = found[i]!;
        const b = found[(i + 1) % found.length]!;
        nx += (a.y - b.y) * (a.z + b.z);
        ny += (a.z - b.z) * (a.x + b.x);
        nz += (a.x - b.x) * (a.y + b.y);
    }
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-8) return null;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const signed = nx * (p.x - c.x) + ny * (p.y - c.y) + nz * (p.z - c.z);
    return { x: p.x - nx * signed, y: p.y - ny * signed, z: p.z - nz * signed };
}

function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Segments whose centripetal span uses `dragIndex` (four spans on a closed loop). */
export function affectedTrimSegments(pinCount: number, dragIndex: number, closed = true): number[] {
    const n = pinCount;
    if (n < 2 || dragIndex < 0 || dragIndex >= n) return [];
    const segCount = closed ? n : n - 1;
    const out: number[] = [];
    for (const k of [-2, -1, 0, 1]) {
        const seg = (dragIndex + k + n) % n;
        if (seg >= 0 && seg < segCount && !out.includes(seg)) out.push(seg);
    }
    return out;
}

function emptySpline(reasons: string[]): SurfaceSpline {
    return {
        ok: false,
        reasons,
        curve: [],
        display: [],
        segments: [],
        maxTurnDeg: 0,
        maxChordErrorMm: 0,
        maxSurfaceErrorMm: 0,
    };
}

/** Centripetal Catmull-Rom (alpha 0.5) between p1 and p2. */
export function centripetalCatmullRom(
    p0: AfoVec3,
    p1: AfoVec3,
    p2: AfoVec3,
    p3: AfoVec3,
    t: number,
    alpha = 0.5,
): AfoVec3 {
    const knot = (ti: number, a: AfoVec3, b: AfoVec3) => ti + Math.max(1e-4, dist(a, b)) ** alpha;
    const t0 = 0;
    const t1 = knot(t0, p0, p1);
    const t2 = knot(t1, p1, p2);
    const t3 = knot(t2, p2, p3);
    const tt = t1 + (t2 - t1) * Math.min(1, Math.max(0, t));
    const mix = (a: AfoVec3, b: AfoVec3, ta: number, tb: number, tc: number) => {
        const den = tb - ta || 1e-4;
        return lerp(a, b, (tc - ta) / den);
    };
    const a1 = mix(p0, p1, t0, t1, tt);
    const a2 = mix(p1, p2, t1, t2, tt);
    const a3 = mix(p2, p3, t2, t3, tt);
    const b1 = mix(a1, a2, t0, t2, tt);
    const b2 = mix(a2, a3, t1, t3, tt);
    return mix(b1, b2, t1, t2, tt);
}

function resolveFitOptions(
    spacingOrOptions: number | SurfaceSplineFitOptions,
): Required<Pick<SurfaceSplineFitOptions, "spacingMm" | "closed" | "quick">> & SurfaceSplineFitOptions {
    if (typeof spacingOrOptions === "number") {
        return { spacingMm: spacingOrOptions, closed: true, quick: false };
    }
    return {
        spacingMm: spacingOrOptions.spacingMm ?? AFO_TRIM_SAMPLE_MM,
        closed: spacingOrOptions.closed ?? true,
        quick: spacingOrOptions.quick ?? false,
        dragIndex: spacingOrOptions.dragIndex,
        previousSegments: spacingOrOptions.previousSegments,
    };
}

export function fitSurfaceSpline(
    mesh: AfoTriMesh,
    pins: AfoVec3[],
    spacingOrOptions: number | SurfaceSplineFitOptions = AFO_TRIM_SAMPLE_MM,
): SurfaceSpline {
    const opts = resolveFitOptions(spacingOrOptions);
    const reasons: string[] = [];
    const closed = opts.closed && pins.length >= 3;
    if (pins.length < 2 || (opts.closed && pins.length < 3)) {
        return emptySpline(["Need at least 3 trim pins."]);
    }
    const projector = meshProjector(mesh);
    const snapped = dedupePins(pins.map((p) => snapPointToMesh(mesh, p).point));
    if (snapped.length < 2 || (closed && snapped.length < 3)) {
        return emptySpline(["Need at least 3 trim pins."]);
    }
    const spacing = Math.min(AFO_TRIM_SAMPLE_MAX_MM, Math.max(0.2, opts.spacingMm));
    const segCount = closed ? snapped.length : snapped.length - 1;
    const dirty =
        opts.dragIndex == null ? null : new Set(affectedTrimSegments(snapped.length, opts.dragIndex, closed));
    const segments: AfoVec3[][] = [];
    for (let i = 0; i < segCount; i++) {
        const reused = dirty && !dirty.has(i) ? opts.previousSegments?.[i] : undefined;
        if (reused && reused.length >= 2) segments.push(reused);
        else segments.push(sampleSegment(snapped, i, closed, spacing, projector));
    }
    const counts = segments.map((seg) => seg.length);
    const flat: AfoVec3[] = [];
    for (const seg of segments) for (const p of seg) flat.push(p);
    const dirtyIndex = dirtyIndexSet(counts, dirty);
    const pinLocks = new Set<number>();
    {
        let offset = 0;
        for (const count of counts) {
            pinLocks.add(offset);
            offset += count;
        }
    }
    const smoothed = smoothAndReproject(flat, projector, dirtyIndex, closed, pinLocks);
    if (smoothed.curve.length < 2) return emptySpline(["Need at least 3 trim pins."]);
    const spaced = enforceSpacing(smoothed.curve, AFO_TRIM_SAMPLE_MAX_MM, projector, closed);
    const relaxed = relaxSurfaceKinks(spaced, projector, snapped, closed);
    const curve = enforceSpacing(relaxed, AFO_TRIM_SAMPLE_MAX_MM, projector, closed);
    let maxSurface = 0;
    for (const p of curve) maxSurface = Math.max(maxSurface, projector.closest(p).errorMm);
    let maxTurn = 0;
    let maxChord = 0;
    const turnCount = closed ? curve.length : Math.max(0, curve.length - 2);
    const corners = pinCornerSet(curve, snapped, closed);
    for (let i = 0; i < curve.length; i++) {
        const prev = curve[(i - 1 + curve.length) % curve.length]!;
        const cur = curve[i]!;
        const next = curve[(i + 1) % curve.length]!;
        if (!closed && (i === 0 || i === curve.length - 1)) continue;
        if (i >= turnCount && !closed) continue;
        // A placed pin is allowed to be a corner. The 25° / 0.5 mm limits
        // apply to the spans between pins, not to the pin itself.
        if (corners.has(i)) continue;
        const v1 = sub(cur, prev);
        const v2 = sub(next, cur);
        const l1 = len(v1) || 1;
        const l2 = len(v2) || 1;
        const c = Math.min(1, Math.max(-1, dot(v1, v2) / (l1 * l2)));
        maxTurn = Math.max(maxTurn, (Math.acos(c) * 180) / Math.PI);
        maxChord = Math.max(maxChord, dist(cur, lerp(prev, next, 0.5)));
    }
    if (closed && maxTurn > 25) reasons.push(`Trim turning ${maxTurn.toFixed(1)}° exceeds 25°.`);
    if (closed && maxChord > 0.5) reasons.push(`Chord error ${maxChord.toFixed(2)} mm exceeds 0.5 mm.`);
    if (maxSurface > 0.1) reasons.push(`Curve leaves the surface by ${maxSurface.toFixed(2)} mm.`);
    if (closed && !opts.quick && polylineSelfIntersects(curve)) {
        reasons.push("Trim loop self-intersects.");
    }
    const baked = resliceKeepingClean(smoothed.curve, counts, segments, dirty);
    const ring = closed && curve.length > 2 ? [...curve, { ...curve[0]! }] : curve;
    return {
        ok: reasons.length === 0 && (closed || snapped.length >= 2),
        reasons,
        curve: ring,
        display: offsetDisplay(projector, ring),
        segments: baked,
        maxTurnDeg: maxTurn,
        maxChordErrorMm: maxChord,
        maxSurfaceErrorMm: maxSurface,
    };
}

/** Pin corners, and the samples on either side of them, are not span limits. */
function pinCornerSet(curve: AfoVec3[], pins: AfoVec3[], closed: boolean): Set<number> {
    const skip = new Set<number>();
    const n = curve.length;
    const radius = 10;
    for (const pin of pins) {
        let best = -1;
        let bestD = Infinity;
        for (let i = 0; i < n; i++) {
            const d = dist(curve[i]!, pin);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
            if (d <= radius) skip.add(i);
        }
        if (best < 0 || n < 2) continue;
        skip.add(best);
        const prev = closed ? (best - 1 + n) % n : best - 1;
        const next = closed ? (best + 1) % n : best + 1;
        if (prev >= 0 && prev < n) skip.add(prev);
        if (next >= 0 && next < n) skip.add(next);
    }
    return skip;
}

function dedupePins(pins: AfoVec3[]): AfoVec3[] {
    const out: AfoVec3[] = [];
    for (const p of pins) {
        if (out.some((q) => dist(q, p) < 1)) continue;
        out.push(p);
    }
    return out;
}

function sampleSegment(
    pins: AfoVec3[],
    i: number,
    closed: boolean,
    spacing: number,
    projector: MeshProjector,
): AfoVec3[] {
    const n = pins.length;
    const at = (k: number) => pins[(k + n) % n]!;
    const p1 = at(i);
    const p2 = closed ? at(i + 1) : pins[i + 1]!;
    const p0 = closed ? at(i - 1) : i > 0 ? pins[i - 1]! : p1;
    const p3 = closed ? at(i + 2) : i + 2 < n ? pins[i + 2]! : p2;
    const chord = Math.max(dist(p1, p2), 0.5);
    const steps = Math.max(2, Math.ceil(chord / spacing));
    const raw: AfoVec3[] = [];
    for (let s = 0; s < steps; s++) raw.push(centripetalCatmullRom(p0, p1, p2, p3, s / steps));
    return projectChain(raw, spacing, projector);
}

function projectChain(raw: AfoVec3[], spacing: number, projector: MeshProjector): AfoVec3[] {
    const out: AfoVec3[] = [];
    const cap = Math.min(spacing, AFO_TRIM_SAMPLE_MAX_MM);
    const walk = (prevRaw: AfoVec3, sample: AfoVec3, depth: number) => {
        const prev = out.length ? out[out.length - 1]! : null;
        const hit = projector.project(sample, prev, cap);
        if (prev && dist(hit.point, prev) > cap && depth < 8) {
            const mid = lerp(prevRaw, sample, 0.5);
            if (dist(mid, prevRaw) > 1e-4 && dist(mid, sample) > 1e-4) {
                walk(prevRaw, mid, depth + 1);
                walk(mid, sample, depth + 1);
                return;
            }
        }
        if (!prev || dist(hit.point, prev) > 0.02) out.push(hit.point);
    };
    const first = raw[0];
    if (!first) return out;
    out.push(projector.project(first, null, cap).point);
    for (let i = 1; i < raw.length; i++) walk(raw[i - 1]!, raw[i]!, 0);
    return out;
}

/**
 * A sample more than 25° off the chord, while that chord still lies on the
 * mesh, is a spline kink rather than the surface. Pull it onto the chord.
 * Pin corners are left alone.
 */
function relaxSurfaceKinks(
    curve: AfoVec3[],
    projector: MeshProjector,
    pins: AfoVec3[],
    closed: boolean,
): AfoVec3[] {
    const cur = curve.map((p) => ({ ...p }));
    const corners = pinCornerSet(cur, pins, closed);
    const n = cur.length;
    for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        for (let i = 0; i < n; i++) {
            if (!closed && (i === 0 || i === n - 1)) continue;
            const prev = cur[(i - 1 + n) % n]!;
            const p = cur[i]!;
            const next = cur[(i + 1) % n]!;
            if (corners.has(i)) continue;
            const v1 = sub(p, prev);
            const v2 = sub(next, p);
            const l1 = len(v1) || 1;
            const l2 = len(v2) || 1;
            const c = Math.min(1, Math.max(-1, dot(v1, v2) / (l1 * l2)));
            if ((Math.acos(c) * 180) / Math.PI <= 25) continue;
            const mid = lerp(prev, next, 0.5);
            const hit = projector.closest(mid);
            if (hit.errorMm > 0.15 || dist(hit.point, p) < 0.01) continue;
            cur[i] = { ...hit.point };
            moved = true;
        }
        if (!moved) break;
    }
    return cur;
}

/** Insert reprojected midpoints until every step is within the 1 mm cap. */
function enforceSpacing(curve: AfoVec3[], cap: number, projector: MeshProjector, closed: boolean): AfoVec3[] {
    let cur = curve.map((p) => ({ ...p }));
    for (let pass = 0; pass < 8; pass++) {
        const next: AfoVec3[] = [];
        let grew = false;
        const n = cur.length;
        const limit = closed ? n : Math.max(0, n - 1);
        for (let i = 0; i < limit; i++) {
            const a = cur[i]!;
            const b = cur[(i + 1) % n]!;
            next.push(a);
            if (dist(a, b) > cap + 1e-4) {
                const mid = projector.project(lerp(a, b, 0.5), a, cap).point;
                if (dist(mid, a) > 0.05 && dist(mid, b) > 0.05) {
                    next.push(mid);
                    grew = true;
                }
            }
        }
        if (!closed && n > 0) next.push(cur[n - 1]!);
        cur = next;
        if (!grew) break;
    }
    return cur;
}

function dirtyIndexSet(counts: number[], dirty: Set<number> | null): Set<number> | null {
    if (!dirty) return null;
    const out = new Set<number>();
    let offset = 0;
    counts.forEach((count, seg) => {
        if (dirty.has(seg)) {
            for (let i = 0; i < count; i++) out.add(offset + i);
        }
        offset += count;
    });
    return out;
}

function smoothAndReproject(
    curve: AfoVec3[],
    projector: MeshProjector,
    dirty: Set<number> | null,
    closed: boolean,
    pinLocks: Set<number>,
): { curve: AfoVec3[] } {
    let cur = curve.map((p) => ({ ...p }));
    const rounds = 2;
    for (let r = 0; r < rounds; r++) {
        const next = cur.map((p) => ({ ...p }));
        const n = cur.length;
        for (let i = 0; i < n; i++) {
            if (pinLocks.has(i)) continue;
            if (dirty && !dirty.has(i)) continue;
            if (!closed && (i === 0 || i === n - 1)) continue;
            const prev = cur[(i - 1 + n) % n]!;
            const nxt = cur[(i + 1) % n]!;
            const blended = {
                x: cur[i]!.x * 0.5 + prev.x * 0.25 + nxt.x * 0.25,
                y: cur[i]!.y * 0.5 + prev.y * 0.25 + nxt.y * 0.25,
                z: cur[i]!.z * 0.5 + prev.z * 0.25 + nxt.z * 0.25,
            };
            next[i] = projector.project(blended, cur[i], AFO_TRIM_SAMPLE_MM).point;
        }
        cur = next;
    }
    return { curve: cur };
}

function resliceKeepingClean(
    curve: AfoVec3[],
    counts: number[],
    original: AfoVec3[][],
    dirty: Set<number> | null,
): AfoVec3[][] {
    const out: AfoVec3[][] = [];
    let offset = 0;
    counts.forEach((count, seg) => {
        if (dirty && !dirty.has(seg) && original[seg]) out.push(original[seg]!);
        else out.push(curve.slice(offset, offset + count).map((p) => ({ ...p })));
        offset += count;
    });
    return out;
}

function averagedDisplayNormal(projector: MeshProjector, curve: AfoVec3[], index: number): AfoVec3 {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const addAt = (i: number) => {
        const normal = projector.closest(curve[i] ?? curve[index]!).normal;
        sx += normal.x;
        sy += normal.y;
        sz += normal.z;
    };
    addAt(index);
    let behind = 0;
    for (let step = 1; step < curve.length; step++) {
        const i = index - step;
        if (i < 0) break;
        behind += dist(curve[i + 1]!, curve[i]!);
        if (behind > AFO_TRIM_DISPLAY_NORMAL_MM) break;
        addAt(i);
    }
    let ahead = 0;
    for (let step = 1; step < curve.length; step++) {
        const i = index + step;
        if (i >= curve.length) break;
        ahead += dist(curve[i - 1]!, curve[i]!);
        if (ahead > AFO_TRIM_DISPLAY_NORMAL_MM) break;
        addAt(i);
    }
    const length = Math.hypot(sx, sy, sz);
    if (length < 1e-8) return projector.closest(curve[index]!).normal;
    return { x: sx / length, y: sy / length, z: sz / length };
}

function offsetDisplay(projector: MeshProjector, curve: AfoVec3[]): AfoVec3[] {
    return curve.map((p, index) => {
        const normal = averagedDisplayNormal(projector, curve, index);
        let d = AFO_TRIM_DRAW_OFFSET_MM;
        for (let k = 0; k < 4; k++) {
            const q = add(p, scale(normal, d));
            const back = projector.closest(q);
            if (dist(back.point, p) <= 0.35 && back.errorMm <= d + 0.08) return q;
            d *= 0.5;
        }
        return { ...p };
    });
}

/** Yellow trim stroke: the trim curve lifted along a 4 mm averaged normal. */
export function trimDisplayPoints(mesh: AfoTriMesh, curve: AfoVec3[]): AfoVec3[] {
    return offsetDisplay(meshProjector(mesh), curve);
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
    const box = meshBounds(mesh);
    const med =
        afo.landmarks.find((l) => l.id === "malleolus_medial")?.point ??
        malleolusOn(mesh, afo.side, "medial", box);
    const lat =
        afo.landmarks.find((l) => l.id === "malleolus_lateral")?.point ??
        malleolusOn(mesh, afo.side, "lateral", box);
    const midZ = (med.z + lat.z) * 0.5;
    const fib =
        afo.clinicalMarkers.find((m) => m.id === "fibular_head")?.point ??
        afo.scanWorkflow.landmarks.fibular_head;
    let topZ = midZ + 110;
    if (fib) topZ = Math.min(topZ, fib.z - 15);
    if (topZ - midZ < 100) reasons.push("Balance-brace top is under 100 mm above the malleoli.");
    const length = Math.max(1, box.xMax - box.xMin);
    const distal = afo.landmarks.find((l) => l.id === "distal")?.point ?? {
        x: box.xMin + length * 0.72,
        y: 0,
        z: box.zMin + 18,
    };
    const heelZ = box.zMin + 12;
    const heelX = box.xMin + length * 0.06;
    const sign = medialSign(afo.side);
    const pins = [
        { x: med.x + 10, y: med.y + sign * 4, z: topZ },
        { x: med.x + 10, y: med.y + sign * 4, z: med.z },
        { x: heelX, y: med.y * 0.55, z: heelZ },
        distal,
        { x: heelX, y: lat.y * 0.55, z: heelZ },
        { x: lat.x + 10, y: lat.y - sign * 4, z: lat.z },
        { x: lat.x + 10, y: lat.y - sign * 4, z: topZ },
        { x: box.xMin - 6, y: 0, z: topZ },
    ].map((p) => snapPointToMesh(mesh, p).point);
    if (fib && topZ > fib.z - 15) reasons.push("Proximal pin is closer than 15 mm to the fibular head.");
    if (pins[2]!.z < box.zMin + 10 - 0.5 || pins[4]!.z < box.zMin + 10 - 0.5) {
        reasons.push("Heel cup edge is under 10 mm above the plantar plane.");
    }
    return { pins, reasons };
}

/**
 * Posterior leaf: footplate to the sulcus, heel cup, then the trim rises
 * behind each malleolus and closes across the posterior calf. The anterior
 * shin stays open, so the side pins sit posterior of the malleoli.
 */
export function posteriorLeafPins(mesh: AfoTriMesh, afo: AfoDesignState): BalanceBrace {
    const reasons: string[] = [];
    const box = meshBounds(mesh);
    const med =
        afo.landmarks.find((l) => l.id === "malleolus_medial")?.point ??
        malleolusOn(mesh, afo.side, "medial", box);
    const lat =
        afo.landmarks.find((l) => l.id === "malleolus_lateral")?.point ??
        malleolusOn(mesh, afo.side, "lateral", box);
    const midZ = (med.z + lat.z) * 0.5;
    const fib =
        afo.clinicalMarkers.find((m) => m.id === "fibular_head")?.point ??
        afo.scanWorkflow.landmarks.fibular_head;
    let topZ = midZ + 100;
    if (fib) topZ = Math.min(topZ, fib.z - 15);
    if (topZ - midZ < 80) reasons.push("Posterior-leaf top is under 80 mm above the malleoli.");
    const length = Math.max(1, box.xMax - box.xMin);
    const distal = afo.landmarks.find((l) => l.id === "distal")?.point ?? {
        x: box.xMin + length * 0.72,
        y: 0,
        z: box.zMin + 18,
    };
    const heelZ = box.zMin + 12;
    const heelX = box.xMin + length * 0.06;
    const sign = medialSign(afo.side);
    const pins = [
        { x: box.xMin - 6, y: 0, z: topZ },
        { x: box.xMin - 4, y: med.y + sign * 2, z: topZ - 8 },
        { x: med.x - 14, y: med.y + sign * 2, z: med.z },
        { x: heelX, y: med.y * 0.55, z: heelZ },
        distal,
        { x: heelX, y: lat.y * 0.55, z: heelZ },
        { x: lat.x - 14, y: lat.y - sign * 2, z: lat.z },
        { x: box.xMin - 4, y: lat.y - sign * 2, z: topZ - 8 },
    ].map((p) => snapPointToMesh(mesh, p).point);
    if (fib && topZ > fib.z - 15) reasons.push("Proximal pin is closer than 15 mm to the fibular head.");
    if (pins[3]!.z < box.zMin + 10 - 0.5 || pins[5]!.z < box.zMin + 10 - 0.5) {
        reasons.push("Heel cup edge is under 10 mm above the plantar plane.");
    }
    return { pins, reasons };
}

interface MeshBounds {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    zMin: number;
    zMax: number;
}

function meshBounds(mesh: AfoTriMesh): MeshBounds {
    const box: MeshBounds = {
        xMin: Infinity,
        xMax: -Infinity,
        yMin: Infinity,
        yMax: -Infinity,
        zMin: Infinity,
        zMax: -Infinity,
    };
    const n = vertexCount(mesh);
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3] ?? 0;
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        if (x < box.xMin) box.xMin = x;
        if (x > box.xMax) box.xMax = x;
        if (y < box.yMin) box.yMin = y;
        if (y > box.yMax) box.yMax = y;
        if (z < box.zMin) box.zMin = z;
        if (z > box.zMax) box.zMax = z;
    }
    return box;
}

/** Live frame: +X anterior, width on Y, medial = medialSign. */
function malleolusOn(
    mesh: AfoTriMesh,
    side: AfoDesignState["side"],
    which: "medial" | "lateral",
    box: MeshBounds,
): AfoVec3 {
    const sign = medialSign(side);
    const length = Math.max(1, box.xMax - box.xMin);
    const x0 = box.xMin + length * 0.12;
    const x1 = box.xMin + length * 0.4;
    const z0 = box.zMin + 45;
    const z1 = box.zMin + 115;
    let best: AfoVec3 | null = null;
    let bestScore = -Infinity;
    const n = vertexCount(mesh);
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3] ?? 0;
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        if (x < x0 || x > x1 || z < z0 || z > z1) continue;
        const score = which === "medial" ? y * sign : -y * sign;
        if (score > bestScore) {
            bestScore = score;
            best = { x, y, z };
        }
    }
    if (best) return best;
    const width = Math.max(Math.abs(box.yMin), Math.abs(box.yMax), 20);
    return {
        x: box.xMin + length * 0.25,
        y: (which === "medial" ? sign : -sign) * width * 0.7,
        z: box.zMin + 70,
    };
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


function samplesWithin(curve: AfoVec3[], index: number, reachMm: number): { back: number; fore: number } {
    const n = curve.length;
    let back = (index - 1 + n) % n;
    let walked = dist(curve[index]!, curve[back]!);
    while (walked < reachMm) {
        const nxt = (back - 1 + n) % n;
        const step = dist(curve[back]!, curve[nxt]!);
        if (step < 1e-4 || walked + step > reachMm * 1.4) break;
        back = nxt;
        walked += step;
        if (back === index) break;
    }
    let fore = (index + 1) % n;
    walked = dist(curve[index]!, curve[fore]!);
    while (walked < reachMm) {
        const nxt = (fore + 1) % n;
        const step = dist(curve[fore]!, curve[nxt]!);
        if (step < 1e-4 || walked + step > reachMm * 1.4) break;
        fore = nxt;
        walked += step;
        if (fore === index) break;
    }
    return { back, fore };
}

function circumradius(a: AfoVec3, b: AfoVec3, c: AfoVec3): number {
    const ab = dist(a, b);
    const bc = dist(b, c);
    const ca = dist(c, a);
    const cross = len(cross3(sub(b, a), sub(c, a)));
    if (cross < 1e-6) return Infinity;
    return (ab * bc * ca) / (2 * cross);
}

function cross3(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

export interface FlatPlateTrim {
    /** Control points. Every one stays; smoothing passes through them. */
    pins: AfoVec3[];
    /** Dense loop on the sole, closed by repeating the first point. */
    curve: AfoVec3[];
    minRadiusMm: number;
}

/**
 * Default trim on the flat plate. The loop is inset from the cast silhouette
 * using the contact plane: lateral by a third of the local width, medial by
 * a few millimetres until the forefoot, where it sweeps toward the lateral
 * side. Heel and toe are single rounded closures.
 */
export function flatPlateTrimLoop(mesh: AfoTriMesh, spec: AfoFlatPlateSpec): FlatPlateTrim {
    const planes = contactPlanesFromLandmarks(spec);
    const bins = soleSilhouette(mesh, planes);
    if (bins.length < 4) {
        return { pins: [], curve: [], minRadiusMm: 0 };
    }
    const built = buildInsetLoop(bins);
    const faired = built;
    const lifted = liftLoop(mesh, planes, faired);
    const curve = resampleClosed(lifted, 1);
    const pins = controlPins(curve);
    const ring = curve.length > 2 ? [...curve, { ...curve[0]! }] : curve;
    return { pins, curve: ring, minRadiusMm: minRadiusOf(faired) };
}

/**
 * Fair a closed trim without dropping control pins. The curve is pulled
 * toward each pin until it is within 2 mm, or until the radius limit stops it.
 */
export function fairTrimNearPins(
    curve: AfoVec3[],
    pins: AfoVec3[],
    minRadiusMm = AFO_FLAT_TRIM_MIN_RADIUS_MM,
    blendMm = AFO_FLAT_TRIM_BLEND_MM,
): { curve: AfoVec3[]; pins: AfoVec3[] } {
    const open = stripSeam(curve);
    const kept = pins.map((p) => ({ ...p }));
    let cur = dropSpikes(resampleClosed(open.length >= 3 ? open : kept, 1.5));
    for (const pin of kept) {
        let best = 0;
        let bestD = Infinity;
        for (let i = 0; i < cur.length; i++) {
            const d = dist(cur[i]!, pin);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        const gap = dist(cur[best]!, pin);
        const target = gap > 1.5 ? lerp(cur[best]!, pin, (gap - 1.5) / gap) : { ...cur[best]! };
        cur = cosineBump(cur, best, target, Math.max(blendMm, 25));
    }
    const faired = minRadiusMm > 0 ? easeSharpTurns(cur) : cur;
    const ring = faired.length > 2 ? [...faired, { ...faired[0]! }] : faired.map((p) => ({ ...p }));
    return { curve: ring, pins: kept };
}

interface SilhouetteBin {
    s: number;
    vMed: number;
    vLat: number;
}

function soleSilhouette(
    mesh: AfoTriMesh,
    planes: ReturnType<typeof contactPlanesFromLandmarks>,
): SilhouetteBin[] {
    const n = vertexCount(mesh);
    const raw: { s: number; v: number }[] = [];
    for (let i = 0; i < n; i++) {
        const p = {
            x: mesh.positions[i * 3] ?? 0,
            y: mesh.positions[i * 3 + 1] ?? 0,
            z: mesh.positions[i * 3 + 2] ?? 0,
        };
        const h = heightAboveContact(p, planes);
        if (h < -6 || h > 22) continue;
        const d = sub(p, planes.origin);
        raw.push({ s: dot(d, planes.forward), v: dot(d, planes.along) });
    }
    if (raw.length < 8) return [];
    let sMin = Infinity;
    let sMax = -Infinity;
    for (const p of raw) {
        sMin = Math.min(sMin, p.s);
        sMax = Math.max(sMax, p.s);
    }
    const binW = 3;
    const count = Math.max(2, Math.ceil((sMax - sMin) / binW));
    const mins = new Array<number>(count).fill(Infinity);
    const maxs = new Array<number>(count).fill(-Infinity);
    for (const p of raw) {
        const k = Math.min(count - 1, Math.max(0, Math.floor((p.s - sMin) / binW)));
        mins[k] = Math.min(mins[k]!, p.v);
        maxs[k] = Math.max(maxs[k]!, p.v);
    }
    const bins: SilhouetteBin[] = [];
    for (let k = 0; k < count; k++) {
        if (!Number.isFinite(mins[k])) continue;
        bins.push({ s: sMin + (k + 0.5) * binW, vMed: mins[k]!, vLat: maxs[k]! });
    }
    return smoothSilhouette(bins, AFO_FLAT_TRIM_BLEND_MM);
}

function smoothSilhouette(bins: SilhouetteBin[], windowMm: number): SilhouetteBin[] {
    return bins.map((bin, i) => {
        let med = 0;
        let lat = 0;
        let w = 0;
        for (let j = 0; j < bins.length; j++) {
            const ds = Math.abs(bins[j]!.s - bin.s);
            if (ds > windowMm) continue;
            const weight = 1 - ds / windowMm;
            med += bins[j]!.vMed * weight;
            lat += bins[j]!.vLat * weight;
            w += weight;
        }
        return { s: bin.s, vMed: med / (w || 1), vLat: lat / (w || 1) };
    });
}

function buildInsetLoop(bins: SilhouetteBin[]): AfoVec3[] {
    const sMin = bins[0]!.s;
    const sMax = bins[bins.length - 1]!.s;
    const sHeel = sMin + AFO_FLAT_TRIM_HEEL_INSET_MM;
    const sToe = sMax - AFO_FLAT_TRIM_TOE_INSET_MM;
    const sMet = sMin + (sMax - sMin) * 0.58;
    const sMid = sMin + (sMax - sMin) * 0.4;
    const at = (s: number) => {
        let best = bins[0]!;
        let bestD = Infinity;
        for (const bin of bins) {
            const d = Math.abs(bin.s - s);
            if (d < bestD) {
                bestD = d;
                best = bin;
            }
        }
        return best;
    };
    const lateralV = (s: number) => {
        const bin = at(s);
        const width = Math.max(24, bin.vLat - bin.vMed);
        return bin.vLat - width * AFO_FLAT_TRIM_LATERAL_INSET_RATIO;
    };
    const medialV = (s: number) => at(s).vMed + AFO_FLAT_TRIM_MEDIAL_INSET_MM;
    const sweepV = (s: number) => {
        const vL = lateralV(s);
        const vM = medialV(Math.min(s, sMet));
        if (s <= sMet) return vM;
        const u = Math.min(1, Math.max(0, (s - sMet) / Math.max(1, sToe - sMet)));
        const e = u * u * (3 - 2 * u);
        const crossed = Math.min(vL - 28, (vL + vM) * 0.5 + (vL - vM) * 0.2);
        return vM * (1 - e) + crossed * e;
    };
    const heelS = sHeel + AFO_FLAT_TRIM_BLEND_MM;
    const toeS = sToe - AFO_FLAT_TRIM_BLEND_MM;
    const heelVL = lateralV(heelS);
    const heelVM = medialV(heelS);
    let toeVL = lateralV(toeS);
    let toeVM = sweepV(toeS);
    if (toeVL - toeVM < AFO_FLAT_TRIM_MIN_RADIUS_MM * 2 + 16) toeVM = toeVL - (AFO_FLAT_TRIM_MIN_RADIUS_MM * 2 + 16);
    const lateral = filletOpen(
        [
            inPlane(heelS, heelVL),
            inPlane(heelS + AFO_FLAT_TRIM_BLEND_MM, heelVL),
            inPlane(sMid, lateralV(sMid)),
            inPlane(sMet, lateralV(sMet)),
            inPlane(toeS - AFO_FLAT_TRIM_BLEND_MM, toeVL),
            inPlane(toeS, toeVL),
        ],
        AFO_FLAT_TRIM_MIN_RADIUS_MM + 8,
        1.5,
    );
    const medial = filletOpen(
        [
            inPlane(toeS, toeVM),
            inPlane(toeS - AFO_FLAT_TRIM_BLEND_MM, toeVM),
            inPlane(sMet, sweepV(sMet)),
            inPlane(sMid, medialV(sMid)),
            inPlane(heelS + AFO_FLAT_TRIM_BLEND_MM, heelVM),
            inPlane(heelS, heelVM),
        ],
        AFO_FLAT_TRIM_MIN_RADIUS_MM + 8,
        1.5,
    );
    const toe = circularArc(lateral[lateral.length - 1]!, medial[0]!, 1);
    const heel = circularArc(medial[medial.length - 1]!, lateral[0]!, -1);
    return [...lateral, ...toe, ...medial, ...heel];
}

/** `s` is forward, `v` is along. World placement is filled in by the caller via the plane. */
function inPlane(s: number, v: number): AfoVec3 {
    return { x: s, y: v, z: 0 };
}

/** Straight runs joined by circular fillets of at least `radius`. End segments stay straight. */
function filletOpen(points: AfoVec3[], radius: number, spacing: number): AfoVec3[] {
    const n = points.length;
    if (n < 2) return points.map((p) => ({ ...p }));
    const trimA = new Array<number>(n - 1).fill(0);
    const trimB = new Array<number>(n - 1).fill(0);
    const corner: Array<{ start: AfoVec3; end: AfoVec3; center: AfoVec3; r: number } | null> = new Array(n).fill(null);
    for (let i = 1; i < n - 1; i++) {
        const prev = points[i - 1]!;
        const cur = points[i]!;
        const next = points[i + 1]!;
        const inLen = dist(prev, cur);
        const outLen = dist(cur, next);
        if (inLen < 1 || outLen < 1) continue;
        const v1 = { x: (cur.x - prev.x) / inLen, y: (cur.y - prev.y) / inLen };
        const v2 = { x: (next.x - cur.x) / outLen, y: (next.y - cur.y) / outLen };
        const cross = v1.x * v2.y - v1.y * v2.x;
        const dotDir = Math.min(1, Math.max(-1, v1.x * v2.x + v1.y * v2.y));
        const turn = Math.acos(dotDir);
        if (turn < 0.04 || Math.abs(cross) < 1e-4) continue;
        const half = turn * 0.5;
        const maxT = Math.min(inLen, outLen) * 0.45;
        const tanHalf = Math.tan(half);
        const r = Math.min(radius, maxT / Math.max(tanHalf, 1e-3));
        const t = r * tanHalf;
        trimB[i - 1] = Math.max(trimB[i - 1]!, t);
        trimA[i] = Math.max(trimA[i]!, t);
        const sign = cross > 0 ? 1 : -1;
        const start = { x: cur.x - v1.x * t, y: cur.y - v1.y * t, z: 0 };
        const end = { x: cur.x + v2.x * t, y: cur.y + v2.y * t, z: 0 };
        const nx = -v1.y * sign;
        const ny = v1.x * sign;
        corner[i] = { start, end, center: { x: start.x + nx * r, y: start.y + ny * r, z: 0 }, r };
    }
    const out: AfoVec3[] = [];
    const pushLine = (a: AfoVec3, b: AfoVec3) => {
        const len = dist(a, b);
        const steps = Math.max(1, Math.ceil(len / spacing));
        for (let s = 0; s < steps; s++) out.push(lerp(a, b, s / steps));
    };
    const pushArc = (arc: { start: AfoVec3; end: AfoVec3; center: AfoVec3; r: number }) => {
        const a0 = Math.atan2(arc.start.y - arc.center.y, arc.start.x - arc.center.x);
        let sweep = Math.atan2(arc.end.y - arc.center.y, arc.end.x - arc.center.x) - a0;
        while (sweep <= -Math.PI) sweep += Math.PI * 2;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        const steps = Math.max(2, Math.ceil((arc.r * Math.abs(sweep)) / spacing));
        for (let s = 0; s < steps; s++) {
            const t = a0 + (sweep * s) / steps;
            out.push({ x: arc.center.x + Math.cos(t) * arc.r, y: arc.center.y + Math.sin(t) * arc.r, z: 0 });
        }
    };
    for (let i = 0; i < n - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const len = dist(a, b);
        const ux = (b.x - a.x) / (len || 1);
        const uy = (b.y - a.y) / (len || 1);
        const from = { x: a.x + ux * trimA[i]!, y: a.y + uy * trimA[i]!, z: 0 };
        const to = { x: b.x - ux * trimB[i]!, y: b.y - uy * trimB[i]!, z: 0 };
        if (i > 0 && corner[i]) pushArc(corner[i]!);
        if (dist(from, to) > 0.2) pushLine(from, to);
    }
    out.push({ ...points[n - 1]! });
    return out;
}

/** Semicircle from `a` to `b`, bulging toward +s when `dir` is +1. Endpoints stay with the chains. */
function circularArc(a: AfoVec3, b: AfoVec3, dir: 1 | -1): AfoVec3[] {
    const chord = Math.max(dist(a, b), (AFO_FLAT_TRIM_MIN_RADIUS_MM + 8) * 2);
    const radius = chord * 0.5;
    const mid = lerp(a, b, 0.5);
    let px = -(b.y - a.y);
    let py = b.x - a.x;
    const pl = Math.hypot(px, py) || 1;
    px /= pl;
    py /= pl;
    if (px * dir < 0) {
        px = -px;
        py = -py;
    }
    const h = Math.sqrt(Math.max(0, radius * radius - (chord * 0.5) * (chord * 0.5)));
    const center = { x: mid.x - px * h, y: mid.y - py * h, z: 0 };
    const angA = Math.atan2(a.y - center.y, a.x - center.x);
    let sweep = Math.atan2(b.y - center.y, b.x - center.x) - angA;
    while (sweep <= -Math.PI) sweep += Math.PI * 2;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    const midAng = angA + sweep * 0.5;
    const bulge = Math.cos(midAng) * dir + Math.sin(midAng) * 0;
    if (bulge < 0) sweep += sweep > 0 ? -Math.PI * 2 : Math.PI * 2;
    const steps = Math.max(8, Math.ceil((radius * Math.abs(sweep)) / 2));
    const out: AfoVec3[] = [];
    for (let i = 1; i < steps; i++) {
        const t = angA + (sweep * i) / steps;
        out.push({ x: center.x + Math.cos(t) * radius, y: center.y + Math.sin(t) * radius, z: 0 });
    }
    return out;
}

/** Lift the whole loop, then smooth the height so a curled sole does not stair-step the trim. */
function liftLoop(
    mesh: AfoTriMesh,
    planes: ReturnType<typeof contactPlanesFromLandmarks>,
    svs: AfoVec3[],
): AfoVec3[] {
    const raw = svs.map((sv) => liftOnPlane(mesh, planes, sv));
    const n = raw.length;
    if (n < 4) return raw;
    const height = raw.map((p) => heightAboveContact(p, planes));
    const smooth = height.map((_, index) => {
        let sum = 0;
        let weight = 0;
        for (const sign of [-1, 1]) {
            let walked = 0;
            for (let k = 0; k < n; k++) {
                const j = (index + sign * k + n * 2) % n;
                if (k > 0) {
                    const prev = (j - sign + n) % n;
                    walked += dist(raw[prev]!, raw[j]!);
                }
                if (walked > AFO_FLAT_TRIM_BLEND_MM) break;
                const w = 0.5 * (1 + Math.cos((Math.PI * walked) / AFO_FLAT_TRIM_BLEND_MM));
                sum += height[j]! * w;
                weight += w;
            }
        }
        return weight > 0 ? sum / weight : height[index]!;
    });
    return raw.map((p, index) => {
        const h = heightAboveContact(p, planes);
        const d = smooth[index]! - h;
        return {
            x: p.x + planes.normal.x * d,
            y: p.y + planes.normal.y * d,
            z: p.z + planes.normal.z * d,
        };
    });
}

/** Keep the plan position. Only adopt a mesh hit that does not walk off that plan point. */
function liftOnPlane(
    mesh: AfoTriMesh,
    planes: ReturnType<typeof contactPlanesFromLandmarks>,
    sv: AfoVec3,
): AfoVec3 {
    const p = {
        x: planes.origin.x + planes.forward.x * sv.x + planes.along.x * sv.y,
        y: planes.origin.y + planes.forward.y * sv.x + planes.along.y * sv.y,
        z: planes.origin.z + planes.forward.z * sv.x + planes.along.z * sv.y,
    };
    const hit = meshProjector(mesh).closest(p);
    const d = sub(hit.point, p);
    const plan = Math.hypot(
        d.x - planes.normal.x * dot(d, planes.normal),
        d.y - planes.normal.y * dot(d, planes.normal),
        d.z - planes.normal.z * dot(d, planes.normal),
    );
    const h = heightAboveContact(hit.point, planes);
    if (hit.errorMm <= 14 && plan <= 0.6 && h <= 28 && h >= -4) {
        return {
            x: p.x + planes.normal.x * h,
            y: p.y + planes.normal.y * h,
            z: p.z + planes.normal.z * h,
        };
    }
    return p;
}

function cosineBump(curve: AfoVec3[], index: number, target: AfoVec3, blendMm: number): AfoVec3[] {
    const next = curve.map((p) => ({ ...p }));
    const n = curve.length;
    const offset = sub(target, curve[index]!);
    next[index] = { ...target };
    for (const sign of [-1, 1]) {
        let walked = 0;
        for (let k = 1; k < n; k++) {
            const i = (index + sign * k + n * 2) % n;
            const prev = (i - sign + n) % n;
            walked += dist(curve[prev]!, curve[i]!);
            if (walked >= blendMm) break;
            const w = 0.5 * (1 + Math.cos((Math.PI * walked) / blendMm));
            next[i] = {
                x: curve[i]!.x + offset.x * w,
                y: curve[i]!.y + offset.y * w,
                z: curve[i]!.z + offset.z * w,
            };
        }
    }
    return next;
}

function easeSharpTurns(curve: AfoVec3[]): AfoVec3[] {
    const cur = curve.map((p) => ({ ...p }));
    const n = cur.length;
    for (let pass = 0; pass < 6; pass++) {
        const next = cur.map((p) => ({ ...p }));
        let moved = false;
        for (let i = 0; i < n; i++) {
            const a = cur[(i - 1 + n) % n]!;
            const b = cur[i]!;
            const c = cur[(i + 1) % n]!;
            const v1 = sub(b, a);
            const v2 = sub(c, b);
            const l1 = Math.hypot(v1.x, v1.y, v1.z);
            const l2 = Math.hypot(v2.x, v2.y, v2.z);
            if (l1 < 0.2 || l2 < 0.2) continue;
            const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z) / (l1 * l2)));
            const turn = (Math.acos(cos) * 180) / Math.PI;
            if (turn < 22) continue;
            next[i] = lerp(b, lerp(a, c, 0.5), 0.55);
            moved = true;
        }
        for (let i = 0; i < n; i++) cur[i] = next[i]!;
        if (!moved) break;
    }
    return cur;
}

function dropSpikes(curve: AfoVec3[]): AfoVec3[] {
    const cur = curve.map((p) => ({ ...p }));
    const n = cur.length;
    if (n < 8) return cur;
    for (let pass = 0; pass < 24; pass++) {
        let worst = 0;
        let at = -1;
        for (let i = 0; i < n; i++) {
            const mid = lerp(cur[(i - 1 + n) % n]!, cur[(i + 1) % n]!, 0.5);
            const off = dist(cur[i]!, mid);
            if (off > worst) {
                worst = off;
                at = i;
            }
        }
        if (at < 0 || worst < 0.25) break;
        cur[at] = lerp(cur[(at - 1 + n) % n]!, cur[(at + 1) % n]!, 0.5);
    }
    return cur;
}

function controlPins(curve: AfoVec3[]): AfoVec3[] {
    const n = curve.length;
    if (n < 4) return curve.map((p) => ({ ...p }));
    const pins: AfoVec3[] = [];
    let since = 0;
    const spacing = 32;
    for (let i = 0; i < n; i++) {
        const radius = circumradius(curve[(i - 3 + n) % n]!, curve[i]!, curve[(i + 3) % n]!);
        const corner = radius < AFO_FLAT_TRIM_MIN_RADIUS_MM * 1.35;
        if (i === 0 || corner || since >= spacing) {
            const last = pins[pins.length - 1];
            if (!last || dist(last, curve[i]!) > 12) pins.push({ ...curve[i]! });
            since = 0;
        }
        const nxt = curve[(i + 1) % n]!;
        since += dist(curve[i]!, nxt);
    }
    return pins.length >= 3 ? pins : curve.filter((_, i) => i % 8 === 0).map((p) => ({ ...p }));
}

function minRadiusOf(curve: AfoVec3[]): number {
    const n = curve.length;
    let min = Infinity;
    if (n < 3) return 0;
    for (let i = 0; i < n; i++) {
        const reach = samplesWithin(curve, i, 6);
        min = Math.min(min, circumradius(curve[reach.back]!, curve[i]!, curve[reach.fore]!));
    }
    return Number.isFinite(min) ? min : Infinity;
}

function resampleClosed(points: AfoVec3[], spacing: number): AfoVec3[] {
    const src = stripSeam(points);
    if (src.length < 2) return src.map((p) => ({ ...p }));
    const out: AfoVec3[] = [{ ...src[0]! }];
    let acc = 0;
    for (let i = 0; i < src.length; i++) {
        const a = src[i]!;
        const b = src[(i + 1) % src.length]!;
        const span = dist(a, b);
        if (span < 1e-4) continue;
        let t = (spacing - acc) / span;
        while (t <= 1) {
            out.push(lerp(a, b, t));
            t += spacing / span;
        }
        acc = (1 - (t - spacing / span)) * span;
    }
    const last = out[out.length - 1]!;
    if (dist(last, out[0]!) < spacing * 0.4) out.pop();
    return out.length >= 3 ? out : src.map((p) => ({ ...p }));
}

function stripSeam(points: AfoVec3[]): AfoVec3[] {
    if (points.length >= 2 && dist(points[0]!, points[points.length - 1]!) < 0.2) return points.slice(0, -1);
    return points.map((p) => ({ ...p }));
}
