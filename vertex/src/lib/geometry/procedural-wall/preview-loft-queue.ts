// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Side } from "@/types";

/**
 * Serial preview-loft queue.
 *
 * Reconstruct runs in a Web Worker, but left and right still share one worker
 * and one queue. Jobs run one at a time, active foot first, with a paint yield
 * between them so the splash can update.
 *
 * Lower-resolution preview rows (widening OUTLINE_STATION_SPACING_MM) would
 * change the approved wall station set and need CAD expert sign-off. This
 * queue does not change reconstruct math.
 */

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
let running: QueuedLoft | null = null;
let pumping = false;

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
    void pumpPreviewLoftQueue();
    return {
        id: queued.id,
        cancel: () => {
            queued.cancelled = true;
            const i = pending.indexOf(queued);
            if (i >= 0) pending.splice(i, 1);
        },
    };
}

async function pumpPreviewLoftQueue(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
        while (true) {
            const next = pending.shift();
            if (!next) return;
            if (next.cancelled) continue;
            running = next;
            try {
                await next.run();
            } finally {
                running = null;
            }
            await yieldToPaint();
        }
    } finally {
        pumping = false;
        if (pending.length > 0) void pumpPreviewLoftQueue();
    }
}

/** Cancel queued jobs and mark the running job so Cancel aborts generate. */
export function cancelAllPreviewLofts(): void {
    for (const job of pending) job.cancelled = true;
    pending.length = 0;
    if (running) running.cancelled = true;
}

export function resetPreviewLoftQueueForTests(): void {
    pending.length = 0;
    running = null;
    pumping = false;
    seq = 0;
}

export function previewLoftQueueSnapshotForTests(): { pending: Side[]; running: Side | null } {
    return {
        pending: pending.filter((j) => !j.cancelled).map((j) => j.side),
        running: running?.side ?? null,
    };
}
