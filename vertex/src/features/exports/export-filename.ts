// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ApexPrintMaterialId } from "@/features/exports/apex-print-material";
import type { ExportOutputTarget } from "@/features/exports/export-target";
import { useClientStore } from "@/stores/client-store";
import { useDesignStore } from "@/stores/design-store";
import type { ExportFormat } from "@/types";

function yyyymmdd(d = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

export function targetSuffix(target: ExportOutputTarget): "L" | "R" | "LR" {
    if (target === "left") return "L";
    if (target === "right") return "R";
    return "LR";
}

export function buildExportFilename(
    ext: string,
    target: ExportOutputTarget,
    options?: { apexMaterialId?: ApexPrintMaterialId },
): string {
    const { activeDesignId, designs, activeClientId, clients } = useClientStore.getState();
    const design = useDesignStore.getState().design;
    const record = activeDesignId ? designs.find((d) => d.id === activeDesignId) : null;
    const clientRecord = activeClientId ? clients.find((c) => c.id === activeClientId) : null;
    const clientPart = clientRecord?.reference?.trim() || "design";
    const namePart = (record?.name ?? design.name ?? "insole")
        .trim()
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 48);
    const suffix = targetSuffix(target);
    const materialPart = options?.apexMaterialId ? `-${options.apexMaterialId}` : "";
    const base = `${clientPart}-${namePart}${materialPart}-${suffix}-${yyyymmdd()}`;
    return ext.startsWith(".") ? `${base}${ext}` : `${base}.${ext}`;
}

export function extensionForFormat(format: ExportFormat): string {
    if (format === "3mf") return "3mf";
    if (format === "glb") return "glb";
    if (format === "gcode") return "gcode";
    return "stl";
}
