// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { APEX_CORE_NOZZLE_TEMP_C, APEX_FORGE_NOZZLE_TEMP_C } from "@/features/exports/apex-print-material";
import { hybridGcodeFilename, printerGcodeSliceFields } from "@/features/exports/export-service";
import { gyroidInfillPctForHardness } from "../../../shared/print-recipe/print-recipe";

function hotendTempsFromGcode(gcode: string): number[] {
    return [...gcode.matchAll(/\bM10[49]\s+S(\d+)/gi)].map((match) => Number(match[1]));
}

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

    test("Apex Forge slice fields mirror Core except material; temps are slicer-side", () => {
        const core = printerGcodeSliceFields("ApexCore");
        const forge = printerGcodeSliceFields("ApexForge");
        expect({ presetId: forge.presetId }).toEqual({ presetId: core.presetId });
        expect(forge.material).toBe("apex_forge");
        expect(core.material).toBe("apex_core");
        expect(APEX_CORE_NOZZLE_TEMP_C).toBe(225);
        expect(APEX_FORGE_NOZZLE_TEMP_C).toBe(245);
        const coreGcode = `; filament_type = apex_core\nM104 S${APEX_CORE_NOZZLE_TEMP_C}\nM109 S${APEX_CORE_NOZZLE_TEMP_C}\n`;
        const forgeGcode = `; filament_type = apex_forge\nM104 S${APEX_FORGE_NOZZLE_TEMP_C}\nM109 S${APEX_FORGE_NOZZLE_TEMP_C}\n`;
        expect(hotendTempsFromGcode(coreGcode)).toEqual([225, 225]);
        expect(hotendTempsFromGcode(forgeGcode)).toEqual([245, 245]);
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

    test("Apex Bounce slices as apex_bounce", () => {
        expect(printerGcodeSliceFields("ApexBounce")).toEqual({
            presetId: "apex-v2-insole-95a",
            material: "apex_bounce",
        });
    });
});
