// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side, SideCorrections } from "@/types";

/**
 * Transverse medial-arch profile.
 *
 * 0 = Domed (a concave-down parabola, crown ≤ 4 mm above the chord, hard
 *     cap 5 mm),
 * 50 = Neutral (the straight valley-to-trimline chord in the fully active
 *     region),
 * 100 = Cradled (the current shell, zero displacement).
 * A missing value is Cradled so saved designs do not move.
 *
 * The chord is not applied through an inboard anatomical crest. A straight
 * valley-to-rim line passes several millimetres under that crest, and
 * pulling the crest down onto it relocates the apex. From s = 0.52 to that
 * crest the absolute height is a monotone cubic from the crown to the shell.
 * Blending the displacement instead falls faster than the shell rises and
 * cuts a trough. The crest and everything medial of it stay on the shell.
 * When the crest is the trimline, that return is idle and the parabola still
 * ends on the edge.
 */

export const ARCH_PROFILE_CRADLED = 100;
export const ARCH_PROFILE_BULGE_MM = 4;
export const ARCH_PROFILE_CAP_MM = 5;
/**
 * Posterior cutoff. The heel-cup bowl `bump(u, 0.1, 0.18)` is already 0 at
 * u = 0.28, and a 16 mm heel cup stops moving the medial wall by u ≈ 0.25.
 * u = 0.23 would land inside that bowl.
 */
export const ARCH_PROFILE_U_POSTERIOR = 0.28;
/**
 * Anterior cutoff. The 1st MPJ pad is centered at u = 0.665 and is 30 mm
 * long; on a Men's 9 its proximal blend reaches u ≈ 0.58. u = 0.63 would
 * land on the metatarsal head.
 */
export const ARCH_PROFILE_U_ANTERIOR = 0.58;
/**
 * Raises the shoulders of the longitudinal bell without moving its maximum.
 * `1 - (1 - q) ** 2` is strictly increasing on [0, 1], so a single raw peak
 * stays a single peak.
 */
export const ARCH_PROFILE_ENVELOPE_BROADEN = 2;

/**
 * C2 fillet from the plantar floor into the parabola, in millimetres.
 * A fraction-only window of 0.14 was ~5 mm on SAMPLE_Top — one facet — so the
 * theoretically smooth join still read as a crease. 14 mm keeps that fillet
 * under the sheet's dihedral limit once the longitudinal bell is broadened
 * to full strength at the crest.
 */
export const ARCH_PROFILE_VALLEY_BLEND_MM = 14;
/** Fillet never passes this fraction of the span, so s = 0.5 stays on the parabola. */
const VALLEY_BLEND_S_MAX = 0.42;
/** On a very wide span, keep the fillet at least this fraction so it still covers several facets. */
const VALLEY_BLEND_S_MIN = 0.28;
/** Fallback only when the surface has no measurable crest. The window midpoint. */
const ARCH_PROFILE_U_FALLBACK = (ARCH_PROFILE_U_POSTERIOR + ARCH_PROFILE_U_ANTERIOR) / 2;
/** Crest within this fraction of the trimline is the trimline. The hold stays idle. */
const CREST_RIM_FRACTION = 0.015;
/** Pin the hold this far valley-ward of the sampled peak so one sample cannot lower it. */
const CREST_PIN_FRACTION = 0.012;
/** Midspan crown (s = 0.5) stays on the parabola. The crest bridge starts here. */
const CREST_HOLD_CROWN_S = 0.52;
const SECTION_SAMPLES = 64;
const VALLEY_M_MIN = -0.2;
/** The bow stays on the medial side of the centerline. */
const VALLEY_SEARCH_MIN = 0;
const RIM_M_MIN = 0.25;
const FLOOR_BAND_MM = 0.4;
/** Stations of the faired (m, z) curves across [0.28, 0.58]. */
const CURVE_STATIONS = 40;
/**
 * Index-space Whittaker penalties. Large enough to kill one-bin isoline jitter,
 * small enough that an already-smooth arch-scale curve is left alone.
 */
const SECTION_M_VALLEY_LAMBDA = 64;
/** The trimline is already a clean edge. A heavy smooth pulls it inboard and leaves a lip. */
const SECTION_M_RIM_LAMBDA = 4;
const SECTION_Z_VALLEY_LAMBDA = 16;
const SECTION_Z_RIM_LAMBDA = 0.5;

export interface ArchSectionSample {
    m: number;
    z: number;
}

export interface ArchSection {
    mValley: number;
    mRim: number;
    zValley: number;
    zRim: number;
    /**
     * Medial coordinate of the unprofiled crest. Equal to `mRim` when the
     * highest point is the trimline, so the parabola still meets that edge.
     */
    mCrest: number;
    /**
     * Unprofiled surface height at a medial coordinate on this station.
     * Present on faired sections. The crest return matches this shell.
     */
    shellAt?: (m: number) => number;
}

/** 100 when the value is missing or not finite. Clamped to 0..100. */
export function resolveArchProfile(value: number | undefined): number {
    if (value == null || !Number.isFinite(value)) return ARCH_PROFILE_CRADLED;
    if (value <= 0) return 0;
    if (value >= ARCH_PROFILE_CRADLED) return ARCH_PROFILE_CRADLED;
    return value;
}

/** True only when the slider would move the shell. 100 and undefined do not. */
export function archProfileActive(value: number | undefined): boolean {
    return resolveArchProfile(value) < ARCH_PROFILE_CRADLED - 1e-9;
}

export function archProfilePhase(value: number | undefined): "Domed" | "Neutral" | "Cradled" {
    const p = resolveArchProfile(value);
    if (p < 25) return "Domed";
    if (p > 75) return "Cradled";
    return "Neutral";
}

/**
 * Signed medial coordinate. +1 is the medial rim and −1 is the lateral rim
 * on both feet, so a left/right pair uses the same arch math.
 */
export function medialCoordinate(vSigned: number, side: Side): number {
    const medialSign = side === "left" ? -1 : 1;
    return -(vSigned * medialSign);
}

export function vSignedFromMedial(m: number, side: Side): number {
    const medialSign = side === "left" ? -1 : 1;
    return -m * medialSign;
}

