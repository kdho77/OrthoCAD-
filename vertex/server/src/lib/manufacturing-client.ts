// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { TRPCError } from "@trpc/server";

export interface GrindingStylePayload {
    type: "straight" | "rounded";
    angle_degrees?: number;
    radius_mm?: number;
}

/** Payload sent to the Python `/manufacture` endpoint (snake_case by contract). */
export interface ManufacturePayload {
    job_id: string;
    design_id: string;
    preset_id: string;
    stl_url: string;
    output_type: "gcode" | "stl";
    belt_angle_deg: number;
    side: string | null;
    layer_height_mm?: number;
    infill_density?: number;
    perimeters?: number;
    grinding_style?: GrindingStylePayload;
    print_recipe?: Record<string, unknown>;
    /** Filament the user selected. Omitted leaves the slicer header on its preset default. */
    material?: string;
}

/** Shape returned by the Python `/manufacture` endpoint on success. */
export interface ManufactureResult {
    ok: boolean;
    job_id?: string;
    design_id?: string;
    preset_id?: string;
    output_type?: "gcode" | "stl";
    belt_angle_deg?: number;
    grinding_style?: string;
    gcode?: string;
    stl_base64?: string;
    error?: string;
}

/**
 * Resolve the manufacturing microservice config.
 *
 * `MANUFACTURING_SERVICE_URL` is the canonical var (matches render.yaml). We also
 * accept the legacy `PYTHON_MANUFACTURING_URL` and fall back to the local docker
 * default so `npm run dev:server` + `docker compose up` works out of the box.
 *
 * `MANUFACTURING_INTERNAL_API_KEY` is optional: when set, it is sent as a Bearer
 * token and the Python service enforces it.
 */
export function getManufacturingConfig(): { baseUrl: string; apiKey: string | null } {
    const baseUrl = (
        process.env.MANUFACTURING_SERVICE_URL ||
        process.env.PYTHON_MANUFACTURING_URL ||
        "http://localhost:8001"
    ).trim();
    const apiKey = process.env.MANUFACTURING_INTERNAL_API_KEY?.trim() || null;
    return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/**
 * POST target for the manufacturing service.
 *
 * `MANUFACTURING_SERVICE_URL` is the service root (`https://host`). Some
 * deploys paste the full endpoint (`https://host/manufacture`). Appending
 * `/manufacture` again requests `/manufacture/manufacture`, which the service
 * answers with 404.
 */
export function resolveManufactureEndpoint(configuredBaseUrl: string): string {
    const base = configuredBaseUrl.trim().replace(/\/+$/, "");
    if (/\/manufacture$/i.test(base)) return base;
    return `${base}/manufacture`;
}

/** Surface the upstream body. Platform 404s use `message`, FastAPI uses `detail`. */
export function manufacturingFailureDetail(status: number, statusText: string, bodyText: string): string {
    let detail = "";
    const trimmed = bodyText.trim();
    if (trimmed) {
        try {
            const body = JSON.parse(trimmed) as { detail?: unknown; message?: unknown };
            if (typeof body.detail === "string" && body.detail.trim()) detail = body.detail.trim();
            else if (typeof body.message === "string" && body.message.trim()) detail = body.message.trim();
        } catch {
            detail = trimmed.replace(/\s+/g, " ").slice(0, 300);
        }
    }
    if (!detail) detail = statusText.trim() || "request failed";
    return `Manufacturing service error (${status}): ${detail}`;
}

/**
 * Call the Python hybrid-manufacturing service.
 *
 * Validates the finished STL, then returns G-code (belt profiles) or STL bytes.
 * Throws a `TRPCError` on any transport or service failure.
 */
export async function callManufacture(payload: ManufacturePayload): Promise<ManufactureResult> {
    const { baseUrl, apiKey } = getManufacturingConfig();
    const endpoint = resolveManufactureEndpoint(baseUrl);

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    console.log("[manufacturing] -> Python /manufacture", {
        endpoint,
        jobId: payload.job_id,
        presetId: payload.preset_id,
        outputType: payload.output_type,
        beltAngleDeg: payload.belt_angle_deg,
        side: payload.side,
        material: payload.material ?? null,
        hasStlUrl: Boolean(payload.stl_url && !payload.stl_url.startsWith("file://")),
        authenticated: Boolean(apiKey),
    });

    let response: Response;
    try {
        response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[manufacturing] transport error reaching Python service", { endpoint, message });
        throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Could not reach manufacturing service (${endpoint}): ${message}`,
        });
    }

    if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        const message = manufacturingFailureDetail(response.status, response.statusText, bodyText);
        console.error("[manufacturing] Python service returned error", {
            endpoint,
            status: response.status,
            detail: message,
        });
        throw new TRPCError({
            code:
                response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR",
            message,
        });
    }

    const result = (await response.json().catch(() => null)) as ManufactureResult | null;
    const outputType = result?.output_type ?? payload.output_type;
    const hasGcode = Boolean(result?.gcode);
    const hasStl = Boolean(result?.stl_base64);

    if (!result || !result.ok || (outputType === "gcode" && !hasGcode) || (outputType === "stl" && !hasStl)) {
        const message = result?.error || "Manufacturing service did not return valid output";
        console.error("[manufacturing] invalid Python service response", { endpoint, message, outputType });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }

    console.log("[manufacturing] <- Python /manufacture OK", {
        jobId: result.job_id,
        outputType,
        bytes: outputType === "gcode" ? result.gcode?.length : result.stl_base64?.length,
    });

    return result;
}
