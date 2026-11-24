// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { taperedInsoleStl } from "../../../shared/slicer/tapered-insole-fixture";
import type { VertexSliceSliceInput } from "../../../shared/vertexslice/contract";
import { LEADER_SUFFIX_TRIANGLE_COUNT } from "../../../src/lib/geometry/leader-block";
import { DEV_SUPER_ADMIN } from "./dev-auth";
import { createMockVertexSliceClient } from "./vertexslice-mock";
import { handleSlicerRequest, shouldUseMockSlicer } from "./vertexslice-proxy";

function authHeaders(): HeadersInit {
    return { authorization: `Bearer dev:${DEV_SUPER_ADMIN.id}` };
}

describe("shouldUseMockSlicer", () => {
    test("uses mock when the VertexSlice env is unset or SLICER_MOCK=1", () => {
        expect(shouldUseMockSlicer({})).toBe(true);
        expect(shouldUseMockSlicer({ VERTEXSLICE_SLICER_URL: "" })).toBe(true);
        expect(shouldUseMockSlicer({ VERTEXSLICE_SLICER_URL: "https://slice.example" })).toBe(true);
        expect(
            shouldUseMockSlicer({
                VERTEXSLICE_SLICER_URL: "https://slice.example",
                VERTEXSLICE_API_KEY: "secret-never-leak",
                SLICER_MOCK: "1",
            }),
        ).toBe(true);
        expect(
            shouldUseMockSlicer({
                VERTEXSLICE_SLICER_URL: "https://slice.example",
                VERTEXSLICE_API_KEY: "secret-never-leak",
            }),
        ).toBe(false);
    });
});

describe("handleSlicerRequest", () => {
    test("GET reports mock mode and never includes the API key", async () => {
        const res = await handleSlicerRequest(new Request("http://localhost/api/slicer"), {
            env: { VERTEXSLICE_SLICER_URL: "", VERTEXSLICE_API_KEY: "secret-never-leak" },
        });
        const body = (await res.json()) as {
            ok: boolean;
            mock: boolean;
            payMock: boolean;
            unitAmountCents: number;
        };
        expect(body.ok).toBe(true);
        expect(body.mock).toBe(true);
        expect(body.payMock).toBe(true);
        expect(body.unitAmountCents).toBe(800);
        expect(JSON.stringify(body)).not.toContain("secret-never-leak");
        expect(res.headers.get("X-Request-Id")).toBeTruthy();
    });

    test("POST mock success returns a sealed slice, stats, and download filename", async () => {
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
            sealed: string;
            gcode?: string;
            filename: string;
            stats: { layers: number };
            requestId: string;
        };
        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.gcode).toBeUndefined();
        expect(body.sealed.length).toBeGreaterThan(20);
        expect(JSON.stringify(body)).not.toContain("; material = ApexCore");
        expect(body.filename).toBe("insole_ApexCore_toefirst_1w.gcode");
        expect(body.stats.layers).toBe(42);
        expect(body.requestId).toBeTruthy();
        expect(JSON.stringify(body)).not.toContain("X-API-Key");
        expect(JSON.stringify(body)).not.toContain("secret-never-leak");
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

describe("slicer pay route", () => {
    test("download is refused without a paid session, and mock pay still unlocks when Stripe is unset", async () => {
        const sliced = await handleSlicerRequest(
            new Request("http://localhost/api/slicer", {
                method: "POST",
                headers: { "content-type": "application/json", origin: "http://localhost" },
                body: JSON.stringify({
                    filename: "insole.stl",
                    modelBase64: Buffer.from([0, 1, 2]).toString("base64"),
                    material: "apex_core",
                }),
            }),
            { client: createMockVertexSliceClient(), env: {} },
        );
        const sliceBody = (await sliced.json()) as { ok: boolean; sealed: string };
        expect(sliceBody.ok).toBe(true);
        expect(JSON.stringify(sliceBody)).not.toContain("; material = ApexCore");

        const refused = await handleSlicerRequest(
            new Request("http://localhost/api/slicer?action=download", {
                method: "POST",
                headers: { "content-type": "application/json", ...authHeaders() },
                body: JSON.stringify({ sealed: sliceBody.sealed, sessionId: "" }),
            }),
            { env: {} },
        );
        expect(refused.status).toBe(402);

        const checkout = await handleSlicerRequest(
            new Request("http://localhost/api/slicer?action=checkout", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    origin: "http://localhost",
                    ...authHeaders(),
                },
                body: JSON.stringify({ seals: [sliceBody.sealed] }),
            }),
            { env: {} },
        );
        const checkoutBody = (await checkout.json()) as { ok: boolean; mock: boolean; sessionId: string };
        expect(checkout.status).toBe(200);
        expect(checkoutBody.mock).toBe(true);

        const paid = await handleSlicerRequest(
            new Request("http://localhost/api/slicer?action=download", {
                method: "POST",
                headers: { "content-type": "application/json", ...authHeaders() },
                body: JSON.stringify({ sealed: sliceBody.sealed, sessionId: checkoutBody.sessionId }),
            }),
            { env: {} },
        );
        const paidBody = (await paid.json()) as { ok: boolean; files: Array<{ gcode: string }> };
        expect(paid.status).toBe(200);
        expect(paidBody.files[0]?.gcode).toContain("; material = ApexCore");
        expect(JSON.stringify(paidBody)).not.toContain("secret-never-leak");
    });
});

