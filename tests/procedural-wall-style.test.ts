// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    ACROSS_STATION_MAX_DEG,
    ACROSS_STATION_P99_MAX_DEG,
    countSelfIntersections,
    extractStockWallModel,
    G1_MAX_DEG,
    plantarFlatDeltaMm,
    RING_TURNING_MAX_DEG,
    reconstructionManifold,
    reconstructProceduralWalls,
    SPLINE_CHORD_MIN_MM,
    SPLINE_F_RING_MAX,
    SPLINE_FACE_DOT_MIN,
    SPLINE_FREEZE_MISS_MAX_DEG,
    SPLINE_FREEZE_MISS_STATIONS,
    SPLINE_G1_ANALYTIC_MAX_DEG,
    SPLINE_G1_MESH_MAX_DEG,
    SPLINE_G1_R_MAX_DEG,
    SPLINE_GATES_REPORT_ONLY,
    SPLINE_H_MIN_MM,
    SPLINE_INFL_ACCEPT_DEG,
    SPLINE_INFL_TURN_MIN_DEG,
    SPLINE_LIP_S_SLACK_MM,
    SPLINE_ROW1_TR_MAX_DEG,
    SPLINE_S_MIN_MM,
    SPLINE_SHORT_LS_MM,
    SPLINE_VOL_ERR_FRAC,
    SPLINE_WR_STEP_MAX,
    WALL_MID_DIHEDRAL_MAX_DEG,
    WALL_MID_TURN_MAX_DEG,
    WALL_PLAN_ANGLE_REPORT_DEG,
    WALL_STYLE_ACROSS_P99_BLOCK_DEG,
    WALL_STYLE_ACROSS_P100_BLOCK_DEG,
    windingReport,
} from "@/lib/geometry/procedural-wall";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import {
    drawRampMarks,
    drawStationMarks,
    encodePng,
    projectViewPoint,
    renderMesh,
    viewBounds,
} from "./helpers/render-png";

type Style = "straight" | "round" | "hybrid";

/** Legacy-map STRAIGHT STL. ROUND/HYBRID must not change this bytes. */
const STRAIGHT_STL_MD5 = "053d39a5dfd7c889f6b67d0d3fe2d57e";

type StlGate = {
    style: string;
    watertight: boolean;
    winding: boolean;
    bodies: number;
    volume: number | null;
    straightVolume: number | null;
    volumeDelta: number | null;
    volumeDeltaPct: number | null;
};

function loadStlGates(style: Style, stlPath: string, straightPath?: string): StlGate {
    const helper = resolve(process.cwd(), "tests/helpers/stl-gates.py");
    const args = [helper, style, stlPath];
    if (straightPath) args.push(straightPath);
    const run = (): StlGate => {
        const out = execFileSync("python3", args, { encoding: "utf8" });
        return JSON.parse(out) as StlGate;
    };
    try {
        return run();
    } catch (err) {
        const stdout = (err as { stdout?: string }).stdout?.trim();
        if (stdout) {
            try {
                return JSON.parse(stdout) as StlGate;
            } catch {
                /* fall through */
            }
        }
        throw err;
    }
}

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

function topDeltaMm(a: BufferGeometry, b: BufferGeometry): number {
    const n = Math.min(
        (a.userData as { topVertexCount?: number }).topVertexCount ?? 0,
        (b.userData as { topVertexCount?: number }).topVertexCount ?? 0,
    );
    const pa = a.getAttribute("position").array as Float32Array;
    const pb = b.getAttribute("position").array as Float32Array;
    let max = 0;
    for (let i = 0; i < n * 3; i++) max = Math.max(max, Math.abs(pa[i]! - pb[i]!));
    return max;
}

function rimDeltaMm(a: BufferGeometry, b: BufferGeometry): number {
    const ra = (a.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ?? [];
    const rb = (b.userData as { outlineRing?: Array<{ x: number; y: number; z: number }> }).outlineRing ?? [];
    const n = Math.min(ra.length, rb.length);
    let max = 0;
    for (let i = 0; i < n; i++) {
        const p = ra[i]!;
        const q = rb[i]!;
        max = Math.max(max, Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z));
    }
    return max;
}

