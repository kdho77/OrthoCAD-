// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import {
    ARCH_DEFAULT_APEX_U,
    ArchFitError,
    archFitToCorrectionPatch,
    fitArchParamsFromScan,
    unitArchWeight,
} from "@/lib/geometry/fit-arch-from-scan";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
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

/** Flat reference plane at z=0 for base-style fit. */
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
 * Synthetic plantar cloud: medial midfoot raised by `heightMm` with apex at `apexU`.
 * Left foot: medial is +Y (vSigned positive) — matches height-field medialSign.
 */
function syntheticArchScan(opts: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    apexU: number;
}): Float32Array {
    const { lengthMm, widthMm, heightMm, apexU } = opts;
    const pts: number[] = [];
    for (let i = 0; i <= 50; i++) {
        const u = 0.25 + (0.35 * i) / 50;
        for (let j = 0; j <= 20; j++) {
            // Medial half for left: vSigned ∈ [+0.15, +0.9]
            const vSigned = 0.15 + (0.75 * j) / 20;
            const x = u * lengthMm;
            const y = vSigned * (widthMm / 2);
            const du = (u - apexU) / 0.36;
            const arch = Math.abs(du) >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * Math.abs(du)));
            const medial = Math.min(1, (vSigned - 0.1) / 0.7);
            const z = heightMm * arch * medial;
            pts.push(x, y, z);
            // Dorsal decoy above plantar — fit must prefer lower Z.
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

    test("recovers arch height and distal apex from synthetic medial gap", () => {
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
        expect(fit.archHeightMm).toBeGreaterThan(5);
        expect(fit.archHeightMm).toBeLessThan(12);
        expect(fit.apexMoveMm).toBeGreaterThan(5);
        expect(fit.apexU).toBeGreaterThan(0.44);
        expect(fit.sampleCount).toBeGreaterThanOrEqual(24);
        const patch = archFitToCorrectionPatch(fit);
        expect(patch.archFillMm).toBe(0);
        expect(patch.archHeightMm).toBe(fit.archHeightMm);
    });

    test("works against parametric zero-arch reference when scan clears baseline", () => {
        const lengthMm = 260;
        const widthMm = 95;
        // Parametric baseline medial rim is ~12–16 mm — raise above it.
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

    test("throws when medial gap samples are missing", () => {
        const lengthMm = 260;
        const widthMm = 95;
        // Flat scan on the reference → no positive gaps.
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
});
