// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { clonePayloadForTransfer, geometryToPayload, type GeometryBufferPayload } from "@/lib/geometry/geometry-buffer";
import { closeAndSerializeExportPayload } from "@/lib/geometry/mesh-export-core";
import type { ExportRimPoint, MeshExportWorkerRequest, MeshExportWorkerResponse } from "@/workers/mesh-export.worker";

/** Worker-side export timeout — keep in sync with EXPORT_OPERATION_TIMEOUT_MS. */
const DEFAULT_EXPORT_WORKER_TIMEOUT_MS = 120_000;

let exportWorker: Worker | null = null;
let nextRequestId = 0;
let workerRunnerOverride: MeshExportWorkerRunner | null = null;

export type MeshExportWorkerRunner = (
    payload: GeometryBufferPayload,
    topVertexCount: number,
    timeoutMs?: number,
    precomputedBottomRim?: ExportRimPoint[],
) => Promise<{ stlBuffer: ArrayBuffer; bottomRimVertexCount: number; usedReducedBottom: boolean }>;

/** @internal Test hook to bypass the real Web Worker. */
export function setMeshExportWorkerRunnerForTesting(runner: MeshExportWorkerRunner | null): void {
    workerRunnerOverride = runner;
}

function getExportWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    if (!exportWorker) {
        exportWorker = new Worker(new URL("../../workers/mesh-export.worker.ts", import.meta.url), {
            type: "module",
        });
    }
    return exportWorker;
}

export function runMeshExportWorker(
    payload: GeometryBufferPayload,
    topVertexCount: number,
    timeoutMs = DEFAULT_EXPORT_WORKER_TIMEOUT_MS,
    precomputedBottomRim?: ExportRimPoint[],
): Promise<{ stlBuffer: ArrayBuffer; bottomRimVertexCount: number; usedReducedBottom: boolean }> {
    if (workerRunnerOverride) {
        return workerRunnerOverride(payload, topVertexCount, timeoutMs, precomputedBottomRim);
    }

    const worker = getExportWorker();
    if (!worker) {
        const result = closeAndSerializeExportPayload(payload, topVertexCount, { precomputedBottomRim });
        return Promise.resolve(result);
    }

    const { payload: clonedPayload, transfer } = clonePayloadForTransfer(payload);
    const id = ++nextRequestId;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Export timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        const onMessage = (event: MessageEvent<MeshExportWorkerResponse>) => {
            if (event.data.id !== id) return;
            cleanup();
            if (event.data.type === "STL_READY") {
                resolve({
                    stlBuffer: event.data.stlBuffer,
                    bottomRimVertexCount: event.data.bottomRimVertexCount,
                    usedReducedBottom: event.data.usedReducedBottom,
                });
                return;
            }
            reject(new Error(event.data.message));
        };

        const onError = (event: ErrorEvent) => {
            cleanup();
            reject(new Error(event.message));
        };

        const cleanup = () => {
            clearTimeout(timer);
            worker.removeEventListener("message", onMessage);
            worker.removeEventListener("error", onError);
        };

        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);

        const msg: MeshExportWorkerRequest = {
            type: "CLOSE_AND_SERIALIZE",
            id,
            payload: clonedPayload,
            topVertexCount,
            precomputedBottomRim,
        };
        worker.postMessage(msg, transfer);
    });
}

export function geometryToExportPayload(geometry: BufferGeometry): {
    payload: GeometryBufferPayload;
    topVertexCount: number;
} {
    const userData = geometry.userData as { topVertexCount?: number };
    const total = geometry.getAttribute("position").count;
    const topVertexCount =
        userData.topVertexCount && userData.topVertexCount > 0 && userData.topVertexCount < total
            ? userData.topVertexCount
            : total;
    return {
        payload: geometryToPayload(geometry),
        topVertexCount,
    };
}
