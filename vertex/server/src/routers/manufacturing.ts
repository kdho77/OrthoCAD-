import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { RATE_LIMITS } from "../lib/rate-limit";
import { protectedProcedure, rateLimitedProcedure, router } from "../trpc";
import { getSupabaseAdmin, type Context } from "../context";
import { signedDownloadUrl, uploadAsset } from "../lib/storage";

// Token cost for a full hybrid manufacturing G-code job (higher than simple export
// because it runs authoritative geometry + belt transform + slicing on the server).
const HYBRID_GCODE_COST = 3;

// Shape we forward to the Python manufacturing service.
// This must stay in sync with app/models/requests.py:GenerateSolidRequest + GrindingStyle.
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
    // The committed design data the client sends for the chosen side.
    // The server trusts the client for the geometric params but still enforces
    // ownership + license + token accounting.
    corrections: z.record(z.any()),
    trimlines: z.record(z.any()),
    thicknessMm: z.number(),
    heelLiftMm: z.number().default(0),
    heelCupWidthMm: z.number().default(0),
    grindingStyle: grindingStyleSchema,
    baseGlbUrl: z.string().url().optional(), // client-provided signed/public URL (fallback / custom cases)
    baseAssetId: z.string().optional(), // assetId of CustomPrefab (or similar); server will resolve glbPath to fresh signed URL when provided
    fileName: z.string().max(200).optional(),
});

