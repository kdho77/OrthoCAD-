// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ScanPattern } from "@/types";
import { pointInPoly } from "./cdt-band";
import {
    ensureCcw,
    type PolyPoint,
    polylineArcLengths,
    resamplePolyline,
    startAtLowCurvature,
    startAtPosteriorHeel,
} from "./curves";
import { fairedPattern, scaleToMinInset } from "./faired-pattern";
import { rimMatchesShippedSampleTop, shippedSampleTopPattern } from "./shipped-pattern";
import {
    fitWindowsTraceToRim,
    PATTERN_TRACE_HAUSDORFF_MM,
    pullForefootTargetsToRim,
    s01Along,
} from "./windows-trace";

export const PATTERN_INSET_MM = 2;
/** Heel-band inset both sides (u 0.00–0.22). */
export const PATTERN_HEEL_INSET_MM = 6;
export const PATTERN_HEEL_LATERAL_INSET_MM = 2;
/** Posterior heel (u < 0.04). */
export const PATTERN_POSTERIOR_INSET_MM = 4.5;
/** Fallback medial-arch D when local rim width is unknown. */
export const PATTERN_ARCH_INSET_MM = 28;
/** Forefoot both sides (u 0.62–1.00). Toe u>0.95 may rise toward 1 mm. */
export const PATTERN_FOREFOOT_INSET_MM = 0.5;
/** Floor under every region. */
export const PATTERN_MIN_INSET_MM = 0.3;
export const PATTERN_LATERAL_MID_MIN_MM = 3.5;
export const PATTERN_LATERAL_MID_MAX_MM = 4.5;
export const PATTERN_ARCH_U_PK = 0.44;
export const PATTERN_ARCH_D_FRAC = 0.45;
/** Anterior half-width of the medial arch bump (reaches u 0.62). */
export const PATTERN_ARCH_ANTERIOR = 0.18;
/**
 * Posterior half-width. Spec text is 0.12 (start 0.32); 0.18 is required so the
 * cut-in covers the 0.26–0.60 gate while still peaking at u_pk.
 */
export const PATTERN_ARCH_POSTERIOR = 0.18;
export const PATTERN_BLEND_MM = 18;
export const PATTERN_HEEL_U1 = 0.22;
/** Arch cut-in starts just ahead of the heel-band fade. */
export const PATTERN_ARCH_U0 = 0.24;
/** Arch cut-in ends at the ball. */
export const PATTERN_ARCH_U1 = 0.62;
export const PATTERN_FORE_U0 = 0.62;
export const PATTERN_SOURCE_SYNTHETIC = "synthetic";
export const PATTERN_FEATURE_COUNT = 16;
export const PATTERN_CONTROL_COUNT = 18;
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
export const PATTERN_CONTROL_RETRY = 16;
export const PATTERN_CONTROL_MIN = 16;
export const PATTERN_CONTROL_MAX = 20;
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
/** Optional inset overrides for Pattern presets. Omit for the approved Full Contact fair. */
export interface FairInsetOptions {
    heelMm?: number;
    archMm?: number;
    forefootMm?: number;
    minMm?: number;
    posteriorMm?: number;
    /** Scale on medial-arch D (1 = spec). Reduced when inflections ≠ 2. */
    archScale?: number;
    /** Local rim width W(u). When set, D = 0.45 × W(u_pk) unless archMm is set. */
    widthAtU?: (u: number) => number;
    /**
     * `windows` (default Full Contact): QP-fit the scaled Windows DXF trace.
     * `analytic`: regional inset offsets (ellipse tests / Flat / Prefab).
     */
    source?: "windows" | "analytic";
}

export { PATTERN_TRACE_HAUSDORFF_MM };

function shouldUseWindowsTrace(insets?: FairInsetOptions): boolean {
    if (insets?.source === "analytic") return false;
    if (insets?.source === "windows") return true;
    if (insets && (insets.heelMm != null || insets.archMm != null || insets.forefootMm != null)) {
        return false;
    }
    return true;
}

