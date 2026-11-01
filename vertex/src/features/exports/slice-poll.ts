// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { nextSlicePollDelayMs, SLICE_TIMEOUT_MS, type SliceJobStatusName } from "../../../shared/slice-job";

export interface SlicePollStatus {
    status: SliceJobStatusName;
    error?: string;
    downloadUrl?: string;
    productionId?: string;
    balance?: number;
}

export function mintIdempotencyKey(): string {
    return crypto.randomUUID();
}

export function isRetryableSliceStart(err: unknown): boolean {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (!msg) return true;
    if (msg.includes("insufficient")) return false;
    if (msg.includes("no valid license")) return false;
    if (msg.includes("not sliced")) return false;
    if (msg.includes("invalid manufacturing")) return false;
    if (msg.includes("design not found")) return false;
    if (msg.includes("bad request")) return false;
    return true;
}

/** Retry a start call with the same idempotency key. A new click mints a new key. */
export async function retrySameKey<T>(
    idempotencyKey: string,
    attempt: (idempotencyKey: string) => Promise<T>,
    opts?: {
        retries?: number;
        isRetryable?: (err: unknown) => boolean;
        sleep?: (ms: number) => Promise<void>;
    },
): Promise<T> {
    const retries = opts?.retries ?? 2;
    const isRetryable = opts?.isRetryable ?? isRetryableSliceStart;
    const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    let last: unknown;
    for (let i = 0; i <= retries; i++) {
        try {
            return await attempt(idempotencyKey);
        } catch (err) {
            last = err;
            if (!isRetryable(err) || i === retries) throw err;
            await sleep(nextSlicePollDelayMs(i));
        }
    }
    throw last instanceof Error ? last : new Error("Slice start failed");
}

/**
 * Poll until the job is terminal. Delay grows from ~2s to 10s.
 * The deadline is a few seconds past the server timeout so a timed-out job
 * is observed as failed (0 tokens) instead of abandoned while still running.
 */
export async function pollSliceJob(opts: {
    jobId: string;
    read: (jobId: string) => Promise<SlicePollStatus>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    deadlineMs?: number;
}): Promise<SlicePollStatus> {
    const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = opts.now ?? (() => Date.now());
    const deadline = now() + (opts.deadlineMs ?? SLICE_TIMEOUT_MS + 20_000);
    let attempt = 0;
    for (;;) {
        const status = await opts.read(opts.jobId);
        if (status.status === "succeeded" || status.status === "failed") return status;
        if (now() >= deadline) {
            return { status: "failed", error: "Slice timed out" };
        }
        await sleep(nextSlicePollDelayMs(attempt));
        attempt += 1;
    }
}
