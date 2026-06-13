import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { callManufacture } from "../lib/manufacturing-client.js";
import {
    archiveManufacturingSourceStl,
    deleteManufacturingTempBestEffort,
} from "../lib/manufacturing-stl-lifecycle.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import {
    assertActiveLicense,
    getUserTokenBalance,
    requireSupabaseAdmin,
} from "../lib/supabase-db.js";
import {
    assertManufacturingTempKeyForUser,
    buildManufacturingTempStlKey,
    MANUFACTURING_BUCKET,
    signedDownloadUrl,
    uploadAsset,
} from "../lib/storage.js";
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
    stlUrl: z.string().url(),
    stlStorageKey: z.string().min(1),
    outputType: z.enum(["gcode", "stl"]),
    beltAngleDeg: z.number().min(10).max(80).default(45),
    layerHeightMm: z.number().min(0.05).max(1).optional(),
    infillDensity: z.number().min(0).max(1).optional(),
    perimeters: z.number().int().min(1).max(10).optional(),
    grindingStyle: grindingStyleSchema.optional(),
    fileName: z.string().max(200).optional(),
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

            if (!input.presetId || !input.stlUrl || !input.stlStorageKey) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Missing required manufacturing parameters (stlUrl, stlStorageKey, presetId)",
                });
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

                const cost = HYBRID_GCODE_COST;

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

                const pythonResult = await callManufacture({
                    job_id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    design_id: input.designId ?? "adhoc",
                    preset_id: input.presetId,
                    stl_url: input.stlUrl,
                    output_type: input.outputType,
                    belt_angle_deg: input.beltAngleDeg,
                    side: input.side ?? null,
                    layer_height_mm: input.layerHeightMm,
                    infill_density: input.infillDensity,
                    perimeters: input.perimeters,
                    grinding_style: input.grindingStyle,
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
                            infillDensity: input.infillDensity ?? null,
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
