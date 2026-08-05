// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { ensureDefaultStockBaseResolved, useDesignStore } from "@/stores/design-store";
import type { DesignBase, DesignState } from "@/types";

function resolvedStockBase(side: "left" | "right", mirrored = false): DesignBase {
    return {
        assetId: "11111111-1111-4111-8111-111111111111",
        name: `Default Stock Base (${side === "left" ? "Left" : "Right"})`,
        source: "stock",
        glbPath: "Templates/Default.glb",
        url: "https://example.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb",
        primarySide: "left",
        ...(mirrored ? { mirrored: true, mirroredFrom: "11111111-1111-4111-8111-111111111111" } : {}),
    };
}

function resolvedPairedDesign(): DesignState {
    const left = resolvedStockBase("left");
    const right = resolvedStockBase("right", true);
    return {
        pattern: "custom",
        method: "printing_solid",
        thicknessMm: BASE_REFERENCE_THICKNESS_MM,
        corrections: {
            unit: "mm",
            linked: false,
            left: {},
            right: {},
        },
        elements: [],
        base: left,
        customPrefabId: left.assetId,
        customPrefabName: left.name,
        paired: {
            leftBase: left,
            rightBase: right,
            leftThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            rightThicknessMm: BASE_REFERENCE_THICKNESS_MM,
            leftMethod: "printing_solid",
            rightMethod: "printing_solid",
            linked: false,
        },
    };
}

describe("stock base loading state", () => {
    beforeEach(() => {
        useDesignStore.setState({
            design: resolvedPairedDesign(),
            stockBaseLoading: true,
            stockBaseResolutionState: "loading",
            stockBaseError: null,
            baseMeshLoadingBySide: { left: false, right: false },
        });
    });

    test("ensureDefaultStockBaseResolved clears loading when design is already resolved", () => {
        ensureDefaultStockBaseResolved();
        const state = useDesignStore.getState();
        // Regression: bootstrap/rehydrate races used to leave this true forever while
        // the GLB was already on screen ("Loading base…" + "Loading stock base…").
        expect(state.stockBaseLoading).toBe(false);
    });

    test("applyDefaultStockBase no-ops without flipping loading when already resolved", async () => {
        useDesignStore.setState({ stockBaseLoading: false, stockBaseResolutionState: "resolved" });
        await useDesignStore.getState().applyDefaultStockBase();
        const state = useDesignStore.getState();
        expect(state.stockBaseLoading).toBe(false);
        expect(state.design.paired?.leftBase?.url).toMatch(/^https?:\/\//);
        expect(state.design.paired?.rightBase?.url).toMatch(/^https?:\/\//);
    });
});
