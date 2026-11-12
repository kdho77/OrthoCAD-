import { describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";

import {
    type Actor,
    createClientFile,
    createDesignFile,
    createMemoryClientFileRepo,
    defaultShoeChart,
} from "../../../shared/client-files.js";
import { HARDNESS_TO_INFILL_PCT } from "../../../shared/print-recipe/hardness-to-infill-pct.js";
import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe.js";
import { buildManufacturingTempStlKey } from "../lib/storage.js";
import {
    assertDesignExportAccess,
    runSessionGenerateSolid,
    type SessionChargeArgs,
    type SessionManufacturingIo,
} from "./manufacturing-session.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

function actor(id: string, role: string, tenantId: string | null): Actor {
    return { id, email: `${role}@example.test`, role, tenantId };
}

function exportIo(
    exporter: Actor,
    repo: ReturnType<typeof createMemoryClientFileRepo>,
    charges: SessionChargeArgs[],
    calls: string[],
): SessionManufacturingIo {
    return {
        assertActiveLicense: async (userId) => {
            calls.push(`license:${userId}`);
        },
        verifyDesignOwner: async (designId, userId) => {
            calls.push("design");
            expect(userId).toBe(exporter.id);
            await assertDesignExportAccess(repo, exporter, designId);
        },
        getTokenBalance: async (userId) => {
            calls.push(`balance:${userId}`);
            return 9;
        },
        storageAvailable: () => true,
        signedDownloadUrl: async () => "https://files.example.test/temp.stl",
        downloadStl: async () => new Uint8Array([1, 2, 3]),
        sliceWithVertexSlice: async () => {
            calls.push("slice");
            return "G1 X0\n";
        },
        callManufacture: async () => {
            throw new Error("session gcode must not call Python");
        },
        charge: async (chargeArgs) => {
            calls.push("charge");
            charges.push(chargeArgs);
            return {
                productionId: "33333333-3333-4333-8333-333333333333",
                exportId: "44444444-4444-4444-8444-444444444444",
                balance: 6,
                jobId: chargeArgs.p_job_id,
            };
        },
        uploadOutput: async () => {
            calls.push("upload");
        },
        signedOutputUrl: async () => "https://files.example.test/out.gcode",
        updateExportStorage: async () => {},
        updateProductionGcode: async () => {},
        archiveSourceStl: async () => {
            calls.push("archive");
        },
        deleteTemp: async () => {
            calls.push("delete");
        },
    };
}

async function exportDesign(
    exporter: Actor,
    repo: ReturnType<typeof createMemoryClientFileRepo>,
    designId: string,
) {
    const charges: SessionChargeArgs[] = [];
    const calls: string[] = [];
    const result = await runSessionGenerateSolid({
        userId: exporter.id,
        ip: "127.0.0.1",
        input: {
            designId,
            side: "left",
            presetId: "apex-v2-insole-95a",
            stlStorageKey: buildManufacturingTempStlKey(
                exporter.id,
                1,
                "55555555-5555-4555-8555-555555555555",
            ),
            outputType: "gcode",
            beltAngleDeg: 45,
            printRecipe: recipe,
            material: "apex_core",
        },
        io: exportIo(exporter, repo, charges, calls),
    });
    return { result, charges, calls };
}

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

describe("design export access matches save", () => {
    const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const colleagueId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const superId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const outsiderId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

    async function seed() {
        const repo = createMemoryClientFileRepo({ clients: [], designs: [], exports: [], audits: [] });
        const admin = actor(adminId, "admin", TENANT);
        const colleague = actor(colleagueId, "clinician", TENANT);
        const superAdmin = actor(superId, "super_admin", null);
        const outsider = actor(outsiderId, "admin", OTHER_TENANT);
        const { client } = await createClientFile(repo, admin, {
            displayName: "AB",
            firstName: "A",
            lastName: "B",
            ...defaultShoeChart(),
        });
        return { repo, admin, colleague, superAdmin, outsider, client };
    }

    test("same-tenant admin exports a design created by another account", async () => {
        const { repo, admin, colleague, client } = await seed();
        const design = await createDesignFile(repo, colleague, {
            clientId: client.id,
            name: "Colleague insole",
            kind: "insole",
        });
        expect(design.ownerId).toBe(colleague.id);
        const { result, charges, calls } = await exportDesign(admin, repo, design.id);
        expect(result.ok).toBe(true);
        expect(charges).toHaveLength(1);
        expect(charges[0]?.p_user_id).toBe(admin.id);
        expect(calls[0]).toBe(`license:${admin.id}`);
        expect(calls).toContain("slice");
        expect(calls).toContain("charge");
    });

    test("tenant admin exports a super_admin design in that tenant's patient file", async () => {
        const { repo, admin, superAdmin, client } = await seed();
        const design = await createDesignFile(repo, superAdmin, {
            clientId: client.id,
            name: "Filed insole",
            kind: "insole",
        });
        expect(design.ownerId).toBe(superAdmin.id);
        expect(superAdmin.tenantId).toBeNull();
        const { result, charges, calls } = await exportDesign(admin, repo, design.id);
        expect(result.ok).toBe(true);
        expect(charges[0]?.p_user_id).toBe(admin.id);
        expect(calls[0]).toBe(`license:${admin.id}`);
        expect(calls).not.toContain(`license:${superAdmin.id}`);
        expect(calls).not.toContain(`balance:${superAdmin.id}`);
    });

    test("a different-tenant user is forbidden", async () => {
        const { repo, colleague, outsider, client } = await seed();
        const design = await createDesignFile(repo, colleague, {
            clientId: client.id,
            name: "Colleague insole",
            kind: "insole",
        });
        await expect(exportDesign(outsider, repo, design.id)).rejects.toBeInstanceOf(TRPCError);
        await expect(exportDesign(outsider, repo, design.id)).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: "Design not found or access denied",
        });
    });

    test("a missing design is forbidden or not found", async () => {
        const { repo, admin } = await seed();
        const error = await exportDesign(admin, repo, "99999999-9999-4999-8999-999999999999").then(
            () => {
                throw new Error("missing design was exported");
            },
            (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(TRPCError);
        expect(["FORBIDDEN", "NOT_FOUND"]).toContain((error as TRPCError).code);
    });
});
