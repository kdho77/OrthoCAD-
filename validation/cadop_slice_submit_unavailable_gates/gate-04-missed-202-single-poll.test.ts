// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { submitVertexSliceJob } from "../../vertex/server/src/lib/vertexslice-client.js";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../vertex/shared/print-recipe/print-recipe.js";
import { installFetch, restoreFetch } from "./helpers/fetch-mock.js";
import { pollJobToTerminalGcode } from "./helpers/poll-job.js";

afterEach(() => {
    restoreFetch();
});

describe("G4 — missed 202 then retry: poll exactly one job to completion", () => {
    const model = new Uint8Array([9, 9, 9]);
    const metrics: { enqueuedJobIds: string[]; polledToCompletion: string[] } = {
        enqueuedJobIds: [],
        polledToCompletion: [],
    };

    test("first POST queues job-orphan but client loses 202; retry accepts job-live; one poll to gcode", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "gate-test-key";
        let postAttempt = 0;
        installFetch((url, init) => {
            const method = (init.method ?? "GET").toUpperCase();
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (method === "POST" && url.endsWith("/v1/slice/jobs")) {
                postAttempt += 1;
                if (postAttempt === 1) {
                    metrics.enqueuedJobIds.push("job-orphan");
                    return new Promise((_resolve, reject) => {
                        const signal = init.signal;
                        if (!signal) {
                            reject(new Error("no signal"));
                            return;
                        }
                        const abort = () => {
                            reject(
                                new DOMException("The operation was aborted due to timeout", "TimeoutError"),
                            );
                        };
                        if (signal.aborted) abort();
                        else signal.addEventListener("abort", abort, { once: true });
                    });
                }
                metrics.enqueuedJobIds.push("job-live");
                return new Response(JSON.stringify({ job_id: "job-live", status: "queued", position: 1 }), {
                    status: 202,
                });
            }
            if (method === "GET" && url.endsWith("/v1/slice/jobs/job-live")) {
                return new Response(
                    JSON.stringify({
                        job_id: "job-live",
                        status: "succeeded",
                        position: null,
                        queued_at: null,
                        started_at: null,
                        finished_at: null,
                        elapsed_s: 1,
                        error: null,
                    }),
                    { status: 200 },
                );
            }
            if (url.endsWith("/v1/slice/jobs/job-live/result")) {
                metrics.polledToCompletion.push("job-live");
                return new Response("G1 gate-live\n", { status: 200 });
            }
            if (url.includes("job-orphan")) {
                throw new Error("G4: client must not poll the orphan job");
            }
            return new Response("unexpected", { status: 500 });
        });

        const submitted = await submitVertexSliceJob({
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_core",
            model,
            side: "left",
        });
        expect(submitted).toEqual({ kind: "accepted", jobId: "job-live", position: 1 });
        const gcode = await pollJobToTerminalGcode("job-live");
        expect(gcode).toContain("gate-live");

        expect(metrics.enqueuedJobIds).toEqual(["job-orphan", "job-live"]);
        expect(metrics.polledToCompletion).toEqual(["job-live"]);
        expect(metrics.polledToCompletion).toHaveLength(1);
        const orphanResidual = metrics.enqueuedJobIds.length - metrics.polledToCompletion.length;
        expect(orphanResidual).toBe(1);
    });
});
