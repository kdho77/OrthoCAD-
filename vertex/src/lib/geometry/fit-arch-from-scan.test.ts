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
import {
    type BandedGapSample,
    decomposeRigidGapBanded,
    subtractRigidGap,
} from "@/lib/geometry/scan-fit-residual";
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
 * Full-footprint synthetic: arch dome on medial midfoot + flat heel/lateral/toe
 * so the banded rigid plane has reference anatomy that is NOT the arch.
 */
function syntheticArchScan(opts: {
    lengthMm: number;
    widthMm: number;
    heightMm: number;
    apexU: number;
    pitchDeg?: number;
    offsetMm?: number;
    forefootValgusDeg?: number;
    rollDeg?: number;
}): Float32Array {
    const {
        lengthMm,
        widthMm,
        heightMm,
        apexU,
        pitchDeg = 0,
        offsetMm = 0,
        forefootValgusDeg = 0,
        rollDeg = 0,
    } = opts;
    const pitchRad = (pitchDeg * Math.PI) / 180;
    const rollRad = (rollDeg * Math.PI) / 180;
    const ffRad = (forefootValgusDeg * Math.PI) / 180;
    const apexMove = (apexU - ARCH_DEFAULT_APEX_U) * lengthMm;
    const pts: number[] = [];
    for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        for (let j = 0; j <= 24; j++) {
            const vSigned = -0.95 + (1.9 * j) / 24;
            const x = u * lengthMm;
            const y = vSigned * (widthMm / 2);
            const w = unitArchWeight(u, vSigned, "left", lengthMm, apexMove);
            let z = heightMm * w + offsetMm + Math.tan(pitchRad) * x + Math.tan(rollRad) * y;
            // Forefoot valgus: raise +Y in forefoot (u > 0.58) — survives heel-only roll.
            if (u > 0.58) {
                z += Math.tan(ffRad) * y;
            }
            pts.push(x, y, z);
            pts.push(x, y, z + 25);
        }
    }
    return new Float32Array(pts);
}

