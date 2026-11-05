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
    MILLED_ORDER_PRINT_REASON,
} from "@/features/exports/export-service";
import { exportMachineFamily, pairExportLayout } from "@/features/exports/machine-export-layout";
import { orderDownloadSides } from "@/lib/geometry/export-geometry";
import { resolveViewerWallStyle } from "@/lib/geometry/procedural-wall/viewer-wall-flag";
import { type CamOverrides, type PrinterPreset, presetsForMethod } from "@/lib/kiri";
import type { ViewerSettings } from "@/stores/design-store";
import { type DesignState, type ProductionMethod, SIDE_LABELS, type Side } from "@/types";
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

export type GcodeFootScope = "left" | "right" | "both";

/** Paired orders default to both feet. A one-foot order stays on that foot. */
export function defaultGcodeFootScope(design: DesignState): GcodeFootScope {
    const sides = orderDownloadSides(design);
    return sides.length > 1 ? "both" : (sides[0] ?? "left");
}

/** Explicit Left or Right never expands to the other foot. Both uses the order's feet. */
export function gcodeFeetForExport(design: DesignState, scope: GcodeFootScope): Side[] {
    const sides = orderDownloadSides(design);
    if (scope === "both") return sides.length > 0 ? [...sides] : ["left"];
    return sides.includes(scope) ? [scope] : [];
}

function objectUrlForBlob(blob: Blob): string {
    try {
        return URL.createObjectURL(blob);
    } catch (error) {
        // happy-dom's Blob and Node's URL.createObjectURL disagree on instanceof.
        // Browsers take the first path. The filename on the anchor is what the user saves.
        const message = error instanceof Error ? error.message : "";
        if (!/instance of Blob/i.test(message)) throw error;
        return `blob:orthocad/${blob.size}`;
    }
}

/** Both clicks happen in one turn, after every foot has a file. */
export function downloadNamedBlobs(files: ReadonlyArray<{ filename: string; blob: Blob }>): void {
    const urls: string[] = [];
    for (const file of files) {
        const url = objectUrlForBlob(file.blob);
        urls.push(url);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = file.filename;
        anchor.rel = "noopener";
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
    }
    setTimeout(() => {
        for (const url of urls) {
            if (url.startsWith("blob:orthocad/")) continue;
            URL.revokeObjectURL(url);
        }
    }, 2000);
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
    /**
     * Paired Export passes "both". Omit to keep a single-side call on `side`
     * (Print prep and older callers).
     */
    feet?: GcodeFootScope;
    design: DesignState;
    wallStyle?: Parameters<typeof resolveViewerWallStyle>[0];
    /** Apex product. Defaults to Apex Core. Bounce and Forge are refused. */
    apexMaterialId?: ApexPrintMaterialId;
    /** Belt G-code adds the sacrificial leader before the slicer. Default on. */
    includeLeaderBlock?: boolean;
    onProgress?: (step: GcodeExportStep | string) => void;
    shouldAbort?: () => boolean;
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
    const family = exportMachineFamily({
        method: input.design.method,
        beltAngleDeg: preset.beltAngleDeg,
    });
    if (family === "cnc") {
        return { ok: false, reason: MILLED_ORDER_PRINT_REASON };
    }
    const overrides = camOverridesForClinicalExport(input.design, preset);
    const grindingStyle = grindingStyleFromViewerWall(input.wallStyle);
    // Conventional beds keep one side-by-side file. Only the belt loops feet.
    if (pairExportLayout(family) !== "separate-files") {
        const options = {
            apexMaterialId,
            includeLeaderBlock: false,
            onProgress: input.onProgress,
            shouldAbort: input.shouldAbort,
        };
        return exportGcode(input.side, preset, overrides, options);
    }
    const feet = input.feet ? gcodeFeetForExport(input.design, input.feet) : [input.side];
    if (feet.length === 0) {
        return { ok: false, reason: `This order has no ${input.feet ?? input.side} foot to export.` };
    }
    const many = feet.length > 1;
    const built: { side: Side; filename: string; blob: Blob }[] = [];
    for (const foot of feet) {
        if (input.shouldAbort?.()) {
            return { ok: false, reason: "Export cancelled. No G-code was downloaded.", cancelled: true };
        }
        const options = {
            apexMaterialId,
            includeLeaderBlock: input.includeLeaderBlock !== false,
            deferDownload: true,
            shouldAbort: input.shouldAbort,
            onProgress: (step: string) => input.onProgress?.(many ? `${SIDE_LABELS[foot]}: ${step}` : step),
        };
        const res = await generateHybridGcode(foot, preset, grindingStyle, overrides, options);
        if (res.cancelled || input.shouldAbort?.()) {
            return { ok: false, reason: "Export cancelled. No G-code was downloaded.", cancelled: true };
        }
        if (!res.ok || !res.blob || !res.filename) {
            const detail = res.reason ?? "G-code export failed";
            const reason = many
                ? `${SIDE_LABELS[foot]} G-code failed. No files were downloaded. ${detail}`
                : detail;
            return { ok: false, reason };
        }
        built.push({ side: foot, filename: res.filename, blob: res.blob });
    }
    downloadNamedBlobs(built);
    const filenames = built.map((file) => file.filename);
    return {
        ok: true,
        filename: filenames.join(", "),
        filenames,
        blob: built[0]?.blob,
    };
}
