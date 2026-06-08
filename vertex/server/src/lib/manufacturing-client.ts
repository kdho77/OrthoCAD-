// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { TRPCError } from "@trpc/server";

export interface GrindingStylePayload {
    type: "straight" | "rounded";
    angle_degrees?: number;
    radius_mm?: number;
}

export interface GenerateSolidPayload {
    job_id: string;
    design_id: string;
    preset_id: string;
    base_glb_url: string;
    corrections: Record<string, unknown>;
    trimlines: Record<string, unknown>;
    heel_lift_mm: number;
    heel_cup_width_mm: number;
    grinding_style: GrindingStylePayload;
    thickness_mm: number;
}

export interface GenerateSolidResult {
    job_id: string;
    solid_stl_base64: string | null;
    solid_url: string | null;
    metadata: Record<string, unknown>;
}

export function getManufacturingConfig(): { baseUrl: string; apiKey: string } | null {
    const baseUrl = process.env.MANUFACTURING_SERVICE_URL?.trim();
    const apiKey = process.env.MANUFACTURING_INTERNAL_API_KEY?.trim();
    if (!baseUrl || !apiKey) return null;
    return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

export async function callGenerateSolid(payload: GenerateSolidPayload): Promise<GenerateSolidResult> {
    const cfg = getManufacturingConfig();
    if (!cfg) {
        throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Manufacturing service not configured (set MANUFACTURING_SERVICE_URL and MANUFACTURING_INTERNAL_API_KEY)",
        });
    }

    const response = await fetch(`${cfg.baseUrl}/api/v1/manufacturing/generate-solid`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as
        | GenerateSolidResult
        | { detail?: string }
        | null;

    if (!response.ok) {
        const detail = body && "detail" in body ? body.detail : `Manufacturing service error (${response.status})`;
        throw new TRPCError({
            code: response.status === 401 ? "UNAUTHORIZED" : "BAD_REQUEST",
            message: detail ?? "Manufacturing service request failed",
        });
    }

    if (!body || !("job_id" in body)) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Invalid manufacturing service response" });
    }

    return body;
}
