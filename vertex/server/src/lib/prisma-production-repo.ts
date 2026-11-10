// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Postgres adapter for shop jobs and stored G-code. Prisma only, so this can
// point at RDS later. It does not import the Supabase client or a slicer.

import type { Prisma, PrismaClient } from "@prisma/client";
import { DISPATCH_LEDGER_UNAVAILABLE } from "../../../shared/printer-adapter.js";
import {
    type DispatchEvent,
    EMPTY_DISPATCH,
    type PrinterBinding,
    type PrinterRecord,
    type PrinterState,
    ProductionError,
    type ProductionJob,
    type ProductionRepo,
    type StoredGcode,
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
        ...EMPTY_DISPATCH,
    };
}

function mapPrinter(
    row: {
        id: string;
        name: string;
        state: PrinterState;
        tenantId: string | null;
        ownerId: string;
    },
    config?: {
        adapterMode: string;
        protocolId: string | null;
        endpoint: string | null;
        credentialRef: string | null;
        cancellation: string;
        lastSeenAt: Date | null;
        enabled?: boolean;
        bridgeId?: string | null;
        configVersion?: number;
    } | null,
): PrinterRecord {
    const mode =
        config?.adapterMode === "mock-only" || config?.adapterMode === "configured"
            ? config.adapterMode
            : "unset";
    return {
        id: row.id,
        name: row.name,
        state: row.state,
        tenantId: row.tenantId,
        ownerId: row.ownerId,
        adapterMode: mode,
        protocolId: config?.protocolId ?? null,
        endpointConfigured: Boolean(config?.endpoint),
        credentialRef: config?.credentialRef ?? null,
        cancellation: config?.cancellation === "explicit" ? "explicit" : "unsupported",
        liveVerified: false,
        protocolVerified: false,
        lastSeenAt: config?.lastSeenAt ? config.lastSeenAt.toISOString() : null,
        ...(config
            ? {
                  enabled: config.enabled !== false,
                  bridgeId: config.bridgeId ?? null,
                  configVersion: config.configVersion ?? 1,
                  address: config.endpoint ?? null,
              }
            : {}),
    };
}

function isMissingLedger(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("code" in error)) return false;
    const code = (error as { code?: unknown }).code;
    return code === "P2021" || code === "P2022";
}

function ledgerError(error: unknown): never {
    if (isMissingLedger(error)) throw new ProductionError("BAD_REQUEST", DISPATCH_LEDGER_UNAVAILABLE);
    throw error;
}

function withDispatch(
    job: ProductionJob,
    row: {
        dispatchState: string;
        controllerJobId: string | null;
        dispatchAttempt: number;
        idempotencyKey: string | null;
        dispatchError: string | null;
    } | null,
): ProductionJob {
    if (!row) return { ...job, ...EMPTY_DISPATCH };
    const state = row.dispatchState;
    const dispatchState =
        state === "started" ||
        state === "uploaded" ||
        state === "acknowledged" ||
        state === "uncertain" ||
        state === "rejected" ||
        state === "none"
            ? state
            : "none";
    return {
        ...job,
        dispatchState,
        controllerJobId: row.controllerJobId,
        dispatchAttempt: row.dispatchAttempt,
        idempotencyKey: row.idempotencyKey,
        dispatchError: row.dispatchError,
    };
}

function dateOrNull(value: string | null | undefined): Date | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    return new Date(value);
}

async function ledgerRow(prisma: PrismaClient, jobId: string) {
    try {
        return await prisma.shopDispatchRecord.findUnique({ where: { jobId } });
    } catch (error) {
        if (isMissingLedger(error)) return null;
        throw error;
    }
}

async function configRow(prisma: PrismaClient, printerId: string) {
    try {
        return await prisma.shopPrinterConfig.findUnique({ where: { printerId } });
    } catch (error) {
        if (isMissingLedger(error)) return null;
        throw error;
    }
}

