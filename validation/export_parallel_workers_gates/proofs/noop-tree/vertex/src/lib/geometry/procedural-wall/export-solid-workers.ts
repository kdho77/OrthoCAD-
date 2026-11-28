import { reconstructProceduralPreview } from "./sample-top-preview";

const poolSize = 2;
let pool: unknown[] | null = null;

function ensurePool() {
    if (pool) return pool;
    pool = [];
    for (let i = 0; i < poolSize; i++) {
        pool.push(
            new Worker(new URL("../../../workers/export-solid.worker.ts", import.meta.url), {
                type: "module",
            }),
        );
    }
    return pool;
}

export function terminateExportWorkers() {
    if (!pool) return;
    for (const worker of pool) (worker as { terminate: () => void }).terminate();
    pool = null;
}

export function bindExportWorkerAbort(signal: AbortSignal) {
    signal.addEventListener("abort", () => terminateExportWorkers());
}

export async function buildFootSolidInWorker(side: string) {
    if (typeof Worker === "undefined") {
        return reconstructProceduralPreview(null, { side });
    }
    return ensurePool()[side === "left" ? 0 : 1];
}
