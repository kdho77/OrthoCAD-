// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { extractHostTextContext, placeBottomText } from "@/lib/geometry/text-marking/place";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { Side, TextMarking } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const ASYMMETRIC = "JR";

function markingBottom(text: string, extras: Partial<TextMarking> = {}): TextMarking {
    return {
        ...defaultTextMarking("bottom"),
        text,
        capHeightMm: 6,
        mode: "engrave",
        placementU: 0.32,
        ...extras,
    };
}

/** Outline point farthest from centreline in the arch band (u ≈ 0.32). */
function archLateralY(ctx: ReturnType<typeof extractHostTextContext>): number {
    const cx = ctx.minX + 0.32 * (ctx.maxX - ctx.minX);
    const band = ctx.outline.filter((p) => Math.abs(p.x - cx) < 18);
    let peak = ctx.midY;
    for (const p of band) {
        if (Math.abs(p.y - ctx.midY) > Math.abs(peak - ctx.midY)) peak = p.y;
    }
    return peak;
}

/** Sole viewed from below with toe toward +x: lateral axis is −world Y. */
function viewFromBelow(p: { x: number; y: number }): { x: number; y: number } {
    return { x: p.x, y: -p.y };
}

/** Asymmetric bias of the first glyph (J hook) in the below-view frame. */
function jHookBias(placed: ReturnType<typeof placeBottomText>["flat"]): number {
    const g = placed.groups[0];
    if (!g?.outer.length) return 0;
    let cx = 0;
    let cy = 0;
    for (const p of g.outer) {
        cx += p.x;
        cy += p.y;
    }
    cx /= g.outer.length;
    cy /= g.outer.length;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const p of g.outer) {
        const v = viewFromBelow({ x: p.x - cx, y: p.y - cy });
        minX = Math.min(minX, v.x);
        maxX = Math.max(maxX, v.x);
    }
    return maxX + minX;
}

describe("SAMPLE_Top bottom text L/R handedness", () => {
    test("arch lateral Y: left −, right +; soles are y-mirrors", async () => {
        const raw = await loadSampleTopGlb();
        try {
            const rightPreview = await reconstructProceduralPreview(raw.clone(), { wallStyle: "straight" });
            const mirrored = mirrorGeometry(raw);
            const leftPreview = await reconstructProceduralPreview(mirrored, { wallStyle: "straight" });
            mirrored.dispose();
            const leftCtx = extractHostTextContext(leftPreview.geometry);
            const rightCtx = extractHostTextContext(rightPreview.geometry);
            const leftArch = archLateralY(leftCtx);
            const rightArch = archLateralY(rightCtx);
            expect(leftArch).toBeLessThan(leftCtx.midY);
            expect(rightArch).toBeGreaterThan(rightCtx.midY);
            expect(rightArch - rightCtx.midY).toBeCloseTo(leftCtx.midY - leftArch, 0.5);
            leftPreview.geometry.dispose();
            rightPreview.geometry.dispose();
        } finally {
            raw.dispose();
        }
    }, 120_000);

    test("bottom J reads the same from below on both feet (export + placement)", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, ASYMMETRIC, 6, 0.6, true);
        const raw = await loadSampleTopGlb();
        const outDir = mkdtempSync(join(tmpdir(), "bottomtext-"));
        try {
            const buildSide = async (side: Side) => {
                const base = side === "left" ? mirrorGeometry(raw) : raw.clone();
                const preview = await reconstructProceduralPreview(base, { wallStyle: "straight" });
                if (side === "left") base.dispose();
                const ctx = extractHostTextContext(preview.geometry);
                const placed = placeBottomText(preview.geometry, ctx, markingBottom(ASYMMETRIC), flat, side);
                const tagged = await applyTextMarkingToPrintSolid(
                    preview.geometry.clone(),
                    markingBottom(ASYMMETRIC),
                    {
                        side,
                    },
                );
                const stlPath = join(outDir, `${side}-bottom-JR.stl`);
                writeFileSync(stlPath, Buffer.from(geometryToBinarySTL(tagged)));
                tagged.dispose();
                preview.geometry.dispose();
                return { ctx, placed, stlPath };
            };

            const left = await buildSide("left");
            const right = await buildSide("right");

            const leftC = left.placed.meta.centroids;
            const rightC = right.placed.meta.centroids;
            expect(leftC.length).toBeGreaterThan(0);
            expect(rightC.length).toBe(leftC.length);

            const readLeft = Math.sign((leftC[leftC.length - 1]?.x ?? 0) - (leftC[0]?.x ?? 0));
            const readRight = Math.sign((rightC[rightC.length - 1]?.x ?? 0) - (rightC[0]?.x ?? 0));
            expect(readLeft).not.toBe(0);
            expect(readRight).toBe(readLeft);

            const leftHook = jHookBias(left.placed.flat);
            const rightHook = jHookBias(right.placed.flat);
            expect(Math.sign(leftHook)).not.toBe(0);
            expect(Math.sign(rightHook)).toBe(Math.sign(leftHook));
        } finally {
            raw.dispose();
        }
    }, 180_000);
});
