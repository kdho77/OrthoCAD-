// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";

import { gyroidInfillPctForHardness } from "../../shared/print-recipe/print-recipe.js";
import {
    CAD_OPERATOR_BELT_MATERIAL,
    type CadOperatorPrincipal,
    DOGFOOD_TENANT_ID,
} from "./auth/cad-operator.js";
import type { Context } from "./context.js";
import * as contextMod from "./context.js";
import * as meshRunner from "./lib/finalized-mesh-runner.js";
import { runCadOperatorGenerateRequest } from "./routers/cad-operator-generate.js";
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

const DESIGN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function designRow() {
    return {
        id: DESIGN_ID,
        ownerId: OWNER_ID,
        name: "Sample",
        kind: "insole",
        pattern: "gyroid",
        method: "printing_solid",
        thicknessMm: 3,
        linked: true,
        unit: "mm",
        settingsJson: {
            schemaVersion: 1,
            settings: {
                printRecipe: {
                    version: 1,
                    pattern: "gyroid",
                    profileId: "apex-v2-insole-95a",
                    defaultHardness: "Hard",
                    zones: [],
                },
            },
        },
        updatedAt: new Date("2026-11-10T16:00:00.000Z"),
        deletedAt: null,
        client: { tenantId: DOGFOOD_TENANT_ID, firstName: "Ada", lastName: "Lovelace" },
        integrationLink: {
            tenantId: DOGFOOD_TENANT_ID,
            source: "vo2",
            externalOrderId: "order-1",
            sides: "both",
        },
    };
}

function memoryPrisma() {
    const productions = new Map<string, Record<string, unknown>>();
    const production = {
        async create({ data }: { data: Record<string, unknown> }) {
            const row = { ...data };
            productions.set(String(data.id), row);
            return row;
        },
        async findUnique({ where }: { where: { id?: string; idempotencyKey?: string } }) {
            if (where.id) return productions.get(where.id) ?? null;
            if (where.idempotencyKey) {
                return (
                    [...productions.values()].find((row) => row.idempotencyKey === where.idempotencyKey) ??
                    null
                );
            }
            return null;
        },
        async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
            const row = productions.get(where.id);
            if (!row) throw new Error("missing production");
            for (const [key, value] of Object.entries(data)) {
                if (value !== undefined) row[key] = value;
            }
            return { ...row };
        },
        async findMany() {
            return [...productions.values()];
        },
    };
    const prisma = {
        design: {
            findUnique: async () => designRow(),
            update: async () => designRow(),
        },
        production,
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
            fn({
                $queryRaw: async () => [{ id: "locked" }],
                production,
            }),
        $queryRaw: async () => [{ result: { exportId: "exp-1", balance: 4, alreadyCharged: false } }],
    };
    return { prisma: prisma as unknown as PrismaClient, productions };
}

describe("CAD-operator generate honors the caller material", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete process.env.VERTEXSLICE_SLICER_URL;
        delete process.env.VERTEXSLICE_API_KEY;
    });

    test("hardness infill percents stay on the locked ladder", () => {
        expect(gyroidInfillPctForHardness("Extra Soft")).toBe(14);
        expect(gyroidInfillPctForHardness("Soft")).toBe(20);
        expect(gyroidInfillPctForHardness("Medium")).toBe(26);
        expect(gyroidInfillPctForHardness("Hard")).toBe(32);
        expect(gyroidInfillPctForHardness("Extra Hard")).toBe(38);
        expect(CAD_OPERATOR_BELT_MATERIAL).toBe("apex_core");
    });

    test("apex_light and ApexLight Foam reach the VertexSlice form, not apex_core", async () => {
        const light = await sliceCallerMaterial({ material: "apex_light", presetId: "apex-v2-insole-95a" });
        const foam = await sliceCallerMaterial({
            material: "ApexLight Foam",
            presetId: "apex-v2-insole-95a",
        });
        for (const sliced of [light, foam]) {
            expect(sliced.form.get("material")).toBe("apex_light");
            expect(sliced.form.get("material")).not.toBe("apex_core");
            expect(sliced.form.get("profile_id")).toBe("apex-v2-insole-95a");
            expect(sliced.form.get("infill_density")).toBe("32");
            expect(sliced.form.get("nozzle_temp")).toBeNull();
            expect(sliced.productionMaterial).toBe("apex_light");
            expect(sliced.uploadedGcode).toContain("filament_type = apex_light");
            expect(sliced.uploadedGcode).not.toContain("filament_type = apex_core");
        }
    });

    test("omitted material and preset use apex_core and the locked profile", async () => {
        const sliced = await sliceCallerMaterial({});
        expect(sliced.form.get("material")).toBe("apex_core");
        expect(sliced.form.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(sliced.form.get("infill_density")).toBe("32");
        expect(sliced.productionMaterial).toBe("apex_core");
        expect(sliced.uploadedGcode).toContain("filament_type = apex_core");
    });

    test("unknown material, Apex Forge, and an unlocked preset are rejected before slicing", async () => {
        await expect(sliceCallerMaterial({ material: "TPU 95A" })).rejects.toThrow(/Unknown print material/);
        await expect(sliceCallerMaterial({ material: "apex_forge" })).rejects.toThrow(
            /disabled until print settings/i,
        );
        await expect(sliceCallerMaterial({ material: "Apex Forge" })).rejects.toThrow(
            /disabled until print settings/i,
        );
        await expect(
            sliceCallerMaterial({ material: "apex_light", presetId: "gyroid-production-v1" }),
        ).rejects.toThrow(/not substituted/);
    });
});

