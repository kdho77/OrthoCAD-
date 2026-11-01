import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
    isGyroidManufacturingPreset,
    migratePrintRecipe,
    PrintRecipeProfileRequiredError,
    printRecipeToSnake,
    printRecipeV1Schema,
    resolveGyroidManufacturingPrintRecipe,
} from "../../../shared/print-recipe/print-recipe.js";
import { isCncProcess, SLICE_TOKEN_COST } from "../../../shared/slice-job.js";
import { getSupabaseAdmin } from "../context.js";
import { callManufacture } from "../lib/manufacturing-client.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "../lib/manufacturing-stl-lifecycle.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import { enqueueSlice, readSliceForUser, SliceJobNotFoundError } from "../lib/slice-orchestrator.js";
import { createProductionSliceRuntime } from "../lib/slice-supabase.js";
import {
    assertManufacturingTempKeyForUser,
    buildManufacturingTempStlKey,
    createSignedUpload,
    MANUFACTURING_BUCKET,
    signedDownloadUrl,
    uploadAsset,
} from "../lib/storage.js";
import { assertActiveLicense, getUserTokenBalance, requireSupabaseAdmin } from "../lib/supabase-db.js";
import { getManufacturingSlicer } from "../lib/vertexslice-client.js";
import { protectedProcedure, rateLimitedProcedure, router } from "../trpc.js";

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
    idempotencyKey: z.string().uuid().optional(),
});

const startSliceInputSchema = z
    .object({
        designId: z.string().uuid().optional(),
        stlUrl: z.string().url().optional(),
        stlStorageKey: z.string().min(1).optional(),
        profileId: z.string().min(1).optional(),
        material: z.string().min(1).optional(),
        side: z.enum(["left", "right"]).optional(),
        idempotencyKey: z.string().uuid(),
        process: z.string().max(80).optional(),
        fileName: z.string().max(200).optional(),
        printRecipe: printRecipeV1Schema.optional(),
        beltAngleDeg: z.number().min(10).max(80).optional(),
        layerHeightMm: z.number().min(0.05).max(1).optional(),
        perimeters: z.number().int().min(1).max(10).optional(),
        grindingStyle: grindingStyleSchema.optional(),
    })
    .superRefine((val, ctx) => {
        if (!val.designId && !val.stlUrl && !val.stlStorageKey) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "designId or stlUrl is required" });
        }
        if (!val.stlUrl && !val.stlStorageKey) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "stlUrl or stlStorageKey is required" });
        }
        if (!val.profileId && !val.material) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "material or profileId is required" });
        }
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

