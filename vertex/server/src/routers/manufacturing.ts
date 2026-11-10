import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { DogfoodUserQuestion } from "../../../shared/dogfood-manufacturing.js";
import { printRecipeV1Schema } from "../../../shared/print-recipe/print-recipe.js";
import { SavedDesignSnapshotError } from "../../../shared/saved-design-catalog.js";
import { assertCadOperatorGcodeKey, buildCadOperatorTempStlKey } from "../auth/cad-operator.js";
import { dogfoodDesignRead } from "../auth/dogfood-design-access.js";
import { getSupabaseAdmin } from "../context.js";
import { runtimeDogfoodOrderOwnerVerifier } from "../lib/dogfood-order-owner-wire.js";
import {
    createDogfoodSavedDesign,
    DogfoodOrderIdentityError,
    IntegrationShoeWidthError,
    prismaDogfoodSavedDesignStore,
} from "../lib/dogfood-saved-design.js";
import { callManufacture } from "../lib/manufacturing-client.js";
import { downloadManufacturingStl } from "../lib/manufacturing-stl-download.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "../lib/manufacturing-stl-lifecycle.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import { persistSavedDesignSnapshotOnDesign } from "../lib/saved-design-snapshot.js";
import {
    buildManufacturingTempStlKey,
    createSignedUpload,
    MANUFACTURING_BUCKET,
    signedDownloadUrl,
    uploadAsset,
} from "../lib/storage.js";
import { assertActiveLicense, getUserTokenBalance, requireSupabaseAdmin } from "../lib/supabase-db.js";
import { sliceWithVertexSlice } from "../lib/vertexslice-client.js";
import {
    rateLimitedProcedure,
    rateLimitedSessionOrCadProcedure,
    router,
    sessionOrCadOperatorProcedure,
} from "../trpc.js";
import {
    listCadOperatorProductions,
    readCadOperatorProduction,
    runCadOperatorGenerateRequest,
} from "./cad-operator-generate.js";
import { runSessionGenerateSolid, type SessionManufacturingIo } from "./manufacturing-session.js";

const MAX_INLINE_STL_BYTES = 8 * 1024 * 1024;

const grindingStyleSchema = z.object({
    type: z.enum(["straight", "rounded"]),
    angle_degrees: z.number().optional(),
    radius_mm: z.number().optional(),
});

const manufactureInputSchema = z.object({
    designId: z.string().uuid().optional(),
    side: z.enum(["left", "right"]).optional(),
    presetId: z.string().min(1),
    stlUrl: z.string().url().optional(),
    stlStorageKey: z.string().min(1),
    outputType: z.enum(["gcode", "stl"]),
    beltAngleDeg: z.number().min(10).max(80).default(45),
    layerHeightMm: z.number().min(0.05).max(1).optional(),
    infillDensity: z.number().min(0).max(1).optional(),
    perimeters: z.number().int().min(1).max(10).optional(),
    grindingStyle: grindingStyleSchema.optional(),
    printRecipe: printRecipeV1Schema.optional(),
    fileName: z.string().max(200).optional(),
    /** Dogfood CAD-operator only. The server builds the Export mesh and does not return STL. */
    useSavedDesignMesh: z.boolean().optional(),
    /** Dogfood CAD-operator only. Bottom engrave textMarking for this export (merged into settingsJson). */
    patientName: z.string().max(200).optional(),
    /** Explicit material hardness. Omitted hardness asks the user instead of using Medium. */
    hardness: z.string().max(40).optional(),
    material: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .regex(/^[\w .+\-/%()]+$/)
        .optional(),
});

const uploadStlInputSchema = z.object({
    side: z.enum(["left", "right"]),
    stlBase64: z.string().min(1),
    fileName: z.string().max(200).optional(),
});

async function assertActiveLicenseForUser(userId: string): Promise<void> {
    const supabase = requireSupabaseAdmin();
    await assertActiveLicense(supabase, userId);
}

