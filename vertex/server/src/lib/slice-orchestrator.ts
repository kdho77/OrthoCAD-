// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { SLICE_TIMEOUT_MS } from "../../../shared/slice-job.js";

export class SliceJobNotFoundError extends Error {
    constructor() {
        super("Slice job not found");
        this.name = "SliceJobNotFoundError";
    }
}

import type { InsertSliceJob, SliceJobRecord, SliceLedger } from "./slice-ledger.js";
import { redactSecrets } from "./vertexslice-client.js";

export interface SliceRuntime {
    ledger: SliceLedger;
    loadStl(job: SliceJobRecord): Promise<Uint8Array>;
    slice(job: SliceJobRecord, stl: Uint8Array): Promise<string>;
    storeGcode(job: SliceJobRecord, gcode: string): Promise<string>;
    signDownload?(storageKey: string): Promise<string>;
    onSucceeded?(job: SliceJobRecord): Promise<void>;
    onFailed?(job: SliceJobRecord): Promise<void>;
}

export interface SliceStatusView {
    jobId: string;
    status: SliceJobRecord["status"];
    error?: string;
    downloadUrl?: string;
    productionId?: string;
    exportId?: string;
    balance?: number;
}

const inflight = new Map<string, Promise<SliceJobRecord | null>>();

export function sliceInflight(jobId: string): boolean {
    return inflight.has(jobId);
}

function safeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : "Slice failed";
    return redactSecrets(raw, [
        process.env.VERTEXSLICE_API_KEY,
        process.env.MANUFACTURING_INTERNAL_API_KEY,
    ]).slice(0, 500);
}

export async function executeSliceJob(jobId: string, runtime: SliceRuntime): Promise<SliceJobRecord | null> {
    const claimed = await runtime.ledger.claimRunning(jobId);
    if (!claimed) return runtime.ledger.getById(jobId);

    const timer = setInterval(() => {
        void runtime.ledger.touch(jobId).catch(() => undefined);
    }, 10_000);

    try {
        const job = await runtime.ledger.getById(jobId);
        if (!job) return null;
        if (Date.now() - Date.parse(job.createdAt) > SLICE_TIMEOUT_MS) {
            return runtime.ledger.markFailed(jobId, "timeout");
        }
        const stl = await runtime.loadStl(job);
        const gcode = await runtime.slice(job, stl);
        if (!gcode.trim()) throw new Error("Slice returned empty G-code");
        const fresh = await runtime.ledger.getById(jobId);
        if (!fresh || fresh.status === "failed" || fresh.status === "succeeded") return fresh;
        if (Date.now() - Date.parse(fresh.createdAt) > SLICE_TIMEOUT_MS) {
            return runtime.ledger.markFailed(jobId, "timeout");
        }
        const storageKey = await runtime.storeGcode(fresh, gcode);
        const settled = await runtime.ledger.settleSuccess(jobId, {
            gcodeStorageKey: storageKey,
            fileName: fresh.fileName,
        });
        if (settled.job.status === "succeeded") {
            await runtime.onSucceeded?.(settled.job);
        } else {
            await runtime.onFailed?.(settled.job);
        }
        return settled.job;
    } catch (err) {
        const failed = await runtime.ledger.markFailed(jobId, safeError(err));
        await runtime.onFailed?.(failed);
        return failed;
    } finally {
        clearInterval(timer);
    }
}

export function trackSlice(jobId: string, runtime: SliceRuntime): Promise<SliceJobRecord | null> {
    const existing = inflight.get(jobId);
    if (existing) return existing;
    const run = executeSliceJob(jobId, runtime).finally(() => {
        inflight.delete(jobId);
    });
    inflight.set(jobId, run);
    return run;
}

export async function enqueueSlice(
    input: InsertSliceJob,
    runtime: SliceRuntime,
    opts?: { wait?: boolean },
): Promise<SliceJobRecord> {
    const { job } = await runtime.ledger.insertQueued(input);
    if (job.status !== "queued" && job.status !== "running") return job;
    const run = trackSlice(job.id, runtime);
    if (opts?.wait) {
        await run;
        return (await runtime.ledger.getById(job.id)) ?? job;
    }
    void run.catch((err: unknown) => {
        console.error("[manufacturing] background slice error", { jobId: job.id, message: safeError(err) });
    });
    return job;
}

export async function readSliceForUser(
    jobId: string,
    userId: string,
    runtime: SliceRuntime,
): Promise<SliceStatusView> {
    let job = await runtime.ledger.getById(jobId);
    if (!job || job.userId !== userId) {
        throw new SliceJobNotFoundError();
    }
    const age = Date.now() - Date.parse(job.createdAt);
    if ((job.status === "queued" || job.status === "running") && age > SLICE_TIMEOUT_MS) {
        job = await runtime.ledger.markFailed(job.id, "timeout");
    } else if (job.status === "queued" || (job.status === "running" && !sliceInflight(job.id))) {
        const backgroundJobId = job.id;
        void trackSlice(backgroundJobId, runtime).catch((err: unknown) => {
            console.error("[manufacturing] background slice error", {
                jobId: backgroundJobId,
                message: safeError(err),
            });
        });
    }

    let downloadUrl: string | undefined;
    if (job.status === "succeeded" && job.gcodeStorageKey && runtime.signDownload) {
        downloadUrl = await runtime.signDownload(job.gcodeStorageKey);
    }
    const balance =
        job.status === "succeeded"
            ? (job.balanceAfter ?? (await runtime.ledger.getBalance(userId)))
            : undefined;
    return {
        jobId: job.id,
        status: job.status,
        error: job.error ?? undefined,
        downloadUrl,
        productionId: job.productionId ?? undefined,
        exportId: job.exportId ?? undefined,
        balance,
    };
}
