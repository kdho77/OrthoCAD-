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
    };
}
