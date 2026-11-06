import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
    gyroidInfillPctForHardness,
    isGyroidManufacturingPreset,
    migratePrintRecipe,
    PrintRecipeProfileRequiredError,
    printRecipeToSnake,
    printRecipeV1Schema,
    resolveGyroidManufacturingPrintRecipe,
} from "../../../shared/print-recipe/print-recipe.js";
import { SavedDesignSnapshotError } from "../../../shared/saved-design-catalog.js";
import {
    assertCadOperatorGcodeKey,
    buildCadOperatorGcodeKey,
    buildCadOperatorTempStlKey,
} from "../auth/cad-operator.js";
import { dogfoodDesignRead } from "../auth/dogfood-design-access.js";
import { getSupabaseAdmin } from "../context.js";
import { callManufacture } from "../lib/manufacturing-client.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "../lib/manufacturing-stl-lifecycle.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import { persistSavedDesignSnapshotOnDesign } from "../lib/saved-design-snapshot.js";
import {
    assertManufacturingTempKeyForUser,
    buildManufacturingTempStlKey,
    createSignedUpload,
    MANUFACTURING_BUCKET,
    signedDownloadUrl,
    uploadAsset,
} from "../lib/storage.js";
import { assertActiveLicense, getUserTokenBalance, requireSupabaseAdmin } from "../lib/supabase-db.js";
import { readUpstreamErrorText } from "../lib/upstream-error.js";
import { manufacturingBackendForOutput, sliceWithVertexSlice } from "../lib/vertexslice-client.js";
import {
    rateLimitedProcedure,
    rateLimitedSessionOrCadProcedure,
    router,
    sessionOrCadOperatorProcedure,
} from "../trpc.js";
import { planCadOperatorGenerate } from "./manufacturing-cad.js";

const HYBRID_GCODE_COST = 3;
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
    material: z
        .string()
        .trim()
        .min(1)
        .max(80)
        .regex(/^[\w .+\-/%()]+$/)
        .optional(),
});

async function downloadManufacturingStl(url: string): Promise<Uint8Array> {
    let response: Response;
    try {
        response = await fetch(url);
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not download manufacturing STL: ${message}`,
        });
    }
    if (!response.ok) {
        const detail = await readUpstreamErrorText(response);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not download manufacturing STL (${response.status}): ${detail}`,
        });
    }
    return new Uint8Array(await response.arrayBuffer());
}

const uploadStlInputSchema = z.object({
    side: z.enum(["left", "right"]),
    stlBase64: z.string().min(1),
    fileName: z.string().max(200).optional(),
});

