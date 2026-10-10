// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    fitClosedC2Spline,
    type PolyPoint,
    resampleClosedC2,
    startAtLowCurvature,
} from "./curves";

export const PATTERN_INSET_MM = 2;
export const PATTERN_HEEL_INSET_MM = 8;
export const PATTERN_HEEL_LATERAL_INSET_MM = 2;
export const PATTERN_ARCH_INSET_MM = 28;
export const PATTERN_FOREFOOT_INSET_MM = 0;
/** Numerical floor so zero-inset columns keep a defined inward heading. */
export const PATTERN_MIN_INSET_MM = 0.35;
export const PATTERN_BLEND_MM = 18;
export const PATTERN_HEEL_U1 = 0.16;
export const PATTERN_ARCH_U0 = 0.18;
export const PATTERN_ARCH_U1 = 0.58;
export const PATTERN_FORE_U0 = 0.76;
export const PATTERN_SOURCE_SYNTHETIC = "synthetic";
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

function miterInward(i: number, outline: PolyPoint[]): { x: number; y: number } {
    const n = outline.length;
    const a = outline[(i + n - 1) % n]!;
    const b = outline[i]!;
    const c = outline[(i + 1) % n]!;
    const n1 = edgeInward(a, b, outline);
    const n2 = edgeInward(b, c, outline);
    const denom = 1 + n1.x * n2.x + n1.y * n2.y;
    const mx = n1.x + n2.x;
    const my = n1.y + n2.y;
    if (Math.abs(denom) < 1e-4) {
        const len = Math.hypot(mx, my) || 1;
        return { x: mx / len, y: my / len };
    }
    const sx = mx / denom;
    const sy = my / denom;
    const len = Math.hypot(sx, sy);
    const cap = 1.85;
    if (len > cap) return { x: (sx / len) * cap, y: (sy / len) * cap };
    return { x: sx, y: sy };
}

function archWindow(u: number): number {
    const t = (u - PATTERN_ARCH_U0) / (PATTERN_ARCH_U1 - PATTERN_ARCH_U0);
    if (t <= 0 || t >= 1) return 0;
    return 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
}

/** C2 at 0 and 1: first and second derivatives vanish. */
function smootherstep(t: number): number {
    const x = Math.max(0, Math.min(1, t));
    return x * x * x * (x * (x * 6 - 15) + 10);
}

function regionWeights(u: number, lengthMm: number): { heel: number; mid: number; fore: number } {
    const du = Math.max(1e-3, PATTERN_BLEND_MM / Math.max(lengthMm, 1));
    let heel = 0;
    if (u <= PATTERN_HEEL_U1) heel = 1;
    else if (u < PATTERN_HEEL_U1 + du) heel = 1 - smootherstep((u - PATTERN_HEEL_U1) / du);
    let fore = 0;
    if (u >= PATTERN_FORE_U0) fore = 1;
    else if (u > PATTERN_FORE_U0 - du) fore = smootherstep((u - (PATTERN_FORE_U0 - du)) / du);
    const mid = Math.max(0, 1 - heel - fore);
    const sum = heel + mid + fore;
    return { heel: heel / sum, mid: mid / sum, fore: fore / sum };
}

function regionInsetMm(u: number, y: number, yMid: number, sign: MedialYSign, lengthMm: number): number {
    const w = regionWeights(u, lengthMm);
    const base =
        w.heel * PATTERN_HEEL_INSET_MM +
        w.mid * PATTERN_HEEL_LATERAL_INSET_MM +
        w.fore * PATTERN_FOREFOOT_INSET_MM;
    const extra =
        (y - yMid) * sign > 0 ? (PATTERN_ARCH_INSET_MM - PATTERN_HEEL_LATERAL_INSET_MM) * archWindow(u) : 0;
    return Math.max(PATTERN_MIN_INSET_MM, base + extra);
}

/**
 * Synthetic bottom-pattern (Kendon markup): TopSheet rim plan projection
 * with an 8 mm radial heel-counter inset, midfoot ~2 mm plus the medial-arch
 * cut-in (~28 mm), and ~0 mm at the toe box so it sits full-width. C2
 * smootherstep blends over ~18 mm. Labeled `synthetic`.
 */
export function syntheticBottomPattern(
    outline: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rim3d?: PolyPoint[],
    side?: "left" | "right",
): PolyPoint[] {
    const loop = startAtLowCurvature(ensureCcw(outline.map((p) => ({ ...p, z: 0 }))), bounds);
    const n = loop.length;
    if (n < 3) return loop;
    const heightSrc = rim3d?.length ? rim3d : outline;
    const sign = medialYSignFromTopRim(heightSrc, bounds, side);
    const yMid = rimYMid(heightSrc);
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const insets = loop.map((p) => {
        const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
        return regionInsetMm(u, p.y, yMid, sign, length);
    });
    const offset: PolyPoint[] = [];
    for (let i = 0; i < n; i++) {
        const p = loop[i]!;
        const m = miterInward(i, loop);
        const d = Math.max(PATTERN_MIN_INSET_MM, insets[i]!);
        const q = { x: p.x + m.x * d, y: p.y + m.y * d, z: 0 };
        if (!pointInPoly(q.x, q.y, loop)) {
            offset.push({ x: p.x - m.x * d, y: p.y - m.y * d, z: 0 });
        } else {
            offset.push(q);
        }
    }
    const spline = fitClosedC2Spline(offset);
    return resampleClosedC2(spline, Math.max(160, n));
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
