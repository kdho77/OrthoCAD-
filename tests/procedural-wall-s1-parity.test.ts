// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * S1 planform-column loft: tiered Hausdorff, non-crossing frame, BVH
 * self-intersection, fold gates, sole-UV, and modifier smoke (no smoothing).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    assertNonCrossing,
    countSelfIntersections,
    extractStockWallModel,
    FOLD_HARD_LIMIT_DEG,
    FOLD_WORST_LIMIT_DEG,
    foldReport,
    minWallThicknessMm,
    reconstructionManifold,
    reconstructProceduralWalls,
    S1_HAUSDORFF,
    S1_MIN_WALL_MM,
    S1_PROFILE_RESIDUAL_MM,
    soleUvFrameFromOutline,
    soleUvFrameFromPolyline,
    tieredHausdorffReport,
    zoneFixturesMapIdentically,
} from "@/lib/geometry/procedural-wall";
import { listStockBaseFixtures } from "@/lib/geometry/procedural-wall/catalog";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

async function loadFixture(path: string): Promise<BufferGeometry> {
    const buf = readFileSync(path);
    const group = await loadGlbFromBuffer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    const merged = extractMergedGeometry(group);
    if (!merged) throw new Error(`No geometry in ${path}`);
    const reoriented = reorientToFootprintFrame(merged.geometry);
    merged.geometry.dispose();
    return reoriented;
}

