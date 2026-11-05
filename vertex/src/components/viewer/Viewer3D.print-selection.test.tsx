// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import { Viewer3D } from "./Viewer3D";

const canvasEvents = rs.hoisted(() => ({ click: () => {}, miss: () => {} }));
const fiberState = rs.hoisted(() => ({
    scene: { getObjectByName: () => undefined },
    invalidate: () => {},
    camera: {},
    gl: {},
}));
rs.mock("@react-three/fiber", () => ({
    Canvas: (props: { children: React.ReactNode; onClick: () => void; onPointerMissed: () => void }) => {
        canvasEvents.click = props.onClick;
        canvasEvents.miss = props.onPointerMissed;
        return props.children;
    },
    // Viewer3D renders PressureMapOverlay, which calls useThree. The mock used
    // to export only Canvas, so those renders threw "useThree is not a function".
    useThree: (selector?: (state: typeof fiberState) => unknown) =>
        typeof selector === "function" ? selector(fiberState) : fiberState,
}));
rs.mock("@react-three/drei", () => ({ OrbitControls: () => null }));
rs.mock("./BaseInsoleMesh", () => ({ BaseInsoleMesh: () => null }));
rs.mock("./InsoleMesh", () => ({ InsoleMesh: () => null }));
rs.mock("./ElementMarkers", () => ({ ElementMarkers: () => null }));
rs.mock("./SplitElementOverlays", () => ({ SplitElementOverlays: () => null }));
rs.mock("./ScanMarkerPlacement", () => ({ ScanMarkerPlacement: () => null }));
rs.mock("./ScanMeshes", () => ({ ScanMeshes: () => null }));
rs.mock("./ScanPlaneSliceTool", () => ({ ScanPlaneSliceTool: () => null }));
rs.mock("./ScanRotateTool", () => ({ ScanRotateTool: () => null }));
rs.mock("./PrintLoftSplash", () => ({ PrintLoftSplash: () => null }));
rs.mock("./PerformanceMonitor", () => ({ PerformanceMonitorOverlay: () => null }));
rs.mock("./ScanTransformTool", () => ({
    ScanTransformTool: () => null,
    consumeScanMissDeselectSuppression: () => false,
}));
rs.mock("./MeshEditTools", () => ({
    MeshEditTools: () =>
        React.createElement("button", { type: "button", "data-edit-target": "MeshEditTools" }),
}));
rs.mock("./TrimlineEditTools", () => ({
    TrimlineEditTools: () =>
        React.createElement("button", { type: "button", "data-edit-target": "TrimlineEditTools" }),
}));
rs.mock("./BottomPatternEditTools", () => ({
    BottomPatternEditTools: () =>
        React.createElement("button", { type: "button", "data-edit-target": "BottomPatternEditTools" }),
}));

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    useDesignStore.setState({
        selectedElementId: null,
        baseMeshLoadingBySide: { left: false, right: false },
    });
    useMeshEditStore.setState({ ...useMeshEditStore.getInitialState() });
    usePreviewLoftStatusStore.setState({ phaseBySide: { left: "ready", right: "ready" }, error: null });
    useClinicalWorkflowStore.setState({ step: "print" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

test("Print selection and background clicks cannot enter geometry edit mode or clear mesh edits", async () => {
    await act(async () => root.render(createElement(Viewer3D)));
    const design = useDesignStore.getState().design;
    const edit = useMeshEditStore.getState();
    const loft = usePreviewLoftStatusStore.getState();
    expect(container.querySelectorAll("[data-edit-target]").length).toBe(0);
    await act(async () => useDesignStore.getState().selectElement("placed-pad"));
    await act(async () => canvasEvents.click());
    expect(useDesignStore.getState().selectedElementId).toBe("placed-pad");
    expect(useMeshEditStore.getState()).toBe(edit);
    await act(async () => canvasEvents.miss());
    expect(useDesignStore.getState().selectedElementId).toBeNull();
    expect(useMeshEditStore.getState()).toBe(edit);
    expect(useDesignStore.getState().design).toBe(design);
    expect(usePreviewLoftStatusStore.getState()).toBe(loft);
});

test("Design retains geometry editing targets; Print and Export exclude them", async () => {
    await act(async () => root.render(createElement(Viewer3D)));
    for (const step of ["elements", "print", "export", "elements"] as const) {
        await act(async () => useClinicalWorkflowStore.getState().setStep(step));
        expect(container.querySelectorAll("[data-edit-target]").length).toBe(step === "elements" ? 3 : 0);
        const labels = [...container.querySelectorAll("button")].map((button) => button.textContent?.trim());
        expect(labels).not.toContain("Edit trimline");
        expect(labels).not.toContain("Edit bottom pattern");
        expect(labels).not.toContain("Trim");
        expect(labels).not.toContain("Vertex");
        expect(container.querySelector("[data-testid=outline-edit-toolbar]")).toBeNull();
    }
});

function buttonLabels(): string[] {
    return [...container.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
}

test("outline toolbar stays hidden until edit mode, then Done commits and Cancel discards", async () => {
    await act(async () => root.render(createElement(Viewer3D)));
    expect(container.querySelector("[data-testid=outline-edit-toolbar]")).toBeNull();
    expect(buttonLabels()).not.toContain("Trim");
    expect(buttonLabels()).not.toContain("Vertex");

    const before = JSON.stringify(useDesignStore.getState().design.trimlines ?? null);
    await act(async () => useMeshEditStore.getState().beginTrimlineEdit("left"));
    const bar = container.querySelector("[data-testid=outline-edit-toolbar]");
    expect(bar?.getAttribute("aria-label")).toBe("Edit trimline");
    expect(bar?.className).toContain("inset-x-0");
    expect(bar?.className).toContain("top-0");
    expect(bar?.textContent).toContain("Edit trimline");
    expect(bar?.textContent).not.toContain("Edit bottom pattern");
    const done = [...(bar?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Done");
    const cancel = [...(bar?.querySelectorAll("button") ?? [])].find(
        (button) => button.textContent === "Cancel",
    );
    expect(done).toBeTruthy();
    expect(cancel).toBeTruthy();
    expect(done?.className).toContain("bg-primary");
    expect(bar?.textContent?.indexOf("Cancel")).toBeLessThan(bar?.textContent?.indexOf("Done") ?? -1);

    await act(async () => {
        useMeshEditStore
            .getState()
            .setTrimlineDraft([
                new THREE.Vector3(1, 2, 0),
                new THREE.Vector3(8, 2, 0),
                new THREE.Vector3(8, 9, 0),
            ]);
    });
    await act(async () => cancel?.click());
    expect(useMeshEditStore.getState().trimlineEdit).toBeNull();
    expect(useMeshEditStore.getState().editMode).toBe("transform");
    expect(JSON.stringify(useDesignStore.getState().design.trimlines ?? null)).toBe(before);
    expect(container.querySelector("[data-testid=outline-edit-toolbar]")).toBeNull();

    await act(async () => useMeshEditStore.getState().beginTrimlineEdit("left"));
    await act(async () => {
        useMeshEditStore
            .getState()
            .setTrimlineDraft([
                new THREE.Vector3(4, 1, 0),
                new THREE.Vector3(12, 1, 0),
                new THREE.Vector3(12, 6, 0),
                new THREE.Vector3(4, 6, 0),
            ]);
    });
    const doneAgain = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Done",
    );
    await act(async () => doneAgain?.click());
    expect(useMeshEditStore.getState().trimlineEdit).toBeNull();
    expect(useDesignStore.getState().design.trimlines?.left).toEqual([
        { x: 4, y: 1, z: 0 },
        { x: 12, y: 1, z: 0 },
        { x: 12, y: 6, z: 0 },
        { x: 4, y: 6, z: 0 },
    ]);
    expect(container.querySelector("[data-testid=outline-edit-toolbar]")).toBeNull();
});

test("bottom-pattern edit docks only that tool", async () => {
    await act(async () => root.render(createElement(Viewer3D)));
    await act(async () => useMeshEditStore.getState().beginBottomPatternEdit("right"));
    const bar = container.querySelector("[data-testid=outline-edit-toolbar]");
    expect(bar?.getAttribute("aria-label")).toBe("Edit bottom pattern");
    expect(bar?.textContent).toContain("Edit bottom pattern");
    expect(bar?.textContent).not.toContain("Edit trimline");
    expect(buttonLabels()).not.toContain("Trim");
    expect(buttonLabels()).not.toContain("Vertex");
    const beforeTrim = useDesignStore.getState().design.trimlines;
    await act(async () => {
        useMeshEditStore
            .getState()
            .setBottomPatternDraft([
                new THREE.Vector3(1, 1, 0),
                new THREE.Vector3(7, 1, 0),
                new THREE.Vector3(7, 4, 0),
            ]);
    });
    const done = [...container.querySelectorAll("button")].find((button) => button.textContent === "Done");
    await act(async () => done?.click());
    expect(useMeshEditStore.getState().bottomPatternEdit).toBeNull();
    expect(useBottomPatternStore.getState().getPattern("right")?.points).toHaveLength(3);
    expect(useDesignStore.getState().design.trimlines).toBe(beforeTrim);
    expect(container.querySelector("[data-testid=outline-edit-toolbar]")).toBeNull();
    useBottomPatternStore.getState().clear();
});

test("selected element tools keep move rotate and scale and omit Trim and Vertex", async () => {
    await act(async () => root.render(createElement(Viewer3D)));
    await act(async () => {
        useClinicalWorkflowStore.getState().setStep("elements");
        useDesignStore.getState().selectElement("placed-pad");
    });
    expect(buttonLabels()).toContain("Move");
    expect(buttonLabels()).toContain("Rotate");
    expect(buttonLabels()).toContain("Scale");
    expect(buttonLabels()).not.toContain("Trim");
    expect(buttonLabels()).not.toContain("Vertex");
});
