// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import * as React from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClinicalStepFooter, ClinicalStepRail } from "@/components/clinical/ClinicalStepRail";
import { AFO_PRINT_TRIM_REASON } from "@/lib/clinical/clinical-step-gates";
import { defaultAfoDesignState } from "@/lib/geometry/afo/defaults";
import { patchAfoState } from "@/stores/afo-store";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { defaultDesign, useDesignStore } from "@/stores/design-store";

(globalThis as typeof globalThis & { React: typeof React }).React = React;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function loadAfo(trimConfirmed: boolean) {
    useDesignStore.setState({
        design: {
            ...defaultDesign(),
            productType: "afo",
            method: "printing_shell",
            afo: {
                ...defaultAfoDesignState("right"),
                trimClosed: trimConfirmed,
                trimConfirmed,
            },
        },
    });
    useClinicalWorkflowStore.setState({
        productType: "afo",
        step: "design",
        completedSteps: ["scan", "cast", "corrections"],
        footSideExplicitlyChosen: true,
        designStartPath: null,
        scanGateStickyReason: null,
        nextBlockReason: null,
    });
}

beforeEach(() => {
    loadAfo(false);
});

afterEach(() => {
    useClinicalWorkflowStore.setState({
        productType: "insole",
        step: "scan",
        completedSteps: [],
        footSideExplicitlyChosen: false,
        scanGateStickyReason: null,
        nextBlockReason: null,
        designStartPath: null,
    });
});

describe("AFO Print stays closed without a confirmed trim", () => {
    test("setStep, Next, and Back cannot open Print or Export", () => {
        const store = useClinicalWorkflowStore.getState();
        store.setStep("print");
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(useClinicalWorkflowStore.getState().nextBlockReason).toBe(AFO_PRINT_TRIM_REASON);

        useClinicalWorkflowStore.setState({ step: "scan", nextBlockReason: null });
        useClinicalWorkflowStore.getState().setStep("print");
        expect(useClinicalWorkflowStore.getState().step).toBe("scan");

        useClinicalWorkflowStore.setState({ step: "cast", nextBlockReason: null });
        useClinicalWorkflowStore.getState().setStep("export");
        expect(useClinicalWorkflowStore.getState().step).toBe("cast");
        expect(useClinicalWorkflowStore.getState().step).not.toBe("print");

        useClinicalWorkflowStore.setState({ step: "design", nextBlockReason: null });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(useClinicalWorkflowStore.getState().step).not.toBe("print");
        expect(useClinicalWorkflowStore.getState().completedSteps).not.toContain("design");
    });

    test("a saved Print or Export step reloads onto Design", () => {
        useClinicalWorkflowStore.getState().setProductType("afo");
        useClinicalWorkflowStore.setState({
            step: "print",
            completedSteps: ["scan", "cast", "corrections", "design"],
            footSideExplicitlyChosen: true,
            designStartPath: null,
            scanGateStickyReason: null,
            nextBlockReason: null,
        });
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(useClinicalWorkflowStore.getState().step).not.toBe("print");
        expect(useClinicalWorkflowStore.getState().nextBlockReason).toBe(AFO_PRINT_TRIM_REASON);

        useClinicalWorkflowStore.setState({ step: "export", nextBlockReason: null });
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(useClinicalWorkflowStore.getState().step).not.toBe("export");
    });

    test("clearing trimConfirmed from Print or Export returns to Design", () => {
        loadAfo(true);
        useClinicalWorkflowStore.getState().setStep("print");
        expect(useClinicalWorkflowStore.getState().step).toBe("print");
        patchAfoState({ trimClosed: false, trimConfirmed: false }, "afo-trim-point");
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(useClinicalWorkflowStore.getState().step).not.toBe("print");

        loadAfo(true);
        useClinicalWorkflowStore.getState().setStep("export");
        expect(useClinicalWorkflowStore.getState().step).toBe("export");
        patchAfoState({ trimConfirmed: false }, "afo-trim-spline");
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(useClinicalWorkflowStore.getState().step).not.toBe("print");

        loadAfo(true);
        useClinicalWorkflowStore.getState().setStep("export");
        useClinicalWorkflowStore.getState().goBack();
        expect(useClinicalWorkflowStore.getState().step).toBe("print");
    });

    test("a confirmed trim can open Print, and insole Print is unchanged", () => {
        loadAfo(true);
        useClinicalWorkflowStore.getState().setStep("print");
        expect(useClinicalWorkflowStore.getState().step).toBe("print");
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("export");

        useClinicalWorkflowStore.setState({
            productType: "insole",
            step: "elements",
            nextBlockReason: null,
        });
        useClinicalWorkflowStore.getState().setStep("print");
        expect(useClinicalWorkflowStore.getState().step).toBe("print");
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("export");
    });

    test("the step pill and the Next button stay off Print", async () => {
        const container = document.createElement("div");
        document.body.appendChild(container);
        let root: Root | null = null;
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ClinicalStepRail));
        });
        const print = container.querySelector('[data-testid="clinical-step-print"]');
        const exportStep = container.querySelector('[data-testid="clinical-step-export"]');
        expect(print).toBeTruthy();
        await act(async () => {
            print?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(container.textContent).toContain(AFO_PRINT_TRIM_REASON);
        await act(async () => {
            exportStep?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(useClinicalWorkflowStore.getState().step).not.toBe("print");
        expect(useClinicalWorkflowStore.getState().step).not.toBe("export");
        await act(async () => {
            root?.unmount();
        });

        useClinicalWorkflowStore.setState({ step: "design", nextBlockReason: null });
        await act(async () => {
            root = createRoot(container);
            root.render(createElement(ClinicalStepFooter));
        });
        const next = [...container.querySelectorAll("button")].find(
            (button) => button.textContent === "Next",
        );
        expect(next).toBeTruthy();
        await act(async () => {
            next?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
        expect(useClinicalWorkflowStore.getState().step).toBe("design");
        expect(container.textContent).toContain(AFO_PRINT_TRIM_REASON);
        await act(async () => {
            root?.unmount();
        });
        container.remove();
    });
});
