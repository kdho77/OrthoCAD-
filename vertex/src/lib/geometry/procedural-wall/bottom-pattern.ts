// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    type PolyPoint,
    polylineArcLengths,
    resamplePolyline,
    startAtLowCurvature,
    startAtPosteriorHeel,
} from "./curves";
import { FAIRED_CONTROL_DEFAULT, fairedPattern } from "./faired-pattern";

export const PATTERN_INSET_MM = 2;
export const PATTERN_HEEL_INSET_MM = 8;
export const PATTERN_HEEL_LATERAL_INSET_MM = 2;
export const PATTERN_ARCH_INSET_MM = 28;
/** Constant toe-box inset so the forefoot matches the top outline. */
export const PATTERN_FOREFOOT_INSET_MM = 1;
/** Floor under every region; the toe box is exactly `PATTERN_FOREFOOT_INSET_MM`. */
export const PATTERN_MIN_INSET_MM = 1;
export const PATTERN_BLEND_MM = 18;
export const PATTERN_HEEL_U1 = 0.16;
/** Arch cut-in starts just ahead of the heel. */
export const PATTERN_ARCH_U0 = 0.16;
/** Arch cut-in ends behind the ball. */
export const PATTERN_ARCH_U1 = 0.62;
export const PATTERN_FORE_U0 = 0.76;
export const PATTERN_SOURCE_SYNTHETIC = "synthetic";
export const PATTERN_FEATURE_COUNT = 16;
export const PATTERN_CONTROL_COUNT = FAIRED_CONTROL_DEFAULT;
export const PATTERN_SILHOUETTE_MM = 1;
/** Bound on |dk/ds| (1/mm²) so k(s) stays fair — no local curvature spikes. */
export const PATTERN_MAX_DKDS = 0.02;
/** Sign change counts only where |k| exceeds this for ≥ INFLECTION_MIN_ARC_MM. */
export const INFLECTION_K_EPS = 0.002;
export const INFLECTION_MIN_ARC_MM = 3;
/** Lateral slack: k ≥ this, or the QP holds k ≥ 0 every 1 mm. */
export const LATERAL_K_SLACK = -0.005;
export const PATTERN_LATERAL_K_SAMPLE_MM = 1;
export const PATTERN_FAIR_RETRY_W = 0.55;
export const PATTERN_CONTROL_RETRY = 14;
export const MIDFOOT_U0 = 0.28;
export const MIDFOOT_U1 = 0.48;

/** +1 when the higher midfoot rim is on +Y; never a hardcoded axis. */
export type MedialYSign = 1 | -1;

function rimYMid(rim: PolyPoint[]): number {
    if (!rim.length) return 0;
    let s = 0;
    for (const p of rim) s += p.y;
    return s / rim.length;
}

/**
 * Medial is the side where the top's arch rim is highest at midfoot.
 * `side` is only a hint: the high rim wins if they disagree. Flat-Z → +1.
 */
export function medialYSignFromTopRim(
    rim3d: PolyPoint[],
    bounds: { minX: number; maxX: number },
    side?: "left" | "right",
): MedialYSign {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const yMid = rimYMid(rim3d);
    let maxPos = -Infinity;
    let maxNeg = -Infinity;
    for (const p of rim3d) {
        const u = (p.x - bounds.minX) / length;
        if (u < MIDFOOT_U0 || u > MIDFOOT_U1) continue;
        if (p.y >= yMid) maxPos = Math.max(maxPos, p.z);
        else maxNeg = Math.max(maxNeg, p.z);
    }
    let sign: MedialYSign = 1;
    if (Number.isFinite(maxPos) && Number.isFinite(maxNeg) && maxNeg > maxPos + 1e-6) sign = -1;
    if (side === "right" && sign === 1 && !(Number.isFinite(maxPos) && Number.isFinite(maxNeg))) {
        return -1;
    }
    return sign;
}

