// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// One CAD-operator loft, off the Vercel request event loop.
// A pair generate used to run both feet on that loop. The left foot's sync
// loft then held the right foot pending until the left posted its slice, and
// the right loft stalled the left slice poll for the same stretch.
// This file is plain JS so Node can start it without a bundler. The loft
// function is the in-process Export path; only the thread changes.

import { isMainThread, parentPort, threadId, workerData } from "node:worker_threads";

if (!isMainThread) {
    await runJob(workerData);
}

async function runJob(data) {
    if (!parentPort) return;
    try {
        if (!data || data.kind === "block") {
            const ms = Math.max(0, Number(data?.ms) || 0);
            const started = performance.now();
            if (ms > 0) {
                const sab = new SharedArrayBuffer(4);
                Atomics.wait(new Int32Array(sab), 0, 0, ms);
            }
            parentPort.postMessage({
                ok: true,
                kind: "block",
                threadId,
                elapsedMs: performance.now() - started,
            });
            return;
        }
        if (data.kind !== "loft") {
            throw new Error("CAD-operator loft worker received an unknown job");
        }
        console.log(JSON.stringify({ msg: "cad-operator-loft-start", side: data.side, threadId }));
        const runner = await import(data.runnerUrl);
        const foot = await runner.buildHeadlessFinalizedFoot({
            settingsJson: data.settingsJson,
            side: data.side,
            includeLeader: data.includeLeader !== false,
        });
        const stl = Buffer.from(foot.stl);
        parentPort.postMessage({
            ok: true,
            kind: "loft",
            side: foot.side,
            solidTriangles: foot.solidTriangles,
            uploadTriangles: foot.uploadTriangles,
            fingerprint: foot.fingerprint,
            stl,
        });
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        parentPort.postMessage({
            ok: false,
            message: err.message,
            stack: err.stack,
            name: err.name || "Error",
        });
    }
}
