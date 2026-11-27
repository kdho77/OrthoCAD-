// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side, SideCorrections } from "@/types";

/**
 * Transverse medial-arch profile.
 *
 * 0 = Domed (convex, up to 4 mm above the valley-to-rim chord),
 * 50 = Neutral (the straight chord, with a short C2 fillet at each end),
 * 100 = Cradled (the current shell, zero displacement).
 * A missing value is Cradled so saved designs do not move.
 */

export const ARCH_PROFILE_CRADLED = 100;
export const ARCH_PROFILE_BULGE_MM = 4;
export const ARCH_PROFILE_CAP_MM = 5;
/** Posterior cutoff. The heel cup (u ≤ 0.28) is untouched. */
export const ARCH_PROFILE_U_POSTERIOR = 0.28;
/** Anterior cutoff. The 1st metatarsal head (u ≥ 0.58) is untouched. */
export const ARCH_PROFILE_U_ANTERIOR = 0.58;

/** Fraction of the valley-to-rim span used for the C2 fillet at each end. */
const PIN_RAMP = 0.14;
const SECTION_SAMPLES = 64;
const VALLEY_M_MIN = -0.2;
/** The bow stays on the medial side of the centerline. */
const VALLEY_SEARCH_MIN = 0;
const RIM_M_MIN = 0.25;
const FLOOR_BAND_MM = 0.4;

export interface ArchSectionSample {
    m: number;
    z: number;
}