/** Medial is the midfoot side where the pattern sits farther inboard of the rim. */
export function medialYSignFromPattern(
    pattern: PolyPoint[],
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
): MedialYSign {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const yMid = rimYMid(rim.length ? rim : pattern);
    let pos = 0;
    let neg = 0;
    let nPos = 0;
    let nNeg = 0;
    for (const p of pattern) {
        const u = (p.x - bounds.minX) / length;
        if (u < MIDFOOT_U0 || u > MIDFOOT_U1) continue;
        const c = minDistToLoopXY(p.x, p.y, rim.length ? rim : pattern);
        if (p.y >= yMid) {
            pos += c;
            nPos++;
        } else {
            neg += c;
            nNeg++;
        }
    }
    if (!nPos && !nNeg) return 1;
    const posM = nPos ? pos / nPos : 0;
    const negM = nNeg ? neg / nNeg : 0;
    return negM > posM + 1e-6 ? -1 : 1;
}

/** Deepest midfoot pattern clearance must sit on the high-rim (medial) side. */
export function assertCutInOnHighRimSide(
    pattern: PolyPoint[],
    rim3d: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: MedialYSign,
): void {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const yMid = rimYMid(rim3d);
    let best = -Infinity;
    let bestSide = 0;
    for (const p of pattern) {
        const u = (p.x - bounds.minX) / length;
        if (u < MIDFOOT_U0 || u > MIDFOOT_U1) continue;
        const c = minDistToLoopXY(p.x, p.y, rim3d);
        if (c > best) {
            best = c;
            bestSide = p.y - yMid;
        }
    }
    if (best < 4) return;
    if (bestSide * sign <= 0) {
        throw new Error(
            `[S1-MEDIAL] cut-in side ${bestSide >= 0 ? "+" : "-"}Y != high-rim sign ${sign} ` +
                `(clearance ${best.toFixed(2)} mm)`,
        );
    }
}

function minDistToLoopXY(x: number, y: number, loop: PolyPoint[]): number {
    let best = Infinity;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i]!;
        const b = loop[(i + 1) % loop.length]!;
        const ex = b.x - a.x;
        const ey = b.y - a.y;
        const len2 = ex * ex + ey * ey;
        const t = len2 > 1e-12 ? Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / len2)) : 0;
        best = Math.min(best, Math.hypot(x - (a.x + ex * t), y - (a.y + ey * t)));
    }
    return best;
}

function edgeInward(a: PolyPoint, b: PolyPoint, outline: PolyPoint[]): { x: number; y: number } {
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len;
    let ny = ex / len;
    const probe = { x: (a.x + b.x) * 0.5 + nx * 0.5, y: (a.y + b.y) * 0.5 + ny * 0.5 };
    if (!pointInPoly(probe.x, probe.y, outline)) {
        nx = -nx;
        ny = -ny;
    }
    return { x: nx, y: ny };
}

/**
 * C∞ lateral taper: 8 mm at the heel, 1 mm at the toe. No region steps.
 * `(0.5 + 0.5 cos(πu))²` holds the heel width, then falls smoothly.
 */
export function fairLateralInsetMm(u: number): number {
    const t = Math.max(0, Math.min(1, u));
    const w = 0.5 + 0.5 * Math.cos(Math.PI * t);
    return PATTERN_FOREFOOT_INSET_MM + (PATTERN_HEEL_INSET_MM - PATTERN_FOREFOOT_INSET_MM) * w * w;
}

/**
 * Medial arch as one long shallow C2 bump on the lateral taper.
 * `sin⁴(πt)` is C2 at the ends (value and first two derivatives vanish).
 */
export function fairInsetMm(u: number, medial: boolean): number {
    const dLat = fairLateralInsetMm(u);
    if (!medial) return Math.max(PATTERN_MIN_INSET_MM, dLat);
    const span = PATTERN_ARCH_U1 - PATTERN_ARCH_U0;
    const t = (u - PATTERN_ARCH_U0) / span;
    if (t <= 0 || t >= 1) return Math.max(PATTERN_MIN_INSET_MM, dLat);
    const bump = Math.sin(Math.PI * t) ** 4;
    return Math.max(PATTERN_MIN_INSET_MM, dLat + (PATTERN_ARCH_INSET_MM - dLat) * bump);
}

