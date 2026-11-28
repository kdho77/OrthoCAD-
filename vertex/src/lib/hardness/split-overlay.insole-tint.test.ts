// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { PlacedElement } from "@/types";
import {
    CLASS_PREVIEW_COLORS,
    NAMED_HARDNESS_CLASSES,
} from "../../../shared/print-recipe/hardness-class-table";
import {
    elementPreviewColor,
    INSOLE_VIEWPORT_BASE_COLOR,
    insoleViewportMaterialColor,
} from "./split-overlay";

function repoFile(...parts: string[]): string {
    const a = resolve(process.cwd(), ...parts);
    const b = resolve(process.cwd(), "vertex", ...parts);
    if (existsSync(a)) return a;
    if (existsSync(b)) return b;
    return a;
}

describe("insole viewport hardness tint", () => {
    test("each named device hardness maps to a distinct material color", () => {
        expect(insoleViewportMaterialColor(undefined)).toBe(INSOLE_VIEWPORT_BASE_COLOR);
        expect(insoleViewportMaterialColor({})).toBe(INSOLE_VIEWPORT_BASE_COLOR);
        const colors = NAMED_HARDNESS_CLASSES.map((name) =>
            insoleViewportMaterialColor({ defaultHardness: name }),
        );
        expect(new Set(colors).size).toBe(NAMED_HARDNESS_CLASSES.length);
        expect(colors.every((c) => c !== INSOLE_VIEWPORT_BASE_COLOR)).toBe(true);
        expect(insoleViewportMaterialColor({ defaultHardness: "Soft" })).not.toBe(
            insoleViewportMaterialColor({ defaultHardness: "Hard" }),
        );
    });

    test("Print/Export solid uses exact CLASS_PREVIEW_COLORS (no washout)", () => {
        for (const name of NAMED_HARDNESS_CLASSES) {
            expect(insoleViewportMaterialColor({ defaultHardness: name }, { printExport: true })).toBe(
                CLASS_PREVIEW_COLORS[name],
            );
        }
        const design = insoleViewportMaterialColor({ defaultHardness: "Soft" });
        const print = insoleViewportMaterialColor({ defaultHardness: "Soft" }, { printExport: true });
        expect(print).toBe(CLASS_PREVIEW_COLORS.Soft);
        expect(print).not.toBe(design);
    });

    test("inheriting elements match insole Print/Export color for the same device hardness", () => {
        const base: PlacedElement = {
            id: "el",
            kind: "dancers_pad",
            side: "left",
            position: { x: 0, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 4,
        };
        for (const name of NAMED_HARDNESS_CLASSES) {
            const insole = insoleViewportMaterialColor({ defaultHardness: name }, { printExport: true });
            const element = elementPreviewColor(base, true, false, true, name);
            expect(insole).toBe(CLASS_PREVIEW_COLORS[name]);
            expect(element).toBe(insole);
        }
    });

    test("hardness tint derives from the same preview palette as split elements", () => {
        const soft = insoleViewportMaterialColor({ defaultHardness: "Soft" });
        const preview = CLASS_PREVIEW_COLORS.Soft;
        expect(soft.startsWith("#")).toBe(true);
        expect(soft).not.toBe(preview);
        expect(soft).not.toBe(INSOLE_VIEWPORT_BASE_COLOR);
    });

    test("viewer meshes use viewport tint helper only (exports stay geometry-only)", () => {
        for (const rel of [
            "src/components/viewer/BaseInsoleMesh.tsx",
            "src/components/viewer/InsoleMesh.tsx",
        ]) {
            const src = readFileSync(repoFile(rel), "utf8");
            expect(src).toMatch(/insoleViewportMaterialColor/);
        }
        for (const rel of [
            "src/lib/geometry/export-geometry.ts",
            "src/lib/hardness/pipeline.ts",
            "src/lib/geometry/procedural-wall/preview-loft-worker.ts",
        ]) {
            const src = readFileSync(repoFile(rel), "utf8");
            expect(src).not.toMatch(/insoleViewportMaterialColor/);
        }
    });
});
