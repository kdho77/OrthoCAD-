// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Shop-floor jobs for the Production tab. G-code is stored and replayed as
// the exact bytes already saved. This module does not slice, does not talk to
// a printer or a mill, and does not create customer orders.

import { type Actor, canAccessOrg } from "./client-files.js";

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
}

export interface PrinterRecord {
    id: string;
    name: string;
    state: PrinterState;
    tenantId: string | null;
    ownerId: string;
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
    getGcode(jobId: string): Promise<StoredGcode | null>;
    putGcode(jobId: string, value: StoredGcode): Promise<void>;
    clearGcode(jobId: string): Promise<void>;
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
}): ProductionRepo {
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
            return db.printers;
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
    return repo.patchJob(jobId, { status: "cancelled", finishedAt: stamp(now), updatedAt: stamp(now) });
}

export async function retryJob(
    repo: ProductionRepo,
    actor: Actor,
    jobId: string,
    now = new Date(),
): Promise<ProductionJob> {
    const job = await requireJob(repo, actor, jobId);
    if (job.status !== "failed") throw new ProductionError("BAD_REQUEST", "Only a failed job can be retried");
    return repo.patchJob(jobId, {
        status: "waiting",
        failureReason: null,
        printerId: null,
        printerName: null,
        progress: null,
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
