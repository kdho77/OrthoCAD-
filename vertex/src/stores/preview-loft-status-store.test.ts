// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { retryPreviewLoft, usePreviewLoftStatusStore } from "./preview-loft-status-store";

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
});
