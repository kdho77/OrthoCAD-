// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// A pair used to share one event loop. The left loft ran to the slice POST
// before the right loft could start, and that right loft then stalled the
// left slice poll. These tests lock the off-thread schedule.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "@rstest/core";

import {
    beginCadOperatorProduction,
    type CadProductionInsert,
    executeCadOperatorProduction,
    MemoryCadProductionStore,
} from "./cad-operator-production.js";
import { loftWorkerPeak, occupyLoftWorker, resetLoftWorkerPeak } from "./loft-worker-pool.js";

function insert(side: "left" | "right"): CadProductionInsert {
    return {
        designId: "ad1e0cc5-e221-443c-a477-2488b7f1c536",
        side,
        presetId: "apex-v2-insole-95a",
        idempotencyKey: `cadop:v1:pair-parallel:${side}`,
        settingsFingerprint: `fp-pair-parallel-${side}`,
        beltAngleDeg: 45,
        layerHeightMm: null,
        material: "apex_core",
    };
}

describe("CAD-operator pair lofts", () => {
    test("left and right lofts start together, before either foot reaches slice", async () => {
        resetLoftWorkerPeak();
        const store = new MemoryCadProductionStore();
        const now = new Date("2026-11-25T18:24:33.800Z");
        const marks: Array<{ side: "left" | "right"; event: "loft" | "slice"; at: number }> = [];
        const started = performance.now();

        async function run(side: "left" | "right"): Promise<void> {
            const claimed = await store.insert({
                ...insert(side),
                id:
                    side === "left"
                        ? "11111111-1111-4111-8111-111111111111"
                        : "22222222-2222-4222-8222-222222222222",
                status: "pending",
                gcodeStorageKey: null,
                error: null,
                createdAt: now,
                updatedAt: now,
                leaseExpiresAt: new Date(now.getTime() + 60_000),
                chargedAt: null,
                exportId: null,
                method: "printing_solid",
            });
            await executeCadOperatorProduction({
                row: claimed,
                store,
                now: () => new Date(),
                materialize: async () => {
                    const occupied = await occupyLoftWorker(200);
                    marks.push({ side, event: "loft", at: performance.now() - occupied.elapsedMs - started });
                    return { stlStorageKey: `tmp/${side}.stl`, meshFingerprint: "mesh" };
                },
                slice: async () => {
                    marks.push({ side, event: "slice", at: performance.now() - started });
                    return { gcode: "G1\n", jobId: `job-${side}` };
                },
                uploadGcode: async () => ({ storageKey: `gcode/${side}.gcode` }),
                charge: async () => ({ exportId: `exp-${side}`, balance: 1, alreadyCharged: false }),
            });
        }

        await Promise.all([run("left"), run("right")]);
        const leftSlice = marks.find((mark) => mark.side === "left" && mark.event === "slice");
        const rightLoft = marks.find((mark) => mark.side === "right" && mark.event === "loft");
        const leftLoft = marks.find((mark) => mark.side === "left" && mark.event === "loft");
        expect(leftLoft).toBeDefined();
        expect(rightLoft).toBeDefined();
        expect(leftSlice).toBeDefined();
        expect(loftWorkerPeak()).toBe(2);
        expect(Math.abs((leftLoft?.at ?? 0) - (rightLoft?.at ?? 0))).toBeLessThan(80);
        expect(rightLoft?.at ?? Number.POSITIVE_INFINITY).toBeLessThan((leftSlice?.at ?? 0) - 50);
    });

    test("a loft thread does not stretch the other foot's slice poll", async () => {
        const occupy = occupyLoftWorker(180);
        const gaps: number[] = [];
        let last = performance.now();
        for (let poll = 0; poll < 6; poll += 1) {
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 20);
            });
            const now = performance.now();
            gaps.push(now - last);
            last = now;
        }
        await occupy;
        expect(Math.max(...gaps)).toBeLessThan(80);
        expect(gaps.reduce((sum, gap) => sum + gap, 0)).toBeLessThan(180);
    });

    test("the pair response is returned while both lofts are still running", async () => {
        resetLoftWorkerPeak();
        const store = new MemoryCadProductionStore();
        const jobs: Array<Promise<void>> = [];
        const origin = performance.now();
        const responses: Array<{ side: "left" | "right"; at: number }> = [];

        async function foot(side: "left" | "right"): Promise<void> {
            if (side === "right") {
                await new Promise<void>((resolve) => {
                    setTimeout(resolve, 40);
                });
            }
            await beginCadOperatorProduction({
                store,
                insert: insert(side),
                now: new Date("2026-11-25T18:24:33.800Z"),
                schedule: (work) => {
                    jobs.push(work);
                },
                execute: async () => {
                    await occupyLoftWorker(250);
                },
            });
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 15);
            });
            responses.push({ side, at: performance.now() - origin });
        }

        try {
            await Promise.all([foot("left"), foot("right")]);
            expect(responses.map((entry) => entry.side).sort()).toEqual(["left", "right"]);
            expect(Math.max(...responses.map((entry) => entry.at))).toBeLessThan(150);
            expect(loftWorkerPeak()).toBe(2);
        } finally {
            await Promise.all(jobs);
        }
    });

    test("production materialize lofts off the request thread", () => {
        const source = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "../routers/manufacturing-cad.ts"),
            "utf8",
        );
        expect(source).toContain("buildHeadlessFinalizedFootOffThread");
        expect(source).not.toContain("buildHeadlessFinalizedFoot(");
    });
});
