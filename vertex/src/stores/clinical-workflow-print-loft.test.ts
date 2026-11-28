// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { BufferGeometry } from "three";
import {
    peekManufacturingSolid,
    rememberManufacturingSolid,
    resetManufacturingSolidCache,
} from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { useClinicalWorkflowStore } from "./clinical-workflow-store";
import { usePreviewLoftStatusStore } from "./preview-loft-status-store";

beforeEach(() => {
    useClinicalWorkflowStore.setState({ step: "elements" });
    usePreviewLoftStatusStore.getState().reset();
    resetManufacturingSolidCache();
});

describe("clinical workflow print loft invalidation", () => {
    test("Print → Corrections → Print resets the splash and keeps the epoch bump off the solid", () => {
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

    test("Print → Export and Print → Corrections keep the cached solid", () => {
        const geo = new BufferGeometry();
        geo.userData = { mark: "print-solid" };
        rememberManufacturingSolid("print-solid", "left", geo);
        useClinicalWorkflowStore.setState({ step: "print" });
        usePreviewLoftStatusStore.setState({
            phaseBySide: { left: "ready", right: "ready" },
            printLoftEpoch: 5,
        });

        useClinicalWorkflowStore.getState().setStep("export");
        expect(usePreviewLoftStatusStore.getState().printLoftEpoch).toBe(5);
        expect(usePreviewLoftStatusStore.getState().phaseBySide).toEqual({ left: "ready", right: "ready" });
        expect(peekManufacturingSolid("print-solid", "left")?.userData.mark).toBe("print-solid");

        useClinicalWorkflowStore.setState({ step: "print" });
        useClinicalWorkflowStore.getState().goNext();
        expect(useClinicalWorkflowStore.getState().step).toBe("export");
        expect(usePreviewLoftStatusStore.getState().printLoftEpoch).toBe(5);
        expect(peekManufacturingSolid("print-solid", "left")?.userData.mark).toBe("print-solid");

        useClinicalWorkflowStore.getState().setStep("corrections");
        expect(usePreviewLoftStatusStore.getState().printLoftEpoch).toBe(6);
        expect(peekManufacturingSolid("print-solid", "left")?.userData.mark).toBe("print-solid");
        geo.dispose();
    });
});
