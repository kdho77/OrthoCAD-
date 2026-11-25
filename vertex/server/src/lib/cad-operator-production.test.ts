import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, test } from "@rstest/core";

import { HARDNESS_TO_INFILL_PCT } from "../../../shared/print-recipe/hardness-to-infill-pct.js";
import type { PrintRecipeV1 } from "../../../shared/print-recipe/print-recipe.js";
import {
    assetLoadCauseForLog,
    beginCadOperatorProduction,
    CAD_PRODUCTION_LEASE_MS,
    CAD_PRODUCTION_MAX_DURATION_SEC,
    CAD_VERTEX_SLICE_MAX_TIMEOUT_SEC,
    CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC,
    type CadProductionInsert,
    cadOperatorManufacturingIdentity,
    cadVertexSliceSliceTimeoutMs,
    claimProduction,
    executeCadOperatorProduction,
    expireStaleProduction,
    infillPctForCadSlice,
    MemoryCadProductionStore,
    publicProductionError,
    readSliceCheckpoint,
    runCadSliceAttempt,
    SLICE_JOB_POLL_BUDGET_MS,
    SLICE_JOB_QUEUE_WAIT_CAP_MS,
    SLICE_JOB_SLICE_CAP_MS,
    toPublicProduction,
} from "./cad-operator-production.js";
import { PrismaCadProductionStore } from "./cad-operator-production-prisma.js";
import { passingBeltGcode } from "./gcode-handedness-sample.js";
import { sliceWithVertexSlice } from "./vertexslice-client.js";

function handednessFixture(name: string): string {
    return gunzipSync(
        readFileSync(resolve(__dirname, "../../../../tests/fixtures/handedness", `${name}.gcode.gz`)),
    ).toString("utf8");
}

const recipe: PrintRecipeV1 = {
    version: 1,
    pattern: "gyroid",
    profileId: "apex-v2-insole-95a",
    defaultHardness: "Hard",
    zones: [],
};

function triangleStl(verts: number[]): Uint8Array {
    const buf = Buffer.alloc(84 + 50);
    buf.writeUInt32LE(1, 80);
    for (let i = 0; i < 9; i++) buf.writeFloatLE(verts[i] ?? 0, 84 + 12 + i * 4);
    return new Uint8Array(buf);
}

async function expectHungSliceFails(mode: "never" | "slow"): Promise<void> {
    const happy = (globalThis as { happyDOM?: { settings: { fetch: { disableSameOriginPolicy: boolean } } } })
        .happyDOM;
    const previousCors = happy?.settings.fetch.disableSameOriginPolicy;
    if (happy) happy.settings.fetch.disableSameOriginPolicy = true;
    let slowTimer: ReturnType<typeof setInterval> | undefined;
    const server: Server = createServer((req, res) => {
        const url = req.url ?? "";
        if (url.startsWith("/v1/materials")) {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(["apex_core"]));
            return;
        }
        if (!url.startsWith("/v1/slice")) {
            res.statusCode = 404;
            res.end();
            return;
        }
        if (mode === "slow") {
            req.pause();
            slowTimer = setInterval(() => {
                if (req.destroyed || req.readableEnded) return;
                req.read(1);
            }, 200);
            req.on("close", () => {
                if (slowTimer) clearInterval(slowTimer);
            });
            return;
        }
        req.resume();
    });
    await new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    process.env.VERTEXSLICE_SLICER_URL = `http://127.0.0.1:${port}`;
    process.env.VERTEXSLICE_API_KEY = "super-secret-key";
    const timeoutMs = 350;
    try {
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("left", `hang-${mode}`), new Date());
        const invocationStart = new Date();
        const sliceAt = new Date(
            invocationStart.getTime() +
                (CAD_PRODUCTION_MAX_DURATION_SEC - CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC) * 1000 -
                timeoutMs,
        );
        let nowCalls = 0;
        const startedAt = Date.now();
        const done = executeCadOperatorProduction({
            row: claimed.row,
            store,
            now: () => {
                nowCalls += 1;
                return nowCalls === 1 ? invocationStart : sliceAt;
            },
            materialize: async () => ({ stlStorageKey: "tmp/left.stl", meshFingerprint: null }),
            slice: async (_stlStorageKey, sliceCtx) => {
                await sliceWithVertexSlice({
                    profileId: "apex-v2-insole-95a",
                    material: "apex_core",
                    model: triangleStl([0, 0, 0, 120, 0, 0, 0, 40, 8]),
                    filename: "left.stl",
                    infillDensityPct: 26,
                    sliceTimeoutMs: sliceCtx?.sliceTimeoutMs,
                    side: "left",
                });
                return { gcode: "G1\n", jobId: "job" };
            },
            uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
            charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
        });
        const status = await Promise.race([
            done.then(() => "done" as const),
            new Promise<"hung">((resolve) => {
                setTimeout(() => resolve("hung"), 2_500);
            }),
        ]);
        expect(status).toBe("done");
        expect(Date.now() - startedAt).toBeLessThan(timeoutMs + 1_500);
        const row = await store.findById(claimed.row.id);
        const expectedMs = cadVertexSliceSliceTimeoutMs(invocationStart, sliceAt);
        const expectedSec = Math.max(1, Math.ceil(expectedMs / 1000));
        expect(expectedMs).toBe(timeoutMs);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe(`VertexSlice timed out after ${expectedSec}s (left)`);
        expect(publicProductionError(new Error(row?.error ?? ""))).toBe(row?.error);
    } finally {
        if (slowTimer) clearInterval(slowTimer);
        server.closeAllConnections?.();
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
        });
        delete process.env.VERTEXSLICE_SLICER_URL;
        delete process.env.VERTEXSLICE_API_KEY;
        if (happy) happy.settings.fetch.disableSameOriginPolicy = previousCors ?? false;
    }
}

