// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { defaultDesign, useDesignStore } from "@/stores/design-store";

const calls: Array<{ side: string; options: { beltPrint?: boolean; exportMode?: string } | undefined }> = [];

rs.mock("@/lib/geometry/export-geometry", () => ({
    buildExportStl: async (side: string, options?: { beltPrint?: boolean; exportMode?: string }) => {
        calls.push({ side, options });
        const buf = new ArrayBuffer(84);
        return buf;
    },
    buildOrderPairStl: async () => new ArrayBuffer(84),
    buildOrderPairGeometry: async () => {
        throw new Error("pair geometry is not the belt foot");
    },
    buildExportGlb: async () => new ArrayBuffer(0),
    exportModeFromMethod: (method: string) =>
        method === "printing_solid" || method === "milling_3axis" ? "manufacturing" : "preview",
    orderDownloadSides: () => ["left"],
}));

describe("belt manufacturing STL", () => {
    test("asks the loft to keep the bottom name in the belt print frame", async () => {
        useDesignStore.setState({ design: { ...defaultDesign(), method: "printing_solid" } });
        const { buildPrinterFootManufacturingStl } = await import("./export-service");
        calls.length = 0;
        await buildPrinterFootManufacturingStl("left", false);
        await buildPrinterFootManufacturingStl("right", false);
        expect(calls.map((c) => c.side)).toEqual(["left", "right"]);
        expect(calls.every((c) => c.options?.beltPrint === true)).toBe(true);
        expect(calls.every((c) => c.options?.exportMode === "manufacturing")).toBe(true);
    });
});