function styleMisses(geo: BufferGeometry, style: Style, straight?: BufferGeometry): string[] {
    const ud = geo.userData as {
        columnQuality?: {
            maxG1EDeg?: number;
            maxG1FDeg?: number;
            maxAcrossDeg?: number;
            maxAcrossP99Deg?: number;
            maxETurningPlanDeg?: number;
            maxFTurningPlanDeg?: number;
            maxETurningDeg?: number;
            maxFTurningDeg?: number;
            maxMidRowTurnDeg?: number;
            maxMidRowDihedralDeg?: number;
            maxAlongRowDeg?: number;
            maxMidAcrossP99Deg?: number;
            maxSplineFDelta?: number;
            maxSplineStepRatio?: number;
            minSplineEdgeOverLN?: number;
            maxRow1TRDeg?: number;
            minSplineRhoOverNeed?: number;
            nSplineRhoFail?: number;
            nSplineCorner?: number;
            splineN?: number;
            splineMaxNi?: number;
            splineMaxNiU?: number;
            duplicateVerts?: number;
            worstAcrossI?: number;
            worstAcrossU?: number;
            worstAlongRowI?: number;
            worstAlongRowU?: number;
            maxWRStep?: number;
            maxHybridW?: number;
            maxG1RAnalyticDeg?: number;
            maxG1EAnalyticDeg?: number;
            maxG1BAnalyticDeg?: number;
            maxG1RMeshDeg?: number;
            maxLandingTurnDeg?: number;
            maxLandingAlongDeg?: number;
            freezeOk?: boolean;
            i0Dump?: unknown;
        };
        wallFrames?: Array<{
            u: number;
            midWeight?: number;
            overhangMm?: number;
            g1EDeg?: number;
            g1FDeg?: number;
            midFlagged?: boolean;
            midPlanAngleDeg?: number;
            heightMm?: number;
            midChordOffMm?: number;
            midChordMm?: number;
            lineLengthMm?: number;
            midSStar?: number;
            midKappaF?: number;
            midKappaFil?: number;
            midEndRatio?: number;
            midPeakHFrac?: number;
            midBulgeHFrac?: number;
            midBeta?: number;
            sideSign?: 1 | -1;
            o?: number;
            zy?: number;
            a?: number;
            steep?: boolean;
            tRAngleDeg?: number;
            inflCount?: number;
            maxOppTurnDeg?: number;
            splineG1EDeg?: number;
            splineG1RAnalyticDeg?: number;
            splineG1EAnalyticDeg?: number;
            splineG1BAnalyticDeg?: number;
            splineG1RMeshDeg?: number;
            splineLambda?: number;
            splineLipTurnDeg?: number;
            splineTRS?: number;
            splineTRZ?: number;
            fallbackStraight?: boolean;
            midPlanOffMm?: number;
            splineRow1Deg?: number;
            splineStepRatio?: number;
            splineMinEdge?: number;
            splineL?: number;
            splineFk?: number[];
            splineFlat?: boolean;
            splineWR?: number;
            splineSMinLip?: number;
            splineSMinBody?: number;
            rTop?: number;
        }>;
        medialYSign?: 1 | -1;
        footLengthMm?: number;
        stationCount?: number;
        generatedStart?: number;
        nRound?: number;
        nLine?: number;
    };
    const q = ud.columnQuality ?? {};
    const misses: string[] = [];
    const g1ECap = style === "straight" ? G1_MAX_DEG : SPLINE_G1_MESH_MAX_DEG;
    const g1FCap = style === "straight" ? G1_MAX_DEG : SPLINE_G1_R_MAX_DEG;
    if (style === "straight" && (q.maxG1EDeg ?? 0) > g1ECap + 1e-6) {
        misses.push(`G1-R ${q.maxG1EDeg?.toFixed(2)}>${g1ECap}`);
    }
    if (style !== "straight" && (q.maxG1RMeshDeg ?? 0) > SPLINE_G1_MESH_MAX_DEG + 1e-6) {
        misses.push(`G1-R_m ${q.maxG1RMeshDeg?.toFixed(2)}>${SPLINE_G1_MESH_MAX_DEG}`);
    }
    if ((q.maxG1FDeg ?? 0) > g1FCap + 1e-6) misses.push(`seam-B ${q.maxG1FDeg?.toFixed(2)}>${g1FCap}`);
    const acrossP99 =
        style === "straight" ? (q.maxAcrossP99Deg ?? 0) : (q.maxMidAcrossP99Deg ?? q.maxAcrossP99Deg ?? 0);
    const acrossP99Cap = style === "straight" ? ACROSS_STATION_P99_MAX_DEG : WALL_STYLE_ACROSS_P99_BLOCK_DEG;
    if (acrossP99 > acrossP99Cap + 1e-6) {
        misses.push(`across-p99 ${acrossP99.toFixed(2)}>${acrossP99Cap}`);
    }
    const acrossP100 = q.maxAcrossDeg ?? 0;
    const acrossP100Cap = style === "straight" ? ACROSS_STATION_MAX_DEG : WALL_STYLE_ACROSS_P100_BLOCK_DEG;
    if (acrossP100 > acrossP100Cap + 1e-6) {
        misses.push(`across-p100 ${acrossP100.toFixed(2)}>${acrossP100Cap}`);
    }
    const eTurn = q.maxETurningPlanDeg ?? q.maxETurningDeg ?? 0;
    const fTurn = q.maxFTurningPlanDeg ?? q.maxFTurningDeg ?? 0;
    if (eTurn > RING_TURNING_MAX_DEG + 0.01) misses.push(`E-turn ${eTurn.toFixed(2)}`);
    if (fTurn > RING_TURNING_MAX_DEG + 0.01) misses.push(`F-turn ${fTurn.toFixed(2)}`);
    if (style !== "straight") {
        const midTurn = q.maxMidRowTurnDeg ?? 0;
        const midDihedral = q.maxMidRowDihedralDeg ?? q.maxAlongRowDeg ?? 0;
        if (midTurn > WALL_MID_TURN_MAX_DEG + 1e-6) {
            misses.push(`mid-row-turn ${midTurn.toFixed(2)}>${WALL_MID_TURN_MAX_DEG}`);
        }
        if (midDihedral > WALL_MID_DIHEDRAL_MAX_DEG + 1e-6) {
            misses.push(`mid-row-dihedral ${midDihedral.toFixed(2)}>${WALL_MID_DIHEDRAL_MAX_DEG}`);
        }
        if ((q.maxSplineFDelta ?? 0) > SPLINE_F_RING_MAX + 1e-9) {
            misses.push(`f-delta ${q.maxSplineFDelta?.toFixed(4)}>${SPLINE_F_RING_MAX}`);
        }
        if ((q.minSplineEdgeOverLN ?? 1) + 1e-9 < 1) {
            misses.push(`minEdge ${(q.minSplineEdgeOverLN ?? 0).toFixed(3)}<1 × ${SPLINE_CHORD_MIN_MM} mm`);
        }
        if ((q.maxRow1TRDeg ?? 0) > SPLINE_ROW1_TR_MAX_DEG + 1e-6) {
            misses.push(`row1-tR ${q.maxRow1TRDeg?.toFixed(2)}>${SPLINE_ROW1_TR_MAX_DEG}`);
        }
        if ((q.duplicateVerts ?? 0) > 0) misses.push(`dup-verts ${q.duplicateVerts}`);
    }
    const hits = countSelfIntersections(geo);
    if (hits.real !== 0) misses.push(`SI ${hits.real}`);
    const man = reconstructionManifold(geo);
    if (!man.watertight) misses.push("not-watertight");
    if (man.nonManifoldEdges !== 0) misses.push(`NM ${man.nonManifoldEdges}`);
    const wind =
        (ud as { winding?: { consistent?: boolean; oppositeEdgeMismatch?: number; signedVolume?: number } })
            .winding ?? windingReport(geo);
    if (!wind.consistent) {
        misses.push(`winding mismatch=${wind.oppositeEdgeMismatch} vol=${wind.signedVolume.toFixed(1)}`);
    }
    const flipN = (ud as { wallFlip?: { n?: number } }).wallFlip?.n ?? 0;
    if (flipN > 0) misses.push(`flipped-wall ${flipN}`);
    if (plantarFlatDeltaMm(geo) > 1e-3) misses.push(`plantar-z ${plantarFlatDeltaMm(geo).toFixed(4)}`);
    if (straight) {
        const top = topDeltaMm(geo, straight);
        if (top > 1e-6) misses.push(`top-vs-straight ${top.toFixed(6)}`);
        const rim = rimDeltaMm(geo, straight);
        if (rim > 1e-3) misses.push(`rim-vs-straight ${rim.toFixed(4)}`);
    }
    const frames = ud.wallFrames ?? [];
    if (style !== "straight" && frames.length) {
        const infl = frames.filter((f) => f.midFlagged);
        if (infl.length) misses.push(`[RND-INFL] ${infl.length} >=${SPLINE_INFL_ACCEPT_DEG}`);
        const poly = frames.filter((f) => f.fallbackStraight);
        if (poly.length) misses.push(`[RND-POLY] ${poly.length}`);
        const steep = frames.filter((f) => f.steep);
        if (steep.length) {
            console.log(
                "[RND-STEEP]",
                JSON.stringify(
                    steep.map((f) => ({
                        u: Number(f.u.toFixed(4)),
                        tRAngleDeg: Number((f.tRAngleDeg ?? 0).toFixed(3)),
                        o: Number((f.o ?? 0).toFixed(4)),
                    })),
                ),
            );
        }
        const sMinHits = frames.filter((f) => {
            if (f.splineFlat || (f.splineWR ?? 0) < 0.5) return false;
            const body = (f.splineSMinBody ?? f.midPlanOffMm ?? 0) < SPLINE_S_MIN_MM - 1e-6;
            const r1 = f.rTop ?? 0.5;
            const lip = (f.splineSMinLip ?? 0) < -(r1 + SPLINE_LIP_S_SLACK_MM) - 1e-6;
            return body || lip;
        });
        if (sMinHits.length) misses.push(`sMin ${sMinHits.length} <${SPLINE_S_MIN_MM}`);
        const g1RaHits = frames.filter(
            (f) => (f.splineG1RAnalyticDeg ?? 0) > SPLINE_G1_ANALYTIC_MAX_DEG + 1e-6,
        );
        if (g1RaHits.length) {
            misses.push(`G1-R_a ${g1RaHits.length} >${SPLINE_G1_ANALYTIC_MAX_DEG}`);
        }
        const g1EaHits = frames.filter(
            (f) => (f.splineG1EAnalyticDeg ?? 0) > SPLINE_G1_ANALYTIC_MAX_DEG + 1e-6,
        );
        if (g1EaHits.length) {
            misses.push(`G1-E_a ${g1EaHits.length} >${SPLINE_G1_ANALYTIC_MAX_DEG}`);
        }
        const g1BaHits = frames.filter(
            (f) => (f.splineG1BAnalyticDeg ?? 0) > SPLINE_G1_ANALYTIC_MAX_DEG + 1e-6,
        );
        if (g1BaHits.length) {
            misses.push(`G1-B_a ${g1BaHits.length} >${SPLINE_G1_ANALYTIC_MAX_DEG}`);
        }
        const g1RmHits = frames.filter((f) => (f.splineG1RMeshDeg ?? 0) > SPLINE_G1_MESH_MAX_DEG + 1e-6);
        if (g1RmHits.length) {
            misses.push(`G1-R_m ${g1RmHits.length} >${SPLINE_G1_MESH_MAX_DEG}`);
        }
        if ((q.maxLandingTurnDeg ?? 0) > WALL_MID_TURN_MAX_DEG + 1e-6) {
            misses.push(`landing-turn ${q.maxLandingTurnDeg?.toFixed(2)}>${WALL_MID_TURN_MAX_DEG}`);
        }
        if ((q.maxLandingAlongDeg ?? 0) > WALL_MID_DIHEDRAL_MAX_DEG + 1e-6) {
            misses.push(`landing-along ${q.maxLandingAlongDeg?.toFixed(2)}>${WALL_MID_DIHEDRAL_MAX_DEG}`);
        }
    }
    if (style === "hybrid" && frames.length) {
        const lateral = frames.filter((f) => (f.sideSign ?? 1) < 0);
        if (lateral.some((f) => (f.midWeight ?? 0) > 1e-3)) {
            misses.push("hybrid lateral weight");
        }
        const heel = frames.filter((f) => f.u <= 0.12 && (f.sideSign ?? 1) > 0);
        if (heel.some((f) => (f.midWeight ?? 0) > 1e-3)) {
            misses.push("hybrid heel weight");
        }
        const archW = frames.filter((f) => (f.sideSign ?? 1) > 0 && (f.midWeight ?? 0) > 0.5);
        if (!archW.length) misses.push("hybrid arch empty");
        const blendInfl = frames.filter((f) => {
            const w = f.midWeight ?? 1;
            return w > 1e-6 && w < 1 - 1e-6 && (f.maxOppTurnDeg ?? 0) >= SPLINE_INFL_TURN_MIN_DEG;
        });
        if (blendInfl.length) misses.push(`hybrid blend-infl ${blendInfl.length}`);
    }
    return misses;
}

type GateRow = {
    gate: string;
    pass: boolean;
    value: number | string;
    cap?: number | string;
    n?: number;
    worstI?: number;
    worstK?: number;
    worstU?: number;
};

