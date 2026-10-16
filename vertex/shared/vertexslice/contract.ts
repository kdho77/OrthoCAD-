// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Typed mirror of the VertexSlice headless HTTP API
 * (kdho77/VertexSlice, branch cursor/headless-server-20b4, server/app.py).
 *
 * Form fields, material ids, tunables, response headers, and error statuses
 * match that contract exactly. Hidden printer settings (temps, speeds,
 * retraction, cooling, profile) are not part of the user-facing request.
 */

export const VERTEXSLICE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const VERTEXSLICE_MATERIALS = ["apex_core", "apex_light", "apex_forge", "apex_bounce"] as const;
export type VertexSliceMaterialId = (typeof VERTEXSLICE_MATERIALS)[number];

/** Display names required by the OrthoCAD slicer UI — exact spelling. */
export const VERTEXSLICE_MATERIAL_DISPLAY: Record<VertexSliceMaterialId, string> = {
    apex_core: "ApexCore",
    apex_light: "ApexLight",
    apex_forge: "ApexForge",
    apex_bounce: "ApexBounce",
};

export const DEFAULT_MATERIAL_ID: VertexSliceMaterialId = "apex_core";

export const PRINT_DIRECTION_TOE_FIRST = "toe_first";
export const PRINT_DIRECTION_HEEL_FIRST = "heel_first";
export const PRINT_DIRECTION_CHOICES = [PRINT_DIRECTION_TOE_FIRST, PRINT_DIRECTION_HEEL_FIRST] as const;
export type VertexSlicePrintDirection = (typeof PRINT_DIRECTION_CHOICES)[number];
export const DEFAULT_PRINT_DIRECTION: VertexSlicePrintDirection = PRINT_DIRECTION_TOE_FIRST;

export const DEFAULT_WALL_LOOPS = 1;
export const WALL_LOOPS_MIN = 1;
export const WALL_LOOPS_MAX = 6;
export const REINFORCED_WALL_LOOPS = 4;
/** ApexLight server default (validation/apex_light.py DEFAULT_WALL_LOOPS). */
export const APEX_LIGHT_DEFAULT_WALL_LOOPS = 2;

export const INFILL_DENSITY_PCT_MIN = 5;
export const INFILL_DENSITY_PCT_MAX = 100;
export const DEFAULT_INFILL_DENSITY_PCT = 20;

/** Locked process profile — never shown in the UI. */
export const DEFAULT_PROFILE_ID = "apex-v2-insole-95a";

export const VERTEXSLICE_PROFILE_IDS = [
    "apex-v2-insole-95a",
    "apex-v2-insole-soft",
    "apex-v2-insole-extra-soft",
    "apex-v2-insole-medium",
    "apex-v2-insole-hard",
    "apex-v2-insole-extra-hard",
] as const;
export type VertexSliceProfileId = (typeof VERTEXSLICE_PROFILE_IDS)[number];

/** Multipart field names on POST /v1/slice. */
export const SLICE_FORM_FIELDS = {
    profileId: "profile_id",
    model: "model",
    wallLoops: "wall_loops",
    infillDensity: "infill_density",
    printDirection: "print_direction",
    beltInsolePlace: "belt_insole_place",
    material: "material",
} as const;

/** Response headers on a successful POST /v1/slice. */
export const SLICE_RESPONSE_HEADERS = {
    sliceSeconds: "X-Slice-Seconds",
    peakRssKb: "X-Peak-RSS-KB",
    profileId: "X-Profile-Id",
    material: "X-Material",
    wallLoops: "X-Wall-Loops",
    infillDensity: "X-Infill-Density",
    printDirection: "X-Print-Direction",
} as const;

export interface VertexSliceMaterial {
    id: VertexSliceMaterialId | string;
    display_name: string;
    nozzle: number;
    bed: number;
}

export interface VertexSliceMaterialsResponse {
    materials: VertexSliceMaterial[];
    default: string;
}

