import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

export const clientRouter = router({
    list: protectedProcedure.query(({ ctx }) =>
        ctx.prisma.client.findMany({
            where: { ownerId: ctx.user.id },
            orderBy: { createdAt: "desc" },
            include: { _count: { select: { designs: true } } },
        }),
    ),

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
        .mutation(({ ctx, input }) =>
            ctx.prisma.client.create({ data: { ...input, ownerId: ctx.user.id } }),
        ),

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
            const owned = await ctx.prisma.client.findFirst({ where: { id, ownerId: ctx.user.id } });
            if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
            return ctx.prisma.client.update({ where: { id }, data: patch });
        }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const owned = await ctx.prisma.client.findFirst({ where: { id: input.id, ownerId: ctx.user.id } });
        if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.prisma.client.delete({ where: { id: input.id } });
        return { ok: true };
    }),
});
