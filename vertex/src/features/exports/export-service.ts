import type { ApexPrintMaterialId } from "@/features/exports/apex-print-material";
import { downloadBlob, downloadSequential } from "@/features/exports/export-download";
import { buildExportFilename } from "@/features/exports/export-filename";
import { export3mfPairSeparate, exportStlPairSeparate } from "@/features/exports/export-pair";
import type { ExportOutputTarget } from "@/features/exports/export-target";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { workpiecesFromDesign } from "@/lib/cnc/compose";
import { generateCncJob } from "@/lib/cnc/export";
import type { MillingProfile } from "@/lib/cnc/types";
import {
    buildExportGeometry,
    buildExportGlb,
    buildExportStl,
    exportModeFromMethod,
} from "@/lib/geometry/export-geometry";
import { collectHardnessRegions } from "@/lib/hardness/collect";
import { parseBinaryStl } from "@/lib/hardness/mesh";
import { exportHardness3mf, STL_SHELL_ONLY_WARNING } from "@/lib/hardness/pipeline";
import type { HardnessExportReport } from "@/lib/hardness/report";
import { type CamOverrides, type CamResult, generateGcode, type PrinterPreset } from "@/lib/kiri";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { mapClientRpcError } from "@/lib/trpc-errors";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import { useMillingProfileStore } from "@/stores/milling-profile-store";
import type { ExportFormat, GrindingStyle, Side } from "@/types";
import { bindPrintRecipeProfile } from "../../../shared/print-recipe/print-recipe";

// Re-export for convenience in UI components
export type GrindingStyleInput = GrindingStyle;

export interface ExportedFilePart {
    side: Side;
    filename: string;
    blob: Blob;
    sizeBytes: number;
    stats?: CamResult["stats"];
    productionId?: string;
}

export interface ExportOutcome {
    ok: boolean;
    reason?: string;
    filename?: string;
    blob?: Blob;
    /** Pair exports: separate Left and Right files (no zip). */
    files?: ExportedFilePart[];
    stats?: CamResult["stats"];
    productionId?: string;
    warning?: string;
    report?: HardnessExportReport;
}

function buildSideGeometry(side: Side) {
    return buildExportGeometry(side);
}

function applyServerBalance(balance: number | undefined): void {
    if (typeof balance !== "number") return;
    const { user, setUser } = useAuthStore.getState();
    if (user) setUser({ ...user, tokenBalance: balance });
}

async function uploadManufacturingStlDirect(side: Side, stlBuffer: ArrayBuffer): Promise<string> {
    const prep = await trpc.manufacturing.prepareManufacturingStlUpload.mutate({
        side,
        fileName: `manufacturing-${side}.stl`,
    });
    const putHeaders: Record<string, string> = { "Content-Type": "model/stl" };
    if (prep.token) putHeaders.Authorization = `Bearer ${prep.token}`;
    const putRes = await fetch(prep.uploadUrl, {
        method: "PUT",
        headers: putHeaders,
        body: stlBuffer,
    });
    if (!putRes.ok) {
        const detail = await putRes.text().catch(() => "");
        throw new Error(
            `Manufacturing STL upload failed (${putRes.status})${detail ? `: ${detail.slice(0, 120)}` : ""}`,
        );
    }
    return prep.storageKey;
}

/** Export the finalized viewer solid as binary STL (mesh-close primary export path). */
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
            const raw = e instanceof Error ? e.message : "Export authorization failed";
            return { ok: false, reason: mapClientRpcError(raw, "Export authorization failed") };
        }
    }
    const check = canExport(user, license, format);
    if (!check.ok) return { ok: false, reason: check.reason };
    deductTokens(TOKEN_COST[format]);
    return { ok: true };
}

export interface ExportRunOptions {
    download?: boolean;
    /** Pair second side — skip duplicate token charge (offline client path). */
    skipAuthorize?: boolean;
    apexMaterialId?: ApexPrintMaterialId;
}

export async function exportDesign(
    format: ExportFormat,
    target: ExportOutputTarget = "left",
    options: ExportRunOptions = {},
): Promise<ExportOutcome> {
    const download = options.download ?? true;
    if (format === "gcode") {
        return { ok: false, reason: "Use Generate G-code in the Print step" };
    }
    if (format === "glb") {
        const side = target === "pair" ? "left" : target;
        return exportGlb(side, download);
    }
    if (format === "3mf") {
        if (target === "pair") return export3mfPairForTarget(download);
        return export3mf(target, download);
    }
    if (target === "pair") return exportStlPairForTarget(download);
    return exportStlSingle(target, download);
}

