// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { ArchFitError, unitArchWeight } from "@/lib/geometry/fit-arch-from-scan";
import { fitFlangeFromScan, flangeFitToCorrectionPatch } from "@/lib/geometry/fit-flange-from-scan";
import {
    flangeDeltaAt,
    flangeLongitudinalWeight,
    type HeightFieldParams,
    heightAt,
    unitFlangeWeight,
} from "@/lib/geometry/height-field";
import {
    FLANGE_FEATHER_U,
    FLANGE_LATERAL_U_END,
    FLANGE_LATERAL_U_START,
    FLANGE_MEDIAL_U_END,
    FLANGE_MEDIAL_U_START,
    SCAN_FIT_FLANGE_COMPLIANCE,
    SCAN_FIT_FLANGE_MIN_SAMPLES,
} from "@/lib/geometry/scan-fit-constants";
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

function field(patch: Partial<SideCorrections> = {}, side: "left" | "right" = "left"): HeightFieldParams {
    return {
        side,
        lengthMm: 260,
        widthMm: 95,
        thicknessMm: 3,
        corrections: { ...ZERO, ...patch },
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

/** Synthetic scan with medial and/or lateral rim rise in the flange bands. */
function syntheticFlangeScan(opts: {
    lengthMm: number;
    widthMm: number;
    medialMm: number;
    lateralMm: number;
    side?: "left" | "right";
}): Float32Array {
    const { lengthMm, widthMm, medialMm, lateralMm, side = "left" } = opts;
    const pts: number[] = [];
    for (let i = 0; i <= 60; i++) {
        const u = i / 60;
        for (let j = 0; j <= 24; j++) {
            const vSigned = -0.95 + (1.9 * j) / 24;
            const x = u * lengthMm;
            const y = vSigned * (widthMm / 2);
            const z =
                medialMm * unitFlangeWeight(u, vSigned, side, "medial") +
                lateralMm * unitFlangeWeight(u, vSigned, side, "lateral");
            pts.push(x, y, z);
            pts.push(x, y, z + 25);
        }
    }
    return new Float32Array(pts);
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

describe("flange operator (height-field)", () => {
    test("flange = 0 → byte-identical to pre-flange neutral", () => {
        const a = field({ medialFlangeMm: 0, lateralFlangeMm: 0 });
        const b = field({});
        for (let i = 0; i <= 20; i++) {
            const u = i / 20;
            for (let j = 0; j <= 10; j++) {
                const v = -1 + (2 * j) / 10;
                expect(heightAt(u, v, a)).toBe(heightAt(u, v, b));
            }
        }
    });

    test("stored design missing flange fields defaults to 0 (identical render)", () => {
        const withFields = field({ medialFlangeMm: 0, lateralFlangeMm: 0 });
        // Simulate legacy payload lacking the keys — heightAt uses ?? 0.
        const legacy = field();
        (legacy.corrections as Partial<SideCorrections>).medialFlangeMm = undefined as unknown as number;
        (legacy.corrections as Partial<SideCorrections>).lateralFlangeMm = undefined as unknown as number;
        for (const u of [0.2, 0.4, 0.55]) {
            for (const v of [-0.9, 0, 0.9]) {
                expect(heightAt(u, v, legacy)).toBeCloseTo(heightAt(u, v, withFields), 10);
            }
        }
    });

    test("medial flange does not raise lateral rim (no cross-talk)", () => {
        const f = field({ medialFlangeMm: 12, lateralFlangeMm: 0 });
        const n = field();
        // Left medial = +vSigned
        const medDelta = heightAt(0.45, 0.9, f) - heightAt(0.45, 0.9, n);
        const latDelta = heightAt(0.45, -0.9, f) - heightAt(0.45, -0.9, n);
        expect(medDelta).toBeGreaterThan(4);
        expect(Math.abs(latDelta)).toBeLessThan(0.05);
    });

    test("lateral flange does not raise medial rim", () => {
        const f = field({ medialFlangeMm: 0, lateralFlangeMm: 12 });
        const n = field();
        const medDelta = heightAt(0.4, 0.9, f) - heightAt(0.4, 0.9, n);
        const latDelta = heightAt(0.4, -0.9, f) - heightAt(0.4, -0.9, n);
        expect(latDelta).toBeGreaterThan(4);
        expect(Math.abs(medDelta)).toBeLessThan(0.05);
    });

    test("left vs right medial mirroring", () => {
        const left = field({ medialFlangeMm: 10 }, "left");
        const right = field({ medialFlangeMm: 10 }, "right");
        const nL = field({}, "left");
        const nR = field({}, "right");
        // Left medial +v; right medial −v
        const dL = heightAt(0.45, 0.9, left) - heightAt(0.45, 0.9, nL);
        const dR = heightAt(0.45, -0.9, right) - heightAt(0.45, -0.9, nR);
        expect(dL).toBeGreaterThan(3);
        expect(dR).toBeGreaterThan(3);
        expect(Math.abs(dL - dR)).toBeLessThan(0.2);
        // Opposite side stays flat
        expect(Math.abs(heightAt(0.45, -0.9, left) - heightAt(0.45, -0.9, nL))).toBeLessThan(0.05);
        expect(Math.abs(heightAt(0.45, 0.9, right) - heightAt(0.45, 0.9, nR))).toBeLessThan(0.05);
    });

    test("longitudinal cosine is zero at feathered ends and peaks mid-span", () => {
        const mid = 0.5 * (FLANGE_MEDIAL_U_START + FLANGE_MEDIAL_U_END);
        expect(
            flangeLongitudinalWeight(FLANGE_MEDIAL_U_START, FLANGE_MEDIAL_U_START, FLANGE_MEDIAL_U_END),
        ).toBe(0);
        expect(
            flangeLongitudinalWeight(FLANGE_MEDIAL_U_END, FLANGE_MEDIAL_U_START, FLANGE_MEDIAL_U_END),
        ).toBe(0);
        expect(flangeLongitudinalWeight(mid, FLANGE_MEDIAL_U_START, FLANGE_MEDIAL_U_END)).toBeGreaterThan(
            0.9,
        );
        expect(FLANGE_FEATHER_U).toBe(0.08);
        expect(FLANGE_LATERAL_U_START).toBe(0.25);
        expect(FLANGE_LATERAL_U_END).toBe(0.6);
    });

    test("heel cup + flange at max: proximal overlap blends (no double-add)", () => {
        const both = field({ medialFlangeMm: 25, heelCupDepthMm: 10 });
        const flangeOnly = field({ medialFlangeMm: 25, heelCupDepthMm: 0 });
        const cupOnly = field({ medialFlangeMm: 0, heelCupDepthMm: 10 });
        const neutral = field();
        // Inside medial flange feather (uStart=0.30, feather=0.08) where heel gate still active.
        const u = 0.34;
        const v = 0.9;
        const dBoth = heightAt(u, v, both) - heightAt(u, v, neutral);
        const dFlange = heightAt(u, v, flangeOnly) - heightAt(u, v, neutral);
        const dCup = heightAt(u, v, cupOnly) - heightAt(u, v, neutral);
        expect(dFlange).toBeGreaterThan(0.5);
        expect(dBoth).toBeLessThan(dFlange + Math.max(0, dCup) + dFlange * 0.5);
        const attenuated = flangeDeltaAt(u, v, "left", 25, 0, 10);
        const full = flangeDeltaAt(u, v, "left", 25, 0, 0);
        expect(full).toBeGreaterThan(0.5);
        expect(attenuated).toBeLessThan(full);
        expect(attenuated).toBeGreaterThan(0);
    });

    test("max flange (25 mm) stays finite / non-inverted at rim", () => {
        const f = field({ medialFlangeMm: 25, lateralFlangeMm: 25 });
        const n = field();
        for (const u of [0.35, 0.45, 0.55]) {
            for (const v of [-0.95, 0.95]) {
                const h = heightAt(u, v, f);
                expect(Number.isFinite(h)).toBe(true);
                expect(h).toBeGreaterThan(heightAt(u, v, n));
            }
        }
    });
});

describe("fitFlangeFromScan", () => {
    test("constants are fixed by contract", () => {
        expect(SCAN_FIT_FLANGE_MIN_SAMPLES).toBe(40);
        expect(SCAN_FIT_FLANGE_COMPLIANCE).toBe(0.8);
    });

    test("recovers medial flange independently of lateral", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticFlangeScan({ lengthMm, widthMm, medialMm: 10, lateralMm: 0 });
        const sug = fitFlangeFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
        });
        expect(sug.autoApply).toBe(false);
        expect(sug.suggestedMedialFlangeMm).toBeGreaterThan(5);
        expect(sug.suggestedLateralFlangeMm).toBeLessThan(1.5);
        const patch = flangeFitToCorrectionPatch(sug);
        expect(patch.medialFlangeMm).toBe(sug.suggestedMedialFlangeMm);
    });

    test("insufficient edge coverage throws", () => {
        const lengthMm = 260;
        const widthMm = 95;
        // Tiny sample cloud — below FLANGE_MIN_SAMPLES
        const pts = new Float32Array([
            100, 40, 5, 100, 40, 30, 110, 42, 5, 110, 42, 30, 120, -40, 5, 120, -40, 30,
        ]);
        expect(() =>
            fitFlangeFromScan({
                scanPositions: pts,
                scanVertexCount: pts.length / 3,
                scanToBase: new THREE.Matrix4().identity(),
                reference: flatBaseReference(lengthMm, widthMm),
                side: "left",
            }),
        ).toThrow(ArchFitError);
    });

    test("Poor registration blocks Apply path (confidence.tier / blockAutoApply)", () => {
        const lengthMm = 260;
        const widthMm = 95;
        // Large pitch (10°) exceeds SCAN_FIT_MAX_PITCH_DEG → blockAutoApply.
        const pts: number[] = [];
        const pitchRad = (10 * Math.PI) / 180;
        for (let i = 0; i <= 60; i++) {
            const u = i / 60;
            for (let j = 0; j <= 24; j++) {
                const vSigned = -0.95 + (1.9 * j) / 24;
                const x = u * lengthMm;
                const y = vSigned * (widthMm / 2);
                const z = 8 * unitFlangeWeight(u, vSigned, "left", "medial") + Math.tan(pitchRad) * x;
                pts.push(x, y, z, x, y, z + 25);
            }
        }
        const sug = fitFlangeFromScan({
            scanPositions: new Float32Array(pts),
            scanVertexCount: pts.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
        });
        expect(sug.confidence.registration.blockAutoApply || sug.confidence.tier === "poor").toBe(true);
    });

    test("clamp reported when solve exceeds clinical max", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const scan = syntheticFlangeScan({ lengthMm, widthMm, medialMm: 40, lateralMm: 0 });
        const sug = fitFlangeFromScan({
            scanPositions: scan,
            scanVertexCount: scan.length / 3,
            scanToBase: new THREE.Matrix4().identity(),
            reference: flatBaseReference(lengthMm, widthMm),
            side: "left",
        });
        expect(sug.suggestedMedialFlangeMm).toBeLessThanOrEqual(25);
        expect(sug.clamped || sug.suggestedMedialFlangeMm === 25).toBe(true);
    });
});

describe("HARD GATE — roll-leakage lock", () => {
    test("injected 2° registration roll does not leak into arch height (< 0.1 mm)", async () => {
        const { fitArchParamsFromScan } = await import("@/lib/geometry/fit-arch-from-scan");
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
});
