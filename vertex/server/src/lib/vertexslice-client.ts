// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { TRPCError } from "@trpc/server";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../../shared/print-recipe/print-recipe.js";
import { readUpstreamErrorText } from "./upstream-error.js";

/** VertexSlice `/v1/slice` material ids. Enabled printer exports are the first two. */
export const VERTEX_SLICE_MATERIAL_IDS = ["apex_core", "apex_light", "apex_forge", "apex_bounce"] as const;

export type VertexSliceMaterialId = (typeof VERTEX_SLICE_MATERIAL_IDS)[number];

export const ENABLED_VERTEX_SLICE_MATERIALS = ["apex_core", "apex_light", "apex_bounce"] as const;

export type EnabledVertexSliceMaterial = (typeof ENABLED_VERTEX_SLICE_MATERIALS)[number];

export function materialUnavailableMessage(material: string, upstream?: string): string {
    const base = `Material ${material} not available on slicer`;
    const extra = upstream?.trim();
    if (!extra || extra === base) return base;
    return `${base}: ${extra}`;
}

export function getVertexSliceConfig(): { baseUrl: string; apiKey: string } {
    const baseUrl = process.env.VERTEXSLICE_SLICER_URL?.trim() ?? "";
    const apiKey = process.env.VERTEXSLICE_API_KEY?.trim() ?? "";
    if (!baseUrl) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VERTEXSLICE_SLICER_URL is not set",
        });
    }
    if (!apiKey) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VERTEXSLICE_API_KEY is not set",
        });
    }
    return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/** Printer G-code uses VertexSlice. STL output stays on the Python manufacturing service. */
export function manufacturingBackendForOutput(outputType: "gcode" | "stl"): "vertexslice" | "python" {
    return outputType === "gcode" ? "vertexslice" : "python";
}

/**
 * Apex Forge stays disabled. Apex Bounce is enabled; its temperatures and speed
 * are a VertexSlice material profile, not fields on this form.
 * Any other id, including legacy Shore-A names, is refused. Nothing is substituted.
 */
export function assertEnabledVertexSliceMaterial(material: string | undefined): EnabledVertexSliceMaterial {
    const id = material?.trim() ?? "";
    if (id === "apex_forge") {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Apex Forge is disabled until print settings are approved",
        });
    }
    if (id !== "apex_core" && id !== "apex_light" && id !== "apex_bounce") {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message:
                "Printer G-code requires Apex Core (apex_core), Apex Light (apex_light), or Apex Bounce (apex_bounce).",
        });
    }
    return id;
}

export function assertLockedVertexSliceProfile(profileId: string): string {
    if (profileId !== APEX_V2_INSOLE_LOCKED_PROFILE_ID) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Printer G-code requires locked profile ${APEX_V2_INSOLE_LOCKED_PROFILE_ID}`,
        });
    }
    return profileId;
}

function vertexSliceUrl(baseUrl: string, path: string): string {
    return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders(apiKey: string): Record<string, string> {
    return { "X-API-Key": apiKey };
}

/**
 * Ids from `GET /v1/materials`.
 * Accepts a string array, `{ materials|filaments|items|data }`, or a map of id → definition.
 * Returns null when the payload shape is not a material list.
 */
export function materialIdsFromPayload(payload: unknown): string[] | null {
    const fromList = (value: unknown): string[] | null => {
        if (!Array.isArray(value)) return null;
        const ids: string[] = [];
        for (const item of value) {
            if (typeof item === "string" && item.trim()) {
                ids.push(item.trim());
                continue;
            }
            if (!item || typeof item !== "object") continue;
            const rec = item as Record<string, unknown>;
            const id = rec.id ?? rec.material ?? rec.material_id ?? rec.name ?? rec.code;
            if (typeof id === "string" && id.trim()) ids.push(id.trim());
        }
        return ids;
    };

    const direct = fromList(payload);
    if (direct) return direct;

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const rec = payload as Record<string, unknown>;
    for (const key of ["materials", "filaments", "items", "data", "results"]) {
        if (!(key in rec)) continue;
        const nested = fromList(rec[key]);
        if (nested) return nested;
        const child = rec[key];
        if (child && typeof child === "object" && !Array.isArray(child)) {
            const mapIds = materialMapIds(child as Record<string, unknown>);
            if (mapIds) return mapIds;
        }
    }
    return materialMapIds(rec);
}

function materialMapIds(rec: Record<string, unknown>): string[] | null {
    const keys = Object.keys(rec);
    if (!keys.length) return null;
    if (keys.some((key) => key === "message" || key === "detail" || key === "error" || key === "status")) {
        return null;
    }
    const valuesAreDefinitions = keys.every((key) => {
        const value = rec[key];
        return value !== null && typeof value === "object";
    });
    return valuesAreDefinitions ? keys : null;
}

function materialIsListed(listed: readonly string[], material: string): boolean {
    const wanted = material.trim().toLowerCase();
    return listed.some((id) => id.trim().toLowerCase() === wanted);
}

function isMaterialRejection(errorText: string, material: string): boolean {
    const text = errorText.toLowerCase();
    const id = material.trim().toLowerCase();
    const mentionsMaterial = text.includes(id) || /\bmaterial\b|\bfilament\b/.test(text);
    if (!mentionsMaterial) return false;
    return /not available|not found|unknown|unsupported|unrecognized|invalid|not allowed|no such/.test(text);
}

function isAbortError(err: unknown): boolean {
    if (err instanceof Error && err.name === "AbortError") return true;
    if (err instanceof DOMException && err.name === "AbortError") return true;
    return false;
}

function vertexSliceTimedOutError(timeoutSec: number, side?: string): Error {
    const suffix = side?.trim() ? ` (${side.trim()})` : "";
    return new Error(`VertexSlice timed out after ${timeoutSec}s${suffix}`);
}

async function vertexSliceFetch(
    url: string,
    init: RequestInit,
    opts?: { timedOut?: { timeoutSec: number; side?: string } },
): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch (err: unknown) {
        if (isAbortError(err) && opts?.timedOut) {
            throw vertexSliceTimedOutError(opts.timedOut.timeoutSec, opts.timedOut.side);
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not reach VertexSlice (${url}): ${message}`,
        });
    }
}

