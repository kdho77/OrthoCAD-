// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, test } from "@rstest/core";
import type { Box3 } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    countSelfIntersections,
    extractTopOnlyModel,
    reconstructionManifold,
    reconstructProceduralWalls,
} from "@/lib/geometry/procedural-wall";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import type { Side, SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";

function neutralCorrections(): SideCorrections {
    return {
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
        forefootWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

function field(side: Side, patch: Partial<SideCorrections>): HeightFieldParams {
    return {
        side,
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...neutralCorrections(), ...patch },
        elements: [],
        includeSkives: true,
        includeElements: true,
        trimline: null,
    };
}

function detectAxes(box: Box3): { lengthAxis: number; widthAxis: number } {
    const sizes: [number, number][] = [
        [0, box.max.x - box.min.x],
        [1, box.max.y - box.min.y],
        [2, box.max.z - box.min.z],
    ];
    sizes.sort((a, b) => a[1] - b[1]);
    return { lengthAxis: sizes[2]![0], widthAxis: sizes[1]![0] };
}

function measurePlanformWidthMm(geo: import("three").BufferGeometry, uTarget: number, uBand = 0.025): number {
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const { lengthAxis, widthAxis } = detectAxes(box);
    const min = [box.min.x, box.min.y, box.min.z] as const;
    const size = [
        box.max.x - box.min.x || 1,
        box.max.y - box.min.y || 1,
        box.max.z - box.min.z || 1,
    ] as const;
    const lenMin = min[lengthAxis];
    const lenSize = size[lengthAxis];
    const pos = geo.getAttribute("position")!.array as Float32Array;
    const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? pos.length / 3;
    let minW = Infinity;
    let maxW = -Infinity;
    for (let i = 0; i < topN; i++) {
        const lenCoord = pos[i * 3 + lengthAxis]!;
        const u = (lenCoord - lenMin) / lenSize;
        if (u < uTarget - uBand || u > uTarget + uBand) continue;
        const w = pos[i * 3 + widthAxis]!;
        minW = Math.min(minW, w);
        maxW = Math.max(maxW, w);
    }
    if (!Number.isFinite(minW) || !Number.isFinite(maxW)) return 0;
    return maxW - minW;
}

function outlineCurvatureMax(geo: import("three").BufferGeometry, uMin: number, uMax: number): number {
    const bins = 40;
    const widths: number[] = [];
    for (let b = 0; b < bins; b++) {
        const u = uMin + (b / (bins - 1)) * (uMax - uMin);
        widths.push(measurePlanformWidthMm(geo, u, 0.012));
    }
    let maxK = 0;
    for (let i = 1; i < widths.length - 1; i++) {
        const k = Math.abs(widths[i + 1]! - 2 * widths[i]! + widths[i - 1]!);
        maxK = Math.max(maxK, k);
    }
    return maxK;
}

function positionsEqual(a: Float32Array, b: Float32Array): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function stlGates(stlPath: string): { watertight: boolean; selfIntersections?: number } {
    const helper = resolve(process.cwd(), "tests/helpers/stl-gates.py");
    const out = execFileSync("python3", [helper, "forefoot-width", stlPath], { encoding: "utf8" });
    const parsed = JSON.parse(out) as { watertight: boolean };
    return parsed;
}

describe("forefoot width correction", () => {
    test("forefootWidthMm=0 is byte-identical to baseline mesh", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "right" });
        const baseline = applyBaseModifiers(raw, field("right", {}), 0);
        const withZero = applyBaseModifiers(raw, field("right", { forefootWidthMm: 0 }), 0);
        const a = baseline.getAttribute("position")!.array as Float32Array;
        const b = withZero.getAttribute("position")!.array as Float32Array;
        expect(positionsEqual(a, b)).toBe(true);
        baseline.dispose();
        withZero.dispose();
        raw.dispose();
    });

    test("+5 mm widens forefoot at u=0.75 by ~5 mm on both feet; heel at u=0.2 unchanged", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "right" });
        const baseField = field("right", {});
        const wideField = field("right", { forefootWidthMm: 5 });
        const baseGeo = applyBaseModifiers(raw, baseField, 0);
        const wideGeo = applyBaseModifiers(raw, wideField, 0);

        const wBase75 = measurePlanformWidthMm(baseGeo, 0.75);
        const wWide75 = measurePlanformWidthMm(wideGeo, 0.75);
        const delta75 = wWide75 - wBase75;
        expect(delta75).toBeGreaterThan(4.7);
        expect(delta75).toBeLessThan(5.3);

        const wBase20 = measurePlanformWidthMm(baseGeo, 0.2);
        const wWide20 = measurePlanformWidthMm(wideGeo, 0.2);
        expect(Math.abs(wWide20 - wBase20)).toBeLessThan(0.05);

        const rawLeft = await loadProductionDefaultGlb({ slot: "left" });
        const baseLeft = applyBaseModifiers(rawLeft, field("left", {}), 0);
        const wideLeft = applyBaseModifiers(rawLeft, field("left", { forefootWidthMm: 5 }), 0);
        const dLeft = measurePlanformWidthMm(wideLeft, 0.75) - measurePlanformWidthMm(baseLeft, 0.75);
        expect(dLeft).toBeGreaterThan(4.7);
        expect(dLeft).toBeLessThan(5.3);

        console.log("[FOREFOOT-WIDTH] +5mm", {
            rightDelta75: delta75,
            leftDelta75: dLeft,
            heelDelta20: wWide20 - wBase20,
        });

        baseGeo.dispose();
        wideGeo.dispose();
        baseLeft.dispose();
        wideLeft.dispose();
        raw.dispose();
        rawLeft.dispose();
    });

    test("outline curvature u∈[0.4,0.7] within 1.5× baseline at +5 mm", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "right" });
        const baseGeo = applyBaseModifiers(raw, field("right", {}), 0);
        const wideGeo = applyBaseModifiers(raw, field("right", { forefootWidthMm: 5 }), 0);
        const kBase = outlineCurvatureMax(baseGeo, 0.4, 0.7);
        const kWide = outlineCurvatureMax(wideGeo, 0.4, 0.7);
        expect(kWide).toBeLessThanOrEqual(kBase * 1.5 + 1e-6);
        baseGeo.dispose();
        wideGeo.dispose();
        raw.dispose();
    });

    test("procedural STL at ±10 mm is watertight with 0 self-intersections", async () => {
        const original = await loadSampleTopGlb();
        const model = extractTopOnlyModel(original, { id: "sample-top", name: "SAMPLE_Top" });
        for (const forefootWidthMm of [10, -10]) {
            const geometry = reconstructProceduralWalls(model, {
                corrections: { ...neutralCorrections(), forefootWidthMm },
                flatPlantar: true,
            });
            const man = reconstructionManifold(geometry);
            expect(man.watertight).toBe(true);
            expect(countSelfIntersections(geometry).real).toBe(0);

            const dir = mkdtempSync(join(tmpdir(), "forefoot-stl-"));
            const stlPath = join(dir, `fore-${forefootWidthMm}.stl`);
            writeFileSync(stlPath, Buffer.from(geometryToBinarySTL(geometry)));
            const gates = stlGates(stlPath);
            expect(gates.watertight).toBe(true);

            geometry.dispose();
        }
        original.dispose();
    });
});
