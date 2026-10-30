// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { beforeEach, describe, expect, test } from "@rstest/core";
import { stockBaseDisplayName } from "@/lib/geometry/base-asset";
import { BASE_REFERENCE_THICKNESS_MM } from "@/lib/geometry/base-modifier";
import { ensureDefaultStockBaseResolved, useDesignStore } from "@/stores/design-store";
import type { DesignBase, DesignState } from "@/types";

function resolvedStockBase(side: "left" | "right", mirrored = false): DesignBase {
    return {
        assetId: "sample-top",
        name: `SAMPLE_Top (${side === "left" ? "Left" : "Right"})`,
        source: "stock",
        glbPath: "Templates/SAMPLE_Top.glb",
        url: "/Templates/SAMPLE_Top.glb",
        primarySide: "left",
        offlinePlaceholder: true,
        resolutionFallback: true,
        ...(mirrored ? { mirrored: true, mirroredFrom: "sample-top" } : {}),
    };
}

function legacyDefaultStockBase(side: "left" | "right", mirrored = false): DesignBase {
    return {
        assetId: "stock-default",
        name: `Default Stock Base (${side === "left" ? "Left" : "Right"})`,
        source: "stock",
        glbPath: "Templates/Default.glb",
        url: "https://example.supabase.co/storage/v1/object/public/stock-bases/Templates/Default.glb",
        primarySide: "left",
        ...(mirrored ? { mirrored: true, mirroredFrom: "stock-default" } : {}),
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

    test("already-resolved bootstrap does not notify stock subscribers", () => {
        useDesignStore.setState({ stockBaseLoading: false, stockBaseResolutionState: "resolved" });
        let notified = 0;
        const unsub = useDesignStore.subscribe(() => {
            notified += 1;
        });
        ensureDefaultStockBaseResolved();
        unsub();
        expect(notified).toBe(0);
        expect(useDesignStore.getState().stockBaseResolutionState).toBe("resolved");
        expect(useDesignStore.getState().stockBaseLoading).toBe(false);
    });

    test("applyDefaultStockBase no-ops without flipping loading when already resolved", async () => {
        useDesignStore.setState({ stockBaseLoading: false, stockBaseResolutionState: "resolved" });
        await useDesignStore.getState().applyDefaultStockBase();
        const state = useDesignStore.getState();
        expect(state.stockBaseLoading).toBe(false);
        expect(state.design.paired?.leftBase?.url).toBe("/Templates/SAMPLE_Top.glb");
        expect(state.design.paired?.rightBase?.url).toBe("/Templates/SAMPLE_Top.glb");
        expect(state.design.paired?.leftBase?.name).toMatch(/SAMPLE_Top/i);
        expect(state.design.paired?.leftBase?.name).not.toMatch(/Default Stock Base/i);
    });

    test("applyDefaultStockBase migrates leftover Default.glb to SAMPLE_Top", async () => {
        const left = legacyDefaultStockBase("left");
        const right = legacyDefaultStockBase("right", true);
        useDesignStore.setState({
            design: {
                ...resolvedPairedDesign(),
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
            },
            stockBaseLoading: false,
            stockBaseResolutionState: "resolved",
        });
        await useDesignStore.getState().applyDefaultStockBase();
        const state = useDesignStore.getState();
        expect(state.design.paired?.leftBase?.glbPath).toMatch(/SAMPLE_Top\.glb$/);
        expect(state.design.paired?.rightBase?.mirrored).toBe(true);
        expect(state.design.base?.name).not.toMatch(/Default Stock Base/i);
        expect(state.viewer.wallModel ?? "procedural").toBe("procedural");
    });

    test("store initializer is SAMPLE_Top + procedural Straight, not Default Stock Base", () => {
        const initial = useDesignStore.getInitialState();
        expect(initial.viewer.wallModel).toBe("procedural");
        expect(initial.viewer.wallStyle).toBe("straight");
        expect(initial.design.paired?.leftBase?.glbPath).toMatch(/SAMPLE_Top\.glb$/);
        expect(initial.design.paired?.rightBase?.mirrored).toBe(true);
        expect(initial.design.base?.name).not.toMatch(/Default Stock Base/i);
        expect(stockBaseDisplayName(initial.design.base)).toBe("SAMPLE_Top");
    });
});
