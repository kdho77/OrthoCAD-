// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// TODO(#234): call classifyArchHeightMm and the Flexible apex shift from
// vertex/src/lib/clinical/arch-class.ts once feature/one-click-scan-rx-generation
// is on main. That branch is not merged. This adapter only writes the existing
// SideCorrections fields archHeightMm and apexMoveMm. It does not move vertices
// and it does not replace SAMPLE_Top.

import type { DesignState, SideCorrections } from "@/types";

export const ARCH_LOW_REVIEW_BELOW_MM = 18;
export const ARCH_STANDARD_MIN_MM = 23;
export const ARCH_STANDARD_MAX_MM = 26;
export const ARCH_LOW_DELTA_MM = -3.5;
export const ARCH_HIGH_DELTA_MM = 3;
/** Positive apexMoveMm moves the existing apex toward the toe. */
export const FLEXIBLE_APEX_ANTERIOR_MM = 4;

export type ArchBand = "low" | "standard" | "high";

export interface ArchClass {
    band: ArchBand;
    deltaMm: number;
    /** Under 18 mm is still Low, and it is flagged for review. */
    flagged: boolean;
}

export function classifyArchHeightMm(heightMm: number): ArchClass {
    if (heightMm < ARCH_STANDARD_MIN_MM) {
        return {
            band: "low",
            deltaMm: ARCH_LOW_DELTA_MM,
            flagged: heightMm < ARCH_LOW_REVIEW_BELOW_MM,
        };
    }
    if (heightMm <= ARCH_STANDARD_MAX_MM) {
        return { band: "standard", deltaMm: 0, flagged: false };
    }
    return { band: "high", deltaMm: ARCH_HIGH_DELTA_MM, flagged: false };
}

export interface ScanFootCorrection {
    side: "left" | "right";
    archHeightMm: number;
    flexible: boolean;
}

function withSide(design: DesignState, side: "left" | "right", correction: SideCorrections): DesignState {
    return {
        ...design,
        corrections: {
            ...design.corrections,
            [side]: correction,
        },
    };
}

/**
 * Apply the published One-Click band and Flexible shift onto the design that
 * already holds SAMPLE_Top. A Standard foot with Flexible off is left untouched.
 */
export function applyScanCorrections(design: DesignState, feet: ScanFootCorrection[]): DesignState {
    let next = design;
    for (const foot of feet) {
        const band = classifyArchHeightMm(foot.archHeightMm);
        const apexMoveMm = foot.flexible ? FLEXIBLE_APEX_ANTERIOR_MM : 0;
        if (band.deltaMm === 0 && apexMoveMm === 0) continue;
        const current = next.corrections[foot.side];
        next = withSide(next, foot.side, {
            ...current,
            archHeightMm: band.deltaMm,
            apexMoveMm,
        });
    }
    return next;
}
