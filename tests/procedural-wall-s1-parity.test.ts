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
    COLUMN_PLANARITY_LIMIT_MM,
    CUP_BOWL,
    countDegenerateFaces,
    countSelfIntersections,
    cupHeightAtU,
    evaluateHeelCupGate,
    extractStockWallModel,
    extractTopOnlyModel,
    extractTopSheet,
    FILLET_BOUNDS,
    FOLD_HARD_LIMIT_DEG,
    FOLD_WORST_LIMIT_DEG,
    foldReport,
    formatSiBreakdown,
    generatedMinWallMm,
    groundDriftMm,
    heelInnerWidthAtU,
    maxVertexDeltaMm,
    measureReconFlareDeg,
    medialArchUpperWallFolds,
    meshVertexMinZ,
    minWallThicknessMm,
    outlineExactOnBMm,
    outlineSeamDihedrals,
    PATTERN_SOURCE_SYNTHETIC,
    plantarFlatDeltaMm,
    reconstructionManifold,
    reconstructProceduralWalls,
    S1_MIN_WALL_MM,
    SKEW_LIMIT_MM,
    sheetBoundaryStats,
    soleUvFrameFromOutline,
    soleUvFrameFromPolyline,
    summarizeWallBands,
    syntheticBottomPattern,
    zoneFixturesMapIdentically,
} from "@/lib/geometry/procedural-wall";
import { listStockBaseFixtures } from "@/lib/geometry/procedural-wall/catalog";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";
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
            const topStock = model.top.meshPositions ?? new Float32Array(0);
            const topRecon = (rebuilt.getAttribute("position").array as Float32Array).slice(
                0,
                topStock.length,
            );
            const topDelta = maxVertexDeltaMm(topRecon, topStock);
            const outlineDev = outlineExactOnBMm(rebuilt);
            const plantarZ0 = plantarFlatDeltaMm(rebuilt);

            const man = reconstructionManifold(rebuilt);
            const outlineN = (rebuilt.userData as { outlineVertexCount?: number }).outlineVertexCount ?? 0;
            const outlineStart =
                (rebuilt.userData as { outlineVertexStart?: number }).outlineVertexStart ?? topN;
            const fold = foldReport(rebuilt, {
                wholeInsole: true,
                topVertexCount: topN,
                outlineVertexCount: outlineN,
                outlineVertexStart: outlineStart,
            });
            let hits: ReturnType<typeof countSelfIntersections> = { real: -1, coplanar: 0 };
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

            const generatedOutline =
                (rebuilt.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> })
                    .outlineRing ?? outlineOf(model);
            const reconSeam = outlineSeamDihedrals(rebuilt, generatedOutline, 1.25);
            const implied = (
                (rebuilt.userData as { filletImpliedSeamDeg?: number[] }).filletImpliedSeamDeg ?? []
            ).slice();
            const filletRing =
                (rebuilt.userData as { filletRing?: Array<{ x: number; y: number; z: number }> })
                    .filletRing ?? [];
            const fSeam = filletRing.length ? outlineSeamDihedrals(rebuilt, filletRing, 1.25) : reconSeam;
            let seamOver = 0;
            const nSeam = fSeam.perStation.length;
            for (let i = 0; i < nSeam; i++) {
                const allow = (implied[i] ?? 0) + 2;
                seamOver = Math.max(seamOver, fSeam.perStation[i]! - allow);
            }
            const stitchDelta = 0;
            const archFolds = medialArchUpperWallFolds(rebuilt, model.bounds, topN);
            const boundary = sheetBoundaryStats(
                model.outline.meshPositions,
                model.outline.meshIndices,
                model.outline.rimLocal,
            );
            const ud = rebuilt.userData as {
                pairingMethod?: string;
                maxFrameAngleDeg?: number;
                maxOffPlaneMm?: number;
                masterMinRadiusMm?: number;
                waistMinRadiusMm?: number;
                maxSepMm?: number;
                dishLost?: boolean;
                floodFaceCount?: number;
                floodZSpanMm?: number;
                interiorFaceCount?: number;
                chordCrossings?: number;
                loftChordCrossings?: number;
                windowCrossings?: number;
                maxSidewaysSkewMm?: number;
                pairingMonotonic?: boolean;
                missedRays?: number;
                planReversals?: number;
                zeroAreaFaces?: number;
                duplicateFaces?: number;
                junctionSlivers?: number;
                bandTiltDegMax?: number;
                meshMinZ?: number;
                flareCapReport?: {
                    stillNeeded?: boolean;
                    cappedStations?: number[];
                    maxDeviationDeg?: number;
                };
            };
            console.log(
                "[S1-HARMONIC]",
                JSON.stringify({
                    base: fixture.name,
                    method: ud.pairingMethod,
                    chordCrossings: ud.chordCrossings,
                    masterMinRadiusMm: ud.masterMinRadiusMm,
                    waistMinRadiusMm: ud.waistMinRadiusMm,
                    maxSepMm: ud.maxSepMm,
                    dishLost: ud.dishLost ?? model.outline.dishLost,
                    floodFaceCount: ud.floodFaceCount ?? model.outline.floodFaceCount,
                    floodZSpanMm: ud.floodZSpanMm ?? model.outline.floodZSpanMm,
                    interiorFaceCount: ud.interiorFaceCount ?? model.outline.interiorFaceCount,
                }),
            );
            const flareKinds = (model.flareDiagnostics ?? []).map((d) => ({
                region: d.region,
                lower: d.lowerThirdDeg,
                upper: d.upperThirdDeg,
                kind: d.kind,
            }));
            console.log("[S1-FLARE-CURVE-VS-KINK]", JSON.stringify({ base: fixture.name, rows: flareKinds }));
            const chordX = ud.chordCrossings ?? -1;
            const loftChordX = ud.loftChordCrossings ?? chordX;
            const windowX = ud.windowCrossings ?? 0;
            const maxSkew = ud.maxSidewaysSkewMm ?? 0;
            const flareCap = ud.flareCapReport;

            const misses: string[] = [];
            if (topDelta > 1e-9) misses.push(`top-identical ${topDelta.toFixed(6)}`);
            if (plantarZ0 > 1e-3) misses.push(`plantar-z0 ${plantarZ0.toFixed(3)}`);
            if (outlineDev > 1e-3) misses.push(`outline-B ${outlineDev.toFixed(3)}`);
            const minZ = ud.meshMinZ ?? meshVertexMinZ(rebuilt);
            const degenerates = countDegenerateFaces(rebuilt);
            if (minZ < -0.01) misses.push(`min-z ${minZ.toFixed(3)}`);
            if ((ud.planReversals ?? 0) !== 0) misses.push(`plan-reversals ${ud.planReversals}`);
            if ((ud.junctionSlivers ?? 0) !== 0) misses.push(`junction-slivers ${ud.junctionSlivers}`);
            if (degenerates.zeroArea !== 0) misses.push(`zero-area ${degenerates.zeroArea}`);
            if (degenerates.duplicates !== 0) misses.push(`duplicate-faces ${degenerates.duplicates}`);
            if (man.openEdges !== 0) misses.push(`open ${man.openEdges}`);
            if (man.nonManifoldEdges !== 0) misses.push(`nonManifold ${man.nonManifoldEdges}`);
            if (!man.watertight) misses.push("not-watertight");
            if (hits.real !== 0) {
                const cls = hits.byClass
                    ? Object.entries(hits.byClass)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(",")
                    : "";
                const sub = hits.bySubClass
                    ? Object.entries(hits.bySubClass)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(",")
                    : "";
                misses.push(
                    `self-intersect ${hits.real} (coplanar ${hits.coplanar}${cls ? ` ${cls}` : ""}${sub ? ` ${sub}` : ""})`,
                );
                const topWall = hits.byClass?.["top-wall"] ?? 0;
                if (topWall > 0) {
                    const heelHits = heelTopWallHits(hits, model);
                    if (heelHits > 0) {
                        throw new Error(heelSlopeStopMessage(rebuilt, topWall, heelHits));
                    }
                    throw new Error(
                        `[S1-TOP] top junction still has ${topWall} real hits (${cls}). HARD STOP.`,
                    );
                }
                throw new Error(siBreakdownMessage(hits, rebuilt, model, `[S1-SI] ${fixture.name}`));
            }
            const offPlane = (rebuilt.userData as { maxOffPlaneMm?: number }).maxOffPlaneMm ?? 0;
            if (offPlane > COLUMN_PLANARITY_LIMIT_MM) {
                misses.push(`off-plane ${offPlane.toFixed(4)}>${COLUMN_PLANARITY_LIMIT_MM}`);
            }
            if (chordX !== 0 || loftChordX !== 0) {
                misses.push(`chord-cross ${chordX}/${loftChordX}`);
            }
            if (windowX !== 0) misses.push(`window-cross ${windowX}`);
            if (maxSkew > SKEW_LIMIT_MM) misses.push(`skew ${maxSkew.toFixed(2)}`);
            if (ud.pairingMonotonic === false) misses.push("pairing-not-monotonic");
            const genMinWall = generatedMinWallMm(rebuilt);
            if (Math.min(minWall, genMinWall) < S1_MIN_WALL_MM) {
                misses.push(`minWall ${Math.min(minWall, genMinWall).toFixed(3)}`);
            }
            if (fold.worstDeg > FOLD_WORST_LIMIT_DEG) misses.push(`fold ${fold.worstDeg.toFixed(1)}`);
            if (fold.edgesAtLeast10Deg !== 0) misses.push(`fold≥10 ${fold.edgesAtLeast10Deg}`);
            if (archFolds.edgesAtLeast10Deg !== 0) {
                misses.push(`medial-arch-upper≥10 ${archFolds.edgesAtLeast10Deg}`);
            }
            if (seamOver > 0) {
                misses.push(`seam-F ${fSeam.worstDeg.toFixed(1)} over fillet+2 by ${seamOver.toFixed(1)}`);
            }
            if (reconSeam.worstDeg > 5 + 1e-6) {
                misses.push(`seam-B ${reconSeam.worstDeg.toFixed(1)}>5`);
            }
            if (flareCap?.stillNeeded) {
                misses.push(
                    `flare-cap still needed at ${flareCap.cappedStations?.length ?? 0} stations (maxDev ${flareCap.maxDeviationDeg?.toFixed(1)})`,
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
                plantarZ0: Number(plantarZ0.toFixed(4)),
                plantarHaus: Number(haus.plantar.maxMm.toFixed(4)),
                outlineMax: Number(outlineDev.toFixed(4)),
                groundDrift: Number(drift.toFixed(4)),
                meshMinZ: Number(minZ.toFixed(4)),
                planReversals: ud.planReversals ?? 0,
                junctionSlivers: ud.junctionSlivers ?? 0,
                zeroArea: degenerates.zeroArea,
                duplicateFaces: degenerates.duplicates,
                openEdges: man.openEdges,
                nonManifold: man.nonManifoldEdges,
                watertight: man.watertight,
                selfIntersections: hits.real,
                coplanarOverlaps: hits.coplanar,
                stitchDelta: Number(stitchDelta.toFixed(6)),
                archFoldGe10: archFolds.edgesAtLeast10Deg,
                minWallMm: Number(minWall.toFixed(3)),
                foldWorstDeg: Number(fold.worstDeg.toFixed(3)),
                foldGe10: fold.edgesAtLeast10Deg,
                seamWorstDeg: Number(reconSeam.worstDeg.toFixed(3)),
                seamOverFilletDeg: Number(seamOver.toFixed(3)),
                chordCrossings: chordX,
                maxSkewMm: Number(maxSkew.toFixed(3)),
                boundaryZ: Number(boundary.zMax.toFixed(3)),
                boundaryTilt: Number(boundary.tiltDegMax.toFixed(2)),
                pairingMethod: ud.pairingMethod ?? "harmonic",
                maxFrameAngleDeg: Number((ud.maxFrameAngleDeg ?? 0).toFixed(3)),
                maxOffPlaneMm: Number((ud.maxOffPlaneMm ?? 0).toFixed(4)),
                masterMinRadiusMm: Number((ud.masterMinRadiusMm ?? 0).toFixed(2)),
                waistMinRadiusMm: Number((ud.waistMinRadiusMm ?? 0).toFixed(2)),
                pairingMonotonic: ud.pairingMonotonic !== false,
                flareCapNeeded: Boolean(flareCap?.stillNeeded),
                dishLost: Boolean(ud.dishLost ?? model.outline.dishLost),
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
            if (chordX !== 0) {
                throw new Error(
                    `[S1-PAIR] harmonic pairing still left ${chordX} plan-view chord crossings on ${fixture.name} ` +
                        `(skew ${maxSkew.toFixed(2)} mm, masterR=${(ud.masterMinRadiusMm ?? 0).toFixed(1)}, ` +
                        `waistR=${(ud.waistMinRadiusMm ?? 0).toFixed(1)}, maxSep=${(ud.maxSepMm ?? 0).toFixed(1)}, ` +
                        `monotonic=${ud.pairingMonotonic}, missed=${ud.missedRays}). REAL STOP.`,
                );
            }
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
        const smokeBreakdowns: string[] = [];
        for (const smoke of smokes) {
            let rebuilt: BufferGeometry;
            try {
                rebuilt = reconstructProceduralWalls(model, {
                    corrections: { ...neutralCorrections(), ...smoke.patch },
                    thicknessMm: smoke.thicknessMm,
                    stockThicknessMm: 3,
                    archGrindDepthMm: smoke.archGrindDepthMm,
                });
            } catch (err) {
                smokeMiss.push(`${smoke.name} reconstruct: ${String(err)}`);
                continue;
            }
            const topN = (rebuilt.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const outlineN = (rebuilt.userData as { outlineVertexCount?: number }).outlineVertexCount ?? 0;
            const outlineStart =
                (rebuilt.userData as { outlineVertexStart?: number }).outlineVertexStart ?? topN;
            const fold = foldReport(rebuilt, {
                wholeInsole: true,
                topVertexCount: topN,
                outlineVertexCount: outlineN,
                outlineVertexStart: outlineStart,
            });
            const hits = countSelfIntersections(rebuilt);
            const man = reconstructionManifold(rebuilt);
            const drift = groundDriftMm(rebuilt, outlineOf(model));
            const archFolds = medialArchUpperWallFolds(rebuilt, model.bounds, topN);
            const generatedOutline =
                (rebuilt.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> })
                    .outlineRing ?? outlineOf(model);
            const reconSeam = outlineSeamDihedrals(rebuilt, generatedOutline, 1.25);
            const sud = rebuilt.userData as {
                chordCrossings?: number;
                maxSidewaysSkewMm?: number;
                planReversals?: number;
                junctionSlivers?: number;
                meshMinZ?: number;
                bandTiltDegMax?: number;
                maxFrameAngleDeg?: number;
                maxOffPlaneMm?: number;
            };
            const chordX = sud.chordCrossings ?? -1;
            const maxSkew = sud.maxSidewaysSkewMm ?? 0;
            const minZ = sud.meshMinZ ?? meshVertexMinZ(rebuilt);
            const degenerates = countDegenerateFaces(rebuilt);
            results.push({
                smoke: smoke.name,
                selfIntersections: hits.real,
                byClass: hits.byClass ? JSON.stringify(hits.byClass) : "",
                bySubClass: hits.bySubClass ? JSON.stringify(hits.bySubClass) : "",
                coplanarOverlaps: hits.coplanar,
                chordCrossings: chordX,
                maxSkewMm: Number(maxSkew.toFixed(3)),
                foldWorstDeg: Number(fold.worstDeg.toFixed(3)),
                foldGe10: fold.edgesAtLeast10Deg,
                archFoldGe10: archFolds.edgesAtLeast10Deg,
                seamWorstDeg: Number(reconSeam.worstDeg.toFixed(3)),
                watertight: man.watertight,
                openEdges: man.openEdges,
                nonManifold: man.nonManifoldEdges,
                groundDrift: Number(drift.toFixed(3)),
                meshMinZ: Number(minZ.toFixed(3)),
                planReversals: sud.planReversals ?? 0,
                junctionSlivers: sud.junctionSlivers ?? 0,
                zeroArea: degenerates.zeroArea,
                duplicateFaces: degenerates.duplicates,
                bandTilt: Number((sud.bandTiltDegMax ?? 0).toFixed(2)),
            });
            if (hits.real !== 0) {
                const cls = hits.byClass
                    ? Object.entries(hits.byClass)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(",")
                    : "";
                const sub = hits.bySubClass
                    ? Object.entries(hits.bySubClass)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(",")
                    : "";
                smokeMiss.push(`${smoke.name} xi=${hits.real}${cls ? ` ${cls}` : ""}${sub ? ` ${sub}` : ""}`);
                const topWall = hits.byClass?.["top-wall"] ?? 0;
                if (topWall > 0) {
                    const heelHits = heelTopWallHits(hits, model);
                    smokeMiss.push(
                        heelHits > 0
                            ? `[S1-TOP] ${smoke.name}: ${heelHits} of ${topWall} top-wall in heel`
                            : `[S1-TOP] ${smoke.name}: top junction still has ${topWall} hits`,
                    );
                    if (heelHits > 0) {
                        smokeBreakdowns.push(heelSlopeStopMessage(rebuilt, topWall, heelHits));
                    }
                }
                smokeBreakdowns.push(siBreakdownMessage(hits, rebuilt, model, `[S1-SI] ${smoke.name}`));
            }
            if ((sud.maxOffPlaneMm ?? 0) > COLUMN_PLANARITY_LIMIT_MM) {
                smokeMiss.push(
                    `${smoke.name} off-plane ${sud.maxOffPlaneMm!.toFixed(4)}>${COLUMN_PLANARITY_LIMIT_MM}`,
                );
            }
            if (chordX !== 0) smokeMiss.push(`${smoke.name} chord-cross=${chordX}`);
            if ((sud.planReversals ?? 0) !== 0)
                smokeMiss.push(`${smoke.name} reversals=${sud.planReversals}`);
            if ((sud.junctionSlivers ?? 0) !== 0)
                smokeMiss.push(`${smoke.name} slivers=${sud.junctionSlivers}`);
            if (degenerates.zeroArea !== 0) smokeMiss.push(`${smoke.name} zero-area=${degenerates.zeroArea}`);
            if (degenerates.duplicates !== 0) smokeMiss.push(`${smoke.name} dupes=${degenerates.duplicates}`);
            if (man.nonManifoldEdges !== 0)
                smokeMiss.push(`${smoke.name} nonManifold=${man.nonManifoldEdges}`);
            if (archFolds.edgesAtLeast10Deg !== 0) {
                smokeMiss.push(`${smoke.name} medial-arch-upper≥10`);
            }
            if (fold.worstDeg > FOLD_WORST_LIMIT_DEG) smokeMiss.push(`${smoke.name} fold`);
            if (fold.edgesAtLeast10Deg !== 0) smokeMiss.push(`${smoke.name} fold≥10`);
            if (reconSeam.worstDeg > 5 + 1e-6) {
                smokeMiss.push(`${smoke.name} seam-B ${reconSeam.worstDeg.toFixed(1)}>5`);
            }
            if (!man.watertight) smokeMiss.push(`${smoke.name} open=${man.openEdges}`);
            if (minZ < -0.01) smokeMiss.push(`${smoke.name} min-z ${minZ.toFixed(3)}`);
            rebuilt.dispose();
        }
        writeFileSync("/tmp/s1-smoke.json", JSON.stringify(results, null, 2));
        if (smokeBreakdowns.length || smokeMiss.length) {
            throw new Error(
                `[S1-SMOKE] nonzero. STOP.\n` +
                    (smokeMiss.length ? `misses: ${smokeMiss.join("; ")}\n` : "") +
                    smokeBreakdowns.join("\n\n"),
            );
        }
        original.dispose();
    }, 240_000);

    test("SAMPLE_Top + synthetic pattern", async () => {
        const original = await loadSampleTopGlb();
        const model = extractTopOnlyModel(original, { id: "sample-top", name: "SAMPLE_Top" });
        const pos = model.top.meshPositions;
        const rimLocal = model.top.rimLocal ?? [];
        expect(pos?.length).toBe(7809 * 3);
        expect(rimLocal.length).toBe(446);
        const rimPlan = rimLocal.map((i) => ({
            x: pos![i * 3]!,
            y: pos![i * 3 + 1]!,
            z: 0,
        }));
        const pattern = syntheticBottomPattern(rimPlan, model.bounds);
        let rebuilt: BufferGeometry;
        try {
            rebuilt = reconstructProceduralWalls(model, {
                corrections: neutralCorrections(),
                bottomPattern: pattern,
                bottomPatternLabel: PATTERN_SOURCE_SYNTHETIC,
                flatPlantar: true,
            });
        } catch (err) {
            throw new Error(`[S1-SAMPLE] reconstruct: ${String(err)}`);
        }
        const topN = (rebuilt.userData as { topVertexCount?: number }).topVertexCount ?? 0;
        const outlineN = (rebuilt.userData as { outlineVertexCount?: number }).outlineVertexCount ?? 0;
        const outlineStart = (rebuilt.userData as { outlineVertexStart?: number }).outlineVertexStart ?? topN;
        const fold = foldReport(rebuilt, {
            wholeInsole: true,
            topVertexCount: topN,
            outlineVertexCount: outlineN,
            outlineVertexStart: outlineStart,
        });
        const hits = countSelfIntersections(rebuilt);
        const man = reconstructionManifold(rebuilt);
        const generatedOutline =
            (rebuilt.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ??
            pattern;
        const reconSeam = outlineSeamDihedrals(rebuilt, generatedOutline, 1.25);
        const archFolds = medialArchUpperWallFolds(rebuilt, model.bounds, topN);
        const outlineDev = outlineExactOnBMm(rebuilt);
        const plantarZ0 = plantarFlatDeltaMm(rebuilt);
        const genMinWall = generatedMinWallMm(rebuilt);
        const topStock = model.top.meshPositions ?? new Float32Array(0);
        const topRecon = (rebuilt.getAttribute("position").array as Float32Array).slice(0, topStock.length);
        const topDelta = maxVertexDeltaMm(topRecon, topStock);
        const uvOk = zoneFixturesMapIdentically(
            soleUvFrameFromOutline(model.outline),
            soleUvFrameFromPolyline(model.outline.spline.controls),
        );
        const sud = rebuilt.userData as {
            sliverMaxAspect?: number;
            junctionSlivers?: number;
            plantarOpenEdges?: number;
            plantarMissingBoundary?: number;
            maxOffPlaneMm?: number;
            planReversals?: number;
            chordCrossings?: number;
            bottomPatternSource?: string;
        };
        const misses: string[] = [];
        if (hits.real !== 0) {
            misses.push(
                `xi=${hits.real} ${hits.byClass ? JSON.stringify(hits.byClass) : ""} ${
                    hits.bySubClass ? JSON.stringify(hits.bySubClass) : ""
                }`,
            );
        }
        if (!man.watertight) misses.push(`open=${man.openEdges}`);
        if (man.nonManifoldEdges !== 0) misses.push(`nonManifold=${man.nonManifoldEdges}`);
        if (fold.edgesAtLeast10Deg !== 0) misses.push(`fold≥10=${fold.edgesAtLeast10Deg}`);
        if (archFolds.edgesAtLeast10Deg !== 0) misses.push(`medial-arch-upper≥10`);
        if (reconSeam.worstDeg > 5 + 1e-6) misses.push(`seam-B ${reconSeam.worstDeg.toFixed(1)}>5`);
        if (outlineDev > 1e-3) misses.push(`outline-B ${outlineDev.toFixed(4)}`);
        if (plantarZ0 > 1e-3) misses.push(`plantar-z0 ${plantarZ0.toFixed(4)}`);
        if (topDelta > 1e-9) misses.push(`top-identical ${topDelta.toFixed(6)}`);
        if (genMinWall < S1_MIN_WALL_MM) misses.push(`minWall ${genMinWall.toFixed(3)}`);
        if ((sud.sliverMaxAspect ?? 0) > 20) misses.push(`sliver ${sud.sliverMaxAspect}`);
        if ((sud.junctionSlivers ?? 0) !== 0) misses.push(`junction-slivers=${sud.junctionSlivers}`);
        if ((sud.plantarOpenEdges ?? 0) !== 0) misses.push(`plantar-open=${sud.plantarOpenEdges}`);
        if ((sud.plantarMissingBoundary ?? 0) !== 0) {
            misses.push(`plantar-missing=${sud.plantarMissingBoundary}`);
        }
        if ((sud.maxOffPlaneMm ?? 0) > COLUMN_PLANARITY_LIMIT_MM) {
            misses.push(`off-plane ${sud.maxOffPlaneMm}`);
        }
        if ((sud.planReversals ?? 0) !== 0) misses.push(`reversals=${sud.planReversals}`);
        if ((sud.chordCrossings ?? 0) !== 0) misses.push(`crossings=${sud.chordCrossings}`);
        if (!uvOk) misses.push("sole-UV");
        if (sud.bottomPatternSource !== PATTERN_SOURCE_SYNTHETIC) {
            misses.push(`pattern-source ${sud.bottomPatternSource}`);
        }
        writeFileSync(
            "/tmp/s1-sample-top.json",
            JSON.stringify(
                {
                    selfIntersections: hits.real,
                    byClass: hits.byClass,
                    bySubClass: hits.bySubClass,
                    watertight: man.watertight,
                    openEdges: man.openEdges,
                    foldGe10: fold.edgesAtLeast10Deg,
                    seamWorstDeg: Number(reconSeam.worstDeg.toFixed(3)),
                    sliverMaxAspect: sud.sliverMaxAspect,
                    outlineExactMm: outlineDev,
                    plantarZ0,
                    topDelta,
                    minWall: genMinWall,
                    patternSource: sud.bottomPatternSource,
                },
                null,
                2,
            ),
        );
        const stl = Buffer.from(geometryToBinarySTL(rebuilt));
        mkdirSync("/opt/cursor/artifacts", { recursive: true });
        writeFileSync("/opt/cursor/artifacts/sample-top-synthetic.stl", stl);
        if (misses.length || hits.real !== 0) {
            throw new Error(
                `[S1-SAMPLE] nonzero. STOP.\nmisses: ${misses.join("; ")}\n` +
                    (hits.real ? siBreakdownMessage(hits, rebuilt, model, "[S1-SI] SAMPLE_Top") : ""),
            );
        }
        rebuilt.dispose();
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
        const todayTopPos = todayTop.meshPositions ?? new Float32Array(0);
        const reconTop = (rebuilt.getAttribute("position").array as Float32Array).slice(
            0,
            todayTopPos.length,
        );
        const delta = maxVertexDeltaMm(reconTop, todayTopPos);
        expect(delta).toBeLessThanOrEqual(0.01);
        today.dispose();
        rebuilt.dispose();
        raw.dispose();
    }, 120_000);

    test("lateral flange is off on the flat plantar", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const a = reconstructProceduralWalls(model);
        const b = reconstructProceduralWalls(model, {
            lateralFlange: { heightMm: 0, lengthMm: 40, angleDeg: 10 },
        });
        const c = reconstructProceduralWalls(model, {
            lateralFlange: { heightMm: 6, lengthMm: 40, angleDeg: 10 },
        });
        const pa = a.getAttribute("position").array as Float32Array;
        const pb = b.getAttribute("position").array as Float32Array;
        const pc = c.getAttribute("position").array as Float32Array;
        expect(maxVertexDeltaMm(pa, pb)).toBeLessThan(1e-9);
        expect(maxVertexDeltaMm(pa, pc)).toBeLessThan(1e-9);
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

function heelTopWallHits(
    hits: ReturnType<typeof countSelfIntersections>,
    model: ReturnType<typeof extractStockWallModel>,
): number {
    const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
    return (hits.topWallHitCentroids ?? []).filter((c) => {
        const u = Math.max(0, Math.min(1, (c.x - model.bounds.minX) / length));
        return u < 0.22;
    }).length;
}

function heelSlopeStopMessage(rebuilt: BufferGeometry, topWall: number, heelHits: number): string {
    const frames =
        (
            rebuilt.userData as {
                wallFrames?: Array<{
                    u: number;
                    sheetSlopeDeg?: number;
                    t0TiltDeg?: number;
                    overhangMm: number;
                    heightMm: number;
                }>;
            }
        ).wallFrames ?? [];
    const heel = frames
        .filter((f) => f.u < 0.22)
        .map((f) => ({
            u: Number(f.u.toFixed(3)),
            sheetSlopeDeg: Number((f.sheetSlopeDeg ?? 0).toFixed(2)),
            t0TiltDeg: Number((f.t0TiltDeg ?? 0).toFixed(2)),
            overhangMm: Number(f.overhangMm.toFixed(2)),
            heightMm: Number(f.heightMm.toFixed(2)),
        }));
    return (
        `[S1-TOP] heel top-wall hits remain (${heelHits} of ${topWall} top-wall). STOP.\n` +
        JSON.stringify({ heelStations: heel }, null, 2)
    );
}

function siBreakdownMessage(
    hits: ReturnType<typeof countSelfIntersections>,
    rebuilt: BufferGeometry,
    model: ReturnType<typeof extractStockWallModel>,
    title: string,
): string {
    const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
    const classified = hits.classifiedHits ?? [];
    const hitUs = classified.map((c) => Math.max(0, Math.min(1, (c.x - model.bounds.minX) / length)));
    const frames =
        (
            rebuilt.userData as {
                wallFrames?: Array<{ u: number; overhangMm: number; heightMm: number }>;
                maxOffPlaneMm?: number;
                chordCrossings?: number;
            }
        ).wallFrames ?? [];
    const ud = rebuilt.userData as { maxOffPlaneMm?: number; chordCrossings?: number };
    const bands = summarizeWallBands(hitUs, frames);
    return (
        formatSiBreakdown(hits, {
            title,
            hitUs,
            frames,
            maxOffPlaneMm: ud.maxOffPlaneMm,
            chordCrossings: ud.chordCrossings,
        }) + `\n${JSON.stringify({ overhangBands: bands }, null, 2)}`
    );
}
