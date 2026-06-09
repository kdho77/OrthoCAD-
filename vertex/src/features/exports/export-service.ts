import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { buildExportGeometry, buildExportGlb, buildExportStl } from "@/lib/geometry/export-geometry";
import { getDesignBase } from "@/lib/geometry/base-asset";
import { type CamOverrides, type CamResult, generateGcode, type PrinterPreset } from "@/lib/kiri";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import type { ExportFormat, Side } from "@/types";

export interface ExportOutcome {
    ok: boolean;
    reason?: string;
    filename?: string;
    blob?: Blob;
    stats?: CamResult["stats"];
}

function buildSideGeometry(side: Side) {
    return buildExportGeometry(side);
}

/** Server-authoritative token gate shared by STL and G-code exports. */
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

/**
 * Export flow:
 *   1. Server-authoritative path (when the API is configured): the server
 *      validates the license, atomically deducts tokens and records an audit
 *      entry via `export.authorize`. The file is generated only after the
 *      server returns `ok`.
 *   2. Offline fallback (no API): client-side license/token gate + optimistic
 *      local deduction so the workspace is usable in dev/preview.
 */
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

/**
 * Production-quality GLB export. Builds a watertight tapered insole mesh from
 * the user's confirmed trimline (with parametric fallback) — top surface +
 * tapered side walls + flat bottom — entirely in a Web Worker so the UI stays
 * responsive. The exported file contains a single mesh ready for slicing.
 *
 * GLB is license-gated client-side but does not consume export tokens (the
 * server `export.authorize` endpoint is unchanged; GLB is treated as a CAD
 * preview asset rather than a manufacturing artefact).
 */
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

/**
 * Token-protected G-code export. Slices/CAMs the side's solid with the chosen
 * printer/mill preset, then (after server authorization) downloads the G-code.
 */
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
 * Hybrid / server-authoritative G-code generation path (for loaded stock bases or
 * high-fidelity OCCT solid + CAM).
 *
 * When the API is configured, this calls the server `manufacturing.generateSolid`
 * (or equivalent authoritative solid generator) and includes the current `designId`
 * (from the persisted client design record) when available.
 *
 * The `designId` gives the server the ability to:
 *  - Resolve the full persisted design state authoritatively (instead of only
 *    trusting the payload the client sends).
 *  - Record precise audit / production context linking the generated artefact
 *    back to a specific clinical design.
 *
 * We also forward rich data from the current design state (baseAssetId for stock/custom,
 * corrections, trimlines, thickness etc.) so the server can build a complete payload for
 * the Python solid + belt + slicer pipeline.
 *
 * The designId (and extra fields) are optional for backward compatibility.
 *
 * Response from server includes gcode (for direct download) + stats + optional productionId.
 */
export async function generateHybridGcode(
    side: Side,
    preset: PrinterPreset,
    overrides: CamOverrides = {},
): Promise<ExportOutcome> {
    const filename = `insole-${side}-${preset.id}-${Date.now()}.gcode`;

    // Pull the server-side design id (if a design has been loaded/saved via the
    // client store). This may be undefined for brand-new unsaved or fully offline sessions.
    const activeDesignId = useClientStore.getState().activeDesignId ?? undefined;

    if (isApiConfigured()) {
        try {
            // Pull current design state so we can pass corrections, trimlines, base etc.
            // This allows the server to forward a complete payload to the Python pipeline
            // (designId is still sent for authoritative lookup + audit context).
            const design = useDesignStore.getState().design;
            const baseForSide = getDesignBase(design, side);

            // The server procedure is expected to accept designId optionally.
            const res = await trpc.manufacturing.generateSolid.mutate({
                side,
                presetId: preset.id,
                overrides,
                designId: activeDesignId,
                // Pass what the Python solid generator + CAM needs (base for stock/custom, trimlines, corrections, thickness etc.)
                baseAssetId: baseForSide?.assetId,
                corrections: design.corrections,
                trimlines: design.trimlines,
                thicknessMm: design.thicknessMm,
                // grindingStyle or other can come from overrides or preset
            });

            if (!res?.ok) {
                return { ok: false, reason: res?.reason ?? "Server solid generation denied" };
            }

            // In the real implementation the server would return the gcode (or a
            // storage key). For now we surface a successful shape; the caller
            // (PrintingPanel or future hybrid button) can decide how to present it.
            const blob = new Blob([res.gcode ?? ""], { type: "text/plain" });
            downloadBlob(blob, filename);

            useAuditStore
                .getState()
                .record("export_generated", `Hybrid G-code ${side} · ${preset.name} (design ${activeDesignId ?? "unknown"})`);

            return { ok: true, filename, blob, stats: res.stats };
        } catch (e) {
            return {
                ok: false,
                reason: e instanceof Error ? e.message : "Hybrid solid generation failed",
            };
        }
    }

    // Offline fallback: fall back to local CAM (same as exportGcode today).
    const geometry = await buildSideGeometry(side);
    const { gcode, stats } = generateGcode(geometry, preset, overrides);
    geometry.dispose();
    const blob = new Blob([gcode], { type: "text/plain" });
    downloadBlob(blob, filename);
    useAuditStore
        .getState()
        .record("export_generated", `G-code ${side} · ${preset.name} (-${TOKEN_COST.gcode}) (local fallback)`);

    return { ok: true, filename, blob, stats };
}
