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
 * pulling the crest down onto it relocates the apex. The crest hold keeps
 * the crest and the crest-to-trimline shoulder on the shell. When the crest
 * is the trimline itself, the hold is idle and the parabola still ends on
 * the edge.
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
/** Midspan crown (s = 0.5) stays fully active when the crest is medial of this. */
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
 * the parabola still meets that edge. The blend starts at or after s = 0.52
 * so the midspan crown stays on the chord.
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
 * it, either in the height-field dome (`0.42 + apexMoveMm / lengthMm`) or in
 * the stock-arch warp that runs before this pass. It is not added again.
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
    for (const step of [0.004, 0.001, 0.00025]) {
        let moved = true;
        while (moved) {
            moved = false;
            const origin = best;
            for (const du of [-step, 0, step]) {
                for (const dm of [-step * 4, 0, step * 4]) {
                    if (du === 0 && dm === 0) continue;
                    consider(origin.u + du, origin.m + dm);
                }
            }
            if (best.z > origin.z + 1e-9) moved = true;
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
    const decorate = (section: ArchSection | null, uq: number): ArchSection | null =>
        section ? withCrest(section, mCrestAt(uq)) : null;
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
        return withCrest({ mValley, mRim, zValley, zRim, mCrest: mRim }, mCrestAt(uq));
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
 * Added millimetres at one point. `zCur` is the cradled height (profile 100).
 * Outside the valley-to-trimline span the delta is 0. At the trimline the
 * target is `zRim`, so the edge height stays put.
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
    // Exact zero on the floor and on the trimline vertex. The parabola meets
    // zRim with a flat tangent just inboard of that vertex.
    if (m <= section.mValley || m >= section.mRim) return 0;
    const s = (m - section.mValley) / span;
    if (!(s > 0) || s >= 1) return 0;
    const dzRim = section.zRim - section.zValley;
    const zChord = section.zValley + s * dzRim;
    // Peak of 4*A*s*(1-s) is A. A tracks a quarter of the arch rise and never
    // passes 4 mm. The 5 mm constant remains the hard ceiling on that crown.
    // It is not applied to the preserved shell: an inboard crest already sits
    // higher than 5 mm above the chord.
    const amp = Math.min(ARCH_PROFILE_BULGE_MM, Math.max(0, dzRim / 4));
    let bulge = 4 * amp * s * (1 - s);
    if (bulge > ARCH_PROFILE_CAP_MM) bulge = ARCH_PROFILE_CAP_MM;
    const spanMm = span * halfWidthMm;
    const sCrest = (section.mCrest - section.mValley) / span;
    const wValley = archProfileValleyBlend(s, spanMm) * archProfileCrestHold(s, sCrest, spanMm);
    let zTarget: number;
    if (p >= 0.5) {
        const t = (1 - p) / 0.5;
        zTarget = zCur + t * (zChord - zCur) * wValley;
    } else {
        const c = (0.5 - p) / 0.5;
        const zNeutral = zCur + (zChord - zCur) * wValley;
        const zDomed = zCur + (zChord + bulge - zCur) * wValley;
        zTarget = zNeutral + c * (zDomed - zNeutral);
        // The bulge is already capped. Do not also clamp the preserved shell:
        // an inboard crest sits more than 5 mm above the chord, and that clamp
        // was pulling it down onto a shelf.
    }
    return envelope * (zTarget - zCur);
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
            zAt: (m) => sampleAt(u, vSignedFromMedial(m, side)),
        });
    }
    return { evalAt: fairArchCurve(stations), apexU: measureAnatomicalApex(side, sampleAt).u };
}

function cachedHeightFieldCurve(
    side: Side,
    sampleAt: (u: number, vSigned: number) => number,
): ProfileCurve {
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

/**
 * Longitudinal center of the inboard arch hump. Samples within 2 mm of the
 * tallest one vote, so a one-bin argmax hop between the preview sheet and
 * the print sheet does not move the envelope.
 */
function inboardCrestU(samples: readonly { u: number; z: number }[]): number {
    if (samples.length < 5) return ARCH_PROFILE_U_FALLBACK;
    let maxZ = -Infinity;
    for (const sample of samples) if (sample.z > maxZ) maxZ = sample.z;
    let weight = 0;
    let weightedU = 0;
    for (const sample of samples) {
        const w = sample.z - (maxZ - 2);
        if (w > 0) {
            weight += w;
            weightedU += sample.u * w;
        }
    }
    if (!(weight > 0)) return ARCH_PROFILE_U_FALLBACK;
    let u = weightedU / weight;
    if (u < 0.34) u = 0.34;
    if (u > 0.54) u = 0.54;
    return u;
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
    const rimAt = (u: number): { mRim: number; zRim: number } | null => {
        const x = (u - u0) / du - 0.5;
        const i0 = Math.floor(x);
        const t = x - i0;
        const ia = Math.min(MESH_U_BINS - 1, Math.max(0, i0));
        const ib = Math.min(MESH_U_BINS - 1, Math.max(0, i0 + 1));
        const a = stations[ia]!.section;
        const b = stations[ib]!.section;
        if (a && b) {
            const k = 1 - t;
            return { mRim: k * a.mRim + t * b.mRim, zRim: k * a.zRim + t * b.zRim };
        }
        const one = a ?? b;
        return one ? { mRim: one.mRim, zRim: one.zRim } : null;
    };
    const halfWidthMm = args.widSize / 2;

    // Inboard surface, not the trimline. Rim height falls from the heel cup,
    // so the tallest rim is the heel wall and would drag the bell posterior.
    // A centroid of the hump, not the single tallest sample: the print sheet
    // and the preview sheet peak one sample apart, and that hop moved the
    // envelope enough to miss preview/export parity. The apex warp has
    // already run, so this crest is not shifted again.
    const crestSamples: { u: number; z: number }[] = [];
    for (let i = 0; i <= 24; i++) {
        const u = 0.34 + (0.2 * i) / 24;
        const section = sectionAt(u);
        if (!section) continue;
        const span = section.mRim - section.mValley;
        if (!(span > 0.12)) continue;
        const si = Math.min(stations.length - 1, Math.max(0, Math.round((u - u0) / du - 0.5)));
        const z = stations[si]!.zAt(section.mValley + 0.7 * span);
        if (Number.isFinite(z)) crestSamples.push({ u, z });
    }
    const apexU = inboardCrestU(crestSamples);

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
        const rim = rimAt(u);
        if (rim) {
            // The loaded sheet keeps the parabola out to the trimline. An
            // inboard crest hold on this triangulation folds the valley fillet.
            // The height-field path still pins an inboard crest.
            section = {
                mValley: section.mValley,
                zValley: section.zValley,
                mRim: rim.mRim,
                zRim: rim.zRim,
                mCrest: rim.mRim,
            };
        }
        const m = mOf(i);
        const z = args.positions[i * 3 + args.thickAxis]!;
        const delta = archProfileDeltaMm(m, z, archProfile, section, envelope, halfWidthMm);
        if (delta !== 0) args.positions[i * 3 + args.thickAxis] = z + delta;
    }
}
