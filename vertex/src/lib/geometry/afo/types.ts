// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

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
    /** Toe box: 100–130% of max Z in the toe region. */
    heightPct?: number;
    enabled: boolean;
}

export interface AfoReliefChannel {
    mm: number;
    on: boolean;
}

export interface AfoReliefs {
    malleoli: AfoReliefChannel;
    navicular: AfoReliefChannel;
    fifthMetBase: AfoReliefChannel;
    postCalcaneus: AfoReliefChannel;
    fibularHead: AfoReliefChannel;
}

export type AfoClinicalMarkerId =
    | "navicular"
    | "fifth_met_base"
    | "post_calcaneus"
    | "fibular_head"
    | "tibial_tuberosity"
    | "distal_crest";

export interface AfoClinicalMarker {
    id: AfoClinicalMarkerId;
    point: AfoVec3;
    vertexIndex: number;
}

export interface AfoCrestState {
    points: AfoVec3[];
    outlierRatio: number;
    peakToMedian: number;
    lowConfidence: boolean;
    override: boolean;
}

export interface AfoCastState {
    /** Remove Cast offset `c_cast` (mm). c>0 shrinks. */
    removeCastMm: number;
    /** Shin offset `c_shin` (mm). */
    shinOffsetMm: number;
    insensate: boolean;
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
}

export interface AfoWarning {
    id: string;
    message: string;
    blocking: boolean;
}

/** Stage 1 plantar points, in unoriented scan millimetres. */
export type AfoPlantarPointId = "heel" | "m1p" | "m5p";

/** Stage 2 anatomical landmarks, in unoriented scan millimetres. */
export type AfoAnatomicalLandmarkId =
    | "posterior_calcaneus"
    | "m1_mpj"
    | "m5_mpj"
    | "navicular"
    | "fifth_met_base"
    | "medial_malleolus"
    | "lateral_malleolus"
    | "fibular_head";

/** Values derived from the landmark frame. Shell/trim geometry does not read these yet. */
export interface AfoScanDerived {
    forefootToRearfootDeg: number | null;
    /** Malleolar apices in the oriented frame. The future Cast-tab DF/PF pivot. */
    ankleAxis: { medial: AfoVec3; lateral: AfoVec3 } | null;
    plannedReliefsMm: { malleoli: number; navicular: number; styloid: number };
    /** Fibular head minus the proximal-trim offset, in the oriented frame. */
    proximalTrimCap: { offsetMm: number; point: AfoVec3 } | null;
    heelCupCenter: AfoVec3 | null;
    mpjBreak: { m1: AfoVec3; m5: AfoVec3 } | null;
    shankTiltDeg: { sagittal: number; frontal: number } | null;
    warnings: { id: string; message: string }[];
}

/**
 * Two-stage AFO scan registration.
 * Points stay in unoriented millimetres so Level to rearfoot can rebuild the rigid map.
 */
export interface AfoScanWorkflow {
    scanId: string | null;
    displayScale: number;
    plantar: Partial<Record<AfoPlantarPointId, AfoVec3>>;
    alignmentApplied: boolean;
    levelToRearfoot: boolean;
    /** Column-major 4×4. Unoriented millimetres → oriented millimetres. Null before Apply. */
    matrixElements: number[] | null;
    landmarks: Partial<Record<AfoAnatomicalLandmarkId, AfoVec3>>;
    derived: AfoScanDerived | null;
}

/** Persisted AFO parameter block (lives on DesignState.afo). */
export interface AfoDesignState {
    side: Side;
    method: ProductionMethod;
    cast: AfoCastState;
    corrections: AfoCorrections;
    reliefs: AfoReliefs;
    clinicalMarkers: AfoClinicalMarker[];
    crest: AfoCrestState;
    effectiveFeatherMm: number;
    landmarks: AfoLandmark[];
    scanWorkflow: AfoScanWorkflow;
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
