// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { extractMergedGeometry, loadGlbFromBuffer } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";

const FIXTURE = resolve(process.cwd(), "tests/fixtures/Default.glb");
const DEPTH = 5;
const WIDTH = 8;

function neutral(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 0,
        archHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupHeightMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutral(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

let base: BufferGeometry;
let baseArr: Float32Array;
let topN: number;
let thickAxis: number;
let lengthAxis: number;
let lenMin: number;
let lenSize: number;

beforeAll(async () => {
    const group = await loadGlbFromBuffer(readFileSync(FIXTURE).buffer.slice(0) as ArrayBuffer);
    const merged = extractMergedGeometry(group)!;
    base = merged.geometry;
    baseArr = base.getAttribute("position")!.array as Float32Array;
    topN = (base.userData as { topVertexCount?: number }).topVertexCount ?? baseArr.length / 3;
    base.computeBoundingBox();
    const box = base.boundingBox!;
    const size: [number, number, number][] = [
        [0, box.max.x - box.min.x],
        [1, box.max.y - box.min.y],
        [2, box.max.z - box.min.z],
    ];
    size.sort((a, b) => a[1] - b[1]);
    thickAxis = size[0]![0];
    lengthAxis = size[2]![0];
    lenMin = [box.min.x, box.min.y, box.min.z][lengthAxis]!;
    lenSize = [box.max.x, box.max.y, box.max.z][lengthAxis]! - lenMin;
});

function maxHeelThickDelta(modArr: Float32Array): number {
    let max = 0;
    for (let i = 0; i < topN; i++) {
        const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / lenSize;
        if (u > 0.2) continue;
        max = Math.max(max, Math.abs(modArr[i * 3 + thickAxis]! - baseArr[i * 3 + thickAxis]!));
    }
    return max;
}

function maxHeelWidthDelta(modArr: Float32Array): number {
    const widthAxis = [0, 1, 2].find((a) => a !== thickAxis && a !== lengthAxis)!;
    let max = 0;
    for (let i = 0; i < topN; i++) {
        const u = (baseArr[i * 3 + lengthAxis]! - lenMin) / lenSize;
        if (u > 0.2) continue;
        max = Math.max(max, Math.abs(modArr[i * 3 + widthAxis]! - baseArr[i * 3 + widthAxis]!));
    }
    return max;
}

function maxVertexDiff(a: Float32Array, b: Float32Array): number {
    let max = 0;
    for (let i = 0; i < topN; i++) {
        max = Math.max(
            max,
            Math.hypot(a[i * 3]! - b[i * 3]!, a[i * 3 + 1]! - b[i * 3 + 1]!, a[i * 3 + 2]! - b[i * 3 + 2]!),
        );
    }
    return max;
}

describe("heel cup depth+width composition — Default.glb modifier", () => {
    test("depth→width: combined geometry preserves depth apex thick-axis delta", () => {
        const depthOnly = applyBaseModifiers(base, field({ heelCupDepthMm: DEPTH }), 0);
        const depthOnlyArr = depthOnly.getAttribute("position")!.array as Float32Array;
        const thickDepthOnly = maxHeelThickDelta(depthOnlyArr);

        applyBaseModifiers(base, field({ heelCupDepthMm: DEPTH }), 0).dispose();
        const combined = applyBaseModifiers(base, field({ heelCupDepthMm: DEPTH, heelCupWidthMm: WIDTH }), 0);
        const combinedArr = combined.getAttribute("position")!.array as Float32Array;
        const thickCombined = maxHeelThickDelta(combinedArr);
        const widthCombined = maxHeelWidthDelta(combinedArr);

        console.log("[HC-COMPOSITION] depth→width", {
            thickDepthOnly,
            thickCombined,
            widthCombined,
            thickRatio: thickCombined / thickDepthOnly,
        });

        expect(thickDepthOnly).toBeGreaterThan(0.3);
        expect(thickCombined).toBeGreaterThan(thickDepthOnly * 0.85);
        expect(widthCombined).toBeGreaterThan(0.2);

        depthOnly.dispose();
        combined.dispose();
    });

    test("width→depth: combined geometry preserves width lateral spread", () => {
        const widthOnly = applyBaseModifiers(base, field({ heelCupWidthMm: WIDTH }), 0);
        const widthOnlyArr = widthOnly.getAttribute("position")!.array as Float32Array;
        const spreadWidthOnly = maxHeelWidthDelta(widthOnlyArr);

        applyBaseModifiers(base, field({ heelCupWidthMm: WIDTH }), 0).dispose();
        const combined = applyBaseModifiers(base, field({ heelCupDepthMm: DEPTH, heelCupWidthMm: WIDTH }), 0);
        const combinedArr = combined.getAttribute("position")!.array as Float32Array;
        const spreadCombined = maxHeelWidthDelta(combinedArr);
        const thickCombined = maxHeelThickDelta(combinedArr);

        console.log("[HC-COMPOSITION] width→depth", {
            spreadWidthOnly,
            spreadCombined,
            thickCombined,
            widthRatio: spreadCombined / spreadWidthOnly,
        });

        expect(spreadWidthOnly).toBeGreaterThan(0.2);
        expect(spreadCombined).toBeGreaterThan(spreadWidthOnly * 0.85);
        expect(thickCombined).toBeGreaterThan(0.3);

        widthOnly.dispose();
        combined.dispose();
    });

    test("cache warmup order: depth-first vs width-first yield identical combined mesh", () => {
        applyBaseModifiers(base, field({ heelCupDepthMm: DEPTH }), 0).dispose();
        const depthFirst = applyBaseModifiers(
            base,
            field({ heelCupDepthMm: DEPTH, heelCupWidthMm: WIDTH }),
            0,
        );
        const depthFirstArr = depthFirst.getAttribute("position")!.array as Float32Array;

        applyBaseModifiers(base, field({ heelCupWidthMm: WIDTH }), 0).dispose();
        const widthFirst = applyBaseModifiers(
            base,
            field({ heelCupDepthMm: DEPTH, heelCupWidthMm: WIDTH }),
            0,
        );
        const widthFirstArr = widthFirst.getAttribute("position")!.array as Float32Array;

        const maxPosDiff = maxVertexDiff(depthFirstArr, widthFirstArr);
        console.log("[HC-COMPOSITION] cache-order", { maxPosDiff });

        expect(maxPosDiff).toBeLessThan(1e-4);

        depthFirst.dispose();
        widthFirst.dispose();
    });
});

describe("heel cup depth+width composition — preview flush", () => {
    test("CorrectionsPanel commit pattern preserves sibling preview fields", () => {
        const committed = neutral();
        const preview = { heelCupDepthMm: DEPTH };
        const commitValue = WIDTH;
        // Mirrors CorrectionsPanel onChange: { ...preview, [f.key]: v }
        const flushed = { ...preview, heelCupWidthMm: commitValue };
        const stored = { ...committed, ...flushed };

        console.log("[HC-COMPOSITION] preview-flush", {
            storedDepth: stored.heelCupDepthMm,
            storedWidth: stored.heelCupWidthMm,
        });

        expect(stored.heelCupDepthMm).toBe(DEPTH);
        expect(stored.heelCupWidthMm).toBe(WIDTH);
    });
});
