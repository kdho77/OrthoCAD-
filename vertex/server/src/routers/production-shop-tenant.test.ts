// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, beforeEach, describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import type { PrinterRecord } from "../../../shared/production-jobs";

const SHOP = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const MISSING = "33333333-3333-4333-8333-333333333333";
const SUPER_ID = "00000000-0000-4000-8000-0000000000a1";
const ADMIN_ID = "00000000-0000-4000-8000-0000000000a2";
const NULL_PRINTER = "44444444-4444-4444-8444-444444444444";
const BRIDGE = "55555555-5555-4555-8555-555555555555";

let actorTenant: string | null = null;
const printers: PrinterRecord[] = [];
const endpoints = new Map<string, string>();
const bridges: {
    bridgeId: string;
    tenantId: string;
    shopId: string;
    name: string;
    revokedAt: string | null;
    proofHash: string;
}[] = [];

rs.mock("../lib/ensure-user.js", () => ({
    ensureAppUser: async () => undefined,
}));

rs.mock("../lib/prisma.js", () => ({
    resolveDatabaseUrl: () => "postgresql://unit-test",
    prisma: {
        tenant: {
            findFirst: async ({ where }: { where: { id: string; archivedAt: null } }) => {
                if (where.archivedAt !== null) return null;
                if (where.id !== SHOP && where.id !== OTHER) return null;
                return { id: where.id, name: where.id === SHOP ? "North clinic" : "South clinic" };
            },
        },
    },
    prismaDirect: {},
}));

rs.mock("../lib/prisma-client-file-repo.js", () => ({
    actorFromPostgres: async (_prisma: unknown, user: { id: string; email: string; role: string }) => ({
        id: user.id,
        email: user.email,
        role: user.role,
        tenantId: actorTenant,
        tenantName: null,
    }),
}));

rs.mock("../lib/prisma-production-repo.js", () => ({
    prismaProductionRepo: () => memoryRepo(),
}));

rs.mock("../print-bridge-state.js", () => ({
    serverBridgeDirectory: {
        async putEnrollment(
            record: { bridgeId: string; tenantId: string; shopId: string; proofHash: string },
            options?: { name?: string },
        ) {
            bridges.push({
                bridgeId: record.bridgeId,
                tenantId: record.tenantId,
                shopId: record.shopId,
                name: options?.name ?? "",
                revokedAt: null,
                proofHash: record.proofHash,
            });
        },
        async revoke(bridgeId: string, tenantId: string, at: string) {
            const row = bridges.find(
                (bridge) => bridge.bridgeId === bridgeId && bridge.tenantId === tenantId,
            );
            if (!row) return false;
            row.revokedAt = at;
            return true;
        },
        async findBridge() {
            return null;
        },
    },
}));

const { productionRouter } = await import("./production.js");
const { createCallerFactory } = await import("../trpc.js");
const createCaller = createCallerFactory(productionRouter);

function memoryRepo() {
    return {
        async listJobs() {
            return [];
        },
        async getJob() {
            return null;
        },
        async insertJob() {
            return undefined;
        },
        async patchJob() {
            throw new Error("not used");
        },
        async listPrinters() {
            return printers.map((printer) => ({ ...printer }));
        },
        async insertPrinter(printer: PrinterRecord) {
            const index = printers.findIndex((row) => row.id === printer.id);
            if (index >= 0) printers[index] = printer;
            else printers.push(printer);
        },
        async getGcode() {
            return null;
        },
        async putGcode() {
            return undefined;
        },
        async clearGcode() {
            return undefined;
        },
        async getPrinterEndpoint(printerId: string) {
            return endpoints.get(printerId) ?? null;
        },
        async insertConfiguredPrinter(printer: PrinterRecord, binding: { endpoint: string }) {
            endpoints.set(printer.id, binding.endpoint);
            const stored = { ...printer, endpointConfigured: true };
            const index = printers.findIndex((row) => row.id === printer.id);
            if (index >= 0) printers[index] = stored;
            else printers.push(stored);
        },
        async patchPrinter() {
            throw new Error("not used");
        },
        async claimDispatch() {
            return null;
        },
        async appendDispatchEvent() {
            return undefined;
        },
        async listDispatchEvents() {
            return [];
        },
    };
}

