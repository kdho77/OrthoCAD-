import { describe, expect, test } from "@rstest/core";

import { HARDNESS_TO_INFILL_PCT } from "../../../shared/print-recipe/hardness-to-infill-pct.js";
import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe.js";
import { VERTEXSLICE_REGIONAL_3MF_ENV } from "../../../shared/vertexslice-regional-3mf.js";
import { buildManufacturingTempStlKey } from "../lib/storage.js";
import { sliceWithVertexSlice } from "../lib/vertexslice-client.js";
import {
    runSessionGenerateSolid,
    type SessionChargeArgs,
    type SessionManufacturingIo,
} from "./manufacturing-session.js";

const userId = "00000000-0000-4000-8000-0000000000aa";

const recipe: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: "apex-v2-insole-95a",
    defaultHardness: "Hard",
    zones: [],
};

describe("session generateSolid", () => {
    test("still returns the synchronous result and charges once", async () => {
        expect(HARDNESS_TO_INFILL_PCT.Hard).toBe(32);
        const order: string[] = [];
        const charges: SessionChargeArgs[] = [];
        let infill: number | undefined;
        const io: SessionManufacturingIo = {
            assertActiveLicense: async () => {
                order.push("license");
            },
            verifyDesignOwner: async () => {
                order.push("design");
            },
            getTokenBalance: async () => 9,
            storageAvailable: () => true,
            signedDownloadUrl: async () => "https://files.example.test/temp.stl",
            downloadStl: async () => new Uint8Array([1, 2, 3]),
            sliceWithVertexSlice: async (request) => {
                order.push("slice");
                infill = request.infillDensityPct;
                expect(request.profileId).toBe("apex-v2-insole-95a");
                expect(request.material).toBe("apex_core");
                return "G1 X0\n";
            },
            callManufacture: async () => {
                throw new Error("session gcode must not call Python");
            },
            charge: async (args) => {
                order.push("charge");
                charges.push(args);
                return {
                    productionId: "33333333-3333-4333-8333-333333333333",
                    exportId: "44444444-4444-4444-8444-444444444444",
                    balance: 6,
                    jobId: args.p_job_id,
                };
            },
            uploadOutput: async () => {
                order.push("upload");
            },
            signedOutputUrl: async () => "https://files.example.test/out.gcode",
            updateExportStorage: async () => {},
            updateProductionGcode: async () => {},
            archiveSourceStl: async () => {
                order.push("archive");
            },
            deleteTemp: async () => {
                order.push("delete");
            },
        };

        const result = await runSessionGenerateSolid({
            userId,
            ip: "127.0.0.1",
            input: {
                designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                side: "left",
                presetId: "apex-v2-insole-95a",
                stlStorageKey: buildManufacturingTempStlKey(
                    userId,
                    1,
                    "55555555-5555-4555-8555-555555555555",
                ),
                outputType: "gcode",
                beltAngleDeg: 45,
                printRecipe: recipe,
                material: "apex_core",
            },
            io,
        });

        expect(order).toEqual(["license", "design", "slice", "charge", "upload", "archive"]);
        expect(infill).toBe(32);
        expect(charges).toHaveLength(1);
        expect(charges[0]).not.toHaveProperty("p_production_id");
        expect(charges[0]?.p_cost).toBe(3);
        expect(charges[0]?.p_preset_id).toBe("apex-v2-insole-95a");
        expect(charges[0]?.p_is_gcode).toBe(true);
        expect(result).toMatchObject({
            ok: true,
            outputType: "gcode",
            productionId: "33333333-3333-4333-8333-333333333333",
            exportId: "44444444-4444-4444-8444-444444444444",
            balance: 6,
            downloadUrl: "https://files.example.test/out.gcode",
            gcodeDownloadUrl: "https://files.example.test/out.gcode",
            gcode: undefined,
            stlBase64: undefined,
            gcodeBase64: undefined,
        });
        expect(result.gcodeStorageKey).toContain("gcode/");
        expect(result).not.toHaveProperty("status");
        expect(Object.keys(result).sort()).toEqual(
            [
                "balance",
                "downloadUrl",
                "exportId",
                "gcode",
                "gcodeBase64",
                "gcodeDownloadUrl",
                "gcodeStorageKey",
                "jobId",
                "ok",
                "outputType",
                "productionId",
                "stlBase64",
            ].sort(),
        );
    });

    test("the regional gate off refuses a regional upload instead of slicing STL", async () => {
        delete process.env[VERTEXSLICE_REGIONAL_3MF_ENV];
        const stl = new Uint8Array([1, 2, 3, 4]);
        const threeMf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]);
        const stlKey = buildManufacturingTempStlKey(userId, 1, "55555555-5555-4555-8555-555555555555");
        const regionalKey = buildManufacturingTempStlKey(userId, 2, "66666666-6666-4666-8666-666666666666");
        let sliced = false;
        const io = sessionIo({
            stlKey,
            regionalKey,
            stl,
            threeMf,
            onSlice: () => {
                sliced = true;
            },
        });
        await expect(
            runSessionGenerateSolid({
                userId,
                ip: null,
                input: {
                    side: "left",
                    presetId: "apex-v2-insole-95a",
                    stlStorageKey: stlKey,
                    outputType: "gcode",
                    beltAngleDeg: 45,
                    printRecipe: { ...recipe, defaultHardness: "Medium" },
                    material: "apex_core",
                    regional3mfStorageKey: regionalKey,
                    expectedRegionCount: 1,
                },
                io,
            }),
        ).rejects.toThrow(/Regional hardness is turned off on this server/);
        expect(sliced).toBe(false);
    });

    test("the regional gate on rejects a 3MF whose modifier count is missing", async () => {
        process.env[VERTEXSLICE_REGIONAL_3MF_ENV] = "1";
        try {
            const stl = new Uint8Array([1, 2, 3, 4]);
            const threeMf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]);
            const stlKey = buildManufacturingTempStlKey(userId, 5, "99999999-9999-4999-8999-999999999999");
            const regionalKey = buildManufacturingTempStlKey(
                userId,
                6,
                "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
            );
            let sliced = false;
            const io = sessionIo({
                stlKey,
                regionalKey,
                stl,
                threeMf,
                onSlice: () => {
                    sliced = true;
                },
            });
            await expect(
                runSessionGenerateSolid({
                    userId,
                    ip: null,
                    input: {
                        side: "left",
                        presetId: "apex-v2-insole-95a",
                        stlStorageKey: stlKey,
                        outputType: "gcode",
                        beltAngleDeg: 45,
                        printRecipe: { ...recipe, defaultHardness: "Medium" },
                        material: "apex_core",
                        regional3mfStorageKey: regionalKey,
                    },
                    io,
                }),
            ).rejects.toThrow(/modifier count is missing/);
            expect(sliced).toBe(false);
        } finally {
            delete process.env[VERTEXSLICE_REGIONAL_3MF_ENV];
        }
    });

    test("the regional gate on sends the 3MF and keeps device infill", async () => {
        process.env[VERTEXSLICE_REGIONAL_3MF_ENV] = "1";
        try {
            const stl = new Uint8Array([1, 2, 3, 4]);
            const threeMf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9]);
            const stlKey = buildManufacturingTempStlKey(userId, 3, "77777777-7777-4777-8777-777777777777");
            const regionalKey = buildManufacturingTempStlKey(
                userId,
                4,
                "88888888-8888-4888-8888-888888888888",
            );
            let sliceRequest: {
                filename?: string;
                model?: Uint8Array;
                infillDensityPct?: number;
                expectedRegionCount?: number;
            } | null = null;
            const io = sessionIo({
                stlKey,
                regionalKey,
                stl,
                threeMf,
                onSlice: (request) => {
                    sliceRequest = {
                        filename: request.filename,
                        model: request.model,
                        infillDensityPct: request.infillDensityPct,
                        expectedRegionCount: request.expectedRegionCount,
                    };
                },
            });
            await runSessionGenerateSolid({
                userId,
                ip: null,
                input: {
                    side: "right",
                    presetId: "apex-v2-insole-95a",
                    stlStorageKey: stlKey,
                    outputType: "gcode",
                    beltAngleDeg: 45,
                    printRecipe: { ...recipe, defaultHardness: "Medium" },
                    material: "apex_core",
                    regional3mfStorageKey: regionalKey,
                    expectedRegionCount: 1,
                },
                io,
            });
            expect(sliceRequest?.filename).toBe("model.3mf");
            expect(sliceRequest?.model).toEqual(threeMf);
            expect(sliceRequest?.infillDensityPct).toBe(26);
            expect(sliceRequest?.expectedRegionCount).toBe(1);
        } finally {
            delete process.env[VERTEXSLICE_REGIONAL_3MF_ENV];
        }
    });

    test("a missing or short X-VertexSlice-Regions header fails the export", async () => {
        process.env[VERTEXSLICE_REGIONAL_3MF_ENV] = "1";
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const originalFetch = globalThis.fetch;
        const headers: Array<string | null> = [null, "0", "nope"];
        try {
            for (const regionsHeader of headers) {
                globalThis.fetch = (async (input: RequestInfo | URL) => {
                    const url = String(input);
                    if (url.endsWith("/v1/materials")) {
                        return new Response(JSON.stringify(["apex_core"]), { status: 200 });
                    }
                    const responseHeaders = new Headers();
                    if (regionsHeader != null) responseHeaders.set("X-VertexSlice-Regions", regionsHeader);
                    return new Response("G1 X0\n", { status: 200, headers: responseHeaders });
                }) as typeof fetch;
                const stl = new Uint8Array([1, 2, 3, 4]);
                const threeMf = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9]);
                const stlKey = buildManufacturingTempStlKey(
                    userId,
                    7,
                    "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                );
                const regionalKey = buildManufacturingTempStlKey(
                    userId,
                    8,
                    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                );
                const io = sessionIo({
                    stlKey,
                    regionalKey,
                    stl,
                    threeMf,
                    onSlice: () => undefined,
                });
                io.sliceWithVertexSlice = sliceWithVertexSlice;
                await expect(
                    runSessionGenerateSolid({
                        userId,
                        ip: null,
                        input: {
                            side: "left",
                            presetId: "apex-v2-insole-95a",
                            stlStorageKey: stlKey,
                            outputType: "gcode",
                            beltAngleDeg: 45,
                            printRecipe: { ...recipe, defaultHardness: "Medium" },
                            material: "apex_core",
                            regional3mfStorageKey: regionalKey,
                            expectedRegionCount: 1,
                        },
                        io,
                    }),
                ).rejects.toThrow(/Regional hardness/);
            }
        } finally {
            globalThis.fetch = originalFetch;
            delete process.env[VERTEXSLICE_REGIONAL_3MF_ENV];
            delete process.env.VERTEXSLICE_SLICER_URL;
            delete process.env.VERTEXSLICE_API_KEY;
        }
    });
});

