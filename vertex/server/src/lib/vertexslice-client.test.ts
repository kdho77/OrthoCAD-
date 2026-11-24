// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { afterEach, describe, expect, test } from "@rstest/core";
import { TRPCError } from "@trpc/server";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../../shared/print-recipe/print-recipe";
import {
    assertEnabledVertexSliceMaterial,
    downloadVertexSliceJobResult,
    getVertexSliceJob,
    inspectManufacturingStl,
    manufacturingBackendForOutput,
    materialIdsFromPayload,
    sliceWithVertexSlice,
    submitVertexSliceJob,
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

    test("Apex Bounce, Forge, and Vylon are allowed before any slicer call", () => {
        expect(assertEnabledVertexSliceMaterial("apex_bounce")).toBe("apex_bounce");
        expect(assertEnabledVertexSliceMaterial("apex_forge")).toBe("apex_forge");
        expect(assertEnabledVertexSliceMaterial("apex_vylon")).toBe("apex_vylon");
        expect(() => assertEnabledVertexSliceMaterial("TPU 95A")).toThrow(/Apex Forge/);
        expect(() => assertEnabledVertexSliceMaterial("PLA")).toThrow(/Apex Core/);
    });

    test("Apex Vylon slice sends the material id and no process override", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core", "apex_vylon"]), { status: 200 });
            }
            return new Response("G1 X0\n", { status: 200 });
        });
        const gcode = await sliceWithVertexSlice({
            profileId: "apex-v2-insole-95a",
            material: "apex_vylon",
            model: new Uint8Array([1, 2, 3]),
            infillDensityPct: 32,
        });
        expect(gcode).toContain("G1");
        const form = calls.find((call) => call.url.endsWith("/v1/slice"))?.init.body as FormData;
        expect(form.get("material")).toBe("apex_vylon");
        expect(form.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(form.get("nozzle_temp")).toBeNull();
        expect(form.get("bed_temp")).toBeNull();
        expect(form.get("belt_temp")).toBeNull();
        expect(form.get("wall_loops")).toBeNull();
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

    test("apex_forge slice request mirrors apex_core except material", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example/";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const stub = new Uint8Array([5, 6, 7]);
        const infill = 26;
        let coreForm: FormData | undefined;
        let forgeForm: FormData | undefined;
        const calls = installFetch((url, init) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify({ materials: ["apex_core", "apex_forge"] }), {
                    status: 200,
                });
            }
            const form = init.body as FormData;
            const material = form.get("material");
            if (material === "apex_core") coreForm = form;
            if (material === "apex_forge") forgeForm = form;
            const temp = material === "apex_forge" ? 245 : 225;
            return new Response(`M104 S${temp}\nM109 S${temp}\n`, { status: 200 });
        });

        const coreGcode = await sliceWithVertexSlice({
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_core",
            model: stub,
            infillDensityPct: infill,
        });
        const forgeGcode = await sliceWithVertexSlice({
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_forge",
            model: stub,
            infillDensityPct: infill,
        });

        expect(coreForm?.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(forgeForm?.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(coreForm?.get("infill_density")).toBe(String(infill));
        expect(forgeForm?.get("infill_density")).toBe(String(infill));
        expect(coreForm?.get("nozzle_temp")).toBeNull();
        expect(forgeForm?.get("nozzle_temp")).toBeNull();
        expect(coreForm?.get("material")).toBe("apex_core");
        expect(forgeForm?.get("material")).toBe("apex_forge");
        expect(coreGcode).toMatch(/M10[49]\s+S225\b/);
        expect(forgeGcode).toMatch(/M10[49]\s+S245\b/);
        expect(calls.filter((call) => call.url.endsWith("/v1/slice"))).toHaveLength(2);
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
        const model = form.get("model");
        expect(model).toBeInstanceOf(Blob);
        expect((model as Blob).type).toBe("model/stl");
    });

    test("a 3MF with modifiers requires X-VertexSlice-Regions and keeps the global infill", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const modelBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 7, 7, 7]);
        const appended: Array<{ name: string; filename?: string; type: string }> = [];
        const originalAppend = FormData.prototype.append;
        FormData.prototype.append = function (
            this: FormData,
            name: string,
            value: string | Blob,
            filename?: string,
        ) {
            if (typeof value !== "string") appended.push({ name: String(name), filename, type: value.type });
            return originalAppend.call(this, name, value, filename);
        } as FormData["append"];
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            return new Response("G1 X0\n", {
                status: 200,
                headers: { "X-VertexSlice-Regions": "2" },
            });
        });
        const gcode = await sliceWithVertexSlice({
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_core",
            model: modelBytes,
            filename: "model.3mf",
            infillDensityPct: 26,
            expectedRegionCount: 2,
            side: "left",
        });
        expect(gcode).toContain("G1");
        const form = calls.find((call) => call.url.endsWith("/v1/slice"))?.init.body as FormData;
        expect([...form.keys()].sort()).toEqual(["infill_density", "material", "model", "profile_id"]);
        expect(form.get("infill_density")).toBe("26");
        expect(form.get("profile_id")).toBe("apex-v2-insole-95a");
        expect(form.get("material")).toBe("apex_core");
        FormData.prototype.append = originalAppend;
        const model = form.get("model");
        expect(model).toBeInstanceOf(Blob);
        expect(appended.find((part) => part.name === "model")).toEqual({
            name: "model",
            filename: "model.3mf",
            type: "model/3mf",
        });
        expect(new Uint8Array(await (model as Blob).arrayBuffer())).toEqual(modelBytes);

        installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            return new Response("G1 X0\n", { status: 200, headers: { "X-VertexSlice-Regions": "1" } });
        });
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_core",
                model: modelBytes,
                filename: "model.3mf",
                infillDensityPct: 26,
                expectedRegionCount: 2,
            }),
        ).rejects.toThrow(/Regional hardness applied 1 of 2/);

        installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            return new Response("G1 X0\n", { status: 200 });
        });
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_core",
                model: modelBytes,
                filename: "left.3mf",
                infillDensityPct: 26,
                expectedRegionCount: 2,
            }),
        ).rejects.toThrow(/missing X-VertexSlice-Regions/);

        const callsBefore = installFetch(() => new Response("nope", { status: 500 }));
        await expect(
            sliceWithVertexSlice({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_core",
                model: new Uint8Array([1, 2, 3]),
                filename: "left.stl",
                infillDensityPct: 26,
                expectedRegionCount: 1,
            }),
        ).rejects.toThrow(/not a 3MF/);
        expect(callsBefore).toHaveLength(0);
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

