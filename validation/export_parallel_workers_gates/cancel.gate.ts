// Frozen before grading candidate f059edf74b9bed33071a4deb8ad3c9674d289dfd.
// Abort and unmount must terminate in-flight workers. The probe never lofts.

import { writeFileSync } from "node:fs";
import { test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { buildExportStl } from "@/lib/geometry/export-geometry";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    buildProceduralViewerPatternInWorker,
    terminateProceduralWallWorker,
} from "@/lib/geometry/procedural-wall/preview-loft-worker";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";

const tracePath = process.env.GATE_TRACE ?? "";

interface Hung {
    terminated: boolean;
}

class HungWorker {
    static all: HungWorker[] = [];
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message?: string }) => void) | null = null;
    terminated = false;
    constructor(url: unknown, options?: unknown) {
        void url;
        void options;
        HungWorker.all.push(this);
    }
    postMessage(_msg: unknown): void {
        void _msg;
    }
    terminate(): void {
        this.terminated = true;
    }
}

function snapshot(trace: unknown): void {
    if (!tracePath) return;
    writeFileSync(tracePath, JSON.stringify(trace));
}

function tinyTop(): BufferGeometry {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 30, 0, 1, 10, 12, 2]), 3));
    return geo;
}

function createdSince(start: number): Hung[] {
    return HungWorker.all.slice(start);
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function cancelled(pending: Promise<unknown>): Promise<boolean> {
    try {
        await Promise.race([
            pending.then(
                () => {
                    throw new Error("resolved");
                },
                (error: unknown) => {
                    throw error;
                },
            ),
            delay(2000).then(() => {
                throw new Error("timeout");
            }),
        ]);
        return false;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return /cancelled/i.test(message);
    }
}

test("abort and unmount terminate workers", async () => {
    const trace: {
        phase: string;
        preview: { constructed: number; terminated: boolean; rejectedCancelled: boolean };
        exportAbortStarted: boolean;
        exportAbort?: { constructed: number; terminated: boolean; rejectedCancelled: boolean };
        exportUnmountStarted: boolean;
        exportUnmount?: { constructed: number; terminated: boolean; rejectedCancelled: boolean };
    } = {
        phase: "init",
        preview: { constructed: 0, terminated: false, rejectedCancelled: false },
        exportAbortStarted: false,
        exportUnmountStarted: false,
    };
    (globalThis as { Worker?: unknown }).Worker = HungWorker;
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

    const beforePreview = HungWorker.all.length;
    const preview = buildProceduralViewerPatternInWorker(tinyTop(), "full_contact");
    await delay(40);
    const previewWorkers = createdSince(beforePreview);
    terminateProceduralWallWorker();
    trace.preview = {
        constructed: previewWorkers.length,
        terminated: previewWorkers.length > 0 && previewWorkers.every((worker) => worker.terminated),
        rejectedCancelled: await cancelled(preview),
    };
    trace.phase = "preview-done";
    snapshot(trace);

    const beforeAbort = HungWorker.all.length;
    trace.exportAbortStarted = true;
    snapshot(trace);
    let abort = false;
    const aborting = buildExportStl("left", { exportMode: "manufacturing", shouldAbort: () => abort });
    await delay(120);
    const abortWorkers = createdSince(beforeAbort);
    abort = true;
    trace.exportAbort = {
        constructed: abortWorkers.length,
        terminated: abortWorkers.length > 0 && abortWorkers.every((worker) => worker.terminated),
        rejectedCancelled: await cancelled(aborting),
    };
    trace.phase = "abort-done";
    snapshot(trace);

    const beforeUnmount = HungWorker.all.length;
    trace.exportUnmountStarted = true;
    snapshot(trace);
    const unmount = buildExportStl("right", { exportMode: "manufacturing" });
    await delay(120);
    const unmountWorkers = createdSince(beforeUnmount);
    terminateProceduralWallWorker();
    trace.exportUnmount = {
        constructed: unmountWorkers.length,
        terminated: unmountWorkers.length > 0 && unmountWorkers.every((worker) => worker.terminated),
        rejectedCancelled: await cancelled(unmount),
    };
    trace.phase = "done";
    snapshot(trace);
});
