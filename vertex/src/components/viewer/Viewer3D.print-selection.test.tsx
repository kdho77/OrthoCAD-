// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, expect, rs, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import { Viewer3D } from "./Viewer3D";

const canvasEvents = rs.hoisted(() => ({ click: () => {}, miss: () => {} }));
rs.mock("@react-three/fiber", () => ({
    Canvas: (props: { children: React.ReactNode; onClick: () => void; onPointerMissed: () => void }) => {
        canvasEvents.click = props.onClick;
        canvasEvents.miss = props.onPointerMissed;
        return props.children;
    },
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
        const hasTrimlineButton = [...container.querySelectorAll("button")].some(
            (button) => button.textContent === "Edit trimline",
        );
        expect(hasTrimlineButton).toBe(step === "elements");
    }
});
