// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    ARCH_DEFAULT_APEX_U,
    ArchFitError,
    archFitToCorrectionPatch,
    canAutoApplyArchFit,
    fitArchParamsFromScan,
    unitArchWeight,
} from "@/lib/geometry/fit-arch-from-scan";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { SCAN_FIT_ARCH_COMPLIANCE, SCAN_FIT_CONVERGE_DELTA_MM } from "@/lib/geometry/scan-fit-constants";
import type { SideCorrections } from "@/types";

const ZERO: SideCorrections = {
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

function parametricField(lengthMm = 260, widthMm = 95): HeightFieldParams {
    return {
        side: "left",
        lengthMm,
        widthMm,
        thicknessMm: 3,
        corrections: { ...ZERO },
    };
}

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

/**
 * Synthetic plantar cloud matching unitArchWeight shape so compliance is testable.
 * Left foot medial = +Y (vSigned > 0).
 */
function syntheticArchScan(opts: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    apexU: number;
    pitchDeg?: number;
    offsetMm?: number;
}): Float32Array {
    const { lengthMm, widthMm, heightMm, apexU, pitchDeg = 0, offsetMm = 0 } = opts;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const pts: number[] = [];
    // Full footprint samples for rigid-body (heel + arch + toe), plus dorsal decoys.
    for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        for (let j = 0; j <= 24; j++) {
            const vSigned = -0.95 + (1.9 * j) / 24;
            const x = u * lengthMm;
            const y = vSigned * (widthMm / 2);
            const w = unitArchWeight(u, vSigned, "left", lengthMm, (apexU - ARCH_DEFAULT_APEX_U) * lengthMm);
            const zArch = heightMm * w;
            const z = zArch + offsetMm + Math.tan(pitchRad) * x;
            pts.push(x, y, z);
            pts.push(x, y, z + 25);
        }
    }
    return new Float32Array(pts);
}

