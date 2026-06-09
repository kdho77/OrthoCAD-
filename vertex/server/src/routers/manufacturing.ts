import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RATE_LIMITS } from "../lib/rate-limit";
import { protectedProcedure, rateLimitedProcedure, router } from "../trpc";
import { getSupabaseAdmin } from "../context";
import { signedDownloadUrl, uploadAsset } from "../lib/storage";

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
            const pythonUrl = process.env.PYTHON_MANUFACTURING_URL || "http://localhost:8001";

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
                throw new TRPCError({ code: "BAD_REQUEST", message: "Missing required manufacturing parameters" });
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
            let baseSource: 'server' | 'client' | 'synthetic' = input.baseAssetId ? 'server' : (input.baseGlbUrl ? 'client' : 'synthetic');
            let baseResolvedServerSide = baseSource === 'server';

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
                            baseSource = 'server';
                        } catch {
                            if (!input.baseGlbUrl) {
                                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to generate signed URL for base GLB" });
                            }
                            baseSource = 'client';
                        }
                    } else {
                        if (!input.baseGlbUrl) {
                            throw new TRPCError({ code: "FORBIDDEN", message: "Base GLB asset not found or access denied" });
                        }
                        baseSource = 'client';
                    }
                } else {
                    if (!input.baseGlbUrl) {
                        throw new TRPCError({ code: "BAD_REQUEST", message: "Server cannot resolve base GLB" });
                    }
                    baseSource = 'client';
                }
            }

            const pythonPayload = {
                job_id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                design_id: input.designId ?? "unknown",
                preset_id: input.presetId,
                base_glb_url: baseGlbUrl ?? "file://synthetic",
                corrections: input.corrections,
                trimlines: input.trimlines,
                heel_lift_mm: input.heelLiftMm,
                heel_cup_width_mm: input.heelCupWidthMm,
                grinding_style: input.grindingStyle,
                thickness_mm: input.thicknessMm,
                belt_angle_deg: input.beltAngleDeg,
                side: input.side ?? null,
            };

            let pythonResult: any;
            try {
                const resp = await fetch(`${pythonUrl}/manufacture`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(pythonPayload),
                });
                if (!resp.ok) {
                    const text = await resp.text().catch(() => "");
                    throw new Error(`Python service error (${resp.status}): ${text || resp.statusText}`);
                }
                pythonResult = await resp.json();
            } catch (err: any) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Hybrid manufacturing failed: ${err?.message ?? err}`,
                });
            }

            if (!pythonResult?.ok || !pythonResult?.gcode) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: pythonResult?.error || "Python service did not return valid G-code",
                });
            }

            let gcodeStorageKey: string | null = null;
            let gcodeDownloadUrl: string | undefined;

            const supabase = getSupabaseAdmin();
            if (supabase && pythonResult.gcode) {
                try {
                    const gcodeBytes = Buffer.from(pythonResult.gcode, 'utf-8');
                    const safeName = (input.fileName || `hybrid-${input.presetId || 'print'}.gcode`).replace(/[^a-zA-Z0-9_.-]/g, '_');
                    const key = `gcode/${input.designId || 'adhoc'}/${Date.now()}-${safeName}`;
                    const uploadRes = await uploadAsset(supabase, key, gcodeBytes, 'text/plain');
                    gcodeStorageKey = uploadRes.key;
                    gcodeDownloadUrl = await signedDownloadUrl(supabase, gcodeStorageKey, 3600);
                } catch (uploadErr: any) {
                    throw new TRPCError({
                        code: "INTERNAL_SERVER_ERROR",
                        message: `Failed to store generated G-code: ${uploadErr?.message || uploadErr}`,
                    });
                }
            }

            const result = await ctx.prisma.$transaction(async (tx) => {
                const dec = await tx.user.updateMany({
                    where: { id: ctx.user.id, tokenBalance: { gte: cost } },
                    data: { tokenBalance: { decrement: cost } },
                });
                if (dec.count === 0) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }
                const updatedUser = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });

                const production = await tx.production.create({
                    data: {
                        designId: input.designId ?? null,
                        method: "hybrid_belt",
                        presetId: input.presetId,
                        beltAngleDeg: input.beltAngleDeg,
                        layerHeightMm: 0.3,
                        material: "TPU",
                        gcodeStorageKey,
                    },
                });

                const exp = await tx.export.create({
                    data: {
                        designId: input.designId ?? null,
                        userId: ctx.user.id,
                        format: "gcode",
                        side: input.side ?? null,
                        tokenCost: cost,
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
                        action: "manufacturing_generated",
                        targetId: production.id,
                        metadata: {
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
                    productionId: production.id,
                    exportId: exp.id,
                    balance: updatedUser.tokenBalance,
                    jobId: pythonResult.job_id,
                    gcodeDownloadUrl,
                };
            });

            return { ok: true as const, ...result };
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
                throw new TRPCError({ code: "NOT_FOUND", message: "No G-code file stored for this production" });
            }
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Storage not available" });
            }
            const downloadUrl = await signedDownloadUrl(supabase, production.gcodeStorageKey, 3600);
            return { downloadUrl, productionId: production.id };
        }),
});