function callerFor(role: string, id: string) {
    return createCaller({
        user: { id, email: `${role}@shop.example`, role },
        ip: "127.0.0.1",
    } as never);
}

function proofShape(proof: unknown): boolean {
    return typeof proof === "string" && proof.length >= 20 && /^[A-Za-z0-9_-]+$/.test(proof);
}

function hashed(value: unknown): boolean {
    return typeof value === "string" && value.length > 10;
}

async function rejection(run: () => Promise<unknown>): Promise<TRPCError> {
    try {
        await run();
    } catch (error) {
        expect(error).toBeInstanceOf(TRPCError);
        return error as TRPCError;
    }
    throw new Error("expected a rejection");
}

function seedPrinter(id: string, tenantId: string | null, ownerId: string, name: string): void {
    printers.push({
        id,
        name,
        state: "offline",
        tenantId,
        ownerId,
        adapterMode: "configured",
        protocolId: "moonraker",
        endpointConfigured: true,
        credentialRef: null,
        cancellation: "unsupported",
        liveVerified: false,
        protocolVerified: false,
        lastSeenAt: null,
        enabled: true,
        bridgeId: BRIDGE,
        configVersion: 1,
        address: `http://192.168.1.${printers.length + 20}:7125`,
    });
    endpoints.set(id, `http://192.168.1.${printers.length + 19}:7125`);
}

const previousOrigin = process.env.ORTHOCAD_CLOUD_ORIGIN;

