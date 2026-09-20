// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { archSkiveDepthAtThirdWidth, archSkiveUMask } from "@/lib/geometry/arch-skive";
import {
    assertShapeFinishExportAllowed,
    evaluateShapeFinishQc,
    gateArchGrindDepth,
    gateArchSkiveDepth,
    gateTopCoverAccommodate,
    gateTrimmableForefootLength,
    shapeFinishWallRisk,
} from "@/lib/geometry/shape-finish-gates";
import {
    archGrindApexRaiseMm,
    archGrindPlantarRaiseAt,
    archSkiveOutsideMask,
    clampArchGrindDepthMm,
    defaultSideShapeFinish,
    maxArchGrindDepthForThickness,
    TRACK5B_MIN_WALL_MM,
    topCoverAccommodateDeltaAt,
    trimmableForefootLengthDeltaMm,
} from "@/lib/geometry/shape-finish-modifiers";
import type { DesignState } from "@/types";

describe("shape-finish modifiers", () => {
    test("top cover accommodate is localized to cup / flange mask", () => {
        const set = 1.5;
        const inCup = topCoverAccommodateDeltaAt(0.1, 0.9, set);
        const midArch = topCoverAccommodateDeltaAt(0.42, 0.2, set);
        expect(inCup).toBeGreaterThan(0.5);
        expect(midArch).toBeLessThan(0.15);
    });

    test("arch grind apex raise matches gate expectation", () => {
        const depth = 3;
        const apex = archGrindApexRaiseMm(depth);
        expect(apex).toBeCloseTo(archGrindPlantarRaiseAt(0.42, 0.35, depth), 5);
        const gate = gateArchGrindDepth(depth, apex, 0.02, 1.2);
        expect(gate.ok).toBe(true);
    });

    test("arch grind gate blocks top sink", () => {
        const gate = gateArchGrindDepth(2, 1.0, 0.25, 1.0);
        expect(gate.ok).toBe(false);
        expect(gate.failures.some((f) => f.includes("top sink"))).toBe(true);
    });

    test("trimmable forefoot length gate", () => {
        const sf = {
            ...defaultSideShapeFinish("printing_solid"),
            trimmableForefoot: true,
            trimmableForefootExtraMm: 5,
        };
        expect(trimmableForefootLengthDeltaMm(sf)).toBe(5);
        expect(gateTrimmableForefootLength(sf, 5).ok).toBe(true);
        expect(gateTrimmableForefootLength(sf, 3).ok).toBe(false);
    });

    test("top cover gate within tolerance", () => {
        const set = 1.25;
        const measured = topCoverAccommodateDeltaAt(0.1, 0.85, set);
        expect(gateTopCoverAccommodate(set, measured).ok).toBe(true);
    });

    test("clampArchGrindDepthMm enforces min wall at apply", () => {
        const t = 3;
        const max = maxArchGrindDepthForThickness(t);
        expect(t - archGrindApexRaiseMm(max)).toBeGreaterThanOrEqual(TRACK5B_MIN_WALL_MM - 0.05);
        expect(clampArchGrindDepthMm(6, t)).toBeLessThanOrEqual(max);
        expect(clampArchGrindDepthMm(6, t)).toBeLessThan(6);
    });

    test("assertShapeFinishExportAllowed passes after apply-time grind clamp", () => {
        const design = {
            method: "printing_solid",
            thicknessMm: 2,
            pattern: "full_contact",
            corrections: {
                unit: "mm",
                linked: true,
                left: {
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
                },
                right: {
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
                },
            },
            elements: [],
            shapeFinish: {
                linked: true,
                left: { ...defaultSideShapeFinish(), archGrindDepthMm: 5 },
                right: { ...defaultSideShapeFinish(), archGrindDepthMm: 5 },
            },
        } as DesignState;
        expect(() => assertShapeFinishExportAllowed(design, "right")).not.toThrow();
    });

    test("gateArchGrindDepth hard-fails export scenario without clamp", () => {
        const apex = archGrindApexRaiseMm(5);
        const gate = gateArchGrindDepth(5, apex, 0, 2 - apex);
        expect(gate.ok).toBe(false);
    });

    test("evaluateShapeFinishQc reports fail when min wall breached", () => {
        const sf = {
            ...defaultSideShapeFinish(),
            archGrindDepthMm: 5,
            archSkiveMm: 0,
            topCoverAccommodateMm: 0,
            trimmableForefoot: false,
        };
        const items = evaluateShapeFinishQc({
            side: "right",
            sf,
            thicknessMm: 3,
            archHeightMm: 6,
            heelSkiveMedialMm: 0,
            heelSkiveLateralMm: 0,
        });
        const grind = items.find((i) => i.key === "archGrind");
        expect(grind?.status).toBe("fail");
        expect(
            shapeFinishWallRisk({
                side: "right",
                sf,
                thicknessMm: 3,
                archHeightMm: 6,
                heelSkiveMedialMm: 0,
                heelSkiveLateralMm: 0,
            }).atRisk,
        ).toBe(true);
    });

    test("arch skive mask zero outside midfoot band", () => {
        expect(archSkiveUMask(0.02)).toBe(0);
        expect(archSkiveOutsideMask(0.02, 0, "right", "medial")).toBe(0);
        const expected = archSkiveDepthAtThirdWidth(4, "medial");
        expect(
            gateArchSkiveDepth(
                { ...defaultSideShapeFinish(), archSkiveMm: 4, archSkiveSide: "medial" },
                expected,
                0,
            ).ok,
        ).toBe(true);
    });
});
