// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";
import { ClinicalStepRail } from "./ClinicalStepRail";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    useClinicalWorkflowStore.setState({
        productType: "afo",
        step: "corrections",
        completedSteps: [],
        scanGateStickyReason: null,
        nextBlockReason: null,
        footSideExplicitlyChosen: true,
    });
    useDesignStore.setState({
        design: {
            ...useDesignStore.getInitialState().design,
            productType: "afo",
            method: "printing_shell",
        },
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
});

describe("ClinicalStepRail header layout", () => {
    test("product toggle and workflow steps share one row container", async () => {
        await act(async () => {
            root.render(createElement(ClinicalStepRail, { showProductSwitcher: true }));
        });

        const row = container.querySelector('[data-testid="design-workflow-header-row"]');
        if (!row) throw new Error("design-workflow-header-row missing");

        const switcher = row.querySelector('[data-testid="product-type-switcher"]');
        if (!switcher) throw new Error("product-type-switcher missing");
        expect(switcher.textContent).toContain("Product");
        expect(switcher.textContent).toContain("Insole");
        expect(switcher.textContent).toContain("AFO");

        const nav = row.querySelector('nav[aria-label="Clinical workflow"]');
        if (!nav) throw new Error("clinical workflow nav missing");
        expect(nav.parentElement).toBe(row);

        expect(container.querySelectorAll('[data-testid="design-workflow-header"]').length).toBe(1);
    });

    test("insole-only header is a single row of steps without the product switcher", async () => {
        useClinicalWorkflowStore.setState({ productType: "insole", step: "scan" });
        await act(async () => {
            root.render(createElement(ClinicalStepRail, { showProductSwitcher: false }));
        });

        const row = container.querySelector('[data-testid="design-workflow-header-row"]');
        if (!row) throw new Error("design-workflow-header-row missing");
        expect(row.querySelector('[data-testid="product-type-switcher"]')).toBeNull();
        expect(row.querySelector('nav[aria-label="Clinical workflow"]')).not.toBeNull();
    });
});
