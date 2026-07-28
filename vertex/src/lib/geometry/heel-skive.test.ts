// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    clampSkiveAngleDeg,
    oneThirdLineY,
    resolveSkivePlane,
    seatTiltRadFromEdges,
    seatTiltRadFromWedgeField,
    SKIVE_DEFAULT_ANGLE_DEG,
    SKIVE_U_REF,
    skivePlaneZAtY,
    solveSkiveDerived,
} from "@/lib/geometry/heel-skive";
import type { SideCorrections } from "@/types";

function neu(): SideCorrections {
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

describe("heel-skive plane solve", () => {
    test("default angle is 15°", () => {
        expect(SKIVE_DEFAULT_ANGLE_DEG).toBe(15);
        expect(clampSkiveAngleDeg(15)).toBe(15);
        expect(clampSkiveAngleDeg(1)).toBe(5);
        expect(clampSkiveAngleDeg(90)).toBe(30);
    });

    test("one-third line sits W/3 from the skived edge", () => {
        expect(oneThirdLineY(0, 90, "medial")).toBeCloseTo(30, 5);
        expect(oneThirdLineY(0, 90, "lateral")).toBeCloseTo(60, 5);
        expect(oneThirdLineY(-40, 40, "medial")).toBeCloseTo(-40 + 80 / 3, 5);
    });

    test("T1 algebra: medial plane raises medial side (+Z toward medial)", () => {
        const W = 70;
        const yMedial = -W / 2;
        const yLateral = W / 2;
        const plane = resolveSkivePlane({
            side: "right",
            edge: "medial",
            depthMm: 4,
            angleDeg: 15,
            driven: "location",
            heelWidthMm: W,
            yMedial,
            yLateral,
            zSeatAtThird: 10,
            zSeatMedial: 10,
            zSeatLateral: 10,
        });
        expect(plane).not.toBeNull();
        const zMed = skivePlaneZAtY(plane!, yMedial);
        const zLat = skivePlaneZAtY(plane!, yLateral);
        expect(zMed).toBeGreaterThan(zLat);
        const yThird = oneThirdLineY(yMedial, yLateral, "medial");
        expect(skivePlaneZAtY(plane!, yThird) - 10).toBeCloseTo(4, 5);
    });

    test("R6c flat-floor algebra: 3mm @ 15° → locationPct in 45–65%", () => {
        const W = 70;
        const derived = solveSkiveDerived({
            depthMm: 3,
            angleDeg: 15,
            locationPct: 50,
            driven: "location",
            heelWidthMm: W,
        });
        expect(derived.locationPct).toBeGreaterThanOrEqual(45);
        expect(derived.locationPct).toBeLessThanOrEqual(65);
        // ~20% would mean depth-at-edge reference (wrong)
        expect(derived.locationPct).toBeGreaterThan(30);
    });

    test("Option C: graded wedge seat tilt is additive for medial/varus", () => {
        // Rearfoot wedge is a graded linear height field (not rigid rotation).
        const tiltFlat = seatTiltRadFromEdges(10, 10, 70);
        expect(tiltFlat).toBeCloseTo(0, 6);

        const c: SideCorrections = {
            ...neu(),
            rearfootWedge: { side: "medial", value: 5, unit: "deg" },
        };
        const tilt = seatTiltRadFromWedgeField(
            "right",
            c,
            { lengthMm: 266, widthMm: 95, trimline: null },
            SKIVE_U_REF,
        );
        expect(tilt).toBeGreaterThan(0.05); // medial higher
        expect((tilt * 180) / Math.PI).toBeCloseTo(5, 0);

        const W = 70;
        const yMedial = -W / 2;
        const yLateral = W / 2;
        const zMed = 10 + (W / 2) * Math.tan(tilt);
        const zLat = 10 - (W / 2) * Math.tan(tilt);
        const plane = resolveSkivePlane({
            side: "right",
            edge: "medial",
            depthMm: 4,
            angleDeg: 15,
            driven: "location",
            heelWidthMm: W,
            yMedial,
            yLateral,
            zSeatAtThird: 10,
            zSeatMedial: zMed,
            zSeatLateral: zLat,
        });
        expect(plane).not.toBeNull();
        // World tilt ≈ seat + skive
        expect((plane!.worldTiltRad * 180) / Math.PI).toBeCloseTo(20, 0);
    });

    test("D6: locking location derives angle", () => {
        const d = solveSkiveDerived({
            depthMm: 4,
            angleDeg: 15,
            locationPct: 55,
            driven: "angle",
            heelWidthMm: 70,
        });
        expect(d.angleDeg).toBeGreaterThanOrEqual(5);
        expect(d.angleDeg).toBeLessThanOrEqual(30);
    });
});
