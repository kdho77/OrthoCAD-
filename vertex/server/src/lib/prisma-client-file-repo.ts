// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Postgres adapter for client files. Talks to Prisma only, so the same code
// can point at RDS later. It does not import the Supabase client.

import type { Prisma, PrismaClient } from "@prisma/client";
import {
    type Actor,
    ClientFileError,
    type ClientFileRepo,
    type ClientRow,
    type DesignGeometryWrite,
    type DesignKind,
    type DesignRow,
} from "../../../shared/client-files.js";
import { resolveDevRole } from "./dev-auth.js";

type ClientRecord = {
    id: string;
    ownerId: string;
    tenantId: string | null;
    displayName: string | null;
    firstName: string;
    lastName: string;
    reference: string | null;
    dateOfBirth: Date | null;
    mrn: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

function iso(value: Date | null | undefined): string | null {
    return value ? value.toISOString() : null;
}

function day(value: Date | null | undefined): string | null {
    return value ? value.toISOString().slice(0, 10) : null;
}

function asDate(value: string | null | undefined): Date | null {
    if (!value) return null;
    return new Date(value);
}

function mapClient(row: ClientRecord): ClientRow {
    return {
        id: row.id,
        ownerId: row.ownerId,
        tenantId: row.tenantId,
        displayName: row.displayName ?? "",
        firstName: row.firstName,
        lastName: row.lastName,
        reference: row.reference,
        dateOfBirth: day(row.dateOfBirth),
        mrn: row.mrn,
        email: row.email,
        phone: row.phone,
        notes: row.notes,
        archivedAt: iso(row.archivedAt),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}

function mapDesign(
    row: {
        id: string;
        clientId: string;
        ownerId: string;
        name: string;
        kind: DesignKind;
        notes: string | null;
        createdAt: Date;
        updatedAt: Date;
        archivedAt: Date | null;
        deletedAt: Date | null;
    },
    hasExport: boolean,
): DesignRow {
    return {
        id: row.id,
        clientId: row.clientId,
        ownerId: row.ownerId,
        name: row.name,
        kind: row.kind === "afo" ? "afo" : "insole",
        notes: row.notes ?? "",
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        archivedAt: iso(row.archivedAt),
        deletedAt: iso(row.deletedAt),
        hasExport,
    };
}

function clientData(row: ClientRow): Prisma.ClientCreateInput {
    return {
        id: row.id,
        displayName: row.displayName,
        firstName: row.firstName,
        lastName: row.lastName,
        reference: row.reference,
        dateOfBirth: asDate(row.dateOfBirth),
        mrn: row.mrn,
        email: row.email,
        phone: row.phone,
        notes: row.notes,
        archivedAt: asDate(row.archivedAt),
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
        owner: { connect: { id: row.ownerId } },
        ...(row.tenantId ? { tenant: { connect: { id: row.tenantId } } } : {}),
    };
}

export function prismaClientFileRepo(prisma: PrismaClient): ClientFileRepo {
    return {
        async listClients() {
            const rows = await prisma.client.findMany();
            return rows.map((row) => mapClient(row));
        },
        async getClient(id) {
            const row = await prisma.client.findUnique({ where: { id } });
            return row ? mapClient(row) : null;
        },
        async insertClient(row) {
            await prisma.client.create({ data: clientData(row) });
        },
        async patchClient(id, patch) {
            const data: Prisma.ClientUpdateInput = {};
            if (patch.displayName !== undefined) data.displayName = patch.displayName;
            if (patch.firstName !== undefined) data.firstName = patch.firstName;
            if (patch.lastName !== undefined) data.lastName = patch.lastName;
            if (patch.reference !== undefined) data.reference = patch.reference;
            if (patch.dateOfBirth !== undefined) data.dateOfBirth = asDate(patch.dateOfBirth);
            if (patch.mrn !== undefined) data.mrn = patch.mrn;
            if (patch.email !== undefined) data.email = patch.email;
            if (patch.phone !== undefined) data.phone = patch.phone;
            if (patch.notes !== undefined) data.notes = patch.notes;
            if (patch.archivedAt !== undefined) data.archivedAt = asDate(patch.archivedAt);
            if (patch.updatedAt !== undefined) data.updatedAt = new Date(patch.updatedAt);
            if (patch.tenantId !== undefined) {
                data.tenant = patch.tenantId ? { connect: { id: patch.tenantId } } : { disconnect: true };
            }
            const row = await prisma.client.update({ where: { id }, data });
            return mapClient(row);
        },
        async removeClient(id) {
            await prisma.client.delete({ where: { id } });
        },
        async listDesigns() {
            const rows = await prisma.design.findMany({
                include: { _count: { select: { exports: true } } },
            });
            return rows.map((row) => mapDesign(row, row._count.exports > 0));
        },
        async getDesign(id) {
            const row = await prisma.design.findUnique({
                where: { id },
                include: { _count: { select: { exports: true } } },
            });
            return row ? mapDesign(row, row._count.exports > 0) : null;
        },
        async insertDesign(row) {
            await prisma.design.create({
                data: {
                    id: row.id,
                    name: row.name,
                    kind: row.kind,
                    notes: row.notes,
                    archivedAt: asDate(row.archivedAt),
                    deletedAt: asDate(row.deletedAt),
                    createdAt: new Date(row.createdAt),
                    updatedAt: new Date(row.updatedAt),
                    client: { connect: { id: row.clientId } },
                    owner: { connect: { id: row.ownerId } },
                },
            });
        },
        async patchDesign(id, patch) {
            const data: Prisma.DesignUpdateInput = {};
            if (patch.name !== undefined) data.name = patch.name;
            if (patch.kind !== undefined) data.kind = patch.kind;
            if (patch.notes !== undefined) data.notes = patch.notes;
            if (patch.archivedAt !== undefined) data.archivedAt = asDate(patch.archivedAt);
            if (patch.deletedAt !== undefined) data.deletedAt = asDate(patch.deletedAt);
            if (patch.updatedAt !== undefined) data.updatedAt = new Date(patch.updatedAt);
            const row = await prisma.design.update({
                where: { id },
                data,
                include: { _count: { select: { exports: true } } },
            });
            return mapDesign(row, patch.hasExport ?? row._count.exports > 0);
        },
        async countExports(designId) {
            return prisma.export.count({ where: { designId } });
        },
        async duplicateDesign(sourceId, copy) {
            const source = await prisma.design.findUnique({ where: { id: sourceId } });
            if (!source) throw new ClientFileError("NOT_FOUND", "Design not found");
            const created = await prisma.design.create({
                data: {
                    id: copy.id,
                    name: copy.name,
                    kind: source.kind,
                    notes: source.notes,
                    pattern: source.pattern,
                    method: source.method,
                    thicknessMm: source.thicknessMm,
                    linked: source.linked,
                    unit: source.unit,
                    archivedAt: null,
                    deletedAt: null,
                    createdAt: new Date(copy.now),
                    updatedAt: new Date(copy.now),
                    client: { connect: { id: source.clientId } },
                    owner: { connect: { id: copy.ownerId } },
                },
            });
            const corrections = await prisma.correction.findMany({ where: { designId: sourceId } });
            if (corrections.length > 0) {
                await prisma.correction.createMany({
                    data: corrections.map((row) => ({
                        ...row,
                        id: crypto.randomUUID(),
                        designId: copy.id,
                    })),
                });
            }
            const elements = await prisma.element.findMany({ where: { designId: sourceId } });
            if (elements.length > 0) {
                await prisma.element.createMany({
                    data: elements.map((row) => ({
                        ...row,
                        id: crypto.randomUUID(),
                        designId: copy.id,
                    })),
                });
            }
            return mapDesign(created, false);
        },
        async loadDesignDocument(id) {
            const row = await prisma.design.findUnique({
                where: { id },
                include: { corrections: true, elements: true },
            });
            return row ? JSON.parse(JSON.stringify(row)) : null;
        },
        async saveDesignGeometry(input: DesignGeometryWrite) {
            await prisma.$queryRaw`
                SELECT vertex_save_design(
                    ${input.userId}::uuid,
                    ${input.designId}::uuid,
                    ${input.name}::text,
                    ${input.pattern}::text,
                    ${input.method}::text,
                    ${input.thicknessMm}::float8,
                    ${input.unit}::text,
                    ${input.linked}::boolean,
                    ${JSON.stringify(input.corrections)}::jsonb,
                    ${JSON.stringify(input.elements)}::jsonb,
                    ${input.ip}::text
                )
            `;
            return { ok: true as const };
        },
        async audit(entry) {
            try {
                await prisma.auditLog.create({
                    data: {
                        userId: entry.userId,
                        action: entry.action as Prisma.AuditLogCreateInput["action"],
                        targetId: entry.targetId,
                    },
                });
            } catch {
                // Audit is best-effort; a logging failure must not drop the clinical write.
            }
        },
    };
}

export async function actorFromPostgres(
    prisma: PrismaClient,
    user: { id: string; email: string; role: string },
): Promise<Actor> {
    const row = await prisma.user.findUnique({
        where: { id: user.id },
        select: { tenantId: true, role: true },
    });
    return {
        id: user.id,
        email: user.email,
        role: resolveDevRole(user.email, user.role || row?.role),
        tenantId: row?.tenantId ?? null,
    };
}
