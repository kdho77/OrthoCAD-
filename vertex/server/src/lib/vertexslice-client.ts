// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { resolveVertexSliceTarget } from "../../../shared/slice-job.js";

export type ManufacturingSlicer = "vertexslice" | "legacy";

/** `MANUFACTURING_SLICER=legacy` keeps the Python service. Anything else uses VertexSlice. */
export function getManufacturingSlicer(): ManufacturingSlicer {
    const raw = (process.env.MANUFACTURING_SLICER ?? "vertexslice").trim().toLowerCase();
    return raw === "legacy" ? "legacy" : "vertexslice";
}

export function getVertexSliceConfig(): { baseUrl: string; apiKey: string | null } {
    const baseUrl = (process.env.VERTEXSLICE_URL ?? "").trim().replace(/\/+$/, "");
    const apiKey = process.env.VERTEXSLICE_API_KEY?.trim() || null;
    return { baseUrl, apiKey };
}

/** Remove server secrets from messages that might be logged or returned to the client. */
export function redactSecrets(message: string, secrets: Array<string | null | undefined>): string {
    let out = message;
    for (const secret of secrets) {
        if (secret && secret.length > 0) out = out.split(secret).join("[redacted]");
    }
    return out;
}

export interface VertexSliceRequest {
    stl: Uint8Array;
    profileId: string;
    material?: string | null;
    hardness?: string | null;
    fileName?: string | null;
}

export interface VertexSliceDeps {
    fetch?: typeof fetch;
    baseUrl?: string;
    apiKey?: string | null;
    timeoutMs?: number;
}

/**
 * POST the finished STL to VertexSlice `POST /v1/slice` (multipart).
 * The belt leader is already part of this STL when the Print/Export toggle is
 * on (OrthoCAD adds it before upload). This client does not run a postprocess
 * chain: it uploads the mesh and reads G-code text back. The API key is sent
 * only as `X-API-Key`.
 */
export async function sliceWithVertexSlice(
    input: VertexSliceRequest,
    deps: VertexSliceDeps = {},
): Promise<string> {
    const cfg = getVertexSliceConfig();
    const baseUrl = (deps.baseUrl ?? cfg.baseUrl).replace(/\/+$/, "");
    const apiKey = deps.apiKey === undefined ? cfg.apiKey : deps.apiKey;
    if (!baseUrl) {
        throw new Error("VertexSlice is not configured");
    }

    const target = resolveVertexSliceTarget({
        profileId: input.profileId,
        material: input.material,
        hardness: input.hardness,
    });
    const form = new FormData();
    form.set("profile_id", target.profileId);
    form.set("material", target.material);
    form.set("belt_insole_place", "true");
    const fileName = input.fileName?.endsWith(".stl") ? input.fileName : "model.stl";
    form.set("model", new Blob([input.stl]), fileName);

    const headers: Record<string, string> = {};
    if (apiKey) headers["X-API-Key"] = apiKey;

    const endpoint = `${baseUrl}/v1/slice`;
    let host = "vertexslice";
    try {
        host = new URL(baseUrl).host;
    } catch {
        host = "invalid-vertexslice-url";
    }
    console.log("[vertexslice] POST /v1/slice", {
        host,
        profileId: target.profileId,
        material: target.material,
        bytes: input.stl.byteLength,
        authenticated: Boolean(apiKey),
    });

    const fetchImpl = deps.fetch ?? fetch;
    let response: Response;
    try {
        response = await fetchImpl(endpoint, {
            method: "POST",
            headers,
            body: form,
            signal: AbortSignal.timeout(deps.timeoutMs ?? 9 * 60 * 1000),
        });
    } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : "VertexSlice request failed";
        throw new Error(`Could not reach VertexSlice: ${redactSecrets(raw, [apiKey])}`);
    }

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        const safe = redactSecrets(body, [apiKey]).slice(0, 300);
        console.error("[vertexslice] slice failed", { host, status: response.status });
        throw new Error(`VertexSlice slice failed (${response.status})${safe ? `: ${safe}` : ""}`);
    }

    const gcode = await response.text();
    if (!gcode.trim()) {
        throw new Error("VertexSlice returned empty G-code");
    }
    console.log("[vertexslice] slice ok", { host, bytes: gcode.length });
    return gcode;
}