function gateTable(geo: BufferGeometry, style: Style, straight?: BufferGeometry): GateRow[] {
    const misses = styleMisses(geo, style, straight);
    const ud = geo.userData as {
        columnQuality?: {
            maxG1EDeg?: number;
            maxG1FDeg?: number;
            maxAcrossDeg?: number;
            maxAcrossP99Deg?: number;
            maxMidAcrossP99Deg?: number;
            maxMidRowTurnDeg?: number;
            maxMidRowDihedralDeg?: number;
            maxAlongRowDeg?: number;
            maxSplineFDelta?: number;
            maxSplineStepRatio?: number;
            minSplineEdgeOverLN?: number;
            maxRow1TRDeg?: number;
            minSplineRhoOverNeed?: number;
            nSplineRhoFail?: number;
            nSplineCorner?: number;
            splineN?: number;
            splineMaxNi?: number;
            splineMaxNiU?: number;
            duplicateVerts?: number;
            worstAcrossI?: number;
            worstAcrossK?: number;
            worstAcrossU?: number;
            worstAlongRowI?: number;
            worstAlongRowK?: number;
            worstAlongRowU?: number;
            worstMidRowTurnI?: number;
            worstMidRowTurnK?: number;
            worstMidRowTurnU?: number;
            nLipFail?: number;
            maxG1RAnalyticDeg?: number;
            maxG1EAnalyticDeg?: number;
            maxG1BAnalyticDeg?: number;
            maxG1RMeshDeg?: number;
            maxLandingTurnDeg?: number;
            maxLandingAlongDeg?: number;
            freezeOk?: boolean;
            residualStations?: Array<{ i: number; u: number }>;
            inflRemainder?: Array<{ i: number; u: number; maxOpp: number }>;
        };
        wallFrames?: Array<{
            u: number;
            g1EDeg?: number;
            g1FDeg?: number;
            midFlagged?: boolean;
            fallbackStraight?: boolean;
            heightMm?: number;
            midBulgeHFrac?: number;
            midPeakHFrac?: number;
            midPlanOffMm?: number;
            splineRow1Deg?: number;
            splineStepRatio?: number;
            splineMinEdge?: number;
            splineL?: number;
            splineFk?: number[];
            midBeta?: number;
            midWeight?: number;
            midChordOffMm?: number;
            midChordMm?: number;
            splineFlat?: boolean;
            splineWR?: number;
            splineCorner?: boolean;
            splineRhoMin?: number;
            splineRhoNeed?: number;
            splineKappaRatio?: number;
            splineKappaMaxMean?: number;
            splineKappaE?: number;
            splineLipOk?: boolean;
            splineLipTurnMax?: number;
            splineLipTurnK?: number;
            splineG1EDeg?: number;
            splineG1BDeg?: number;
            splineG1RAnalyticDeg?: number;
            splineG1EAnalyticDeg?: number;
            splineG1BAnalyticDeg?: number;
            splineG1RMeshDeg?: number;
            maxOppTurnDeg?: number;
            splineSMinLip?: number;
            splineSMinBody?: number;
            splineSMinK?: number;
            splineSBound?: boolean;
            splineShort?: boolean;
            splineFlatReason?: string;
            nLip?: number;
            rTop?: number;
            o?: number;
            a?: number;
        }>;
    };
    const q = ud.columnQuality ?? {};
    const frames = ud.wallFrames ?? [];
    const worstHi = (
        val: (f: (typeof frames)[number], i: number) => number,
        pred: (v: number) => boolean,
    ) => {
        let n = 0;
        let v = Number.NEGATIVE_INFINITY;
        let i = -1;
        let u = -1;
        frames.forEach((f, idx) => {
            const x = val(f, idx);
            if (!pred(x)) return;
            n++;
            if (x > v) {
                v = x;
                i = idx;
                u = f.u;
            }
        });
        return { n, v, i, u };
    };
    const worstLo = (val: (f: (typeof frames)[number]) => number, pred: (v: number) => boolean) => {
        let n = 0;
        let v = Number.POSITIVE_INFINITY;
        let i = -1;
        let u = -1;
        frames.forEach((f, idx) => {
            const x = val(f);
            if (!pred(x)) return;
            n++;
            if (x < v) {
                v = x;
                i = idx;
                u = f.u;
            }
        });
        return { n, v, i, u };
    };
    const g1Rm = worstHi(
        (f) => f.splineG1RMeshDeg ?? 0,
        (v) => v > SPLINE_G1_MESH_MAX_DEG + 1e-6,
    );
    const chord = worstHi(
        (f) => f.splineRow1Deg ?? 0,
        (v) => v > SPLINE_ROW1_TR_MAX_DEG + 1e-6,
    );
    const seam = worstHi(
        (f) => f.g1FDeg ?? 0,
        (v) => v > SPLINE_G1_R_MAX_DEG + 1e-6,
    );
    const infl = worstHi(
        (f) => (f.midFlagged ? 1 : 0),
        (v) => v > 0,
    );
    const poly = worstHi(
        (f) => (f.fallbackStraight ? 1 : 0),
        (v) => v > 0,
    );
    const wrGated = (f: (typeof frames)[number]): boolean => !f.splineFlat && (f.splineWR ?? 0) >= 0.5;
    const shortHits = frames
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => !!f.splineShort || f.splineFlatReason === "short-ls");
    const sMin = worstLo(
        (f) => {
            if (!wrGated(f)) return 0;
            return Math.min(f.splineSMinBody ?? f.midPlanOffMm ?? 0, 0);
        },
        (v) => v < SPLINE_S_MIN_MM - 1e-6,
    );
    const sMinLipHits = frames
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => {
            if (!wrGated(f)) return false;
            const lim = -((f.rTop ?? 0.5) + SPLINE_LIP_S_SLACK_MM);
            return (f.splineSMinLip ?? 0) < lim - 1e-6;
        });
    const sMinLipWorst = sMinLipHits.reduce(
        (best, row) => {
            const v = row.f.splineSMinLip ?? 0;
            return v < best.v
                ? { n: sMinLipHits.length, v, i: row.i, u: row.f.u, k: row.f.splineSMinK ?? 0 }
                : best;
        },
        { n: 0, v: 0, i: -1, u: -1, k: 0 },
    );
    const lip = worstHi(
        (f) => (wrGated(f) && f.splineLipOk === false ? (f.splineLipTurnMax ?? 5) : 0),
        (v) => v > 4 + 1e-6,
    );
    const edge = worstLo(
        (f) => {
            const need = SPLINE_CHORD_MIN_MM;
            return need > 1e-12 ? (f.splineMinEdge ?? 0) / need : 1;
        },
        (v) => v + 1e-9 < 1,
    );
    const rhoLo = worstLo(
        (f) => {
            if (f.splineFlat || (f.splineWR ?? 0) < 0.5) return 1;
            const need = f.splineRhoNeed ?? 0;
            const rho = f.splineRhoMin ?? Number.POSITIVE_INFINITY;
            return need > 1e-12 ? rho / need : 1;
        },
        (v) => v + 1e-9 < 1,
    );
    let fDelta = { n: 0, v: 0, i: -1, u: -1 };
    for (let i = 0; i < frames.length; i++) {
        const a = frames[i]!.splineFk ?? [];
        const b = frames[(i + 1) % frames.length]?.splineFk ?? [];
        const nF = Math.min(a.length, b.length);
        for (let k = 1; k < nF - 1; k++) {
            const d = Math.abs((a[k] ?? 0) - (b[k] ?? 0));
            if (d > SPLINE_F_RING_MAX + 1e-9) {
                fDelta.n++;
                if (d > fDelta.v) {
                    fDelta = { n: fDelta.n, v: d, i, u: frames[i]!.u };
                }
            }
        }
    }
    const row = (
        gate: string,
        pass: boolean,
        value: number | string,
        cap?: number | string,
        extra?: { n?: number; worstI?: number; worstK?: number; worstU?: number },
    ): GateRow => ({ gate, pass, value, cap, ...extra });
    const rows: GateRow[] = [
        row(
            "G1-R_m",
            style === "straight" || !g1Rm.n,
            style === "straight" ? (q.maxG1EDeg ?? 0) : g1Rm.n ? g1Rm.v : (q.maxG1RMeshDeg ?? 0),
            style === "straight" ? G1_MAX_DEG : SPLINE_G1_MESH_MAX_DEG,
            g1Rm.n ? { n: g1Rm.n, worstI: g1Rm.i, worstU: g1Rm.u } : undefined,
        ),
        row(
            "first-chord",
            !(style !== "straight" && chord.n),
            chord.n ? chord.v : (q.maxRow1TRDeg ?? 0),
            SPLINE_ROW1_TR_MAX_DEG,
            chord.n ? { n: chord.n, worstI: chord.i, worstU: chord.u } : undefined,
        ),
        row(
            "G1-B",
            !(style !== "straight" && seam.n),
            seam.n ? seam.v : (q.maxG1FDeg ?? 0),
            style === "straight" ? G1_MAX_DEG : SPLINE_G1_R_MAX_DEG,
            seam.n ? { n: seam.n, worstI: seam.i, worstU: seam.u } : undefined,
        ),
        row(
            "[RND-INFL]",
            !infl.n,
            infl.n,
            0,
            infl.n ? { n: infl.n, worstI: infl.i, worstU: infl.u } : undefined,
        ),
        row(
            "[RND-POLY]",
            !poly.n,
            poly.n,
            0,
            poly.n ? { n: poly.n, worstI: poly.i, worstU: poly.u } : undefined,
        ),
        row(
            "[RND-SHORT]",
            true,
            shortHits.length,
            SPLINE_SHORT_LS_MM,
            shortHits.length
                ? { n: shortHits.length, worstI: shortHits[0]!.i, worstU: shortHits[0]!.f.u }
                : undefined,
        ),
        row(
            "sMin-body",
            !sMin.n || style === "straight",
            sMin.n ? sMin.v : 0,
            SPLINE_S_MIN_MM,
            sMin.n
                ? { n: sMin.n, worstI: sMin.i, worstK: frames[sMin.i]?.splineSMinK, worstU: sMin.u }
                : undefined,
        ),
        row(
            "sMin-lip",
            !sMinLipHits.length || style === "straight",
            sMinLipHits.length ? sMinLipWorst.v : 0,
            `-(r1+${SPLINE_LIP_S_SLACK_MM})`,
            sMinLipHits.length
                ? {
                      n: sMinLipHits.length,
                      worstI: sMinLipWorst.i,
                      worstK: sMinLipWorst.k,
                      worstU: sMinLipWorst.u,
                  }
                : undefined,
        ),
        row(
            "lip-rows",
            !lip.n || style === "straight",
            lip.n ? lip.v : 0,
            4,
            lip.n
                ? {
                      n: lip.n,
                      worstI: lip.i,
                      worstK: frames[lip.i]?.splineLipTurnK,
                      worstU: lip.u,
                  }
                : undefined,
        ),
        row(
            "vs-straight",
            true,
            (() => {
                const xs = frames
                    .filter((f) => !f.splineFlat && (f.heightMm ?? 0) >= SPLINE_H_MIN_MM)
                    .map((f) => f.midBulgeHFrac ?? 0);
                return xs.length ? Math.max(...xs) : 0;
            })(),
            "report-only",
        ),
        row("step-ratio", true, q.maxSplineStepRatio ?? 1, "no-cap"),
        row(
            "minEdge",
            !edge.n || style === "straight",
            edge.n ? edge.v : (q.minSplineEdgeOverLN ?? 1),
            1,
            edge.n ? { n: edge.n, worstI: edge.i, worstU: edge.u } : undefined,
        ),
        row(
            "f-delta",
            !fDelta.n || style === "straight",
            fDelta.n ? fDelta.v : (q.maxSplineFDelta ?? 0),
            SPLINE_F_RING_MAX,
            fDelta.n ? { n: fDelta.n, worstI: fDelta.i, worstU: fDelta.u } : undefined,
        ),
        row(
            "rho-first20",
            true,
            rhoLo.n ? rhoLo.v : (q.minSplineRhoOverNeed ?? 0),
            "report-only",
            rhoLo.n ? { n: rhoLo.n, worstI: rhoLo.i, worstU: rhoLo.u } : { n: q.nSplineCorner ?? 0 },
        ),
        row(
            "across-p99",
            !misses.some((m) => m.startsWith("across-p99")),
            style === "straight"
                ? (q.maxAcrossP99Deg ?? 0)
                : (q.maxMidAcrossP99Deg ?? q.maxAcrossP99Deg ?? 0),
            style === "straight" ? 5 : WALL_STYLE_ACROSS_P99_BLOCK_DEG,
            q.worstAcrossI != null ? { worstI: q.worstAcrossI, worstU: q.worstAcrossU } : undefined,
        ),
        row(
            "across-p100",
            !misses.some((m) => m.startsWith("across-p100")),
            q.maxAcrossDeg ?? 0,
            style === "straight" ? ACROSS_STATION_MAX_DEG : WALL_STYLE_ACROSS_P100_BLOCK_DEG,
            q.worstAcrossI != null
                ? { worstI: q.worstAcrossI, worstK: q.worstAcrossK, worstU: q.worstAcrossU }
                : undefined,
        ),
        row(
            "mid-row-turn",
            style === "straight" || (q.maxMidRowTurnDeg ?? 0) <= WALL_MID_TURN_MAX_DEG + 1e-6,
            q.maxMidRowTurnDeg ?? 0,
            WALL_MID_TURN_MAX_DEG,
            q.worstMidRowTurnI != null
                ? { worstI: q.worstMidRowTurnI, worstK: q.worstMidRowTurnK, worstU: q.worstMidRowTurnU }
                : undefined,
        ),
        row(
            "mid-row-dihedral",
            style === "straight" ||
                (q.maxMidRowDihedralDeg ?? q.maxAlongRowDeg ?? 0) <= WALL_MID_DIHEDRAL_MAX_DEG + 1e-6,
            q.maxMidRowDihedralDeg ?? q.maxAlongRowDeg ?? 0,
            WALL_MID_DIHEDRAL_MAX_DEG,
            q.worstAlongRowI != null
                ? { worstI: q.worstAlongRowI, worstK: q.worstAlongRowK, worstU: q.worstAlongRowU }
                : undefined,
        ),
        row(
            "|dw|",
            style === "straight" || (q.maxWRStep ?? 0) <= SPLINE_WR_STEP_MAX + 1e-9,
            q.maxWRStep ?? 0,
            SPLINE_WR_STEP_MAX,
        ),
        row(
            "w_max",
            style !== "hybrid" || Math.abs((q.maxHybridW ?? 0) - 1) <= 1e-9,
            q.maxHybridW ?? (style === "round" ? 1 : 0),
            style === "hybrid" ? 1 : "n/a",
        ),
        row("dup-verts", (q.duplicateVerts ?? 0) === 0, q.duplicateVerts ?? 0, 0),
        row(
            "[RND-FLAT]",
            true,
            style === "straight" ? 0 : frames.filter((f) => f.splineFlat).length,
            undefined,
            (() => {
                const flats = frames.map((f, i) => ({ f, i })).filter((x) => x.f.splineFlat);
                return flats.length
                    ? { n: flats.length, worstI: flats[0]!.i, worstU: flats[0]!.f.u }
                    : undefined;
            })(),
        ),
        row("SI", !misses.some((m) => m.startsWith("SI ")), misses.find((m) => m.startsWith("SI ")) ?? 0),
        row("watertight", !misses.includes("not-watertight"), misses.includes("not-watertight") ? 0 : 1, 1),
        row("NM", !misses.some((m) => m.startsWith("NM ")), misses.find((m) => m.startsWith("NM ")) ?? 0),
        row(
            "winding",
            !misses.some((m) => m.startsWith("winding ")),
            (geo.userData as { winding?: { oppositeEdgeMismatch?: number } }).winding?.oppositeEdgeMismatch ??
                0,
            0,
        ),
        row(
            "flipped-wall",
            !misses.some((m) => m.startsWith("flipped-wall ")),
            (geo.userData as { wallFlip?: { n?: number } }).wallFlip?.n ?? 0,
            0,
        ),
        row(
            "landing-turn",
            style === "straight" || (q.maxLandingTurnDeg ?? 0) <= WALL_MID_TURN_MAX_DEG + 1e-6,
            q.maxLandingTurnDeg ?? 0,
            WALL_MID_TURN_MAX_DEG,
        ),
        row(
            "landing-along",
            style === "straight" || (q.maxLandingAlongDeg ?? 0) <= WALL_MID_DIHEDRAL_MAX_DEG + 1e-6,
            q.maxLandingAlongDeg ?? 0,
            WALL_MID_DIHEDRAL_MAX_DEG,
        ),
        row(
            "[RND-INFL-REM]",
            true,
            (q.inflRemainder ?? []).length,
            `<${SPLINE_INFL_ACCEPT_DEG}`,
            (q.inflRemainder ?? []).length
                ? {
                      n: q.inflRemainder!.length,
                      worstI: q.inflRemainder![0]!.i,
                      worstU: q.inflRemainder![0]!.u,
                  }
                : undefined,
        ),
        row(
            "freeze",
            style === "straight" || !!q.freezeOk,
            (q.residualStations ?? []).length,
            `${SPLINE_FREEZE_MISS_STATIONS}@${SPLINE_FREEZE_MISS_MAX_DEG}`,
            (q.residualStations ?? []).length ? { n: q.residualStations!.length } : undefined,
        ),
    ];
    return rows;
}

