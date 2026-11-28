// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { Side } from "@/types";

/**
 * Preview-loft queue.
 *
 * Left and right each take a worker and run together. A third job waits.
 * Priority still orders who starts when a slot is free. A paint yield between
 * a finish and the next start lets the splash update.
 *
 * Lower-resolution preview rows (widening OUTLINE_STATION_SPACING_MM) would
 * change the approved wall station set and need CAD expert sign-off. This
 * queue does not change reconstruct math.
 */

/** Two feet, two workers. Station spacing stays 1.5 mm. */
export const PREVIEW_LOFT_PARALLELISM = 2;

export interface PreviewLoftJob {
    side: Side;
    priority: number;
    run: () => void | Promise<void>;
}

interface QueuedLoft extends PreviewLoftJob {
    id: string;
    cancelled: boolean;
}

let seq = 0;
const pending: QueuedLoft[] = [];
const runningJobs: QueuedLoft[] = [];
let runningCount = 0;

export function isCoarsePointerDevice(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
}

/** Lower number runs first. Mirror waits behind the active foot; farther back on phones. */
export function previewLoftPriority(side: Side, activeSide: Side, coarse: boolean): number {
    if (side === activeSide) return 0;
    return coarse ? 10 : 1;
}

/** Yield the main thread so Chrome does not see one multi-second task. */
export async function yieldToMain(): Promise<void> {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (typeof scheduler?.yield === "function") {
        await scheduler.yield();
        return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export async function yieldToPaint(): Promise<void> {
    await yieldToMain();
    if (typeof requestAnimationFrame !== "function") return;
    await new Promise<void>((resolve) => {
        const fallback = setTimeout(resolve, 16);
        requestAnimationFrame(() => {
            clearTimeout(fallback);
            resolve();
        });
    });
}

export function enqueuePreviewLoft(job: PreviewLoftJob): { id: string; cancel: () => void } {
    const queued: QueuedLoft = { ...job, id: `loft-${++seq}`, cancelled: false };
    pending.push(queued);
    pending.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
    fillPreviewLoftSlots();
    return {
        id: queued.id,
        cancel: () => {
            queued.cancelled = true;
            const i = pending.indexOf(queued);
            if (i >= 0) pending.splice(i, 1);
        },
    };
}

function launchPreviewLoft(job: QueuedLoft): void {
    runningCount += 1;
    runningJobs.push(job);
    void (async () => {
        try {
            if (!job.cancelled) await job.run();
        } finally {
            const index = runningJobs.indexOf(job);
            if (index >= 0) runningJobs.splice(index, 1);
            runningCount -= 1;
            await yieldToPaint();
            fillPreviewLoftSlots();
        }
    })();
}

function fillPreviewLoftSlots(): void {
    while (runningCount < PREVIEW_LOFT_PARALLELISM) {
        const next = pending.shift();
        if (!next) return;
        if (next.cancelled) continue;
        launchPreviewLoft(next);
    }
}

/** Cancel queued jobs and mark every running job so Cancel aborts generate. */
export function cancelAllPreviewLofts(): void {
    for (const job of pending) job.cancelled = true;
    pending.length = 0;
    for (const job of runningJobs) job.cancelled = true;
}

export function resetPreviewLoftQueueForTests(): void {
    pending.length = 0;
    runningJobs.length = 0;
    runningCount = 0;
    seq = 0;
}

export function previewLoftQueueSnapshotForTests(): { pending: Side[]; running: Side[] } {
    return {
        pending: pending.filter((j) => !j.cancelled).map((j) => j.side),
        running: runningJobs.filter((j) => !j.cancelled).map((j) => j.side),
    };
}
