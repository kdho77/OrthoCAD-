// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import type { BufferGeometry } from "three";
import {
    ACROSS_STATION_MAX_DEG,
    ACROSS_STATION_P99_MAX_DEG,
    extractStockWallModel,
    FOLD_WORST_LIMIT_DEG,
    foldReport,
    medialArchUpperWallFolds,
    RING_TURNING_MAX_DEG,
    RING_TURNING_MODIFIED_MAX_DEG,
    reconstructProceduralWalls,
    SPLINE_INFL_TURN_MIN_DEG,
    TOP_ROUND_MAX_STEP_DEG,
    WALL_MID_DIHEDRAL_MAX_DEG,
    WALL_MID_TURN_MAX_DEG,
} from "@/lib/geometry/procedural-wall";
import {
    DEFAULT_PROCEDURAL_WALL_STYLE,
    viewerWallStyleOrDefault,
} from "@/lib/geometry/procedural-wall/defaults";
import { useDesignStore } from "@/stores/design-store";
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

/** Mirrors hybrid branch of tests/procedural-wall-style.test.ts styleMisses. */
function hybridStyleMisses(geo: BufferGeometry): string[] {
    const misses: string[] = [];
    const q = (geo.userData as { columnQuality?: Record<string, number | undefined> }).columnQuality ?? {};
    const midTurn = q.maxMidRowTurnDeg ?? 0;
    const midDihedral = q.maxMidRowDihedralDeg ?? q.maxAlongRowDeg ?? 0;
    if (midTurn > WALL_MID_TURN_MAX_DEG + 1e-6) {
        misses.push(`mid-row-turn ${midTurn.toFixed(2)}>${WALL_MID_TURN_MAX_DEG}`);
    }
    if (midDihedral > WALL_MID_DIHEDRAL_MAX_DEG + 1e-6) {
        misses.push(`mid-row-dihedral ${midDihedral.toFixed(2)}>${WALL_MID_DIHEDRAL_MAX_DEG}`);
    }
    if (Math.abs((q.maxHybridW ?? 0) - 1) > 1e-9) {
        misses.push(`maxHybridW ${q.maxHybridW ?? 0}`);
    }
    const frames =
        (
            geo.userData as {
                wallFrames?: Array<{
                    u?: number;
                    sideSign?: 1 | -1;
                    midWeight?: number;
                    maxOppTurnDeg?: number;
                }>;
            }
        ).wallFrames ?? [];
    const lateral = frames.filter((f) => (f.sideSign ?? 1) < 0);
    if (lateral.some((f) => (f.midWeight ?? 0) > 1e-3)) {
        misses.push("hybrid lateral weight");
    }
    const heel = frames.filter((f) => (f.u ?? 1) <= 0.12 && (f.sideSign ?? 1) > 0);
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
    return misses;
}

function hybridDihedralGateMisses(geo: BufferGeometry, modified: boolean): string[] {
    const misses: string[] = [];
    const q = (geo.userData as { columnQuality?: Record<string, number | undefined> }).columnQuality ?? {};
    if ((q.maxAcrossDeg ?? 0) > ACROSS_STATION_MAX_DEG + 0.05) {
        misses.push(`across-p100 ${q.maxAcrossDeg?.toFixed(2)}>${ACROSS_STATION_MAX_DEG}`);
    }
    if ((q.maxAcrossP99Deg ?? 0) > ACROSS_STATION_P99_MAX_DEG + 1e-6) {
        misses.push(`across-p99 ${q.maxAcrossP99Deg?.toFixed(2)}>${ACROSS_STATION_P99_MAX_DEG}`);
    }
    const turnMax = modified ? RING_TURNING_MODIFIED_MAX_DEG : RING_TURNING_MAX_DEG;
    const eTurn = q.maxETurningPlanDeg ?? q.maxETurningDeg ?? 0;
    const fTurn = q.maxFTurningPlanDeg ?? q.maxFTurningDeg ?? 0;
    if (eTurn > turnMax + 0.01) misses.push(`E-turn ${eTurn.toFixed(2)}>${turnMax}`);
    if (fTurn > turnMax + 0.01) misses.push(`F-turn ${fTurn.toFixed(2)}>${turnMax}`);
    return misses;
}