function unitInward(outline: PolyPoint[], i: number): { x: number; y: number } {
    const n = edgeInward(outline[(i + outline.length - 1) % outline.length]!, outline[i]!, outline);
    const m = edgeInward(outline[i]!, outline[(i + 1) % outline.length]!, outline);
    const x = n.x + m.x;
    const y = n.y + m.y;
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
}

function smoothUnit2(ns: Array<{ x: number; y: number }>, passes: number): Array<{ x: number; y: number }> {
    let cur = ns.map((n) => ({ ...n }));
    for (let p = 0; p < passes; p++) {
        const next = cur.map((n, i) => {
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const c = cur[(i + 1) % cur.length]!;
            const x = n.x * 0.5 + (a.x + c.x) * 0.25;
            const y = n.y * 0.5 + (a.y + c.y) * 0.25;
            const len = Math.hypot(x, y) || 1;
            return { x: x / len, y: y / len };
        });
        cur = next;
    }
    return cur;
}

export interface PatternCurvatureReport {
    k: number[];
    s: number[];
    inflections: number;
    inflectionU: number[];
    maxAbsDkDs: number;
    lateralMinK: number;
}

/** Signed polyline curvature k = Δθ / Δs. Positive is left-turning (CCW convex). */
export function closedSignedCurvature(loop: PolyPoint[]): { k: number[]; s: number[] } {
    const n = loop.length;
    const k = new Array<number>(n).fill(0);
    const s = new Array<number>(n).fill(0);
    let acc = 0;
    for (let i = 0; i < n; i++) {
        const a = loop[(i + n - 1) % n]!;
        const b = loop[i]!;
        const c = loop[(i + 1) % n]!;
        const ab = Math.hypot(b.x - a.x, b.y - a.y);
        const bc = Math.hypot(c.x - b.x, c.y - b.y);
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
        const ang = Math.atan2(cross, dot);
        k[i] = ang / Math.max(0.5 * (ab + bc), 1e-9);
        s[i] = acc;
        acc += bc;
    }
    return { k, s };
}

/**
 * Count closed-curve inflections with hysteresis: a sign change only counts
 * where |k| > `eps` for at least `minArcMm` of arc on each side.
 */
export function countClosedInflections(
    k: number[],
    s?: number[],
    eps = INFLECTION_K_EPS,
    minArcMm = INFLECTION_MIN_ARC_MM,
): number {
    const n = k.length;
    if (n < 3) return 0;
    const ds = new Array<number>(n).fill(1);
    if (s && s.length === n) {
        for (let i = 0; i < n - 1; i++) ds[i] = Math.max(s[i + 1]! - s[i]!, 1e-9);
        ds[n - 1] = Math.max(s[1]! - s[0]!, 1e-9);
    }
    const runs: Array<{ sign: number; arc: number }> = [];
    let sign = 0;
    let arc = 0;
    const flush = (): void => {
        if (sign !== 0 && arc >= minArcMm - 1e-9) runs.push({ sign, arc });
        sign = 0;
        arc = 0;
    };
    for (let t = 0; t < n; t++) {
        const ki = k[t]!;
        if (Math.abs(ki) < eps) {
            flush();
            continue;
        }
        const sg = Math.sign(ki);
        if (sign === 0) {
            sign = sg;
            arc = ds[t]!;
        } else if (sg === sign) {
            arc += ds[t]!;
        } else {
            flush();
            sign = sg;
            arc = ds[t]!;
        }
    }
    flush();
    const merged: Array<{ sign: number; arc: number }> = [];
    for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && last.sign === r.sign) last.arc += r.arc;
        else merged.push({ ...r });
    }
    if (merged.length >= 2 && merged[0]!.sign === merged[merged.length - 1]!.sign) {
        merged[0]!.arc += merged.pop()!.arc;
    }
    if (merged.length < 2) return 0;
    let count = 0;
    for (let i = 0; i < merged.length; i++) {
        if (merged[i]!.sign !== merged[(i + 1) % merged.length]!.sign) count++;
    }
    return count;
}

