// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Host() {
    useKeyboardShortcuts({});
    return null;
}

test("Escape exits outline edit and discards an unsaved draft", async () => {
    const confirm = window.confirm;
    window.confirm = () => {
        throw new Error("Escape should not prompt");
    };
    useMeshEditStore.getState().resetEdits();
    const before = useDesignStore.getState().design.trimlines;
    useMeshEditStore.getState().beginBottomPatternEdit("left");
    useMeshEditStore
        .getState()
        .setBottomPatternDraft([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(6, 0, 0),
            new THREE.Vector3(6, 3, 0),
        ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => root.render(createElement(Host)));
    await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(useMeshEditStore.getState().bottomPatternEdit).toBeNull();
    expect(useMeshEditStore.getState().editMode).toBe("transform");
    expect(useDesignStore.getState().design.trimlines).toBe(before);
    await act(async () => root.unmount());
    container.remove();
    window.confirm = confirm;
    useMeshEditStore.getState().resetEdits();
});