async function exportStlSingle(side: Side, download: boolean): Promise<ExportOutcome> {
    const filename = buildExportFilename("stl", side);
    try {
        const { design } = useDesignStore.getState();
        const stl = await buildExportStl(side, { exportMode: exportModeFromMethod(design.method) });
        if (!stl?.byteLength) {
            return { ok: false, reason: "Export failed" };
        }
        const blob = new Blob([stl], { type: "model/stl" });
        if (download) downloadBlob(blob, filename);
        const auth = await authorize("stl", side, filename);
        if (!auth.ok) return { ok: false, reason: auth.reason };
        useAuditStore.getState().record("export_generated", `STL ${side} (-${TOKEN_COST.stl})`);
        const warning = collectHardnessRegions(design, side).length > 0 ? STL_SHELL_ONLY_WARNING : undefined;
        return { ok: true, filename, blob, warning };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "Export failed" };
    }
}

async function exportStlPairForTarget(download: boolean): Promise<ExportOutcome> {
    const check = canExport(useAuthStore.getState().user, useAuthStore.getState().license, "stl");
    if (!check.ok) return { ok: false, reason: check.reason };
    const res = await exportStlPairSeparate(download);
    if (!res.ok) return res;
    const auth = await authorize("stl", "left", res.filename ?? "pair.zip");
    if (!auth.ok) return { ok: false, reason: auth.reason };
    useAuditStore.getState().record("export_generated", `STL pair (-${TOKEN_COST.stl})`);
    return res;
}

async function export3mfPairForTarget(download: boolean): Promise<ExportOutcome> {
    const { user, license } = useAuthStore.getState();
    const check = canExport(user, license, "3mf");
    if (!check.ok) return { ok: false, reason: check.reason };
    const res = await export3mfPairSeparate(download);
    if (!res.ok) return res;
    useAuthStore.getState().deductTokens(TOKEN_COST["3mf"]);
    useAuditStore.getState().record("export_generated", `3MF pair (-${TOKEN_COST["3mf"]})`);
    return res;
}

export async function export3mf(side: Side, download = true): Promise<ExportOutcome> {
    const { user, license, deductTokens } = useAuthStore.getState();
    const check = canExport(user, license, "3mf");
    if (!check.ok) return { ok: false, reason: check.reason };
    const filename = buildExportFilename("3mf", side);
    try {
        const { design } = useDesignStore.getState();
        const stl = await buildExportStl(side, { exportMode: exportModeFromMethod(design.method) });
        if (!stl?.byteLength) return { ok: false, reason: "Export failed" };
        const shell = parseBinaryStl(stl);
        const packed = await exportHardness3mf({ design, side, shell });
        const blob = new Blob([packed.bytes], { type: "model/3mf" });
        if (download) downloadBlob(blob, filename);
        deductTokens(TOKEN_COST["3mf"]);
        useAuditStore.getState().record("export_generated", `3MF ${side} (-${TOKEN_COST["3mf"]})`);
        return { ok: true, filename, blob, report: packed.report };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "3MF export failed" };
    }
}

export async function exportGlb(side: Side, download = true): Promise<ExportOutcome> {
    const { user, license } = useAuthStore.getState();
    const check = canExport(user, license, "glb");
    if (!check.ok) return { ok: false, reason: check.reason };
    const filename = buildExportFilename("glb", side);
    try {
        const arrayBuffer = await buildExportGlb(side);
        const blob = new Blob([arrayBuffer], { type: "model/gltf-binary" });
        if (download) downloadBlob(blob, filename);
        useAuditStore.getState().record("export_generated", `GLB ${side}`);
        return { ok: true, filename, blob };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "GLB export failed" };
    }
}

export async function exportCncGcode(sides: Side[], profile: MillingProfile): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const before = JSON.stringify(design);
    const filename = `insole-cnc-${sides.join("-")}-${Date.now()}${profile.fileExtension || ".gcode"}`;
    try {
        const parts = await workpiecesFromDesign(design, sides, profile);
        if (parts.length === 0) {
            return { ok: false, reason: "No insole geometry to mill" };
        }
        const placements = useMillingProfileStore.getState().placements;
        const job = generateCncJob(profile, parts, { placements });
        const after = JSON.stringify(useDesignStore.getState().design);
        if (after !== before) {
            return { ok: false, reason: "CNC export mutated design state" };
        }
        const blob = new Blob([job.gcode], { type: "text/plain" });
        downloadBlob(blob, filename);
        const auth = await authorize("gcode", sides[0] ?? "left", filename);
        if (!auth.ok) return { ok: false, reason: auth.reason };
        useAuditStore
            .getState()
            .record("export_generated", `CNC G-code ${sides.join("+")} · ${profile.name}`);
        return {
            ok: true,
            filename,
            blob,
            stats: {
                lines: job.gcode.split("\n").length,
                extrudeDistanceMm: 0,
                travelDistanceMm: job.stats.travelDistanceMm,
                estimatedTimeSec: job.stats.estimatedTimeSec,
                estimatedMaterialMm3: 0,
            },
        };
    } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "CNC export failed" };
    }
}

