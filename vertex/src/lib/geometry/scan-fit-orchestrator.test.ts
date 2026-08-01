// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { unitArchWeight } from "@/lib/geometry/fit-arch-from-scan";
import {
    SCAN_FIT_CONVERGE_DELTA_MM,
    SCAN_FIT_JOINT_RIGID_SOLVE,
    SCAN_FIT_LATERAL_COLUMN_U_MAX,
    SCAN_FIT_MAX_CONDITION_NUMBER,
    SCAN_FIT_MIN_SAMPLES,
} from "@/lib/geometry/scan-fit-constants";
import { matchFromScan } from "@/lib/geometry/scan-fit-orchestrator";
import {
    accumulatePlaneNormalSums,
    type BandedGapSample,
    decomposeRigidGapBanded,
    isHeelBandSample,
    isProximalLateralColumnSample,
    planeNormalConditionNumber,
    selectJointRigidReferenceBand,
} from "@/lib/geometry/scan-fit-residual";

function flatBaseReference(lengthMm: number, widthMm: number) {
    const nx = 40;
    const ny = 20;
    const positions: number[] = [];
    for (let i = 0; i <= nx; i++) {
        const u = i / nx;
        for (let j = 0; j <= ny; j++) {
            const v = (j / ny) * 2 - 1;
            positions.push(u * lengthMm, v * (widthMm / 2), 0);
        }
    }
    return {
        kind: "base" as const,
        topPositions: new Float32Array(positions),
        topVertexCount: positions.length / 3,
        lengthMin: 0,
        lengthSize: lengthMm,
        widthCenter: 0,
        widthHalf: widthMm / 2,
    };
}

function syntheticArchScan(opts: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    apexU: number;
    rollDeg?: number;
    pitchDeg?: number;
    offsetMm?: number;
}): Float32Array {
    const { lengthMm, widthMm, heightMm, apexU, rollDeg = 0, pitchDeg = 0, offsetMm = 0 } = opts;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const rollRad = (rollDeg * Math.PI) / 180;
    const apexMove = (apexU - 0.42) * lengthMm;
    const pts: number[] = [];
    for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        for (let j = 0; j <= 24; j++) {
            const vSigned = -0.95 + (1.9 * j) / 24;
            const x = u * lengthMm;
            const y = vSigned * (widthMm / 2);
            const w = unitArchWeight(u, vSigned, "left", lengthMm, apexMove);
            const z = heightMm * w + offsetMm + Math.tan(pitchRad) * x + Math.tan(rollRad) * y;
            pts.push(x, y, z);
            pts.push(x, y, z + 25);
        }
    }
    return new Float32Array(pts);
}

function makeGridSamples(lengthMm = 260, widthMm = 95): BandedGapSample[] {
    const samples: BandedGapSample[] = [];
    for (let i = 0; i <= 50; i++) {
        const u = i / 50;
        for (let j = 0; j <= 20; j++) {
            const vSigned = -0.95 + (1.9 * j) / 20;
            samples.push({
                x: u * lengthMm,
                y: vSigned * (widthMm / 2),
                gapMm: 0,
                u,
                vSigned,
            });
        }
    }
    return samples;
}

describe("joint rigid solve", () => {
    test("contract constants", () => {
        expect(SCAN_FIT_JOINT_RIGID_SOLVE).toBe(true);
        expect(SCAN_FIT_LATERAL_COLUMN_U_MAX).toBe(0.45);
        expect(SCAN_FIT_MAX_CONDITION_NUMBER).toBe(1000);
        expect(SCAN_FIT_MIN_SAMPLES).toBe(24);
    });

    test("joint reference = heel ∪ proximal lateral; excludes distal lateral", () => {
        const samples = makeGridSamples();
        const joint = selectJointRigidReferenceBand(samples, "left");
        expect(
            joint.every(
                (s) => isHeelBandSample(s.u) || isProximalLateralColumnSample(s.u, s.vSigned, "left"),
            ),
        ).toBe(true);
        const distalLateral = samples.filter((s) => s.u > SCAN_FIT_LATERAL_COLUMN_U_MAX && s.vSigned < -0.7);
        expect(distalLateral.length).toBeGreaterThan(0);
        expect(joint.some((s) => s.u > SCAN_FIT_LATERAL_COLUMN_U_MAX && s.vSigned < -0.7)).toBe(false);
    });

    test("condition number is finite and below guard on dense joint set", () => {
        const samples = makeGridSamples();
        const joint = selectJointRigidReferenceBand(samples, "left");
        const sums = accumulatePlaneNormalSums(joint);
        expect(sums).not.toBeNull();
        const kappa = planeNormalConditionNumber(sums!);
        expect(Number.isFinite(kappa)).toBe(true);
        expect(kappa).toBeLessThan(SCAN_FIT_MAX_CONDITION_NUMBER);
    });

    test("insufficient heel band degrades with named reason", () => {
        const samples: BandedGapSample[] = [];
        // Proximal lateral only — no heel (u > 0.28)
        for (let i = 30; i <= 45; i++) {
            const u = i / 100; // 0.30 .. 0.45
            for (let j = 0; j <= 20; j++) {
                const vSigned = -0.95 + (1.9 * j) / 20;
                samples.push({ x: u * 260, y: vSigned * 47.5, gapMm: 1, u, vSigned });
            }
        }
        const rigid = decomposeRigidGapBanded(samples, "left");
        expect(rigid).not.toBeNull();
        expect(rigid!.rollUnsolvable).toBe(true);
        expect(rigid!.warnings.some((w) => /Heel band insufficient/i.test(w))).toBe(true);
    });
});

describe("matchFromScan orchestrator", () => {
    test("runs arch + heel + flange; does not auto-apply heel/flange", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticArchScan({ lengthMm, widthMm, heightMm: 8, apexU: 0.42 });
        const result = matchFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
            lengthMm,
            allowAutoApply: true,
        });
        expect(result.arch).not.toBeNull();
        expect(result.conditionNumber).toBeGreaterThan(0);
        expect(result.postFitDeviationRmsMm).not.toBeNull();
        // Heel/flange may be null on flat synthetic (thin edge) — never auto-applied.
        if (result.heel) expect(result.heel.autoApply).toBe(false);
        if (result.flange) expect(result.flange.autoApply).toBe(false);
    });

    test("idempotent within CONVERGE_DELTA", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticArchScan({ lengthMm, widthMm, heightMm: 7, apexU: 0.42 });
        const args = {
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left" as const,
            lengthMm,
        };
        const a = matchFromScan(args);
        const b = matchFromScan(args);
        expect(a.arch).not.toBeNull();
        expect(b.arch).not.toBeNull();
        expect(Math.abs(a.arch!.archHeightMm - b.arch!.archHeightMm)).toBeLessThan(
            SCAN_FIT_CONVERGE_DELTA_MM,
        );
    });

    test("disabled path for empty scan", () => {
        const result = matchFromScan({
            scanPositions: new Float32Array(0),
            scanVertexCount: 0,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(260, 95),
            side: "left",
            lengthMm: 260,
        });
        expect(result.disabledReason).not.toBeNull();
        expect(result.arch).toBeNull();
    });
});

describe("clinical flange clamp reverted", () => {
    test("CLINICAL_LIMITS flange max is 8", async () => {
        const { CLINICAL_LIMITS } = await import("@/lib/geometry/clinical-constraints");
        expect(CLINICAL_LIMITS.medialFlangeMm.max).toBe(8);
        expect(CLINICAL_LIMITS.lateralFlangeMm.max).toBe(8);
    });
});
