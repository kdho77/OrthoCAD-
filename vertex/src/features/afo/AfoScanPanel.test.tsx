// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as THREE from "three";
import { evaluateScanStepGate } from "@/lib/clinical/clinical-step-gates";
import { setProductType, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";
import type { Side } from "@/types";
import { AfoScanPanel } from "./AfoScanPanel";
import {
    activeMarkerPlacementLayer,
    applyAfoAlignment,
    commitAfoScanPoint,
    markerPlaceControl,
    undoAfoMarker,
} from "./afo-scan-markers";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MANIFOLD = {
    isWatertight: true,
    openEdges: 0,
    triangleCount: 12,
    vertexCount: 8,
    nonManifoldEdges: 0,
};

const HEEL = { x: 0, y: 0, z: 0 };
const M1P = { x: 120, y: -40, z: 0 };
const M5P = { x: 100, y: 35, z: 0 };

function addBox(id: string, side: Side, size: [number, number, number] = [80, 220, 60]) {
    useScanStore.getState().addScan({
        id,
        name: `${id}.stl`,
        side,
        format: "stl",
        triangleCount: 12,
        geometry: new THREE.BoxGeometry(...size),
        manifold: MANIFOLD,
    });
}

function buttonByText(container: HTMLElement, label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
    if (!found) throw new Error(`missing button ${label}`);
    return found as HTMLButtonElement;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    useScanStore.getState().clear();
    useScanStore.setState({ landmarkSourceAssetId: null });
    useAfoStore.getState().resetSession();
    useClinicalWorkflowStore.setState({
        productType: "insole",
        step: "scan",
        footSideExplicitlyChosen: false,
        elementPlacementFoot: "both",
        completedSteps: [],
        scanGateStickyReason: null,
        nextBlockReason: null,
    });
    useDesignStore.setState({
        design: { ...useDesignStore.getInitialState().design, productType: "insole", afo: undefined },
        history: [],
        future: [],
        stockBaseLoading: false,
        stockBaseError: null,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useScanStore.getState().clear();
    useAfoStore.getState().resetSession();
    useClinicalWorkflowStore.setState({ productType: "insole", footSideExplicitlyChosen: false });
    useDesignStore.setState({
        design: { ...useDesignStore.getInitialState().design, productType: "insole" },
    });
});

async function renderPanel() {
    await act(async () => root.render(createElement(AfoScanPanel)));
}

function armAfo(side: Side | "both" = "left") {
    useClinicalWorkflowStore.getState().setProductType("afo");
    setProductType("afo", side === "both" ? "left" : side);
    if (side === "both") useClinicalWorkflowStore.getState().acknowledgePairAssignment();
    else useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide(side);
}

describe("AFO scan marker placement", () => {
    test("alignment enables without an insole base, then Stage 2 gates Next", async () => {
        armAfo("left");
        addBox("leg", "left");
        await renderPanel();

        const place = buttonByText(container, "Place alignment");
        const apply = buttonByText(container, "Apply alignment");
        expect(place.disabled).toBe(false);
        expect(apply.disabled).toBe(true);
        expect(container.textContent).toMatch(/Step 1 of 2: Align/);
        expect(container.textContent).toMatch(/Next: Plantar heel center/);
        expect(evaluateScanStepGate().ok).toBe(false);

        await act(async () => {
            commitAfoScanPoint(HEEL, "leg", 1);
            commitAfoScanPoint(M1P, "leg", 1);
            commitAfoScanPoint(M5P, "leg", 1);
        });
        expect(buttonByText(container, "Apply alignment").disabled).toBe(false);

        await act(async () => {
            buttonByText(container, "Apply alignment").click();
        });
        expect(useAfoStore.getState().sourceMesh?.positions.length ?? 0).toBeGreaterThan(0);
        expect(container.textContent).toMatch(/Step 2 of 2: Landmarks 0\/8/);
        expect(container.textContent).toMatch(/Next: Posterior calcaneus center/);
        expect(evaluateScanStepGate().ok).toBe(false);

        const landmarks = [
            { x: -4, y: 0, z: 12 },
            { x: 110, y: -30, z: 8 },
            { x: 100, y: 28, z: 8 },
            { x: 70, y: -18, z: 22 },
            { x: 55, y: 22, z: 18 },
            { x: 30, y: -16, z: 80 },
            { x: 18, y: 14, z: 70 },
            { x: 8, y: 24, z: 210 },
        ];
        await act(async () => {
            for (const point of landmarks) commitAfoScanPoint(point, "leg", 1);
        });
        expect(container.textContent).toMatch(/Step 2 of 2: Landmarks 8\/8/);
        expect(evaluateScanStepGate().ok).toBe(true);
        const workflow = useDesignStore.getState().design.afo?.scanWorkflow;
        expect(workflow?.landmarks.medial_malleolus).toBeTruthy();
        expect(workflow?.landmarks.fibular_head).toBeTruthy();
        expect(workflow?.derived?.plannedReliefsMm).toEqual({ malleoli: -3, navicular: -2, styloid: -2 });
    });

    test("left, right, and both keep Place alignment enabled", async () => {
        armAfo("left");
        addBox("L", "left");
        addBox("R", "right");
        await renderPanel();
        expect(buttonByText(container, "Place alignment").disabled).toBe(false);

        await act(async () => {
            useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide("right");
        });
        expect(buttonByText(container, "Place alignment").disabled).toBe(false);

        await act(async () => {
            useClinicalWorkflowStore.getState().acknowledgePairAssignment();
        });
        expect(buttonByText(container, "Place alignment").disabled).toBe(false);
    });

    test("insole Place markers stays disabled until the landmark base is loaded", async () => {
        useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide("left");
        addBox("insole-scan", "left");
        useScanStore.setState({ landmarkSourceAssetId: null });
        await renderPanel();
        const place = buttonByText(container, "Place markers");
        expect(place.disabled).toBe(true);
        expect(place.getAttribute("title")).toBe("Base geometry not loaded");

        await act(async () => {
            useScanStore.setState({ landmarkSourceAssetId: "stock-base" });
        });
        expect(buttonByText(container, "Place markers").disabled).toBe(false);
    });
});

describe("AFO marker placement helpers", () => {
    test("enable path does not wait on the insole base, and AFO clicks hit the scan while placing", () => {
        expect(markerPlaceControl({ isAfo: true, hasLandmarkBase: false })).toEqual({
            enabled: true,
            blockedTitle: null,
        });
        expect(markerPlaceControl({ isAfo: false, hasLandmarkBase: false })).toEqual({
            enabled: false,
            blockedTitle: "Base geometry not loaded",
        });
        expect(markerPlaceControl({ isAfo: false, hasLandmarkBase: true }).enabled).toBe(true);
        expect(activeMarkerPlacementLayer(true, false)).toBe("afo-design");
        expect(activeMarkerPlacementLayer(true, false, true)).toBe("afo-scan");
        expect(activeMarkerPlacementLayer(true, true)).toBe("scan");
        expect(activeMarkerPlacementLayer(false, false)).toBe("scan");
    });

    test("the next click fills the first missing landmark after an undo", () => {
        armAfo("left");
        addBox("leg", "left");
        commitAfoScanPoint(HEEL, "leg", 1);
        commitAfoScanPoint(M1P, "leg", 1);
        commitAfoScanPoint(M5P, "leg", 1);
        applyAfoAlignment(false);
        expect(commitAfoScanPoint({ x: -4, y: 0, z: 12 }, "leg", 1)).toBeNull();
        expect(commitAfoScanPoint({ x: 110, y: -20, z: 8 }, "leg", 1)).toBeNull();
        undoAfoMarker("posterior_calcaneus");
        expect(commitAfoScanPoint({ x: -2, y: 1, z: 14 }, "leg", 1)).toBeNull();
        const workflow = useDesignStore.getState().design.afo?.scanWorkflow;
        expect(workflow?.landmarks.posterior_calcaneus?.x).toBe(-2);
        expect(workflow?.landmarks.m1_mpj).toBeTruthy();
        expect(workflow?.landmarks.m5_mpj).toBeFalsy();
    });
});
