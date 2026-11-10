// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Postgres bridge directory. Proofs and credentials are stored as sha256 only.
// This module does not log proofs, credentials, or hashes.

import type { Prisma, PrismaClient } from "@prisma/client";
import type { BridgeDirectory } from "../../../shared/print-bridge-directory.js";
import {
    BRIDGE_AUDIENCE,
    type BridgeCredential,
    credentialMatches,
    issueCredential,
    sha256Hex,
} from "../../../shared/print-bridge-enrollment.js";
import {
    DISCOVERY_AUDIENCE,
    type DiscoveryCandidateRecord,
    type DiscoveryMeta,
    deviceProofHash,
    discoveryProofHash,
    generatePairingCode,
    PAIRING_AUDIENCE,
    PAIRING_TTL_MS,
    PENDING_BRIDGE_NAME,
    PENDING_SHOP_ID,
    pairingCodeHash,
    readDiscoveryMeta,
    readPairingMeta,
} from "../../../shared/print-bridge-pairing.js";
import { productionAddressPolicy } from "../../../shared/printer-address-policy.js";

type DirectoryClient = PrismaClient | Prisma.TransactionClient;

interface ClaimedEnrollment {
    id: string;
    tenantId: string | null;
    shopId: string;
    bridgeId: string;
    printerIds: unknown;
    audience: string;
    origin: string;
}

