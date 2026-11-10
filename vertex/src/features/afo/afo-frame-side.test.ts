// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { knownScanSide } from "./afo-scan-markers";

describe("AFO scan side", () => {
    test("a missing or unknown scan side does not become the left leg", () => {
        expect(knownScanSide(undefined)).toBeNull();
        expect(knownScanSide(null)).toBeNull();
        expect(knownScanSide("left")).toBe("left");
        expect(knownScanSide("right")).toBe("right");
    });
});
