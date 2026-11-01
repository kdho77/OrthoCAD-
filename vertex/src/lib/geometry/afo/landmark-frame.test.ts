// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { Matrix4 } from "three";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { defaultAfoDesignState } from "@/lib/geometry/afo/defaults";
import { medialSign } from "@/lib/pressure-map/placement";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";
import type { Side } from "@/types";
import {
    alignScanToPlantarFrame,
    anatomicalPlacementAllowed,
    buildPlantarFrame,
    deriveAfoMeasurements,
    evaluateAfoScanProgress,
    PlantarFrameError,
    proximalTrimWarning,
    transformAfoPoint,
} from "./landmark-frame";
import type { AfoScanWorkflow, AfoTriMesh, AfoVec3 } from "./types";

const heel: AfoVec3 = { x: 0, y: 0, z: 0 };
const leftM1: AfoVec3 = { x: 120, y: -40, z: 0 };
const leftM5: AfoVec3 = { x: 100, y: 35, z: 0 };
const rightM1: AfoVec3 = { x: 120, y: 40, z: 0 };
const rightM5: AfoVec3 = { x: 100, y: -35, z: 0 };
const up = { x: 0, y: 0, z: 1 };

function dot(a: AfoVec3, b: AfoVec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function sub(a: AfoVec3, b: AfoVec3): AfoVec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

describe("AFO plantar frame", () => {
    test("frame math keeps +Y medial on left and right", () => {
        for (const side of ["left", "right"] as const) {
            const m1 = side === "left" ? leftM1 : rightM1;
            const m5 = side === "left" ? leftM5 : rightM5;
            const frame = buildPlantarFrame(heel, m1, m5, side, up);
            expect(frame.medialSign).toBe(medialSign(side));
            expect(dot(frame.yAxis, sub(m1, m5))).toBeGreaterThan(0);
            const aligned = alignScanToPlantarFrame(
                { positions: new Float32Array(9), indices: new Uint32Array() },
                {
                    heel,
                    m1p: m1,
                    m5p: m5,
                },
                side,
            );
            const m1o = transformAfoPoint(m1, aligned.matrixElements);
            const m5o = transformAfoPoint(m5, aligned.matrixElements);
            expect(medialSign(side) * m1o.y).toBeGreaterThan(medialSign(side) * m5o.y);
            const det = new Matrix4().fromArray(aligned.matrixElements).determinant();
            expect(det).toBeGreaterThan(0.999);
            expect(det).toBeLessThan(1.001);
            const origin = transformAfoPoint(heel, aligned.matrixElements);
            expect(Math.hypot(origin.x, origin.y, origin.z)).toBeLessThan(1e-6);
        }
    });

    test("triangle validation refuses a short span, a swap, and a collinear set", () => {
        expect(() =>
            buildPlantarFrame(heel, { x: 10, y: -4, z: 0 }, { x: 8, y: 4, z: 0 }, "left", up),
        ).toThrow(PlantarFrameError);
        expect(() =>
            buildPlantarFrame(heel, { x: 10, y: -4, z: 0 }, { x: 8, y: 4, z: 0 }, "left", up),
        ).toThrow(/at least 40 mm/);

        expect(() => buildPlantarFrame(heel, leftM5, leftM1, "left", up)).toThrow(/not medial of M5p/);
        expect(() => buildPlantarFrame(heel, rightM5, rightM1, "right", up)).toThrow(/not medial of M5p/);

        expect(() =>
            buildPlantarFrame(heel, { x: 80, y: 0, z: 0 }, { x: 140, y: 0, z: 0 }, "left", up),
        ).toThrow(/collinear/);
    });

    test("order enforcement places anatomical landmarks one at a time and allows redo", () => {
        const none = {};
        expect(anatomicalPlacementAllowed("posterior_calcaneus", none).ok).toBe(true);
        const skipped = anatomicalPlacementAllowed("m1_mpj", none);
        expect(skipped.ok).toBe(false);
        if (!skipped.ok) expect(skipped.message).toMatch(/Posterior calcaneus center before M1/);

        const afterHeel = { posterior_calcaneus: heel };
        expect(anatomicalPlacementAllowed("m1_mpj", afterHeel).ok).toBe(true);
        expect(anatomicalPlacementAllowed("navicular", afterHeel).ok).toBe(false);

        const placed = { posterior_calcaneus: heel, m1_mpj: leftM1, navicular: heel };
        expect(anatomicalPlacementAllowed("posterior_calcaneus", placed).ok).toBe(true);
        expect(anatomicalPlacementAllowed("m1_mpj", placed).ok).toBe(true);
    });

    test("sanity checks warn and do not move the landmarks", () => {
        const side: Side = "left";
        const good = {
            medial_malleolus: { x: 40, y: -20, z: 80 },
            lateral_malleolus: { x: 20, y: 15, z: 70 },
            navicular: { x: 60, y: -10, z: 20 },
            m1_mpj: { x: 110, y: -25, z: 5 },
            m5_mpj: { x: 100, y: 20, z: 4 },
            posterior_calcaneus: { x: -5, y: 0, z: 15 },
            fibular_head: { x: 10, y: 25, z: 220 },
        };
        const frozen = structuredClone(good);
        const mesh = columnMesh({ x: 30, y: -2.5, z: 75 }, { x: 30, y: -2.5, z: 240 });
        const ok = deriveAfoMeasurements(good, side, mesh, 2);
        expect(ok.warnings.map((warning) => warning.id)).toEqual([]);
        expect(good).toEqual(frozen);
        expect(ok.ankleAxis?.medial).toEqual(good.medial_malleolus);
        expect(ok.plannedReliefsMm).toEqual({ malleoli: -3, navicular: -2, styloid: -2 });
        expect(ok.proximalTrimCap?.offsetMm).toBe(22);
        expect(ok.proximalTrimCap?.point.z).toBeCloseTo(198);
        expect(ok.heelCupCenter).toEqual(good.posterior_calcaneus);
        expect(ok.mpjBreak?.m1).toEqual(good.m1_mpj);
        expect(ok.shankTiltDeg?.sagittal ?? 99).toBeLessThan(5);
        expect(proximalTrimWarning(22)).toBeNull();
        expect(proximalTrimWarning(18)).toMatch(/closer than 20 mm/);

        const bad = deriveAfoMeasurements(
            {
                medial_malleolus: { x: 40, y: -20, z: 80 },
                lateral_malleolus: { x: 50, y: -30, z: 90 },
                navicular: { x: 130, y: 0, z: 20 },
                m1_mpj: { x: 100, y: -20, z: 5 },
                fibular_head: { x: 40, y: -40, z: 60 },
            },
            side,
            columnMesh({ x: 45, y: -25, z: 60 }, { x: 120, y: -25, z: 90 }),
            12,
        );
        const ids = bad.warnings.map((warning) => warning.id);
        expect(ids).toContain("lat-mal-height");
        expect(ids).toContain("lat-mal-posterior");
        expect(ids).toContain("navicular-proximal");
        expect(ids).toContain("fibular-lateral");
        expect(ids).toContain("fibular-above");
        expect(ids).toContain("shank-sagittal");
        expect(ids).toContain("forefoot-rearfoot");
        expect(bad.warnings.find((warning) => warning.id === "shank-sagittal")?.message).toMatch(
            /not re-posed/,
        );
    });
});

describe("AFO scan gate", () => {
    beforeEach(() => {
        useScanStore.getState().clear();
        useClinicalWorkflowStore.setState({
            productType: "afo",
            footSideExplicitlyChosen: true,
            step: "scan",
        });
        useDesignStore.setState({
            design: {
                ...useDesignStore.getInitialState().design,
                productType: "afo",
                afo: defaultAfoDesignState("left"),
            },
        });
    });

    test("Next waits for alignment and all 8 landmarks", () => {
        useScanStore.setState({
            scans: [{ id: "leg" } as never],
        });
        const empty = evaluateAfoScanProgress(defaultAfoDesignState().scanWorkflow);
        expect(empty.ok).toBe(false);
        if (!empty.ok) expect(empty.reason).toMatch(/Step 1 of 2/);
        expect(evaluateScanStepGate().ok).toBe(false);

        const aligned: AfoScanWorkflow = {
            ...defaultAfoDesignState().scanWorkflow,
            alignmentApplied: true,
            matrixElements: new Array(16).fill(0),
        };
        const mid = evaluateAfoScanProgress(aligned);
        expect(mid.ok).toBe(false);
        if (!mid.ok) expect(mid.reason).toMatch(/Posterior calcaneus center \(0\/8\)/);

        const landmarks = Object.fromEntries(
            [
                "posterior_calcaneus",
                "m1_mpj",
                "m5_mpj",
                "navicular",
                "fifth_met_base",
                "medial_malleolus",
                "lateral_malleolus",
                "fibular_head",
            ].map((id) => [id, heel]),
        );
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                afo: {
                    ...defaultAfoDesignState("left"),
                    scanWorkflow: { ...aligned, landmarks },
                },
            },
        });
        expect(evaluateScanStepGate().ok).toBe(true);
        useScanStore.setState({ scans: [] });
    });
});

function columnMesh(from: AfoVec3, to: AfoVec3): AfoTriMesh {
    const count = 24;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        positions[i * 3] = from.x + (to.x - from.x) * t;
        positions[i * 3 + 1] = from.y + (to.y - from.y) * t;
        positions[i * 3 + 2] = from.z + (to.z - from.z) * t;
    }
    return { positions, indices: new Uint32Array([0, 1, 2]) };
}
