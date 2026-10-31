// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { randomUUID } from "node:crypto";
import { SLICE_TIMEOUT_MS, SLICE_TOKEN_COST, type SliceJobStatusName } from "../../../shared/slice-job.js";

export const SLICE_RUNNING_STALE_MS = 30_000;

export interface SliceJobRecord {
    id: string;
    userId: string;
    idempotencyKey: string;
    status: SliceJobStatusName;
    designId: string | null;
    stlUrl: string | null;
    stlStorageKey: string | null;
    profileId: string;
    material: string | null;
    side: "left" | "right" | null;
    process: string | null;
    error: string | null;
    gcodeStorageKey: string | null;
    productionId: string | null;
    exportId: string | null;
    tokenCost: number;
    charged: boolean;
    balanceAfter: number | null;
    fileName: string | null;
    request: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
}

export interface InsertSliceJob {
    userId: string;
    idempotencyKey: string;
    designId?: string | null;
    stlUrl?: string | null;
    stlStorageKey?: string | null;
    profileId: string;
    material?: string | null;
    side?: "left" | "right" | null;
    process?: string | null;
    fileName?: string | null;
    request?: Record<string, unknown>;
}

export interface SettleSliceResult {
    job: SliceJobRecord;
    charged: boolean;
    balance: number;
}

export interface SliceLedger {
    getBalance(userId: string): Promise<number>;
    getById(jobId: string): Promise<SliceJobRecord | null>;
    findByIdempotency(userId: string, idempotencyKey: string): Promise<SliceJobRecord | null>;
    insertQueued(input: InsertSliceJob): Promise<{ job: SliceJobRecord; created: boolean }>;
    claimRunning(jobId: string): Promise<boolean>;
    touch(jobId: string): Promise<void>;
    markFailed(jobId: string, error: string): Promise<SliceJobRecord>;
    settleSuccess(
        jobId: string,
        patch: { gcodeStorageKey: string; fileName?: string | null },
    ): Promise<SettleSliceResult>;
}

/**
 * In-memory ledger with the same charge rules as the SQL functions:
 * one row per (userId, idempotencyKey), deduct 1 only inside the success
 * transition, and a single-flight lock so concurrent success calls charge once.
 */
export class MemorySliceLedger implements SliceLedger {
    private jobs = new Map<string, SliceJobRecord>();
    private balances = new Map<string, number>();
    private tails = new Map<string, Promise<unknown>>();
    readonly charges: { userId: string; idempotencyKey: string; amount: number }[] = [];

    setBalance(userId: string, balance: number): void {
        this.balances.set(userId, balance);
    }

    /** Test hook: age a job so settle treats it as timed out. */
    rewindCreatedAt(jobId: string, createdAt: string): void {
        const job = this.jobs.get(jobId);
        if (!job) throw new Error("NOT_FOUND");
        job.createdAt = createdAt;
    }

    async getBalance(userId: string): Promise<number> {
        return this.balances.get(userId) ?? 0;
    }

    async getById(jobId: string): Promise<SliceJobRecord | null> {
        const job = this.jobs.get(jobId);
        return job ? { ...job, request: { ...job.request } } : null;
    }

    async findByIdempotency(userId: string, idempotencyKey: string): Promise<SliceJobRecord | null> {
        for (const job of this.jobs.values()) {
            if (job.userId === userId && job.idempotencyKey === idempotencyKey) {
                return { ...job, request: { ...job.request } };
            }
        }
        return null;
    }

    async insertQueued(input: InsertSliceJob): Promise<{ job: SliceJobRecord; created: boolean }> {
        const lockKey = `${input.userId}:${input.idempotencyKey}`;
        return this.withLock(lockKey, async () => {
            const existing = await this.findByIdempotency(input.userId, input.idempotencyKey);
            if (existing) return { job: existing, created: false };
            const now = new Date().toISOString();
            const job: SliceJobRecord = {
                id: randomUUID(),
                userId: input.userId,
                idempotencyKey: input.idempotencyKey,
                status: "queued",
                designId: input.designId ?? null,
                stlUrl: input.stlUrl ?? null,
                stlStorageKey: input.stlStorageKey ?? null,
                profileId: input.profileId,
                material: input.material ?? null,
                side: input.side ?? null,
                process: input.process ?? null,
                error: null,
                gcodeStorageKey: null,
                productionId: null,
                exportId: null,
                tokenCost: 0,
                charged: false,
                balanceAfter: null,
                fileName: input.fileName ?? null,
                request: input.request ?? {},
                createdAt: now,
                updatedAt: now,
            };
            this.jobs.set(job.id, job);
            return { job: { ...job, request: { ...job.request } }, created: true };
        });
    }

