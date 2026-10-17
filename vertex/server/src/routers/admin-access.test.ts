// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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

async function expectForbidden(fn: () => Promise<unknown>) {
    try {
        await fn();
        throw new Error("expected FORBIDDEN");
    } catch (e) {
        expect(e).toBeInstanceOf(TRPCError);
        expect((e as TRPCError).code).toBe("FORBIDDEN");
    }
}

describe("super-admin tenant API role enforcement", () => {
    test("unauthenticated caller is rejected", async () => {
        try {
            await callerFor(null).admin.tenants.list();
            throw new Error("expected UNAUTHORIZED");
        } catch (e) {
            expect(e).toBeInstanceOf(TRPCError);
            expect((e as TRPCError).code).toBe("UNAUTHORIZED");
        }
    });

    test("clinician receives 403 on tenant and audit procedures", async () => {
        const caller = callerFor("clinician");
        await expectForbidden(() => caller.admin.tenants.list());
        await expectForbidden(() => caller.admin.tenants.get({ id: "00000000-0000-4000-8000-000000000010" }));
        await expectForbidden(() =>
            caller.admin.tenants.grantTokens({
                tenantId: "00000000-0000-4000-8000-000000000010",
                amount: 10,
                reason: "Purchase",
            }),
        );
        await expectForbidden(() => caller.admin.tenantAudit.list());
        await expectForbidden(() => caller.admin.tenantAudit.csv());
    });

    test("clinic admin role is not enough — super_admin only", async () => {
        const caller = callerFor("admin");
        await expectForbidden(() => caller.admin.tenants.list());
        await expectForbidden(() =>
            caller.admin.tenants.suspend({
                tenantId: "00000000-0000-4000-8000-000000000010",
                reason: "nonpayment",
                confirmName: "Apex",
            }),
        );
    });
});
