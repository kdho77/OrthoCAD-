// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
//
// Shared OrthoCAD ↔ VertexSlice contract for regional hardness.
// The slice endpoint stays POST /v1/slice with profile_id, material,
// infill_density (the device / global percent), and model.
// A design with no regions keeps today's STL model part.
// A design with regions sends model.3mf only when VERTEXSLICE_REGIONAL_3MF is on,
// so a slicer that does not apply modifier_part yet still receives the STL.

/** Server env. Unset or any other value keeps the STL path. Not a VITE_ name. */
export const VERTEXSLICE_REGIONAL_3MF_ENV = "VERTEXSLICE_REGIONAL_3MF";

export const VERTEXSLICE_REGIONS_HEADER = "X-VertexSlice-Regions";

export const VERTEXSLICE_3MF_FILENAME = "model.3mf";
export const VERTEXSLICE_3MF_CONTENT_TYPE = "model/3mf";
export const VERTEXSLICE_STL_CONTENT_TYPE = "model/stl";

/** The only densities a regional modifier may carry. */
export const REGIONAL_INFILL_PRESETS = [
    { hardnessClass: "Extra Soft", densityPct: 14 },
    { hardnessClass: "Soft", densityPct: 20 },
    { hardnessClass: "Medium", densityPct: 26 },
    { hardnessClass: "Hard", densityPct: 32 },
    { hardnessClass: "Extra Hard", densityPct: 38 },
] as const;

export type RegionalInfillPreset = (typeof REGIONAL_INFILL_PRESETS)[number];

const ENABLED = new Set(["1", "true", "yes", "on"]);

export function vertexSliceRegional3mfEnabled(env?: Record<string, string | undefined>): boolean {
    const source = env ?? process.env;
    const raw = source[VERTEXSLICE_REGIONAL_3MF_ENV]?.trim().toLowerCase() ?? "";
    return ENABLED.has(raw);
}

export function isVertexSlice3mfModel(bytes: Uint8Array, filename?: string): boolean {
    const name = filename?.trim().toLowerCase() ?? "";
    if (name.endsWith(".3mf")) return true;
    return (
        bytes.byteLength >= 4 &&
        bytes[0] === 0x50 &&
        bytes[1] === 0x4b &&
        bytes[2] === 0x03 &&
        bytes[3] === 0x04
    );
}

export function assertRegionalInfillPreset(region: {
    regionId: string;
    hardnessClass: string;
    overrides?: { sparseInfillDensityPct?: number };
}): number {
    const preset = REGIONAL_INFILL_PRESETS.find((item) => item.hardnessClass === region.hardnessClass);
    if (!preset) {
        throw new Error(
            `Regional hardness ${region.regionId} (${region.hardnessClass}) is not one of the presets Extra Soft 14%, Soft 20%, Medium 26%, Hard 32%, Extra Hard 38%.`,
        );
    }
    const override = region.overrides?.sparseInfillDensityPct;
    if (override !== undefined && override !== preset.densityPct) {
        throw new Error(
            `Regional hardness ${region.regionId} density ${override}% is not the ${preset.hardnessClass} preset (${preset.densityPct}%).`,
        );
    }
    return preset.densityPct;
}

export interface Regional3mfPayload {
    bytes: Uint8Array;
    regionCount: number;
}

/**
 * Gate off, or no modifier payload: the STL bytes and today's filename.
 * Gate on with modifiers: model.3mf and the count the slicer must apply.
 */
export function selectVertexSliceUpload(args: {
    stl: Uint8Array;
    stlFilename: string;
    regional3mf: Regional3mfPayload | null;
    regional3mfEnabled: boolean;
}): {
    bytes: Uint8Array;
    filename: string;
    contentType: typeof VERTEXSLICE_STL_CONTENT_TYPE | typeof VERTEXSLICE_3MF_CONTENT_TYPE;
    expectedRegionCount?: number;
} {
    if (args.regional3mfEnabled && args.regional3mf && args.regional3mf.regionCount > 0) {
        return {
            bytes: args.regional3mf.bytes,
            filename: VERTEXSLICE_3MF_FILENAME,
            contentType: VERTEXSLICE_3MF_CONTENT_TYPE,
            expectedRegionCount: args.regional3mf.regionCount,
        };
    }
    return {
        bytes: args.stl,
        filename: args.stlFilename,
        contentType: VERTEXSLICE_STL_CONTENT_TYPE,
    };
}