/** Quintic smoothstep. Matches `quinticSmoothstep` in height-field.ts (C2 ends). */
function quintic(t: number): number {
    const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * Fraction of the valley-to-rim span covered by the fillet.
 * `spanMm` is the physical width of that span. The fillet is 14 mm when that
 * fits between 28% and 42% of the span; otherwise it stays inside that band so
 * the midspan crown is still the pure parabola.
 */
export function archProfileValleyBlendFraction(spanMm: number): number {
    if (!(spanMm > 1)) return VALLEY_BLEND_S_MAX;
    const s = ARCH_PROFILE_VALLEY_BLEND_MM / spanMm;
    if (s < VALLEY_BLEND_S_MIN) return VALLEY_BLEND_S_MIN;
    if (s > VALLEY_BLEND_S_MAX) return VALLEY_BLEND_S_MAX;
    return s;
}

/**
 * C2 blend that is 0 on the plantar valley and 1 once the fillet is done.
 * The rim is not pinned by a second window. `spanMm` is the valley-to-trimline
 * distance; omit it only when the caller has no metric scale (uses the wide cap).
 */
export function archProfileValleyBlend(s: number, spanMm = 0): number {
    if (!(s > 0)) return 0;
    const blendS = archProfileValleyBlendFraction(spanMm);
    if (s >= blendS) return 1;
    return quintic(s / blendS);
}

/**
 * Longitudinal gate. Exact 0 at and outside [0.28, 0.58]. One C2 peak at
 * `apexU` — the measured anatomical crest, not a nominal 0.43 and not an
 * extra apex-shift or elongation offset. Arch elongation lengthens the
 * height-field dome about that crest; it does not move this peak.
 * Shoulders are broadened with {@link ARCH_PROFILE_ENVELOPE_BROADEN}.
 * The heel cup and the 1st MPJ stay at 0.
 */
export function archProfileEnvelope(u: number, apexU: number): number {
    if (u <= ARCH_PROFILE_U_POSTERIOR || u >= ARCH_PROFILE_U_ANTERIOR) return 0;
    const minRamp = 0.04;
    const lo = ARCH_PROFILE_U_POSTERIOR + minRamp;
    const hi = ARCH_PROFILE_U_ANTERIOR - minRamp;
    let uPeak = Number.isFinite(apexU) ? apexU : ARCH_PROFILE_U_FALLBACK;
    if (uPeak < lo) uPeak = lo;
    if (uPeak > hi) uPeak = hi;
    const raw =
        u <= uPeak
            ? quintic((u - ARCH_PROFILE_U_POSTERIOR) / (uPeak - ARCH_PROFILE_U_POSTERIOR))
            : 1 - quintic((u - uPeak) / (ARCH_PROFILE_U_ANTERIOR - uPeak));
    return broadenArchEnvelope(raw);
}

/** Strictly increasing on [0, 1]. A unique raw maximum stays the unique maximum. */
export function broadenArchEnvelope(raw: number): number {
    const q = raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
    return 1 - (1 - q) ** ARCH_PROFILE_ENVELOPE_BROADEN;
}

/**
 * 1 from the valley through the fully active chord, 0 at and medial of the
 * anatomical crest. Idle when the crest is the trimline (`sCrest` ≈ 1), so
 * the parabola still meets that edge. The blend starts at s = 0.52 so the
 * midspan crown stays on the chord.
 */
export function archProfileCrestHold(s: number, sCrest: number, spanMm: number): number {
    if (!(sCrest < 1 - CREST_RIM_FRACTION)) return 1;
    if (!(s < sCrest)) return 0;
    const mm = spanMm > 1 ? spanMm : 40;
    const hold = Math.min(Math.max(0, sCrest - CREST_HOLD_CROWN_S), ARCH_PROFILE_VALLEY_BLEND_MM / mm);
    if (!(hold > 1e-4)) return 1;
    const start = sCrest - hold;
    if (s <= start) return 1;
    return 1 - quintic((s - start) / hold);
}

export interface AnatomicalApex {
    u: number;
    /** Medial coordinate, +1 at the medial rim on both feet. */
    m: number;
    z: number;
}

/**
 * Crest of the unprofiled medial arch inside the open window. This is the
 * surface apex the profile must not move. Apex Shift has already relocated
 * it, either by the height-field crest (u = 0.4, plus apex shift when the
 * arch height is nonzero) or by the stock-arch warp. It is not added again.
 *
 * The last search step is 1e-5 in u. On a 260 mm foot that is 0.0026 mm, so
 * a 0.05 mm displacement is several steps and not a grid artifact.
 */
export function measureAnatomicalApex(
    side: Side,
    sampleAt: (u: number, vSigned: number) => number,
): AnatomicalApex {
    let best: AnatomicalApex = { u: ARCH_PROFILE_U_FALLBACK, m: 1, z: -Infinity };
    const consider = (u: number, m: number) => {
        if (u <= ARCH_PROFILE_U_POSTERIOR || u >= ARCH_PROFILE_U_ANTERIOR) return;
        if (m < 0.15 || m > 1.05) return;
        const z = sampleAt(u, vSignedFromMedial(m, side));
        if (z > best.z) best = { u, m, z };
    };
    // Stay inside the open arch. The heel wall can be the tallest vertex just
    // inside u = 0.28, and that is not the longitudinal-arch crest.
    for (let ui = 0; ui <= 40; ui++) {
        const u = 0.34 + (0.2 * ui) / 40;
        for (let mi = 0; mi <= 32; mi++) {
            const m = 0.25 + (0.75 * mi) / 32;
            consider(u, m);
        }
    }
    for (const step of [0.004, 0.001, 0.00025, 0.00005, 0.00001]) {
        let moved = true;
        let guard = 0;
        while (moved && guard < 40) {
            moved = false;
            guard++;
            const origin = best;
            const dmStep = step < 0.001 ? step : step * 4;
            for (const du of [-step, 0, step]) {
                for (const dm of [-dmStep, 0, dmStep]) {
                    if (du === 0 && dm === 0) continue;
                    consider(origin.u + du, origin.m + dm);
                }
            }
            if (best.z > origin.z + 1e-12) moved = true;
        }
    }
    return best;
}

/**
 * Valley = medial edge of the plantar floor. Rim = the local medial trimline
 * (largest `m` among the samples), with the surface height at that edge.
 * `m` stays in the caller's normalization. Samples should be ordered by `m`.
 */
export function measureArchSection(samples: readonly ArchSectionSample[]): ArchSection | null {
    let rim: ArchSectionSample | null = null;
    for (const s of samples) {
        if (!rim || s.m > rim.m || (s.m === rim.m && s.z > rim.z)) rim = s;
    }
    if (!rim || rim.m < RIM_M_MIN) return null;

    let zMin = Infinity;
    for (const s of samples) {
        if (s.m < VALLEY_M_MIN || s.m > 0.45 || s.m >= rim.m) continue;
        if (s.z < zMin) zMin = s.z;
    }
    if (!Number.isFinite(zMin)) return null;

    let valley: ArchSectionSample | null = null;
    for (const s of samples) {
        if (s.m < VALLEY_SEARCH_MIN || s.m >= rim.m - 0.04) continue;
        if (s.z <= zMin + FLOOR_BAND_MM && (!valley || s.m > valley.m)) valley = s;
    }
    if (!valley) {
        for (const s of samples) {
            if (s.m < VALLEY_SEARCH_MIN) continue;
            if (!valley || s.m < valley.m) valley = s;
        }
    }
    if (!valley || rim.m - valley.m < 0.12) return null;
    return { mValley: valley.m, mRim: rim.m, zValley: valley.z, zRim: rim.z, mCrest: rim.m };
}

interface CubicSpline {
    x: number[];
    y: number[];
    /** Second derivatives at the knots. Natural ends are 0. */
    m: number[];
}

/** Solve A x = b. A is overwritten. n is small (the arch is a few dozen stations). */
function solveDense(a: number[][], b: number[]): number[] {
    const n = b.length;
    const m = a.map((row, i) => [...row, b[i]!]);
    for (let col = 0; col < n; col++) {
        let pivot = col;
        let best = Math.abs(m[col]![col]!);
        for (let row = col + 1; row < n; row++) {
            const v = Math.abs(m[row]![col]!);
            if (v > best) {
                best = v;
                pivot = row;
            }
        }
        if (!(best > 1e-14)) continue;
        if (pivot !== col) {
            const swap = m[col]!;
            m[col] = m[pivot]!;
            m[pivot] = swap;
        }
        const diag = m[col]![col]!;
        for (let row = col + 1; row < n; row++) {
            const f = m[row]![col]! / diag;
            if (f === 0) continue;
            const dst = m[row]!;
            const src = m[col]!;
            for (let c = col; c <= n; c++) dst[c] = dst[c]! - f * src[c]!;
        }
    }
    const x = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i--) {
        let sum = m[i]![n]!;
        const row = m[i]!;
        for (let c = i + 1; c < n; c++) sum -= row[c]! * x[c]!;
        const diag = row[i]!;
        x[i] = Math.abs(diag) > 1e-14 ? sum / diag : 0;
    }
    return x;
}