export interface ArchSection {
    mValley: number;
    mRim: number;
    zValley: number;
    zRim: number;
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
 * C2 window that is 0 at both endpoints (value and first derivative) and 1
 * across the interior, so the chord blend does not crease into the floor or rim.
 */
export function archProfilePinWindow(s: number): number {
    if (s <= 0 || s >= 1) return 0;
    if (s < PIN_RAMP) return quintic(s / PIN_RAMP);
    if (s > 1 - PIN_RAMP) return quintic((1 - s) / PIN_RAMP);
    return 1;
}

/**
 * Longitudinal gate. Exact 0 at and outside [0.28, 0.58]. The plateau sits on
 * the navicular / sustentaculum (about 0.38–0.48) and slides with the apex,
 * but the cutoffs stay clamped so the heel cup and the 1st MPJ never rise.
 */
export function archProfileEnvelope(
    u: number,
    apexMoveMm: number,
    lengthMm: number,
    elongationMm: number | undefined,
): number {
    if (u <= ARCH_PROFILE_U_POSTERIOR || u >= ARCH_PROFILE_U_ANTERIOR) return 0;
    const shift = lengthMm > 0 && Number.isFinite(apexMoveMm) ? apexMoveMm / lengthMm : 0;
    const elong = elongationMm != null && elongationMm > 0 ? elongationMm : 0;
    const widen = lengthMm > 0 ? Math.min(5, elong) / lengthMm : 0;
    const minRamp = 0.04;
    let riseEnd = 0.38 + shift - widen * 0.5;
    let fallStart = 0.48 + shift + widen * 0.5;
    riseEnd = Math.min(Math.max(riseEnd, ARCH_PROFILE_U_POSTERIOR + minRamp), 0.46);
    fallStart = Math.max(Math.min(fallStart, ARCH_PROFILE_U_ANTERIOR - minRamp), riseEnd);
    if (u < riseEnd) {
        return quintic((u - ARCH_PROFILE_U_POSTERIOR) / (riseEnd - ARCH_PROFILE_U_POSTERIOR));
    }
    if (u > fallStart) {
        return quintic((ARCH_PROFILE_U_ANTERIOR - u) / (ARCH_PROFILE_U_ANTERIOR - fallStart));
    }
    return 1;
}

/**
 * Valley = medial edge of the plantar floor. Rim = highest point on the
 * medial arch. Samples should be ordered by increasing `m`.
 */
export function measureArchSection(samples: readonly ArchSectionSample[]): ArchSection | null {
    let rim: ArchSectionSample | null = null;
    for (const s of samples) {
        if (s.m < RIM_M_MIN) continue;
        if (!rim || s.z >= rim.z) rim = s;
    }
    if (!rim) return null;

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
    return { mValley: valley.m, mRim: rim.m, zValley: valley.z, zRim: rim.z };
}

/**
 * Added millimetres at one point. `zCur` is the cradled height (profile 100).
 * Endpoints and anything outside the span return 0.
 */
export function archProfileDeltaMm(
    m: number,
    zCur: number,
    profile: number | undefined,
    section: ArchSection,
    envelope: number,
): number {
    if (!(envelope > 0)) return 0;
    const p = resolveArchProfile(profile) / 100;
    if (p >= 1) return 0;
    const span = section.mRim - section.mValley;
    if (!(span > 1e-4)) return 0;
    if (m <= section.mValley || m >= section.mRim) return 0;
    const s = (m - section.mValley) / span;
    const zChord = (1 - s) * section.zValley + s * section.zRim;
    const w = archProfilePinWindow(s);
    let zTarget: number;
    if (p >= 0.5) {
        const t = (1 - p) / 0.5;
        zTarget = zCur + t * (zChord - zCur) * w;
    } else {
        const zNeutral = zCur + (zChord - zCur) * w;
        const c = (0.5 - p) / 0.5;
        const bulge = c * ARCH_PROFILE_BULGE_MM * Math.sin(Math.PI * s) ** 2;
        zTarget = zNeutral + bulge;
        if (zTarget - zChord > ARCH_PROFILE_CAP_MM) zTarget = zChord + ARCH_PROFILE_CAP_MM;
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

let sectionSampling = 0;
let sectionCache: { token: number; uKey: number; section: ArchSection | null } | null = null;

function sampleSection(
    u: number,
    side: Side,
    token: number,
    sampleUnprofiled: (u: number, vSigned: number) => number,
): ArchSection | null {
    const uKey = Math.round(u * 1e5);
    if (sectionCache && sectionCache.token === token && sectionCache.uKey === uKey) {
        return sectionCache.section;
    }
    sectionSampling++;
    let section: ArchSection | null;
    try {
        section = sampleMedialArchSection(u, side, sampleUnprofiled);
    } finally {
        sectionSampling--;
    }
    sectionCache = { token, uKey, section };
    return section;
}

export interface ArchProfileQuery {
    u: number;
    vSigned: number;
    zCur: number;
    side: Side;
    lengthMm: number;
    profile: number | undefined;
    apexMoveMm: number;
    archElongationMm: number | undefined;
    /** Changes when the unprofiled surface changes. The profile value is not part of it. */
    cacheToken: number;
    sampleUnprofiled: (u: number, vSigned: number) => number;
}

/**
 * Vertical delta for the procedural height field. Returns 0 without sampling
 * when the slider is at Cradled, while a nested sample is in progress, or
 * outside the longitudinal arch.
 */
export function archProfileDeltaAt(query: ArchProfileQuery): number {
    if (sectionSampling > 0) return 0;
    if (!archProfileActive(query.profile)) return 0;
    const envelope = archProfileEnvelope(query.u, query.apexMoveMm, query.lengthMm, query.archElongationMm);
    if (envelope === 0) return 0;
    const section = sampleSection(query.u, query.side, query.cacheToken, query.sampleUnprofiled);
    if (!section) return 0;
    return archProfileDeltaMm(
        medialCoordinate(query.vSigned, query.side),
        query.zCur,
        query.profile,
        section,
        envelope,
    );
}

type Axis = 0 | 1 | 2;

const MESH_U_BINS = 24;
const MESH_M_BINS = 64;

function lerpSection(a: ArchSection, b: ArchSection, t: number): ArchSection {
    const u = 1 - t;
    return {
        mValley: u * a.mValley + t * b.mValley,
        mRim: u * a.mRim + t * b.mRim,
        zValley: u * a.zValley + t * b.zValley,
        zRim: u * a.zRim + t * b.zRim,
    };
}

/**
 * Bow the loaded top sheet from its own valley-to-rim chord. The height-field
 * delta is not used here: a stock mesh (SAMPLE_Top) is not the procedural
 * shell, so the chord has to be measured on the deformed top. No-op when the
 * slider is Cradled, and pinned vertices are not written.
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
        return factor != null && (factor[i] ?? 0) > 0.65;
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

    const sections: (ArchSection | null)[] = best.map((row) => {
        const samples: ArchSectionSample[] = [];
        for (const slot of row) if (slot) samples.push(slot);
        samples.sort((a, b) => a.m - b.m);
        return measureArchSection(samples);
    });

    const sectionAt = (u: number): ArchSection | null => {
        const x = (u - u0) / du - 0.5;
        const i0 = Math.floor(x);
        const t = x - i0;
        const a = sections[Math.min(MESH_U_BINS - 1, Math.max(0, i0))] ?? null;
        const b = sections[Math.min(MESH_U_BINS - 1, Math.max(0, i0 + 1))] ?? null;
        if (a && b) return lerpSection(a, b, t);
        return a ?? b;
    };

    const { apexMoveMm, archElongationMm, archProfile } = args.corrections;
    for (let i = 0; i < count; i++) {
        if (!isTop(i)) continue;
        const u = uOf(i);
        const envelope = archProfileEnvelope(u, apexMoveMm, args.lengthMm, archElongationMm);
        if (envelope === 0) continue;
        const section = sectionAt(u);
        if (!section) continue;
        const z = args.positions[i * 3 + args.thickAxis]!;
        const delta = archProfileDeltaMm(mOf(i), z, archProfile, section, envelope);
        if (delta !== 0) args.positions[i * 3 + args.thickAxis] = z + delta;
    }
}
