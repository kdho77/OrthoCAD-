import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "../lib/supabase-db.js";
import { protectedProcedure, router } from "../trpc.js";

export const clientRouter = router({
    list: protectedProcedure.query(async ({ ctx }) => {
        const supabase = requireSupabaseAdmin();
        const { data, error } = await supabase
            .from("clients")
            .select("*, designs(count)")
            .eq("ownerId", ctx.user.id)
            .order("createdAt", { ascending: false });

        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to list clients: ${error.message}`,
            });
        }

        return data ?? [];
    }),

    create: protectedProcedure
        .input(
            z.object({
                firstName: z.string().min(1).max(100),
                lastName: z.string().min(1).max(100),
                reference: z.string().max(60).optional(),
                email: z.string().email().optional(),
                phone: z.string().max(40).optional(),
                notes: z.string().max(2000).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data, error } = await supabase
                .from("clients")
                .insert({ ...input, ownerId: ctx.user.id })
                .select()
                .single();

            if (error || !data) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to create client: ${error?.message ?? "unknown error"}`,
                });
            }

            return data;
        }),

    update: protectedProcedure
        .input(
            z.object({
                id: z.string().uuid(),
                firstName: z.string().min(1).max(100).optional(),
                lastName: z.string().min(1).max(100).optional(),
                reference: z.string().max(60).optional(),
                email: z.string().email().optional(),
                phone: z.string().max(40).optional(),
                notes: z.string().max(2000).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const { id, ...patch } = input;
            const supabase = requireSupabaseAdmin();
            const { data: owned, error: ownedError } = await supabase
                .from("clients")
                .select("id")
                .eq("id", id)
                .eq("ownerId", ctx.user.id)
                .maybeSingle();

            if (ownedError) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to verify client ownership: ${ownedError.message}`,
                });
            }
            if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

            const { data, error } = await supabase.from("clients").update(patch).eq("id", id).select().single();
            if (error || !data) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to update client: ${error?.message ?? "unknown error"}`,
                });
            }

            return data;
        }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const supabase = requireSupabaseAdmin();
        const { data: owned, error: ownedError } = await supabase
            .from("clients")
            .select("id")
            .eq("id", input.id)
            .eq("ownerId", ctx.user.id)
            .maybeSingle();

        if (ownedError) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to verify client ownership: ${ownedError.message}`,
            });
        }
        if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

        const { error } = await supabase.from("clients").delete().eq("id", input.id);
        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to delete client: ${error.message}`,
            });
        }

        return { ok: true };
    }),
});
