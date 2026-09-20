// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { sectionProfilePoints } from "@/lib/geometry/occt-insole";
import { archGrindApexRaiseMm, archGrindPlantarRaiseAt } from "@/lib/geometry/shape-finish-modifiers";
import type { SideCorrections } from "@/types";

const ARCH_U = 0.42;
const ARCH_APEX_ACROSS = 0.35;

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

function field(grindMm: number, thicknessMm = 4): HeightFieldParams {
    return {
        side: "right",
        lengthMm: 260,
        widthMm: 95,
        thicknessMm,
        corrections: neu(),
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
        shapeFinish: {
            topCoverAccommodateMm: 0,
            trimmableForefoot: false,
            trimmableForefootExtraMm: 0,
            archGrindDepthMm: grindMm,
            archSkiveMm: 0,
            archSkiveSide: "medial",
        },
    };
}

const CROSS_SECTION_SAMPLES = 16;

/** Plantar chord only (first n+1 points) — dorsal samples share y but must not be used. */
function plantarChord(points: ReturnType<typeof sectionProfilePoints>) {
    return points.slice(0, CROSS_SECTION_SAMPLES + 1);
}

function bottomZAtAcross(
    points: ReturnType<typeof sectionProfilePoints>,
    av: number,
    hw: number,
    vSign = 1,
): number {
    const yTarget = vSign * av * hw;
    const chord = plantarChord(points);
    let best = chord[0]!;
    let bestDy = Math.abs(best.y - yTarget);
    for (const p of chord) {
        const dy = Math.abs(p.y - yTarget);
        if (dy < bestDy) {
            bestDy = dy;
            best = p;
        }
    }
    return best.z;
}

describe("OCCT loft arch grind", () => {
    test("plantar chord samples real av — apex raise ≈ setpoint at u=0.42", () => {
        const depth = 3;
        const params = field(depth);
        const points = sectionProfilePoints(ARCH_U, params);
        const hw = Math.abs(points[0]!.y);
        const chord = plantarChord(points);
        const zApex = bottomZAtAcross(points, ARCH_APEX_ACROSS, hw);
        const apexPt = chord.reduce((best, p) =>
            Math.abs(p.y - ARCH_APEX_ACROSS * hw) < Math.abs(best.y - ARCH_APEX_ACROSS * hw) ? p : best,
        );
        const avSample = Math.abs(apexPt.y) / hw;
        const expected = archGrindPlantarRaiseAt(ARCH_U, avSample, depth);
        expect(zApex).toBeGreaterThan(0.5);
        expect(zApex).toBeCloseTo(expected, 2);
        expect(Math.abs(zApex - archGrindApexRaiseMm(depth))).toBeLessThan(0.12);
    });

    test("perimeter bottom (av=1) stays at z=0 while apex lifts", () => {
        const depth = 2.5;
        const params = field(depth);
        const points = sectionProfilePoints(ARCH_U, params);
        const hw = Math.abs(points[0]!.y);
        const zEdge = bottomZAtAcross(points, 1, hw);
        const zApex = bottomZAtAcross(points, ARCH_APEX_ACROSS, hw);
        expect(zEdge).toBeCloseTo(0, 2);
        expect(zApex).toBeGreaterThan(zEdge + 0.5);
    });
});
