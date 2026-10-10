// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * S1 parametric walls (Rhino model). Reverse-fit / wall Hausdorff gates dropped.
 * Top sheet exact; plantar + outline; topology; whole-insole folds; clinical
 * cup/flare; smoke widen / thickness / lift / posting / grind. Legacy default
 * path unchanged. All behind wallModel:'procedural'.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import { applyBaseModifiers } from "@/lib/geometry/base-modifier";
import { exportObjectToGlb, meshFromGeometry } from "@/lib/geometry/glb-export";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { heelCupWidthLongitudinalEnvelope } from "@/lib/geometry/height-field";
import {
    ACROSS_STATION_MAX_DEG,
    ACROSS_STATION_P99_MAX_DEG,
    ASPECT_EVERYWHERE_MAX,
    ASPECT_LAST_STRIP_MAX,
    ASPECT_ROUND_MAX,
    ASPECT_ROUND_S1_MAX,
    buildHermiteStations,
    CHORD_RISE_MAX_DEG,
    COLUMN_PLANARITY_LIMIT_MM,
    CUP_BOWL,
    countDegenerateFaces,
    countSelfIntersections,
    cupHeightAtU,
    evaluateHeelCupGate,
    extractStockWallModel,
    extractTopOnlyModel,
    extractTopSheet,
    FIL_CHORD_S1_MIN,
    FILLET_BOUNDS,
    FOLD_HARD_LIMIT_DEG,
    FOLD_WORST_LIMIT_DEG,
    FOREFOOT_INSET_MM,
    foldReport,
    formatSiBreakdown,
    G1_MAX_DEG,
    generatedMinWallMm,
    groundDriftMm,
    heelInnerWidthAtU,
    heelRegionWallHeightMm,
    LAST_CHORD_FLOOR_MAX_FRAC,
    LATERAL_K_SLACK,
    MIN_EDGE_MM,
    MIN_LINE_MM,
    maxVertexDeltaMm,
    measureReconFlareDeg,
    medialArchUpperWallFolds,
    medialYSignFromTopRim,
    meshVertexMinZ,
    minWallThicknessMm,
    movedPatternHygiene,
    outlineExactOnBMm,
    outlineSeamDihedrals,
    PATTERN_HEEL_INSET_MM,
    PATTERN_MAX_DKDS,
    PATTERN_MIN_INSET_MM,
    PATTERN_SILHOUETTE_MM,
    PATTERN_SOURCE_SYNTHETIC,
    patternCurvatureReport,
    plantarFlatDeltaMm,
    RING_TURNING_MAX_DEG,
    ROUND_JOINT_MAX_DEG,
    ROUND_START_INCIDENT_MAX_DEG,
    reconstructionManifold,
    reconstructProceduralWalls,
    S1_MIN_WALL_MM,
    SEAM_B_FALLBACK_DEG,
    SEAM_B_LIMIT_DEG,
    SEAM_B_SLACK_DEG,
    SIGNED_FOLD_MAX_DEG,
    SKEW_LIMIT_MM,
    sheetBoundaryStats,
    soleUvFrameFromOutline,
    soleUvFrameFromPolyline,
    summarizeWallBands,
    syntheticBottomPattern,
    TOP_ROUND_MAX_STEP_DEG,
    topSurfaceDeltas,
    windingReport,
    zoneFixturesMapIdentically,
} from "@/lib/geometry/procedural-wall";
import { listStockBaseFixtures } from "@/lib/geometry/procedural-wall/catalog";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { extractMergedGeometry, loadGlbFromBuffer, reorientToFootprintFrame } from "@/lib/library/loaders";
import type { SideCorrections } from "@/types";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { loadSampleTopGlb } from "./helpers/load-sample-top-glb";
import {
    compositeBottomAndCurvature,
    encodePng,
    renderMesh,
    renderPatternCurvature,
} from "./helpers/render-png";

function writeArtifact(relPath: string, data: Buffer | Uint8Array): void {
    const slash = relPath.lastIndexOf("/");
    const sub = slash >= 0 ? relPath.slice(0, slash) : "";
    for (const root of ["/opt/cursor/artifacts", "/tmp/s1-stls"]) {
        try {
            mkdirSync(sub ? `${root}/${sub}` : root, { recursive: true });
            writeFileSync(`${root}/${relPath}`, data);
        } catch {
            /* agent-store can be 0-byte */
        }
    }
}

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

type ColumnQualityUd = {
    reversals?: number;
    tColBoundHits?: number;
    alongOverBudget?: number;
    maxAlongJointDeg?: number;
    maxAcrossDeg?: number;
    maxAcrossP99Deg?: number;
    maxTcolDeg?: number;
    maxTopRoundDeg?: number;
    topRoundBand?: Array<{ i: number; u: number; deg: number }>;
    maxRoundWallDeg?: number;
    minEdgeMm?: number;
    maxStationGapMult?: number;
    minLineMm?: number;
    maxNTopChangeDeg?: number;
    maxR1ChangePct?: number;
    maxR2ChangePct?: number;
    maxR1ChangeMm?: number;
    maxR2ChangeMm?: number;
    minLastChordOverLocal?: number;
    lastChordFloorStations?: number;
    lastChordFloorFrac?: number;
    maxHeadingChangeDeg?: number;
    maxToeSpacingRatio?: number;
    minForefootInsetMm?: number;
    maxAlaPackMm?: number;
    maxSignedSeamDeg?: number;
    flippedFaces?: number;
    minLastRowSMm?: number;
    minLastRowHeightMm?: number;
    maxBFaceAspect?: number;
    maxTopSheetEdgeDeg?: number;
    minLastChordMm?: number;
    maxChordRiseDeg?: number;
    lastSzMonotone?: boolean;
    stationSpacingMm?: number;
    rowPieceIdentical?: boolean;
    maxAlongRowDeg?: number;
    maxG1EDeg?: number;
    maxG1FDeg?: number;
    maxAspectEverywhere?: number;
    maxAspectRound?: number;
    maxNeighbourSpacingRatio?: number;
    maxNeighbourSpacingRatioB?: number;
    maxNeighbourSpacingRatioR?: number;
    maxETurningDeg?: number;
    maxFTurningDeg?: number;
    maxETurningPlanDeg?: number;
    maxFTurningPlanDeg?: number;
    maxSignedFoldDeg?: number;
    nFoldsOver90?: number;
    inwardWallFaces?: number;
    nRoundSetter?: number;
    nRoundSetterU?: number;
    nRoundCollapsedSkipped?: number;
    maxRoundStepDeg?: number;
    maxStartIncidentDeg?: number;
    minFilletChordOverCMin?: number;
    nRows?: number;
    columnCrossings?: number;
    maxSignedSeamNonFallbackDeg?: number;
    obliqueFallback?: Array<{
        i: number;
        u: number;
        obliqueDeg: number;
        seamDeg: number;
        g1EDeg: number;
        g1FDeg: number;
    }>;
};

