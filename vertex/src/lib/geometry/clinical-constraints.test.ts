// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import {
    CLINICAL_LIMITS,
    constrainDesignCorrections,
    constrainSideCorrections,
    HEEL_CUP_DEPTH_DEFAULT_MM,
} from "@/lib/geometry/clinical-constraints";
import type { SideCorrections } from "@/types";

function neutral(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archHeightMm: 0,
        archFillMm: 0,
        heelCupHeightMm: 0,
        heelCupDepthMm: 0,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

describe("clinical limits — heel cup depth (Biomechanics lock 2026-09-20)", () => {
    test("HEEL_CUP_DEPTH_DEFAULT_MM is 12", () => {
        expect(HEEL_CUP_DEPTH_DEFAULT_MM).toBe(12);
    });

    test("0 stays off; values below 12 clamp up; above 18 clamp down", () => {
        const off = constrainSideCorrections({ ...neutral(), heelCupDepthMm: 0 }, 4);
        expect(off.constrained.heelCupDepthMm).toBe(0);
        expect(off.violations).toHaveLength(0);

        const thicknessMm = 8;
        const low = constrainSideCorrections({ ...neutral(), heelCupDepthMm: 8 }, thicknessMm);
        const lowClamp = low.violations.find((v) => v.field === "heelCupDepthMm");
        expect(lowClamp?.requested).toBe(8);
        expect(lowClamp?.applied).toBe(CLINICAL_LIMITS.heelCupDepthMm.min);

        const high = constrainSideCorrections({ ...neutral(), heelCupDepthMm: 22 }, thicknessMm);
        const highClamp = high.violations.find((v) => v.field === "heelCupDepthMm");
        expect(highClamp?.applied).toBe(CLINICAL_LIMITS.heelCupDepthMm.max);

        const inRange = constrainSideCorrections({ ...neutral(), heelCupDepthMm: 15 }, thicknessMm);
        expect(inRange.violations.some((v) => v.field === "heelCupDepthMm")).toBe(false);
    });
});

describe("clinical limits — heel lift hard cap 12 mm", () => {
    test("left and right clamp independently to max 12", () => {
        const left = constrainSideCorrections({ ...neutral(), heelLiftMm: 20 }, 4);
        const right = constrainSideCorrections({ ...neutral(), heelLiftMm: 15 }, 4);
        expect(left.constrained.heelLiftMm).toBe(12);
        expect(right.constrained.heelLiftMm).toBe(12);

        const both = constrainDesignCorrections(
            { ...neutral(), heelLiftMm: 20 },
            { ...neutral(), heelLiftMm: 18 },
            4,
            false,
        );
        expect(both.left.heelLiftMm).toBe(12);
        expect(both.right.heelLiftMm).toBe(12);
        expect(both.violations.filter((v) => v.field === "heelLiftMm")).toHaveLength(2);
    });

    test("linked mode mirrors after per-side clamp", () => {
        const linked = constrainDesignCorrections(
            { ...neutral(), heelLiftMm: 20 },
            { ...neutral(), heelLiftMm: 4 },
            4,
            true,
        );
        expect(linked.left.heelLiftMm).toBe(linked.right.heelLiftMm);
        expect(linked.left.heelLiftMm).toBeLessThanOrEqual(12);
    });
});
