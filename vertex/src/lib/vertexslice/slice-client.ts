import type { BeltPrintDirection } from "@/lib/vertexslice/profile-map";

export interface VertexSliceSliceParams {
    baseUrl: string;
    apiKey?: string;
    profileId: string;
    stl: ArrayBuffer;
    wallLoops: number;
    infillDensityPct: number;
    printDirection: BeltPrintDirection;
    fileName?: string;
}

export interface VertexSliceSliceResult {
    gcode: string;
    sliceSeconds?: number;
    profileId?: string;
}

function trimBaseUrl(url: string): string {
    return url.replace(/\/+$/, "");
}

export function isVertexSliceConfigured(): boolean {
    const url = import.meta.env.VITE_VERTEXSLICE_SLICER_URL?.trim();
    return Boolean(url);
}

export function vertexSliceBaseUrl(): string {
    const url = import.meta.env.VITE_VERTEXSLICE_SLICER_URL?.trim();
    if (!url) {
        throw new Error("VITE_VERTEXSLICE_SLICER_URL is not set");
    }
    return trimBaseUrl(url);
}

export function vertexSliceApiKey(): string | undefined {
    const key = import.meta.env.VITE_VERTEXSLICE_API_KEY?.trim();
    return key || undefined;
}

export async function sliceStlWithVertexSlice(params: VertexSliceSliceParams): Promise<VertexSliceSliceResult> {
    const base = trimBaseUrl(params.baseUrl);
    const form = new FormData();
    form.append("profile_id", params.profileId);
    form.append(
        "model",
        new Blob([params.stl], { type: "model/stl" }),
        params.fileName ?? "insole.stl",
    );
    form.append("wall_loops", String(params.wallLoops));
    form.append("infill_density", String(params.infillDensityPct));
    form.append("print_direction", params.printDirection);
    form.append("belt_insole_place", "true");

    const headers: Record<string, string> = {};
    const key = params.apiKey ?? vertexSliceApiKey();
    if (key) {
        headers["X-API-Key"] = key;
    }

    const res = await fetch(`${base}/v1/slice`, {
        method: "POST",
        headers,
        body: form,
    });

    if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
            `VertexSlice slicer failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        );
    }

    const gcode = await res.text();
    const sliceSeconds = res.headers.get("X-Slice-Seconds");
    return {
        gcode,
        sliceSeconds: sliceSeconds ? Number(sliceSeconds) : undefined,
        profileId: res.headers.get("X-Profile-Id") ?? params.profileId,
    };
}

export async function checkVertexSliceHealth(baseUrl: string): Promise<boolean> {
    try {
        const res = await fetch(`${trimBaseUrl(baseUrl)}/health`, { method: "GET" });
        if (!res.ok) return false;
        const body = (await res.json()) as { status?: string };
        return body.status === "ok";
    } catch {
        return false;
    }
}
