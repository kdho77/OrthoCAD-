import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { buildExportGeometry, buildExportGlb, buildExportStl } from "@/lib/geometry/export-geometry";
import { getDesignBase } from "@/lib/geometry/base-asset";
import { type CamOverrides, type CamResult, generateGcode, type PrinterPreset } from "@/lib/kiri";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { buildExportGeometry, buildExportGlb, buildExportStl } from "@/lib/geometry/export-geometry";
import { getDesignBase } from "@/lib/geometry/base-asset";
import { type CamOverrides, type CamResult, generateGcode, type PrinterPreset } from "@/lib/kiri";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
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
    const stl = await buildExportStl(side);
    const blob = new Blob([stl], { type: "model/stl" });
    downloadBlob(blob, filename);
    useAuditStore.getState().record("export_generated", `STL ${side} (-${TOKEN_COST.stl})`);
    return { ok: true, filename, blob };
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
    useAuditStore.getState().record("export_generated", `G-code ${side} · ${preset.name} (-${TOKEN_COST.gcode})`);
    return { ok: true, filename, blob, stats };
}

/**
 * Server-side hybrid manufacturing G-code (solid + Grinding Style sides + belt transform + slicing).
 * Uses the new manufacturing.generateSolid procedure.
 */
export async function generateHybridGcode(
    side: Side,
    preset: PrinterPreset,
    grindingStyle: GrindingStyleInput,
    overrides: CamOverrides = {},
): Promise<ExportOutcome> {
    const { design } = useDesignStore.getState();
    const activeDesignId = useClientStore.getState().activeDesignId;
    const filename = `hybrid-${side}-${preset.id}-${Date.now()}.gcode`;

    const sideCorrections = design.corrections[side];
    const trimlineForSide = design.trimlines?.[side] ?? [];

    let baseGlbUrl: string | undefined;
    const base = design.base ?? (side === "left" ? design.paired?.leftBase : design.paired?.rightBase);
    const baseAssetId = base?.assetId;

    if (baseAssetId) {
        const lib = useCustomLibraryStore.getState();
        const prefab = lib.customPrefabs.find((p) => p.id === baseAssetId);
        if (prefab?.url) {
            baseGlbUrl = prefab.url;
        }
    }

    const correctionsDict: Record<string, any> = { ...sideCorrections };
    if (sideCorrections.heelCupWidthMm != null) correctionsDict.heelCupWidthMm = sideCorrections.heelCupWidthMm;
    if (sideCorrections.heelLiftMm != null) correctionsDict.heelLiftMm = sideCorrections.heelLiftMm;

    const trimlinesDict: Record<string, any> = {
        points: trimlineForSide.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })),
    };

    if (isApiConfigured()) {
        try {
            const res = await trpc.manufacturing.generateSolid.mutate({
                designId: activeDesignId || undefined,
                side,
                presetId: preset.id,
                beltAngleDeg: preset.beltAngleDeg ?? 45,
                corrections: correctionsDict,
                trimlines: trimlinesDict,
                thicknessMm: design.thicknessMm,
                heelLiftMm: sideCorrections.heelLiftMm ?? 0,
                heelCupWidthMm: sideCorrections.heelCupWidthMm ?? 0,
                grindingStyle,
                baseGlbUrl,
                ...(baseAssetId ? { baseAssetId } : {}),
                fileName: filename,
            });

            if (!res?.ok || (!res.gcode && !res.gcodeDownloadUrl && !res.productionId)) {
                return { ok: false, reason: res?.note || "Server did not return G-code reference" };
            }

            let blob: Blob | undefined;

            if (res.gcodeDownloadUrl) {
                try {
                    const textResp = await fetch(res.gcodeDownloadUrl);
                    if (!textResp.ok) throw new Error(`Download failed with status ${textResp.status}`);
                    const gcodeText = await textResp.text();
                    blob = new Blob([gcodeText], { type: "text/plain" });
                    downloadBlob(blob, filename);
                } catch (dlErr: any) {
                    return {
                        ok: false,
                        reason: `G-code generated (productionId=${res.productionId}) but client download failed: ${dlErr?.message || dlErr}`,
                    };
                }
            } else if (res.gcode) {
                blob = new Blob([res.gcode], { type: "text/plain" });
                downloadBlob(blob, filename);
            }

            useAuditStore.getState().record(
                "export_generated",
                `Hybrid G-code ${side} · ${preset.name} (${grindingStyle.type}) (productionId=${res.productionId || 'n/a'})`,
            );

            return { ok: true, filename, blob, productionId: res.productionId };
        } catch (e) {
            return {
                ok: false,
                reason: e instanceof Error ? e.message : "Hybrid G-code generation failed (server)",
            };
        }
    }

    // Offline fallback
    return exportGcode(side, preset, overrides);
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
        useAuditStore.getState().record("export_generated", `Hybrid G-code re-download via productionId ${productionId}`);
        return { ok: true, filename, blob, productionId };
    } catch (e) {
        return {
            ok: false,
            reason: e instanceof Error ? e.message : "G-code download by productionId failed",
        };
    }
}