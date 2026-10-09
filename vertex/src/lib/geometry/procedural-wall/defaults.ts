// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { smoothstep } from "@/lib/geometry/height-field";

/**
 * Biomechanics Expert bounds for the parametric wall (S1).
 *
 * Parity wins: flare defaults ARE the measured stock values. Bounds are
 * widened for later UI, but measured flare is never clamped. CAD owns
 * region-boundary placement; flare is C1-blended so there is never a step
 * between regions.
 *
 * All of this is viewer-only behind `wallModel: 'procedural'`.
 */

export type FlareRegionId =
    | "heelPosterior"
    | "heelMedial"
    | "heelLateral"
    | "medialArch"
    | "lateralMidfoot"
    | "forefoot";

export type DeviceTypePreset = "functional" | "accommodative";

export type FlareProfileKind = "curved" | "kink" | "linear";

export interface BoundSpec {
    /** Biomechanics / stock recommended default (used only when there is no measurement). */
    recommended: number;
    min: number;
    max: number;
    step?: number;
}

export const FLARE_BOUNDS: Record<Exclude<FlareRegionId, "forefoot">, BoundSpec> = {
    heelPosterior: { recommended: 23.9, min: 10, max: 35 },
    heelMedial: { recommended: 27.7, min: 10, max: 35 },
    heelLateral: { recommended: 27.8, min: 10, max: 35 },
    medialArch: { recommended: 23.0, min: 10, max: 35 },
    lateralMidfoot: { recommended: 41.0, min: 15, max: 50 },
};

export const FILLET_BOUNDS = {
    topRimMm: { recommended: 0.5, min: 0, max: 3 } satisfies BoundSpec,
    bottomJoinMm: { recommended: 0, min: 0, max: 5 } satisfies BoundSpec,
    /** Top fillet must not lower cup height by more than this (measure after fillet). */
    maxCupHeightDropMm: 0.5,
} as const;

export const CUP_BOWL = {
    /** Floor-to-wall radius as a factor of cup height. */
    radiusMinFactor: 0.5,
    radiusMaxFactor: 0.75,
    maxVerticalSegmentMm: 3,
    gateHeightsMm: [12, 15, 18] as const,
} as const;

export const LATERAL_FLANGE_BOUNDS = {
    heightMm: { recommended: 0, min: 0, max: 10, step: 1 } satisfies BoundSpec,
    lengthMm: { recommended: 40, min: 20, max: 80, step: 5 } satisfies BoundSpec,
    angleDeg: { recommended: 10, min: 0, max: 25 } satisfies BoundSpec,
} as const;

export interface MeasuredVsBoundRow {
    region: string;
    measured: number | null;
    boundMin: number;
    boundMax: number;
    recommended: number;
    applied: number;
    clamped: boolean;
    unit: "deg" | "mm";
}

export interface FlareRegionDiagnostic {
    region: Exclude<FlareRegionId, "forefoot">;
    lowerThirdDeg: number | null;
    upperThirdDeg: number | null;
    kind: FlareProfileKind;
    curvature: number;
}

export interface WallRegionDefaults {
    flareDeg: Record<Exclude<FlareRegionId, "forefoot">, number>;
    flareCurvature: Record<Exclude<FlareRegionId, "forefoot">, number>;
    wallFilletTopMm: number;
    wallFilletBottomMm: number;
    cupBowlFactor: number;
    lateralFlangeHeightMm: number;
    lateralFlangeLengthMm: number;
    lateralFlangeAngleDeg: number;
    report: MeasuredVsBoundRow[];
    flareDiagnostics: FlareRegionDiagnostic[];
}

export function clampToBound(measured: number | null, spec: BoundSpec): { value: number; clamped: boolean } {
    if (measured == null || !Number.isFinite(measured)) {
        return { value: spec.recommended, clamped: false };
    }
    if (measured < spec.min) return { value: spec.min, clamped: true };
    if (measured > spec.max) return { value: spec.max, clamped: true };
    return { value: measured, clamped: false };
}

