// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    SLICE_FORM_FIELDS,
    SLICE_RESPONSE_HEADERS,
    type VertexSliceHealthResponse,
    type VertexSliceMaterialsResponse,
    type VertexSliceProfilesResponse,
    type VertexSliceSliceHeaders,
    type VertexSliceSliceInput,
    type VertexSliceSliceSuccess,
} from "../../../shared/vertexslice/contract.js";
import { VertexSliceHttpError } from "../../../shared/vertexslice/errors.js";

export interface VertexSliceClientOptions {
    baseUrl: string;
    apiKey: string;
    fetch?: typeof fetch;
}

export interface VertexSliceClient {
    health(): Promise<VertexSliceHealthResponse>;
    materials(): Promise<VertexSliceMaterialsResponse>;
    profiles(): Promise<VertexSliceProfilesResponse>;
    slice(input: VertexSliceSliceInput, init?: { signal?: AbortSignal }): Promise<VertexSliceSliceSuccess>;
}

function normalizeBaseUrl(url: string): string {
    return url.trim().replace(/\/+$/, "");
}

async function readDetail(response: Response): Promise<string> {
    const text = await response.text().catch(() => "");
    if (!text) return response.statusText || `HTTP ${response.status}`;
    try {
        const json = JSON.parse(text) as { detail?: unknown };
        if (typeof json.detail === "string") return json.detail;
        if (json.detail != null) return JSON.stringify(json.detail);
    } catch {
        // VertexSlice 400/401/413 return {"detail": "..."}; other bodies stay as text.
    }
    return text.slice(0, 2000);
}

function toBlob(model: VertexSliceSliceInput["model"], filename: string): Blob {
    if (typeof Blob !== "undefined" && model instanceof Blob) return model;
    const bytes =
        model instanceof Uint8Array
            ? model
            : model instanceof ArrayBuffer
              ? new Uint8Array(model)
              : new Uint8Array();
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const type = filename.toLowerCase().endsWith(".3mf") ? "model/3mf" : "model/stl";
    return new Blob([copy], { type });
}

export function buildSliceFormData(input: VertexSliceSliceInput): FormData {
    const filename = input.filename || "model.stl";
    const form = new FormData();
    form.set(SLICE_FORM_FIELDS.profileId, input.profileId);
    form.set(SLICE_FORM_FIELDS.model, toBlob(input.model, filename), filename);
    if (input.wallLoops != null && String(input.wallLoops).trim() !== "") {
        form.set(SLICE_FORM_FIELDS.wallLoops, String(input.wallLoops));
    }
    if (input.infillDensity != null && String(input.infillDensity).trim() !== "") {
        form.set(SLICE_FORM_FIELDS.infillDensity, String(input.infillDensity));
    }
    if (input.printDirection != null && String(input.printDirection).trim() !== "") {
        form.set(SLICE_FORM_FIELDS.printDirection, String(input.printDirection));
    }
    if (input.beltInsolePlace !== undefined) {
        form.set(SLICE_FORM_FIELDS.beltInsolePlace, input.beltInsolePlace ? "true" : "false");
    }
    if (input.material != null && String(input.material).trim() !== "") {
        form.set(SLICE_FORM_FIELDS.material, String(input.material));
    }
    return form;
}

function headersFromResponse(response: Response): VertexSliceSliceHeaders {
    const get = (name: string) => response.headers.get(name) ?? "";
    const headers: VertexSliceSliceHeaders = {
        sliceSeconds: get(SLICE_RESPONSE_HEADERS.sliceSeconds),
        peakRssKb: get(SLICE_RESPONSE_HEADERS.peakRssKb),
        profileId: get(SLICE_RESPONSE_HEADERS.profileId),
        material: get(SLICE_RESPONSE_HEADERS.material),
    };
    const wallLoops = response.headers.get(SLICE_RESPONSE_HEADERS.wallLoops);
    if (wallLoops) headers.wallLoops = wallLoops;
    const infill = response.headers.get(SLICE_RESPONSE_HEADERS.infillDensity);
    if (infill) headers.infillDensity = infill;
    const direction = response.headers.get(SLICE_RESPONSE_HEADERS.printDirection);
    if (direction) headers.printDirection = direction;
    return headers;
}

export function createVertexSliceClient(options: VertexSliceClientOptions): VertexSliceClient {
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const fetchImpl = options.fetch ?? fetch;
    const apiHeaders = (): Record<string, string> => {
        const headers: Record<string, string> = {};
        if (options.apiKey) headers["X-API-Key"] = options.apiKey;
        return headers;
    };

    async function jsonGet<T>(path: string): Promise<T> {
        let response: Response;
        try {
            response = await fetchImpl(`${baseUrl}${path}`, { headers: apiHeaders() });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            throw new VertexSliceHttpError(503, `Could not reach VertexSlice (${baseUrl}): ${message}`);
        }
        if (!response.ok) {
            throw new VertexSliceHttpError(response.status, await readDetail(response));
        }
        return (await response.json()) as T;
    }

    return {
        health: () => jsonGet<VertexSliceHealthResponse>("/health"),
        materials: () => jsonGet<VertexSliceMaterialsResponse>("/v1/materials"),
        profiles: () => jsonGet<VertexSliceProfilesResponse>("/v1/profiles"),
        async slice(input, init) {
            const form = buildSliceFormData(input);
            let response: Response;
            try {
                response = await fetchImpl(`${baseUrl}/v1/slice`, {
                    method: "POST",
                    headers: apiHeaders(),
                    body: form,
                    signal: init?.signal,
                });
            } catch (err) {
                if (init?.signal?.aborted) throw err;
                const message = err instanceof Error ? err.message : String(err);
                throw new VertexSliceHttpError(503, `Could not reach VertexSlice (${baseUrl}): ${message}`);
            }
            if (!response.ok) {
                throw new VertexSliceHttpError(response.status, await readDetail(response));
            }
            const gcode = await response.text();
            return { gcode, headers: headersFromResponse(response), status: 200 };
        },
    };
}
