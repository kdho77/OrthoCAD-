// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    SCAN_FIT_ARCH_COMPLIANCE,
    SCAN_FIT_CONVERGE_DELTA_MM,
    SCAN_FIT_MIN_SAMPLES,
} from "@/lib/geometry/scan-fit-constants";
import {
    iterativeRefineScalar,
    solveScalarFromWeightedGaps,
    solveWithCompliance,
} from "@/lib/geometry/scan-fit-kernel";
import {
    type BandedGapSample,
    confidenceFromRms,
    decomposeRigidGap,
    decomposeRigidGapBanded,
    type GapSample,
    gapsEntirelyNegative,
    registrationFlagsFromRigid,
    subtractRigidGap,
} from "@/lib/geometry/scan-fit-residual";

describe("scan-fit-kernel", () => {
    test("exact scalar from known gap = weight · 7", () => {
        const samples = [];
        for (let i = 0; i < SCAN_FIT_MIN_SAMPLES; i++) {
            const w = 0.5 + (i % 5) * 0.1;
            samples.push({ weight: w, gapMm: w * 7 });
        }
        const r = solveScalarFromWeightedGaps(samples);
        expect(r).not.toBeNull();
        expect(r!.value).toBeCloseTo(7, 10);
        expect(r!.residualRmsMm).toBeCloseTo(0, 10);
    });

    test("degenerate weight field → null", () => {
        const samples = Array.from({ length: SCAN_FIT_MIN_SAMPLES }, () => ({
            weight: 0,
            gapMm: 3,
        }));
        expect(solveScalarFromWeightedGaps(samples)).toBeNull();
    });

    test("compliance multiplies raw solve", () => {
        const samples = Array.from({ length: SCAN_FIT_MIN_SAMPLES }, () => {
            const w = 0.6;
            return { weight: w, gapMm: w * 10 };
        });
        const raw = solveScalarFromWeightedGaps(samples)!;
        const withC = solveWithCompliance(samples, SCAN_FIT_ARCH_COMPLIANCE)!;
        expect(withC.value).toBeCloseTo(raw.value * SCAN_FIT_ARCH_COMPLIANCE, 10);
    });

    test("iterative refine converges in 1 iter on linear fixed weights", () => {
        const gaps = Array.from({ length: SCAN_FIT_MIN_SAMPLES }, () => ({ gapMm: 4 }));
        const r = iterativeRefineScalar({
            gaps,
            weightAt: () => 1,
            initialValue: 0,
            compliance: 1,
        });
        expect(r).not.toBeNull();
        expect(r!.value).toBeCloseTo(4, 6);
        expect(r!.converged).toBe(true);
        expect(r!.iterations).toBe(1);
    });

    test("iterative refine leaves high residual on contradictory targets", () => {
        // Half the samples want 0, half want 20 — single scalar cannot clear residual.
        const gaps = Array.from({ length: SCAN_FIT_MIN_SAMPLES }, (_, i) => ({
            gapMm: i < SCAN_FIT_MIN_SAMPLES / 2 ? 0 : 20,
        }));
        const r = iterativeRefineScalar({
            gaps,
            weightAt: () => 1,
            initialValue: 0,
            compliance: 1,
        });
        expect(r).not.toBeNull();
        expect(r!.residualRmsMm).toBeGreaterThan(5);
        expect(r!.value).toBeCloseTo(10, 0);
    });

    test("iteration cap without early stop flags non-converged", () => {
        // Contradictory targets: first iter steps far with high RMS; cap at 1 → no early stop.
        const gaps = Array.from({ length: SCAN_FIT_MIN_SAMPLES }, (_, i) => ({
            gapMm: i < SCAN_FIT_MIN_SAMPLES / 2 ? 0 : 20,
        }));
        const r = iterativeRefineScalar({
            gaps,
            weightAt: () => 1,
            initialValue: 0,
            compliance: 1,
            maxIterations: 1,
        });
        expect(r).not.toBeNull();
        expect(r!.iterations).toBe(1);
        expect(r!.converged).toBe(false);
        expect(r!.residualRmsMm).toBeGreaterThan(5);
    });

    test("non-converged flag downgrades confidence one tier", () => {
        const ok = {
            meanOffsetExceeded: false,
            pitchExceeded: false,
            rollExceeded: false,
            blockAutoApply: false,
        };
        expect(confidenceFromRms(1.0, ok, true).tier).toBe("fair");
        expect(confidenceFromRms(2.0, ok, true).tier).toBe("poor");
        expect(confidenceFromRms(4.0, ok, true).tier).toBe("poor");
    });
});