async function assertActiveLicenseForUser(userId: string): Promise<void> {
    const supabase = requireSupabaseAdmin();
    await assertActiveLicense(supabase, userId);
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
            if (cadOperator && (!input.designId || !input.side)) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "CAD-operator G-code requires designId and side",
                });
            }

            let stlStorageKey = input.stlStorageKey;
            let presetId = input.presetId;
            let printRecipe = input.printRecipe;
            let material = input.material;
            let beltAngleDeg = input.beltAngleDeg;
            let requestedOutputType = input.outputType;
            let actorUserId = ctx.user?.id ?? "";
            let manufacturingFingerprint: string | null = null;

            if (cadOperator && input.designId && input.side) {
                const supabaseForPlan = getSupabaseAdmin();
                const plan = await planCadOperatorGenerate({
                    prisma: ctx.prisma,
                    principal: cadOperator,
                    designId: input.designId,
                    side: input.side,
                    outputType: input.outputType,
                    useSavedDesignMesh: input.useSavedDesignMesh === true,
                    stlStorageKey,
                    uploadStl: async (key, bytes) => {
                        if (!supabaseForPlan) {
                            throw new TRPCError({
                                code: "INTERNAL_SERVER_ERROR",
                                message: "Storage not available",
                            });
                        }
                        await uploadAsset(supabaseForPlan, key, bytes, "model/stl", MANUFACTURING_BUCKET);
                    },
                });
                stlStorageKey = plan.stlStorageKey;
                presetId = plan.presetId;
                printRecipe = plan.printRecipe;
                material = plan.material;
                beltAngleDeg = plan.beltAngleDeg;
                requestedOutputType = "gcode";
                actorUserId = plan.ownerId;
                manufacturingFingerprint = plan.fingerprint;
            }

            console.log("[manufacturing] generateSolid request", {
                userId: actorUserId,
                cadOperator: cadOperator?.credentialId ?? null,
                designId: input.designId ?? null,
                side: input.side ?? null,
                presetId,
                outputType: requestedOutputType,
                beltAngleDeg,
                stlStorageKey,
                useSavedDesignMesh: input.useSavedDesignMesh === true,
            });

            if (!presetId || !stlStorageKey) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Missing required manufacturing parameters (stlStorageKey, presetId)",
                });
            }

            const gyroidPreset = isGyroidManufacturingPreset(presetId);
            if (gyroidPreset && input.infillDensity !== undefined && !printRecipe) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                        "Legacy infillDensity is not accepted for gyroid manufacturing presets. " +
                        "Upgrade the design with PrintRecipeV1 (named hardness) and resend printRecipe.",
                });
            }

            let resolvedPrintRecipe: ReturnType<typeof migratePrintRecipe> | undefined;
            if (gyroidPreset) {
                try {
                    resolvedPrintRecipe = resolveGyroidManufacturingPrintRecipe(presetId, printRecipe);
                } catch (e) {
                    if (e instanceof PrintRecipeProfileRequiredError) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
                    }
                    throw e;
                }
                if (presetId !== resolvedPrintRecipe.profileId) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message:
                            "presetId must match PrintRecipeV1.profileId for production gyroid manufacturing.",
                    });
                }
            } else if (printRecipe) {
                resolvedPrintRecipe = migratePrintRecipe(printRecipe);
            }

            if (!cadOperator) {
                if (!ctx.user) {
                    throw new TRPCError({ code: "UNAUTHORIZED", message: "Authentication required" });
                }
                try {
                    assertManufacturingTempKeyForUser(stlStorageKey, ctx.user.id);
                } catch {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "Invalid manufacturing STL storage key",
                    });
                }
            }

            const tempStlKey = stlStorageKey;
            const supabase = getSupabaseAdmin();

            try {
                await assertActiveLicenseForUser(actorUserId);

                const cost = HYBRID_GCODE_COST;

                if (input.designId) {
                    const supabase = requireSupabaseAdmin();
                    const { data: design, error: designError } = await supabase
                        .from("designs")
                        .select("id")
                        .eq("id", input.designId)
                        .eq("ownerId", actorUserId)
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
                }

                const balance = await getUserTokenBalance(requireSupabaseAdmin(), actorUserId);
                if (balance < cost) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }

                let stlUrl = input.stlUrl;
                if (!stlUrl) {
                    if (!supabase) {
                        throw new TRPCError({
                            code: "INTERNAL_SERVER_ERROR",
                            message: "Storage not available",
                        });
                    }
                    stlUrl = await signedDownloadUrl(supabase, stlStorageKey, 3600, MANUFACTURING_BUCKET);
                }

                const jobStamp = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                let outputBytes: Buffer;
                let outputType: "gcode" | "stl";
                let jobId: string;
                let inlineGcode: string | undefined;
                let inlineStl: string | undefined;

                if (manufacturingBackendForOutput(requestedOutputType) === "vertexslice") {
                    if (!resolvedPrintRecipe) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message:
                                "Printer G-code requires PrintRecipe hardness so gyroid infill stays on the locked profile.",
                        });
                    }
                    const infillDensityPct = gyroidInfillPctForHardness(
                        resolvedPrintRecipe.defaultHardness,
                        resolvedPrintRecipe.hardnessToInfillPct,
                    );
                    const stlBytes = await downloadManufacturingStl(stlUrl);
                    const gcode = await sliceWithVertexSlice({
                        profileId: presetId,
                        material: material ?? "",
                        model: stlBytes,
                        filename: `${input.side ?? "model"}.stl`,
                        infillDensityPct,
                    });
                    outputBytes = Buffer.from(gcode, "utf-8");
                    outputType = "gcode";
                    jobId = `vs_${jobStamp}`;
                    inlineGcode = gcode;
                } else {
                    const pythonResult = await callManufacture({
                        job_id: jobStamp,
                        design_id: input.designId ?? "adhoc",
                        preset_id: presetId,
                        stl_url: stlUrl,
                        output_type: requestedOutputType,
                        belt_angle_deg: beltAngleDeg,
                        side: input.side ?? null,
                        layer_height_mm: input.layerHeightMm,
                        infill_density: resolvedPrintRecipe ? undefined : input.infillDensity,
                        perimeters: input.perimeters,
                        grinding_style: input.grindingStyle,
                        print_recipe: resolvedPrintRecipe
                            ? printRecipeToSnake(resolvedPrintRecipe)
                            : undefined,
                        ...(material ? { material } : {}),
                    });
                    outputType = pythonResult.output_type ?? requestedOutputType;
                    inlineGcode = pythonResult.gcode;
                    inlineStl = pythonResult.stl_base64;
                    jobId = pythonResult.job_id ?? jobStamp;
                    outputBytes =
                        outputType === "gcode"
                            ? Buffer.from(pythonResult.gcode ?? "", "utf-8")
                            : Buffer.from(pythonResult.stl_base64 ?? "", "base64");
                }

                const isGcode = outputType === "gcode";
                if (cadOperator && !isGcode) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: "CAD-operator manufacturing returns G-code only",
                    });
                }
                const exportFormat = isGcode ? "gcode" : "stl";

                if (outputBytes.length === 0) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: "Manufacturing service returned empty output",
                    });
                }

                const defaultName = isGcode ? `hybrid-${presetId}.gcode` : `hybrid-${presetId}.stl`;
                const safeName = (input.fileName || defaultName).replace(/[^a-zA-Z0-9_.-]/g, "_");
                const storagePrefix = isGcode ? "gcode" : "manufacturing-output";
                const storageKey =
                    cadOperator && input.designId
                        ? buildCadOperatorGcodeKey(
                              cadOperator.credentialId,
                              input.designId,
                              `${Date.now()}-${safeName}`,
                          )
                        : `${storagePrefix}/${input.designId || "adhoc"}/${Date.now()}-${safeName}`;
                const contentType = isGcode ? "text/plain" : "model/stl";

                // License re-check + token deduction happen atomically via RPC BEFORE output upload.
                if (!supabase) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: "Supabase admin client not configured",
                    });
                }

                const { data: chargeData, error: chargeError } = await supabase.rpc(
                    "vertex_charge_manufacturing_hybrid",
                    {
                        p_user_id: actorUserId,
                        p_cost: cost,
                        p_design_id: input.designId ?? null,
                        p_export_format: exportFormat,
                        p_side: input.side ?? null,
                        p_file_name: safeName,
                        p_preset_id: presetId,
                        p_belt_angle_deg: beltAngleDeg,
                        p_layer_height_mm: input.layerHeightMm ?? null,
                        p_is_gcode: isGcode,
                        p_storage_key: isGcode ? storageKey : null,
                        p_job_id: jobId,
                        p_ip: ctx.ip,
                        p_metadata: {
                            kind: "manufacturing_hybrid",
                            outputType,
                            presetId,
                            beltAngleDeg,
                            grindingStyle: input.grindingStyle?.type ?? null,
                            material: material ?? null,
                            manufacturingFingerprint,
                            cadOperatorCredentialId: cadOperator?.credentialId ?? null,
                            slicer: isGcode ? "vertexslice" : "python",
                            side: input.side ?? null,
                            layerHeightMm: input.layerHeightMm ?? null,
                            infillDensity: resolvedPrintRecipe ? null : (input.infillDensity ?? null),
                            printRecipe: resolvedPrintRecipe ?? null,
                            perimeters: input.perimeters ?? null,
                            sourceStlTempKey: tempStlKey,
                        },
                    },
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

                const result = chargeData as {
                    productionId: string | null;
                    exportId: string;
                    balance: number;
                    jobId: string;
                };

                let downloadUrl: string | undefined;
                if (supabase) {
                    await uploadAsset(supabase, storageKey, outputBytes, contentType, MANUFACTURING_BUCKET);
                    downloadUrl = await signedDownloadUrl(supabase, storageKey, 3600, MANUFACTURING_BUCKET);
                    await supabase.from("exports").update({ storageKey }).eq("id", result.exportId);
                    if (result.productionId && isGcode) {
                        await supabase
                            .from("productions")
                            .update({ gcodeStorageKey: storageKey })
                            .eq("id", result.productionId);
                    }
                }

                if (supabase) {
                    await archiveManufacturingSourceStl(supabase, {
                        userId: actorUserId,
                        exportId: result.exportId,
                        tempStlKey,
                    });
                }

                console.log("[manufacturing] generateSolid success", {
                    userId: actorUserId,
                    productionId: result.productionId,
                    exportId: result.exportId,
                    balance: result.balance,
                    outputType,
                    stored: Boolean(downloadUrl),
                });

                return {
                    ok: true as const,
                    outputType,
                    ...result,
                    downloadUrl,
                    gcode: isGcode && !downloadUrl ? inlineGcode : undefined,
                    stlBase64: cadOperator || isGcode || downloadUrl ? undefined : inlineStl,
                    gcodeDownloadUrl: isGcode ? downloadUrl : undefined,
                };
            } catch (err) {
                deleteManufacturingTempBestEffort(supabase, tempStlKey);
                throw err;
            }
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
