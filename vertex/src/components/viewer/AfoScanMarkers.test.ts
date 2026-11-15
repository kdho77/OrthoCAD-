// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { AFO_FAR_MARKER_COLOR, AFO_NEAR_MARKER_COLOR, afoMarkerDisplayCue } from "@/features/afo/afo-scan-ui";
import { afoScanMarkersInteractive, afoTrimPinFacesCamera } from "./AfoScanMarkers";

describe("AFO scan markers", () => {
    test("markers drag only on the scan step, and not while trimming", () => {
        expect(afoScanMarkersInteractive("scan", false)).toBe(true);
        expect(afoScanMarkersInteractive("scan", true)).toBe(false);
        expect(afoScanMarkersInteractive("design", false)).toBe(false);
        expect(afoScanMarkersInteractive("design", true)).toBe(false);
        expect(afoScanMarkersInteractive("corrections", false)).toBe(false);
        expect(afoScanMarkersInteractive("print", false)).toBe(false);
    });

    test("trim pins on the far side of the cast do not face the camera", () => {
        const center = { x: 0, y: 0, z: 0 };
        const pin = { x: 30, y: 5, z: 10 };
        expect(afoTrimPinFacesCamera(pin, { x: 60, y: 0, z: 0 }, center)).toBe(true);
        expect(afoTrimPinFacesCamera(pin, { x: -60, y: 0, z: 0 }, center)).toBe(false);
        const nearCue = afoMarkerDisplayCue({
            drawMode: "surface",
            facesCamera: true,
            nearColor: AFO_NEAR_MARKER_COLOR,
        });
        const farCue = afoMarkerDisplayCue({
            drawMode: "surface",
            facesCamera: false,
            nearColor: AFO_NEAR_MARKER_COLOR,
        });
        expect(nearCue.color).toBe(AFO_NEAR_MARKER_COLOR);
        expect(farCue.color).toBe(AFO_FAR_MARKER_COLOR);
    });
});
