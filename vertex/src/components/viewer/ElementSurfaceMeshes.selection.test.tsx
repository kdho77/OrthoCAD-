// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BoxGeometry, BufferGeometry } from "three";
import { buildElementDisplayMeshes } from "@/lib/geometry/element-assets/display-mesh";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { ElementSurfaceMeshes } from "./ElementSurfaceMeshes";

rs.mock("@/lib/geometry/element-assets/display-mesh", () => ({ buildElementDisplayMeshes: rs.fn() }));
rs.mock("./ElementHardnessPopup", () => ({ ElementHardnessPopup: () => null }));
(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let base: BoxGeometry;

beforeEach(() => {
    const design = JSON.parse(JSON.stringify(useDesignStore.getInitialState().design));
    design.elements = [
        {
            id: "pad",
            kind: "dancers_pad",
            side: "left",
            position: { x: 20, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 4,
        },
    ];
    useDesignStore.setState({ design, selectedElementId: null });
    useClinicalWorkflowStore.setState({ step: "print" });
    rs.mocked(buildElementDisplayMeshes).mockReset();
    rs.mocked(buildElementDisplayMeshes).mockImplementation(async (_base, elements) => [
        {
            element: elements[0]!,
            surface: new BoxGeometry(2, 2, 2),
            border: new BufferGeometry(),
        },
    ]);
    base = new BoxGeometry(10, 10, 1);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    base.dispose();
    container.remove();
});

test("element pointer-down is consumed; selection, hardness and dismissal reuse the surface mesh", async () => {
    const pointerDownBehind = rs.fn();
    await act(async () =>
        root.render(
            createElement(
                "div",
                { onPointerDown: pointerDownBehind },
                createElement(ElementSurfaceMeshes, { base, side: "left" }),
            ),
        ),
    );
    const mesh = container.querySelector("mesh");
    expect(mesh).not.toBeNull();
    const design = useDesignStore.getState().design;
    const firstGeometry = rs.mocked(buildElementDisplayMeshes).mock.results.length;
    expect(firstGeometry).toBe(1);
    await act(async () => {
        mesh!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        mesh!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pointerDownBehind).not.toHaveBeenCalled();
    expect(useDesignStore.getState().selectedElementId).toBe("pad");
    expect(useDesignStore.getState().design).toBe(design);
    await act(async () => useDesignStore.getState().setElementHardness("pad", "Soft"));
    await act(async () => useDesignStore.getState().selectElement(null));
    expect(buildElementDisplayMeshes).toHaveBeenCalledTimes(1);
    expect(container.querySelector("mesh")).toBe(mesh);
    // A real placement change must still invalidate the display geometry.
    await act(async () => useDesignStore.getState().updateElement("pad", { heightMm: 6 }));
    expect(buildElementDisplayMeshes).toHaveBeenCalledTimes(2);
});
