// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { nextSlicePollDelayMs } from "../../../shared/slice-job";
import { mintIdempotencyKey, pollSliceJob, retrySameKey } from "./slice-poll";

describe("slice status polling", () => {
    test("backoff starts at 2s and caps at 10s", () => {
        expect(nextSlicePollDelayMs(0)).toBe(2000);
        expect(nextSlicePollDelayMs(1)).toBe(3000);
        expect(nextSlicePollDelayMs(2)).toBe(4500);
        expect(nextSlicePollDelayMs(4)).toBe(10000);
        expect(nextSlicePollDelayMs(8)).toBe(10000);
    });

    test("poll waits with backoff and stops on success", async () => {
        const delays: number[] = [];
        let t = 0;
        let reads = 0;
        const result = await pollSliceJob({
            jobId: "job-1",
            now: () => t,
            sleep: async (ms) => {
                delays.push(ms);
                t += ms;
            },
            read: async () => {
                reads += 1;
                if (reads < 3) return { status: "running" };
                return { status: "succeeded", downloadUrl: "https://example.test/gcode" };
            },
        });
        expect(result.status).toBe("succeeded");
        expect(result.downloadUrl).toContain("gcode");
        expect(delays[0]).toBe(2000);
        expect(delays[1]).toBe(3000);
    });

    test("poll gives up as failed when the deadline passes", async () => {
        let t = 0;
        const result = await pollSliceJob({
            jobId: "job-2",
            deadlineMs: 2500,
            now: () => t,
            sleep: async (ms) => {
                t += ms;
            },
            read: async () => ({ status: "queued" }),
        });
        expect(result.status).toBe("failed");
        expect(result.error).toMatch(/timed out/i);
    });

    test("retries reuse one idempotency key", async () => {
        const key = mintIdempotencyKey();
        const seen: string[] = [];
        let tries = 0;
        const value = await retrySameKey(
            key,
            async (idempotencyKey) => {
                seen.push(idempotencyKey);
                tries += 1;
                if (tries < 3) throw new Error("network down");
                return "ok";
            },
            { retries: 2, sleep: async () => undefined },
        );
        expect(value).toBe("ok");
        expect(seen).toEqual([key, key, key]);
    });

    test("insufficient tokens is not retried", async () => {
        let tries = 0;
        await expect(
            retrySameKey(
                mintIdempotencyKey(),
                async () => {
                    tries += 1;
                    throw new Error("Insufficient export tokens");
                },
                { retries: 2, sleep: async () => undefined },
            ),
        ).rejects.toThrow(/Insufficient/);
        expect(tries).toBe(1);
    });
});
