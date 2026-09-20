// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    DEFAULT_PRINT_RECIPE_V1,
    gyroidInfillPctForHardness,
    HARDNESS_NAMES,
    HARDNESS_TO_INFILL_PCT,
    infillFractionFromRecipe,
    migratePrintRecipe,
    printRecipeV1Schema,
} from "./print-recipe";

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
        expect(parsed.zones).toEqual([]);
    });

    test("migration undefined → Medium gyroid empty zones", () => {
        const m = migratePrintRecipe(undefined);
        expect(m).toEqual(DEFAULT_PRINT_RECIPE_V1);
        expect(m.defaultHardness).toBe("Medium");
        expect(m.pattern).toBe("gyroid");
        expect(m.zones).toEqual([]);
    });

    test("infill fraction from recipe", () => {
        expect(infillFractionFromRecipe({ ...DEFAULT_PRINT_RECIPE_V1, defaultHardness: "Soft" })).toBe(0.2);
        expect(gyroidInfillPctForHardness("Extra Hard")).toBe(38);
    });
});