function analyticGateTable(geo: BufferGeometry, style: Style): GateRow[] {
    const ud = geo.userData as {
        columnQuality?: {
            maxG1RAnalyticDeg?: number;
            maxG1EAnalyticDeg?: number;
            maxG1BAnalyticDeg?: number;
        };
        wallFrames?: Array<{
            u: number;
            splineG1RAnalyticDeg?: number;
            splineG1EAnalyticDeg?: number;
            splineG1BAnalyticDeg?: number;
        }>;
    };
    const q = ud.columnQuality ?? {};
    const frames = ud.wallFrames ?? [];
    const worst = (val: (f: (typeof frames)[number]) => number) => {
        let n = 0;
        let v = Number.NEGATIVE_INFINITY;
        let i = -1;
        let u = -1;
        frames.forEach((f, idx) => {
            const x = val(f);
            if (x <= SPLINE_G1_ANALYTIC_MAX_DEG + 1e-6) return;
            n++;
            if (x > v) {
                v = x;
                i = idx;
                u = f.u;
            }
        });
        return { n, v, i, u };
    };
    const row = (
        gate: string,
        hit: { n: number; v: number; i: number; u: number },
        fallback: number,
    ): GateRow => ({
        gate,
        pass: style === "straight" || !hit.n,
        value: style === "straight" ? 0 : hit.n ? hit.v : fallback,
        cap: SPLINE_G1_ANALYTIC_MAX_DEG,
        ...(hit.n ? { n: hit.n, worstI: hit.i, worstU: hit.u } : {}),
    });
    return [
        row(
            "G1-R_a",
            worst((f) => f.splineG1RAnalyticDeg ?? 0),
            q.maxG1RAnalyticDeg ?? 0,
        ),
        row(
            "G1-E_a",
            worst((f) => f.splineG1EAnalyticDeg ?? 0),
            q.maxG1EAnalyticDeg ?? 0,
        ),
        row(
            "G1-B_a",
            worst((f) => f.splineG1BAnalyticDeg ?? 0),
            q.maxG1BAnalyticDeg ?? 0,
        ),
    ];
}