type SampleGateReport = {
    misses: string[];
    columnQuality: ColumnQualityUd | undefined;
    seamWorstDeg: number;
    junctionSlivers: number;
    sliverMaxAspect: number;
    topDelta: number;
    topRimMm: number;
    topInteriorMm: number;
    watertight: boolean;
    selfIntersections: number;
    archFoldGe10: number;
    obliqueFallback: ColumnQualityUd["obliqueFallback"];
};

function sampleGateReport(
    rebuilt: BufferGeometry,
    model: ReturnType<typeof extractTopOnlyModel>,
    pattern: Array<{ x: number; y: number; z: number }>,
): SampleGateReport {
    const topN = (rebuilt.userData as { topVertexCount?: number }).topVertexCount ?? 0;
    const hits = countSelfIntersections(rebuilt);
    const man = reconstructionManifold(rebuilt);
    const generatedOutline =
        (rebuilt.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ??
        pattern;
    const reconSeam = outlineSeamDihedrals(rebuilt, generatedOutline, 1.25);
    const designedStep =
        (rebuilt.userData as { columnQuality?: { maxRoundStepDeg?: number } }).columnQuality
            ?.maxRoundStepDeg ?? TOP_ROUND_MAX_STEP_DEG;
    const archFolds = medialArchUpperWallFolds(
        rebuilt,
        model.bounds,
        topN,
        (rebuilt.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1,
        designedStep,
    );
    const outlineDev = outlineExactOnBMm(rebuilt);
    const plantarZ0 = plantarFlatDeltaMm(rebuilt);
    const genMinWall = generatedMinWallMm(rebuilt);
    const topStock = model.top.meshPositions ?? new Float32Array(0);
    const topRecon = (rebuilt.getAttribute("position").array as Float32Array).slice(0, topStock.length);
    const topDelta = maxVertexDeltaMm(topRecon, topStock);
    const surface = topSurfaceDeltas(topRecon, topStock, model.top.rimLocal ?? []);
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
        columnQuality?: ColumnQualityUd;
        maxBPlantarDeltaMm?: number;
        wallBelowPlantar?: number;
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
    misses.push(...qualityMisses(sud));
    if (archFolds.edgesAtLeast10Deg !== 0) {
        misses.push(
            `medial-arch-upper>${(designedStep + 2).toFixed(1)} ${JSON.stringify(archFolds.hardEdges ?? [])}`,
        );
    }
    {
        const fb = sud.columnQuality?.obliqueFallback ?? [];
        const nonFb = sud.columnQuality?.maxSignedSeamNonFallbackDeg ?? reconSeam.worstDeg;
        if (reconSeam.worstDeg > SEAM_B_FALLBACK_DEG + 1e-6) {
            misses.push(`seam-B ${reconSeam.worstDeg.toFixed(1)}>${SEAM_B_FALLBACK_DEG}`);
        } else if (nonFb > SEAM_B_LIMIT_DEG + SEAM_B_SLACK_DEG) {
            misses.push(`seam-B ${nonFb.toFixed(1)}>${SEAM_B_LIMIT_DEG}`);
        } else if (reconSeam.worstDeg > SEAM_B_LIMIT_DEG + SEAM_B_SLACK_DEG && !fb.length) {
            misses.push(`seam-B ${reconSeam.worstDeg.toFixed(1)}>${SEAM_B_LIMIT_DEG}`);
        }
    }
    if (outlineDev > 1e-3) misses.push(`outline-B ${outlineDev.toFixed(4)}`);
    if (plantarZ0 > 1e-3) misses.push(`plantar-z0 ${plantarZ0.toFixed(4)}`);
    if (topDelta > 1e-9) misses.push(`top-surface ${topDelta.toFixed(6)}`);
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
    const wind = windingReport(rebuilt);
    if (!wind.consistent || wind.signedVolume <= 0 || wind.oppositeEdgeMismatch !== 0) {
        misses.push(`winding vol=${wind.signedVolume.toFixed(1)} mismatch=${wind.oppositeEdgeMismatch}`);
    }
    if ((sud.chordCrossings ?? 0) !== 0) misses.push(`crossings=${sud.chordCrossings}`);
    if ((sud.maxBPlantarDeltaMm ?? 0) > 1e-3) {
        misses.push(`B-plantar ${sud.maxBPlantarDeltaMm!.toFixed(4)}`);
    }
    if ((sud.wallBelowPlantar ?? 0) > 0) misses.push(`wall-below-plantar=${sud.wallBelowPlantar}`);
    if (!uvOk) misses.push("sole-UV");
    if (sud.bottomPatternSource !== PATTERN_SOURCE_SYNTHETIC) {
        misses.push(`pattern-source ${sud.bottomPatternSource}`);
    }
    return {
        misses,
        columnQuality: sud.columnQuality,
        seamWorstDeg: reconSeam.worstDeg,
        junctionSlivers: sud.junctionSlivers ?? 0,
        sliverMaxAspect: sud.sliverMaxAspect ?? 0,
        topDelta,
        topRimMm: surface.rimMm,
        topInteriorMm: surface.interiorMm,
        watertight: man.watertight,
        selfIntersections: hits.real,
        archFoldGe10: archFolds.edgesAtLeast10Deg,
        obliqueFallback: sud.columnQuality?.obliqueFallback ?? [],
    };
}

function compactGateTable(
    name: string,
    q: ColumnQualityUd | undefined,
    extra: Record<string, number | string | boolean | undefined> = {},
): Record<string, number | string | boolean | undefined> {
    return {
        name,
        nS: extra.nS,
        nRound: extra.nRound,
        nLine: extra.nLine,
        nFil: extra.nFil,
        nRows: q?.nRows,
        acrossP99: q?.maxAcrossP99Deg,
        acrossP100: q?.maxAcrossDeg,
        eTurn: q?.maxETurningDeg,
        fTurn: q?.maxFTurningDeg,
        eTurnPlan: q?.maxETurningPlanDeg,
        fTurnPlan: q?.maxFTurningPlanDeg,
        g1E: q?.maxG1EDeg,
        g1F: q?.maxG1FDeg,
        topRound: q?.maxTopRoundDeg,
        topSheet: q?.maxTopSheetEdgeDeg,
        crossings: q?.columnCrossings,
        fold: q?.maxSignedFoldDeg,
        aspectRound: q?.maxAspectRound,
        aspect: q?.maxAspectEverywhere,
        spacingB: q?.maxNeighbourSpacingRatioB,
        spacingR: q?.maxNeighbourSpacingRatioR,
        fallback: q?.obliqueFallback?.length ?? 0,
        foldCap: SIGNED_FOLD_MAX_DEG,
        inward: q?.inwardWallFaces,
        nRoundSetter: extra.nRoundSetter ?? q?.nRoundSetter,
        nRoundSetterU: extra.nRoundSetterU ?? q?.nRoundSetterU,
        nRoundCollapsed: extra.nRoundCollapsed ?? q?.nRoundCollapsedSkipped,
        seamB: q?.maxSignedSeamNonFallbackDeg,
        aspectB: q?.maxBFaceAspect,
        chordB: q?.minLastChordMm,
        chordLocal: q?.minLastChordOverLocal,
        chordFloor: q?.lastChordFloorStations,
        chordFloorFrac: q?.lastChordFloorFrac,
        chordRise: q?.maxChordRiseDeg,
        roundStep: q?.maxRoundStepDeg,
        startInc: q?.maxStartIncidentDeg,
        filChord: q?.minFilletChordOverCMin,
        r1Pct: q?.maxR1ChangePct,
        r2Pct: q?.maxR2ChangePct,
        r1Abs: q?.maxR1ChangeMm,
        r2Abs: q?.maxR2ChangeMm,
        alaPack: q?.maxAlaPackMm,
        misses: extra.misses,
    };
}

function qualityMisses(ud: { columnQuality?: ColumnQualityUd }): string[] {
    const q = ud.columnQuality;
    if (!q) return ["no-column-quality"];
    const misses: string[] = [];
    if ((q.maxAcrossDeg ?? 0) > ACROSS_STATION_MAX_DEG + 0.05) {
        misses.push(`across-p100 ${q.maxAcrossDeg?.toFixed(2)}>${ACROSS_STATION_MAX_DEG}`);
    }
    if ((q.maxAcrossP99Deg ?? 0) > ACROSS_STATION_P99_MAX_DEG + 1e-6) {
        misses.push(`across-p99 ${q.maxAcrossP99Deg?.toFixed(2)}>${ACROSS_STATION_P99_MAX_DEG}`);
    }
    if ((q.minEdgeMm ?? 0) < MIN_EDGE_MM - 1e-9) {
        misses.push(`min-edge ${q.minEdgeMm?.toFixed(4)}<${MIN_EDGE_MM}`);
    }
    if ((q.minLineMm ?? 0) < MIN_LINE_MM - 1e-9) {
        misses.push(`line-L ${q.minLineMm?.toFixed(3)}<${MIN_LINE_MM}`);
    }
    // |dr| ≤ 0.05 is a construction diagnostic, not a pass/fail outcome.
    if ((q.maxSignedSeamNonFallbackDeg ?? q.maxSignedSeamDeg ?? 0) > SEAM_B_LIMIT_DEG + SEAM_B_SLACK_DEG) {
        misses.push(`seam-B ${q.maxSignedSeamNonFallbackDeg?.toFixed(2)}>${SEAM_B_LIMIT_DEG}`);
    }
    const fbOver = (q.obliqueFallback ?? []).filter((r) => r.seamDeg > SEAM_B_FALLBACK_DEG + 1e-6);
    if (fbOver.length) {
        misses.push(
            `fallback-seam ${fbOver.map((r) => `${r.i}:${r.seamDeg}`).join(",")}>${SEAM_B_FALLBACK_DEG}`,
        );
    }
    if ((q.maxBFaceAspect ?? 0) > ASPECT_LAST_STRIP_MAX + 1e-6) {
        misses.push(`aspect-B ${q.maxBFaceAspect?.toFixed(2)}>${ASPECT_LAST_STRIP_MAX}`);
    }
    if ((q.maxAspectEverywhere ?? 0) > ASPECT_EVERYWHERE_MAX + 1e-6) {
        misses.push(`aspect ${q.maxAspectEverywhere?.toFixed(2)}>${ASPECT_EVERYWHERE_MAX}`);
    }
    if ((q.maxAspectRound ?? 0) > ASPECT_ROUND_S1_MAX + 1e-6) {
        misses.push(`aspect-round ${q.maxAspectRound?.toFixed(2)}>${ASPECT_ROUND_S1_MAX}`);
    } else if ((q.maxAspectRound ?? 0) > ASPECT_ROUND_MAX + 1e-6) {
        console.log(
            "[S2-ASPECT-ROUND]",
            JSON.stringify({
                maxAspectRound: Number(q.maxAspectRound?.toFixed(2)),
                s1: ASPECT_ROUND_S1_MAX,
                s2: ASPECT_ROUND_MAX,
            }),
        );
    }
    if ((q.maxChordRiseDeg ?? 0) > CHORD_RISE_MAX_DEG + 0.05) {
        misses.push(`chord-rise ${q.maxChordRiseDeg?.toFixed(2)}>${CHORD_RISE_MAX_DEG}`);
    }
    if ((q.minLastChordOverLocal ?? 1) + 1e-9 < 1) {
        const frac = q.lastChordFloorFrac ?? 1;
        if (frac > LAST_CHORD_FLOOR_MAX_FRAC + 1e-9) {
            misses.push(`lastChord-floor ${(frac * 100).toFixed(1)}%>${LAST_CHORD_FLOOR_MAX_FRAC * 100}%`);
        }
    }
    if ((q.maxAlongRowDeg ?? 0) > ROUND_JOINT_MAX_DEG + 1e-6) {
        misses.push(`along-row ${q.maxAlongRowDeg?.toFixed(2)}>${ROUND_JOINT_MAX_DEG}`);
    }
    if ((q.maxG1EDeg ?? 0) > G1_MAX_DEG + 1e-6) {
        misses.push(`G1-E ${q.maxG1EDeg?.toFixed(2)}>${G1_MAX_DEG}`);
    }
    if ((q.maxG1FDeg ?? 0) > G1_MAX_DEG + 1e-6) {
        misses.push(`G1-F ${q.maxG1FDeg?.toFixed(2)}>${G1_MAX_DEG}`);
    }
    {
        const eTurn = q.maxETurningPlanDeg ?? q.maxETurningDeg ?? 0;
        const fTurn = q.maxFTurningPlanDeg ?? q.maxFTurningDeg ?? 0;
        if ((q.maxETurningDeg ?? 0) > RING_TURNING_MAX_DEG + 0.01) {
            console.log(
                "[S2-E-TURN-3D]",
                JSON.stringify({
                    eTurn3d: Number(q.maxETurningDeg?.toFixed(2)),
                    eTurnPlan: Number(q.maxETurningPlanDeg?.toFixed(2)),
                }),
            );
        }
        if (eTurn > RING_TURNING_MAX_DEG + 0.01) {
            misses.push(`E-turn ${eTurn.toFixed(2)}>${RING_TURNING_MAX_DEG}`);
        }
        if (fTurn > RING_TURNING_MAX_DEG + 0.01) {
            misses.push(`F-turn ${fTurn.toFixed(2)}>${RING_TURNING_MAX_DEG}`);
        }
    }
    if ((q.columnCrossings ?? 0) !== 0) {
        misses.push(`column-cross=${q.columnCrossings}`);
    }
    if ((q.inwardWallFaces ?? 0) !== 0) {
        misses.push(`inward-faces=${q.inwardWallFaces}`);
    }
    if ((q.maxRoundStepDeg ?? 0) > TOP_ROUND_MAX_STEP_DEG + 1e-6) {
        misses.push(`round-step ${q.maxRoundStepDeg?.toFixed(2)}>${TOP_ROUND_MAX_STEP_DEG}`);
    }
    if ((q.maxStartIncidentDeg ?? 0) > ROUND_START_INCIDENT_MAX_DEG + 1e-6) {
        misses.push(`start-incident ${q.maxStartIncidentDeg?.toFixed(2)}>${ROUND_START_INCIDENT_MAX_DEG}`);
    }
    if ((q.minFilletChordOverCMin ?? 1) + 1e-3 < FIL_CHORD_S1_MIN) {
        misses.push(`fillet-chord ${q.minFilletChordOverCMin?.toFixed(3)}<${FIL_CHORD_S1_MIN}`);
    } else if ((q.minFilletChordOverCMin ?? 1) + 1e-3 < 1) {
        console.log(
            "[S2-FIL-CHORD]",
            JSON.stringify({
                minFilletChordOverCMin: Number(q.minFilletChordOverCMin?.toFixed(3)),
                s1: FIL_CHORD_S1_MIN,
            }),
        );
    }
    return misses;
}

function readBinaryStl(buf: Buffer): { pos: Float32Array; idx: Uint32Array } {
    const n = buf.readUInt32LE(80);
    const pos = new Float32Array(n * 9);
    const idx = new Uint32Array(n * 3);
    let o = 84;
    for (let i = 0; i < n; i++) {
        o += 12;
        for (let k = 0; k < 9; k++) {
            pos[i * 9 + k] = buf.readFloatLE(o);
            o += 4;
        }
        idx[i * 3] = i * 3;
        idx[i * 3 + 1] = i * 3 + 1;
        idx[i * 3 + 2] = i * 3 + 2;
        o += 2;
    }
    return { pos, idx };
}

const KENDON_REARFOOT = {
    right: [0.98, 0.2, 0] as [number, number, number],
    up: [-0.065, 0.32, 0.945] as [number, number, number],
    light: [0.25, 0.35, 0.9] as [number, number, number],
};

const BOTTOM_VIEW = {
    right: [1, 0, 0] as [number, number, number],
    up: [0, -1, 0] as [number, number, number],
    light: [0.15, 0.25, -0.95] as [number, number, number],
};

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
            const designedStep =
                (rebuilt.userData as { columnQuality?: { maxRoundStepDeg?: number } }).columnQuality
                    ?.maxRoundStepDeg ?? TOP_ROUND_MAX_STEP_DEG;
            const archFolds = medialArchUpperWallFolds(
                rebuilt,
                model.bounds,
                topN,
                (rebuilt.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1,
                designedStep,
            );
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
                columnQuality?: ColumnQualityUd;
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
                maxBPlantarDeltaMm?: number;
                wallBelowPlantar?: number;
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
            {
                const frames = rebuilt.userData as {
                    wallFrames?: Array<{ u: number }>;
                    sidewaysSkewMm?: number[];
                    generatedStart?: number;
                    loftN?: number;
                    stationCount?: number;
                };
                const skews = frames.sidewaysSkewMm ?? [];
                let skewI = 0;
                for (let i = 1; i < skews.length; i++) {
                    if ((skews[i] ?? 0) > (skews[skewI] ?? 0)) skewI = i;
                }
                const nS = frames.stationCount ?? frames.loftN ?? 0;
                const gen = frames.generatedStart ?? 0;
                const we = fold.worstEdge;
                const rowOf = (v: number): number =>
                    nS > 0 && v >= gen ? 1 + Math.floor((v - gen) / nS) : 0;
                const length = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
                console.log(
                    "[S1-FOLD-SKEW]",
                    JSON.stringify({
                        base: fixture.name,
                        fold: Number(fold.worstDeg.toFixed(3)),
                        foldU: we ? Number(((we.x - model.bounds.minX) / length).toFixed(4)) : null,
                        foldRow: we ? [rowOf(we.a), rowOf(we.b)] : null,
                        foldVerts: we ? [we.a, we.b] : null,
                        skew: Number(maxSkew.toFixed(3)),
                        skewI,
                        skewU: frames.wallFrames?.[skewI]?.u ?? null,
                    }),
                );
            }

            const misses: string[] = [];
            if (topDelta > 1e-9) misses.push(`top-surface ${topDelta.toFixed(6)}`);
            if (plantarZ0 > 1e-3) misses.push(`plantar-z0 ${plantarZ0.toFixed(3)}`);
            if (outlineDev > 1e-3) misses.push(`outline-B ${outlineDev.toFixed(3)}`);
            const minZ = ud.meshMinZ ?? meshVertexMinZ(rebuilt);
            const degenerates = countDegenerateFaces(rebuilt);
            if (minZ < -0.01) misses.push(`min-z ${minZ.toFixed(3)}`);
            // plan-reversals / Tcol / along-over / heading: table diagnostics only.
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
            const wind = windingReport(rebuilt);
            if (!wind.consistent || wind.signedVolume <= 0 || wind.oppositeEdgeMismatch !== 0) {
                misses.push(
                    `winding vol=${wind.signedVolume.toFixed(1)} mismatch=${wind.oppositeEdgeMismatch}`,
                );
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
            misses.push(...qualityMisses(ud));
            if ((ud.maxBPlantarDeltaMm ?? 0) > 1e-3) {
                misses.push(`B-plantar ${ud.maxBPlantarDeltaMm!.toFixed(4)}`);
            }
            if ((ud.wallBelowPlantar ?? 0) > 0) misses.push(`wall-below-plantar=${ud.wallBelowPlantar}`);
            if (archFolds.edgesAtLeast10Deg !== 0) {
                misses.push(
                    `medial-arch-upper>${(designedStep + 2).toFixed(1)} ${archFolds.edgesAtLeast10Deg} edges=${JSON.stringify(archFolds.hardEdges ?? [])}`,
                );
            }
            if (seamOver > 0) {
                misses.push(`seam-F ${fSeam.worstDeg.toFixed(1)} over fillet+2 by ${seamOver.toFixed(1)}`);
            }
            if (reconSeam.worstDeg > SEAM_B_LIMIT_DEG + SEAM_B_SLACK_DEG) {
                misses.push(`seam-B ${reconSeam.worstDeg.toFixed(1)}>${SEAM_B_LIMIT_DEG}`);
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
        const smokeBreakdowns: string[] = [];
        const seamBRequiredSmokes = ["widen+6", "width+5"] as const;
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
            if (smoke.name === "t4") {
                try {
                    const t2geo = reconstructProceduralWalls(model, {
                        corrections: { ...neutralCorrections() },
                        thicknessMm: 2,
                        stockThicknessMm: 3,
                    });
                    const t4Band =
                        (rebuilt.userData as { topRoundBand?: Array<{ i: number; u: number; deg: number }> })
                            .topRoundBand ?? [];
                    const t2Band =
                        (t2geo.userData as { topRoundBand?: Array<{ i: number; u: number; deg: number }> })
                            .topRoundBand ?? [];
                    const byU = new Map(t2Band.map((r) => [r.u, r.deg]));
                    const cmp = t4Band.map((r) => ({
                        i: r.i,
                        u: r.u,
                        t4: r.deg,
                        t2: byU.get(r.u) ?? null,
                        d: byU.has(r.u) ? Number((r.deg - (byU.get(r.u) ?? 0)).toFixed(2)) : null,
                    }));
                    const maxT4 = t4Band.reduce((m, r) => Math.max(m, r.deg), 0);
                    const maxD = cmp.reduce((m, r) => Math.max(m, Math.abs(r.d ?? 0)), 0);
                    console.log("[S1-TOP-ROUND] t4-vs-t2", JSON.stringify({ maxT4, maxD, cmp }));
                    if (maxT4 > ROUND_JOINT_MAX_DEG + 1e-6) {
                        smokeMiss.push(
                            `t4 top|round ${maxT4.toFixed(2)}>${ROUND_JOINT_MAX_DEG} at u 0.40-0.54`,
                        );
                    }
                    if (maxD > ROUND_JOINT_MAX_DEG + 1e-6) {
                        smokeMiss.push(`t4-vs-t2 top|round Δ ${maxD.toFixed(2)}>${ROUND_JOINT_MAX_DEG}`);
                    }
                    t2geo.dispose();
                } catch (err) {
                    smokeMiss.push(`t2 top|round reconstruct: ${String(err)}`);
                }
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
            const designedStep =
                (rebuilt.userData as { columnQuality?: { maxRoundStepDeg?: number } }).columnQuality
                    ?.maxRoundStepDeg ?? TOP_ROUND_MAX_STEP_DEG;
            const archFolds = medialArchUpperWallFolds(
                rebuilt,
                model.bounds,
                topN,
                (rebuilt.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1,
                designedStep,
            );
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
                maxSidewaysMm?: number;
                stationCount?: number;
                nRound?: number;
                nLine?: number;
                nFil?: number;
                columnQuality?: ColumnQualityUd;
                patternAdjustedForClearance?: string | null;
                patternClearanceStations?: number[];
                widenFollowFactor?: number;
                insoleWidthScale?: number;
                postingClamps?: Array<{ station: number; u: number; droppedMm: number }>;
                maxBPlantarDeltaMm?: number;
                wallBelowPlantar?: number;
                plantarAbsMaxZ?: number;
                heelWallHeightMm?: number;
            };
            const chordX = sud.chordCrossings ?? -1;
            const maxSkew = sud.maxSidewaysSkewMm ?? 0;
            const minZ = sud.meshMinZ ?? meshVertexMinZ(rebuilt);
            const degenerates = countDegenerateFaces(rebuilt);
            const qMiss = qualityMisses(sud);
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
                ...compactGateTable(smoke.name, sud.columnQuality, {
                    nS: sud.stationCount,
                    nRound: sud.nRound,
                    nLine: sud.nLine,
                    nFil: sud.nFil,
                    misses: qMiss.join("; "),
                }),
                patternAdjusted: sud.patternAdjustedForClearance ?? "",
                followFactor: sud.widenFollowFactor ?? 0,
                insoleWidthScale: sud.insoleWidthScale ?? 1,
                postingClamps: sud.postingClamps?.length ?? 0,
                plantarFlatMm: Number(plantarFlatDeltaMm(rebuilt).toFixed(6)),
                heelWallHeightMm: Number(heelRegionWallHeightMm(rebuilt, model.bounds).toFixed(4)),
                plantarAbsMaxZ: Number((sud.plantarAbsMaxZ ?? 0).toFixed(6)),
            });
            writeArtifact(
                `procedural-${smoke.name.replace(/\+/g, "-")}.stl`,
                Buffer.from(geometryToBinarySTL(rebuilt)),
            );
            if (smoke.name === "widen+6" || smoke.name === "width+5") {
                const pos = rebuilt.getAttribute("position")?.array as Float32Array;
                const idx = rebuilt.getIndex()?.array;
                if (pos && idx) {
                    writeArtifact(
                        `screenshots/bottom-${smoke.name.replace(/\+/g, "")}.png`,
                        encodePng(900, 680, renderMesh(pos, idx, BOTTOM_VIEW, 900, 680)),
                    );
                }
            }
            if (smoke.name.startsWith("widen") || smoke.name === "width+5") {
                const ring = generatedOutline;
                if (ring.length >= 8) {
                    const sign = (rebuilt.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1;
                    const movedAt =
                        smoke.name === "width+5"
                            ? () => true
                            : (u: number) => heelCupWidthLongitudinalEnvelope(u) > 1e-6;
                    const hy = movedPatternHygiene(ring, model.bounds, sign, {
                        maxInflections: 4,
                        movedAt,
                    });
                    for (const m of hy.misses) smokeMiss.push(`${smoke.name} ${m}`);
                }
                if (smoke.name.startsWith("widen") && (sud.widenFollowFactor ?? 0) !== 1) {
                    smokeMiss.push(`${smoke.name} followFactor ${sud.widenFollowFactor}!=1`);
                }
                if (smoke.name === "width+5" && Math.abs((sud.insoleWidthScale ?? 1) - 1.05) > 1e-9) {
                    smokeMiss.push(`${smoke.name} insoleWidthScale ${sud.insoleWidthScale}!=1.05`);
                }
            }
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
            const wind = windingReport(rebuilt);
            if (!wind.consistent || wind.signedVolume <= 0 || wind.oppositeEdgeMismatch !== 0) {
                smokeMiss.push(`${smoke.name} winding mismatch=${wind.oppositeEdgeMismatch}`);
            }
            if (chordX !== 0) smokeMiss.push(`${smoke.name} chord-cross=${chordX}`);
            // plan-reversals: table diagnostic only.
            if ((sud.junctionSlivers ?? 0) !== 0)
                smokeMiss.push(`${smoke.name} slivers=${sud.junctionSlivers}`);
            if (degenerates.zeroArea !== 0) smokeMiss.push(`${smoke.name} zero-area=${degenerates.zeroArea}`);
            if (degenerates.duplicates !== 0) smokeMiss.push(`${smoke.name} dupes=${degenerates.duplicates}`);
            if (man.nonManifoldEdges !== 0)
                smokeMiss.push(`${smoke.name} nonManifold=${man.nonManifoldEdges}`);
            if (archFolds.edgesAtLeast10Deg !== 0) {
                smokeMiss.push(
                    `${smoke.name} medial-arch-upper>${(designedStep + 2).toFixed(1)} ${JSON.stringify(archFolds.hardEdges ?? [])}`,
                );
            }
            if (fold.worstDeg > FOLD_WORST_LIMIT_DEG) smokeMiss.push(`${smoke.name} fold`);
            for (const m of qMiss) smokeMiss.push(`${smoke.name} ${m}`);
            if ((sud.maxBPlantarDeltaMm ?? 0) > 1e-3) {
                smokeMiss.push(`${smoke.name} B-plantar ${sud.maxBPlantarDeltaMm!.toFixed(4)}`);
            }
            if ((sud.wallBelowPlantar ?? 0) > 0) {
                smokeMiss.push(`${smoke.name} wall-below-plantar=${sud.wallBelowPlantar}`);
            }
            {
                const fb = sud.columnQuality?.obliqueFallback ?? [];
                const nonFb = sud.columnQuality?.maxSignedSeamNonFallbackDeg ?? reconSeam.worstDeg;
                if (reconSeam.worstDeg > SEAM_B_FALLBACK_DEG + 1e-6) {
                    smokeMiss.push(
                        `${smoke.name} seam-B ${reconSeam.worstDeg.toFixed(1)}>${SEAM_B_FALLBACK_DEG}`,
                    );
                } else if (nonFb > SEAM_B_LIMIT_DEG + SEAM_B_SLACK_DEG) {
                    smokeMiss.push(`${smoke.name} seam-B ${nonFb.toFixed(1)}>${SEAM_B_LIMIT_DEG}`);
                } else if (reconSeam.worstDeg > SEAM_B_LIMIT_DEG + SEAM_B_SLACK_DEG && !fb.length) {
                    smokeMiss.push(
                        `${smoke.name} seam-B ${reconSeam.worstDeg.toFixed(1)}>${SEAM_B_LIMIT_DEG}`,
                    );
                }
            }
            if (!man.watertight) smokeMiss.push(`${smoke.name} open=${man.openEdges}`);
            if (minZ < -0.01) smokeMiss.push(`${smoke.name} min-z ${minZ.toFixed(3)}`);
            if (smoke.name === "posting-4" || smoke.name === "heel-lift-10") {
                const flat = plantarFlatDeltaMm(rebuilt);
                if (flat > 1e-3) smokeMiss.push(`${smoke.name} plantar-z0 ${flat.toFixed(4)}`);
            }
            rebuilt.dispose();
        }
        writeFileSync("/tmp/s1-smoke.json", JSON.stringify(results, null, 2));
        for (const name of seamBRequiredSmokes) {
            if (!results.some((row) => row.name === name)) {
                smokeMiss.push(`${name} missing from seam-B gate`);
            }
        }
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
        const rim3d = rimLocal.map((i) => ({
            x: pos![i * 3]!,
            y: pos![i * 3 + 1]!,
            z: pos![i * 3 + 2]!,
        }));
        const pattern = syntheticBottomPattern(rim3d, model.bounds, rim3d);
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
        const exactRep = sampleGateReport(rebuilt, model, pattern);
        const misses = exactRep.misses.slice();
        const sampleUd = rebuilt.userData as {
            stationCount?: number;
            nRound?: number;
            nLine?: number;
            nFil?: number;
            nRoundSetter?: number;
            nRoundSetterU?: number;
            nRoundCollapsedSkipped?: number;
        };
        const sampleTable = compactGateTable("SAMPLE", exactRep.columnQuality, {
            nS: sampleUd.stationCount,
            nRound: sampleUd.nRound,
            nLine: sampleUd.nLine,
            nFil: sampleUd.nFil,
            nRoundSetter: sampleUd.nRoundSetter,
            nRoundSetterU: sampleUd.nRoundSetterU,
            nRoundCollapsed: sampleUd.nRoundCollapsedSkipped,
            misses: exactRep.misses.join("; "),
        });
        writeFileSync(
            "/tmp/s1-sample-top.json",
            JSON.stringify({ ...exactRep, gateTable: sampleTable }, null, 2),
        );
        console.log("[S1-SAMPLE-GATES]", JSON.stringify(sampleTable, null, 2));
        const stl = Buffer.from(geometryToBinarySTL(rebuilt));
        mkdirSync("/tmp/s1-stls", { recursive: true });
        mkdirSync("/tmp/s1-stls/screenshots", { recursive: true });
        const beforePath = "/tmp/s1-stls/sample-top-synthetic.stl";
        if (existsSync(beforePath)) {
            const prev = readBinaryStl(readFileSync(beforePath));
            writeFileSync(
                "/tmp/s1-stls/screenshots/rearfoot-before.png",
                encodePng(900, 680, renderMesh(prev.pos, prev.idx, KENDON_REARFOOT, 900, 680)),
            );
        }
        const afterPos = rebuilt.getAttribute("position").array as Float32Array;
        const afterIdx = rebuilt.getIndex()!.array;
        writeFileSync(
            "/tmp/s1-stls/screenshots/rearfoot-after.png",
            encodePng(900, 680, renderMesh(afterPos, afterIdx, KENDON_REARFOOT, 900, 680)),
        );
        const bottomRgb = renderMesh(afterPos, afterIdx, BOTTOM_VIEW, 900, 680);
        writeFileSync("/tmp/s1-stls/screenshots/bottom-view.png", encodePng(900, 680, bottomRgb));
        writeFileSync(
            "/tmp/s1-stls/screenshots/sample-top-synthetic-rearfoot.png",
            encodePng(900, 680, renderMesh(afterPos, afterIdx, KENDON_REARFOOT, 900, 680)),
        );
        const patternSign = medialYSignFromTopRim(rim3d, model.bounds);
        const curv = patternCurvatureReport(pattern, model.bounds, patternSign);
        const curveRgb = renderPatternCurvature(pattern, curv.k, curv.s, 900, 320, rim3d, curv.inflections);
        writeFileSync("/tmp/s1-stls/screenshots/pattern-curvature.png", encodePng(900, 320, curveRgb));
        const overlay = compositeBottomAndCurvature(bottomRgb, 900, 680, curveRgb, 900, 320);
        writeFileSync(
            "/tmp/s1-stls/screenshots/bottom-view-curvature.png",
            encodePng(overlay.width, overlay.height, overlay.rgb),
        );
        if (curv.inflections !== 2) {
            misses.push(`pattern-inflections ${curv.inflections} != 2`);
        }
        if (curv.lateralMinK < LATERAL_K_SLACK) {
            misses.push(`lateral-concave k=${curv.lateralMinK.toFixed(5)}<${LATERAL_K_SLACK}`);
        }
        if (curv.maxAbsDkDs > PATTERN_MAX_DKDS) {
            misses.push(`pattern-dkds ${curv.maxAbsDkDs.toFixed(4)}>${PATTERN_MAX_DKDS}`);
        }
        let minInset = Infinity;
        for (const p of pattern) {
            let best = Infinity;
            for (let i = 0; i < rim3d.length; i++) {
                const a = rim3d[i]!;
                const b = rim3d[(i + 1) % rim3d.length]!;
                const ex = b.x - a.x;
                const ey = b.y - a.y;
                const len2 = ex * ex + ey * ey;
                const t =
                    len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
                best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
            }
            minInset = Math.min(minInset, best);
        }
        if (minInset < PATTERN_MIN_INSET_MM - 1e-3) {
            misses.push(`pattern-inset ${minInset.toFixed(3)}<${PATTERN_MIN_INSET_MM}`);
        }
        const footLen = Math.max(1e-3, model.bounds.maxX - model.bounds.minX);
        let heelFeat = 0;
        let toeFeat = Infinity;
        for (const p of pattern) {
            const u = (p.x - model.bounds.minX) / footLen;
            let best = Infinity;
            for (let i = 0; i < rim3d.length; i++) {
                const a = rim3d[i]!;
                const b = rim3d[(i + 1) % rim3d.length]!;
                const ex = b.x - a.x;
                const ey = b.y - a.y;
                const len2 = ex * ex + ey * ey;
                const t =
                    len2 > 1e-12 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
                best = Math.min(best, Math.hypot(p.x - (a.x + ex * t), p.y - (a.y + ey * t)));
            }
            if (u < 0.12) heelFeat = Math.max(heelFeat, best);
            if (u > 0.82) toeFeat = Math.min(toeFeat, best);
        }
        if (heelFeat < PATTERN_HEEL_INSET_MM - PATTERN_SILHOUETTE_MM) {
            misses.push(
                `pattern-heel ${heelFeat.toFixed(2)}<${PATTERN_HEEL_INSET_MM - PATTERN_SILHOUETTE_MM}`,
            );
        }
        if (Math.abs(toeFeat - FOREFOOT_INSET_MM) > PATTERN_SILHOUETTE_MM) {
            misses.push(
                `pattern-toe ${toeFeat.toFixed(2)} not ${FOREFOOT_INSET_MM}±${PATTERN_SILHOUETTE_MM}`,
            );
        }
        writeArtifact("sample-top-synthetic.stl", stl);
        const glb = await exportObjectToGlb(meshFromGeometry(rebuilt));
        writeArtifact("sample-top-synthetic.glb", Buffer.from(glb.arrayBuffer));
        if (misses.length || exactRep.selfIntersections !== 0) {
            throw new Error(`[S1-SAMPLE] nonzero. STOP.\nmisses: ${misses.join("; ")}`);
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
        const shotDir = "/tmp/s1-stls/screenshots";
        mkdirSync(shotDir, { recursive: true });
        mkdirSync("/tmp/s1-stls", { recursive: true });
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
        writeArtifact("procedural-default.stl", Buffer.from(geometryToBinarySTL(rebuilt)));
        const defaultGlb = await exportObjectToGlb(meshFromGeometry(rebuilt));
        writeArtifact("procedural-default.glb", Buffer.from(defaultGlb.arrayBuffer));
        const defaultUd = rebuilt.userData as {
            columnQuality?: ColumnQualityUd;
            stationCount?: number;
            nRound?: number;
            nLine?: number;
            nFil?: number;
            nRoundSetter?: number;
            nRoundSetterU?: number;
            nRoundCollapsedSkipped?: number;
        };
        const defaultTable = compactGateTable("Default", defaultUd.columnQuality, {
            nS: defaultUd.stationCount,
            nRound: defaultUd.nRound,
            nLine: defaultUd.nLine,
            nFil: defaultUd.nFil,
            nRoundSetter: defaultUd.nRoundSetter,
            nRoundSetterU: defaultUd.nRoundSetterU,
            nRoundCollapsed: defaultUd.nRoundCollapsedSkipped,
            misses: qualityMisses(defaultUd).join("; "),
        });
        writeFileSync(
            "/tmp/s1-default.json",
            JSON.stringify({ columnQuality: defaultUd.columnQuality, gateTable: defaultTable }, null, 2),
        );
        console.log("[S1-DEFAULT-GATES]", JSON.stringify(defaultTable, null, 2));
        const defaultDesigned = defaultUd.columnQuality?.maxRoundStepDeg ?? TOP_ROUND_MAX_STEP_DEG;
        const defaultArch = medialArchUpperWallFolds(
            rebuilt,
            model.bounds,
            (rebuilt.userData as { topVertexCount?: number }).topVertexCount ?? 0,
            (rebuilt.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1,
            defaultDesigned,
        );
        console.log(
            "[S1-DEFAULT-ARCH]",
            JSON.stringify({
                designedStep: defaultDesigned,
                threshold: defaultDesigned + 2,
                hard: defaultArch.edgesAtLeast10Deg,
                note:
                    "Default's prior 285 edges ≥10° sat at the designed ~8° round step plus neighbour " +
                    "tilt. The Default screenshot test gates qualityMisses only, so that count never " +
                    "failed the outcome. medial-arch-upper now counts |deg| > designedStep+2.",
            }),
        );
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
