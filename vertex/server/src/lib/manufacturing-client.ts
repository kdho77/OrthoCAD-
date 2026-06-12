// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
 * Call the Python hybrid-manufacturing service.
 *
 * Validates the finished STL, then returns G-code (belt profiles) or STL bytes.
 * Throws a `TRPCError` on any transport or service failure.
 */
export async function callManufacture(payload: ManufacturePayload): Promise<ManufactureResult> {
    const { baseUrl, apiKey } = getManufacturingConfig();
    const endpoint = `${baseUrl}/manufacture`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    console.log("[manufacturing] -> Python /manufacture", {
        endpoint,
        jobId: payload.job_id,
        presetId: payload.preset_id,
        outputType: payload.output_type,
        beltAngleDeg: payload.belt_angle_deg,
        side: payload.side,
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
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        const detail = body?.detail || (await response.text().catch(() => "")) || response.statusText;
        console.error("[manufacturing] Python service returned error", { endpoint, status: response.status, detail });
        throw new TRPCError({
            code: response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "INTERNAL_SERVER_ERROR",
            message: `Manufacturing service error (${response.status}): ${detail}`,
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
