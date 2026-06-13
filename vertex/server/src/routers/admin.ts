import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireSupabaseAdmin } from "../lib/supabase-db.js";
import { adminProcedure, router, superAdminProcedure } from "../trpc.js";

// Super Admin Portal API: user/token/license administration and audit access.
export const adminRouter = router({
    listUsers: adminProcedure
        .input(z.object({ search: z.string().optional() }).optional())
        .query(async ({ input }) => {
            const supabase = requireSupabaseAdmin();
            let query = supabase
                .from("users")
                .select("id, email, fullName, role, tokenBalance, isActive")
                .order("createdAt", { ascending: false })
                .limit(200);

            if (input?.search) {
                const term = `%${input.search}%`;
                query = query.or(`email.ilike.${term},fullName.ilike.${term}`);
            }

            const { data, error } = await query;
            if (error) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to list users: ${error.message}`,
                });
            }

            return data ?? [];
        }),

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

            const supabase = requireSupabaseAdmin();
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

    listLicenses: adminProcedure.query(async () => {
        const supabase = requireSupabaseAdmin();
        const { data, error } = await supabase
            .from("licenses")
            .select("*, owner:users!ownerId(email)")
            .order("createdAt", { ascending: false })
            .limit(200);

        if (error) {
            throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: `Failed to list licenses: ${error.message}`,
            });
        }

        return data ?? [];
    }),

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
            const supabase = requireSupabaseAdmin();
            const { data: license, error } = await supabase
                .from("licenses")
                .insert({
                    ownerId: input.ownerId,
                    type: input.type,
                    seats: input.seats,
                    expiresAt: input.expiresAt ?? null,
                    status: "active",
                })
                .select()
                .single();

            if (error || !license) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to create license: ${error?.message ?? "unknown error"}`,
                });
            }

            await supabase.from("audit_logs").insert({
                userId: ctx.user.id,
                action: "license_created",
                targetId: license.id,
                ipAddress: ctx.ip,
            });

            return license;
        }),

    renewLicense: superAdminProcedure
        .input(z.object({ id: z.string().uuid(), expiresAt: z.string().datetime() }))
        .mutation(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data: license, error } = await supabase
                .from("licenses")
                .update({ status: "active", expiresAt: input.expiresAt })
                .eq("id", input.id)
                .select()
                .single();

            if (error || !license) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to renew license: ${error?.message ?? "unknown error"}`,
                });
            }

            await supabase.from("audit_logs").insert({
                userId: ctx.user.id,
                action: "license_renewed",
                targetId: input.id,
                ipAddress: ctx.ip,
            });

            return license;
        }),

    revokeLicense: superAdminProcedure
        .input(z.object({ id: z.string().uuid() }))
        .mutation(async ({ ctx, input }) => {
            const supabase = requireSupabaseAdmin();
            const { data: license, error } = await supabase
                .from("licenses")
                .update({ status: "revoked" })
                .eq("id", input.id)
                .select()
                .single();

            if (error || !license) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to revoke license: ${error?.message ?? "unknown error"}`,
                });
            }

            await supabase.from("audit_logs").insert({
                userId: ctx.user.id,
                action: "license_revoked",
                targetId: input.id,
                ipAddress: ctx.ip,
            });

            return license;
        }),

    listAuditLogs: adminProcedure
        .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }).optional())
        .query(async ({ input }) => {
            const supabase = requireSupabaseAdmin();
            const { data, error } = await supabase
                .from("audit_logs")
                .select("*, user:users(email)")
                .order("createdAt", { ascending: false })
                .limit(input?.limit ?? 100);

            if (error) {
                throw new TRPCError({
                    code: "INTERNAL_SERVER_ERROR",
                    message: `Failed to list audit logs: ${error.message}`,
                });
            }

            return data ?? [];
        }),
});
