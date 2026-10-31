// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import {
    cncSidesForOrder,
    exportDesign,
    exportGcode,
    generateHybridGcode,
    isMilledOrder,
    MILLED_ORDER_PRINT_REASON,
} from "@/features/exports/export-service";
import { orderDownloadSides } from "@/lib/geometry/export-geometry";
import type { PrinterPreset } from "@/lib/kiri";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import type { DesignState } from "@/types";

function millingOrder(): DesignState {
    const design = createDesignWithStockPlaceholder();
    design.method = "milling_3axis";
    if (design.paired) {
        design.paired.leftMethod = "milling_3axis";
        design.paired.rightMethod = "milling_3axis";
    }
    return design;
}

describe("milled orders export CNC only", () => {
    test("a paired mill order is L+R even when the caller asks for one foot", () => {
        const design = millingOrder();
        expect(isMilledOrder(design)).toBe(true);
        expect(cncSidesForOrder(design, ["left"])).toEqual(["left", "right"]);
        expect(orderDownloadSides(design)).toEqual(["left", "right"]);
        if (design.paired) design.paired.rightBase = undefined;
        expect(cncSidesForOrder(design, ["right"])).toEqual(["left"]);
        const print = createDesignWithStockPlaceholder();
        expect(isMilledOrder(print)).toBe(false);
        expect(cncSidesForOrder(print, ["left"])).toEqual(["left"]);
    });

    test("STL, 3MF, GLB, and print G-code are refused", async () => {
        useDesignStore.setState({ design: millingOrder() });
        const preset = { id: "desktop-fdm", name: "Desktop" } as PrinterPreset;
        const stl = await exportDesign("stl", "left");
        const three = await exportDesign("3mf", "left");
        const glb = await exportDesign("glb", "left");
        const gcode = await exportGcode("left", preset);
        const hybrid = await generateHybridGcode("left", preset, { type: "straight", angle_degrees: 8 });
        for (const res of [stl, three, glb, gcode, hybrid]) {
            expect(res.ok).toBe(false);
            expect(res.reason).toBe(MILLED_ORDER_PRINT_REASON);
            expect(res.blob).toBeUndefined();
        }
    });
});
