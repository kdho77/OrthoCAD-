// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { submitVertexSliceJob } from "../../vertex/server/src/lib/vertexslice-client.js";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../vertex/shared/print-recipe/print-recipe.js";
import { installFetch, restoreFetch } from "./helpers/fetch-mock.js";

afterEach(() => {
    restoreFetch();
});

describe("G3 — throwSliceHttpError 4xx/5xx not retried", () => {
    const model = new Uint8Array([1, 2, 3]);

    async function expectSingleJobPost(status: number, body: string, pattern: RegExp): Promise<void> {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "gate-test-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (url.endsWith("/v1/slice/jobs")) {
                return new Response(body, { status, headers: { "content-type": "application/json" } });
            }
            return new Response("unexpected", { status: 500 });
        });
        await expect(
            submitVertexSliceJob({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_core",
                model,
            }),
        ).rejects.toThrow(pattern);
        expect(calls.filter((c) => c.url.endsWith("/v1/slice/jobs"))).toHaveLength(1);
    }

    test("HTTP 400 — one POST", async () => {
        await expectSingleJobPost(400, JSON.stringify({ detail: "rejected" }), /VertexSlice error \(400\)/);
    });

    test("HTTP 422 — one POST", async () => {
        await expectSingleJobPost(422, JSON.stringify({ detail: "bad mesh" }), /VertexSlice error \(422\)/);
    });

    test("HTTP 500 — one POST", async () => {
        await expectSingleJobPost(500, JSON.stringify({ detail: "server" }), /VertexSlice error \(500\)/);
    });
});
