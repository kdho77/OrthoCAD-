import { getKernel } from "@/lib/chili3d";
import { buildInsoleGeometry } from "@/lib/geometry/insole";
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
 * Phase 0/1 export flow: validate license + tokens → generate STL → (optimistic)
 * token deduction → download. The authoritative deduction happens server-side
 * via tRPC in later phases; here we gate the client and deduct locally.
 */
export function exportDesign(format: ExportFormat, side: Side = "left"): ExportOutcome {
    const { user, license, deductTokens } = useAuthStore.getState();

    const check = canExport(user, license, format === "stl" ? "stl" : "gcode");
    if (!check.ok) return { ok: false, reason: check.reason };

    if (format === "gcode") {
        return { ok: false, reason: "G-code export is enabled in Phase 3 (Kiri:Moto)" };
    }

    const { design } = useDesignStore.getState();
    const geometry = buildInsoleGeometry({
        side,
        lengthMm: INSOLE_LENGTH_MM,
        widthMm: INSOLE_WIDTH_MM,
        thicknessMm: design.thicknessMm,
        corrections: design.corrections[side],
    });

    const stl = getKernel().exportSTL(geometry);
    const blob = new Blob([stl], { type: "model/stl" });
    const filename = `insole-${side}-${Date.now()}.stl`;

    deductTokens(TOKEN_COST.stl);
    downloadBlob(blob, filename);

    return { ok: true, filename, blob };
}
