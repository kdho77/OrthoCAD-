// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    applyCorrectionPresetToDesign,
    applyDesignMacrosToDesign,
    correctionPresetOriginKeys,
    type DesignMacro,
    listDesignMacros,
    VERTEX_STARTER_PRESETS,
} from "@/lib/clinical/correction-presets";
import type { DesignState } from "@/types";

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

        expect(next.corrections.left.archFillMm).toBe(0);
        expect(next.corrections.left.archHeightMm).toBe(12);
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

    test("legacy includeElements cannot insert suggested elements", () => {
        const design = testDesign();
        const sesamoid = VERTEX_STARTER_PRESETS.find((p) => p.id === "vertex-sesamoiditis")!;
        const next = applyCorrectionPresetToDesign(design, sesamoid.payload, {
            mode: "merge",
            includeElements: true,
            activeSide: "left",
        });
        expect(next.elements).toEqual([]);
    });

    test("presets leave suggested elements for the user to add", () => {
        const sesamoid = VERTEX_STARTER_PRESETS.find((p) => p.id === "vertex-sesamoiditis")!;
        const next = applyCorrectionPresetToDesign(testDesign(), sesamoid.payload, {
            mode: "merge",
            activeSide: "left",
        });
        expect(next.elements).toHaveLength(0);
    });

    test("omitting both macros returns the same design", () => {
        const design = testDesign();
        expect(applyDesignMacrosToDesign(design, {})).toBe(design);
    });

    test("customer then pathology matches two Merge applies and the reverse order does not", () => {
        const rhinebeck: DesignMacro = {
            id: "fixture-customer-order",
            name: "Rhinebeck",
            kind: "customer",
            payload: {
                corrections: { linked: true, left: { heelCupDepthMm: 14, archHeightMm: 4 } },
            },
        };
        const library = listDesignMacros([rhinebeck]);
        const planus = library.find((macro) => macro.id === "vertex-planus");
        if (!planus) throw new Error("vertex-planus missing");
        expect(planus.aliases).toEqual(["pes planus"]);
        const design = testDesign();
        const ui = applyCorrectionPresetToDesign(
            applyCorrectionPresetToDesign(design, rhinebeck.payload, { mode: "merge" }),
            planus.payload,
            { mode: "merge" },
        );
        const headless = applyDesignMacrosToDesign(
            design,
            { customer: "Rhinebeck", pathology: "Pes Planus" },
            library,
        );
        expect(headless).toEqual(ui);
        const reversed = applyCorrectionPresetToDesign(
            applyCorrectionPresetToDesign(design, planus.payload, { mode: "merge" }),
            rhinebeck.payload,
            { mode: "merge" },
        );
        expect(headless.corrections).not.toEqual(reversed.corrections);
    });

    test("an unknown customer macro is refused and pes planus is not a customer macro", () => {
        expect(() => applyDesignMacrosToDesign(testDesign(), { customer: "Rhinebeck" })).toThrow(
            /No customer macro named "Rhinebeck"/,
        );
        expect(() => applyDesignMacrosToDesign(testDesign(), { customer: "Pes Planus" })).toThrow(
            /No customer macro named "Pes Planus"/,
        );
        expect(listDesignMacros().some((macro) => macro.kind === "customer")).toBe(false);
    });

    test("origin keys mark the fields a linked preset wrote", () => {
        const pf = VERTEX_STARTER_PRESETS.find((p) => p.id === "vertex-pf")!;
        const keys = correctionPresetOriginKeys(pf.payload, true);
        expect(keys.left).toEqual(expect.arrayContaining(["archFillMm", "heelCupDepthMm", "archHeightMm"]));
        expect(keys.right).toEqual(keys.left);
    });
});