describe("slicer sacrificial leader flag", () => {
    function capturingClient() {
        let seen: Uint8Array | null = null;
        const inner = createMockVertexSliceClient();
        return {
            seen: () => seen,
            client: {
                health: () => inner.health(),
                materials: () => inner.materials(),
                profiles: () => inner.profiles(),
                async slice(input: VertexSliceSliceInput, init?: { signal?: AbortSignal }) {
                    const model = input.model;
                    seen =
                        model instanceof Uint8Array
                            ? model
                            : model instanceof ArrayBuffer
                              ? new Uint8Array(model)
                              : new Uint8Array(await model.arrayBuffer());
                    return inner.slice(input, init);
                },
            },
        };
    }

    test("the leader flag off leaves the uploaded bytes unchanged", async () => {
        const raw = taperedInsoleStl();
        const capture = capturingClient();
        const res = await handleSlicerRequest(
            new Request("http://localhost/api/slicer", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    filename: "insole.stl",
                    modelBase64: Buffer.from(raw).toString("base64"),
                    material: "apex_core",
                    print_direction: "toe_first",
                    sacrificial_leader: false,
                }),
            }),
            { client: capture.client, env: {} },
        );
        expect(res.status).toBe(200);
        const seen = capture.seen();
        expect(seen).not.toBeNull();
        expect(Buffer.from(seen ?? []).equals(Buffer.from(raw))).toBe(true);
    });

    test("the leader flag on sends the CAD leader and a bad orientation is refused", async () => {
        const raw = taperedInsoleStl();
        const before = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(80, true);
        const capture = capturingClient();
        const res = await handleSlicerRequest(
            new Request("http://localhost/api/slicer", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    filename: "insole.stl",
                    modelBase64: Buffer.from(raw).toString("base64"),
                    material: "apex_core",
                    print_direction: "toe_first",
                    sacrificial_leader: true,
                }),
            }),
            { client: capture.client, env: {} },
        );
        expect(res.status).toBe(200);
        const seen = capture.seen();
        expect(seen).not.toBeNull();
        expect(new DataView(seen?.buffer, seen?.byteOffset, seen?.byteLength).getUint32(80, true)).toBe(
            before + LEADER_SUFFIX_TRIANGLE_COUNT,
        );

        const refused = await handleSlicerRequest(
            new Request("http://localhost/api/slicer", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    filename: "cube.stl",
                    modelBase64: Buffer.from(raw).toString("base64"),
                    material: "apex_core",
                    print_direction: "heel_first",
                    sacrificial_leader: true,
                }),
            }),
            { client: capture.client, env: {} },
        );
        expect(refused.status).toBe(400);
        const body = (await refused.json()) as { ok: boolean; error: { cause: string } };
        expect(body.ok).toBe(false);
        expect(body.error.cause).toContain("thinner toe");
    });
});
