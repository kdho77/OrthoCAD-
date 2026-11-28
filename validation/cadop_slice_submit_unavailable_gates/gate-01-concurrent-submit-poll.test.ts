// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { submitVertexSliceJob } from "../../vertex/server/src/lib/vertexslice-client.js";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../vertex/shared/print-recipe/print-recipe.js";
import { installFetch, restoreFetch } from "./helpers/fetch-mock.js";
import { pollJobToTerminalGcode } from "./helpers/poll-job.js";
import { triangleStl } from "./helpers/triangle-stl.js";

afterEach(() => {
    restoreFetch();
});

describe("G1 — concurrent submits accepted and both polled to completion", () => {
    const model = triangleStl([0, 0, 0, 120, 0, 0, 0, 40, 8]);

    test("Promise.all of two submits: each 202, distinct job ids, both polled to succeeded + gcode", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "gate-test-key";
        let posted = 0;
        const polledJobIds: string[] = [];
        installFetch((url, init) => {
            const method = (init.method ?? "GET").toUpperCase();
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (method === "POST" && url.endsWith("/v1/slice/jobs")) {
                posted += 1;
                const jobId = `gate-job-${posted}`;
                return new Response(JSON.stringify({ job_id: jobId, status: "queued", position: posted }), {
                    status: 202,
                    headers: { "content-type": "application/json" },
                });
            }
            if (method === "GET" && url.includes("/v1/slice/jobs/gate-job-") && !url.endsWith("/result")) {
                const jobId = url.split("/").pop() ?? "";
                return new Response(
                    JSON.stringify({
                        job_id: jobId,
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
            if (url.endsWith("/result")) {
                const jobId = url.split("/").slice(-2, -1)[0] ?? "";
                polledJobIds.push(jobId);
                return new Response(`;gcode-${jobId}\n`, { status: 200 });
            }
            return new Response("unexpected", { status: 500 });
        });

        const requestBase = {
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_core" as const,
            model,
            infillDensityPct: 32,
        };
        const [left, right] = await Promise.all([
            submitVertexSliceJob({ ...requestBase, filename: "left.stl", side: "left" }),
            submitVertexSliceJob({ ...requestBase, filename: "right.stl", side: "right" }),
        ]);
        expect(left.kind).toBe("accepted");
        expect(right.kind).toBe("accepted");
        if (left.kind !== "accepted" || right.kind !== "accepted") {
            throw new Error("G1: concurrent submits were not both accepted");
        }
        expect(posted).toBe(2);
        expect(left.jobId).not.toBe(right.jobId);

        const gcodes = await Promise.all([
            pollJobToTerminalGcode(left.jobId),
            pollJobToTerminalGcode(right.jobId),
        ]);
        expect(gcodes[0]).toContain(left.jobId);
        expect(gcodes[1]).toContain(right.jobId);
        expect(new Set(polledJobIds)).toEqual(new Set([left.jobId, right.jobId]));
    });

    test("slow materials prep must not abort POST before 202 (pair-style 50s prep)", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "gate-test-key";
        rs.useFakeTimers();
        let posted = 0;
        const postSignals: AbortSignal[] = [];
        installFetch((url, init) => {
            if (url.endsWith("/v1/materials")) {
                return new Promise((resolve) => {
                    setTimeout(() => {
                        resolve(new Response(JSON.stringify(["apex_core"]), { status: 200 }));
                    }, 50_000);
                });
            }
            if (url.endsWith("/v1/slice/jobs")) {
                return new Promise((resolve, reject) => {
                    const signal = init.signal;
                    if (!signal) {
                        reject(new Error("POST without deadline"));
                        return;
                    }
                    postSignals.push(signal);
                    const timer = setTimeout(() => {
                        if (signal.aborted) {
                            reject(signal.reason ?? new Error("POST aborted before 202"));
                            return;
                        }
                        posted += 1;
                        resolve(
                            new Response(
                                JSON.stringify({
                                    job_id: `late-${posted}`,
                                    status: "queued",
                                    position: posted,
                                }),
                                { status: 202 },
                            ),
                        );
                    }, 21_000);
                    signal.addEventListener(
                        "abort",
                        () => {
                            clearTimeout(timer);
                            reject(signal.reason ?? new Error("POST aborted"));
                        },
                        { once: true },
                    );
                });
            }
            return new Response("unexpected", { status: 500 });
        });

        const pending = Promise.all([
            submitVertexSliceJob({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_core",
                model,
                filename: "left.stl",
                side: "left",
            }),
            submitVertexSliceJob({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_core",
                model,
                filename: "right.stl",
                side: "right",
            }),
        ]);
        await rs.advanceTimersByTimeAsync(49_000);
        expect(posted).toBe(0);
        expect(postSignals).toHaveLength(0);
        await rs.advanceTimersByTimeAsync(1_000);
        expect(postSignals).toHaveLength(2);
        expect(postSignals.every((s) => !s.aborted)).toBe(true);
        await rs.advanceTimersByTimeAsync(21_000);
        const [left, right] = await pending;
        expect(posted).toBe(2);
        expect(left.kind).toBe("accepted");
        expect(right.kind).toBe("accepted");
        if (left.kind !== "accepted" || right.kind !== "accepted") {
            throw new Error("G1 pair prep: submits not accepted");
        }
        expect(postSignals.every((s) => !s.aborted)).toBe(true);
    });
});