export function patternCurvatureReport(
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: MedialYSign = 1,
): PatternCurvatureReport {
    const { k, s } = closedSignedCurvature(loop);
    const n = loop.length;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const yMid = rimYMid(loop);
    const total = s.length
        ? (s[s.length - 1] ?? 0) +
          Math.hypot((loop[0]?.x ?? 0) - (loop[n - 1]?.x ?? 0), (loop[0]?.y ?? 0) - (loop[n - 1]?.y ?? 0))
        : 1;
    let maxAbsDkDs = 0;
    for (let i = 0; i < n; i++) {
        const ds = i + 1 < n ? s[i + 1]! - s[i]! : Math.max(total - s[i]!, 1e-9);
        const dk = k[(i + 1) % n]! - k[i]!;
        if (ds > 1e-6) maxAbsDkDs = Math.max(maxAbsDkDs, Math.abs(dk / ds));
    }
    const inflectionU: number[] = [];
    let prev = 0;
    let runArc = 0;
    for (let i = 0; i < n; i++) {
        if (Math.abs(k[i]!) < INFLECTION_K_EPS) {
            prev = 0;
            runArc = 0;
            continue;
        }
        const sg = Math.sign(k[i]!);
        const ds = i + 1 < n ? s[i + 1]! - s[i]! : Math.max(total - s[i]!, 1e-9);
        if (prev && sg !== prev && runArc >= INFLECTION_MIN_ARC_MM) {
            inflectionU.push(Math.max(0, Math.min(1, (loop[i]!.x - bounds.minX) / length)));
            runArc = 0;
        }
        runArc += ds;
        prev = sg;
    }
    let lateralMinK = Infinity;
    for (let i = 0; i < n; i++) {
        const p = loop[i]!;
        if ((p.y - yMid) * sign > 0) continue;
        lateralMinK = Math.min(lateralMinK, k[i]!);
    }
    return {
        k,
        s,
        inflections: countClosedInflections(k, s),
        inflectionU,
        maxAbsDkDs,
        lateralMinK: Number.isFinite(lateralMinK) ? lateralMinK : 0,
    };
}

/**
 * C∞ offset → few-control FAIRED approximating cubic (not an interpolant).
 * Heel (8 mm) tapers into the forefoot (1 mm); the medial arch is one S.
 */
