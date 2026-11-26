// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Optional per-design path. The mesh stays SAMPLE_Top. Each stored scan is
// imported with importFootScanFile (the Scan step) and measured with
// generateOrthoticFromScanAndRx (the Generate Orthotic button). Only the
// arch-height slider is copied from that result. Catalog corrections stay.
// An explicit catalog arch replaces the scan class, the same way an explicit
// Rx arch height does. Omitted means this module is not called.

import {
    type GenerateOrthoticResult,
    generateOrthoticFromScanAndRx,
    type RequiredShoeSize,
} from "@/lib/clinical/generateOrthoticFromScanAndRx";
import { importFootScanFile } from "@/lib/geometry/import-foot-scan";
import type { DesignState, Side } from "@/types";
import type { SavedDesignCatalog } from "../../../shared/saved-design-catalog.js";
import { SavedDesignSnapshotError } from "../../../shared/saved-design-catalog.js";
import type { SavedDesignSnapshotBuild } from "../../../shared/saved-design-snapshot.js";
import { type OrderScanFile, selectLatestScanPerSide } from "./order-scan-file";

const TEMPLATE_REFUSAL = "Refusing to substitute the template.";

export async function designFromImportedScanFiles(args: {
    baselineDesign: DesignState;
    files: { side: Side; file: File }[];
    shoeSize: RequiredShoeSize;
    flexibleBySide?: Partial<Record<Side, boolean>>;
    prescriptionText?: string;
}): Promise<GenerateOrthoticResult> {
    const scans = [];
    for (const entry of args.files) {
        const imported = await importFootScanFile(entry.file, entry.side);
        scans.push({
            side: imported.side,
            geometry: imported.geometry,
            display: imported.display,
            keepSetApproved: imported.keepSetApproved,
        });
    }
    return generateOrthoticFromScanAndRx({
        baselineDesign: args.baselineDesign,
        scans,
        shoeSize: args.shoeSize,
        flexibleBySide: args.flexibleBySide,
        prescriptionText: args.prescriptionText,
    });
}

function fileFromBytes(fileName: string, bytes: Uint8Array): File {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return new File([copy], fileName);
}

/**
 * Write scan arch height onto an already-built SAMPLE_Top snapshot.
 * Does not replace the base mesh, elements, sinks, or other correction sliders.
 */
export async function applyOrderScansToSavedDesign(args: {
    built: SavedDesignSnapshotBuild;
    catalog: SavedDesignCatalog;
    files: readonly OrderScanFile[];
}): Promise<string[]> {
    const selected = selectLatestScanPerSide(args.files);
    if (selected.length === 0) {
        throw new SavedDesignSnapshotError(`This order has no foot scans. ${TEMPLATE_REFUSAL}`);
    }
    const provenance = args.built.design.dogfoodManufacturing;
    if (!provenance || provenance.template !== "SAMPLE_Top") {
        throw new SavedDesignSnapshotError(`SAMPLE_Top provenance is missing. ${TEMPLATE_REFUSAL}`);
    }
    const usMenSize = args.built.design.usMenSize;
    if (typeof usMenSize !== "number" || !Number.isFinite(usMenSize)) {
        throw new SavedDesignSnapshotError(
            `Shoe size is required. It is not taken from the scan. ${TEMPLATE_REFUSAL}`,
        );
    }

    const flexible = args.catalog.flexible_foot === true;
    let outcome: GenerateOrthoticResult;
    try {
        outcome = await designFromImportedScanFiles({
            baselineDesign: args.built.design,
            files: selected.map((scan) => ({
                side: scan.side,
                file: fileFromBytes(scan.fileName, scan.bytes),
            })),
            shoeSize: { system: "us", value: usMenSize },
            flexibleBySide: { left: flexible, right: flexible },
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SavedDesignSnapshotError(`${message} ${TEMPLATE_REFUSAL}`);
    }
    if (!outcome.ok) {
        throw new SavedDesignSnapshotError(`${outcome.reason} ${TEMPLATE_REFUSAL}`);
    }

    const review: string[] = [...outcome.reviewItems];
    const catalogArch = args.catalog.arch !== undefined;
    for (const foot of outcome.perFoot) {
        if (catalogArch) {
            review.push(`${foot.side}: catalog arch overrides the ${foot.archBand} scan class`);
            continue;
        }
        args.built.design.corrections[foot.side].archHeightMm =
            outcome.design.corrections[foot.side].archHeightMm;
        const path = `settings.corrections.${foot.side}.archHeightMm`;
        if (!args.built.paths.includes(path)) args.built.paths.push(path);
    }

    args.built.design.corrections.linked = false;
    if (!args.built.paths.includes("settings.corrections.linked")) {
        args.built.paths.push("settings.corrections.linked");
    }
    args.built.design.dogfoodManufacturing = { ...provenance, scansUsed: true };
    if (!args.built.paths.includes("settings.dogfoodManufacturing.scansUsed")) {
        args.built.paths.push("settings.dogfoodManufacturing.scansUsed");
    }
    return review;
}
