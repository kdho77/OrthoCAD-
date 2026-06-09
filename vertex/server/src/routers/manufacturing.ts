// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

/**
 * Manufacturing / authoritative solid + CAM router.
 *
 * This is the server-side home for high-fidelity "hybrid" generation paths
 * (e.g. loaded stock base + OCCT solid + CAM) that benefit from having the
 * full persisted design state and being able to record precise audit context.
 */
export const manufacturingRouter = router({
    /**
     * Server-authoritative solid generation / hybrid CAM entry point.
     *
     * Node (this tRPC procedure) responsibilities (orchestrator):
     *  - License / balance pre-check (before expensive Python work).
     *  - Enrich/load authoritative data from DB using designId (corrections, elements, method, thickness).
     *  - Forward rich payload (including client-sent baseAssetId, trimlines, corrections, overrides) to Python.
     *  - On Python success ONLY: guarded token deduct + create Production, Export, TokenTransaction, rich AuditLog.
     *  - Return G-code directly (for client download) + stats + productionId.
     *
     * Python service responsibilities (geometry/CAM engine):
     *  - solid_generator (Base + Modifier or stock base + modifiers) → watertight solid.
     *  - belt_transformer (if belt preset).
     *  - slicer → G-code + stats.
     *
     * Response shape decision: Return { ok, gcode, stats, designId, productionId? }.
     * - G-code directly (not just productionId) for immediate compatibility with the client
     *   generateHybridGcode helper (which does `new Blob([res.gcode ?? ""])` and attaches stats).
     * - productionId included so callers can track the manufacturing run (Production row).
     * - This matches "return G-code directly for now" while allowing evolution (e.g. store gcode in bucket and return key later).
     *
     * `designId` (when provided) + baseAssetId allow server to resolve full context (stock bases,
     * live trimlines/corrections) and produce correct audit linkage.
     *
     * The designId field (and extra payload fields) are optional in the schema for backward
     * compatibility with any clients or internal calls that have not yet been updated.
     */
    generateSolid: protectedProcedure
        .input(
            z.object({
                side: z.enum(["left", "right"]).optional(),
                presetId: z.string().optional(),
                overrides: z.record(z.unknown()).optional(),
                /** Server design id for authoritative state resolution and audit linking. */
                designId: z.string().uuid().optional(),
                // Additional data the client may send for the Python payload (base, trimlines etc.)
                baseAssetId: z.string().optional(),
                corrections: z.any().optional(),
                trimlines: z.any().optional(),
                thicknessMm: z.number().optional(),
                grindingStyle: z.string().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            // === Phase 1: Connect to Python manufacturing service ===
            // Node is the orchestrator: auth, license, pre-checks, data enrichment from DB,
            // audit, tokens (on success). Python is the pure geometry/CAM engine.

            const cost = 2; // gcode / solid manufacturing cost, same as export gcode
            const now = new Date();

            // License pre-check (no deduct yet — see Phase 3 for success-only deduct)
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

            // Check balance for pre-check (do not deduct here)
            const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
            if (user.tokenBalance < cost) {
                throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient tokens for manufacturing" });
            }

            // Enrich data using designId when available (authoritative DB state for corrections/elements/method etc.)
            let loadedCorrections: any = input.corrections;
            let loadedElements: any = null;
            let loadedMethod: string | undefined;
            let loadedThickness: number | undefined;
            let baseAssetId = input.baseAssetId;

            if (input.designId) {
                try {
                    const design = await ctx.prisma.design.findFirst({
                        where: { id: input.designId, ownerId: ctx.user.id },
                        include: { corrections: true, elements: true },
                    });
                    if (design) {
                        loadedMethod = design.method;
                        loadedThickness = design.thicknessMm;
                        if (!loadedCorrections && design.corrections?.length) {
                            loadedCorrections = {
                                left: design.corrections.find((c: any) => c.side === "left"),
                                right: design.corrections.find((c: any) => c.side === "right"),
                            };
                        }
                        if (design.elements?.length) {
                            loadedElements = design.elements;
                        }
                        // baseAssetId may come from client payload for stock/custom bases (not stored relationally in Design)
                    }
                } catch {
                    // best effort enrichment; continue with what client sent
                }
            }

            // Construct payload for Python service.
            // The Python side (solid_generator + belt + slicer) expects the clinical + base + trim data.
            const payload: any = {
                designId: input.designId ?? null,
                side: input.side ?? "left",
                baseAssetId: baseAssetId ?? null,
                corrections: loadedCorrections ?? input.corrections,
                elements: loadedElements,
                trimlines: input.trimlines,
                method: loadedMethod ?? "printing_solid",
                thicknessMm: input.thicknessMm ?? loadedThickness ?? 3,
                grindingStyle: input.grindingStyle,
                presetId: input.presetId,
                overrides: input.overrides || {},
                // heelLift etc are typically inside corrections or overrides
            };

            const serviceUrl = process.env.MANUFACTURING_SERVICE_URL || "http://localhost:8000";
            const headers: Record<string, string> = {
                "content-type": "application/json",
            };
            const internalKey = process.env.MANUFACTURING_INTERNAL_API_KEY;
            if (internalKey) {
                headers["x-internal-api-key"] = internalKey;
            }

            let pyRes: any;
            try {
                pyRes = await fetch(`${serviceUrl.replace(/\/$/, "")}/api/v1/manufacturing/generate-solid`, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                });
            } catch (e: any) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to reach manufacturing service: ${e?.message || e}`,
                });
            }

            if (!pyRes.ok) {
                const text = await pyRes.text().catch(() => "");
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `Manufacturing service error (${pyRes.status}): ${text || "unknown"}`,
                });
            }

            const data = (await pyRes.json()) as { ok?: boolean; gcode?: string; stats?: any; reason?: string; productionId?: string };

            if (!data?.ok) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: data?.reason || "Manufacturing pipeline failed",
                });
            }

            // === Phase 3: Success-only token deduction + records (inside tx) ===
            // Only deduct and persist if Python succeeded. Follows export.authorize pattern exactly
            // (guarded updateMany for deduct, then create records, then audit).
            // Python call (expensive pipeline) has already succeeded at this point.
            const finalDesignId = input.designId ?? null;
            const finalBaseAssetId = baseAssetId ?? input.baseAssetId ?? null;

            const result = await ctx.prisma.$transaction(async (tx) => {
                // Guarded decrement (re-check in tx for safety)
                const dec = await tx.user.updateMany({
                    where: { id: ctx.user.id, tokenBalance: { gte: cost } },
                    data: { tokenBalance: { decrement: cost } },
                });
                if (dec.count === 0) {
                    throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient tokens for manufacturing (race)" });
                }

                const updatedUser = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });

                // Create Production record for the manufacturing run (slicing/CAM + artifact)
                const production = await tx.production.create({
                    data: {
                        designId: finalDesignId,
                        method: (loadedMethod as any) || "printing_solid",
                        presetId: input.presetId || "unknown",
                        beltAngleDeg: (input.overrides as any)?.beltAngleDeg ?? null,
                        layerHeightMm: (input.overrides as any)?.layerHeightMm ?? null,
                        material: (input.overrides as any)?.material ?? null,
                        gcodeStorageKey: null, // gcode returned directly in response for client download; no server storage for now
                    },
                });

                // Also create an Export record (for token/audit traceability, similar to gcode export)
                const exp = await tx.export.create({
                    data: {
                        designId: finalDesignId,
                        userId: ctx.user.id,
                        format: "gcode",
                        side: (input.side as any) || null,
                        tokenCost: cost,
                        storageKey: null,
                        fileName: `manufacturing-${input.side || "side"}-${Date.now()}.gcode`,
                    },
                });

                await tx.tokenTransaction.create({
                    data: {
                        userId: ctx.user.id,
                        type: "deduct",
                        amount: -cost,
                        balance: updatedUser.tokenBalance,
                        reason: "manufacturing:generate-solid",
                        exportId: exp.id,
                    },
                });

                // Rich audit on success
                await tx.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "export_generated", // could be manufacturing_solid_generated when enum extended
                        targetId: production.id,
                        metadata: {
                            kind: "manufacturing_solid_generation_success",
                            designId: finalDesignId,
                            baseAssetId: finalBaseAssetId,
                            side: input.side ?? null,
                            presetId: input.presetId ?? null,
                            method: loadedMethod,
                            stockResolved: !!finalBaseAssetId,
                            grindingStyle: input.grindingStyle,
                            beltAngle: (input.overrides as any)?.beltAngleDeg,
                            // add more as needed (heel lift etc from corrections if desired)
                        },
                        ipAddress: ctx.ip,
                    },
                });

                return { productionId: production.id, exportId: exp.id, balance: updatedUser.tokenBalance };
            });

            // Return gcode directly (client downloads it) + metadata for UI / future production tracking.
            // Shape chosen for backward compat with generateHybridGcode (expects res.gcode + res.stats).
            return {
                ok: true as const,
                designId: finalDesignId,
                gcode: data.gcode || "",
                stats: data.stats || null,
                productionId: result.productionId,
            };
        }),
});