describe("scan-fit-residual", () => {
    test("recovers 1.5 mm offset + 2° pitch; post-subtraction flat", () => {
        const offset = 1.5;
        const pitchDeg = 2;
        const pitchRad = (pitchDeg * Math.PI) / 180;
        const samples: GapSample[] = [];
        for (let i = 0; i < 40; i++) {
            for (let j = 0; j < 10; j++) {
                const x = 40 + i * 5;
                const y = -20 + j * 4;
                samples.push({ x, y, gapMm: offset + Math.tan(pitchRad) * x });
            }
        }
        const rigid = decomposeRigidGap(samples);
        expect(rigid).not.toBeNull();
        const meanGap = samples.reduce((s, p) => s + p.gapMm, 0) / samples.length;
        expect(rigid!.meanOffsetMm).toBeCloseTo(meanGap, 1);
        // Pitch recovery — allow 0.05°
        expect(Math.abs(rigid!.pitchDeg - pitchDeg)).toBeLessThan(0.05);
        expect(Math.abs(rigid!.rollDeg)).toBeLessThan(0.05);

        const flat = subtractRigidGap(samples, rigid!);
        const rms = Math.sqrt(flat.reduce((s, p) => s + p.gapMm * p.gapMm, 0) / flat.length);
        expect(rms).toBeLessThan(1e-6);
    });

    test("confidence tiers at RMS boundaries", () => {
        const okFlags = {
            meanOffsetExceeded: false,
            pitchExceeded: false,
            rollExceeded: false,
            blockAutoApply: false,
        };
        expect(confidenceFromRms(1.5, okFlags).tier).toBe("good");
        expect(confidenceFromRms(1.5001, okFlags).tier).toBe("fair");
        expect(confidenceFromRms(3.0, okFlags).tier).toBe("fair");
        expect(confidenceFromRms(3.0001, okFlags).tier).toBe("poor");
        expect(confidenceFromRms(0.5, { ...okFlags, blockAutoApply: true, pitchExceeded: true }).tier).toBe(
            "poor",
        );
        expect(confidenceFromRms(1.0, okFlags, true).tier).toBe("fair"); // good→fair
        expect(confidenceFromRms(2.0, okFlags, true).tier).toBe("poor"); // fair→poor
    });

    test("registration flags at bounds", () => {
        const r = {
            meanOffsetMm: 2.01,
            pitchDeg: 0,
            rollDeg: 0,
            forefootRollDeg: 0,
            heelRollDeg: 0,
            forefootToRearfootDeg: 0,
            a: 2.01,
            b: 0,
            c: 0,
            pitchFallbackUsed: false,
            rollUnsolvable: false,
            conditionNumber: 1,
            illConditioned: false,
            heelSampleCount: 100,
            lateralSampleCount: 100,
            jointSampleCount: 200,
            warnings: [] as string[],
        };
        const f = registrationFlagsFromRigid(r);
        expect(f.meanOffsetExceeded).toBe(true);
        expect(f.blockAutoApply).toBe(true);
    });

    test("banded sagittal does not absorb medial arch into pitch", () => {
        const lengthMm = 260;
        const widthMm = 95;
        const archH = 8;
        const samples: BandedGapSample[] = [];
        for (let i = 0; i <= 50; i++) {
            const u = i / 50;
            for (let j = 0; j <= 20; j++) {
                const vSigned = -0.95 + (1.9 * j) / 20;
                const x = u * lengthMm;
                const y = vSigned * (widthMm / 2);
                let gap = 0;
                if (u >= 0.28 && u <= 0.58) {
                    const m = vSigned; // left medial = +v
                    if (m > 0.2) {
                        const du = (u - 0.42) / 0.36;
                        const arch = Math.abs(du) >= 1 ? 0 : 0.5 * (1 + Math.cos(Math.PI * Math.abs(du)));
                        gap = archH * arch * Math.min(1, m);
                    }
                }
                samples.push({ x, y, gapMm: gap, u, vSigned });
            }
        }
        const rigid = decomposeRigidGapBanded(samples, "left");
        expect(rigid).not.toBeNull();
        expect(Math.abs(rigid!.pitchDeg)).toBeLessThan(0.5);
        const after = subtractRigidGap(samples, rigid!);
        let peak = 0;
        for (let i = 0; i < samples.length; i++) {
            const s = samples[i]!;
            if (s.u < 0.28 || s.u > 0.58) continue;
            if (s.vSigned < 0.2) continue;
            peak = Math.max(peak, after[i]!.gapMm);
        }
        expect(peak).toBeGreaterThan(archH - 1.5);
    });

    test("gapsEntirelyNegative", () => {
        expect(
            gapsEntirelyNegative([
                { x: 0, y: 0, gapMm: -1 },
                { x: 1, y: 0, gapMm: -0.1 },
            ]),
        ).toBe(true);
        expect(
            gapsEntirelyNegative([
                { x: 0, y: 0, gapMm: -1 },
                { x: 1, y: 0, gapMm: 0.1 },
            ]),
        ).toBe(false);
    });
});

describe("scan-fit converge delta constant", () => {
    test("idempotency threshold is 0.25 mm", () => {
        expect(SCAN_FIT_CONVERGE_DELTA_MM).toBe(0.25);
    });
});
