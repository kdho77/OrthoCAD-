// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { z } from "zod";
import { applyAutoLesionTagsToRecipe, type ElementFootprintInput } from "./accommodative-auto-tags";
import hardnessTable from "./hardness-to-infill-pct.json";

/** Locked clinical hardness ladder (Biomechanics 2026-09-20). */
export const HARDNESS_NAMES = ["Extra Soft", "Soft", "Medium", "Hard", "Extra Hard"] as const;

export type HardnessName = (typeof HARDNESS_NAMES)[number];

export type GyroidInfillPct = 14 | 20 | 26 | 32 | 38;

export const HARDNESS_TO_INFILL_PCT: Record<HardnessName, GyroidInfillPct> = hardnessTable as Record<
    HardnessName,
    GyroidInfillPct
>;

export const LESION_TAGS = ["accommodative", "highRisk"] as const;
export type LesionTag = (typeof LESION_TAGS)[number];

const gyroidPctSchema = z.union([z.literal(14), z.literal(20), z.literal(26), z.literal(32), z.literal(38)]);

const hardnessNameSchema = z.enum(HARDNESS_NAMES);

/** Phase A production default — belt TPU profile (Track 0 migration target). */
export const DEFAULT_PRODUCTION_PROFILE_ID = "apex-belt-v2";

export const soleUvPointSchema = z.object({
    u: z.number().min(0).max(1),
    v: z.number().min(-1).max(1),
});

export type SoleUvPoint = z.infer<typeof soleUvPointSchema>;

export const materialZoneV1Schema = z.object({
    zoneId: z.string().min(1),
    anatomicLabel: z.string().min(1),
    hardnessName: hardnessNameSchema,
    boundarySoleUv: z.array(soleUvPointSchema).min(3),
    lesionTags: z.array(z.enum(LESION_TAGS)).optional(),
});

export type MaterialZoneV1 = z.infer<typeof materialZoneV1Schema>;

export const soleUvFrameSchema = z.object({
    minXMm: z.number(),
    minYMm: z.number(),
    lengthMm: z.number().positive(),
    widthMm: z.number().positive(),
});

export type SoleUvFrame = z.infer<typeof soleUvFrameSchema>;

/** A2 / manufacturing gates (w = 0.48 mm). */
export const ZONE_MIN_AREA_MM2 = 100;
export const ZONE_MIN_CORRIDOR_MM = 1.92;
export const ZONE_CORE_ERODE_W = 2;
export const ZONE_FILL_TOLERANCE_PP = 5;

export const printRecipeV1Schema = z.object({
    version: z.literal(1),
    pattern: z.literal("gyroid"),
    /** Locked printer/material profile (Phase A: existing PRINTER_PRESETS id). */
    profileId: z.string().min(1),
    defaultHardness: hardnessNameSchema,
    zones: z.array(materialZoneV1Schema),
    hardnessToInfillPct: z.record(hardnessNameSchema, gyroidPctSchema).optional(),
    overrideSoftWins: z.boolean().optional(),
    soleUvFrame: soleUvFrameSchema.optional(),
});

export type PrintRecipeV1 = z.infer<typeof printRecipeV1Schema>;

export const DEFAULT_PRINT_RECIPE_V1: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: DEFAULT_PRODUCTION_PROFILE_ID,
    defaultHardness: "Medium",
    zones: [],
};

/** Presets that require PrintRecipeV1 (reject legacy infill-only overrides). */
export const GYROID_MANUFACTURING_PRESET_IDS = new Set([
    "apex-belt-v2",
    "apex-belt-v2-shell",
    "desktop-fdm",
    "apex-belt-v2-45",
    "layerloop-30",
]);

export function isGyroidManufacturingPreset(presetId: string): boolean {
    return GYROID_MANUFACTURING_PRESET_IDS.has(presetId);
}

export function gyroidInfillPctForHardness(
    hardness: HardnessName,
    table: Partial<Record<HardnessName, GyroidInfillPct>> | undefined = HARDNESS_TO_INFILL_PCT,
): GyroidInfillPct {
    const pct = table?.[hardness] ?? HARDNESS_TO_INFILL_PCT[hardness];
    return pct;
}

/** Volume fraction 0..1 for slicer APIs that use scalar density. */
export function infillFractionFromRecipe(recipe: PrintRecipeV1): number {
    const pct = gyroidInfillPctForHardness(recipe.defaultHardness, recipe.hardnessToInfillPct);
    return pct / 100;
}

