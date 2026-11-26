// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { PRINT_EXPORT_AMBIENT_INTENSITY, PRINT_EXPORT_KEY_INTENSITY } from "./InsoleContourLighting";

describe("print/export contour lighting", () => {
    test("contour preset lowers ambient and raises key vs standard", () => {
        expect(PRINT_EXPORT_AMBIENT_INTENSITY).toBeLessThan(0.6);
        expect(PRINT_EXPORT_KEY_INTENSITY).toBeGreaterThan(1.1);
    });

    test("Viewer3D selects contour lighting on Print/Export solid", () => {
        const src = readFileSync(resolve("vertex/src/components/viewer/Viewer3D.tsx"), "utf8");
        expect(src).toMatch(/contourLighting/);
        expect(src).toMatch(/InsoleContourLighting/);
        expect(src).toMatch(/printExportSolid/);
    });
});
