// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Single hardness table for device-wide PrintRecipe and per-region modifiers.
 * Five named levels (Extra Soft → Extra Hard) plus Custom density overrides.
 *
 * Slicing (Kendon 2026-10, 10 mm coupon validated):
 * - Extra Soft / Soft: 15% / 21% gyroid at 0.7 mm (material default infill speed)
 * - Medium: 26% gyroid at 1.0 mm (material default infill speed)
 * - Hard / Extra Hard: 26% / 30% gyroid at 1.2 mm, sparse_infill_speed 23 mm/s
 * - infill_wall_overlap 25% every class (~0.25 mm into the 1.0 mm global wall)
 * - Walls and skins stay global at 1.0 mm
 *
 * Keep values in lockstep with hardness-class-table.json (calibration / Python).
 * This is a .ts module so the Vercel Node ESM function can import it without
 * `with { type: "json" }` (ERR_IMPORT_ATTRIBUTE_MISSING).
 */
export const NAMED_HARDNESS_CLASSES = ["Extra Soft", "Soft", "Medium", "Hard", "Extra Hard"] as const;
export type NamedHardnessClass = (typeof NAMED_HARDNESS_CLASSES)[number];

export const REGION_HARDNESS_CLASSES = [...NAMED_HARDNESS_CLASSES, "Custom"] as const;
export type RegionHardnessClass = (typeof REGION_HARDNESS_CLASSES)[number];

export const SPARSE_INFILL_PATTERN = "gyroid" as const;

/** Global wall / skin extrusion width — not per-region. */
export const GLOBAL_WALL_LINE_WIDTH_MM = 1.0;
export const GLOBAL_SKIN_LINE_WIDTH_MM = 1.0;

/**
 * VertexSlice `infill_wall_overlap` is a percent of inner-wall spacing
 * (PerimeterGenerator.cpp; PrintConfig.cpp `ratio_over = inner_wall_line_width`).
 * 25% of the global 1.0 mm wall ≈ 0.25 mm into the inner wall.
 */
export const INFILL_WALL_OVERLAP_PCT = 25;
export const TARGET_ABSOLUTE_OVERLAP_MM = 0.25;

export interface NamedClassSettings {
    sparseInfillDensityPct: number;
    sparseInfillPattern: typeof SPARSE_INFILL_PATTERN;
    sparseInfillLineWidthMm: number;
    infillWallOverlapPct: typeof INFILL_WALL_OVERLAP_PCT;
    /** Only Hard / Extra Hard override TPU volumetric flow at 1.2 mm. */
    sparseInfillSpeedMmS?: number;
}

export interface CustomClassSettings {
    sparseInfillDensityPctMin: number;
    sparseInfillDensityPctMax: number;
    sparseInfillPattern: typeof SPARSE_INFILL_PATTERN;
    sparseInfillLineWidthMm: number;
    infillWallOverlapPct: typeof INFILL_WALL_OVERLAP_PCT;
}

export interface HardnessClassTable {
    "Extra Soft": NamedClassSettings;
    Soft: NamedClassSettings;
    Medium: NamedClassSettings;
    Hard: NamedClassSettings;
    "Extra Hard": NamedClassSettings;
    Custom: CustomClassSettings;
}

export const HARDNESS_CLASS_TABLE: HardnessClassTable = {
    "Extra Soft": {
        sparseInfillDensityPct: 15,
        sparseInfillPattern: "gyroid",
        sparseInfillLineWidthMm: 0.7,
        infillWallOverlapPct: 25,
    },
    Soft: {
        sparseInfillDensityPct: 21,
        sparseInfillPattern: "gyroid",
        sparseInfillLineWidthMm: 0.7,
        infillWallOverlapPct: 25,
    },
    Medium: {
        sparseInfillDensityPct: 26,
        sparseInfillPattern: "gyroid",
        sparseInfillLineWidthMm: 1.0,
        infillWallOverlapPct: 25,
    },
    Hard: {
        sparseInfillDensityPct: 26,
        sparseInfillPattern: "gyroid",
        sparseInfillSpeedMmS: 23.0,
        sparseInfillLineWidthMm: 1.2,
        infillWallOverlapPct: 25,
    },
    "Extra Hard": {
        sparseInfillDensityPct: 30,
        sparseInfillPattern: "gyroid",
        sparseInfillSpeedMmS: 23.0,
        sparseInfillLineWidthMm: 1.2,
        infillWallOverlapPct: 25,
    },
    Custom: {
        sparseInfillDensityPctMin: 5,
        sparseInfillDensityPctMax: 100,
        sparseInfillPattern: "gyroid",
        sparseInfillLineWidthMm: 1.0,
        infillWallOverlapPct: 25,
    },
};

