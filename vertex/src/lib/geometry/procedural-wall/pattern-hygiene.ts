// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    booleanOp,
    ClipType,
    EndType,
    FillRule,
    inflatePathsD,
    isPositive,
    isPositiveD,
    JoinType,
    type Path64,
    unionD,
} from "clipper2-ts";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { minDistToLoopXY, pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    fitClosedC2Spline,
    nearestClosedArc01,
    type PolyPoint,
    polygonSignedArea,
    resampleClosedC2,
    resamplePolyline,
    sampleClosedAtArc01,
} from "./curves";
import { scaleToMinInset } from "./faired-pattern";
import { masterCurveRadii, smoothClosedToMinRadius } from "./stations";

export const PATTERN_MIN_RADIUS_MM = 3;
export const PATTERN_RIM_CLEARANCE_MM = 0.5;
export const PATTERN_HARD_OUTSIDE_MM = 3;
export const PATTERN_SOURCE_SYNTHETIC = "synthetic";
/** Clipper2 integer grid: millimetres → micrometres. */
const CLIPPER_UM = 1000;
/** Extra inset so resample / fairing cannot land 1e-4 mm short of the rim gate. */
export const RIM_INSET_SLACK_MM = 0.02;

export interface InsoleFootprintAnchor {
    x0: number;
    yMid: number;
    nativeLengthMm: number;
    nativeWidthMm: number;
}

export interface FootprintBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

/** Same anchor as {@link scaleGeometryToInsoleSize} (heel at minX, width about yMid). */
export function insoleFootprintAnchorFromBounds(bounds: FootprintBounds): InsoleFootprintAnchor {
    return {
        x0: bounds.minX,
        yMid: 0.5 * (bounds.minY + bounds.maxY),
        nativeLengthMm: Math.max(1e-3, bounds.maxX - bounds.minX),
        nativeWidthMm: Math.max(1e-3, bounds.maxY - bounds.minY),
    };
}

/** Men's 9 / 260×95 reference footprint for SAMPLE_Top-native coordinates. */
export function mensNineFootprintAnchor(bounds: FootprintBounds): InsoleFootprintAnchor {
    const anchor = insoleFootprintAnchorFromBounds(bounds);
    return {
        ...anchor,
        nativeLengthMm: INSOLE_LENGTH_MM,
        nativeWidthMm: INSOLE_WIDTH_MM,
    };
}

/**
 * Apply the same XY footprint scale used on the TopSheet mesh (260 mm reference,
 * shared anchor). Z is unchanged.
 */
export function applyInsoleFootprintScale(
    loop: PolyPoint[],
    anchor: InsoleFootprintAnchor,
    lengthMm: number,
    widthMm: number,
): PolyPoint[] {
    const sx = lengthMm / anchor.nativeLengthMm;
    const sy = widthMm / anchor.nativeWidthMm;
    if (Math.abs(sx - 1) < 1e-12 && Math.abs(sy - 1) < 1e-12) {
        return loop.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    }
    return loop.map((p) => ({
        x: (p.x - anchor.x0) * sx,
        y: (p.y - anchor.yMid) * sy,
        z: p.z,
    }));
}

export interface HygieneReport {
    loop: PolyPoint[];
    turning: number;
    minRadiusMm: number;
    source: string;
}

function toPathD(loop: PolyPoint[]): Array<{ x: number; y: number }> {
    return loop.map((p) => ({ x: p.x, y: p.y }));
}

function fromPathD(path: Array<{ x: number; y: number }>, z = 0): PolyPoint[] {
    return path.map((p) => ({ x: p.x, y: p.y, z }));
}

function pathArea(path: Array<{ x: number; y: number }>): number {
    let s = 0;
    for (let i = 0; i < path.length; i++) {
        const a = path[i]!;
        const b = path[(i + 1) % path.length]!;
        s += a.x * b.y - b.x * a.y;
    }
    return 0.5 * s;
}