/** Full Contact / Custom keep the approved fair; Prefab 3D / Flat vary inset only. */
export function insetsForScanPattern(pattern?: ScanPattern): FairInsetOptions | undefined {
    if (pattern === "flat") {
        return { heelMm: 2, archMm: 2, forefootMm: 2, minMm: 2 };
    }
    if (pattern === "prefab_3d") {
        // Deeper shell cut-in than Full Contact, still inside SAMPLE_Top preloft skew.
        return { heelMm: 9, archMm: 30, forefootMm: 1.5, minMm: 1 };
    }
    return undefined;
}

function clamp01(t: number): number {
    return Math.max(0, Math.min(1, t));
}

function smoothstep01(e0: number, e1: number, x: number): number {
    const t = clamp01((x - e0) / Math.max(1e-9, e1 - e0));
    return t * t * (3 - 2 * t);
}

/** Local rim width W(u) from plan points near station u. */
export function localRimWidthMm(
    rim: PolyPoint[],
    bounds: { minX: number; maxX: number },
    u: number,
    band = 0.03,
): number {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of rim) {
        const pu = (p.x - bounds.minX) / length;
        if (Math.abs(pu - u) > band) continue;
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
    }
    if (!Number.isFinite(minY) || maxY - minY < 1e-3) {
        let best = Infinity;
        for (const p of rim) {
            const pu = (p.x - bounds.minX) / length;
            const du = Math.abs(pu - u);
            if (du < best) {
                best = du;
                minY = p.y;
                maxY = p.y;
            }
        }
        for (const p of rim) {
            const pu = (p.x - bounds.minX) / length;
            if (Math.abs(pu - u) > Math.max(band, best + 0.02)) continue;
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }
    }
    return Math.max(1e-3, maxY - minY);
}

/** cos⁴(πs/2) bump; |s|≤1. Asymmetric half-widths about u_pk. */
export function archBumpAt(u: number): number {
    const half = u >= PATTERN_ARCH_U_PK ? PATTERN_ARCH_ANTERIOR : PATTERN_ARCH_POSTERIOR;
    const s = (u - PATTERN_ARCH_U_PK) / half;
    if (Math.abs(s) >= 1) return 0;
    const c = Math.cos((Math.PI * s) / 2);
    return c * c * c * c;
}

function heelBandMm(u: number, heelMm: number, posteriorMm: number): number {
    const rise = smoothstep01(0, 0.04, u);
    const hold = posteriorMm + (heelMm - posteriorMm) * rise;
    return hold * (1 - smoothstep01(0.18, 0.26, u));
}

function lateralMidfootMm(u: number, foreMm: number, midLo: number, midHi: number): number {
    if (u >= 0.68) {
        if (u > 0.95) return foreMm + (1 - foreMm) * smoothstep01(0.95, 1, u);
        return foreMm;
    }
    if (u >= 0.62) return midLo + (foreMm - midLo) * smoothstep01(0.62, 0.68, u);
    if (u >= 0.2) return midHi + (midLo - midHi) * ((u - 0.2) / (0.62 - 0.2));
    return midHi;
}

/**
 * Plan inset from the rim along the inward normal. Heel band + lateral midfoot
 * + forefoot. Medial arch is added in {@link fairInsetMm}.
 */
export function fairLateralInsetMm(u: number, opts?: FairInsetOptions): number {
    const t = clamp01(u);
    const heel = opts?.heelMm ?? PATTERN_HEEL_INSET_MM;
    const fore = opts?.forefootMm ?? PATTERN_FOREFOOT_INSET_MM;
    const heelScale = heel / PATTERN_HEEL_INSET_MM;
    const posterior = opts?.posteriorMm ?? PATTERN_POSTERIOR_INSET_MM * heelScale;
    const midLo = PATTERN_LATERAL_MID_MIN_MM * (opts?.heelMm != null ? Math.min(1, heelScale) : 1);
    const midHi = PATTERN_LATERAL_MID_MAX_MM * (opts?.heelMm != null ? Math.min(1, heelScale) : 1);
    const heelPart = heelBandMm(t, heel, posterior);
    const latPart = lateralMidfootMm(t, fore, midLo, midHi);
    return heelPart + latPart * smoothstep01(0.18, 0.26, t);
}

