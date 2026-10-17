// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import tableJson from "./hardness-class-table.json";

/**
 * Region hardness classes (Phase 1 element/zone modifiers).
 * Distinct from the device-wide Extra Soft → Extra Hard PrintRecipe ladder.
 * Calibrate densities/speeds here — VertexSlice reads the exported per-volume copy.
 */
export const REGION_HARDNESS_CLASSES = ["Soft", "Medium", "Firm", "Rigid", "Custom"] as const;
export type RegionHardnessClass = (typeof REGION_HARDNESS_CLASSES)[number];

export const SPARSE_INFILL_PATTERN = "gyroid" as const;

export interface NamedClassSettings {
    sparseInfillDensityPct: number;
    sparseInfillPattern: typeof SPARSE_INFILL_PATTERN;
    sparseInfillSpeedMmS: number;
}

export interface CustomClassSettings {
    sparseInfillDensityPctMin: number;
    sparseInfillDensityPctMax: number;
    sparseInfillPattern: typeof SPARSE_INFILL_PATTERN;
}

export interface HardnessClassTable {
    Soft: NamedClassSettings;
    Medium: NamedClassSettings;
    Firm: NamedClassSettings;
    Rigid: NamedClassSettings;
    Custom: CustomClassSettings;
}

export const HARDNESS_CLASS_TABLE: HardnessClassTable = tableJson as HardnessClassTable;

/** Softest first — used for equal-priority tie breaks (softer wins). */
export const CLASS_SOFTNESS_RANK: Record<Exclude<RegionHardnessClass, "Custom">, number> = {
    Soft: 0,
    Medium: 1,
    Firm: 2,
    Rigid: 3,
};

export const CLASS_PREVIEW_COLORS: Record<RegionHardnessClass, string> = {
    Soft: "#7ec8e3",
    Medium: "#f4d35e",
    Firm: "#f18f01",
    Rigid: "#c73e1d",
    Custom: "#9b87f5",
};

export function namedClassSettings(cls: Exclude<RegionHardnessClass, "Custom">): NamedClassSettings {
    return HARDNESS_CLASS_TABLE[cls];
}

export function customDensityInRange(pct: number): boolean {
    const { sparseInfillDensityPctMin, sparseInfillDensityPctMax } = HARDNESS_CLASS_TABLE.Custom;
    return pct >= sparseInfillDensityPctMin && pct <= sparseInfillDensityPctMax;
}

export function classDensityPct(
    cls: RegionHardnessClass,
    overrides?: { sparseInfillDensityPct?: number },
): number {
    if (cls === "Custom") {
        const pct = overrides?.sparseInfillDensityPct;
        if (pct === undefined || !customDensityInRange(pct)) {
            throw new Error("Custom hardness requires overrides.sparseInfillDensityPct in 5–100%");
        }
        return pct;
    }
    if (overrides?.sparseInfillDensityPct !== undefined) {
        if (!customDensityInRange(overrides.sparseInfillDensityPct)) {
            throw new Error("sparseInfillDensityPct override must be in 5–100%");
        }
        return overrides.sparseInfillDensityPct;
    }
    return HARDNESS_CLASS_TABLE[cls].sparseInfillDensityPct;
}

export function classSpeedMmS(cls: RegionHardnessClass): number | undefined {
    if (cls === "Custom") return undefined;
    return HARDNESS_CLASS_TABLE[cls].sparseInfillSpeedMmS;
}

export function softnessKey(cls: RegionHardnessClass, densityPct: number): number {
    if (cls !== "Custom") return CLASS_SOFTNESS_RANK[cls];
    const marks = [
        HARDNESS_CLASS_TABLE.Soft.sparseInfillDensityPct,
        HARDNESS_CLASS_TABLE.Medium.sparseInfillDensityPct,
        HARDNESS_CLASS_TABLE.Firm.sparseInfillDensityPct,
        HARDNESS_CLASS_TABLE.Rigid.sparseInfillDensityPct,
    ];
    if (densityPct <= marks[0]!) return densityPct / marks[0]! - 1;
    for (let i = 0; i < marks.length - 1; i++) {
        const lo = marks[i]!;
        const hi = marks[i + 1]!;
        if (densityPct <= hi) return i + (densityPct - lo) / (hi - lo);
    }
    const rigid = marks[3]!;
    return 3 + (densityPct - rigid) / Math.max(1, 100 - rigid);
}
