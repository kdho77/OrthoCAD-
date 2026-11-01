// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PrinterPreset } from "@/lib/kiri";
import { PRINTER_PRESETS } from "@/lib/kiri";

/** Apex TPU product line for 3D-printer G-code (not CNC). */
export type ApexPrintMaterialId = "ApexLight" | "ApexCore" | "ApexBounce" | "ApexForge";

/**
 * VertexSlice `/v1/slice` material ids (locked — matches golden G-code jobs).
 * @see ApexCore_95A_GOLDEN_2026-10-31 · ApexLight_90A_GOLDEN_2026-10-31
 */
export type VertexSliceMaterialId = "apex_core" | "apex_light" | "apex_forge" | "apex_bounce";

/** Locked belt insole process profile — hardness variants are separate ids; material picks 95A vs 90A TPU. */
export const APEX_V2_INSOLE_LOCKED_PROFILE_ID = "apex-v2-insole-95a";

export interface ApexPrintMaterialOption {
    id: ApexPrintMaterialId;
    label: string;
    /** Locked manufacturing / PrintRecipe profile id (no ad-hoc slicer settings). */
    lockedProfileId: string;
    vertexSliceMaterial: VertexSliceMaterialId;
    /** Filament identifier shown in QC / result card (VertexSlice contract). */
    shoreLabel: string;
    goldenArtifact: string;
    enabled: boolean;
    disabledReason?: string;
}

/**
 * Enabled materials map to the locked VertexSlice golden pair:
 * - ApexCore → profile `apex-v2-insole-95a` + material `apex_core` (Shore 95A)
 * - ApexLight → profile `apex-v2-insole-95a` + material `apex_light` (Shore 90A)
 */
export const APEX_PRINT_MATERIAL_OPTIONS: readonly ApexPrintMaterialOption[] = [
    {
        id: "ApexLight",
        label: "Apex Light",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_light",
        shoreLabel: "Shore 90A",
        goldenArtifact: "ApexLight_90A_GOLDEN_2026-10-31",
        enabled: true,
    },
    {
        id: "ApexCore",
        label: "Apex Core",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_core",
        shoreLabel: "Shore 95A",
        goldenArtifact: "ApexCore_95A_GOLDEN_2026-10-31",
        enabled: true,
    },
    {
        id: "ApexBounce",
        label: "Apex Bounce",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_bounce",
        shoreLabel: "",
        goldenArtifact: "",
        enabled: false,
        disabledReason: "Settings not set up yet",
    },
    {
        id: "ApexForge",
        label: "Apex Forge",
        lockedProfileId: APEX_V2_INSOLE_LOCKED_PROFILE_ID,
        vertexSliceMaterial: "apex_forge",
        shoreLabel: "",
        goldenArtifact: "",
        enabled: false,
        disabledReason: "Settings not set up yet",
    },
] as const;

export const APEX_PRINT_MATERIAL_PICK_HINT = "Pick a material";

export function apexPrintMaterialById(id: ApexPrintMaterialId): ApexPrintMaterialOption {
    const found = APEX_PRINT_MATERIAL_OPTIONS.find((m) => m.id === id);
    if (!found) throw new Error(`Unknown Apex print material: ${id}`);
    return found;
}

export function apexPrintMaterialLabel(id: ApexPrintMaterialId): string {
    return apexPrintMaterialById(id).label;
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

/** Preset used for hybrid G-code slicing for a picked Apex material. */
export function printerPresetForApexMaterial(materialId: ApexPrintMaterialId): PrinterPreset | undefined {
    const profileId = lockedProfileIdForApexMaterial(materialId);
    return PRINTER_PRESETS.find((p) => p.id === profileId);
}

export function formatResultMaterialLine(materialId: ApexPrintMaterialId, volumeCm3?: string): string {
    const opt = apexPrintMaterialById(materialId);
    const name = `${opt.label} (${opt.shoreLabel})`;
    return volumeCm3 ? `${name} · ${volumeCm3} cm³` : name;
}
