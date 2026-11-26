// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Headless caller for the UI Export loft. The mesh is internal. G-code is the deliverable.

import type { BufferGeometry } from "three";
import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { buildVertexSliceModel } from "@/features/exports/vertexslice-regional-model";
import { getDesignBase } from "@/lib/geometry/base-asset";
import {
    type ElementAssetReader,
    injectElementAssetSource,
} from "@/lib/geometry/element-assets/element-asset";
import { manufacturingFingerprintForActiveExport } from "@/lib/geometry/export-geometry";
import { binaryStlTriangleCount } from "@/lib/geometry/leader-block";
import { assertProductionFootStl } from "@/lib/geometry/procedural-wall/manufacturing-foot-guard";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import { SAMPLE_TOP_ASSET_ID } from "@/lib/geometry/procedural-wall/sample-top-id";
import {
    loadSampleTopGeometry,
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { primeTextFont } from "@/lib/geometry/text-marking/font";
import { mirrorGeometry } from "@/lib/library/loaders";
import { useBaseOutlineStore } from "@/stores/base-outline-store";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore, widthAdjustedMeshOutline } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import type { DesignState, Side } from "@/types";
import { readStoredDesignSettings } from "../../../shared/design-settings";
import { SHELL_THICKNESS_MM_DEFAULT } from "../../../shared/saved-design-catalog";

export interface FinalizedFootMesh {
    side: Side;
    /** Internal manufacturing bytes (solid + one leader). Not a client deliverable. */
    stl: ArrayBuffer;
    solidTriangles: number;
    uploadTriangles: number;
    fingerprint: string;
}

export class SavedDesignMeshError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SavedDesignMeshError";
    }
}

function assertSolidManufacturingShellThickness(settings: DesignState): void {
    const method = settings.method;
    if (method !== "printing_solid" && method !== "milling_3axis") return;
    if (settings.shellThicknessMode !== "uniform") return;
    if (Math.abs(settings.thicknessMm - SHELL_THICKNESS_MM_DEFAULT) <= 1e-9) return;
    throw new SavedDesignMeshError(
        "This design was saved with a non-default shell thickness in uniform mode and would print too thin. Re-save the design (create_saved_design / saved-design-snapshot) or open it in the UI and save again so shell thickness stays in zonal mode.",
    );
}

export function designStateFromSavedSettings(settingsJson: unknown): DesignState {
    const settings = readStoredDesignSettings(settingsJson);
    if (!settings) {
        throw new SavedDesignMeshError("Design has no saved parameter snapshot");
    }
    const design = createDesignWithStockPlaceholder(settings as DesignState);
    assertSolidManufacturingShellThickness(design);
    return design;
}

/**
 * Publish the same SAMPLE_Top silhouette the Top view uses for #364 presets.
 * Right is the mirrored base. Full does not need this curve.
 */
export function publishProceduralSampleTopOutlines(native: BufferGeometry, design: DesignState): void {
    for (const side of ["left", "right"] as const) {
        const base = getDesignBase(design, side);
        if (!base) continue;
        const mirrored = Boolean(base.mirrored);
        const geometry = mirrored ? mirrorGeometry(native) : native.clone();
        try {
            const outline = widthAdjustedMeshOutline(geometry, design, side);
            if (!outline) continue;
            const tag = mirrored ? "m" : "p";
            useBaseOutlineStore.getState().setOutline(`${SAMPLE_TOP_ASSET_ID}:${side}:${tag}`, outline);
        } finally {
            geometry.dispose();
        }
    }
}

function installSavedDesign(design: DesignState, printLoftEpoch: number): void {
    resetManufacturingSolidCache();
    useBottomPatternStore.getState().clear();
    useMeshEditStore.setState({ trimlineEdit: null, bottomPatternEdit: null });
    usePreviewLoftStatusStore.setState({ printLoftEpoch });
    const viewer = useDesignStore.getState().viewer;
    useDesignStore.setState({ design, viewer: { ...viewer, wallModel: "procedural" } });
}

/**
 * One foot, same functions as Export: buildExportStl, watertight close, leader once.
 * SAMPLE_Top bytes must be the bundled template. This does not invent a substitute solid.
 */
