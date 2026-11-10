// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { readFileSync } from "node:fs";
import { describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import type { Context } from "../context";
import { createCallerFactory } from "../trpc";
import { appRouter } from "./index";

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

describe("bridge enrollment admin guard", () => {
    test("bridge enrollment and pairing approval use the admin guard", () => {
        const source = readFileSync("vertex/server/src/routers/production.ts", "utf8");
        const guarded = [...source.matchAll(/(\w+):\s*bridgeAdminProcedure/g)].map((match) => match[1]);
        expect(guarded).toEqual([
            "createBridgeEnrollment",
            "revokeBridge",
            "approveBridgePairing",
            "listEnrolledBridges",
        ]);
        expect(source).toContain("saveMoonrakerPrinter: protectedProcedure");
        expect(source).toContain('message: "Admin access required"');
        expect(source).toContain("Cloud origin is not configured.");
        expect(source).toContain("return { bridgeId: result.bridgeId, bridgeName: input.bridgeName.trim() }");
    });

    test("a signed-out caller and a non-admin are rejected before any enrollment is written", async () => {
        try {
            await callerFor(null).production.createBridgeEnrollment({ bridgeName: "Bay" });
            throw new Error("expected UNAUTHORIZED");
        } catch (error) {
            expect(error).toBeInstanceOf(TRPCError);
            expect((error as TRPCError).code).toBe("UNAUTHORIZED");
        }
        for (const role of ["clinician", "staff"]) {
            try {
                await callerFor(role).production.createBridgeEnrollment({ bridgeName: "Bay" });
                throw new Error(`expected FORBIDDEN for ${role}`);
            } catch (error) {
                expect(error).toBeInstanceOf(TRPCError);
                expect((error as TRPCError).code).toBe("FORBIDDEN");
                expect((error as TRPCError).message).toBe("Admin access required");
            }
            try {
                await callerFor(role).production.revokeBridge({
                    bridgeId: "00000000-0000-4000-8000-0000000000aa",
                });
                throw new Error(`expected FORBIDDEN revoke for ${role}`);
            } catch (error) {
                expect(error).toBeInstanceOf(TRPCError);
                expect((error as TRPCError).code).toBe("FORBIDDEN");
                expect((error as TRPCError).message).toBe("Admin access required");
            }
            try {
                await callerFor(role).production.approveBridgePairing({
                    code: "ABCD-EFGH",
                    bridgeName: "Bay",
                });
                throw new Error(`expected FORBIDDEN approve for ${role}`);
            } catch (error) {
                expect(error).toBeInstanceOf(TRPCError);
                expect((error as TRPCError).code).toBe("FORBIDDEN");
                expect((error as TRPCError).message).toBe("Admin access required");
            }
        }
    });
});
