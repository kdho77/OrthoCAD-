// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    type ApexPrintMaterialId,
    apexPrintMaterialById,
    DEFAULT_APEX_PRINT_MATERIAL_ID,
    isApexPrintMaterialExportReady,
} from "@/features/exports/apex-print-material";
import {
    type ExportOutcome,
    exportGcode,
    type GcodeExportStep,
    type GrindingStyleInput,
    generateHybridGcode,
} from "@/features/exports/export-service";
import { resolveViewerWallStyle } from "@/lib/geometry/procedural-wall/viewer-wall-flag";
import { type CamOverrides, type PrinterPreset, presetsForMethod } from "@/lib/kiri";
import type { ViewerSettings } from "@/stores/design-store";
import type { DesignState, ProductionMethod, Side } from "@/types";
import { infillFractionFromRecipe, migratePrintRecipe } from "../../../shared/print-recipe/print-recipe";

export type ClinicalExportKind = "stl" | "glb" | "3mf" | "gcode";

const MESH_KINDS: ClinicalExportKind[] = ["stl", "3mf", "glb"];

/** Compact Export tab file types for the clinical workflow. */
export function clinicalExportFormatTabs(method: ProductionMethod): ClinicalExportKind[] {
    if (method === "milling_3axis") return [...MESH_KINDS];
    return [...MESH_KINDS, "gcode"];
}

export function clinicalExportOffersGcode(method: ProductionMethod): boolean {
    return method !== "milling_3axis";
}

export function defaultPrinterPresetForMethod(method: ProductionMethod): PrinterPreset | undefined {
    const presets = presetsForMethod(method);
    return presets.find((p) => p.beltAngleDeg) ?? presets[0];
}

export function defaultClinicalGcodeMaterial(): ApexPrintMaterialId {
    return DEFAULT_APEX_PRINT_MATERIAL_ID;
}

export function grindingStyleFromViewerWall(wallStyle: ViewerSettings["wallStyle"]): GrindingStyleInput {
    const style = resolveViewerWallStyle(wallStyle);
    if (style === "straight") return { type: "straight", angle_degrees: 8 };
    return { type: "rounded", radius_mm: 3 };
}

function camOverridesForClinicalExport(design: DesignState, preset: PrinterPreset): CamOverrides {
    const recipeInfillPct = Math.round(
        infillFractionFromRecipe(migratePrintRecipe(design.printRecipe)) * 100,
    );
    return {
        layerHeightMm: preset.layerHeightMm ?? 0.3,
        infillDensity: recipeInfillPct / 100,
    };
}

/**
 * VertexSlice / manufacturing.generateSolid path used on Print — same contract for Export downloads.
 */
export async function exportClinicalPrinterGcode(input: {
    side: Side;
    design: DesignState;
    wallStyle?: Parameters<typeof resolveViewerWallStyle>[0];
    /** Apex product. Defaults to Apex Core. Bounce is refused until approved. */
    apexMaterialId?: ApexPrintMaterialId;
    /** Belt G-code adds the sacrificial leader before the slicer. Default on. */
    includeLeaderBlock?: boolean;
    onProgress?: (step: GcodeExportStep) => void;
}): Promise<ExportOutcome> {
    const preset = defaultPrinterPresetForMethod(input.design.method);
    if (!preset) {
        return { ok: false, reason: "No printer preset for this production method" };
    }
    const apexMaterialId = input.apexMaterialId ?? defaultClinicalGcodeMaterial();
    if (!isApexPrintMaterialExportReady(apexMaterialId)) {
        const reason =
            apexPrintMaterialById(apexMaterialId).disabledReason ?? "Material not available for export";
        return { ok: false, reason };
    }
    const overrides = camOverridesForClinicalExport(input.design, preset);
    const grindingStyle = grindingStyleFromViewerWall(input.wallStyle);
    const options = {
        apexMaterialId,
        includeLeaderBlock: input.includeLeaderBlock !== false,
        onProgress: input.onProgress,
    };
    if (preset.beltAngleDeg) {
        return generateHybridGcode(input.side, preset, grindingStyle, overrides, options);
    }
    return exportGcode(input.side, preset, overrides, options);
}
