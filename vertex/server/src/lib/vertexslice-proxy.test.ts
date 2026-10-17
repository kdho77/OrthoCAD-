// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { DEV_SUPER_ADMIN } from "./dev-auth";
import { createMockVertexSliceClient } from "./vertexslice-mock";
import { handleSlicerRequest, shouldUseMockSlicer } from "./vertexslice-proxy";

function authHeaders(): HeadersInit {
    return { authorization: `Bearer dev:${DEV_SUPER_ADMIN.id}` };
}

describe("shouldUseMockSlicer", () => {
    test("uses mock when URL is unset or SLICER_MOCK=1", () => {
        expect(shouldUseMockSlicer({})).toBe(true);
        expect(shouldUseMockSlicer({ VERTEXSLICE_URL: "" })).toBe(true);
        expect(shouldUseMockSlicer({ VERTEXSLICE_URL: "https://slice.example", SLICER_MOCK: "1" })).toBe(
            true,
        );
        expect(shouldUseMockSlicer({ VERTEXSLICE_URL: "https://slice.example" })).toBe(false);
    });
});

describe("handleSlicerRequest", () => {
    test("GET reports mock mode and never includes the API key", async () => {
        const res = await handleSlicerRequest(new Request("http://localhost/api/slicer"), {
            env: { VERTEXSLICE_URL: "", VERTEXSLICE_API_KEY: "secret-never-leak" },
        });
        const body = (await res.json()) as { ok: boolean; mock: boolean };
        expect(body.ok).toBe(true);
        expect(body.mock).toBe(true);
        expect(JSON.stringify(body)).not.toContain("secret-never-leak");
        expect(res.headers.get("X-Request-Id")).toBeTruthy();
    });

    test("POST mock success returns gcode, stats, and download filename", async () => {
        const res = await handleSlicerRequest(
            new Request("http://localhost/api/slicer", {
                method: "POST",
                headers: { "content-type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    profile_id: "apex-v2-insole-95a",
                    filename: "insole.stl",
                    modelBase64: Buffer.from([0, 1, 2]).toString("base64"),
                    material: "apex_core",
                    print_direction: "toe_first",
                    wall_loops: 1,
                }),
            }),
            { client: createMockVertexSliceClient(), env: {} },
        );
        const body = (await res.json()) as {
            ok: boolean;
            gcode: string;
            filename: string;
            stats: { layers: number };
            requestId: string;
        };
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.gcode).toContain("; material = ApexCore");
        expect(body.filename).toBe("insole_ApexCore_toefirst_1w.gcode");
        expect(body.stats.layers).toBe(42);
        expect(body.requestId).toBeTruthy();
        expect(JSON.stringify(body)).not.toContain("X-API-Key");
    });

    test("POST succeeds without an account (pay-per-file, nothing persisted)", async () => {
        const res = await handleSlicerRequest(
            new Request("http://localhost/api/slicer", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    filename: "insole.stl",
                    modelBase64: Buffer.from([0, 1, 2]).toString("base64"),
                    material: "apex_core",
                }),
            }),
            { client: createMockVertexSliceClient(), env: {} },
        );
        const body = (await res.json()) as { ok: boolean };
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
    });

    test("mock timeout and 5xx each return a request ID", async () => {
        const timeout = await handleSlicerRequest(
            new Request("http://localhost/api/slicer?fault=timeout", {
                method: "POST",
                headers: { "content-type": "application/json", ...authHeaders() },
                body: JSON.stringify({
                    filename: "insole.stl",
                    modelBase64: Buffer.from([0]).toString("base64"),
                    material: "apex_core",
                }),
            }),
            { env: {} },
        );
        const timeoutBody = (await timeout.json()) as {
            ok: false;
            error: { code: string; requestId: string };
        };
        expect(timeout.status).toBe(504);
        expect(timeoutBody.error.code).toBe("timeout");
        expect(timeoutBody.error.requestId).toBeTruthy();

        const five = await handleSlicerRequest(
            new Request("http://localhost/api/slicer?fault=5xx", {
                method: "POST",
                headers: { "content-type": "application/json", "X-Slicer-Fault": "5xx", ...authHeaders() },
                body: JSON.stringify({
                    filename: "insole.stl",
                    modelBase64: Buffer.from([0]).toString("base64"),
                    material: "apex_core",
                }),
            }),
            { env: {} },
        );
        const fiveBody = (await five.json()) as {
            ok: false;
            error: { code: string; cause: string; requestId: string };
        };
        expect(five.status).toBe(502);
        expect(fiveBody.error.code).toBe("auth_config");
        expect(fiveBody.error.cause).toContain("Something on our side");
        expect(fiveBody.error.requestId).toBeTruthy();
    });
});
