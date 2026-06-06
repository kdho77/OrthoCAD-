import { getKernel } from "@/lib/chili3d";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
import { isApiConfigured, trpc } from "@/lib/trpc";
import { canExport, TOKEN_COST } from "@/features/licensing/license";
import { useAuthStore } from "@/stores/auth-store";
import { useDesignStore } from "@/stores/design-store";
import type { ExportFormat, Side } from "@/types";

export interface ExportOutcome {
    ok: boolean;
    reason?: string;
    filename?: string;
    blob?: Blob;
}

const INSOLE_LENGTH_MM = 260;
const INSOLE_WIDTH_MM = 95;

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
        return { ok: false, reason: "G-code export is enabled in Phase 3 (Kiri:Moto)" };
    }

    const { user, license, deductTokens, setUser } = useAuthStore.getState();
    const { design } = useDesignStore.getState();

    const filename = `insole-${side}-${Date.now()}.stl`;

    if (isApiConfigured()) {
        try {
            const res = await trpc.export.authorize.mutate({ format: "stl", side, fileName: filename });
            if (!res.ok) return { ok: false, reason: "Authorization denied" };
            // Sync authoritative balance from the server.
            if (user) setUser({ ...user, tokenBalance: res.balance });
        } catch (e) {
            const message = e instanceof Error ? e.message : "Export authorization failed";
            return { ok: false, reason: message };
        }
    } else {
        const check = canExport(user, license, "stl");
        if (!check.ok) return { ok: false, reason: check.reason };
        deductTokens(TOKEN_COST.stl);
    }

    const geometry = buildInsoleGeometry({
        side,
        lengthMm: INSOLE_LENGTH_MM,
        widthMm: INSOLE_WIDTH_MM,
        thicknessMm: design.thicknessMm,
        corrections: design.corrections[side],
    });
    const stl = getKernel().exportSTL(geometry);
    const blob = new Blob([stl], { type: "model/stl" });
    downloadBlob(blob, filename);

    return { ok: true, filename, blob };
}
