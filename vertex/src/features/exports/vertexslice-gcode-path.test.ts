// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { printerGcodeSliceFields, printGcodeSides } from "@/features/exports/export-service";

describe("printer G-code VertexSlice fields", () => {
    test("Apex Light sends apex_light on the locked profile and does not swap to apex_core", () => {
        const light = printerGcodeSliceFields("ApexLight");
        const core = printerGcodeSliceFields("ApexCore");
        expect(light).toEqual({ presetId: "apex-v2-insole-95a", material: "apex_light" });
        expect(core).toEqual({ presetId: "apex-v2-insole-95a", material: "apex_core" });
        expect(light.material).not.toBe(core.material);
    });

    test("Pair is two separate side calls", () => {
        expect(printGcodeSides("pair")).toEqual(["left", "right"]);
        expect(printGcodeSides("left")).toEqual(["left"]);
        expect(printGcodeSides("right")).toEqual(["right"]);
    });
});
