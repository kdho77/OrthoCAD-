import type { BeltPrintDirection } from "@/lib/vertexslice/profile-map";

export type VertexSliceMaterialId = "apex_core" | "apex_forge" | "apex_bounce";

export interface VertexSliceMaterial {
    id: string;
    displayName: string;
    nozzle: number;
    /** Bed temperature in °C, or null when the bed is off. */
    bed: number | null;
}

export const DEFAULT_VERTEX_SLICE_MATERIAL: VertexSliceMaterialId = "apex_core";

export const FALLBACK_VERTEX_SLICE_MATERIALS: VertexSliceMaterial[] = [
    { id: "apex_core", displayName: "ApexCore", nozzle: 225, bed: null },
    { id: "apex_forge", displayName: "ApexForge", nozzle: 245, bed: null },
    { id: "apex_bounce", displayName: "ApexBounce", nozzle: 225, bed: 60 },
];

export interface VertexSliceSliceParams {
    baseUrl: string;
    apiKey?: string;
    profileId: string;
    stl: ArrayBuffer;
    wallLoops: number;
    infillDensityPct: number;
    printDirection: BeltPrintDirection;
    /** VertexSlice material id. Defaults to ApexCore (`apex_core`). */
    material?: string;
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

function parseBedTemp(bed: unknown): number | null {
    if (bed == null || bed === false || bed === "off") return null;
    if (typeof bed === "number") return Number.isFinite(bed) && bed > 0 ? bed : null;
    if (typeof bed === "string") {
        const lowered = bed.trim().toLowerCase();
        if (!lowered || lowered === "off") return null;
        const n = Number(lowered);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
}

export function vertexSliceMaterialOptionLabel(material: VertexSliceMaterial): string {
    const temps = material.bed == null ? `${material.nozzle}/off` : `${material.nozzle}/${material.bed} C`;
    return `${material.displayName} (${temps})`;
}

export function vertexSliceGcodeFilename(opts: {
    side: string;
    printDirection: string;
    material: string;
    now?: number;
}): string {
    return `apex-v2-${opts.side}-${opts.printDirection}-${opts.material}-${opts.now ?? Date.now()}.gcode`;
}

export async function fetchVertexSliceMaterials(
    baseUrl: string,
    apiKey?: string,
): Promise<{ materials: VertexSliceMaterial[]; defaultId: string }> {
    const fallback = {
        materials: FALLBACK_VERTEX_SLICE_MATERIALS,
        defaultId: DEFAULT_VERTEX_SLICE_MATERIAL,
    };
    try {
        const headers: Record<string, string> = {};
        const key = apiKey ?? vertexSliceApiKey();
        if (key) headers["X-API-Key"] = key;
        const res = await fetch(`${trimBaseUrl(baseUrl)}/v1/materials`, { method: "GET", headers });
        if (!res.ok) return fallback;
        const body = (await res.json()) as {
            materials?: Array<{ id?: unknown; display_name?: unknown; nozzle?: unknown; bed?: unknown }>;
            default?: unknown;
        };
        const materials: VertexSliceMaterial[] = [];
        for (const item of body.materials ?? []) {
            if (typeof item?.id !== "string" || !item.id) continue;
            if (typeof item.display_name !== "string" || !item.display_name) continue;
            const nozzle = typeof item.nozzle === "number" ? item.nozzle : Number(item.nozzle);
            if (!Number.isFinite(nozzle)) continue;
            materials.push({
                id: item.id,
                displayName: item.display_name,
                nozzle,
                bed: parseBedTemp(item.bed),
            });
        }
        if (materials.length === 0) return fallback;
        const defaultId =
            typeof body.default === "string" && materials.some((m) => m.id === body.default)
                ? body.default
                : (materials.find((m) => m.id === DEFAULT_VERTEX_SLICE_MATERIAL)?.id ?? materials[0].id);
        return { materials, defaultId };
    } catch {
        return fallback;
    }
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

export async function sliceStlWithVertexSlice(
    params: VertexSliceSliceParams,
): Promise<VertexSliceSliceResult> {
    const base = trimBaseUrl(params.baseUrl);
    const form = new FormData();
    form.append("profile_id", params.profileId);
    form.append("model", new Blob([params.stl], { type: "model/stl" }), params.fileName ?? "insole.stl");
    form.append("wall_loops", String(params.wallLoops));
    form.append("infill_density", String(params.infillDensityPct));
    form.append("print_direction", params.printDirection);
    form.append("material", params.material ?? DEFAULT_VERTEX_SLICE_MATERIAL);
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
