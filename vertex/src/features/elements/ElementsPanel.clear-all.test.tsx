// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { ElementsPanel } from "./ElementsPanel";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

function freshDesign() {
    return JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
}

beforeEach(() => {
    useClinicalWorkflowStore.setState({ elementPlacementFoot: "left" });
    useDesignStore.setState({
        design: freshDesign(),
        selectedElementId: null,
        history: [],
        future: [],
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

async function renderPanel() {
    await act(async () => root.render(createElement(ElementsPanel)));
}

describe("ElementsPanel placed clear all", () => {
    test("hides Clear all when nothing is placed for the active foot", async () => {
        useDesignStore.getState().addElement("met_pad", "right");
        await renderPanel();
        expect(container.querySelector('[data-testid="placed-clear-all"]')).toBeNull();
    });

    test("shows Clear all when elements exist for the active foot", async () => {
        useDesignStore.getState().addElement("met_pad", "left");
        await renderPanel();
        expect(container.querySelector('[data-testid="placed-clear-all"]')?.textContent).toBe("Clear all");
    });

    test("Clear all on Both removes left and right placements", async () => {
        useClinicalWorkflowStore.setState({ elementPlacementFoot: "both" });
        const state = useDesignStore.getState();
        state.addElement("met_pad", "left");
        state.addElement("met_bar", "right");
        await renderPanel();
        const clearAll = container.querySelector('[data-testid="placed-clear-all"]');
        expect(clearAll).toBeTruthy();
        await act(async () => clearAll?.closest("button")?.click());
        await act(async () => {
            const deleteBtn = [...document.querySelectorAll("button")].find(
                (b) => b.textContent?.trim() === "Delete",
            );
            expect(deleteBtn).toBeTruthy();
            deleteBtn?.click();
        });
        expect(useDesignStore.getState().design.elements).toEqual([]);
    });
});
