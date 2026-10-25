// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { createDefaultStockPairedBases, getSampleTopStockBase } from "@/lib/geometry/base-asset";
import { reconstructProceduralPreview } from "@/lib/geometry/procedural-wall/sample-top-preview";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { applyTextMarkingToPrintSolid } from "@/lib/geometry/text-marking/apply";
import { defaultTextMarking } from "@/lib/geometry/text-marking/constants";
import { flattenText } from "@/lib/geometry/text-marking/contours";
import { loadTextFont } from "@/lib/geometry/text-marking/font";
import { extractHostTextContext, placeBottomText } from "@/lib/geometry/text-marking/place";
import { mirrorGeometry } from "@/lib/library/loaders";
import type { DesignBase, Side, TextMarking } from "@/types";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

const ASYMMETRIC = "JR";

/** Same `mirrored` flag as `export-geometry.ts` → `buildProceduralExportSolid`. */
function stockBaseForSide(side: Side): DesignBase {
    const { left, right } = createDefaultStockPairedBases(getSampleTopStockBase());
    return side === "left" ? left : right;
}

function productionMirrored(side: Side): boolean {
    return Boolean(stockBaseForSide(side).mirrored);
}

/** `loadBaseGeometry` mirror + `reconstructProceduralPreview` (export-geometry procedural path). */
async function buildProductionHost(side: Side) {
    const mirrored = productionMirrored(side);
    let raw = await loadSampleTopGlb();
    if (mirrored) {
        const reflected = mirrorGeometry(raw);
        raw.dispose();
        raw = reflected;
    }
    const preview = await reconstructProceduralPreview(raw, { wallStyle: "straight" });
    raw.dispose();
    return { preview, mirrored };
}

/**
 * Medial arch sign from top-surface height in the 35–55% length band.
 * Returns −1 when the higher arch (max Z) sits on Y−, +1 when on Y+.
 */
function medialArchSideSign(geo: BufferGeometry): number {
    const pos = geo.getAttribute("position").array as Float32Array;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        minX = Math.min(minX, pos[i]!);
        maxX = Math.max(maxX, pos[i]!);
        minY = Math.min(minY, pos[i + 1]!);
        maxY = Math.max(maxY, pos[i + 1]!);
    }
    const midY = (minY + maxY) / 2;
    const x0 = minX + 0.35 * (maxX - minX);
    const x1 = minX + 0.55 * (maxX - minX);
    let maxZNegY = -Infinity;
    let maxZPosY = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i]!;
        const y = pos[i + 1]!;
        const z = pos[i + 2]!;
        if (x < x0 || x > x1) continue;
        if (y < midY) maxZNegY = Math.max(maxZNegY, z);
        else maxZPosY = Math.max(maxZPosY, z);
    }
    if (!Number.isFinite(maxZNegY) || !Number.isFinite(maxZPosY)) return 0;
    return maxZNegY > maxZPosY ? -1 : 1;
}

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
    test("production mirror: left unmirrored, right mirrored; arch Y− / Y+", async () => {
        expect(productionMirrored("left")).toBe(false);
        expect(productionMirrored("right")).toBe(true);

        const leftHost = await buildProductionHost("left");
        const rightHost = await buildProductionHost("right");
        try {
            expect(medialArchSideSign(leftHost.preview.geometry)).toBe(-1);
            expect(medialArchSideSign(rightHost.preview.geometry)).toBe(1);
        } finally {
            leftHost.preview.geometry.dispose();
            rightHost.preview.geometry.dispose();
        }
    }, 180_000);

    test("bottom JR reads the same from below on both feet (export + placement)", async () => {
        const font = await loadTextFont();
        const flat = flattenText(font, ASYMMETRIC, 6, 0.6, true);
        const outDir = mkdtempSync(join(tmpdir(), "bottomtext-"));
        try {
            const buildSide = async (side: Side) => {
                const { preview } = await buildProductionHost(side);
                const ctx = extractHostTextContext(preview.geometry);
                const placed = placeBottomText(preview.geometry, ctx, markingBottom(ASYMMETRIC), flat, side);
                const tagged = await applyTextMarkingToPrintSolid(
                    preview.geometry.clone(),
                    markingBottom(ASYMMETRIC),
                    { side },
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
            /* buildProductionHost loads SAMPLE_Top internally */
        }
    }, 240_000);
});