function largestPath(paths: Array<Array<{ x: number; y: number }>>): Array<{ x: number; y: number }> {
    let best = paths[0] ?? [];
    let bestA = -1;
    for (const path of paths) {
        const a = Math.abs(pathArea(path));
        if (a > bestA) {
            bestA = a;
            best = path;
        }
    }
    return best;
}

function dedupePath2d(loop: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    const out: Array<{ x: number; y: number }> = [];
    for (const p of loop) {
        const prev = out[out.length - 1];
        if (prev && Math.hypot(prev.x - p.x, prev.y - p.y) < 1e-6) continue;
        out.push({ x: p.x, y: p.y });
    }
    if (out.length >= 2) {
        const a = out[0]!;
        const b = out[out.length - 1]!;
        if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) out.pop();
    }
    return out;
}

function toPathUm(loop: PolyPoint[]): Path64 {
    return dedupePath2d(loop).map((p) => ({
        x: Math.round(p.x * CLIPPER_UM),
        y: Math.round(p.y * CLIPPER_UM),
    }));
}

function fromPathUm(path: Path64): PolyPoint[] {
    return dedupePath2d(path.map((p) => ({ x: p.x / CLIPPER_UM, y: p.y / CLIPPER_UM }))).map((p) => ({
        x: p.x,
        y: p.y,
        z: 0,
    }));
}

function orientPositiveUm(path: Path64): Path64 {
    return isPositive(path) ? path : path.slice().reverse();
}

export function turningNumber(loop: PolyPoint[]): number {
    let sum = 0;
    const n = loop.length;
    for (let i = 0; i < n; i++) {
        const a = loop[(i + n - 1) % n]!;
        const b = loop[i]!;
        const c = loop[(i + 1) % n]!;
        const v1x = b.x - a.x;
        const v1y = b.y - a.y;
        const v2x = c.x - b.x;
        const v2y = c.y - b.y;
        sum += Math.atan2(v1x * v2y - v1y * v2x, v1x * v2x + v1y * v2y);
    }
    return sum / (Math.PI * 2);
}

/** Clipper2 self-union so the outline is a single simple polygon (turning +1). */
export function clipperUnion(loop: PolyPoint[]): PolyPoint[] {
    const subject = [toPathD(ensureCcw(loop.map((p) => ({ ...p, z: 0 }))))];
    const paths = unionD(subject, FillRule.NonZero);
    if (!paths.length) {
        throw new Error("[S1-PATTERN] Clipper2 union produced no path");
    }
    const best = largestPath(paths);
    if (best.length < 3) {
        throw new Error("[S1-PATTERN] Clipper2 union path has fewer than 3 vertices");
    }
    const pts = fromPathD(best);
    const oriented = isPositiveD(best) ? pts : pts.slice().reverse();
    return ensureCcw(oriented);
}

/** Clipper2 round-join inward offset. Used only as the CDT sliver fallback ring. */
export function clipperRoundInset(loop: PolyPoint[], deltaMm: number): PolyPoint[] {
    const src = ensureCcw(loop.map((p) => ({ ...p, z: 0 })));
    const area = polygonSignedArea(src);
    const signed = area >= 0 ? -Math.abs(deltaMm) : Math.abs(deltaMm);
    const paths = inflatePathsD([toPathD(src)], signed, JoinType.Round, EndType.Polygon, 2, 2);
    if (!paths.length) {
        throw new Error(`[S1-PATTERN] Clipper2 inset ${deltaMm} mm produced no path`);
    }
    const best = largestPath(paths);
    if (best.length < 3) {
        throw new Error("[S1-PATTERN] Clipper2 inset path has fewer than 3 vertices");
    }
    const pts = fromPathD(best);
    const oriented = isPositiveD(best) ? pts : pts.slice().reverse();
    return ensureCcw(oriented);
}