function insert(side: "left" | "right", fingerprint = "fp-1"): CadProductionInsert {
    return {
        designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `cadop:v1:design:${side}:${fingerprint}`,
        settingsFingerprint: fingerprint,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

describe("CAD-operator production claim", () => {
    test("cadVertexSliceSliceTimeoutMs respects invocation budget and 240s cap", () => {
        const started = new Date("2026-11-09T00:00:00.000Z");
        const atStart = cadVertexSliceSliceTimeoutMs(started, started);
        expect(atStart).toBe(
            Math.min(
                CAD_VERTEX_SLICE_MAX_TIMEOUT_SEC,
                CAD_PRODUCTION_MAX_DURATION_SEC - CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC,
            ) * 1000,
        );
        const after99s = cadVertexSliceSliceTimeoutMs(started, new Date(started.getTime() + 99_000));
        expect(after99s).toBe(
            Math.min(240, CAD_PRODUCTION_MAX_DURATION_SEC - CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC - 99) * 1000,
        );
    });

    test("a hung VertexSlice slice fails the production with a timeout error", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (url.endsWith("/v1/slice")) {
                return new Promise<Response>((_resolve, reject) => {
                    const signal = init?.signal;
                    if (!signal) {
                        reject(new Error("expected AbortSignal on slice fetch"));
                        return;
                    }
                    const onAbort = () => {
                        reject(new DOMException("The operation was aborted.", "AbortError"));
                    };
                    if (signal.aborted) {
                        onAbort();
                        return;
                    }
                    signal.addEventListener("abort", onAbort, { once: true });
                });
            }
            return originalFetch(input, init);
        }) as typeof fetch;

        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("right"), new Date("2026-11-09T00:00:00.000Z"));
        const invocationStart = new Date("2026-11-09T00:00:00.000Z");
        const sliceAt = new Date(
            invocationStart.getTime() +
                (CAD_PRODUCTION_MAX_DURATION_SEC - CAD_VERTEX_SLICE_SAFETY_BUFFER_SEC - 1) * 1000,
        );
        let sliceCtxSeen: { sliceTimeoutMs: number } | undefined;
        let nowCalls = 0;
        await executeCadOperatorProduction({
            row: claimed.row,
            store,
            now: () => {
                nowCalls += 1;
                return nowCalls === 1 ? invocationStart : sliceAt;
            },
            materialize: async () => ({ stlStorageKey: "tmp/r.stl", meshFingerprint: null }),
            slice: async (stlStorageKey, sliceCtx) => {
                sliceCtxSeen = sliceCtx;
                await sliceWithVertexSlice({
                    profileId: "apex-v2-insole-95a",
                    material: "apex_core",
                    model: new Uint8Array([1, 2, 3]),
                    filename: stlStorageKey,
                    sliceTimeoutMs: sliceCtx?.sliceTimeoutMs,
                    side: "right",
                });
                return { gcode: "G1\n", jobId: "job" };
            },
            uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/right.gcode" }),
            charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
        });

        globalThis.fetch = originalFetch;
        delete process.env.VERTEXSLICE_SLICER_URL;
        delete process.env.VERTEXSLICE_API_KEY;

        const expectedMs = cadVertexSliceSliceTimeoutMs(invocationStart, sliceAt);
        const expectedSec = Math.ceil(expectedMs / 1000);
        expect(sliceCtxSeen?.sliceTimeoutMs).toBe(expectedMs);
        expect(expectedMs).toBe(1000);
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe(`VertexSlice timed out after ${expectedSec}s (right)`);
        expect(publicProductionError(new Error(row?.error ?? ""))).toBe(row?.error);
    });

    test("a real hung slice and a slow body read fail the production inside the budget", async () => {
        const originalTimeout = AbortSignal.timeout;
        // Production missed this deadline: Node's AbortSignal.timeout did not reject the fetch.
        AbortSignal.timeout = (() => new AbortController().signal) as typeof AbortSignal.timeout;
        try {
            await expectHungSliceFails("never");
            await expectHungSliceFails("slow");
        } finally {
            AbortSignal.timeout = originalTimeout;
        }
    });

    test("begin returns pending before execute starts on the next event-loop turn", async () => {
        const store = new MemoryCadProductionStore();
        let executeStarted = false;
        let returnedBeforeExecute = false;
        const pending = beginCadOperatorProduction({
            store,
            insert: insert("left"),
            now: new Date("2026-11-09T00:00:00.000Z"),
            schedule: (work) => {
                void work;
            },
            execute: () => {
                executeStarted = true;
                return Promise.resolve();
            },
        });
        returnedBeforeExecute = await Promise.race([
            pending.then(() => true),
            new Promise<boolean>((resolve) => {
                setImmediate(() => resolve(false));
            }),
        ]);
        expect(returnedBeforeExecute).toBe(true);
        expect(executeStarted).toBe(false);
        await pending;
        await new Promise<void>((resolve) => {
            setImmediate(() => resolve());
        });
        expect(executeStarted).toBe(true);
    });

    test("begin returns before synchronous execute work would block the turn", async () => {
        const store = new MemoryCadProductionStore();
        let scheduled: Promise<void> | null = null;
        let executeEntered = false;
        const pending = beginCadOperatorProduction({
            store,
            insert: insert("left"),
            now: new Date("2026-11-09T00:00:00.000Z"),
            schedule: (work) => {
                scheduled = work;
            },
            execute: () => {
                executeEntered = true;
                const deadline = Date.now() + 200;
                while (Date.now() < deadline) {
                    /* spin synchronously */
                }
                return Promise.resolve();
            },
        });
        const started = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error("begin blocked on synchronous execute")), 100);
            }),
        ]);
        expect(started.status).toBe("pending");
        expect(executeEntered).toBe(false);
        await scheduled;
        expect(executeEntered).toBe(true);
    });

    test("begin returns before slicing finishes", async () => {
        const store = new MemoryCadProductionStore();
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let scheduled: Promise<void> | null = null;
        const pending = beginCadOperatorProduction({
            store,
            insert: insert("left"),
            now: new Date("2026-11-09T00:00:00.000Z"),
            schedule: (work) => {
                scheduled = work;
            },
            execute: async () => {
                await gate;
            },
        });
        const started = await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error("generate blocked on slicing")), 50);
            }),
        ]);
        expect(started.status).toBe("pending");
        expect(started.productionId).toMatch(/^[0-9a-f-]{36}$/);
        release();
        await scheduled;
    });

    test("one success charges once, a second call reuses it, and a pair is two rows", async () => {
        const store = new MemoryCadProductionStore();
        let charges = 0;
        let scheduled: Promise<void> | null = null;
        const run = (side: "left" | "right") =>
            beginCadOperatorProduction({
                store,
                insert: insert(side),
                now: new Date("2026-11-09T00:00:00.000Z"),
                schedule: (work) => {
                    scheduled = work;
                },
                execute: (row) =>
                    executeCadOperatorProduction({
                        row,
                        store,
                        now: () => new Date("2026-11-09T00:00:02.000Z"),
                        materialize: async () => ({
                            stlStorageKey: `tmp/${side}.stl`,
                            meshFingerprint: "mesh",
                        }),
                        slice: async () => ({ gcode: "G1 X0\n", jobId: `job-${side}` }),
                        uploadGcode: async () => ({ storageKey: `gcode/cad-operator/t/c/d/${side}.gcode` }),
                        charge: async () => {
                            charges += 1;
                            return { exportId: `exp-${side}`, balance: 7, alreadyCharged: false };
                        },
                    }),
            });

        const left = await run("left");
        expect(charges).toBe(0);
        await scheduled;
        expect(charges).toBe(1);
        const done = await store.findById(left.productionId);
        expect(done?.status).toBe("succeeded");
        expect(done?.gcodeStorageKey).toBe("gcode/cad-operator/t/c/d/left.gcode");
        expect(done?.chargedAt).toBeTruthy();
        if (!done) throw new Error("production missing");
        const pub = toPublicProduction(done);
        expect(Object.keys(pub).sort()).toEqual(
            [
                "createdAt",
                "designId",
                "download",
                "error",
                "gcodeStorageKey",
                "presetId",
                "productionId",
                "side",
                "status",
                "updatedAt",
            ].sort(),
        );
        expect(pub.download).toEqual({ tool: "get_export_download", productionId: left.productionId });
        expect(JSON.stringify(pub)).not.toMatch(/patient|Jane/);

        let reran = false;
        const again = await beginCadOperatorProduction({
            store,
            insert: insert("left"),
            now: new Date("2026-11-09T00:00:03.000Z"),
            schedule: () => {},
            execute: async () => {
                reran = true;
            },
        });
        expect(again).toEqual({ productionId: left.productionId, status: "succeeded", side: "left" });
        expect(reran).toBe(false);
        expect(charges).toBe(1);

        const right = await run("right");
        await scheduled;
        expect(right.productionId).not.toBe(left.productionId);
        expect(charges).toBe(2);
    });

    test("default reuses an in-flight production for the same idempotency key", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:00.000Z");
        const first = await claimProduction(store, insert("left"), now);
        await store.updateIf(first.row.id, () => true, {
            status: "running",
            leaseExpiresAt: new Date(now.getTime() + CAD_PRODUCTION_LEASE_MS),
            updatedAt: now,
        });
        const second = await claimProduction(store, insert("left"), now);
        expect(second).toEqual({ row: expect.objectContaining({ id: first.row.id }), run: false });
    });

    test("force_new_slice enqueues a new production when one already succeeded", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:03.000Z");
        const first = await claimProduction(store, insert("left", "fp-force-new"), now);
        await store.updateIf(first.row.id, () => true, {
            status: "succeeded",
            gcodeStorageKey: "gcode/left.gcode",
            updatedAt: now,
            leaseExpiresAt: null,
        });
        const second = await claimProduction(store, insert("left", "fp-force-new"), now, {
            forceNewSlice: true,
        });
        expect(second.row.id).not.toBe(first.row.id);
        expect(second.run).toBe(true);
    });

    test("force_new_slice reuses an in-flight fresh slice instead of duplicating", async () => {
        const store = new MemoryCadProductionStore();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let scheduled: Promise<void> | null = null;
        const seed = insert("left", "fp-force-inflight");
        await beginCadOperatorProduction({
            store,
            insert: seed,
            now: new Date("2026-11-09T00:00:00.000Z"),
            schedule: (work) => {
                scheduled = work;
            },
            execute: (row) =>
                executeCadOperatorProduction({
                    row,
                    store,
                    now: () => new Date("2026-11-09T00:00:01.000Z"),
                    materialize: async () => ({
                        stlStorageKey: "tmp/left.stl",
                        meshFingerprint: "mesh",
                    }),
                    slice: async () => ({ gcode: "G1\n", jobId: "job-seed" }),
                    uploadGcode: async () => ({ storageKey: "gcode/seed.gcode" }),
                    charge: async () => ({ exportId: "exp-seed", balance: 1, alreadyCharged: false }),
                }),
        });
        await scheduled;

        const inFlight = await beginCadOperatorProduction({
            store,
            insert: seed,
            now: new Date("2026-11-09T00:00:02.000Z"),
            forceNewSlice: true,
            schedule: (work) => {
                scheduled = work;
            },
            execute: async () => {
                await gate;
            },
        });
        expect(inFlight.status).toBe("pending");

        let duplicate = false;
        const again = await beginCadOperatorProduction({
            store,
            insert: seed,
            now: new Date("2026-11-09T00:00:02.500Z"),
            forceNewSlice: true,
            schedule: () => {},
            execute: async () => {
                duplicate = true;
            },
        });
        expect(again.productionId).toBe(inFlight.productionId);
        expect(duplicate).toBe(false);
        release();
        await scheduled;
    });

    test("a failed slice is not charged and a later call runs that row again", async () => {
        const store = new MemoryCadProductionStore();
        let charges = 0;
        let scheduled: Promise<void> | null = null;
        const start = (
            slice: () => Promise<{ gcode: string; jobId: string }>,
            claimNow = new Date("2026-11-09T00:00:00.000Z"),
        ) =>
            beginCadOperatorProduction({
                store,
                insert: insert("left"),
                now: claimNow,
                schedule: (work) => {
                    scheduled = work;
                },
                execute: (row) =>
                    executeCadOperatorProduction({
                        row,
                        store,
                        now: () => new Date(),
                        materialize: async () => ({ stlStorageKey: "tmp/a.stl", meshFingerprint: null }),
                        slice,
                        uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                        charge: async () => {
                            charges += 1;
                            return { exportId: "exp-1", balance: 4, alreadyCharged: false };
                        },
                    }),
            });

        const failed = await start(async () => {
            throw new Error("patient Jane Doe loft exploded");
        });
        await scheduled;
        const row = await store.findById(failed.productionId);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe("Manufacturing failed (left): patient [redacted] loft exploded");
        expect(row?.error).not.toMatch(/Jane/);
        expect(charges).toBe(0);

        const staleKey = "gcode/cad-operator/stale/left.gcode";
        await store.updateIf(failed.productionId, () => true, { gcodeStorageKey: staleKey });
        const failCreatedAt = row?.createdAt;

        const again = await start(
            async () => ({ gcode: "G1 X0\n", jobId: "job-2" }),
            new Date("2026-11-09T00:02:00.000Z"),
        );
        expect(again.productionId).toBe(failed.productionId);
        expect(again.status).toBe("pending");
        const claimed = await store.findById(again.productionId);
        expect(claimed?.error).toBeNull();
        expect(claimed?.gcodeStorageKey).toBeNull();
        expect(claimed?.createdAt.getTime()).toBeGreaterThan(failCreatedAt?.getTime() ?? 0);
        await scheduled;
        expect(charges).toBe(1);
        const succeeded = await store.findById(again.productionId);
        expect(succeeded?.status).toBe("succeeded");
        expect(succeeded?.gcodeStorageKey).toBe("gcode/cad-operator/t/c/d/left.gcode");
        expect(succeeded?.gcodeStorageKey).not.toBe(staleKey);
    });

    test("concurrent claims share one row and an expired lease can be retried", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:00.000Z");
        let runs = 0;
        const claim = () =>
            beginCadOperatorProduction({
                store,
                insert: insert("left", "same"),
                now,
                schedule: (work) => {
                    void work;
                },
                execute: async () => {
                    runs += 1;
                },
            });
        const [first, second] = await Promise.all([claim(), claim()]);
        expect(first.productionId).toBe(second.productionId);
        await new Promise<void>((resolve) => {
            setImmediate(() => resolve());
        });
        expect(runs).toBe(1);
        expect([first.status, second.status].sort()).toEqual(["pending", "pending"]);

        const later = new Date(now.getTime() + CAD_PRODUCTION_LEASE_MS + 1);
        const expired = await expireStaleProduction(store, first.productionId, later);
        expect(expired?.status).toBe("failed");
        expect(expired?.error).toBe("Production lease expired");
        const rerun = await claimProduction(store, insert("left", "same"), later);
        expect(rerun.run).toBe(true);
        expect(rerun.row.id).toBe(first.productionId);
        expect(rerun.row.status).toBe("pending");
    });

    test("an already charged row is not charged again, and Hard gyroid stays 32%", async () => {
        expect(HARDNESS_TO_INFILL_PCT.Hard).toBe(32);
        expect(infillPctForCadSlice("apex-v2-insole-95a", recipe)).toBe(32);
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("left"), new Date("2026-11-09T00:00:00.000Z"));
        await store.updateIf(claimed.row.id, () => true, {
            status: "running",
            chargedAt: new Date("2026-11-09T00:00:01.000Z"),
            exportId: "exp-1",
            gcodeStorageKey: "gcode/cad-operator/t/c/d/left.gcode",
        });
        let charges = 0;
        await executeCadOperatorProduction({
            row: (await store.findById(claimed.row.id)) ?? claimed.row,
            store,
            now: () => new Date("2026-11-09T00:00:02.000Z"),
            materialize: async () => {
                throw new Error("should not loft");
            },
            slice: async () => ({ gcode: "G1\n", jobId: "job" }),
            uploadGcode: async () => ({ storageKey: "other" }),
            charge: async () => {
                charges += 1;
                return { exportId: "exp-2", balance: 1, alreadyCharged: false };
            },
        });
        expect(charges).toBe(0);
        expect((await store.findById(claimed.row.id))?.status).toBe("succeeded");
        expect(
            publicProductionError(new Error("Canonical Export mesh is not available headless (Jane Doe)")),
        ).toBe("Canonical Export mesh is not available headless. Refusing to substitute a different mesh.");
        expect(
            assetLoadCauseForLog(new Error("Canonical Export mesh is not available headless (Jane Doe)")),
        ).toBeNull();
    });

    test("execute logs loft_s and slice_s for a finished foot and a loft failure", async () => {
        const store = new MemoryCadProductionStore();
        const lines: string[] = [];
        const original = console.log;
        console.log = (...args: unknown[]) => {
            lines.push(args.map((arg) => String(arg)).join(" "));
        };
        try {
            const claimed = await claimProduction(
                store,
                insert("left", "timing"),
                new Date("2026-11-09T00:00:00.000Z"),
            );
            await executeCadOperatorProduction({
                row: claimed.row,
                store,
                now: () => new Date("2026-11-09T00:00:01.000Z"),
                materialize: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    return { stlStorageKey: "tmp/left.stl", meshFingerprint: "abc" };
                },
                slice: async () => {
                    await new Promise((resolve) => setTimeout(resolve, 5));
                    return { gcode: "G1\n", jobId: "job-1" };
                },
                uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
            });
            const failed = await claimProduction(
                store,
                insert("right", "timing-fail"),
                new Date("2026-11-09T00:00:02.000Z"),
            );
            await executeCadOperatorProduction({
                row: failed.row,
                store,
                now: () => new Date("2026-11-09T00:00:03.000Z"),
                materialize: async () => {
                    throw new Error("loft failed");
                },
                slice: async () => ({ gcode: "G1\n", jobId: "job-2" }),
                uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/right.gcode" }),
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
            });
        } finally {
            console.log = original;
        }
        const parsed = lines
            .map((line) => {
                try {
                    return JSON.parse(line) as {
                        msg?: string;
                        loft_s?: number;
                        slice_s?: number;
                        side?: string;
                    };
                } catch {
                    return null;
                }
            })
            .filter((row) => row?.msg === "cad-operator-timing");
        expect(parsed).toHaveLength(2);
        expect(parsed[0]).toMatchObject({ side: "left" });
        expect(parsed[0]?.loft_s).toBeGreaterThan(0);
        expect(parsed[0]?.slice_s).toBeGreaterThan(0);
        expect(parsed[1]).toMatchObject({ side: "right", slice_s: 0 });
        expect(parsed[1]?.loft_s).toBeGreaterThanOrEqual(0);
        expect(JSON.stringify(parsed)).not.toMatch(/patient|settingsJson|api_key|token|bearer/i);
    });

    test("a failed loft logs the font or element cause and keeps the public row error", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:00.000Z");
        const claimed = await claimProduction(store, insert("left", "font-cause"), now);
        const fontError = new Error(
            "Canonical Export mesh is not available headless (Failed to parse URL from /fonts/Inter-Bold.ttf). Refusing to substitute a different mesh.",
        );
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => {
            logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
        };
        try {
            await executeCadOperatorProduction({
                row: (await store.findById(claimed.row.id)) ?? claimed.row,
                store,
                now: () => new Date("2026-11-09T00:00:01.000Z"),
                materialize: async () => {
                    throw fontError;
                },
                slice: async () => ({ gcode: "G1\n", jobId: "job" }),
                uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
            });
        } finally {
            console.error = original;
        }
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe(
            "Canonical Export mesh is not available headless. Refusing to substitute a different mesh. (Error: Failed to parse URL from /fonts/Inter-Bold.ttf)",
        );
        expect(toPublicProduction(row ?? claimed.row).error).toBe(row?.error);
        const loggedText = logged.join("\n");
        expect(loggedText).toContain("Failed to parse URL from /fonts/Inter-Bold.ttf");
        expect(loggedText).toContain('"stack"');
        expect(loggedText).not.toContain("Jane Doe");
        expect(assetLoadCauseForLog(fontError)).toBe("Failed to parse URL from /fonts/Inter-Bold.ttf");
        const elementError = new Error(
            "Canonical Export mesh is not available headless (Element asset /elements/met_bar_1.right.glb is not a GLB). Refusing to substitute a different mesh.",
        );
        expect(assetLoadCauseForLog(elementError)).toBe(
            "Element asset /elements/met_bar_1.right.glb is not a GLB",
        );
    });

    test("get_production keeps the refusal and appends a sanitized inner cause", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-09T00:00:00.000Z");
        const claimed = await claimProduction(store, insert("left", "inner-cause"), now);
        const cause = new TypeError("Cannot read properties of undefined (reading 'archHeightMm')");
        cause.stack =
            "TypeError: Cannot read properties of undefined (reading 'archHeightMm')\n    at buildWedge (wedge.ts:10:1)";
        const wrapped = new Error(
            `Canonical Export mesh is not available headless (${cause.name}: ${cause.message}). Refusing to substitute a different mesh.`,
            { cause },
        );
        const logged: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => {
            logged.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
        };
        try {
            await executeCadOperatorProduction({
                row: (await store.findById(claimed.row.id)) ?? claimed.row,
                store,
                now: () => new Date("2026-11-09T00:00:01.000Z"),
                materialize: async () => {
                    throw wrapped;
                },
                slice: async () => ({ gcode: "G1\n", jobId: "job" }),
                uploadGcode: async () => ({ storageKey: "gcode/cad-operator/t/c/d/left.gcode" }),
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
            });
        } finally {
            console.error = original;
        }
        const row = await store.findById(claimed.row.id);
        const text = row?.error ?? "";
        expect(text).toContain(
            "Canonical Export mesh is not available headless. Refusing to substitute a different mesh.",
        );
        expect(text).toContain("TypeError: Cannot read properties of undefined (reading 'archHeightMm')");
        expect(toPublicProduction(row ?? claimed.row).error).toBe(text);
        expect(logged.join("\n")).toContain("at buildWedge (wedge.ts:10:1)");
        expect(
            publicProductionError(
                new Error(
                    "Canonical Export mesh is not available headless (Jane Doe). Refusing to substitute a different mesh.",
                ),
            ),
        ).toBe("Canonical Export mesh is not available headless. Refusing to substitute a different mesh.");
        const named = publicProductionError(
            new Error(
                "Canonical Export mesh is not available headless (TypeError: loft failed for Jane Doe). Refusing to substitute a different mesh.",
            ),
        );
        expect(named).toContain("TypeError: loft failed for [redacted]");
        expect(named).not.toContain("Jane Doe");
        const secret = publicProductionError(
            new Error(
                "Canonical Export mesh is not available headless (TypeError: bearer ocad_live_secret rejected). Refusing to substitute a different mesh.",
            ),
        );
        expect(secret).toContain("TypeError:");
        expect(secret).not.toContain("ocad_live_secret");
        expect(secret).not.toContain("bearer");
        const dumped = publicProductionError(
            new Error(
                'Canonical Export mesh is not available headless (Error: bad settingsJson {"firstName":"Jane","lastName":"Doe"}). Refusing to substitute a different mesh.',
            ),
        );
        expect(dumped).toBe(
            "Canonical Export mesh is not available headless. Refusing to substitute a different mesh.",
        );
        expect(dumped).not.toContain("Jane");
        const stl = publicProductionError(
            new Error(
                "Canonical Export mesh is not available headless (Error: solid foot facet normal 0 0 1). Refusing to substitute a different mesh.",
            ),
        );
        expect(stl).toBe(
            "Canonical Export mesh is not available headless. Refusing to substitute a different mesh.",
        );
        expect(stl).not.toContain("facet normal");
    });

    test("settings identity changes with the foot and stays stable for the same inputs", () => {
        const base = {
            designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            side: "left" as const,
            presetId: "apex-v2-insole-95a",
            useSavedDesignMesh: true,
            material: "apex_core",
            beltAngleDeg: 45,
            layerHeightMm: null,
            printRecipe: recipe,
            settingsJson: { schemaVersion: 1, settings: { thicknessMm: 3 } },
            stlStorageKey: null,
        };
        const left = cadOperatorManufacturingIdentity(base);
        const again = cadOperatorManufacturingIdentity({
            ...base,
            settingsJson: { settings: { thicknessMm: 3 }, schemaVersion: 1 },
        });
        const right = cadOperatorManufacturingIdentity({ ...base, side: "right" });
        expect(left.idempotencyKey).toBe(again.idempotencyKey);
        expect(left.idempotencyKey).not.toBe(right.idempotencyKey);
        expect(cadOperatorManufacturingIdentity({ ...base, regional3mf: false }).idempotencyKey).toBe(
            left.idempotencyKey,
        );
        expect(cadOperatorManufacturingIdentity({ ...base, regional3mf: true }).idempotencyKey).not.toBe(
            left.idempotencyKey,
        );
        expect(left.idempotencyKey).toContain(":left:");
        expect(left.idempotencyKey).toContain("apex-v2-insole-95a");
        const stl = cadOperatorManufacturingIdentity({ ...base, deliverable: "central_fab_stl" });
        expect(stl.idempotencyKey).not.toBe(left.idempotencyKey);
    });

    test("a materialized STL is stored without slicing", async () => {
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(
            store,
            insert("left", "stl-fp"),
            new Date("2026-11-11T00:00:00.000Z"),
        );
        let sliced = 0;
        await executeCadOperatorProduction({
            row: claimed.row,
            store,
            now: () => new Date("2026-11-11T00:00:01.000Z"),
            deliverMaterializedStl: true,
            materialize: async () => ({
                stlStorageKey: "stl/cad-operator/tenant/cred/design/left-1-id.stl",
                meshFingerprint: "mesh",
            }),
            slice: async () => {
                sliced += 1;
                return { gcode: "G1\n", jobId: "job" };
            },
            uploadGcode: async () => {
                sliced += 1;
                return { storageKey: "gcode/should-not" };
            },
            charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
        });
        const row = await store.findById(claimed.row.id);
        expect(sliced).toBe(0);
        expect(row?.status).toBe("succeeded");
        expect(row?.gcodeStorageKey).toBe("stl/cad-operator/tenant/cred/design/left-1-id.stl");
        if (!row) throw new Error("production row missing");
        expect(toPublicProduction(row).download?.tool).toBe("get_export_download");
    });
});