/**
 * Whittaker smoother on a uniform station index. Weight 0 stations are filled
 * by the roughness term, so a missing bin does not punch a hole in the curve.
 * Linear trends are in the null space of the second-difference penalty.
 */
function whittaker(y: number[], w: number[], lambda: number): number[] {
    const n = y.length;
    if (n === 0) return [];
    if (n <= 2 || !(lambda > 0)) return y.slice();
    const a: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const rhs = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
        const wi = w[i]! > 0 ? w[i]! : 0;
        a[i]![i] = wi + 1e-8;
        rhs[i] = wi * y[i]!;
    }
    const coeff = [1, -2, 1];
    for (let r = 0; r < n - 2; r++) {
        for (let p = 0; p < 3; p++) {
            for (let q = 0; q < 3; q++) {
                const row = r + p;
                const col = r + q;
                a[row]![col] = a[row]![col]! + lambda * coeff[p]! * coeff[q]!;
            }
        }
    }
    return solveDense(a, rhs);
}

function naturalCubic(x: number[], y: number[]): CubicSpline {
    const n = x.length;
    const second = new Array<number>(n).fill(0);
    if (n < 3) return { x, y: y.slice(), m: second };
    const h: number[] = [];
    for (let i = 0; i < n - 1; i++) h.push(x[i + 1]! - x[i]!);
    const lower = new Array<number>(n).fill(0);
    const diag = new Array<number>(n).fill(0);
    const upper = new Array<number>(n).fill(0);
    const rhs = new Array<number>(n).fill(0);
    diag[0] = 1;
    diag[n - 1] = 1;
    for (let i = 1; i < n - 1; i++) {
        lower[i] = h[i - 1]! / 6;
        diag[i] = (h[i - 1]! + h[i]!) / 3;
        upper[i] = h[i]! / 6;
        rhs[i] = (y[i + 1]! - y[i]!) / h[i]! - (y[i]! - y[i - 1]!) / h[i - 1]!;
    }
    for (let i = 1; i < n; i++) {
        const f = lower[i]! / diag[i - 1]!;
        diag[i] -= f * upper[i - 1]!;
        rhs[i] -= f * rhs[i - 1]!;
    }
    second[n - 1] = rhs[n - 1]! / diag[n - 1]!;
    for (let i = n - 2; i >= 0; i--) {
        second[i] = (rhs[i]! - upper[i]! * second[i + 1]!) / diag[i]!;
    }
    return { x, y: y.slice(), m: second };
}

function evalCubic(spline: CubicSpline, xq: number): number {
    const { x, y, m } = spline;
    const n = x.length;
    if (n === 0) return 0;
    if (n === 1 || xq <= x[0]!) return y[0]!;
    if (xq >= x[n - 1]!) return y[n - 1]!;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (x[mid]! <= xq) lo = mid;
        else hi = mid;
    }
    const h = x[hi]! - x[lo]!;
    if (!(h > 1e-12)) return y[lo]!;
    const t = (xq - x[lo]!) / h;
    const y0 = y[lo]!;
    const y1 = y[hi]!;
    const m0 = m[lo]!;
    const m1 = m[hi]!;
    const h2 = (h * h) / 6;
    return (1 - t) * y0 + t * y1 + h2 * ((1 - t) * ((1 - t) * (1 - t) - 1) * m0 + t * (t * t - 1) * m1);
}

interface FairStation {
    u: number;
    section: ArchSection | null;
    /** Surface height (mm) at a medial coordinate on this station. */
    zAt: (m: number) => number;
}

/**
 * C2 curves for the valley isoline and the medial trimline. Raw per-bin
 * detections hop from vertex to vertex; a linear lerp of those hops is the
 * sawtooth. Whittaker removes the hop, then a natural cubic makes the isoline
 * C2. z is resampled on the faired m so the chord still meets the surface.
 */
function withCrest(section: ArchSection, mCrest: number): ArchSection {
    const span = section.mRim - section.mValley;
    let m = mCrest;
    if (!Number.isFinite(m)) m = section.mRim;
    if (m < section.mValley) m = section.mValley;
    if (m > section.mRim) m = section.mRim;
    if (!(span > 1e-4) || m > section.mRim - CREST_RIM_FRACTION * span) m = section.mRim;
    return { ...section, mCrest: m };
}