async function sliceCallerMaterial(input: { material?: string; presetId?: string }) {
    process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
    process.env.VERTEXSLICE_API_KEY = "unit-test-key";
    const uploads: Buffer[] = [];
    const adminSpy = rs.spyOn(contextMod, "getSupabaseAdmin").mockReturnValue({
        rpc: async () => ({ data: null, error: null }),
        from: () => ({
            select: () => ({
                eq: () => ({
                    single: async () => ({ data: { tokenBalance: 50 }, error: null }),
                }),
            }),
            update: () => ({
                eq: async () => ({ error: null }),
            }),
        }),
        storage: {
            from: () => ({
                upload: async (_key: string, data: Buffer) => {
                    uploads.push(Buffer.from(data));
                    return { error: null };
                },
                createSignedUrl: async () => ({
                    data: { signedUrl: "http://127.0.0.1/model.stl" },
                    error: null,
                }),
                download: async () => ({ data: null, error: { message: "archive skipped" } }),
                remove: async () => ({ error: null }),
            }),
        },
    } as never);
    const meshSpy = rs.spyOn(meshRunner, "buildHeadlessFinalizedFoot").mockResolvedValue({
        side: "left",
        stl: new Uint8Array([1, 2, 3, 4]).buffer,
        solidTriangles: 1,
        uploadTriangles: 1,
        fingerprint: "mesh-fp",
    });
    const forms: FormData[] = [];
    let sliceCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/v1/materials")) {
            return new Response(JSON.stringify(["apex_core", "apex_light", "apex_bounce"]), { status: 200 });
        }
        if (url.endsWith("/v1/slice")) {
            sliceCalls += 1;
            forms.push(init?.body as FormData);
            const selected = (init?.body as FormData).get("material");
            return new Response(`; filament_type = ${selected}\nG1 X0\n`, { status: 200 });
        }
        if (url.includes("model.stl")) {
            return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
        }
        return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const { prisma, productions } = memoryPrisma();
    let scheduled: Promise<void> | null = null;
    try {
        await runCadOperatorGenerateRequest({
            prisma,
            principal,
            ip: null,
            now: () => new Date("2026-11-10T16:00:00.000Z"),
            schedule: (work) => {
                scheduled = work;
            },
            input: {
                designId: DESIGN_ID,
                side: "left",
                presetId: input.presetId,
                stlStorageKey: "saved-design-internal",
                outputType: "gcode",
                beltAngleDeg: 45,
                useSavedDesignMesh: true,
                patientName: "Ada Lovelace",
                hardness: "Hard",
                material: input.material,
            },
        });
        if (!scheduled) throw new Error("slice was not scheduled");
        await scheduled;
        if (sliceCalls !== 1) throw new Error(`expected one slice call, saw ${sliceCalls}`);
        const form = forms[0];
        if (!form) throw new Error("VertexSlice form was not sent");
        const productionMaterial = [...productions.values()][0]?.material;
        return {
            form,
            productionMaterial,
            uploadedGcode: uploads.map((bytes) => bytes.toString("utf8")).join("\n"),
        };
    } finally {
        adminSpy.mockRestore();
        meshSpy.mockRestore();
    }
}