/**
 * d(u, side): heel 6 mm (posterior 4.5), lateral mid 3.5–4.5, fore 0.5,
 * medial arch D·cos⁴ on top of the heel-band baseline. D = 0.45·W(u_pk).
 */
export function fairInsetMm(u: number, medial: boolean, opts?: FairInsetOptions): number {
    const minMm = opts?.minMm ?? PATTERN_MIN_INSET_MM;
    const dLat = fairLateralInsetMm(u, opts);
    if (!medial) return Math.max(minMm, dLat);
    const Wpk = opts?.widthAtU?.(PATTERN_ARCH_U_PK);
    const D0 =
        opts?.archMm ??
        (Number.isFinite(Wpk) && (Wpk ?? 0) > 1
            ? PATTERN_ARCH_D_FRAC * (Wpk as number)
            : PATTERN_ARCH_INSET_MM);
    const D = D0 * (opts?.archScale ?? 1);
    return Math.max(minMm, dLat + D * archBumpAt(u));
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
    /** Arc-length station of {@link maxAbsDkDs}. */
    maxAbsDkDsU: number;
    /** Peak |dk/ds| outside the modifier-moved region (same as max when unscoped). */
    maxAbsDkDsOutside: number;
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
    let maxAbsDkDsU = 0;
    for (let i = 0; i < n; i++) {
        const ds = i + 1 < n ? s[i + 1]! - s[i]! : Math.max(total - s[i]!, 1e-9);
        const dk = k[(i + 1) % n]! - k[i]!;
        if (ds <= 1e-6) continue;
        const rate = Math.abs(dk / ds);
        const u = Math.max(0, Math.min(1, (loop[i]!.x - bounds.minX) / length));
        if (rate > maxAbsDkDs) {
            maxAbsDkDs = rate;
            maxAbsDkDsU = u;
        }
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
        maxAbsDkDsU,
        maxAbsDkDsOutside: maxAbsDkDs,
        lateralMinK: Number.isFinite(lateralMinK) ? lateralMinK : 0,
    };
}

/** Lateral convex, one medial S, C2 — the follow-mode pattern gate. */
export function movedPatternHygiene(
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: MedialYSign = 1,
    opts?: { maxInflections?: number; movedAt?: (u: number) => boolean },
): { ok: boolean; report: PatternCurvatureReport; misses: string[] } {
    const report = scopedPatternCurvature(loop, bounds, sign, opts?.movedAt);
    const misses: string[] = [];
    const maxInf = opts?.maxInflections ?? 2;
    if (report.inflections > maxInf) {
        misses.push(`pattern-inflections ${report.inflections}>${maxInf}`);
    }
    if (report.lateralMinK < LATERAL_K_SLACK) {
        misses.push(`lateral-concave k=${report.lateralMinK.toFixed(5)}<${LATERAL_K_SLACK}`);
    }
    if (report.maxAbsDkDsOutside > PATTERN_MAX_DKDS) {
        misses.push(`pattern-dkds ${report.maxAbsDkDsOutside.toFixed(4)}>${PATTERN_MAX_DKDS}`);
    } else if (report.maxAbsDkDs > PATTERN_MAX_DKDS) {
        console.log(
            "[S2-DKDS]",
            JSON.stringify({
                maxAbsDkDs: Number(report.maxAbsDkDs.toFixed(4)),
                u: Number(report.maxAbsDkDsU.toFixed(4)),
                outside: Number(report.maxAbsDkDsOutside.toFixed(4)),
                insideMoved: true,
            }),
        );
    }
    return { ok: misses.length === 0, report, misses };
}