export async function listVertexSliceMaterials(): Promise<string[]> {
    const { baseUrl, apiKey } = getVertexSliceConfig();
    const endpoint = vertexSliceUrl(baseUrl, "/v1/materials");
    const response = await vertexSliceFetch(endpoint, {
        method: "GET",
        headers: authHeaders(apiKey),
    });
    if (!response.ok) {
        const detail = await readUpstreamErrorText(response);
        throw new TRPCError({
            code:
                response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR",
            message: `VertexSlice error (${response.status}): ${detail}`,
        });
    }
    const raw = await response.text();
    let payload: unknown = null;
    try {
        payload = raw ? (JSON.parse(raw) as unknown) : null;
    } catch {
        payload = null;
    }
    const ids = materialIdsFromPayload(payload);
    if (!ids) {
        const snippet = raw.replace(/\s+/g, " ").trim().slice(0, 180);
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `VertexSlice /v1/materials returned an unrecognized payload${snippet ? `: ${snippet}` : ""}`,
        });
    }
    return ids;
}

export interface VertexSliceRequest {
    profileId: string;
    material: VertexSliceMaterialId | string;
    model: Uint8Array;
    filename?: string;
    /** PrintRecipe hardness percent on the locked profile. Wall loops are never sent. */
    infillDensityPct?: number;
    /** Deadline for POST /v1/slice only. Materials prefetch is not bounded by this. */
    sliceTimeoutMs?: number;
    /** Included in timeout errors when sliceTimeoutMs is set. */
    side?: string;
}

/**
 * Slice one STL on VertexSlice.
 * Sends `profile_id`, `model`, `material`, and the PrintRecipe infill percent.
 * Does not send wall loops or any other process override.
 * Fails closed when the material is absent from `/v1/materials` or the slice call rejects it.
 */
export async function sliceWithVertexSlice(request: VertexSliceRequest): Promise<string> {
    const material = assertEnabledVertexSliceMaterial(request.material);
    const profileId = assertLockedVertexSliceProfile(request.profileId.trim());

    const listed = await listVertexSliceMaterials();
    if (!materialIsListed(listed, material)) {
        throw new TRPCError({
            code: "BAD_REQUEST",
            message: materialUnavailableMessage(material),
        });
    }

    const { baseUrl, apiKey } = getVertexSliceConfig();
    const endpoint = vertexSliceUrl(baseUrl, "/v1/slice");
    const form = new FormData();
    form.append("profile_id", profileId);
    form.append("material", material);
    if (request.infillDensityPct !== undefined) {
        const pct = request.infillDensityPct;
        if (!Number.isInteger(pct) || pct < 5 || pct > 100) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: `PrintRecipe infill ${pct}% is outside the locked slicer range (5–100)`,
            });
        }
        form.append("infill_density", String(pct));
    }
    const bytes = new Uint8Array(request.model);
    form.append("model", new Blob([bytes], { type: "model/stl" }), request.filename ?? "model.stl");

    console.log("[vertexslice] -> POST /v1/slice", {
        endpoint,
        profileId,
        material,
        infillDensityPct: request.infillDensityPct ?? null,
        modelBytes: bytes.byteLength,
        authenticated: true,
    });

    const sliceTimeoutMs = request.sliceTimeoutMs;
    const sliceTimeoutSec =
        sliceTimeoutMs !== undefined ? Math.max(1, Math.ceil(sliceTimeoutMs / 1000)) : undefined;
    const sliceSignal =
        sliceTimeoutMs !== undefined && sliceTimeoutMs > 0 ? AbortSignal.timeout(sliceTimeoutMs) : undefined;

    const response = await vertexSliceFetch(
        endpoint,
        {
            method: "POST",
            headers: authHeaders(apiKey),
            body: form,
            signal: sliceSignal,
        },
        sliceTimeoutSec !== undefined
            ? { timedOut: { timeoutSec: sliceTimeoutSec, side: request.side } }
            : undefined,
    );

    if (!response.ok) {
        const detail = await readUpstreamErrorText(response);
        console.error("[vertexslice] slice failed", { endpoint, status: response.status, detail, material });
        if (isMaterialRejection(detail, material)) {
            throw new TRPCError({
                code: "BAD_REQUEST",
                message: materialUnavailableMessage(material, detail),
            });
        }
        throw new TRPCError({
            code:
                response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR",
            message: `VertexSlice error (${response.status}): ${detail}`,
        });
    }

    const gcode = await response.text();
    if (!gcode.trim()) {
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "VertexSlice returned empty G-code",
        });
    }
    console.log("[vertexslice] <- POST /v1/slice OK", { profileId, material, bytes: gcode.length });
    return gcode;
}
