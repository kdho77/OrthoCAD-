let worker: { postMessage: (msg: unknown) => void } | null = null;

function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(new URL("../../../workers/export-solid.worker.ts", import.meta.url));
    return worker;
}

export async function buildFootSolidInWorker(side: string) {
    const active = ensureWorker();
    active.postMessage({ side });
    return active;
}
