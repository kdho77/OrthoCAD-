// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import { describe, expect, test } from "@rstest/core";
import { cancelPreviewLoft, retryPreviewLoft, usePreviewLoftStatusStore } from "./preview-loft-status-store";

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
