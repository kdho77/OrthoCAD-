// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { beginInsoleDesignSession, type InsoleDesignStartPath } from "@/features/clients/start-path";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useScanStore } from "@/stores/scan-store";
import {
    CLINICAL_STEPS,
    type ClinicalStepId,
    normalizeClinicalStep,
    useClinicalWorkflowStore,
} from "./clinical-workflow-store";

function satisfyScanStepGate(): void {
    useClinicalWorkflowStore.getState().acknowledgeExplicitFootSide("left");
    useDesignStore.setState({
        stockBaseLoading: false,
        stockBaseError: null,
        design: createDesignWithStockPlaceholder(),
    });
    useScanStore.setState({ scans: [] });
}

function stepsAfterLanding(path: InsoleDesignStartPath): ClinicalStepId[] {
    const landing = path === "scan" ? "scan" : "setup";
    const idx = CLINICAL_STEPS.findIndex((s) => s.id === landing);
    return CLINICAL_STEPS.slice(idx).map((s) => s.id);
}

beforeEach(() => {
    useClinicalWorkflowStore.setState({
        step: "scan",
        designStartPath: null,
        completedSteps: [],
        footSideExplicitlyChosen: false,
        scanGateStickyReason: null,
        nextBlockReason: null,
    });
    useDesignStore.setState({
        stockBaseLoading: false,
        stockBaseError: null,
        design: createDesignWithStockPlaceholder(),
    });
    useScanStore.setState({ scans: [] });
});

describe("clinical workflow Next navigation", () => {
    test.each<InsoleDesignStartPath>([
        "scan",
        "template",
        "ai",
    ])("%s workflow: Next advances through each step in order", (path) => {
        beginInsoleDesignSession(path);
        satisfyScanStepGate();
        const expected = stepsAfterLanding(path);

        for (let i = 0; i < expected.length - 1; i++) {
            const before = useClinicalWorkflowStore.getState().step;
            expect(before).toBe(expected[i]);
            useClinicalWorkflowStore.getState().goNext();
            const after = useClinicalWorkflowStore.getState().step;
            expect(after).toBe(expected[i + 1]);
            expect(after).not.toBe("scan");
            if (i > 0) expect(after).not.toBe(before);
        }
        expect(useClinicalWorkflowStore.getState().step).toBe("export");
    });

    test("reopened design (no explicit foot side): Next from a middle step does not return to Scan", () => {
        useClinicalWorkflowStore.setState({
            step: "corrections",
            footSideExplicitlyChosen: false,
            designStartPath: null,
        });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("elements");
    });

    test("Next from Print advances to Export when foot side was never re-acknowledged", () => {
        useClinicalWorkflowStore.setState({
            step: "print",
            footSideExplicitlyChosen: false,
            completedSteps: ["scan", "setup", "base", "corrections", "elements"],
        });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("export");
    });

    test("blocked Next on Scan stays on Scan with a reason", () => {
        useClinicalWorkflowStore.setState({
            step: "scan",
            footSideExplicitlyChosen: false,
        });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("scan");
        expect(useClinicalWorkflowStore.getState().nextBlockReason).toMatch(/Left, Right, or Pair/i);
    });

    test("legacy step ids normalize before advancing", () => {
        satisfyScanStepGate();
        useClinicalWorkflowStore.setState({ step: "shape" as ClinicalStepId });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("corrections");
        expect(normalizeClinicalStep("shape")).toBe("base");

        useClinicalWorkflowStore.setState({ step: "hardness" as ClinicalStepId });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("export");
    });

    test("Next from a middle step preserves design state", () => {
        satisfyScanStepGate();
        const marker = 7.25;
        useClinicalWorkflowStore.setState({ step: "corrections" });
        useDesignStore.setState((s) => ({
            design: {
                ...s.design,
                corrections: {
                    ...s.design.corrections,
                    left: { ...s.design.corrections.left, archEaseMm: marker },
                },
            },
        }));
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("elements");
        expect(useDesignStore.getState().design.corrections.left.archEaseMm).toBe(marker);
    });
});
