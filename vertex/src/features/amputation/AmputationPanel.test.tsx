// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AmputationPanel } from "@/features/amputation/AmputationPanel";
import { useAmputationDrawStore } from "@/features/amputation/amputation-draw-store";
import { defaultDesign, useDesignStore } from "@/stores/design-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clickLabel(container: HTMLElement, label: string) {
    const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === label,
    );
    if (!button) throw new Error(`missing ${label}`);
    button.click();
}

describe("Amputation panel", () => {
    let container: HTMLDivElement;
    let root: Root;

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        container?.remove();
        useAmputationDrawStore.getState().cancel();
        useDesignStore.setState({ design: defaultDesign() });
    });

    test("Draw does not render the 2D outline sketch", async () => {
        useDesignStore.setState({ design: defaultDesign() });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(createElement(AmputationPanel)));
        const draw = [...container.querySelectorAll("button")].filter(
            (button) => button.textContent?.trim() === "Draw",
        );
        expect(draw.length).toBe(2);
        await act(async () => clickLabel(container, "Draw"));
        expect(container.querySelector('[aria-label="Amputation draw canvas"]')).toBeNull();
        expect(container.textContent).not.toContain("Medial is the top of the outline");
        expect(container.querySelector("svg")).toBeNull();
        expect(container.textContent).toContain("Confirm");
        expect(container.textContent).toContain("Click the Left insole");
    });

    test("a linked confirm copies the cut onto both feet", () => {
        useDesignStore.setState({ design: defaultDesign() });
        expect(useDesignStore.getState().design.corrections.linked).toBe(true);
        useDesignStore.getState().updateAmputation("left", {
            enabled: true,
            points: [
                { x: 160, y: 30 },
                { x: 200, y: 0 },
                { x: 160, y: -30 },
            ],
        });
        const amp = useDesignStore.getState().design.amputation;
        expect(amp?.left?.enabled).toBe(true);
        expect(amp?.right?.enabled).toBe(true);
        expect(amp?.right?.points).toEqual(amp?.left?.points);
        expect(amp?.left?.height).toBe(15);
        expect(amp?.left?.filletInside).toBe(10);
        expect(amp?.left?.filletOutside).toBe(30);

        useDesignStore.getState().setLinked(false);
        useDesignStore.getState().updateAmputation("right", { enabled: false, points: [] });
        const split = useDesignStore.getState().design.amputation;
        expect(split?.right?.enabled).toBe(false);
        expect(split?.left?.enabled).toBe(true);
        expect(split?.left?.points.length).toBe(3);
    });
});
