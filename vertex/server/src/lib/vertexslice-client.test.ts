// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import {
    manufacturingBackendForOutput,
    materialIdsFromPayload,
    sliceWithVertexSlice,
} from "./vertexslice-client.js";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    delete process.env.VERTEXSLICE_SLICER_URL;
    delete process.env.VERTEXSLICE_API_KEY;
});

function installFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const request = init ?? {};
        calls.push({ url, init: request });
        return handler(url, request);
    }) as typeof fetch;
    return calls;
}

describe("VertexSlice printer G-code client", () => {
    test("printer G-code uses VertexSlice and STL stays on the Python service", () => {
        expect(manufacturingBackendForOutput("gcode")).toBe("vertexslice");
        expect(manufacturingBackendForOutput("stl")).toBe("python");
    });

    test("reads material ids from a list or a map", () => {
        expect(materialIdsFromPayload(["apex_core", "apex_light"])).toEqual(["apex_core", "apex_light"]);
        expect(
            materialIdsFromPayload({
                materials: [{ id: "apex_core" }, { id: "apex_light", shore: "90A" }],
            }),
        ).toEqual(["apex_core", "apex_light"]);
        expect(
            materialIdsFromPayload({
                materials: { apex_core: { nozzle: 225 }, apex_light: { nozzle: 260 } },
            }),
        ).toEqual(["apex_core", "apex_light"]);
        expect(materialIdsFromPayload({ message: "nope" })).toBeNull();
    });

    test("POST /v1/slice sends profile, STL, material, and X-API-Key", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example/";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify({ materials: ["apex_core", "apex_light"] }), {
                    status: 200,
                });
            }
            return new Response("SLICE_OK", { status: 200 });
        });

        const gcode = await sliceWithVertexSlice({
            profileId: "apex-v2-insole-95a",
            material: "apex_light",
            model: new Uint8Array([1, 2, 3, 4]),
        });

        expect(gcode).toBe("SLICE_OK");
        expect(calls.map((call) => call.url)).toEqual([
            "https://slicer.example/v1/materials",
            "https://slicer.example/v1/slice",
        ]);
        const slice = calls[1];
        expect(slice).toBeDefined();
        if (!slice) return;
        const headers = new Headers(slice.init.headers);
        expect(headers.get("x-api-key")).toBe("super-secret-key");
        expect(slice.init.method).toBe("POST");
        const form = slice.init.body as FormData;
        expect(form.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(form.get("material")).toBe("apex_light");
        expect(form.get("model")).toBeTruthy();
        expect(form.get("wall_loops")).toBeNull();
        expect(form.get("infill_density")).toBeNull();
        expect(calls.map((call) => call.url).join(" ")).not.toContain("super-secret-key");
    });

    test("fails closed when /v1/materials does not list the material and does not slice", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch(
            () =>
                new Response(JSON.stringify({ materials: ["apex_core", "apex_forge", "apex_bounce"] }), {
                    status: 200,
                }),
        );

        await expect(
            sliceWithVertexSlice({
                profileId: "apex-v2-insole-95a",
                material: "apex_light",
                model: new Uint8Array([1]),
            }),
        ).rejects.toMatchObject({
            message: "Material apex_light not available on slicer",
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("https://slicer.example/v1/materials");
    });

    test("slice rejection of the material does not fall back to apex_core", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core", "apex_light"]), { status: 200 });
            }
            return new Response(JSON.stringify({ detail: "Unknown material apex_light" }), {
                status: 400,
                statusText: "Bad Request",
            });
        });

        try {
            await sliceWithVertexSlice({
                profileId: "apex-v2-insole-95a",
                material: "apex_light",
                model: new Uint8Array([1]),
            });
            throw new Error("expected slice to fail");
        } catch (err) {
            expect(err).toBeInstanceOf(TRPCError);
            expect((err as TRPCError).message).toBe(
                "Material apex_light not available on slicer: Unknown material apex_light",
            );
        }
        const sliceCalls = calls.filter((call) => call.url.endsWith("/v1/slice"));
        expect(sliceCalls).toHaveLength(1);
        expect((sliceCalls[0]?.init.body as FormData).get("material")).toBe("apex_light");
    });

    test("shows the real VertexSlice error text for non-material failures", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_light"]), { status: 200 });
            }
            return new Response(JSON.stringify({ message: "slicer engine offline" }), {
                status: 503,
                statusText: "Service Unavailable",
            });
        });

        await expect(
            sliceWithVertexSlice({
                profileId: "apex-v2-insole-95a",
                material: "apex_light",
                model: new Uint8Array([1]),
            }),
        ).rejects.toThrow("VertexSlice error (503): slicer engine offline");
    });
});
