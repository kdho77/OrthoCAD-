import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { callManufacture } from "../lib/manufacturing-client.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import { signedDownloadUrl, uploadAsset } from "../lib/storage.js";
import { protectedProcedure, rateLimitedProcedure, router } from "../trpc.js";

const HYBRID_GCODE_COST = 3;

const grindingStyleSchema = z.object({
    type: z.enum(["straight", "rounded"]),
    angle_degrees: z.number().optional(),
    radius_mm: z.number().optional(),
});

const manufactureInputSchema = z.object({
    designId: z.string().uuid().optional(),
    side: z.enum(["left", "right"]).optional(),
    presetId: z.string().min(1),
    beltAngleDeg: z.number().min(10).max(80).default(45),
    corrections: z.record(z.any()),
    trimlines: z.record(z.any()),
    thicknessMm: z.number(),
    heelLiftMm: z.number().default(0),
    heelCupWidthMm: z.number().default(0),
    grindingStyle: grindingStyleSchema,
    baseGlbUrl: z.string().url().optional(),
    baseAssetId: z.string().optional(),
    fileName: z.string().max(200).optional(),
});

export const manufacturingRouter = router({
    generateSolid: rateLimitedProcedure(RATE_LIMITS.export, "manufacturing:generateSolid")
        .input(manufactureInputSchema)
        .mutation(async ({ ctx, input }) => {
            console.log("[manufacturing] generateSolid request", {
                userId: ctx.user.id,
                designId: input.designId ?? null,
                side: input.side ?? null,
                presetId: input.presetId,
                beltAngleDeg: input.beltAngleDeg,
                grindingStyle: input.grindingStyle.type,
                hasBaseGlbUrl: Boolean(input.baseGlbUrl),
                baseAssetId: input.baseAssetId ?? null,
            });

            // License validation
            const now = new Date();
            const license = await ctx.prisma.license.findFirst({
                where: {
                    status: "active",
                    OR: [{ ownerId: ctx.user.id }, { seatList: { some: { userId: ctx.user.id } } }],
                    AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
                },
            });
            if (!license) {
                throw new TRPCError({ code: "FORBIDDEN", message: "No valid license" });
            }

            if (!input.presetId || !input.corrections || typeof input.thicknessMm !== "number") {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Missing required manufacturing parameters",
                });
            }

            const cost = HYBRID_GCODE_COST;
            const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
            if ((user.tokenBalance ?? 0) < cost) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
            }

            if (input.designId) {
                const design = await ctx.prisma.design.findFirst({
                    where: { id: input.designId, ownerId: ctx.user.id },
                });
                if (!design) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Design not found or access denied" });
                }
            }

            let baseGlbUrl = input.baseGlbUrl;
            let baseSource: "server" | "client" | "synthetic" = input.baseAssetId
                ? "server"
                : input.baseGlbUrl
                  ? "client"
                  : "synthetic";
            let baseResolvedServerSide = baseSource === "server";

            if (input.baseAssetId) {
                const supabase = getSupabaseAdmin();
                if (supabase) {
                    const prefab = await ctx.prisma.customPrefab.findFirst({
                        where: { id: input.baseAssetId, userId: ctx.user.id },
                    });
                    if (prefab && prefab.glbPath) {
                        try {
                            baseGlbUrl = await signedDownloadUrl(supabase, prefab.glbPath);
                            baseResolvedServerSide = true;
                            baseSource = "server";
                        } catch {
                            if (!input.baseGlbUrl) {
                                throw new TRPCError({
                                    code: "INTERNAL_SERVER_ERROR",
                                    message: "Failed to generate signed URL for base GLB",
                                });
                            }
                            baseSource = "client";
                        }
                    } else {
                        if (!input.baseGlbUrl) {
                            throw new TRPCError({
                                code: "FORBIDDEN",
                                message: "Base GLB asset not found or access denied",
                            });
                        }
                        baseSource = "client";
                    }
                } else {
                    if (!input.baseGlbUrl) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "Server cannot resolve base GLB",
                        });
                    }
                    baseSource = "client";
                }
            }

            if (!baseGlbUrl) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message:
                        "No base GLB URL available. Select a stock or custom base before generating hybrid G-code.",
                });
            }

            // Run the authoritative pipeline on the Python microservice:
            // watertight solid (Grinding Style sides) + belt pre-transform + slicing.
            // Throws on any failure so tokens are NOT deducted below.
            const pythonResult = await callManufacture({
                job_id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                design_id: input.designId ?? "adhoc",
                preset_id: input.presetId,
                base_glb_url: baseGlbUrl,
                corrections: input.corrections,
                trimlines: input.trimlines,
                heel_lift_mm: input.heelLiftMm,
                heel_cup_width_mm: input.heelCupWidthMm,
                grinding_style: input.grindingStyle,
                thickness_mm: input.thicknessMm,
                belt_angle_deg: input.beltAngleDeg,
                side: input.side ?? null,
            });

            let gcodeStorageKey: string | null = null;
            let gcodeDownloadUrl: string | undefined;

            const supabase = getSupabaseAdmin();
            if (supabase && pythonResult.gcode) {
                try {
                    const gcodeBytes = Buffer.from(pythonResult.gcode, "utf-8");
                    const safeName = (input.fileName || `hybrid-${input.presetId || "print"}.gcode`).replace(
                        /[^a-zA-Z0-9_.-]/g,
                        "_",
                    );
                    const key = `gcode/${input.designId || "adhoc"}/${Date.now()}-${safeName}`;
                    const uploadRes = await uploadAsset(supabase, key, gcodeBytes, "text/plain");
                    gcodeStorageKey = uploadRes.key;
                    gcodeDownloadUrl = await signedDownloadUrl(supabase, gcodeStorageKey, 3600);
                } catch (uploadErr: any) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to store generated G-code: ${uploadErr?.message || uploadErr}`,
                    });
                }
            }

            // Interactive transactions use prepared statements; route them through the
            // direct Postgres client to avoid PgBouncer "prepared statement already exists".
            const result = await ctx.prismaDirect.$transaction(async (tx) => {
                const dec = await tx.user.updateMany({
                    where: { id: ctx.user.id, tokenBalance: { gte: cost } },
                    data: { tokenBalance: { decrement: cost } },
                });
                if (dec.count === 0) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }
                const updatedUser = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });

                // Production rows require a real design FK (productions.designId is
                // non-nullable). Ad-hoc generations (no persisted design) skip the
                // Production row but still record the Export + token transaction.
                let productionId: string | null = null;
                if (input.designId) {
                    const production = await tx.production.create({
                        data: {
                            designId: input.designId,
                            method: "printing_solid",
                            presetId: input.presetId,
                            beltAngleDeg: input.beltAngleDeg,
                            layerHeightMm: 0.3,
                            material: "TPU",
                            gcodeStorageKey,
                        },
                    });
                    productionId = production.id;
                }

                const exp = await tx.export.create({
                    data: {
                        designId: input.designId ?? null,
                        userId: ctx.user.id,
                        format: "gcode",
                        side: input.side ?? null,
                        tokenCost: cost,
                        storageKey: gcodeStorageKey,
                        fileName: input.fileName ?? `hybrid-${input.presetId}.gcode`,
                    },
                });

                await tx.tokenTransaction.create({
                    data: {
                        userId: ctx.user.id,
                        type: "deduct",
                        amount: -cost,
                        balance: updatedUser.tokenBalance,
                        reason: "manufacturing:hybrid_gcode",
                        exportId: exp.id,
                    },
                });

                await tx.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "export_generated",
                        targetId: productionId ?? exp.id,
                        metadata: {
                            kind: "manufacturing_hybrid_gcode",
                            presetId: input.presetId,
                            beltAngleDeg: input.beltAngleDeg,
                            grindingStyle: input.grindingStyle.type,
                            side: input.side ?? null,
                            baseResolvedServerSide,
                            baseSource,
                        },
                        ipAddress: ctx.ip,
                    },
                });

                return {
                    productionId,
                    exportId: exp.id,
                    balance: updatedUser.tokenBalance,
                    jobId: pythonResult.job_id,
                    gcodeDownloadUrl,
                };
            });

            console.log("[manufacturing] generateSolid success", {
                userId: ctx.user.id,
                productionId: result.productionId,
                exportId: result.exportId,
                balance: result.balance,
                stored: Boolean(gcodeDownloadUrl),
            });

            // When object storage is unavailable, return the raw G-code so the
            // client can still download it (no persisted download URL).
            return {
                ok: true as const,
                ...result,
                gcode: gcodeDownloadUrl ? undefined : pythonResult.gcode,
            };
        }),

    getGcodeDownloadUrl: protectedProcedure
        .input(z.object({ productionId: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            const production = await ctx.prisma.production.findFirst({
                where: { id: input.productionId },
                include: { design: true },
            });
            if (!production || !production.design || production.design.ownerId !== ctx.user.id) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Production not found or access denied" });
            }
            if (!production.gcodeStorageKey) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "No G-code file stored for this production",
                });
            }
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }
            const downloadUrl = await signedDownloadUrl(supabase, production.gcodeStorageKey, 3600);
            return { downloadUrl, productionId: production.id };
        }),
});