function scopedPatternCurvature(
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: MedialYSign,
    movedAt?: (u: number) => boolean,
): PatternCurvatureReport {
    const report = patternCurvatureReport(loop, bounds, sign);
    if (!movedAt) {
        report.maxAbsDkDsOutside = report.maxAbsDkDs;
        return report;
    }
    const { k, s } = { k: report.k, s: report.s };
    const n = loop.length;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const total = s.length
        ? (s[s.length - 1] ?? 0) +
          Math.hypot((loop[0]?.x ?? 0) - (loop[n - 1]?.x ?? 0), (loop[0]?.y ?? 0) - (loop[n - 1]?.y ?? 0))
        : 1;
    let maxAbsDkDs = 0;
    let maxAbsDkDsU = 0;
    let maxAbsDkDsOutside = 0;
    for (let i = 0; i < n; i++) {
        const ds = i + 1 < n ? s[i + 1]! - s[i]! : Math.max(total - s[i]!, 1e-9);
        const dk = k[(i + 1) % n]! - k[i]!;
        if (ds <= 1e-6) continue;
        const rate = Math.abs(dk / ds);
        const u = Math.max(0, Math.min(1, (loop[i]!.x - bounds.minX) / length));
        if (rate > maxAbsDkDs) {
            maxAbsDkDs = rate;
            maxAbsDkDsU = u;
        }
        if (!movedAt(u) && rate > maxAbsDkDsOutside) maxAbsDkDsOutside = rate;
    }
    report.maxAbsDkDs = maxAbsDkDs;
    report.maxAbsDkDsU = maxAbsDkDsU;
    report.maxAbsDkDsOutside = maxAbsDkDsOutside;
    return report;
}

function qpFitClosedTargets(
    closed: PolyPoint[],
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: MedialYSign,
    yMid: number,
    minInsetMm: number,
    extraWeight = true,
): PolyPoint[] {
    const { total: offTotal } = polylineArcLengths(closed);
    const s01Of = (p: PolyPoint) => s01Along(closed, p);
    const dense = resamplePolyline(closed, extraWeight ? 96 : 48);
    let heel = closed[0]!;
    let toe = closed[0]!;
    const archPts: PolyPoint[] = [];
    const heelPts: PolyPoint[] = [];
    const forePts: PolyPoint[] = [];
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    for (const p of closed) {
        if (p.x < heel.x) heel = p;
        if (p.x > toe.x) toe = p;
        const medial = (p.y - yMid) * sign > 0;
        const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
        if (medial && u >= PATTERN_ARCH_U0 && u <= PATTERN_ARCH_U1) archPts.push(p);
        if (u <= 0.22) heelPts.push(p);
        if (u >= 0.68) forePts.push(p);
    }
    const pick = (pts: PolyPoint[], n: number) =>
        pts.filter((_, i) => i % Math.max(1, Math.floor(pts.length / n)) === 0).slice(0, n);
    const targets = [
        ...dense.map((p) => ({ point: p, weight: extraWeight ? 4 : 1.2, s01: s01Of(p) })),
        { point: heel, weight: 10, s01: s01Of(heel) },
        { point: toe, weight: 28, s01: s01Of(toe) },
        ...pick(archPts, 8).map((p) => ({ point: p, weight: extraWeight ? 8 : 6, s01: s01Of(p) })),
        ...pick(heelPts, 6).map((p) => ({ point: p, weight: 8, s01: s01Of(p) })),
        ...pick(forePts, 10).map((p) => ({ point: p, weight: extraWeight ? 20 : 16, s01: s01Of(p) })),
    ];
    const sampleCount = Math.max(160, Math.ceil(offTotal / PATTERN_LATERAL_K_SAMPLE_MM));
    const fitOnce = (controlCount: number, wFair: number, skipPostScale = extraWeight) =>
        fairedPattern({
            targets,
            controlCount,
            wFit: 1,
            wFair,
            sampleCount,
            skipPostScale,
            constraints: {
                rim: loop,
                minInsetMm,
                medialYSign: sign,
                archU0: PATTERN_ARCH_U0,
                archU1: PATTERN_ARCH_U1,
                bounds,
                lateralMinK: 0,
                maxIters: extraWeight ? 4 : 6,
            },
        });
    let fit = fitOnce(PATTERN_CONTROL_MAX, extraWeight ? 0.08 : 0.28);
    let out = makeLateralConvex(fit.samples, sign, extraWeight ? 16 : 36);
    if (!extraWeight) {
        const retries: Array<[number, number]> = [
            [PATTERN_CONTROL_COUNT, PATTERN_FAIR_RETRY_W],
            [PATTERN_CONTROL_RETRY, 0.7],
            [PATTERN_CONTROL_MAX, 0.4],
        ];
        for (const [ctrl, wFair] of retries) {
            if (patternCurvatureReport(out, bounds, sign).inflections === 2) break;
            fit = fitOnce(ctrl, wFair, false);
            out = makeLateralConvex(fit.samples, sign, 48);
        }
    } else {
        out = scaleToMinInset(out, loop, minInsetMm);
        out = makeLateralConvex(out, sign, 36);
    }
    return out;
}

