// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import {
    parseSavedDesignCatalog,
    REARFOOT_POSTING_DEG_SIGN,
    SavedDesignSnapshotError,
    savedDesignCatalogSchema,
    WEDGE_FOOT_FIELD,
} from "../../../shared/saved-design-catalog";
import type { Side, SideCorrections } from "../../types";
import { heightAt } from "../geometry/height-field";
import { migrateSideCorrections } from "../geometry/migrate-corrections";
import { insoleLayoutForUsMenSize } from "../geometry/shoe-size";
import { wedgeDeltaAt } from "../geometry/wedge";
import { buildSavedDesignSnapshot } from "./saved-design-snapshot";

const storedNine = {
    system: "US_M" as const,
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

function expect422(catalog: unknown): void {
    try {
        build(catalog);
        throw new Error("expected 422");
    } catch (error) {
        expect(error).toBeInstanceOf(SavedDesignSnapshotError);
        expect((error as Error).message).toMatch(/^422 /);
    }
}

/** Top of the solid. Bottom is z = 0, so this height is the solid thickness. */
function solidTop(side: Side, corrections: SideCorrections, u: number, vSigned: number): number {
    const layout = insoleLayoutForUsMenSize(9);
    return heightAt(u, vSigned, {
        side,
        lengthMm: layout.lengthMm,
        widthMm: layout.widthMm,
        thicknessMm: 2,
        corrections,
        elements: [],
        includeSkives: false,
        includeElements: false,
        trimline: null,
    });
}

function solidGrid(side: Side, corrections: SideCorrections): number[] {
    const samples: number[] = [];
    for (const u of [0.08, 0.15, 0.4, 0.7, 0.9]) {
        for (const v of [-0.98, -0.5, 0, 0.5, 0.98]) {
            samples.push(solidTop(side, corrections, u, v));
        }
    }
    return samples;
}

/** Lateral edge in the height field. Medial is the opposite sign. */
function lateralV(side: Side): number {
    return side === "left" ? -0.98 : 0.98;
}

function medialV(side: Side): number {
    return -lateralV(side);
}

describe("per-foot wedges and rearfoot posting sign", () => {
    test("omitted wedge foot matches explicit both, on both feet", () => {
        const rear = { side: "lateral" as const, value: 3, unit: "mm" as const };
        const full = { side: "lateral" as const, value: 4, unit: "deg" as const };
        const omitted = build({ rearfoot_wedge: rear, full_length_wedge: full });
        const both = build({
            rearfoot_wedge: { ...rear, foot: "both" },
            full_length_wedge: { ...full, foot: "both" },
        });
        expect(JSON.stringify(omitted.design)).toBe(JSON.stringify(both.design));
        expect(omitted.paths).toEqual(both.paths);
        expect(omitted.design.corrections.linked).toBe(true);
        for (const side of ["left", "right"] as const) {
            expect(JSON.parse(JSON.stringify(omitted.design.corrections[side].rearfootWedge))).toEqual(rear);
            expect(JSON.stringify(omitted.design.corrections[side].rearfootWedge)).not.toContain("degree");
            expect(JSON.stringify(omitted.design.corrections[side].rearfootWedge)).not.toContain("foot");
            expect(omitted.design.corrections[side].fullLengthWedge).toEqual(full);
        }
    });

    test("a left-only rearfoot wedge changes only the left solid", () => {
        const baseline = build({});
        // Bragg: left 2° medial rearfoot, right 0/0. The 2° is the requested post, not a new default.
        const leftOnly = build({
            rearfoot_wedge: { side: "medial", value: 2, unit: "deg", foot: "left" },
        });
        expect(leftOnly.design.corrections.linked).toBe(false);
        expect(leftOnly.design.corrections.left.rearfootWedge).toEqual({
            side: "medial",
            value: 2,
            unit: "deg",
        });
        expect(leftOnly.design.corrections.right.rearfootWedge).toBeUndefined();
        expect(JSON.stringify(leftOnly.design.corrections.right)).toBe(
            JSON.stringify(baseline.design.corrections.right),
        );
        expect(leftOnly.paths).toContain("settings.corrections.linked");
        expect(leftOnly.paths).toContain("settings.corrections.left.rearfootWedge");
        expect(leftOnly.paths).not.toContain("settings.corrections.right.rearfootWedge");

        expect(solidGrid("right", leftOnly.design.corrections.right)).toEqual(
            solidGrid("right", baseline.design.corrections.right),
        );
        const layout = insoleLayoutForUsMenSize(9);
        const params = { lengthMm: layout.lengthMm, widthMm: layout.widthMm };
        const leftMedial = wedgeDeltaAt(
            0.12,
            medialV("left"),
            "left",
            leftOnly.design.corrections.left,
            params,
        );
        const leftLateral = wedgeDeltaAt(
            0.12,
            lateralV("left"),
            "left",
            leftOnly.design.corrections.left,
            params,
        );
        // v = ±0.98 is just inboard of the rim, so the low edge is a small remainder, not 0.
        expect(leftMedial).toBeGreaterThan(0.2);
        expect(leftLateral).toBeLessThan(leftMedial * 0.25);
        const medialRise =
            solidTop("left", leftOnly.design.corrections.left, 0.12, medialV("left")) -
            solidTop("left", baseline.design.corrections.left, 0.12, medialV("left"));
        const lateralRise =
            solidTop("left", leftOnly.design.corrections.left, 0.12, lateralV("left")) -
            solidTop("left", baseline.design.corrections.left, 0.12, lateralV("left"));
        expect(medialRise).toBeGreaterThan(0.2);
        expect(lateralRise).toBeLessThan(medialRise * 0.25);
        expect(wedgeDeltaAt(0.12, medialV("right"), "right", leftOnly.design.corrections.right, params)).toBe(
            0,
        );
    });

    test("a right-only rearfoot wedge leaves the left solid unchanged", () => {
        const baseline = build({});
        const rightOnly = build({
            rearfoot_wedge: { side: "lateral", value: 2, unit: "deg", degree_mode: "station", foot: "right" },
        });
        expect(rightOnly.design.corrections.left.rearfootWedge).toBeUndefined();
        expect(rightOnly.design.corrections.right.rearfootWedge).toEqual({
            side: "lateral",
            value: 2,
            unit: "deg",
            degreeMode: "station",
        });
        expect(JSON.stringify(rightOnly.design.corrections.left)).toBe(
            JSON.stringify(baseline.design.corrections.left),
        );
        expect(solidGrid("left", rightOnly.design.corrections.left)).toEqual(
            solidGrid("left", baseline.design.corrections.left),
        );
        expect(solidGrid("right", rightOnly.design.corrections.right)).not.toEqual(
            solidGrid("right", baseline.design.corrections.right),
        );
    });

    test("a left-only full-length wedge changes only the left solid", () => {
        const baseline = build({});
        // Suiters is a lateral full-length wedge on the left only. 4° is a fixture already
        // used by the wedge tests, not a clinical magnitude for that order.
        const leftOnly = build({
            full_length_wedge: { side: "lateral", value: 4, unit: "deg", foot: "left" },
        });
        expect(leftOnly.design.corrections.linked).toBe(false);
        expect(leftOnly.design.corrections.left.fullLengthWedge).toEqual({
            side: "lateral",
            value: 4,
            unit: "deg",
        });
        expect(leftOnly.design.corrections.right.fullLengthWedge).toBeUndefined();
        expect(JSON.stringify(leftOnly.design.corrections.right)).toBe(
            JSON.stringify(baseline.design.corrections.right),
        );
        expect(leftOnly.paths).toContain("settings.corrections.left.fullLengthWedge");
        expect(leftOnly.paths).not.toContain("settings.corrections.right.fullLengthWedge");

        expect(solidGrid("right", leftOnly.design.corrections.right)).toEqual(
            solidGrid("right", baseline.design.corrections.right),
        );
        const lateralRise =
            solidTop("left", leftOnly.design.corrections.left, 0.15, lateralV("left")) -
            solidTop("left", baseline.design.corrections.left, 0.15, lateralV("left"));
        const medialRise =
            solidTop("left", leftOnly.design.corrections.left, 0.15, medialV("left")) -
            solidTop("left", baseline.design.corrections.left, 0.15, medialV("left"));
        expect(lateralRise).toBeGreaterThan(0.2);
        expect(medialRise).toBeLessThan(lateralRise * 0.25);
    });

    test("rearfoot posting sign is valgus lateral and varus medial", () => {
        expect(REARFOOT_POSTING_DEG_SIGN).toMatch(/Positive is valgus \(lateral high, pronation\)/);
        expect(REARFOOT_POSTING_DEG_SIGN).toMatch(/Negative is varus \(medial high, supination\)/);
        expect(savedDesignCatalogSchema.shape.sliders.unwrap().shape.rearfoot_posting_deg.description).toBe(
            REARFOOT_POSTING_DEG_SIGN,
        );
        expect(
            savedDesignCatalogSchema.shape.sliders_by_side.unwrap().shape.left.unwrap().shape
                .rearfoot_posting_deg.description,
        ).toBe(REARFOOT_POSTING_DEG_SIGN);
        expect(savedDesignCatalogSchema.shape.rearfoot_wedge.unwrap().shape.foot.unwrap().description).toBe(
            WEDGE_FOOT_FIELD,
        );
        expect(
            savedDesignCatalogSchema.shape.full_length_wedge.unwrap().shape.foot.unwrap().description,
        ).toBe(WEDGE_FOOT_FIELD);

        // Fleming: 2° valgus rearfoot post, both feet. Positive is that sign.
        const neutral = migrateSideCorrections(build({}).design.corrections.left);
        const both = build({ sliders: { rearfoot_posting_deg: 2 } });
        expect(both.design.corrections.linked).toBe(true);
        for (const side of ["left", "right"] as const) {
            expect(both.design.corrections[side].rearfootPostingDeg).toBe(2);
            const migrated = migrateSideCorrections(both.design.corrections[side]);
            expect(migrated.rearfootWedge).toEqual({ side: "lateral", value: 2, unit: "deg" });
            expect(migrated.rearfootPostingDeg).toBe(0);
            const lateralRise =
                solidTop(side, migrated, 0.12, lateralV(side)) -
                solidTop(side, neutral, 0.12, lateralV(side));
            const medialRise =
                solidTop(side, migrated, 0.12, medialV(side)) - solidTop(side, neutral, 0.12, medialV(side));
            expect(lateralRise).toBeGreaterThan(0.2);
            expect(medialRise).toBeLessThan(lateralRise * 0.25);
        }

        const split = build({
            sliders_by_side: {
                left: { rearfoot_posting_deg: 2 },
                right: { rearfoot_posting_deg: -2 },
            },
        });
        expect(split.design.corrections.linked).toBe(false);
        const left = migrateSideCorrections(split.design.corrections.left);
        const right = migrateSideCorrections(split.design.corrections.right);
        expect(left.rearfootWedge).toEqual({ side: "lateral", value: 2, unit: "deg" });
        expect(right.rearfootWedge).toEqual({ side: "medial", value: 2, unit: "deg" });
        const leftLateralRise =
            solidTop("left", left, 0.12, lateralV("left")) -
            solidTop("left", neutral, 0.12, lateralV("left"));
        const leftMedialRise =
            solidTop("left", left, 0.12, medialV("left")) - solidTop("left", neutral, 0.12, medialV("left"));
        expect(leftLateralRise).toBeGreaterThan(0.2);
        expect(leftMedialRise).toBeLessThan(leftLateralRise * 0.25);
        const rightMedialRise =
            solidTop("right", right, 0.12, medialV("right")) -
            solidTop("right", neutral, 0.12, medialV("right"));
        const rightLateralRise =
            solidTop("right", right, 0.12, lateralV("right")) -
            solidTop("right", neutral, 0.12, lateralV("right"));
        expect(rightMedialRise).toBeGreaterThan(0.2);
        expect(rightLateralRise).toBeLessThan(rightMedialRise * 0.25);
    });

    test("an unknown foot and a foot on the forefoot wedge are refused", () => {
        expect422({ rearfoot_wedge: { side: "medial", value: 2, unit: "deg", foot: "pair" } });
        expect422({ full_length_wedge: { side: "lateral", value: 4, unit: "deg", foot: "bilateral" } });
        expect422({ forefoot_wedge: { side: "lateral", value: 2, unit: "deg", foot: "left" } });
    });
});
