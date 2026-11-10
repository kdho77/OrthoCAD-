// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";

import { type CadOperatorPrincipal, DOGFOOD_TENANT_ID } from "./auth/cad-operator.js";
import type { Context } from "./context.js";

const handed: Promise<unknown>[] = [];
let releaseMaterialize: (() => void) | null = null;
let charges = 0;

interface MemoryRow {
    id: string;
    idempotencyKey: string;
    status: string;
    [key: string]: unknown;
}

function memoryStore() {
    const rows = new Map<string, MemoryRow>();
    const clone = (row: MemoryRow): MemoryRow => ({
        ...row,
        createdAt: new Date(row.createdAt as Date),
        updatedAt: new Date(row.updatedAt as Date),
        leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt as Date) : null,
        chargedAt: row.chargedAt ? new Date(row.chargedAt as Date) : null,
    });
    return {
        async insert(row: MemoryRow) {
            rows.set(row.id, clone(row));
            return clone(row);
        },
        async findById(id: string) {
            const row = rows.get(id);
            return row ? clone(row) : null;
        },
        async findByKey(idempotencyKey: string) {
            for (const existing of rows.values()) {
                if (existing.idempotencyKey === idempotencyKey) return clone(existing);
            }
            return null;
        },
        async updateIf(id: string, predicate: (row: MemoryRow) => boolean, patch: Partial<MemoryRow>) {
            const row = rows.get(id);
            if (!row || !predicate(row)) return null;
            const next = clone({ ...row, ...patch });
            rows.set(id, next);
            return clone(next);
        },
        async listByDesign() {
            return [];
        },
    };
}

rs.mock("@vercel/functions", () => ({
    waitUntil(promise: Promise<unknown>) {
        handed.push(promise);
    },
}));

rs.mock("./context.js", () => ({
    getSupabaseAdmin: () => ({}),
}));

rs.mock("./lib/supabase-db.js", () => ({
    requireSupabaseAdmin: () => ({}),
    assertActiveLicense: async () => undefined,
    getUserTokenBalance: async () => 12,
}));

rs.mock("./lib/cad-operator-production-prisma.js", () => ({
    PrismaCadProductionStore: class {
        private readonly inner = memoryStore();
        insert(row: MemoryRow) {
            return this.inner.insert(row);
        }
        findById(id: string) {
            return this.inner.findById(id);
        }
        findByKey(key: string) {
            return this.inner.findByKey(key);
        }
        updateIf(id: string, predicate: (row: MemoryRow) => boolean, patch: Partial<MemoryRow>) {
            return this.inner.updateIf(id, predicate, patch);
        }
        listByDesign() {
            return this.inner.listByDesign();
        }
    },
    chargeExistingProduction: async () => {
        charges += 1;
        return { exportId: "exp-1", balance: 9, alreadyCharged: false };
    },
}));

rs.mock("./routers/manufacturing-cad.js", () => ({
    prepareCadOperatorGenerate: async () => ({
        stlStorageKey: "manufacturing-temp/cad-operator/stored.stl",
        presetId: "apex-v2-insole-95a",
        printRecipe: {
            version: 1,
            pattern: "gyroid",
            profileId: "apex-v2-insole-95a",
            defaultHardness: "Hard",
            zones: [],
        },
        material: "apex_core",
        beltAngleDeg: 45,
        ownerId: "11111111-1111-4111-8111-111111111111",
        useSavedDesignMesh: true,
        settingsJson: { schemaVersion: 1, firstName: "Jane Doe" },
    }),
    materializeCadOperatorStl: () =>
        new Promise((resolve) => {
            releaseMaterialize = () => {
                resolve({ stlStorageKey: "manufacturing-temp/left.stl", meshFingerprint: "mesh" });
            };
        }),
    loadDogfoodDesign: async () => {
        throw new Error("not used");
    },
}));

const { manufacturingRouter } = await import("./routers/manufacturing.js");
const { createCallerFactory } = await import("./trpc.js");
const createCaller = createCallerFactory(manufacturingRouter);

const principal: CadOperatorPrincipal = {
    kind: "cad_operator",
    credentialId: "cred-flush",
    tenantId: DOGFOOD_TENANT_ID,
    scopes: ["design:read", "manufacturing:prepare", "manufacturing:generate", "manufacturing:download"],
};

describe("tRPC generateSolid", () => {
    test("generateSolid resolves before executeCadOperatorProduction finishes", async () => {
        const caller = createCaller({
            prisma: {} as Context["prisma"],
            prismaDirect: {} as Context["prismaDirect"],
            user: null,
            cadOperator: principal,
            ip: null,
        });
        const result = await Promise.race([
            caller.generateSolid({
                designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                side: "left",
                presetId: "apex-v2-insole-95a",
                stlStorageKey: "manufacturing-temp/cad-operator/stored.stl",
                outputType: "gcode",
                beltAngleDeg: 45,
                useSavedDesignMesh: true,
                patientName: "Jane Doe",
            }),
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error("generateSolid stayed open until execute finished")), 1000);
            }),
        ]);
        expect(result).toMatchObject({
            ok: true,
            outputType: "gcode",
            status: "pending",
            side: "left",
        });
        expect(result.productionId).toMatch(/^[0-9a-f-]{36}$/);
        expect(handed).toHaveLength(1);
        expect(charges).toBe(0);
        let settled = false;
        void handed[0]?.then(
            () => {
                settled = true;
            },
            () => {
                settled = true;
            },
        );
        await Promise.resolve();
        expect(settled).toBe(false);
        for (let i = 0; i < 50 && !releaseMaterialize; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(releaseMaterialize).toBeTruthy();
        releaseMaterialize?.();
        await handed[0];
        expect(charges).toBe(0);
        expect(JSON.stringify(result)).not.toMatch(/Jane Doe|settingsJson|G1 /);
    });
});