function shellHeight(stations: readonly FairStation[], uq: number, m: number): number {
    const n = stations.length;
    if (n === 0) return Number.NaN;
    // Empty u-bins (a closed solid's side wall fails the top test) have no
    // samples, and lerping through them turns the shell into NaN.
    const zOf = (i: number): number => stations[i]!.zAt(m);
    let lo = -1;
    let hi = -1;
    for (let i = 0; i < n; i++) {
        if (!Number.isFinite(zOf(i))) continue;
        if (stations[i]!.u <= uq) lo = i;
        if (hi < 0 && stations[i]!.u >= uq) hi = i;
    }
    if (lo < 0 && hi < 0) return Number.NaN;
    if (lo < 0) return zOf(hi);
    if (hi < 0 || hi === lo) return zOf(lo);
    const span = stations[hi]!.u - stations[lo]!.u;
    const t = span > 1e-12 ? (uq - stations[lo]!.u) / span : 0;
    const za = zOf(lo);
    const zb = zOf(hi);
    return za + t * (zb - za);
}

function fairArchCurve(stations: readonly FairStation[]): (u: number) => ArchSection | null {
    const n = stations.length;
    const crestU: number[] = [];
    const crestM: number[] = [];
    for (const station of stations) {
        const m = crestMedial(station);
        if (m == null) continue;
        crestU.push(station.u);
        crestM.push(m);
    }
    // Nearest station, not a lerp. Averaging an inboard crest with a rim
    // station pulls the pin onto the crest and the chord lowers it.
    const mCrestAt = (uq: number): number => {
        if (crestU.length === 0) return Number.NaN;
        let best = 0;
        let bestD = Math.abs(uq - crestU[0]!);
        for (let i = 1; i < crestU.length; i++) {
            const d = Math.abs(uq - crestU[i]!);
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return crestM[best]!;
    };
    const decorate = (section: ArchSection | null, uq: number): ArchSection | null => {
        if (!section) return null;
        const pinned = withCrest(section, mCrestAt(uq));
        pinned.shellAt = (m: number) => shellHeight(stations, uq, m);
        return pinned;
    };
    const fallback = lerpFallback(stations);
    if (n < 4) return (uq) => decorate(fallback(uq), uq);
    const u = stations.map((s) => s.u);
    const w = stations.map((s) => (s.section ? 1 : 0));
    if (w.reduce((sum, flag) => sum + flag, 0) < 4) return (uq) => decorate(fallback(uq), uq);
    const mValleyY = stations.map((s) => s.section?.mValley ?? 0);
    const mRimY = stations.map((s) => s.section?.mRim ?? 0);
    const mValleyS = whittaker(mValleyY, w, SECTION_M_VALLEY_LAMBDA);
    const mRimS = whittaker(mRimY, w, SECTION_M_RIM_LAMBDA);
    const zValleyY = new Array<number>(n).fill(0);
    const zRimY = new Array<number>(n).fill(0);
    const wZ = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
        const mv = mValleyS[i]!;
        const mr = mRimS[i]!;
        if (!(mr > mv + 0.12)) continue;
        // Rim height is the surface at the detected edge, not at the faired
        // (slightly inboard) m. That keeps the parabola from ending above the trimline.
        const rawRim = stations[i]!.section?.mRim ?? mr;
        const zv = stations[i]!.zAt(mv);
        const zr = stations[i]!.zAt(rawRim);
        if (!Number.isFinite(zv) || !Number.isFinite(zr)) continue;
        zValleyY[i] = zv;
        zRimY[i] = zr;
        wZ[i] = 1;
    }
    if (wZ.reduce((sum, flag) => sum + flag, 0) < 4) return (uq) => decorate(fallback(uq), uq);
    const zValleyS = whittaker(zValleyY, wZ, SECTION_Z_VALLEY_LAMBDA);
    const zRimS = whittaker(zRimY, wZ, SECTION_Z_RIM_LAMBDA);
    const mValleySp = naturalCubic(u, mValleyS);
    const mRimSp = naturalCubic(u, mRimS);
    const zValleySp = naturalCubic(u, zValleyS);
    const zRimSp = naturalCubic(u, zRimS);
    return (uq: number) => {
        const mValley = evalCubic(mValleySp, uq);
        const mRim = evalCubic(mRimSp, uq);
        const zValley = evalCubic(zValleySp, uq);
        const zRim = evalCubic(zRimSp, uq);
        if (![mValley, mRim, zValley, zRim].every(Number.isFinite)) return null;
        if (!(mRim - mValley > 0.12)) return null;
        return decorate({ mValley, mRim, zValley, zRim, mCrest: mRim }, uq);
    };
}

function lerpFallback(stations: readonly FairStation[]): (u: number) => ArchSection | null {
    const valid = stations.filter((s): s is FairStation & { section: ArchSection } => s.section != null);
    return (uq: number) => {
        if (valid.length === 0) return null;
        if (valid.length === 1 || uq <= valid[0]!.u) return valid[0]!.section;
        const last = valid[valid.length - 1]!;
        if (uq >= last.u) return last.section;
        let hi = 1;
        while (hi < valid.length && valid[hi]!.u < uq) hi++;
        const b = valid[hi]!;
        const a = valid[hi - 1]!;
        const span = b.u - a.u;
        const t = span > 1e-12 ? (uq - a.u) / span : 0;
        return lerpSection(a.section, b.section, t);
    };
}

function zAtSamples(samples: readonly ArchSectionSample[], m: number): number {
    if (samples.length === 0) return Number.NaN;
    if (samples.length === 1 || m <= samples[0]!.m) return samples[0]!.z;
    const last = samples[samples.length - 1]!;
    if (m >= last.m) return last.z;
    let hi = 1;
    while (hi < samples.length && samples[hi]!.m < m) hi++;
    const b = samples[hi]!;
    const a = samples[hi - 1]!;
    const dm = b.m - a.m;
    const t = dm > 1e-12 ? (m - a.m) / dm : 0;
    return a.z + t * (b.z - a.z);
}

/**
 * Cubic on t ∈ [0, 1]. Derivatives are dy/dt. End slopes are kept so the
 * crown and the crest stay C1. Fritsch–Carlson scales them only when the
 * cubic would leave the span between the endpoints by more than 0.2 mm,
 * which is a trough or a second bump rather than the shell's own curvature.
 */
const SHOULDER_OVERSHOOT_MM = 0.2;