describe("publicProductionError operational messages", () => {
    test("preserves VertexSlice, mesh, and manufacturing errors without PHI", () => {
        expect(publicProductionError(new Error("VertexSlice error (500): mesh not manifold"))).toBe(
            "VertexSlice error (500): mesh not manifold",
        );
        expect(publicProductionError(new Error("VertexSlice returned empty G-code"))).toBe(
            "VertexSlice returned empty G-code",
        );
        expect(
            publicProductionError(
                new Error("Could not reach VertexSlice (https://slicer.example): socket hang up"),
            ),
        ).toBe("Could not reach VertexSlice: socket hang up");
        expect(publicProductionError(new Error("Material apex_core not available on slicer"))).toBe(
            "Material apex_core not available on slicer",
        );
        expect(
            publicProductionError(new Error("Hardness 3MF export failed: Jane Doe region boolean failed")),
        ).toBe("Hardness 3MF export failed: [redacted] region boolean failed");
        expect(publicProductionError(new Error("manifold-3d rejected mesh for right met pad volume"))).toBe(
            "manifold-3d rejected mesh for right met pad volume",
        );
        expect(
            publicProductionError(new Error("manifold-3d subtract failed for heel cup: bad topology")),
        ).toBe("manifold-3d subtract failed for heel cup: bad topology");
        expect(publicProductionError(new Error("3MF missing /components/3/3/model.model"))).toBe(
            "3MF missing /components/3/3/model.model",
        );
        expect(publicProductionError(new Error("binary STL truncated after 84 bytes"))).toBe(
            "binary STL truncated after 84 bytes",
        );
        expect(publicProductionError(new Error("connect ETIMEDOUT 203.0.113.1:443"), "right")).toBe(
            "Manufacturing timed out (right)",
        );
        expect(publicProductionError(new Error("patient Jane Doe loft exploded"), "left")).toBe(
            "Manufacturing failed (left): patient [redacted] loft exploded",
        );
        const email = publicProductionError(
            new Error("VertexSlice error (502): rejected patient jane.doe@example.com"),
        );
        expect(email).toBe("VertexSlice error (502): rejected patient [redacted]");
        expect(email.length).toBeLessThanOrEqual(200);
    });
});

