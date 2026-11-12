// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { afoScanMarkersInteractive } from "./AfoScanMarkers";

describe("AFO scan markers", () => {
    test("markers drag only on the scan step, and not while trimming", () => {
        expect(afoScanMarkersInteractive("scan", false)).toBe(true);
        expect(afoScanMarkersInteractive("scan", true)).toBe(false);
        expect(afoScanMarkersInteractive("design", false)).toBe(false);
        expect(afoScanMarkersInteractive("design", true)).toBe(false);
        expect(afoScanMarkersInteractive("corrections", false)).toBe(false);
        expect(afoScanMarkersInteractive("print", false)).toBe(false);
    });
});
