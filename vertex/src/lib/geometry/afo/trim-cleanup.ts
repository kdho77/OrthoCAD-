// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { getAfoState, patchAfoState, useAfoStore } from "@/stores/afo-store";
import { meshProjector, nearestVertex } from "./mesh-ops";
import { polylineSelfIntersects } from "./trim-loop";
import { AFO_TRIM_NO_MESH } from "./trim-preview";
import type { AfoDesignState, AfoTriMesh, AfoVec3 } from "./types";

/** Target spacing. The contour may keep more points, including more than 48. */
export const TRIM_CLEANUP_SPACING_MM = 12;
export const TRIM_CLEANUP_PROTECT_MM = 8;
export const TRIM_CLEANUP_MAX_DEVIATION_MM = 2;
export const TRIM_CLEANUP_PROTECTED_DEVIATION_MM = 1;
export const TRIM_CLEANUP_DESPIKE_MM = 3;
const MIN_STEP_MM = 1.5;
const SURFACE_MM = 0.35;

export interface TrimCleanupResult {
    ok: boolean;
    /** True when the committed dots differ from the input. */
    applied: boolean;
    reasons: string[];
    pins: AfoVec3[];
    curve: AfoVec3[];
}

function dist(a: AfoVec3, b: AfoVec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function lerp(a: AfoVec3, b: AfoVec3, t: number): AfoVec3 {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

function copy(points: AfoVec3[]): AfoVec3[] {
    return points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
}

function samePoint(a: AfoVec3, b: AfoVec3, tol = 1e-4): boolean {
    return dist(a, b) <= tol;
}

function stripClosing(points: AfoVec3[]): AfoVec3[] {
    if (points.length > 1 && samePoint(points[0]!, points[points.length - 1]!, 0.05)) {
        return points.slice(0, -1);
    }
    return points.slice();
}

function pointSegmentDistance(p: AfoVec3, a: AfoVec3, b: AfoVec3): number {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const ab2 = abx * abx + aby * aby + abz * abz || 1;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / ab2));
    return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}

function distToPolyline(p: AfoVec3, pts: AfoVec3[], closed: boolean): number {
    let best = Infinity;
    const n = pts.length;
    const segs = closed ? n : Math.max(0, n - 1);
    for (let i = 0; i < segs; i++) best = Math.min(best, pointSegmentDistance(p, pts[i]!, pts[(i + 1) % n]!));
    return best;
}

export function trimCurveDeviation(next: AfoVec3[], original: AfoVec3[], closed: boolean): number {
    if (next.length === 0 || original.length === 0) return Infinity;
    let max = 0;
    for (const p of next) max = Math.max(max, distToPolyline(p, original, closed));
    for (const p of original) max = Math.max(max, distToPolyline(p, next, closed));
    return max;
}

function chainSelfIntersects(points: AfoVec3[], closed: boolean): boolean {
    if (points.length < 4) return false;
    if (closed) return polylineSelfIntersects(points);
    const n = points.length;
    for (let i = 0; i < n - 1; i++) {
        for (let j = i + 2; j < n - 1; j++) {
            if (j === i + 1) continue;
            const gap = pointSegmentDistance(points[j]!, points[i]!, points[i + 1]!);
            const gap2 = pointSegmentDistance(points[i]!, points[j]!, points[j + 1]!);
            if (Math.min(gap, gap2) <= 0.3 && j > i + 2) return true;
        }
    }
    return false;
}

