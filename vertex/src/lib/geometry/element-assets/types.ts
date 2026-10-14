// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ElementKind, PlacedElement, Side } from "@/types";

export type ElementAssetCategory = "add" | "sink";
export type ElementPlacementMode = "flow" | "noFlow";

export interface ElementAssetSidecar {
    kind: ElementAssetCategory;
    label: string;
    nominalPeakMm: number;
    defaultAnchorU: number;
    defaultAnchorV: number;
    rotationDeg: number;
    featherMm: number;
    category: ElementAssetCategory;
    defaultPlacementMode?: ElementPlacementMode;
}

export interface ElementManifestEntry {
    id: string;
    kind: ElementKind;
    glb: string;
    sidecar: string;
}

export interface ElementManifest {
    version: number;
    elements: ElementManifestEntry[];
}

export interface ElementAssetTransform {
    /** Footprint scale X (mm true — not width-affine scaled). */
    scaleX: number;
    /** Footprint scale Y (mm true — not width-affine scaled). */
    scaleY: number;
    scaleZ: number;
    rotationDeg: number;
    mirrorX: boolean;
    anchorUMm: number;
    anchorVMm: number;
    placementMode: ElementPlacementMode;
    zOffsetMm: number;
    heightMm: number;
    category: ElementAssetCategory;
}

export interface PlacedElementAssetContext {
    placed: PlacedElement;
    side: Side;
    sidecar: ElementAssetSidecar;
    assetId: string;
    assetHash: string;
    transform: ElementAssetTransform;
}

export const NO_FLOW_SMOOTH_MAX_K_MM = 0.5;
export const ELEMENT_GRID_MM = 0.25;
export const NO_FLOW_BASE_RADIUS_MM = 3;
export const ELEMENT_SUBDIVIDE_EDGE_MM = 1;
