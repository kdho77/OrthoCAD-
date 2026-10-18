// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { fixtureSampleTopElements } from "@/lib/hardness/fixtures";
import { canonicalizeJson } from "@/lib/hardness/hash";
import {
    applyDefaultSplitHardness,
    designColorForElementIndex,
    resolvedSplitHardness,
    splitColorForElement,
    splitOverlayOutline,
} from "@/lib/hardness/split-overlay";
import {
    CLASS_PREVIEW_COLORS,
    classFingerprint,
    classLineWidthMm,
    migrateRegionHardnessClass,
    NAMED_HARDNESS_CLASSES,
} from "../vertex/shared/print-recipe/hardness-class-table";
import { hardnessRegionSchema, migrateHardnessZones } from "../vertex/shared/print-recipe/hardness-region";

function repoFile(...parts: string[]): string {
    const a = resolve(process.cwd(), ...parts);
    const b = resolve(process.cwd(), "vertex", ...parts);
    if (existsSync(a)) return a;
    if (existsSync(b)) return b;
    return a;
}

describe("split elements UI + one hardness table", () => {
    test("print step mounts split toggles, additions Split, and resource settings", () => {
        const print = readFileSync(repoFile("src/features/clinical/ClinicalPrintStepPanel.tsx"), "utf8");
        const split = readFileSync(repoFile("src/features/clinical/SplitSettingsPanel.tsx"), "utf8");
        expect(print).toMatch(/SplitSettingsPanel/);
        expect(split).toMatch(/split-elements-toggle/);
        expect(split).toMatch(/smooth-elements-toggle/);
        expect(split).toMatch(/additions-split-button/);
        expect(split).toMatch(/resource-settings/);
        expect(split).toMatch(/hardness-legend/);
        expect(split).toMatch(/Resource settings/);
    });

    test("hardness dropdown lists Extra soft → Extra hard only", () => {
        const picker = readFileSync(repoFile("src/features/elements/HardnessPicker.tsx"), "utf8");
        expect(picker).toMatch(/NAMED_HARDNESS_CLASSES/);
        expect(picker).toMatch(/hardness-dropdown/);
        expect(picker).not.toMatch(/Firm/);
        expect(picker).not.toMatch(/Rigid/);
    });

    test("viewer colors split elements and highlights the selection", () => {
        const overlays = readFileSync(repoFile("src/components/viewer/SplitElementOverlays.tsx"), "utf8");
        const viewer = readFileSync(repoFile("src/components/viewer/Viewer3D.tsx"), "utf8");
        expect(overlays).toMatch(/SplitElementOverlays/);
        expect(overlays).toMatch(/SELECTED_ELEMENT_HIGHLIGHT/);
        expect(viewer).toMatch(/SplitElementOverlays/);
        expect(viewer).toMatch(/HardnessLegend/);
        expect(viewer).toMatch(/appearance=\{workflowStep === "print" \? "hardness" : "design"\}/);
        expect(overlays).toMatch(/appearance === "design"/);
    });

    test("design additions use the purple highlight on white bases", () => {
        const colors = [0, 1, 2, 3, 4, 5, 6].map(designColorForElementIndex);
        expect(colors).toEqual(Array(7).fill("#a855f7"));
        const stockBase = readFileSync(repoFile("src/components/viewer/BaseInsoleMesh.tsx"), "utf8");
        const parametricBase = readFileSync(repoFile("src/components/viewer/InsoleMesh.tsx"), "utf8");
        expect(stockBase.match(/#f8fafc/g)?.length).toBeGreaterThan(0);
        expect(parametricBase.match(/#f8fafc/g)?.length).toBeGreaterThan(0);
    });

    test("five named classes have distinct colors and line-width fingerprint", () => {
        const colors = new Set(NAMED_HARDNESS_CLASSES.map((c) => CLASS_PREVIEW_COLORS[c]));
        expect(colors.size).toBe(5);
        expect(classLineWidthMm("Extra Soft")).toBe(0.7);
        expect(classLineWidthMm("Soft")).toBe(0.7);
        expect(classLineWidthMm("Medium")).toBe(1.0);
        expect(classLineWidthMm("Hard")).toBe(1.0);
        expect(classLineWidthMm("Extra Hard")).toBe(1.0);
        const fp = classFingerprint("Soft");
        expect(fp.lineWidthMm).toBe(0.7);
        expect(fp.densityPct).toBe(22);
        expect(fp.pendingCouponValidation).toBe(true);
    });

    test("legacy Firm/Rigid migrate onto the five-level table", () => {
        expect(migrateRegionHardnessClass("Firm")).toBe("Hard");
        expect(migrateRegionHardnessClass("Rigid")).toBe("Extra Hard");
        expect(migrateRegionHardnessClass("Extrasoft")).toBe("Extra Soft");
        const zones = migrateHardnessZones([
            {
                regionId: "legacy-firm",
                kind: "zone",
                hardnessClass: "Firm",
                priority: 0,
                depth: { type: "full" },
                side: "left",
                polygon: [
                    { x: 0, y: 0 },
                    { x: 2, y: 0 },
                    { x: 2, y: 2 },
                    { x: 0, y: 2 },
                ],
            },
        ]);
        expect(zones[0]?.hardnessClass).toBe("Hard");
        expect(
            hardnessRegionSchema.parse({
                regionId: "r",
                kind: "element",
                hardnessClass: "Rigid",
                priority: 1,
                depth: { type: "full" },
                side: "right",
            }).hardnessClass,
        ).toBe("Extra Hard");
    });

    test("element hardness survives JSON reopen and move", () => {
        const d = fixtureSampleTopElements();
        d.splitElements = true;
        const json = canonicalizeJson(d);
        const reopened = JSON.parse(json) as typeof d;
        expect(reopened.splitElements).toBe(true);
        const met = reopened.elements.find((e) => e.id === "el-met-left");
        expect(met?.hardnessClass).toBe("Soft");
        if (!met) throw new Error("el-met-left missing after reopen");
        met.position = { x: met.position.x + 8, y: met.position.y };
        met.scale = { x: 1.2, y: 0.9 };
        expect(met.hardnessClass).toBe("Soft");
        expect(resolvedSplitHardness(met)).toBe("Soft");
        const colored = splitColorForElement(met);
        expect(colored).toBe(CLASS_PREVIEW_COLORS.Soft);
        expect(splitOverlayOutline(met).length).toBeGreaterThan(8);
    });

    test("enabling split assigns Medium without wiping existing classes", () => {
        const d = fixtureSampleTopElements();
        d.elements.push({
            id: "el-plain",
            kind: "met_pad",
            side: "left",
            position: { x: 0, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 3,
        });
        const next = applyDefaultSplitHardness(d.elements);
        expect(next.find((e) => e.id === "el-met-left")?.hardnessClass).toBe("Soft");
        expect(next.find((e) => e.id === "el-plain")?.hardnessClass).toBe("Medium");
    });
});
