// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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
        archEaseMm: 0,
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
        expect(PRINT_SOLID_CORRECTION_AUDIT.filter((r) => r.verdict === "lost")).toHaveLength(0);
    });

    test("surviving gates: posting, lift, widen, cup, arch height, thickness", () => {
        expect(gate({ rearfootWedge: { side: "lateral", value: 4, unit: "deg" } })).toBe(true);
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

describe("Print solid composed-top corrections", () => {
    test("skive survives the worker solid", () => {
        expect(gate({ medialSkiveMm: 4 })).toBe(true);
        expect(auditRow("skive").verdict).toBe("survives");
    });

    test("apex-only move survives the worker solid", () => {
        expect(gate({ apexMoveMm: 8 })).toBe(true);
        expect(auditRow("arch-apex").verdict).toBe("survives");
    });

    test("correction flanges survive the worker solid", () => {
        expect(gate({ medialFlangeMm: 6 })).toBe(true);
        expect(auditRow("flanges-correction").verdict).toBe("survives");
    });

    test("surface wedges survive the worker solid", () => {
        expect(
            gate({
                rearfootWedge: { side: "medial", unit: "mm", value: 3 },
            }),
        ).toBe(true);
        expect(auditRow("wedges").verdict).toBe("survives");
    });

    test("placed elements survive the worker solid", () => {
        expect(
            hasCurveOrTopModifiers({
                corrections: zero(),
                sourceField: {
                    side: "left",
                    lengthMm: 260,
                    widthMm: 95,
                    thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                    corrections: zero(),
                    elements: [
                        {
                            id: "met-1",
                            kind: "met_pad",
                            side: "left",
                            position: { x: 0, y: 0 },
                            rotationDeg: 0,
                            scale: { x: 1, y: 1 },
                            heightMm: 4,
                        },
                    ],
                    includeElements: true,
                },
            }),
        ).toBe(true);
        expect(auditRow("elements").verdict).toBe("survives");
    });

    test("shape-finish survives the worker solid", () => {
        expect(
            hasCurveOrTopModifiers({
                corrections: zero(),
                sourceField: {
                    side: "left",
                    lengthMm: 260,
                    widthMm: 95,
                    thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                    corrections: zero(),
                    includeElements: true,
                    shapeFinish: {
                        topCoverAccommodateMm: 1.25,
                        trimmableForefoot: true,
                        trimmableForefootExtraMm: 5,
                        archGrindDepthMm: 0,
                        archSkiveMm: 0,
                        archSkiveSide: "medial",
                    },
                },
            }),
        ).toBe(true);
        expect(auditRow("shape-finish").verdict).toBe("survives");
    });

    test("trimline edits survive the worker solid", () => {
        expect(
            hasCurveOrTopModifiers({
                corrections: zero(),
                sourceField: {
                    side: "left",
                    lengthMm: 260,
                    widthMm: 95,
                    thicknessMm: BASE_REFERENCE_THICKNESS_MM,
                    corrections: zero(),
                    trimline: {
                        points: [
                            { x: 0, y: 0, z: 0 },
                            { x: 100, y: 20, z: 0 },
                            { x: 200, y: 0, z: 0 },
                            { x: 100, y: -20, z: 0 },
                        ],
                    },
                },
            }),
        ).toBe(true);
        expect(auditRow("trimline").verdict).toBe("survives");
    });

    test("shoe width scales the Print top sheet", () => {
        expect(auditRow("shoe-width").verdict).toBe("survives");
        expect(hasCurveOrTopModifiers({ corrections: zero(), insoleWidthScale: 1.05 })).toBe(true);
        expect(hasCurveOrTopModifiers({ corrections: zero(), composedTop: true })).toBe(true);
    });

    test("correction-preset skive/elements survive Print", () => {
        expect(auditRow("presets").verdict).toBe("survives");
        expect(gate({ medialSkiveMm: 3, archHeightMm: 8 })).toBe(true);
    });
});
