import { canExport, TOKEN_COST } from "@/features/licensing/license";
import {
    buildExportGeometry,
    buildExportGlb,
    buildExportSolid,
    buildExportStl,
    ExportGeometryNotReadyError,
    exportModeFromMethod,
} from "@/lib/geometry/export-geometry";
import { type CamOverrides, type CamResult, generateGcode, type PrinterPreset } from "@/lib/kiri";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import type { ExportFormat, GrindingStyle, Side } from "@/types";

// Re-export for convenience in UI components
export type GrindingStyleInput = GrindingStyle;

export interface ExportOutcome {
    ok: boolean;
    reason?: string;
    filename?: string;
    blob?: Blob;
    stats?: CamResult["stats"];
    productionId?: string;
}

function buildSideGeometry(side: Side) {
    return buildExportGeometry(side);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

/** Export the finalized viewer solid as binary STL (OCCT sew primary, mesh-close fallback). */
async function buildManufacturingStl(side: Side): Promise<ArrayBuffer> {
    const { design } = useDesignStore.getState();
    return buildExportStl(side, { exportMode: exportModeFromMethod(design.method) });
}

async function authorize(
    format: "stl" | "gcode",
    side: Side,
    fileName: string,
): Promise<{ ok: boolean; reason?: string }> {
    const { user, license, deductTokens, setUser } = useAuthStore.getState();
    if (isApiConfigured()) {
        try {
            const res = await trpc.export.authorize.mutate({ format, side, fileName });
            if (!res.ok) return { ok: false, reason: "Authorization denied" };
            if (user) setUser({ ...user, tokenBalance: res.balance });
            return { ok: true };
        } catch (e) {
            return { ok: false, reason: e instanceof Error ? e.message : "Export authorization failed" };
        }
    }
    const check = canExport(user, license, format);
    if (!check.ok) return { ok: false, reason: check.reason };
    deductTokens(TOKEN_COST[format]);
    return { ok: true };
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export async function exportDesign(format: ExportFormat, side: Side = "left"): Promise<ExportOutcome> {
    if (format === "gcode") {
        return { ok: false, reason: "Use Generate + Export G-code in the Printing tab" };
    }
    if (format === "glb") {
        return exportGlb(side);
    }
    const filename = `insole-${side}-${Date.now()}.stl`;
    const auth = await authorize("stl", side, filename);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    const { design } = useDesignStore.getState();
    try {
        const stl = await buildExportStl(side, { exportMode: exportModeFromMethod(design.method) });
        const blob = new Blob([stl], { type: "model/stl" });
        downloadBlob(blob, filename);
        useAuditStore.getState().record("export_generated", `STL ${side} (-${TOKEN_COST.stl})`);
        return { ok: true, filename, blob };
    } catch (e) {
        if (e instanceof ExportGeometryNotReadyError) {
            return { ok: false, reason: e.message };
        }
        throw e;
    }
}

export async function exportGlb(side: Side): Promise<ExportOutcome> {
    const { user, license } = useAuthStore.getState();
    const check = canExport(user, license, "glb");
    if (!check.ok) return { ok: false, reason: check.reason };
    const filename = `insole-${side}-${Date.now()}.glb`;
    try {
        const arrayBuffer = await buildExportGlb(side);
        const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
        downloadBlob(blob, filename);
        useAuditStore.getState().record("export_generated", `GLB ${side}`);
        return { ok: true, filename, blob };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "GLB export failed" };
    }
}

export async function exportGcode(
    side: Side,
    preset: PrinterPreset,
    overrides: CamOverrides = {},
): Promise<ExportOutcome> {
    const filename = `insole-${side}-${preset.id}-${Date.now()}.gcode`;
    const auth = await authorize("gcode", side, filename);
    if (!auth.ok) return { ok: false, reason: auth.reason };
    const geometry = await buildSideGeometry(side);
    const { gcode, stats } = generateGcode(geometry, preset, overrides);
    geometry.dispose();
    const blob = new Blob([gcode], { type: "text/plain" });
    downloadBlob(blob, filename);
    useAuditStore
        .getState()
        .record("export_generated", `G-code ${side} · ${preset.name} (-${TOKEN_COST.gcode})`);
    return { ok: true, filename, blob, stats };
}

/**
 * Server-side hybrid manufacturing: upload the finished viewer STL, then slice (belt) or
 * return validated STL (external printers).
 */
export async function generateHybridGcode(
    side: Side,
    preset: PrinterPreset,
    grindingStyle: GrindingStyleInput,
    overrides: CamOverrides = {},
): Promise<ExportOutcome> {
    const activeDesignId = useClientStore.getState().activeDesignId;
    const outputType = preset.beltAngleDeg ? "gcode" : "stl";
    const ext = outputType === "gcode" ? "gcode" : "stl";
    const filename = `hybrid-${side}-${preset.id}-${Date.now()}.${ext}`;

    if (isApiConfigured()) {
        try {
            const stlBuffer = await buildManufacturingStl(side);
            const upload = await trpc.manufacturing.uploadManufacturingStl.mutate({
                side,
                stlBase64: arrayBufferToBase64(stlBuffer),
                fileName: `manufacturing-${side}.stl`,
            });

            const res = await trpc.manufacturing.generateSolid.mutate({
                designId: activeDesignId || undefined,
                side,
                presetId: preset.id,
                stlUrl: upload.stlUrl,
                stlStorageKey: upload.storageKey,
                outputType,
                beltAngleDeg: preset.beltAngleDeg ?? 45,
                layerHeightMm: overrides.layerHeightMm,
                infillDensity: overrides.infillDensity,
                perimeters: overrides.perimeters,
                grindingStyle,
                fileName: filename,
            });

            if (!res?.ok) {
                return { ok: false, reason: "Server manufacturing request failed" };
            }

            let blob: Blob | undefined;
            const downloadUrl = res.downloadUrl ?? res.gcodeDownloadUrl;

            if (downloadUrl) {
                const resp = await fetch(downloadUrl);
                if (!resp.ok) throw new Error(`Download failed with status ${resp.status}`);
                const data = await resp.arrayBuffer();
                const mime = outputType === "gcode" ? "text/plain" : "model/stl";
                blob = new Blob([data], { type: mime });
                downloadBlob(blob, filename);
            } else if (outputType === "gcode" && res.gcode) {
                blob = new Blob([res.gcode], { type: "text/plain" });
                downloadBlob(blob, filename);
            } else if (outputType === "stl" && res.stlBase64) {
                const bytes = Uint8Array.from(atob(res.stlBase64), (c) => c.charCodeAt(0));
                blob = new Blob([bytes], { type: "model/stl" });
                downloadBlob(blob, filename);
            } else {
                return { ok: false, reason: "Server did not return a downloadable output file" };
            }

            useAuditStore
                .getState()
                .record(
                    "export_generated",
                    `Hybrid ${outputType.toUpperCase()} ${side} · ${preset.name} (${grindingStyle.type}) (productionId=${res.productionId || "n/a"})`,
                );

            return { ok: true, filename, blob, productionId: res.productionId ?? undefined };
        } catch (e) {
            return {
                ok: false,
                reason: e instanceof Error ? e.message : "Hybrid manufacturing failed (server)",
            };
        }
    }

    // Offline fallback — client-side G-code only
    if (outputType === "gcode") {
        return exportGcode(side, preset, overrides);
    }
    return exportDesign("stl", side);
}

export async function downloadGcodeByProductionId(productionId: string): Promise<ExportOutcome> {
    if (!isApiConfigured()) {
        return { ok: false, reason: "API not configured; server G-code download requires backend" };
    }
    try {
        const res = await trpc.manufacturing.getGcodeDownloadUrl.query({ productionId });
        if (!res?.downloadUrl) {
            return { ok: false, reason: "No download URL returned for production" };
        }
        const textResp = await fetch(res.downloadUrl);
        if (!textResp.ok) {
            throw new Error(`Failed to fetch G-code (status ${textResp.status})`);
        }
        const gcodeText = await textResp.text();
        const filename = `hybrid-${productionId}.gcode`;
        const blob = new Blob([gcodeText], { type: "text/plain" });
        downloadBlob(blob, filename);
        useAuditStore
            .getState()
            .record("export_generated", `Hybrid G-code re-download via productionId ${productionId}`);
        return { ok: true, filename, blob, productionId };
    } catch (e) {
        return {
            ok: false,
            reason: e instanceof Error ? e.message : "G-code download by productionId failed",
        };
    }
}