export function prismaProductionRepo(prisma: PrismaClient): ProductionRepo {
    return {
        async listJobs() {
            const rows = await prisma.shopJob.findMany({ orderBy: { createdAt: "desc" } });
            const jobs = rows.map((row) => mapJob(row));
            try {
                const ledgers = await prisma.shopDispatchRecord.findMany({
                    where: { jobId: { in: jobs.map((job) => job.id) } },
                });
                const byId = new Map(ledgers.map((row) => [row.jobId, row]));
                return jobs.map((job) => withDispatch(job, byId.get(job.id) ?? null));
            } catch (error) {
                if (isMissingLedger(error)) return jobs.map((job) => withDispatch(job, null));
                throw error;
            }
        },
        async getJob(id) {
            const row = await prisma.shopJob.findUnique({ where: { id } });
            if (!row) return null;
            return withDispatch(mapJob(row), await ledgerRow(prisma, id));
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
            const dispatchTouched =
                patch.dispatchState !== undefined ||
                patch.controllerJobId !== undefined ||
                patch.dispatchAttempt !== undefined ||
                patch.idempotencyKey !== undefined ||
                patch.dispatchError !== undefined;
            if (dispatchTouched) {
                try {
                    await prisma.shopDispatchRecord.upsert({
                        where: { jobId: id },
                        create: {
                            jobId: id,
                            dispatchState: patch.dispatchState ?? "none",
                            controllerJobId: patch.controllerJobId ?? null,
                            dispatchAttempt: patch.dispatchAttempt ?? 0,
                            idempotencyKey: patch.idempotencyKey ?? null,
                            dispatchError: patch.dispatchError ?? null,
                        },
                        update: {
                            ...(patch.dispatchState !== undefined
                                ? { dispatchState: patch.dispatchState }
                                : {}),
                            ...(patch.controllerJobId !== undefined
                                ? { controllerJobId: patch.controllerJobId }
                                : {}),
                            ...(patch.dispatchAttempt !== undefined
                                ? { dispatchAttempt: patch.dispatchAttempt }
                                : {}),
                            ...(patch.idempotencyKey !== undefined
                                ? { idempotencyKey: patch.idempotencyKey }
                                : {}),
                            ...(patch.dispatchError !== undefined
                                ? { dispatchError: patch.dispatchError }
                                : {}),
                        },
                    });
                } catch (error) {
                    ledgerError(error);
                }
            }
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
            return withDispatch(mapJob(row), await ledgerRow(prisma, id));
        },
        async listPrinters() {
            const rows = await prisma.shopPrinter.findMany({ orderBy: { name: "asc" } });
            const printers: PrinterRecord[] = [];
            for (const row of rows) {
                printers.push(mapPrinter(row, await configRow(prisma, row.id)));
            }
            return printers;
        },
        async insertPrinter(printer) {
            await prisma.shopPrinter.create({
                data: {
                    id: printer.id,
                    name: printer.name,
                    state: printer.state,
                    ownerId: printer.ownerId,
                    tenantId: printer.tenantId,
                },
            });
            if (printer.adapterMode !== "mock-only") return;
            try {
                await prisma.shopPrinterConfig.create({
                    data: {
                        printerId: printer.id,
                        adapterMode: "mock-only",
                        cancellation: "unsupported",
                    },
                });
            } catch (error) {
                if (!isMissingLedger(error)) throw error;
            }
        },
        async getPrinterEndpoint(printerId) {
            try {
                const config = await prisma.shopPrinterConfig.findUnique({ where: { printerId } });
                return config?.endpoint ?? null;
            } catch (error) {
                ledgerError(error);
            }
        },
        async insertConfiguredPrinter(printer, binding: PrinterBinding) {
            const presence = {
                enabled: printer.enabled !== false,
                bridgeId: printer.bridgeId ?? null,
                configVersion: printer.configVersion ?? 1,
            };
            try {
                await prisma.$transaction([
                    prisma.shopPrinter.upsert({
                        where: { id: printer.id },
                        create: {
                            id: printer.id,
                            name: printer.name,
                            state: printer.state,
                            ownerId: printer.ownerId,
                            tenantId: printer.tenantId,
                        },
                        update: { name: printer.name },
                    }),
                    prisma.shopPrinterConfig.upsert({
                        where: { printerId: printer.id },
                        create: {
                            printerId: printer.id,
                            adapterMode: "configured",
                            protocolId: binding.protocolId,
                            endpoint: binding.endpoint,
                            credentialRef: binding.credentialRef,
                            cancellation: binding.cancellation,
                            lastSeenAt: binding.lastSeenAt ? new Date(binding.lastSeenAt) : null,
                            ...presence,
                        },
                        update: {
                            adapterMode: "configured",
                            protocolId: binding.protocolId,
                            endpoint: binding.endpoint,
                            credentialRef: binding.credentialRef,
                            cancellation: binding.cancellation,
                            ...presence,
                        },
                    }),
                ]);
            } catch (error) {
                ledgerError(error);
            }
        },
        async patchPrinter(id, patch) {
            if (patch.state !== undefined) {
                await prisma.shopPrinter.update({ where: { id }, data: { state: patch.state } });
            }
            if (patch.lastSeenAt !== undefined) {
                try {
                    await prisma.shopPrinterConfig.update({
                        where: { printerId: id },
                        data: { lastSeenAt: patch.lastSeenAt ? new Date(patch.lastSeenAt) : null },
                    });
                } catch (error) {
                    ledgerError(error);
                }
            }
            const row = await prisma.shopPrinter.findUnique({ where: { id } });
            if (!row) throw new ProductionError("NOT_FOUND", "Printer not found");
            return mapPrinter(row, await configRow(prisma, id));
        },
        async claimDispatch(jobId, fields) {
            try {
                const existing = await prisma.shopDispatchRecord.findUnique({ where: { jobId } });
                if (!existing) {
                    await prisma.shopDispatchRecord.create({
                        data: {
                            jobId,
                            dispatchState: "started",
                            dispatchAttempt: fields.dispatchAttempt,
                            idempotencyKey: fields.idempotencyKey,
                        },
                    });
                } else if (existing.dispatchState !== "none") {
                    return null;
                } else {
                    const updated = await prisma.shopDispatchRecord.updateMany({
                        where: { jobId, dispatchState: "none" },
                        data: {
                            dispatchState: "started",
                            dispatchAttempt: fields.dispatchAttempt,
                            idempotencyKey: fields.idempotencyKey,
                            controllerJobId: null,
                            dispatchError: null,
                        },
                    });
                    if (updated.count !== 1) return null;
                }
            } catch (error) {
                if (
                    typeof error === "object" &&
                    error &&
                    "code" in error &&
                    (error as { code?: string }).code === "P2002"
                ) {
                    return null;
                }
                ledgerError(error);
            }
            return this.getJob(jobId);
        },
        async appendDispatchEvent(event: DispatchEvent) {
            try {
                await prisma.shopDispatchEvent.create({
                    data: {
                        id: event.id,
                        jobId: event.jobId,
                        printerId: event.printerId,
                        kind: event.kind,
                        detail: event.detail,
                        createdAt: new Date(event.createdAt),
                    },
                });
            } catch (error) {
                ledgerError(error);
            }
        },
        async listDispatchEvents(jobId) {
            try {
                const rows = await prisma.shopDispatchEvent.findMany({
                    where: { jobId },
                    orderBy: { createdAt: "asc" },
                });
                return rows.map((row) => ({
                    id: row.id,
                    jobId: row.jobId,
                    printerId: row.printerId,
                    kind: row.kind,
                    detail: row.detail,
                    createdAt: row.createdAt.toISOString(),
                }));
            } catch (error) {
                ledgerError(error);
            }
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
