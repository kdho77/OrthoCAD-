// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { VERTEX_STARTER_PRESETS } from "@/lib/clinical/correction-presets";
import { defaultElementPose, ELEMENT_PROFILES } from "@/lib/geometry/elements";
import { meshYForAnatomicalSide, meshYSign } from "@/lib/geometry/handedness";
import { insoleLayoutForUsMenSize } from "@/lib/geometry/shoe-size";
import type { DesignState, ElementKind, PrescriptionParseResult } from "@/types";
import { defaultShoeChart } from "../../shared/client-files";
import { useClientStore } from "./client-store";
import { useClinicalWorkflowStore } from "./clinical-workflow-store";
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
        useClinicalWorkflowStore.setState({ elementPlacementFoot: "both" });
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
        const client = useClientStore
            .getState()
            .addClient({ firstName: "Test", lastName: "Client", reference: "T-1", ...defaultShoeChart() });
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

    test("loading a saved design puts an untouched legacy first-ray pad back under the first ray", () => {
        const layout = insoleLayoutForUsMenSize(11.5);
        const half = layout.widthMm / 2;
        const design = freshDesign();
        design.usMenSize = 11.5;
        design.sizeSystem = "us";
        design.elements = [
            {
                id: "legacy-left",
                kind: "mortons_extension",
                side: "left",
                position: { x: 0.78 * layout.lengthMm - layout.lengthMm / 2, y: 0.5 * half },
                rotationDeg: 0,
                scale: { x: 1, y: 1 },
                heightMm: 2,
            },
            {
                id: "legacy-right",
                kind: "reverse_mortons",
                side: "right",
                position: {
                    x: 0.7 * layout.lengthMm - layout.lengthMm / 2,
                    y: meshYForAnatomicalSide("right", "lateral", 0.1 * half),
                },
                rotationDeg: 0,
                scale: { x: 1, y: 1 },
                heightMm: 2.5,
            },
        ];
        useDesignStore.getState().loadDesign(design);
        const loaded = useDesignStore.getState().design.elements;
        for (const el of loaded) {
            const pose = defaultElementPose(el.kind, el.side, layout.lengthMm, layout.widthMm);
            expect(el.position).toEqual(pose.position);
            expect(Math.sign(el.position.y)).toBe(meshYSign(el.side, "medial"));
        }
        expect(loaded.find((el) => el.id === "legacy-left")?.heightMm).toBe(2);
        expect(loaded.find((el) => el.id === "legacy-right")?.heightMm).toBe(2.5);
        useDesignStore.getState().loadDesign(useDesignStore.getState().design);
        expect(useDesignStore.getState().design.elements.map((el) => el.position)).toEqual(
            loaded.map((el) => el.position),
        );
    });

    test("removeElementsForSides removes only the requested foot sides", () => {
        const state = useDesignStore.getState();
        state.addElement("dancers_pad", "left");
        state.addElement("met_pad", "right");
        state.addElement("met_bar", "left");
        useDesignStore.setState({ history: [], future: [] });

        state.removeElementsForSides(["left"]);
        expect(useDesignStore.getState().design.elements.map((e) => e.side)).toEqual(["right"]);

        useDesignStore.setState({ history: [], future: [] });
        state.addElement("toe_crest", "left");
        useDesignStore.setState({ history: [], future: [] });
        state.removeElementsForSides(["right"]);
        expect(useDesignStore.getState().design.elements.every((e) => e.side === "left")).toBe(true);

        useDesignStore.setState({ history: [], future: [] });
        state.removeElementsForSides(["left", "right"]);
        expect(useDesignStore.getState().design.elements).toEqual([]);
    });

    test("removeElementsForSides is a no-op with nothing to clear", () => {
        useDesignStore.getState().addElement("dancers_pad", "left");
        useDesignStore.setState({ history: [], future: [] });
        useDesignStore.getState().removeElementsForSides(["right"]);
        expect(useDesignStore.getState().design.elements).toHaveLength(1);
        expect(useDesignStore.getState().history).toHaveLength(0);
    });

    test("removeElementsForSides restores all removed elements in one undo", () => {
        const state = useDesignStore.getState();
        state.addElement("dancers_pad", "left");
        state.addElement("met_pad", "right");
        const before = JSON.parse(JSON.stringify(useDesignStore.getState().design.elements));
        useDesignStore.setState({ history: [], future: [] });
        state.removeElementsForSides(["left", "right"]);
        expect(useDesignStore.getState().design.elements).toEqual([]);
        expect(useDesignStore.getState().history).toHaveLength(1);
        state.undo();
        expect(useDesignStore.getState().design.elements).toEqual(before);
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