describe("fitArchParamsFromScan (banded + profile)", () => {
    test("HARD GATE A — pure arch amplitude recovered within 0.3 mm BEFORE compliance", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const targetHeight = 8;
        const scan = syntheticArchScan({
            lengthMm,
            widthMm,
            heightMm: targetHeight,
            apexU: 0.42,
        });
        const fit = fitArchParamsFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
            lengthMm,
        });
        expect(Math.abs(fit.amplitudePreComplianceMm - targetHeight)).toBeLessThan(0.3);
        // Post-compliance is reduced once on the composite.
        expect(fit.archHeightMm + fit.archFillMm).toBeCloseTo(
            fit.amplitudePreComplianceMm * SCAN_FIT_ARCH_COMPLIANCE,
            0,
        );
    });

    test("HARD GATE B — forefoot valgus preserved (FF−heel roll ≈ 5° ± 0.5)", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const samples: BandedGapSample[] = [];
        const ffDeg = 5;
        const ffRad = (ffDeg * Math.PI) / 180;
        for (let i = 0; i <= 50; i++) {
            const u = i / 50;
            for (let j = 0; j <= 20; j++) {
                const vSigned = -0.95 + (1.9 * j) / 20;
                const x = u * lengthMm;
                const y = vSigned * (widthMm / 2);
                // Pure FF valgus, zero registration, zero arch.
                const gapMm = u > 0.58 ? Math.tan(ffRad) * y : 0;
                samples.push({ x, y, gapMm, u, vSigned });
            }
        }
        const rigid = decomposeRigidGapBanded(samples, "left");
        expect(rigid).not.toBeNull();
        expect(Math.abs(rigid!.forefootToRearfootDeg - ffDeg)).toBeLessThan(0.5);
        // After subtraction (heel roll only), FF valgus must remain in forefoot gaps.
        const after = subtractRigidGap(samples, rigid!);
        // Fit roll on residual forefoot — should still be ~5°.
        let s0 = 0;
        let sy = 0;
        let syy = 0;
        let sg = 0;
        let sgy = 0;
        for (let i = 0; i < samples.length; i++) {
            if (samples[i]!.u <= 0.58) continue;
            const y = samples[i]!.y;
            const g = after[i]!.gapMm;
            s0 += 1;
            sy += y;
            syy += y * y;
            sg += g;
            sgy += g * y;
        }
        const det = s0 * syy - sy * sy;
        const c = (s0 * sgy - sy * sg) / det;
        const recoveredFf = (Math.atan(c) * 180) / Math.PI;
        expect(Math.abs(recoveredFf - ffDeg)).toBeLessThan(0.5);
    });

    test("injected 2° pitch does not leak into arch height (< 0.1 mm)", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const baseArgs = { lengthMm, widthMm, heightMm: 8, apexU: 0.42 };
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
        expect(Math.abs(fitP.amplitudePreComplianceMm - fit0.amplitudePreComplianceMm)).toBeLessThan(0.1);
    });

    test("HARD GATE — injected 2° roll does not leak into arch height (< 0.1 mm)", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const baseArgs = { lengthMm, widthMm, heightMm: 8, apexU: 0.42 };
        const scan0 = syntheticArchScan(baseArgs);
        const scanRoll = syntheticArchScan({ ...baseArgs, rollDeg: 2 });
        const ref = flatBaseReference(lengthMm, widthMm);
        const fit0 = fitArchParamsFromScan({
            scanPositions: scan0,
            scanVertexCount: scan0.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: ref,
            side: "left",
            lengthMm,
        });
        const fitR = fitArchParamsFromScan({
            scanPositions: scanRoll,
            scanVertexCount: scanRoll.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: ref,
            side: "left",
            lengthMm,
        });
        expect(Math.abs(fitR.amplitudePreComplianceMm - fit0.amplitudePreComplianceMm)).toBeLessThan(0.1);
    });

    test("HARD GATE C — joint solve recovers offset+pitch+roll together", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const offsetMm = 1.5;
        const pitchDeg = 2;
        const rollDeg = 2;
        const samples: BandedGapSample[] = [];
        const pitchRad = (pitchDeg * Math.PI) / 180;
        const rollRad = (rollDeg * Math.PI) / 180;
        for (let i = 0; i <= 60; i++) {
            const u = i / 60;
            for (let j = 0; j <= 24; j++) {
                const vSigned = -0.95 + (1.9 * j) / 24;
                const x = u * lengthMm;
                const y = vSigned * (widthMm / 2);
                const gapMm = offsetMm + Math.tan(pitchRad) * x + Math.tan(rollRad) * y;
                samples.push({ x, y, gapMm, u, vSigned });
            }
        }
        const rigid = decomposeRigidGapBanded(samples, "left");
        expect(rigid).not.toBeNull();
        expect(rigid!.illConditioned).toBe(false);
        // Intercept a recovers the injected offset (gap ≈ a + b·x + c·y).
        expect(Math.abs(rigid!.a - offsetMm)).toBeLessThan(0.05);
        expect(Math.abs(rigid!.pitchDeg - pitchDeg)).toBeLessThan(0.05);
        expect(Math.abs(rigid!.rollDeg - rollDeg)).toBeLessThan(0.05);

        // Arch amplitude unaffected by the combined rigid injection.
        const baseArgs = { lengthMm, widthMm, heightMm: 8, apexU: 0.42 };
        const scan0 = syntheticArchScan(baseArgs);
        const scanCombo = syntheticArchScan({ ...baseArgs, offsetMm, pitchDeg, rollDeg });
        const ref = flatBaseReference(lengthMm, widthMm);
        const fit0 = fitArchParamsFromScan({
            scanPositions: scan0,
            scanVertexCount: scan0.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: ref,
            side: "left",
            lengthMm,
        });
        const fitC = fitArchParamsFromScan({
            scanPositions: scanCombo,
            scanVertexCount: scanCombo.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: ref,
            side: "left",
            lengthMm,
        });
        expect(Math.abs(fitC.amplitudePreComplianceMm - fit0.amplitudePreComplianceMm)).toBeLessThan(0.1);
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
        expect(Math.abs(a.archFillMm - b.archFillMm)).toBeLessThan(SCAN_FIT_CONVERGE_DELTA_MM);
    });

    test("archFillMm is fitted (not force-zeroed)", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticArchScan({ lengthMm, widthMm, heightMm: 8, apexU: 0.42 });
        const fit = fitArchParamsFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
            lengthMm,
        });
        const patch = archFitToCorrectionPatch(fit);
        expect(patch.archFillMm).toBe(fit.archFillMm);
        expect(fit.solveMode === "profile" || fit.solveMode === "scalar_fallback").toBe(true);
    });

    test("right-foot medial band uses opposite vSigned", () => {
        const lengthMm = 260;
        const widthMm = 95;
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
        expect(fit.amplitudePreComplianceMm).toBeGreaterThan(3);
        expect(canAutoApplyArchFit(fit) || fit.confidence.tier === "fair").toBe(true);
    });

    test("works against parametric zero-arch reference when scan clears baseline", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticArchScan({ lengthMm, widthMm, heightMm: 22, apexU: 0.42 });
        const fit = fitArchParamsFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: { kind: "parametric", field: parametricField(lengthMm, widthMm) },
            side: "left",
            lengthMm,
        });
        expect(fit.archHeightMm + fit.archFillMm).toBeGreaterThan(2);
    });

    test("throws when medial gap samples are missing", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const pts: number[] = [];
        for (let i = 0; i < 100; i++) {
            pts.push((i / 100) * lengthMm, 20, 0);
        }
        expect(() =>
            fitArchParamsFromScan({
                scanPositions: new Float32Array(pts),
                scanVertexCount: pts.length / 3,
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
        expect(() =>
            fitArchParamsFromScan({
                scanPositions: new Float32Array(pts),
                scanVertexCount: pts.length / 3,
                scanToBase: new THREE.Matrix4().identity(),
                reference: flatBaseReference(lengthMm, widthMm),
                side: "left",
                lengthMm,
            }),
        ).toThrow(/below the base/i);
    });
});