interface MockSliceJob {
    id: string;
    acceptedAt: number;
    queueMs: number;
    sliceMs: number;
    gcode: string;
    failedError?: string;
}

function iso(ms: number): string {
    return new Date(ms).toISOString();
}

function mockJobView(job: MockSliceJob, nowMs: number) {
    const start = job.acceptedAt + job.queueMs;
    const finish = start + job.sliceMs;
    const queuedAt = iso(job.acceptedAt);
    if (job.failedError && nowMs >= start) {
        return {
            job_id: job.id,
            status: "failed",
            position: null,
            queued_at: queuedAt,
            started_at: iso(start),
            finished_at: iso(start),
            elapsed_s: 0,
            error: job.failedError,
        };
    }
    if (nowMs < start) {
        return {
            job_id: job.id,
            status: "queued",
            position: 1,
            queued_at: queuedAt,
            started_at: null,
            finished_at: null,
            elapsed_s: null,
            error: null,
        };
    }
    if (nowMs < finish) {
        return {
            job_id: job.id,
            status: "running",
            position: null,
            queued_at: queuedAt,
            started_at: iso(start),
            finished_at: null,
            elapsed_s: (nowMs - start) / 1000,
            error: null,
        };
    }
    return {
        job_id: job.id,
        status: "succeeded",
        position: null,
        queued_at: queuedAt,
        started_at: iso(start),
        finished_at: iso(finish),
        elapsed_s: job.sliceMs / 1000,
        error: null,
    };
}

