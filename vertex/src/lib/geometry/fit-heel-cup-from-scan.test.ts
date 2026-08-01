// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { CLINICAL_LIMITS } from "@/lib/geometry/clinical-constraints";
import { ArchFitError } from "@/lib/geometry/fit-arch-from-scan";
import {
    fitHeelCupFromScan,
    heelCupFitToCorrectionPatch,
    unitHeelCupWeight,
} from "@/lib/geometry/fit-heel-cup-from-scan";
import {
    SCAN_FIT_HEEL_COMPLIANCE,
    SCAN_FIT_HEELCUP_MAX_MM,
    SCAN_FIT_HEELCUP_MIN_MM,
} from "@/lib/geometry/scan-fit-constants";

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

function syntheticHeelScan(lengthMm: number, widthMm: number, depthMm: number): Float32Array {
    const pts: number[] = [];
    for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        for (let j = 0; j <= 24; j++) {
            const vSigned = -0.95 + (1.9 * j) / 24;
            const x = u * lengthMm;
            const y = vSigned * (widthMm / 2);
            const w = unitHeelCupWeight(u, vSigned);
            pts.push(x, y, depthMm * w);
            pts.push(x, y, depthMm * w + 20);
        }
    }
    return new Float32Array(pts);
}

describe("fitHeelCupFromScan", () => {
    test("autoApply is always false", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticHeelScan(lengthMm, widthMm, 12);
        const sug = fitHeelCupFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
        });
        expect(sug.autoApply).toBe(false);
        expect(heelCupFitToCorrectionPatch(sug).heelCupDepthMm).toBe(sug.suggestedHeelCupDepthMm);
    });

    test("clamps at SCAN_FIT_HEELCUP_MIN_MM", () => {
        const lengthMm = 260;
        const widthMm = 95;
        // Tiny bowl → compliance pushes below min → clamp up to 8.
        const scan = syntheticHeelScan(lengthMm, widthMm, 2);
        const sug = fitHeelCupFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
        });
        expect(sug.suggestedHeelCupDepthMm).toBeGreaterThanOrEqual(SCAN_FIT_HEELCUP_MIN_MM);
        expect(sug.suggestedHeelCupDepthMm).toBeLessThanOrEqual(SCAN_FIT_HEELCUP_MAX_MM);
    });

    test("clamps at SCAN_FIT_HEELCUP_MAX_MM", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticHeelScan(lengthMm, widthMm, 40);
        const sug = fitHeelCupFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
        });
        expect(sug.suggestedHeelCupDepthMm).toBeLessThanOrEqual(SCAN_FIT_HEELCUP_MAX_MM);
        expect(sug.clamped).toBe(true);
    });

    test("compliance is applied before advisory clamp", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const raw = 14;
        const scan = syntheticHeelScan(lengthMm, widthMm, raw);
        const sug = fitHeelCupFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
        });
        const expected = raw * SCAN_FIT_HEEL_COMPLIANCE;
        // Within 2 mm of compliance-scaled target before window edges dominate.
        if (expected >= SCAN_FIT_HEELCUP_MIN_MM && expected <= SCAN_FIT_HEELCUP_MAX_MM) {
            expect(Math.abs(sug.suggestedHeelCupDepthMm - expected)).toBeLessThan(2);
        }
        expect(sug.exceedsClinicalMax).toBe(sug.suggestedHeelCupDepthMm > CLINICAL_LIMITS.heelCupDepthMm.max);
    });

    test("insufficient heel coverage throws", () => {
        const lengthMm = 260;
        const widthMm = 95;
        // Only forefoot samples.
        const pts: number[] = [];
        for (let i = 0; i < 30; i++) {
            pts.push(200 + i, 10, 2);
        }
        expect(() =>
            fitHeelCupFromScan({
                scanPositions: new Float32Array(pts),
                scanVertexCount: pts.length / 3,
                scanToBase: new THREE.Matrix4().identity(),
                reference: flatBaseReference(lengthMm, widthMm),
            }),
        ).toThrow(ArchFitError);
    });
});