function monotoneCubic(t: number, y0: number, y1: number, d0: number, d1: number): number {
    const delta = y1 - y0;
    let m0 = d0;
    let m1 = d1;
    const needsClamp = () => {
        const lo = Math.min(y0, y1) - SHOULDER_OVERSHOOT_MM;
        const hi = Math.max(y0, y1) + SHOULDER_OVERSHOOT_MM;
        for (const tt of [0.25, 0.5, 0.75]) {
            const y = cubicHermite(tt, y0, y1, m0, m1);
            if (y < lo || y > hi) return true;
        }
        return false;
    };
    if (needsClamp()) {
        if (!(Math.abs(delta) > 1e-9)) {
            m0 = 0;
            m1 = 0;
        } else {
            const a = m0 / delta;
            const b = m1 / delta;
            const mag = a * a + b * b;
            if (mag > 9) {
                const scale = 3 / Math.sqrt(mag);
                m0 *= scale;
                m1 *= scale;
            }
        }
    }
    return cubicHermite(t, y0, y1, m0, m1);
}

function cubicHermite(t: number, y0: number, y1: number, d0: number, d1: number): number {
    const tt = t <= 0 ? 0 : t >= 1 ? 1 : t;
    const t2 = tt * tt;
    const t3 = t2 * tt;
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + tt) * d0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * d1;
}

/** Shell height and its derivatives with respect to the span fraction s. */
function shellSlope(
    shellAt: (m: number) => number,
    m: number,
    span: number,
): { z: number; ds: number; dss: number } {
    const dm = 0.012;
    const z0 = shellAt(m);
    const zp = shellAt(m + dm);
    const zm = shellAt(m - dm);
    const dzdm = (zp - zm) / (2 * dm);
    const d2 = (zp - 2 * z0 + zm) / (dm * dm);
    return { z: z0, ds: dzdm * span, dss: d2 * span * span };
}

/**
 * Displacement from the shell to the chord or the dome, and its s-derivatives.
 * `profile01` is 0 at Domed, 0.5 at Neutral, 1 at Cradled.
 */
function shapeGap(
    s: number,
    profile01: number,
    section: ArchSection,
    shell: { z: number; ds: number; dss: number },
): { d: number; ds: number; dss: number } {
    const dzRim = section.zRim - section.zValley;
    const amp = Math.min(ARCH_PROFILE_BULGE_MM, Math.max(0, dzRim / 4));
    const raw = 4 * amp * s * (1 - s);
    const capped = raw > ARCH_PROFILE_CAP_MM;
    const bulge = capped ? ARCH_PROFILE_CAP_MM : raw;
    const dsBulge = capped ? 0 : 4 * amp * (1 - 2 * s);
    const dssBulge = capped ? 0 : -8 * amp;
    const pull = profile01 >= 0.5 ? (1 - profile01) / 0.5 : 1;
    const dome = profile01 >= 0.5 ? 0 : (0.5 - profile01) / 0.5;
    return {
        d: pull * (section.zValley + s * dzRim - shell.z) + dome * bulge,
        ds: pull * (dzRim - shell.ds) + dome * dsBulge,
        dss: pull * -shell.dss + dome * dssBulge,
    };
}

/**
 * Added millimetres at one point. `zCur` is the cradled height (profile 100).
 * Outside the valley-to-trimline span the delta is 0. At the trimline the
 * target is `zRim`, so the edge height stays put.
 *
 * An inboard crest is not pulled onto the chord. From s = 0.52 to the crest
 * the absolute height is a monotone cubic between the crown and the shell at
 * the crest. Blending the displacement instead lets that cubic fall faster
 * than the shell rises, which cuts a trough in front of the crest. Medial of
 * the crest the shell is unchanged.
 */
export function archProfileDeltaMm(
    m: number,
    zCur: number,
    profile: number | undefined,
    section: ArchSection,
    envelope: number,
    halfWidthMm = 0,
): number {
    if (!(envelope > 0)) return 0;
    const p = resolveArchProfile(profile) / 100;
    if (p >= 1) return 0;
    const span = section.mRim - section.mValley;
    if (!(span > 1e-4)) return 0;
    if (m <= section.mValley || m >= section.mRim) return 0;
    const s = (m - section.mValley) / span;
    if (!(s > 0) || s >= 1) return 0;
    const spanMm = span * halfWidthMm;
    const sCrest = (section.mCrest - section.mValley) / span;
    const shellAt = section.shellAt;
    const hold = shellAt != null && sCrest < 1 - CREST_RIM_FRACTION && sCrest > CREST_HOLD_CROWN_S + 1e-3;
    if (!hold || !shellAt) {
        return envelope * chordDelta(s, p, section, { z: zCur, ds: 0, dss: 0 }, spanMm);
    }
    if (s >= sCrest) return 0;
    // Shell-relative on both sides of the shoulder so the target is one C2
    // curve. A vertex-relative crown meeting a shell-relative Hermite leaves
    // a step, and that step is a crease on the sheet.
    const shell = shellSlope(shellAt, section.mValley + s * span, span);
    if (!Number.isFinite(shell.z)) return 0;
    if (s <= CREST_HOLD_CROWN_S) {
        return envelope * chordDelta(s, p, section, shell, spanMm);
    }
    const shell0 = shellSlope(shellAt, section.mValley + CREST_HOLD_CROWN_S * span, span);
    const start = shapeGap(CREST_HOLD_CROWN_S, p, section, shell0);
    const mCrest = section.mValley + sCrest * span;
    const shell1 = shellSlope(shellAt, mCrest, span);
    const h = sCrest - CREST_HOLD_CROWN_S;
    if (!(h > 1e-3) || !Number.isFinite(shell0.z) || !Number.isFinite(shell1.z)) return 0;
    const t = (s - CREST_HOLD_CROWN_S) / h;
    const z0 = shell0.z + start.d;
    const z1 = shell1.z;
    const zTarget = monotoneCubic(t, z0, z1, (shell0.ds + start.ds) * h, shell1.ds * h);
    if (!Number.isFinite(zTarget)) return 0;
    return envelope * (zTarget - shell.z);
}

/** Valley fillet times the chord/dome gap. Crest hold is 1 through s = 0.52. */
function chordDelta(
    s: number,
    profile01: number,
    section: ArchSection,
    shell: { z: number; ds: number; dss: number },
    spanMm: number,
): number {
    const gap = shapeGap(s, profile01, section, shell);
    return archProfileValleyBlend(s, spanMm) * gap.d;
}

/** Same transverse samples the height field uses to place the valley and the rim. */
export function sampleMedialArchSection(
    u: number,
    side: Side,
    sampleAt: (u: number, vSigned: number) => number,
): ArchSection | null {
    const samples: ArchSectionSample[] = [];
    for (let i = 0; i <= SECTION_SAMPLES; i++) {
        const m = -0.3 + (1.3 * i) / SECTION_SAMPLES;
        samples.push({ m, z: sampleAt(u, vSignedFromMedial(m, side)) });
    }
    return measureArchSection(samples);
}

