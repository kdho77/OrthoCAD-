// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { archSkiveDepthAtThirdWidth, archSkiveUMask } from "@/lib/geometry/arch-skive";
import {
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
    defaultSideShapeFinish,
    topCoverAccommodateDeltaAt,
    trimmableForefootLengthDeltaMm,
} from "@/lib/geometry/shape-finish-modifiers";

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
