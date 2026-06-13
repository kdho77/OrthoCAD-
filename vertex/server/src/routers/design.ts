import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { designStateSchema } from "../lib/design-schema.js";
import { protectedProcedure, router } from "../trpc.js";

export const designRouter = router({
    list: protectedProcedure.input(z.object({ clientId: z.string().uuid() })).query(({ ctx, input }) =>
        ctx.prisma.design.findMany({
            where: { clientId: input.clientId, ownerId: ctx.user.id },
            orderBy: { updatedAt: "desc" },
            select: { id: true, name: true, pattern: true, method: true, updatedAt: true },
        }),
    ),

    get: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
        const design = await ctx.prisma.design.findFirst({
            where: { id: input.id, ownerId: ctx.user.id },
            include: { corrections: true, elements: true },
        });
        if (!design) throw new TRPCError({ code: "NOT_FOUND" });
        return design;
    }),

    create: protectedProcedure
        .input(z.object({ clientId: z.string().uuid(), name: z.string().min(1).max(120) }))
        .mutation(async ({ ctx, input }) => {
            const client = await ctx.prisma.client.findFirst({
                where: { id: input.clientId, ownerId: ctx.user.id },
            });
            if (!client) throw new TRPCError({ code: "NOT_FOUND", message: "Client not found" });
            const design = await ctx.prisma.design.create({
                data: { clientId: input.clientId, ownerId: ctx.user.id, name: input.name },
            });
            await ctx.prisma.auditLog.create({
                data: {
                    userId: ctx.user.id,
                    action: "design_created",
                    targetId: design.id,
                    ipAddress: ctx.ip,
                },
            });
            return design;
        }),

    // Persists the full design: header fields + relational corrections + elements.
    save: protectedProcedure
        .input(
            z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), state: designStateSchema }),
        )
        .mutation(async ({ ctx, input }) => {
            const owned = await ctx.prisma.design.findFirst({
                where: { id: input.id, ownerId: ctx.user.id },
            });
            if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
            const { state } = input;

            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }

            const { data, error } = await supabase.rpc("vertex_save_design", {
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
        const owned = await ctx.prisma.design.findFirst({ where: { id: input.id, ownerId: ctx.user.id } });
        if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.prisma.design.delete({ where: { id: input.id } });
        return { ok: true };
    }),
});
