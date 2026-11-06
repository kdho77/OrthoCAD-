// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";

import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "./auth/cad-operator.js";
import type { Context } from "./context.js";
import { protectedProcedure, router, sessionOrCadOperatorProcedure } from "./trpc.js";

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-dogfood",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

const probe = router({
    sessionOnly: protectedProcedure.query(() => "session"),
    designRead: sessionOrCadOperatorProcedure("design:read").query(
        ({ ctx }) => ctx.cadOperator?.credentialId ?? "session",
    ),
    prepare: sessionOrCadOperatorProcedure("manufacturing:prepare").query(() => "prepare"),
    generate: sessionOrCadOperatorProcedure("manufacturing:generate").query(() => "generate"),
    download: sessionOrCadOperatorProcedure("manufacturing:download").query(() => "download"),
});

function caller(patch: Partial<Context>) {
    return probe.createCaller({
        prisma: {} as Context["prisma"],
        prismaDirect: {} as Context["prismaDirect"],
        user: null,
        cadOperator: null,
        ip: null,
        ...patch,
    });
}

async function codeOf(run: Promise<unknown>): Promise<string> {
    try {
        await run;
        return "OK";
    } catch (error) {
        return error instanceof TRPCError ? error.code : "OTHER";
    }
}

describe("CAD-operator bearer does not bypass session procedures", () => {
    test("no auth is unauthorized on design read and manufacturing", async () => {
        const api = caller({});
        expect(await codeOf(api.designRead())).toBe("UNAUTHORIZED");
        expect(await codeOf(api.prepare())).toBe("UNAUTHORIZED");
        expect(await codeOf(api.generate())).toBe("UNAUTHORIZED");
        expect(await codeOf(api.download())).toBe("UNAUTHORIZED");
        expect(await codeOf(api.sessionOnly())).toBe("UNAUTHORIZED");
    });

    test("dogfood operator can call the four scopes and still cannot call protectedProcedure", async () => {
        const api = caller({ cadOperator: principal });
        expect(await api.designRead()).toBe("cred-dogfood");
        expect(await api.prepare()).toBe("prepare");
        expect(await api.generate()).toBe("generate");
        expect(await api.download()).toBe("download");
        expect(await codeOf(api.sessionOnly())).toBe("UNAUTHORIZED");
    });

    test("a principal without dogfood scope is rejected", async () => {
        const api = caller({
            cadOperator: { ...principal, scopes: ["design:read"] },
        });
        expect(await api.designRead()).toBe("cred-dogfood");
        expect(await codeOf(api.generate())).toBe("UNAUTHORIZED");
    });
});