const HYBRID_DEFAULT_SMOKES = [
    { name: "unmodified", patch: {} as Partial<SideCorrections> },
    { name: "widen+6", patch: { heelCupWidthMm: 6 } },
    { name: "heel-lift-10", patch: { heelLiftMm: 10 } },
    {
        name: "posting-4",
        patch: { rearfootWedge: { side: "lateral" as const, value: 4, unit: "deg" as const } },
    },
] as const;

describe("grinding style default", () => {
    test("DEFAULT_PROCEDURAL_WALL_STYLE is Hybrid (Kendon crease gates pass on Default)", () => {
        expect(DEFAULT_PROCEDURAL_WALL_STYLE).toBe("hybrid");
    });

    test("fresh design store session uses DEFAULT_PROCEDURAL_WALL_STYLE", () => {
        useDesignStore.getState().startFreshSession();
        expect(useDesignStore.getState().viewer.wallStyle).toBe(DEFAULT_PROCEDURAL_WALL_STYLE);
    });

    test("explicit straight wallStyle is preserved for export fallback", () => {
        expect(viewerWallStyleOrDefault("straight")).toBe("straight");
        expect(viewerWallStyleOrDefault(undefined)).toBe(DEFAULT_PROCEDURAL_WALL_STYLE);
    });

    test("Hybrid Default procedural crease/dihedral gates with heel widen, lift, posting", async () => {
        const raw = await loadProductionDefaultGlb({ slot: "left" });
        const model = extractStockWallModel(raw, { id: "default", name: "Default" });
        const straight = reconstructProceduralWalls(model, { wallStyle: "straight" });
        const failures: string[] = [];
        for (const smoke of HYBRID_DEFAULT_SMOKES) {
            const modified = smoke.name !== "unmodified";
            const geo = reconstructProceduralWalls(model, {
                corrections: { ...neutralCorrections(), ...smoke.patch },
                stockThicknessMm: 3,
                wallStyle: "hybrid",
            });
            const topN = (geo.userData as { topVertexCount?: number }).topVertexCount ?? 0;
            const outlineN = (geo.userData as { outlineVertexCount?: number }).outlineVertexCount ?? 0;
            const outlineStart = (geo.userData as { outlineVertexStart?: number }).outlineVertexStart ?? topN;
            const fold = foldReport(geo, {
                wholeInsole: true,
                topVertexCount: topN,
                outlineVertexCount: outlineN,
                outlineVertexStart: outlineStart,
                plantarVertexStart: (geo.userData as { plantarStart?: number }).plantarStart,
                plantarVertexEnd: (geo.userData as { plantarEnd?: number }).plantarEnd,
            });
            const designedStep =
                (geo.userData as { columnQuality?: { maxRoundStepDeg?: number } }).columnQuality
                    ?.maxRoundStepDeg ?? TOP_ROUND_MAX_STEP_DEG;
            const archFolds = medialArchUpperWallFolds(
                geo,
                model.bounds,
                topN,
                (geo.userData as { medialYSign?: 1 | -1 }).medialYSign ?? 1,
                designedStep,
            );
            const label = `hybrid/${smoke.name}`;
            const misses = [...hybridStyleMisses(geo), ...hybridDihedralGateMisses(geo, modified)];
            if (fold.worstDeg > FOLD_WORST_LIMIT_DEG) {
                misses.push(`fold ${fold.worstDeg.toFixed(1)}>${FOLD_WORST_LIMIT_DEG}`);
            }
            if (archFolds.edgesAtLeast10Deg !== 0) {
                misses.push(`medial-arch-upper>${(designedStep + 2).toFixed(1)}`);
            }
            if (misses.length) failures.push(`${label}: ${misses.join("; ")}`);
            geo.dispose();
        }
        straight.dispose();
        raw.dispose();
        expect(failures, failures.join("\n")).toEqual([]);
    }, 300_000);
});
