// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Postgres adapter. Tenants are only referenced, never inserted.

import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/prisma.js";
import type {
    ClientLinkRecord,
    ClientRecord,
    CreateClientInput,
    CreateDesignInput,
    CredentialRecord,
    DesignLinkRecord,
    DesignRecord,
    DesignType,
    IntegrationSource,
    IntegrationStore,
    LaunchRecord,
    ScanFormat,
    ScanRecord,
    ScanSide,
    ShoeSize,
    ShoeSystem,
    ShoeWidth,
    UploadRecord,
    UserRecord,
    WebhookEventRecord,
} from "./store.js";
import { StoreConflict } from "./store.js";

type Db = typeof prisma;

function isConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function iso(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function day(value: Date | null | undefined): string | null {
    if (!value) return null;
    return value.toISOString().slice(0, 10);
}

function asDate(value: string | null): Date | null {
    return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function asWidth(value: string): ShoeWidth {
    if (value === "narrow" || value === "wide" || value === "medium") return value;
    return "medium";
}

function shoeOf(row: {
    shoeSizeSystem: ShoeSystem;
    shoeSize: number;
    shoeSizeLeft: number | null;
    shoeSizeRight: number | null;
    shoeWidth: string;
}): ShoeSize {
    return {
        system: row.shoeSizeSystem,
        size: row.shoeSize,
        left: row.shoeSizeLeft,
        right: row.shoeSizeRight,
        width: asWidth(row.shoeWidth),
    };
}

function chartOf(row: {
    shoeSizeDeclared: boolean;
    shoeSizeSystem: ShoeSystem;
    shoeSizeUs: number;
    shoeSizesSplit: boolean;
    shoeSizeLeftUs: number;
    shoeSizeRightUs: number;
    shoeWidth: string;
}): ClientRecord["chart"] {
    return {
        declared: row.shoeSizeDeclared,
        shoe: {
            system: row.shoeSizeSystem,
            size: row.shoeSizeUs,
            left: row.shoeSizesSplit ? row.shoeSizeLeftUs : null,
            right: row.shoeSizesSplit ? row.shoeSizeRightUs : null,
            width: asWidth(row.shoeWidth),
        },
    };
}

function shoeWrite(shoe: ShoeSize) {
    const split = shoe.left != null || shoe.right != null;
    return {
        shoeSizeSystem: shoe.system,
        shoeSizeDeclared: true,
        shoeSizeUs: shoe.size,
        shoeSizesSplit: split,
        shoeSizeLeftUs: shoe.left ?? shoe.size,
        shoeSizeRightUs: shoe.right ?? shoe.size,
        shoeWidth: shoe.width,
    };
}

export function createPrismaIntegrationStore(db: Db = prisma): IntegrationStore {
    function mapLink(row: {
        id: string;
        source: IntegrationSource;
        tenantId: string;
        externalClientId: string;
        clientId: string;
        shoeSizeSystem: ShoeSystem;
        shoeSize: number;
        shoeSizeLeft: number | null;
        shoeSizeRight: number | null;
        shoeWidth: string;
        shoeSizeMismatch: boolean;
    }): ClientLinkRecord {
        return {
            id: row.id,
            source: row.source,
            tenantId: row.tenantId,
            externalClientId: row.externalClientId,
            clientId: row.clientId,
            orderShoe: shoeOf(row),
            shoeSizeMismatch: row.shoeSizeMismatch,
        };
    }

    function mapDesignLink(row: {
        id: string;
        source: IntegrationSource;
        tenantId: string;
        externalOrderId: string;
        designId: string;
        clientId: string;
        kind: DesignType;
        sides: string;
        rxText: string | null;
        notes: string | null;
        orderReference: string | null;
        orderedByAccount: string | null;
        parentExternalOrderId: string | null;
        parentDesignId: string | null;
        shoeSizeSystem: ShoeSystem;
        shoeSize: number;
        shoeSizeLeft: number | null;
        shoeSizeRight: number | null;
        shoeWidth: string;
        shoeSizeMismatch: boolean;
    }): DesignLinkRecord {
        const sides =
            row.sides === "left" || row.sides === "right" || row.sides === "pair" ? row.sides : "pair";
        return {
            id: row.id,
            source: row.source,
            tenantId: row.tenantId,
            externalOrderId: row.externalOrderId,
            designId: row.designId,
            clientId: row.clientId,
            kind: row.kind,
            sides,
            rxText: row.rxText,
            notes: row.notes,
            orderReference: row.orderReference,
            orderedByAccount: row.orderedByAccount,
            parentExternalOrderId: row.parentExternalOrderId,
            parentDesignId: row.parentDesignId,
            shoe: shoeOf(row),
            shoeSizeMismatch: row.shoeSizeMismatch,
        };
    }

    return {
        async countTenants() {
            return db.tenant.count();
        },
        async tenantExists(id) {
            const row = await db.tenant.findUnique({ where: { id }, select: { id: true } });
            return Boolean(row);
        },
        async findCredentialByHash(hash) {
            const row = await db.integrationCredential.findUnique({
                where: { keyHash: hash },
                include: { tenants: true },
            });
            if (!row) return null;
            const credential: CredentialRecord = {
                id: row.id,
                label: row.label,
                keyHash: row.keyHash,
                tenantIds: row.tenants.map((tenant) => tenant.tenantId),
                webhookUrl: row.webhookUrl,
                webhookSecretCiphertext: row.webhookSecretCiphertext,
                revokedAt: iso(row.revokedAt),
            };
            return credential;
        },
        async insertCredential(row) {
            await db.integrationCredential.create({
                data: {
                    id: row.id,
                    label: row.label,
                    keyHash: row.keyHash,
                    webhookUrl: row.webhookUrl,
                    webhookSecretCiphertext: row.webhookSecretCiphertext,
                    revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
                    tenants: { create: row.tenantIds.map((tenantId) => ({ tenantId })) },
                },
            });
        },
        async findUser(id) {
            const row = await db.user.findUnique({ where: { id } });
            if (!row) return null;
            return { id: row.id, tenantId: row.tenantId, role: row.role, email: row.email };
        },
        async ownerForTenant(tenantId) {
            const row = await db.user.findFirst({
                where: { tenantId, isActive: true, role: { not: "super_admin" } },
                orderBy: { createdAt: "asc" },
            });
            if (!row) return null;
            const user: UserRecord = { id: row.id, tenantId: row.tenantId, role: row.role, email: row.email };
            return user;
        },
        async findClient(id) {
            const row = await db.client.findUnique({ where: { id } });
            if (!row?.tenantId) return null;
            const client: ClientRecord = {
                id: row.id,
                tenantId: row.tenantId,
                ownerId: row.ownerId,
                firstName: row.firstName,
                lastName: row.lastName,
                dateOfBirth: day(row.dateOfBirth),
                chart: chartOf(row),
            };
            return client;
        },
        async findClientLink(key) {
            const row = await db.integrationClient.findUnique({
                where: {
                    source_tenantId_externalClientId: {
                        source: key.source,
                        tenantId: key.tenantId,
                        externalClientId: key.externalClientId,
                    },
                },
            });
            return row ? mapLink(row) : null;
        },
        async findClientLinkByClient(source, tenantId, clientId) {
            const row = await db.integrationClient.findFirst({ where: { source, tenantId, clientId } });
            return row ? mapLink(row) : null;
        },
        async createClientWithLink(input: CreateClientInput) {
            try {
                await db.$transaction(async (tx) => {
                    await tx.client.create({
                        data: {
                            id: input.client.id,
                            tenantId: input.client.tenantId,
                            ownerId: input.client.ownerId,
                            firstName: input.client.firstName,
                            lastName: input.client.lastName,
                            displayName: `${input.client.firstName} ${input.client.lastName}`.trim(),
                            dateOfBirth: asDate(input.client.dateOfBirth),
                            ...shoeWrite(input.client.chart.shoe),
                        },
                    });
                    await tx.integrationClient.create({
                        data: {
                            id: input.link.id,
                            source: input.link.source,
                            tenantId: input.link.tenantId,
                            externalClientId: input.link.externalClientId,
                            clientId: input.link.clientId,
                            shoeSizeSystem: input.link.orderShoe.system,
                            shoeSize: input.link.orderShoe.size,
                            shoeSizeLeft: input.link.orderShoe.left,
                            shoeSizeRight: input.link.orderShoe.right,
                            shoeWidth: input.link.orderShoe.width,
                            shoeSizeMismatch: input.link.shoeSizeMismatch,
                        },
                    });
                });
            } catch (error) {
                if (isConflict(error)) throw new StoreConflict();
                throw error;
            }
        },
        async updateClientIdentity(clientId, patch) {
            await db.client.update({
                where: { id: clientId },
                data: {
                    firstName: patch.firstName,
                    lastName: patch.lastName,
                    displayName: `${patch.firstName} ${patch.lastName}`.trim(),
                    dateOfBirth: asDate(patch.dateOfBirth),
                },
            });
        },
        async fillChart(clientId, shoe) {
            await db.client.update({ where: { id: clientId }, data: shoeWrite(shoe) });
        },
        async setClientLinkShoe(linkId, shoe, mismatch) {
            await db.integrationClient.update({
                where: { id: linkId },
                data: {
                    shoeSizeSystem: shoe.system,
                    shoeSize: shoe.size,
                    shoeSizeLeft: shoe.left,
                    shoeSizeRight: shoe.right,
                    shoeWidth: shoe.width,
                    shoeSizeMismatch: mismatch,
                },
            });
        },
        async findDesignLink(key) {
            const row = await db.integrationDesign.findUnique({
                where: {
                    source_tenantId_externalOrderId: {
                        source: key.source,
                        tenantId: key.tenantId,
                        externalOrderId: key.externalOrderId,
                    },
                },
            });
            return row ? mapDesignLink(row) : null;
        },
        async findDesignLinkByDesignId(designId) {
            const row = await db.integrationDesign.findUnique({ where: { designId } });
            return row ? mapDesignLink(row) : null;
        },
        async getDesign(id) {
            const row = await db.design.findUnique({ where: { id }, include: { client: true } });
            if (!row) return null;
            const design: DesignRecord = {
                id: row.id,
                clientId: row.clientId,
                tenantId: row.client.tenantId ?? "",
                ownerId: row.ownerId,
                kind: row.kind,
                name: row.name,
                notes: row.notes ?? "",
                updatedAt: row.updatedAt.toISOString(),
            };
            return design;
        },
        async createDesignWithLink(input: CreateDesignInput) {
            try {
                await db.$transaction(async (tx) => {
                    await tx.design.create({
                        data: {
                            id: input.design.id,
                            clientId: input.design.clientId,
                            ownerId: input.design.ownerId,
                            kind: input.design.kind,
                            name: input.design.name,
                            notes: input.design.notes || null,
                        },
                    });
                    await tx.integrationDesign.create({
                        data: {
                            id: input.link.id,
                            source: input.link.source,
                            tenantId: input.link.tenantId,
                            externalOrderId: input.link.externalOrderId,
                            designId: input.link.designId,
                            clientId: input.link.clientId,
                            kind: input.link.kind,
                            sides: input.link.sides,
                            rxText: input.link.rxText,
                            notes: input.link.notes,
                            orderReference: input.link.orderReference,
                            orderedByAccount: input.link.orderedByAccount,
                            parentExternalOrderId: input.link.parentExternalOrderId,
                            parentDesignId: input.link.parentDesignId,
                            shoeSizeSystem: input.link.shoe.system,
                            shoeSize: input.link.shoe.size,
                            shoeSizeLeft: input.link.shoe.left,
                            shoeSizeRight: input.link.shoe.right,
                            shoeWidth: input.link.shoe.width,
                            shoeSizeMismatch: input.link.shoeSizeMismatch,
                        },
                    });
                });
            } catch (error) {
                if (isConflict(error)) throw new StoreConflict();
                throw error;
            }
        },
        async replaceOpenUploads(designLinkId, uploads) {
            await db.$transaction(async (tx) => {
                await tx.integrationScanUpload.deleteMany({
                    where: { integrationDesignId: designLinkId, completedAt: null },
                });
                if (uploads.length === 0) return;
                await tx.integrationScanUpload.createMany({
                    data: uploads.map((row: UploadRecord) => ({
                        id: row.id,
                        integrationDesignId: row.designLinkId,
                        side: row.side,
                        storageKey: row.storageKey,
                        tokenHash: hashToken(row.uploadUrl),
                        uploadUrl: row.uploadUrl,
                        expiresAt: new Date(row.expiresAt),
                    })),
                });
            });
        },
        async listUploads(designLinkId) {
            const rows = await db.integrationScanUpload.findMany({
                where: { integrationDesignId: designLinkId },
                orderBy: { createdAt: "asc" },
            });
            return rows.map((row) => ({
                id: row.id,
                designLinkId: row.integrationDesignId,
                side: row.side as ScanSide,
                storageKey: row.storageKey,
                uploadUrl: row.uploadUrl,
                expiresAt: row.expiresAt.toISOString(),
                completedAt: iso(row.completedAt),
                format: (row.format as ScanFormat | null) ?? null,
                fileName: row.fileName,
                sizeBytes: row.sizeBytes,
            }));
        },
        async completeUpload(uploadId, patch) {
            await db.integrationScanUpload.update({
                where: { id: uploadId },
                data: {
                    format: patch.format,
                    fileName: patch.fileName,
                    sizeBytes: patch.sizeBytes,
                    completedAt: new Date(patch.completedAt),
                },
            });
        },
        async findScanByStorageKey(storageKey) {
            const row = await db.scan.findFirst({
                where: { storageKey },
                include: { design: { include: { client: true } } },
            });
            if (!row || (row.side !== "left" && row.side !== "right")) return null;
            const scan: ScanRecord = {
                id: row.id,
                designId: row.designId,
                tenantId: row.design.client.tenantId ?? "",
                side: row.side,
                fileName: row.fileName,
                storageKey: row.storageKey,
                format: row.format,
                sizeBytes: row.sizeBytes ?? 0,
            };
            return scan;
        },
        async insertScan(row) {
            await db.scan.create({
                data: {
                    id: row.id,
                    designId: row.designId,
                    side: row.side,
                    fileName: row.fileName,
                    storageKey: row.storageKey,
                    format: row.format,
                    sizeBytes: row.sizeBytes,
                },
            });
        },
        async countScans(designId) {
            return db.scan.count({ where: { designId } });
        },
        async insertLaunch(row: LaunchRecord) {
            let actorUserId = row.actorUserId;
            if (actorUserId) {
                const user = await db.user.findUnique({ where: { id: actorUserId }, select: { id: true } });
                if (!user) actorUserId = null;
            }
            await db.integrationLaunchToken.create({
                data: {
                    tokenHash: row.tokenHash,
                    tenantId: row.tenantId,
                    designId: row.designId,
                    actorKind: row.actorKind,
                    actorUserId,
                    actorRole: row.actorRole,
                    expiresAt: new Date(row.expiresAt),
                },
            });
        },
        async findLaunchByHash(hash) {
            const row = await db.integrationLaunchToken.findUnique({ where: { tokenHash: hash } });
            if (!row) return null;
            return {
                tokenHash: row.tokenHash,
                tenantId: row.tenantId,
                designId: row.designId,
                actorKind: row.actorKind,
                actorUserId: row.actorUserId,
                actorRole: row.actorRole,
                expiresAt: row.expiresAt.toISOString(),
                usedAt: iso(row.usedAt),
            };
        },
        async markLaunchUsed(hash, usedAt) {
            const result = await db.integrationLaunchToken.updateMany({
                where: { tokenHash: hash, usedAt: null },
                data: { usedAt: new Date(usedAt) },
            });
            return result.count === 1;
        },
        async insertWebhookEvent(row: WebhookEventRecord) {
            await db.integrationWebhookEvent.create({
                data: {
                    id: row.id,
                    type: row.type,
                    tenantId: row.tenantId,
                    designId: row.designId,
                    payload: row.payload as Prisma.InputJsonValue,
                    attemptCount: row.attemptCount,
                    nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt) : null,
                    deliveredAt: row.deliveredAt ? new Date(row.deliveredAt) : null,
                },
            });
        },
    };
}

function hashToken(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}