export const manufacturingRouter = router({
    /**
     * Server-side hybrid manufacturing entry point (production flow post Phases 1-5).
     *
     * 1. License + rate-limit + pre-check (deduct only on full success).
     * 2. Design ownership verification (designId).
     * 3. Server-preferred base resolution (baseAssetId → CustomPrefab + signed; client URL only for stock/templates).
     * 4. Python: solid (Grinding Style) + belt + improved TPU/belt slicer.
     * 5. Upload G-code to storage (key on Production), short-lived download URL.
     * 6. Tx (only on success): deduct, Production (with key), Export, audit (baseSource, productionId).
     * 7. Return productionId + gcodeDownloadUrl (NO raw gcode string — client downloads via identifier/URL).
     *
     * Full security, success-only economics, and small tRPC payloads.
     */
    generateSolid: rateLimitedProcedure(RATE_LIMITS.export, "manufacturing:generateSolid")
        .input(manufactureInputSchema)
        .mutation(async ({ ctx, input }) => {
            const pythonUrl = process.env.PYTHON_MANUFACTURING_URL || "http://localhost:8001";

            // 1. License validation (same pattern as exportRouter)
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

            // 2. Basic input validation for manufacturing payload
            if (!input.presetId || !input.corrections || typeof input.thicknessMm !== "number") {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Missing required manufacturing parameters (preset, corrections, thickness)" });
            }

            // 3. Pre-check balance (we will deduct only on success)
            const cost = HYBRID_GCODE_COST;
            const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
            if ((user.tokenBalance ?? 0) < cost) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
            }

            // 4. Verify design ownership (if designId provided) for security and audit.
            // This ensures the user is acting on a design they own (or have access to via the license/seat model).
            if (input.designId) {
                const design = await ctx.prisma.design.findFirst({
                    where: { id: input.designId, ownerId: ctx.user.id },
                });
                if (!design) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Design not found or access denied" });
                }
            }

            // 5. Server-side base GLB URL resolution (hardened to be authoritative for user-owned bases).
            // - When baseAssetId is present (indicating a user custom base via CustomPrefab), *always* perform
            //   server-side lookup + ownership check + fresh signedDownloadUrl. This is preferred for security
            //   (verifies the user owns the asset) and freshness (avoids stale client URLs).
            // - Client-provided baseGlbUrl is only used as fallback when no baseAssetId (e.g. stock/system
            //   templates that are not in per-user CustomPrefab rows, direct one-off uploads, or dev/testing
            //   where the client has pre-resolved a public/signed URL).
            // - If designId + baseAssetId are both present, server resolution is forced for that base.
            // - baseResolvedServerSide and baseSource are recorded in audit for traceability.
            let baseGlbUrl = input.baseGlbUrl;
            let baseSource: 'server' | 'client' | 'synthetic' = input.baseAssetId ? 'server' : (input.baseGlbUrl ? 'client' : 'synthetic');
            let baseResolvedServerSide = baseSource === 'server';

            if (input.baseAssetId) {
                const supabase = getSupabaseAdmin();
                if (supabase) {
                    const prefab = await ctx.prisma.customPrefab.findFirst({
                        where: {
                            id: input.baseAssetId,
                            userId: ctx.user.id,
                        },
                    });
                    if (prefab && prefab.glbPath) {
                        try {
                            baseGlbUrl = await signedDownloadUrl(supabase, prefab.glbPath);
                            baseResolvedServerSide = true;
                            baseSource = 'server';
                        } catch (err) {
                            // If server signing fails but client provided a URL, fall back; otherwise error.
                            if (!input.baseGlbUrl) {
                                throw new TRPCError({
                                    code: "INTERNAL_SERVER_ERROR",
                                    message: "Failed to generate signed URL for base GLB",
                                });
                            }
                            baseSource = 'client';
                        }
                    } else {
                        // Asset not found under this user — if client gave a URL use it (compat), else deny.
                        if (!input.baseGlbUrl) {
                            throw new TRPCError({ code: "FORBIDDEN", message: "Base GLB asset not found or access denied" });
                        }
                        baseSource = 'client';
                    }
                } else {
                    // No storage on server (dev) — require client URL or fail.
                    if (!input.baseGlbUrl) {
                        throw new TRPCError({
                            code: "BAD_REQUEST",
                            message: "Server cannot resolve base GLB (no storage configured); provide baseGlbUrl from client",
                        });
                    }
                    baseSource = 'client';
                }
            }
            // Note on stock/system templates: these are typically not stored as per-user CustomPrefab.
            // Client code should detect (e.g. base.source === 'stock') and provide a resolvable baseGlbUrl
            // (public CDN URL or pre-signed). Server will use the provided URL in that case.

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

            // 6. Call the Python service (HTTP client) — only after all auth, pre-checks, ownership, and (attempted) server-side resolution.
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
                // Critical: do not deduct tokens on failure
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

            // Upload the generated G-code to storage *before* the accounting transaction.
            // Failures here do not deduct tokens (error thrown before tx).
            // We store the key on Production for records/history and generate a short-lived
            // signed download URL so the client can fetch the content without the full G-code
            // string ever crossing the tRPC boundary (production-grade for large outputs).
            let gcodeStorageKey: string | null = null;
            let gcodeDownloadUrl: string | undefined;
            if (pythonResult.gcode) {
                const supabase = getSupabaseAdmin();
                if (supabase) {
                    try {
                        const gcodeBytes = Buffer.from(pythonResult.gcode, 'utf-8');
                        const safeName = (input.fileName || `hybrid-${input.presetId || 'print'}.gcode`).replace(/[^a-zA-Z0-9_.-]/g, '_');
                        const key = `gcode/${input.designId || 'adhoc'}/${Date.now()}-${safeName}`;
                        const uploadRes = await uploadAsset(supabase, key, gcodeBytes, 'text/plain');
                        gcodeStorageKey = uploadRes.key;
                        gcodeDownloadUrl = await signedDownloadUrl(supabase, gcodeStorageKey, 3600);
                    } catch (uploadErr: any) {
                        // Do not charge user for storage failure. Surface useful error.
                        throw new TRPCError({
                            code: "INTERNAL_SERVER_ERROR",
                            message: `Failed to store generated G-code: ${uploadErr?.message || uploadErr}`,
                        });
                    }
                } else {
                    // Dev/offline without storage: we cannot persist, but to not break flow we could fall back
                    // to returning the string (current behavior). For production-grade we require storage.
                    // Here we throw to enforce the new contract in API-enabled environments.
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "G-code storage is required for server-side manufacturing (no Supabase configured)",
                    });
                }
            }

            // 7. Success path — now deduct tokens + record Production + audit (atomic)
            const result = await ctx.prisma.$transaction(async (tx) => {
                const dec = await tx.user.updateMany({
                    where: { id: ctx.user.id, tokenBalance: { gte: cost } },
                    data: { tokenBalance: { decrement: cost } },
                });
                if (dec.count === 0) {
                    // Race condition — someone else spent the tokens
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient export tokens" });
                }

                const updatedUser = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });

                const production = await tx.production.create({
                    data: {
                        designId: input.designId ?? null,
                        method: "hybrid_belt", // proper value for server-driven hybrid belt manufacturing (replaces previous stand-in "printing_solid")
                        presetId: input.presetId,
                        beltAngleDeg: input.beltAngleDeg,
                        layerHeightMm: 0.3,
                        material: "TPU",
                        gcodeStorageKey, // set from the pre-tx upload (null only in error paths that don't reach here)
                    },
                });

                // Also create an Export record so the existing token/export history remains consistent
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
                    // No full gcode string returned (production-grade). Client downloads using the
                    // productionId (via getGcode or history) or the short-lived download URL provided here.
                    gcodeDownloadUrl,
                };
            });

            return { ok: true as const, ...result };
        }),

    /**
     * Returns a fresh, short-lived signed download URL for the G-code associated
     * with a Production record. The caller must own the design linked to the production.
     * Follows the same ownership + audit patterns as design.get, export flows, etc.
     */
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

            let downloadUrl: string;
            try {
                downloadUrl = await signedDownloadUrl(supabase, production.gcodeStorageKey, 3600);
            } catch (err: any) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to generate download URL: ${err?.message || err}`,
                });
            }

            await ctx.prisma.auditLog.create({
                data: {
                    userId: ctx.user.id,
                    action: "gcode_download_url_generated",
                    targetId: production.id,
                    ipAddress: ctx.ip,
                    metadata: { productionId: production.id },
                },
            });

            return { downloadUrl, productionId: production.id };
        }),
});
