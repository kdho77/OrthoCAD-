// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Prisma } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { validateGlbBase64 } from "../lib/glb-validation.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import { buildGlbKey, deleteAsset, signedDownloadUrl, uploadAsset } from "../lib/storage.js";
import { protectedProcedure, rateLimitedProcedure, router } from "../trpc.js";

// Token cost for saving a custom GLB to the personal library.
const SAVE_TOKEN_COST = 1;

const saveInput = z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(60),
    parentStockId: z.string().max(60).optional(),
    /** Base64-encoded GLB bytes (no data: prefix). */
    glbBase64: z.string().min(1),
});

async function authorizeSave(ctx: {
    prisma: typeof import("../context").prisma;
    user: { id: string };
    ip: string | null;
}) {
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

    const pre = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (pre.tokenBalance < SAVE_TOKEN_COST) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient tokens to save custom asset" });
    }

    return { cost: SAVE_TOKEN_COST };
}

async function deductSaveTokens(
    ctx: {
        user: { id: string };
        ip: string | null;
    },
    reason: string,
    targetId: string,
    metadata: Prisma.InputJsonValue,
) {
    const supabase = getSupabaseAdmin();
    if (!supabase) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage not configured" });
    }

    const { data, error } = await supabase.rpc("vertex_charge_library_save", {
        p_user_id: ctx.user.id,
        p_cost: SAVE_TOKEN_COST,
        p_reason: reason,
        p_target_id: targetId,
        p_metadata: metadata,
        p_ip: ctx.ip,
    });

    if (error) {
        if (error.message.includes("INSUFFICIENT_TOKENS")) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient tokens to save custom asset" });
        }
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Library save charge failed: ${error.message}`,
        });
    }

    const result = data as { balance: number };
    return { balance: result.balance };
}

export const libraryRouter = router({
    listElements: protectedProcedure.query(async ({ ctx }) => {
        const rows = await ctx.prisma.customElement.findMany({
            where: { userId: ctx.user.id },
            orderBy: { createdAt: "desc" },
        });
        const supabase = getSupabaseAdmin();
        return Promise.all(
            rows.map(async (r) => ({
                id: r.id,
                name: r.name,
                category: r.category,
                glbPath: r.glbPath,
                parentStockId: r.parentStockId,
                createdAt: r.createdAt.toISOString(),
                url: supabase ? await signedDownloadUrl(supabase, r.glbPath).catch(() => null) : null,
            })),
        );
    }),

    listPrefabs: protectedProcedure.query(async ({ ctx }) => {
        const rows = await ctx.prisma.customPrefab.findMany({
            where: { userId: ctx.user.id },
            orderBy: { createdAt: "desc" },
        });
        const supabase = getSupabaseAdmin();
        return Promise.all(
            rows.map(async (r) => ({
                id: r.id,
                name: r.name,
                category: r.category,
                glbPath: r.glbPath,
                parentStockId: r.parentStockId,
                createdAt: r.createdAt.toISOString(),
                url: supabase ? await signedDownloadUrl(supabase, r.glbPath).catch(() => null) : null,
            })),
        );
    }),

    saveElement: rateLimitedProcedure(RATE_LIMITS.librarySave, "library:saveElement")
        .input(saveInput)
        .mutation(async ({ ctx, input }) => {
            await authorizeSave(ctx);
            const validated = validateGlbBase64(input.glbBase64);
            if (!validated.ok) {
                throw new TRPCError({ code: "BAD_REQUEST", message: validated.reason });
            }

            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage not configured" });
            }

            const key = buildGlbKey(ctx.user.id, "element", input.name);
            await uploadAsset(supabase, key, validated.bytes, "model/gltf-binary");

            const row = await ctx.prisma.customElement.create({
                data: {
                    userId: ctx.user.id,
                    name: input.name,
                    category: input.category,
                    glbPath: key,
                    parentStockId: input.parentStockId ?? null,
                },
            });

            const { balance } = await deductSaveTokens(ctx, "custom_library:element", row.id, {
                kind: "element",
                name: input.name,
                parentStockId: input.parentStockId ?? null,
            });

            const url = await signedDownloadUrl(supabase, key);
            return {
                ok: true as const,
                balance,
                item: {
                    id: row.id,
                    name: row.name,
                    category: row.category,
                    glbPath: row.glbPath,
                    parentStockId: row.parentStockId,
                    createdAt: row.createdAt.toISOString(),
                    url,
                },
            };
        }),

    savePrefab: rateLimitedProcedure(RATE_LIMITS.librarySave, "library:savePrefab")
        .input(saveInput)
        .mutation(async ({ ctx, input }) => {
            await authorizeSave(ctx);
            const validated = validateGlbBase64(input.glbBase64);
            if (!validated.ok) {
                throw new TRPCError({ code: "BAD_REQUEST", message: validated.reason });
            }

            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage not configured" });
            }

            const key = buildGlbKey(ctx.user.id, "prefab", input.name);
            await uploadAsset(supabase, key, validated.bytes, "model/gltf-binary");

            const row = await ctx.prisma.customPrefab.create({
                data: {
                    userId: ctx.user.id,
                    name: input.name,
                    category: input.category,
                    glbPath: key,
                    parentStockId: input.parentStockId ?? null,
                },
            });

            const { balance } = await deductSaveTokens(ctx, "custom_library:prefab", row.id, {
                kind: "prefab",
                name: input.name,
                parentStockId: input.parentStockId ?? null,
            });

            const url = await signedDownloadUrl(supabase, key);
            return {
                ok: true as const,
                balance,
                item: {
                    id: row.id,
                    name: row.name,
                    category: row.category,
                    glbPath: row.glbPath,
                    parentStockId: row.parentStockId,
                    createdAt: row.createdAt.toISOString(),
                    url,
                },
            };
        }),

    deleteElement: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const row = await ctx.prisma.customElement.findFirst({
                where: { id: input.id, userId: ctx.user.id },
            });
            if (!row) throw new TRPCError({ code: "NOT_FOUND" });
            const supabase = getSupabaseAdmin();
            if (supabase) await deleteAsset(supabase, row.glbPath).catch(() => undefined);
            await ctx.prisma.customElement.delete({ where: { id: row.id } });
            return { ok: true as const };
        }),

    deletePrefab: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const row = await ctx.prisma.customPrefab.findFirst({
                where: { id: input.id, userId: ctx.user.id },
            });
            if (!row) throw new TRPCError({ code: "NOT_FOUND" });
            const supabase = getSupabaseAdmin();
            if (supabase) await deleteAsset(supabase, row.glbPath).catch(() => undefined);
            await ctx.prisma.customPrefab.delete({ where: { id: row.id } });
            return { ok: true as const };
        }),
});
