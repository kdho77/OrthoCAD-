// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Headless caller for the UI Export loft. The mesh is internal. G-code is the deliverable.

import { buildPrinterFootManufacturingStl } from "@/features/exports/export-service";
import { manufacturingFingerprintForActiveExport } from "@/lib/geometry/export-geometry";
import { binaryStlTriangleCount } from "@/lib/geometry/leader-block";
import { resetManufacturingSolidCache } from "@/lib/geometry/procedural-wall/manufacturing-solid-cache";
import {
    primeSampleTopGeometry,
    resetSampleTopGeometryCache,
    sampleTopFromArrayBuffer,
} from "@/lib/geometry/procedural-wall/sample-top-preview";
import { useBottomPatternStore } from "@/stores/bottom-pattern-store";
import { createDesignWithStockPlaceholder, useDesignStore } from "@/stores/design-store";
import { useMeshEditStore } from "@/stores/mesh-edit-store";
import { usePreviewLoftStatusStore } from "@/stores/preview-loft-status-store";
import type { DesignState, Side } from "@/types";
import { readStoredDesignSettings } from "../../../shared/design-settings";

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

export function designStateFromSavedSettings(settingsJson: unknown): DesignState {
    const settings = readStoredDesignSettings(settingsJson);
    if (!settings) {
        throw new SavedDesignMeshError("Design has no saved parameter snapshot");
    }
    return createDesignWithStockPlaceholder(settings as DesignState);
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
}): Promise<FinalizedFootMesh> {
    const includeLeader = input.includeLeader !== false;
    resetSampleTopGeometryCache();
    const native = await sampleTopFromArrayBuffer(input.sampleTopBytes);
    primeSampleTopGeometry(native);
    installSavedDesign(input.design, input.printLoftEpoch ?? 0);
    const fingerprint = manufacturingFingerprintForActiveExport(input.side);
    const built = await buildPrinterFootManufacturingStl(input.side, includeLeader);
    if (binaryStlTriangleCount(built.stl) !== built.uploadTriangles) {
        throw new SavedDesignMeshError(`Finalized ${input.side} mesh triangle count does not match the STL`);
    }
    if (includeLeader && built.uploadTriangles <= built.solidTriangles) {
        throw new SavedDesignMeshError(`Leader was not applied once on the ${input.side} foot`);
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
    });
}

/** Both feet or neither. A failed second foot does not return the first. */
export async function buildFinalizedBeltPairFromSavedSettings(input: {
    settingsJson: unknown;
    sampleTopBytes: ArrayBuffer;
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