/** Largest simple intersection of two closed loops (integer µm Clipper2). */
export function intersectPatternWithRim(pattern: PolyPoint[], rim: PolyPoint[]): PolyPoint[] | null {
    if (pattern.length < 3 || rim.length < 3) return null;
    const subject = [orientPositiveUm(toPathUm(ensureCcw(pattern.map((p) => ({ ...p, z: 0 })))))];
    const clip = [orientPositiveUm(toPathUm(ensureCcw(rim.map((p) => ({ ...p, z: 0 })))))];
    const out = booleanOp(ClipType.Intersection, subject, clip, FillRule.NonZero) as Path64[];
    if (!out?.length) return null;
    let best: Path64 | null = null;
    let bestA = -1;
    for (const path of out) {
        if (path.length < 3) continue;
        const pts = fromPathUm(path);
        const a = Math.abs(polygonSignedArea(pts));
        if (a > bestA) {
            bestA = a;
            best = path;
        }
    }
    return best ? fromPathUm(best) : null;
}

/** Max distance any station sits outside the rim (0 when fully inside). */
export function maxOutsideRimViolationMm(pattern: PolyPoint[], rim: PolyPoint[]): number {
    let maxOut = 0;
    for (const p of pattern) {
        if (pointInPoly(p.x, p.y, rim)) continue;
        maxOut = Math.max(maxOut, minDistToLoopXY(p.x, p.y, rim));
    }
    return maxOut;
}

export function signedRimInsetMmPattern(p: PolyPoint, rim: PolyPoint[]): number {
    const d = minDistToLoopXY(p.x, p.y, rim);
    return pointInPoly(p.x, p.y, rim) ? d : -d;
}

export interface PatternRimGateContext {
    sizeLabel?: string;
    /** e.g. reconstruct:user-bottom-pattern, hygieneBottomPattern:keepFair */
    codePath: string;
}

function logPatternRimFailure(
    pattern: PolyPoint[],
    rim: PolyPoint[],
    ctx: PatternRimGateContext,
    extra?: Record<string, unknown>,
): void {
    let worstSigned = Infinity;
    let worstI = 0;
    for (let i = 0; i < pattern.length; i++) {
        const signed = signedRimInsetMmPattern(pattern[i]!, rim);
        if (signed < worstSigned) {
            worstSigned = signed;
            worstI = i;
        }
    }
    const p = pattern[worstI]!;
    console.error(
        "[S1-PATTERN-RIM-FAIL]",
        JSON.stringify({
            station: worstI,
            x: Number(p.x.toFixed(2)),
            y: Number(p.y.toFixed(2)),
            signedRimInsetMm: Number(worstSigned.toFixed(3)),
            maxPreClipOutsideMm: maxOutsideRimViolationMm(pattern, rim),
            sizeLabel: ctx.sizeLabel ?? "unknown",
            codePath: ctx.codePath,
            ...extra,
        }),
    );
}

/**
 * Footprint XY scale for bottom patterns. Viewer/export store user patterns in the
 * same frame as the composed TopSheet; skip re-scaling in that case.
 */
export function alignPatternToExportFootprint(
    loop: PolyPoint[],
    opts: {
        footprintReferenceBounds?: FootprintBounds;
        footprintLengthMm?: number;
        footprintWidthMm?: number;
        /** Pattern already matches the loft TopSheet (stored B, faired on scaled mesh). */
        patternInMeshFrame?: boolean;
    },
): PolyPoint[] {
    if (opts.patternInMeshFrame) {
        return loop.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    }
    const lengthMm = opts.footprintLengthMm;
    const widthMm = opts.footprintWidthMm;
    const ref = opts.footprintReferenceBounds;
    if (!ref || lengthMm == null || widthMm == null) {
        return loop.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    }
    const anchor = insoleFootprintAnchorFromBounds(ref);
    return applyInsoleFootprintScale(loop, anchor, lengthMm, widthMm);
}

export type PatternRimCase = "inside" | "clip_warn" | "hard_fail";

export interface PatternRimClipResult {
    loop: PolyPoint[];
    case: PatternRimCase;
    /**
     * Symmetric-difference area between the input stations and the output
     * polyline, in mm². Zero when the outline is already inside the rim.
     */
    clippedAreaMm2: number;
    /** Max distance from each original station to the output polyline, mm. */
    displacementMm: number;
    symmetricDifferenceMm2: number;
}

