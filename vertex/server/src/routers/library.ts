// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildGlbKey, deleteAsset, signedDownloadUrl, uploadAsset } from "../lib/storage";
import { protectedProcedure, router } from "../trpc";
import { getSupabaseAdmin } from "../context";

// Token cost for saving a custom GLB to the personal library.
const SAVE_TOKEN_COST = 1;

const saveInput = z.object({
    name: z.string().min(1).max(120),
    category: z.string().min(1).max(60),
    parentStockId: z.string().max(60).optional(),
    /** Base64-encoded GLB bytes (no data: prefix). */
    glbBase64: z.string().min(1),
});

async function authorizeSave(ctx: { prisma: typeof import("../context").prisma; user: { id: string }; ip: string | null }) {
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

    const cost = SAVE_TOKEN_COST;
    const result = await ctx.prisma.$transaction(async (tx) => {
        const dec = await tx.user.updateMany({
            where: { id: ctx.user.id, tokenBalance: { gte: cost } },
            data: { tokenBalance: { decrement: cost } },
        });
        if (dec.count === 0) {
            throw new TRPCError({ code: "FORBIDDEN", message: "Insufficient tokens to save custom asset" });
        }
        const user = await tx.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
        return { balance: user.tokenBalance };
    });

    return { cost, balance: result.balance };
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

    saveElement: protectedProcedure.input(saveInput).mutation(async ({ ctx, input }) => {
        const { balance } = await authorizeSave(ctx);
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage not configured" });
        }

        const buf = Buffer.from(input.glbBase64, "base64");
        const key = buildGlbKey(ctx.user.id, "element", input.name);
        await uploadAsset(supabase, key, buf, "model/gltf-binary");

        const row = await ctx.prisma.customElement.create({
            data: {
                userId: ctx.user.id,
                name: input.name,
                category: input.category,
                glbPath: key,
                parentStockId: input.parentStockId ?? null,
            },
        });

        await ctx.prisma.tokenTransaction.create({
            data: {
                userId: ctx.user.id,
                type: "deduct",
                amount: -SAVE_TOKEN_COST,
                balance,
                reason: "custom_library:element",
            },
        });

        await ctx.prisma.auditLog.create({
            data: {
                userId: ctx.user.id,
                action: "custom_library_saved",
                targetId: row.id,
                metadata: { kind: "element", name: input.name, parentStockId: input.parentStockId ?? null },
                ipAddress: ctx.ip,
            },
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

    savePrefab: protectedProcedure.input(saveInput).mutation(async ({ ctx, input }) => {
        const { balance } = await authorizeSave(ctx);
        const supabase = getSupabaseAdmin();
        if (!supabase) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Storage not configured" });
        }

        const buf = Buffer.from(input.glbBase64, "base64");
        const key = buildGlbKey(ctx.user.id, "prefab", input.name);
        await uploadAsset(supabase, key, buf, "model/gltf-binary");

        const row = await ctx.prisma.customPrefab.create({
            data: {
                userId: ctx.user.id,
                name: input.name,
                category: input.category,
                glbPath: key,
                parentStockId: input.parentStockId ?? null,
            },
        });

        await ctx.prisma.tokenTransaction.create({
            data: {
                userId: ctx.user.id,
                type: "deduct",
                amount: -SAVE_TOKEN_COST,
                balance,
                reason: "custom_library:prefab",
            },
        });

        await ctx.prisma.auditLog.create({
            data: {
                userId: ctx.user.id,
                action: "custom_library_saved",
                targetId: row.id,
                metadata: { kind: "prefab", name: input.name, parentStockId: input.parentStockId ?? null },
                ipAddress: ctx.ip,
            },
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
