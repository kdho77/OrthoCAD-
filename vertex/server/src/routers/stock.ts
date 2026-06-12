// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { validateGlbBase64 } from "../lib/glb-validation.js";
import {
    buildStockGlbKey,
    deleteAsset,
    getPublicUrl,
    STOCK_BUCKET,
    signedDownloadUrl,
    uploadAsset,
} from "../lib/storage.js";
import { adminProcedure, protectedProcedure, router } from "../trpc.js";

/**
 * Server-authoritative procedures for system stock bases (global GLB templates
 * such as the default Right foot last uploaded as Templates/Default.glb).
 *
 * These are distinct from user custom library items:
 * - Stock bases are system-owned, shared by all licensed users.
 * - No per-user ownership, no token costs for access.
 * - Managed exclusively by admins (create/update/delete **must** use adminProcedure).
 *
 * Reads (list / get / getDefault) are intentionally available to any authenticated user
 * via protectedProcedure — stock bases are shared templates, not private user data.
 *
 * All write paths (when implemented) are gated behind adminProcedure (see trpc.ts).
 */

// Common shape returned to clients (dates serialized, url attached when possible).
const stockBaseResponse = z.object({
    id: z.string(),
    name: z.string(),
    glbPath: z.string(),
    primarySide: z.string().nullable(),
    isDefault: z.boolean(),
    isActive: z.boolean(),
    metadata: z.unknown().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    url: z.string().nullable().optional(),
});

