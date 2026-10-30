// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "@rstest/core";
import {
    bindPrintRecipeProfile,
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
} from "./print-recipe";

describe("print-recipe", () => {
    test("hardness table matches the single 5-level ladder (pending coupon)", () => {
        expect(HARDNESS_TO_INFILL_PCT["Extra Soft"]).toBe(16);
        expect(HARDNESS_TO_INFILL_PCT.Soft).toBe(22);
        expect(HARDNESS_TO_INFILL_PCT.Medium).toBe(26);
        expect(HARDNESS_TO_INFILL_PCT.Hard).toBe(32);
        expect(HARDNESS_TO_INFILL_PCT["Extra Hard"]).toBe(38);
        expect(HARDNESS_NAMES).toHaveLength(5);
    });

    test("TS hardness table matches the JSON Python still reads", () => {
        const jsonPath = join(dirname(fileURLToPath(import.meta.url)), "hardness-to-infill-pct.json");
        const fromJson = JSON.parse(readFileSync(jsonPath, "utf8"));
        expect(HARDNESS_TO_INFILL_PCT).toEqual(fromJson);
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

    test("migration undefined → Medium gyroid empty zones", () => {
        const m = migratePrintRecipe(undefined);
        expect(m).toEqual(DEFAULT_PRINT_RECIPE_V1);
        expect(m.defaultHardness).toBe("Medium");
        expect(m.pattern).toBe("gyroid");
        expect(m.profileId).toBe(DEFAULT_PRODUCTION_PROFILE_ID);
        expect(m.zones).toEqual([]);
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

    test("zones accept kind zone regions and keep empty legacy arrays", () => {
        const empty = printRecipeV1Schema.parse({ ...DEFAULT_PRINT_RECIPE_V1 });
        expect(empty.zones).toEqual([]);
        const withZone = printRecipeV1Schema.parse({
            ...DEFAULT_PRINT_RECIPE_V1,
            zones: [
                {
                    regionId: "z-heel",
                    kind: "zone",
                    hardnessClass: "Medium",
                    priority: 0,
                    depth: { type: "full" },
                    side: "left",
                    polygon: [
                        { x: 0, y: 0 },
                        { x: 1, y: 0 },
                        { x: 1, y: 1 },
                        { x: 0, y: 1 },
                    ],
                },
            ],
        });
        expect(withZone.zones[0]!.kind).toBe("zone");
        expect(withZone.zones[0]!.priority).toBe(0);
    });

    test("infill fraction from recipe", () => {
        expect(infillFractionFromRecipe({ ...DEFAULT_PRINT_RECIPE_V1, defaultHardness: "Soft" })).toBe(0.22);
        expect(gyroidInfillPctForHardness("Extra Hard")).toBe(38);
        expect(gyroidInfillPctForHardness("Extra Soft")).toBe(16);
    });
});
