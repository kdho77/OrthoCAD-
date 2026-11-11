// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../../shared/print-recipe/print-recipe";
import {
    assertEnabledVertexSliceMaterial,
    inspectManufacturingStl,
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

    test("Apex Bounce is allowed and Forge is refused before any slicer call", () => {
        expect(assertEnabledVertexSliceMaterial("apex_bounce")).toBe("apex_bounce");
        expect(() => assertEnabledVertexSliceMaterial("apex_forge")).toThrow(
            /disabled until print settings/i,
        );
        expect(() => assertEnabledVertexSliceMaterial("TPU 95A")).toThrow(/Apex Core/);
    });

    test("Apex Bounce slice sends the material id and no process override", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core", "apex_bounce"]), { status: 200 });
            }
            return new Response("G1 X0\n", { status: 200 });
        });
        const gcode = await sliceWithVertexSlice({
            profileId: "apex-v2-insole-95a",
            material: "apex_bounce",
            model: new Uint8Array([1, 2, 3]),
            infillDensityPct: 26,
        });
        expect(gcode).toContain("G1");
        const form = calls.find((call) => call.url.endsWith("/v1/slice"))?.init.body as FormData;
        expect(form.get("material")).toBe("apex_bounce");
        expect(form.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(form.get("nozzle_temp")).toBeNull();
        expect(form.get("bed_temp")).toBeNull();
        expect(form.get("print_speed")).toBeNull();
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

    test("POST /v1/slice sends locked profile, material, PrintRecipe infill, and X-API-Key", async () => {
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
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_light",
            model: new Uint8Array([1, 2, 3, 4]),
            infillDensityPct: 26,
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
        expect(form.get("infill_density")).toBe("26");
        expect(form.get("model")).toBeTruthy();
        expect(form.get("wall_loops")).toBeNull();
        expect(form.get("print_direction")).toBeNull();
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

    test("POST /v1/slice aborts when sliceTimeoutMs elapses", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        installFetch((url, init) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core", "apex_light"]), { status: 200 });
            }
            if (url.endsWith("/v1/slice")) {
                expect(init.signal).toBeTruthy();
                return new Promise<Response>((_resolve, reject) => {
                    const signal = init.signal;
                    if (!signal) {
                        reject(new Error("expected AbortSignal on slice fetch"));
                        return;
                    }
                    const onDeadline = () => {
                        reject(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
                    };
                    if (signal.aborted) {
                        onDeadline();
                        return;
                    }
                    signal.addEventListener("abort", onDeadline, { once: true });
                });
            }
            return new Response("unexpected", { status: 500 });
        });

        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_light",
                model: new Uint8Array([1]),
                sliceTimeoutMs: 40,
                side: "left",
            }),
        ).rejects.toThrow("VertexSlice timed out after 1s (left)");
    });

    test("a binary STL outside a single foot fails before any slicer call", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch(() => new Response("nope", { status: 500 }));
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_light",
                model: triangleStl([0, 0, 0, 10_000, 0, 0, 0, 1, 0]),
                infillDensityPct: 26,
                sliceTimeoutMs: 1_000,
                side: "left",
            }),
        ).rejects.toThrow(/Manufacturing STL bounding box is 10000×1×0 mm/);
        expect(calls).toHaveLength(0);
        const degenerate = inspectManufacturingStl(triangleStl([0, 0, 0, 0, 0, 0, 0, 0, 0]));
        expect(degenerate.problem).toMatch(/degenerate/);
        const placeholder = inspectManufacturingStl(new Uint8Array([1, 2, 3]));
        expect(placeholder.binary).toBe(false);
        expect(placeholder.problem).toBeNull();
    });

    test("a foot-sized binary STL still posts infill and the locked profile", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_light"]), { status: 200 });
            }
            return new Response("G1 X0\n", { status: 200 });
        });
        const gcode = await sliceWithVertexSlice({
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_light",
            model: triangleStl([0, 0, 0, 120, 0, 0, 0, 40, 8]),
            infillDensityPct: 26,
        });
        expect(gcode).toContain("G1");
        const form = calls.find((call) => call.url.endsWith("/v1/slice"))?.init.body as FormData;
        expect(form.get("infill_density")).toBe("26");
        expect(form.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(form.get("material")).toBe("apex_light");
        expect(form.get("wall_loops")).toBeNull();
    });

    test("a slice timeout logs mesh bytes, triangles, bounds, and the manifold check", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const errors: unknown[] = [];
        const spy = rs.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
            errors.push(args);
        });
        installFetch((url, init) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_light"]), { status: 200 });
            }
            return new Promise<Response>((_resolve, reject) => {
                init.signal?.addEventListener(
                    "abort",
                    () =>
                        reject(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
                    { once: true },
                );
            });
        });
        const model = triangleStl([0, 0, 0, 120, 0, 0, 0, 40, 8]);
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_light",
                model,
                sliceTimeoutMs: 40,
                side: "left",
            }),
        ).rejects.toThrow("VertexSlice timed out after 1s (left)");
        expect(errors.flat()).toContain("[vertexslice] mesh at timeout");
        const stats = errors
            .flat()
            .find((item) => item && typeof item === "object" && "triangles" in item) as {
            bytes: number;
            triangles: number;
            bbox: { minX: number; maxX: number };
            manifold: { openEdges: number };
        };
        expect(stats.bytes).toBe(model.byteLength);
        expect(stats.triangles).toBe(1);
        expect(stats.bbox.maxX).toBeGreaterThan(stats.bbox.minX);
        expect(stats.manifold.openEdges).toBeGreaterThan(0);
        spy.mockRestore();
    });

    test("a mesh past the belt plate is refused before any slicer call", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch(() => new Response("nope", { status: 500 }));
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_light",
                model: triangleStl([600, 0, 0, 600.2, 0, 0, 600, 0.2, 0]),
            }),
        ).rejects.toThrow(/Manufacturing mesh is not sliceable/);
        expect(calls).toHaveLength(0);
    });
});

function triangleStl(verts: number[]): Uint8Array {
    const buf = Buffer.alloc(84 + 50);
    buf.writeUInt32LE(1, 80);
    for (let i = 0; i < 9; i++) buf.writeFloatLE(verts[i] ?? 0, 84 + 12 + i * 4);
    return new Uint8Array(buf);
}
