// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { VERTEX_STARTER_PRESETS } from "@/lib/clinical/correction-presets";
import { ELEMENT_PROFILES } from "@/lib/geometry/elements";
import type { DesignState, ElementKind, PrescriptionParseResult } from "@/types";
import { useDesignStore } from "./design-store";

function freshDesign(): DesignState {
    return JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
}

function prescription(): PrescriptionParseResult {
    return {
        corrections: { left: { heelLiftMm: 2 } },
        elements: Object.keys(ELEMENT_PROFILES).flatMap((kind) => [
            { kind: kind as ElementKind, side: "left" as const },
            { kind: kind as ElementKind, side: "right" as const },
        ]),
        notes: "Element suggestions",
        confidence: 1,
        provider: "heuristic",
        tokenCost: 0,
    };
}

describe("elements require explicit library placement", () => {
    beforeEach(() => {
        localStorage.removeItem("vertex-design-session");
        useDesignStore.setState({ design: freshDesign(), selectedElementId: null, history: [], future: [] });
    });

    test("new designs and resets have no elements", () => {
        expect(useDesignStore.getInitialState().design.elements).toEqual([]);
        useDesignStore.getState().addElement("dancers_pad", "left");
        expect(useDesignStore.getState().design.elements).toHaveLength(1);
        useDesignStore.getState().reset();
        expect(useDesignStore.getState().design.elements).toEqual([]);
        expect(useDesignStore.getState().selectedElementId).toBeNull();
    });

    test("prescription application never inserts any suggested element", () => {
        useDesignStore.getState().applyPrescription(prescription());
        expect(useDesignStore.getState().design.elements).toEqual([]);
        expect(useDesignStore.getState().design.corrections.left.heelLiftMm).toBe(2);
    });

    test("every starter preset is element-free in merge and replace modes", () => {
        for (const preset of VERTEX_STARTER_PRESETS) {
            for (const mode of ["merge", "replace"] as const) {
                useDesignStore.getState().applyCorrectionPreset(preset.payload, mode);
                expect(useDesignStore.getState().design.elements).toEqual([]);
            }
        }
    });

    test("explicit stock/custom placements survive prescriptions, presets and saved design load", () => {
        const state = useDesignStore.getState();
        state.addElement("dancers_pad", "left");
        state.addElement("met_pad", "right");
        state.addCustomElement("custom-user-asset", "My pad", "left");
        const placed = JSON.parse(JSON.stringify(useDesignStore.getState().design.elements));
        expect(placed).toHaveLength(3);
        state.applyPrescription(prescription());
        for (const mode of ["merge", "replace"] as const) {
            state.applyCorrectionPreset(VERTEX_STARTER_PRESETS[0]!.payload, mode);
            expect(useDesignStore.getState().design.elements).toEqual(placed);
        }
        const saved = JSON.parse(JSON.stringify(useDesignStore.getState().design));
        state.loadDesign(saved);
        expect(useDesignStore.getState().design.elements).toEqual(placed);
    });

    test("session rehydration restores intentional placements without adding or erasing any", async () => {
        useDesignStore.getState().addElement("dancers_pad", "right");
        const saved = JSON.parse(JSON.stringify(useDesignStore.getState().design));
        useDesignStore.setState({ design: freshDesign() });
        localStorage.setItem(
            "vertex-design-session",
            JSON.stringify({ state: { design: saved }, version: 0 }),
        );
        await useDesignStore.persist.rehydrate();
        expect(useDesignStore.getState().design.elements).toEqual(saved.elements);
        // Reloading an intentionally empty session must stay empty as well.
        const empty = { ...saved, elements: [] };
        localStorage.setItem(
            "vertex-design-session",
            JSON.stringify({ state: { design: empty }, version: 0 }),
        );
        await useDesignStore.persist.rehydrate();
        expect(useDesignStore.getState().design.elements).toEqual([]);
    });
});
