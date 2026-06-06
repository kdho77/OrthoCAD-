import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { designStateSchema } from "../lib/design-schema";
import { protectedProcedure, router } from "../trpc";

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
                data: { userId: ctx.user.id, action: "design_created", targetId: design.id, ipAddress: ctx.ip },
            });
            return design;
        }),

    // Persists the full design: header fields + relational corrections + elements.
    save: protectedProcedure
        .input(z.object({ id: z.string().uuid(), name: z.string().min(1).max(120), state: designStateSchema }))
        .mutation(async ({ ctx, input }) => {
            const owned = await ctx.prisma.design.findFirst({ where: { id: input.id, ownerId: ctx.user.id } });
            if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
            const { state } = input;

            return ctx.prisma.$transaction(async (tx) => {
                await tx.design.update({
                    where: { id: input.id },
                    data: {
                        name: input.name,
                        pattern: state.pattern,
                        method: state.method,
                        thicknessMm: state.thicknessMm,
                        unit: state.corrections.unit,
                        linked: state.corrections.linked,
                    },
                });
                await tx.correction.deleteMany({ where: { designId: input.id } });
                await tx.element.deleteMany({ where: { designId: input.id } });
                await tx.correction.createMany({
                    data: (["left", "right"] as const).map((side) => ({
                        designId: input.id,
                        side,
                        ...state.corrections[side],
                    })),
                });
                if (state.elements.length > 0) {
                    await tx.element.createMany({
                        data: state.elements.map((e) => ({
                            designId: input.id,
                            side: e.side,
                            kind: e.kind,
                            posX: e.position.x,
                            posY: e.position.y,
                            rotationDeg: e.rotationDeg,
                            scaleX: e.scale.x,
                            scaleY: e.scale.y,
                            heightMm: e.heightMm,
                        })),
                    });
                }
                await tx.auditLog.create({
                    data: { userId: ctx.user.id, action: "design_updated", targetId: input.id, ipAddress: ctx.ip },
                });
                return { ok: true };
            });
        }),

    delete: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
        const owned = await ctx.prisma.design.findFirst({ where: { id: input.id, ownerId: ctx.user.id } });
        if (!owned) throw new TRPCError({ code: "NOT_FOUND" });
        await ctx.prisma.design.delete({ where: { id: input.id } });
        return { ok: true };
    }),
});
