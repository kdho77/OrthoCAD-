// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// The Scan step's import: parse STL/OBJ, weld for component labels, keep the
// top-ranked foot when the file has more than one component, and build the
// same display frame ScanImport stores. Vertices of the kept triangles are
// copied, not welded.

import type { BufferGeometry } from "three";
import { type ImportFormat, importScanFile } from "@/lib/geometry/import";
import {
    extractKeptGeometry,
    rankComponents,
    type ScanComponentLabeling,
    type ScanComponentStats,
    selectedComponentsBBox,
    weldAndLabelComponents,
} from "@/lib/geometry/scan-components";
import type { ScanDisplayInfo } from "@/lib/geometry/scan-display";
import { buildScanDisplayInfo, buildScanDisplayInfoFromBBox } from "@/lib/geometry/scan-display";
import type { Side } from "@/types";

export interface ImportedFootScan {
    side: Side;
    name: string;
    format: ImportFormat;
    triangleCount: number;
    geometry: BufferGeometry;
    rawGeometry: BufferGeometry;
    display: ScanDisplayInfo;
    components: ScanComponentStats[];
    keptComponentIds: number[];
    triangleComponentOf: ScanComponentLabeling["triangleComponentOf"];
    labelingMeta: {
        degenerateTriangleCount: number;
        weldTolerance: number;
        elapsedMs: number;
        originalTriangleCount: number;
    };
    /**
     * Same rule as `addScan` when the caller omits `keepSetApproved`:
     * a single component is approved; a multi-component file is not.
     */
    keepSetApproved: boolean;
}

/** Import one foot file the way the Scan step's file picker does. */
export async function importFootScanFile(file: File, side: Side): Promise<ImportedFootScan> {
    const { geometry: rawGeometry, format } = await importScanFile(file);
    const labeling = weldAndLabelComponents(rawGeometry);
    const ranked = rankComponents(labeling.components);
    // Multi-component: preselect top-ranked foot only. Single: keep all.
    const keptIds =
        ranked.length <= 1 ? ranked.map((component) => component.id) : ranked[0] ? [ranked[0].id] : [];
    const geometry = keptIds.length > 0 ? extractKeptGeometry(rawGeometry, labeling, keptIds) : rawGeometry;
    const prior = buildScanDisplayInfo(rawGeometry);
    const bbox = selectedComponentsBBox(ranked, keptIds);
    const display = bbox
        ? buildScanDisplayInfoFromBBox(bbox.min, bbox.max, {
              inferredUnit: prior.inferredUnit,
              dominantRawAxis: prior.dominantRawAxis,
              rawLongest: prior.rawLongest,
          })
        : prior;
    const index = geometry.getIndex();
    const triangleCount = index ? index.count / 3 : geometry.getAttribute("position").count / 3;
    return {
        side,
        name: file.name,
        format,
        triangleCount,
        geometry,
        rawGeometry,
        display,
        components: ranked,
        keptComponentIds: keptIds,
        triangleComponentOf: labeling.triangleComponentOf,
        labelingMeta: {
            degenerateTriangleCount: labeling.degenerateTriangleCount,
            weldTolerance: labeling.weldTolerance,
            elapsedMs: labeling.elapsedMs,
            originalTriangleCount: labeling.originalTriangleCount,
        },
        keepSetApproved: ranked.length <= 1,
    };
}