/** Apply the measured value even when it sits outside the (widened) bound. */
export function applyMeasuredUnclamped(
    measured: number | null,
    spec: BoundSpec,
): { value: number; clamped: boolean } {
    if (measured == null || !Number.isFinite(measured)) {
        return { value: spec.recommended, clamped: false };
    }
    return { value: measured, clamped: measured < spec.min || measured > spec.max };
}

function row(
    region: string,
    measured: number | null,
    spec: BoundSpec,
    unit: "deg" | "mm",
    mode: "measure" | "recommended" = "measure",
): MeasuredVsBoundRow {
    const finite = measured != null && Number.isFinite(measured) ? measured : null;
    const applied = mode === "recommended" ? spec.recommended : applyMeasuredUnclamped(finite, spec).value;
    const clamped = finite != null && (finite < spec.min || finite > spec.max);
    return {
        region,
        measured: finite,
        boundMin: spec.min,
        boundMax: spec.max,
        recommended: spec.recommended,
        applied,
        clamped,
        unit,
    };
}

export interface RegionMeasurements {
    flareDeg: Partial<Record<Exclude<FlareRegionId, "forefoot">, number>>;
    filletTopMm?: number;
    filletBottomMm?: number;
    cupBowlFactor?: number;
    flareDiagnostics?: FlareRegionDiagnostic[];
}

const ZERO_CURVATURE: WallRegionDefaults["flareCurvature"] = {
    heelPosterior: 0,
    heelMedial: 0,
    heelLateral: 0,
    medialArch: 0,
    lateralMidfoot: 0,
};

/**
 * Stock-measured flare (unclamped) with widened bounds for later UI.
 * Top rim fillet defaults to 0.5 mm; bottom join stays at the stock value (~0).
 * Functional and accommodative share the same stock defaults (no +5/25 overlay).
 */
export function resolveWallDefaults(
    measured: RegionMeasurements,
    _preset: DeviceTypePreset = "functional",
): WallRegionDefaults {
    const heelP = row(
        "heel posterior flare",
        measured.flareDeg.heelPosterior ?? null,
        FLARE_BOUNDS.heelPosterior,
        "deg",
    );
    const heelM = row(
        "heel medial flare",
        measured.flareDeg.heelMedial ?? null,
        FLARE_BOUNDS.heelMedial,
        "deg",
    );
    const heelL = row(
        "heel lateral flare",
        measured.flareDeg.heelLateral ?? null,
        FLARE_BOUNDS.heelLateral,
        "deg",
    );
    const arch = row(
        "medial arch flare",
        measured.flareDeg.medialArch ?? null,
        FLARE_BOUNDS.medialArch,
        "deg",
    );
    const mid = row(
        "lateral midfoot flare",
        measured.flareDeg.lateralMidfoot ?? null,
        FLARE_BOUNDS.lateralMidfoot,
        "deg",
    );
    const topF = row(
        "top rim fillet",
        measured.filletTopMm ?? null,
        FILLET_BOUNDS.topRimMm,
        "mm",
        "recommended",
    );
    const botF = row("bottom join fillet", measured.filletBottomMm ?? null, FILLET_BOUNDS.bottomJoinMm, "mm");

    const flareDeg = {
        heelPosterior: heelP.applied,
        heelMedial: heelM.applied,
        heelLateral: heelL.applied,
        medialArch: arch.applied,
        lateralMidfoot: mid.applied,
    };
    const flareDiagnostics = measured.flareDiagnostics ?? [];
    const flareCurvature = { ...ZERO_CURVATURE };
    for (const d of flareDiagnostics) {
        flareCurvature[d.region] = d.kind === "curved" ? d.curvature : 0;
    }

    const wallFilletTopMm = topF.applied;
    const wallFilletBottomMm = botF.applied;
    const cupBowlFactor = Math.max(
        CUP_BOWL.radiusMinFactor,
        Math.min(CUP_BOWL.radiusMaxFactor, measured.cupBowlFactor ?? 0.5),
    );

    const report = [heelP, heelM, heelL, arch, mid, topF, botF];

    return {
        flareDeg,
        flareCurvature,
        wallFilletTopMm,
        wallFilletBottomMm,
        cupBowlFactor,
        lateralFlangeHeightMm: LATERAL_FLANGE_BOUNDS.heightMm.recommended,
        lateralFlangeLengthMm: LATERAL_FLANGE_BOUNDS.lengthMm.recommended,
        lateralFlangeAngleDeg: LATERAL_FLANGE_BOUNDS.angleDeg.recommended,
        report,
        flareDiagnostics,
    };
}

