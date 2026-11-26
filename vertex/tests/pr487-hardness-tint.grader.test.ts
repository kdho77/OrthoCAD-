// Independent grader for PR #487 @ ec88e52 (cursor/insole-hardness-tint-1125). Do not merge.
// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, test } from "@rstest/core";
import {
    InsoleStandardLighting,
    PRINT_EXPORT_AMBIENT_INTENSITY,
    PRINT_EXPORT_KEY_INTENSITY,
} from "@/components/viewer/InsoleContourLighting";
import { defaultHeightmapForClinicalStep } from "@/components/viewer/viewer-tab-defaults";
import { buildExportGlbGeometry } from "@/lib/geometry/export-geometry";
import { fixtureSampleTopElements } from "@/lib/hardness/fixtures";
import {
    elementPreviewColor,
    INSOLE_HARDNESS_TINT_MIX,
    INSOLE_PRINT_EXPORT_TINT_MIX,
    INSOLE_VIEWPORT_BASE_COLOR,
    insoleViewportMaterialColor,
    splitColorForElement,
} from "@/lib/hardness/split-overlay";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import type { PlacedElement } from "@/types";
import { CLASS_PREVIEW_COLORS, NAMED_HARDNESS_CLASSES } from "../shared/print-recipe/hardness-class-table";

const REPO_ROOT = join(import.meta.dirname, "..", "..");

const PR487_WORKER_FILES = [
    "vertex/src/components/viewer/BaseInsoleMesh.tsx",
    "vertex/src/components/viewer/InsoleMesh.tsx",
    "vertex/src/components/viewer/Viewer3D.tsx",
    "vertex/src/lib/hardness/split-overlay.ts",
    "vertex/src/components/viewer/viewer-tab-defaults.ts",
    "vertex/src/stores/clinical-workflow-store.ts",
] as const;

function repoFile(...parts: string[]): string {
    const fromRoot = resolve(REPO_ROOT, ...parts);
    if (existsSync(fromRoot)) return fromRoot;
    return resolve(process.cwd(), ...parts);
}

function elementAtDeviceHardness(cls: (typeof NAMED_HARDNESS_CLASSES)[number]): PlacedElement {
    const [el] = fixtureSampleTopElements().elements;
    return { ...el, hardnessClass: cls };
}

beforeEach(() => {
    useDesignStore.setState({
        design: defaultDesign(),
        viewer: { heightmap: false, wallModel: "procedural" },
    });
});

