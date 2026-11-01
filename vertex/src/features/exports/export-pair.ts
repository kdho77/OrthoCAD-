// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { downloadSequential } from "@/features/exports/export-download";
import { buildExportFilename } from "@/features/exports/export-filename";
import type { ExportedFilePart, ExportOutcome } from "@/features/exports/export-service";
import { buildExportStl, exportModeFromMethod } from "@/lib/geometry/export-geometry";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { exportHardness3mf } from "@/lib/hardness/pipeline";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

function partFromBlob(side: Side, filename: string, blob: Blob): ExportedFilePart {
    return { side, filename, blob, sizeBytes: blob.size };
}

export async function exportStlPairSeparate(download = true): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const mode = exportModeFromMethod(design.method);
    try {
        const leftStl = await buildExportStl("left", { exportMode: mode });
        const rightStl = await buildExportStl("right", { exportMode: mode });
        if (!leftStl?.byteLength || !rightStl?.byteLength) {
            return { ok: false, reason: "Export failed" };
        }
        const leftName = buildExportFilename("stl", "left");
        const rightName = buildExportFilename("stl", "right");
        const files: ExportedFilePart[] = [
            partFromBlob("left", leftName, new Blob([leftStl], { type: "model/stl" })),
            partFromBlob("right", rightName, new Blob([rightStl], { type: "model/stl" })),
        ];
        if (download) await downloadSequential(files);
        return {
            ok: true,
            files,
            filename: leftName,
            blob: files[0]!.blob,
        };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Pair STL export failed" };
    }
}

/** Two separate 3MF files (Left / Right), not a combined package. */
export async function export3mfPairSeparate(download = true): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const mode = exportModeFromMethod(design.method);
    try {
        const leftStl = await buildExportStl("left", { exportMode: mode });
        const rightStl = await buildExportStl("right", { exportMode: mode });
        if (!leftStl?.byteLength || !rightStl?.byteLength) {
            return { ok: false, reason: "Export failed" };
        }
        const leftShell = parseBinaryStl(leftStl);
        const rightShell = parseBinaryStl(rightStl);
        const leftPack = await exportHardness3mf({ design, side: "left", shell: leftShell });
        const rightPack = await exportHardness3mf({ design, side: "right", shell: rightShell });
        const leftName = buildExportFilename("3mf", "left");
        const rightName = buildExportFilename("3mf", "right");
        const files: ExportedFilePart[] = [
            partFromBlob("left", leftName, new Blob([leftPack.bytes], { type: "model/3mf" })),
            partFromBlob("right", rightName, new Blob([rightPack.bytes], { type: "model/3mf" })),
        ];
        if (download) await downloadSequential(files);
        return {
            ok: true,
            files,
            filename: leftName,
            blob: files[0]!.blob,
            report: leftPack.report,
        };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Pair 3MF export failed" };
    }
}

export function pairFileCount(outcome: ExportOutcome): number {
    if (outcome.files?.length) return outcome.files.length;
    return outcome.ok && outcome.blob ? 1 : 0;
}

export function filenamesEndWithSideLabels(files: ExportedFilePart[]): boolean {
    const left = files.find((f) => f.side === "left")?.filename ?? "";
    const right = files.find((f) => f.side === "right")?.filename ?? "";
    return /-L-/i.test(left) && /-R-/i.test(right);
}