function copyStation(p: PolyPoint): PolyPoint {
    return { x: p.x, y: p.y, z: p.z };
}

/** Max distance from each original station to the output polyline (same frame). */
export function maxStationToPolylineMm(stations: PolyPoint[], loop: PolyPoint[]): number {
    if (stations.length === 0 || loop.length === 0) return 0;
    let maxD = 0;
    for (const p of stations) {
        const d =
            loop.length < 2
                ? Math.hypot(p.x - loop[0]!.x, p.y - loop[0]!.y)
                : minDistToLoopXY(p.x, p.y, loop);
        if (d > maxD) maxD = d;
    }
    return maxD;
}

/** Area of the symmetric difference of two simple loops (mm²). */
export function symmetricDifferenceAreaMm2(a: PolyPoint[], b: PolyPoint[]): number {
    if (a.length < 3 || b.length < 3) return 0;
    const subject = [orientPositiveUm(toPathUm(ensureCcw(a.map((p) => ({ ...p, z: 0 })))))];
    const clip = [orientPositiveUm(toPathUm(ensureCcw(b.map((p) => ({ ...p, z: 0 })))))];
    const out = booleanOp(ClipType.Xor, subject, clip, FillRule.NonZero) as Path64[];
    if (!out?.length) return 0;
    let area = 0;
    for (const path of out) {
        if (path.length < 3) continue;
        area += Math.abs(polygonSignedArea(fromPathUm(path)));
    }
    return area;
}

function resampleClosedToCount(clipped: PolyPoint[], n: number, origin: PolyPoint): PolyPoint[] {
    const s0 = nearestClosedArc01(clipped, origin);
    const out: PolyPoint[] = [];
    for (let i = 0; i < n; i++) out.push(sampleClosedAtArc01(clipped, s0 + i / n));
    return out;
}

function arcSpan01(s0: number, s1: number, forward: boolean): number {
    const raw = forward ? s1 - s0 : s0 - s1;
    return ((raw % 1) + 1) % 1;
}

function sampleOpenArc(
    loop: PolyPoint[],
    s0: number,
    s1: number,
    forward: boolean,
    count: number,
): PolyPoint[] {
    const span = arcSpan01(s0, s1, forward);
    if (span < 1e-9 || count <= 0) {
        const p = sampleClosedAtArc01(loop, s0);
        return Array.from({ length: Math.max(count, 0) }, () => ({ x: p.x, y: p.y, z: p.z }));
    }
    const out: PolyPoint[] = [];
    for (let i = 1; i <= count; i++) {
        const f = i / (count + 1);
        const s = forward ? s0 + f * span : s0 - f * span;
        out.push(sampleClosedAtArc01(loop, s));
    }
    return out;
}

function arcCloserForward(loop: PolyPoint[], s0: number, s1: number, window: PolyPoint[]): boolean {
    let cx = 0;
    let cy = 0;
    for (const p of window) {
        cx += p.x;
        cy += p.y;
    }
    const n = Math.max(1, window.length);
    cx /= n;
    cy /= n;
    const spanF = arcSpan01(s0, s1, true);
    const spanB = arcSpan01(s0, s1, false);
    const midF = sampleClosedAtArc01(loop, s0 + 0.5 * (spanF < 1e-9 ? 1 : spanF));
    const midB = sampleClosedAtArc01(loop, s0 - 0.5 * (spanB < 1e-9 ? 1 : spanB));
    const dF = (midF.x - cx) ** 2 + (midF.y - cy) ** 2;
    const dB = (midB.x - cx) ** 2 + (midB.y - cy) ** 2;
    if (Math.abs(dF - dB) > 1e-8) return dF < dB;
    return spanF <= spanB;
}