/** Landmarks the cleanup is not allowed to slide. Pins within 8 mm of these stay. */
export function trimProtectedAnchors(afo: AfoDesignState): AfoVec3[] {
    const out: AfoVec3[] = [];
    const push = (p: AfoVec3 | null | undefined) => {
        if (p) out.push(p);
    };
    for (const landmark of afo.landmarks) {
        if (landmark.id === "malleolus_medial" || landmark.id === "malleolus_lateral") push(landmark.point);
    }
    const scan = afo.scanWorkflow.landmarks;
    push(scan.medial_malleolus);
    push(scan.lateral_malleolus);
    push(scan.posterior_calcaneus);
    push(scan.m1_mpj);
    push(scan.m5_mpj);
    push(scan.fibular_head);
    push(afo.scanWorkflow.plantar.heel);
    for (const marker of afo.clinicalMarkers) {
        if (marker.id === "post_calcaneus" || marker.id === "fibular_head") push(marker.point);
    }
    push(afo.scanWorkflow.derived?.heelCupCenter);
    push(afo.scanWorkflow.derived?.mpjBreak?.m1);
    push(afo.scanWorkflow.derived?.mpjBreak?.m5);
    return out;
}

function nearAnchor(point: AfoVec3, anchors: AfoVec3[]): boolean {
    return anchors.some((anchor) => dist(anchor, point) <= TRIM_CLEANUP_PROTECT_MM);
}

export function protectedTrimPins(pins: AfoVec3[], closed: boolean, anchors: AfoVec3[]): AfoVec3[] {
    const out: AfoVec3[] = [];
    pins.forEach((pin, index) => {
        const endpoint = !closed && (index === 0 || index === pins.length - 1);
        if (endpoint || nearAnchor(pin, anchors)) out.push(pin);
    });
    return out;
}

function isLockedPoint(point: AfoVec3, locked: AfoVec3[]): boolean {
    return locked.some((pin) => dist(pin, point) <= 0.2);
}

function despike(points: AfoVec3[], locked: AfoVec3[], closed: boolean): AfoVec3[] {
    if (points.length < 3) return copy(points);
    const keep = points.map((point) => isLockedPoint(point, locked));
    const drop = new Set<number>();
    const n = points.length;
    const count = closed ? n : n - 2;
    for (let k = 0; k < count; k++) {
        const i = closed ? k : k + 1;
        if (keep[i]) continue;
        const prev = points[(i - 1 + n) % n]!;
        const cur = points[i]!;
        const next = points[(i + 1) % n]!;
        const dPrev = dist(prev, cur);
        const dNext = dist(cur, next);
        const offChord = pointSegmentDistance(cur, prev, next);
        // A uniform fine sample is not a knot. All three points have to sit together.
        const clustered =
            dPrev < TRIM_CLEANUP_DESPIKE_MM &&
            dNext < TRIM_CLEANUP_DESPIKE_MM &&
            dist(prev, next) < TRIM_CLEANUP_DESPIKE_MM;
        const vx1 = cur.x - prev.x;
        const vy1 = cur.y - prev.y;
        const vz1 = cur.z - prev.z;
        const vx2 = next.x - cur.x;
        const vy2 = next.y - cur.y;
        const vz2 = next.z - cur.z;
        const l1 = Math.hypot(vx1, vy1, vz1) || 1;
        const l2 = Math.hypot(vx2, vy2, vz2) || 1;
        const reversal = (vx1 * vx2 + vy1 * vy2 + vz1 * vz2) / (l1 * l2) < 0;
        const spur = reversal && offChord > 1 && dPrev < 6 && dNext < 6;
        if (clustered || spur) drop.add(i);
    }
    const out = points.filter((_, index) => !drop.has(index));
    return out.length >= 2 ? out : copy(points);
}

function arcTable(pts: AfoVec3[], closed: boolean): { prefix: number[]; total: number } {
    const prefix = [0];
    const n = pts.length;
    const segs = closed ? n : Math.max(0, n - 1);
    for (let i = 0; i < segs; i++) prefix.push((prefix[i] ?? 0) + dist(pts[i]!, pts[(i + 1) % n]!));
    return { prefix, total: prefix[segs] ?? 0 };
}

