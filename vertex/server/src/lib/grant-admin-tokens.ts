// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { PrismaClient } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TRPCError } from "@trpc/server";

export type GrantAdminTokensResult = { ok: true; balance: number };

/** PostgREST / SQL messages that mean the grant RPC is not usable. */
export function isGrantRpcUnavailable(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes("could not find the function") ||
        m.includes("schema cache") ||
        m.includes("pgrst202") ||
        m.includes("42883") || // undefined_function
        /vertex_grant_admin_tokens/i.test(message)
    );
}

export function parseGrantRpcResult(data: unknown): GrantAdminTokensResult | null {
    if (!data || typeof data !== "object") return null;
    const row = data as { ok?: unknown; balance?: unknown };
    if (typeof row.balance !== "number" || !Number.isFinite(row.balance)) return null;
    return { ok: true, balance: row.balance };
}

async function grantViaSupabaseTables(
    supabase: SupabaseClient,
    args: {
        actorId: string;
        targetUserId: string;
        amount: number;
        reason: string | null;
        ip: string | null;
    },
): Promise<GrantAdminTokensResult> {
    const { data: user, error: readErr } = await supabase
        .from("users")
        .select("id, tokenBalance")
        .eq("id", args.targetUserId)
        .single();
    if (readErr || !user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
    }

    const next = (user.tokenBalance as number) + args.amount;
    const { data: updated, error: updErr } = await supabase
        .from("users")
        .update({ tokenBalance: next, updatedAt: new Date().toISOString() })
        .eq("id", args.targetUserId)
        .select("tokenBalance")
        .single();
    if (updErr || !updated) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to update token balance: ${updErr?.message ?? "unknown error"}`,
        });
    }

    const balance = updated.tokenBalance as number;
    const txnType = args.amount >= 0 ? "grant" : "adjustment";
    const { error: txnErr } = await supabase.from("token_transactions").insert({
        userId: args.targetUserId,
        type: txnType,
        amount: args.amount,
        balance,
        reason: args.reason ?? "admin grant",
    });
    if (txnErr) {
        console.error("[admin] token_transactions insert failed after balance update", txnErr.message);
    }
    const { error: auditErr } = await supabase.from("audit_logs").insert({
        userId: args.actorId,
        action: "tokens_granted",
        targetId: args.targetUserId,
        metadata: { amount: args.amount, balance },
        ipAddress: args.ip,
    });
    if (auditErr) {
        console.error("[admin] audit_logs insert failed after balance update", auditErr.message);
    }
    return { ok: true, balance };
}

async function grantViaPrisma(
    prisma: PrismaClient,
    args: {
        actorId: string;
        targetUserId: string;
        amount: number;
        reason: string | null;
        ip: string | null;
    },
): Promise<GrantAdminTokensResult> {
    try {
        const balance = await prisma.$transaction(async (tx) => {
            const updated = await tx.user.update({
                where: { id: args.targetUserId },
                data: { tokenBalance: { increment: args.amount } },
            });
            await tx.tokenTransaction.create({
                data: {
                    userId: args.targetUserId,
                    type: args.amount >= 0 ? "grant" : "adjustment",
                    amount: args.amount,
                    balance: updated.tokenBalance,
                    reason: args.reason ?? "admin grant",
                },
            });
            await tx.auditLog.create({
                data: {
                    userId: args.actorId,
                    action: "tokens_granted",
                    targetId: args.targetUserId,
                    metadata: { amount: args.amount, balance: updated.tokenBalance },
                    ipAddress: args.ip,
                },
            });
            return updated.tokenBalance;
        });
        return { ok: true, balance };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/record to update not found|no record was found/i.test(message)) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
        }
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to grant tokens via Prisma: ${message}`,
        });
    }
}

/**
 * Super-admin token grant. Tries the SQL RPC, then direct table writes, then
 * Prisma. A missing/broken RPC must never block a super admin.
 */
export async function grantAdminTokens(args: {
    supabase: SupabaseClient | null;
    prisma: PrismaClient | null;
    actorId: string;
    targetUserId: string;
    amount: number;
    reason?: string | null;
    ip?: string | null;
}): Promise<GrantAdminTokensResult> {
    const reason = args.reason ?? null;
    const ip = args.ip ?? null;

    if (args.supabase) {
        try {
            const { data, error } = await args.supabase.rpc("vertex_grant_admin_tokens", {
                p_actor_user_id: args.actorId,
                p_target_user_id: args.targetUserId,
                p_amount: args.amount,
                p_reason: reason,
                p_ip: ip,
            });
            if (!error) {
                const parsed = parseGrantRpcResult(data);
                if (parsed) return parsed;
                console.error("[admin] grant RPC returned unusable payload — falling back", { data });
            } else if (error.message.includes("NOT_FOUND")) {
                throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
            } else {
                console.error("[admin] grant RPC failed — falling back", {
                    message: error.message,
                    unavailable: isGrantRpcUnavailable(error.message),
                });
            }
        } catch (e) {
            if (e instanceof TRPCError) throw e;
            console.error("[admin] grant RPC threw — falling back", {
                message: e instanceof Error ? e.message : String(e),
            });
        }

        try {
            return await grantViaSupabaseTables(args.supabase, {
                actorId: args.actorId,
                targetUserId: args.targetUserId,
                amount: args.amount,
                reason,
                ip,
            });
        } catch (e) {
            if (e instanceof TRPCError && e.code === "NOT_FOUND") throw e;
            console.error("[admin] supabase table grant failed — trying Prisma", {
                message: e instanceof Error ? e.message : String(e),
            });
            if (!args.prisma) throw e;
        }
    }

    if (args.prisma) {
        return grantViaPrisma(args.prisma, {
            actorId: args.actorId,
            targetUserId: args.targetUserId,
            amount: args.amount,
            reason,
            ip,
        });
    }

    throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Token grant failed: no Supabase admin client or Prisma client is configured",
    });
}
