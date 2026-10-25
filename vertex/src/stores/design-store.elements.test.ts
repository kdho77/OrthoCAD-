// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { VERTEX_STARTER_PRESETS } from "@/lib/clinical/correction-presets";
import { ELEMENT_PROFILES } from "@/lib/geometry/elements";
import type { DesignState, ElementKind, PrescriptionParseResult } from "@/types";
import { useClientStore } from "./client-store";
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
        useDesignStore.setState({
            design: freshDesign(),
            pendingSessionDesign: null,
            selectedElementId: null,
            history: [],
            future: [],
        });
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

    test("session reload holds placements aside until explicit resume, even across repeated reloads", async () => {
        useDesignStore.getState().addElement("dancers_pad", "right");
        const saved = JSON.parse(JSON.stringify(useDesignStore.getState().design));
        useDesignStore.setState({ design: freshDesign() });
        localStorage.setItem(
            "vertex-design-session",
            JSON.stringify({ state: { design: saved }, version: 0 }),
        );
        await useDesignStore.persist.rehydrate();
        expect(useDesignStore.getState().design.elements).toEqual([]);
        expect(useDesignStore.getState().pendingSessionDesign?.elements).toEqual(saved.elements);
        // A routine store write and another reload must not lose the recovery copy.
        useDesignStore.getState().selectElement(null);
        await useDesignStore.persist.rehydrate();
        expect(useDesignStore.getState().design.elements).toEqual([]);
        expect(useDesignStore.getState().pendingSessionDesign?.elements).toEqual(saved.elements);
        useDesignStore.getState().resumeSession();
        expect(useDesignStore.getState().design.elements).toEqual(saved.elements);
        expect(useDesignStore.getState().pendingSessionDesign).toBeNull();
        // Reloading an intentionally empty session must stay empty as well.
        const empty = { ...saved, elements: [] };
        localStorage.setItem(
            "vertex-design-session",
            JSON.stringify({ state: { design: empty }, version: 0 }),
        );
        await useDesignStore.persist.rehydrate();
        expect(useDesignStore.getState().design.elements).toEqual([]);
    });
    test("starting fresh clears the browser draft and active save target, not saved projects", async () => {
        useDesignStore.getState().addElement("dancers_pad", "left");
        const saved = JSON.parse(JSON.stringify(useDesignStore.getState().design));
        const client = useClientStore.getState().addClient({ firstName: "Test", lastName: "Client" });
        const project = useClientStore.getState().addDesign(client, "Saved design", saved);
        await useDesignStore.persist.rehydrate();
        expect(useDesignStore.getState().pendingSessionDesign).not.toBeNull();
        useDesignStore.getState().startFreshSession();
        expect(useDesignStore.getState().design.elements).toEqual([]);
        expect(useDesignStore.getState().pendingSessionDesign).toBeNull();
        expect(useClientStore.getState().activeDesignId).toBeNull();
        expect(useClientStore.getState().designs.find((d) => d.id === project)?.state).toEqual(saved);
        await useDesignStore.persist.rehydrate();
        expect(useDesignStore.getState().design.elements).toEqual([]);
        expect(useDesignStore.getState().pendingSessionDesign).toBeNull();
        useDesignStore.getState().loadDesign(saved);
        expect(useDesignStore.getState().design.elements).toEqual(saved.elements);
    });

    test("linked sinks keep a requested depth above max on both feet", () => {
        expect(useDesignStore.getState().design.corrections.linked).toBe(true);
        expect(useDesignStore.getState().design.sinks).toBeUndefined();
        useDesignStore.getState().addSink("mpj1", "left");
        const added = useDesignStore.getState().design.sinks?.left?.[0];
        expect(added?.depthMm).toBe(2);
        useDesignStore.getState().updateSink(added!.id, { depthMm: 5 }, "left");
        const sinks = useDesignStore.getState().design.sinks;
        expect(sinks?.left?.[0]?.depthMm).toBe(5);
        expect(sinks?.right?.[0]?.depthMm).toBe(5);
        expect(sinks?.left?.[0]).not.toBe(sinks?.right?.[0]);
        useDesignStore.getState().setSinkStyloidThicken(true, "right");
        expect(useDesignStore.getState().design.sinkStyloidThicken).toEqual({ left: true, right: true });
        useDesignStore.getState().removeSink(added!.id, "left");
        expect(useDesignStore.getState().design.sinks).toBeUndefined();
    });
});