export interface VertexSliceProfileDefaults {
    wall_loops: number;
    infill_density_percent: number;
    print_direction: VertexSlicePrintDirection | string;
}

export interface VertexSliceProfile {
    id: string;
    description: string;
    machine: string;
    process: string;
    filament: string;
    defaults: VertexSliceProfileDefaults;
    user_modifiable: string[];
}

export interface VertexSliceTunables {
    wall_loops: {
        default: number;
        min: number;
        max: number;
        user_modifiable: boolean;
    };
    infill_density_percent: {
        min: number;
        max: number;
        user_modifiable: boolean;
        hardness_preset_defaults: Record<string, number>;
    };
    print_direction: {
        default: string;
        choices: string[];
        user_modifiable: boolean;
    };
}

export interface VertexSliceProfilesResponse {
    profiles: VertexSliceProfile[];
    tunables: VertexSliceTunables;
}

export interface VertexSliceHealthResponse {
    status: string;
    service: string;
}

export interface VertexSliceSliceInput {
    profileId: string;
    model: Blob | Uint8Array | ArrayBuffer;
    filename?: string;
    wallLoops?: number | string | null;
    infillDensity?: number | string | null;
    printDirection?: VertexSlicePrintDirection | string | null;
    beltInsolePlace?: boolean;
    material?: VertexSliceMaterialId | string | null;
}

export interface VertexSliceSliceHeaders {
    sliceSeconds: string;
    peakRssKb: string;
    profileId: string;
    material: string;
    wallLoops?: string;
    infillDensity?: string;
    printDirection?: string;
}

export interface VertexSliceSliceSuccess {
    gcode: string;
    headers: VertexSliceSliceHeaders;
    status: 200;
}

export function isVertexSliceMaterialId(value: string): value is VertexSliceMaterialId {
    return (VERTEXSLICE_MATERIALS as readonly string[]).includes(value);
}

export function isPrintDirection(value: string): value is VertexSlicePrintDirection {
    return (PRINT_DIRECTION_CHOICES as readonly string[]).includes(value);
}

export function defaultWallLoopsForMaterial(material: VertexSliceMaterialId | null | undefined): number {
    return material === "apex_light" ? APEX_LIGHT_DEFAULT_WALL_LOOPS : DEFAULT_WALL_LOOPS;
}

export function validateWallLoops(value: number): number {
    const v = Math.trunc(value);
    if (v < WALL_LOOPS_MIN || v > WALL_LOOPS_MAX) {
        throw new Error(`wall_loops must be ${WALL_LOOPS_MIN}–${WALL_LOOPS_MAX}`);
    }
    return v;
}

export function validateInfillDensityPercent(value: number): number {
    const v = Math.round(value);
    if (v < INFILL_DENSITY_PCT_MIN || v > INFILL_DENSITY_PCT_MAX) {
        throw new Error(`infill_density must be ${INFILL_DENSITY_PCT_MIN}–${INFILL_DENSITY_PCT_MAX}%`);
    }
    return v;
}

export function formatInfillDensity(percent: number): string {
    return `${validateInfillDensityPercent(percent)}%`;
}

export function validatePrintDirection(value: string | null | undefined): VertexSlicePrintDirection {
    if (value == null || String(value).trim() === "") return DEFAULT_PRINT_DIRECTION;
    const v = String(value).trim().toLowerCase();
    if (!isPrintDirection(v)) {
        throw new Error(`print_direction must be one of: ${PRINT_DIRECTION_CHOICES.join(", ")}`);
    }
    return v;
}

export function resolveMaterialId(material: string | null | undefined): VertexSliceMaterialId {
    if (material == null || String(material).trim() === "") return DEFAULT_MATERIAL_ID;
    const key = String(material).trim().toLowerCase();
    if (!isVertexSliceMaterialId(key)) {
        throw new Error(
            `Unknown material: ${material}. Expected one of: ${VERTEXSLICE_MATERIALS.join(", ")}`,
        );
    }
    return key;
}
