// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Belt manufacturing STL identity. No Three.js and no Node crypto so the
// browser bundle can import the version constant.

import { stripMeshBlobs } from "./design-settings.js";

/**
 * Bump when belt placement or loft geometry changes. A stored temp, archive,
 * or slice checkpoint from an older value must not be sliced.
 * 2 — beltPrint is part of the solid identity (pre-#52 temps are not reused).
 */
export const MANUFACTURING_STL_PLACEMENT_VERSION = 2;

/**
 * OrthoCAD loft generation mixed into every manufacturing STL identity.
 * A design saved by another OrthoCAD version must not reuse this STL.
 */
export const ORTHOCAD_MANUFACTURING_VERSION = "0.7.1";

/** Used when the live VertexSlice build hash is not part of this identity. */
export const MANUFACTURING_SLICER_VERSION = "vertexslice";

/**
 * Everything that must change the stored STL. `savedDesign` is the whole
 * parameter snapshot (mesh blobs stripped), not a picked field list.
 * Locked rule t2699u: any design change yields a new STL and a fresh slice.
 */
export function manufacturingStlIdentityPayload(input: {
    savedDesign: unknown;
    side: string;
    beltPrint: boolean;
    placementVersion?: number;
    orthocadVersion?: string;
    slicerVersion?: string;
}): Record<string, unknown> {
    return {
        savedDesign: stripMeshBlobs(input.savedDesign),
        side: input.side,
        beltPrint: input.beltPrint === true,
        placementVersion: input.placementVersion ?? MANUFACTURING_STL_PLACEMENT_VERSION,
        orthocadVersion: input.orthocadVersion ?? ORTHOCAD_MANUFACTURING_VERSION,
        slicerVersion: input.slicerVersion ?? MANUFACTURING_SLICER_VERSION,
    };
}

/**
 * Left belt manufacturing STL sliced at 1:13 PM, before VertexSlice #52.
 * Live force_new_slice uploads kept this eTag and size (9045484 bytes).
 */
export const STALE_PRE52_BELT_MANUFACTURING_STL = {
    etag: "8f5dc451de66dbba8f8521e046a9e4af",
    sizeBytes: 9045484,
} as const;

export function normalizeStorageEtag(etag: string | null | undefined): string {
    return etag?.replaceAll('"', "").trim().toLowerCase() ?? "";
}

/** True for the known pre-#52 belt STL. A matching eTag is enough; size confirms it. */
export function isStalePre52ManufacturingEtag(
    etag: string | null | undefined,
    sizeBytes?: number | null,
): boolean {
    const normalized = normalizeStorageEtag(etag);
    if (normalized !== STALE_PRE52_BELT_MANUFACTURING_STL.etag) return false;
    if (sizeBytes == null) return true;
    return sizeBytes === STALE_PRE52_BELT_MANUFACTURING_STL.sizeBytes;
}
