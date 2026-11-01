// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import JSZip from "jszip";
import { buildExportFilename } from "@/features/exports/export-filename";
import type { ExportOutcome } from "@/features/exports/export-service";
import { buildExportStl, exportModeFromMethod } from "@/lib/geometry/export-geometry";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { exportHardness3mf } from "@/lib/hardness/pipeline";
import { useDesignStore } from "@/stores/design-store";
import type { Side } from "@/types";

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function buildStlPairZip(): Promise<{ bytes: Uint8Array; filenames: [string, string] }> {
    const { design } = useDesignStore.getState();
    const mode = exportModeFromMethod(design.method);
    const leftStl = await buildExportStl("left", { exportMode: mode });
    const rightStl = await buildExportStl("right", { exportMode: mode });
    const zip = new JSZip();
    const leftName = buildExportFilename("stl", "left")
        .replace(/-LR-/, "-L-")
        .replace(/\.stl$/, ".stl");
    const rightName = buildExportFilename("stl", "right")
        .replace(/-LR-/, "-R-")
        .replace(/\.stl$/, ".stl");
    zip.file(leftName, leftStl);
    zip.file(rightName, rightStl);
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return { bytes, filenames: [leftName, rightName] };
}

export async function exportStlPairZip(download = true): Promise<ExportOutcome & { entryCount?: number }> {
    try {
        const { bytes } = await buildStlPairZip();
        const filename = buildExportFilename("zip", "pair");
        const blob = new Blob([bytes], { type: "application/zip" });
        if (download) downloadBlob(blob, filename);
        const zip = await JSZip.loadAsync(bytes);
        const entryCount = Object.keys(zip.files).filter((k) => !zip.files[k]?.dir).length;
        return { ok: true, filename, blob, entryCount };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Pair STL export failed" };
    }
}

/** One 3MF with two named objects (Left / Right) — shell-only pair pack for slicers. */
export async function export3mfPair(download = true): Promise<ExportOutcome & { objectNames?: string[] }> {
    const { design } = useDesignStore.getState();
    const mode = exportModeFromMethod(design.method);
    try {
        const leftStl = await buildExportStl("left", { exportMode: mode });
        const rightStl = await buildExportStl("right", { exportMode: mode });
        const leftShell = parseBinaryStl(leftStl);
        const rightShell = parseBinaryStl(rightStl);
        const leftPack = await exportHardness3mf({ design, side: "left", shell: leftShell });
        const rightPack = await exportHardness3mf({ design, side: "right", shell: rightShell });
        const zip = new JSZip();
        const leftZip = await JSZip.loadAsync(leftPack.bytes);
        const rightZip = await JSZip.loadAsync(rightPack.bytes);
        const leftFile = leftZip.file("3D/3dmodel.model");
        const rightFile = rightZip.file("3D/3dmodel.model");
        if (!leftFile || !rightFile) return { ok: false, reason: "3MF model missing" };
        const leftModel = await leftFile.async("string");
        const rightModel = await rightFile.async("string");
        const combinedSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
<object id="1">
<metadata type="object" key="name" value="Left"/>
</object>
<object id="2">
<metadata type="object" key="name" value="Right"/>
</object>
</config>`;
        const combinedModel = mergePair3mfModels(leftModel, rightModel);
        const ct = leftZip.file("[Content_Types].xml");
        const rels = leftZip.file("_rels/.rels");
        if (!ct || !rels) return { ok: false, reason: "3MF package incomplete" };
        zip.file("[Content_Types].xml", await ct.async("string"));
        zip.file("_rels/.rels", await rels.async("string"));
        zip.file("3D/3dmodel.model", combinedModel);
        zip.file("Metadata/model_settings.config", combinedSettings);
        const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
        const filename = buildExportFilename("3mf", "pair");
        const blob = new Blob([bytes], { type: "model/3mf" });
        if (download) downloadBlob(blob, filename);
        return { ok: true, filename, blob, objectNames: ["Left", "Right"] };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Pair 3MF export failed" };
    }
}

function mergePair3mfModels(leftXml: string, rightXml: string): string {
    const extractResources = (xml: string) => {
        const m = xml.match(/<resources>([\s\S]*?)<\/resources>/);
        return m?.[1] ?? "";
    };
    const leftResources = extractResources(leftXml).replace(/id="(\d+)"/g, (_, id) => `id="L${id}"`);
    const rightResources = extractResources(rightXml).replace(/id="(\d+)"/g, (_, id) => `id="R${id}"`);
    return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">OrthoCAD</metadata>
<resources>${leftResources}${rightResources}</resources>
<build>
<item objectid="L1"/>
<item objectid="R1"/>
</build>
</model>`;
}

export async function zipGcodePair(
    left: { blob: Blob; filename: string },
    right: { blob: Blob; filename: string },
    download = true,
): Promise<ExportOutcome> {
    const zip = new JSZip();
    zip.file(left.filename, await left.blob.arrayBuffer());
    zip.file(right.filename, await right.blob.arrayBuffer());
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const filename = buildExportFilename("zip", "pair");
    const blob = new Blob([bytes], { type: "application/zip" });
    if (download) downloadBlob(blob, filename);
    return { ok: true, filename, blob };
}

export function stlZipEntryCount(bytes: Uint8Array): Promise<number> {
    return JSZip.loadAsync(bytes).then(
        (zip) => Object.keys(zip.files).filter((k) => !zip.files[k]?.dir).length,
    );
}

export function modelSettingsObjectNames(bytes: Uint8Array): Promise<string[]> {
    return JSZip.loadAsync(bytes).then(async (zip) => {
        const cfg = zip.file("Metadata/model_settings.config");
        if (!cfg) return [];
        const text = await cfg.async("string");
        const names: string[] = [];
        const re = /key="name" value="([^"]+)"/g;
        for (const hit of text.matchAll(re)) {
            if (hit[1]) names.push(hit[1]);
        }
        return names;
    });
}