describe("procedural wall styles", () => {
    test("straight / round / hybrid on Default: gates + STL/PNG", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const styles: Style[] = ["round", "hybrid", "straight"];
        const geos: Partial<Record<Style, BufferGeometry>> = {};
        for (const style of styles) {
            geos[style] = reconstructProceduralWalls(model, { wallStyle: style });
        }
        const straight = geos.straight!;
        const misses: string[] = [];
        const tables: Partial<Record<Style, GateRow[]>> = {};
        const analyticTables: Partial<Record<Style, GateRow[]>> = {};
        const meshTables: Partial<Record<Style, GateRow[]>> = {};
        for (const style of styles) {
            const geo = geos[style]!;
            const local = styleMisses(geo, style, style === "straight" ? undefined : straight);
            const analytic = analyticGateTable(geo, style);
            const mesh = gateTable(geo, style, style === "straight" ? undefined : straight);
            const table = [...analytic, ...mesh];
            tables[style] = table;
            analyticTables[style] = analytic;
            meshTables[style] = mesh;
            console.log("[RND-ANALYTIC-TABLE]", style, JSON.stringify(analytic));
            console.log("[RND-MESH-TABLE]", style, JSON.stringify(mesh));
            console.log("[RND-GATE-TABLE]", style, JSON.stringify(table));
            const missRows = table
                .filter((r) => !r.pass && r.gate !== "kappa-ratio")
                .map((r) => ({
                    gate: r.gate,
                    i: r.worstI,
                    k: r.worstK,
                    u: r.worstU,
                    value: r.value,
                    cap: r.cap,
                    n: r.n,
                }));
            console.log("[RND-MISS]", style, JSON.stringify(missRows));
            const qN =
                (
                    geo.userData as {
                        columnQuality?: { splineN?: number; splineMaxNi?: number; splineMaxNiU?: number };
                    }
                ).columnQuality ?? {};
            console.log(
                "[RND-N-REPORT]",
                style,
                JSON.stringify({
                    N: qN.splineN ?? 0,
                    maxNi: qN.splineMaxNi ?? 0,
                    maxNiU: Number((qN.splineMaxNiU ?? 0).toFixed(4)),
                }),
            );
            const frames =
                (
                    geo.userData as {
                        wallFrames?: Array<{
                            u?: number;
                            o?: number;
                            a?: number;
                            heightMm?: number;
                            midWeight?: number;
                            splineFlat?: boolean;
                            splineWR?: number;
                            splineNi?: number;
                        }>;
                    }
                ).wallFrames ?? [];
            const flatList = frames
                .map((f, i) => ({
                    i,
                    u: Number((f.u ?? 0).toFixed(4)),
                    o: Number((f.o ?? 0).toFixed(4)),
                    a: Number((f.a ?? 0).toFixed(4)),
                    H: Number((f.heightMm ?? 0).toFixed(3)),
                    wR: Number((f.splineWR ?? 0).toFixed(4)),
                    flat: !!f.splineFlat,
                }))
                .filter((f) => f.flat);
            console.log(
                "[RND-FLAT-COUNT]",
                style,
                JSON.stringify({
                    n: flatList.length,
                    hLt3: flatList.filter((f) => f.H < 3).length,
                    hGe3: flatList.filter((f) => f.H >= 3).length,
                }),
            );
            console.log("[RND-FLAT-LIST]", style, JSON.stringify(flatList));
            const blendList = frames
                .map((f, i) => ({
                    i,
                    u: Number((f.u ?? 0).toFixed(4)),
                    wR: Number((f.splineWR ?? 0).toFixed(4)),
                    w: Number((f.midWeight ?? 0).toFixed(4)),
                    nI: f.splineNi ?? 0,
                }))
                .filter((f) => f.wR < 1 - 1e-6 || f.w < 1 - 1e-6);
            console.log(
                "[RND-BLEND-REPORT]",
                style,
                JSON.stringify({ n: blendList.length, stations: blendList.slice(0, 48) }),
            );
            const jointDump = (
                (
                    geo.userData as {
                        wallFrames?: Array<{
                            u?: number;
                            splineLambda?: number;
                            splineLipTurnDeg?: number;
                            splineTRS?: number;
                            splineTRZ?: number;
                            splineWR?: number;
                            splineLs?: number;
                        }>;
                    }
                ).wallFrames ?? []
            )
                .map((f, i) => ({
                    i,
                    u: Number((f.u ?? 0).toFixed(4)),
                    lambda: Number((f.splineLambda ?? 0).toFixed(4)),
                    lipTurn: Number((f.splineLipTurnDeg ?? 0).toFixed(3)),
                    tR: {
                        s: Number((f.splineTRS ?? 0).toFixed(4)),
                        z: Number((f.splineTRZ ?? 0).toFixed(4)),
                    },
                    wR: Number((f.splineWR ?? 0).toFixed(4)),
                    Ls: Number((f.splineLs ?? 0).toFixed(4)),
                }))
                .filter((r) => r.i >= 188 && r.i <= 196);
            console.log("[RND-JOINT-I]", style, JSON.stringify(jointDump));
            if (local.length) misses.push(`${style}: ${local.join("; ")}`);
            (geo.userData as { stlPath?: string }).stlPath = `/tmp/s1-stls/procedural-default-${style}.stl`;
            const pos = geo.getAttribute("position").array as Float32Array;
            const idx = geo.getIndex()!.array as Uint32Array;
            const medialY = ((geo.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1) >= 0 ? 1 : -1;
            const sideRight: [number, number, number] = medialY > 0 ? [1, 0, 0] : [-1, 0, 0];
            const views = [
                {
                    name: "side",
                    right: sideRight,
                    up: [0, 0, 1] as [number, number, number],
                    light: [0.15, 0.55 * medialY, 0.82] as [number, number, number],
                },
                {
                    name: "bottom34",
                    right: [0.88, 0.47, 0] as [number, number, number],
                    up: [0.2, -0.38, -0.9] as [number, number, number],
                    light: [0.2, 0.15, -0.97] as [number, number, number],
                },
                {
                    name: "arch-below",
                    right: [0.12, 0.99, 0] as [number, number, number],
                    up: [0.1, -0.01, -0.995] as [number, number, number],
                    light: [0.12, 0.28, -0.95] as [number, number, number],
                },
            ];
            const arch = geo.userData as {
                hybridArch?: {
                    marks?: Array<{ x: number; y: number; z: number; u: number; label: string }>;
                } | null;
                residualStations?: Array<{ i: number; u: number }>;
                wallFrames?: Array<{ R?: { x: number; y: number; z: number } }>;
            };
            const residualPts = (arch.residualStations ?? [])
                .map((r) => arch.wallFrames?.[r.i]?.R)
                .filter((p): p is { x: number; y: number; z: number } => !!p);
            for (const v of views) {
                const view = { right: v.right, up: v.up, light: v.light };
                const focus =
                    v.name === "arch-below" && arch.hybridArch?.marks?.length
                        ? {
                              center: {
                                  x:
                                      arch.hybridArch.marks.reduce((s, m) => s + m.x, 0) /
                                      arch.hybridArch.marks.length,
                                  y:
                                      arch.hybridArch.marks.reduce((s, m) => s + m.y, 0) /
                                      arch.hybridArch.marks.length,
                                  z:
                                      arch.hybridArch.marks.reduce((s, m) => s + m.z, 0) /
                                      arch.hybridArch.marks.length,
                              },
                              radius: 45,
                          }
                        : undefined;
                const rgb = renderMesh(pos, idx, view, 960, 720, [150, 90, 220], 140, focus);
                const b = viewBounds(pos, view, focus);
                if (style === "hybrid" && v.name === "side" && arch.hybridArch?.marks?.length) {
                    drawRampMarks(
                        rgb,
                        960,
                        720,
                        arch.hybridArch.marks.map((m) => projectViewPoint(m, view, 960, 720, b)),
                    );
                }
                if (residualPts.length) {
                    drawStationMarks(
                        rgb,
                        960,
                        720,
                        residualPts.map((m) => projectViewPoint(m, view, 960, 720, b)),
                    );
                }
                writeArtifact(`procedural-default-${style}-${v.name}.png`, encodePng(960, 720, rgb));
            }
        }
        {
            type BlendFr = {
                u?: number;
                midWeight?: number;
                splineWR?: number;
                splineRow1Deg?: number;
                splineCorner?: boolean;
                splineFlat?: boolean;
            };
            const roundFr = ((geos.round!.userData as { wallFrames?: BlendFr[] }).wallFrames ??
                []) as BlendFr[];
            const hybFr = ((geos.hybrid!.userData as { wallFrames?: BlendFr[] }).wallFrames ??
                []) as BlendFr[];
            const hybQ =
                (geos.hybrid!.userData as { columnQuality?: Record<string, number | undefined> })
                    .columnQuality ?? {};
            const rndQ =
                (geos.round!.userData as { columnQuality?: Record<string, number | undefined> })
                    .columnQuality ?? {};
            const inBlend = (f: BlendFr | undefined): boolean =>
                !!f && ((f.midWeight ?? 1) < 1 - 1e-6 || (f.splineWR ?? 1) < 1 - 1e-6);
            const hybChord = hybFr
                .map((f, i) => ({
                    i,
                    u: Number((f.u ?? 0).toFixed(4)),
                    deg: f.splineRow1Deg ?? 0,
                    w: f.midWeight ?? 1,
                    wR: f.splineWR ?? 1,
                }))
                .filter((r) => r.deg > SPLINE_ROW1_TR_MAX_DEG + 1e-6);
            const rndChordI = new Set(
                roundFr
                    .map((f, i) => ({ i, deg: f.splineRow1Deg ?? 0 }))
                    .filter((r) => r.deg > SPLINE_ROW1_TR_MAX_DEG + 1e-6)
                    .map((r) => r.i),
            );
            const onlyHybChord = hybChord.filter((r) => !rndChordI.has(r.i));
            const onlyHybBlend = onlyHybChord.filter((r) => inBlend(hybFr[r.i]));
            const acrossI = hybQ.worstAcrossI ?? -1;
            const alongI = hybQ.worstAlongRowI ?? -1;
            const hybMiss = styleMisses(geos.hybrid!, "hybrid", geos.straight);
            const rndMiss = styleMisses(geos.round!, "round", geos.straight);
            const onlyHybGates = hybMiss.filter((m) => !rndMiss.includes(m));
            console.log(
                "[RND-HYBRID-BLEND]",
                JSON.stringify({
                    nBlend: hybFr.filter(inBlend).length,
                    onlyHybridGates: onlyHybGates,
                    onlyHybridChord: onlyHybChord.slice(0, 24),
                    onlyHybridChordInBlend: onlyHybBlend.slice(0, 24),
                    across: {
                        hyb: hybQ.maxAcrossDeg ?? 0,
                        rnd: rndQ.maxAcrossDeg ?? 0,
                        worstI: acrossI,
                        inBlend: inBlend(hybFr[acrossI]),
                    },
                    along: {
                        hyb: hybQ.maxMidRowDihedralDeg ?? 0,
                        rnd: rndQ.maxMidRowDihedralDeg ?? 0,
                        worstI: alongI,
                        inBlend: inBlend(hybFr[alongI]),
                    },
                }),
            );
        }
        const sectionSegs = (
            geo: BufferGeometry,
            x0: number,
        ): Array<{ y0: number; z0: number; y1: number; z1: number }> => {
            const pos = geo.getAttribute("position").array as Float32Array;
            const idx = geo.getIndex()!.array;
            const segs: Array<{ y0: number; z0: number; y1: number; z1: number }> = [];
            for (let f = 0; f < idx.length; f += 3) {
                const pts = [0, 1, 2].map((k) => {
                    const i = idx[f + k]!;
                    return { x: pos[i * 3]!, y: pos[i * 3 + 1]!, z: pos[i * 3 + 2]! };
                });
                const hits: Array<{ y: number; z: number }> = [];
                for (let e = 0; e < 3; e++) {
                    const a = pts[e]!;
                    const b = pts[(e + 1) % 3]!;
                    if ((a.x - x0) * (b.x - x0) > 0) continue;
                    const t = Math.abs(b.x - a.x) < 1e-9 ? 0 : (x0 - a.x) / (b.x - a.x);
                    if (t < -1e-6 || t > 1 + 1e-6) continue;
                    hits.push({ y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
                }
                if (hits.length >= 2) {
                    segs.push({ y0: hits[0]!.y, z0: hits[0]!.z, y1: hits[1]!.y, z1: hits[1]!.z });
                }
            }
            return segs;
        };
        const drawSection = (
            packs: Array<{
                segs: Array<{ y0: number; z0: number; y1: number; z1: number }>;
                rgb: [number, number, number];
            }>,
            w = 2560,
            h = 1920,
            zoomWall = true,
        ): Uint8Array => {
            const rgb = new Uint8Array(w * h * 3).fill(18);
            const pts: Array<{ y: number; z: number }> = [];
            for (const p of packs) {
                for (const q of p.segs) {
                    pts.push({ y: q.y0, z: q.z0 }, { y: q.y1, z: q.z1 });
                }
            }
            let minY = Infinity;
            let maxY = -Infinity;
            let minZ = Infinity;
            let maxZ = -Infinity;
            for (const q of pts) {
                minY = Math.min(minY, q.y);
                maxY = Math.max(maxY, q.y);
                minZ = Math.min(minZ, q.z);
                maxZ = Math.max(maxZ, q.z);
            }
            if (zoomWall && Number.isFinite(minY)) {
                const midY = 0.5 * (minY + maxY);
                const left = pts.filter((q) => q.y <= midY);
                const right = pts.filter((q) => q.y > midY);
                const zSpan = (a: Array<{ y: number; z: number }>): number => {
                    let lo = Infinity;
                    let hi = -Infinity;
                    for (const q of a) {
                        lo = Math.min(lo, q.z);
                        hi = Math.max(hi, q.z);
                    }
                    return hi - lo;
                };
                const wall = zSpan(left) >= zSpan(right) ? left : right;
                if (wall.length) {
                    minY = Infinity;
                    maxY = -Infinity;
                    minZ = Infinity;
                    maxZ = -Infinity;
                    for (const q of wall) {
                        minY = Math.min(minY, q.y);
                        maxY = Math.max(maxY, q.y);
                        minZ = Math.min(minZ, q.z);
                        maxZ = Math.max(maxZ, q.z);
                    }
                    const pad = 1.5;
                    minY -= pad;
                    maxY += pad;
                    minZ -= pad;
                    maxZ += pad;
                }
            }
            const sx = (w - 32) / Math.max(1e-3, maxY - minY);
            const sz = (h - 32) / Math.max(1e-3, maxZ - minZ);
            const s = Math.min(sx, sz);
            const put = (cx: number, cy: number, col: [number, number, number]): void => {
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const px = cx + dx;
                        const py = cy + dy;
                        if (px < 0 || py < 0 || px >= w || py >= h) continue;
                        const o = (py * w + px) * 3;
                        rgb[o] = col[0];
                        rgb[o + 1] = col[1];
                        rgb[o + 2] = col[2];
                    }
                }
            };
            const toPx = (yy: number, zz: number): [number, number] => [
                Math.round(16 + (yy - minY) * s),
                Math.round(h - 16 - (zz - minZ) * s),
            ];
            const stroke = (
                y0: number,
                z0: number,
                y1: number,
                z1: number,
                col: [number, number, number],
            ): void => {
                const [x0, yy0] = toPx(y0, z0);
                const [x1, yy1] = toPx(y1, z1);
                const n = Math.max(1, Math.hypot(x1 - x0, yy1 - yy0));
                const steps = Math.max(1, Math.ceil(n));
                for (let i = 0; i <= steps; i++) {
                    const t = i / steps;
                    put(Math.round(x0 + (x1 - x0) * t), Math.round(yy0 + (yy1 - yy0) * t), col);
                }
            };
            for (const p of packs) {
                for (const q of p.segs) stroke(q.y0, q.z0, q.y1, q.z1, p.rgb);
            }
            return encodePng(w, h, rgb);
        };
        const pos0 = straight.getAttribute("position").array as Float32Array;
        let meshMinX = Infinity;
        let meshMaxX = -Infinity;
        for (let i = 0; i < pos0.length; i += 3) {
            meshMinX = Math.min(meshMinX, pos0[i]!);
            meshMaxX = Math.max(meshMaxX, pos0[i]!);
        }
        const midX = 0.5 * (meshMinX + meshMaxX);
        const heelX = meshMinX + 0.12 * (meshMaxX - meshMinX);
        const archX = meshMinX + 0.35 * (meshMaxX - meshMinX);
        const colors: Record<Style, [number, number, number]> = {
            straight: [180, 180, 180],
            round: [80, 200, 255],
            hybrid: [255, 140, 70],
        };
        const medialSign = ((straight.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1) >= 0 ? 1 : -1;
        const sideOf = (
            segs: Array<{ y0: number; z0: number; y1: number; z1: number }>,
            side: "medial" | "lateral",
        ) => {
            const sign = side === "medial" ? medialSign : -medialSign;
            return segs.filter((q) => q.y0 * sign >= -1e-6 || q.y1 * sign >= -1e-6);
        };
        for (const [name, x0] of [
            ["heel", heelX],
            ["arch", archX],
            ["midfoot", midX],
        ] as const) {
            const packs = styles.map((s) => ({ segs: sectionSegs(geos[s]!, x0), rgb: colors[s] }));
            writeArtifact(`procedural-default-section-${name}.png`, drawSection(packs));
            for (const side of ["medial", "lateral"] as const) {
                writeArtifact(
                    `procedural-default-section-${name}-${side}.png`,
                    drawSection(packs.map((p) => ({ segs: sideOf(p.segs, side), rgb: p.rgb }))),
                );
            }
        }
        const styleReport = styles.map((s) => {
            const frames = (geos[s]!.userData.wallFrames ?? []) as Array<{
                midWeight?: number;
                midChordOffMm?: number;
                midChordMm?: number;
                midThetaDeg?: number;
                midBeta?: number;
                midPlanOffMm?: number;
                midLimit?: string;
                heightMm?: number;
                g1EDeg?: number;
                g1FDeg?: number;
                midFlagged?: boolean;
                midPlanAngleDeg?: number;
                u?: number;
                lineLengthMm?: number;
                midSStar?: number;
                midKappaF?: number;
                midKappaFil?: number;
                midEndRatio?: number;
                midPeakHFrac?: number;
                midBulgeHFrac?: number;
                thetaEDeg?: number;
                thetaFDeg?: number;
                sideSign?: 1 | -1;
            }>;
            const weights = frames.map((f) => f.midWeight ?? 0);
            const chords = frames.map((f) => f.midChordOffMm ?? 0);
            const plans = frames.map((f) => f.midPlanOffMm ?? 0);
            const limits: Record<string, number> = {};
            for (const f of frames) {
                const k = f.midLimit ?? "none";
                limits[k] = (limits[k] ?? 0) + 1;
            }
            const med = (a: number[]): number => {
                const b = [...a].sort((x, y) => x - y);
                return b[Math.floor(b.length / 2)] ?? 0;
            };
            const limiter = Object.entries(limits).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
            const planStations = frames.map((f, i) => ({
                i,
                u: Number((f.u ?? 0).toFixed(4)),
                plan: Number((f.midPlanAngleDeg ?? 0).toFixed(3)),
                e: Number((f.g1EDeg ?? 0).toFixed(4)),
                f: Number((f.g1FDeg ?? 0).toFixed(4)),
            }));
            return {
                style: s,
                g1E: geos[s]!.userData.columnQuality?.maxG1EDeg,
                g1F: geos[s]!.userData.columnQuality?.maxG1FDeg,
                across: geos[s]!.userData.columnQuality?.maxAcrossDeg,
                p99: geos[s]!.userData.columnQuality?.maxAcrossP99Deg,
                midP99: geos[s]!.userData.columnQuality?.maxMidAcrossP99Deg,
                eTurn: geos[s]!.userData.columnQuality?.maxETurningPlanDeg,
                fTurn: geos[s]!.userData.columnQuality?.maxFTurningPlanDeg,
                midRowTurn: geos[s]!.userData.columnQuality?.maxMidRowTurnDeg,
                midRowDihedral: geos[s]!.userData.columnQuality?.maxMidRowDihedralDeg,
                plantar: plantarFlatDeltaMm(geos[s]!),
                topVsStraight: s === "straight" ? 0 : topDeltaMm(geos[s]!, straight),
                midWmax: weights.length ? Math.max(...weights) : 0,
                midWmean: weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : 0,
                chordOffMax: chords.length ? Math.max(...chords) : 0,
                chordOffMed: med(chords),
                chordOffMedFrac: (() => {
                    const tall = frames.filter((f) => (f.heightMm ?? 0) >= 8);
                    const rs = tall.map((f) => {
                        const d = Math.max(f.midChordMm ?? f.lineLengthMm ?? 0, 1e-6);
                        return (f.midChordOffMm ?? 0) / d;
                    });
                    return rs.length ? med(rs) : 0;
                })(),
                thetaDegMax: frames.length ? Math.max(...frames.map((f) => f.midThetaDeg ?? 0)) : 0,
                betaMax: frames.length ? Math.max(...frames.map((f) => f.midBeta ?? 0)) : 0,
                planOffMax: plans.length ? Math.max(...plans) : 0,
                planOffMed: med(plans),
                limits,
                limiter,
                flagged: frames.filter((f) => f.midFlagged).length,
                sStarP10: (() => {
                    const a = frames.filter((f) => (f.midBeta ?? 0) > 1e-4).map((f) => f.midSStar ?? 0);
                    const b = [...a].sort((x, y) => x - y);
                    return b[Math.floor(0.1 * Math.max(0, b.length - 1))] ?? 0;
                })(),
                sStarP90: (() => {
                    const a = frames.filter((f) => (f.midBeta ?? 0) > 1e-4).map((f) => f.midSStar ?? 0);
                    const b = [...a].sort((x, y) => x - y);
                    return b[Math.floor(0.9 * Math.max(0, b.length - 1))] ?? 0;
                })(),
                bulgeHP50: med(
                    frames
                        .filter((f) => (f.heightMm ?? 0) >= 6 && (f.midBeta ?? 0) > 1e-4)
                        .map((f) => f.midBulgeHFrac ?? 0),
                ),
                peakHP50: med(
                    frames
                        .filter((f) => (f.heightMm ?? 0) >= 6 && (f.midBeta ?? 0) > 1e-4)
                        .map((f) => f.midPeakHFrac ?? 0),
                ),
                kappaFMax: Math.max(
                    0,
                    ...frames.map((f) => Math.abs((f.midKappaF ?? 0) - (f.midKappaFil ?? 0))),
                ),
                endRatioMed: med(
                    frames.filter((f) => (f.midBeta ?? 0) > 1e-4).map((f) => f.midEndRatio ?? 1),
                ),
                thetaEDegMax: frames.length ? Math.max(...frames.map((f) => f.thetaEDeg ?? 0)) : 0,
                thetaFDegMax: frames.length ? Math.max(...frames.map((f) => f.thetaFDeg ?? 0)) : 0,
                planOver30: planStations.filter((p) => p.plan > WALL_PLAN_ANGLE_REPORT_DEG + 1e-6),
                af6037caG1_22_26: {
                    note: "At af6037ca, 450/452 stations flagged (skew tE/tF, no 3D M) and fell back to a chord with G1 22–26°. Listed with current u and tE/tF plan angle.",
                    stations: planStations,
                },
                g1Over: frames
                    .map((f, i) => ({
                        i,
                        u: Number((f.u ?? 0).toFixed(4)),
                        e: Number((f.g1EDeg ?? 0).toFixed(3)),
                        f: Number((f.g1FDeg ?? 0).toFixed(3)),
                        plan: Number((f.midPlanAngleDeg ?? 0).toFixed(3)),
                        flagged: !!f.midFlagged,
                    }))
                    .filter((s) => s.e > 1 + 1e-6 || s.f > 1 + 1e-6 || s.flagged),
            };
        });
        console.log("[S1-WALL-STYLE]", JSON.stringify(styleReport));
        const i0Dump = styles.map((s) => ({
            style: s,
            dump:
                (geos[s]!.userData as { columnQuality?: { i0Dump?: unknown } }).columnQuality?.i0Dump ??
                (geos[s]!.userData as { wallFrames?: Array<{ i0Dump?: unknown }> }).wallFrames?.[0]?.i0Dump ??
                null,
        }));
        console.log("[RND-I0-DUMP]", JSON.stringify(i0Dump));
        const samplingDump = styles.map((s) => {
            const q = geos[s]!.userData as {
                columnQuality?: {
                    g1FlipDump?: unknown;
                    acrossI212Dump?: unknown;
                    splineNL?: number;
                    splineNB?: number;
                    splineN?: number;
                    maxG1RMeshDeg?: number;
                    worstAcrossI?: number;
                    worstAcrossK?: number;
                    worstAcrossU?: number;
                    maxAcrossDeg?: number;
                    freezeOk?: boolean;
                    residualStations?: unknown;
                    inflRemainder?: unknown;
                    maxLandingTurnDeg?: number;
                    maxLandingAlongDeg?: number;
                    maxMidAcrossP99Deg?: number;
                    maxAcrossP99Deg?: number;
                };
                residualStations?: unknown;
                inflRemainder?: unknown;
                freezeOk?: boolean;
                g1FlipDump?: unknown;
                acrossI212Dump?: unknown;
            };
            return {
                style: s,
                NL: q.columnQuality?.splineNL ?? 0,
                NB: q.columnQuality?.splineNB ?? 0,
                N: q.columnQuality?.splineN ?? 0,
                maxG1RMeshDeg: q.columnQuality?.maxG1RMeshDeg ?? 0,
                freezeOk: q.columnQuality?.freezeOk ?? q.freezeOk ?? false,
                p99: q.columnQuality?.maxMidAcrossP99Deg ?? q.columnQuality?.maxAcrossP99Deg ?? 0,
                landingTurn: q.columnQuality?.maxLandingTurnDeg ?? 0,
                landingAlong: q.columnQuality?.maxLandingAlongDeg ?? 0,
                residualStations: q.columnQuality?.residualStations ?? q.residualStations ?? [],
                inflRemainder: q.columnQuality?.inflRemainder ?? q.inflRemainder ?? [],
                worstAcross: {
                    i: q.columnQuality?.worstAcrossI,
                    k: q.columnQuality?.worstAcrossK,
                    u: q.columnQuality?.worstAcrossU,
                    deg: q.columnQuality?.maxAcrossDeg,
                },
                g1FlipDump: q.columnQuality?.g1FlipDump ?? q.g1FlipDump ?? null,
                acrossI212Dump: q.columnQuality?.acrossI212Dump ?? q.acrossI212Dump ?? null,
            };
        });
        console.log("[RND-SAMPLING-DUMP]", JSON.stringify(samplingDump));
        const residualReport = styles.map((s) => ({
            style: s,
            freezeOk: (samplingDump.find((d) => d.style === s) ?? {}).freezeOk,
            residuals: (samplingDump.find((d) => d.style === s) ?? {}).residualStations ?? [],
            inflRemainder: (samplingDump.find((d) => d.style === s) ?? {}).inflRemainder ?? [],
        }));
        console.log("[RND-RESIDUAL]", JSON.stringify(residualReport));
        const rndDump = styles.map((s) => {
            const ud = geos[s]!.userData as {
                rndIndex?: unknown;
                rndEndOk?: unknown;
                wallFrames?: Array<{
                    u?: number;
                    o?: number;
                    a?: number;
                    heightMm?: number;
                    zy?: number;
                    tRAngleDeg?: number;
                    splineFlat?: boolean;
                    splineWR?: number;
                    splineFlatReason?: string;
                }>;
            };
            const flats = (ud.wallFrames ?? [])
                .map((f, i) => ({
                    i,
                    u: Number((f.u ?? 0).toFixed(4)),
                    o: Number((f.o ?? 0).toFixed(4)),
                    a: Number((f.a ?? 0).toFixed(4)),
                    H: Number((f.heightMm ?? 0).toFixed(3)),
                    wR: Number((f.splineWR ?? 0).toFixed(4)),
                    reason: f.splineFlatReason ?? "",
                }))
                .filter((_, i) => ud.wallFrames?.[i]?.splineFlat);
            return { style: s, rndIndex: ud.rndIndex, rndEndOk: ud.rndEndOk, flats };
        });
        const straightStl = "/tmp/s1-stls/procedural-default-straight.stl";
        const stlGates: Partial<Record<Style, StlGate>> = {};
        const hard: string[] = [];
        const straightWind =
            (
                geos.straight!.userData as {
                    winding?: { consistent?: boolean; oppositeEdgeMismatch?: number; signedVolume?: number };
                }
            ).winding ?? windingReport(geos.straight!);
        const straightVol = straightWind.signedVolume ?? 0;
        for (const style of styles) {
            const q =
                (
                    geos[style]!.userData as {
                        columnQuality?: {
                            nFaceFlips?: number;
                            nColZFail?: number;
                            nColQuadFail?: number;
                            dVPred?: number;
                            maxWRStep?: number;
                            faceFlips?: Array<{ i: number; k: number }>;
                        };
                    }
                ).columnQuality ?? {};
            const wind =
                (
                    geos[style]!.userData as {
                        winding?: {
                            consistent?: boolean;
                            oppositeEdgeMismatch?: number;
                            signedVolume?: number;
                        };
                    }
                ).winding ?? windingReport(geos[style]!);
            const add = (
                gateName: string,
                pass: boolean,
                value: number | string,
                cap?: number | string,
            ): void => {
                tables[style]?.push({ gate: gateName, pass, value, cap });
            };
            const gWind =
                !!wind.consistent && (wind.oppositeEdgeMismatch ?? 1) === 0 && (wind.signedVolume ?? 0) > 0;
            add("G-WIND", gWind, wind.oppositeEdgeMismatch ?? -1, 0);
            if (!gWind) {
                hard.push(`${style}: G-WIND mismatch=${wind.oppositeEdgeMismatch} vol=${wind.signedVolume}`);
            }
            const nFace = q.nFaceFlips ?? 0;
            add("G-FACE", nFace === 0 || style === "straight", nFace, `n·out>${SPLINE_FACE_DOT_MIN}`);
            if (style !== "straight" && nFace > 0) {
                hard.push(`${style}: G-FACE flips=${nFace} ${JSON.stringify(q.faceFlips ?? [])}`);
            }
            const colFail = (q.nColZFail ?? 0) + (q.nColQuadFail ?? 0);
            add("G-COL", colFail === 0 || style === "straight", colFail, 0);
            if (style !== "straight" && colFail > 0) {
                hard.push(`${style}: G-COL zFail=${q.nColZFail} quadFail=${q.nColQuadFail}`);
            }
            const dV = q.dVPred ?? 0;
            const vol = wind.signedVolume ?? 0;
            const volErr = style === "straight" ? 0 : Math.abs(vol - straightVol - dV);
            const volCap = SPLINE_VOL_ERR_FRAC * Math.max(straightVol, 1e-6);
            const gVol = style === "straight" || volErr <= volCap;
            add("G-VOL", gVol, volErr, volCap);
            add("dV_pred", true, dV, "mm3");
            add(
                "max-wR-step",
                (q.maxWRStep ?? 0) <= SPLINE_WR_STEP_MAX + 1e-9,
                q.maxWRStep ?? 0,
                SPLINE_WR_STEP_MAX,
            );
            if (!gVol) {
                hard.push(
                    `${style}: G-VOL |${vol.toFixed(1)}-${straightVol.toFixed(1)}-${dV.toFixed(1)}|=${volErr.toFixed(1)} > ${volCap.toFixed(1)}`,
                );
            }
        }
        if (hard.length) {
            writeArtifact(
                "procedural-default-style-report.json",
                Buffer.from(
                    `${JSON.stringify({ styleReport, analyticTables, meshTables, gateTables: tables, rndDump, stlGates, hard, i0Dump, samplingDump, residualReport }, null, 2)}\n`,
                ),
            );
            throw new Error(`[STL-GATE] ${hard.join(" | ")}`);
        }
        mkdirSync("/tmp/s1-stls", { recursive: true });
        const stlBufs: Partial<Record<Style, Buffer>> = {};
        for (const style of styles) {
            const geo = geos[style]!;
            const buf = Buffer.from(geometryToBinarySTL(geo));
            stlBufs[style] = buf;
            writeFileSync(`/tmp/s1-stls/procedural-default-${style}.stl`, buf);
        }
        for (const style of styles) {
            const buf = stlBufs[style]!;
            const stlPath = `/tmp/s1-stls/procedural-default-${style}.stl`;
            const gate = loadStlGates(style, stlPath, style === "straight" ? undefined : straightStl);
            stlGates[style] = gate;
            const md5 = createHash("md5").update(buf).digest("hex");
            console.log("[STL-GATE]", style, JSON.stringify({ ...gate, md5 }));
            const add = (
                gateName: string,
                pass: boolean,
                value: number | string,
                cap?: number | string,
            ): void => {
                tables[style]?.push({ gate: gateName, pass, value, cap });
            };
            add("stl-watertight", gate.watertight, gate.watertight ? 1 : 0, 1);
            add("stl-winding", gate.winding, gate.winding ? 1 : 0, 1);
            add("stl-bodies", gate.bodies === 1, gate.bodies, 1);
            add("volume-vs-straight", true, gate.volumeDeltaPct ?? 0, "report-only");
            if (style === "straight") {
                add("straight-md5", md5 === STRAIGHT_STL_MD5, md5, STRAIGHT_STL_MD5);
                if (md5 !== STRAIGHT_STL_MD5) {
                    hard.push(`straight: md5 ${md5} != ${STRAIGHT_STL_MD5}`);
                }
            }
            if (!gate.watertight) hard.push(`${style}: stl not watertight`);
            if (!gate.winding) {
                hard.push(`${style}: G-WIND trimesh is_winding_consistent=false`);
            }
            if (gate.bodies !== 1) hard.push(`${style}: stl bodies=${gate.bodies}`);
        }
        if (hard.length) {
            writeArtifact(
                "procedural-default-style-report.json",
                Buffer.from(
                    `${JSON.stringify({ styleReport, analyticTables, meshTables, gateTables: tables, rndDump, stlGates, hard, i0Dump, samplingDump, residualReport }, null, 2)}\n`,
                ),
            );
            throw new Error(`[STL-GATE] ${hard.join(" | ")}`);
        }
        for (const style of styles) {
            writeArtifact(`procedural-default-${style}.stl`, stlBufs[style]!);
        }
        const jointReport = styles.map((s) => {
            const frames = geos[s]!.userData as {
                wallFrames?: Array<{
                    u?: number;
                    splineLambda?: number;
                    splineLipTurnDeg?: number;
                    splineTRS?: number;
                    splineTRZ?: number;
                    splineWR?: number;
                    splineLs?: number;
                    splineSzRows?: Array<{ k: number; s: number; z: number }>;
                    maxOppTurnDeg?: number;
                }>;
                hybridArch?: { uA0?: number; uA1?: number; lbMm?: number } | null;
                columnQuality?: { worstAcrossI?: number; worstAcrossK?: number; worstAcrossU?: number };
            };
            const wall = frames.wallFrames ?? [];
            const i188 = wall
                .map((f, i) => ({
                    i,
                    u: Number((f.u ?? 0).toFixed(4)),
                    lambda: Number((f.splineLambda ?? 0).toFixed(4)),
                    lipTurn: Number((f.splineLipTurnDeg ?? 0).toFixed(3)),
                    tR: {
                        s: Number((f.splineTRS ?? 0).toFixed(4)),
                        z: Number((f.splineTRZ ?? 0).toFixed(4)),
                    },
                    wR: Number((f.splineWR ?? 0).toFixed(4)),
                    Ls: Number((f.splineLs ?? 0).toFixed(4)),
                    maxOpp: Number((f.maxOppTurnDeg ?? 0).toFixed(3)),
                }))
                .filter((r) => r.i >= 188 && r.i <= 196);
            let u044: unknown = null;
            if (s === "hybrid") {
                let best = 0;
                let bestD = Number.POSITIVE_INFINITY;
                for (let i = 0; i < wall.length; i++) {
                    const d = Math.abs((wall[i]!.u ?? 0) - 0.44);
                    if (d < bestD) {
                        bestD = d;
                        best = i;
                    }
                }
                const q = frames.columnQuality ?? {};
                u044 = {
                    i: best,
                    u: Number((wall[best]?.u ?? 0).toFixed(4)),
                    wR: Number((wall[best]?.splineWR ?? 0).toFixed(4)),
                    across: { i: q.worstAcrossI, k: q.worstAcrossK, u: q.worstAcrossU },
                    rows: wall[best]?.splineSzRows ?? [],
                    arch: frames.hybridArch ?? null,
                };
            }
            return { style: s, i188, u044 };
        });
        writeArtifact(
            "procedural-default-style-report.json",
            Buffer.from(
                `${JSON.stringify({ styleReport, analyticTables, meshTables, gateTables: tables, rndDump, stlGates, jointReport, i0Dump, samplingDump, residualReport }, null, 2)}\n`,
            ),
        );
        if (misses.length) {
            console.log("[S1-STYLE]", misses.join(" | "));
            if (!SPLINE_GATES_REPORT_ONLY) throw new Error(`[S1-STYLE] ${misses.join(" | ")}`);
        }
        for (const g of Object.values(geos)) g?.dispose();
        raw.dispose();
    }, 360_000);
});