function pointAt(pts: AfoVec3[], prefix: number[], closed: boolean, arc: number): AfoVec3 {
    const n = pts.length;
    const segs = closed ? n : Math.max(0, n - 1);
    const total = prefix[segs] ?? 0;
    let a = arc;
    if (closed && total > 0) a = ((a % total) + total) % total;
    for (let i = 0; i < segs; i++) {
        const a0 = prefix[i] ?? 0;
        const a1 = prefix[i + 1] ?? a0;
        if (a <= a1 + 1e-6 || i === segs - 1) {
            const span = a1 - a0 || 1;
            const t = Math.min(1, Math.max(0, (a - a0) / span));
            return lerp(pts[i]!, pts[(i + 1) % n]!, t);
        }
    }
    return pts[n - 1] ?? { x: 0, y: 0, z: 0 };
}

function closestArc(
    point: AfoVec3,
    pts: AfoVec3[],
    prefix: number[],
    closed: boolean,
    total: number,
): number {
    if (total <= 0) return 0;
    const steps = Math.max(8, Math.ceil(total));
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i <= steps; i++) {
        const arc = (total * i) / steps;
        const d = dist(point, pointAt(pts, prefix, closed, arc));
        if (d < bestD) {
            bestD = d;
            best = arc;
        }
    }
    return best;
}

function chordLeavesSource(
    from: AfoVec3,
    to: AfoVec3,
    arc0: number,
    arc1: number,
    pts: AfoVec3[],
    prefix: number[],
    closed: boolean,
): number {
    const span = Math.max(0, arc1 - arc0);
    const steps = Math.max(1, Math.ceil(span));
    let max = 0;
    for (let s = 0; s <= steps; s++) {
        const p = pointAt(pts, prefix, closed, arc0 + (span * s) / steps);
        max = Math.max(max, pointSegmentDistance(p, from, to));
    }
    return max;
}

function resampleSpan(
    pts: AfoVec3[],
    prefix: number[],
    closed: boolean,
    arc0: number,
    arc1: number,
    start: AfoVec3,
    end: AfoVec3,
    includeEnd: boolean,
    projector: ReturnType<typeof meshProjector>,
): AfoVec3[] {
    const out: AfoVec3[] = [start];
    let arc = arc0;
    let last = start;
    let guard = 0;
    while (arc < arc1 - 0.25 && guard < 2000) {
        guard += 1;
        const room = arc1 - arc;
        if (
            room <= TRIM_CLEANUP_SPACING_MM &&
            chordLeavesSource(last, end, arc, arc1, pts, prefix, closed) <= TRIM_CLEANUP_MAX_DEVIATION_MM
        ) {
            break;
        }
        let step = Math.min(TRIM_CLEANUP_SPACING_MM, room);
        const endOfStep = () => pointAt(pts, prefix, closed, arc + step);
        if (
            chordLeavesSource(last, endOfStep(), arc, arc + step, pts, prefix, closed) >
            TRIM_CLEANUP_MAX_DEVIATION_MM
        ) {
            let low = Math.min(MIN_STEP_MM, room);
            let high = step;
            step = low;
            for (let iter = 0; iter < 10; iter++) {
                const mid = (low + high) * 0.5;
                const at = pointAt(pts, prefix, closed, arc + mid);
                if (
                    chordLeavesSource(last, at, arc, arc + mid, pts, prefix, closed) <=
                    TRIM_CLEANUP_MAX_DEVIATION_MM
                ) {
                    step = mid;
                    low = mid;
                } else {
                    high = mid;
                }
            }
        }
        if (step < 0.2) break;
        arc += step;
        if (arc >= arc1 - 0.25) break;
        const sample = projector.closest(pointAt(pts, prefix, closed, arc)).point;
        if (dist(sample, last) > 0.05) out.push(sample);
        last = sample;
    }
    if (includeEnd && dist(end, out[out.length - 1]!) > 0.05) out.push(end);
    return out;
}