describe("fitArchParamsFromScan", () => {
    test("unitArchWeight peaks near default apex on medial edge", () => {
        const wApex = unitArchWeight(ARCH_DEFAULT_APEX_U, 0.7, "left", 260, 0);
        const wHeel = unitArchWeight(0.1, 0.7, "left", 260, 0);
        const wLat = unitArchWeight(ARCH_DEFAULT_APEX_U, -0.7, "left", 260, 0);
        expect(wApex).toBeGreaterThan(0.5);
        expect(wApex).toBeGreaterThan(wHeel);
        expect(wApex).toBeGreaterThan(wLat);
    });

    test("recovers arch height (with compliance) and distal apex", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const targetHeight = 8;
        const targetApexU = 0.48;
        const scan = syntheticArchScan({
            lengthMm,
            widthMm,
            heightMm: targetHeight,
            apexU: targetApexU,
        });
        const fit = fitArchParamsFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
            lengthMm,
        });
        const expected = targetHeight * SCAN_FIT_ARCH_COMPLIANCE;
        // Plane residual removes a small share of the dome; allow tolerance around compliance target.
        expect(fit.archHeightMm).toBeGreaterThan(expected * 0.45);
        expect(fit.archHeightMm).toBeLessThan(expected * 1.15);
        expect(fit.apexMoveMm).toBeGreaterThan(5);
        expect(fit.apexU).toBeGreaterThan(0.44);
        expect(fit.sampleCount).toBeGreaterThanOrEqual(24);
        expect(fit.confidence).toBeDefined();
        const patch = archFitToCorrectionPatch(fit);
        expect(patch.archFillMm).toBe(0);
        expect(patch.archHeightMm).toBe(fit.archHeightMm);
    });

    test("injected 2° pitch does not leak into arch height (< 0.1 mm)", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const baseArgs = {
            lengthMm,
            widthMm,
            heightMm: 8,
            apexU: 0.42,
        };
        const scan0 = syntheticArchScan(baseArgs);
        const scanPitch = syntheticArchScan({ ...baseArgs, pitchDeg: 2, offsetMm: 0.5 });
        const ref = flatBaseReference(lengthMm, widthMm);
        const fit0 = fitArchParamsFromScan({
            scanPositions: scan0,
            scanVertexCount: scan0.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: ref,
            side: "left",
            lengthMm,
        });
        const fitP = fitArchParamsFromScan({
            scanPositions: scanPitch,
            scanVertexCount: scanPitch.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: ref,
            side: "left",
            lengthMm,
        });
        expect(Math.abs(fitP.archHeightMm - fit0.archHeightMm)).toBeLessThan(0.1);
    });

    test("compliance: fitted height is reduced vs raw dome amplitude", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const rawHeight = 10;
        const scan = syntheticArchScan({ lengthMm, widthMm, heightMm: rawHeight, apexU: 0.42 });
        const fit = fitArchParamsFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
            lengthMm,
        });
        // Compliance + rigid residual both reduce applied height below the synthetic amplitude.
        expect(fit.archHeightMm).toBeLessThan(rawHeight * SCAN_FIT_ARCH_COMPLIANCE + 0.5);
        expect(fit.archHeightMm).toBeGreaterThan(2);
        expect(SCAN_FIT_ARCH_COMPLIANCE).toBe(0.85);
    });

    test("Match twice is idempotent within CONVERGE_DELTA", () => {
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
        const a = fitArchParamsFromScan(args);
        const b = fitArchParamsFromScan(args);
        expect(Math.abs(a.archHeightMm - b.archHeightMm)).toBeLessThan(SCAN_FIT_CONVERGE_DELTA_MM);
        expect(Math.abs(a.apexMoveMm - b.apexMoveMm)).toBeLessThan(SCAN_FIT_CONVERGE_DELTA_MM);
    });

    test("works against parametric zero-arch reference when scan clears baseline", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticArchScan({
            lengthMm,
            widthMm,
            heightMm: 22,
            apexU: 0.42,
        });
        const fit = fitArchParamsFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: { kind: "parametric", field: parametricField(lengthMm, widthMm) },
            side: "left",
            lengthMm,
        });
        expect(fit.archHeightMm).toBeGreaterThan(2);
        expect(fit.apexMoveMm).toBeGreaterThanOrEqual(-12);
        expect(fit.apexMoveMm).toBeLessThanOrEqual(12);
    });

    test("right-foot medial band uses opposite vSigned", () => {
        const lengthMm = 260;
        const widthMm = 95;
        // Build right-medial cloud (vSigned negative for right).
        const pts: number[] = [];
        for (let i = 0; i <= 60; i++) {
            const u = i / 60;
            for (let j = 0; j <= 24; j++) {
                const vSigned = -0.95 + (1.9 * j) / 24;
                const x = u * lengthMm;
                const y = vSigned * (widthMm / 2);
                const w = unitArchWeight(u, vSigned, "right", lengthMm, 0);
                pts.push(x, y, 8 * w);
            }
        }
        const scan = new Float32Array(pts);
        const fit = fitArchParamsFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "right",
            lengthMm,
        });
        expect(fit.archHeightMm).toBeGreaterThan(3);
        expect(canAutoApplyArchFit(fit) || fit.confidence.tier === "fair").toBe(true);
    });

    test("throws when medial gap samples are missing", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const pts: number[] = [];
        for (let i = 0; i < 100; i++) {
            pts.push((i / 100) * lengthMm, 20, 0);
        }
        const scan = new Float32Array(pts);
        expect(() =>
            fitArchParamsFromScan({
                scanPositions: scan,
                scanVertexCount: scan.length / 3,
                scanToBase: new THREE.Matrix4().identity(),
                reference: flatBaseReference(lengthMm, widthMm),
                side: "left",
                lengthMm,
            }),
        ).toThrow(ArchFitError);
    });

    test("entirely negative gap field → registration failure", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const pts: number[] = [];
        for (let i = 0; i <= 40; i++) {
            for (let j = 0; j <= 20; j++) {
                pts.push((i / 40) * lengthMm, ((j / 20) * 2 - 1) * (widthMm / 2), -5);
            }
        }
        const scan = new Float32Array(pts);
        expect(() =>
            fitArchParamsFromScan({
                scanPositions: scan,
                scanVertexCount: scan.length / 3,
                scanToBase: new THREE.Matrix4().identity(),
                reference: flatBaseReference(lengthMm, widthMm),
                side: "left",
                lengthMm,
            }),
        ).toThrow(/below the base/i);
    });
});
