// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PrintingPanel } from "@/features/exports/PrintingPanel";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import type { ProductionMethod } from "@/types";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setMethod(method: ProductionMethod) {
    useDesignStore.setState({
        design: { ...useDesignStore.getState().design, method },
    });
}

describe("Print tab machine scope", () => {
    let container: HTMLDivElement;
    let root: Root;
    const machine = useMillingProfileStore.getState().machine;
    const method = useDesignStore.getState().design.method;

    beforeEach(() => {
        useMillingProfileStore.setState({ machine: "cnc" });
        container = document.createElement("div");
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        useMillingProfileStore.setState({ machine });
        setMethod(method);
    });

    test("a 3D-print design does not show the 3-axis CNC control", async () => {
        for (const methodId of ["printing_solid", "printing_shell"] as const) {
            setMethod(methodId);
            await act(async () =>
                root.render(createElement(PrintingPanel, { clinicalMode: true, primaryOnly: true })),
            );
            const text = container.textContent ?? "";
            expect(text).toContain("3D printer");
            expect(text).not.toContain("3-axis CNC");
            expect(text).not.toContain("Milling table");
            expect(container.querySelector("[data-testid=print-machine] button")).toBeNull();
        }
    });

    test("a CNC design shows no printer controls", async () => {
        setMethod("milling_3axis");
        useMillingProfileStore.setState({ machine: "printer" });
        await act(async () => root.render(createElement(PrintingPanel)));
        const text = container.textContent ?? "";
        expect(text).toContain("3-axis CNC");
        expect(text).toContain("Milling table");
        expect(text).not.toContain("3D printer");
        expect(text).not.toContain("Layer height");
        expect(text).not.toContain("Printer preset");
        expect(text).not.toContain("Generate toolpath");
        expect(text).not.toContain("Prepare for print");
        expect(text).not.toContain("Infill");
    });
});
