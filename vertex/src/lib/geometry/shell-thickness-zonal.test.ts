// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BASE_REFERENCE_THICKNESS_MM, correctionDeltaAt } from "@/lib/geometry/base-modifier";
import { type HeightFieldParams, heightAt } from "@/lib/geometry/height-field";
import {
    DEFAULT_SHELL_THICKNESS_BLEND_MM,
    SHELL_ZONE_MF_END_U,
    SHELL_ZONE_RF_END_U,
    shellThicknessContextFromDesign,
    shellThicknessMmAtU,
    zonalShellThicknessAtU,
} from "@/lib/geometry/shell-thickness-zonal";
import type { SideCorrections } from "@/types";

const LENGTH_MM = 266;

function neutralCorrections(): SideCorrections {
    return {
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
}

function fieldWithShell(
    zones: { rfMm: number; mfMm: number; ffMm: number },
    thicknessMm = 3,
): HeightFieldParams {
    return {
        side: "left",
        lengthMm: LENGTH_MM,
        widthMm: 95,
        thicknessMm,
        shellThicknessMode: "zonal",
        shellThicknessRfMm: zones.rfMm,
        shellThicknessMfMm: zones.mfMm,
        shellThicknessFfMm: zones.ffMm,
        shellThicknessBlendMm: DEFAULT_SHELL_THICKNESS_BLEND_MM,
        corrections: neutralCorrections(),
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

describe("zonal shell thickness t(u)", () => {
    const ctx = shellThicknessContextFromDesign(
        "zonal",
        3,
        LENGTH_MM,
        { rfMm: 3.0, mfMm: 2.5, ffMm: 2.0 },
        DEFAULT_SHELL_THICKNESS_BLEND_MM,
    );

    test("zone cores within ±0.2 mm of prescribed RF/MF/FF", () => {
        const rfCore = zonalShellThicknessAtU(0.1, ctx);
        const mfCore = zonalShellThicknessAtU(0.4, ctx);
        const ffCore = zonalShellThicknessAtU(0.8, ctx);
        expect(Math.abs(rfCore - 3.0)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(mfCore - 2.5)).toBeLessThanOrEqual(0.2);
        expect(Math.abs(ffCore - 2.0)).toBeLessThanOrEqual(0.2);
    });

    test("blends are monotonic heel→toe (RF ≥ MF ≥ FF plateaus)", () => {
        const samples: number[] = [];
        for (let i = 0; i <= 100; i++) {
            samples.push(zonalShellThicknessAtU(i / 100, ctx));
        }
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]!).toBeLessThanOrEqual(samples[i - 1]! + 1e-6);
        }
        expect(samples[5]!).toBeGreaterThanOrEqual(SHELL_ZONE_RF_END_U > 0 ? 2.8 : 0);
        expect(samples[95]!).toBeLessThanOrEqual(2.1);
    });

    test("min wall ≥ 0.8 mm", () => {
        const thin = shellThicknessContextFromDesign("zonal", 3, LENGTH_MM, {
            rfMm: 0.5,
            mfMm: 0.5,
            ffMm: 0.5,
        });
        for (let i = 0; i <= 50; i++) {
            expect(shellThicknessMmAtU(i / 50, thin)).toBeGreaterThanOrEqual(0.8);
        }
    });

    test("FF zone change does not alter heel lift delta at u=0", () => {
        const base = fieldWithShell({ rfMm: 3, mfMm: 2.5, ffMm: 2 });
        const ffOnly = fieldWithShell({ rfMm: 3, mfMm: 2.5, ffMm: 4 });
        const withLift = { ...base, corrections: { ...neutralCorrections(), heelLiftMm: 6 } };
        const withLiftFf = { ...ffOnly, corrections: { ...neutralCorrections(), heelLiftMm: 6 } };
        const d0 = correctionDeltaAt(0.02, 0, withLift, base);
        const d1 = correctionDeltaAt(0.02, 0, withLiftFf, ffOnly);
        expect(Math.abs(d0 - d1)).toBeLessThan(0.05);
    });

    test("heightAt thickness delta isolated in FF when RF/MF matched", () => {
        const a = fieldWithShell({ rfMm: 3, mfMm: 2.5, ffMm: 2 });
        const b = fieldWithShell({ rfMm: 3, mfMm: 2.5, ffMm: 3.5 });
        const neutral = fieldWithShell({
            rfMm: BASE_REFERENCE_THICKNESS_MM,
            mfMm: BASE_REFERENCE_THICKNESS_MM,
            ffMm: BASE_REFERENCE_THICKNESS_MM,
        });
        const dRf = heightAt(0.1, 0, a) - heightAt(0.1, 0, neutral);
        const dRfB = heightAt(0.1, 0, b) - heightAt(0.1, 0, neutral);
        expect(Math.abs(dRf - dRfB)).toBeLessThan(0.15);
        const dFf = heightAt(0.85, 0, a) - heightAt(0.85, 0, neutral);
        const dFfB = heightAt(0.85, 0, b) - heightAt(0.85, 0, neutral);
        expect(dFfB - dFf).toBeGreaterThan(1.0);
    });
});
