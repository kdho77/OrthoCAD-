// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Postgres adapter for shop jobs and stored G-code. Prisma only, so this can
// point at RDS later. It does not import the Supabase client or a slicer.

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
    PrinterRecord,
    PrinterState,
    ProductionJob,
    ProductionRepo,
    StoredGcode,
} from "../../../shared/production-jobs.js";

type JobRow = {
    id: string;
    designId: string;
    designName: string;
    designKind: "insole" | "afo";
    clientId: string;
    clientLabel: string;
    ownerId: string;
    tenantId: string | null;
    process: "print" | "mill";
    status: ProductionJob["status"];
    orderNumber: string | null;
    orderUrl: string | null;
    orderOpen: boolean;
    printerId: string | null;
    printerName: string | null;
    dueAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    durationMs: number | null;
    operatorName: string | null;
    failureReason: string | null;
    progress: number | null;
    gcodeSha256: string | null;
    gcodeStoredAt: Date | null;
};

function iso(value: Date | null): string | null {
    return value ? value.toISOString() : null;
}

function mapJob(row: JobRow): ProductionJob {
    return {
        id: row.id,
        designId: row.designId,
        designName: row.designName,
        designKind: row.designKind,
        clientId: row.clientId,
        clientLabel: row.clientLabel,
        ownerId: row.ownerId,
        tenantId: row.tenantId,
        process: row.process,
        status: row.status,
        orderNumber: row.orderNumber,
        orderUrl: row.orderUrl,
        orderOpen: row.orderOpen,
        printerId: row.printerId,
        printerName: row.printerName,
        dueAt: iso(row.dueAt),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        startedAt: iso(row.startedAt),
        finishedAt: iso(row.finishedAt),
        durationMs: row.durationMs,
        operatorName: row.operatorName,
        failureReason: row.failureReason,
        progress: row.progress,
        gcodeSha256: row.gcodeSha256,
        gcodeStoredAt: iso(row.gcodeStoredAt),
    };
}

function mapPrinter(row: {
    id: string;
    name: string;
    state: PrinterState;
    tenantId: string | null;
    ownerId: string;
}): PrinterRecord {
    return { id: row.id, name: row.name, state: row.state, tenantId: row.tenantId, ownerId: row.ownerId };
}

function dateOrNull(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return new Date(value);
}

export function prismaProductionRepo(prisma: PrismaClient): ProductionRepo {
    return {
        async listJobs() {
            const rows = await prisma.shopJob.findMany({ orderBy: { createdAt: "desc" } });
            return rows.map((row) => mapJob(row));
        },
        async getJob(id) {
            const row = await prisma.shopJob.findUnique({ where: { id } });
            return row ? mapJob(row) : null;
        },
        async insertJob(job) {
            await prisma.shopJob.create({
                data: {
                    id: job.id,
                    designId: job.designId,
                    designName: job.designName,
                    designKind: job.designKind,
                    clientId: job.clientId,
                    clientLabel: job.clientLabel,
                    ownerId: job.ownerId,
                    tenantId: job.tenantId,
                    process: job.process,
                    status: job.status,
                    orderNumber: job.orderNumber,
                    orderUrl: job.orderUrl,
                    orderOpen: job.orderOpen,
                    printerId: job.printerId,
                    printerName: job.printerName,
                    dueAt: job.dueAt ? new Date(job.dueAt) : null,
                    startedAt: job.startedAt ? new Date(job.startedAt) : null,
                    finishedAt: job.finishedAt ? new Date(job.finishedAt) : null,
                    durationMs: job.durationMs,
                    operatorName: job.operatorName,
                    failureReason: job.failureReason,
                    progress: job.progress,
                    gcodeSha256: job.gcodeSha256,
                    gcodeStoredAt: job.gcodeStoredAt ? new Date(job.gcodeStoredAt) : null,
                    createdAt: new Date(job.createdAt),
                    updatedAt: new Date(job.updatedAt),
                },
            });
        },
        async patchJob(id, patch) {
            const data: Prisma.ShopJobUpdateInput = {};
            if (patch.designName !== undefined) data.designName = patch.designName;
            if (patch.status !== undefined) data.status = patch.status;
            if (patch.orderOpen !== undefined) data.orderOpen = patch.orderOpen;
            if (patch.printerId !== undefined) data.printerId = patch.printerId;
            if (patch.printerName !== undefined) data.printerName = patch.printerName;
            if (patch.dueAt !== undefined) data.dueAt = dateOrNull(patch.dueAt);
            if (patch.startedAt !== undefined) data.startedAt = dateOrNull(patch.startedAt);
            if (patch.finishedAt !== undefined) data.finishedAt = dateOrNull(patch.finishedAt);
            if (patch.durationMs !== undefined) data.durationMs = patch.durationMs;
            if (patch.operatorName !== undefined) data.operatorName = patch.operatorName;
            if (patch.failureReason !== undefined) data.failureReason = patch.failureReason;
            if (patch.progress !== undefined) data.progress = patch.progress;
            if (patch.gcodeSha256 !== undefined) data.gcodeSha256 = patch.gcodeSha256;
            if (patch.gcodeStoredAt !== undefined) data.gcodeStoredAt = dateOrNull(patch.gcodeStoredAt);
            if (patch.updatedAt !== undefined) data.updatedAt = new Date(patch.updatedAt);
            const row = await prisma.shopJob.update({ where: { id }, data });
            return mapJob(row);
        },
        async listPrinters() {
            const rows = await prisma.shopPrinter.findMany({ orderBy: { name: "asc" } });
            return rows.map((row) => mapPrinter(row));
        },
        async getGcode(jobId) {
            const row = await prisma.jobGcode.findUnique({ where: { jobId } });
            if (!row) return null;
            const stored: StoredGcode = {
                body: row.body,
                sha256: row.sha256,
                storedAt: row.storedAt.toISOString(),
            };
            return stored;
        },
        async putGcode(jobId, value) {
            await prisma.jobGcode.upsert({
                where: { jobId },
                create: { jobId, sha256: value.sha256, body: value.body, storedAt: new Date(value.storedAt) },
                update: { sha256: value.sha256, body: value.body, storedAt: new Date(value.storedAt) },
            });
        },
        async clearGcode(jobId) {
            await prisma.jobGcode.deleteMany({ where: { jobId } });
        },
    };
}