describe("production shop tenant", () => {
    beforeEach(() => {
        process.env.ORTHOCAD_CLOUD_ORIGIN = "https://cloud.example.test";
        actorTenant = null;
        printers.length = 0;
        endpoints.clear();
        bridges.length = 0;
    });

    test("a super admin with no tenant is rejected until they choose a shop", async () => {
        const caller = callerFor("super_admin", SUPER_ID);
        const enroll = await rejection(() => caller.createBridgeEnrollment({ bridgeName: "North bridge" }));
        expect(enroll.code).toBe("BAD_REQUEST");
        expect(enroll.message).toBe("A tenant is required.");
        const revoke = await rejection(() => caller.revokeBridge({ bridgeId: BRIDGE }));
        expect(revoke.code).toBe("BAD_REQUEST");
        expect(revoke.message).toBe("A tenant is required.");
        const save = await rejection(() =>
            caller.saveMoonrakerPrinter({
                name: "Bay",
                address: "http://192.168.1.50:7125",
                bridgeId: BRIDGE,
                cancellation: "unsupported",
                enabled: true,
            }),
        );
        expect(save.code).toBe("BAD_REQUEST");
        expect(save.message).toBe("A tenant is required.");
        const toggle = await rejection(() =>
            caller.setMoonrakerPrinterEnabled({ id: NULL_PRINTER, enabled: false }),
        );
        expect(toggle.message).toBe("A tenant is required.");
        expect(bridges).toHaveLength(0);
        expect(printers).toHaveLength(0);
    });

    test("the same super admin enrolls and manages printers for a chosen shop", async () => {
        const caller = callerFor("super_admin", SUPER_ID);
        const created = await caller.createBridgeEnrollment({
            bridgeName: "North bridge",
            tenantId: SHOP,
            shopId: SHOP,
        });
        const { proof, ...visible } = created;
        expect(proofShape(proof)).toBe(true);
        expect(visible).toMatchObject({ bridgeName: "North bridge" });
        expect(visible.bridgeId).toBe(bridges[0]?.bridgeId);
        expect(bridges[0]?.tenantId).toBe(SHOP);
        expect(bridges[0]?.shopId).toBe(SHOP);
        expect(hashed(bridges[0]?.proofHash)).toBe(true);
        expect(bridges[0]?.tenantId).not.toBeNull();

        const saved = await caller.saveMoonrakerPrinter({
            name: "North bay",
            address: "http://192.168.1.50:7125",
            bridgeId: visible.bridgeId,
            cancellation: "explicit",
            enabled: true,
            tenantId: SHOP,
            shopId: SHOP,
        });
        expect(saved.tenantId).toBe(SHOP);
        expect(printers.find((printer) => printer.id === saved.id)?.tenantId).toBe(SHOP);

        const disabled = await caller.setMoonrakerPrinterEnabled({
            id: saved.id,
            enabled: false,
            shopId: SHOP,
        });
        expect(disabled.enabled).toBe(false);
        expect(disabled.tenantId).toBe(SHOP);

        seedPrinter(NULL_PRINTER, null, SUPER_ID, "Unscoped");
        seedPrinter("66666666-6666-4666-8666-666666666666", OTHER, SUPER_ID, "South bay");
        const scoped = await caller.list({ tenantId: SHOP });
        expect(scoped.printers.map((printer) => printer.tenantId)).toEqual([SHOP]);
        const open = await caller.list();
        expect(open.printers.map((printer) => printer.id).sort()).toEqual(
            [saved.id, NULL_PRINTER, "66666666-6666-4666-8666-666666666666"].sort(),
        );

        const revoked = await caller.revokeBridge({ bridgeId: visible.bridgeId, tenantId: SHOP });
        expect(revoked).toEqual({ revoked: true });
        expect(typeof bridges[0]?.revokedAt).toBe("string");
        const wrongShop = await rejection(() =>
            caller.revokeBridge({ bridgeId: visible.bridgeId, tenantId: OTHER }),
        );
        expect(wrongShop.code).toBe("NOT_FOUND");

        actorTenant = OTHER;
        bridges.length = 0;
        const picked = await caller.createBridgeEnrollment({
            bridgeName: "Picked shop",
            shopId: SHOP,
        });
        expect(bridges[0]?.tenantId).toBe(SHOP);
        expect(bridges[0]?.shopId).toBe(SHOP);
        expect(picked.bridgeId).toBe(bridges[0]?.bridgeId);
        bridges.length = 0;
        await caller.createBridgeEnrollment({ bridgeName: "Home shop" });
        expect(bridges[0]?.tenantId).toBe(OTHER);
        expect(bridges[0]?.shopId).toBe(OTHER);
    });

    test("a super admin is not bound to a null-tenant printer or bridge", async () => {
        seedPrinter(NULL_PRINTER, null, SUPER_ID, "Unscoped");
        const caller = callerFor("super_admin", SUPER_ID);
        const update = await rejection(() =>
            caller.saveMoonrakerPrinter({
                id: NULL_PRINTER,
                name: "Rebound",
                address: "http://192.168.1.51:7125",
                bridgeId: BRIDGE,
                cancellation: "unsupported",
                enabled: true,
                tenantId: SHOP,
            }),
        );
        expect(update.code).toBe("NOT_FOUND");
        expect(printers.find((printer) => printer.id === NULL_PRINTER)?.tenantId).toBeNull();
        expect(printers.find((printer) => printer.id === NULL_PRINTER)?.name).toBe("Unscoped");
        const toggle = await rejection(() =>
            caller.setMoonrakerPrinterEnabled({ id: NULL_PRINTER, enabled: false, tenantId: SHOP }),
        );
        expect(toggle.code).toBe("NOT_FOUND");
        expect(printers.find((printer) => printer.id === NULL_PRINTER)?.tenantId).toBeNull();
        const missing = await rejection(() =>
            caller.createBridgeEnrollment({ bridgeName: "Missing", tenantId: MISSING, shopId: MISSING }),
        );
        expect(missing.code).toBe("BAD_REQUEST");
        expect(missing.message).toBe("Shop not found.");
        const mismatch = await rejection(() =>
            caller.createBridgeEnrollment({ bridgeName: "Mismatch", tenantId: SHOP, shopId: OTHER }),
        );
        expect(mismatch.message).toBe("Shop does not match the tenant.");
        expect(bridges).toHaveLength(0);
        expect(printers).toHaveLength(1);
    });

    test("an admin enrolls only their own tenant and cannot pass another shop", async () => {
        actorTenant = SHOP;
        const caller = callerFor("admin", ADMIN_ID);
        const created = await caller.createBridgeEnrollment({ bridgeName: "Own shop" });
        expect(bridges[0]?.tenantId).toBe(SHOP);
        expect(bridges[0]?.shopId).toBe(SHOP);
        expect(proofShape(created.proof)).toBe(true);
        const same = await caller.createBridgeEnrollment({
            bridgeName: "Own shop again",
            tenantId: SHOP,
            shopId: SHOP,
        });
        expect(bridges[1]?.tenantId).toBe(SHOP);
        expect(bridges[1]?.bridgeId).toBe(same.bridgeId);
        const foreign = await rejection(() =>
            caller.createBridgeEnrollment({ bridgeName: "Other shop", tenantId: OTHER }),
        );
        expect(foreign.code).toBe("FORBIDDEN");
        expect(foreign.message).toBe("You cannot choose another shop.");
        expect(bridges).toHaveLength(2);

        const saved = await caller.saveMoonrakerPrinter({
            name: "Admin bay",
            address: "http://192.168.1.60:7125",
            bridgeId: BRIDGE,
            cancellation: "unsupported",
            enabled: true,
        });
        expect(saved.tenantId).toBe(SHOP);
        const rejected = await rejection(() =>
            caller.saveMoonrakerPrinter({
                name: "Other bay",
                address: "http://192.168.1.61:7125",
                bridgeId: BRIDGE,
                cancellation: "unsupported",
                enabled: true,
                tenantId: OTHER,
            }),
        );
        expect(rejected.code).toBe("FORBIDDEN");
        expect(printers.filter((printer) => printer.name === "Other bay")).toHaveLength(0);
        const listed = await rejection(() => caller.list({ shopId: OTHER }));
        expect(listed.code).toBe("FORBIDDEN");
    });

    test("a clinician and a staff user still cannot enroll a bridge", async () => {
        actorTenant = SHOP;
        for (const role of ["clinician", "staff"]) {
            const caller = callerFor(role, `${role}-user`);
            const enroll = await rejection(() =>
                caller.createBridgeEnrollment({ bridgeName: "Bay", tenantId: OTHER }),
            );
            expect(enroll.code).toBe("FORBIDDEN");
            expect(enroll.message).toBe("Admin access required");
            const revoke = await rejection(() => caller.revokeBridge({ bridgeId: BRIDGE, tenantId: SHOP }));
            expect(revoke.code).toBe("FORBIDDEN");
            expect(revoke.message).toBe("Admin access required");
            const save = await rejection(() =>
                caller.saveMoonrakerPrinter({
                    name: "Other bay",
                    address: "http://192.168.1.70:7125",
                    bridgeId: BRIDGE,
                    cancellation: "unsupported",
                    enabled: true,
                    tenantId: OTHER,
                }),
            );
            expect(save.code).toBe("FORBIDDEN");
            expect(save.message).toBe("You cannot choose another shop.");
        }
        expect(bridges).toHaveLength(0);
        expect(printers).toHaveLength(0);
    });

    afterEach(() => {
        if (previousOrigin === undefined) delete process.env.ORTHOCAD_CLOUD_ORIGIN;
        else process.env.ORTHOCAD_CLOUD_ORIGIN = previousOrigin;
    });
});
