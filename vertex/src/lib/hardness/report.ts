// Copyright Vertex Orthopedic. All rights reserved.
// Wording pending counsel review.

import {
    classDensityPct,
    classLineWidthMm,
    classSpeedMmS,
    SPARSE_INFILL_PATTERN,
} from "../../../shared/print-recipe/hardness-class-table";
import type { HardnessRegion } from "../../../shared/print-recipe/hardness-region";
import type { RegionStatus, ResolvedModifier } from "./resolve";

export interface RegionReportRow {
    regionId: string;
    kind: HardnessRegion["kind"];
    hardnessClass: HardnessRegion["hardnessClass"];
    priority: number;
    status: RegionStatus | "missing" | "unmapped";
    volumeMm3: number;
    rawVolumeMm3: number;
    densityPct: number;
    pattern: typeof SPARSE_INFILL_PATTERN;
    speedMmS?: number;
    lineWidthMm: number;
    note?: string;
}

export interface HardnessExportReport {
    ok: boolean;
    errors: string[];
    warnings: string[];
    regions: RegionReportRow[];
    reassignedMm3: number;
    resolveMs: number;
    exportMs: number;
}

export function volumeSettingsFor(region: HardnessRegion): {
    densityPct: number;
    pattern: typeof SPARSE_INFILL_PATTERN;
    speedMmS?: number;
    lineWidthMm: number;
} {
    const densityPct = classDensityPct(region.hardnessClass, region.overrides);
    return {
        densityPct,
        pattern: SPARSE_INFILL_PATTERN,
        speedMmS: classSpeedMmS(region.hardnessClass),
        lineWidthMm: classLineWidthMm(region.hardnessClass),
    };
}

export function buildExportReport(
    requested: HardnessRegion[],
    resolved: ResolvedModifier[],
    timing: { resolveMs: number; exportMs: number },
): HardnessExportReport {
    const byId = new Map(resolved.map((r) => [r.region.regionId, r]));
    const errors: string[] = [];
    const warnings: string[] = [];
    const rows: RegionReportRow[] = [];
    let reassignedMm3 = 0;

    for (const region of requested) {
        let densityPct: number;
        try {
            densityPct = classDensityPct(region.hardnessClass, region.overrides);
        } catch (err) {
            errors.push(
                `unmapped region ${region.regionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
            rows.push({
                regionId: region.regionId,
                kind: region.kind,
                hardnessClass: region.hardnessClass,
                priority: region.priority,
                status: "unmapped",
                volumeMm3: 0,
                rawVolumeMm3: 0,
                densityPct: 0,
                pattern: SPARSE_INFILL_PATTERN,
                lineWidthMm: classLineWidthMm(region.hardnessClass),
                note: err instanceof Error ? err.message : String(err),
            });
            continue;
        }
        const got = byId.get(region.regionId);
        if (!got) {
            errors.push(`missing region ${region.regionId} (${region.kind} ${region.hardnessClass})`);
            rows.push({
                regionId: region.regionId,
                kind: region.kind,
                hardnessClass: region.hardnessClass,
                priority: region.priority,
                status: "missing",
                volumeMm3: 0,
                rawVolumeMm3: 0,
                densityPct,
                pattern: SPARSE_INFILL_PATTERN,
                speedMmS: classSpeedMmS(region.hardnessClass),
                lineWidthMm: classLineWidthMm(region.hardnessClass),
            });
            continue;
        }
        reassignedMm3 += got.reassignedMm3;
        if (got.status === "overridden") {
            warnings.push(`${region.regionId} fully overridden (raw ${got.rawVolumeMm3.toFixed(3)} mm³)`);
        }
        if (got.note) warnings.push(got.note);
        rows.push({
            regionId: region.regionId,
            kind: region.kind,
            hardnessClass: region.hardnessClass,
            priority: region.priority,
            status: got.status,
            volumeMm3: got.volumeMm3,
            rawVolumeMm3: got.rawVolumeMm3,
            densityPct,
            pattern: SPARSE_INFILL_PATTERN,
            speedMmS: classSpeedMmS(region.hardnessClass),
            lineWidthMm: classLineWidthMm(region.hardnessClass),
            note: got.note,
        });
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        regions: rows,
        reassignedMm3,
        resolveMs: timing.resolveMs,
        exportMs: timing.exportMs,
    };
}