function sessionManufacturingIo(): SessionManufacturingIo {
    const supabase = getSupabaseAdmin();
    return {
        assertActiveLicense: assertActiveLicenseForUser,
        async verifyDesignOwner(designId, userId) {
            const admin = requireSupabaseAdmin();
            const { data: design, error: designError } = await admin
                .from("designs")
                .select("id")
                .eq("id", designId)
                .eq("ownerId", userId)
                .maybeSingle();
            if (designError) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to verify design ownership: ${designError.message}`,
                });
            }
            if (!design) {
                throw new TRPCError({
                    code: "FORBIDDEN",
                    message: "Design not found or access denied",
                });
            }
        },
        async getTokenBalance(userId) {
            return getUserTokenBalance(requireSupabaseAdmin(), userId);
        },
        storageAvailable: () => Boolean(supabase),
        async signedDownloadUrl(storageKey) {
            if (!supabase) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }
            return signedDownloadUrl(supabase, storageKey, 3600, MANUFACTURING_BUCKET);
        },
        downloadStl: downloadManufacturingStl,
        sliceWithVertexSlice,
        callManufacture,
        async charge(chargeArgs) {
            if (!supabase) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }
            const { data: chargeData, error: chargeError } = await supabase.rpc(
                "vertex_charge_manufacturing_hybrid",
                chargeArgs,
            );
            if (chargeError) {
                if (chargeError.message.includes("INSUFFICIENT_TOKENS")) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }
                if (chargeError.message.includes("NO_VALID_LICENSE")) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "No valid license" });
                }
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Manufacturing charge failed: ${chargeError.message}`,
                });
            }
            return chargeData as {
                productionId: string | null;
                exportId: string;
                balance: number;
                jobId: string;
            };
        },
        async uploadOutput(storageKey, bytes, contentType) {
            if (!supabase) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }
            await uploadAsset(supabase, storageKey, bytes, contentType, MANUFACTURING_BUCKET);
        },
        async signedOutputUrl(storageKey) {
            if (!supabase) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }
            return signedDownloadUrl(supabase, storageKey, 3600, MANUFACTURING_BUCKET);
        },
        async updateExportStorage(exportId, storageKey) {
            if (!supabase) return;
            await supabase.from("exports").update({ storageKey }).eq("id", exportId);
        },
        async updateProductionGcode(productionId, storageKey) {
            if (!supabase) return;
            await supabase.from("productions").update({ gcodeStorageKey: storageKey }).eq("id", productionId);
        },
        async archiveSourceStl(archiveArgs) {
            if (!supabase) return;
            await archiveManufacturingSourceStl(supabase, archiveArgs);
        },
        async deleteTemp(storageKey) {
            deleteManufacturingTempBestEffort(supabase, storageKey);
        },
    };
}

