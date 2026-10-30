// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { z } from "zod";
import { hardnessRegionSchema, migrateHardnessZones } from "./hardness-region.js";
import { HARDNESS_TO_INFILL_PCT as hardnessTable } from "./hardness-to-infill-pct.js";

/** Locked clinical hardness ladder — same five names as region modifiers. */
export const HARDNESS_NAMES = ["Extra Soft", "Soft", "Medium", "Hard", "Extra Hard"] as const;

export type HardnessName = (typeof HARDNESS_NAMES)[number];

/** Pending coupon validation. Extra Soft/Soft are 0.7 mm starting points. */
export type GyroidInfillPct = 10 | 14 | 16 | 20 | 22 | 26 | 32 | 38;

export const HARDNESS_TO_INFILL_PCT: Record<HardnessName, number> = hardnessTable as Record<
    HardnessName,
    number
>;

const gyroidPctSchema = z.number().int().min(5).max(100);

const hardnessNameSchema = z.enum(HARDNESS_NAMES);

/** Phase A production default — belt TPU profile (Track 0 migration target). */
export const DEFAULT_PRODUCTION_PROFILE_ID = "apex-belt-v2";

export const printRecipeV1Schema = z.object({
    version: z.literal(1),
    pattern: z.literal("gyroid"),
    /** Locked printer/material profile (Phase A: existing PRINTER_PRESETS id). */
    profileId: z.string().min(1),
    defaultHardness: hardnessNameSchema,
    /** Phase B material zones — kind "zone" | "element" | "freehand" hardness regions. */
    zones: z.array(hardnessRegionSchema).default([]),
    hardnessToInfillPct: z.record(hardnessNameSchema, gyroidPctSchema).optional(),
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
    table: Partial<Record<HardnessName, number>> | undefined = HARDNESS_TO_INFILL_PCT,
): number {
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
    zones: z.array(z.unknown()).default([]),
    hardnessToInfillPct: z.record(hardnessNameSchema, gyroidPctSchema).optional(),
});

export function migratePrintRecipe(recipe: PrintRecipeV1 | undefined | null): PrintRecipeV1 {
    if (!recipe) {
        return { ...DEFAULT_PRINT_RECIPE_V1, zones: [] };
    }
    const withZones = {
        ...recipe,
        zones: migrateHardnessZones((recipe as { zones?: unknown }).zones),
    };
    const parsed = printRecipeV1Schema.safeParse(withZones);
    if (parsed.success) {
        return parsed.data;
    }
    const legacy = legacyPrintRecipeV1Schema.safeParse(recipe);
    if (legacy.success) {
        return {
            version: legacy.data.version,
            pattern: legacy.data.pattern,
            defaultHardness: legacy.data.defaultHardness,
            hardnessToInfillPct: legacy.data.hardnessToInfillPct,
            profileId: DEFAULT_PRODUCTION_PROFILE_ID,
            zones: migrateHardnessZones(legacy.data.zones),
        };
    }
    return { ...DEFAULT_PRINT_RECIPE_V1, zones: [] };
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
        zones: recipe.zones,
        hardness_to_infill_pct: recipe.hardnessToInfillPct ?? HARDNESS_TO_INFILL_PCT,
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