function resample(
    pts: AfoVec3[],
    locked: AfoVec3[],
    closed: boolean,
    projector: ReturnType<typeof meshProjector>,
): AfoVec3[] {
    const { prefix, total } = arcTable(pts, closed);
    if (total < 1 || pts.length < 2) return copy(pts);
    const marks = locked
        .map((p) => ({ p, arc: closestArc(p, pts, prefix, closed, total) }))
        .sort((a, b) => a.arc - b.arc);
    if (!closed) {
        if (marks.length < 2) return copy(pts);
        const out: AfoVec3[] = [];
        for (let i = 0; i < marks.length - 1; i++) {
            const a = marks[i]!;
            const b = marks[i + 1]!;
            const span = resampleSpan(pts, prefix, false, a.arc, b.arc, a.p, b.p, true, projector);
            if (out.length && samePoint(out[out.length - 1]!, span[0]!, 0.05)) out.push(...span.slice(1));
            else out.push(...span);
        }
        return out;
    }
    if (marks.length === 0) {
        const start = pts[0]!;
        const span = resampleSpan(pts, prefix, true, 0, total, start, start, false, projector);
        return span.length >= 3 ? span : copy(pts);
    }
    const out: AfoVec3[] = [];
    for (let i = 0; i < marks.length; i++) {
        const a = marks[i]!;
        const b = marks[(i + 1) % marks.length]!;
        const endArc = i === marks.length - 1 ? b.arc + total : b.arc;
        const span = resampleSpan(pts, prefix, true, a.arc, endArc, a.p, b.p, false, projector);
        if (out.length && samePoint(out[out.length - 1]!, span[0]!, 0.05)) out.push(...span.slice(1));
        else out.push(...span);
    }
    return out.length >= 3 ? out : copy(pts);
}

function smoothOntoSurface(
    points: AfoVec3[],
    locked: AfoVec3[],
    closed: boolean,
    projector: ReturnType<typeof meshProjector>,
    reference: AfoVec3[],
): AfoVec3[] {
    let cur = copy(points);
    for (const coeff of [0.33, -0.34]) {
        const next = copy(cur);
        const n = cur.length;
        for (let i = 0; i < n; i++) {
            if (isLockedPoint(cur[i]!, locked)) continue;
            if (!closed && (i === 0 || i === n - 1)) continue;
            const prev = cur[(i - 1 + n) % n]!;
            const nxt = cur[(i + 1) % n]!;
            const blended = {
                x: cur[i]!.x + coeff * (0.5 * (prev.x + nxt.x) - cur[i]!.x),
                y: cur[i]!.y + coeff * (0.5 * (prev.y + nxt.y) - cur[i]!.y),
                z: cur[i]!.z + coeff * (0.5 * (prev.z + nxt.z) - cur[i]!.z),
            };
            const hit = projector.closest(blended);
            if (hit.errorMm > SURFACE_MM) continue;
            if (distToPolyline(hit.point, reference, closed) > TRIM_CLEANUP_MAX_DEVIATION_MM) continue;
            next[i] = hit.point;
        }
        cur = next;
    }
    return cur.map((point, index) => (isLockedPoint(points[index]!, locked) ? points[index]! : point));
}

export function validateTrimCleanup(input: {
    mesh: AfoTriMesh;
    original: AfoVec3[];
    candidate: AfoVec3[];
    closed: boolean;
    protectedPins: AfoVec3[];
    endpoints: AfoVec3[];
}): string[] {
    const reasons: string[] = [];
    const { candidate, original, closed, protectedPins, endpoints } = input;
    if (candidate.length < 2) {
        reasons.push("Cleanup removed the trim.");
        return reasons;
    }
    const projector = meshProjector(input.mesh);
    for (const point of candidate) {
        if (projector.closest(point).errorMm > SURFACE_MM) {
            reasons.push("Cleanup left the scan surface.");
            break;
        }
    }
    if (chainSelfIntersects(candidate, closed)) reasons.push("Cleanup self-intersects.");
    const deviation = trimCurveDeviation(candidate, original, closed);
    if (deviation > TRIM_CLEANUP_MAX_DEVIATION_MM + 1e-3) {
        reasons.push(
            `Cleanup moved the curve ${deviation.toFixed(2)} mm (limit ${TRIM_CLEANUP_MAX_DEVIATION_MM} mm).`,
        );
    }
    for (const pin of protectedPins) {
        const nearest = candidate.reduce((best, point) => Math.min(best, dist(point, pin)), Infinity);
        if (nearest > TRIM_CLEANUP_PROTECTED_DEVIATION_MM) {
            reasons.push("Cleanup moved a protected landmark.");
            break;
        }
    }
    if (!closed && endpoints.length >= 2) {
        const first = endpoints[0]!;
        const last = endpoints[endpoints.length - 1]!;
        if (
            !samePoint(candidate[0]!, first, 1e-4) ||
            !samePoint(candidate[candidate.length - 1]!, last, 1e-4)
        ) {
            reasons.push("Cleanup moved an open-chain endpoint.");
        }
    }
    return reasons;
}

