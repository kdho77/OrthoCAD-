// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    bindPrintRecipeProfile,
    DEFAULT_INCLUDE_PRODUCTION_LABEL,
    DEFAULT_PRINT_RECIPE_V1,
    DEFAULT_PRODUCTION_PROFILE_ID,
    gyroidInfillPctForHardness,
    HARDNESS_NAMES,
    HARDNESS_TO_INFILL_PCT,
    infillFractionFromRecipe,
    migratePrintRecipe,
    PrintRecipeProfileRequiredError,
    printRecipeV1Schema,
    resolveGyroidManufacturingPrintRecipe,
    setProductionLabelEnabled,
} from "./print-recipe";
import { buildProductionReleaseLabel } from "./production-label";

describe("print-recipe", () => {
    test("hardness table matches locked ladder 14/20/26/32/38", () => {
        expect(HARDNESS_TO_INFILL_PCT["Extra Soft"]).toBe(14);
        expect(HARDNESS_TO_INFILL_PCT.Soft).toBe(20);
        expect(HARDNESS_TO_INFILL_PCT.Medium).toBe(26);
        expect(HARDNESS_TO_INFILL_PCT.Hard).toBe(32);
        expect(HARDNESS_TO_INFILL_PCT["Extra Hard"]).toBe(38);
        expect(HARDNESS_NAMES).toHaveLength(5);
    });

    test("schema round-trip", () => {
        const recipe = {
            ...DEFAULT_PRINT_RECIPE_V1,
            defaultHardness: "Hard" as const,
        };
        const parsed = printRecipeV1Schema.parse(recipe);
        expect(parsed.defaultHardness).toBe("Hard");
        expect(parsed.pattern).toBe("gyroid");
        expect(parsed.profileId).toBe(DEFAULT_PRODUCTION_PROFILE_ID);
        expect(parsed.zones).toEqual([]);
    });

    test("migration undefined → Medium gyroid empty zones + default label ON", () => {
        const m = migratePrintRecipe(undefined);
        expect(m).toEqual(DEFAULT_PRINT_RECIPE_V1);
        expect(m.defaultHardness).toBe("Medium");
        expect(m.pattern).toBe("gyroid");
        expect(m.profileId).toBe(DEFAULT_PRODUCTION_PROFILE_ID);
        expect(m.zones).toEqual([]);
        expect(m.includeProductionLabel).toBe(DEFAULT_INCLUDE_PRODUCTION_LABEL);
    });

    test("migration legacy recipe without profileId → default production profile", () => {
        const legacy = {
            version: 1 as const,
            pattern: "gyroid" as const,
            defaultHardness: "Soft" as const,
            zones: [] as [],
        };
        const m = migratePrintRecipe(legacy);
        expect(m.defaultHardness).toBe("Soft");
        expect(m.profileId).toBe(DEFAULT_PRODUCTION_PROFILE_ID);
        expect(m.includeProductionLabel).toBe(true);
    });

    test("schema round-trip includes profileId", () => {
        const bound = bindPrintRecipeProfile(DEFAULT_PRINT_RECIPE_V1, "apex-belt-v2-shell", "Hard");
        const parsed = printRecipeV1Schema.parse(bound);
        expect(parsed.profileId).toBe("apex-belt-v2-shell");
        expect(parsed.defaultHardness).toBe("Hard");
    });

    test("resolveGyroidManufacturingPrintRecipe rejects missing printRecipe (400 path)", () => {
        expect(() => resolveGyroidManufacturingPrintRecipe("apex-belt-v2", undefined)).toThrow(
            PrintRecipeProfileRequiredError,
        );
    });

    test("infill fraction from recipe", () => {
        expect(infillFractionFromRecipe({ ...DEFAULT_PRINT_RECIPE_V1, defaultHardness: "Soft" })).toBe(0.2);
        expect(gyroidInfillPctForHardness("Extra Hard")).toBe(38);
    });

    test("production label can be disabled on recipe", () => {
        const off = setProductionLabelEnabled(DEFAULT_PRINT_RECIPE_V1, false);
        expect(off.includeProductionLabel).toBe(false);
        expect(migratePrintRecipe(off).includeProductionLabel).toBe(false);
    });

    test("buildProductionReleaseLabel includes side and hardness", () => {
        const text = buildProductionReleaseLabel({
            side: "left",
            recipe: DEFAULT_PRINT_RECIPE_V1,
            profileDisplayName: "Apex Belt V2 (TPU)",
        });
        expect(text).toContain("Left");
        expect(text).toContain("Medium");
        expect(text).toContain("Apex Belt V2");
        expect(text.toLowerCase()).toContain("gyroid");
    });
});
