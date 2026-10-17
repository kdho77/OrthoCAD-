// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { geometryToPayload, payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import { afoMeshToGeometry, geometryToAfoMesh } from "./mesh-ops";
import { offsetMesh } from "./sdf-offset";
import { buildAfoShell } from "./shell";
import type { AfoOffsetOptions, AfoShellOptions, AfoTriMesh } from "./types";

export type AfoWorkerProgress = { pct: number; stage: string };

/**
 * Run SDF offset / shell either on a dedicated worker (when available) or
 * synchronously on the calling thread (tests, worker-unavailable fallback).
 */
export async function runAfoOffset(mesh: AfoTriMesh, options: AfoOffsetOptions): Promise<AfoTriMesh> {
    const worker = tryWorker();
    if (!worker) return offsetMesh(mesh, options);
    try {
        return await workerRequest(worker, { type: "afoOffset", mesh, options }, options.onProgress);
    } catch {
        return offsetMesh(mesh, options);
    }
}

export async function runAfoShell(
    mesh: AfoTriMesh,
    trimVertexIndices: number[],
    options: AfoShellOptions,
): Promise<AfoTriMesh> {
    const worker = tryWorker();
    if (!worker) return buildAfoShell(mesh, trimVertexIndices, options);
    try {
        return await workerRequest(
            worker,
            { type: "afoShell", mesh, trimVertexIndices, options },
            options.onProgress,
        );
    } catch {
        return buildAfoShell(mesh, trimVertexIndices, options);
    }
}

function tryWorker(): Worker | null {
    if (typeof Worker === "undefined") return null;
    try {
        return new Worker(new URL("../../../workers/geometry.worker.ts", import.meta.url), {
            type: "module",
        });
    } catch {
        return null;
    }
}

function workerRequest(
    worker: Worker,
    body: Record<string, unknown>,
    onProgress?: (pct: number, stage: string) => void,
): Promise<AfoTriMesh> {
    return new Promise((resolve, reject) => {
        const id = Math.floor(Math.random() * 1e9);
        const onMsg = (ev: MessageEvent) => {
            const msg = ev.data;
            if (msg?.id !== id) return;
            if (msg.type === "progress") {
                onProgress?.(msg.pct ?? 0, msg.stage ?? "");
                return;
            }
            worker.removeEventListener("message", onMsg);
            worker.terminate();
            if (msg.type === "error") {
                reject(new Error(msg.message ?? "AFO worker failed"));
                return;
            }
            if (msg.type === "geometry") {
                resolve(geometryToAfoMesh(payloadToGeometry(msg.payload)));
                return;
            }
            reject(new Error("Unexpected AFO worker response"));
        };
        worker.addEventListener("message", onMsg);
        const geom = afoMeshToGeometry(body.mesh as AfoTriMesh);
        const payload = geometryToPayload(geom);
        geom.dispose();
        const transfer: Transferable[] = [payload.positions.buffer as ArrayBuffer];
        if (payload.indices) transfer.push(payload.indices.buffer as ArrayBuffer);
        const { mesh: _omitMesh, options, ...rest } = body;
        const rawOptions = (options ?? {}) as Record<string, unknown>;
        const safeOptions: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawOptions)) {
            if (typeof v !== "function") safeOptions[k] = v;
        }
        try {
            worker.postMessage({ id, ...rest, options: safeOptions, mesh: payload }, transfer);
        } catch (err) {
            worker.removeEventListener("message", onMsg);
            worker.terminate();
            reject(err instanceof Error ? err : new Error("AFO worker postMessage failed"));
        }
    });
}
