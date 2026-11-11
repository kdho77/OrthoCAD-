// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// In-memory Postgres semantics for the bridge directory. Statement-level
// updates are atomic and visible immediately, matching READ COMMITTED.

import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, test } from "@rstest/core";
import { memoryBridgeDirectory } from "../../../shared/print-bridge-directory";
import {
    BRIDGE_AUDIENCE,
    createEnrollment,
    type EnrollmentRecord,
    sha256Hex,
} from "../../../shared/print-bridge-enrollment";
import { containsSecret } from "../../../shared/print-bridge-pairing";
import { prismaBridgeDirectory } from "./prisma-bridge-directory";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://cloud.example";
const NOW = new Date("2026-11-09T18:00:00.000Z");

interface EnrollmentRow {
    id: string;
    proofHash: string;
    tenantId: string | null;
    shopId: string;
    bridgeId: string;
    printerIds: unknown;
    audience: string;
    origin: string;
    expiresAt: Date;
    usedAt: Date | null;
}

interface BridgeRow {
    id: string;
    tenantId: string | null;
    shopId: string;
    name: string;
    credentialHash: string | null;
    revokedAt: Date | null;
    lastSeenAt: Date | null;
    createdAt: Date;
}

function harness() {
    const store = {
        enrollments: [] as EnrollmentRow[],
        bridges: [] as BridgeRow[],
        failNextUpsert: false,
    };
    let tail: Promise<void> = Promise.resolve();
    function atomic<T>(fn: () => T): Promise<T> {
        const run = tail.then(() => fn());
        tail = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    }
    const client = {
        async $transaction<T>(fn: (tx: typeof client) => Promise<T>): Promise<T> {
            const snapshot = {
                enrollments: structuredClone(store.enrollments),
                bridges: structuredClone(store.bridges),
            };
            try {
                return await fn(client);
            } catch (error) {
                store.enrollments = snapshot.enrollments;
                store.bridges = snapshot.bridges;
                throw error;
            }
        },
        $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
            const sql = strings.join("");
            return atomic(() => {
                const now = values[0] as Date;
                const proofHash = String(values[1]);
                const expiresAt = values[2] as Date;
                const audience = String(values[3]);
                const origin = String(values[4]);
                const bridgeId = String(values[5]);
                const matches = store.enrollments.filter((row) => {
                    if (row.proofHash !== proofHash) return false;
                    if (sql.includes('"usedAt" IS NULL') && row.usedAt) return false;
                    if (sql.includes('"expiresAt" >') && row.expiresAt.getTime() <= expiresAt.getTime())
                        return false;
                    if (sql.includes('"audience"') && row.audience !== audience) return false;
                    if (sql.includes('"origin"') && row.origin !== origin) return false;
                    if (sql.includes('"bridgeId"') && row.bridgeId !== bridgeId) return false;
                    return true;
                });
                const row = matches[0];
                if (!row) return [];
                row.usedAt = now;
                return [
                    {
                        id: row.id,
                        tenantId: row.tenantId,
                        shopId: row.shopId,
                        bridgeId: row.bridgeId,
                        printerIds: Array.isArray(row.printerIds) ? [...row.printerIds] : row.printerIds,
                        audience: row.audience,
                        origin: row.origin,
                    },
                ];
            });
        },
        shopEnrollment: {
            create({ data }: { data: EnrollmentRow }) {
                return atomic(() => {
                    store.enrollments.push({
                        ...data,
                        printerIds: structuredClone(data.printerIds),
                        usedAt: data.usedAt ?? null,
                    });
                    return data;
                });
            },
            update({ where, data }: { where: { id: string }; data: Partial<EnrollmentRow> }) {
                return atomic(() => {
                    const row = store.enrollments.find((item) => item.id === where.id);
                    if (!row) throw new Error("enrollment missing");
                    Object.assign(row, data);
                    return row;
                });
            },
            updateMany({
                where,
                data,
            }: {
                where: { id: string; usedAt: null };
                data: Partial<EnrollmentRow>;
            }) {
                return atomic(() => {
                    let count = 0;
                    for (const row of store.enrollments) {
                        if (row.id !== where.id) continue;
                        if (where.usedAt === null && row.usedAt !== null) continue;
                        Object.assign(row, data);
                        count += 1;
                    }
                    return { count };
                });
            },
            deleteMany({ where }: { where: { bridgeId?: string; audience?: string; usedAt?: null } }) {
                return atomic(() => {
                    const before = store.enrollments.length;
                    store.enrollments = store.enrollments.filter((row) => {
                        if (where.bridgeId && row.bridgeId !== where.bridgeId) return true;
                        if (where.audience && row.audience !== where.audience) return true;
                        if (where.usedAt === null && row.usedAt !== null) return true;
                        return false;
                    });
                    return { count: before - store.enrollments.length };
                });
            },
            findMany({
                where,
            }: {
                where: { audience?: string; tenantId?: string; bridgeId?: string; usedAt?: null };
            }) {
                return atomic(() =>
                    store.enrollments.filter((row) => {
                        if (where.audience && row.audience !== where.audience) return false;
                        if (where.tenantId && row.tenantId !== where.tenantId) return false;
                        if (where.bridgeId && row.bridgeId !== where.bridgeId) return false;
                        if (where.usedAt === null && row.usedAt !== null) return false;
                        return true;
                    }),
                );
            },
            findUnique({ where }: { where: { proofHash: string } }) {
                return atomic(
                    () => store.enrollments.find((row) => row.proofHash === where.proofHash) ?? null,
                );
            },
            findFirst({
                where,
            }: {
                where: { bridgeId: string; usedAt?: { not: null } };
                orderBy?: { usedAt: "desc" };
            }) {
                return atomic(() => {
                    const rows = store.enrollments
                        .filter((row) => row.bridgeId === where.bridgeId)
                        .filter((row) => (where.usedAt ? row.usedAt !== null : true))
                        .sort(
                            (left, right) => (right.usedAt?.getTime() ?? 0) - (left.usedAt?.getTime() ?? 0),
                        );
                    return rows[0] ?? null;
                });
            },
        },
        shopBridge: {
            upsert({
                where,
                create,
                update,
            }: {
                where: { id: string };
                create: BridgeRow;
                update: Partial<BridgeRow>;
            }) {
                return atomic(() => {
                    if (store.failNextUpsert) {
                        store.failNextUpsert = false;
                        throw new Error("forced bridge write failure");
                    }
                    const existing = store.bridges.find((row) => row.id === where.id);
                    if (existing) {
                        Object.assign(existing, update);
                        return existing;
                    }
                    const created: BridgeRow = {
                        revokedAt: null,
                        lastSeenAt: null,
                        credentialHash: null,
                        createdAt: new Date(),
                        ...create,
                    };
                    store.bridges.push(created);
                    return created;
                });
            },
            findUnique({ where }: { where: { id: string } }) {
                return atomic(() => store.bridges.find((row) => row.id === where.id) ?? null);
            },
            findFirst({ where }: { where: { id: string; tenantId: string } }) {
                return atomic(
                    () =>
                        store.bridges.find((row) => row.id === where.id && row.tenantId === where.tenantId) ??
                        null,
                );
            },
            update({ where, data }: { where: { id: string }; data: Partial<BridgeRow> }) {
                return atomic(() => {
                    const row = store.bridges.find((item) => item.id === where.id);
                    if (!row) throw new Error("bridge missing");
                    Object.assign(row, data);
                    return row;
                });
            },
            updateMany({
                where,
                data,
            }: {
                where: { id: string; tenantId?: string; revokedAt?: null };
                data: { revokedAt?: Date; lastSeenAt?: Date; credentialHash?: string };
            }) {
                return atomic(() => {
                    let count = 0;
                    for (const row of store.bridges) {
                        if (row.id !== where.id) continue;
                        if (where.tenantId !== undefined && row.tenantId !== where.tenantId) continue;
                        if (where.revokedAt === null && row.revokedAt !== null) continue;
                        if (data.revokedAt !== undefined) row.revokedAt = data.revokedAt;
                        if (data.lastSeenAt !== undefined) row.lastSeenAt = data.lastSeenAt;
                        count += 1;
                    }
                    return { count };
                });
            },
        },
    };
    return { store, directory: prismaBridgeDirectory(client as unknown as PrismaClient) };
}

