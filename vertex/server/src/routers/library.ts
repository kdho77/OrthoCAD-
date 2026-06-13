// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { validateGlbBase64 } from "../lib/glb-validation.js";
import { RATE_LIMITS } from "../lib/rate-limit.js";
import {
    assertActiveLicense,
    requireSupabaseAdmin,
} from "../lib/supabase-db.js";
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

type CustomLibraryRow = {
    id: string;
    name: string;
    category: string;
    glbPath: string;
    parentStockId: string | null;
    createdAt: string;
};

function toIsoDate(value: string | Date): string {
    return typeof value === "string" ? value : value.toISOString();
}

async function authorizeSave(ctx: { user: { id: string } }) {
    const supabase = requireSupabaseAdmin();
    await assertActiveLicense(supabase, ctx.user.id);
    return { cost: SAVE_TOKEN_COST };
}

async function deductSaveTokens(
    ctx: {
        user: { id: string };
        ip: string | null;
    },
    reason: string,
    targetId: string,
    metadata: Record<string, unknown>,
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
        const supabase = requireSupabaseAdmin();
        const { data: rows, error } = await supabase
            .from("custom_elements")
            .select("id, name, category, glbPath, parentStockId, createdAt")
            .eq("userId", ctx.user.id)
            .order("createdAt", { ascending: false });

        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to list custom elements: ${error.message}`,
            });
        }

        return Promise.all(
            (rows ?? []).map(async (r: CustomLibraryRow) => ({
                id: r.id,
                name: r.name,
                category: r.category,
                glbPath: r.glbPath,
                parentStockId: r.parentStockId,
                createdAt: toIsoDate(r.createdAt),
                url: supabase ? await signedDownloadUrl(supabase, r.glbPath).catch(() => null) : null,
            })),
        );
    }),

    listPrefabs: protectedProcedure.query(async ({ ctx }) => {
        const supabase = requireSupabaseAdmin();
        const { data: rows, error } = await supabase
            .from("custom_prefabs")
            .select("id, name, category, glbPath, parentStockId, createdAt")
            .eq("userId", ctx.user.id)
            .order("createdAt", { ascending: false });

        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to list custom prefabs: ${error.message}`,
            });
        }

        return Promise.all(
            (rows ?? []).map(async (r: CustomLibraryRow) => ({
                id: r.id,
                name: r.name,
                category: r.category,
                glbPath: r.glbPath,
                parentStockId: r.parentStockId,
                createdAt: toIsoDate(r.createdAt),
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

            const { data: row, error: insertError } = await supabase
                .from("custom_elements")
                .insert({
                    userId: ctx.user.id,
                    name: input.name,
                    category: input.category,
                    glbPath: key,
                    parentStockId: input.parentStockId ?? null,
                })
                .select("id, name, category, glbPath, parentStockId, createdAt")
                .single();

            if (insertError || !row) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to save custom element: ${insertError?.message ?? "unknown error"}`,
                });
            }

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
                    createdAt: toIsoDate(row.createdAt),
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

            const { data: row, error: insertError } = await supabase
                .from("custom_prefabs")
                .insert({
                    userId: ctx.user.id,
                    name: input.name,
                    category: input.category,
                    glbPath: key,
                    parentStockId: input.parentStockId ?? null,
                })
                .select("id, name, category, glbPath, parentStockId, createdAt")
                .single();

            if (insertError || !row) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to save custom prefab: ${insertError?.message ?? "unknown error"}`,
                });
            }

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
                    createdAt: toIsoDate(row.createdAt),
                    url,
                },
            };
        }),

    deleteElement: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data: row, error } = await supabase
                .from("custom_elements")
                .select("id, glbPath")
                .eq("id", input.id)
                .eq("userId", ctx.user.id)
                .maybeSingle();

            if (error) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to load custom element: ${error.message}`,
                });
            }
            if (!row) throw new TRPCError({ code: "NOT_FOUND" });

            await deleteAsset(supabase, row.glbPath).catch(() => undefined);

            const { error: deleteError } = await supabase.from("custom_elements").delete().eq("id", row.id);
            if (deleteError) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to delete custom element: ${deleteError.message}`,
                });
            }

            return { ok: true as const };
        }),

    deletePrefab: protectedProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data: row, error } = await supabase
                .from("custom_prefabs")
                .select("id, glbPath")
                .eq("id", input.id)
                .eq("userId", ctx.user.id)
                .maybeSingle();

            if (error) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to load custom prefab: ${error.message}`,
                });
            }
            if (!row) throw new TRPCError({ code: "NOT_FOUND" });

            await deleteAsset(supabase, row.glbPath).catch(() => undefined);

            const { error: deleteError } = await supabase.from("custom_prefabs").delete().eq("id", row.id);
            if (deleteError) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to delete custom prefab: ${deleteError.message}`,
                });
            }

            return { ok: true as const };
        }),
});
