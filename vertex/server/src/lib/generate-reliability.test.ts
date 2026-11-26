// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// generate_gcode must return a production id before loft, retry the transient
// failures seen in production, and slice a fresh loft instead of a stored STL.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "@rstest/core";

import {
    beginCadOperatorProduction,
    type CadProductionInsert,
    claimProduction,
    encodeSliceCheckpoint,
    executeCadOperatorProduction,
    isTransientProductionFailure,
    MemoryCadProductionStore,
    workerLooksDead,
} from "./cad-operator-production.js";
import {
    LOFT_WORKER_LIMIT,
    loftWorkerPeak,
    occupyLoftWorker,
    resetLoftWorkerPeak,
} from "./loft-worker-pool.js";
import { uploadAsset } from "./storage.js";

const here = dirname(fileURLToPath(import.meta.url));

function insert(side: "left" | "right", fingerprint = "fp-reliability"): CadProductionInsert {
    return {
        designId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `cadop:v1:reliability:${side}:${fingerprint}`,
        settingsFingerprint: fingerprint,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

function productionFiles(): string[] {
    return [
        join(here, "cad-operator-production.ts"),
        join(here, "../routers/cad-operator-generate.ts"),
        join(here, "../routers/manufacturing-cad.ts"),
    ].map((file) => readFileSync(file, "utf8"));
}

describe("generate reliability", () => {
    test("transient submit, storage, and lease failures are retried; a mesh error is not", () => {
        expect(isTransientProductionFailure(new Error("VertexSlice server error: submit unavailable"))).toBe(
            true,
        );
        expect(isTransientProductionFailure(new Error("Storage upload failed: fetch failed"))).toBe(true);
        expect(isTransientProductionFailure(new Error("Production lease expired"))).toBe(true);
        expect(isTransientProductionFailure(new Error("Manufacturing timed out (left)"))).toBe(true);
        expect(isTransientProductionFailure(new Error("VertexSlice slice exceeded 240s (left)"))).toBe(false);
        expect(isTransientProductionFailure(new Error("Manufacturing mesh is not sliceable"))).toBe(false);
    });

    test("execute retries submit unavailable, fetch failed, and lease expiry, then succeeds", async () => {
        const now = new Date("2026-11-25T12:00:00.000Z");
        async function run(fingerprint: string, message: string, step: "materialize" | "slice" | "upload") {
            const store = new MemoryCadProductionStore();
            const claimed = await claimProduction(store, insert("left", fingerprint), now);
            let materializeCalls = 0;
            let failedOnce = false;
            const keys: string[] = [];
            const fail = (where: "materialize" | "slice" | "upload") => {
                if (where === step && !failedOnce) {
                    failedOnce = true;
                    throw new Error(message);
                }
            };
            await executeCadOperatorProduction({
                row: claimed.row,
                store,
                now: () => now,
                sleep: async () => {},
                materialize: async () => {
                    materializeCalls += 1;
                    fail("materialize");
                    const key = `tmp/${fingerprint}-${materializeCalls}.stl`;
                    return { stlStorageKey: key, meshFingerprint: "fresh" };
                },
                slice: async (key) => {
                    keys.push(key);
                    fail("slice");
                    return { gcode: "G1 X0\n", jobId: `job-${fingerprint}` };
                },
                uploadGcode: async () => {
                    fail("upload");
                    return { storageKey: `gcode/${fingerprint}.gcode` };
                },
                charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
                deleteTemp: async () => {},
            });
            const saved = await store.findById(claimed.row.id);
            expect(saved?.status).toBe("succeeded");
            expect(saved?.error).toBeNull();
            expect(materializeCalls).toBe(2);
            expect(keys.at(-1)).toBe(`tmp/${fingerprint}-2.stl`);
        }
        await run("submit", "VertexSlice server error: submit unavailable", "slice");
        await run("fetch", "Storage upload failed: fetch failed", "upload");
        await run("lease", "Production lease expired", "materialize");
    });

    test("a non-transient mesh error fails that foot once", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T12:00:00.000Z");
        const claimed = await claimProduction(store, insert("left", "mesh"), now);
        let materializeCalls = 0;
        await executeCadOperatorProduction({
            row: claimed.row,
            store,
            now: () => now,
            sleep: async () => {},
            materialize: async () => {
                materializeCalls += 1;
                throw new Error("Manufacturing mesh is not sliceable: open rim");
            },
            slice: async () => ({ gcode: "G1\n", jobId: "unused" }),
            uploadGcode: async () => ({ storageKey: "unused" }),
            charge: async () => ({ exportId: "unused", balance: 1, alreadyCharged: false }),
        });
        expect(materializeCalls).toBe(1);
        const saved = await store.findById(claimed.row.id);
        expect(saved?.status).toBe("failed");
        expect(saved?.error).toContain("Manufacturing mesh is not sliceable");
        expect(saved?.error).toContain("open rim");
    });

    test("a status poll does not slice a stored STL checkpoint", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T12:00:00.000Z");
        const claimed = await claimProduction(store, insert("right", "stale"), now);
        const staleKey = "manufacturing-temp/cad-operator/stale/right.stl";
        await store.updateIf(claimed.row.id, () => true, {
            status: "running",
            error: encodeSliceCheckpoint({
                v: 1,
                jobId: "pre52-job",
                acceptedAt: "2026-11-24T19:13:17.000Z",
                stlStorageKey: staleKey,
                meshFingerprint: "old",
                expectedRegionCount: 0,
                credentialId: "cred",
                serverStartedAt: null,
            }),
        });
        const row = await store.findById(claimed.row.id);
        let slicedKey = "";
        await executeCadOperatorProduction({
            row: row ?? claimed.row,
            store,
            now: () => now,
            resumeSubmittedSlice: true,
            materialize: async () => ({ stlStorageKey: "tmp/rebuilt-right.stl", meshFingerprint: "fresh" }),
            slice: async (key, ctx) => {
                slicedKey = key;
                expect(ctx?.checkpoint ?? null).toBeNull();
                return { gcode: "G1 X1\n", jobId: "fresh" };
            },
            uploadGcode: async () => ({ storageKey: "gcode/right.gcode" }),
            charge: async () => ({ exportId: "exp", balance: 1, alreadyCharged: false }),
        });
        expect(slicedKey).toBe("tmp/rebuilt-right.stl");
        const saved = await store.findById(claimed.row.id);
        expect(saved?.error ?? "").not.toContain(staleKey);
    });

    test("the production path does not look up a stored manufacturing STL", () => {
        const sources = productionFiles().join("\n");
        expect(sources).not.toContain("downloadManufacturingStl");
        expect(sources).not.toContain("createSignedUrl");
        const generate = productionFiles()[1] ?? "";
        expect(generate).toContain("resumeSubmittedSlice: stored.rematerialized === true");
        expect(generate).toContain("stlBytes: bytes");
    });

    test("begin returns the production id while preflight is still pending", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T12:00:00.000Z");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        let ran = false;
        let scheduled: Promise<void> | undefined;
        const pending = beginCadOperatorProduction({
            store,
            insert: insert("left", "preflight"),
            now,
            schedule: (work) => {
                scheduled = work;
            },
            preflight: () => gate,
            execute: async () => {
                ran = true;
            },
        });
        const started = await Promise.race([
            pending,
            new Promise<never>((_resolve, reject) => {
                setTimeout(() => reject(new Error("generate blocked on preflight")), 50);
            }),
        ]);
        expect(started.status).toBe("pending");
        expect(started.productionId).toBeTruthy();
        expect(ran).toBe(false);
        release();
        await scheduled;
        expect(ran).toBe(true);
    });

    test("a preflight failure marks the returned production failed and does not loft", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T12:00:00.000Z");
        let ran = false;
        let scheduled: Promise<void> | undefined;
        const started = await beginCadOperatorProduction({
            store,
            insert: insert("right", "license"),
            now,
            schedule: (work) => {
                scheduled = work;
            },
            preflight: async () => {
                throw new Error("No valid license");
            },
            execute: async () => {
                ran = true;
            },
        });
        expect(started.status).toBe("pending");
        await scheduled;
        expect(ran).toBe(false);
        const saved = await store.findById(started.productionId);
        expect(saved?.status).toBe("failed");
        expect(saved?.error).toBe("No valid license");
    });

    test("a dead worker is started again and a live in-flight row is not", async () => {
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T12:00:00.000Z");
        const claimed = await claimProduction(store, insert("left", "dead"), now);
        await store.updateIf(claimed.row.id, () => true, {
            status: "pending",
            error: null,
            updatedAt: new Date(now.getTime() - 120_000),
            leaseExpiresAt: new Date(now.getTime() + 60_000),
        });
        const stale = await store.findById(claimed.row.id);
        expect(stale && workerLooksDead(stale, now)).toBe(true);
        expect(stale && workerLooksDead({ ...stale, status: "running" }, now)).toBe(false);
        let runs = 0;
        let scheduled: Promise<void> | undefined;
        const restarted = await beginCadOperatorProduction({
            store,
            insert: insert("left", "dead"),
            now,
            schedule: (work) => {
                scheduled = work;
            },
            execute: async () => {
                runs += 1;
            },
        });
        expect(restarted.productionId).toBe(claimed.row.id);
        await scheduled;
        expect(runs).toBe(1);
        const live = await store.findById(claimed.row.id);
        expect(live && workerLooksDead(live, now)).toBe(false);
        const second = await beginCadOperatorProduction({
            store,
            insert: insert("left", "dead"),
            now,
            schedule: () => {},
            execute: async () => {
                runs += 1;
            },
        });
        expect(second.productionId).toBe(claimed.row.id);
        expect(runs).toBe(1);
    });

    test("upload retries fetch failed and does not retry a permanent storage error", async () => {
        let transientCalls = 0;
        const transient = {
            storage: {
                from: () => ({
                    upload: async () => {
                        transientCalls += 1;
                        if (transientCalls < 3) return { error: { message: "fetch failed" } };
                        return { error: null };
                    },
                }),
            },
        };
        const uploaded = await uploadAsset(
            transient as never,
            "tmp/left.stl",
            Buffer.from("stl"),
            "model/stl",
        );
        expect(uploaded.key).toBe("tmp/left.stl");
        expect(transientCalls).toBe(3);

        let permanentCalls = 0;
        const permanent = {
            storage: {
                from: () => ({
                    upload: async () => {
                        permanentCalls += 1;
                        return { error: { message: "The resource already exists" } };
                    },
                }),
            },
        };
        await expect(
            uploadAsset(permanent as never, "tmp/left.stl", Buffer.from("stl"), "model/stl"),
        ).rejects.toThrow(/Storage upload failed: The resource already exists/);
        expect(permanentCalls).toBe(1);
    });

    test("four loft workers run together", async () => {
        resetLoftWorkerPeak();
        const marks: number[] = [];
        await Promise.all(
            [0, 1, 2, 3].map(async () => {
                const occupied = await occupyLoftWorker(120);
                marks.push(performance.now() - occupied.elapsedMs);
            }),
        );
        expect(LOFT_WORKER_LIMIT).toBeGreaterThanOrEqual(4);
        expect(loftWorkerPeak()).toBe(4);
        expect(Math.max(...marks) - Math.min(...marks)).toBeLessThan(150);
    });
});
