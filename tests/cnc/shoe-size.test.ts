// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { generateCncJob } from "@/lib/cnc/export";
import { cloneProfile, IDAHO_PROFILE } from "@/lib/cnc/profile";
import { defaultSideShapeFinish } from "@/lib/geometry/shape-finish-modifiers";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import { mirrorGeometry } from "@/lib/library/loaders";
import { createDesignWithStockPlaceholder } from "@/stores/design-store";
import { loadSampleTop } from "./helpers";

function meshLengthMm(geo: {
    getAttribute: (name: string) => { count: number; getX: (i: number) => number } | null;
}): number {
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("mesh has no position");
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
    }
    return maxX - minX;
}

function outlineLengthMm(outline: Array<{ x: number }>): number {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of outline) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
    }
    return maxX - minX;
}

describe("CNC shoe-size scale", () => {
    test("US 7.5, 9 and 12 toolpath the sized footprint", async () => {
        const profile = cloneProfile(IDAHO_PROFILE);
        const raw = await loadSampleTop();
        const measured: Record<string, { meshLength: number; outlineLength: number; shoe: number }> = {};
        try {
            for (const size of [7.5, 9, 12] as const) {
                const layout = insoleLayoutForUsMenSize(size);
                const design = createDesignWithStockPlaceholder();
                design.usMenSize = size;
                design.method = "milling_3axis";
                if (design.paired) {
                    design.paired.leftMethod = "milling_3axis";
                    design.paired.rightMethod = "milling_3axis";
                }
                const millFinish = defaultSideShapeFinish("milling_3axis");
                design.shapeFinish = { left: millFinish, right: { ...millFinish }, linked: true };
                const parts = await workpiecesFromDesign(design, ["left", "right"], profile, async (side) => {
                    const geo = raw.clone();
                    return side === "right" ? mirrorGeometry(geo) : geo;
                });
                expect(parts).toHaveLength(2);
                for (const part of parts) {
                    expect(part.mesh).toBeTruthy();
                    const length = meshLengthMm(part.mesh!);
                    expect(length).toBeGreaterThan(layout.lengthMm - 1);
                    expect(length).toBeLessThan(layout.lengthMm + 1);
                    expect(outlineLengthMm(part.outline)).toBeGreaterThan(layout.lengthMm * 0.9);
                    expect(outlineLengthMm(part.outline)).toBeLessThan(layout.lengthMm + 2);
                }
                const job = generateCncJob(profile, parts);
                expect(job.gcode.length).toBeGreaterThan(1000);
                expect(job.gcode).toContain("G1");
                expect(job.gcode).toContain("; foot: left+right");
                const first = parts[0]!;
                measured[String(size)] = {
                    meshLength: meshLengthMm(first.mesh!),
                    outlineLength: outlineLengthMm(first.outline),
                    shoe: layout.lengthMm,
                };
                for (const part of parts) part.mesh?.dispose();
            }
        } finally {
            writeFileSync("/tmp/cnc-dims.json", JSON.stringify(measured, null, 2));
            raw.dispose();
        }
    }, 180_000);
});