export async function buildFinalizedFootFromSavedDesign(input: {
    design: DesignState;
    side: Side;
    sampleTopBytes: ArrayBuffer;
    includeLeader?: boolean;
    printLoftEpoch?: number;
    /** Bundled Inter Bold. When set, the loft does not fetch or search cwd. */
    fontBytes?: ArrayBuffer;
    /** Absolute public/elements directory. When set, element reads ignore cwd. */
    elementsBaseDir?: string;
    elementAssetReader?: ElementAssetReader;
}): Promise<FinalizedFootMesh> {
    const includeLeader = input.includeLeader !== false;
    resetSampleTopGeometryCache();
    const native = await sampleTopFromArrayBuffer(input.sampleTopBytes);
    primeSampleTopGeometry(native);
    installSavedDesign(input.design, input.printLoftEpoch ?? 0);
    publishProceduralSampleTopOutlines(native, input.design);
    const fingerprint = manufacturingFingerprintForActiveExport(input.side, true);
    if (input.fontBytes) primeTextFont(input.fontBytes);
    if (input.elementsBaseDir != null || input.elementAssetReader) {
        injectElementAssetSource({
            elementsBaseDir: input.elementsBaseDir ?? null,
            reader: input.elementAssetReader ?? null,
        });
    }
    const built = await buildPrinterFootManufacturingStl(input.side, includeLeader);
    if (binaryStlTriangleCount(built.stl) !== built.uploadTriangles) {
        throw new SavedDesignMeshError(`Finalized ${input.side} mesh triangle count does not match the STL`);
    }
    if (includeLeader && built.uploadTriangles <= built.solidTriangles) {
        throw new SavedDesignMeshError(`Leader was not applied once on the ${input.side} foot`);
    }
    const reference = await loadSampleTopGeometry();
    try {
        await assertProductionFootStl({
            stl: built.stl,
            design: input.design,
            side: input.side,
            native: reference,
        });
    } finally {
        reference.dispose();
    }
    return {
        side: input.side,
        stl: built.stl,
        solidTriangles: built.solidTriangles,
        uploadTriangles: built.uploadTriangles,
        fingerprint,
    };
}

export async function buildFinalizedFootFromSavedSettings(input: {
    settingsJson: unknown;
    side: Side;
    sampleTopBytes: ArrayBuffer;
    includeLeader?: boolean;
    fontBytes?: ArrayBuffer;
    elementsBaseDir?: string;
    elementAssetReader?: ElementAssetReader;
}): Promise<FinalizedFootMesh> {
    const settings = readStoredDesignSettings(input.settingsJson);
    if (settings?.method === "milling_3axis") {
        throw new SavedDesignMeshError("Milled orders are not belt G-code");
    }
    return buildFinalizedFootFromSavedDesign({
        design: designStateFromSavedSettings(input.settingsJson),
        side: input.side,
        sampleTopBytes: input.sampleTopBytes,
        includeLeader: input.includeLeader,
        fontBytes: input.fontBytes,
        elementsBaseDir: input.elementsBaseDir,
        elementAssetReader: input.elementAssetReader,
    });
}

/**
 * Modifier 3MF for one saved foot. The shell is the leader-blocked STL from
 * {@link buildFinalizedFootFromSavedSettings}. Null when that foot has no regions.
 * Does not install the design store; prisms come from the saved parameters.
 */
export async function buildRegional3mfFromSavedSettings(input: {
    settingsJson: unknown;
    side: Side;
    manufacturingStl: ArrayBuffer;
}): Promise<{ bytes: Uint8Array; regionCount: number } | null> {
    const settings = readStoredDesignSettings(input.settingsJson);
    if (settings?.method === "milling_3axis") {
        throw new SavedDesignMeshError("Milled orders are not belt G-code");
    }
    const model = await buildVertexSliceModel({
        design: designStateFromSavedSettings(input.settingsJson),
        side: input.side,
        manufacturingStl: input.manufacturingStl,
        stlFilename: `${input.side}.stl`,
        regional3mfEnabled: true,
    });
    if (model.contentType !== "model/3mf") return null;
    return { bytes: model.bytes, regionCount: model.regionCount };
}

/** Both feet or neither. A failed second foot does not return the first. */
export async function buildFinalizedBeltPairFromSavedSettings(input: {
    settingsJson: unknown;
    sampleTopBytes: ArrayBuffer;
    fontBytes?: ArrayBuffer;
    elementsBaseDir?: string;
    elementAssetReader?: ElementAssetReader;
}): Promise<{ left: FinalizedFootMesh; right: FinalizedFootMesh }> {
    const left = await buildFinalizedFootFromSavedSettings({ ...input, side: "left" });
    try {
        const right = await buildFinalizedFootFromSavedSettings({ ...input, side: "right" });
        return { left, right };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new SavedDesignMeshError(
            `Belt pair failed on the right foot. No partial pair is returned. ${message}`,
        );
    }
}
