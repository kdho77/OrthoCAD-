import { buffersToGeometry } from "@/lib/geometry/geometry-buffers";
import type { SolidValidation } from "@/lib/geometry/repair";
import type { InsoleParams } from "@/lib/geometry/insole";
import type { BuildQuality, WorkerBuildRequest, WorkerBuildResponse } from "@/lib/geometry/geometry.worker";
import type { BufferGeometry } from "three";
import { getKernel } from "@/lib/chili3d";

export interface GeometryBuildResult {
    geometry: BufferGeometry;
    manifold?: SolidValidation;
}

let worker: Worker | null = null;
let nextId = 0;
let latestGeneration = 0;

const pending = new Map<
    number,
    {
        resolve: (value: GeometryBuildResult) => void;
        reject: (reason: Error) => void;
        generation: number;
    }
>();

function getWorker(): Worker {
    if (!worker) {
        worker = new Worker(new URL("./geometry.worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<WorkerBuildResponse>) => {
            const { id, buffers, manifold, error } = event.data;
            const entry = pending.get(id);
            if (!entry) return;
            pending.delete(id);

            if (entry.generation !== latestGeneration) {
                entry.reject(new Error("superseded"));
                return;
            }

            if (error || !buffers) {
                entry.reject(new Error(error ?? "Geometry build failed"));
                return;
            }

            entry.resolve({
                geometry: buffersToGeometry(buffers),
                manifold: manifold as SolidValidation | undefined,
            });
        };
        worker.onerror = (event) => {
            for (const [id, entry] of pending) {
                entry.reject(new Error(event.message));
                pending.delete(id);
            }
        };
    }
    return worker;
}

export interface PoolBuildOptions {
    params: InsoleParams;
    quality: BuildQuality;
    withManifold?: boolean;
    generation?: number;
}

/**
 * Builds insole geometry off the main thread. Supersedes in-flight requests when
 * `generation` changes (call `bumpGeometryGeneration()` on each new edit burst).
 */
export function buildInsoleAsync(options: PoolBuildOptions): Promise<GeometryBuildResult> {
    const id = ++nextId;
    const generation = options.generation ?? latestGeneration;
    const occtAvailable = getKernel().name === "opencascade-wasm";

    const message: WorkerBuildRequest = {
        id,
        type: "build",
        params: options.params,
        quality: options.quality,
        withManifold: options.withManifold ?? false,
        occtAvailable,
    };

    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, generation });
        getWorker().postMessage(message);
    });
}

/** Invalidate older in-flight worker builds after a new edit. */
export function bumpGeometryGeneration(): number {
    latestGeneration += 1;
    return latestGeneration;
}

export function getGeometryGeneration(): number {
    return latestGeneration;
}

export function terminateGeometryWorker(): void {
    worker?.terminate();
    worker = null;
    pending.clear();
}
