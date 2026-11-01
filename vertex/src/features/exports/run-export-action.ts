// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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

export async function runExportForChoice(options: {
    choice: ExportFileTypeChoice;
    target: ExportOutputTarget;
    cnc: boolean;
    preset: PrinterPreset | undefined;
    grindingStyle: GrindingStyleInput;
    overrides: CamOverrides;
    millingProfile: MillingProfile;
    designRevision: string;
}): Promise<{ ok: true; record: SessionExportRecord } | { ok: false; reason: string; noTokens?: boolean }> {
    const { choice, target, cnc, preset, grindingStyle, overrides, millingProfile, designRevision } = options;

    if (choice === "stl") {
        const res = await exportDesign("stl", target);
        if (!res.ok || !res.blob) {
            return { ok: false, reason: stlExportUserMessage(res.reason), noTokens: true };
        }
        return {
            ok: true,
            record: {
                id: `stl-${Date.now()}`,
                kind: "stl",
                target,
                filename: res.filename ?? buildExportFilename("stl", target),
                sizeBytes: res.blob.size,
                blob: res.blob,
                tokensCharged: TOKEN_COST.stl,
                designRevision,
                createdAt: Date.now(),
            },
        };
    }

    if (choice === "3mf") {
        const res = await exportDesign("3mf", target);
        if (!res.ok || !res.blob) {
            return { ok: false, reason: res.reason ?? "3MF export failed", noTokens: true };
        }
        return {
            ok: true,
            record: {
                id: `3mf-${Date.now()}`,
                kind: "3mf",
                target,
                filename: res.filename ?? buildExportFilename("3mf", target),
                sizeBytes: res.blob.size,
                blob: res.blob,
                tokensCharged: TOKEN_COST["3mf"],
                designRevision,
                createdAt: Date.now(),
            },
        };
    }

    if (!preset) return { ok: false, reason: "Choose a printer preset in Print", noTokens: true };

    let res: Awaited<ReturnType<typeof exportPrintGcode>>;
    if (cnc) {
        res = await exportCncGcode(["left", "right"], millingProfile);
    } else if (target === "pair" || preset.beltAngleDeg) {
        res = await exportPrintGcode(target, preset, grindingStyle, overrides, { download: true });
    } else {
        res = await exportGcode(target, preset, overrides, { download: true });
    }

    if (!res.ok || !res.blob) {
        return {
            ok: false,
            reason: stlExportUserMessage(res.reason ?? "G-code export failed"),
            noTokens: true,
        };
    }

    const stats = res.stats as CamResult["stats"] | undefined;
    return {
        ok: true,
        record: {
            id: `gcode-${Date.now()}`,
            kind: "gcode",
            target,
            filename: res.filename ?? buildExportFilename("gcode", target),
            sizeBytes: res.blob.size,
            blob: res.blob,
            tokensCharged: TOKEN_COST.gcode,
            designRevision,
            createdAt: Date.now(),
            estimatedTimeSec: stats?.estimatedTimeSec,
            materialLabel: stats ? `${(stats.estimatedMaterialMm3 / 1000).toFixed(1)} cm³` : undefined,
        },
    };
}
