// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { randomUUID } from "node:crypto";
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

function asFiniteBalance(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

function readGrantPayload(value: unknown): GrantAdminTokensResult | null {
    if (!value) return null;
    if (typeof value === "string") {
        try {
            return readGrantPayload(JSON.parse(value));
        } catch {
            return null;
        }
    }
    if (Array.isArray(value)) {
        for (const row of value) {
            const parsed = readGrantPayload(row);
            if (parsed) return parsed;
        }
        return null;
    }
    if (typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const nested = row.vertex_grant_admin_tokens ?? row.vertexGrantAdminTokens ?? row.result ?? row.data;
    if (nested && nested !== value) {
        const parsed = readGrantPayload(nested);
        if (parsed) return parsed;
    }
    const balance = asFiniteBalance(row.balance);
    if (balance == null) return null;
    return { ok: true, balance };
}

export function parseGrantRpcResult(data: unknown): GrantAdminTokensResult | null {
    return readGrantPayload(data);
}

export async function grantViaSupabaseTables(
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
        .maybeSingle();
    if (readErr) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to load target user: ${readErr.message}`,
        });
    }
    if (!user) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Target user not found" });
    }

    const next = (user.tokenBalance as number) + args.amount;
    const { data: updated, error: updErr } = await supabase
        .from("users")
        .update({ tokenBalance: next, updatedAt: new Date().toISOString() })
        .eq("id", args.targetUserId)
        .select("tokenBalance")
        .maybeSingle();
    if (updErr) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to update token balance: ${updErr.message}`,
        });
    }
    if (!updated) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
                "Failed to update token balance: 0 rows (RLS or missing UPDATE grant). " +
                "Service-role key must be SUPABASE_SERVICE_ROLE_KEY, not the anon key.",
        });
    }

    const balance = updated.tokenBalance as number;
    const txnType = args.amount >= 0 ? "grant" : "adjustment";
    const { error: txnErr } = await supabase.from("token_transactions").insert({
        id: randomUUID(),
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
        id: randomUUID(),
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

/**
 * Super-admin token grant. Uses the SQL RPC, then direct table writes.
 * Never touches Prisma — loading the query engine in the Vercel Lambda is
 * what produces FUNCTION_INVOCATION_FAILED / plaintext
 * "A server error has occurred".
 */
export async function grantAdminTokens(args: {
    supabase: SupabaseClient | null;
    actorId: string;
    targetUserId: string;
    amount: number;
    reason?: string | null;
    ip?: string | null;
}): Promise<GrantAdminTokensResult> {
    const reason = args.reason ?? null;
    const ip = args.ip ?? null;

    if (!args.supabase) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
                "Token grant failed: Supabase admin client is not configured " +
                "(set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on this Vercel environment).",
        });
    }

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

    return grantViaSupabaseTables(args.supabase, {
        actorId: args.actorId,
        targetUserId: args.targetUserId,
        amount: args.amount,
        reason,
        ip,
    });
}
