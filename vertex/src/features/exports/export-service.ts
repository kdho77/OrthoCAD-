import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { getKernel } from "@/lib/chili3d";
import { INSOLE_LENGTH_MM, INSOLE_WIDTH_MM } from "@/lib/geometry/layout";
import { type CamOverrides, type CamResult, generateGcode, type PrinterPreset } from "@/lib/kiri";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { useAuditStore } from "@/stores/audit-store";
import { useAuthStore } from "@/stores/auth-store";
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
    const { design } = useDesignStore.getState();
    return getKernel().buildInsole({
        side,
        lengthMm: INSOLE_LENGTH_MM,
        widthMm: INSOLE_WIDTH_MM,
        thicknessMm: design.thicknessMm,
        corrections: design.corrections[side],
        elements: design.elements.filter((e) => e.side === side),
    });
}

/** Server-authoritative token gate shared by STL and G-code exports. */
async function authorize(
    format: ExportFormat,
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

    const filename = `insole-${side}-${Date.now()}.stl`;
    const auth = await authorize("stl", side, filename);
    if (!auth.ok) return { ok: false, reason: auth.reason };

    const geometry = buildSideGeometry(side);
    const stl = getKernel().exportSTL(geometry);
    const blob = new Blob([stl], { type: "model/stl" });
    downloadBlob(blob, filename);
    useAuditStore.getState().record("export_generated", `STL ${side} (-${TOKEN_COST.stl})`);

    return { ok: true, filename, blob };
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

    const geometry = buildSideGeometry(side);
    const { gcode, stats } = generateGcode(geometry, preset, overrides);
    const blob = new Blob([gcode], { type: "text/plain" });
    downloadBlob(blob, filename);
    useAuditStore
        .getState()
        .record("export_generated", `G-code ${side} · ${preset.name} (-${TOKEN_COST.gcode})`);

    return { ok: true, filename, blob, stats };
}