export function syntheticBottomPattern(
    outline: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rim3d?: PolyPoint[],
    side?: "left" | "right",
): PolyPoint[] {
    const loop = startAtLowCurvature(ensureCcw(outline.map((p) => ({ ...p, z: 0 }))), bounds);
    if (loop.length < 3) return loop;
    const heightSrc = rim3d?.length ? rim3d : outline;
    const sign = medialYSignFromTopRim(heightSrc, bounds, side);
    const yMid = rimYMid(heightSrc);
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const rim = resamplePolyline(loop, 96);
    const normals = smoothUnit2(
        rim.map((_, i) => unitInward(rim, i)),
        20,
    );
    const offset: PolyPoint[] = rim.map((p, i) => {
        const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
        const medial = (p.y - yMid) * sign > 0;
        const d = Math.max(PATTERN_MIN_INSET_MM, fairInsetMm(u, medial));
        const n = normals[i]!;
        const q = { x: p.x + n.x * d, y: p.y + n.y * d, z: 0 };
        if (!pointInPoly(q.x, q.y, loop)) {
            return { x: p.x - n.x * d, y: p.y - n.y * d, z: 0 };
        }
        return q;
    });
    let closed = startAtPosteriorHeel(ensureCcw(offset));
    for (let pass = 0; pass < 4; pass++) {
        closed = closed.map((b, i) => {
            const a = closed[(i + closed.length - 1) % closed.length]!;
            const c = closed[(i + 1) % closed.length]!;
            return {
                x: b.x * 0.6 + (a.x + c.x) * 0.2,
                y: b.y * 0.6 + (a.y + c.y) * 0.2,
                z: 0,
            };
        });
    }
    closed = startAtPosteriorHeel(ensureCcw(closed));
    const { cum: offCum, total: offTotal } = polylineArcLengths(closed);
    const s01Of = (p: PolyPoint): number => {
        let bestS = 0;
        let bestD = Infinity;
        for (let i = 0; i < closed.length; i++) {
            const a = closed[i]!;
            const b = closed[(i + 1) % closed.length]!;
            const ex = b.x - a.x;
            const ey = b.y - a.y;
            const len2 = ex * ex + ey * ey;
            const t =
                len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
            const d = (p.x - (a.x + ex * t)) ** 2 + (p.y - (a.y + ey * t)) ** 2;
            if (d < bestD) {
                bestD = d;
                const seg = offCum[i + 1]! - offCum[i]!;
                bestS = (offCum[i]! + t * seg) / Math.max(offTotal, 1e-12);
            }
        }
        return ((bestS % 1) + 1) % 1;
    };
    const dense = resamplePolyline(closed, 36);
    let heel = closed[0]!;
    let toe = closed[0]!;
    const archPts: PolyPoint[] = [];
    for (const p of closed) {
        if (p.x < heel.x) heel = p;
        if (p.x > toe.x) toe = p;
        const medial = (p.y - yMid) * sign > 0;
        const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
        if (medial && u >= PATTERN_ARCH_U0 && u <= PATTERN_ARCH_U1) archPts.push(p);
    }
    const targets = [
        ...dense.map((p) => ({ point: p, weight: 1.2, s01: s01Of(p) })),
        { point: heel, weight: 8, s01: s01Of(heel) },
        { point: toe, weight: 20, s01: s01Of(toe) },
        ...archPts
            .filter((_, i) => i % Math.max(1, Math.floor(archPts.length / 8)) === 0)
            .slice(0, 8)
            .map((p) => ({ point: p, weight: 6, s01: s01Of(p) })),
    ];
    const sampleCount = Math.max(160, Math.ceil(offTotal / PATTERN_LATERAL_K_SAMPLE_MM));
    const fitOnce = (controlCount: number, wFair: number) =>
        fairedPattern({
            targets,
            controlCount,
            wFit: 1,
            wFair,
            sampleCount,
            constraints: {
                rim: loop,
                minInsetMm: PATTERN_MIN_INSET_MM,
                medialYSign: sign,
                archU0: PATTERN_ARCH_U0,
                archU1: PATTERN_ARCH_U1,
                bounds,
                lateralMinK: 0,
                maxIters: 6,
            },
        });
    let fit = fitOnce(22, 0.34);
    let out = makeLateralConvex(fit.samples, sign, 36, yMid);
    const report = patternCurvatureReport(out, bounds, sign);
    if (report.inflections >= 4) {
        fit = fitOnce(PATTERN_CONTROL_RETRY, PATTERN_FAIR_RETRY_W);
        out = makeLateralConvex(fit.samples, sign, 36, yMid);
    }
    return out;
}

/** Laplacian only concave lateral verts so the lateral side stays convex. */
function makeLateralConvex(
    loop: PolyPoint[],
    sign: MedialYSign,
    passes = 12,
    yMidHint?: number,
): PolyPoint[] {
    if (loop.length < 4) return loop;
    const yMid = yMidHint ?? rimYMid(loop);
    let cur = loop.map((p) => ({ ...p }));
    for (let p = 0; p < passes; p++) {
        const { k } = closedSignedCurvature(cur);
        const next = cur.map((b, i) => {
            if ((b.y - yMid) * sign > 0) return b;
            if ((k[i] ?? 0) >= LATERAL_K_SLACK) return b;
            const a = cur[(i + cur.length - 1) % cur.length]!;
            const c = cur[(i + 1) % cur.length]!;
            return {
                x: b.x * 0.3 + (a.x + c.x) * 0.35,
                y: b.y * 0.3 + (a.y + c.y) * 0.35,
                z: b.z,
            };
        });
        cur = next;
    }
    return cur;
}

