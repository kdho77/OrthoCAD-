import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { designStateSchema } from "../lib/design-schema.js";
import { requireSupabaseAdmin, writeAuditLogBestEffort } from "../lib/supabase-db.js";
import { protectedProcedure, router } from "../trpc.js";

export const designRouter = router({
    list: protectedProcedure.input(z.object({ clientId: z.string().uuid() })).query(async ({ ctx, input }) => {
        const supabase = requireSupabaseAdmin();
        const { data, error } = await supabase
            .from("designs")
            .select("id, name, pattern, method, updatedAt")
            .eq("clientId", input.clientId)
            .eq("ownerId", ctx.user.id)
            .order("updatedAt", { ascending: false });

        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to list designs: ${error.message}`,
            });
        }

        return data ?? [];
    }),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
        const supabase = requireSupabaseAdmin();
        const { data: design, error } = await supabase
            .from("designs")
            .select("*, corrections(*), elements(*)")
            .eq("id", input.id)
            .eq("ownerId", ctx.user.id)
            .maybeSingle();

        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to load design: ${error.message}`,
            });
        }
        if (!design) throw new TRPCError({ code: "NOT_FOUND" });
        return design;
    }),

    create: protectedProcedure
        .input(z.object({ clientId: z.string().uuid(), name: z.string().min(1).max(120) }))
        .mutation(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data: client, error: clientError } = await supabase
                .from("clients")
                .select("id")
                .eq("id", input.clientId)
                .eq("ownerId", ctx.user.id)
                .maybeSingle();

            if (clientError) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to verify client: ${clientError.message}`,
                });
            }
            if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });

            const { data: design, error } = await supabase
                .from("designs")
                .insert({
                    clientId: input.clientId,
                    ownerId: ctx.user.id,
                    name: input.name,
                })
                .select()
                .single();

            if (error || !design) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to create design: ${error?.message ?? "unknown error"}`,
                });
            }

            await writeAuditLogBestEffort(supabase, {
                userId: ctx.user.id,
                action: "design_created",
                targetId: design.id,
                ipAddress: ctx.ip,
            });

            return design;
        }),

    // Persists the full design: header fields + relational corrections + elements.
    save: protectedProcedure
        .input(
            z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), state: designStateSchema }),
        )
        .mutation(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data: owned, error: ownedError } = await supabase
                .from("designs")
                .select("id")
                .eq("id", input.id)
                .eq("ownerId", ctx.user.id)
                .maybeSingle();

            if (ownedError) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to verify design ownership: ${ownedError.message}`,
                });
            }
            if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
            const { state } = input;

            const adminClient = getSupabaseAdmin();
            if (!adminClient) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }

            const { data, error } = await adminClient.rpc("vertex_save_design", {
                p_user_id: ctx.user.id,
                p_design_id: input.id,
                p_name: input.name,
                p_pattern: state.pattern,
                p_method: state.method,
                p_thickness_mm: state.thicknessMm,
                p_unit: state.corrections.unit,
                p_linked: state.corrections.linked,
                p_corrections: {
                    left: state.corrections.left,
                    right: state.corrections.right,
                },
                p_elements: state.elements,
                p_ip: ctx.ip,
            });

            if (error) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Design save failed: ${error.message}`,
                });
            }

            return data as { ok: true };
        }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const supabase = requireSupabaseAdmin();
        const { data: owned, error: ownedError } = await supabase
            .from("designs")
            .select("id")
            .eq("id", input.id)
            .eq("ownerId", ctx.user.id)
            .maybeSingle();

        if (ownedError) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to verify design ownership: ${ownedError.message}`,
            });
        }
        if (!owned) throw new TRPCError({ code: "NOT_FOUND" });

        const { error } = await supabase.from("designs").delete().eq("id", input.id);
        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to delete design: ${error.message}`,
            });
        }

        return { ok: true };
    }),
});
