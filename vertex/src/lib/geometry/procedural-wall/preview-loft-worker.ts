// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import { type geometryToPayload, payloadToGeometry } from "@/lib/geometry/geometry-buffer";
import type { PolyPoint } from "./curves";
import { type ProceduralPreviewOptions, reconstructProceduralPreview } from "./sample-top-preview";

export interface ProceduralWallWorkerRequest {
    id: number;
    type: "reconstruct";
    positions: Float32Array;
    indices: Uint32Array | null;
    options: ProceduralPreviewOptions;
}

export interface ProceduralWallWorkerResponse {
    id: number;
    type: "geometry" | "error";
    payload?: ReturnType<typeof geometryToPayload>;
    pattern?: PolyPoint[];
    userData?: Record<string, unknown>;
    message?: string;
}

interface Pending {
    resolve: (value: { geometry: BufferGeometry; pattern: PolyPoint[] }) => void;
    reject: (err: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function geometryCopy(geo: BufferGeometry): {
    positions: Float32Array;
    indices: Uint32Array | null;
} {
    const pos = geo.getAttribute("position");
    if (!pos) throw new Error("procedural wall worker: top mesh has no positions");
    const positions = new Float32Array(pos.array as ArrayLike<number>);
    const index = geo.getIndex();
    const indices = index ? new Uint32Array(index.array as ArrayLike<number>) : null;
    return { positions, indices };
}

function ensureWorker(): Worker | null {
    if (worker) return worker;
    if (typeof Worker === "undefined") return null;
    try {
        worker = new Worker(new URL("../../../workers/procedural-wall.worker.ts", import.meta.url), {
            type: "module",
        });
        worker.onmessage = (event: MessageEvent<ProceduralWallWorkerResponse>) => {
            const msg = event.data;
            const req = pending.get(msg.id);
            if (!req) return;
            pending.delete(msg.id);
            if (msg.type === "error" || !msg.payload) {
                req.reject(new Error(msg.message ?? "Procedural wall worker failed"));
                return;
            }
            const geometry = payloadToGeometry(msg.payload);
            if (msg.userData) geometry.userData = { ...geometry.userData, ...msg.userData };
            req.resolve({ geometry, pattern: msg.pattern ?? [] });
        };
        worker.onerror = (ev) => {
            const err = new Error(ev.message || "Procedural wall worker crashed");
            for (const req of pending.values()) req.reject(err);
            pending.clear();
            worker?.terminate();
            worker = null;
        };
        return worker;
    } catch {
        return null;
    }
}

/** Kill an in-flight reconstruct so Cancel does not leave a running worker. */
export function terminateProceduralWallWorker(): void {
    const err = new Error("Print solid cancelled");
    for (const req of pending.values()) req.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
}

/**
 * Loft SAMPLE_Top + the live bottom pattern off the main thread.
 * Falls back to a synchronous reconstruct when Workers are unavailable (tests).
 */
export async function reconstructProceduralPreviewInWorker(
    topGeo: BufferGeometry,
    options: ProceduralPreviewOptions = {},
): Promise<{ geometry: BufferGeometry; pattern: PolyPoint[] }> {
    const sync = () => {
        const preview = reconstructProceduralPreview(topGeo, options);
        return { geometry: preview.geometry, pattern: preview.pattern };
    };
    const w = ensureWorker();
    if (!w) return sync();
    const id = ++nextId;
    const copy = geometryCopy(topGeo);
    try {
        return await new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            const transfer: Transferable[] = [copy.positions.buffer];
            if (copy.indices) transfer.push(copy.indices.buffer);
            const msg: ProceduralWallWorkerRequest = {
                id,
                type: "reconstruct",
                positions: copy.positions,
                indices: copy.indices,
                options: {
                    ...options,
                    bottomPattern: options.bottomPattern?.map((p) => ({
                        x: p.x,
                        y: p.y,
                        z: p.z ?? 0,
                    })),
                },
            };
            w.postMessage(msg, transfer);
        });
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (/cancelled/i.test(message)) throw e;
        console.warn("[preview-loft-worker] falling back to main thread:", message);
        return sync();
    }
}
