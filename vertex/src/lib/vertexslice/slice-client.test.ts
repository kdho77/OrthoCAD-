// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterEach, describe, expect, test } from "@rstest/core";
import {
    DEFAULT_VERTEX_SLICE_MATERIAL,
    FALLBACK_VERTEX_SLICE_MATERIALS,
    fetchVertexSliceMaterials,
    sliceStlWithVertexSlice,
    vertexSliceGcodeFilename,
    vertexSliceMaterialOptionLabel,
} from "./slice-client";

const nativeFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = nativeFetch;
});

function installSliceCapture(onBody: (form: FormData, url: string) => void): void {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        onBody(init?.body as FormData, url);
        return new Response("G0 X0\n", { status: 200, headers: { "X-Slice-Seconds": "1.2" } });
    }) as typeof fetch;
}

const sliceParams = {
    baseUrl: "https://slicer.example",
    profileId: "apex-v2-insole-medium",
    stl: new ArrayBuffer(8),
    wallLoops: 1,
    infillDensityPct: 20,
    printDirection: "toe_first" as const,
};

describe("sliceStlWithVertexSlice material", () => {
    test("POST /v1/slice defaults material to apex_core", async () => {
        let form: FormData | undefined;
        let url = "";
        installSliceCapture((body, requestUrl) => {
            form = body;
            url = requestUrl;
        });

        await sliceStlWithVertexSlice(sliceParams);

        expect(url).toBe("https://slicer.example/v1/slice");
        expect(form?.get("material")).toBe("apex_core");
        expect(DEFAULT_VERTEX_SLICE_MATERIAL).toBe("apex_core");
    });

    test("POST /v1/slice includes the selected material", async () => {
        let form: FormData | undefined;
        installSliceCapture((body) => {
            form = body;
        });

        await sliceStlWithVertexSlice({ ...sliceParams, material: "apex_forge" });

        expect(form?.get("material")).toBe("apex_forge");
        expect(form?.get("print_direction")).toBe("toe_first");
        expect(form?.get("wall_loops")).toBe("1");
        expect(form?.get("infill_density")).toBe("20");
    });
});

describe("VertexSlice material catalog", () => {
    test("hardcoded fallback lists ApexCore/Forge/Bounce with nozzle/bed temps", () => {
        expect(FALLBACK_VERTEX_SLICE_MATERIALS.map((m) => m.id)).toEqual([
            "apex_core",
            "apex_forge",
            "apex_bounce",
        ]);
        expect(vertexSliceMaterialOptionLabel(FALLBACK_VERTEX_SLICE_MATERIALS[0])).toBe("ApexCore (225/off)");
        expect(vertexSliceMaterialOptionLabel(FALLBACK_VERTEX_SLICE_MATERIALS[1])).toBe(
            "ApexForge (245/off)",
        );
        expect(vertexSliceMaterialOptionLabel(FALLBACK_VERTEX_SLICE_MATERIALS[2])).toBe(
            "ApexBounce (225/60 C)",
        );
    });

    test("filename includes the material id", () => {
        expect(
            vertexSliceGcodeFilename({
                side: "left",
                printDirection: "toe_first",
                material: "apex_core",
                now: 1700000000000,
            }),
        ).toBe("apex-v2-left-toe_first-apex_core-1700000000000.gcode");
    });

    test("GET /v1/materials falls back when the request fails", async () => {
        globalThis.fetch = (async () => {
            throw new Error("network down");
        }) as typeof fetch;

        const loaded = await fetchVertexSliceMaterials("https://slicer.example");
        expect(loaded.defaultId).toBe("apex_core");
        expect(loaded.materials).toEqual(FALLBACK_VERTEX_SLICE_MATERIALS);
    });
});
