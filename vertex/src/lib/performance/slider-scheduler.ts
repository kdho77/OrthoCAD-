// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/** Slider geometry scheduling: immediate UI, throttled preview, idle full quality. */

export const PREVIEW_THROTTLE_MS = 75;
export const FULL_IDLE_MS = 200;

export interface SliderSchedulerHandlers {
    /** Run a preview-quality build (decimated mesh, skip normals). */
    onPreview: () => void;
    /** Run a full-quality build (editing mesh, normals). */
    onFull: () => void;
}

/**
 * Schedules modifier rebuilds while dragging:
 * - at most one preview every 75 ms
 * - full-quality rebuild 200 ms after the last change / on release
 * Cancels pending timers when disposed.
 *
 * Handlers are read from a mutable slot so React effects can refresh closures
 * without resetting throttle clocks.
 */
export class SliderScheduler {
    private previewTimer: ReturnType<typeof setTimeout> | null = null;
    private fullTimer: ReturnType<typeof setTimeout> | null = null;
    private disposed = false;
    private lastPreviewAt = 0;
    private handlers: SliderSchedulerHandlers;

    constructor(handlers: SliderSchedulerHandlers) {
        this.handlers = handlers;
    }

    setHandlers(handlers: SliderSchedulerHandlers): void {
        this.handlers = handlers;
    }

    /** Call on every live slider/preview value change while interacting. */
    schedulePreview(): void {
        if (this.disposed) return;
        const now = performance.now();
        const since = now - this.lastPreviewAt;
        if (since >= PREVIEW_THROTTLE_MS) {
            this.lastPreviewAt = now;
            this.handlers.onPreview();
        } else if (!this.previewTimer) {
            this.previewTimer = setTimeout(() => {
                this.previewTimer = null;
                if (this.disposed) return;
                this.lastPreviewAt = performance.now();
                this.handlers.onPreview();
            }, PREVIEW_THROTTLE_MS - since);
        }
        this.armFull();
    }

    /** Call on pointer-up / commit — cancel preview throttle and run full ASAP. */
    scheduleFullNow(): void {
        if (this.disposed) return;
        this.clearPreview();
        this.clearFull();
        this.handlers.onFull();
    }

    /** Call when values change while idle (non-drag) — debounce full quality. */
    scheduleFullIdle(): void {
        if (this.disposed) return;
        this.armFull();
    }

    dispose(): void {
        this.disposed = true;
        this.clearPreview();
        this.clearFull();
    }

    private armFull(): void {
        this.clearFull();
        this.fullTimer = setTimeout(() => {
            this.fullTimer = null;
            if (this.disposed) return;
            this.handlers.onFull();
        }, FULL_IDLE_MS);
    }

    private clearPreview(): void {
        if (this.previewTimer) {
            clearTimeout(this.previewTimer);
            this.previewTimer = null;
        }
    }

    private clearFull(): void {
        if (this.fullTimer) {
            clearTimeout(this.fullTimer);
            this.fullTimer = null;
        }
    }
}
