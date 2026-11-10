// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PrinterPreset } from "@/lib/kiri";
import { PRINTER_PRESETS } from "@/lib/kiri";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../../shared/print-recipe/print-recipe";

/** Apex product line for printed G-code. Shore-A is QC text, not the product name. */
export type ApexPrintMaterialId = "ApexLight" | "ApexCore" | "ApexBounce" | "ApexForge";

/** VertexSlice `/v1/slice` material ids. */
export type VertexSliceMaterialId = "apex_core" | "apex_light" | "apex_forge" | "apex_bounce";

/**
 * Founder-approved Apex Core nozzle. VertexSlice applies it on `apex_core`.
 * OrthoCAD does not send a temperature override on `/v1/slice`.
 */
export const APEX_CORE_NOZZLE_TEMP_C = 225;

/**
 * Apex Bounce is Apex Core with these approved deltas.
 * Speed is a factor of Core's print speeds. Core's mm/s value is not invented here.
 */
export const APEX_BOUNCE_NOZZLE_TEMP_C = 220;
export const APEX_BOUNCE_BED_TEMP_C = 70;
export const APEX_BOUNCE_SPEED_FACTOR = 0.8;

/** Bounded packet for the VertexSlice owner. Not applied by this repository. */
export const VERTEX_SLICE_APEX_BOUNCE_PACKET = {
    owner: "VertexSlice",
    liveVerified: false,
    orthocadSendsProcessOverrides: false,
    materialId: "apex_bounce",
    cloneFromMaterialId: "apex_core",
    nozzleTempC: APEX_BOUNCE_NOZZLE_TEMP_C,
    coreNozzleTempC: APEX_CORE_NOZZLE_TEMP_C,
    bedTempC: APEX_BOUNCE_BED_TEMP_C,
    speedFactorVersusCore: APEX_BOUNCE_SPEED_FACTOR,
    otherwiseIdenticalTo: "apex_core",
    sliceFormFieldsSentByOrthocad: ["profile_id", "material", "infill_density", "model"],
    coreSpeedMmS: null,
    runtimeProofRequired: [
        "GET /v1/materials on the deployed slicer lists apex_bounce.",
        "POST /v1/slice with profile_id apex-v2-insole-95a and material apex_bounce returns non-empty G-code.",
        "That G-code sets the hotend to 220C and the bed to 70C.",
        "Its print speed is 0.8 times the apex_core speed defined in VertexSlice. OrthoCAD does not store that mm/s value.",
    ],
} as const;

export { APEX_V2_INSOLE_LOCKED_PROFILE_ID };

/**
 * Apex Forge process contract from draft PR #265
 * (branch cursor/enable-apex-forge-for-clinical-export-... @ fc3e4aa4adc0e6adcfe0c5a1d2b3a2f52db12c64)
 * and the VertexSlice `apex_forge` registry: nozzle 245°C, bed off (0°C), no wall-loop override.
 * Forge stays disabled in {@link APEX_PRINT_MATERIAL_OPTIONS}. OrthoCAD does not send these
 * numbers on `/v1/slice`; VertexSlice applies them from the material id.
 */
export const APEX_FORGE_NOZZLE_TEMP_C = 245;
export const APEX_FORGE_BED_TEMP_C = 0;
export const APEX_FORGE_BELT_TEMP_C = 0;
/** Null: VertexSlice `apex_forge` sets no wall-loop override. */
export const APEX_FORGE_WALL_LOOPS = null;

/** Founder deltas from Apex Forge: heated belt/bed 60°C and wall loops 6. Nozzle stays 245°C. */
export const APEX_VYLON_NOZZLE_TEMP_C = APEX_FORGE_NOZZLE_TEMP_C;
export const APEX_VYLON_BED_TEMP_C = 60;
export const APEX_VYLON_BELT_TEMP_C = 60;
export const APEX_VYLON_WALL_LOOPS = 6;

export interface ApexProcessSettings {
    id: string;
    label: string;
    vertexSliceMaterial: string;
    lockedProfileId: string;
    nozzleTempC: number;
    bedTempC: number;
    beltTempC: number;
    /** Null means the material defines no wall-loop override. */
    wallLoops: number | null;
}

export const APEX_FORGE_PROCESS_SETTINGS: ApexProcessSettings = {
    id: "ApexForge",
    label: "Apex Forge",
    vertexSliceMaterial: "apex_forge",
    lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
    nozzleTempC: APEX_FORGE_NOZZLE_TEMP_C,
    bedTempC: APEX_FORGE_BED_TEMP_C,
    beltTempC: APEX_FORGE_BELT_TEMP_C,
    wallLoops: APEX_FORGE_WALL_LOOPS,
};

/** ApexVylon is Apex Forge with a 60°C belt/bed and 6 wall loops. AFO shell only. */
export const APEX_VYLON_PROCESS_SETTINGS: ApexProcessSettings = {
    ...APEX_FORGE_PROCESS_SETTINGS,
    id: "ApexVylon",
    label: "ApexVylon",
    vertexSliceMaterial: "apex_vylon",
    nozzleTempC: APEX_VYLON_NOZZLE_TEMP_C,
    bedTempC: APEX_VYLON_BED_TEMP_C,
    beltTempC: APEX_VYLON_BELT_TEMP_C,
    wallLoops: APEX_VYLON_WALL_LOOPS,
};

/**
 * Bounded packet for the VertexSlice owner. Not applied by this repository.
 * Clone `apex_forge`, then set belt/bed 60°C and wall loops 6. Nozzle stays 245°C.
 */