function paddedSpanMask(flags: boolean[], pad: number): boolean[] {
    const n = flags.length;
    const mask = flags.slice();
    for (let i = 0; i < n; i++) {
        if (!flags[i]) continue;
        for (let d = 1; d <= pad; d++) {
            mask[(i - d + n) % n] = true;
            mask[(i + d) % n] = true;
        }
    }
    return mask;
}

function maskToSpans(mask: boolean[]): Array<{ start: number; count: number }> {
    const n = mask.length;
    if (n === 0) return [];
    let i = 0;
    while (i < n && mask[i]) i++;
    if (i === n) return [{ start: 0, count: n }];
    const spans: Array<{ start: number; count: number }> = [];
    let k = 0;
    while (k < n) {
        const idx = (i + k) % n;
        if (!mask[idx]) {
            k++;
            continue;
        }
        let count = 0;
        while (count < n && mask[(idx + count) % n]) count++;
        spans.push({ start: idx, count });
        k += count;
    }
    return spans;
}

/**
 * Replace only stations that miss the rim clearance, plus one station on
 * either side, with arc-length samples of the clipped outline. Every other
 * station keeps its exact coordinates.
 */
function resampleClippedSpans(
    pattern: PolyPoint[],
    clipped: PolyPoint[],
    rim: PolyPoint[],
    clearanceMm: number,
): PolyPoint[] {
    const n = pattern.length;
    const clippedCcw = ensureCcw(clipped.map((p) => ({ x: p.x, y: p.y, z: 0 })));
    if (n < 3) {
        return resampleClosedToCount(clippedCcw, Math.max(n, 3), pattern[0] ?? { x: 0, y: 0, z: 0 });
    }
    const violate = pattern.map((p) => signedRimInsetMmPattern(p, rim) < clearanceMm - 1e-6);
    const spans = maskToSpans(paddedSpanMask(violate, 1));
    if (spans.length === 0 || (spans.length === 1 && spans[0]!.count >= n)) {
        return resampleClosedToCount(clippedCcw, n, pattern[0]!).map((p, i) => ({
            x: p.x,
            y: p.y,
            z: pattern[i]!.z,
        }));
    }
    const out = pattern.map(copyStation);
    for (const span of spans) {
        const left = (span.start - 1 + n) % n;
        const right = (span.start + span.count) % n;
        const window: PolyPoint[] = [];
        for (let k = 0; k < span.count; k++) window.push(pattern[(span.start + k) % n]!);
        const sL = nearestClosedArc01(clippedCcw, pattern[left]!);
        const sR = nearestClosedArc01(clippedCcw, pattern[right]!);
        const forward = arcCloserForward(clippedCcw, sL, sR, window);
        const samples = sampleOpenArc(clippedCcw, sL, sR, forward, span.count);
        for (let k = 0; k < span.count; k++) {
            const idx = (span.start + k) % n;
            const s = samples[k]!;
            out[idx] = { x: s.x, y: s.y, z: pattern[idx]!.z };
        }
    }
    return out;
}

/**
 * Gate on the pre-clip outside violation. An outline already inside the rim
 * passes through bit-identical (no inset, no resample). A mild violation is
 * clipped, and only that span plus one station on either side is re-sampled.
 * Hard fail only when the violation exceeds hardOutsideMm.
 */
