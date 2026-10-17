// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { SLICE_FORM_FIELDS, SLICE_RESPONSE_HEADERS } from "../../../shared/vertexslice/contract";
import type { VertexSliceHttpError } from "../../../shared/vertexslice/errors";
import { buildSliceFormData, createVertexSliceClient } from "./vertexslice-client";

describe("buildSliceFormData", () => {
    test("uses VertexSlice multipart field names", () => {
        const form = buildSliceFormData({
            profileId: "apex-v2-insole-95a",
            model: new Uint8Array([1, 2, 3]),
            filename: "insole.stl",
            wallLoops: 4,
            infillDensity: 20,
            printDirection: "toe_first",
            beltInsolePlace: true,
            material: "apex_core",
        });
        expect(form.get(SLICE_FORM_FIELDS.profileId)).toBe("apex-v2-insole-95a");
        expect(form.get(SLICE_FORM_FIELDS.wallLoops)).toBe("4");
        expect(form.get(SLICE_FORM_FIELDS.infillDensity)).toBe("20");
        expect(form.get(SLICE_FORM_FIELDS.printDirection)).toBe("toe_first");
        expect(form.get(SLICE_FORM_FIELDS.beltInsolePlace)).toBe("true");
        expect(form.get(SLICE_FORM_FIELDS.material)).toBe("apex_core");
        const model = form.get(SLICE_FORM_FIELDS.model);
        expect(model).toBeInstanceOf(Blob);
    });

    test("omits optional fields the contract treats as defaulted", () => {
        const form = buildSliceFormData({
            profileId: "apex-v2-insole-95a",
            model: new Uint8Array([1]),
        });
        expect(form.get(SLICE_FORM_FIELDS.wallLoops)).toBeNull();
        expect(form.get(SLICE_FORM_FIELDS.material)).toBeNull();
        expect(form.get(SLICE_FORM_FIELDS.printDirection)).toBeNull();
    });
});

describe("createVertexSliceClient", () => {
    test("POSTs /v1/slice with X-API-Key and reads response headers", async () => {
        const calls: Array<{ url: string; headers: Headers; body: FormData }> = [];
        const fetchMock: typeof fetch = async (input, init) => {
            const url = String(input);
            calls.push({
                url,
                headers: new Headers(init?.headers),
                body: init?.body as FormData,
            });
            return new Response("G28\n", {
                status: 200,
                headers: {
                    [SLICE_RESPONSE_HEADERS.profileId]: "apex-v2-insole-95a",
                    [SLICE_RESPONSE_HEADERS.material]: "apex_core",
                    [SLICE_RESPONSE_HEADERS.wallLoops]: "1",
                    [SLICE_RESPONSE_HEADERS.printDirection]: "toe_first",
                    [SLICE_RESPONSE_HEADERS.sliceSeconds]: "1.2",
                },
            });
        };
        const client = createVertexSliceClient({
            baseUrl: "https://slice.example",
            apiKey: "secret-key",
            fetch: fetchMock,
        });
        const result = await client.slice({
            profileId: "apex-v2-insole-95a",
            model: new Uint8Array([0, 1]),
            filename: "insole.stl",
            material: "apex_core",
            printDirection: "toe_first",
        });
        expect(calls[0].url).toBe("https://slice.example/v1/slice");
        expect(calls[0].headers.get("X-API-Key")).toBe("secret-key");
        expect(result.gcode).toContain("G28");
        expect(result.headers.material).toBe("apex_core");
        expect(result.headers.printDirection).toBe("toe_first");
    });

    test("surfaces FastAPI detail JSON as VertexSliceHttpError", async () => {
        const client = createVertexSliceClient({
            baseUrl: "https://slice.example",
            apiKey: "k",
            fetch: async () =>
                new Response(JSON.stringify({ detail: "Invalid or missing X-API-Key" }), { status: 401 }),
        });
        await expect(
            client.slice({ profileId: "apex-v2-insole-95a", model: new Uint8Array([1]) }),
        ).rejects.toMatchObject({
            status: 401,
            detail: "Invalid or missing X-API-Key",
        } satisfies Partial<VertexSliceHttpError>);
    });
});
