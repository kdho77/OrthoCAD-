import { describe, expect, test } from "@rstest/core";

import { HARDNESS_TO_INFILL_PCT } from "../../../shared/print-recipe/hardness-to-infill-pct.js";
import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe.js";
import { buildManufacturingTempStlKey } from "../lib/storage.js";
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
});
