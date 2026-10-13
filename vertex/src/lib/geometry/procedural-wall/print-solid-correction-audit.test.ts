// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import type { SideCorrections } from "@/types";
import { auditRow, PRINT_SOLID_CORRECTION_AUDIT } from "./print-solid-correction-audit";
import { hasCurveOrTopModifiers, type ReconstructOptions } from "./reconstruct";

function zero(): SideCorrections {
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

function gate(patch: Partial<SideCorrections>, extra: Partial<ReconstructOptions> = {}): boolean {
    return hasCurveOrTopModifiers({
        corrections: { ...zero(), ...patch },
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
        ...extra,
    });
}

describe("Print solid correction audit (inventory)", () => {
    test("documents every parametric group Kendon listed", () => {
        const ids = PRINT_SOLID_CORRECTION_AUDIT.map((r) => r.id);
        for (const need of [
            "posting",
            "heel-lift",
            "heel-widen",
            "skive",
            "arch-height",
            "arch-apex",
            "shoe-width",
            "trimline",
            "bottom-pattern",
            "presets",
        ]) {
            expect(ids).toContain(need);
        }
        expect(PRINT_SOLID_CORRECTION_AUDIT.filter((r) => r.verdict === "lost").length).toBeGreaterThan(3);
    });

    test("surviving gates: posting, lift, widen, cup, arch height, thickness", () => {
        expect(gate({ rearfootPostingDeg: 4 })).toBe(true);
        expect(gate({ heelLiftMm: 6 })).toBe(true);
        expect(gate({ heelCupWidthMm: 4 })).toBe(true);
        expect(gate({ heelCupDepthMm: 8 })).toBe(true);
        expect(gate({ archHeightMm: 10 })).toBe(true);
        expect(
            hasCurveOrTopModifiers({
                corrections: zero(),
                thicknessMm: 3,
                stockThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            }),
        ).toBe(true);
        expect(auditRow("posting").verdict).toBe("survives");
        expect(auditRow("heel-lift").verdict).toBe("survives");
        expect(auditRow("bottom-pattern").verdict).toBe("survives");
    });
});

describe("Print solid lost corrections (expected-fail until CAD sign-off)", () => {
    test.skip("skive survives the worker solid — EXPECTED FAIL: applyAnalyticTopDeltas includeSkives=false; hasCurveOrTopModifiers ignores medialSkiveMm. Drop: reconstruct.ts applyAnalyticTopDeltas + useBaseInsoleGeometry reconstructProceduralPreviewInWorker(raw). Proposed: R11 Kirby raise on Print top after CAD sign-off.", () => {
        expect(gate({ medialSkiveMm: 4 })).toBe(true);
        expect(auditRow("skive").verdict).toBe("survives");
    });

    test.skip("apex-only move survives the worker solid — EXPECTED FAIL: hasCurveOrTopModifiers ignores apexMoveMm so applyAnalyticTopDeltas never runs. Drop: reconstruct.ts hasCurveOrTopModifiers. Proposed: treat apexMoveMm !== 0 as a top modifier.", () => {
        expect(gate({ apexMoveMm: 8 })).toBe(true);
        expect(auditRow("arch-apex").verdict).toBe("survives");
    });

    test.skip("correction flanges survive the worker solid — EXPECTED FAIL: hasCurveOrTopModifiers ignores medialFlangeMm/lateralFlangeMm. Drop: reconstruct.ts hasCurveOrTopModifiers. Proposed: include flange mm or map onto options.lateralFlange.", () => {
        expect(gate({ medialFlangeMm: 6 })).toBe(true);
        expect(auditRow("flanges-correction").verdict).toBe("survives");
    });

    test.skip("surface wedges survive the worker solid — EXPECTED FAIL: hasCurveOrTopModifiers ignores rearfootWedge/forefootWedge. Drop: reconstruct.ts hasCurveOrTopModifiers. Proposed: treat a present wedge as a top modifier.", () => {
        expect(
            gate({
                rearfootWedge: { side: "medial", unit: "mm", value: 3 },
            }),
        ).toBe(true);
        expect(auditRow("wedges").verdict).toBe("survives");
    });

    test.skip("placed elements survive the worker solid — EXPECTED FAIL: applyAnalyticTopDeltas sets elements:[]; reconstructProceduralPreview does not forward design.elements. Drop: sample-top-preview.ts reconstructProceduralPreview / reconstruct.ts applyAnalyticTopDeltas. Proposed: pass merged elements into the Print field.", () => {
        expect(auditRow("elements").verdict).toBe("survives");
    });

    test.skip("shape-finish survives the worker solid — EXPECTED FAIL: Print field has no shapeFinish; archGrindDepthMm does not offset plantar. Drop: sample-top-preview.ts (no shapeFinish) + base-modifier.ts ~2864 vs reconstruct.ts applyAnalyticTopDeltas. Proposed: forward getSideShapeFinish after CAD sign-off.", () => {
        expect(auditRow("shape-finish").verdict).toBe("survives");
    });

    test.skip("trimline edits survive the worker solid — EXPECTED FAIL: Print reconstruct never receives the committed trimline (viewer clips only on the non-Print path). Drop: useBaseInsoleGeometry clipGeometryToOutline vs reconstructProceduralWalls. Proposed: clip/retarget Print top+pattern to the trimline.", () => {
        expect(auditRow("trimline").verdict).toBe("survives");
    });

    test.skip("shoe width scales the Print top sheet — EXPECTED FAIL: insoleWidthScale is never passed; only the live pattern carries width. Drop: reconstructProceduralPreview options vs useBaseInsoleGeometry applyShoeWidthToPoints. Proposed: pass insoleWidthScale from shoeWidthForSide.", () => {
        expect(auditRow("shoe-width").verdict).toBe("survives");
        expect(hasCurveOrTopModifiers({ corrections: zero(), insoleWidthScale: 1.05 })).toBe(true);
        // The gate works when scale is passed — Print just never passes it.
        expect(false).toBe(true);
    });

    test.skip("correction-preset skive/elements survive Print — EXPECTED FAIL: presets only write fields; lost fields stay lost. Drop: correction-presets.ts apply + the per-field Print drops above.", () => {
        expect(auditRow("presets").verdict).toBe("survives");
    });
});
