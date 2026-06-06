import { z } from "zod";
import { adminProcedure, router, superAdminProcedure } from "../trpc";

// Super Admin Portal API: user/token/license administration and audit access.
export const adminRouter = router({
    listUsers: adminProcedure
        .input(z.object({ search: z.string().optional() }).optional())
        .query(({ ctx, input }) =>
            ctx.prisma.user.findMany({
                where: input?.search
                    ? {
                          OR: [
                              { email: { contains: input.search, mode: "insensitive" } },
                              { fullName: { contains: input.search, mode: "insensitive" } },
                          ],
                      }
                    : undefined,
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    role: true,
                    tokenBalance: true,
                    isActive: true,
                },
                take: 200,
            }),
        ),

    // Grant (or remove, if negative) tokens in bulk, recording a transaction + audit.
    grantTokens: superAdminProcedure
        .input(
            z.object({
                userId: z.string().uuid(),
                amount: z.number().int(),
                reason: z.string().max(200).optional(),
            }),
        )
        .mutation(async ({ ctx, input }) =>
            ctx.prisma.$transaction(async (tx) => {
                const user = await tx.user.update({
                    where: { id: input.userId },
                    data: { tokenBalance: { increment: input.amount } },
                });
                await tx.tokenTransaction.create({
                    data: {
                        userId: input.userId,
                        type: input.amount >= 0 ? "grant" : "adjustment",
                        amount: input.amount,
                        balance: user.tokenBalance,
                        reason: input.reason ?? "admin grant",
                    },
                });
                await tx.auditLog.create({
                    data: {
                        userId: ctx.user.id,
                        action: "tokens_granted",
                        targetId: input.userId,
                        metadata: { amount: input.amount },
                        ipAddress: ctx.ip,
                    },
                });
                return { ok: true, balance: user.tokenBalance };
            }),
        ),

    listLicenses: adminProcedure.query(({ ctx }) =>
        ctx.prisma.license.findMany({
            orderBy: { createdAt: "desc" },
            include: { owner: { select: { email: true } } },
            take: 200,
        }),
    ),

    createLicense: superAdminProcedure
        .input(
            z.object({
                ownerId: z.string().uuid(),
                type: z.enum(["monthly", "yearly", "per_seat"]),
                seats: z.number().int().min(1).default(1),
                expiresAt: z.string().datetime().optional(),
            }),
        )
        .mutation(async ({ ctx, input }) => {
            const license = await ctx.prisma.license.create({
                data: {
                    ownerId: input.ownerId,
                    type: input.type,
                    seats: input.seats,
                    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
                    status: "active",
                },
            });
            await ctx.prisma.auditLog.create({
                data: {
                    userId: ctx.user.id,
                    action: "license_created",
                    targetId: license.id,
                    ipAddress: ctx.ip,
                },
            });
            return license;
        }),

    renewLicense: superAdminProcedure
        .input(z.object({ id: z.string().uuid(), expiresAt: z.string().datetime() }))
        .mutation(async ({ ctx, input }) => {
            const license = await ctx.prisma.license.update({
                where: { id: input.id },
                data: { status: "active", expiresAt: new Date(input.expiresAt) },
            });
            await ctx.prisma.auditLog.create({
                data: {
                    userId: ctx.user.id,
                    action: "license_renewed",
                    targetId: input.id,
                    ipAddress: ctx.ip,
                },
            });
            return license;
        }),

    revokeLicense: superAdminProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const license = await ctx.prisma.license.update({
                where: { id: input.id },
                data: { status: "revoked" },
            });
            await ctx.prisma.auditLog.create({
                data: {
                    userId: ctx.user.id,
                    action: "license_revoked",
                    targetId: input.id,
                    ipAddress: ctx.ip,
                },
            });
            return license;
        }),

    listAuditLogs: adminProcedure
        .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
        .query(({ ctx, input }) =>
            ctx.prisma.auditLog.findMany({
                orderBy: { createdAt: "desc" },
                take: input?.limit ?? 100,
                include: { user: { select: { email: true } } },
            }),
        ),
});
