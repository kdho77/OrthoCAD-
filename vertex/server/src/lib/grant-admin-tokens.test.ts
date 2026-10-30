// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import { grantAdminTokens, isGrantRpcUnavailable, parseGrantRpcResult } from "./grant-admin-tokens";

function supabaseMock(opts: {
    rpc?: { data?: unknown; error?: { message: string } | null };
    user?: { id: string; tokenBalance: number } | null;
    readError?: { message: string };
    update?: { tokenBalance: number } | null;
    updateError?: { message: string };
    onUpdate?: () => void;
}) {
    return {
        rpc: async () => {
            if (opts.rpc?.error) return { data: null, error: opts.rpc.error };
            return { data: opts.rpc?.data ?? null, error: null };
        },
        from: (table: string) => {
            let wrote = false;
            const chain = {
                select: () => chain,
                insert: async () => ({ error: null }),
                update: () => {
                    wrote = true;
                    opts.onUpdate?.();
                    return chain;
                },
                eq: () => chain,
                maybeSingle: async () => {
                    if (table !== "users") return { data: null, error: null };
                    if (wrote) {
                        return { data: opts.update ?? null, error: opts.updateError ?? null };
                    }
                    return { data: opts.user ?? null, error: opts.readError ?? null };
                },
            };
            return chain;
        },
    };
}

describe("grant admin tokens helpers", () => {
    test("treats a missing PostgREST RPC as unavailable so super admin can fall back", () => {
        expect(isGrantRpcUnavailable("Could not find the function public.vertex_grant_admin_tokens")).toBe(
            true,
        );
        expect(isGrantRpcUnavailable("PGRST202: schema cache")).toBe(true);
        expect(isGrantRpcUnavailable("function vertex_grant_admin_tokens(unknown) does not exist")).toBe(
            true,
        );
        expect(isGrantRpcUnavailable("NOT_FOUND")).toBe(false);
    });

    test("parses RPC jsonb in the shapes PostgREST actually returns", () => {
        expect(parseGrantRpcResult({ ok: true, balance: 120 })).toEqual({ ok: true, balance: 120 });
        expect(parseGrantRpcResult([{ ok: true, balance: 88 }])).toEqual({ ok: true, balance: 88 });
        expect(parseGrantRpcResult('{"ok":true,"balance":50}')).toEqual({ ok: true, balance: 50 });
        expect(parseGrantRpcResult({ vertex_grant_admin_tokens: { ok: true, balance: 7 } })).toEqual({
            ok: true,
            balance: 7,
        });
        expect(parseGrantRpcResult(null)).toBeNull();
        expect(parseGrantRpcResult({ ok: true })).toBeNull();
    });
});

describe("grantAdminTokens", () => {
    const ids = {
        actorId: "00000000-0000-4000-8000-000000000001",
        targetUserId: "00000000-0000-4000-8000-000000000002",
        amount: 50,
    };

    test("accepts a PostgREST array-wrapped RPC payload without writing tables", async () => {
        let updates = 0;
        const supabase = supabaseMock({
            rpc: { data: [{ ok: true, balance: 120 }] },
            user: { id: ids.targetUserId, tokenBalance: 70 },
            update: { tokenBalance: 120 },
            onUpdate: () => {
                updates += 1;
            },
        });
        const result = await grantAdminTokens({
            supabase: supabase as never,
            ...ids,
        });
        expect(result).toEqual({ ok: true, balance: 120 });
        expect(updates).toBe(0);
    });

    test("uses table writes when the RPC is missing and never needs Prisma", async () => {
        let updates = 0;
        const supabase = supabaseMock({
            rpc: { error: { message: "Could not find the function public.vertex_grant_admin_tokens" } },
            user: { id: ids.targetUserId, tokenBalance: 10 },
            update: { tokenBalance: 60 },
            onUpdate: () => {
                updates += 1;
            },
        });
        const result = await grantAdminTokens({
            supabase: supabase as never,
            ...ids,
        });
        expect(result).toEqual({ ok: true, balance: 60 });
        expect(updates).toBe(1);
    });

    test("returns a JSON TRPCError when Supabase is not configured (no Prisma engine load)", async () => {
        await expect(grantAdminTokens({ supabase: null, ...ids })).rejects.toMatchObject({
            name: "TRPCError",
            code: "INTERNAL_SERVER_ERROR",
            message: expect.stringMatching(/SUPABASE_SERVICE_ROLE_KEY/),
        });
    });

    test("surfaces 0-row updates as a service-role / RLS error instead of crashing", async () => {
        const supabase = supabaseMock({
            rpc: { error: { message: "PGRST202 schema cache" } },
            user: { id: ids.targetUserId, tokenBalance: 10 },
            update: null,
        });
        try {
            await grantAdminTokens({ supabase: supabase as never, ...ids });
            expect.fail("should have thrown");
        } catch (e) {
            expect(e).toBeInstanceOf(TRPCError);
            expect((e as TRPCError).code).toBe("INTERNAL_SERVER_ERROR");
            expect((e as TRPCError).message).toMatch(/service-role/i);
        }
    });
});