export async function exportGcode(
    side: Side,
    preset: PrinterPreset,
    overrides: CamOverrides = {},
    options: ExportRunOptions = {},
): Promise<ExportOutcome> {
    const download = options.download ?? true;
    const filename = buildExportFilename("gcode", side, { apexMaterialId: options.apexMaterialId });
    if (!options.skipAuthorize) {
        const auth = await authorize("gcode", side, filename);
        if (!auth.ok) return { ok: false, reason: auth.reason };
    }
    const geometry = await buildSideGeometry(side);
    const { gcode, stats } = generateGcode(geometry, preset, overrides);
    geometry.dispose();
    const blob = new Blob([gcode], { type: "text/plain" });
    if (download) downloadBlob(blob, filename);
    if (!options.skipAuthorize) {
        useAuditStore
            .getState()
            .record("export_generated", `G-code ${side} · ${preset.name} (-${TOKEN_COST.gcode})`);
    }
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
    options: ExportRunOptions = {},
): Promise<ExportOutcome> {
    const download = options.download ?? true;
    const activeDesignId = useClientStore.getState().activeDesignId;
    const outputType = preset.beltAngleDeg ? "gcode" : "stl";
    const ext = outputType === "gcode" ? "gcode" : "stl";
    const filename = buildExportFilename(ext, side, { apexMaterialId: options.apexMaterialId });

    if (isApiConfigured()) {
        try {
            const stlBuffer = await buildManufacturingStl(side);
            const stlStorageKey = await uploadManufacturingStlDirect(side, stlBuffer);

            const design = useDesignStore.getState().design;
            const printRecipe = bindPrintRecipeProfile(design.printRecipe, preset.id);

            const res = await trpc.manufacturing.generateSolid.mutate({
                designId: activeDesignId || undefined,
                side,
                presetId: preset.id,
                stlStorageKey,
                outputType,
                beltAngleDeg: preset.beltAngleDeg ?? 45,
                layerHeightMm: overrides.layerHeightMm,
                printRecipe,
                perimeters: overrides.perimeters,
                grindingStyle,
                fileName: filename,
            });

            if (!res?.ok) {
                return { ok: false, reason: "Server manufacturing request failed" };
            }
            applyServerBalance(res.balance);

            let blob: Blob | undefined;
            const downloadUrl = res.downloadUrl ?? res.gcodeDownloadUrl;

            if (downloadUrl) {
                const resp = await fetch(downloadUrl);
                if (!resp.ok) throw new Error(`Download failed with status ${resp.status}`);
                const data = await resp.arrayBuffer();
                const mime = outputType === "gcode" ? "text/plain" : "model/stl";
                blob = new Blob([data], { type: mime });
                if (download) downloadBlob(blob, filename);
            } else if (outputType === "gcode" && res.gcode) {
                blob = new Blob([res.gcode], { type: "text/plain" });
                if (download) downloadBlob(blob, filename);
            } else if (outputType === "stl" && res.stlBase64) {
                const bytes = Uint8Array.from(atob(res.stlBase64), (c) => c.charCodeAt(0));
                blob = new Blob([bytes], { type: "model/stl" });
                if (download) downloadBlob(blob, filename);
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
            const raw = e instanceof Error ? e.message : "Hybrid manufacturing failed (server)";
            return {
                ok: false,
                reason: mapClientRpcError(raw, "Hybrid manufacturing failed (server)"),
            };
        }
    }

    // Offline fallback — client-side G-code only
    if (outputType === "gcode") {
        return exportGcode(side, preset, overrides, options);
    }
    return exportDesign("stl", side, options);
}

export async function exportPrintGcode(
    target: ExportOutputTarget,
    preset: PrinterPreset,
    grindingStyle: GrindingStyleInput,
    overrides: CamOverrides = {},
    options: ExportRunOptions = {},
): Promise<ExportOutcome> {
    const download = options.download ?? true;
    if (target === "pair") {
        const left = await generateHybridGcode("left", preset, grindingStyle, overrides, {
            download: false,
            apexMaterialId: options.apexMaterialId,
        });
        if (!left.ok || !left.blob) return left;
        const right = await generateHybridGcode("right", preset, grindingStyle, overrides, {
            download: false,
            skipAuthorize: true,
            apexMaterialId: options.apexMaterialId,
        });
        if (!right.ok || !right.blob) return right;
        const leftName = left.filename ?? buildExportFilename("gcode", "left");
        const rightName = right.filename ?? buildExportFilename("gcode", "right");
        const files: ExportedFilePart[] = [
            {
                side: "left",
                filename: leftName,
                blob: left.blob,
                sizeBytes: left.blob.size,
                stats: left.stats,
                productionId: left.productionId,
            },
            {
                side: "right",
                filename: rightName,
                blob: right.blob,
                sizeBytes: right.blob.size,
                stats: right.stats,
                productionId: right.productionId,
            },
        ];
        if (download) await downloadSequential(files);
        useAuditStore
            .getState()
            .record("export_generated", `G-code pair L+R · ${preset.name} (-${TOKEN_COST.gcode})`);
        return {
            ok: true,
            files,
            filename: leftName,
            blob: left.blob,
            stats: left.stats,
        };
    }
    const side = target;
    return generateHybridGcode(side, preset, grindingStyle, overrides, { download });
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
