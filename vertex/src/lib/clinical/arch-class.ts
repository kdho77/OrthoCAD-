// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";

/**
 * Kendon's one-click arch bands. Measured arch height is an absolute mm
 * value from the scan, not a gap against SAMPLE_Top.
 *
 * Boundaries are exact: 23 and 26 are Standard. Below 23 is Low.
 * Below 18 is still Low and is flagged for review. Above 26 is High.
 */

export const ARCH_LOW_REVIEW_BELOW_MM = 18;
export const ARCH_STANDARD_MIN_MM = 23;
export const ARCH_STANDARD_MAX_MM = 26;

/** Added to the default arch (archHeightMm 0) for a Low foot. */
export const ARCH_LOW_DELTA_MM = -3.5;
/** Added to the default arch for a High foot. Standard applies 0. */
export const ARCH_HIGH_DELTA_MM = 3;
/** Flexible foot: move the existing apex parameter this far toward the toe. */
export const FLEXIBLE_APEX_ANTERIOR_MM = 4;

/**
 * Flexible apex plus a manual Corrections / Rx apex.
 * Additive on purpose (Founder confirmation still pending — change only this function).
 * Clamped to the existing apex control range.
 */
export function combineFlexibleApex(
    manualApexMm: number,
    flexible: boolean,
): { apexMoveMm: number; clamped: boolean } {
    const manual = Number.isFinite(manualApexMm) ? manualApexMm : 0;
    const requested = manual + (flexible ? FLEXIBLE_APEX_ANTERIOR_MM : 0);
    const { min, max } = CLINICAL_LIMITS.apexMoveMm;
    const apexMoveMm = Math.min(max, Math.max(min, requested));
    return { apexMoveMm, clamped: apexMoveMm !== requested };
}

export type ArchBand = "low" | "standard" | "high";

export type ArchClassification = {
    band: ArchBand;
    /** True when the measurement is below 18 mm. The band is still Low. */
    reviewBelow18: boolean;
    /** Parametric archHeightMm relative to the default mesh. */
    archHeightMm: number;
};

export function classifyArchHeightMm(heightMm: number): ArchClassification {
    if (!Number.isFinite(heightMm)) {
        throw new Error("Arch height measurement is not a finite number");
    }
    if (heightMm < ARCH_STANDARD_MIN_MM) {
        return {
            band: "low",
            reviewBelow18: heightMm < ARCH_LOW_REVIEW_BELOW_MM,
            archHeightMm: ARCH_LOW_DELTA_MM,
        };
    }
    if (heightMm <= ARCH_STANDARD_MAX_MM) {
        return { band: "standard", reviewBelow18: false, archHeightMm: 0 };
    }
    return { band: "high", reviewBelow18: false, archHeightMm: ARCH_HIGH_DELTA_MM };
}
