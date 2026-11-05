// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import { afoScanAutoFrameAllowed, cameraViewForAfoMarker } from "./afo-scan-ui";

describe("afo scan ui", () => {
    test("auto-frame is disabled during Stage 1 plantar alignment", () => {
        expect(afoScanAutoFrameAllowed(defaultAfoScanWorkflow())).toBe(false);
        expect(afoScanAutoFrameAllowed({ ...defaultAfoScanWorkflow(), alignmentApplied: true })).toBe(true);
    });

    test("medial and lateral views flip with foot side", () => {
        expect(cameraViewForAfoMarker("navicular", "left")).toBe("right");
        expect(cameraViewForAfoMarker("fibular_head", "left")).toBe("left");
        expect(cameraViewForAfoMarker("navicular", "right")).toBe("left");
        expect(cameraViewForAfoMarker("fibular_head", "right")).toBe("right");
    });
});