describe("PR #487 grader G1 — device hardness tints the whole insole viewport material", () => {
    test("each named hardness maps to a distinct blended color; unset stays neutral gray", () => {
        expect(insoleViewportMaterialColor(undefined)).toBe(INSOLE_VIEWPORT_BASE_COLOR);
        expect(insoleViewportMaterialColor({ defaultHardness: undefined })).toBe(INSOLE_VIEWPORT_BASE_COLOR);
        const colors = NAMED_HARDNESS_CLASSES.map((name) =>
            insoleViewportMaterialColor({ defaultHardness: name }),
        );
        expect(new Set(colors).size).toBe(NAMED_HARDNESS_CLASSES.length);
        for (const c of colors) {
            expect(c).not.toBe(INSOLE_VIEWPORT_BASE_COLOR);
            expect(c).not.toBe(CLASS_PREVIEW_COLORS.Soft);
        }
    });

    test("changing defaultHardness changes the mapped viewport color", () => {
        const a = insoleViewportMaterialColor({ defaultHardness: "Extra Soft" });
        const b = insoleViewportMaterialColor({ defaultHardness: "Extra Hard" });
        expect(a).not.toBe(b);
    });

    test("BaseInsoleMesh and InsoleMesh wire the tint helper on solid (non-heightmap) materials", () => {
        for (const rel of [
            "vertex/src/components/viewer/BaseInsoleMesh.tsx",
            "vertex/src/components/viewer/InsoleMesh.tsx",
        ]) {
            const src = readFileSync(repoFile(rel), "utf8");
            expect(src).toMatch(/insoleViewportMaterialColor\(design\.printRecipe/);
            expect(src).toMatch(/printExportSolid/);
            const heightmapBlock = src.match(
                /if \(heightmap\)[\s\S]*?return new THREE\.MeshStandardMaterial/,
            );
            expect(heightmapBlock?.[0] ?? "").not.toMatch(/insoleViewportMaterialColor/);
        }
    });
});

describe("PR #487 grader G2 — palette reuse and element legibility", () => {
    test("tint mix constants keep design tint stronger than Print/Export light tint", () => {
        expect(INSOLE_PRINT_EXPORT_TINT_MIX).toBeLessThan(INSOLE_HARDNESS_TINT_MIX);
    });

    test("print-view element at same device hardness stays visually distinct from insole tint", () => {
        for (const cls of NAMED_HARDNESS_CLASSES) {
            const el = elementAtDeviceHardness(cls);
            const insole = insoleViewportMaterialColor({ defaultHardness: cls }, { printExport: true });
            const element = elementPreviewColor(el, true, false);
            expect(element).toBe(splitColorForElement(el));
            expect(element).toBe(CLASS_PREVIEW_COLORS[cls]);
            expect(insole).not.toBe(element);
        }
    });

    test("design-tab elements keep non-hardness preview colors (purple / green selection)", () => {
        const el = elementAtDeviceHardness("Medium");
        expect(elementPreviewColor(el, false, false)).toBe("#a855f7");
        expect(elementPreviewColor(el, false, true)).toBe("#22c55e");
    });
});

describe("PR #487 grader G3 — per-tab viewport defaults (t2786u)", () => {
    test("insole design steps default to heatmap; Print and Export default to solid", () => {
        for (const step of ["scan", "setup", "base", "corrections", "elements"] as const) {
            expect(defaultHeightmapForClinicalStep(step)).toBe(true);
        }
        expect(defaultHeightmapForClinicalStep("print")).toBe(false);
        expect(defaultHeightmapForClinicalStep("export")).toBe(false);
    });

    test("clinical-workflow setStep hooks apply viewer defaults", () => {
        const wf = readFileSync(repoFile("vertex/src/stores/clinical-workflow-store.ts"), "utf8");
        expect(wf).toMatch(/applyViewerDefaultsForClinicalStep/);
        expect(wf).toMatch(/goNext|goBack|setStep/);
    });
});

describe("PR #487 grader G4 — Print/Export light tint + stronger contour shading", () => {
    test("print/export solid tint is nearer base gray than design-tab tint", () => {
        const dist = (hex: string) => {
            const v = Number.parseInt(hex.slice(1), 16);
            const r = (v >> 16) & 255;
            const g = (v >> 8) & 255;
            const b = v & 255;
            return Math.abs(r - 248) + Math.abs(g - 250) + Math.abs(b - 252);
        };
        const recipe = { defaultHardness: "Soft" as const };
        const design = insoleViewportMaterialColor(recipe);
        const print = insoleViewportMaterialColor(recipe, { printExport: true });
        expect(dist(print)).toBeLessThan(dist(design));
    });

    test("contour preset lowers ambient and raises key versus standard lighting", () => {
        expect(PRINT_EXPORT_AMBIENT_INTENSITY).toBeLessThan(0.6);
        expect(PRINT_EXPORT_KEY_INTENSITY).toBeGreaterThan(1.1);
        const standardSrc = InsoleStandardLighting.toString();
        expect(standardSrc).toMatch(/0\.6/);
        expect(standardSrc).toMatch(/1\.1/);
    });

    test("Viewer3D enables contour lighting only for Print/Export solid", () => {
        const src = readFileSync(repoFile("vertex/src/components/viewer/Viewer3D.tsx"), "utf8");
        expect(src).toMatch(/printExportSolid\s*=\s*printPreview\s*&&\s*!viewer\.heightmap/);
        expect(src).toMatch(/contourLighting\s*=\s*printExportSolid/);
        expect(src).toMatch(/InsoleContourLighting/);
    });
});

describe("PR #487 grader G5 — exports and manufacturing paths stay geometry-only", () => {
    const exportOnlyPaths = [
        "vertex/src/lib/geometry/export-geometry.ts",
        "vertex/src/lib/hardness/pipeline.ts",
        "vertex/src/lib/geometry/procedural-wall/preview-loft-worker.ts",
        "vertex/src/lib/geometry/stl.ts",
    ];

    test("viewport tint helper is absent from export / manufacturing code", () => {
        for (const rel of exportOnlyPaths) {
            const src = readFileSync(repoFile(rel), "utf8");
            expect(src).not.toMatch(/insoleViewportMaterialColor/);
        }
    });

    test("GLB export geometry is unchanged when only viewer.heightmap toggles", async () => {
        useDesignStore.setState({ design: fixtureSampleTopElements() });
        useDesignStore.getState().setViewer({ heightmap: false });
        const solid = await buildExportGlbGeometry("left");
        const solidPos = solid.getAttribute("position")!.array.slice();
        useDesignStore.getState().setViewer({ heightmap: true });
        const heatmap = await buildExportGlbGeometry("left");
        expect(heatmap.getAttribute("position")!.array).toEqual(solidPos);
        solid.dispose();
        heatmap.dispose();
    });
});

describe("PR #487 grader G6 — PR scope files present (worker diff manifest)", () => {
    test("expected worker-touched sources exist in the tree", () => {
        for (const rel of PR487_WORKER_FILES) {
            expect(existsSync(repoFile(rel))).toBe(true);
        }
    });
});
