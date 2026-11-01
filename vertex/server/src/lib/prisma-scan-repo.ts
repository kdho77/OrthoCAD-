// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Postgres adapter for client scan blobs. Prisma only. No Supabase client.

import type { PrismaClient } from "@prisma/client";
import {
    ClientFileError,
    type ScanMeta,
    type ScanRepo,
    type ScanSide,
} from "../../../shared/client-scans.js";

function mapScan(row: {
    id: string;
    clientId: string;
    ownerId: string;
    tenantId: string | null;
    side: string;
    fileName: string;
    contentType: string;
    byteLength: number;
    sha256: string;
    uploadedAt: Date;
}): ScanMeta {
    return {
        id: row.id,
        clientId: row.clientId,
        ownerId: row.ownerId,
        tenantId: row.tenantId,
        side: row.side === "right" ? "right" : "left",
        fileName: row.fileName,
        contentType: row.contentType,
        byteLength: row.byteLength,
        sha256: row.sha256,
        uploadedAt: row.uploadedAt.toISOString(),
    };
}

export function prismaScanRepo(prisma: PrismaClient): ScanRepo {
    return {
        async listByClient(clientId) {
            const rows = await prisma.clientScan.findMany({ where: { clientId } });
            return rows.map(mapScan);
        },
        async listAll() {
            const rows = await prisma.clientScan.findMany();
            return rows.map(mapScan);
        },
        async getMeta(id) {
            const row = await prisma.clientScan.findUnique({ where: { id } });
            return row ? mapScan(row) : null;
        },
        async getBytes(id) {
            const row = await prisma.clientScanBlob.findUnique({ where: { scanId: id } });
            return row ? new Uint8Array(row.body) : null;
        },
        async insert(meta, bytes) {
            await prisma.clientScan.create({
                data: {
                    id: meta.id,
                    side: meta.side,
                    fileName: meta.fileName,
                    contentType: meta.contentType,
                    byteLength: meta.byteLength,
                    sha256: meta.sha256,
                    uploadedAt: new Date(meta.uploadedAt),
                    client: { connect: { id: meta.clientId } },
                    owner: { connect: { id: meta.ownerId } },
                    ...(meta.tenantId ? { tenant: { connect: { id: meta.tenantId } } } : {}),
                    blob: { create: { body: Buffer.from(bytes) } },
                },
            });
        },
        async patch(id, patch) {
            const data: { side?: ScanSide; fileName?: string } = {};
            if (patch.side !== undefined) data.side = patch.side;
            if (patch.fileName !== undefined) data.fileName = patch.fileName;
            const row = await prisma.clientScan.update({ where: { id }, data });
            return mapScan(row);
        },
        async remove(id) {
            await prisma.clientScan.delete({ where: { id } }).catch(() => {
                throw new ClientFileError("NOT_FOUND", "Scan not found");
            });
        },
    };
}
