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

export const printRecipeV1Schema = z.object({
    version: z.literal(1),
    pattern: z.literal("gyroid"),
    defaultHardness: hardnessNameSchema,
    zones: z.tuple([]),
    hardnessToInfillPct: z.record(hardnessNameSchema, gyroidPctSchema).optional(),
});

export type PrintRecipeV1 = z.infer<typeof printRecipeV1Schema>;

export const DEFAULT_PRINT_RECIPE_V1: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
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

export function migratePrintRecipe(recipe: PrintRecipeV1 | undefined | null): PrintRecipeV1 {
    if (!recipe) {
        return { ...DEFAULT_PRINT_RECIPE_V1 };
    }
    const parsed = printRecipeV1Schema.safeParse(recipe);
    if (!parsed.success) {
        return { ...DEFAULT_PRINT_RECIPE_V1 };
    }
    return parsed.data;
}

/** Snake_case payload for Python `/manufacture`. */
export function printRecipeToSnake(recipe: PrintRecipeV1): Record<string, unknown> {
    return {
        version: recipe.version,
        pattern: recipe.pattern,
        default_hardness: recipe.defaultHardness,
        zones: recipe.zones,
        hardness_to_infill_pct: recipe.hardnessToInfillPct ?? HARDNESS_TO_INFILL_PCT,
    };
}
