// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import {
    APEX_PRINT_MATERIAL_PICK_HINT,
    type ApexPrintMaterialId,
    formatResultMaterialLine,
    isApexPrintMaterialExportReady,
    printerPresetForApexMaterial,
} from "@/features/exports/apex-print-material";
import type { ExportFileTypeChoice } from "@/features/exports/export-file-type-store";
import { buildExportFilename } from "@/features/exports/export-filename";
import {
    exportCncGcode,
    exportDesign,
    exportGcode,
    exportPrintGcode,
    type GrindingStyleInput,
} from "@/features/exports/export-service";
import type { SessionExportRecord } from "@/features/exports/export-session-store";
import type { ExportOutputTarget } from "@/features/exports/export-target";
import { stlExportUserMessage } from "@/features/exports/export-user-message";
import { TOKEN_COST } from "@/features/licensing/license";
import type { MillingProfile } from "@/lib/cnc/types";
import type { CamOverrides, CamResult, PrinterPreset } from "@/lib/kiri";

function sessionFilesFromOutcome(
    res: Awaited<ReturnType<typeof exportDesign>>,
    kind: SessionExportRecord["kind"],
    target: ExportOutputTarget,
    designRevision: string,
    tokensCharged: number,
    apexMaterialId?: ApexPrintMaterialId,
): SessionExportRecord | null {
    if (!res.ok) return null;
    const id = `${kind}-${Date.now()}`;
    const volumeCm3 = (stats?: CamResult["stats"]) =>
        stats ? `${(stats.estimatedMaterialMm3 / 1000).toFixed(1)}` : undefined;
    const materialLabelForGcode = (stats?: CamResult["stats"]) =>
        apexMaterialId
            ? formatResultMaterialLine(apexMaterialId, volumeCm3(stats))
            : volumeCm3(stats)
              ? `${volumeCm3(stats)} cm³`
              : undefined;
    if (res.files?.length) {
        const parts = res.files.map((f) => ({
            side: f.side,
            filename: f.filename,
            sizeBytes: f.sizeBytes,
            blob: f.blob,
            estimatedTimeSec: f.stats?.estimatedTimeSec,
            materialLabel: materialLabelForGcode(f.stats),
        }));
        const totalBytes = parts.reduce((n, p) => n + p.sizeBytes, 0);
        return {
            id,
            kind,
            target,
            filename: parts.map((p) => p.filename).join(" · "),
            sizeBytes: totalBytes,
            blob: parts[0]!.blob,
            tokensCharged,
            designRevision,
            createdAt: Date.now(),
            files: parts,
        };
    }
    if (!res.blob) return null;
    const stats = res.stats as CamResult["stats"] | undefined;
    return {
        id,
        kind,
        target,
        filename: res.filename ?? buildExportFilename(kind, target),
        sizeBytes: res.blob.size,
        blob: res.blob,
        tokensCharged,
        designRevision,
        createdAt: Date.now(),
        estimatedTimeSec: stats?.estimatedTimeSec,
        materialLabel: materialLabelForGcode(stats),
    };
}

export async function runExportForChoice(options: {
    choice: ExportFileTypeChoice;
    target: ExportOutputTarget;
    cnc: boolean;
    preset: PrinterPreset | undefined;
    apexMaterialId: ApexPrintMaterialId | null;
    grindingStyle: GrindingStyleInput;
    overrides: CamOverrides;
    millingProfile: MillingProfile;
    designRevision: string;
}): Promise<{ ok: true; record: SessionExportRecord } | { ok: false; reason: string; noTokens?: boolean }> {
    const {
        choice,
        target,
        cnc,
        preset: uiPreset,
        apexMaterialId,
        grindingStyle,
        overrides,
        millingProfile,
        designRevision,
    } = options;

    if (choice === "stl") {
        const res = await exportDesign("stl", target);
        const record = sessionFilesFromOutcome(res, "stl", target, designRevision, TOKEN_COST.stl);
        if (!record) {
            return { ok: false, reason: stlExportUserMessage(res.reason), noTokens: true };
        }
        return { ok: true, record };
    }

    if (choice === "3mf") {
        const res = await exportDesign("3mf", target);
        const record = sessionFilesFromOutcome(res, "3mf", target, designRevision, TOKEN_COST["3mf"]);
        if (!record) {
            return { ok: false, reason: res.reason ?? "3MF export failed", noTokens: true };
        }
        return { ok: true, record };
    }

    let preset = uiPreset;
    if (!cnc) {
        if (!isApexPrintMaterialExportReady(apexMaterialId)) {
            return { ok: false, reason: APEX_PRINT_MATERIAL_PICK_HINT, noTokens: true };
        }
        preset = printerPresetForApexMaterial(apexMaterialId);
    }

    if (!preset) return { ok: false, reason: "Choose a printer preset in Print", noTokens: true };

    let res: Awaited<ReturnType<typeof exportPrintGcode>>;
    const gcodeOptions = { download: true, apexMaterialId: apexMaterialId ?? undefined };
    if (cnc) {
        res = await exportCncGcode(["left", "right"], millingProfile);
    } else if (target === "pair" || preset.beltAngleDeg) {
        res = await exportPrintGcode(target, preset, grindingStyle, overrides, gcodeOptions);
    } else {
        res = await exportGcode(target, preset, overrides, gcodeOptions);
    }

    const record = sessionFilesFromOutcome(
        res,
        "gcode",
        target,
        designRevision,
        TOKEN_COST.gcode,
        apexMaterialId ?? undefined,
    );
    if (!record) {
        return {
            ok: false,
            reason: stlExportUserMessage(res.reason ?? "G-code export failed"),
            noTokens: true,
        };
    }
    return { ok: true, record };
}