export function clipPatternInsideRim(
    pattern: PolyPoint[],
    rim: PolyPoint[],
    clearanceMm: number,
    resampleN: number,
    opts?: { sizeLabel?: string; hardOutsideMm?: number; codePath?: string },
): PatternRimClipResult {
    // Callers still pass a global station count. Inside outlines are not
    // re-spaced, and a clipped span keeps the original stations outside it.
    void resampleN;
    const hardOutsideMm = opts?.hardOutsideMm ?? PATTERN_HARD_OUTSIDE_MM;
    const maxOut = maxOutsideRimViolationMm(pattern, rim);
    if (maxOut > hardOutsideMm + 1e-6) {
        logPatternRimFailure(pattern, rim, {
            sizeLabel: opts?.sizeLabel,
            codePath: opts?.codePath ?? "clipPatternInsideRim",
        });
        throw new Error(
            `[S1-PATTERN] pattern is ${maxOut.toFixed(2)} mm outside the TopSheet rim ` +
                `(max ${hardOutsideMm} mm); size=${opts?.sizeLabel ?? "unknown"}`,
        );
    }
    if (maxOut <= 1e-6) {
        return {
            loop: pattern.map(copyStation),
            case: "inside",
            clippedAreaMm2: 0,
            displacementMm: 0,
            symmetricDifferenceMm2: 0,
        };
    }
    const rimGate = clipperRoundInset(rim, clearanceMm);
    const clipped = intersectPatternWithRim(pattern, rimGate);
    if (!clipped || clipped.length < 3) {
        throw new Error(
            `[S1-PATTERN] Clipper2 intersection with rim inset ${clearanceMm} mm produced no path`,
        );
    }
    const loop = resampleClippedSpans(pattern, clipped, rim, clearanceMm);
    const displacementMm = maxStationToPolylineMm(pattern, loop);
    const symmetricDifferenceMm2 = symmetricDifferenceAreaMm2(pattern, loop);
    console.warn(
        `[S1-PATTERN] clipped ${symmetricDifferenceMm2.toFixed(2)} mm² symmetric difference ` +
            `(displacement ${displacementMm.toFixed(3)} mm; max outside ${maxOut.toFixed(3)} mm; ` +
            `size=${opts?.sizeLabel ?? "unknown"})`,
    );
    return {
        loop,
        case: "clip_warn",
        clippedAreaMm2: symmetricDifferenceMm2,
        displacementMm,
        symmetricDifferenceMm2,
    };
}

function smoothHeelBand(loop: PolyPoint[], uMax: number, passes: number): PolyPoint[] {
    if (loop.length < 4) return loop;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of loop) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
    }
    const length = Math.max(1e-3, maxX - minX);
    let cur = loop.map((p) => ({ ...p }));
    for (let pass = 0; pass < passes; pass++) {
        const next = cur.map((p) => ({ ...p }));
        for (let i = 0; i < cur.length; i++) {
            const u = (cur[i]!.x - minX) / length;
            if (u > uMax) continue;
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const b = cur[i]!;
            const c = cur[(i + 1) % cur.length]!;
            next[i] = {
                x: 0.5 * b.x + 0.25 * (a.x + c.x),
                y: 0.5 * b.y + 0.25 * (a.y + c.y),
                z: b.z,
            };
        }
        cur = next;
    }
    return cur;
}

function nearestOnLoopXY(origin: PolyPoint, loop: PolyPoint[]): PolyPoint {
    let best = loop[0] ?? { x: origin.x, y: origin.y, z: 0 };
    let bestD = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t =
            len2 > 1e-12
                ? Math.max(0, Math.min(1, ((origin.x - a.x) * ex + (origin.y - a.y) * ey) / len2))
                : 0;
        const x = a.x + ex * t;
        const y = a.y + ey * t;
        const d = (x - origin.x) ** 2 + (y - origin.y) ** 2;
        if (d < bestD) {
            bestD = d;
            best = { x, y, z: 0 };
        }
    }
    return best;
}

function rimCentroid(rim: PolyPoint[]): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const p of rim) {
        x += p.x;
        y += p.y;
    }
    const n = Math.max(1, rim.length);
    return { x: x / n, y: y / n };
}

/**
 * If any sample sits short of the rim gate, inset the whole pattern by the
 * deficit. A uniform Clipper offset keeps the faired shape; per-vertex snaps
 * kink the toe and drive E/F turning.
 */
