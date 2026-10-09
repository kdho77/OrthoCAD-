// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { smoothstep } from "@/lib/geometry/height-field";

/**
 * Biomechanics Expert bounds for the parametric wall (S1).
 *
 * Rule: keep the value measured from Default.glb wherever it falls inside the
 * bound, otherwise clamp to the bound. CAD owns region-boundary placement;
 * flare is C1-blended so there is never a step between regions.
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

export interface BoundSpec {
    /** Biomechanics recommended default (used only when there is no measurement). */
    recommended: number;
    min: number;
    max: number;
    step?: number;
}

export const FLARE_BOUNDS: Record<Exclude<FlareRegionId, "forefoot">, BoundSpec> = {
    heelPosterior: { recommended: 10, min: 5, max: 15 },
    heelMedial: { recommended: 8, min: 5, max: 15 },
    heelLateral: { recommended: 8, min: 5, max: 15 },
    medialArch: { recommended: 20, min: 10, max: 30 },
    lateralMidfoot: { recommended: 12, min: 5, max: 20 },
};

export const FILLET_BOUNDS = {
    topRimMm: { recommended: 2.0, min: 1, max: 3 } satisfies BoundSpec,
    bottomJoinMm: { recommended: 3.0, min: 2, max: 5 } satisfies BoundSpec,
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

export interface WallRegionDefaults {
    flareDeg: Record<Exclude<FlareRegionId, "forefoot">, number>;
    wallFilletTopMm: number;
    wallFilletBottomMm: number;
    cupBowlFactor: number;
    lateralFlangeHeightMm: number;
    lateralFlangeLengthMm: number;
    lateralFlangeAngleDeg: number;
    report: MeasuredVsBoundRow[];
}

export function clampToBound(measured: number | null, spec: BoundSpec): { value: number; clamped: boolean } {
    if (measured == null || !Number.isFinite(measured)) {
        return { value: spec.recommended, clamped: false };
    }
    if (measured < spec.min) return { value: spec.min, clamped: true };
    if (measured > spec.max) return { value: spec.max, clamped: true };
    return { value: measured, clamped: false };
}

function row(
    region: string,
    measured: number | null,
    spec: BoundSpec,
    unit: "deg" | "mm",
): MeasuredVsBoundRow {
    const { value, clamped } = clampToBound(measured, spec);
    return {
        region,
        measured: measured == null || !Number.isFinite(measured) ? null : measured,
        boundMin: spec.min,
        boundMax: spec.max,
        recommended: spec.recommended,
        applied: value,
        clamped,
        unit,
    };
}

export interface RegionMeasurements {
    flareDeg: Partial<Record<Exclude<FlareRegionId, "forefoot">, number>>;
    filletTopMm?: number;
    filletBottomMm?: number;
    cupBowlFactor?: number;
}

/**
 * Keep Default.glb measurements inside the biomechanics bounds; otherwise clamp.
 * Functional preset = those clamped values. Accommodative overlays heel flare +5,
 * medial arch 25, top fillet 3.0.
 */
export function resolveWallDefaults(
    measured: RegionMeasurements,
    preset: DeviceTypePreset = "functional",
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
    const topF = row("top rim fillet", measured.filletTopMm ?? null, FILLET_BOUNDS.topRimMm, "mm");
    const botF = row("bottom join fillet", measured.filletBottomMm ?? null, FILLET_BOUNDS.bottomJoinMm, "mm");

    const flareDeg = {
        heelPosterior: heelP.applied,
        heelMedial: heelM.applied,
        heelLateral: heelL.applied,
        medialArch: arch.applied,
        lateralMidfoot: mid.applied,
    };
    let wallFilletTopMm = topF.applied;
    const wallFilletBottomMm = botF.applied;
    const cupBowlFactor = Math.max(
        CUP_BOWL.radiusMinFactor,
        Math.min(CUP_BOWL.radiusMaxFactor, measured.cupBowlFactor ?? 0.5),
    );

    const report = [heelP, heelM, heelL, arch, mid, topF, botF];

    if (preset === "accommodative") {
        flareDeg.heelPosterior += 5;
        flareDeg.heelMedial += 5;
        flareDeg.heelLateral += 5;
        flareDeg.medialArch = 25;
        wallFilletTopMm = 3.0;
        report.push({
            region: "accommodative overlay",
            measured: null,
            boundMin: 0,
            boundMax: 0,
            recommended: 0,
            applied: 1,
            clamped: false,
            unit: "deg",
        });
    }

    return {
        flareDeg,
        wallFilletTopMm,
        wallFilletBottomMm,
        cupBowlFactor,
        lateralFlangeHeightMm: LATERAL_FLANGE_BOUNDS.heightMm.recommended,
        lateralFlangeLengthMm: LATERAL_FLANGE_BOUNDS.lengthMm.recommended,
        lateralFlangeAngleDeg: LATERAL_FLANGE_BOUNDS.angleDeg.recommended,
        report,
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
    const w = regionWeights(u, y);
    const num =
        w.heelPosterior * flare.heelPosterior +
        w.heelMedial * flare.heelMedial +
        w.heelLateral * flare.heelLateral +
        w.medialArch * flare.medialArch +
        w.lateralMidfoot * flare.lateralMidfoot;
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
