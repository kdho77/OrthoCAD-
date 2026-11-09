// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { defaultAfoScanWorkflow } from "@/lib/geometry/afo/defaults";
import { afoViewportPlacementLayer } from "./afo-scan-markers";
import { afoScanAutoFrameAllowed, afoUploadedScanMaterial, cameraViewForAfoMarker } from "./afo-scan-ui";

describe("afo scan ui", () => {
    test("auto-frame is disabled during Stage 1 plantar alignment", () => {
        expect(afoScanAutoFrameAllowed(defaultAfoScanWorkflow())).toBe(false);
        expect(afoScanAutoFrameAllowed({ ...defaultAfoScanWorkflow(), alignmentApplied: true })).toBe(true);
    });

    test("the uploaded scan stays opaque for every landmark and when Transparent is off", () => {
        expect(afoUploadedScanMaterial({ transparentOn: true, placingLandmarks: true })).toEqual({
            opacity: 1,
            transparent: false,
            grey: true,
        });
        expect(afoUploadedScanMaterial({ transparentOn: false, placingLandmarks: false })).toEqual({
            opacity: 1,
            transparent: false,
            grey: false,
        });
        expect(afoUploadedScanMaterial({ transparentOn: true, placingLandmarks: false })).toEqual({
            opacity: 0.45,
            transparent: true,
            grey: false,
        });
    });

    test("Design trim clicks are not stolen by a leftover scan-marker session", () => {
        expect(afoViewportPlacementLayer("design", true, false, true)).toBe("afo-design");
        expect(afoViewportPlacementLayer("scan", true, false, true)).toBe("afo-scan");
        expect(afoViewportPlacementLayer("corrections", true, false, false)).toBe("afo-design");
    });

    test("medial and lateral views flip with foot side", () => {
        expect(cameraViewForAfoMarker("navicular", "left")).toBe("right");
        expect(cameraViewForAfoMarker("fibular_head", "left")).toBe("left");
        expect(cameraViewForAfoMarker("navicular", "right")).toBe("left");
        expect(cameraViewForAfoMarker("fibular_head", "right")).toBe("right");
    });
});
