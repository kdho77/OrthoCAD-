// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { useClinicalWorkflowStore } from "./clinical-workflow-store";
import { usePreviewLoftStatusStore } from "./preview-loft-status-store";

beforeEach(() => {
    useClinicalWorkflowStore.setState({ step: "elements" });
    usePreviewLoftStatusStore.getState().reset();
});

describe("clinical workflow print loft invalidation", () => {
    test("Print → Corrections → Print bumps printLoftEpoch so walls must rebuild", () => {
        useClinicalWorkflowStore.setState({ step: "print" });
        usePreviewLoftStatusStore.setState({
            phaseBySide: { left: "ready", right: "ready" },
            printLoftEpoch: 2,
        });

        useClinicalWorkflowStore.getState().setStep("corrections");
        expect(usePreviewLoftStatusStore.getState().printLoftEpoch).toBe(3);
        expect(usePreviewLoftStatusStore.getState().phaseBySide).toEqual({
            left: "idle",
            right: "idle",
        });

        useClinicalWorkflowStore.getState().setStep("print");
        expect(usePreviewLoftStatusStore.getState().printLoftEpoch).toBe(3);
    });

    test("Print → Export does not invalidate (shared walled solid)", () => {
        useClinicalWorkflowStore.setState({ step: "print" });
        usePreviewLoftStatusStore.setState({ printLoftEpoch: 5 });

        useClinicalWorkflowStore.getState().setStep("export");
        expect(usePreviewLoftStatusStore.getState().printLoftEpoch).toBe(5);
    });
});