/** Nonzero while the faired curve is sampling the unprofiled shell. */
let curveBuilding = 0;
interface ProfileCurve {
    evalAt: (u: number) => ArchSection | null;
    /** Measured unprofiled crest. Not `0.43`, and not apex shift added a second time. */
    apexU: number;
}

let tokenCurve: { token: number; curve: ProfileCurve } | null = null;
const curveCache = new Map<number, ProfileCurve>();

function mixHash(hash: number, n: number): number {
    const bits = Number.isFinite(n) ? Math.round(n * 10000) : 0;
    return Math.imul(hash ^ bits, 16777619);
}

function surfaceKey(side: Side, sampleAt: (u: number, vSigned: number) => number): number {
    let hash = side === "left" ? 1 : 2;
    for (let i = 0; i <= 6; i++) {
        const u = ARCH_PROFILE_U_POSTERIOR + ((ARCH_PROFILE_U_ANTERIOR - ARCH_PROFILE_U_POSTERIOR) * i) / 6;
        for (let j = 0; j <= 4; j++) {
            const m = -0.15 + (1.05 * j) / 4;
            hash = mixHash(hash, sampleAt(u, vSignedFromMedial(m, side)));
        }
    }
    return hash;
}

/** Freeze the shell while the curve is built. A live sampleAt calls heightAt again. */
function frozenShell(
    side: Side,
    u: number,
    sampleAt: (u: number, vSigned: number) => number,
): (m: number) => number {
    const n = 256;
    const m0 = -0.45;
    const m1 = 1.25;
    const z = new Array<number>(n + 1);
    for (let i = 0; i <= n; i++) {
        const m = m0 + ((m1 - m0) * i) / n;
        z[i] = sampleAt(u, vSignedFromMedial(m, side));
    }
    return (m: number) => {
        if (m <= m0) return z[0]!;
        if (m >= m1) return z[n]!;
        const t = ((m - m0) / (m1 - m0)) * n;
        const i = Math.min(n - 1, Math.floor(t));
        const f = t - i;
        return z[i]! + f * (z[i + 1]! - z[i]!);
    };
}

function fitHeightFieldCurve(side: Side, sampleAt: (u: number, vSigned: number) => number): ProfileCurve {
    const u0 = ARCH_PROFILE_U_POSTERIOR;
    const u1 = ARCH_PROFILE_U_ANTERIOR;
    const du = (u1 - u0) / CURVE_STATIONS;
    const stations: FairStation[] = [];
    for (let i = 0; i < CURVE_STATIONS; i++) {
        const u = u0 + (i + 0.5) * du;
        stations.push({
            u,
            section: sampleMedialArchSection(u, side, sampleAt),
            zAt: frozenShell(side, u, sampleAt),
        });
    }
    return { evalAt: fairArchCurve(stations), apexU: measureAnatomicalApex(side, sampleAt).u };
}

function cachedHeightFieldCurve(side: Side, sampleAt: (u: number, vSigned: number) => number): ProfileCurve {
    if (curveBuilding > 0) return { evalAt: () => null, apexU: ARCH_PROFILE_U_FALLBACK };
    curveBuilding++;
    try {
        const key = surfaceKey(side, sampleAt);
        const hit = curveCache.get(key);
        if (hit) return hit;
        const built = fitHeightFieldCurve(side, sampleAt);
        if (curveCache.size > 32) {
            const oldest = curveCache.keys().next().value;
            if (oldest !== undefined) curveCache.delete(oldest);
        }
        curveCache.set(key, built);
        return built;
    } finally {
        curveBuilding--;
    }
}

/**
 * Faired valley/trimline section at one u. Same curve `archProfileDeltaAt` uses,
 * so a test can score the parabola against the isoline that actually moves the shell.
 */
export function fairedMedialArchSection(
    u: number,
    side: Side,
    sampleAt: (u: number, vSigned: number) => number,
): ArchSection | null {
    if (curveBuilding > 0) return null;
    return cachedHeightFieldCurve(side, sampleAt).evalAt(u);
}

export interface ArchProfileQuery {
    u: number;
    vSigned: number;
    zCur: number;
    side: Side;
    profile: number | undefined;
    /** Changes when the unprofiled surface changes. The profile value is not part of it. */
    cacheToken: number;
    sampleUnprofiled: (u: number, vSigned: number) => number;
    /** Millimetres of one unit of the medial coordinate at this u. 0 → wide fractional fillet. */
    halfWidthMm?: number;
}

/**
 * Vertical delta for the procedural height field. Returns 0 without sampling
 * when the slider is at Cradled, while a nested sample is in progress, or
 * outside the longitudinal arch.
 */
export function archProfileDeltaAt(query: ArchProfileQuery): number {
    if (curveBuilding > 0) return 0;
    if (!archProfileActive(query.profile)) return 0;
    if (!tokenCurve || tokenCurve.token !== query.cacheToken) {
        tokenCurve = {
            token: query.cacheToken,
            curve: cachedHeightFieldCurve(query.side, query.sampleUnprofiled),
        };
    }
    const envelope = archProfileEnvelope(query.u, tokenCurve.curve.apexU);
    if (envelope === 0) return 0;
    const section = tokenCurve.curve.evalAt(query.u);
    if (!section) return 0;
    return archProfileDeltaMm(
        medialCoordinate(query.vSigned, query.side),
        query.zCur,
        query.profile,
        section,
        envelope,
        query.halfWidthMm ?? 0,
    );
}

type Axis = 0 | 1 | 2;

const MESH_U_BINS = 24;
const MESH_M_BINS = 64;

export interface LoadedArchApex {
    u: number;
    /** Medial coordinate, +1 at the medial rim on both feet. */
    m: number;
    z: number;
}

/**
 * Anatomical apex of a loaded top sheet.
 *
 * The trimline is often the tallest vertex, and that wall is not the arch.
 * Vertices within 4 mm of it are excluded. Among the rest, the apex is the
 * point of greatest longitudinal prominence (height above the posterior and
 * anterior arch ends). A quadratic fit in millimetres then places the
 * critical point to well under 0.05 mm. A centroid of the hump is not used:
 * it sits off the peak.
 */
