// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { afoShellSliceFields } from "@/features/exports/apex-print-material";
import { generateHybridGcode, resolveHybridSlice } from "@/features/exports/export-service";
import type { PrinterPreset } from "@/lib/kiri";
import { PRINTER_PRESETS } from "@/lib/kiri/presets";
import { useDesignStore } from "@/stores/design-store";

const sliceCalls: Array<Record<string, unknown>> = [];

rs.mock("@/lib/geometry/export-geometry", () => ({
    buildExportStl: async () => boxStl(),
    buildOrderPairStl: async () => boxStl(),
    buildOrderPairGeometry: async () => {
        throw new Error("paired geometry is not the AFO belt path");
    },
    buildExportGlb: async () => new ArrayBuffer(0),
    exportModeFromMethod: () => "manufacturing",
    orderDownloadSides: () => ["left"],
}));

rs.mock("@/lib/trpc", () => ({
    isApiConfigured: () => true,
    trpc: {
        manufacturing: {
            prepareManufacturingStlUpload: {
                mutate: async () => ({
                    uploadUrl: "https://upload.test/afo",
                    storageKey: "temp/afo",
                    token: "",
                }),
            },
            generateSolid: {
                mutate: async (input: Record<string, unknown>) => {
                    sliceCalls.push(input);
                    return { ok: true, gcode: "; mocked vertexslice\n", productionId: "mock", balance: 1 };
                },
            },
        },
    },
}));

function boxStl(): ArrayBuffer {
    const v = [
        [0, 0, 0],
        [10, 0, 0],
        [10, 8, 0],
        [0, 8, 0],
        [0, 0, 4],
        [10, 0, 4],
        [10, 8, 4],
        [0, 8, 4],
    ];
    const faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    const buffer = new ArrayBuffer(84 + faces.length * 50);
    const view = new DataView(buffer);
    view.setUint32(80, faces.length, true);
    let offset = 84;
    for (const [a, b, c] of faces) {
        offset += 12;
        for (const i of [a, b, c]) {
            const p = v[i]!;
            view.setFloat32(offset, p[0]!, true);
            view.setFloat32(offset + 4, p[1]!, true);
            view.setFloat32(offset + 8, p[2]!, true);
            offset += 12;
        }
        offset += 2;
    }
    return buffer;
}

describe("AFO G-code route", () => {
    test("an AFO uses ApexVylon and the shell method even when the insole picker says Apex Core", () => {
        const route = resolveHybridSlice({ productType: "afo" }, { apexMaterialId: "ApexCore" });
        const fields = afoShellSliceFields();
        expect(route?.material).toBe("apex_vylon");
        expect(route?.material).toBe(fields.material);
        expect(route?.presetId).toBe(fields.presetId);
        expect(route?.method).toBe("printing_shell");
        expect(route?.localPresetId).toBe("apex-belt-v2-shell");
        const local = PRINTER_PRESETS.find((p) => p.id === route?.localPresetId);
        expect(local?.method).toBe("printing_shell");
    });

    test("an insole keeps the selected Apex Core solid profile", () => {
        const route = resolveHybridSlice({ productType: "insole" }, { apexMaterialId: "ApexCore" });
        expect(route?.material).toBe("apex_core");
        expect(route?.method).toBe("printing_solid");
        expect(route?.localPresetId).toBe("apex-belt-v2");
    });

    test("Send to VertexSlice's apex_vylon flag matches the AFO route", () => {
        const sent = resolveHybridSlice({ productType: "insole" }, { afoSliceMaterial: "apex_vylon" });
        const afo = resolveHybridSlice({ productType: "afo" }, { apexMaterialId: "ApexCore" });
        expect(sent).toEqual(afo);
    });

    test("production VertexSlice generateSolid receives the ApexVylon shell contract", async () => {
        sliceCalls.length = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
        useDesignStore.setState({
            design: {
                ...useDesignStore.getState().design,
                productType: "afo",
                method: "printing_shell",
            },
        });
        const preset = PRINTER_PRESETS.find((p) => p.id === "apex-belt-v2-shell") as PrinterPreset;
        try {
            const result = await generateHybridGcode(
                "left",
                preset,
                { type: "rounded", radius_mm: 3 },
                {},
                { deferDownload: true, includeLeaderBlock: false },
            );
            expect(result.ok, result.ok ? "" : result.reason).toBe(true);
            expect(sliceCalls).toHaveLength(1);
            const call = sliceCalls[0]!;
            expect(call.presetId).toBe("apex-v2-insole-95a");
            expect(call.material).toBe("apex_vylon");
            expect(call.outputType).toBe("gcode");
            expect(call.beltAngleDeg).toBe(45);
            expect(call.side).toBe("left");
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

afterEach(() => {
    sliceCalls.length = 0;
});
