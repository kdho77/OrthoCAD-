// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { cameraViewForAfoMarker } from "./afo-scan-ui";

describe("afo scan ui", () => {
    test("medial and lateral views flip with foot side", () => {
        expect(cameraViewForAfoMarker("navicular", "left")).toBe("right");
        expect(cameraViewForAfoMarker("fibular_head", "left")).toBe("left");
        expect(cameraViewForAfoMarker("navicular", "right")).toBe("left");
        expect(cameraViewForAfoMarker("fibular_head", "right")).toBe("right");
    });
});
