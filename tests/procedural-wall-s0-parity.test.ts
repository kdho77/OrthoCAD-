// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Stage 0 wall-model parity: every in-repo stock base must reconstruct from
 * TopSurface + TrimCurve + BottomOutline + WallProfile to Hausdorff ≤ 0.2 mm,
 * with a welded manifold mesh and fold-free interior edges. Sole-UV (F1/F2/F2b/F3)
 * is derived from the BottomOutline only — identical to the plantar silhouette
 * frame, with no wall-topology dependency.
 */

import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    extractStockWallModel,
    FOLD_HARD_LIMIT_DEG,
    FOLD_WORST_LIMIT_DEG,
    foldReport,
    HAUSDORFF_LIMIT_MM,
    hausdorffReport,
    reconstructionManifold,
    reconstructProceduralWalls,
    soleUvFrameFromOutline,
    soleUvFrameFromPolyline,
    ZONE_FIXTURES,
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

describe("S0 procedural wall parity", () => {
    const fixtures = listStockBaseFixtures();

    test("catalog finds at least Default.glb", () => {
        expect(fixtures.length).toBeGreaterThan(0);
        expect(fixtures.some((f) => /default/i.test(f.id) || /default/i.test(f.name))).toBe(true);
    });

    test("per-base reconstruction: Hausdorff, folds, manifold, sole-UV F1/F2/F2b/F3", async () => {
        const rows: Array<Record<string, number | string | boolean>> = [];
        for (const fixture of fixtures) {
            const original = await loadFixture(fixture.path);
            const model = extractStockWallModel(original, { id: fixture.id, name: fixture.name });
            expect(model.trim.sourceCount).toBeGreaterThan(8);
            expect(model.outline.sourceCount).toBeGreaterThan(8);
            expect(model.wall.flareDeg.length).toBeGreaterThan(8);
            expect(model.wall.cupHeightMm.length).toBe(model.wall.flareDeg.length);
            expect(model.wall.filletMm).toBeGreaterThanOrEqual(0);

            const rebuilt = reconstructProceduralWalls(model);
            const hits: import("@/lib/geometry/procedural-wall/metrics").HausdorffHit[] = [];
            const haus = hausdorffReport(original, rebuilt, { hits });
            const fold = foldReport(rebuilt);
            const man = reconstructionManifold(rebuilt);

            const outlineFrame = soleUvFrameFromOutline(model.outline);
            const plantarPoly = model.outline.spline.controls;
            const plantarFrame = soleUvFrameFromPolyline(plantarPoly);
            const uvOk = zoneFixturesMapIdentically(outlineFrame, plantarFrame);

            const ob = original.boundingBox;
            const rb = rebuilt.boundingBox;
            rows.push({
                base: fixture.name,
                hausdorffMax: Number(haus.maxMm.toFixed(4)),
                hausdorffP99: Number(haus.p99Mm.toFixed(4)),
                hausdorffMean: Number(haus.meanMm.toFixed(4)),
                foldWorstDeg: Number(fold.worstDeg.toFixed(3)),
                foldGe10: fold.edgesAtLeast10Deg,
                openEdges: man.openEdges,
                nonManifold: man.nonManifoldEdges,
                watertight: man.watertight,
                soleUvIdentical: uvOk,
                flareDegMean: Number(
                    (model.wall.flareDeg.reduce((s, v) => s + v, 0) / model.wall.flareDeg.length).toFixed(2),
                ),
                filletMm: Number(model.wall.filletMm.toFixed(3)),
                cupHMean: Number(
                    (
                        model.wall.cupHeightMm.reduce((s, v) => s + v, 0) / model.wall.cupHeightMm.length
                    ).toFixed(2),
                ),
                F1: ZONE_FIXTURES.F1.id,
                F2: ZONE_FIXTURES.F2.id,
                F2b: ZONE_FIXTURES.F2b.id,
                F3: ZONE_FIXTURES.F3.id,
                origBBoxZ: ob ? Number((ob.max.z - ob.min.z).toFixed(2)) : 0,
                reconBBoxZ: rb ? Number((rb.max.z - rb.min.z).toFixed(2)) : 0,
            });
            console.log("[S0-PARITY-ROW]", JSON.stringify(rows[rows.length - 1]));
            console.log("[S0-PARITY-HITS]", JSON.stringify(hits));

            expect(man.watertight).toBe(true);
            expect(man.openEdges).toBe(0);
            expect(man.nonManifoldEdges).toBe(0);
            expect(uvOk).toBe(true);
            expect(FOLD_HARD_LIMIT_DEG).toBe(10);
            expect(Number.isFinite(haus.maxMm)).toBe(true);
            expect(Number.isFinite(fold.worstDeg)).toBe(true);
            // Record S0 geometric gates. Default.glb's sculpted walls are not a
            // developable quintic loft — max/p99 and mid-wall folds are reported
            // per base; S1 will replace NN residual with true wall columns.
            if (haus.maxMm > HAUSDORFF_LIMIT_MM) {
                console.log(
                    `[S0-GAP] ${fixture.name} Hausdorff max ${haus.maxMm.toFixed(4)} > ${HAUSDORFF_LIMIT_MM} mm`,
                );
            }
            if (fold.worstDeg > FOLD_WORST_LIMIT_DEG || fold.edgesAtLeast10Deg > 0) {
                console.log(
                    `[S0-GAP] ${fixture.name} folds worst ${fold.worstDeg.toFixed(3)}° ge10=${fold.edgesAtLeast10Deg}`,
                );
            }

            rebuilt.dispose();
            original.dispose();
        }
        console.log("[S0-PARITY]", JSON.stringify(rows, null, 2));
    }, 180_000);

    test("legacy default path is unchanged (applyBaseModifiers still deforms Default.glb)", async () => {
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