/** Softest first — used for equal-priority tie breaks (softer wins). */
export const CLASS_SOFTNESS_RANK: Record<NamedHardnessClass, number> = {
    "Extra Soft": 0,
    Soft: 1,
    Medium: 2,
    Hard: 3,
    "Extra Hard": 4,
};

/** Distinct viewer / legend colors. Selected elements get a separate highlight. */
export const CLASS_PREVIEW_COLORS: Record<RegionHardnessClass, string> = {
    "Extra Soft": "#9be7c4",
    Soft: "#5dade2",
    Medium: "#7eb6ff",
    Hard: "#f4d35e",
    "Extra Hard": "#e07a5f",
    Custom: "#9b87f5",
};

export const CLASS_DISPLAY_NAMES: Record<RegionHardnessClass, string> = {
    "Extra Soft": "Extra soft",
    Soft: "Soft",
    Medium: "Medium",
    Hard: "Hard",
    "Extra Hard": "Extra hard",
    Custom: "Custom",
};

export const SELECTED_ELEMENT_HIGHLIGHT = "#3ddc84";

export function namedClassSettings(cls: NamedHardnessClass): NamedClassSettings {
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

export function classLineWidthMm(cls: RegionHardnessClass): number {
    if (cls === "Custom") return HARDNESS_CLASS_TABLE.Custom.sparseInfillLineWidthMm;
    return HARDNESS_CLASS_TABLE[cls].sparseInfillLineWidthMm;
}

export function classOverlapPct(cls: RegionHardnessClass): number {
    if (cls === "Custom") return HARDNESS_CLASS_TABLE.Custom.infillWallOverlapPct;
    return HARDNESS_CLASS_TABLE[cls].infillWallOverlapPct;
}

export interface ClassFingerprint {
    className: RegionHardnessClass;
    densityPct: number;
    pattern: typeof SPARSE_INFILL_PATTERN;
    speedMmS?: number;
    lineWidthMm: number;
    infillWallOverlapPct: number;
}

/** Density + pattern + line width + optional speed + overlap fingerprint used by G-code / 3MF verification. */
export function classFingerprint(
    cls: RegionHardnessClass,
    overrides?: { sparseInfillDensityPct?: number },
): ClassFingerprint {
    return {
        className: cls,
        densityPct:
            cls === "Custom"
                ? classDensityPct(cls, overrides)
                : HARDNESS_CLASS_TABLE[cls].sparseInfillDensityPct,
        pattern: SPARSE_INFILL_PATTERN,
        speedMmS: classSpeedMmS(cls),
        lineWidthMm: classLineWidthMm(cls),
        infillWallOverlapPct: classOverlapPct(cls),
    };
}

export function softnessKey(cls: RegionHardnessClass, densityPct: number): number {
    if (cls !== "Custom") return CLASS_SOFTNESS_RANK[cls];
    const marks = NAMED_HARDNESS_CLASSES.map((name) => HARDNESS_CLASS_TABLE[name].sparseInfillDensityPct);
    const first = marks[0] ?? 10;
    if (densityPct <= first) return densityPct / first - 1;
    for (let i = 0; i < marks.length - 1; i++) {
        const lo = marks[i] ?? first;
        const hi = marks[i + 1] ?? lo;
        if (densityPct <= hi) return i + (densityPct - lo) / Math.max(1e-6, hi - lo);
    }
    const last = marks[marks.length - 1] ?? 30;
    return marks.length - 1 + (densityPct - last) / Math.max(1, 100 - last);
}

/** Phase 1 Soft/Medium/Firm/Rigid and mashed Windows labels → the five-level table. */
export function migrateRegionHardnessClass(raw: unknown): RegionHardnessClass {
    if (typeof raw !== "string") return "Medium";
    const n = raw.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    if (n === "custom") return "Custom";
    if (n === "extra soft" || n === "extrasoft") return "Extra Soft";
    if (n === "extra hard" || n === "extrahard" || n === "rigid") return "Extra Hard";
    if (n === "soft") return "Soft";
    if (n === "medium") return "Medium";
    if (n === "hard" || n === "firm") return "Hard";
    if (n.includes("extra") && n.includes("soft")) return "Extra Soft";
    if (n.includes("extra") && n.includes("hard")) return "Extra Hard";
    if (n.includes("soft")) return "Soft";
    if (n.includes("rigid") || n.includes("post")) return "Extra Hard";
    if (n.includes("hard") || n.includes("firm")) return "Hard";
    return "Medium";
}
