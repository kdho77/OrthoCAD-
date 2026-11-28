// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    CLASS_PREVIEW_COLORS,
    NAMED_HARDNESS_CLASSES,
} from "../../../shared/print-recipe/hardness-class-table";

function repoFile(...parts: string[]): string {
    const a = resolve(process.cwd(), ...parts);
    const b = resolve(process.cwd(), "vertex", ...parts);
    if (existsSync(a)) return a;
    if (existsSync(b)) return b;
    return a;
}

describe("HardnessStepPanel device selector", () => {
    test("DEVICE rows show CLASS_PREVIEW_COLORS dots like ElementHardnessPopup", () => {
        const src = readFileSync(repoFile("src/features/clinical/HardnessStepPanel.tsx"), "utf8");
        expect(src).toMatch(/CLASS_PREVIEW_COLORS\[name\]/);
        for (const name of NAMED_HARDNESS_CLASSES) {
            expect(src).toContain(`CLASS_PREVIEW_COLORS[name]`);
            expect(CLASS_PREVIEW_COLORS[name]).toMatch(/^#/);
        }
    });
});