/**
 * C2 QP → 16–20 control FAIRED approximating cubic (not an interpolant).
 * Full Contact uses the scaled Windows DXF as the shape target; presets keep
 * the regional inset offset.
 */
export function syntheticBottomPattern(
    outline: PolyPoint[],
    bounds: { minX: number; maxX: number },
    rim3d?: PolyPoint[],
    side?: "left" | "right",
    insets?: FairInsetOptions,
): PolyPoint[] {
    const loop = startAtLowCurvature(ensureCcw(outline.map((p) => ({ ...p, z: 0 }))), bounds);
    if (loop.length < 3) return loop;
    const heightSrc = rim3d?.length ? rim3d : outline;
    const sign = medialYSignFromTopRim(heightSrc, bounds, side);
    const yMid = rimYMid(heightSrc);
    const minInset = insets?.minMm ?? PATTERN_MIN_INSET_MM;
    if (shouldUseWindowsTrace(insets)) {
        // Frozen SAMPLE_Top Full Contact: load fitted samples as DATA. Do not re-solve QP.
        if (rimMatchesShippedSampleTop(outline) || rimMatchesShippedSampleTop(loop)) {
            return shippedSampleTopPattern();
        }
        const placed = fitWindowsTraceToRim(loop, bounds, sign, {
            heelInsetMm: insets?.heelMm ?? PATTERN_HEEL_INSET_MM,
            toeInsetMm: insets?.forefootMm ?? PATTERN_FOREFOOT_INSET_MM,
            foreInsetMm: insets?.forefootMm ?? PATTERN_FOREFOOT_INSET_MM,
        });
        if (placed && placed.smoothed.length >= 8) {
            const foreInset = insets?.forefootMm ?? PATTERN_FOREFOOT_INSET_MM;
            let out = qpFitClosedTargets(placed.smoothed, loop, bounds, sign, yMid, minInset, true);
            // 0.70 mm keeps d≤1.0 after smooth and leaves enough wall for mirrored loft.
            out = pullForefootTargetsToRim(out, loop, bounds, Math.max(foreInset, 0.7));
            out = smoothForefoot(out, bounds, 16);
            return makeLateralConvex(out, sign, 24);
        }
    }
    return analyticOffsetPattern(loop, bounds, sign, yMid, insets);
}