    async claimRunning(jobId: string): Promise<boolean> {
        return this.withLock(jobId, async () => {
            const job = this.jobs.get(jobId);
            if (!job || job.charged || job.status === "succeeded" || job.status === "failed") return false;
            const stale = Date.now() - Date.parse(job.updatedAt) > SLICE_RUNNING_STALE_MS;
            if (job.status === "queued" || (job.status === "running" && stale)) {
                job.status = "running";
                job.updatedAt = new Date().toISOString();
                return true;
            }
            return false;
        });
    }

    async touch(jobId: string): Promise<void> {
        await this.withLock(jobId, async () => {
            const job = this.jobs.get(jobId);
            if (job && job.status === "running") job.updatedAt = new Date().toISOString();
        });
    }

    async markFailed(jobId: string, error: string): Promise<SliceJobRecord> {
        return this.withLock(jobId, async () => {
            const job = this.jobs.get(jobId);
            if (!job) throw new Error("NOT_FOUND");
            if (job.status === "succeeded" || job.charged || job.status === "failed") {
                return { ...job, request: { ...job.request } };
            }
            job.status = "failed";
            job.error = error.slice(0, 500);
            job.tokenCost = 0;
            job.charged = false;
            job.updatedAt = new Date().toISOString();
            return { ...job, request: { ...job.request } };
        });
    }

    async settleSuccess(
        jobId: string,
        patch: { gcodeStorageKey: string; fileName?: string | null },
    ): Promise<SettleSliceResult> {
        return this.withLock(jobId, async () => {
            const job = this.jobs.get(jobId);
            if (!job) throw new Error("NOT_FOUND");
            const balance = this.balances.get(job.userId) ?? 0;
            if (job.charged || job.status === "succeeded") {
                return {
                    job: { ...job, request: { ...job.request } },
                    charged: false,
                    balance: job.balanceAfter ?? balance,
                };
            }
            if (job.status === "failed") {
                return { job: { ...job, request: { ...job.request } }, charged: false, balance };
            }
            const timedOut = Date.now() - Date.parse(job.createdAt) > SLICE_TIMEOUT_MS;
            if (timedOut || balance < SLICE_TOKEN_COST) {
                job.status = "failed";
                job.error = timedOut ? "timeout" : "INSUFFICIENT_TOKENS";
                job.tokenCost = 0;
                job.charged = false;
                job.updatedAt = new Date().toISOString();
                return { job: { ...job, request: { ...job.request } }, charged: false, balance };
            }
            const next = balance - SLICE_TOKEN_COST;
            this.balances.set(job.userId, next);
            job.status = "succeeded";
            job.charged = true;
            job.tokenCost = SLICE_TOKEN_COST;
            job.balanceAfter = next;
            job.gcodeStorageKey = patch.gcodeStorageKey;
            if (patch.fileName) job.fileName = patch.fileName;
            job.exportId = job.exportId ?? randomUUID();
            job.productionId = job.designId ? (job.productionId ?? randomUUID()) : null;
            job.updatedAt = new Date().toISOString();
            this.charges.push({
                userId: job.userId,
                idempotencyKey: job.idempotencyKey,
                amount: SLICE_TOKEN_COST,
            });
            return { job: { ...job, request: { ...job.request } }, charged: true, balance: next };
        });
    }

    private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const prev = this.tails.get(key) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.tails.set(
            key,
            prev.then(() => gate),
        );
        await prev;
        try {
            return await fn();
        } finally {
            release();
        }
    }
}