function sessionIo(args: {
    stlKey: string;
    regionalKey: string;
    stl: Uint8Array;
    threeMf: Uint8Array;
    onSlice: (request: {
        filename?: string;
        model: Uint8Array;
        infillDensityPct?: number;
        expectedRegionCount?: number;
    }) => void;
}): SessionManufacturingIo {
    return {
        assertActiveLicense: async () => undefined,
        verifyDesignOwner: async () => undefined,
        getTokenBalance: async () => 9,
        storageAvailable: () => true,
        signedDownloadUrl: async (key) =>
            key === args.regionalKey
                ? "https://files.example.test/regional"
                : "https://files.example.test/temp.stl",
        downloadStl: async (url) => (url.includes("regional") ? args.threeMf : args.stl),
        sliceWithVertexSlice: async (request) => {
            args.onSlice(request);
            return "G1 X0\n";
        },
        callManufacture: async () => {
            throw new Error("session gcode must not call Python");
        },
        charge: async (charge) => ({
            productionId: "33333333-3333-4333-8333-333333333333",
            exportId: "44444444-4444-4444-8444-444444444444",
            balance: 6,
            jobId: charge.p_job_id,
        }),
        uploadOutput: async () => undefined,
        signedOutputUrl: async () => "https://files.example.test/out.gcode",
        updateExportStorage: async () => undefined,
        updateProductionGcode: async () => undefined,
        archiveSourceStl: async () => undefined,
        deleteTemp: async () => undefined,
    };
}
