// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ElementKind, PlacedElement, Side } from "@/types";

export type ElementAssetCategory = "add" | "sink";
export type ElementPlacementMode = "flow" | "noFlow";

/** Per-edge AABB / authored taper widths (mm). Distal = toe, proximal = heel. */
export interface ElementEdgeFeather {
    distal?: number;
    proximal?: number;
    lateral?: number;
    medialThumb?: number;
    medial?: number;
    notchRim?: number;
}

export type ElementFeatherMm = number | ElementEdgeFeather;

export interface ElementNotchSidecar {
    radiusMm?: number;
    tipFilletMm?: number;
    rimTaperMm?: number;
    centerAuthoredMm?: { x: number; y: number };
    centerAssetMm?: { x: number; y: number };
    /** `v` is stale on dancers_pad — derive from mm, never trust stored v. */
    centerUV?: { u: number; v: number };
    landmark?: string;
    scaling?: string;
}

export interface ElementAssetSidecar {
    kind: string;
    label: string;
    nominalPeakMm: number;
    defaultAnchorU?: number;
    defaultAnchorV?: number;
    anchor?: { u: number; v: number };
    rotationDeg: number;
    featherMm: ElementFeatherMm;
    featherProfile?: string;
    notch?: ElementNotchSidecar;
    notchRadiusMm?: number;
    anchorMm?: { x: number; y: number };
    category: ElementAssetCategory;
    defaultPlacementMode?: ElementPlacementMode;
    /** Authoritative insole length the asset was authored for (mm). XY scale is L/refSizeMm. */
    refSizeMm?: number;
    /** Informational measured top length (mm). Not used for scale. */
    refMeasuredLengthMm?: number;
    refWidthAtAnchorMm?: number;
    authoredSide?: "left" | "right";
    footprintMm?: { w: number; l: number; area: number };
    frame?: string;
    /** Width reference: `"SAMPLE_Top unscaled"` → Wref from SAMPLE_Top, scaled onto refSizeMm. */
    widthBasis?: string;
    /** Occupied-cell edge-ring max height (mm). >1 mm uses rim fade in no-flow. */
    edgeRingMaxMm?: number;
}

export interface ElementManifestEntry {
    id: string;
    kind: ElementKind;
    glb: string;
    sidecar: string;
    /** Viridis height-heatmap PNG generated at import from the 0.25 mm raster. */
    thumb?: string;
    label?: string;
}

export interface ElementManifest {
    version: number;
    elements: ElementManifestEntry[];
}

export interface ElementAssetTransform {
    /** Across-foot scale (authored +X medial). */
    scaleX: number;
    /** Along-foot scale (authored +Y toe). */
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
    scaleWarning?: string;
}

export const NO_FLOW_SMOOTH_MAX_K_MM = 0.5;
export const ELEMENT_GRID_MM = 0.25;
export const NO_FLOW_BASE_RADIUS_MM = 3;
export const ELEMENT_SUBDIVIDE_EDGE_MM = 1;
export const ELEMENT_SCALE_CLAMP_MIN = 0.75;
export const ELEMENT_SCALE_CLAMP_MAX = 1.25;

/** GLB library kinds applied as a height-field lift (height-field lift, not mesh boolean). */
export const LIBRARY_HEIGHT_FIELD_KINDS = [
    "met_pad",
    "met_bar",
    "toe_crest",
    "cuboid_pad",
    "dancers_pad",
    "cluffy_wedge",
] as const satisfies readonly ElementKind[];

export function isLibraryHeightFieldKind(kind: string): boolean {
    return (LIBRARY_HEIGHT_FIELD_KINDS as readonly string[]).includes(kind);
}

export function sidecarFeatherKey(feather: ElementFeatherMm | undefined): string {
    if (feather == null) return "";
    if (typeof feather === "number") return feather.toFixed(3);
    const medial = feather.medialThumb ?? feather.medial ?? 0;
    return [
        (feather.distal ?? 0).toFixed(2),
        (feather.proximal ?? 0).toFixed(2),
        (feather.lateral ?? 0).toFixed(2),
        medial.toFixed(2),
        (feather.notchRim ?? 0).toFixed(2),
    ].join("/");
}
