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

function sessionFilesFromOutcome(
    res: Awaited<ReturnType<typeof exportDesign>>,
    kind: SessionExportRecord["kind"],
    target: ExportOutputTarget,
    designRevision: string,
    tokensCharged: number,
): SessionExportRecord | null {
    if (!res.ok) return null;
    const id = `${kind}-${Date.now()}`;
    if (res.files?.length) {
        const parts = res.files.map((f) => ({
            side: f.side,
            filename: f.filename,
            sizeBytes: f.sizeBytes,
            blob: f.blob,
            estimatedTimeSec: f.stats?.estimatedTimeSec,
            materialLabel: f.stats ? `${(f.stats.estimatedMaterialMm3 / 1000).toFixed(1)} cm³` : undefined,
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
        materialLabel: stats ? `${(stats.estimatedMaterialMm3 / 1000).toFixed(1)} cm³` : undefined,
    };
}

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

    if (!preset) return { ok: false, reason: "Choose a printer preset in Print", noTokens: true };

    let res: Awaited<ReturnType<typeof exportPrintGcode>>;
    if (cnc) {
        res = await exportCncGcode(["left", "right"], millingProfile);
    } else if (target === "pair" || preset.beltAngleDeg) {
        res = await exportPrintGcode(target, preset, grindingStyle, overrides, { download: true });
    } else {
        res = await exportGcode(target, preset, overrides, { download: true });
    }

    const record = sessionFilesFromOutcome(res, "gcode", target, designRevision, TOKEN_COST.gcode);
    if (!record) {
        return {
            ok: false,
            reason: stlExportUserMessage(res.reason ?? "G-code export failed"),
            noTokens: true,
        };
    }
    return { ok: true, record };
}
