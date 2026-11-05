// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PrinterPreset } from "@/lib/kiri";
import { PRINTER_PRESETS } from "@/lib/kiri";
import { APEX_V2_INSOLE_LOCKED_PROFILE_ID } from "../../../shared/print-recipe/print-recipe";

/** Apex product line for printed G-code. Shore-A is QC text, not the product name. */
export type ApexPrintMaterialId = "ApexLight" | "ApexCore" | "ApexBounce" | "ApexForge";

/** VertexSlice `/v1/slice` material ids. */
export type VertexSliceMaterialId = "apex_core" | "apex_light" | "apex_forge" | "apex_bounce";

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
 * Apex Light and Apex Core share the locked process profile.
 * Bounce and Forge stay visible and disabled until settings are approved.
 * ApexComfort is not a fifth product: it uses Apex Core's locked settings.
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
        enabled: false,
        disabledReason: SETTINGS_NOT_APPROVED,
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