export function measureLoadedArchApex(args: {
    positions: ArrayLike<number>;
    side: Side;
    lengthAxis: Axis;
    widthAxis: Axis;
    thickAxis: Axis;
    lenMin: number;
    lenSize: number;
    widCenter: number;
    widSize: number;
    widthSign: number;
    topVertexCount: number;
}): LoadedArchApex | null {
    const count = (args.positions.length / 3) | 0;
    const topEnd = args.topVertexCount > 0 ? Math.min(args.topVertexCount, count) : count;
    if (!(args.lenSize > 1) || !(args.widSize > 1) || topEnd < 8) return null;
    const halfW = args.widSize / 2;
    const medialSign = args.side === "left" ? -1 : 1;
    const samples: { u: number; m: number; z: number }[] = [];
    for (let i = 0; i < topEnd; i++) {
        const len = args.positions[i * 3 + args.lengthAxis]!;
        const wid = args.positions[i * 3 + args.widthAxis]!;
        const u = (len - args.lenMin) / args.lenSize;
        if (u < 0.32 || u > 0.56) continue;
        const vNorm = (args.widthSign * (wid - args.widCenter)) / halfW;
        const vSigned = vNorm < -1 ? -1 : vNorm > 1 ? 1 : vNorm;
        const m = -(vSigned * medialSign);
        if (m < 0.2 || m > 1.05) continue;
        samples.push({ u, m, z: args.positions[i * 3 + args.thickAxis]! });
    }
    if (samples.length < 24) return null;

    const inset = 4 / halfW;
    const uBin = 0.01;
    const mBin = 0.025;
    const bins = new Map<string, { u: number; m: number; z: number }>();
    const keyOf = (u: number, m: number) => `${Math.round(u / uBin)}:${Math.round(m / mBin)}`;
    for (const s of samples) {
        const key = keyOf(s.u, s.m);
        const slot = bins.get(key);
        if (!slot || s.z > slot.z) bins.set(key, s);
    }
    const cells = [...bins.values()];
    let best: { u: number; m: number; z: number; score: number } | null = null;
    for (const s of cells) {
        let rimM = -Infinity;
        let rear = 0;
        let rearN = 0;
        let fore = 0;
        let foreN = 0;
        for (const o of cells) {
            const du = o.u - s.u;
            if (Math.abs(du) <= 0.03 && o.m > rimM) rimM = o.m;
            if (Math.abs(o.m - s.m) > 0.05) continue;
            if (du < -0.04 && du > -0.12) {
                rear += o.z;
                rearN++;
            } else if (du > 0.04 && du < 0.12) {
                fore += o.z;
                foreN++;
            }
        }
        if (rearN < 1 || foreN < 1) continue;
        if (s.m > rimM - inset) continue;
        const score = s.z - 0.5 * (rear / rearN + fore / foreN);
        if (!best || score > best.score) best = { u: s.u, m: s.m, z: s.z, score };
    }
    if (!best) return null;

    const radiusU = 6 / args.lenSize;
    const radiusM = 6 / halfW;
    const rows: { du: number; dm: number; z: number }[] = [];
    for (const s of samples) {
        const du = (s.u - best.u) * args.lenSize;
        const dm = (s.m - best.m) * halfW;
        if (Math.abs(s.u - best.u) > radiusU || Math.abs(s.m - best.m) > radiusM) continue;
        rows.push({ du, dm, z: s.z });
    }
    const fitted = fitApexQuadratic(rows);
    if (!fitted) return { u: best.u, m: best.m, z: best.z };
    let u = best.u + fitted.du / args.lenSize;
    let m = best.m + fitted.dm / halfW;
    if (u < 0.32) u = 0.32;
    if (u > 0.56) u = 0.56;
    if (m < 0.2) m = 0.2;
    if (m > 1.02) m = 1.02;
    return { u, m, z: fitted.z };
}

/**
 * Least-squares paraboloid z = A du² + B dm² + C du dm + D du + E dm + F,
 * in millimetres about the coarse apex. Returns the critical point when it
 * is a maximum inside the fitted window; otherwise the longitudinal vertex
 * at dm = 0, which is the ridge when the sheet still rises toward the rim.
 */
function fitApexQuadratic(rows: readonly { du: number; dm: number; z: number }[]): {
    du: number;
    dm: number;
    z: number;
} | null {
    if (rows.length < 8) return null;
    const ata: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    const atb = new Array<number>(6).fill(0);
    for (const row of rows) {
        const { du, dm, z } = row;
        const phi = [du * du, dm * dm, du * dm, du, dm, 1];
        for (let r = 0; r < 6; r++) {
            atb[r] += phi[r]! * z;
            for (let c = 0; c < 6; c++) ata[r]![c] += phi[r]! * phi[c]!;
        }
    }
    const coef = solveDense(ata, atb);
    const A = coef[0]!;
    const B = coef[1]!;
    const C = coef[2]!;
    const D = coef[3]!;
    const E = coef[4]!;
    const F = coef[5]!;
    const hess = 4 * A * B - C * C;
    let du = 0;
    let dm = 0;
    if (A < 0 && B < 0 && hess > 1e-8) {
        const det = hess;
        du = (-2 * B * D + C * E) / det;
        dm = (C * D - 2 * A * E) / det;
        if (Math.hypot(du, dm) > 6) {
            du = Math.abs(A) > 1e-8 ? -D / (2 * A) : 0;
            dm = 0;
        }
    } else if (A < 0) {
        du = -D / (2 * A);
        dm = 0;
        if (Math.abs(du) > 6) du = 0;
    } else {
        return null;
    }
    const z = A * du * du + B * dm * dm + C * du * dm + D * du + E * dm + F;
    return { du, dm, z };
}

function lerpSection(a: ArchSection, b: ArchSection, t: number): ArchSection {
    const u = 1 - t;
    return {
        mValley: u * a.mValley + t * b.mValley,
        mRim: u * a.mRim + t * b.mRim,
        zValley: u * a.zValley + t * b.zValley,
        zRim: u * a.zRim + t * b.zRim,
        mCrest: u * a.mCrest + t * b.mCrest,
    };
}

/**
 * Medial coordinate of the highest sample between the valley and the rim.
 * The trimline is returned when that peak sits on the edge, so the parabola
 * is left unchanged. An inboard peak is biased slightly toward the valley.
 */