/** Legacy PrintRecipeV1 payloads saved before profile lock (no profileId). */
const legacyPrintRecipeV1Schema = z.object({
    version: z.literal(1),
    pattern: z.literal("gyroid"),
    defaultHardness: hardnessNameSchema,
    zones: z.tuple([]),
    hardnessToInfillPct: z.record(hardnessNameSchema, gyroidPctSchema).optional(),
});

export function migratePrintRecipe(recipe: PrintRecipeV1 | undefined | null): PrintRecipeV1 {
    if (!recipe) {
        return { ...DEFAULT_PRINT_RECIPE_V1 };
    }
    const parsed = printRecipeV1Schema.safeParse(recipe);
    if (parsed.success) {
        return parsed.data;
    }
    const legacy = legacyPrintRecipeV1Schema.safeParse(recipe);
    if (legacy.success) {
        return {
            ...legacy.data,
            profileId: DEFAULT_PRODUCTION_PROFILE_ID,
        };
    }
    return { ...DEFAULT_PRINT_RECIPE_V1 };
}

export class PrintRecipeProfileRequiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PrintRecipeProfileRequiredError";
    }
}

/**
 * Gyroid / parity manufacturing requires an explicit PrintRecipe with profileId.
 * Legacy designs are upgraded via migratePrintRecipe when profileId was omitted on save.
 */
export function resolveGyroidManufacturingPrintRecipe(
    presetId: string,
    printRecipeInput: PrintRecipeV1 | undefined,
): PrintRecipeV1 {
    if (!isGyroidManufacturingPreset(presetId)) {
        throw new PrintRecipeProfileRequiredError(
            "resolveGyroidManufacturingPrintRecipe called for non-gyroid preset",
        );
    }
    if (!printRecipeInput) {
        throw new PrintRecipeProfileRequiredError(
            "Production gyroid manufacturing requires PrintRecipeV1 with profileId (locked printer preset).",
        );
    }
    const recipe = migratePrintRecipe(printRecipeInput);
    if (!recipe.profileId?.trim()) {
        throw new PrintRecipeProfileRequiredError(
            "PrintRecipeV1.profileId is required for gyroid manufacturing.",
        );
    }
    return recipe;
}

/** Snake_case payload for Python `/manufacture`. */
export function printRecipeToSnake(recipe: PrintRecipeV1): Record<string, unknown> {
    return {
        version: recipe.version,
        pattern: recipe.pattern,
        profile_id: recipe.profileId,
        default_hardness: recipe.defaultHardness,
        zones: recipe.zones.map((z) => ({
            zone_id: z.zoneId,
            anatomic_label: z.anatomicLabel,
            hardness_name: z.hardnessName,
            boundary_sole_uv: z.boundarySoleUv,
            lesion_tags: z.lesionTags ?? [],
        })),
        hardness_to_infill_pct: recipe.hardnessToInfillPct ?? HARDNESS_TO_INFILL_PCT,
        override_soft_wins: recipe.overrideSoftWins ?? false,
        sole_uv_frame: recipe.soleUvFrame
            ? {
                  min_x_mm: recipe.soleUvFrame.minXMm,
                  min_y_mm: recipe.soleUvFrame.minYMm,
                  length_mm: recipe.soleUvFrame.lengthMm,
                  width_mm: recipe.soleUvFrame.widthMm,
              }
            : undefined,
    };
}

export function attachSoleUvFrameToRecipe(
    recipe: PrintRecipeV1,
    lengthMm: number,
    widthMm: number,
): PrintRecipeV1 {
    if (!recipe.zones.length) {
        return recipe;
    }
    if (recipe.soleUvFrame) {
        return recipe;
    }
    return {
        ...recipe,
        soleUvFrame: {
            minXMm: 0,
            minYMm: -widthMm / 2,
            lengthMm,
            widthMm,
        },
    };
}

/** Bind hardness + gyroid ladder to a locked production profile (preset id). */
export function bindPrintRecipeProfile(
    recipe: PrintRecipeV1 | undefined | null,
    profileId: string,
    hardness?: HardnessName,
): PrintRecipeV1 {
    const base = migratePrintRecipe(recipe);
    return {
        ...base,
        profileId,
        defaultHardness: hardness ?? base.defaultHardness,
    };
}

/** Sole frame + biomechanical auto lesion tags before hybrid manufacture. */
export function preparePrintRecipeForManufacturing(
    recipeInput: PrintRecipeV1 | undefined | null,
    elements: ElementFootprintInput[],
    lengthMm: number,
    widthMm: number,
): PrintRecipeV1 {
    const framed = attachSoleUvFrameToRecipe(migratePrintRecipe(recipeInput), lengthMm, widthMm);
    return applyAutoLesionTagsToRecipe(framed, elements, lengthMm, widthMm);
}
