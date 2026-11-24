// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { insoleLayoutForDesignSide } from "@/lib/geometry/shoe-size";
import { useDesignStore } from "@/stores/design-store";
import {
    clientPatchFromDesignSetup,
    defaultShoeChart,
    setupShoeChartMatchesClient,
    shoeChartFromDesignSetup,
    shoeChartFromInput,
} from "../../../shared/client-files";

describe("setup shoe size chart sync", () => {
    test("locked design maps to a single client chart size", () => {
        const chart = shoeChartFromDesignSetup({ usMenSize: 11, shoeSizesLinked: true });
        expect(chart.shoeSizesSplit).toBe(false);
        expect(chart.shoeSizeUs).toBe(11);
        expect(chart.shoeSizeLeftUs).toBe(11);
        expect(chart.shoeSizeRightUs).toBe(11);
    });

    test("unlocked design maps to split client chart sizes", () => {
        const chart = shoeChartFromDesignSetup({
            usMenSize: 9,
            shoeSizesLinked: false,
            usMenSizeBySide: { left: 10, right: 8.5 },
        });
        expect(chart.shoeSizesSplit).toBe(true);
        expect(chart.shoeSizeLeftUs).toBe(10);
        expect(chart.shoeSizeRightUs).toBe(8.5);
    });

    test("client patch from setup writes split fields", () => {
        const patch = clientPatchFromDesignSetup({
            shoeSizesLinked: false,
            usMenSize: 9,
            usMenSizeBySide: { left: 12, right: 11 },
        });
        expect(patch).toEqual({
            shoeSizeUs: 9,
            shoeSizesSplit: true,
            shoeSizeLeftUs: 12,
            shoeSizeRightUs: 11,
        });
    });

    test("setupShoeChartMatchesClient detects overrides", () => {
        const client = defaultShoeChart();
        expect(setupShoeChartMatchesClient({ usMenSize: 9 }, client)).toBe(true);
        expect(setupShoeChartMatchesClient({ usMenSize: 10 }, client)).toBe(false);
        const splitClient = shoeChartFromInput({
            shoeSizesSplit: true,
            shoeSizeUs: 9,
            shoeSizeLeftUs: 10,
            shoeSizeRightUs: 9,
        });
        expect(
            setupShoeChartMatchesClient(
                { shoeSizesLinked: false, usMenSize: 9, usMenSizeBySide: { left: 10, right: 9 } },
                splitClient,
            ),
        ).toBe(true);
    });
});

describe("design store shoe size lock", () => {
    test("unlock then per-side sizes yield different footprint lengths", () => {
        const store = useDesignStore.getState();
        store.setShoeSizesLinked(false);
        store.setUsShoeSize(10, "left");
        store.setUsShoeSize(8, "right");
        const design = useDesignStore.getState().design;
        expect(design.shoeSizesLinked).toBe(false);
        expect(design.usMenSizeBySide).toEqual({ left: 10, right: 8 });
        const leftLen = insoleLayoutForDesignSide(design, "left").lengthMm;
        const rightLen = insoleLayoutForDesignSide(design, "right").lengthMm;
        expect(leftLen).toBeGreaterThan(rightLen);
    });

    test("re-lock applies the left foot size to both sides", () => {
        const store = useDesignStore.getState();
        store.setShoeSizesLinked(false);
        store.setUsShoeSize(11, "left");
        store.setUsShoeSize(9, "right");
        store.setShoeSizesLinked(true);
        const design = useDesignStore.getState().design;
        expect(design.shoeSizesLinked).not.toBe(false);
        expect(design.usMenSize).toBe(11);
        expect(design.usMenSizeBySide).toEqual({ left: 11, right: 11 });
    });
});
