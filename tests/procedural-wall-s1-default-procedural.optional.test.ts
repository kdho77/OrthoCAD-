// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * NON-REQUIRED Default.glb procedural smokes.
 * Retired from test-and-deploy (CAD freeze @ a2f7cc61). Job: default-procedural-smoke.
 *
 * Tracking: GitHub Issues are disabled on kdho77/OrthoCAD-. Residuals are this
 * job's report plus the PR #180 CAD-gate comment. Known a2f7cc61 residuals:
 *   widen+6  dk/ds ≈ 0.0283  (gate 0.02)
 *   widen+10 dk/ds ≈ 0.0448  (gate 0.02)
 */

import { writeFileSync } from "node:fs";
import { describe, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { heelCupWidthLongitudinalEnvelope } from "@/lib/geometry/height-field";
import {
    countSelfIntersections,
    extractStockWallModel,
    movedPatternHygiene,
    PATTERN_MAX_DKDS,
    plantarFlatDeltaMm,
    reconstructionManifold,
    reconstructProceduralWalls,
    windingReport,
} from "@/lib/geometry/procedural-wall";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";

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

describe("Default procedural smokes (non-required residuals)", () => {
    test("smoke: widen +6/+10, t4, lift 10, posting 4deg, grind 3", async () => {
        const original = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(original, { id: "default", name: "Default" });
        const smokes: Array<{
            name: string;
            patch: Partial<SideCorrections>;
            thicknessMm?: number;
            archGrindDepthMm?: number;
            insoleWidthScale?: number;
        }> = [
            { name: "widen+6", patch: { heelCupWidthMm: 6 } },
            { name: "widen+10", patch: { heelCupWidthMm: 10 } },
            { name: "width+5", patch: {}, insoleWidthScale: 1.05 },
            { name: "t2", patch: {}, thicknessMm: 2 },
            { name: "t4", patch: {}, thicknessMm: 4 },
            { name: "heel-lift-10", patch: { heelLiftMm: 10 } },
            { name: "posting-4", patch: { rearfootPostingDeg: 4 } },
            { name: "grind-3", patch: {}, archGrindDepthMm: 3 },
        ];
        const results: Array<Record<string, number | string | boolean>> = [];
        const smokeMiss: string[] = [];
        const residuals: Array<Record<string, number | string>> = [];
        for (const smoke of smokes) {
            let rebuilt: BufferGeometry;
            try {
                rebuilt = reconstructProceduralWalls(model, {
                    corrections: { ...neutralCorrections(), ...smoke.patch },
                    thicknessMm: smoke.thicknessMm,
                    stockThicknessMm: 3,
                    archGrindDepthMm: smoke.archGrindDepthMm,
                    insoleWidthScale: smoke.insoleWidthScale,
                });
            } catch (err) {
                smokeMiss.push(`${smoke.name} reconstruct: ${String(err)}`);
                continue;
            }
            const hits = countSelfIntersections(rebuilt);
            const man = reconstructionManifold(rebuilt);
            const wind = windingReport(rebuilt);
            const ring =
                (rebuilt.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> })
                    .outlineRing ?? [];
            const sign = (rebuilt.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1;
            let dkds = 0;
            let infl = 0;
            if (ring.length >= 8) {
                const movedAt =
                    smoke.name === "width+5"
                        ? () => true
                        : (u: number) => heelCupWidthLongitudinalEnvelope(u) > 1e-6 || (u >= 0 && u <= 0.42);
                const hy = movedPatternHygiene(ring, model.bounds, sign, {
                    maxInflections: 4,
                    movedAt,
                });
                dkds = hy.report.maxAbsDkDs;
                infl = hy.report.inflections;
                if (smoke.name.startsWith("widen") || smoke.name === "width+5") {
                    for (const m of hy.misses) smokeMiss.push(`${smoke.name} ${m}`);
                }
            }
            residuals.push({
                smoke: smoke.name,
                dkds,
                gate: PATTERN_MAX_DKDS,
                residual: Number((dkds - PATTERN_MAX_DKDS).toFixed(4)),
                infl,
                SI: hits.real,
                watertight: man.watertight ? 1 : 0,
                NM: man.nonManifoldEdges,
                winding: wind.consistent ? 1 : 0,
            });
            if (hits.real !== 0) smokeMiss.push(`${smoke.name} xi=${hits.real}`);
            if (!man.watertight) smokeMiss.push(`${smoke.name} open=${man.openEdges}`);
            if (man.nonManifoldEdges !== 0)
                smokeMiss.push(`${smoke.name} nonManifold=${man.nonManifoldEdges}`);
            if (!wind.consistent || wind.signedVolume <= 0 || wind.oppositeEdgeMismatch !== 0) {
                smokeMiss.push(`${smoke.name} winding mismatch=${wind.oppositeEdgeMismatch}`);
            }
            if (smoke.name === "posting-4" || smoke.name === "heel-lift-10" || smoke.name === "grind-3") {
                const flat = plantarFlatDeltaMm(rebuilt);
                if (flat > 1e-3) smokeMiss.push(`${smoke.name} plantar-z0 ${flat.toFixed(4)}`);
            }
            results.push({
                smoke: smoke.name,
                SI: hits.real,
                watertight: man.watertight,
                NM: man.nonManifoldEdges,
                dkds,
            });
            rebuilt.dispose();
        }
        writeFileSync(
            "/tmp/s1-default-procedural-residuals.json",
            JSON.stringify({ residuals, smokeMiss }, null, 2),
        );
        console.log("[S1-DEFAULT-PROCEDURAL-RESIDUALS]", JSON.stringify({ residuals, smokeMiss }, null, 2));
        original.dispose();
        if (smokeMiss.length) {
            throw new Error(
                `[S1-SMOKE] Default procedural residuals (non-required). STOP.\n` +
                    `misses: ${smokeMiss.join("; ")}\n` +
                    `residuals: ${JSON.stringify(residuals)}`,
            );
        }
    }, 300_000);
});