/**
 * Manual cleanup. Despike, resample toward 12 mm, project, and Taubin-smooth.
 * The whole result is checked before it replaces the dots. A failure returns
 * the original pins.
 */
export function cleanupTrimCurve(input: {
    mesh: AfoTriMesh;
    pins: AfoVec3[];
    curve?: AfoVec3[] | null;
    closed: boolean;
    anchors?: AfoVec3[];
}): TrimCleanupResult {
    const pins = stripClosing(input.pins);
    const original = stripClosing(input.curve && input.curve.length >= 2 ? input.curve : pins);
    const unchanged = (): TrimCleanupResult => ({
        ok: false,
        applied: false,
        reasons: [],
        pins: copy(input.pins),
        curve: copy(input.curve && input.curve.length >= 2 ? input.curve : input.pins),
    });
    if (pins.length < 2 || original.length < 2) {
        const result = unchanged();
        result.reasons = ["Need at least 2 trim points."];
        return result;
    }
    const anchors = input.anchors ?? [];
    const locked = protectedTrimPins(pins, input.closed, anchors);
    const endpoints = input.closed ? [] : [pins[0]!, pins[pins.length - 1]!];
    const projector = meshProjector(input.mesh);
    const source = despike(original, locked, input.closed);
    const resampled = resample(source.length >= 2 ? source : original, locked, input.closed, projector);
    const candidate = smoothOntoSurface(resampled, locked, input.closed, projector, original);
    const reasons = validateTrimCleanup({
        mesh: input.mesh,
        original,
        candidate,
        closed: input.closed,
        protectedPins: locked,
        endpoints,
    });
    if (reasons.length > 0) {
        const result = unchanged();
        result.reasons = reasons;
        return result;
    }
    const applied =
        candidate.length !== pins.length ||
        candidate.some((point, i) => !samePoint(point, pins[i] ?? point, 0.05));
    return {
        ok: true,
        applied,
        reasons: [],
        pins: candidate,
        curve: candidate,
    };
}

/** One undo step. A failed check leaves the dots and the shell fingerprint alone. */
export function applyAfoTrimCleanup(): { ok: boolean; reasons: string[] } {
    const session = useAfoStore.getState();
    const mesh = session.correctedMesh ?? session.castMesh;
    if (!mesh) return { ok: false, reasons: [AFO_TRIM_NO_MESH] };
    const afo = getAfoState();
    const pins = afo.trimPoints.map((point) => point.point);
    const result = cleanupTrimCurve({
        mesh,
        pins,
        curve: afo.trimCurve,
        closed: afo.trimClosed,
        anchors: trimProtectedAnchors(afo),
    });
    if (!result.ok || !result.applied) {
        if (result.reasons.length) useAfoStore.getState().setLastError(result.reasons.join(" "));
        return { ok: false, reasons: result.reasons };
    }
    useAfoStore.getState().setLastError(null);
    patchAfoState(
        {
            trimPoints: result.pins.map((point) => ({
                point,
                vertexIndex: nearestVertex(mesh, point).index,
            })),
            trimCurve: result.curve,
            shellReady: false,
        },
        "afo-trim-cleanup",
    );
    return { ok: true, reasons: [] };
}
