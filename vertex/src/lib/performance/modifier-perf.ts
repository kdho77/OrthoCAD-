// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Lightweight instrumentation for base-modifier slider performance.
 * Safe no-op in production consumers — values are readable for tests / console.
 */

export interface ModifierPerfSnapshot {
    workerMs: number;
    transferMs: number;
    mainThreadBlockMs: number;
    previewTriangleCount: number;
    fullTriangleCount: number;
    r3fCommits: number;
    meshMountCount: number;
    staleDiscarded: number;
    applyCount: number;
    lastHeapMB: number | null;
}

class ModifierPerfTracker {
    workerMs = 0;
    transferMs = 0;
    mainThreadBlockMs = 0;
    previewTriangleCount = 0;
    fullTriangleCount = 0;
    r3fCommits = 0;
    meshMountCount = 0;
    staleDiscarded = 0;
    applyCount = 0;
    lastHeapMB: number | null = null;

    recordWorker(ms: number): void {
        this.workerMs = ms;
        this.applyCount++;
    }

    recordTransfer(ms: number): void {
        this.transferMs = ms;
    }

    recordMainThread(ms: number): void {
        this.mainThreadBlockMs = ms;
    }

    recordTriangles(preview: number, full: number): void {
        this.previewTriangleCount = preview;
        this.fullTriangleCount = full;
    }

    recordR3fCommit(): void {
        this.r3fCommits++;
    }

    recordMeshMount(): void {
        this.meshMountCount++;
    }

    recordStale(): void {
        this.staleDiscarded++;
    }

    sampleHeap(): void {
        const perf = performance as Performance & { memory?: { usedJSHeapSize: number } };
        if (perf.memory) this.lastHeapMB = Math.round((perf.memory.usedJSHeapSize / 1e6) * 10) / 10;
    }

    snapshot(): ModifierPerfSnapshot {
        return {
            workerMs: this.workerMs,
            transferMs: this.transferMs,
            mainThreadBlockMs: this.mainThreadBlockMs,
            previewTriangleCount: this.previewTriangleCount,
            fullTriangleCount: this.fullTriangleCount,
            r3fCommits: this.r3fCommits,
            meshMountCount: this.meshMountCount,
            staleDiscarded: this.staleDiscarded,
            applyCount: this.applyCount,
            lastHeapMB: this.lastHeapMB,
        };
    }

    reset(): void {
        this.workerMs = 0;
        this.transferMs = 0;
        this.mainThreadBlockMs = 0;
        this.previewTriangleCount = 0;
        this.fullTriangleCount = 0;
        this.r3fCommits = 0;
        this.meshMountCount = 0;
        this.staleDiscarded = 0;
        this.applyCount = 0;
        this.lastHeapMB = null;
    }
}

export const modifierPerf = new ModifierPerfTracker();

/** Expose on window for Chrome profiling sessions. */
export function installModifierPerfGlobal(): void {
    if (typeof window === "undefined") return;
    (window as unknown as { __MODIFIER_PERF__?: ModifierPerfTracker }).__MODIFIER_PERF__ = modifierPerf;
}