export function enforceMinRimInset(
    pattern: PolyPoint[],
    rim: PolyPoint[],
    minInsetMm: number,
    opts?: { smooth?: boolean },
): PolyPoint[] {
    if (pattern.length < 3 || rim.length < 3 || minInsetMm <= 0) return pattern;
    const need = minInsetMm + RIM_INSET_SLACK_MM;
    let minIn = Infinity;
    for (const p of pattern) {
        const d = minDistToLoopXY(p.x, p.y, rim);
        const inset = pointInPoly(p.x, p.y, rim) ? d : -d;
        if (inset < minIn) minIn = inset;
    }
    if (minIn >= need - 1e-9) return pattern.map((p) => ({ x: p.x, y: p.y, z: 0 }));
    const extra = need - minIn;
    try {
        const inseted = clipperRoundInset(pattern, extra);
        if (inseted.length >= 3) {
            let after = Infinity;
            for (const p of inseted) {
                const d = minDistToLoopXY(p.x, p.y, rim);
                const inset = pointInPoly(p.x, p.y, rim) ? d : -d;
                if (inset < after) after = inset;
            }
            if (after >= minInsetMm - 1e-6) return inseted.map((p) => ({ x: p.x, y: p.y, z: 0 }));
        }
    } catch {
        /* fall through */
    }
    if (opts?.smooth) return scaleToMinInset(pattern, rim, minInsetMm);
    const c = rimCentroid(rim);
    return pattern.map((p) => {
        let q = { x: p.x, y: p.y, z: 0 };
        for (let iter = 0; iter < 16; iter++) {
            const d = minDistToLoopXY(q.x, q.y, rim);
            const inside = pointInPoly(q.x, q.y, rim);
            const inset = inside ? d : -d;
            if (inset >= need - 1e-9) return q;
            const near = nearestOnLoopXY(q, rim);
            let vx = inside ? q.x - near.x : c.x - near.x;
            let vy = inside ? q.y - near.y : c.y - near.y;
            if (Math.hypot(vx, vy) < 1e-9) {
                vx = c.x - near.x;
                vy = c.y - near.y;
            }
            const vl = Math.hypot(vx, vy) || 1;
            q = {
                x: q.x + (vx / vl) * Math.max(need - inset, 0.05),
                y: q.y + (vy / vl) * Math.max(need - inset, 0.05),
                z: 0,
            };
        }
        return q;
    });
}

export function assertInsideRim(
    pattern: PolyPoint[],
    rimPlan: PolyPoint[],
    clearanceMm = PATTERN_RIM_CLEARANCE_MM,
    ctx?: PatternRimGateContext,
): void {
    if (rimPlan.length < 3) return;
    for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i]!;
        const signed = signedRimInsetMmPattern(p, rimPlan);
        const d = minDistToLoopXY(p.x, p.y, rimPlan);
        if (!pointInPoly(p.x, p.y, rimPlan) && d > 1e-4) {
            if (ctx) {
                logPatternRimFailure(pattern, rimPlan, ctx, {
                    failStation: i,
                    signedRimInsetMm: Number(signed.toFixed(3)),
                    outsideMm: Number(d.toFixed(3)),
                });
            }
            throw new Error(
                `[S1-PATTERN] station ${i} (${p.x.toFixed(2)},${p.y.toFixed(2)}) is outside the TopSheet rim`,
            );
        }
        if (d < clearanceMm - 1e-6) {
            if (ctx) {
                console.error(
                    "[S1-PATTERN-RIM-FAIL]",
                    JSON.stringify({
                        station: i,
                        x: Number(p.x.toFixed(2)),
                        y: Number(p.y.toFixed(2)),
                        signedRimInsetMm: Number(signed.toFixed(3)),
                        insetMm: Number(d.toFixed(3)),
                        clearanceMm,
                        sizeLabel: ctx.sizeLabel ?? "unknown",
                        codePath: ctx.codePath,
                        case: "clearance",
                    }),
                );
            }
            throw new Error(
                `[S1-PATTERN] station ${i} (${p.x.toFixed(2)},${p.y.toFixed(2)}) is ` +
                    `${d.toFixed(3)} mm from the rim (need >= ${clearanceMm} mm)`,
            );
        }
    }
}

/**
 * Pattern hygiene before stations: Clipper2 union (turning +1), C2 smooth to
 * min radius >= 3 mm, arc-length resample. Optionally reject if the pattern
 * is not inside the TopSheet rim plan minus 0.5 mm.
 */
