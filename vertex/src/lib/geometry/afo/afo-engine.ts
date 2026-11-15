// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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

/** Drop callbacks before postMessage. Progress comes back as `{ type: "progress" }` messages. */
export function cloneableWorkerOptions(options: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(options)) {
        if (typeof value === "function") continue;
        if (Array.isArray(value)) {
            out[key] = value.map((item) =>
                item && typeof item === "object" && !ArrayBuffer.isView(item)
                    ? cloneableWorkerOptions(item as Record<string, unknown>)
                    : item,
            );
            continue;
        }
        if (value && typeof value === "object" && !ArrayBuffer.isView(value)) {
            out[key] = cloneableWorkerOptions(value as Record<string, unknown>);
            continue;
        }
        out[key] = value;
    }
    return out;
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
                const mesh = geometryToAfoMesh(payloadToGeometry(msg.payload));
                if (typeof msg.rimFaceStart === "number") mesh.rimFaceStart = msg.rimFaceStart;
                if (typeof msg.outerVertex0 === "number") mesh.outerVertex0 = msg.outerVertex0;
                resolve(mesh);
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
        const safeOptions = cloneableWorkerOptions((options ?? {}) as Record<string, unknown>);
        try {
            worker.postMessage({ id, ...rest, options: safeOptions, mesh: payload }, transfer);
        } catch (err) {
            worker.removeEventListener("message", onMsg);
            worker.terminate();
            reject(err instanceof Error ? err : new Error("AFO worker postMessage failed"));
        }
    });
}
