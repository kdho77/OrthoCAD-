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
    afoOrientFromScanMarkers,
    markerPlaceControl,
    scanIdForThreePointOrient,
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
    test("Place markers is enabled without an insole base, then Apply 3-point orient runs", async () => {
        armAfo("left");
        addBox("leg", "left");
        await renderPanel();

        const place = buttonByText(container, "Place markers");
        const apply = buttonByText(container, "Apply 3-point orient");
        expect(place.disabled).toBe(false);
        expect(place.getAttribute("title")).toMatch(/heel, medial malleolus, and lateral malleolus/);
        expect(apply.disabled).toBe(true);
        expect(container.textContent).toMatch(/Place the 3-point orient/);

        await act(async () => {
            useScanStore.getState().enterPlacement("leg");
            useScanStore.getState().setMarker("leg", "M1", new THREE.Vector3(0, 0, 0));
            useScanStore.getState().setMarker("leg", "M2", new THREE.Vector3(30, 40, 70));
            useScanStore.getState().setMarker("leg", "M3", new THREE.Vector3(-30, 40, 70));
        });

        expect(useScanStore.getState().placementMode).toBeNull();
        expect(useScanStore.getState().markersByScanId.leg?.ARCH).toBeNull();
        expect(evaluateScanStepGate().ok).toBe(true);
        expect(buttonByText(container, "Apply 3-point orient").disabled).toBe(false);
        expect(container.textContent).toMatch(/3-point markers placed/);

        await act(async () => {
            buttonByText(container, "Apply 3-point orient").click();
        });
        const mesh = useAfoStore.getState().sourceMesh;
        expect(mesh?.positions.length ?? 0).toBeGreaterThan(0);
    });

    test("left, right, and both keep Place markers enabled", async () => {
        armAfo("left");
        addBox("L", "left");
        addBox("R", "right");
        await renderPanel();
        for (const button of container.querySelectorAll("button")) {
            if (button.textContent?.includes("Place markers")) expect(button.disabled).toBe(false);
        }

        await act(async () => {
            useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide("right");
        });
        for (const button of container.querySelectorAll("button")) {
            if (button.textContent?.includes("Place markers")) expect(button.disabled).toBe(false);
        }

        await act(async () => {
            useClinicalWorkflowStore.getState().acknowledgePairAssignment();
        });
        for (const button of container.querySelectorAll("button")) {
            if (button.textContent?.includes("Place markers")) expect(button.disabled).toBe(false);
        }

        await act(async () => {
            useScanStore.getState().setMarker("R", "M1", new THREE.Vector3(0, 0, 0));
            useScanStore.getState().setMarker("R", "M2", new THREE.Vector3(20, 30, 60));
            useScanStore.getState().setMarker("R", "M3", new THREE.Vector3(-20, 30, 60));
        });
        expect(
            scanIdForThreePointOrient(
                useScanStore.getState().scans,
                useScanStore.getState().markersByScanId,
                "right",
            ),
        ).toBe("R");
        expect(
            scanIdForThreePointOrient(
                useScanStore.getState().scans,
                useScanStore.getState().markersByScanId,
                "both",
            ),
        ).toBe("R");
        expect(buttonByText(container, "Apply 3-point orient").disabled).toBe(false);
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
    test("enable path does not wait on the insole base, and clicks hit the scan while placing", () => {
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
        expect(activeMarkerPlacementLayer(true, true)).toBe("scan");
        expect(activeMarkerPlacementLayer(false, false)).toBe("scan");
    });

    test("metre scans are oriented in millimetres", () => {
        const geometry = new THREE.BoxGeometry(0.2, 0.32, 0.12);
        const result = afoOrientFromScanMarkers(
            geometry,
            {
                M1: { x: 0, y: -0.14, z: 0 },
                M2: { x: 0.04, y: 0.02, z: 0.08 },
                M3: { x: -0.04, y: 0.02, z: 0.08 },
            },
            1000,
        );
        let maxAbs = 0;
        for (const v of result.mesh.positions) maxAbs = Math.max(maxAbs, Math.abs(v));
        expect(maxAbs).toBeGreaterThan(50);
        expect(Number.isFinite(result.residualRmsMm)).toBe(true);
    });
});