export const stockRouter = router({
    /**
     * List all active stock bases.
     * Ordered with defaults first for convenience in UI pickers.
     * Returns enriched objects with a short-lived signed download URL when storage is configured.
     */
    listStockBases: protectedProcedure.query(async ({ ctx }) => {
        const rows = await ctx.prisma.stockBase.findMany({
            where: { isActive: true },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        });

        const items = await Promise.all(rows.map((r) => enrichStockBase(r)));
        return items;
    }),

    /**
     * Fetch a single stock base by ID (must be active).
     */
    getStockBase: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .query(async ({ ctx, input }) => {
            const row = await ctx.prisma.stockBase.findFirst({
                where: { id: input.id, isActive: true },
            });

            if (!row) {
                throw new TRPCError({
                    code: "NOT_FOUND",
                    message: "Stock base not found or inactive",
                });
            }

            return enrichStockBase(row);
        }),

    /**
     * Return the designated default stock base (the one with isDefault=true and active).
     * Returns null if none is configured — callers (client base resolution) are expected
     * to have a minimal local fallback only for completely offline/dev scenarios.
     *
     * A lightweight audit record is written (best-effort) for traceability of which
     * stock base is being used as the starting model for new designs.
     */
    getDefaultStockBase: protectedProcedure.query(async ({ ctx }) => {
        // Prefer exact isDefault; if multiple, the most recently created wins as tie-breaker.
        const row = await ctx.prisma.stockBase.findFirst({
            where: { isDefault: true, isActive: true },
            orderBy: { createdAt: "desc" },
        });

        if (!row) {
            return null;
        }

        const item = await enrichStockBase(row);

        // Basic audit / observability for stock base usage (non-blocking, best effort).
        // This helps answer "which stock template was this design started from?" without
        // the cost of full design audit on every correction.
        try {
            await ctx.prisma.auditLog.create({
                data: {
                    userId: ctx.user?.id ?? null,
                    action: "stock_base_resolved",
                    targetId: row.id,
                    metadata: {
                        kind: "stock_base_resolved",
                        stockBaseName: row.name,
                        isDefault: row.isDefault,
                        primarySide: row.primarySide,
                    },
                    ipAddress: ctx.ip ?? null,
                },
            });
        } catch {
            // Audit is best-effort; never fail the resolution because of logging.
        }

        return item;
    }),

    // ------------------------------------------------------------------
    // Admin mutations (stock bases are system assets — only admins may create/update/delete)
    // ------------------------------------------------------------------

    /**
     * Create a new stock base.
     * Supports direct GLB upload via base64 (preferred) or providing an existing glbPath key
     * (for cases where the file was uploaded through a separate secure channel).
     * Enforces single `isDefault` rule: setting isDefault=true will clear it on all other rows.
     */
    createStockBase: adminProcedure
        .input(
            z
                .object({
                    name: z.string().min(1).max(120),
                    /** Base64-encoded GLB (no data: prefix). Preferred for new uploads. */
                    glbBase64: z.string().min(1).optional(),
                    /** Existing storage key (must be valid path under stock bucket). Use when glbBase64 omitted. */
                    glbPath: z.string().min(1).optional(),
                    primarySide: z.enum(["left", "right"]).nullish(),
                    isDefault: z.boolean().optional(),
                    isActive: z.boolean().optional(),
                    /** Convenience — will be merged into metadata.category */
                    category: z.string().min(1).max(60).optional(),
                    /** Convenience — will be merged into metadata.description */
                    description: z.string().max(500).optional(),
                    /** Free-form JSON metadata (e.g. clinical notes, mirroredAvailable, etc.) */
                    metadata: z.record(z.unknown()).optional(),
                })
                .refine((d) => !!d.glbBase64 || !!d.glbPath, {
                    message: "Either glbBase64 or glbPath must be provided",
                }),
        )
        .mutation(async ({ ctx, input }) => {
            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({
                    code: "PRECONDITION_FAILED",
                    message: "Storage not configured",
                });
            }

            let finalGlbPath: string;

            if (input.glbBase64) {
                const validated = validateGlbBase64(input.glbBase64);
                if (!validated.ok) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: validated.reason });
                }
                finalGlbPath = buildStockGlbKey(input.name, { category: input.category });
                await uploadAsset(supabase, finalGlbPath, validated.bytes, "model/gltf-binary", STOCK_BUCKET);
            } else if (input.glbPath) {
                // Accept pre-uploaded key (admin responsibility to have placed it correctly in STOCK_BUCKET)
                finalGlbPath = input.glbPath;
            } else {
                // Should be unreachable due to refine
                throw new TRPCError({ code: "BAD_REQUEST", message: "No GLB source provided" });
            }

            // Build metadata (merge convenience fields)
            const meta: Record<string, unknown> = { ...(input.metadata ?? {}) };
            if (input.category) meta.category = input.category;
            if (input.description) meta.description = input.description;

            const isDef = input.isDefault ?? false;
            const isAct = input.isActive ?? true;

            if (isDef && !isAct) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: "Cannot set isDefault=true on an inactive stock base",
                });
            }

            // Atomic: clear other defaults if needed, then create
            const row = await ctx.prismaDirect.$transaction(async (tx) => {
                if (isDef) {
                    await tx.stockBase.updateMany({
                        where: { isDefault: true },
                        data: { isDefault: false },
                    });
                }

                const created = await tx.stockBase.create({
                    data: {
                        name: input.name,
                        glbPath: finalGlbPath,
                        primarySide: input.primarySide ?? null,
                        isDefault: isDef,
                        isActive: isAct,
                        metadata: Object.keys(meta).length > 0 ? (meta as Prisma.InputJsonValue) : undefined,
                    },
                });
                return created;
            });

            // Audit
            try {
                await ctx.prisma.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "stock_base_created",
                        targetId: row.id,
                        metadata: {
                            kind: "stock_base_created",
                            name: row.name,
                            glbPath: finalGlbPath,
                            isDefault: isDef,
                            primarySide: input.primarySide ?? null,
                        },
                        ipAddress: ctx.ip,
                    },
                });
            } catch {
                // best effort
            }

            const item = await enrichStockBase(row);
            return { ok: true as const, item };
        }),

    /**
     * Update metadata on an existing stock base.
     * Can be used to toggle isDefault / isActive, change name/side, or edit metadata.
     * Enforces the single-default invariant when isDefault is being set to true.
     */
    updateStockBase: adminProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                name: z.string().min(1).max(120).optional(),
                primarySide: z.enum(["left", "right"]).nullish(),
                isDefault: z.boolean().optional(),
                isActive: z.boolean().optional(),
                category: z.string().min(1).max(60).optional(),
                description: z.string().max(500).optional(),
                metadata: z.record(z.unknown()).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const existing = await ctx.prisma.stockBase.findUnique({ where: { id: input.id } });
            if (!existing) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Stock base not found" });
            }

            const isDef = input.isDefault;
            const isAct = input.isActive;

            if (isDef === true) {
                const finalActive = isAct ?? existing.isActive;
                if (!finalActive) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: "Cannot set isDefault=true on an inactive stock base",
                    });
                }
            }

            const row = await ctx.prismaDirect.$transaction(async (tx) => {
                // If we are turning OFF the default (isActive=false on a currently-default row, or explicitly isDefault=false),
                // auto-promote another active stock so the system keeps a designated default.
                const turningOffDefault =
                    (existing.isDefault && isAct === false) || (existing.isDefault && isDef === false);

                if (turningOffDefault) {
                    const replacement = await tx.stockBase.findFirst({
                        where: { isActive: true, id: { not: input.id } },
                        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
                    });
                    if (replacement) {
                        await tx.stockBase.update({
                            where: { id: replacement.id },
                            data: { isDefault: true },
                        });
                    }
                }

                if (isDef === true) {
                    await tx.stockBase.updateMany({
                        where: { isDefault: true, id: { not: input.id } },
                        data: { isDefault: false },
                    });
                }

                // Merge metadata if provided
                let nextMeta: Prisma.InputJsonValue = (existing.metadata as Prisma.InputJsonValue) ?? {};
                if (input.metadata) {
                    nextMeta = {
                        ...(nextMeta as Prisma.JsonObject),
                        ...(input.metadata as Prisma.JsonObject),
                    };
                }
                if (input.category !== undefined) {
                    nextMeta = { ...(nextMeta as Prisma.JsonObject), category: input.category };
                }
                if (input.description !== undefined) {
                    nextMeta = { ...(nextMeta as Prisma.JsonObject), description: input.description };
                }
                const metadataValue: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue =
                    Object.keys(nextMeta as Prisma.JsonObject).length > 0 ? nextMeta : Prisma.JsonNull;

                const updated = await tx.stockBase.update({
                    where: { id: input.id },
                    data: {
                        ...(input.name !== undefined ? { name: input.name } : {}),
                        ...(input.primarySide !== undefined ? { primarySide: input.primarySide } : {}),
                        ...(isDef !== undefined ? { isDefault: isDef } : {}),
                        ...(isAct !== undefined ? { isActive: isAct } : {}),
                        ...(input.metadata !== undefined ||
                        input.category !== undefined ||
                        input.description !== undefined
                            ? { metadata: metadataValue }
                            : {}),
                    },
                });
                return updated;
            });

            // Audit
            try {
                await ctx.prisma.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "stock_base_updated",
                        targetId: row.id,
                        metadata: {
                            kind: "stock_base_updated",
                            name: row.name,
                            isDefault: row.isDefault,
                            isActive: row.isActive,
                        },
                        ipAddress: ctx.ip,
                    },
                });
            } catch {
                // best effort
            }

            const item = await enrichStockBase(row);
            return { ok: true as const, item };
        }),

    /**
     * Delete a stock base.
     *
     * **Delete strategy (hard delete)**: The DB row is removed and the GLB bytes are
     * deleted from storage (best-effort).
     *
     * Rationale (documented per requirements):
     * - Stock bases are *system templates*, not user-owned clinical data.
     * - Hard delete keeps storage clean and avoids accumulating obsolete large GLBs.
     * - Existing saved designs that reference the deleted stock's assetId/glbPath will
     *   experience graceful degradation on next load (loadBaseGeometry will fail to fetch
     *   the mesh → geo = null for that side). New designs will pick the promoted default
     *   (or fall back to the client builtin placeholder).
     * - If the deleted row was the active default, we atomically promote the "next best"
     *   active stock base (newest active, preferring any that had isDefault) so that
     *   `getDefaultStockBase` continues to return a useful server value.
     *
     * Soft-delete alternative (just isActive=false) was considered but rejected for
     * storage efficiency on large binary assets and simplicity (no need for "deletedAt"
     * column or special listing filters for admins).
     */
    deleteStockBase: adminProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const row = await ctx.prisma.stockBase.findUnique({ where: { id: input.id } });
            if (!row) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Stock base not found" });
            }

            const wasDefault = row.isDefault;

            // Hard delete chosen (see JSDoc below). If this was the active default, auto-promote
            // another active stock base so that new designs continue to have a server default.
            await ctx.prismaDirect.$transaction(async (tx) => {
                if (wasDefault) {
                    const replacement = await tx.stockBase.findFirst({
                        where: { isActive: true, id: { not: input.id } },
                        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
                    });
                    if (replacement) {
                        await tx.stockBase.update({
                            where: { id: replacement.id },
                            data: { isDefault: true },
                        });
                    }
                    // If no replacement, getDefaultStockBase will return null → client falls back to builtin.
                }

                const supabase = getSupabaseAdmin();
                if (supabase) {
                    await deleteAsset(supabase, row.glbPath, STOCK_BUCKET).catch(() => undefined);
                }

                await tx.stockBase.delete({ where: { id: input.id } });
            });

            try {
                await ctx.prisma.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "stock_base_deleted",
                        targetId: input.id,
                        metadata: {
                            kind: "stock_base_deleted",
                            name: row.name,
                            wasDefault,
                            promotedReplacement: wasDefault, // the tx above handled promotion if needed
                        },
                        ipAddress: ctx.ip,
                    },
                });
            } catch {
                // best effort
            }

            return { ok: true as const };
        }),

    /**
     * Idempotent admin helper to ensure the canonical system default stock base exists
     * and is marked as the active default.
     *
     * This is the recommended way to bootstrap or re-seed the "Default Template"
     * (the one that client code falls back to for new designs when no other base
     * is selected).
     *
     * - If a row with the conventional name already exists, it will be updated to
     *   `isDefault: true` + `isActive: true` (and the single-default invariant is
     *   enforced by the internal transaction).
     * - If `glbBase64` is supplied, the file will be (re-)uploaded.
     * - Otherwise a conventional `glbPath` is used (you are responsible for placing
     *   the actual GLB file at that key in the STOCK_BUCKET, or supply the bytes here).
     *
     * Only admins may call this.
     */
    ensureDefaultStockBase: adminProcedure
        .input(
            z
                .object({
                    /** Optional override name for the system default row. */
                    name: z.string().min(1).max(120).optional(),
                    /** If you want to (re)upload the GLB bytes as part of seeding. */
                    glbBase64: z.string().min(1).optional(),
                    /** Conventional glbPath to use when no bytes are supplied. */
                    glbPath: z.string().min(1).optional(),
                    primarySide: z.enum(["left", "right"]).nullish(),
                    category: z.string().min(1).max(60).optional(),
                    description: z.string().max(500).optional(),
                    metadata: z.record(z.unknown()).optional(),
                })
                .optional(),
        )
        .mutation(async ({ ctx, input }) => {
            const desiredName = input?.name ?? "Default Stock Base";
            const desiredGlbPath = input?.glbPath ?? "stock/standard/Default.glb";

            // Idempotent upsert of the system default row.
            const row = await ctx.prismaDirect.$transaction(async (tx) => {
                // Make sure no other row is the default while we set this one.
                await tx.stockBase.updateMany({
                    where: { isDefault: true },
                    data: { isDefault: false },
                });

                // Try to find an existing row by conventional name (or create).
                const existing = await tx.stockBase.findFirst({
                    where: { name: desiredName },
                });

                const meta = {
                    ...(input?.metadata ?? {}),
                    isSystemDefault: true,
                    seededAt: new Date().toISOString(),
                };
                if (input?.category) (meta as any).category = input.category;
                if (input?.description) (meta as any).description = input.description;

                if (existing) {
                    return tx.stockBase.update({
                        where: { id: existing.id },
                        data: {
                            isDefault: true,
                            isActive: true,
                            glbPath: input?.glbBase64
                                ? /* will be overwritten by caller if bytes */ existing.glbPath
                                : desiredGlbPath,
                            primarySide: input?.primarySide ?? existing.primarySide,
                            metadata: meta,
                        },
                    });
                }

                // Create fresh (single-default already cleared above).
                return tx.stockBase.create({
                    data: {
                        name: desiredName,
                        glbPath: desiredGlbPath,
                        primarySide: input?.primarySide ?? "right",
                        isDefault: true,
                        isActive: true,
                        metadata: meta,
                    },
                });
            });

            // If bytes were supplied, perform the upload and patch the glbPath
            // (after the default flip tx to keep things simple and safe).
            let finalRow = row;
            if (input?.glbBase64) {
                const supabase = getSupabaseAdmin();
                if (!supabase) {
                    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage not configured" });
                }
                const validated = validateGlbBase64(input.glbBase64);
                if (!validated.ok) {
                    throw new TRPCError({ code: "BAD_REQUEST", message: validated.reason });
                }
                const key = buildStockGlbKey(desiredName, { category: input?.category ?? "standard" });
                await uploadAsset(supabase, key, validated.bytes, "model/gltf-binary", STOCK_BUCKET);

                finalRow = await ctx.prisma.stockBase.update({
                    where: { id: row.id },
                    data: { glbPath: key },
                });
            }

            // Audit the seeding action.
            try {
                await ctx.prisma.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "stock_base_created",
                        targetId: finalRow.id,
                        metadata: {
                            kind: "stock_base_seeded",
                            name: finalRow.name,
                            isSystemDefault: true,
                        },
                        ipAddress: ctx.ip,
                    },
                });
            } catch {
                // best effort
            }

            const item = await enrichStockBase(finalRow);
            return { ok: true as const, item };
        }),
});