export function hygieneBottomPattern(
    loop: PolyPoint[],
    opts?: {
        rimPlan?: PolyPoint[];
        requireInsideRim?: boolean;
        clearanceMm?: number;
        source?: string;
        resampleN?: number;
        /** Keep a fair few-control spline; do not re-interpolate or Laplacian the heel. */
        keepFair?: boolean;
        sizeLabel?: string;
        rimHardOutsideMm?: number;
        codePath?: string;
    },
): HygieneReport {
    const rimCtx: PatternRimGateContext = {
        sizeLabel: opts?.sizeLabel,
        codePath: opts?.codePath ?? "hygieneBottomPattern",
    };
    const hardOutsideMm = opts?.rimHardOutsideMm ?? PATTERN_HARD_OUTSIDE_MM;
    const sourceLoop = ensureCcw(loop.map((p) => ({ ...p, z: 0 })));
    const tn0 = turningNumber(sourceLoop);
    const unioned = Math.abs(tn0 - 1) < 0.05 && opts?.keepFair ? sourceLoop : clipperUnion(sourceLoop);
    const tn = turningNumber(unioned);
    if (Math.abs(tn - 1) > 0.05) {
        throw new Error(`[S1-PATTERN] turning number ${tn.toFixed(3)} is not +1 after Clipper2 union`);
    }
    if (opts?.keepFair) {
        const n = Math.max(opts.resampleN ?? 0, 160, unioned.length);
        const resampled = resamplePolyline(unioned, n);
        const minRadiusMm = masterCurveRadii(resampled).minRadiusMm;
        if (opts.requireInsideRim && opts.rimPlan?.length) {
            const clearance = opts.clearanceMm ?? PATTERN_RIM_CLEARANCE_MM;
            const clip = clipPatternInsideRim(resampled, opts.rimPlan, clearance, n, {
                sizeLabel: opts.sizeLabel,
                hardOutsideMm: hardOutsideMm,
                codePath: rimCtx.codePath,
            });
            assertInsideRim(clip.loop, opts.rimPlan, clip.case === "inside" ? 0 : clearance, rimCtx);
            return {
                loop: clip.loop,
                turning: turningNumber(clip.loop),
                minRadiusMm,
                source: opts.source ?? "pattern",
            };
        }
        return {
            loop: resampled,
            turning: turningNumber(resampled),
            minRadiusMm,
            source: opts.source ?? "pattern",
        };
    }
    const smoothed = smoothClosedToMinRadius(unioned, PATTERN_MIN_RADIUS_MM, unioned.length);
    const minRadiusMm = masterCurveRadii(smoothed).minRadiusMm;
    if (minRadiusMm + 1e-6 < PATTERN_MIN_RADIUS_MM) {
        throw new Error(
            `[S1-PATTERN] min radius of curvature ${minRadiusMm.toFixed(2)} < ${PATTERN_MIN_RADIUS_MM} mm`,
        );
    }
    const n = Math.max(opts?.resampleN ?? 0, 160, smoothed.length);
    const resampled = smoothHeelBand(resampleClosedC2(fitClosedC2Spline(smoothed), n), 0.18, 8);
    if (opts?.requireInsideRim && opts.rimPlan?.length) {
        const clearance = opts.clearanceMm ?? PATTERN_RIM_CLEARANCE_MM;
        const clip = clipPatternInsideRim(resampled, opts.rimPlan, clearance, n, {
            sizeLabel: opts?.sizeLabel,
            hardOutsideMm: hardOutsideMm,
            codePath: rimCtx.codePath,
        });
        assertInsideRim(clip.loop, opts.rimPlan, clip.case === "inside" ? 0 : clearance, rimCtx);
        return {
            loop: clip.loop,
            turning: turningNumber(clip.loop),
            minRadiusMm,
            source: opts?.source ?? "pattern",
        };
    }
    const source = opts?.source ?? "pattern";
    return { loop: resampled, turning: turningNumber(resampled), minRadiusMm, source };
}