export const manufacturingRouter = router({
    /**
     * Browser uploads the STL directly to Storage via a signed URL so the JSON
     * tRPC payload never carries multi-MB base64 (that 413'd as "Request Entity Too Large"
     * and the client then showed 0 tokens after auth refresh).
     */
    prepareManufacturingStlUpload: rateLimitedProcedure(RATE_LIMITS.export, "manufacturing:prepareStl")
        .input(
            z.object({
                side: z.enum(["left", "right"]),
                fileName: z.string().max(200).optional(),
            }),
        )
        .mutation(async ({ ctx }) => {
            await assertActiveLicenseForUser(ctx.user.id);

            const supabase = getSupabaseAdmin();
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

    generateSolid: rateLimitedProcedure(RATE_LIMITS.export, "manufacturing:generateSolid")
        .input(manufactureInputSchema)
        .mutation(async ({ ctx, input }) => {
            console.log("[manufacturing] generateSolid request", {
                userId: ctx.user.id,
                designId: input.designId ?? null,
                side: input.side ?? null,
                presetId: input.presetId,
                outputType: input.outputType,
                beltAngleDeg: input.beltAngleDeg,
                stlStorageKey: input.stlStorageKey,
            });

            if (!input.presetId || !input.stlStorageKey) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Missing required manufacturing parameters (stlStorageKey, presetId)",
                });
            }

            const gyroidPreset = isGyroidManufacturingPreset(input.presetId);
            if (gyroidPreset && input.infillDensity !== undefined && !input.printRecipe) {
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
                    resolvedPrintRecipe = resolveGyroidManufacturingPrintRecipe(
                        input.presetId,
                        input.printRecipe,
                    );
                } catch (e) {
                    if (e instanceof PrintRecipeProfileRequiredError) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
                    }
                    throw e;
                }
                if (input.presetId !== resolvedPrintRecipe.profileId) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message:
                            "presetId must match PrintRecipeV1.profileId for production gyroid manufacturing.",
                    });
                }
            } else if (input.printRecipe) {
                resolvedPrintRecipe = migratePrintRecipe(input.printRecipe);
            }

            try {
                assertManufacturingTempKeyForUser(input.stlStorageKey, ctx.user.id);
            } catch {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Invalid manufacturing STL storage key",
                });
            }

            const tempStlKey = input.stlStorageKey;
            const supabase = getSupabaseAdmin();

            try {
                await assertActiveLicenseForUser(ctx.user.id);

                const useVertexSlice =
                    input.outputType === "gcode" && getManufacturingSlicer() === "vertexslice";
                const cost = useVertexSlice ? SLICE_TOKEN_COST : HYBRID_GCODE_COST;

                if (input.designId) {
                    const supabase = requireSupabaseAdmin();
                    const { data: design, error: designError } = await supabase
                        .from("designs")
                        .select("id")
                        .eq("id", input.designId)
                        .eq("ownerId", ctx.user.id)
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

                const balance = await getUserTokenBalance(requireSupabaseAdmin(), ctx.user.id);
                if (balance < cost) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }

                if (useVertexSlice) {
                    if (!supabase) {
                        throw new TRPCError({
                            code: "INTERNAL_SERVER_ERROR",
                            message: "Supabase admin client not configured",
                        });
                    }
                    const runtime = createProductionSliceRuntime(supabase);
                    const job = await enqueueSlice(
                        {
                            userId: ctx.user.id,
                            idempotencyKey: input.idempotencyKey ?? randomUUID(),
                            designId: input.designId ?? null,
                            stlUrl: input.stlUrl ?? null,
                            stlStorageKey: tempStlKey,
                            profileId: input.presetId,
                            side: input.side ?? null,
                            fileName: input.fileName ?? null,
                            request: {
                                beltAngleDeg: input.beltAngleDeg,
                                layerHeightMm: input.layerHeightMm ?? null,
                                perimeters: input.perimeters ?? null,
                                grindingStyle: input.grindingStyle ?? null,
                                printRecipe: resolvedPrintRecipe ?? null,
                            },
                        },
                        runtime,
                        { wait: true },
                    );
                    const view = await readSliceForUser(job.id, ctx.user.id, runtime);
                    if (view.status !== "succeeded" || !view.downloadUrl) {
                        const denied =
                            view.error === "INSUFFICIENT_TOKENS" || view.error === "NO_VALID_LICENSE";
                        throw new TRPCError({
                            code: denied ? "FORBIDDEN" : "INTERNAL_SERVER_ERROR",
                            message:
                                view.error === "INSUFFICIENT_TOKENS"
                                    ? "Insufficient export tokens"
                                    : view.error === "NO_VALID_LICENSE"
                                      ? "No valid license"
                                      : view.error === "timeout"
                                        ? "Slice timed out"
                                        : view.error || "Slice failed",
                        });
                    }
                    console.log("[manufacturing] generateSolid vertexslice success", {
                        userId: ctx.user.id,
                        jobId: view.jobId,
                        productionId: view.productionId ?? null,
                        balance: view.balance ?? null,
                    });
                    return {
                        ok: true as const,
                        outputType: "gcode" as const,
                        productionId: view.productionId ?? null,
                        exportId: view.exportId ?? "",
                        balance: view.balance ?? 0,
                        jobId: view.jobId,
                        downloadUrl: view.downloadUrl,
                        gcodeDownloadUrl: view.downloadUrl,
                    };
                }

                let stlUrl = input.stlUrl;
                if (!stlUrl) {
                    if (!supabase) {
                        throw new TRPCError({
                            code: "INTERNAL_SERVER_ERROR",
                            message: "Storage not available",
                        });
                    }
                    stlUrl = await signedDownloadUrl(
                        supabase,
                        input.stlStorageKey,
                        3600,
                        MANUFACTURING_BUCKET,
                    );
                }

                const pythonResult = await callManufacture({
                    job_id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    design_id: input.designId ?? "adhoc",
                    preset_id: input.presetId,
                    stl_url: stlUrl,
                    output_type: input.outputType,
                    belt_angle_deg: input.beltAngleDeg,
                    side: input.side ?? null,
                    layer_height_mm: input.layerHeightMm,
                    infill_density: resolvedPrintRecipe ? undefined : input.infillDensity,
                    perimeters: input.perimeters,
                    grinding_style: input.grindingStyle,
                    print_recipe: resolvedPrintRecipe ? printRecipeToSnake(resolvedPrintRecipe) : undefined,
                });

                const outputType = pythonResult.output_type ?? input.outputType;
                const isGcode = outputType === "gcode";
                const exportFormat = isGcode ? "gcode" : "stl";

                const outputBytes = isGcode
                    ? Buffer.from(pythonResult.gcode ?? "", "utf-8")
                    : Buffer.from(pythonResult.stl_base64 ?? "", "base64");

                if (outputBytes.length === 0) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: "Manufacturing service returned empty output",
                    });
                }

                const defaultName = isGcode
                    ? `hybrid-${input.presetId}.gcode`
                    : `hybrid-${input.presetId}.stl`;
                const safeName = (input.fileName || defaultName).replace(/[^a-zA-Z0-9_.-]/g, "_");
                const storagePrefix = isGcode ? "gcode" : "manufacturing-output";
                const storageKey = `${storagePrefix}/${input.designId || "adhoc"}/${Date.now()}-${safeName}`;
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
                        p_user_id: ctx.user.id,
                        p_cost: cost,
                        p_design_id: input.designId ?? null,
                        p_export_format: exportFormat,
                        p_side: input.side ?? null,
                        p_file_name: safeName,
                        p_preset_id: input.presetId,
                        p_belt_angle_deg: input.beltAngleDeg,
                        p_layer_height_mm: input.layerHeightMm ?? null,
                        p_is_gcode: isGcode,
                        p_storage_key: isGcode ? storageKey : null,
                        p_job_id: pythonResult.job_id,
                        p_ip: ctx.ip,
                        p_metadata: {
                            kind: "manufacturing_hybrid",
                            outputType,
                            presetId: input.presetId,
                            beltAngleDeg: input.beltAngleDeg,
                            grindingStyle: input.grindingStyle?.type ?? null,
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
                        userId: ctx.user.id,
                        exportId: result.exportId,
                        tempStlKey,
                    });
                }

                console.log("[manufacturing] generateSolid success", {
                    userId: ctx.user.id,
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
                    gcode: isGcode && !downloadUrl ? pythonResult.gcode : undefined,
                    stlBase64: !isGcode && !downloadUrl ? pythonResult.stl_base64 : undefined,
                    gcodeDownloadUrl: isGcode ? downloadUrl : undefined,
                };
            } catch (err) {
                deleteManufacturingTempBestEffort(supabase, tempStlKey);
                throw err;
            }
        }),

    /**
     * Queue a G-code slice. Balance is checked here and not deducted.
     * The same idempotency key returns the existing job and never opens a second charge.
     */
    startSlice: rateLimitedProcedure(RATE_LIMITS.manufacturing, "manufacturing:startSlice")
        .input(startSliceInputSchema)
        .mutation(async ({ ctx, input }) => {
            if (isCncProcess(input.process)) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "CNC/milled orders are not sliced",
                });
            }
            await assertActiveLicenseForUser(ctx.user.id);
            if (input.stlStorageKey) {
                try {
                    assertManufacturingTempKeyForUser(input.stlStorageKey, ctx.user.id);
                } catch {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "Invalid manufacturing STL storage key",
                    });
                }
            }
            if (input.designId) {
                const supabase = requireSupabaseAdmin();
                const { data: design, error: designError } = await supabase
                    .from("designs")
                    .select("id")
                    .eq("id", input.designId)
                    .eq("ownerId", ctx.user.id)
                    .maybeSingle();
                if (designError) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to verify design ownership: ${designError.message}`,
                    });
                }
                if (!design) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Design not found or access denied" });
                }
            }

            const supabase = requireSupabaseAdmin();
            const runtime = createProductionSliceRuntime(supabase);
            const existing = await runtime.ledger.findByIdempotency(ctx.user.id, input.idempotencyKey);
            if (!existing) {
                const balance = await getUserTokenBalance(supabase, ctx.user.id);
                if (balance < SLICE_TOKEN_COST) {
                    deleteManufacturingTempBestEffort(supabase, input.stlStorageKey);
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }
            }

            let resolvedPrintRecipe: ReturnType<typeof migratePrintRecipe> | undefined;
            if (input.printRecipe) resolvedPrintRecipe = migratePrintRecipe(input.printRecipe);

            const job = await enqueueSlice(
                {
                    userId: ctx.user.id,
                    idempotencyKey: input.idempotencyKey,
                    designId: input.designId ?? null,
                    stlUrl: input.stlUrl ?? null,
                    stlStorageKey: input.stlStorageKey ?? null,
                    profileId: input.profileId ?? input.material ?? "apex-v2-insole-95a",
                    material: input.material ?? null,
                    side: input.side ?? null,
                    process: input.process ?? null,
                    fileName: input.fileName ?? null,
                    request: {
                        beltAngleDeg: input.beltAngleDeg ?? 45,
                        layerHeightMm: input.layerHeightMm ?? null,
                        perimeters: input.perimeters ?? null,
                        grindingStyle: input.grindingStyle ?? null,
                        printRecipe: resolvedPrintRecipe ?? null,
                    },
                },
                runtime,
            );
            return { jobId: job.id, status: job.status };
        }),

    sliceStatus: protectedProcedure
        .input(z.object({ jobId: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const runtime = createProductionSliceRuntime(supabase);
            let view: Awaited<ReturnType<typeof readSliceForUser>>;
            try {
                view = await readSliceForUser(input.jobId, ctx.user.id, runtime);
            } catch (err) {
                if (err instanceof SliceJobNotFoundError) {
                    throw new TRPCError({ code: "NOT_FOUND", message: err.message });
                }
                throw err;
            }
            return {
                status: view.status,
                error: view.error,
                downloadUrl: view.downloadUrl,
                productionId: view.productionId,
                balance: view.balance,
            };
        }),

    getGcodeDownloadUrl: protectedProcedure
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