function installSliceJobFetch(args: {
    nowMs: () => number;
    jobs: MockSliceJob[];
    mode: "jobs" | "jobs-404" | "lose";
    syncBody?: string;
}): string[] {
    const calls: string[] = [];
    let posted = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        calls.push(`${method} ${url}`);
        if (url.endsWith("/v1/materials")) {
            return new Response(JSON.stringify(["apex_core"]), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (method === "POST" && url.endsWith("/v1/slice/jobs")) {
            if (args.mode === "jobs-404") return new Response("not deployed", { status: 404 });
            const job = args.jobs[posted];
            posted += 1;
            if (!job) return new Response("unexpected job", { status: 500 });
            job.acceptedAt = args.nowMs();
            return new Response(JSON.stringify({ job_id: job.id, status: "queued", position: posted }), {
                status: 202,
                headers: { "content-type": "application/json" },
            });
        }
        if (args.mode === "lose" && url.includes("/v1/slice/jobs/")) {
            return new Response("restarted", { status: 404 });
        }
        const result = url.match(/\/v1\/slice\/jobs\/([^/]+)\/result$/);
        if (result) {
            const job = args.jobs.find((item) => item.id === decodeURIComponent(result[1] ?? ""));
            if (!job) return new Response("missing", { status: 404 });
            if (mockJobView(job, args.nowMs()).status !== "succeeded")
                return new Response("busy", { status: 409 });
            return new Response(job.gcode, { status: 200, headers: { "content-type": "text/plain" } });
        }
        const status = url.match(/\/v1\/slice\/jobs\/([^/]+)$/);
        if (status && method === "GET") {
            const job = args.jobs.find((item) => item.id === decodeURIComponent(status[1] ?? ""));
            if (!job) return new Response("missing", { status: 404 });
            return new Response(JSON.stringify(mockJobView(job, args.nowMs())), {
                status: 200,
                headers: { "content-type": "application/json" },
            });
        }
        if (method === "POST" && url.endsWith("/v1/slice")) {
            return new Response(args.syncBody ?? "", {
                status: 200,
                headers: { "content-type": "text/plain" },
            });
        }
        return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    return calls;
}

describe("VertexSlice job productions", () => {
    const originalFetch = globalThis.fetch;
    const foot = triangleStl([0, 0, 0, 120, 0, 0, 0, 40, 8]);

    async function drive(args: {
        store: MemoryCadProductionStore;
        rowId: string;
        side: "left" | "right";
        budgetMs: number;
        now: () => Date;
        sleep: (ms: number) => Promise<void>;
        saved: Map<string, string>;
    }): Promise<void> {
        const row = await args.store.findById(args.rowId);
        if (!row) throw new Error("missing production");
        await executeCadOperatorProduction({
            row,
            store: args.store,
            now: args.now,
            sliceBudgetMs: args.budgetMs,
            sleep: args.sleep,
            materialize: async () => ({ stlStorageKey: `tmp/${args.side}.stl`, meshFingerprint: "mesh" }),
            slice: async (stlStorageKey, sliceCtx) => {
                const attempt = await runCadSliceAttempt({
                    request: sliceCtx?.checkpoint
                        ? null
                        : {
                              profileId: "apex-v2-insole-95a",
                              material: "apex_core",
                              model: foot,
                              filename: `${args.side}.stl`,
                              infillDensityPct: 32,
                              side: args.side,
                              sliceTimeoutMs: sliceCtx?.sliceTimeoutMs,
                          },
                    checkpoint: sliceCtx?.checkpoint ?? null,
                    stlStorageKey,
                    meshFingerprint: sliceCtx?.meshFingerprint ?? "mesh",
                    credentialId: "cred",
                    side: args.side,
                    now: sliceCtx?.now ?? args.now,
                    sleep: sliceCtx?.sleep ?? args.sleep,
                    budgetMs: sliceCtx?.budgetMs ?? args.budgetMs,
                    persistCheckpoint: sliceCtx?.persistCheckpoint,
                });
                if (attempt.kind === "pending") return { pending: true, checkpoint: attempt.checkpoint };
                return { gcode: attempt.gcode, jobId: attempt.jobId };
            },
            uploadGcode: async (gcode) => {
                args.saved.set(args.side, gcode);
                return { storageKey: `gcode/${args.side}.gcode` };
            },
            charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
        });
    }

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete process.env.VERTEXSLICE_SLICER_URL;
        delete process.env.VERTEXSLICE_API_KEY;
    });

    test("a transient submit is retried inside the slice attempt and the later 202 is returned", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const gcode = passingBeltGcode("left");
        let posts = 0;
        const nowMs = Date.parse("2026-11-24T23:05:00.000Z");
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);
            const method = (init?.method ?? "GET").toUpperCase();
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (method === "POST" && url.endsWith("/v1/slice/jobs")) {
                posts += 1;
                if (posts === 1) throw new TypeError("ECONNRESET");
                return new Response(JSON.stringify({ job_id: "job-retry", status: "queued", position: 0 }), {
                    status: 202,
                    headers: { "content-type": "application/json" },
                });
            }
            if (url.endsWith("/v1/slice/jobs/job-retry/result")) {
                return new Response(gcode, { status: 200, headers: { "content-type": "text/plain" } });
            }
            if (method === "GET" && url.endsWith("/v1/slice/jobs/job-retry")) {
                return new Response(
                    JSON.stringify({
                        job_id: "job-retry",
                        status: "succeeded",
                        position: null,
                        queued_at: new Date(nowMs).toISOString(),
                        started_at: new Date(nowMs).toISOString(),
                        finished_at: new Date(nowMs).toISOString(),
                        elapsed_s: 1,
                        error: null,
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            }
            return new Response("unexpected", { status: 500 });
        }) as typeof fetch;
        const attempt = await runCadSliceAttempt({
            request: {
                profileId: "apex-v2-insole-95a",
                material: "apex_core",
                model: foot,
                filename: "left.stl",
                infillDensityPct: 32,
                side: "left",
            },
            checkpoint: null,
            stlStorageKey: "tmp/left.stl",
            meshFingerprint: "mesh",
            credentialId: "cred",
            side: "left",
            now: () => new Date(nowMs),
            sleep: async () => undefined,
            budgetMs: 1_000,
        });
        expect(posts).toBe(2);
        expect(attempt).toEqual({ kind: "gcode", gcode, jobId: "vs_job-retry" });
    });

    test("two overlapping productions succeed when the second waits 200s in queue", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const t0 = Date.parse("2026-11-23T16:00:00.000Z");
        let nowMs = t0;
        const now = () => new Date(nowMs);
        const sleep = async (ms: number) => {
            nowMs += ms;
        };
        const leftGcode = passingBeltGcode("left");
        const rightGcode = passingBeltGcode("right");
        const jobs: MockSliceJob[] = [
            { id: "job-left", acceptedAt: 0, queueMs: 0, sliceMs: 30_000, gcode: leftGcode },
            { id: "job-right", acceptedAt: 0, queueMs: 200_000, sliceMs: 10_000, gcode: rightGcode },
        ];
        installSliceJobFetch({ nowMs: () => nowMs, jobs, mode: "jobs" });
        const store = new MemoryCadProductionStore();
        const left = await claimProduction(store, insert("left", "overlap-left"), now());
        const right = await claimProduction(store, insert("right", "overlap-right"), now());
        const saved = new Map<string, string>();
        await drive({ store, rowId: left.row.id, side: "left", budgetMs: 1, now, sleep, saved });
        await drive({ store, rowId: right.row.id, side: "right", budgetMs: 1, now, sleep, saved });
        const queued = await store.findById(right.row.id);
        expect(queued?.status).toBe("running");
        expect(readSliceCheckpoint(queued?.error)?.jobId).toBe("job-right");
        expect(toPublicProduction(queued ?? right.row).error).toBeNull();
        expect(toPublicProduction(queued ?? right.row).status).toBe("running");

        const before = nowMs;
        await drive({
            store,
            rowId: right.row.id,
            side: "right",
            budgetMs: SLICE_JOB_POLL_BUDGET_MS,
            now,
            sleep,
            saved,
        });
        expect(nowMs - before).toBeLessThanOrEqual(SLICE_JOB_POLL_BUDGET_MS);
        const stillQueued = await store.findById(right.row.id);
        expect(stillQueued?.status).toBe("running");
        expect(stillQueued?.error).not.toContain("Manufacturing timed out");
        expect(toPublicProduction(stillQueued ?? right.row).error).toBeNull();

        nowMs = t0 + 210_000;
        await drive({ store, rowId: right.row.id, side: "right", budgetMs: 0, now, sleep, saved });
        await drive({ store, rowId: left.row.id, side: "left", budgetMs: 0, now, sleep, saved });
        const doneLeft = await store.findById(left.row.id);
        const doneRight = await store.findById(right.row.id);
        expect(doneLeft?.status).toBe("succeeded");
        expect(doneRight?.status).toBe("succeeded");
        expect(saved.get("left")).toBe(leftGcode);
        expect(saved.get("right")).toBe(rightGcode);
        expect(doneRight?.error).toBeNull();
    });

    test("a stuck slice fails at 260s from started_at and names the slice hop", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const t0 = Date.parse("2026-11-23T16:00:00.000Z");
        let nowMs = t0;
        const jobs: MockSliceJob[] = [
            { id: "job-stuck", acceptedAt: 0, queueMs: 0, sliceMs: 86_400_000, gcode: "G1 SHOULD-NOT\n" },
        ];
        installSliceJobFetch({ nowMs: () => nowMs, jobs, mode: "jobs" });
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("left", "stuck-slice"), new Date(nowMs));
        const saved = new Map<string, string>();
        const now = () => new Date(nowMs);
        const sleep = async (ms: number) => {
            nowMs += ms;
        };
        await drive({ store, rowId: claimed.row.id, side: "left", budgetMs: 1, now, sleep, saved });
        nowMs = t0 + SLICE_JOB_SLICE_CAP_MS - 1;
        await drive({ store, rowId: claimed.row.id, side: "left", budgetMs: 0, now, sleep, saved });
        expect((await store.findById(claimed.row.id))?.status).toBe("running");
        nowMs = t0 + SLICE_JOB_SLICE_CAP_MS;
        await drive({ store, rowId: claimed.row.id, side: "left", budgetMs: 0, now, sleep, saved });
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toBe("VertexSlice slice exceeded 260s (left)");
        expect(row?.error).not.toContain("Manufacturing timed out");
        expect(saved.has("left")).toBe(false);
    });

    test("a 404 on a known job is failed and retryable", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const t0 = Date.parse("2026-11-23T16:00:00.000Z");
        const jobs: MockSliceJob[] = [
            { id: "job-lost", acceptedAt: 0, queueMs: 0, sliceMs: 10_000, gcode: "G1\n" },
        ];
        installSliceJobFetch({ nowMs: () => t0, jobs, mode: "lose" });
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("right", "lost-job"), new Date(t0));
        await drive({
            store,
            rowId: claimed.row.id,
            side: "right",
            budgetMs: 1,
            now: () => new Date(t0),
            sleep: async () => undefined,
            saved: new Map(),
        });
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toContain("404");
        expect(row?.error).toContain("retryable");
        expect(row?.error).not.toContain("Manufacturing timed out");
        const again = await claimProduction(store, insert("right", "lost-job"), new Date(t0 + 1_000));
        expect(again.run).toBe(true);
        expect(again.row.status).toBe("pending");
        expect(again.row.error).toBeNull();
    });

    test("POST /v1/slice/jobs 404 falls back to sync /v1/slice bytes", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const syncBody = `${passingBeltGcode("left")}; keep-bytes\n`;
        const calls = installSliceJobFetch({
            nowMs: () => Date.parse("2026-11-23T16:00:00.000Z"),
            jobs: [],
            mode: "jobs-404",
            syncBody,
        });
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(
            store,
            insert("left", "fallback-sync"),
            new Date("2026-11-23T16:00:00.000Z"),
        );
        const saved = new Map<string, string>();
        await drive({
            store,
            rowId: claimed.row.id,
            side: "left",
            budgetMs: SLICE_JOB_POLL_BUDGET_MS,
            now: () => new Date("2026-11-23T16:00:00.000Z"),
            sleep: async () => undefined,
            saved,
        });
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("succeeded");
        expect(saved.get("left")).toBe(syncBody);
        expect(calls.some((call) => call.startsWith("POST") && call.endsWith("/v1/slice/jobs"))).toBe(true);
        expect(calls.some((call) => call.startsWith("POST") && call.endsWith("/v1/slice"))).toBe(true);
        expect(readSliceCheckpoint(row?.error)).toBeNull();
    });

    test("queue wait over 20 minutes names the queue hop", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const t0 = Date.parse("2026-11-23T16:00:00.000Z");
        let nowMs = t0;
        const jobs: MockSliceJob[] = [
            {
                id: "job-queue",
                acceptedAt: 0,
                queueMs: SLICE_JOB_QUEUE_WAIT_CAP_MS + 60_000,
                sliceMs: 1_000,
                gcode: "G1\n",
            },
        ];
        installSliceJobFetch({ nowMs: () => nowMs, jobs, mode: "jobs" });
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("right", "queue-cap"), new Date(t0));
        const now = () => new Date(nowMs);
        await drive({
            store,
            rowId: claimed.row.id,
            side: "right",
            budgetMs: 1,
            now,
            sleep: async () => undefined,
            saved: new Map(),
        });
        nowMs = t0 + SLICE_JOB_QUEUE_WAIT_CAP_MS;
        await drive({
            store,
            rowId: claimed.row.id,
            side: "right",
            budgetMs: 0,
            now,
            sleep: async () => undefined,
            saved: new Map(),
        });
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toContain("queue wait");
        expect(row?.error).not.toContain("Manufacturing timed out");
        expect(row?.error).not.toContain("slice exceeded");
    });

    test("a failed job records the server hop", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const t0 = Date.parse("2026-11-23T16:00:00.000Z");
        const jobs: MockSliceJob[] = [
            {
                id: "job-fail",
                acceptedAt: 0,
                queueMs: 0,
                sliceMs: 1_000,
                gcode: "G1\n",
                failedError: "slice exceeded 260s",
            },
        ];
        installSliceJobFetch({ nowMs: () => t0 + 1_000, jobs, mode: "jobs" });
        const store = new MemoryCadProductionStore();
        const claimed = await claimProduction(store, insert("left", "server-fail"), new Date(t0));
        await drive({
            store,
            rowId: claimed.row.id,
            side: "left",
            budgetMs: 1,
            now: () => new Date(t0 + 1_000),
            sleep: async () => undefined,
            saved: new Map(),
        });
        const row = await store.findById(claimed.row.id);
        expect(row?.status).toBe("failed");
        expect(row?.error).toContain("server error");
        expect(row?.error).toContain("slice exceeded 260s");
        expect(row?.error).not.toContain("Manufacturing timed out");
    });

    test("a mirrored left slice fails before upload; a true left is stored unchanged", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const mirrored = handednessFixture("main_left_request_toe_first");
        const trueLeft = handednessFixture("true_left_toe_first");
        const now = new Date("2026-11-24T00:00:00.000Z");

        async function run(side: "left" | "right", body: string, fingerprint: string, mode: "sync" | "job") {
            if (mode === "sync") {
                installSliceJobFetch({
                    nowMs: () => now.getTime(),
                    jobs: [],
                    mode: "jobs-404",
                    syncBody: body,
                });
            } else {
                installSliceJobFetch({
                    nowMs: () => now.getTime(),
                    jobs: [
                        {
                            id: `job-${fingerprint}`,
                            acceptedAt: 0,
                            queueMs: 0,
                            sliceMs: 0,
                            gcode: body,
                        },
                    ],
                    mode: "jobs",
                });
            }
            const store = new MemoryCadProductionStore();
            const claimed = await claimProduction(store, insert(side, fingerprint), now);
            let uploads = 0;
            let charges = 0;
            let uploaded = "";
            await executeCadOperatorProduction({
                row: claimed.row,
                store,
                now: () => now,
                materialize: async () => ({ stlStorageKey: `tmp/${side}.stl`, meshFingerprint: "mesh" }),
                slice: async (stlStorageKey, sliceCtx) => {
                    const attempt = await runCadSliceAttempt({
                        request: sliceCtx?.checkpoint
                            ? null
                            : {
                                  profileId: "apex-v2-insole-95a",
                                  material: "apex_core",
                                  model: foot,
                                  filename: `${side}.stl`,
                                  infillDensityPct: 32,
                                  side,
                                  sliceTimeoutMs: sliceCtx?.sliceTimeoutMs,
                              },
                        checkpoint: sliceCtx?.checkpoint ?? null,
                        stlStorageKey,
                        meshFingerprint: "mesh",
                        credentialId: "cred",
                        side,
                        now: () => now,
                        sleep: async () => undefined,
                        budgetMs: sliceCtx?.budgetMs ?? 0,
                        persistCheckpoint: sliceCtx?.persistCheckpoint,
                    });
                    if (attempt.kind === "pending") return { pending: true, checkpoint: attempt.checkpoint };
                    return { gcode: attempt.gcode, jobId: attempt.jobId };
                },
                uploadGcode: async (gcode) => {
                    uploads += 1;
                    uploaded = gcode;
                    return { storageKey: `gcode/${side}.gcode` };
                },
                charge: async () => {
                    charges += 1;
                    return { exportId: "exp", balance: 1, alreadyCharged: false };
                },
            });
            const row = await store.findById(claimed.row.id);
            return { row, uploads, charges, uploaded };
        }

        const failed = await run("left", mirrored, "hand-fail-sync", "sync");
        expect(failed.row?.status).toBe("failed");
        expect(failed.row?.error).toBe(
            "Handedness check failed: requested left, G-code is a physical right foot. File not delivered.",
        );
        expect(failed.uploads).toBe(0);
        expect(failed.charges).toBe(0);
        expect(failed.row?.gcodeStorageKey ?? null).toBeNull();

        const jobFailed = await run("left", mirrored, "hand-fail-job", "job");
        expect(jobFailed.row?.status).toBe("failed");
        expect(jobFailed.row?.error).toBe(failed.row?.error);
        expect(jobFailed.uploads).toBe(0);
        expect(jobFailed.charges).toBe(0);

        const delivered = await run("left", trueLeft, "hand-ok-left", "sync");
        expect(delivered.row?.status).toBe("succeeded");
        expect(delivered.uploads).toBe(1);
        expect(delivered.charges).toBe(1);
        expect(delivered.uploaded).toBe(trueLeft);

        const rightFoot = await run("right", mirrored, "hand-ok-right", "job");
        expect(rightFoot.row?.status).toBe("succeeded");
        expect(rightFoot.uploads).toBe(1);
        expect(rightFoot.uploaded).toBe(mirrored);
    });
});

