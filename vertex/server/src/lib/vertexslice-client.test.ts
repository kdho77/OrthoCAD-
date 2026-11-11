// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../../shared/print-recipe/print-recipe";
import {
    assertEnabledVertexSliceMaterial,
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
        const model = writeTimeoutStl();
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_light",
                model,
                sliceTimeoutMs: 40,
                side: "left",
            }),
        ).rejects.toThrow("VertexSlice timed out after 1s (left)");
        const logged = errors.flat().find((item) => item === "[vertexslice] mesh at timeout");
        expect(logged).toBe("[vertexslice] mesh at timeout");
        const stats = errors
            .flat()
            .find((item) => item && typeof item === "object" && "triangles" in item) as {
            bytes: number;
            triangles: number;
            bbox: { minX: number; maxX: number };
            manifold: { isWatertight: boolean };
        };
        expect(stats.bytes).toBe(model.byteLength);
        expect(stats.triangles).toBe(12);
        expect(stats.bbox.maxX).toBeGreaterThan(stats.bbox.minX);
        expect(stats.manifold.isWatertight).toBe(true);
        expect(stats.manifold).toMatchObject({ shells: 1 });
        spy.mockRestore();
    });

    test("an off-plate mesh is refused before POST /v1/slice", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_light"]), { status: 200 });
            }
            return new Response("sliced", { status: 200 });
        });
        const model = writeTimeoutStl();
        new DataView(model.buffer).setFloat32(96, 50_000, true);
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_light",
                model,
            }),
        ).rejects.toThrow(/Manufacturing mesh is not sliceable/);
        expect(calls.some((call) => call.url.endsWith("/v1/slice"))).toBe(false);
    });
});

function writeTimeoutStl(): Uint8Array {
    const v = [
        [0, 0, 0],
        [20, 0, 0],
        [20, 10, 0],
        [0, 10, 0],
        [0, 0, 8],
        [20, 0, 8],
        [20, 10, 8],
        [0, 10, 8],
    ];
    const faces = [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ];
    const out = new Uint8Array(84 + faces.length * 50);
    const view = new DataView(out.buffer);
    view.setUint32(80, faces.length, true);
    let offset = 84;
    const put = (x: number, y: number, z: number) => {
        view.setFloat32(offset, x, true);
        offset += 4;
        view.setFloat32(offset, y, true);
        offset += 4;
        view.setFloat32(offset, z, true);
        offset += 4;
    };
    for (const [a, b, c] of faces) {
        put(0, 0, 0);
        for (const i of [a, b, c]) {
            const p = v[i]!;
            put(p[0]!, p[1]!, p[2]!);
        }
        offset += 2;
    }
    return out;
}
