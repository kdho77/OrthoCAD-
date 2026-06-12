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

            const supabase = getSupabaseAdmin();
            if (!supabase) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: "Supabase admin client not configured",
                });
            }

            let email: string;
            if (input.userId === ctx.user.id) {
                email = ctx.user.email.trim() || `${ctx.user.id}@placeholder.invalid`;
            } else {
                const { data: target, error: targetError } = await supabase
                    .from("users")
                    .select("email")
                    .eq("id", input.userId)
                    .single();
                if (targetError || !target) {
                    console.warn("[admin] grantTokens target user not found", { targetUserId: input.userId });
                    throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
                }
                email = target.email;
            }

            try {
                const { data: user, error } = await supabase
                    .from("users")
                    .upsert(
                        {
                            email,
                            role: "super_admin",
                            tokenBalance: 0,
                            isActive: true,
                        },
                        { onConflict: "email", ignoreDuplicates: false },
                    )
                    .select("id, email, role, tokenBalance, isActive")
                    .single();

                if (error) throw new Error(`User upsert failed: ${error.message}`);

                if (input.amount < 0 && (user.tokenBalance || 0) + input.amount < 0) {
                    throw new TRPCError({
                        code: "BAD_REQUEST",
                        message: `Cannot remove ${-input.amount} tokens — user only has ${user.tokenBalance || 0}`,
                    });
                }

                const newBalance = (user.tokenBalance || 0) + input.amount;

                const { error: updateError } = await supabase
                    .from("users")
                    .update({
                        tokenBalance: newBalance,
                        updatedAt: new Date().toISOString(),
                    })
                    .eq("email", email);

                if (updateError) throw new Error(`Token grant failed: ${updateError.message}`);

                const { error: txnError } = await supabase.from("token_transactions").insert({
                    userId: user.id,
                    type: input.amount >= 0 ? "grant" : "adjustment",
                    amount: input.amount,
                    balance: newBalance,
                    reason: input.reason ?? "admin grant",
                });
                if (txnError) throw new Error(`Token transaction failed: ${txnError.message}`);

                const { error: auditError } = await supabase.from("audit_logs").insert({
                    userId: ctx.user.id,
                    action: "tokens_granted",
                    targetId: user.id,
                    metadata: { amount: input.amount, balance: newBalance },
                    ipAddress: ctx.ip,
                });
                if (auditError) throw new Error(`Audit log failed: ${auditError.message}`);

                console.log("[admin] grantTokens success", {
                    actorId: ctx.user.id,
                    targetUserId: user.id,
                    amount: input.amount,
                    newBalance,
                });
                return { ok: true, balance: newBalance };
            } catch (err) {
                console.error("[admin] grantTokens failed", {
                    actorId: ctx.user.id,
                    targetUserId: input.userId,
                    amount: input.amount,
                    error: err instanceof Error ? err.message : String(err),
                });
                if (err instanceof TRPCError) throw err;
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: err instanceof Error ? err.message : "Failed to grant tokens",
                });
            }
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
