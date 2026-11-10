// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { buildValidatedExportGeometry } from "@/lib/geometry/export-geometry";
import { insoleExportSides } from "./export-key";
import { overallPrintSize, triangleMeshFromGeometry } from "./mesh-ops";
import { publishExportMeasureMesh } from "./registry";
import type { MeasureOverall, MeasureSide } from "./types";

export interface ExportMeasureRow {
    side: MeasureSide;
    overall: MeasureOverall;
    source: "export";
}

export type InsoleExportLoader = (includeLeader: boolean) => Promise<ExportMeasureRow[]>;

let loaderOverride: InsoleExportLoader | null = null;

/** Tests inject a loader so the panel does not loft a real solid. */
export function setInsoleExportLoaderForTests(loader: InsoleExportLoader | null): void {
    loaderOverride = loader;
}

export async function loadInsoleExportRows(includeLeader: boolean): Promise<ExportMeasureRow[]> {
    if (loaderOverride) return loaderOverride(includeLeader);
    const sides = insoleExportSides();
    const rows: ExportMeasureRow[] = [];
    for (const side of sides) {
        const geometry = await buildValidatedExportGeometry(side);
        try {
            const mesh = triangleMeshFromGeometry(geometry);
            publishExportMeasureMesh(side, mesh);
            rows.push({
                side,
                overall: overallPrintSize(mesh, "insole", includeLeader),
                source: "export",
            });
        } finally {
            geometry.dispose();
        }
    }
    return rows;
}
