import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getSupabaseAdmin } from "../context.js";
import { adminProcedure, router, superAdminProcedure } from "../trpc.js";

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
        .mutation(async ({ ctx, input }) => {
            console.log("[admin] grantTokens request", {
                actorId: ctx.user.id,
                actorRole: ctx.user.role,
                targetUserId: input.userId,
                amount: input.amount,
                reason: input.reason ?? null,
            });

            if (input.amount === 0) {
                throw new TRPCError({ code: "BAD_REQUEST", message: "Grant amount must be non-zero" });
            }

            // ROOT CAUSE of the production 500: Supabase-authenticated users are
            // never mirrored into the app `users` table (no signup/sign-in sync
            // anywhere in the codebase). The Super Admin Portal grants to the
            // logged-in user themselves (userId === ctx.user.id), so BOTH the
            // update target AND the AuditLog actor FK (userId) pointed at a row
            // that does not exist. `user.update` then threw Prisma P2025 and the
            // audit insert would have thrown P2003 — rolling the transaction back
            // and returning a 500 (an HTML crash page on Vercel). Lazily provision
            // the acting user so these foreign keys resolve.
            // Actor is provisioned by protectedProcedure middleware before we get here.

            // Resolve the target. For self-grants (the portal's path) it now exists
            // because we just provisioned it above; for an explicit other userId a
            // missing record yields a clear 404 instead of an opaque Prisma error.
            const target = await ctx.prisma.user.findUnique({
                where: { id: input.userId },
                select: { id: true, email: true, tokenBalance: true },
            });
            if (!target) {
                console.warn("[admin] grantTokens target user not found", { targetUserId: input.userId });
                throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
            }

            // Token balances are non-negative; reject removals that would underflow.
            if (input.amount < 0 && target.tokenBalance + input.amount < 0) {
                throw new TRPCError({
                    code: "BAD_REQUEST",
                    message: `Cannot remove ${-input.amount} tokens — user only has ${target.tokenBalance}`,
                });
            }

            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }

            const { data, error } = await supabase.rpc("vertex_grant_admin_tokens", {
                p_actor_user_id: ctx.user.id,
                p_target_user_id: input.userId,
                p_amount: input.amount,
                p_reason: input.reason ?? null,
                p_ip: ctx.ip,
            });

            if (error) {
                console.error("[admin] grantTokens failed", {
                    actorId: ctx.user.id,
                    targetUserId: input.userId,
                    amount: input.amount,
                    error: error.message,
                });
                if (error.message.includes("NOT_FOUND")) {
                    throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
                }
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to grant tokens: ${error.message}`,
                });
            }

            const result = data as { ok: true; balance: number };
            console.log("[admin] grantTokens success", {
                actorId: ctx.user.id,
                targetUserId: input.userId,
                amount: input.amount,
                newBalance: result.balance,
            });
            return result;
        }),

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
