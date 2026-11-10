// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { hybridGcodeFilename, printerGcodeSliceFields } from "@/features/exports/export-service";
import { gyroidInfillPctForHardness } from "../../../shared/print-recipe/print-recipe";

describe("printer G-code VertexSlice fields", () => {
    test("Apex Light and Apex Core send the locked profile and do not swap materials", () => {
        const light = printerGcodeSliceFields("ApexLight");
        const core = printerGcodeSliceFields("ApexCore");
        expect(light).toEqual({ presetId: "apex-v2-insole-95a", material: "apex_light" });
        expect(core).toEqual({ presetId: "apex-v2-insole-95a", material: "apex_core" });
        expect(light.material).not.toBe(core.material);
        expect(light.presetId).toBe(core.presetId);
    });

    test("hardness still maps to the locked gyroid infill percent", () => {
        expect(gyroidInfillPctForHardness("Extra Soft")).toBe(14);
        expect(gyroidInfillPctForHardness("Soft")).toBe(20);
        expect(gyroidInfillPctForHardness("Medium")).toBe(26);
        expect(gyroidInfillPctForHardness("Hard")).toBe(32);
        expect(gyroidInfillPctForHardness("Extra Hard")).toBe(38);
    });

    test("paired filenames stay side-specific on the locked Core profile", () => {
        const left = hybridGcodeFilename("left", "apex-v2-insole-95a", 1793911362202);
        const right = hybridGcodeFilename("right", "apex-v2-insole-95a", 1793911362202);
        expect(left).toBe("hybrid-left-apex-v2-insole-95a-1793911362202.gcode");
        expect(right).toBe("hybrid-right-apex-v2-insole-95a-1793911362202.gcode");
        expect(left).not.toBe(right);
    });

    test("Apex Bounce slices as apex_bounce and Forge cannot produce a payload", () => {
        expect(printerGcodeSliceFields("ApexBounce")).toEqual({
            presetId: "apex-v2-insole-95a",
            material: "apex_bounce",
        });
        expect(() => printerGcodeSliceFields("ApexForge")).toThrow(/approved/i);
    });
});