function neutralCorrections(): SideCorrections {
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

describe("S1 planform-column loft", () => {
    const fixtures = listStockBaseFixtures();

    test("per-base tiered parity: Hausdorff, folds, BVH, non-crossing, sole-UV", async () => {
        const rows: Array<Record<string, number | string | boolean>> = [];
        for (const fixture of fixtures) {
            const original = await loadFixture(fixture.path);
            const model = extractStockWallModel(original, { id: fixture.id, name: fixture.name });
            expect(model.planform).toBeTruthy();
            expect(model.columns?.length).toBeGreaterThan(16);
            expect(assertNonCrossing(model.planform!)).toBe(true);
            const maxRes = model.columns!.reduce((m, c) => Math.max(m, c.residualMm), 0);
            expect(model.planform!.detSignStable).toBe(true);

            const rebuilt = reconstructProceduralWalls(model);
            const haus = tieredHausdorffReport(original, rebuilt, model);
            const fold = foldReport(rebuilt);
            const man = reconstructionManifold(rebuilt);
            const hits = countSelfIntersections(rebuilt);
            const minWall = minWallThicknessMm(model);
            const uvOk = zoneFixturesMapIdentically(
                soleUvFrameFromOutline(model.outline),
                soleUvFrameFromPolyline(model.outline.spline.controls),
            );

            const row = {
                base: fixture.name,
                topMax: Number(haus.top.maxMm.toFixed(4)),
                plantarMax: Number(haus.plantar.maxMm.toFixed(4)),
                rimMax: Number(haus.rim.maxMm.toFixed(4)),
                outlineMax: Number(haus.outline.maxMm.toFixed(4)),
                wallMax: Number(haus.wall.maxMm.toFixed(4)),
                wallP99: Number(haus.wall.p99Mm.toFixed(4)),
                wallMean: Number(haus.wall.meanMm.toFixed(4)),
                heelCupMax: Number(haus.heelCup.maxMm.toFixed(4)),
                foldWorstDeg: Number(fold.worstDeg.toFixed(3)),
                foldGe10: fold.edgesAtLeast10Deg,
                selfIntersections: hits,
                minWallMm: Number(minWall.toFixed(3)),
                openEdges: man.openEdges,
                nonManifold: man.nonManifoldEdges,
                watertight: man.watertight,
                nonCrossing: assertNonCrossing(model.planform!),
                soleUvIdentical: uvOk,
                profileResidual: Number(maxRes.toFixed(4)),
            };
            rows.push(row);
            writeFileSync("/tmp/s1-parity.json", JSON.stringify(rows, null, 2));

            expect(man.watertight).toBe(true);
            expect(man.openEdges).toBe(0);
            expect(man.nonManifoldEdges).toBe(0);
            expect(uvOk).toBe(true);
            expect(assertNonCrossing(model.planform!)).toBe(true);
            expect(hits).toBe(0);
            expect(fold.worstDeg).toBeLessThanOrEqual(FOLD_WORST_LIMIT_DEG);
            expect(fold.edgesAtLeast10Deg).toBe(0);
            expect(FOLD_HARD_LIMIT_DEG).toBe(10);
            expect(minWall).toBeGreaterThanOrEqual(S1_MIN_WALL_MM);

            const misses: string[] = [];
            if (haus.top.maxMm > S1_HAUSDORFF.topMax) misses.push(`top ${haus.top.maxMm.toFixed(3)}`);
            if (haus.plantar.maxMm > S1_HAUSDORFF.plantarMax)
                misses.push(`plantar ${haus.plantar.maxMm.toFixed(3)}`);
            if (haus.rim.maxMm > S1_HAUSDORFF.curveMax) misses.push(`rim ${haus.rim.maxMm.toFixed(3)}`);
            if (haus.outline.maxMm > S1_HAUSDORFF.curveMax)
                misses.push(`outline ${haus.outline.maxMm.toFixed(3)}`);
            if (haus.wall.maxMm > S1_HAUSDORFF.wallMax) misses.push(`wall-max ${haus.wall.maxMm.toFixed(3)}`);
            if (haus.wall.p99Mm > S1_HAUSDORFF.wallP99) misses.push(`wall-p99 ${haus.wall.p99Mm.toFixed(3)}`);
            if (haus.wall.meanMm > S1_HAUSDORFF.wallMean)
                misses.push(`wall-mean ${haus.wall.meanMm.toFixed(3)}`);
            if (haus.heelCup.maxMm > S1_HAUSDORFF.heelCupMax)
                misses.push(`heel ${haus.heelCup.maxMm.toFixed(3)}`);
            if (maxRes > S1_PROFILE_RESIDUAL_MM) misses.push(`fit ${maxRes.toFixed(3)}`);
            if (misses.length) {
                throw new Error(`[S1-GAP] ${fixture.name}: ${misses.join("; ")}`);
            }

            rebuilt.dispose();
            original.dispose();
        }
    }, 240_000);

    test("smoke: widen +6/+10, t4, heel lift 10 — no intersections, fold gates, no smoothing", async () => {
        const original = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(original, { id: "default", name: "Default" });
        const smokes: Array<{ name: string; patch: Partial<SideCorrections>; thicknessMm?: number }> = [
            { name: "widen+6", patch: { heelCupWidthMm: 6 } },
            { name: "widen+10", patch: { heelCupWidthMm: 10 } },
            { name: "t4", patch: {}, thicknessMm: 4 },
            { name: "heel-lift-10", patch: { heelLiftMm: 10 } },
        ];
        const results: Array<Record<string, number | string | boolean>> = [];
        for (const smoke of smokes) {
            const rebuilt = reconstructProceduralWalls(model, {
                corrections: { ...neutralCorrections(), ...smoke.patch },
                thicknessMm: smoke.thicknessMm,
                stockThicknessMm: 3,
            });
            const fold = foldReport(rebuilt);
            const hits = countSelfIntersections(rebuilt);
            const man = reconstructionManifold(rebuilt);
            results.push({
                smoke: smoke.name,
                selfIntersections: hits,
                foldWorstDeg: Number(fold.worstDeg.toFixed(3)),
                foldGe10: fold.edgesAtLeast10Deg,
                watertight: man.watertight,
                openEdges: man.openEdges,
            });
            expect(hits).toBe(0);
            expect(fold.worstDeg).toBeLessThanOrEqual(FOLD_WORST_LIMIT_DEG);
            expect(fold.edgesAtLeast10Deg).toBe(0);
            expect(man.watertight).toBe(true);
            rebuilt.dispose();
        }
        writeFileSync("/tmp/s1-smoke.json", JSON.stringify(results, null, 2));
        original.dispose();
    }, 240_000);

    test("legacy default path is unchanged", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const field: HeightFieldParams = {
            side: "left",
            lengthMm: 266,
            widthMm: 95,
            thicknessMm: 3,
            corrections: { ...neutralCorrections(), archHeightMm: 8 },
            elements: [],
            includeSkives: true,
            includeElements: true,
            trimline: null,
        };
        const modified = applyBaseModifiers(raw, field, 0);
        const a = raw.getAttribute("position")!.array as Float32Array;
        const b = modified.getAttribute("position")!.array as Float32Array;
        expect(a.length).toBe(b.length);
        let max = 0;
        for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i]! - b[i]!));
        expect(max).toBeGreaterThan(0.5);
        modified.dispose();
        raw.dispose();
    }, 60_000);
});
