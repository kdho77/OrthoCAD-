// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Two headless Export lofts at once, each on its own thread.
// The request thread only waits on the worker, so a slice poll and the
// other foot's enqueue keep running. Geometry is the in-process loft.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import type { HeadlessFinalizedFoot } from "./finalized-mesh-runner.js";

/** One pair is two feet. A third loft waits for a free thread. */
export const LOFT_WORKER_LIMIT = 2;

interface BlockMessage {
    ok: true;
    kind: "block";
    threadId: number;
    elapsedMs: number;
}

interface LoftMessage {
    ok: true;
    kind: "loft";
    side: "left" | "right";
    solidTriangles: number;
    uploadTriangles: number;
    fingerprint: string;
    stl: Uint8Array;
}

interface FailMessage {
    ok: false;
    message?: string;
    stack?: string;
    name?: string;
}

type WorkerMessage = BlockMessage | LoftMessage | FailMessage;

interface BlockJob {
    kind: "block";
    ms: number;
}

interface LoftJob {
    kind: "loft";
    runnerUrl: string;
    settingsJson: unknown;
    side: "left" | "right";
    includeLeader: boolean;
}

let active = 0;
let maxActive = 0;
const waiters: Array<() => void> = [];

export function loftWorkerPeak(): number {
    return maxActive;
}

export function resetLoftWorkerPeak(): void {
    maxActive = active;
}

function reserve(): Promise<void> {
    if (active < LOFT_WORKER_LIMIT) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        waiters.push(() => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            resolve();
        });
    });
}

function release(): void {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
}

/** Sibling of this module. Rstest may rewrite import.meta.url; the source path still exists. */
export function loftWorkerFileUrl(): URL {
    const fromMeta = new URL("./loft-off-thread.mjs", import.meta.url);
    if (fromMeta.protocol === "file:" && existsSync(fileURLToPath(fromMeta))) return fromMeta;
    // Repo-root tests, then the Vercel function root (includeFiles keeps this path).
    const candidates = [
        `${process.cwd()}/vertex/server/src/lib/loft-off-thread.mjs`,
        `${process.cwd()}/server/src/lib/loft-off-thread.mjs`,
    ];
    for (const path of candidates) {
        if (existsSync(path)) return pathToFileURL(path);
    }
    return fromMeta;
}

function runnerModuleUrl(): string {
    const name = import.meta.url.endsWith(".ts") ? "finalized-mesh-runner.ts" : "finalized-mesh-runner.js";
    return new URL(`./${name}`, import.meta.url).href;
}

function workerExecArgv(runnerUrl: string | null): string[] {
    if (!runnerUrl?.endsWith(".ts")) return [];
    return ["--experimental-strip-types"];
}

function failFromMessage(message: FailMessage): Error {
    const error = new Error(message.message || "CAD-operator loft worker failed");
    error.name = message.name || "Error";
    if (message.stack) error.stack = message.stack;
    return error;
}

function arrayBufferFrom(bytes: Uint8Array): ArrayBuffer {
    const copy = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(copy).set(bytes);
    return copy;
}

function spawn(data: BlockJob | LoftJob): Promise<WorkerMessage> {
    return new Promise((resolve, reject) => {
        const worker = new Worker(loftWorkerFileUrl(), {
            workerData: data,
            execArgv: workerExecArgv(data.kind === "loft" ? data.runnerUrl : null),
        });
        let settled = false;
        const finish = (error: Error | null, message?: WorkerMessage) => {
            if (settled) return;
            settled = true;
            void worker.terminate();
            if (error) reject(error);
            else if (message) resolve(message);
        };
        worker.once("message", (message: WorkerMessage) => {
            if (!message?.ok) {
                finish(failFromMessage(message ?? { ok: false }));
                return;
            }
            finish(null, message);
        });
        worker.once("error", (error) => {
            finish(error instanceof Error ? error : new Error(String(error)));
        });
        worker.once("exit", (code) => {
            if (!settled) finish(new Error(`CAD-operator loft worker exited ${code}`));
        });
    });
}

async function runInLoftWorker(data: BlockJob | LoftJob): Promise<WorkerMessage> {
    await reserve();
    try {
        return await spawn(data);
    } finally {
        release();
    }
}

/**
 * Block one loft thread. The request event loop stays free, so a slice poll
 * on that loop is not stretched by the other foot.
 */
export async function occupyLoftWorker(ms: number): Promise<{ threadId: number; elapsedMs: number }> {
    const message = await runInLoftWorker({ kind: "block", ms });
    if (!message.ok || message.kind !== "block") {
        throw new Error("CAD-operator loft worker did not occupy a thread");
    }
    return { threadId: message.threadId, elapsedMs: message.elapsedMs };
}

/** Same mesh as {@link buildHeadlessFinalizedFoot}, on a loft thread. */
export async function buildHeadlessFinalizedFootOffThread(input: {
    settingsJson: unknown;
    side: "left" | "right";
    includeLeader?: boolean;
}): Promise<HeadlessFinalizedFoot> {
    console.log(JSON.stringify({ msg: "cad-operator-loft-dispatch", side: input.side }));
    const message = await runInLoftWorker({
        kind: "loft",
        runnerUrl: runnerModuleUrl(),
        settingsJson: input.settingsJson,
        side: input.side,
        includeLeader: input.includeLeader !== false,
    });
    if (!message.ok || message.kind !== "loft") {
        throw new Error("CAD-operator loft worker returned no mesh");
    }
    return {
        side: message.side,
        stl: arrayBufferFrom(message.stl),
        solidTriangles: message.solidTriangles,
        uploadTriangles: message.uploadTriangles,
        fingerprint: message.fingerprint,
    };
}
