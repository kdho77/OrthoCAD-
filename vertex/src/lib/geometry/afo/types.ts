// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

type Side = "left" | "right";
type ProductionMethod = "printing_solid" | "printing_shell" | "milling_3axis";

/** Worker-safe triangle mesh (positions xyz packed). */
export interface AfoTriMesh {
    positions: Float32Array;
    indices: Uint32Array;
}

export interface AfoVec3 {
    x: number;
    y: number;
    z: number;
}

export interface AfoBoxParams {
    widthMm: number;
    depthMm: number;
    heightMm: number;
    enabled: boolean;
}

export interface AfoCastState {
    removeCast: boolean;
    flattenBottom: boolean;
    shinBox: AfoBoxParams;
    toeBox: AfoBoxParams;
    transparent: boolean;
    show3dModel: boolean;
    showCorrected: boolean;
}

export interface AfoCorrections {
    /** Frontal-plane tibial rotation (varus / valgus), degrees. */
    legRearDeg: number;
    /** Sagittal-plane rotation (PF / DF), degrees. */
    legSideDeg: number;
    heelLiftMm: number;
    footLiftMedMm: number;
    footLiftLatMm: number;
    toeFlowMm: number;
    medialArchMm: number;
    heelWidthMm: number;
    braceHeightMm: number;
    smoothIterations: number;
}

export type AfoDesignMarkerId =
    | "proximal_medial"
    | "proximal_lateral"
    | "malleolus_medial"
    | "malleolus_lateral"
    | "distal";

export interface AfoLandmark {
    id: AfoDesignMarkerId;
    point: AfoVec3;
    vertexIndex: number;
}

export interface AfoTrimPoint {
    point: AfoVec3;
    vertexIndex: number;
}

export interface AfoPrintParams {
    thicknessMm: number;
    edgeMm: number;
    flareMm: number;
    hideCast: boolean;
}

/** Persisted AFO parameter block (lives on DesignState.afo). */
export interface AfoDesignState {
    side: Side;
    method: ProductionMethod;
    cast: AfoCastState;
    corrections: AfoCorrections;
    landmarks: AfoLandmark[];
    trimPoints: AfoTrimPoint[];
    trimClosed: boolean;
    trimConfirmed: boolean;
    print: AfoPrintParams;
    shellReady: boolean;
}

export interface AfoOffsetOptions {
    distanceMm: number;
    /** Voxel cells along the longest AABB axis. */
    resolution?: number;
    onProgress?: (pct: number, stage: string) => void;
}

export interface AfoShellOptions {
    thicknessMm: number;
    edgeMm: number;
    flareMm: number;
    resolution?: number;
    onProgress?: (pct: number, stage: string) => void;
}

export interface TrimLoopValidation {
    ok: boolean;
    reasons: string[];
}

export type ProductType = "insole" | "afo";
