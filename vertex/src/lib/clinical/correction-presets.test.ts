// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { applyCorrectionPresetToDesign, VERTEX_STARTER_PRESETS } from "@/lib/clinical/correction-presets";
import type { DesignState, ElementKind } from "@/types";

function testDesign(): DesignState {
    return {
        pattern: "full_contact",
        method: "printing_solid",
        thicknessMm: 3,
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
                heelLiftMm: 0,
                apexMoveMm: 0,
                medialFlangeMm: 0,
                lateralFlangeMm: 0,
            },
        },
        elements: [],
    };
}

describe("correction presets", () => {
    test("vertex starter library includes expected clinical labels", () => {
        const names = VERTEX_STARTER_PRESETS.map((p) => p.name);
        expect(names).toContain("Plantar fasciitis (PF)");
        expect(names).toContain("Sesamoiditis");
        expect(VERTEX_STARTER_PRESETS.length).toBeGreaterThanOrEqual(10);
    });

    test("merge applies only keys present in preset", () => {
        const design = testDesign();
        design.corrections.left.archHeightMm = 10;
        design.corrections.right.archHeightMm = 10;

        const next = applyCorrectionPresetToDesign(
            design,
            { corrections: { linked: true, left: { archFillMm: 2 } } },
            {
                mode: "merge",
                includeElements: false,
                activeSide: "left",
            },
        );

        expect(next.corrections.left.archFillMm).toBe(2);
        expect(next.corrections.left.archHeightMm).toBe(10);
    });

    test("replace overwrites scalar corrections on linked feet", () => {
        const design = testDesign();
        design.corrections.linked = true;
        design.corrections.left.archHeightMm = 10;
        design.corrections.right.archHeightMm = 10;

        const achilles = VERTEX_STARTER_PRESETS.find((p) => p.id === "vertex-achilles")!;
        const next = applyCorrectionPresetToDesign(design, achilles.payload, {
            mode: "replace",
            includeElements: false,
            activeSide: "left",
        });

        expect(next.corrections.left.heelLiftMm).toBe(4);
        expect(next.corrections.left.archHeightMm).toBe(0);
        expect(next.corrections.right.heelLiftMm).toBe(4);
    });

    test("merge adds stock elements for new kinds", () => {
        const design = testDesign();
        const sesamoid = VERTEX_STARTER_PRESETS.find((p) => p.id === "vertex-sesamoiditis")!;
        const next = applyCorrectionPresetToDesign(design, sesamoid.payload, {
            mode: "merge",
            includeElements: true,
            activeSide: "left",
        });
        const kinds = next.elements.map((e) => e.kind);
        expect(kinds).toContain("dancers_pad" satisfies ElementKind);
    });
});
