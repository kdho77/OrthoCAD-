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
 * on `apex_bounce`. Forge stays disabled. ApexComfort uses Apex Core.
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

/**
 * Order-material alias. ApexComfort prints with the locked Apex Core profile.
 * "ApexLight Foam" is the VertexOrders label for Apex Light, not a separate product.
 * Spaces, underscores, and hyphens are ignored, so "Apex Light", "ApexLight", and
 * "apex_light" match ApexLight.
 */
const ORDER_MATERIAL_ALIASES: Record<string, ApexPrintMaterialId> = {
    apexcomfort: "ApexCore",
    apexlightfoam: "ApexLight",
};

export function apexPrintMaterialForOrderMaterial(
    orderMaterial: string | null | undefined,
): ApexPrintMaterialId | null {
    const key =
        orderMaterial
            ?.trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "") ?? "";
    if (!key) return null;
    const alias = ORDER_MATERIAL_ALIASES[key];
    if (alias) return alias;
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
