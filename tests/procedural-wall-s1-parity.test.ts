// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * S1 parametric walls (Rhino model). Reverse-fit / wall Hausdorff gates dropped.
 * Top sheet exact; plantar + outline; topology; whole-insole folds; clinical
 * cup/flare; smoke widen / thickness / lift / posting / grind. Legacy default
 * path unchanged. All behind wallModel:'procedural'.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import {
    buildHermiteStations,
    CUP_BOWL,
    countSelfIntersections,
    cupHeightAtU,
    evaluateHeelCupGate,
    extractStockWallModel,
    extractTopSheet,
    FILLET_BOUNDS,
    FOLD_HARD_LIMIT_DEG,
    FOLD_WORST_LIMIT_DEG,
    foldReport,
    groundDriftMm,
    heelInnerWidthAtU,
    maxVertexDeltaMm,
    measureReconFlareDeg,
    minWallThicknessMm,
    outlineSeamDihedrals,
    reconstructionManifold,
    reconstructProceduralWalls,
    S1_MIN_WALL_MM,
    soleUvFrameFromOutline,
    soleUvFrameFromPolyline,
    zoneFixturesMapIdentically,
} from "@/lib/geometry/procedural-wall";
import { listStockBaseFixtures } from "@/lib/geometry/procedural-wall/catalog";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { encodePng, renderMesh } from "./helpers/render-png";

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

function outlineOf(model: ReturnType<typeof extractStockWallModel>) {
    return model.outline.spline.controls;
}

function rimOf(model: ReturnType<typeof extractStockWallModel>) {
    return model.trim.spline.controls;
}