function crestMedial(station: FairStation): number | null {
    const section = station.section;
    if (!section) return null;
    const m0 = section.mValley;
    const m1 = section.mRim;
    const span = m1 - m0;
    if (!(span > 1e-4)) return null;
    const n = 48;
    const z: number[] = [];
    let bestI = n;
    let bestZ = -Infinity;
    for (let i = 0; i <= n; i++) {
        const zi = station.zAt(m0 + (span * i) / n);
        z.push(zi);
        if (zi > bestZ) {
            bestZ = zi;
            bestI = i;
        }
    }
    if (bestI <= 0 || bestI >= n) return m1;
    const zm = z[bestI - 1]!;
    const z0 = z[bestI]!;
    const zp = z[bestI + 1]!;
    const denom = zm - 2 * z0 + zp;
    let shift = Math.abs(denom) > 1e-8 ? (0.5 * (zm - zp)) / denom : 0;
    if (shift < -0.5) shift = -0.5;
    if (shift > 0.5) shift = 0.5;
    const m = m0 + (span * (bestI + shift)) / n;
    if (m > m1 - CREST_RIM_FRACTION * span) return m1;
    return Math.max(m0, m - CREST_PIN_FRACTION * span);
}

/**
 * Bow the loaded top sheet from its own valley-to-rim chord. The height-field
 * delta is not used here: a stock mesh (SAMPLE_Top) is not the procedural
 * shell, so the chord has to be measured on the deformed top. No-op when the
 * slider is Cradled, and pinned vertices are not written.
 *
 * The valley join is the analytic C2 fillet (`archProfileValleyBlend`). A mesh
 * Laplacian here folds triangles on the real SAMPLE_Top sheet: neighbors mix
 * the pinned floor with the higher parabola, and the resulting z oscillation
 * inverts faces. Do not add one back.
 */
export function applyArchProfileToTopPositions(args: {
    positions: Float32Array;
    corrections: SideCorrections;
    side: Side;
    lengthAxis: Axis;
    widthAxis: Axis;
    thickAxis: Axis;
    lenMin: number;
    lenSize: number;
    widCenter: number;
    widSize: number;
    widthSign: number;
    /** Exclusive end of an explicit top sheet. 0 → use `topFactor`. */
    topVertexCount: number;
    topFactor?: ArrayLike<number> | null;
    lengthMm: number;
}): void {
    if (!archProfileActive(args.corrections.archProfile)) return;
    if (!(args.lenSize > 1e-6) || !(args.widSize > 1e-6)) return;

    const count = (args.positions.length / 3) | 0;
    const topEnd = args.topVertexCount > 0 ? Math.min(args.topVertexCount, count) : 0;
    const factor = args.topFactor;
    const isTop = (i: number): boolean => {
        if (topEnd > 0) return i < topEnd;
        // Top-only open sheet (e.g. SAMPLE_Top.glb): classifyBaseTopFactors
        // returns null because there is no downward-facing bottom surface.
        if (factor == null) return true;
        return (factor[i] ?? 0) > 0.65;
    };

    const halfW = args.widSize / 2;
    const medialSign = args.side === "left" ? -1 : 1;
    const uOf = (i: number): number => {
        const len = args.positions[i * 3 + args.lengthAxis]!;
        return (len - args.lenMin) / args.lenSize;
    };
    const mOf = (i: number): number => {
        const wid = args.positions[i * 3 + args.widthAxis]!;
        const vNorm = (args.widthSign * (wid - args.widCenter)) / halfW;
        const vSigned = vNorm < -1 ? -1 : vNorm > 1 ? 1 : vNorm;
        return -(vSigned * medialSign);
    };

    const u0 = ARCH_PROFILE_U_POSTERIOR;
    const u1 = ARCH_PROFILE_U_ANTERIOR;
    const du = (u1 - u0) / MESH_U_BINS;
    const best: ({ m: number; z: number } | null)[][] = Array.from({ length: MESH_U_BINS }, () =>
        Array.from({ length: MESH_M_BINS }, () => null),
    );

    for (let i = 0; i < count; i++) {
        if (!isTop(i)) continue;
        const u = uOf(i);
        if (u < u0 || u >= u1) continue;
        const m = mOf(i);
        const ui = Math.min(MESH_U_BINS - 1, Math.max(0, Math.floor((u - u0) / du)));
        const mi = Math.min(MESH_M_BINS - 1, Math.max(0, Math.floor(((m + 1) / 2) * MESH_M_BINS)));
        const z = args.positions[i * 3 + args.thickAxis]!;
        const slot = best[ui]![mi];
        if (!slot || z > slot.z) best[ui]![mi] = { m, z };
    }

    const binSamples: ArchSectionSample[][] = best.map((row) => {
        const samples: ArchSectionSample[] = [];
        for (const slot of row) if (slot) samples.push(slot);
        samples.sort((a, b) => a.m - b.m);
        return samples;
    });
    const stations: FairStation[] = binSamples.map((samples, i) => ({
        u: u0 + (i + 0.5) * du,
        section: measureArchSection(samples),
        zAt: (m) => zAtSamples(samples, m),
    }));
    const sectionAt = fairArchCurve(stations);
    const halfWidthMm = args.widSize / 2;

    // The loaded sheet's own apex. Not the trimline, and not the centroid of
    // the hump. The warp, when it runs, has already moved this crest.
    const measured = measureLoadedArchApex({
        positions: args.positions,
        side: args.side,
        lengthAxis: args.lengthAxis,
        widthAxis: args.widthAxis,
        thickAxis: args.thickAxis,
        lenMin: args.lenMin,
        lenSize: args.lenSize,
        widCenter: args.widCenter,
        widSize: args.widSize,
        widthSign: args.widthSign,
        topVertexCount: args.topVertexCount,
    });
    const apexU = measured?.u ?? ARCH_PROFILE_U_FALLBACK;

    const { archProfile } = args.corrections;
    for (let i = 0; i < count; i++) {
        if (!isTop(i)) continue;
        const u = uOf(i);
        const envelope = archProfileEnvelope(u, apexU);
        if (envelope === 0) continue;
        let section = sectionAt(u);
        if (!section) continue;
        // Rim channels stay on the local detected edge, lerped in u the way the
        // pre-fair section did. A faired mRim sits inboard of that edge and the
        // parabola ends as a lip. The valley isoline is what sawtoothed.
        if (measured) {
            // One measured crest for every station. The faired trimline is
            // left in place: the return reaches the crest and the edge beyond
            // it is already on the shell, so a raw rim channel is not needed
            // and its station-to-station hop was creasing the shoulder.
            let mCrest = measured.m;
            if (mCrest < section.mValley) mCrest = section.mValley;
            if (mCrest > section.mRim) mCrest = section.mRim;
            section = { ...section, mCrest };
        }
        const m = mOf(i);
        const z = args.positions[i * 3 + args.thickAxis]!;
        const delta = archProfileDeltaMm(m, z, archProfile, section, envelope, halfWidthMm);
        if (delta !== 0) args.positions[i * 3 + args.thickAxis] = z + delta;
    }
}