const PAIR_FIXTURE_GCODE = "G90\nG1 X10 Y0 Z0.2\n";
const PAIR_FIXTURE_STL = {
    left: "stl/cad-operator/fixture/left.stl",
    right: "stl/cad-operator/fixture/right.stl",
} as const;

/**
 * Interactive transactions yield between statements. A sibling foot's
 * CPU-bound loft can then run before COMMIT. Prisma's default timeout is 5s.
 */
function blockEventLoop(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        // Matches a long synchronous loft on the other foot.
    }
}

function pairRow(side: "left" | "right", now: Date) {
    return {
        id: side === "left" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222",
        designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        side,
        presetId: "apex-v2-insole-95a",
        status: "pending" as const,
        idempotencyKey: `cadop:v1:pair:${side}`,
        settingsFingerprint: "fp-pair",
        gcodeStorageKey: null,
        error: null,
        createdAt: now,
        updatedAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
        chargedAt: null,
        exportId: null,
        method: "printing_solid" as const,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

function sameStoredValue(actual: unknown, expected: unknown): boolean {
    if (actual instanceof Date && expected instanceof Date) return actual.getTime() === expected.getTime();
    return actual === expected;
}

function createPairPrisma(): {
    prisma: PrismaClient;
    transactions: () => number;
    openTransactions: () => number;
} {
    type Stored = Record<string, unknown>;
    const rows = new Map<string, Stored>();
    let transactions = 0;
    let openTransactions = 0;

    function read(where: { id?: string }): Stored | null {
        if (!where.id) return null;
        const row = rows.get(where.id);
        return row ? { ...row } : null;
    }

    const production = {
        async create({ data }: { data: Stored }) {
            const row: Stored = {
                id: data.id,
                designId: data.designId,
                side: data.side ?? null,
                presetId: data.presetId,
                status: data.status,
                idempotencyKey: data.idempotencyKey ?? null,
                settingsFingerprint: data.settingsFingerprint ?? null,
                gcodeStorageKey: data.gcodeStorageKey ?? null,
                error: data.error ?? null,
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                leaseExpiresAt: data.leaseExpiresAt ?? null,
                chargedAt: data.chargedAt ?? null,
                exportId: data.exportId ?? null,
                method: data.method,
                beltAngleDeg: data.beltAngleDeg ?? null,
                layerHeightMm: data.layerHeightMm ?? null,
                material: data.material ?? null,
            };
            rows.set(String(row.id), row);
            return { ...row };
        },
        async findUnique({ where }: { where: { id?: string } }) {
            return read(where);
        },
        async updateMany({ where, data }: { where: Stored; data: Stored }) {
            const current = rows.get(String(where.id));
            if (!current) return { count: 0 };
            const matches = Object.entries(where).every(([key, value]) =>
                sameStoredValue(current[key], value),
            );
            if (!matches) return { count: 0 };
            for (const [key, value] of Object.entries(data)) {
                if (value !== undefined) current[key] = value;
            }
            return { count: 1 };
        },
        async update({ where, data }: { where: { id: string }; data: Stored }) {
            const current = rows.get(where.id);
            if (!current) throw new Error("missing production");
            for (const [key, value] of Object.entries(data)) {
                if (value !== undefined) current[key] = value;
            }
            return { ...current };
        },
    };

    const prisma = {
        production,
        async $transaction(fn: (tx: unknown) => Promise<unknown>) {
            transactions += 1;
            openTransactions += 1;
            const started = Date.now();
            const assertWithinTimeout = () => {
                const elapsed = Date.now() - started;
                if (elapsed > 5_000) {
                    throw new Error(
                        `Transaction already closed: The timeout for this transaction was 5000 ms, however ${elapsed} ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.`,
                    );
                }
            };
            const tx = {
                async $queryRaw() {
                    await new Promise((resolve) => setImmediate(resolve));
                    assertWithinTimeout();
                    return [{ id: "locked" }];
                },
                production: {
                    async findUnique(args: { where: { id?: string } }) {
                        await new Promise((resolve) => setImmediate(resolve));
                        assertWithinTimeout();
                        return production.findUnique(args);
                    },
                    async update(args: { where: { id: string }; data: Stored }) {
                        await new Promise((resolve) => setImmediate(resolve));
                        assertWithinTimeout();
                        return production.update(args);
                    },
                },
            };
            try {
                const result = await fn(tx);
                assertWithinTimeout();
                return result;
            } finally {
                openTransactions -= 1;
            }
        },
    };

    return {
        prisma: prisma as unknown as PrismaClient,
        transactions: () => transactions,
        openTransactions: () => openTransactions,
    };
}

describe("CAD-operator pair production transactions", () => {
    test("updateIf commits one matching status change without an interactive transaction", async () => {
        const handle = createPairPrisma();
        const store = new PrismaCadProductionStore(handle.prisma);
        const now = new Date("2026-11-24T17:00:00.000Z");
        const row = await store.insert(pairRow("right", now));
        const updated = await store.updateIf(row.id, (current) => current.status === "pending", {
            status: "running",
            updatedAt: new Date("2026-11-24T17:00:01.000Z"),
        });
        expect(updated?.status).toBe("running");
        expect(handle.transactions()).toBe(0);
        const lost = await store.updateIf(row.id, (current) => current.status === "pending", {
            status: "failed",
            error: "nope",
            updatedAt: new Date("2026-11-24T17:00:02.000Z"),
        });
        expect(lost).toBeNull();
        expect((await store.findById(row.id))?.status).toBe("running");
        expect((await store.findById(row.id))?.error).toBeNull();
    });

    test("a both-feet run with a loft longer than 5s does not fail with a Prisma interactive-transaction timeout", async () => {
        const handle = createPairPrisma();
        const store = new PrismaCadProductionStore(handle.prisma);
        const created = new Date("2026-11-24T17:16:00.000Z");
        const uploaded = new Map<"left" | "right", string>();
        const sliced: string[] = [];
        let openDuringLoft = false;

        await store.insert(pairRow("left", created));
        await store.insert(pairRow("right", created));
        const left = await store.findById(pairRow("left", created).id);
        const right = await store.findById(pairRow("right", created).id);
        if (!left || !right) throw new Error("pair rows missing");

        const run = (row: typeof left) =>
            executeCadOperatorProduction({
                row,
                store,
                now: () => new Date(),
                materialize: async () => {
                    if (handle.openTransactions() > 0) openDuringLoft = true;
                    blockEventLoop(6_000);
                    return {
                        stlStorageKey: PAIR_FIXTURE_STL[row.side ?? "left"],
                        meshFingerprint: "fixture-mesh",
                    };
                },
                slice: async (stlStorageKey) => {
                    sliced.push(stlStorageKey);
                    return { gcode: PAIR_FIXTURE_GCODE, jobId: `job-${row.side}` };
                },
                uploadGcode: async (gcode) => {
                    if (row.side) uploaded.set(row.side, gcode);
                    return { storageKey: `gcode/cad-operator/fixture/${row.side}.gcode` };
                },
                charge: async () => ({ exportId: `exp-${row.side}`, balance: 1, alreadyCharged: false }),
            });

        await Promise.all([run(left), run(right)]);

        expect(openDuringLoft).toBe(false);
        expect(handle.transactions()).toBe(0);
        for (const side of ["left", "right"] as const) {
            const row = await store.findById(pairRow(side, created).id);
            expect(row?.status).toBe("succeeded");
            expect(row?.error ?? "").not.toContain("Manufacturing timed out");
            expect(row?.error ?? "").not.toMatch(/Transaction already closed/);
            expect(uploaded.get(side)).toBe(PAIR_FIXTURE_GCODE);
        }
        expect(sliced.slice().sort()).toEqual([PAIR_FIXTURE_STL.left, PAIR_FIXTURE_STL.right].slice().sort());
    });
});