function asPoint(x: number, y: number, z = 0): PolyPoint {
    return { x, y, z };
}

function parseSvgPoints(source: string): PolyPoint[] {
    const attr = source.match(/points\s*=\s*"([^"]+)"/i);
    const blob = attr?.[1] ?? source;
    const nums = blob.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const out: PolyPoint[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push(asPoint(nums[i]!, nums[i + 1]!));
    return out;
}

function parseSvgPath(source: string): PolyPoint[] {
    const d = source.match(/\bd\s*=\s*"([^"]+)"/i)?.[1] ?? source;
    const out: PolyPoint[] = [];
    const re = /([MLHVZmlhvz])|(-?\d+(?:\.\d+)?)/g;
    let cmd = "M";
    let x = 0;
    let y = 0;
    const raw = d.match(re) ?? [];
    for (let i = 0; i < raw.length; ) {
        const t = raw[i]!;
        if (/^[MLHVZmlhvz]$/.test(t)) {
            cmd = t;
            i++;
            continue;
        }
        const n = Number(t);
        if (cmd === "M" || cmd === "L") {
            x = n;
            y = Number(raw[i + 1] ?? 0);
            out.push(asPoint(x, y));
            i += 2;
            cmd = "L";
        } else if (cmd === "m" || cmd === "l") {
            x += n;
            y += Number(raw[i + 1] ?? 0);
            out.push(asPoint(x, y));
            i += 2;
            cmd = "l";
        } else if (cmd === "H") {
            x = n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "h") {
            x += n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "V") {
            y = n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "v") {
            y += n;
            out.push(asPoint(x, y));
            i++;
        } else if (cmd === "Z" || cmd === "z") {
            i++;
        } else {
            i++;
        }
    }
    return out;
}

function parseDxfPolyline(source: string): PolyPoint[] {
    const lines = source.split(/\r?\n/).map((s) => s.trim());
    const out: PolyPoint[] = [];
    let expecting = "";
    let x = 0;
    for (let i = 0; i < lines.length; i++) {
        const code = lines[i]!;
        const val = lines[i + 1];
        if (code === "10") {
            x = Number(val);
            expecting = "y";
            i++;
        } else if (code === "20" && expecting === "y") {
            out.push(asPoint(x, Number(val)));
            expecting = "";
            i++;
        }
    }
    return out;
}

/**
 * Read a bottom-pattern outline from a polyline, SVG, or DXF (same XY frame
 * as the TopSheet). JSON arrays of {x,y} are also accepted.
 */
export function parseBottomPattern(source: string | PolyPoint[]): PolyPoint[] {
    if (Array.isArray(source)) return source.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
    const t = source.trim();
    if (!t) return [];
    if (t.startsWith("[") || t.startsWith("{")) {
        const json = JSON.parse(t) as { points?: PolyPoint[] } | PolyPoint[];
        const pts = Array.isArray(json) ? json : (json.points ?? []);
        return pts.map((p) => ({ x: Number(p.x), y: Number(p.y), z: Number(p.z ?? 0) }));
    }
    if (/<svg|points\s*=|\bd\s*=/i.test(t)) {
        if (/points\s*=/i.test(t)) return parseSvgPoints(t);
        return parseSvgPath(t);
    }
    if (/LWPOLYLINE|AcDbPolyline|^\s*0\s+SECTION/im.test(t)) return parseDxfPolyline(t);
    if (/[MLHVZ]/i.test(t) && /[-\d]/.test(t)) return parseSvgPath(t);
    return parseSvgPoints(t);
}
