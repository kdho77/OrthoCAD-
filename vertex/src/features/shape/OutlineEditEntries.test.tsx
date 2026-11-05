// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { OutlineEditEntries } from "@/features/shape/OutlineEditEntries";
import { TrimPresetsPanel } from "@/features/shape/TrimPresetsPanel";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function labels(container: HTMLElement): string[] {
    return [...container.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
}

function clickLabel(container: HTMLElement, label: string) {
    const button = [...container.querySelectorAll("button")].find(
        (item) => item.textContent?.trim() === label,
    );
    if (!button) throw new Error(`missing ${label}`);
    button.click();
}

describe("Base-step outline entries", () => {
    let container: HTMLDivElement;
    let root: Root;
    let confirm: typeof window.confirm;

    beforeEach(() => {
        confirm = window.confirm;
        useMeshEditStore.getState().resetEdits();
        useDesignStore.getState().setViewer({ wallModel: "procedural" });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        window.confirm = confirm;
        await act(async () => root.unmount());
        container.remove();
        useMeshEditStore.getState().resetEdits();
    });

    test("Edit trimline and Edit bottom pattern enter that tool", async () => {
        await act(async () => root.render(createElement(OutlineEditEntries)));
        expect(labels(container)).toEqual(["Edit trimline", "Edit bottom pattern"]);
        await act(async () => clickLabel(container, "Edit trimline"));
        expect(useMeshEditStore.getState().editMode).toBe("edit-trimline");
        expect(useMeshEditStore.getState().trimlineEdit?.side).toBeTruthy();
        await act(async () => clickLabel(container, "Edit bottom pattern"));
        expect(useMeshEditStore.getState().editMode).toBe("edit-bottom-pattern");
        expect(useMeshEditStore.getState().trimlineEdit).toBeNull();
    });

    test("legacy walls omit Edit bottom pattern", async () => {
        useDesignStore.getState().setViewer({ wallModel: "legacy" });
        await act(async () => root.render(createElement(OutlineEditEntries)));
        expect(labels(container)).toEqual(["Edit trimline"]);
    });

    test("the other entry prompts only when the draft changed", async () => {
        const prompts: string[] = [];
        window.confirm = (message?: string) => {
            prompts.push(String(message));
            return false;
        };
        await act(async () => root.render(createElement(OutlineEditEntries)));
        await act(async () => clickLabel(container, "Edit trimline"));
        await act(async () => clickLabel(container, "Edit bottom pattern"));
        expect(prompts).toEqual([]);
        expect(useMeshEditStore.getState().editMode).toBe("edit-bottom-pattern");

        await act(async () => {
            useMeshEditStore
                .getState()
                .setBottomPatternDraft([
                    new THREE.Vector3(0, 0, 0),
                    new THREE.Vector3(3, 0, 0),
                    new THREE.Vector3(3, 4, 0),
                ]);
        });
        await act(async () => clickLabel(container, "Edit trimline"));
        expect(prompts).toEqual(["Discard unsaved bottom pattern changes?"]);
        expect(useMeshEditStore.getState().editMode).toBe("edit-bottom-pattern");

        window.confirm = () => true;
        await act(async () => clickLabel(container, "Edit trimline"));
        expect(useMeshEditStore.getState().editMode).toBe("edit-trimline");
        expect(useMeshEditStore.getState().bottomPatternEdit).toBeNull();
    });

    test("a trim preset leaves a dirty bottom-pattern edit only after confirm", async () => {
        window.confirm = () => false;
        await act(async () => root.render(createElement(TrimPresetsPanel)));
        useMeshEditStore.getState().beginBottomPatternEdit("left");
        useMeshEditStore
            .getState()
            .setBottomPatternDraft([
                new THREE.Vector3(1, 1, 0),
                new THREE.Vector3(2, 1, 0),
                new THREE.Vector3(2, 2, 0),
            ]);
        await act(async () => clickLabel(container, "Full"));
        expect(useMeshEditStore.getState().editMode).toBe("edit-bottom-pattern");
        window.confirm = () => true;
        await act(async () => clickLabel(container, "Full"));
        expect(useMeshEditStore.getState().editMode).toBe("edit-trimline");
    });
});
