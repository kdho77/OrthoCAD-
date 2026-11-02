// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";

const rightPanel = readFileSync(resolve("vertex/src/components/layout/RightPanel.tsx"), "utf8");
const scanStepPanel = readFileSync(resolve("vertex/src/features/clinical/ClinicalScanStepPanel.tsx"), "utf8");
const elementsPanel = readFileSync(resolve("vertex/src/features/elements/ElementsPanel.tsx"), "utf8");

describe("RightPanel step deduplication", () => {
    test("Base step does not mount ScanImport", () => {
        expect(rightPanel).not.toMatch(/step === "base"[\s\S]*ScanImport/);
    });

    test("ScanImport appears only on the scan step panel", () => {
        expect(rightPanel).toMatch(/step === "scan" \? <ClinicalScanStepPanel/);
        expect(rightPanel).not.toContain("<ScanImport");
    });

    test("Setup uses SetupStepPanel for size and shell (not duplicated on Base)", () => {
        expect(rightPanel).toMatch(/step === "setup" \? <SetupStepPanel/);
    });

    test("AI Generate is not on Scan or Elements steps", () => {
        expect(scanStepPanel).not.toContain("GenerateOrthoticPanel");
        expect(elementsPanel).not.toContain("GenerateOrthoticPanel");
        expect(scanStepPanel).not.toMatch(/AI Generate from text/i);
        expect(elementsPanel).not.toMatch(/AI Generate from text/i);
        expect(rightPanel).not.toContain("GenerateOrthoticPanel");
    });
});
