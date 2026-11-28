// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.
// Observes a 2-foot cold export. A probe Worker records overlap and does not loft.

import { writeFileSync } from "node:fs";
import { test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { buildOrderPairGeometry } from "@/lib/geometry/export-geometry";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";

const tracePath = process.env.GATE_TRACE ?? "";

interface TraceEvent {
    kind: string;
    workerId?: number;
    side?: string;
    type?: string;
}

interface Trace {
    phase: string;
    peakBusyWorkers: number;
    eventLoopTurnedWhileBothBusy: boolean;
    events: TraceEvent[];
    error: string | null;
}

const trace: Trace = {
    phase: "init",
    peakBusyWorkers: 0,
    eventLoopTurnedWhileBothBusy: false,
    events: [],
    error: null,
};

const inflight = new Map<number, number>();

function busyWorkers(): number {
    let count = 0;
    for (const value of inflight.values()) if (value > 0) count += 1;
    return count;
}

function snapshot(): void {
    if (!tracePath) return;
    writeFileSync(tracePath, JSON.stringify(trace));
}

function sideOf(msg: { options?: { side?: string } }): string {
    return msg.options?.side === "left" || msg.options?.side === "right" ? msg.options.side : "";
}

function isSolidBuild(msg: {
    type?: string;
    options?: { side?: string; thicknessMm?: number; footprintScale?: number };
}): boolean {
    if (!msg || msg.type === "buildPattern" || msg.type === "reconstruct") return false;
    if (sideOf(msg) === "") return false;
    return (
        msg.type === "exportSolid" || msg.options?.thicknessMm != null || msg.options?.footprintScale != null
    );
}

function tinyTop(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 30, 0, 1, 10, 12, 2]), 3));
    return geo;
}

test("cold pair dispatches left and right together", async () => {
    let nextId = 0;
    class ProbeWorker {
        onmessage: ((event: { data: unknown }) => void) | null = null;
        onerror: ((event: { message?: string }) => void) | null = null;
        terminated = false;
        readonly id: number;
        constructor(url: unknown, options?: unknown) {
            void url;
            void options;
            this.id = ++nextId;
            trace.events.push({ kind: "construct", workerId: this.id });
            snapshot();
        }
        postMessage(msg: {
            id?: number;
            type?: string;
            options?: { side?: string; thicknessMm?: number; footprintScale?: number };
        }): void {
            if (!isSolidBuild(msg)) {
                trace.events.push({ kind: "other", workerId: this.id, type: msg?.type, side: sideOf(msg) });
                snapshot();
                return;
            }
            inflight.set(this.id, (inflight.get(this.id) ?? 0) + 1);
            trace.peakBusyWorkers = Math.max(trace.peakBusyWorkers, busyWorkers());
            trace.events.push({ kind: "solid-post", workerId: this.id, side: sideOf(msg), type: msg.type });
            if (busyWorkers() >= 2) {
                setTimeout(() => {
                    if (busyWorkers() >= 2) trace.eventLoopTurnedWhileBothBusy = true;
                    snapshot();
                }, 0);
            }
            snapshot();
            setTimeout(() => {
                inflight.set(this.id, Math.max(0, (inflight.get(this.id) ?? 1) - 1));
                if (this.terminated) return;
                this.onmessage?.({
                    data: { id: msg.id, type: "error", message: "Print solid cancelled" },
                });
            }, 100);
        }
        terminate(): void {
            this.terminated = true;
        }
    }

    (globalThis as { Worker?: unknown }).Worker = ProbeWorker;
    resetSampleTopGeometryCache();
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
    primeSampleTopGeometry(tinyTop());
    const design = createDesignWithStockPlaceholder();
    useDesignStore.setState({
        design: { ...design, method: "printing_solid" },
        viewer: { wallModel: "procedural", wallStyle: "round", deviceType: "functional" },
        stockBaseLoading: false,
        stockBaseResolutionState: "resolved",
    });
    trace.phase = "before-call";
    snapshot();
    try {
        const pending = buildOrderPairGeometry();
        await Promise.race([
            pending.then(
                (geometry) => {
                    geometry.dispose();
                    return "done";
                },
                (error: unknown) => {
                    trace.error = error instanceof Error ? error.message : String(error);
                    return "rejected";
                },
            ),
            new Promise((resolve) => setTimeout(() => resolve("timeout"), 5000)),
        ]);
    } catch (error) {
        trace.error = error instanceof Error ? error.message : String(error);
    }
    trace.phase = "done";
    snapshot();
});
