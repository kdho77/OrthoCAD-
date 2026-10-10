// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    fitClosedC2Spline,
    type PolyPoint,
    resampleClosedBSpline,
    resampleClosedC2,
    resamplePolyline,
    startAtLowCurvature,
} from "./curves";

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
/** Bound on |dk/ds| (1/mm²) so k(s) stays fair — no local curvature spikes. */
export const PATTERN_MAX_DKDS = 0.05;
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

/**
 * Approximating cubics sit inside the control hull. Park the toe-box
 * controls near the rim so the curve lands at ~1 mm; heel and arch stay
 * at the design inset.
 */
function controlInsetMm(u: number, medial: boolean): number {
    const d = fairInsetMm(u, medial);
    if (u >= PATTERN_FORE_U0) return 0.12;
    return d;
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

interface PatternFeatureSpec {
    u: number;
    medial?: boolean;
}

/** Heel apex, toe apex, lateral taper, medial S — 16 interpolating features. */
function featureSpecs(): PatternFeatureSpec[] {
    return [
        { u: 0 },
        { u: 0.1, medial: false },
        { u: 0.28, medial: false },
        { u: 0.48, medial: false },
        { u: 0.68, medial: false },
        { u: 0.82, medial: false },
        { u: 0.92, medial: false },
        { u: 0.98, medial: false },
        { u: 1 },
        { u: 0.98, medial: true },
        { u: 0.92, medial: true },
        { u: 0.82, medial: true },
        { u: 0.48, medial: true },
        { u: 0.34, medial: true },
        { u: 0.2, medial: true },
        { u: 0.1, medial: true },
    ];
}

function pickRimIndex(
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
    yMid: number,
    sign: MedialYSign,
    spec: PatternFeatureSpec,
): number {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    if (spec.medial === undefined) {
        const wantMin = spec.u < 0.5;
        let best = 0;
        for (let i = 1; i < rim.length; i++) {
            const p = rim[i]!;
            const b = rim[best]!;
            const betterX = wantMin ? p.x < b.x - 1e-9 : p.x > b.x + 1e-9;
            const tie = Math.abs(p.x - b.x) <= 1e-9 && Math.abs(p.y - yMid) < Math.abs(b.y - yMid);
            if (betterX || tie) best = i;
        }
        return best;
    }
    let best = 0;
    let bestScore = Infinity;
    for (let i = 0; i < rim.length; i++) {
        const p = rim[i]!;
        const u = (p.x - bounds.minX) / length;
        const medial = (p.y - yMid) * sign > 0;
        let score = Math.abs(u - spec.u);
        if (medial !== spec.medial) score += 2;
        if (score < bestScore) {
            bestScore = score;
            best = i;
        }
    }
    return best;
}

function orderCcwAroundCentroid(pts: PolyPoint[]): PolyPoint[] {
    if (pts.length < 3) return pts;
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
        cx += p.x;
        cy += p.y;
    }
    cx /= pts.length;
    cy /= pts.length;
    const sorted = pts
        .slice()
        .sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
    return ensureCcw(sorted);
}

function dedupeFeatures(pts: PolyPoint[], minDist = 2): PolyPoint[] {
    const out: PolyPoint[] = [];
    for (const p of pts) {
        if (out.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < minDist)) continue;
        out.push(p);
    }
    return out;
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

export function countClosedInflections(k: number[], eps = 5e-4): number {
    const n = k.length;
    let first = 0;
    let start = -1;
    for (let i = 0; i < n; i++) {
        if (Math.abs(k[i]!) >= eps) {
            first = Math.sign(k[i]!);
            start = i;
            break;
        }
    }
    if (start < 0) return 0;
    let prev = first;
    let count = 0;
    for (let t = 1; t <= n; t++) {
        const ki = k[(start + t) % n]!;
        if (Math.abs(ki) < eps) continue;
        const sg = Math.sign(ki);
        if (sg !== prev) {
            count++;
            prev = sg;
        }
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
    for (let i = 0; i < n; i++) {
        if (Math.abs(k[i]!) < 5e-4) continue;
        const sg = Math.sign(k[i]!);
        if (prev && sg !== prev) {
            inflectionU.push(Math.max(0, Math.min(1, (loop[i]!.x - bounds.minX) / length)));
        }
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
        inflections: countClosedInflections(k),
        inflectionU,
        maxAbsDkDs,
        lateralMinK: Number.isFinite(lateralMinK) ? lateralMinK : 0,
    };
}

/**
 * One fair closed curve through ~16 feature offsets — not a per-vertex
 * region-blend. Heel (8 mm) tapers continuously into the forefoot (1 mm);
 * the medial arch is a single shallow S-curve. Periodic approximating cubic.
 */
export function syntheticBottomPattern(
    outline: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rim3d?: PolyPoint[],
    side?: "left" | "right",
): PolyPoint[] {
    const loop = ensureCcw(outline.map((p) => ({ ...p, z: 0 })));
    if (loop.length < 3) return loop;
    const heightSrc = rim3d?.length ? rim3d : outline;
    const sign = medialYSignFromTopRim(heightSrc, bounds, side);
    const yMid = rimYMid(heightSrc);
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const rim = resamplePolyline(startAtLowCurvature(loop, bounds), Math.max(96, Math.min(160, loop.length)));
    const normals = smoothUnit2(
        rim.map((_, i) => unitInward(rim, i)),
        4,
    );
    const features: PolyPoint[] = [];
    for (const spec of featureSpecs()) {
        const idx = pickRimIndex(rim, bounds, yMid, sign, spec);
        const p = rim[idx]!;
        const n = normals[idx]!;
        const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
        const medial = spec.medial ?? (p.y - yMid) * sign > 0;
        const d = controlInsetMm(spec.medial === undefined ? spec.u : u, medial);
        const q = { x: p.x + n.x * d, y: p.y + n.y * d, z: 0 };
        if (!pointInPoly(q.x, q.y, loop)) {
            features.push({ x: p.x - n.x * d, y: p.y - n.y * d, z: 0 });
        } else {
            features.push(q);
        }
    }
    const ordered = orderCcwAroundCentroid(dedupeFeatures(features));
    const nOut = Math.max(160, loop.length);
    if (ordered.length < 8) {
        return pinPatternInsideRim(
            resampleClosedC2(fitClosedC2Spline(ordered.length ? ordered : loop), nOut),
            loop,
        );
    }
    return pinPatternInsideRim(resampleClosedBSpline(ordered, nOut), loop);
}

/** Pull any hull overshoot back inside the rim without changing the fair shape. */
function pinPatternInsideRim(curve: PolyPoint[], rim: PolyPoint[]): PolyPoint[] {
    let cx = 0;
    let cy = 0;
    for (const p of rim) {
        cx += p.x;
        cy += p.y;
    }
    cx /= Math.max(1, rim.length);
    cy /= Math.max(1, rim.length);
    return curve.map((p) => {
        if (pointInPoly(p.x, p.y, rim)) return p;
        let q = p;
        for (let t = 0.04; t <= 1; t += 0.04) {
            q = { x: p.x + (cx - p.x) * t, y: p.y + (cy - p.y) * t, z: 0 };
            if (pointInPoly(q.x, q.y, rim)) return q;
        }
        return q;
    });
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