function asPrinterIds(value: unknown): string[] {
    let parsed = value;
    if (typeof parsed === "string") {
        try {
            parsed = JSON.parse(parsed) as unknown;
        } catch {
            return [];
        }
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
}

function iso(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

function credentialFrom(
    row: {
        id: string;
        tenantId: string | null;
        shopId: string;
        credentialHash: string;
        revokedAt: Date | null;
        lastSeenAt: Date | null;
    },
    enrollment: { printerIds: unknown; origin: string },
): BridgeCredential {
    return {
        bridgeId: row.id,
        tenantId: row.tenantId ?? "",
        shopId: row.shopId,
        printerIds: asPrinterIds(enrollment.printerIds),
        credentialHash: row.credentialHash,
        revokedAt: iso(row.revokedAt),
        lastSeenAt: iso(row.lastSeenAt),
        origin: enrollment.origin,
    };
}

async function latestEnrollment(db: DirectoryClient, bridgeId: string) {
    return db.shopEnrollment.findFirst({
        where: { bridgeId, usedAt: { not: null } },
        orderBy: { usedAt: "desc" },
    });
}

function rejectionReason(
    row: {
        audience: string;
        origin: string;
        bridgeId: string;
        usedAt: Date | null;
        expiresAt: Date;
    } | null,
    input: { bridgeId: string; origin: string; now: Date },
): "expired" | "used" | "mismatch" | "audience" | "origin" | "bridge" {
    if (!row) return "mismatch";
    if (row.audience !== BRIDGE_AUDIENCE) return "audience";
    if (row.origin !== input.origin) return "origin";
    if (row.bridgeId !== input.bridgeId) return "bridge";
    if (row.usedAt) return "used";
    if (row.expiresAt.getTime() <= input.now.getTime()) return "expired";
    return "mismatch";
}

export function prismaBridgeDirectory(prisma: PrismaClient): BridgeDirectory {
    return {
        async putEnrollment(record, options) {
            const name = options?.name?.trim() ?? "";
            if (!name) throw new Error("Bridge name is required.");
            await prisma.$transaction(async (tx) => {
                await tx.shopBridge.upsert({
                    where: { id: record.bridgeId },
                    create: {
                        id: record.bridgeId,
                        tenantId: record.tenantId,
                        shopId: record.shopId,
                        name,
                        credentialHash: null,
                    },
                    update: {
                        name,
                        tenantId: record.tenantId,
                        shopId: record.shopId,
                    },
                });
                await tx.shopEnrollment.create({
                    data: {
                        id: record.id,
                        proofHash: record.proofHash,
                        tenantId: record.tenantId,
                        shopId: record.shopId,
                        bridgeId: record.bridgeId,
                        printerIds: record.printerIds,
                        audience: record.audience,
                        origin: record.origin,
                        expiresAt: new Date(record.expiresAt),
                        usedAt: null,
                    },
                });
            });
        },

        async redeem(input) {
            const proofHash = sha256Hex(input.proof);
            const claimed = await prisma.$transaction(async (tx) => {
                // Conditional update is the one-time gate. A concurrent redeem
                // sees usedAt set and matches zero rows. Failure rolls back both writes.
                const rows = await tx.$queryRaw<ClaimedEnrollment[]>`
                    UPDATE "shop_enrollments"
                    SET "usedAt" = ${input.now}
                    WHERE "proofHash" = ${proofHash}
                      AND "usedAt" IS NULL
                      AND "expiresAt" > ${input.now}
                      AND "audience" = ${BRIDGE_AUDIENCE}
                      AND "origin" = ${input.origin}
                      AND "bridgeId"::text = ${input.bridgeId}
                    RETURNING "id", "tenantId", "shopId", "bridgeId", "printerIds", "audience", "origin"
                `;
                const row = rows[0];
                if (!row) return null;
                const prior = await tx.shopBridge.findUnique({ where: { id: row.bridgeId } });
                if (!prior?.name) throw new Error("Bridge name is missing.");
                const issued = issueCredential();
                await tx.shopBridge.upsert({
                    where: { id: row.bridgeId },
                    create: {
                        id: row.bridgeId,
                        tenantId: row.tenantId,
                        shopId: row.shopId,
                        name: prior.name,
                        credentialHash: issued.credentialHash,
                    },
                    update: {
                        credentialHash: issued.credentialHash,
                    },
                });
                return { credential: issued.credential };
            });
            if (claimed) return { ok: true, credential: claimed.credential };
            const existing = await prisma.shopEnrollment.findUnique({ where: { proofHash } });
            return { ok: false, reason: rejectionReason(existing, input) };
        },

        async authenticate(credential, bridgeId) {
            const row = await prisma.shopBridge.findUnique({ where: { id: bridgeId } });
            if (!row?.credentialHash) return null;
            const enrollment = await latestEnrollment(prisma, bridgeId);
            if (!enrollment) return null;
            const stored = credentialFrom({ ...row, credentialHash: row.credentialHash }, enrollment);
            if (!credentialMatches(stored, credential) || row.revokedAt) return null;
            return stored;
        },

        async revoke(bridgeId, tenantId, at) {
            const updated = await prisma.shopBridge.updateMany({
                where: { id: bridgeId, tenantId, revokedAt: null },
                data: { revokedAt: new Date(at) },
            });
            if (updated.count > 0) return true;
            const existing = await prisma.shopBridge.findFirst({
                where: { id: bridgeId, tenantId },
            });
            return existing !== null;
        },

        async touch(bridgeId, at) {
            await prisma.shopBridge.updateMany({
                where: { id: bridgeId },
                data: { lastSeenAt: new Date(at) },
            });
        },

        async findBridge(bridgeId) {
            const row = await prisma.shopBridge.findUnique({ where: { id: bridgeId } });
            if (!row?.credentialHash) return null;
            const enrollment = await latestEnrollment(prisma, bridgeId);
            if (!enrollment) return null;
            return credentialFrom({ ...row, credentialHash: row.credentialHash }, enrollment);
        },

        async beginPairing(input) {
            const proofHash = deviceProofHash(input.deviceProof);
            if (!proofHash || !allowedPairingOrigin(input.origin)) return { ok: false, reason: "invalid" };
            const existing = await prisma.shopBridge.findUnique({ where: { id: input.bridgeId } });
            if (existing?.credentialHash) return { ok: false, reason: "already-enrolled" };
            const pairingCode = generatePairingCode();
            const codeHash = pairingCodeHash(pairingCode);
            if (!codeHash) return { ok: false, reason: "invalid" };
            const expiresAt = new Date(input.now.getTime() + PAIRING_TTL_MS);
            await prisma.$transaction(async (tx) => {
                await tx.shopEnrollment.deleteMany({
                    where: { bridgeId: input.bridgeId, audience: PAIRING_AUDIENCE, usedAt: null },
                });
                await tx.shopBridge.upsert({
                    where: { id: input.bridgeId },
                    create: {
                        id: input.bridgeId,
                        tenantId: null,
                        shopId: PENDING_SHOP_ID,
                        name: PENDING_BRIDGE_NAME,
                        credentialHash: null,
                    },
                    update: { name: existing?.name ?? PENDING_BRIDGE_NAME },
                });
                await tx.shopEnrollment.create({
                    data: {
                        id: crypto.randomUUID(),
                        proofHash,
                        tenantId: null,
                        shopId: PENDING_SHOP_ID,
                        bridgeId: input.bridgeId,
                        printerIds: { kind: "pairing", codeHash, approved: false },
                        audience: PAIRING_AUDIENCE,
                        origin: input.origin,
                        expiresAt,
                        usedAt: null,
                    },
                });
            });
            return { ok: true, pairingCode, expiresAt: expiresAt.toISOString() };
        },

        async approvePairing(input) {
            const codeHash = pairingCodeHash(input.code);
            const bridgeName = input.bridgeName.trim();
            if (!codeHash || !bridgeName || !input.tenantId) return { ok: false, reason: "mismatch" };
            const rows = await prisma.shopEnrollment.findMany({
                where: { audience: PAIRING_AUDIENCE },
            });
            const matches = rows.filter((row) => readPairingMeta(row.printerIds)?.codeHash === codeHash);
            if (matches.length === 0) return { ok: false, reason: "mismatch" };
            const live = matches.find((row) => !row.usedAt && row.expiresAt.getTime() > input.now.getTime());
            if (!live) return { ok: false, reason: matches.some((row) => row.usedAt) ? "used" : "expired" };
            const meta = readPairingMeta(live.printerIds);
            if (!meta || meta.approved) return { ok: false, reason: "used" };
            let adoptedBridgeId = live.bridgeId;
            if (input.replaceBridgeId) {
                const target = await prisma.shopBridge.findUnique({ where: { id: input.replaceBridgeId } });
                if (!target?.credentialHash || target.revokedAt || target.tenantId !== input.tenantId) {
                    return { ok: false, reason: "mismatch" };
                }
                adoptedBridgeId = target.id;
            }
            await prisma.$transaction(async (tx) => {
                await tx.shopEnrollment.update({
                    where: { id: live.id },
                    data: {
                        tenantId: input.tenantId,
                        shopId: input.shopId,
                        printerIds: {
                            kind: "pairing",
                            codeHash,
                            approved: true,
                            adoptedBridgeId,
                        },
                    },
                });
                await tx.shopBridge.update({
                    where: { id: live.bridgeId },
                    data: { tenantId: input.tenantId, shopId: input.shopId, name: bridgeName },
                });
            });
            return { ok: true, bridgeId: adoptedBridgeId };
        },

        async pollPairing(input) {
            const proofHash = deviceProofHash(input.deviceProof);
            if (!proofHash) return { status: "rejected" };
            const row = await prisma.shopEnrollment.findUnique({ where: { proofHash } });
            if (
                !row ||
                row.audience !== PAIRING_AUDIENCE ||
                row.bridgeId !== input.bridgeId ||
                row.origin !== input.origin
            ) {
                return { status: "rejected" };
            }
            if (row.usedAt) return { status: "consumed" };
            if (row.expiresAt.getTime() <= input.now.getTime()) return { status: "expired" };
            const meta = readPairingMeta(row.printerIds);
            if (!meta?.approved || !row.tenantId || row.shopId === PENDING_SHOP_ID)
                return { status: "pending" };
            const targetBridgeId = meta.adoptedBridgeId || row.bridgeId;
            const claimed = await prisma.$transaction(async (tx) => {
                const updated = await tx.shopEnrollment.updateMany({
                    where: { id: row.id, usedAt: null },
                    data: { usedAt: input.now, printerIds: [] },
                });
                if (updated.count !== 1) return null;
                const issued = issueCredential();
                await tx.shopBridge.update({
                    where: { id: targetBridgeId },
                    data: { credentialHash: issued.credentialHash },
                });
                return { credential: issued.credential, bridgeId: targetBridgeId };
            });
            if (!claimed) return { status: "consumed" };
            return { status: "ready", credential: claimed.credential, bridgeId: claimed.bridgeId };
        },

        async reportDiscovery(input) {
            const proofHash = discoveryProofHash(input.bridge.bridgeId);
            const existing = await prisma.shopEnrollment.findUnique({ where: { proofHash } });
            const current = existing ? readDiscoveryMeta(existing.printerIds) : null;
            const meta: DiscoveryMeta = {
                kind: "discovery",
                candidates: sanitizeStoredCandidates(input.candidates),
                probe: current?.probe ?? null,
                lastTest: current?.lastTest ?? null,
            };
            if (input.connectionTest && meta.probe && meta.probe.address === input.connectionTest.address) {
                meta.lastTest = {
                    address: input.connectionTest.address,
                    info: input.connectionTest.info,
                    checkedAt: input.now.toISOString(),
                };
                meta.probe = null;
            }
            const data = {
                printerIds: meta as unknown as Prisma.InputJsonValue,
                tenantId: input.bridge.tenantId,
                shopId: input.bridge.shopId,
                origin: input.bridge.origin,
                expiresAt: new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
            };
            if (existing) {
                await prisma.shopEnrollment.update({ where: { id: existing.id }, data });
                return;
            }
            await prisma.shopEnrollment.create({
                data: {
                    id: crypto.randomUUID(),
                    proofHash,
                    bridgeId: input.bridge.bridgeId,
                    audience: DISCOVERY_AUDIENCE,
                    usedAt: null,
                    ...data,
                },
            });
        },

        async listDiscovery(tenantId) {
            const rows = await prisma.shopEnrollment.findMany({
                where: { audience: DISCOVERY_AUDIENCE, tenantId },
            });
            const candidates: Array<DiscoveryCandidateRecord & { bridgeId: string }> = [];
            let lastTest: DiscoveryMeta["lastTest"] = null;
            for (const row of rows) {
                const meta = readDiscoveryMeta(row.printerIds);
                if (!meta) continue;
                for (const candidate of meta.candidates)
                    candidates.push({ ...candidate, bridgeId: row.bridgeId });
                if (meta.lastTest) lastTest = meta.lastTest;
            }
            return { candidates, lastTest };
        },

        async requestConnectionTest(input) {
            const bridge = await prisma.shopBridge.findUnique({ where: { id: input.bridgeId } });
            if (!bridge?.credentialHash || bridge.revokedAt || bridge.tenantId !== input.tenantId) {
                return { ok: false, reason: "Bridge not found." };
            }
            const decision = productionAddressPolicy().decide(input.address);
            if (!decision.ok) return { ok: false, reason: decision.reason };
            const proofHash = discoveryProofHash(input.bridgeId);
            const existing = await prisma.shopEnrollment.findUnique({ where: { proofHash } });
            const current = existing ? readDiscoveryMeta(existing.printerIds) : null;
            const meta: DiscoveryMeta = {
                kind: "discovery",
                candidates: current?.candidates ?? [],
                probe: { address: input.address, requestedAt: input.now.toISOString() },
                lastTest: current?.lastTest ?? null,
            };
            if (existing) {
                await prisma.shopEnrollment.update({
                    where: { id: existing.id },
                    data: { printerIds: meta as unknown as Prisma.InputJsonValue },
                });
            } else {
                const enrollment = await latestEnrollment(prisma, input.bridgeId);
                await prisma.shopEnrollment.create({
                    data: {
                        id: crypto.randomUUID(),
                        proofHash,
                        tenantId: input.tenantId,
                        shopId: bridge.shopId,
                        bridgeId: input.bridgeId,
                        printerIds: meta as unknown as Prisma.InputJsonValue,
                        audience: DISCOVERY_AUDIENCE,
                        origin: enrollment?.origin ?? "",
                        expiresAt: new Date(input.now.getTime() + 24 * 60 * 60 * 1000),
                        usedAt: null,
                    },
                });
            }
            return { ok: true, address: input.address };
        },

        async pendingDiscoveryProbe(bridgeId) {
            const row = await prisma.shopEnrollment.findUnique({
                where: { proofHash: discoveryProofHash(bridgeId) },
            });
            const probe = row ? readDiscoveryMeta(row.printerIds)?.probe : null;
            return probe ? { address: probe.address } : null;
        },

        async listEnrolledBridges(tenantId) {
            const rows = await prisma.shopBridge.findMany({
                where: { tenantId, revokedAt: null },
            });
            return rows
                .filter((row) => Boolean(row.credentialHash))
                .map((row) => ({ id: row.id, name: row.name }));
        },
    };
}

function allowedPairingOrigin(origin: string): boolean {
    if (origin.startsWith("https://")) return true;
    try {
        const url = new URL(origin);
        return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    } catch {
        return false;
    }
}

function sanitizeStoredCandidates(candidates: DiscoveryCandidateRecord[]): DiscoveryCandidateRecord[] {
    const policy = productionAddressPolicy();
    return candidates.filter((candidate) => {
        const decision = policy.decide(candidate.address);
        return decision.ok && candidate.address === `http://${candidate.host}:${candidate.port}`;
    });
}