/**
 * Smooth region weights at a planform station. +Y is medial after
 * `reorientToFootprintFrame`. Forefoot is a wall-height taper, not a flare step.
 *
 * CAD-owned boundaries (u along length, heel = 0):
 *   posterior heel  u < 0.10
 *   heel cup        u < 0.22
 *   arch / midfoot  0.22 … 0.60
 *   forefoot        u > 0.62 (height → 0)
 */
export function regionWeights(u: number, y: number): Record<FlareRegionId, number> {
    const uu = Math.max(0, Math.min(1, u));
    const heel = 1 - smoothstep(0.16, 0.26, uu);
    const posterior = (1 - smoothstep(0.06, 0.14, uu)) * heel;
    const heelSide = heel * (1 - posterior);
    const mid = (1 - heel) * (1 - smoothstep(0.56, 0.68, uu));
    const fore = smoothstep(0.56, 0.68, uu);
    const medial = smoothstep(-4, 4, y);
    const lateral = 1 - medial;
    return {
        heelPosterior: posterior,
        heelMedial: heelSide * medial,
        heelLateral: heelSide * lateral,
        medialArch: mid * medial,
        lateralMidfoot: mid * lateral,
        forefoot: fore,
    };
}

/** C1-blended flare (deg from vertical). Forefoot does not contribute a flare step. */
export function blendedFlareDeg(u: number, y: number, flare: WallRegionDefaults["flareDeg"]): number {
    return blendRegionScalar(u, y, flare);
}

/** C1-blended flare-curvature (0 = linear chord, >0 = stock bowl). */
export function blendedFlareCurvature(
    u: number,
    y: number,
    curvature: WallRegionDefaults["flareCurvature"],
): number {
    return blendRegionScalar(u, y, curvature);
}

function blendRegionScalar(
    u: number,
    y: number,
    values: Record<Exclude<FlareRegionId, "forefoot">, number>,
): number {
    const w = regionWeights(u, y);
    const num =
        w.heelPosterior * values.heelPosterior +
        w.heelMedial * values.heelMedial +
        w.heelLateral * values.heelLateral +
        w.medialArch * values.medialArch +
        w.lateralMidfoot * values.lateralMidfoot;
    const den = w.heelPosterior + w.heelMedial + w.heelLateral + w.medialArch + w.lateralMidfoot;
    if (den < 1e-9) return 0;
    return num / den;
}

/** 1 at the heel/midfoot, 0 at the toe — wall height tapers to the trim edge. */
export function wallHeightScale(u: number): number {
    return 1 - smoothstep(0.56, 0.78, Math.max(0, Math.min(1, u)));
}

/** Heel-bowl mix: 1 on the posterior cup, 0 by the arch. */
export function heelBowlMix(u: number): number {
    return 1 - smoothstep(0.14, 0.28, Math.max(0, Math.min(1, u)));
}

/**
 * Additive lateral flange envelope in [0, 1]. Height 0 must be an identity
 * (caller skips the offset). No posterior flange.
 */
export function lateralFlangeEnvelope(u: number, y: number, lengthMm: number, footLengthMm: number): number {
    if (y >= 0) return 0;
    const half = Math.max(20, Math.min(80, lengthMm)) / Math.max(footLengthMm, 1) / 2;
    const center = 0.22;
    const t = 1 - smoothstep(0, half, Math.abs(u - center));
    const lat = 1 - smoothstep(-2, 6, y);
    return t * lat;
}

export function snapToStep(value: number, spec: BoundSpec): number {
    const stepped = spec.step ? Math.round(value / spec.step) * spec.step : value;
    return Math.max(spec.min, Math.min(spec.max, stepped));
}
