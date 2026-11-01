// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import type { Context } from "../context.js";
import { createCallerFactory } from "../trpc.js";
import { appRouter } from "./index.js";

const createCaller = createCallerFactory(appRouter);

function callerFor(role: string | null) {
    const ctx = {
        prisma: {} as Context["prisma"],
        prismaDirect: {} as Context["prismaDirect"],
        user: role
            ? { id: "00000000-0000-4000-8000-000000000099", email: `${role}@example.com`, role }
            : null,
        ip: "127.0.0.1",
    } as Context;
    return createCaller(ctx);
}

describe("client and design routes require a session", () => {
    test("anonymous callers are rejected before any client or design read", async () => {
        const caller = callerFor(null);
        const id = "00000000-0000-4000-8000-000000000010";
        const checks = [
            caller.client.list(),
            caller.client.archive({ id }),
            caller.client.hardDelete({ id }),
            caller.design.list({ clientId: id }),
            caller.design.delete({ id }),
            caller.design.restore({ id }),
        ];
        for (const check of checks) {
            try {
                await check;
                throw new Error("expected UNAUTHORIZED");
            } catch (error) {
                expect(error).toBeInstanceOf(TRPCError);
                expect((error as TRPCError).code).toBe("UNAUTHORIZED");
            }
        }
    });
});
