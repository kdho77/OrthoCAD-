// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop-floor jobs for the Production tab. G-code is stored and replayed as
// the exact bytes already saved. This module does not slice, does not talk to
// a printer or a mill, and does not create customer orders.

import { type Actor, canAccessOrg } from "./client-files.js";
import { type MockPairingResult, mockMoonrakerPair } from "./mock-moonraker.js";
import {
    assertSupportedProtocol,
    type CredentialGate,
    LOCAL_BRIDGE_PROTOCOL_ID,
    normalizeBridgeEndpoint,
    normalizeCredentialRef,
    PRINTER_READINESS_MAX_AGE_MS,
    type PrinterTransport,
    PrinterTransportError,
    publicPrinterMessage,
} from "./printer-adapter.js";

export { DISPATCH_LEDGER_UNAVAILABLE } from "./printer-adapter.js";

export const GCODE_RETAIN_MS = 90 * 24 * 60 * 60 * 1000;

export const JOB_STATUSES = [
    "waiting",
    "assigned",
    "running",
    "paused",
    "held",
    "failed",
    "done",
    "cancelled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Queue keeps failed jobs so they can be retried. Done and cancelled leave the queue. */
export const QUEUE_STATUSES: JobStatus[] = ["waiting", "assigned", "running", "paused", "held", "failed"];
export const HISTORY_STATUSES: JobStatus[] = ["done", "failed", "cancelled"];

export const JOB_PROCESSES = ["print", "mill"] as const;
export type JobProcess = (typeof JOB_PROCESSES)[number];

export const PRINTER_STATES = ["idle", "running", "paused", "error", "offline"] as const;
export type PrinterState = (typeof PRINTER_STATES)[number];

export const DUE_FILTERS = ["any", "overdue", "today", "week", "none"] as const;
export type DueFilter = (typeof DUE_FILTERS)[number];

export interface ProductionJob {
    id: string;
    designId: string;
    designName: string;
    designKind: "insole" | "afo";
    clientId: string;
    /** Display name or initials already chosen for the client. Not a clinical note. */
    clientLabel: string;
    ownerId: string;
    tenantId: string | null;
    process: JobProcess;
    status: JobStatus;
    /** Vertex Orders number. Null means the job is internal. This app does not create the order. */
    orderNumber: string | null;
    orderUrl: string | null;
    /** While true, stored G-code outlives the 90-day window. */
    orderOpen: boolean;
    printerId: string | null;
    printerName: string | null;
    dueAt: string | null;
    createdAt: string;
    updatedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    durationMs: number | null;
    operatorName: string | null;
    failureReason: string | null;
    progress: number | null;
    gcodeSha256: string | null;
    gcodeStoredAt: string | null;
    dispatchState: DispatchState;
    controllerJobId: string | null;
    dispatchAttempt: number;
    idempotencyKey: string | null;
    dispatchError: string | null;
}

export const EMPTY_DISPATCH = {
    dispatchState: "none",
    controllerJobId: null,
    dispatchAttempt: 0,
    idempotencyKey: null,
    dispatchError: null,
} as const satisfies Pick<
    ProductionJob,
    "dispatchState" | "controllerJobId" | "dispatchAttempt" | "idempotencyKey" | "dispatchError"
>;

export const DISPATCH_STATES = ["none", "started", "acknowledged", "uncertain", "rejected"] as const;
export type DispatchState = (typeof DISPATCH_STATES)[number];

export interface PrinterRecord {
    id: string;
    name: string;
    state: PrinterState;
    tenantId: string | null;
    ownerId: string;
    adapterMode: "unset" | "mock-only" | "configured";
    protocolId: string | null;
    /** True when an endpoint is stored. The URL is not on this record. */
    endpointConfigured: boolean;
    /** Secret name only. Never a token or password. */
    credentialRef: string | null;
    cancellation: "unsupported" | "explicit";
    liveVerified: false;
    protocolVerified: false;
    lastSeenAt: string | null;
}

export const UNCONFIGURED_PRINTER = {
    adapterMode: "unset",
    protocolId: null,
    endpointConfigured: false,
    credentialRef: null,
    cancellation: "unsupported",
    liveVerified: false,
    protocolVerified: false,
    lastSeenAt: null,
} as const satisfies Omit<PrinterRecord, "id" | "name" | "state" | "tenantId" | "ownerId">;

export interface PrinterBinding {
    endpoint: string;
    protocolId: string;
    credentialRef: string;
    cancellation: "unsupported" | "explicit";
    lastSeenAt: string | null;
}

export interface DispatchEvent {
    id: string;
    jobId: string | null;
    printerId: string | null;
    kind: string;
    detail: string;
    createdAt: string;
}

export interface DispatchDeps {
    transport: PrinterTransport;
    credentialGate: CredentialGate;
    now?: Date;
    staleAfterMs?: number;
}

export interface StoredGcode {
    body: string;
    sha256: string;
    storedAt: string;
}

export interface ProductionRepo {
    listJobs(): Promise<ProductionJob[]>;
    getJob(id: string): Promise<ProductionJob | null>;
    insertJob(job: ProductionJob): Promise<void>;
    patchJob(id: string, patch: Partial<ProductionJob>): Promise<ProductionJob>;
    listPrinters(): Promise<PrinterRecord[]>;
    insertPrinter(printer: PrinterRecord): Promise<void>;
    getGcode(jobId: string): Promise<StoredGcode | null>;
    putGcode(jobId: string, value: StoredGcode): Promise<void>;
    clearGcode(jobId: string): Promise<void>;
    getPrinterEndpoint(printerId: string): Promise<string | null>;
    insertConfiguredPrinter(printer: PrinterRecord, binding: PrinterBinding): Promise<void>;
    patchPrinter(
        id: string,
        patch: Partial<Pick<PrinterRecord, "state" | "lastSeenAt">>,
    ): Promise<PrinterRecord>;
    claimDispatch(
        jobId: string,
        fields: Pick<ProductionJob, "dispatchAttempt" | "idempotencyKey" | "updatedAt">,
    ): Promise<ProductionJob | null>;
    appendDispatchEvent(event: DispatchEvent): Promise<void>;
    listDispatchEvents(jobId: string): Promise<DispatchEvent[]>;
}

export interface RegisterMockPrinterInput {
    name: string;
    /** Simulated Moonraker base URL. Never contacted in this foundation build. */
    moonrakerUrl: string;
}

export interface RegisterMockPrinterResult {
    printer: PrinterRecord;
    pairing: MockPairingResult;
}

export interface EnqueueInput {
    designId: string;
    designName: string;
    designKind: "insole" | "afo";
    clientId: string;
    clientLabel: string;
    process: JobProcess;
    dueAt?: string | null;
    orderNumber?: string | null;
    orderUrl?: string | null;
    orderOpen?: boolean;
    /** Exact G-code. Stored as-is. Never generated here. */
    gcode: string;
}

export interface QueueQuery {
    q: string;
    status: JobStatus | "any";
    process: JobProcess | "any";
    due: DueFilter;
    dir: "asc" | "desc";
}

export interface HistoryQuery {
    outcome: "any" | "done" | "failed" | "cancelled";
    from: string;
    to: string;
}

export class ProductionError extends Error {
    code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST";

    constructor(code: "NOT_FOUND" | "FORBIDDEN" | "BAD_REQUEST", message: string) {
        super(message);
        this.code = code;
        this.name = "ProductionError";
    }
}

export function defaultQueueQuery(): QueueQuery {
    return { q: "", status: "any", process: "any", due: "any", dir: "asc" };
}

export function defaultHistoryQuery(): HistoryQuery {
    return { outcome: "any", from: "", to: "" };
}

export async function sha256Hex(text: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 90 days, or while the Vertex order is still open, whichever is longer. */
export function isGcodeRetained(storedAt: string, orderOpen: boolean, now = new Date()): boolean {
    if (orderOpen) return true;
    const stored = new Date(storedAt).getTime();
    if (!Number.isFinite(stored)) return false;
    return now.getTime() <= stored + GCODE_RETAIN_MS;
}

export function createMemoryProductionRepo(db: {
    jobs: ProductionJob[];
    printers: PrinterRecord[];
    gcode: Record<string, StoredGcode>;
    endpoints?: Record<string, string>;
    events?: DispatchEvent[];
}): ProductionRepo {
    const endpoints = db.endpoints ?? {};
    const events = db.events ?? [];
    db.endpoints = endpoints;
    db.events = events;
    const shownPrinter = (printer: PrinterRecord): PrinterRecord => ({
        ...printer,
        endpointConfigured: Boolean(endpoints[printer.id]) || printer.endpointConfigured === true,
        liveVerified: false,
        protocolVerified: false,
    });
    return {
        async listJobs() {
            return db.jobs;
        },
        async getJob(id) {
            return db.jobs.find((job) => job.id === id) ?? null;
        },
        async insertJob(job) {
            db.jobs.unshift(job);
        },
        async patchJob(id, patch) {
            const index = db.jobs.findIndex((job) => job.id === id);
            const current = db.jobs[index];
            if (!current) throw new ProductionError("NOT_FOUND", "Job not found");
            const next = { ...current, ...patch };
            db.jobs[index] = next;
            return next;
        },
        async listPrinters() {
            return db.printers.map(shownPrinter);
        },
        async insertPrinter(printer) {
            db.printers.push({ ...printer, liveVerified: false, protocolVerified: false });
        },
        async getPrinterEndpoint(printerId) {
            return endpoints[printerId] ?? null;
        },
        async insertConfiguredPrinter(printer, binding) {
            db.printers.push({
                ...printer,
                endpointConfigured: true,
                liveVerified: false,
                protocolVerified: false,
            });
            endpoints[printer.id] = binding.endpoint;
        },
        async patchPrinter(id, patch) {
            const index = db.printers.findIndex((printer) => printer.id === id);
            const current = db.printers[index];
            if (!current) throw new ProductionError("NOT_FOUND", "Printer not found");
            const next = {
                ...current,
                ...patch,
                liveVerified: false as const,
                protocolVerified: false as const,
            };
            db.printers[index] = next;
            return shownPrinter(next);
        },
        async claimDispatch(jobId, fields) {
            const index = db.jobs.findIndex((job) => job.id === jobId);
            const current = db.jobs[index];
            if (!current || (current.dispatchState ?? "none") !== "none") return null;
            const next: ProductionJob = {
                ...current,
                ...EMPTY_DISPATCH,
                ...fields,
                dispatchState: "started",
                controllerJobId: null,
                dispatchError: null,
            };
            db.jobs[index] = next;
            return next;
        },
        async appendDispatchEvent(event) {
            events.push(event);
        },
        async listDispatchEvents(jobId) {
            return events.filter((event) => event.jobId === jobId);
        },
        async getGcode(jobId) {
            return db.gcode[jobId] ?? null;
        },
        async putGcode(jobId, value) {
            db.gcode[jobId] = value;
        },
        async clearGcode(jobId) {
            delete db.gcode[jobId];
        },
    };
}

function stamp(now?: Date): string {
    return (now ?? new Date()).toISOString();
}

function dayKey(iso: string): string {
    return new Date(iso).toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

export function dueMatches(dueAt: string | null, filter: DueFilter, now = new Date()): boolean {
    if (filter === "any") return true;
    if (filter === "none") return !dueAt;
    if (!dueAt) return false;
    const due = dayKey(dueAt);
    const today = now.toISOString().slice(0, 10);
    if (filter === "overdue") return due < today;
    if (filter === "today") return due === today;
    return due >= today && due <= addDays(today, 6);
}

function matchesText(job: ProductionJob, q: string): boolean {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [job.designName, job.clientLabel, job.orderNumber ?? "", job.printerName ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(needle);
}

function byDueDate(a: ProductionJob, b: ProductionJob, dir: "asc" | "desc"): number {
    if (!a.dueAt && !b.dueAt) return a.createdAt < b.createdAt ? 1 : -1;
    if (!a.dueAt) return 1;
    if (!b.dueAt) return -1;
    let order = 0;
    if (a.dueAt < b.dueAt) order = -1;
    else if (a.dueAt > b.dueAt) order = 1;
    return dir === "asc" ? order : -order;
}

export function queryQueue(
    jobs: ProductionJob[],
    query: QueueQuery = defaultQueueQuery(),
    now = new Date(),
): ProductionJob[] {
    return jobs
        .filter((job) => QUEUE_STATUSES.includes(job.status))
        .filter((job) => query.status === "any" || job.status === query.status)
        .filter((job) => query.process === "any" || job.process === query.process)
        .filter((job) => dueMatches(job.dueAt, query.due, now))
        .filter((job) => matchesText(job, query.q))
        .sort((a, b) => byDueDate(a, b, query.dir));
}

export function queryHistory(
    jobs: ProductionJob[],
    query: HistoryQuery = defaultHistoryQuery(),
): ProductionJob[] {
    return jobs
        .filter((job) => HISTORY_STATUSES.includes(job.status))
        .filter((job) => query.outcome === "any" || job.status === query.outcome)
        .filter((job) => {
            if (!query.from && !query.to) return true;
            const when = dayKey(job.finishedAt ?? job.updatedAt);
            if (query.from && when < query.from) return false;
            if (query.to && when > query.to) return false;
            return true;
        })
        .sort((a, b) => ((a.finishedAt ?? a.updatedAt) < (b.finishedAt ?? b.updatedAt) ? 1 : -1));
}

export interface PrinterCardModel {
    printer: PrinterRecord;
    current: ProductionJob | null;
    next: ProductionJob | null;
    progress: number | null;
}

export function printerCards(printers: PrinterRecord[], jobs: ProductionJob[]): PrinterCardModel[] {
    return printers.map((printer) => {
        const mine = jobs.filter((job) => job.printerId === printer.id);
        const current = mine.find((job) => job.status === "running" || job.status === "paused") ?? null;
        const next =
            mine
                .filter(
                    (job) =>
                        job.id !== current?.id && (job.status === "assigned" || job.status === "waiting"),
                )
                .sort((a, b) => byDueDate(a, b, "asc"))[0] ?? null;
        return { printer, current, next, progress: current?.progress ?? null };
    });
}

async function visibleJobs(repo: ProductionRepo, actor: Actor): Promise<ProductionJob[]> {
    return (await repo.listJobs()).filter((job) => canAccessOrg(actor, job));
}

async function requireJob(repo: ProductionRepo, actor: Actor, id: string): Promise<ProductionJob> {
    const job = await repo.getJob(id);
    if (!job || !canAccessOrg(actor, job)) throw new ProductionError("NOT_FOUND", "Job not found");
    return job;
}

export async function getProductionJob(
    repo: ProductionRepo,
    actor: Actor,
    id: string,
): Promise<ProductionJob> {
    return requireJob(repo, actor, id);
}

export async function expireStoredGcode(repo: ProductionRepo, actor: Actor, now = new Date()): Promise<void> {
    for (const job of await visibleJobs(repo, actor)) {
        if (!job.gcodeStoredAt || !job.gcodeSha256) continue;
        if (isGcodeRetained(job.gcodeStoredAt, job.orderOpen, now)) continue;
        await repo.clearGcode(job.id);
        await repo.patchJob(job.id, { gcodeSha256: null, gcodeStoredAt: null, updatedAt: stamp(now) });
    }
}

function duplicateQueuedJob(
    jobs: ProductionJob[],
    actor: Actor,
    designId: string,
    gcodeSha256: string,
): ProductionJob | null {
    return (
        jobs.find(
            (job) =>
                job.ownerId === actor.id &&
                job.tenantId === actor.tenantId &&
                job.designId === designId &&
                job.gcodeSha256 === gcodeSha256 &&
                QUEUE_STATUSES.includes(job.status),
        ) ?? null
    );
}

export async function registerMockPrinter(
    repo: ProductionRepo,
    actor: Actor,
    input: RegisterMockPrinterInput,
): Promise<RegisterMockPrinterResult> {
    const name = input.name.trim();
    if (!name) throw new ProductionError("BAD_REQUEST", "Printer name is required");
    let pairing: MockPairingResult;
    try {
        pairing = mockMoonrakerPair(input.moonrakerUrl, name);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid Moonraker URL";
        throw new ProductionError("BAD_REQUEST", message);
    }
    const printer: PrinterRecord = {
        id: crypto.randomUUID(),
        name,
        state: "offline",
        tenantId: actor.tenantId,
        ownerId: actor.id,
        adapterMode: "mock-only",
        protocolId: null,
        endpointConfigured: false,
        credentialRef: null,
        cancellation: "unsupported",
        liveVerified: false,
        protocolVerified: false,
        lastSeenAt: null,
    };
    await repo.insertPrinter(printer);
    return { printer, pairing };
}

export async function listProduction(
    repo: ProductionRepo,
    actor: Actor,
    now = new Date(),
): Promise<{ jobs: ProductionJob[]; printers: PrinterRecord[] }> {
    await expireStoredGcode(repo, actor, now);
    const jobs = await visibleJobs(repo, actor);
    const printers = (await repo.listPrinters()).filter((printer) => canAccessOrg(actor, printer));
    return { jobs, printers };
}

export async function enqueueJob(
    repo: ProductionRepo,
    actor: Actor,
    input: EnqueueInput,
    now = new Date(),
): Promise<ProductionJob> {
    const designName = input.designName.trim();
    const clientLabel = input.clientLabel.trim();
    if (!designName) throw new ProductionError("BAD_REQUEST", "Design name is required");
    if (!clientLabel) throw new ProductionError("BAD_REQUEST", "Client label is required");
    if (!input.gcode) throw new ProductionError("BAD_REQUEST", "G-code is required");
    if (input.orderUrl && !/^https?:\/\//i.test(input.orderUrl)) {
        throw new ProductionError("BAD_REQUEST", "Order link must be an http(s) URL");
    }
    const createdAt = stamp(now);
    const sha256 = await sha256Hex(input.gcode);
    const existing = duplicateQueuedJob(await repo.listJobs(), actor, input.designId, sha256);
    if (existing) return existing;
    const job: ProductionJob = {
        id: crypto.randomUUID(),
        designId: input.designId,
        designName,
        designKind: input.designKind,
        clientId: input.clientId,
        clientLabel,
        ownerId: actor.id,
        tenantId: actor.tenantId,
        process: input.process,
        status: "waiting",
        orderNumber: input.orderNumber?.trim() || null,
        orderUrl: input.orderUrl?.trim() || null,
        orderOpen: input.orderOpen === true,
        printerId: null,
        printerName: null,
        dueAt: input.dueAt ?? null,
        createdAt,
        updatedAt: createdAt,
        startedAt: null,
        finishedAt: null,
        durationMs: null,
        operatorName: null,
        failureReason: null,
        progress: null,
        gcodeSha256: sha256,
        gcodeStoredAt: createdAt,
        ...EMPTY_DISPATCH,
    };
    await repo.insertJob(job);
    await repo.putGcode(job.id, { body: input.gcode, sha256, storedAt: createdAt });
    return job;
}

export async function assignJob(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    printerId: string,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await requireJob(repo, actor, jobId);
    if (job.process !== "print")
        throw new ProductionError("BAD_REQUEST", "Mill jobs are not assigned to a printer");
    if (job.status === "done" || job.status === "cancelled") {
        throw new ProductionError("BAD_REQUEST", "Job is already finished");
    }
    if (dispatchInFlight(job)) {
        throw new ProductionError("BAD_REQUEST", "This job cannot move printers after a dispatch attempt.");
    }
    const printer = (await repo.listPrinters()).find((item) => item.id === printerId);
    if (!printer || !canAccessOrg(actor, printer))
        throw new ProductionError("NOT_FOUND", "Printer not found");
    return repo.patchJob(jobId, {
        status: "assigned",
        printerId: printer.id,
        printerName: printer.name,
        updatedAt: stamp(now),
    });
}

export async function holdJob(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await requireJob(repo, actor, jobId);
    if (job.status === "done" || job.status === "cancelled") {
        throw new ProductionError("BAD_REQUEST", "Job is already finished");
    }
    if (dispatchInFlight(job)) {
        throw new ProductionError(
            "BAD_REQUEST",
            "Hold was refused because a dispatch may already have reached the printer.",
        );
    }
    return repo.patchJob(jobId, { status: "held", updatedAt: stamp(now) });
}

export async function cancelJob(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await requireJob(repo, actor, jobId);
    if (job.status === "done" || job.status === "cancelled") {
        throw new ProductionError("BAD_REQUEST", "Job is already finished");
    }
    if (dispatchInFlight(job)) {
        throw new ProductionError(
            "BAD_REQUEST",
            "Queue cancel was refused because a dispatch may already have reached the printer.",
        );
    }
    return repo.patchJob(jobId, { status: "cancelled", finishedAt: stamp(now), updatedAt: stamp(now) });
}

export async function retryJob(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await requireJob(repo, actor, jobId);
    if (job.dispatchState === "uncertain" || job.dispatchState === "started") {
        throw new ProductionError(
            "BAD_REQUEST",
            "Retry was refused. A dispatch that may have started is not sent again automatically.",
        );
    }
    if (job.dispatchState === "acknowledged" && job.status !== "failed") {
        throw new ProductionError("BAD_REQUEST", "Only a failed job can be retried");
    }
    if (job.status !== "failed") throw new ProductionError("BAD_REQUEST", "Only a failed job can be retried");
    return repo.patchJob(jobId, {
        status: "waiting",
        failureReason: null,
        printerId: null,
        printerName: null,
        progress: null,
        dispatchState: "none",
        controllerJobId: null,
        idempotencyKey: null,
        dispatchError: null,
        updatedAt: stamp(now),
    });
}

export async function markJobDone(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await requireJob(repo, actor, jobId);
    if (job.process !== "mill")
        throw new ProductionError("BAD_REQUEST", "Only a mill job is marked done from this queue");
    if (job.status === "done" || job.status === "cancelled") {
        throw new ProductionError("BAD_REQUEST", "Job is already finished");
    }
    const finishedAt = stamp(now);
    const durationMs = job.startedAt
        ? new Date(finishedAt).getTime() - new Date(job.startedAt).getTime()
        : null;
    return repo.patchJob(jobId, {
        status: "done",
        finishedAt,
        durationMs,
        operatorName: actor.email,
        updatedAt: finishedAt,
    });
}

async function readRetainedGcode(repo: ProductionRepo, job: ProductionJob, now: Date): Promise<StoredGcode> {
    if (!job.gcodeStoredAt || !isGcodeRetained(job.gcodeStoredAt, job.orderOpen, now)) {
        await repo.clearGcode(job.id);
        throw new ProductionError("BAD_REQUEST", "Stored G-code has expired");
    }
    const stored = await repo.getGcode(job.id);
    if (!stored) throw new ProductionError("BAD_REQUEST", "Stored G-code has expired");
    const actual = await sha256Hex(stored.body);
    if (actual !== stored.sha256 || actual !== job.gcodeSha256) {
        throw new ProductionError("BAD_REQUEST", "Stored G-code does not match its sha256");
    }
    return stored;
}

/** Queue a new job that reuses the stored G-code bytes. Does not slice. */
export async function rerunJob(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await requireJob(repo, actor, jobId);
    if (!HISTORY_STATUSES.includes(job.status)) {
        throw new ProductionError("BAD_REQUEST", "Re-run is for a finished job");
    }
    const stored = await readRetainedGcode(repo, job, now);
    return enqueueJob(
        repo,
        actor,
        {
            designId: job.designId,
            designName: job.designName,
            designKind: job.designKind,
            clientId: job.clientId,
            clientLabel: job.clientLabel,
            process: job.process,
            dueAt: job.dueAt,
            orderNumber: job.orderNumber,
            orderUrl: job.orderUrl,
            orderOpen: job.orderOpen,
            gcode: stored.body,
        },
        now,
    );
}

export async function downloadGcode(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    now = new Date(),
): Promise<{ filename: string; gcode: string; sha256: string }> {
    const job = await requireJob(repo, actor, jobId);
    const stored = await readRetainedGcode(repo, job, now);
    return { filename: `LR-${job.id}.gcode`, gcode: stored.body, sha256: stored.sha256 };
}

function dispatchInFlight(job: ProductionJob): boolean {
    const state = job.dispatchState ?? "none";
    return state === "started" || state === "uncertain" || state === "acknowledged";
}

function blocksPrinter(job: ProductionJob): boolean {
    if (job.dispatchState === "started" || job.dispatchState === "uncertain") return true;
    if (
        job.dispatchState === "acknowledged" &&
        (job.status === "assigned" || job.status === "running" || job.status === "paused")
    ) {
        return true;
    }
    return job.status === "running" || job.status === "paused";
}

async function audit(
    repo: ProductionRepo,
    event: Omit<DispatchEvent, "id" | "createdAt"> & { createdAt?: string },
    now: Date,
): Promise<void> {
    await repo.appendDispatchEvent({
        id: crypto.randomUUID(),
        jobId: event.jobId,
        printerId: event.printerId,
        kind: event.kind,
        detail: publicPrinterMessage(event.detail),
        createdAt: event.createdAt ?? stamp(now),
    });
}

async function requirePrinter(repo: ProductionRepo, actor: Actor, printerId: string): Promise<PrinterRecord> {
    const printer = (await repo.listPrinters()).find((item) => item.id === printerId);
    if (!printer || !canAccessOrg(actor, printer))
        throw new ProductionError("NOT_FOUND", "Printer not found");
    return {
        ...printer,
        liveVerified: false,
        protocolVerified: false,
    };
}

function requireBound(deps: DispatchDeps): void {
    if (!deps.transport.bound) {
        throw new ProductionError(
            "BAD_REQUEST",
            "Printer transport is not bound. No controller call was made.",
        );
    }
}

async function requireDispatchPermission(
    repo: ProductionRepo,
    printer: PrinterRecord,
    deps: DispatchDeps,
): Promise<void> {
    requireBound(deps);
    if (printer.adapterMode === "mock-only") {
        throw new ProductionError("BAD_REQUEST", "Mock printer registration is not a live controller.");
    }
    if (printer.adapterMode !== "configured" || printer.protocolId !== LOCAL_BRIDGE_PROTOCOL_ID) {
        throw new ProductionError("BAD_REQUEST", "Printer has no supported controller configuration.");
    }
    if (!printer.credentialRef || deps.credentialGate(printer.credentialRef) !== "present") {
        throw new ProductionError("BAD_REQUEST", "Printer credential is not available to this process.");
    }
    const endpoint = await repo.getPrinterEndpoint(printer.id);
    if (!endpoint) throw new ProductionError("BAD_REQUEST", "Printer endpoint is not configured.");
}

export interface RegisterConfiguredPrinterInput {
    name: string;
    protocolId: string;
    endpoint: string;
    credentialRef: string;
    cancellation: "unsupported" | "explicit";
}

/** Stores operator configuration. Does not open a socket and does not mark the printer live. */
export async function registerConfiguredPrinter(
    repo: ProductionRepo,
    actor: Actor,
    input: RegisterConfiguredPrinterInput,
): Promise<PrinterRecord> {
    const name = input.name.trim();
    if (!name) throw new ProductionError("BAD_REQUEST", "Printer name is required");
    let endpoint = "";
    let credentialRef = "";
    try {
        assertSupportedProtocol(input.protocolId);
        endpoint = normalizeBridgeEndpoint(input.endpoint);
        credentialRef = normalizeCredentialRef(input.credentialRef);
    } catch (error) {
        const message = error instanceof Error ? error.message : "Printer configuration is invalid";
        throw new ProductionError("BAD_REQUEST", publicPrinterMessage(message));
    }
    if (input.cancellation !== "unsupported" && input.cancellation !== "explicit") {
        throw new ProductionError("BAD_REQUEST", "Cancellation must be unsupported or explicit.");
    }
    for (const existing of await repo.listPrinters()) {
        if (!canAccessOrg(actor, existing)) continue;
        const other = await repo.getPrinterEndpoint(existing.id);
        if (other && other === endpoint) {
            throw new ProductionError("BAD_REQUEST", "Another printer already uses that endpoint.");
        }
    }
    const printer: PrinterRecord = {
        id: crypto.randomUUID(),
        name,
        state: "offline",
        tenantId: actor.tenantId,
        ownerId: actor.id,
        adapterMode: "configured",
        protocolId: LOCAL_BRIDGE_PROTOCOL_ID,
        endpointConfigured: true,
        credentialRef,
        cancellation: input.cancellation,
        liveVerified: false,
        protocolVerified: false,
        lastSeenAt: null,
    };
    await repo.insertConfiguredPrinter(printer, {
        endpoint,
        protocolId: LOCAL_BRIDGE_PROTOCOL_ID,
        credentialRef,
        cancellation: input.cancellation,
        lastSeenAt: null,
    });
    return printer;
}

export async function refreshPrinterReadiness(
    repo: ProductionRepo,
    actor: Actor,
    printerId: string,
    deps: DispatchDeps,
): Promise<PrinterRecord> {
    const now = deps.now ?? new Date();
    const printer = await requirePrinter(repo, actor, printerId);
    await requireDispatchPermission(repo, printer, deps);
    let ready = false;
    try {
        const result = await deps.transport.readiness(printer.id);
        ready = result.ready;
    } catch (error) {
        if (error instanceof PrinterTransportError && !error.mayHaveStarted) {
            await repo.patchPrinter(printer.id, { state: "offline", lastSeenAt: stamp(now) });
            throw new ProductionError("BAD_REQUEST", publicPrinterMessage(error.message));
        }
        ready = false;
    }
    const mine = (await visibleJobs(repo, actor)).filter((job) => job.printerId === printer.id);
    let state: PrinterRecord["state"] = "idle";
    if (!ready) state = "offline";
    else if (mine.some((job) => job.dispatchState === "started" || job.dispatchState === "uncertain"))
        state = "error";
    else if (mine.some(blocksPrinter)) state = "running";
    const updated = await repo.patchPrinter(printer.id, { state, lastSeenAt: stamp(now) });
    await audit(
        repo,
        {
            jobId: null,
            printerId: printer.id,
            kind: ready ? "readiness_ready" : "readiness_offline",
            detail: ready
                ? "Readiness check passed. The printer is not shop-verified."
                : "Readiness check failed.",
        },
        now,
    );
    return { ...updated, liveVerified: false, protocolVerified: false };
}

async function assertPrinterReady(
    repo: ProductionRepo,
    actor: Actor,
    printer: PrinterRecord,
    deps: DispatchDeps,
    now: Date,
): Promise<void> {
    const seen = printer.lastSeenAt ? new Date(printer.lastSeenAt).getTime() : Number.NaN;
    const staleAfter = deps.staleAfterMs ?? PRINTER_READINESS_MAX_AGE_MS;
    if (
        !Number.isFinite(seen) ||
        now.getTime() - seen > staleAfter ||
        printer.state === "offline" ||
        printer.state === "error"
    ) {
        if (printer.state !== "offline") {
            await repo.patchPrinter(printer.id, { state: "offline" });
        }
        await audit(
            repo,
            {
                jobId: null,
                printerId: printer.id,
                kind: printer.lastSeenAt ? "printer_stale" : "readiness_offline",
                detail: printer.lastSeenAt
                    ? "Printer is offline or its last readiness check is stale. No job was sent."
                    : "Printer readiness has not been checked. No job was sent.",
            },
            now,
        );
        throw new ProductionError(
            "BAD_REQUEST",
            printer.lastSeenAt
                ? "Printer is offline or its last readiness check is stale. No job was sent."
                : "Printer readiness has not been checked. No job was sent.",
        );
    }
    if (printer.state !== "idle") {
        throw new ProductionError("BAD_REQUEST", "Printer already has an active job. No job was sent.");
    }
    const mine = (await visibleJobs(repo, actor)).filter((job) => job.printerId === printer.id);
    if (mine.some(blocksPrinter)) {
        throw new ProductionError("BAD_REQUEST", "Printer already has an active job. No job was sent.");
    }
}

const dispatchLocks = new Map<string, Promise<unknown>>();

function withDispatchLock<T>(jobId: string, run: () => Promise<T>): Promise<T> {
    const previous = dispatchLocks.get(jobId) ?? Promise.resolve();
    const result = previous.then(run, run);
    dispatchLocks.set(
        jobId,
        result.then(
            () => undefined,
            () => undefined,
        ),
    );
    return result;
}

export function dispatchAssignedJob(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    deps: DispatchDeps,
): Promise<ProductionJob> {
    return withDispatchLock(jobId, () => dispatchAssignedJobBody(repo, actor, jobId, deps));
}

async function dispatchAssignedJobBody(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    deps: DispatchDeps,
): Promise<ProductionJob> {
    const now = deps.now ?? new Date();
    const job = await requireJob(repo, actor, jobId);
    if (job.process !== "print")
        throw new ProductionError("BAD_REQUEST", "Mill jobs are not dispatched to a printer");
    if (!job.printerId)
        throw new ProductionError("BAD_REQUEST", "Assign the job to a printer before dispatch.");
    if (job.status !== "assigned") {
        throw new ProductionError("BAD_REQUEST", "Only an assigned print job can be dispatched.");
    }
    const printer = await requirePrinter(repo, actor, job.printerId);
    if (
        job.dispatchState === "uncertain" ||
        job.dispatchState === "started" ||
        job.dispatchState === "acknowledged"
    ) {
        await audit(
            repo,
            {
                jobId: job.id,
                printerId: printer.id,
                kind: "duplicate_suppressed",
                detail: "Dispatch was not repeated. A previous attempt may already have started.",
            },
            now,
        );
        throw new ProductionError(
            "BAD_REQUEST",
            "Dispatch was not acknowledged as a new start. It will not be sent again automatically.",
        );
    }
    await requireDispatchPermission(repo, printer, deps);
    await assertPrinterReady(repo, actor, printer, deps, now);
    const stored = await readRetainedGcode(repo, job, now);
    const attempt = (job.dispatchAttempt ?? 0) + 1;
    const idempotencyKey = `${job.id}:${stored.sha256}:${attempt}`;
    const claimed = await repo.claimDispatch(job.id, {
        dispatchAttempt: attempt,
        idempotencyKey,
        updatedAt: stamp(now),
    });
    if (!claimed) {
        await audit(
            repo,
            {
                jobId: job.id,
                printerId: printer.id,
                kind: "duplicate_suppressed",
                detail: "A concurrent dispatch already claimed this job.",
            },
            now,
        );
        return requireJob(repo, actor, job.id);
    }
    await audit(
        repo,
        {
            jobId: job.id,
            printerId: printer.id,
            kind: "dispatch_started",
            detail: `Dispatch claimed attempt ${attempt}.`,
        },
        now,
    );
    let result: Awaited<ReturnType<PrinterTransport["dispatch"]>>;
    try {
        result = await deps.transport.dispatch({
            printerId: printer.id,
            idempotencyKey,
            gcodeSha256: stored.sha256,
            gcode: stored.body,
        });
    } catch (error) {
        const reason = publicPrinterMessage(error instanceof Error ? error.message : "Dispatch was rejected");
        await audit(
            repo,
            { jobId: job.id, printerId: printer.id, kind: "dispatch_rejected", detail: reason },
            now,
        );
        return repo.patchJob(job.id, {
            status: "failed",
            dispatchState: "rejected",
            failureReason: reason,
            dispatchError: reason,
            updatedAt: stamp(now),
        });
    }
    if (result.outcome === "acknowledged") {
        await repo.patchPrinter(printer.id, { state: "running", lastSeenAt: stamp(now) });
        await audit(
            repo,
            {
                jobId: job.id,
                printerId: printer.id,
                kind: "dispatch_acknowledged",
                detail: "Controller accepted the job.",
            },
            now,
        );
        return repo.patchJob(job.id, {
            status: "running",
            dispatchState: "acknowledged",
            controllerJobId: result.controllerJobId,
            progress: 0,
            startedAt: job.startedAt ?? stamp(now),
            operatorName: actor.email,
            dispatchError: null,
            failureReason: null,
            updatedAt: stamp(now),
        });
    }
    if (result.outcome === "uncertain") {
        const reason = publicPrinterMessage(result.reason);
        await repo.patchPrinter(printer.id, { state: "error", lastSeenAt: stamp(now) });
        await audit(
            repo,
            { jobId: job.id, printerId: printer.id, kind: "dispatch_uncertain", detail: reason },
            now,
        );
        return repo.patchJob(job.id, {
            dispatchState: "uncertain",
            controllerJobId: null,
            dispatchError: reason,
            failureReason: reason,
            updatedAt: stamp(now),
        });
    }
    const reason = publicPrinterMessage(result.reason);
    await audit(
        repo,
        { jobId: job.id, printerId: printer.id, kind: "dispatch_rejected", detail: reason },
        now,
    );
    return repo.patchJob(job.id, {
        status: "failed",
        dispatchState: "rejected",
        failureReason: reason,
        dispatchError: reason,
        updatedAt: stamp(now),
    });
}

export async function reconcilePrinter(
    repo: ProductionRepo,
    actor: Actor,
    printerId: string,
    deps: DispatchDeps,
): Promise<ProductionJob[]> {
    const now = deps.now ?? new Date();
    const printer = await requirePrinter(repo, actor, printerId);
    await requireDispatchPermission(repo, printer, deps);
    const mine = (await visibleJobs(repo, actor)).filter((job) => job.printerId === printer.id);
    let ready = false;
    try {
        ready = (await deps.transport.readiness(printer.id)).ready;
    } catch {
        ready = false;
    }
    if (!ready) {
        await repo.patchPrinter(printer.id, { state: "offline", lastSeenAt: stamp(now) });
        for (const job of mine) {
            if (
                job.dispatchState === "started" ||
                (job.dispatchState === "uncertain" && !job.controllerJobId)
            ) {
                await repo.patchJob(job.id, {
                    dispatchState: "uncertain",
                    dispatchError:
                        "Printer disconnected before a controller job id was stored. The job was not sent again.",
                    updatedAt: stamp(now),
                });
            } else if (job.controllerJobId) {
                await repo.patchJob(job.id, {
                    dispatchError:
                        "Printer disconnected. Status was not changed and the job was not sent again.",
                    updatedAt: stamp(now),
                });
            }
            await audit(
                repo,
                {
                    jobId: job.id,
                    printerId: printer.id,
                    kind: "printer_stale",
                    detail: "Printer disconnected during reconciliation. No job was sent again.",
                },
                now,
            );
        }
        return (await visibleJobs(repo, actor)).filter((job) => job.printerId === printer.id);
    }
    for (const job of mine) {
        if ((job.dispatchState === "started" || job.dispatchState === "uncertain") && !job.controllerJobId) {
            await repo.patchJob(job.id, {
                dispatchState: "uncertain",
                dispatchError: "Dispatch has no controller job id. It will not be sent again automatically.",
                updatedAt: stamp(now),
            });
            await audit(
                repo,
                {
                    jobId: job.id,
                    printerId: printer.id,
                    kind: "dispatch_uncertain",
                    detail: "Reconciliation found no controller job id. No job was sent again.",
                },
                now,
            );
            continue;
        }
        if (!job.controllerJobId) continue;
        let status: Awaited<ReturnType<PrinterTransport["status"]>>;
        try {
            status = await deps.transport.status({
                printerId: printer.id,
                controllerJobId: job.controllerJobId,
            });
        } catch (error) {
            const reason = publicPrinterMessage(
                error instanceof Error ? error.message : "Status check failed",
            );
            await repo.patchJob(job.id, {
                dispatchError: reason,
                updatedAt: stamp(now),
            });
            await audit(
                repo,
                { jobId: job.id, printerId: printer.id, kind: "status_reconciled", detail: reason },
                now,
            );
            continue;
        }
        if (status.controllerJobId !== job.controllerJobId) {
            await repo.patchJob(job.id, {
                dispatchError: "Controller job id did not match the stored id. The stored id was kept.",
                updatedAt: stamp(now),
            });
            await audit(
                repo,
                {
                    jobId: job.id,
                    printerId: printer.id,
                    kind: "controller_job_mismatch",
                    detail: "Controller job id did not match the stored id. The stored id was kept.",
                },
                now,
            );
            continue;
        }
        if (status.phase === "complete") {
            const finishedAt = stamp(now);
            const durationMs = job.startedAt
                ? new Date(finishedAt).getTime() - new Date(job.startedAt).getTime()
                : null;
            await repo.patchJob(job.id, {
                status: "done",
                progress: 100,
                finishedAt,
                durationMs,
                dispatchError: null,
                updatedAt: finishedAt,
            });
        } else if (status.phase === "failed") {
            const reason = publicPrinterMessage(status.reason ?? "Controller reported the job failed");
            await repo.patchJob(job.id, {
                status: "failed",
                dispatchState: "acknowledged",
                failureReason: reason,
                dispatchError: reason,
                updatedAt: stamp(now),
            });
        } else if (status.phase === "printing" || status.phase === "paused" || status.phase === "queued") {
            await repo.patchJob(job.id, {
                status: status.phase === "paused" ? "paused" : "running",
                dispatchState: "acknowledged",
                progress: status.progress,
                dispatchError: null,
                updatedAt: stamp(now),
            });
        } else {
            await repo.patchJob(job.id, {
                dispatchError: "Controller status is unknown. The job was not sent again.",
                updatedAt: stamp(now),
            });
        }
        await audit(
            repo,
            {
                jobId: job.id,
                printerId: printer.id,
                kind: "status_reconciled",
                detail: "Status was reconciled from the stored controller job id.",
            },
            now,
        );
    }
    const after = (await visibleJobs(repo, actor)).filter((job) => job.printerId === printer.id);
    const state = after.some((job) => job.dispatchState === "uncertain" || job.dispatchState === "started")
        ? "error"
        : after.some(blocksPrinter)
          ? "running"
          : "idle";
    await repo.patchPrinter(printer.id, { state, lastSeenAt: stamp(now) });
    return after;
}

/** Printer cancel runs only when this configuration says cancellation is explicit. */
export async function cancelDispatchedPrint(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    deps: DispatchDeps,
): Promise<ProductionJob> {
    const now = deps.now ?? new Date();
    const job = await requireJob(repo, actor, jobId);
    if (!job.printerId) throw new ProductionError("BAD_REQUEST", "Job is not assigned to a printer");
    const printer = await requirePrinter(repo, actor, job.printerId);
    if (job.dispatchState === "uncertain" || job.dispatchState === "started" || !job.controllerJobId) {
        await audit(
            repo,
            {
                jobId: job.id,
                printerId: printer.id,
                kind: "cancel_refused",
                detail: "Cancellation was not sent because the controller job id is unknown.",
            },
            now,
        );
        throw new ProductionError(
            "BAD_REQUEST",
            "Cancellation was not sent because the controller job id is unknown.",
        );
    }
    if (printer.cancellation !== "explicit") {
        await audit(
            repo,
            {
                jobId: job.id,
                printerId: printer.id,
                kind: "cancel_refused",
                detail: "This printer configuration does not support cancellation.",
            },
            now,
        );
        throw new ProductionError("BAD_REQUEST", "This printer configuration does not support cancellation.");
    }
    await requireDispatchPermission(repo, printer, deps);
    let result: Awaited<ReturnType<PrinterTransport["cancel"]>>;
    try {
        result = await deps.transport.cancel({ printerId: printer.id, controllerJobId: job.controllerJobId });
    } catch (error) {
        const reason = publicPrinterMessage(error instanceof Error ? error.message : "Cancel failed");
        await repo.patchJob(job.id, { dispatchError: reason, updatedAt: stamp(now) });
        throw new ProductionError("BAD_REQUEST", reason);
    }
    if (result.outcome !== "cancelled") {
        const reason = publicPrinterMessage(result.reason ?? "Controller refused cancellation");
        await repo.patchJob(job.id, { dispatchError: reason, updatedAt: stamp(now) });
        await audit(
            repo,
            { jobId: job.id, printerId: printer.id, kind: "cancel_refused", detail: reason },
            now,
        );
        throw new ProductionError("BAD_REQUEST", reason);
    }
    await audit(
        repo,
        {
            jobId: job.id,
            printerId: printer.id,
            kind: "cancel_acknowledged",
            detail: "Controller accepted cancellation.",
        },
        now,
    );
    const cancelled = await repo.patchJob(job.id, {
        status: "cancelled",
        finishedAt: stamp(now),
        dispatchError: null,
        updatedAt: stamp(now),
    });
    const remaining = (await visibleJobs(repo, actor)).filter((item) => item.printerId === printer.id);
    if (!remaining.some(blocksPrinter)) {
        await repo.patchPrinter(printer.id, { state: "idle" });
    }
    return cancelled;
}

export function statusLabel(status: JobStatus): string {
    if (status === "waiting") return "Waiting";
    if (status === "assigned") return "Assigned";
    if (status === "running") return "Running";
    if (status === "paused") return "Paused";
    if (status === "held") return "Held";
    if (status === "failed") return "Failed";
    if (status === "done") return "Done";
    return "Cancelled";
}

export function processLabel(process: JobProcess): string {
    return process === "mill" ? "Mill" : "Print";
}

export function printerStateLabel(state: PrinterState): string {
    if (state === "idle") return "Idle";
    if (state === "running") return "Running";
    if (state === "paused") return "Paused";
    if (state === "error") return "Error";
    return "Offline";
}

export function formatDuration(durationMs: number | null): string {
    if (durationMs == null || durationMs < 0) return "—";
    const minutes = Math.round(durationMs / 60000);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
