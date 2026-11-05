// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { printerGcodeSliceFields } from "@/features/exports/export-service";
import { gyroidInfillPctForHardness } from "../../../shared/print-recipe/print-recipe";

describe("printer G-code VertexSlice fields", () => {
    test("Apex Light, Core, and Forge send the locked profile and distinct material ids", () => {
        const light = printerGcodeSliceFields("ApexLight");
        const core = printerGcodeSliceFields("ApexCore");
        const forge = printerGcodeSliceFields("ApexForge");
        expect(light).toEqual({ presetId: "apex-v2-insole-95a", material: "apex_light" });
        expect(core).toEqual({ presetId: "apex-v2-insole-95a", material: "apex_core" });
        expect(forge).toEqual({ presetId: "apex-v2-insole-95a", material: "apex_forge" });
        expect(new Set([light.material, core.material, forge.material]).size).toBe(3);
        expect(light.presetId).toBe(core.presetId);
        expect(forge.presetId).toBe(core.presetId);
    });

    test("hardness still maps to the locked gyroid infill percent", () => {
        expect(gyroidInfillPctForHardness("Extra Soft")).toBe(16);
        expect(gyroidInfillPctForHardness("Soft")).toBe(22);
        expect(gyroidInfillPctForHardness("Medium")).toBe(26);
        expect(gyroidInfillPctForHardness("Hard")).toBe(32);
        expect(gyroidInfillPctForHardness("Extra Hard")).toBe(38);
    });

    test("Bounce cannot produce a slice payload", () => {
        expect(() => printerGcodeSliceFields("ApexBounce")).toThrow(/approved/i);
    });
});
