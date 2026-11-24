// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { getBaseFootprintFrame } from "@/lib/geometry/base-modifier";
import { applyElementsToTopMeshLast } from "@/lib/geometry/element-assets/apply-elements";
import { heightAt, type HeightFieldParams } from "@/lib/geometry/height-field";
import { sampleTopFromArrayBuffer } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { PlacedElement, SideCorrections } from "@/types";
import { defaultElementPose, elementHeightAt } from "./elements";
import { heightFieldYFromMeshY } from "./handedness";
import { effectiveOutlineHalfWidth } from "./trimline";

const CORRECTIONS: SideCorrections = {
    forefootPostingDeg: 0,
    rearfootPostingDeg: 0,
    medialSkiveMm: 0,
    lateralSkiveMm: 0,
    archFillMm: 0,
    archHeightMm: 0,
    archEaseMm: 0,
    heelCupDepthMm: 0,
    heelCupHeightMm: 0,
    heelCupWidthMm: 0,
    heelLiftMm: 0,
    apexMoveMm: 0,
    medialFlangeMm: 0,
    lateralFlangeMm: 0,
};

/**
 * Preview heightAt must match the exported top-mesh add. Morton's is applied
 * after the edge feather, which is the same add the export uses.
 */
describe("Morton's preview matches export", () => {
    test("G11 preview versus export stays within 1e-6 mm at 3 mm and 6 mm", async () => {
        const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/SAMPLE_Top.glb"));
        const raw = await sampleTopFromArrayBuffer(
            bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        try {
            for (const side of ["left", "right"] as const) {
                const base = side === "right" ? mirrorGeometry(raw) : raw.clone();
                const frame = getBaseFootprintFrame(base, side);
                const length = frame.lenSize;
                const width = frame.widSize;
                for (const heightMm of [3, 6]) {
                    const pose = defaultElementPose("mortons_extension", side, length, width);
                    const ext: PlacedElement = {
                        id: `mortons-${side}-${heightMm}`,
                        kind: "mortons_extension",
                        side,
                        ...pose,
                        heightMm,
                    };
                    const field = (elements: PlacedElement[]): HeightFieldParams => ({
                        side,
                        lengthMm: length,
                        widthMm: width,
                        thicknessMm: 3,
                        corrections: CORRECTIONS,
                        elements,
                        includeElements: true,
                        includeSkives: false,
                        trimline: null,
                    });
                    const composed = base.clone();
                    await applyElementsToTopMeshLast(composed, base, field([ext]), { subdivide: false });
                    const before = base.getAttribute("position");
                    const after = composed.getAttribute("position");
                    let worst = 0;
                    let n = 0;
                    for (let i = 0; i < before.count; i += 11) {
                        const len = before.getComponent(i, frame.lengthAxis);
                        const wid = before.getComponent(i, frame.widthAxis);
                        const x = ((len - frame.lenMin) / frame.lenSize) * length;
                        const meshY = wid - frame.widCenter;
                        const z0 = before.getComponent(i, frame.thickAxis);
                        const z1 = after.getComponent(i, frame.thickAxis);
                        if (z1 === z0) continue;
                        const add = elementHeightAt([ext], x, heightFieldYFromMeshY(meshY), length, width);
                        if (add < 1e-4) continue;
                        const u = x / length;
                        const yHf = heightFieldYFromMeshY(meshY);
                        const hw = effectiveOutlineHalfWidth(u, length, width, null) * (width / 2);
                        const vSigned = Math.abs(hw) > 1e-6 ? yHf / hw : 0;
                        const preview = heightAt(u, vSigned, field([ext])) - heightAt(u, vSigned, field([]));
                        worst = Math.max(worst, Math.abs(preview - (z1 - z0)));
                        n++;
                    }
                    expect(n, `${side} ${heightMm} mm samples`).toBeGreaterThan(20);
                    expect(worst, `${side} ${heightMm} mm preview versus export`).toBeLessThanOrEqual(1e-6);
                    composed.dispose();
                }
                base.dispose();
            }
        } finally {
            raw.dispose();
        }
    });
});