export const VERTEX_SLICE_APEX_VYLON_PACKET = {
    owner: "VertexSlice",
    liveVerified: false,
    orthocadSendsProcessOverrides: false,
    materialId: "apex_vylon",
    cloneFromMaterialId: "apex_forge",
    nozzleTempC: APEX_VYLON_NOZZLE_TEMP_C,
    bedTempC: APEX_VYLON_BED_TEMP_C,
    beltTempC: APEX_VYLON_BELT_TEMP_C,
    wallLoops: APEX_VYLON_WALL_LOOPS,
    otherwiseIdenticalTo: "apex_forge",
    sliceFormFieldsSentByOrthocad: ["profile_id", "material", "infill_density", "model"],
    runtimeProofRequired: [
        "GET /v1/materials on the deployed slicer lists apex_vylon.",
        "POST /v1/slice with profile_id apex-v2-insole-95a and material apex_vylon returns non-empty G-code.",
        "That G-code sets the hotend to 245C, the heated belt/bed to 60C, and wall loops to 6.",
    ],
} as const;

/** AFO shell slice payload. Same locked profile as Apex Forge / Apex Core. Material id `apex_vylon`. */
export function afoShellSliceFields(): { presetId: string; material: "apex_vylon" } {
    return {
        presetId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        material: "apex_vylon",
    };
}

export interface ApexPrintMaterialOption {
    id: ApexPrintMaterialId;
    label: string;
    lockedProfileId: string;
    vertexSliceMaterial: VertexSliceMaterialId;
    /** Secondary QC text. Empty until that product's settings are approved. */
    shoreLabel: string;
    enabled: boolean;
    disabledReason?: string;
}

const SETTINGS_NOT_APPROVED = "Disabled until print settings are approved";

/**
 * Apex Light, Apex Core, and Apex Bounce share the locked process profile id.
 * Bounce process deltas (220°C, 0.8× Core speed, 70°C bed) are applied by VertexSlice
 * on `apex_bounce`. Forge stays disabled. ApexVylon is not an insole product; the AFO
 * shell uses {@link APEX_VYLON_PROCESS_SETTINGS}. ApexComfort uses Apex Core.
 */
export const APEX_PRINT_MATERIAL_OPTIONS: readonly ApexPrintMaterialOption[] = [
    {
        id: "ApexLight",
        label: "Apex Light",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_light",
        shoreLabel: "Shore 90A",
        enabled: true,
    },
    {
        id: "ApexCore",
        label: "Apex Core",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_core",
        shoreLabel: "Shore 95A",
        enabled: true,
    },
    {
        id: "ApexBounce",
        label: "Apex Bounce",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_bounce",
        shoreLabel: "",
        enabled: true,
    },
    {
        id: "ApexForge",
        label: "Apex Forge",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_forge",
        shoreLabel: "",
        enabled: false,
        disabledReason: SETTINGS_NOT_APPROVED,
    },
] as const;

export const DEFAULT_APEX_PRINT_MATERIAL_ID: ApexPrintMaterialId = "ApexCore";

export function apexPrintMaterialById(id: ApexPrintMaterialId): ApexPrintMaterialOption {
    const found = APEX_PRINT_MATERIAL_OPTIONS.find((m) => m.id === id);
    if (!found) throw new Error(`Unknown Apex print material: ${id}`);
    return found;
}

export function vertexSliceMaterialForApexMaterial(materialId: ApexPrintMaterialId): VertexSliceMaterialId {
    return apexPrintMaterialById(materialId).vertexSliceMaterial;
}

export function isApexPrintMaterialExportReady(
    materialId: ApexPrintMaterialId | null | undefined,
): materialId is ApexPrintMaterialId {
    if (!materialId) return false;
    const opt = APEX_PRINT_MATERIAL_OPTIONS.find((m) => m.id === materialId);
    return !!opt?.enabled && !!opt.lockedProfileId;
}

export function lockedProfileIdForApexMaterial(materialId: ApexPrintMaterialId): string {
    const opt = apexPrintMaterialById(materialId);
    if (!opt.enabled || !opt.lockedProfileId) {
        throw new Error(opt.disabledReason ?? "Material not available for export");
    }
    return opt.lockedProfileId;
}

/** Order-material alias. ApexComfort prints with the locked Apex Core profile. */
export function apexPrintMaterialForOrderMaterial(
    orderMaterial: string | null | undefined,
): ApexPrintMaterialId | null {
    const key =
        orderMaterial
            ?.trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "") ?? "";
    if (!key) return null;
    if (key === "apexcomfort") return "ApexCore";
    return APEX_PRINT_MATERIAL_OPTIONS.find((m) => m.id.toLowerCase() === key)?.id ?? null;
}

/** Belt process numbers stay on the existing Apex Belt preset; the slice id is the locked profile. */
export function printerPresetForApexMaterial(materialId: ApexPrintMaterialId): PrinterPreset {
    const profileId = lockedProfileIdForApexMaterial(materialId);
    const belt = PRINTER_PRESETS.find((p) => p.id === "apex-belt-v2");
    const material = apexPrintMaterialById(materialId);
    return {
        id: profileId,
        name: belt?.name ?? "Apex V2 insole (locked process)",
        method: belt?.method ?? "printing_solid",
        beltAngleDeg: belt?.beltAngleDeg,
        nozzleMm: belt?.nozzleMm,
        layerHeightMm: belt?.layerHeightMm,
        material: material.label,
        bed: belt?.bed ?? { x: 300, y: 100000, z: 200 },
    };
}
