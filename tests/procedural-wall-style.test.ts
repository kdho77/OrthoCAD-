// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    ACROSS_STATION_MAX_DEG,
    ACROSS_STATION_P99_MAX_DEG,
    countSelfIntersections,
    extractStockWallModel,
    G1_MAX_DEG,
    hybridBulgeAt,
    plantarFlatDeltaMm,
    RING_TURNING_MAX_DEG,
    reconstructionManifold,
    reconstructProceduralWalls,
    SPLINE_F_RING_MAX,
    SPLINE_G1_R_MAX_DEG,
    SPLINE_GATES_REPORT_ONLY,
    SPLINE_H_MIN_MM,
    SPLINE_MIN_EDGE_FRAC,
    SPLINE_PEAK_GATE_HI,
    SPLINE_PEAK_GATE_LO,
    SPLINE_PLAN_OUT_MM,
    SPLINE_ROW1_TR_MAX_DEG,
    SPLINE_SAG_HI,
    SPLINE_SAG_LO,
    SPLINE_SEAM_B_MAX_DEG,
    SPLINE_STEP_RATIO_MAX,
    WALL_MID_DIHEDRAL_MAX_DEG,
    WALL_MID_TURN_MAX_DEG,
    WALL_PLAN_ANGLE_REPORT_DEG,
    WALL_STYLE_ACROSS_P99_BLOCK_DEG,
    WALL_STYLE_ACROSS_P100_BLOCK_DEG,
} from "@/lib/geometry/procedural-wall";
import { geometryToBinarySTL } from "@/lib/geometry/stl";
import { loadProductionDefaultGlb } from "./helpers/load-production-default-glb";
import { encodePng, renderMesh } from "./helpers/render-png";

