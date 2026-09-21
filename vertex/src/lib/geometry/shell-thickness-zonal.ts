// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MIN_SHELL_WALL_MM } from "@/lib/geometry/track4-shared";

/** Longitudinal zone boundaries (u ∈ [0, 1], heel = 0). */
export const SHELL_ZONE_RF_END_U = 0.28;
export const SHELL_ZONE_MF_END_U = 0.55;

export const DEFAULT_SHELL_THICKNESS_BLEND_MM = 12;

export const DEFAULT_SHELL_THICKNESS_RF_MM = 3.0;
export const DEFAULT_SHELL_THICKNESS_MF_MM = 2.5;
export const DEFAULT_SHELL_THICKNESS_FF_MM = 2.0;

export type ShellThicknessMode = "uniform" | "zonal";

export interface ShellThicknessZones {
    rfMm: number;
    mfMm: number;
    ffMm: number;
}

export interface ShellThicknessContext {
    mode: ShellThicknessMode;
    /** Uniform target (mm) when mode === uniform. */
    uniformMm: number;
    zonal: ShellThicknessZones;
    /** Half-width of smooth blends between zones (mm along length). */
    blendHalfMm: number;
    lengthMm: number;
}

export function defaultShellThicknessZones(): ShellThicknessZones {
    return {
        rfMm: DEFAULT_SHELL_THICKNESS_RF_MM,
        mfMm: DEFAULT_SHELL_THICKNESS_MF_MM,
        ffMm: DEFAULT_SHELL_THICKNESS_FF_MM,
    };
}

function smoothstep01(t: number): number {
    const c = Math.max(0, Math.min(1, t));
    return c * c * (3 - 2 * c);
}

/**
 * Piecewise zone cores with smoothstep blends. `blendHalfMm` is converted to Δu
 * via `lengthMm` so transitions are monotonic in u.
 */
export function zonalShellThicknessCoreAtU(u: number, zones: ShellThicknessZones): number {
    if (u <= SHELL_ZONE_RF_END_U) return zones.rfMm;
    if (u >= SHELL_ZONE_MF_END_U) return zones.ffMm;
    return zones.mfMm;
}

/** Full zonal thickness t(u) with blended transitions (mm). */
export function zonalShellThicknessAtU(u: number, ctx: ShellThicknessContext): number {
    const { zonal, blendHalfMm, lengthMm } = ctx;
    if (lengthMm <= 0) return zonalShellThicknessCoreAtU(u, zonal);

    const blendU = Math.max(1e-6, (2 * blendHalfMm) / lengthMm);
    const rf = zonal.rfMm;
    const mf = zonal.mfMm;
    const ff = zonal.ffMm;

    const b0 = SHELL_ZONE_RF_END_U;
    const b1 = SHELL_ZONE_MF_END_U;

    if (u <= b0 - blendU) return rf;
    if (u >= b1 + blendU) return ff;

    if (u < b0 + blendU) {
        const t = smoothstep01((u - (b0 - blendU)) / (2 * blendU));
        return rf + (mf - rf) * t;
    }
    if (u > b1 - blendU) {
        const t = smoothstep01((u - (b1 - blendU)) / (2 * blendU));
        return mf + (ff - mf) * t;
    }
    return mf;
}

export function shellThicknessMmAtU(u: number, ctx: ShellThicknessContext): number {
    const raw = ctx.mode === "uniform" ? ctx.uniformMm : zonalShellThicknessAtU(u, ctx);
    return Math.max(MIN_SHELL_WALL_MM, raw);
}

export function shellThicknessContextFromDesign(
    mode: ShellThicknessMode | undefined,
    uniformMm: number,
    lengthMm: number,
    zones?: Partial<ShellThicknessZones>,
    blendHalfMm?: number,
): ShellThicknessContext {
    const z = { ...defaultShellThicknessZones(), ...zones };
    return {
        // Undefined ⇒ uniform (legacy designs); new designs set zonal explicitly.
        mode: mode ?? "uniform",
        uniformMm,
        zonal: z,
        blendHalfMm: blendHalfMm ?? DEFAULT_SHELL_THICKNESS_BLEND_MM,
        lengthMm,
    };
}

/** Neutral baseline for correction deltas (fixed reference thickness all zones). */
export function neutralShellThicknessContext(
    active: ShellThicknessContext,
    referenceUniformMm: number,
): ShellThicknessContext {
    const ref = Math.max(MIN_SHELL_WALL_MM, referenceUniformMm);
    return {
        mode: active.mode,
        uniformMm: ref,
        zonal: { rfMm: ref, mfMm: ref, ffMm: ref },
        blendHalfMm: active.blendHalfMm,
        lengthMm: active.lengthMm,
    };
}
