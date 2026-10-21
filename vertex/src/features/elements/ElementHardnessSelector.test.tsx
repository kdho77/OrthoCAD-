// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import JSZip from "jszip";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { elementGeometryKey } from "@/lib/geometry/element-geometry-key";
import { collectHardnessRegions } from "@/lib/hardness/collect";
import { packHardness3mf, readDesignFrom3mf } from "@/lib/hardness/export-3mf";
import { boxMesh } from "@/lib/hardness/mesh";
import { buildRawModifiers } from "@/lib/hardness/pipeline";
import { resolveModifiers } from "@/lib/hardness/resolve";
import { elementPreviewColor } from "@/lib/hardness/split-overlay";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import {
    CLASS_PREVIEW_COLORS,
    NAMED_HARDNESS_CLASSES,
} from "../../../shared/print-recipe/hardness-class-table";
import { ElementHardnessSelector } from "./ElementHardnessSelector";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const id = "left-dancer";
const placed = {
    id,
    kind: "dancers_pad" as const,
    side: "left" as const,
    position: { x: 30, y: 0 },
    rotationDeg: 17,
    scale: { x: 1.1, y: 0.9 },
    heightMm: 4,
};

beforeEach(() => {
    const design = JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
    design.elements = [placed, { ...placed, id: "right-dancer", side: "right" }];
    design.splitElements = false;
    useDesignStore.setState({ design, selectedElementId: id, history: [], future: [] });
    useClinicalWorkflowStore.setState({ step: "print" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

async function render() {
    await act(async () => root.render(createElement(ElementHardnessSelector, { elementId: id })));
}
async function choose(value: string) {
    await act(async () =>
        container.querySelector<HTMLButtonElement>(`[data-hardness-option="${value}"]`)!.click(),
    );
}

describe("Print element hardness popup", () => {
    test("chooses all five levels, updates selected color immediately and leaves geometry/other foot unchanged", async () => {
        const original = useDesignStore.getState().design;
        const geometryKey = elementGeometryKey(original.elements);
        const opposite = original.elements[1];
        await render();
        expect(container.querySelectorAll("[data-hardness-option]").length).toBe(5);
        for (const level of NAMED_HARDNESS_CLASSES) {
            await choose(level);
            const design = useDesignStore.getState().design;
            const element = design.elements[0]!;
            expect(element.hardnessClass).toBe(level);
            expect(elementPreviewColor(element, true, true)).toBe(CLASS_PREVIEW_COLORS[level]);
            expect(
                container.querySelector(`[data-hardness-option="${level}"]`)!.getAttribute("aria-pressed"),
            ).toBe("true");
            expect(design.splitElements).toBe(true);
            expect(design.elements[1]).toBe(opposite);
            expect(design.printRecipe).toEqual(original.printRecipe);
            expect(elementGeometryKey(design.elements)).toBe(geometryKey);
        }
        expect(elementPreviewColor(useDesignStore.getState().design.elements[0]!, false, true)).toBe(
            "#22c55e",
        );
        expect(elementPreviewColor(useDesignStore.getState().design.elements[0]!, false, false)).toBe(
            "#a855f7",
        );
    });
    test("only appears for the selected element in Print; Escape closes it", async () => {
        useClinicalWorkflowStore.setState({ step: "elements" });
        await render();
        expect(container.querySelector("[role=dialog]")).toBeNull();
        await act(async () => useClinicalWorkflowStore.setState({ step: "print" }));
        expect(container.querySelector("[role=dialog]")).not.toBeNull();
        await act(async () =>
            container
                .querySelector("[role=dialog]")!
                .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
        );
        expect(useDesignStore.getState().selectedElementId).toBeNull();
        expect(container.querySelector("[role=dialog]")).toBeNull();
    });
    test("saves, reloads, undoes and redoes hardness without changing placement", async () => {
        await render();
        await choose("Soft");
        const state = useDesignStore.getState();
        const saved = JSON.parse(JSON.stringify(state.design));
        await act(async () => state.undo());
        expect(useDesignStore.getState().design.elements[0]!.hardnessClass).toBeUndefined();
        expect(useDesignStore.getState().design.splitElements).toBe(false);
        await act(async () => state.redo());
        expect(useDesignStore.getState().design.elements[0]!.hardnessClass).toBe("Soft");
        await act(async () => state.loadDesign(saved));
        expect(useDesignStore.getState().design.elements[0]!.position).toEqual(placed.position);
        expect(collectHardnessRegions(useDesignStore.getState().design, "left")[0]!.hardnessClass).toBe(
            "Soft",
        );
    });
    // Includes cold WASM initialization and a real ZIP export; performance is
    // measured separately by hardness-regions.gates.test.ts.
    test("popup choice reaches 3MF modifier settings and embedded saved design", async () => {
        await render();
        await choose("Extra Soft");
        const design = useDesignStore.getState().design;
        const { raw } = buildRawModifiers(design, "left");
        const modifiers = await resolveModifiers(raw);
        expect(modifiers).toHaveLength(1);
        expect(modifiers[0]!.status).toBe("present");
        const packed = await packHardness3mf({
            design,
            side: "left",
            shell: boxMesh(0, -50, 0, 260, 50, 10),
            modifiers,
        });
        const zip = await JSZip.loadAsync(packed.bytes);
        const xml = await zip.file("Metadata/model_settings.config")!.async("string");
        expect(xml).toContain('key="hardnessClass" value="Extra Soft"');
        expect(xml).toContain('key="sparse_infill_density" value="15%"');
        expect(xml).toContain('key="sparse_infill_line_width" value="0.7"');
        const reopened = await readDesignFrom3mf(packed.bytes);
        expect(JSON.parse(reopened.designJson).design.elements[0]!.hardnessClass).toBe("Extra Soft");
    }, 30_000);
});
