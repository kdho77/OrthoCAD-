// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { z } from "zod";
import hardnessTable from "./hardness-to-infill-pct.json";
/** Locked clinical hardness ladder (Biomechanics 2026-09-20). */
export const HARDNESS_NAMES = ["Extra Soft", "Soft", "Medium", "Hard", "Extra Hard"] as const;

export type HardnessName = (typeof HARDNESS_NAMES)[number];

export type GyroidInfillPct = 14 | 20 | 26 | 32 | 38;

export const HARDNESS_TO_INFILL_PCT: Record<HardnessName, GyroidInfillPct> = hardnessTable as Record<
    HardnessName,
    GyroidInfillPct
>;

const gyroidPctSchema = z.union([z.literal(14), z.literal(20), z.literal(26), z.literal(32), z.literal(38)]);

const hardnessNameSchema = z.enum(HARDNESS_NAMES);

/** Phase A production default — belt TPU profile (Track 0 migration target). */
export const DEFAULT_PRODUCTION_PROFILE_ID = "apex-belt-v2";

export const printRecipeV1Schema = z.object({
    version: z.literal(1),
    pattern: z.literal("gyroid"),
    /** Locked printer/material profile (Phase A: existing PRINTER_PRESETS id). */
    profileId: z.string().min(1),
    defaultHardness: hardnessNameSchema,
    zones: z.tuple([]),
    hardnessToInfillPct: z.record(hardnessNameSchema, gyroidPctSchema).optional(),
    /** Belt release label in manufacturing output (default ON). */
    includeProductionLabel: z.boolean().optional(),
});

export type PrintRecipeV1 = z.infer<typeof printRecipeV1Schema>;

export const DEFAULT_PRINT_RECIPE_V1: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: DEFAULT_PRODUCTION_PROFILE_ID,
    defaultHardness: "Medium",
    zones: [],
    includeProductionLabel: true,
};

/** Recommended default for belt production release labels (Track 3a). */
export const DEFAULT_INCLUDE_PRODUCTION_LABEL = true;

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

function withLabelDefault(recipe: PrintRecipeV1): PrintRecipeV1 {
    return {
        ...recipe,
        includeProductionLabel: recipe.includeProductionLabel ?? true,
    };
}

/** Legacy PrintRecipeV1 payloads saved before profile lock (no profileId). */
const legacyPrintRecipeV1Schema = z.object({
    version: z.literal(1),
    pattern: z.literal("gyroid"),
    defaultHardness: hardnessNameSchema,
    zones: z.tuple([]),
    hardnessToInfillPct: z.record(hardnessNameSchema, gyroidPctSchema).optional(),
    includeProductionLabel: z.boolean().optional(),
});

export function migratePrintRecipe(recipe: PrintRecipeV1 | undefined | null): PrintRecipeV1 {
    if (!recipe) {
        return { ...DEFAULT_PRINT_RECIPE_V1 };
    }
    const parsed = printRecipeV1Schema.safeParse(recipe);
    if (parsed.success) {
        return withLabelDefault(parsed.data);
    }
    const legacy = legacyPrintRecipeV1Schema.safeParse(recipe);
    if (legacy.success) {
        return withLabelDefault({
            ...legacy.data,
            profileId: DEFAULT_PRODUCTION_PROFILE_ID,
        });
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
    const migrated = migratePrintRecipe(recipe);
    return {
        version: migrated.version,
        pattern: migrated.pattern,
        profile_id: migrated.profileId,
        default_hardness: migrated.defaultHardness,
        zones: migrated.zones,
        hardness_to_infill_pct: migrated.hardnessToInfillPct ?? HARDNESS_TO_INFILL_PCT,
        include_production_label: migrated.includeProductionLabel ?? true,
    };
}

/** Bind hardness + gyroid ladder to a locked production profile (preset id). */
export function bindPrintRecipeProfile(
    recipe: PrintRecipeV1 | undefined | null,
    profileId: string,
    hardness?: HardnessName,
): PrintRecipeV1 {
    const base = migratePrintRecipe(recipe);
    return withLabelDefault({
        ...base,
        profileId,
        defaultHardness: hardness ?? base.defaultHardness,
    });
}

export function setProductionLabelEnabled(
    recipe: PrintRecipeV1 | undefined | null,
    enabled: boolean,
): PrintRecipeV1 {
    const base = migratePrintRecipe(recipe);
    return { ...base, includeProductionLabel: enabled };
}