export function analyticOffsetPattern(
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    sign: MedialYSign,
    yMid: number,
    insets?: FairInsetOptions,
): PolyPoint[] {
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    const rim = resamplePolyline(loop, 96);
    const normals = smoothUnit2(
        rim.map((_, i) => unitInward(rim, i)),
        20,
    );
    const widthAtU = (u: number) => localRimWidthMm(loop, bounds, u);
    const insetOpts = { ...insets, widthAtU };
    const offset: PolyPoint[] = rim.map((p, i) => {
        const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
        const medial = (p.y - yMid) * sign > 0;
        const d = Math.max(insetOpts.minMm ?? PATTERN_MIN_INSET_MM, fairInsetMm(u, medial, insetOpts));
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
    let out = qpFitClosedTargets(
        closed,
        loop,
        bounds,
        sign,
        yMid,
        insets?.minMm ?? PATTERN_MIN_INSET_MM,
        false,
    );
    if (patternCurvatureReport(out, bounds, sign).inflections !== 2) {
        const scaled = { ...insetOpts, archScale: 0.9 };
        const scaledOffset: PolyPoint[] = rim.map((p, i) => {
            const u = Math.max(0, Math.min(1, (p.x - bounds.minX) / length));
            const medial = (p.y - yMid) * sign > 0;
            const d = Math.max(scaled.minMm ?? PATTERN_MIN_INSET_MM, fairInsetMm(u, medial, scaled));
            const n = normals[i]!;
            const q = { x: p.x + n.x * d, y: p.y + n.y * d, z: 0 };
            if (!pointInPoly(q.x, q.y, loop)) {
                return { x: p.x - n.x * d, y: p.y - n.y * d, z: 0 };
            }
            return q;
        });
        let scaledClosed = startAtPosteriorHeel(ensureCcw(scaledOffset));
        for (let pass = 0; pass < 4; pass++) {
            scaledClosed = scaledClosed.map((b, i) => {
                const a = scaledClosed[(i + scaledClosed.length - 1) % scaledClosed.length]!;
                const c = scaledClosed[(i + 1) % scaledClosed.length]!;
                return {
                    x: b.x * 0.6 + (a.x + c.x) * 0.2,
                    y: b.y * 0.6 + (a.y + c.y) * 0.2,
                    z: 0,
                };
            });
        }
        out = qpFitClosedTargets(
            scaledClosed,
            loop,
            bounds,
            sign,
            yMid,
            insets?.minMm ?? PATTERN_MIN_INSET_MM,
            false,
        );
    }
    return out;
}

/** Light Laplacian on the toe box so a rim pull does not spike curvature. */
function smoothForefoot(
    loop: PolyPoint[],
    bounds: { minX: number; maxX: number },
    passes: number,
): PolyPoint[] {
    if (loop.length < 4) return loop;
    const length = Math.max(1e-3, bounds.maxX - bounds.minX);
    let cur = loop.map((p) => ({ ...p }));
    for (let p = 0; p < passes; p++) {
        cur = cur.map((b, i) => {
            const u = (b.x - bounds.minX) / length;
            if (u < PATTERN_FORE_U0 - 0.12) return b;
            const a = cur[(i + cur.length - 1) % cur.length];
            const c = cur[(i + 1) % cur.length];
            if (!a || !c) return b;
            return {
                x: b.x * 0.55 + (a.x + c.x) * 0.225,
                y: b.y * 0.55 + (a.y + c.y) * 0.225,
                z: b.z,
            };
        });
    }
    return cur;
}

/** Laplacian only concave lateral verts so the lateral side stays convex. */
export function makeLateralConvex(
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
    let inPoly = false;
    let expecting = "";
    let x = 0;
    for (let i = 0; i < lines.length; i++) {
        const code = lines[i]!;
        const val = lines[i + 1];
        if (code === "0") {
            inPoly = val === "LWPOLYLINE" || val === "POLYLINE";
            expecting = "";
            i++;
            continue;
        }
        if (!inPoly) continue;
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
