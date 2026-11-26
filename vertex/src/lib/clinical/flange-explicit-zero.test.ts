// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import type { Side, SideCorrections } from "@/types";
import { DESIGN_SETTINGS_SCHEMA_VERSION, readStoredDesignSettings } from "../../../shared/design-settings";
import { parseSavedDesignCatalog, type StoredLinkShoe } from "../../../shared/saved-design-catalog";
import { buildSavedDesignSnapshot } from "../../../shared/saved-design-snapshot";
import { designStateFromSavedSettings } from "../../features/exports/saved-design-finalized-mesh";
import { BASE_REFERENCE_THICKNESS_MM, correctionDeltaAt } from "../geometry/base-modifier";
import type { HeightFieldParams } from "../geometry/height-field";

const storedNine: StoredLinkShoe = {
    system: "US_M",
    size: 9,
    left: null,
    right: null,
    width: null,
};

function build(catalog: unknown) {
    return buildSavedDesignSnapshot({
        stored: storedNine,
        catalog: parseSavedDesignCatalog(catalog),
    });
}

function flangeField(side: Side, corrections: SideCorrections): HeightFieldParams {
    return {
        side,
        lengthMm: 270,
        widthMm: 92,
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
    };
}

/** Left medial is +v. Right medial is −v. The other sign is lateral. */
function borderDelta(side: Side, corrections: SideCorrections, border: "medial" | "lateral"): number {
    const neutral = build({}).design.corrections[side];
    const v = side === "left" ? (border === "medial" ? 0.92 : -0.92) : border === "medial" ? -0.92 : 0.92;
    return correctionDeltaAt(0.45, v, flangeField(side, corrections), flangeField(side, neutral));
}

describe("explicit flange 0", () => {
    test("explicit 0 on any side and foot is no flange, and readback keeps that 0", () => {
        const cases = [
            {
                catalog: { flange: { left: { medial_mm: 0, lateral_mm: 4 } } },
                side: "left" as const,
                zero: "medial" as const,
                kept: "lateral" as const,
                keptMm: 4,
            },
            {
                catalog: { flange: { left: { medial_mm: 3, lateral_mm: 0 } } },
                side: "left" as const,
                zero: "lateral" as const,
                kept: "medial" as const,
                keptMm: 3,
            },
            {
                catalog: { flange: { right: { medial_mm: 0 } } },
                side: "right" as const,
                zero: "medial" as const,
                kept: "lateral" as const,
                keptMm: 0,
            },
            {
                catalog: { flange: { right: { lateral_mm: 0 } } },
                side: "right" as const,
                zero: "lateral" as const,
                kept: "medial" as const,
                keptMm: 0,
            },
        ];

        for (const entry of cases) {
            const built = build(entry.catalog);
            const corrections = built.design.corrections[entry.side];
            const zeroKey = entry.zero === "medial" ? "medialFlangeMm" : "lateralFlangeMm";
            const keptKey = entry.kept === "medial" ? "medialFlangeMm" : "lateralFlangeMm";
            expect(corrections[zeroKey], `${entry.side} ${entry.zero}`).toBe(0);
            expect(corrections[keptKey], `${entry.side} ${entry.kept}`).toBe(entry.keptMm);
            expect(Math.abs(borderDelta(entry.side, corrections, entry.zero))).toBeLessThan(1e-6);
            if (entry.keptMm > 0) {
                expect(borderDelta(entry.side, corrections, entry.kept)).toBeGreaterThan(0.2);
            }

            const envelope = { schemaVersion: DESIGN_SETTINGS_SCHEMA_VERSION, settings: built.design };
            const settings = readStoredDesignSettings(envelope);
            const read = (settings?.corrections as { left: SideCorrections; right: SideCorrections })[
                entry.side
            ];
            expect(read[zeroKey]).toBe(0);
            const reopened = designStateFromSavedSettings(envelope);
            expect(reopened.corrections[entry.side][zeroKey]).toBe(0);
            expect(built.paths).toContain(`settings.corrections.${entry.side}.${zeroKey}`);
        }

        const both = build({
            flange: { left: { medial_mm: 0, lateral_mm: 0 }, right: { medial_mm: 0, lateral_mm: 0 } },
        });
        expect(both.design.corrections.left).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 0 });
        expect(both.design.corrections.right).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 0 });
        expect(Math.abs(borderDelta("left", both.design.corrections.left, "lateral"))).toBeLessThan(1e-6);
        expect(Math.abs(borderDelta("right", both.design.corrections.right, "medial"))).toBeLessThan(1e-6);
    });

    test("an omitted flange border keeps the existing default", () => {
        const omitted = build({});
        expect(omitted.design.corrections.left).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 0 });
        expect(omitted.design.corrections.right).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 0 });

        const requested = build({ flange: { left: {} } });
        expect(requested.design.corrections.left).toMatchObject({ medialFlangeMm: 3, lateralFlangeMm: 3 });
        expect(requested.design.corrections.right).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 0 });

        const medialOnly = build({ flange: { left: { medial_mm: 3 } } });
        expect(medialOnly.design.corrections.left).toMatchObject({ medialFlangeMm: 3, lateralFlangeMm: 0 });
        expect(medialOnly.paths).not.toContain("settings.corrections.left.lateralFlangeMm");

        const lateralOnly = build({ flange: { right: { lateral_mm: 5 } } });
        expect(lateralOnly.design.corrections.right).toMatchObject({ medialFlangeMm: 0, lateralFlangeMm: 5 });
        expect(lateralOnly.paths).not.toContain("settings.corrections.right.medialFlangeMm");
        expect(lateralOnly.paths).toContain("settings.corrections.right.lateralFlangeMm");

        const mild = build({ flange: { right: { level: "mild" } } });
        expect(mild.design.corrections.right).toMatchObject({ medialFlangeMm: 2, lateralFlangeMm: 2 });

        const sliderZero = build({
            sliders_by_side: { left: { lateral_flange_mm: 4 } },
            flange: { left: { lateral_mm: 0 } },
        });
        expect(sliderZero.design.corrections.left.lateralFlangeMm).toBe(0);
        expect(sliderZero.design.corrections.left.medialFlangeMm).toBe(0);
    });
});
