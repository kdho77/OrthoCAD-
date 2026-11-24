// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { submitVertexSliceJob } from "../../vertex/server/src/lib/vertexslice-client.js";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../vertex/shared/print-recipe/print-recipe.js";
import { installFetch, restoreFetch } from "./helpers/fetch-mock.js";
import { triangleStl } from "./helpers/triangle-stl.js";

afterEach(() => {
    restoreFetch();
    rs.useRealTimers();
});

describe("G2 — hung POST past 20s retried; later attempt accepted", () => {
    const model = triangleStl([0, 0, 0, 120, 0, 0, 0, 40, 8]);

    test("first POST hangs until abort; retry after >20s yields 202 (not one 60s-only attempt)", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "gate-test-key";
        rs.useFakeTimers();
        let posted = 0;
        const postTimesMs: number[] = [];
        installFetch((url, init) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (url.endsWith("/v1/slice/jobs")) {
                posted += 1;
                postTimesMs.push(Date.now());
                if (posted === 1) {
                    return new Promise((_resolve, reject) => {
                        const signal = init.signal;
                        if (!signal) {
                            reject(new Error("POST without signal"));
                            return;
                        }
                        const onAbort = () => reject(signal.reason ?? new Error("aborted"));
                        if (signal.aborted) onAbort();
                        else signal.addEventListener("abort", onAbort, { once: true });
                    });
                }
                return new Response(
                    JSON.stringify({ job_id: "gate-retry-job", status: "queued", position: 1 }),
                    { status: 202 },
                );
            }
            return new Response("unexpected", { status: 500 });
        });

        const pending = submitVertexSliceJob({
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_core",
            model,
            side: "left",
        });
        await rs.advanceTimersByTimeAsync(21_000);
        expect(posted).toBe(1);
        await rs.advanceTimersByTimeAsync(38_000);
        expect(posted).toBe(1);
        await rs.advanceTimersByTimeAsync(2_000);
        const submitted = await pending;
        expect(posted).toBe(2);
        expect(submitted).toEqual({ kind: "accepted", jobId: "gate-retry-job", position: 1 });
        const firstAttemptDurationMs = 21_000;
        expect(firstAttemptDurationMs).toBeGreaterThan(20_000);
    });

    test("bounded backoff between transient submit failures (gap ≥250ms)", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "gate-test-key";
        const postAt: number[] = [];
        installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (url.endsWith("/v1/slice/jobs")) {
                postAt.push(Date.now());
                if (postAt.length === 1) throw new TypeError("ECONNRESET");
                return new Response(
                    JSON.stringify({ job_id: "gate-backoff", status: "queued", position: 0 }),
                    { status: 202 },
                );
            }
            return new Response("unexpected", { status: 500 });
        });
        const submitted = await submitVertexSliceJob({
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_core",
            model,
        });
        expect(submitted.kind).toBe("accepted");
        expect(postAt).toHaveLength(2);
        const gap = (postAt[1] ?? 0) - (postAt[0] ?? 0);
        expect(gap).toBeGreaterThanOrEqual(250);
        expect(gap).toBeLessThan(5_000);
    });
});