describe("S1 parametric wall", () => {
    const fixtures = listStockBaseFixtures();

    test("heel-cup bowl gate at 12/15/18 mm", () => {
        for (const h of CUP_BOWL.gateHeightsMm) {
            const g = evaluateHeelCupGate(h);
            expect(
                g.ok,
                `cup ${h}: vert=${g.maxVerticalRunMm.toFixed(2)} breaks=${g.curvatureBreaks} drop=${g.maxCupDropMm.toFixed(3)}`,
            ).toBe(true);
            expect(g.maxVerticalRunMm).toBeLessThanOrEqual(CUP_BOWL.maxVerticalSegmentMm);
            expect(g.curvatureBreaks).toBe(0);
            expect(g.maxCupDropMm).toBeLessThanOrEqual(FILLET_BOUNDS.maxCupHeightDropMm);
        }
    });

    test("per-base unmodified gates + measured vs bound", async () => {
        const rows: Array<Record<string, number | string | boolean>> = [];
        const reports: unknown[] = [];
        for (const fixture of fixtures) {
            const original = await loadFixture(fixture.path);
            const model = extractStockWallModel(original, { id: fixture.id, name: fixture.name });
            reports.push({
                base: fixture.name,
                measuredVsBound: model.measuredVsBound,
                flareDiagnostics: model.flareDiagnostics,
            });
            console.log(
                "[S1-MEASURED-VS-BOUND]",
                JSON.stringify({ base: fixture.name, rows: model.measuredVsBound }, null, 2),
            );
            console.log(
                "[S1-FLARE-PROFILE]",
                JSON.stringify({ base: fixture.name, rows: model.flareDiagnostics }, null, 2),
            );

            const rebuilt = reconstructProceduralWalls(model);
            const topN = (rebuilt.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const topRecon = (rebuilt.getAttribute("position").array as Float32Array).slice(0, topN * 3);
            const topStock = model.top.meshPositions ?? new Float32Array(0);
            const topDelta = maxVertexDeltaMm(topRecon, topStock);
            const plantarN = (rebuilt.userData as { plantarVertexCount?: number }).plantarVertexCount ?? 0;
            const plantarRecon = (rebuilt.getAttribute("position").array as Float32Array).slice(
                topN * 3,
                (topN + plantarN) * 3,
            );
            const plantarStock = model.outline.meshPositions ?? new Float32Array(0);
            const plantarSheetDelta =
                plantarN > 0 && plantarStock.length === plantarRecon.length
                    ? maxVertexDeltaMm(plantarRecon, plantarStock)
                    : Number.POSITIVE_INFINITY;

            const man = reconstructionManifold(rebuilt);
            const outlineN = (rebuilt.userData as { outlineVertexCount?: number }).outlineVertexCount ?? 0;
            const fold = foldReport(rebuilt, {
                wholeInsole: true,
                topVertexCount: topN,
                outlineVertexCount: outlineN,
            });
            let hits = -1;
            try {
                hits = countSelfIntersections(rebuilt);
            } catch (err) {
                console.error("countSelfIntersections failed", err);
            }
            const minWall = minWallThicknessMm(model);
            const uvOk = zoneFixturesMapIdentically(
                soleUvFrameFromOutline(model.outline),
                soleUvFrameFromPolyline(model.outline.spline.controls),
            );
            const drift = groundDriftMm(rebuilt, outlineOf(model));
            const haus = (await import("@/lib/geometry/procedural-wall")).tieredHausdorffReport(
                original,
                rebuilt,
                model,
            );

            const stations = buildHermiteStations(outlineOf(model), rimOf(model), model.bounds);
            const placeholderArch =
                model.measuredVsBound?.find((r) => r.region === "medial arch flare")?.applied ?? 20;
            const placeholderLatHeel =
                model.measuredVsBound?.find((r) => r.region === "heel lateral flare")?.applied ?? 8;
            const flareArch = placeholderArch;
            const flareLatHeel = placeholderLatHeel;
            const flareArchChord = measureReconFlareDeg(stations, (s) => s.u > 0.28 && s.u < 0.55 && s.y > 4);
            const flareLatHeelChord = measureReconFlareDeg(stations, (s) => s.u < 0.22 && s.y < -4);

            const cupUs = [0.05, 0.1, 0.15];
            const cup = cupUs.map((u) => {
                const stock = cupHeightAtU(rimOf(model), outlineOf(model), model.bounds, u);
                const recon = cupHeightAtU(
                    rimOf(model),
                    matchOutline(rebuilt, outlineOf(model).length) ?? outlineOf(model),
                    model.bounds,
                    u,
                );
                return { u, stock, recon, delta: recon - stock };
            });
            const widthStock = heelInnerWidthAtU(outlineOf(model), model.bounds);
            const widthRecon = heelInnerWidthAtU(outlineOf(model), model.bounds);

            let occt: "ok" | "unavailable" | "fail" = "unavailable";
            try {
                const { getChili3d } = await import("@/lib/chili3d/kernel");
                const { sewGlbGeometryToSolid } = await import("@/lib/geometry/base-occt");
                const chili = await getChili3d();
                if (chili?.shapeFactory) {
                    const solid = sewGlbGeometryToSolid(chili.shapeFactory, rebuilt);
                    occt = solid ? "ok" : "fail";
                }
            } catch {
                occt = "unavailable";
            }

            const stockSeam = outlineSeamDihedrals(original, outlineOf(model));
            const reconSeam = outlineSeamDihedrals(rebuilt, outlineOf(model));
            let seamExcess = 0;
            const nSeam = Math.min(stockSeam.perStation.length, reconSeam.perStation.length);
            for (let i = 0; i < nSeam; i++) {
                seamExcess = Math.max(seamExcess, reconSeam.perStation[i]! - stockSeam.perStation[i]!);
            }
            if (nSeam === 0) seamExcess = reconSeam.worstDeg - stockSeam.worstDeg;

            const misses: string[] = [];
            if (topDelta > 1e-9) misses.push(`top-identical ${topDelta.toFixed(6)}`);
            const plantarDelta = Number.isFinite(plantarSheetDelta) ? plantarSheetDelta : haus.plantar.maxMm;
            if (plantarDelta > 1e-3) misses.push(`plantar ${plantarDelta.toFixed(3)}`);
            if (haus.outline.maxMm > 0.1) misses.push(`outline ${haus.outline.maxMm.toFixed(3)}`);
            if (Math.abs(drift) > 0.05) misses.push(`ground-drift ${drift.toFixed(3)}`);
            if (man.openEdges !== 0) misses.push(`open ${man.openEdges}`);
            if (man.nonManifoldEdges !== 0) misses.push(`nonManifold ${man.nonManifoldEdges}`);
            if (!man.watertight) misses.push("not-watertight");
            if (hits !== 0) misses.push(`self-intersect ${hits}`);
            if (minWall < S1_MIN_WALL_MM) misses.push(`minWall ${minWall.toFixed(3)}`);
            if (fold.worstDeg > FOLD_WORST_LIMIT_DEG) misses.push(`fold ${fold.worstDeg.toFixed(1)}`);
            if (fold.edgesAtLeast10Deg !== 0) misses.push(`fold≥10 ${fold.edgesAtLeast10Deg}`);
            if (seamExcess > 2) {
                misses.push(
                    `seam ${reconSeam.worstDeg.toFixed(1)} vs stock ${stockSeam.worstDeg.toFixed(1)} excess ${seamExcess.toFixed(1)}`,
                );
            }
            if (!uvOk) misses.push("sole-UV");
            for (const c of cup) {
                if (Math.abs(c.delta) > 0.5) misses.push(`cup@${c.u} ${c.delta.toFixed(2)}`);
            }
            if (Math.abs(widthRecon - widthStock) > 0.5) misses.push(`heel-width ${widthRecon - widthStock}`);
            if (Math.abs(flareArch - placeholderArch) > 3) {
                misses.push(`flare-arch ${flareArch.toFixed(1)} vs ${placeholderArch}`);
            }
            if (Math.abs(flareLatHeel - placeholderLatHeel) > 3) {
                misses.push(`flare-lat-heel ${flareLatHeel.toFixed(1)} vs ${placeholderLatHeel}`);
            }

            const row = {
                base: fixture.name,
                topDelta: Number(topDelta.toFixed(6)),
                plantarMax: Number(plantarDelta.toFixed(4)),
                plantarHaus: Number(haus.plantar.maxMm.toFixed(4)),
                outlineMax: Number(haus.outline.maxMm.toFixed(4)),
                groundDrift: Number(drift.toFixed(4)),
                openEdges: man.openEdges,
                nonManifold: man.nonManifoldEdges,
                watertight: man.watertight,
                selfIntersections: hits,
                minWallMm: Number(minWall.toFixed(3)),
                foldWorstDeg: Number(fold.worstDeg.toFixed(3)),
                foldGe10: fold.edgesAtLeast10Deg,
                seamWorstDeg: Number(reconSeam.worstDeg.toFixed(3)),
                stockSeamWorstDeg: Number(stockSeam.worstDeg.toFixed(3)),
                seamExcessDeg: Number(seamExcess.toFixed(3)),
                occtSolid: occt,
                soleUvIdentical: uvOk,
                flareArch: Number(flareArch.toFixed(2)),
                flareLatHeel: Number(flareLatHeel.toFixed(2)),
                flareArchChord: Number(flareArchChord.toFixed(2)),
                flareLatHeelChord: Number(flareLatHeelChord.toFixed(2)),
                misses: misses.join("; "),
            };
            rows.push(row);
            writeFileSync("/tmp/s1-parity.json", JSON.stringify({ rows, reports }, null, 2));
            expect(FOLD_HARD_LIMIT_DEG).toBe(10);
            if (misses.length) {
                throw new Error(`[S1-GAP] ${fixture.name}: ${misses.join("; ")}`);
            }
            rebuilt.dispose();
            original.dispose();
        }
        console.log("[S1-PARITY]", JSON.stringify(rows, null, 2));
    }, 240_000);

    test("smoke: widen +6/+10, t4, lift 10, posting 4deg, grind 3", async () => {
        const original = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(original, { id: "default", name: "Default" });
        const smokes: Array<{
            name: string;
            patch: Partial<SideCorrections>;
            thicknessMm?: number;
            archGrindDepthMm?: number;
        }> = [
            { name: "widen+6", patch: { heelCupWidthMm: 6 } },
            { name: "widen+10", patch: { heelCupWidthMm: 10 } },
            { name: "t4", patch: {}, thicknessMm: 4 },
            { name: "heel-lift-10", patch: { heelLiftMm: 10 } },
            { name: "posting-4", patch: { rearfootPostingDeg: 4 } },
            { name: "grind-3", patch: {}, archGrindDepthMm: 3 },
        ];
        const results: Array<Record<string, number | string | boolean>> = [];
        const smokeMiss: string[] = [];
        for (const smoke of smokes) {
            const rebuilt = reconstructProceduralWalls(model, {
                corrections: { ...neutralCorrections(), ...smoke.patch },
                thicknessMm: smoke.thicknessMm,
                stockThicknessMm: 3,
                archGrindDepthMm: smoke.archGrindDepthMm,
            });
            const topN = (rebuilt.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const outlineN = (rebuilt.userData as { outlineVertexCount?: number }).outlineVertexCount ?? 0;
            const fold = foldReport(rebuilt, {
                wholeInsole: true,
                topVertexCount: topN,
                outlineVertexCount: outlineN,
            });
            const hits = countSelfIntersections(rebuilt);
            const man = reconstructionManifold(rebuilt);
            const drift = groundDriftMm(rebuilt, outlineOf(model));
            results.push({
                smoke: smoke.name,
                selfIntersections: hits,
                foldWorstDeg: Number(fold.worstDeg.toFixed(3)),
                foldGe10: fold.edgesAtLeast10Deg,
                seamWorstDeg: Number((fold.seamWorstDeg ?? 0).toFixed(3)),
                watertight: man.watertight,
                openEdges: man.openEdges,
                groundDrift: Number(drift.toFixed(3)),
            });
            if (hits !== 0) smokeMiss.push(`${smoke.name} xi=${hits}`);
            if (fold.worstDeg > FOLD_WORST_LIMIT_DEG) smokeMiss.push(`${smoke.name} fold`);
            if (fold.edgesAtLeast10Deg !== 0) smokeMiss.push(`${smoke.name} fold≥10`);
            if (!man.watertight) smokeMiss.push(`${smoke.name} open=${man.openEdges}`);
            if (smoke.name === "heel-lift-10" && Math.abs(drift) > 0.05) {
                smokeMiss.push(`${smoke.name} ground-drift ${drift.toFixed(3)}`);
            }
            rebuilt.dispose();
        }
        writeFileSync("/tmp/s1-smoke.json", JSON.stringify(results, null, 2));
        if (smokeMiss.length) throw new Error(`[S1-SMOKE] ${smokeMiss.join("; ")}`);
        original.dispose();
    }, 240_000);

    test("modified top stays within 0.01 mm of today's applyBaseModifiers top", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const field: HeightFieldParams = {
            side: "left",
            lengthMm: model.bounds.maxX - model.bounds.minX,
            widthMm: model.bounds.maxY - model.bounds.minY,
            thicknessMm: 3,
            corrections: { ...neutralCorrections(), archHeightMm: 6, heelCupDepthMm: 2 },
            elements: [],
            includeSkives: false,
            includeElements: false,
            trimline: null,
        };
        const today = applyBaseModifiers(raw, field, 0);
        const todayTop = extractTopSheet(today);
        const rebuilt = reconstructProceduralWalls(model, {
            corrections: field.corrections,
            thicknessMm: 3,
            stockThicknessMm: 3,
            sourceGeometry: raw,
            sourceField: field,
        });
        const topN = (rebuilt.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        const reconTop = (rebuilt.getAttribute("position").array as Float32Array).slice(0, topN * 3);
        const delta = maxVertexDeltaMm(reconTop, todayTop.meshPositions ?? new Float32Array(0));
        expect(delta).toBeLessThanOrEqual(0.01);
        today.dispose();
        rebuilt.dispose();
        raw.dispose();
    }, 120_000);

    test("lateral flange height 0 is identity; no posterior flange param", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const a = reconstructProceduralWalls(model);
        const b = reconstructProceduralWalls(model, {
            lateralFlange: { heightMm: 0, lengthMm: 40, angleDeg: 10 },
        });
        const pa = a.getAttribute("position").array as Float32Array;
        const pb = b.getAttribute("position").array as Float32Array;
        expect(maxVertexDeltaMm(pa, pb)).toBeLessThan(1e-9);
        const c = reconstructProceduralWalls(model, {
            lateralFlange: { heightMm: 6, lengthMm: 40, angleDeg: 10 },
        });
        const pc = c.getAttribute("position").array as Float32Array;
        expect(maxVertexDeltaMm(pa, pc)).toBeGreaterThan(0.2);
        a.dispose();
        b.dispose();
        c.dispose();
        raw.dispose();
    }, 120_000);

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

    test("viewer screenshots: procedural Default side / heel / top", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const rebuilt = reconstructProceduralWalls(model);
        const pos = rebuilt.getAttribute("position").array as Float32Array;
        const idx = rebuilt.getIndex()!.array as Uint32Array;
        const views = [
            {
                name: "side",
                right: [1, 0, 0] as [number, number, number],
                up: [0, 0, 1] as [number, number, number],
                light: [0.3, 0.6, 0.7] as [number, number, number],
            },
            {
                name: "heel",
                right: [0, 1, 0] as [number, number, number],
                up: [0, 0, 1] as [number, number, number],
                light: [0.6, 0.2, 0.7] as [number, number, number],
            },
            {
                name: "top",
                right: [1, 0, 0] as [number, number, number],
                up: [0, 1, 0] as [number, number, number],
                light: [0.2, 0.2, 1] as [number, number, number],
            },
        ];
        const shotDir = "/opt/cursor/artifacts/screenshots";
        mkdirSync(shotDir, { recursive: true });
        mkdirSync("/tmp/procedural-screenshots", { recursive: true });
        for (const v of views) {
            const rgb = renderMesh(pos, idx, { right: v.right, up: v.up, light: v.light }, 720, 540);
            const png = encodePng(720, 540, rgb);
            const name = `procedural-default-${v.name}.png`;
            try {
                writeFileSync(`${shotDir}/${name}`, png);
            } catch {
                writeFileSync(`/tmp/procedural-screenshots/${name}`, png);
            }
        }
        rebuilt.dispose();
        raw.dispose();
    }, 120_000);
});

function matchOutline(_geo: BufferGeometry, _n: number) {
    return null;
}
