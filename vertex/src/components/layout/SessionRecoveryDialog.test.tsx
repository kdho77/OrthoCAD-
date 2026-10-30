// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, expect, test } from "@rstest/core";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useDesignStore } from "@/stores/design-store";
import { SessionRecoveryDialog } from "./SessionRecoveryDialog";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
    const design = structuredClone(useDesignStore.getInitialState().design);
    const draft = structuredClone(design);
    draft.elements = [
        {
            id: "old-pad",
            kind: "dancers_pad",
            side: "left",
            position: { x: 20, y: 0 },
            rotationDeg: 0,
            scale: { x: 1, y: 1 },
            heightMm: 4,
        },
    ];
    useDesignStore.setState({ design, pendingSessionDesign: draft });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<SessionRecoveryDialog />));
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});
async function click(label: string) {
    const button = [...document.querySelectorAll("button")].find((el) => el.textContent === label);
    if (!button) throw new Error(`Missing button: ${label}`);
    await act(async () => button.click());
}

test("loading a previous draft shows a choice with empty insoles; only Resume restores its pad", async () => {
    expect(document.querySelector("[role=dialog]")?.textContent).toContain("Previous design available");
    expect(useDesignStore.getState().design.elements).toEqual([]);
    await click("Resume previous design");
    expect(useDesignStore.getState().design.elements.map((e) => e.id)).toEqual(["old-pad"]);
    expect(document.querySelector("[role=dialog]")).toBeNull();
});

test("Start fresh dismisses the choice and keeps the insoles empty", async () => {
    await click("Start fresh");
    expect(useDesignStore.getState().design.elements).toEqual([]);
    expect(useDesignStore.getState().pendingSessionDesign).toBeNull();
    expect(document.querySelector("[role=dialog]")).toBeNull();
});