type Style = "straight" | "round" | "hybrid";

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
            duplicateVerts?: number;
            worstAcrossI?: number;
            worstAcrossU?: number;
            worstAlongRowI?: number;
            worstAlongRowU?: number;
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
            fallbackStraight?: boolean;
            midPlanOffMm?: number;
            splineRow1Deg?: number;
            splineStepRatio?: number;
            splineMinEdge?: number;
            splineL?: number;
            splineFk?: number[];
            splineFlat?: boolean;
            splineWR?: number;
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
    const g1ECap = style === "straight" ? G1_MAX_DEG : SPLINE_G1_R_MAX_DEG;
    const g1FCap = style === "straight" ? G1_MAX_DEG : SPLINE_SEAM_B_MAX_DEG;
    if ((q.maxG1EDeg ?? 0) > g1ECap + 1e-6) misses.push(`G1-R ${q.maxG1EDeg?.toFixed(2)}>${g1ECap}`);
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
        if ((q.maxSplineStepRatio ?? 1) > SPLINE_STEP_RATIO_MAX + 1e-9) {
            misses.push(`step-ratio ${q.maxSplineStepRatio?.toFixed(2)}>${SPLINE_STEP_RATIO_MAX}`);
        }
        if ((q.minSplineEdgeOverLN ?? 1) + 1e-9 < 1) {
            misses.push(
                `minEdge ${((q.minSplineEdgeOverLN ?? 0) * SPLINE_MIN_EDGE_FRAC).toFixed(3)}<${SPLINE_MIN_EDGE_FRAC} L/N`,
            );
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
    if (plantarFlatDeltaMm(geo) > 1e-3) misses.push(`plantar-z ${plantarFlatDeltaMm(geo).toFixed(4)}`);
    if (straight) {
        const top = topDeltaMm(geo, straight);
        if (top > 1e-6) misses.push(`top-vs-straight ${top.toFixed(6)}`);
        const rim = rimDeltaMm(geo, straight);
        if (rim > 1e-3) misses.push(`rim-vs-straight ${rim.toFixed(4)}`);
    }
    const frames = ud.wallFrames ?? [];
    const pct = (vals: number[], p: number): number => {
        if (!vals.length) return 0;
        const s = [...vals].sort((a, b) => a - b);
        const i = Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1))));
        return s[i]!;
    };
    if (style !== "straight" && frames.length) {
        const infl = frames.filter((f) => f.midFlagged);
        if (infl.length) misses.push(`[RND-INFL] ${infl.length}`);
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
        const styled = frames.filter((f) => (f.midBeta ?? 0) > 1e-4 && !f.fallbackStraight);
        const tall = styled.filter((f) => (f.heightMm ?? 0) >= SPLINE_H_MIN_MM);
        const sagH = tall.map((f) => f.midBulgeHFrac ?? 0);
        const peakH = tall.map((f) => f.midPeakHFrac ?? 0);
        if (sagH.length) {
            const p10 = pct(sagH, 0.1);
            const p90 = pct(sagH, 0.9);
            if (p10 + 1e-9 < SPLINE_SAG_LO || p90 - 1e-9 > SPLINE_SAG_HI) {
                misses.push(`sag p10-p90 ${p10.toFixed(3)}-${p90.toFixed(3)}`);
            }
        }
        if (peakH.length) {
            const p10 = pct(peakH, 0.1);
            const p90 = pct(peakH, 0.9);
            if (p10 + 1e-9 < SPLINE_PEAK_GATE_LO || p90 - 1e-9 > SPLINE_PEAK_GATE_HI) {
                misses.push(`peak p10-p90 ${p10.toFixed(3)}-${p90.toFixed(3)}`);
            }
        }
        const insetHits = frames.filter((f) => (f.midPlanOffMm ?? 0) < -1e-6);
        if (insetHits.length) misses.push(`inset ${insetHits.length}`);
        const planHits = frames.filter((f) => (f.midPlanOffMm ?? 0) > SPLINE_PLAN_OUT_MM + 1e-6);
        if (planHits.length) {
            misses.push(`plan ${planHits.length} >${SPLINE_PLAN_OUT_MM}`);
        }
        const g1Hits = frames.filter((f) => (f.g1EDeg ?? 0) > SPLINE_G1_R_MAX_DEG + 1e-6);
        if (g1Hits.length) {
            misses.push(`G1-R ${g1Hits.length} >${SPLINE_G1_R_MAX_DEG}`);
        }
        const seamHits = frames.filter((f) => (f.g1FDeg ?? 0) > SPLINE_SEAM_B_MAX_DEG + 1e-6);
        if (seamHits.length) {
            misses.push(`seam-B ${seamHits.length} >${SPLINE_SEAM_B_MAX_DEG}`);
        }
    }
    if (style === "hybrid" && frames.length) {
        const heel = frames.filter((f) => f.u <= 0.12);
        const midfoot = frames.filter((f) => f.u >= 0.5 && f.u <= 0.7);
        if (heel.some((f) => hybridBulgeAt(f.u, 1, 250, 0.6) > 1e-6)) {
            misses.push("hybrid heel bulge");
        }
        if (midfoot.length && midfoot.every((f) => hybridBulgeAt(f.u, 1, 250, 0.6) < 0.5)) {
            misses.push("hybrid midfoot not round");
        }
        const us = [0, 0.15, 0.25, 0.35, 0.5, 0.7, 0.9];
        for (let i = 1; i < us.length; i++) {
            if (hybridBulgeAt(us[i]!, 1, 250, 0.6) + 1e-9 < hybridBulgeAt(us[i - 1]!, 1, 250, 0.6)) {
                misses.push("bulge-not-monotone");
            }
        }
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
            duplicateVerts?: number;
            worstAcrossI?: number;
            worstAcrossU?: number;
            worstAlongRowI?: number;
            worstAlongRowU?: number;
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
            splineFlat?: boolean;
            splineWR?: number;
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
    const g1 = worstHi(
        (f) => f.g1EDeg ?? 0,
        (v) => v > SPLINE_G1_R_MAX_DEG + 1e-6,
    );
    const chord = worstHi(
        (f) => f.splineRow1Deg ?? 0,
        (v) => v > SPLINE_ROW1_TR_MAX_DEG + 1e-6,
    );
    const seam = worstHi(
        (f) => f.g1FDeg ?? 0,
        (v) => v > SPLINE_SEAM_B_MAX_DEG + 1e-6,
    );
    const infl = worstHi(
        (f) => (f.midFlagged ? 1 : 0),
        (v) => v > 0,
    );
    const poly = worstHi(
        (f) => (f.fallbackStraight ? 1 : 0),
        (v) => v > 0,
    );
    const sagHi = worstHi(
        (f) => ((f.heightMm ?? 0) >= SPLINE_H_MIN_MM ? (f.midBulgeHFrac ?? 0) : 0),
        (v) => v - 1e-9 > SPLINE_SAG_HI,
    );
    const sagLo = worstLo(
        (f) => ((f.heightMm ?? 0) >= SPLINE_H_MIN_MM ? (f.midBulgeHFrac ?? 1) : 1),
        (v) => v + 1e-9 < SPLINE_SAG_LO,
    );
    const peakHi = worstHi(
        (f) => f.midPeakHFrac ?? 0,
        (v) => v - 1e-9 > SPLINE_PEAK_GATE_HI,
    );
    const peakLo = worstLo(
        (f) => f.midPeakHFrac ?? 0,
        (v) => v + 1e-9 < SPLINE_PEAK_GATE_LO,
    );
    const plan = worstHi(
        (f) => f.midPlanOffMm ?? 0,
        (v) => v > SPLINE_PLAN_OUT_MM + 1e-6,
    );
    const inset = worstLo(
        (f) => f.midPlanOffMm ?? 0,
        (v) => v < -1e-6,
    );
    const step = worstHi(
        (f) => f.splineStepRatio ?? 1,
        (v) => v > SPLINE_STEP_RATIO_MAX + 1e-9,
    );
    const edge = worstLo(
        (f) => {
            const N = Math.max(
                1,
                (geo.userData as { nJ?: number }).nJ ? ((geo.userData as { nJ?: number }).nJ ?? 2) - 1 : 1,
            );
            const need = (SPLINE_MIN_EDGE_FRAC * (f.splineL ?? 1)) / N;
            return need > 1e-12 ? (f.splineMinEdge ?? 0) / need : 1;
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
        extra?: { n?: number; worstI?: number; worstU?: number },
    ): GateRow => ({ gate, pass, value, cap, ...extra });
    const rows: GateRow[] = [
        row(
            "G1-R C'(0)",
            !(style !== "straight" && g1.n),
            style === "straight" ? (q.maxG1EDeg ?? 0) : g1.n ? g1.v : (q.maxG1EDeg ?? 0),
            style === "straight" ? G1_MAX_DEG : SPLINE_G1_R_MAX_DEG,
            g1.n ? { n: g1.n, worstI: g1.i, worstU: g1.u } : undefined,
        ),
        row(
            "first-chord",
            !(style !== "straight" && chord.n),
            chord.n ? chord.v : (q.maxRow1TRDeg ?? 0),
            SPLINE_ROW1_TR_MAX_DEG,
            chord.n ? { n: chord.n, worstI: chord.i, worstU: chord.u } : undefined,
        ),
        row(
            "seam-B",
            !(style !== "straight" && seam.n),
            seam.n ? seam.v : (q.maxG1FDeg ?? 0),
            style === "straight" ? G1_MAX_DEG : SPLINE_SEAM_B_MAX_DEG,
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
            "sag-lo",
            !sagLo.n || style === "straight",
            sagLo.n ? sagLo.v : 0,
            SPLINE_SAG_LO,
            sagLo.n ? { n: sagLo.n, worstI: sagLo.i, worstU: sagLo.u } : undefined,
        ),
        row(
            "sag-hi",
            !sagHi.n || style === "straight",
            sagHi.n ? sagHi.v : 0,
            SPLINE_SAG_HI,
            sagHi.n ? { n: sagHi.n, worstI: sagHi.i, worstU: sagHi.u } : undefined,
        ),
        row(
            "peak-lo",
            !peakLo.n || style === "straight",
            peakLo.n ? peakLo.v : 0,
            SPLINE_PEAK_GATE_LO,
            peakLo.n ? { n: peakLo.n, worstI: peakLo.i, worstU: peakLo.u } : undefined,
        ),
        row(
            "peak-hi",
            !peakHi.n || style === "straight",
            peakHi.n ? peakHi.v : 0,
            SPLINE_PEAK_GATE_HI,
            peakHi.n ? { n: peakHi.n, worstI: peakHi.i, worstU: peakHi.u } : undefined,
        ),
        row(
            "plan",
            !plan.n || style === "straight",
            plan.n ? plan.v : 0,
            SPLINE_PLAN_OUT_MM,
            plan.n ? { n: plan.n, worstI: plan.i, worstU: plan.u } : undefined,
        ),
        row(
            "inset",
            !inset.n || style === "straight",
            inset.n ? inset.v : 0,
            0,
            inset.n ? { n: inset.n, worstI: inset.i, worstU: inset.u } : undefined,
        ),
        row(
            "step-ratio",
            !step.n || style === "straight",
            step.n ? step.v : (q.maxSplineStepRatio ?? 1),
            SPLINE_STEP_RATIO_MAX,
            step.n ? { n: step.n, worstI: step.i, worstU: step.u } : undefined,
        ),
        row(
            "minEdge/LN",
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
            q.worstAcrossI != null ? { worstI: q.worstAcrossI, worstU: q.worstAcrossU } : undefined,
        ),
        row(
            "mid-row-turn",
            style === "straight" || (q.maxMidRowTurnDeg ?? 0) <= WALL_MID_TURN_MAX_DEG + 1e-6,
            q.maxMidRowTurnDeg ?? 0,
            WALL_MID_TURN_MAX_DEG,
        ),
        row(
            "mid-row-dihedral",
            style === "straight" ||
                (q.maxMidRowDihedralDeg ?? q.maxAlongRowDeg ?? 0) <= WALL_MID_DIHEDRAL_MAX_DEG + 1e-6,
            q.maxMidRowDihedralDeg ?? q.maxAlongRowDeg ?? 0,
            WALL_MID_DIHEDRAL_MAX_DEG,
            q.worstAlongRowI != null ? { worstI: q.worstAlongRowI, worstU: q.worstAlongRowU } : undefined,
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
    ];
    return rows;
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
        for (const style of styles) {
            const geo = geos[style]!;
            const local = styleMisses(geo, style, style === "straight" ? undefined : straight);
            const table = gateTable(geo, style, style === "straight" ? undefined : straight);
            tables[style] = table;
            console.log("[RND-GATE-TABLE]", style, JSON.stringify(table));
            const frames =
                (
                    geo.userData as {
                        wallFrames?: Array<{
                            u?: number;
                            o?: number;
                            a?: number;
                            splineFlat?: boolean;
                            splineWR?: number;
                        }>;
                    }
                ).wallFrames ?? [];
            const flatList = frames
                .map((f, i) => ({
                    i,
                    u: Number((f.u ?? 0).toFixed(4)),
                    o: Number((f.o ?? 0).toFixed(4)),
                    a: Number((f.a ?? 0).toFixed(4)),
                    wR: Number((f.splineWR ?? 0).toFixed(4)),
                    flat: !!f.splineFlat,
                }))
                .filter((f) => f.flat);
            console.log("[RND-FLAT-LIST]", style, JSON.stringify(flatList));
            if (local.length) misses.push(`${style}: ${local.join("; ")}`);
            writeArtifact(`procedural-default-${style}.stl`, Buffer.from(geometryToBinarySTL(geo)));
            const pos = geo.getAttribute("position").array as Float32Array;
            const idx = geo.getIndex()!.array as Uint32Array;
            const views = [
                {
                    name: "side",
                    right: [0.82, 0.57, 0] as [number, number, number],
                    up: [0, 0, 1] as [number, number, number],
                    light: [0.25, 0.55, 0.8] as [number, number, number],
                },
                {
                    name: "medial",
                    right: [0.18, 0.98, 0] as [number, number, number],
                    up: [0, 0, 1] as [number, number, number],
                    light: [0.15, 0.7, 0.7] as [number, number, number],
                },
            ];
            for (const v of views) {
                const rgb = renderMesh(pos, idx, { right: v.right, up: v.up, light: v.light }, 960, 720);
                writeArtifact(`procedural-default-${style}-${v.name}.png`, encodePng(960, 720, rgb));
            }
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
        writeArtifact(
            "procedural-default-style-report.json",
            Buffer.from(`${JSON.stringify({ styleReport, gateTables: tables }, null, 2)}\n`),
        );
        if (misses.length) {
            console.log("[S1-STYLE]", misses.join(" | "));
            if (!SPLINE_GATES_REPORT_ONLY) throw new Error(`[S1-STYLE] ${misses.join(" | ")}`);
        }
        for (const g of Object.values(geos)) g?.dispose();
        raw.dispose();
    }, 360_000);
});
