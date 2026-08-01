// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { SCAN_FIT_ARCH_COMPLIANCE, SCAN_FIT_PROFILE_RIDGE_LAMBDA } from "@/lib/geometry/scan-fit-constants";
import {
    basisCosineAbs,
    buildProfileStations,
    PROFILE_ARCH_U_MAX,
    PROFILE_ARCH_U_MIN,
    profileStationUs,
    solveArchProfile,
    solveRidgeHF,
    unitArchDomeWeight,
    unitArchFillWeight,
} from "@/lib/geometry/scan-fit-profile";

describe("scan-fit-profile", () => {
    test("dome and fill bases are collinear (cos ≈ 1) — ridge required", () => {
        const us = profileStationUs();
        const colH = us.map((u) => unitArchDomeWeight(u, 0.7, "left", 260, 0));
        const colF = us.map((u) => unitArchFillWeight(u, 0.7, "left", 260, 0));
        const cos = basisCosineAbs(colH, colF);
        expect(cos).toBeGreaterThan(0.95);
        expect(SCAN_FIT_PROFILE_RIDGE_LAMBDA).toBeGreaterThan(0);
    });

    test("ridge recovers amplitude on collinear bases without wild trading", () => {
        const us = profileStationUs();
        const colH = us.map((u) => unitArchDomeWeight(u, 0.7, "left", 260, 0));
        const colF = us.map((u) => unitArchFillWeight(u, 0.7, "left", 260, 0));
        const target = 8;
        const gaps = colH.map((h) => h * target);
        const solved = solveRidgeHF(colH, colF, gaps)!;
        expect(solved.height + solved.fill).toBeCloseTo(target, 1);
        expect(solved.height).toBeGreaterThanOrEqual(0);
        expect(solved.fill).toBeGreaterThanOrEqual(0);
        // Neither parameter should absorb the full amplitude alone into an absurd extreme.
        expect(solved.height).toBeLessThanOrEqual(target + 1);
        expect(solved.fill).toBeLessThanOrEqual(target + 1);
    });

    test("joint profile recovers known dome amplitude within 0.3 mm pre-compliance", () => {
        const lengthMm = 260;
        const target = 8;
        const apexMove = 0;
        const samples: { u: number; vSigned: number; gapMm: number }[] = [];
        for (let i = 0; i <= 40; i++) {
            const u = PROFILE_ARCH_U_MIN + ((PROFILE_ARCH_U_MAX - PROFILE_ARCH_U_MIN) * i) / 40;
            for (let j = 0; j <= 15; j++) {
                const vSigned = 0.25 + (0.65 * j) / 15;
                const w = unitArchDomeWeight(u, vSigned, "left", lengthMm, apexMove);
                samples.push({ u, vSigned, gapMm: target * w });
            }
        }
        const stations = buildProfileStations(samples, "left");
        expect(stations.length).toBeGreaterThanOrEqual(3);
        const profile = solveArchProfile({
            stations,
            samples,
            side: "left",
            lengthMm,
            applyCompliance: false,
        });
        expect(profile).not.toBeNull();
        expect(Math.abs(profile!.amplitudePreComplianceMm - target)).toBeLessThan(0.3);
    });

    test("compliance applied once to composite amplitude", () => {
        const lengthMm = 260;
        const target = 10;
        const samples: { u: number; vSigned: number; gapMm: number }[] = [];
        for (let i = 0; i <= 40; i++) {
            const u = PROFILE_ARCH_U_MIN + ((PROFILE_ARCH_U_MAX - PROFILE_ARCH_U_MIN) * i) / 40;
            for (let j = 0; j <= 15; j++) {
                const vSigned = 0.25 + (0.65 * j) / 15;
                const w = unitArchDomeWeight(u, vSigned, "left", lengthMm, 0);
                samples.push({ u, vSigned, gapMm: target * w });
            }
        }
        const stations = buildProfileStations(samples, "left");
        const raw = solveArchProfile({
            stations,
            samples,
            side: "left",
            lengthMm,
            applyCompliance: false,
        })!;
        const withC = solveArchProfile({
            stations,
            samples,
            side: "left",
            lengthMm,
            applyCompliance: true,
        })!;
        expect(withC.amplitudePostComplianceMm).toBeCloseTo(
            raw.amplitudePreComplianceMm * SCAN_FIT_ARCH_COMPLIANCE,
            1,
        );
    });

    test("archEndU absent — PROFILE_ARCH_U_MAX documents #118 reconciliation", () => {
        // archEndU does NOT exist on this branch — use ARCH_FIT_U_MAX.
        // Reconciliation required once PR #118 merges.
        expect(PROFILE_ARCH_U_MAX).toBe(0.58);
    });
});
