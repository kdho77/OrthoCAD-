// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import {
    applyViewerDefaultsForClinicalStep,
    defaultHeightmapForClinicalStep,
} from "@/components/viewer/viewer-tab-defaults";
import { useClinicalWorkflowStore } from "@/stores/clinical-workflow-store";
import { useDesignStore } from "@/stores/design-store";

beforeEach(() => {
    useClinicalWorkflowStore.setState({ step: "scan", productType: "insole" });
    useDesignStore.getState().setViewer({ heightmap: false });
});

describe("per-tab default viewport heightmap", () => {
    test("design tabs default to heatmap", () => {
        for (const step of ["scan", "setup", "base", "corrections", "elements"] as const) {
            expect(defaultHeightmapForClinicalStep(step)).toBe(true);
        }
    });

    test("Print and Export default to solid", () => {
        expect(defaultHeightmapForClinicalStep("print")).toBe(false);
        expect(defaultHeightmapForClinicalStep("export")).toBe(false);
    });

    test("setStep applies defaults but manual toggle is preserved until the next tab change", () => {
        useClinicalWorkflowStore.getState().setStep("corrections");
        expect(useDesignStore.getState().viewer.heightmap).toBe(true);

        useDesignStore.getState().setViewer({ heightmap: false });
        expect(useDesignStore.getState().viewer.heightmap).toBe(false);

        useClinicalWorkflowStore.getState().setStep("elements");
        expect(useDesignStore.getState().viewer.heightmap).toBe(true);

        useClinicalWorkflowStore.getState().setStep("print");
        expect(useDesignStore.getState().viewer.heightmap).toBe(false);

        useDesignStore.getState().setViewer({ heightmap: true });
        useClinicalWorkflowStore.getState().setStep("export");
        expect(useDesignStore.getState().viewer.heightmap).toBe(false);
    });

    test("goNext and goBack apply defaults", () => {
        useClinicalWorkflowStore.setState({
            step: "elements",
            completedSteps: ["scan", "setup", "base", "corrections"],
        });
        useDesignStore.getState().setViewer({ heightmap: false });

        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("print");
        expect(useDesignStore.getState().viewer.heightmap).toBe(false);

        useClinicalWorkflowStore.getState().goBack();
        expect(useClinicalWorkflowStore.getState().step).toBe("elements");
        expect(useDesignStore.getState().viewer.heightmap).toBe(true);
    });

    test("applyViewerDefaultsForClinicalStep is idempotent for print", () => {
        applyViewerDefaultsForClinicalStep("print");
        expect(useDesignStore.getState().viewer.heightmap).toBe(false);
    });
});
