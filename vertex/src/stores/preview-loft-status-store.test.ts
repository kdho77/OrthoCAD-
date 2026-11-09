// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    cancelPreviewLoft,
    invalidateProceduralPrintLoftForDesignStep,
    retryPreviewLoft,
    usePreviewLoftStatusStore,
} from "./preview-loft-status-store";

describe("preview loft status", () => {
    test("retry clears the error and bumps the nonce so hooks reload", () => {
        usePreviewLoftStatusStore.getState().reset();
        usePreviewLoftStatusStore
            .getState()
            .setError("left", "SAMPLE_Top.glb missing at /Templates/SAMPLE_Top.glb");
        const before = usePreviewLoftStatusStore.getState().retryNonce;
        retryPreviewLoft();
        const state = usePreviewLoftStatusStore.getState();
        expect(state.error).toBeNull();
        expect(state.phaseBySide.left).toBe("idle");
        expect(state.retryNonce).toBe(before + 1);
        usePreviewLoftStatusStore.getState().reset();
    });

    test("invalidateProceduralPrintLoftForDesignStep bumps printLoftEpoch and clears ready phases", () => {
        usePreviewLoftStatusStore.getState().reset();
        usePreviewLoftStatusStore.setState({
            phaseBySide: { left: "ready", right: "ready" },
            printLoftEpoch: 4,
        });
        invalidateProceduralPrintLoftForDesignStep();
        const state = usePreviewLoftStatusStore.getState();
        expect(state.printLoftEpoch).toBe(5);
        expect(state.phaseBySide).toEqual({ left: "idle", right: "idle" });
        usePreviewLoftStatusStore.getState().reset();
    });

    test("cancel marks cancelled so generate does not auto-restart", () => {
        usePreviewLoftStatusStore.getState().reset();
        usePreviewLoftStatusStore.getState().setSidePhase("left", "lofting", "Building left walls…");
        cancelPreviewLoft();
        const state = usePreviewLoftStatusStore.getState();
        expect(state.cancelled).toBe(true);
        expect(state.phaseBySide.left).toBe("idle");
        expect(state.message).toMatch(/cancelled/i);
        retryPreviewLoft();
        expect(usePreviewLoftStatusStore.getState().cancelled).toBe(false);
        usePreviewLoftStatusStore.getState().reset();
    });
});
