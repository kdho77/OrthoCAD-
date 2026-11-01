// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { PrinterPreset } from "@/lib/kiri";
import { PRINTER_PRESETS } from "@/lib/kiri";

/** Apex TPU product line for 3D-printer G-code (not CNC). */
export type ApexPrintMaterialId = "ApexLight" | "ApexCore" | "ApexBounce" | "ApexForge";

export interface ApexPrintMaterialOption {
    id: ApexPrintMaterialId;
    label: string;
    /** Maps to an existing locked PrintRecipe / manufacturing profile id — no new slicer settings. */
    lockedProfileId?: string;
    enabled: boolean;
    disabledReason?: string;
}

/**
 * Enabled materials map to existing locked client preset ids (see shared print-recipe gyroid presets).
 * - ApexCore → apex-belt-v2 (solid belt gyroid, DEFAULT_PRODUCTION_PROFILE_ID)
 * - ApexLight → apex-belt-v2-shell (shell belt profile id)
 */
export const APEX_PRINT_MATERIAL_OPTIONS: readonly ApexPrintMaterialOption[] = [
    {
        id: "ApexLight",
        label: "Apex Light",
        lockedProfileId: "apex-belt-v2-shell",
        enabled: true,
    },
    {
        id: "ApexCore",
        label: "Apex Core",
        lockedProfileId: "apex-belt-v2",
        enabled: true,
    },
    {
        id: "ApexBounce",
        label: "Apex Bounce",
        enabled: false,
        disabledReason: "Settings not set up yet",
    },
    {
        id: "ApexForge",
        label: "Apex Forge",
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
    const name = apexPrintMaterialLabel(materialId);
    return volumeCm3 ? `${name} · ${volumeCm3} cm³` : name;
}