/**
 * How to add and manage new stock bases (long-term operational process)
 *
 * ## Admin API (implemented)
 *
 * All management happens through the stock router using `adminProcedure` (role "admin" or "super_admin").
 *
 * ### createStockBase
 * - Input: name (required), glbBase64 (preferred) **or** glbPath (for pre-uploaded keys),
 *   primarySide, isDefault, isActive, category, description, metadata.
 * - Behavior: If glbBase64 is supplied, validates it (magic header + size), uploads to
 *   STOCK_BUCKET using `buildStockGlbKey(name, {category})` → organized path `stock/{cat}/...`.
 *   The resulting glbPath is stored.
 * - Single-default rule: If isDefault=true, a transaction first clears isDefault on all
 *   other rows, then creates this one. Rejects isDefault + !isActive.
 * - Returns: { ok, item: enriched stock base with url }
 * - Audit: best-effort auditLog (kind: "stock_base_created").
 *
 * ### updateStockBase
 * - Input: id + partial fields (name, primarySide, isDefault, isActive, category, description, metadata).
 * - Behavior: Supports flipping isDefault / isActive. If turning a default off (isActive=false
 *   or isDefault=false on a currently-default row), the tx promotes another active stock
 *   before applying the change. When setting isDefault=true, clears others.
 * - Rejects attempts to make an inactive row the default.
 * - Returns: { ok, item }
 * - Audit: best-effort (kind: "stock_base_updated").
 *
 * ### deleteStockBase
 * - Hard delete (row removed + GLB bytes deleted from storage, best-effort).
 * - If the deleted row was the active default, the tx promotes the "next best" active
 *   stock (newest, preferring prior defaults) so getDefaultStockBase remains useful.
 * - Designs that were using the deleted stock's assetId will gracefully degrade on load
 *   (loadBaseGeometry will fail to fetch the mesh → geo=null for that side; new designs use promoted
 *   default or client builtin fallback).
 * - Returns: { ok }
 * - Audit: best-effort (kind: "stock_base_deleted").
 *
 * ### ensureDefaultStockBase (recommended for seeding)
 * - Idempotent admin-only helper.
 * - Ensures a row named "Default Stock Base" (or override) exists with `isDefault=true`
 *   and `isActive=true`. Enforces the single-default rule internally.
 * - Accepts optional `glbBase64` (will upload) or just ensures a row pointing at a
 *   conventional `glbPath` (you place the file in the bucket separately).
 * - This is the supported way to bootstrap or re-seed the template that client code
 *   (`resolveDefaultStockBase` / new design flows) will pick up automatically.
 *
 * ## Operational notes
 * 1. Storage keys
 *    - Direct upload path always produces `stock/{category|general}/{sanitized-name}-{ts}.glb`
 *      via the extended buildStockGlbKey.
 *    - When supplying a pre-uploaded glbPath, the admin is responsible for the key (can
 *      follow the same convention).
 *
 * 2. Single default invariant
 *    - Enforced server-side in transactions inside create/update/delete.
 *    - Public queries (getDefaultStockBase, list with isActive) only consider active defaults.
 *
 * 3. Client impact (no changes required)
 *    - `resolveDefaultStockBase()` (client) calls the server procedure and receives real
 *      UUID + glbPath + url (from storage) + primarySide.
 *    - loadBaseGeometry prefers the server url (works for organized stock/ paths).
 *    - createDefaultStockPairedBases uses primarySide (when present) / falls back to
 *      mirroring the Default as Right→Left.
 *
 * 4. Security & governance
 *    - Writes are **only** reachable via adminProcedure (role check in middleware).
 *    - GLB validation reuses the shared validateGlbBase64 (size + magic header).
 *    - All admin actions produce auditLog entries using the dedicated stock_base_* AuditAction
 *      enum values (added via migration). Rich metadata is still attached for context.
 *
 * 5. RLS (defense in depth)
 *    - See Prisma model comments. Application procedures are the primary control.
 *
 * 6. Fallbacks
 *    - If no active default exists in the table, getDefaultStockBase returns null.
 *      Client resolution then falls back to the local BUILTIN_DEFAULT_STOCK placeholder
 *      (only for offline / misconfigured environments).
 *
 * 7. Seeding the default
 *    - Call the `ensureDefaultStockBase` admin mutation (easiest for runtime re-seeding).
 *    - Or run `vertex/scripts/seed-default-stock-base.ts` (example script that can do a
 *      direct DB + optional storage upload). See the script for usage notes.
 */

/**
 * Internal helper to enrich a StockBase row with a usable download URL (public preferred
 * from STOCK_BUCKET, signed fallback). Keeps response shape consistent across reads and
 * admin mutations.
 */
async function enrichStockBase(row: any) {
    const supabase = getSupabaseAdmin();
    let url: string | null = null;
    if (supabase) {
        try {
            url = getPublicUrl(supabase, row.glbPath, STOCK_BUCKET);
            if (!url) {
                url = await signedDownloadUrl(supabase, row.glbPath, 3600 * 4, STOCK_BUCKET);
            }
        } catch {
            url = null;
        }
    }
    return {
        id: row.id,
        name: row.name,
        glbPath: row.glbPath,
        primarySide: row.primarySide,
        isDefault: row.isDefault,
        isActive: row.isActive,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        url,
    };
}

export type StockBaseResponse = z.infer<typeof stockBaseResponse>;
