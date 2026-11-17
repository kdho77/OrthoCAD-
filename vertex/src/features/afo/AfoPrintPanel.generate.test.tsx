// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AfoPrintPanel } from "@/features/afo/AfoPrintPanel";
import { nearestVertex } from "@/lib/geometry/afo/mesh-ops";
import type { AfoTriMesh, AfoVec3 } from "@/lib/geometry/afo/types";
import { getAfoState, setProductType, useAfoStore } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { defaultDesign, useDesignStore } from "@/stores/design-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shellMesh: AfoTriMesh = {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
};

let releaseShell: (mesh: AfoTriMesh) => void = () => undefined;
const runAfoShell = rs.fn();

rs.mock("@/lib/geometry/afo/afo-engine", () => ({
    runAfoShell: (...args: unknown[]) => runAfoShell(...args),
}));

function plane(min: number, max: number, cells: number): AfoTriMesh {
    const positions: number[] = [];
    const indices: number[] = [];
    const row = cells + 1;
    for (let iy = 0; iy <= cells; iy++) {
        for (let ix = 0; ix <= cells; ix++) {
            positions.push(min + ((max - min) * ix) / cells, min + ((max - min) * iy) / cells, 0);
        }
    }
    for (let iy = 0; iy < cells; iy++) {
        for (let ix = 0; ix < cells; ix++) {
            const i = iy * row + ix;
            indices.push(i, i + 1, i + row, i + 1, i + row + 1, i + row);
        }
    }
    return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

function pin(mesh: AfoTriMesh, point: AfoVec3) {
    return { point, vertexIndex: nearestVertex(mesh, point).index };
}

function button(container: HTMLElement, testId: string): HTMLButtonElement {
    const found = container.querySelector(`[data-testid="${testId}"]`);
    if (!(found instanceof HTMLButtonElement)) throw new Error(`missing ${testId}`);
    return found;
}

function click(el: Element) {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeEach(() => {
    releaseShell = () => undefined;
    runAfoShell.mockReset();
    runAfoShell.mockImplementation((...args: unknown[]) => {
        const options = args[2] as { onProgress?: (pct: number, stage: string) => void } | undefined;
        options?.onProgress?.(0.45, "shell");
        return new Promise<AfoTriMesh>((resolve) => {
            releaseShell = resolve;
        });
    });
    useAfoStore.getState().resetSession();
    useDesignStore.setState({ design: defaultDesign() });
    setProductType("afo", "right");
    useClinicalWorkflowStore.setState({
        productType: "afo",
        step: "design",
        footSideExplicitlyChosen: true,
        nextBlockReason: null,
        scanGateStickyReason: null,
        completedSteps: [],
    });
});

afterEach(() => {
    releaseShell(shellMesh);
    useClinicalWorkflowStore.setState({
        productType: "insole",
        step: "scan",
        nextBlockReason: null,
        footSideExplicitlyChosen: false,
    });
});

describe("Generate shell", () => {
    test("an unconfirmed trim offers Close and confirm, and that generates the shell", async () => {
        const mesh = plane(-40, 40, 6);
        const points = [
            { x: -15, y: -15, z: 0 },
            { x: 15, y: -15, z: 0 },
            { x: 15, y: 15, z: 0 },
            { x: -15, y: 15, z: 0 },
        ];
        const afo = getAfoState();
        useAfoStore.getState().setCastMesh(mesh);
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                afo: {
                    ...afo,
                    trimPoints: points.map((point) => pin(mesh, point)),
                    trimCurve: [],
                    trimClosed: false,
                    trimConfirmed: false,
                    scanWorkflow: {
                        ...afo.scanWorkflow,
                        plantar: {
                            heel: { x: -10, y: 0, z: 0 },
                            m1p: { x: 20, y: -12, z: 0 },
                            m5p: { x: 20, y: 12, z: 0 },
                        },
                    },
                },
            },
        });
        expect(getAfoState().trimConfirmed).toBe(false);

        const container = document.createElement("div");
        document.body.appendChild(container);
        let root: Root | null = null;
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(AfoPrintPanel));
        });

        await act(async () => {
            click(button(container, "afo-generate-shell"));
        });
        const fix = button(container, "afo-shell-fix-action");
        expect(fix.textContent).toBe("Close and confirm trim");
        expect(container.textContent).toContain("Use the button below to continue.");
        expect(runAfoShell).not.toHaveBeenCalled();

        await act(async () => {
            click(fix);
        });
        expect(getAfoState().trimConfirmed).toBe(true);
        expect(getAfoState().trimClosed).toBe(true);
        expect(container.textContent).toContain("Generating shell");
        expect(container.querySelector('[data-testid="afo-shell-progress"]')).toBeTruthy();
        expect(runAfoShell).toHaveBeenCalledTimes(1);

        await act(async () => {
            releaseShell(shellMesh);
        });
        expect(container.textContent).toContain("Watertight shell ready");
        expect(useAfoStore.getState().shellMesh).toBeTruthy();

        await act(async () => {
            root?.unmount();
        });
        container.remove();
    });

    test("a trim that cannot close sends the user to Design", async () => {
        const mesh = plane(-40, 40, 4);
        const afo = getAfoState();
        useAfoStore.getState().setCastMesh(mesh);
        useClinicalWorkflowStore.setState({ step: "cast" });
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                afo: {
                    ...afo,
                    trimPoints: [pin(mesh, { x: 0, y: 0, z: 0 })],
                    trimClosed: false,
                    trimConfirmed: false,
                },
            },
        });
        const container = document.createElement("div");
        document.body.appendChild(container);
        let root: Root | null = null;
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(AfoPrintPanel));
        });
        await act(async () => {
            click(button(container, "afo-generate-shell"));
        });
        const fix = button(container, "afo-shell-fix-action");
        expect(fix.textContent).toBe("Go to Design to fix trim");
        await act(async () => {
            click(fix);
        });
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(runAfoShell).not.toHaveBeenCalled();
        await act(async () => {
            root?.unmount();
        });
        container.remove();
    });

    test("missing plantar markers offer a jump to Scan", async () => {
        const mesh = plane(-40, 40, 4);
        const afo = getAfoState();
        useAfoStore.getState().setCastMesh(mesh);
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                afo: {
                    ...afo,
                    trimClosed: true,
                    trimConfirmed: true,
                    scanWorkflow: { ...afo.scanWorkflow, plantar: {} },
                },
            },
        });
        useClinicalWorkflowStore.setState({ step: "print" });
        expect(useClinicalWorkflowStore.getState().step).toBe("print");
        const container = document.createElement("div");
        document.body.appendChild(container);
        let root: Root | null = null;
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(AfoPrintPanel));
        });
        await act(async () => {
            click(button(container, "afo-generate-shell"));
        });
        const fix = button(container, "afo-shell-fix-action");
        expect(fix.textContent).toBe("Go to Scan to place markers");
        expect(container.textContent).toMatch(/plantar heel, 1st met head, and 5th met head/);
        await act(async () => {
            click(fix);
        });
        expect(useClinicalWorkflowStore.getState().step).toBe("scan");
        expect(runAfoShell).not.toHaveBeenCalled();
        await act(async () => {
            root?.unmount();
        });
        container.remove();
    });
});
