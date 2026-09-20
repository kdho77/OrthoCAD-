// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BASE_REFERENCE_THICKNESS_MM, correctionDeltaAt } from "@/lib/geometry/base-modifier";
import {
    HEEL_LIFT_TAPER_END_DEFAULT_U,
    heelLiftDeltaAt,
    resolveHeelLiftTaperEndU,
} from "@/lib/geometry/heel-lift";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import type { SideCorrections } from "@/types";

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

function fieldWithLift(mm: number, taper?: Partial<SideCorrections>): HeightFieldParams {
    return {
        side: "left",
        lengthMm: 266,
        widthMm: 95,
        thicknessMm: 3,
        shellThicknessMode: "uniform",
        corrections: { ...neutralCorrections(), heelLiftMm: mm, ...taper },
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    };
}

describe("heel lift taper endpoint", () => {
    test("preset metHeads defaults to 0.75 u", () => {
        expect(resolveHeelLiftTaperEndU({ preset: "metHeads" })).toBeCloseTo(0.75, 5);
    });

    test("heel +lift ±0.2 mm at u=0", () => {
        const lift = 8;
        const d = heelLiftDeltaAt(0, lift);
        expect(Math.abs(d - lift)).toBeLessThanOrEqual(0.2);
    });

    test("distal to endpoint 0 ±0.2 mm", () => {
        const lift = 10;
        const endU = HEEL_LIFT_TAPER_END_DEFAULT_U;
        const d = heelLiftDeltaAt(endU + 0.05, lift);
        expect(Math.abs(d)).toBeLessThanOrEqual(0.2);
    });

    test("custom %AP maps to clamped u", () => {
        expect(resolveHeelLiftTaperEndU({ preset: "custom", customPctAp: 45 })).toBeCloseTo(0.45, 5);
    });

    test("endpoint change does not change delta distal to both taper ends", () => {
        const base = fieldWithLift(0);
        const mid = fieldWithLift(6, { heelLiftTaperPreset: "midfoot" });
        const sulcus = fieldWithLift(6, { heelLiftTaperPreset: "sulcus" });
        const uDistal = 0.95;
        const dMid = correctionDeltaAt(uDistal, 0, mid, base);
        const dSul = correctionDeltaAt(uDistal, 0, sulcus, base);
        expect(Math.abs(dMid - dSul)).toBeLessThan(0.2);
        expect(Math.abs(dMid)).toBeLessThan(0.2);
    });

    test("correction delta at heel respects taper endpoint move", () => {
        const base = fieldWithLift(0);
        const short = fieldWithLift(6, { heelLiftTaperEndU: 0.5 });
        const long = fieldWithLift(6, { heelLiftTaperEndU: 0.85 });
        const uMid = 0.6;
        const dShort = correctionDeltaAt(uMid, 0, short, base);
        const dLong = correctionDeltaAt(uMid, 0, long, base);
        expect(dShort).toBeLessThan(dLong - 0.5);
    });
});
