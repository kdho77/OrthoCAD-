// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { constrainSideCorrections } from "@/lib/geometry/clinical-constraints";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import { mergeCorrections, usePerformanceStore } from "@/stores/performance-store";
import type { SideCorrections } from "@/types";

function baseCorrections(): SideCorrections {
    return {
        forefootPostingDeg: 0,
        rearfootPostingDeg: 0,
        medialSkiveMm: 0,
        lateralSkiveMm: 0,
        archFillMm: 2,
        archHeightMm: 6,
        heelCupDepthMm: 0,
        heelCupHeightMm: 8,
        heelCupWidthMm: 0,
        heelLiftMm: 0,
        apexMoveMm: 0,
        medialFlangeMm: 0,
        lateralFlangeMm: 0,
    };
}

describe("applyConstrainedCorrectionPreview", () => {
    beforeEach(() => {
        usePerformanceStore.setState({
            interacting: false,
            correctionPreview: {},
            thicknessPreview: null,
            elementPreviews: {},
        });
        useDesignStore.setState({
            design: {
                ...defaultDesign(),
                thicknessMm: 3,
                corrections: {
                    linked: true,
                    left: baseCorrections(),
                    right: baseCorrections(),
                },
            },
        });
    });

    test("replaces the whole side preview with constrained corrections (not a shallow merge)", () => {
        const perf = usePerformanceStore.getState();
        perf.applyConstrainedCorrectionPreview("left", { heelCupDepthMm: 6 });
        const preview = usePerformanceStore.getState().correctionPreview.left!;
        const { constrained } = constrainSideCorrections({ ...baseCorrections(), heelCupDepthMm: 6 }, 3);
        expect(preview.heelCupDepthMm).toBe(constrained.heelCupDepthMm);
        expect(Object.keys(preview).length).toBeGreaterThan(1);
    });

    test("stale sibling keys do not linger after release then unrelated drag", () => {
        const perf = usePerformanceStore.getState();
        perf.applyConstrainedCorrectionPreview("left", { heelCupDepthMm: 6 });
        const depthPreview = usePerformanceStore.getState().correctionPreview.left!.heelCupDepthMm;
        expect(depthPreview).toBeLessThan(6);

        perf.clearCorrectionPreview();
        expect(usePerformanceStore.getState().correctionPreview).toEqual({});

        perf.applyConstrainedCorrectionPreview("left", { archHeightMm: 10 });
        const merged = mergeCorrections("left", baseCorrections());
        expect(merged.archHeightMm).toBe(10);
        expect(merged.heelCupDepthMm).toBe(0);
        expect(usePerformanceStore.getState().correctionPreview.left?.heelCupDepthMm).toBe(0);
    });
});
