// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { BufferGeometry } from "three";
import type { HeightFieldParams } from "@/lib/geometry/height-field";
import { insoleParamsFromDesign } from "@/lib/geometry/kernel-build";
import { getDesignTrimline } from "@/lib/geometry/trimline";
import { extractMergedGeometry, loadGlbFromBuffer, loadGlbFromUrl } from "@/lib/library/loaders";
import { mergeCorrections, mergeElementPreviews } from "@/stores/performance-store";
import { useCustomLibraryStore } from "@/stores/custom-library-store";
import type { DesignBase, DesignState, Side } from "@/types";

// Base resolution + loading for the Base + Modifier model.
// Centralises how a design's optional base template is discovered and turned
// into a Three.js geometry, so the viewer hook and the export pipeline agree.

/**
 * Resolve the effective base template for a design.
 * Supports paired left/right workspace: if design.paired and side provided, returns the side-specific base.
 * Falls back to legacy single base / customPrefabId.
 * Returns `null` for pure parametric designs.
 */
export function getDesignBase(design: DesignState, side?: Side): DesignBase | null {
    if (side && design.paired) {
        const sideBase = side === 'left' ? design.paired.leftBase : design.paired.rightBase;
        if (sideBase) return sideBase;
    }
    if (design.base) return design.base;
    if (design.customPrefabId) {
        return { assetId: design.customPrefabId, name: design.customPrefabName, source: "custom" };
    }
    return null;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

/**
 * Load the raw base mesh geometry for a design base from the custom library
 * (local GLB blob preferred, remote URL fallback). Returns `null` when the
 * asset cannot be resolved.
 */
export async function loadBaseGeometry(base: DesignBase): Promise<BufferGeometry | null> {
    const store = useCustomLibraryStore.getState();

    const local = store.getLocalGlb(base.assetId);
    if (local) {
        const group = await loadGlbFromBuffer(base64ToArrayBuffer(local.glbBase64));
        const merged = extractMergedGeometry(group);
        if (merged) return merged.geometry;
    }

    const prefab = store.customPrefabs.find((p) => p.id === base.assetId);
    if (prefab?.url) {
        const group = await loadGlbFromUrl(prefab.url);
        const merged = extractMergedGeometry(group);
        if (merged) return merged.geometry;
    }

    return null;
}

/** Height field (with live correction/element previews) for modifier application. */
export function baseModifierField(design: DesignState, side: Side, thicknessMm: number): HeightFieldParams {
    const params = insoleParamsFromDesign(design, side, "full");
    return {
        side,
        lengthMm: params.lengthMm,
        widthMm: params.widthMm,
        thicknessMm: params.thicknessMm,
        corrections: mergeCorrections(side, design.corrections[side]),
        elements: mergeElementPreviews(design.elements.filter((e) => e.side === side)),
        includeSkives: true,
        includeElements: true,
        trimline: null, // preview path deliberately ignores trimline (clip happens in hook)
    };
}

/**
 * Authoritative field for the sewn OCCT base path (Phase 3B). Includes the
 * committed trimline so that applyTrimlineCut etc. can run as exact booleans
 * on the sewn solid. Only used for idle/Confirm/Export builds.
 */
export function baseModifierFieldAuthoritative(design: DesignState, side: Side, thicknessMm: number): HeightFieldParams {
    const f = baseModifierField(design, side, thicknessMm);
    // Pull the committed (not draft) trimline for manufacturing.
    const committed = getDesignTrimline(design, side); // local import below to avoid cycle in some builds
    return { ...f, trimline: committed };
}
