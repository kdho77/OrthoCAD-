// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";

describe("print bridge workflows", () => {
    test("package and release workflows name the installers and the baked origin", () => {
        const packageWorkflow = readFileSync(".github/workflows/print-bridge-package.yml", "utf8");
        const releaseWorkflow = readFileSync(".github/workflows/print-bridge-release.yml", "utf8");
        for (const source of [packageWorkflow, releaseWorkflow]) {
            expect(source.includes("\t")).toBe(false);
            expect(source).toContain("https://orthocad.vertexorthopedic.com");
            expect(source).toContain("OrthoCAD-Print-Bridge-Setup.exe");
            expect(source).toContain("OrthoCAD-Print-Bridge.pkg");
            expect(source).toContain("OrthoCAD-Print-Bridge.dmg");
            expect(source).toContain("SHORT-UNSIGNED");
        }
        expect(packageWorkflow).toContain("windows-latest");
        expect(packageWorkflow).toContain("macos-latest");
        expect(packageWorkflow).toContain("package-check");
        expect(releaseWorkflow).toContain("workflow_dispatch");
        expect(releaseWorkflow).toContain("ORTHOCAD_BRIDGE_UPDATE_PRIVATE_KEY");
        expect(releaseWorkflow).not.toContain("BEGIN PRIVATE KEY");
    });
});