export const manufacturingRouter = router({
    /**
     * Browser uploads the STL directly to Storage via a signed URL so the JSON
     * tRPC payload never carries multi-MB base64 (that 413'd as "Request Entity Too Large"
     * and the client then showed 0 tokens after auth refresh).
     */
    prepareManufacturingStlUpload: rateLimitedSessionOrCadProcedure(
        RATE_LIMITS.export,
        "manufacturing:prepareStl",
        "manufacturing:prepare",
    )
        .input(
            z.object({
                side: z.enum(["left", "right"]),
                fileName: z.string().max(200).optional(),
            }),
        )
        .mutation(async ({ ctx }) => {
            const supabase = getSupabaseAdmin();
            if (!ctx.user && ctx.cadOperator) {
                if (!supabase) {
                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
                }
                const key = buildCadOperatorTempStlKey(ctx.cadOperator.credentialId);
                let signed: { key: string; uploadUrl: string; token: string };
                try {
                    signed = await createSignedUpload(supabase, key, MANUFACTURING_BUCKET);
                } catch (err) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message:
                            err instanceof Error ? err.message : "Failed to create manufacturing upload URL",
                    });
                }
                return {
                    ok: true as const,
                    storageKey: signed.key,
                    uploadUrl: signed.uploadUrl,
                    token: signed.token,
                };
            }
            if (!ctx.user) {
                throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
            }
            await assertActiveLicenseForUser(ctx.user.id);

            if (!supabase) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }

            const key = buildManufacturingTempStlKey(ctx.user.id);
            let signed: { key: string; uploadUrl: string; token: string };
            try {
                signed = await createSignedUpload(supabase, key, MANUFACTURING_BUCKET);
            } catch (err) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: err instanceof Error ? err.message : "Failed to create manufacturing upload URL",
                });
            }

            return {
                ok: true as const,
                storageKey: signed.key,
                uploadUrl: signed.uploadUrl,
                token: signed.token,
            };
        }),

    uploadManufacturingStl: rateLimitedProcedure(RATE_LIMITS.export, "manufacturing:uploadStl")
        .input(uploadStlInputSchema)
        .mutation(async ({ ctx, input }) => {
            await assertActiveLicenseForUser(ctx.user.id);

            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }

            let bytes: Buffer;
            try {
                bytes = Buffer.from(input.stlBase64, "base64");
            } catch {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid STL base64 payload" });
            }
            if (bytes.length === 0) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Empty STL payload" });
            }
            if (bytes.length > MAX_INLINE_STL_BYTES) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `STL too large (${bytes.length} bytes; max ${MAX_INLINE_STL_BYTES})`,
                });
            }

            const key = buildManufacturingTempStlKey(ctx.user.id);
            await uploadAsset(supabase, key, bytes, "model/stl", MANUFACTURING_BUCKET);
            const stlUrl = await signedDownloadUrl(supabase, key, 3600, MANUFACTURING_BUCKET);

            return { ok: true as const, stlUrl, storageKey: key };
        }),

    generateSolid: rateLimitedSessionOrCadProcedure(
        RATE_LIMITS.export,
        "manufacturing:generateSolid",
        "manufacturing:generate",
    )
        .input(manufactureInputSchema)
        .mutation(async ({ ctx, input }) => {
            const cadOperator = ctx.user ? null : (ctx.cadOperator ?? null);
            if (!ctx.user && !cadOperator) {
                throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
            }
            if (cadOperator) {
                if (!input.designId || !input.side) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "CAD-operator G-code requires designId and side",
                    });
                }
                try {
                    return await runCadOperatorGenerateRequest({
                        prisma: ctx.prisma,
                        principal: cadOperator,
                        ip: ctx.ip,
                        input: {
                            designId: input.designId,
                            side: input.side,
                            presetId: input.presetId,
                            stlStorageKey: input.stlStorageKey,
                            outputType: input.outputType,
                            beltAngleDeg: input.beltAngleDeg,
                            layerHeightMm: input.layerHeightMm,
                            fileName: input.fileName,
                            useSavedDesignMesh: input.useSavedDesignMesh,
                            patientName: input.patientName,
                            hardness: input.hardness,
                        },
                    });
                } catch (error) {
                    if (error instanceof DogfoodUserQuestion) return error.payload;
                    throw error;
                }
            }
            if (!ctx.user) {
                throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
            }
            return runSessionGenerateSolid({
                userId: ctx.user.id,
                ip: ctx.ip,
                input,
                io: sessionManufacturingIo(),
            });
        }),

    getProduction: sessionOrCadOperatorProcedure("manufacturing:download")
        .input(z.object({ productionId: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            return readCadOperatorProduction({
                prisma: ctx.prisma,
                principal: ctx.user ? null : (ctx.cadOperator ?? null),
                userId: ctx.user?.id ?? null,
                productionId: input.productionId,
            });
        }),

    listProductionsByDesign: sessionOrCadOperatorProcedure("manufacturing:download")
        .input(
            z.object({
                designId: z.string().uuid(),
                side: z.enum(["left", "right"]).optional(),
                presetId: z.string().min(1).optional(),
            }),
        )
        .query(async ({ ctx, input }) => {
            return listCadOperatorProductions({
                prisma: ctx.prisma,
                principal: ctx.user ? null : (ctx.cadOperator ?? null),
                userId: ctx.user?.id ?? null,
                designId: input.designId,
                side: input.side,
                presetId: input.presetId,
            });
        }),

    /**
     * Persist a loftable SAMPLE_Top settingsJson on an existing design.
     * Does not create a design, change production status, or read rx text.
     */
    persistSavedDesignSnapshot: rateLimitedSessionOrCadProcedure(
        RATE_LIMITS.export,
        "manufacturing:persistSavedDesignSnapshot",
        "manufacturing:generate",
    )
        .input(
            z.object({
                designId: z.string().uuid(),
                catalog: z.unknown().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            if (!ctx.cadOperator) {
                throw new TRPCError({ code: "FORBIDDEN", message: "CAD-operator credential required" });
            }
            try {
                return await persistSavedDesignSnapshotOnDesign({
                    prisma: ctx.prisma,
                    principal: ctx.cadOperator,
                    designId: input.designId,
                    catalog: input.catalog,
                });
            } catch (error) {
                if (error instanceof SavedDesignSnapshotError) {
                    throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: error.message });
                }
                throw error;
            }
        }),

    /**
     * Refresh the dogfood SAMPLE_Top design already bound to a vo2 order.
     * Does not create a client or a design. clientId only confirms the bound client.
     * No scan upload and no STL deliverable.
     */
    createSavedDesign: rateLimitedSessionOrCadProcedure(
        RATE_LIMITS.export,
        "manufacturing:createSavedDesign",
        "manufacturing:generate",
    )
        .input(
            z.object({
                externalOrderId: z.string().trim().min(1).max(200),
                clientId: z.string().uuid().optional(),
                givenName: z.string().trim().min(1).max(100).optional(),
                familyName: z.string().trim().min(1).max(100).optional(),
                catalog: z.unknown().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            if (!ctx.cadOperator) {
                throw new TRPCError({ code: "FORBIDDEN", message: "CAD-operator credential required" });
            }
            try {
                return await createDogfoodSavedDesign({
                    principal: ctx.cadOperator,
                    externalOrderId: input.externalOrderId,
                    clientId: input.clientId,
                    catalog: input.catalog,
                    chart: { givenName: input.givenName, familyName: input.familyName },
                    verifier: runtimeDogfoodOrderOwnerVerifier(process.env),
                    store: prismaDogfoodSavedDesignStore(ctx.prisma),
                    persist: (designId) =>
                        persistSavedDesignSnapshotOnDesign({
                            prisma: ctx.prisma,
                            principal: ctx.cadOperator!,
                            designId,
                            catalog: input.catalog,
                        }),
                });
            } catch (error) {
                if (error instanceof DogfoodOrderIdentityError) {
                    const forbidden =
                        error.code === "order_client_mismatch" ||
                        error.code === "order_client_cross_tenant" ||
                        error.code === "verifier_revoked" ||
                        error.code === "verifier_unauthorized" ||
                        error.code === "verifier_untrusted";
                    throw new TRPCError({
                        code: forbidden ? "FORBIDDEN" : "PRECONDITION_FAILED",
                        message: error.message,
                    });
                }
                if (error instanceof DogfoodUserQuestion) return error.payload;
                if (error instanceof SavedDesignSnapshotError || error instanceof IntegrationShoeWidthError) {
                    throw new TRPCError({ code: "UNPROCESSABLE_CONTENT", message: error.message });
                }
                if (error instanceof Error && error.name === "DogfoodHoldError") {
                    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
                }
                throw error;
            }
        }),

    getGcodeDownloadUrl: sessionOrCadOperatorProcedure("manufacturing:download")
        .input(z.object({ productionId: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data: production, error } = await supabase
                .from("productions")
                .select("id, gcodeStorageKey, designId")
                .eq("id", input.productionId)
                .maybeSingle();

            if (error) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to load production: ${error.message}`,
                });
            }

            if (!production?.designId) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Production not found or access denied" });
            }

            if (!ctx.user) {
                if (!ctx.cadOperator) {
                    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
                }
                if (!production.gcodeStorageKey) {
                    throw new TRPCError({
                        code: "NOT_FOUND",
                        message: "No G-code file stored for this production",
                    });
                }
                try {
                    assertCadOperatorGcodeKey(production.gcodeStorageKey, ctx.cadOperator.credentialId);
                } catch {
                    throw new TRPCError({
                        code: "FORBIDDEN",
                        message: "Production not found or access denied",
                    });
                }
                const row = await ctx.prisma.design.findUnique({
                    where: { id: production.designId },
                    select: {
                        id: true,
                        ownerId: true,
                        name: true,
                        kind: true,
                        pattern: true,
                        method: true,
                        thicknessMm: true,
                        linked: true,
                        unit: true,
                        settingsJson: true,
                        updatedAt: true,
                        deletedAt: true,
                        client: { select: { tenantId: true } },
                        integrationLink: {
                            select: { tenantId: true, source: true, externalOrderId: true, sides: true },
                        },
                    },
                });
                dogfoodDesignRead(
                    ctx.cadOperator,
                    row
                        ? {
                              id: row.id,
                              ownerId: row.ownerId,
                              name: row.name,
                              kind: row.kind,
                              pattern: row.pattern,
                              method: row.method,
                              thicknessMm: row.thicknessMm,
                              linked: row.linked,
                              unit: row.unit,
                              settingsJson: row.settingsJson,
                              updatedAt: row.updatedAt,
                              deletedAt: row.deletedAt,
                              clientTenantId: row.client.tenantId,
                              linkTenantId: row.integrationLink?.tenantId ?? null,
                              source: row.integrationLink?.source ?? null,
                              externalOrderId: row.integrationLink?.externalOrderId ?? null,
                              sides: row.integrationLink?.sides ?? null,
                          }
                        : null,
                );
                const storage = getSupabaseAdmin();
                if (!storage) {
                    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
                }
                const downloadUrl = await signedDownloadUrl(
                    storage,
                    production.gcodeStorageKey,
                    3600,
                    MANUFACTURING_BUCKET,
                );
                return { downloadUrl, productionId: production.id };
            }

            const { data: design, error: designError } = await supabase
                .from("designs")
                .select("ownerId")
                .eq("id", production.designId)
                .maybeSingle();

            if (designError) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to verify production ownership: ${designError.message}`,
                });
            }

            if (!design || design.ownerId !== ctx.user.id) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Production not found or access denied" });
            }
            if (!production.gcodeStorageKey) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "No G-code file stored for this production",
                });
            }
            const storage = getSupabaseAdmin();
            if (!storage) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }
            const downloadUrl = await signedDownloadUrl(
                storage,
                production.gcodeStorageKey,
                3600,
                MANUFACTURING_BUCKET,
            );
            return { downloadUrl, productionId: production.id };
        }),
});