describe("VertexSlice job API", () => {
    const model = new Uint8Array([1, 2, 3]);

    test("POST /v1/slice/jobs sends the same multipart fields and API key header", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (url.endsWith("/v1/slice/jobs")) {
                return new Response(JSON.stringify({ job_id: "job-1", status: "queued", position: 0 }), {
                    status: 202,
                });
            }
            return new Response("G1 X0\n", { status: 200 });
        });
        const request = {
            profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
            material: "apex_core",
            model,
            filename: "left.stl",
            infillDensityPct: 32,
            side: "left" as const,
        };
        const submitted = await submitVertexSliceJob(request);
        expect(submitted).toEqual({ kind: "accepted", jobId: "job-1", position: 0 });
        const gcode = await sliceWithVertexSlice(request);
        expect(gcode).toBe("G1 X0\n");
        const jobCall = calls.find((call) => call.url.endsWith("/v1/slice/jobs"));
        const sliceCall = calls.find((call) => call.url.endsWith("/v1/slice"));
        const jobForm = jobCall?.init.body as FormData;
        const sliceForm = sliceCall?.init.body as FormData;
        expect([...jobForm.keys()].sort()).toEqual([...sliceForm.keys()].sort());
        expect(jobForm.get("profile_id")).toBe(sliceForm.get("profile_id"));
        expect(jobForm.get("material")).toBe(sliceForm.get("material"));
        expect(jobForm.get("infill_density")).toBe(sliceForm.get("infill_density"));
        expect(jobForm.get("wall_loops")).toBeNull();
        const jobHeaders = jobCall?.init.headers as Record<string, string>;
        const sliceHeaders = sliceCall?.init.headers as Record<string, string>;
        expect(jobHeaders["X-API-Key"]).toBe(sliceHeaders["X-API-Key"]);
        expect(typeof jobHeaders["X-API-Key"]).toBe("string");
    });

    test("a 422 from the job route fails immediately and does not call sync /v1/slice", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const calls = installFetch((url) => {
            if (url.endsWith("/v1/materials")) {
                return new Response(JSON.stringify(["apex_core"]), { status: 200 });
            }
            if (url.endsWith("/v1/slice/jobs")) {
                return new Response(JSON.stringify({ detail: "bad mesh" }), { status: 422 });
            }
            return new Response("should-not-run", { status: 200 });
        });
        await expect(
            submitVertexSliceJob({
                profileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
                material: "apex_core",
                model,
            }),
        ).rejects.toThrow(/VertexSlice error \(422\)/);
        expect(calls.some((call) => call.url.endsWith("/v1/slice"))).toBe(false);
    });

    test("the result body is the server bytes, and an unknown job is missing", async () => {
        process.env.VERTEXSLICE_SLICER_URL = "https://slicer.example";
        process.env.VERTEXSLICE_API_KEY = "super-secret-key";
        const body = "G1 X0 \n";
        installFetch((url) => {
            if (url.endsWith("/result")) return new Response(body, { status: 200 });
            if (url.endsWith("/missing")) return new Response("no", { status: 404 });
            return new Response(
                JSON.stringify({
                    job_id: "missing",
                    status: "queued",
                    position: 1,
                    queued_at: null,
                    started_at: null,
                    finished_at: null,
                    elapsed_s: null,
                    error: null,
                }),
                { status: 404 },
            );
        });
        const result = await downloadVertexSliceJobResult("job-9");
        expect(result).toEqual({ kind: "gcode", gcode: body });
        const missing = await getVertexSliceJob("missing");
        expect(missing.kind).toBe("missing");
    });
});

function triangleStl(verts: number[]): Uint8Array {
    const buf = Buffer.alloc(84 + 50);
    buf.writeUInt32LE(1, 80);
    for (let i = 0; i < 9; i++) buf.writeFloatLE(verts[i] ?? 0, 84 + 12 + i * 4);
    return new Uint8Array(buf);
}