function texts(value: unknown, out: string[] = []): string[] {
    if (typeof value === "string") out.push(value);
    else if (value instanceof Date) out.push(value.toISOString());
    else if (Array.isArray(value)) for (const item of value) texts(item, out);
    else if (value && typeof value === "object") for (const item of Object.values(value)) texts(item, out);
    return out;
}

function enroll(name = "Bay press", now = NOW) {
    const bridgeId = crypto.randomUUID();
    const created = createEnrollment({
        tenantId: TENANT,
        shopId: TENANT,
        bridgeId,
        printerIds: [],
        origin: ORIGIN,
        now,
    });
    return { ...created, name };
}

describe("prisma bridge directory", () => {
    test("the runtime module uses the prisma directory and the redemption SQL is conditional", () => {
        const state = readFileSync("vertex/server/src/print-bridge-state.ts", "utf8");
        const source = readFileSync("vertex/server/src/lib/prisma-bridge-directory.ts", "utf8");
        expect(state).toContain("prismaBridgeDirectory");
        expect(state).not.toContain("memoryBridgeDirectory()");
        expect(typeof memoryBridgeDirectory).toBe("function");
        expect(source).toContain('AND "usedAt" IS NULL');
        expect(source).toContain('AND "expiresAt" >');
        expect(source).toContain('AND "audience" =');
        expect(source).toContain('AND "origin" =');
        expect(source).toContain('AND "bridgeId"::text =');
        expect(source).toContain(".upsert(");
        expect(source).not.toMatch(/console\.(log|info|debug|warn|error)/);
    });

    test("enroll once, reject the second redeem, and store only hashes", async () => {
        const { store, directory } = harness();
        const created = enroll();
        await expect(directory.putEnrollment(created.record)).rejects.toThrow(/Bridge name is required/);
        expect(store.bridges).toHaveLength(0);
        await directory.putEnrollment(created.record, { name: `  ${created.name}  ` });
        expect(store.bridges[0]?.name).toBe(created.name);
        expect(store.bridges[0]?.credentialHash).toBeNull();
        expect(store.bridges[0]?.tenantId).toBe(TENANT);
        expect(store.bridges[0]?.shopId).toBe(TENANT);
        const first = await directory.redeem({
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
            now: NOW,
        });
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const second = await directory.redeem({
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
            now: NOW,
        });
        expect(second).toEqual({ ok: false, reason: "used" });
        const bridge = store.bridges[0];
        const enrollment = store.enrollments[0];
        expect(bridge?.credentialHash).toBe(sha256Hex(first.credential));
        expect(enrollment?.proofHash).toBe(sha256Hex(created.proof));
        expect(bridge?.name).toBe(created.name);
        const found = texts(store);
        expect(found.includes(created.proof)).toBe(false);
        expect(found.includes(first.credential)).toBe(false);
        const authed = await directory.authenticate(first.credential, created.record.bridgeId);
        expect(authed?.tenantId).toBe(TENANT);
        expect(authed?.origin).toBe(ORIGIN);
        expect(await directory.authenticate("wrong-credential", created.record.bridgeId)).toBeNull();
        await directory.touch(created.record.bridgeId, "2026-11-09T18:05:00.000Z");
        expect(store.bridges[0]?.lastSeenAt?.toISOString()).toBe("2026-11-09T18:05:00.000Z");
    });

    test("a failed bridge write rolls back the proof claim", async () => {
        const { store, directory } = harness();
        const created = enroll();
        await directory.putEnrollment(created.record, { name: created.name });
        store.failNextUpsert = true;
        await expect(
            directory.redeem({
                proof: created.proof,
                bridgeId: created.record.bridgeId,
                origin: ORIGIN,
                now: NOW,
            }),
        ).rejects.toThrow(/Bridge name is missing|forced bridge write/);
        expect(store.enrollments[0]?.usedAt).toBeNull();
        expect(store.bridges[0]?.credentialHash).toBeNull();
        const retried = await directory.redeem({
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
            now: NOW,
        });
        expect(retried.ok).toBe(true);
    });

    test("concurrent redeems of one proof succeed exactly once", async () => {
        const { store, directory } = harness();
        const created = enroll();
        await directory.putEnrollment(created.record, { name: created.name });
        const input = {
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
            now: NOW,
        };
        const results = await Promise.all(Array.from({ length: 8 }, () => directory.redeem(input)));
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok && result.reason === "used")).toHaveLength(7);
        expect(store.bridges.filter((row) => row.credentialHash)).toHaveLength(1);
        expect(store.enrollments[0]?.usedAt).toBeInstanceOf(Date);
    });

    test("expired, wrong origin, wrong audience, and wrong bridge are rejected without consuming the proof", async () => {
        const { store, directory } = harness();
        const expired = createEnrollment({
            tenantId: TENANT,
            shopId: TENANT,
            bridgeId: crypto.randomUUID(),
            printerIds: [],
            origin: ORIGIN,
            now: NOW,
            ttlMs: -1_000,
        });
        await directory.putEnrollment(expired.record, { name: "Old" });
        expect(
            await directory.redeem({
                proof: expired.proof,
                bridgeId: expired.record.bridgeId,
                origin: ORIGIN,
                now: NOW,
            }),
        ).toEqual({ ok: false, reason: "expired" });

        const created = enroll();
        await directory.putEnrollment(created.record, { name: created.name });
        expect(
            await directory.redeem({
                proof: created.proof,
                bridgeId: created.record.bridgeId,
                origin: "https://other.example",
                now: NOW,
            }),
        ).toEqual({ ok: false, reason: "origin" });
        expect(
            await directory.redeem({
                proof: created.proof,
                bridgeId: crypto.randomUUID(),
                origin: ORIGIN,
                now: NOW,
            }),
        ).toEqual({ ok: false, reason: "bridge" });
        const wrongAudience = enroll();
        await directory.putEnrollment(
            { ...wrongAudience.record, audience: "somewhere-else" } as EnrollmentRecord,
            { name: "Other audience" },
        );
        expect(wrongAudience.record.audience).toBe(BRIDGE_AUDIENCE);
        expect(
            await directory.redeem({
                proof: wrongAudience.proof,
                bridgeId: wrongAudience.record.bridgeId,
                origin: ORIGIN,
                now: NOW,
            }),
        ).toEqual({ ok: false, reason: "audience" });
        expect(store.enrollments.every((row) => row.usedAt === null)).toBe(true);
        const still = await directory.redeem({
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
            now: NOW,
        });
        expect(still.ok).toBe(true);
    });

    test("a revoked bridge does not authenticate, including across tenants", async () => {
        const { directory } = harness();
        const created = enroll();
        await directory.putEnrollment(created.record, { name: created.name });
        const redeemed = await directory.redeem({
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
            now: NOW,
        });
        if (!redeemed.ok) throw new Error("expected a credential");
        expect(await directory.revoke(created.record.bridgeId, OTHER, NOW.toISOString())).toBe(false);
        expect(await directory.authenticate(redeemed.credential, created.record.bridgeId)).not.toBeNull();
        expect(await directory.revoke(created.record.bridgeId, TENANT, NOW.toISOString())).toBe(true);
        expect(await directory.revoke(created.record.bridgeId, TENANT, NOW.toISOString())).toBe(true);
        expect(await directory.authenticate(redeemed.credential, created.record.bridgeId)).toBeNull();
        expect((await directory.findBridge(created.record.bridgeId))?.revokedAt).toBe(NOW.toISOString());
    });

    test("an already enrolled bridge keeps its credential and is not forced to pair", async () => {
        const { directory } = harness();
        const created = enroll();
        await directory.putEnrollment(created.record, { name: created.name });
        const redeemed = await directory.redeem({
            proof: created.proof,
            bridgeId: created.record.bridgeId,
            origin: ORIGIN,
            now: NOW,
        });
        if (!redeemed.ok) throw new Error("expected a credential");
        const pairing = await directory.beginPairing({
            bridgeId: created.record.bridgeId,
            deviceProof: "deviceProofSecretValueNotStoredAnywhere32",
            origin: ORIGIN,
            now: NOW,
        });
        expect(pairing).toEqual({ ok: false, reason: "already-enrolled" });
        expect(await directory.authenticate(redeemed.credential, created.record.bridgeId)).not.toBeNull();
    });

    test("a pending pairing code is approved once and the credential is only a hash at rest", async () => {
        const { store, directory } = harness();
        const bridgeId = "5598afcd-1111-4111-8111-111111111111";
        const deviceProof = "deviceProofSecretValueNotStoredAnywhere32";
        const began = await directory.beginPairing({
            bridgeId,
            deviceProof,
            origin: ORIGIN,
            now: NOW,
        });
        if (!began.ok) throw new Error("pairing did not start");
        const unapproved = await directory.pollPairing({
            bridgeId,
            deviceProof,
            origin: ORIGIN,
            now: NOW,
        });
        expect(unapproved).toEqual({ status: "pending" });
        expect("credential" in unapproved).toBe(false);
        const expired = await directory.approvePairing({
            code: began.pairingCode,
            tenantId: TENANT,
            shopId: TENANT,
            bridgeName: "Shop computer",
            now: new Date(NOW.getTime() + 11 * 60 * 1000),
        });
        expect(expired).toEqual({ ok: false, reason: "expired" });
        const approved = await directory.approvePairing({
            code: began.pairingCode,
            tenantId: TENANT,
            shopId: TENANT,
            bridgeName: "Shop computer",
            now: NOW,
        });
        expect(approved).toEqual({ ok: true, bridgeId });
        const reused = await directory.approvePairing({
            code: began.pairingCode,
            tenantId: TENANT,
            shopId: TENANT,
            bridgeName: "Shop computer",
            now: NOW,
        });
        expect(reused).toEqual({ ok: false, reason: "used" });
        expect(
            await directory.approvePairing({
                code: "ZZZZ-ZZZZ",
                tenantId: TENANT,
                shopId: TENANT,
                bridgeName: "Shop computer",
                now: NOW,
            }),
        ).toEqual({ ok: false, reason: "mismatch" });
        const wrongProof = await directory.pollPairing({
            bridgeId,
            deviceProof: "anotherDeviceProofSecretValueNotStored99",
            origin: ORIGIN,
            now: NOW,
        });
        expect(wrongProof).toEqual({ status: "rejected" });
        const ready = await directory.pollPairing({
            bridgeId,
            deviceProof,
            origin: ORIGIN,
            now: NOW,
        });
        if (ready.status !== "ready") throw new Error("pairing was not ready");
        const consumed = await directory.pollPairing({
            bridgeId,
            deviceProof,
            origin: ORIGIN,
            now: NOW,
        });
        expect(consumed).toEqual({ status: "consumed" });
        const stored = JSON.stringify(store);
        expect(containsSecret(stored, deviceProof)).toBe(false);
        expect(containsSecret(stored, ready.credential)).toBe(false);
        expect(containsSecret(stored, began.pairingCode)).toBe(false);
        expect(store.bridges.find((row) => row.id === bridgeId)?.credentialHash).toBe(
            sha256Hex(ready.credential),
        );
        expect(await directory.authenticate(ready.credential, bridgeId)).not.toBeNull();
    });
});
