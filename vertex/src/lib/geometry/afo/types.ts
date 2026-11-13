// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

type Side = "left" | "right";
type ProductionMethod = "printing_solid" | "printing_shell" | "milling_3axis";

/** Worker-safe triangle mesh (positions xyz packed). */
export interface AfoTriMesh {
    positions: Float32Array;
    indices: Uint32Array;
    /**
     * First triangle of the closing rim. Faces before this are the inner and
     * outer skins. Set by the shell builder so a flared rim is not inferred
     * from distance to the scan.
     */
    rimFaceStart?: number;
    /** First vertex of the outer skin. Inner vertices occupy [0, outerVertex0). */
    outerVertex0?: number;
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
    /** Legacy toe-box height percent. The Windows toe box uses thickness and extra length. */
    heightPct?: number;
    /** Toe box dorsum addition (mm). Default 0. */
    thicknessMm?: number;
    /** Toe box distal extrusion (mm). Default 15. */
    extraLengthMm?: number;
    enabled: boolean;
}

export interface AfoSideCorrection {
    /** Frontal-plane tibial rotation (varus positive), degrees. */
    legRearDeg: number;
    /** Sagittal rotation. Positive is dorsiflexion. */
    legSideDeg: number;
    /** Signed. Positive raises the heel, negative lowers it. */
    heelLiftMm: number;
    footLiftMedMm: number;
    footLiftLatMm: number;
    /** Signed. Positive raises the medial arch, negative lowers it. */
    medialArchMm: number;
    heelWidthMm: number;
    braceHeightMm: number;
    /** Signed forefoot offset (mm). Positive rises, negative lowers. 0 stays on the plane. */
    toeRiseMm: number;
}

export interface AfoVolumeRegion {
    id: string;
    vertexIndices: number[];
    offsetMm: number;
    featherMm: number;
}

export interface AfoSmoothRegion {
    id: string;
    vertexIndices: number[];
    iterations: number;
}

export interface AfoTextMark {
    text: string;
    depthMm: number;
    anchor: AfoVec3 | null;
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
    /** Remove Cast offset `c_cast` (mm). c>0 shrinks. Default −2. */
    removeCastMm: number;
    /** Shin offset `c_shin` (mm). */
    shinOffsetMm: number;
    insensate: boolean;
    /** Flatten bottom enabled. */
    flattenBottom: boolean;
    /** Plantar plane height above the lowest vertex (mm). Default 7. */
    flattenRemoveMm: number;
    /** Plantar band above the plane that is also pulled onto it (mm). Default 2.8. */
    flattenAddMm: number;
    shinBox: AfoBoxParams;
    toeBox: AfoBoxParams;
    transparent: boolean;
    show3dModel: boolean;
    showCorrected: boolean;
}

export interface AfoCorrections extends AfoSideCorrection {
    /** Shared by both sides. Taubin iterations. */
    smoothIterations: number;
    left: AfoSideCorrection;
    right: AfoSideCorrection;
    volumeRegions: AfoVolumeRegion[];
    smoothRegions: AfoSmoothRegion[];
    text: AfoTextMark | null;
    /** Default plaque reads this name plus the side letter. */
    patientName: string;
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

/** AFO shell filament. The Print step offers this id and no other. */
export type AfoPrintMaterialId = "ApexVylon";

/**
 * Plug-in for the flat-AFO pass. The shell fingerprint hashes this object, so
 * that work can store unwrap settings without adding a second validity check.
 * Null until the flat-AFO pass writes it.
 */
export interface AfoFlatAfoSettings {
    revision: number;
    values: Record<string, string | number | boolean | null>;
}

export interface AfoPrintParams {
    thicknessMm: number;
    edgeMm: number;
    flareMm: number;
    /**
     * Locked to ApexVylon. Legacy saved values such as PLA are coerced on read
     * and are not offered in the Print control.
     */
    material: AfoPrintMaterialId;
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
    /** Malleolar apices in the oriented frame. Rear and side rotation pivot on their midpoint. */
    ankleAxis: { medial: AfoVec3; lateral: AfoVec3 } | null;
    /** Null when that optional marker was not placed. */
    plannedReliefsMm: { malleoli: number; navicular: number | null; styloid: number | null };
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
    /** Optional landmarks the user skipped. They advance the order and store no point. */
    skippedLandmarks: AfoAnatomicalLandmarkId[];
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
    /** Densified surface spline through the trim pins. Empty until the loop is fit. */
    trimCurve: AfoVec3[];
    trimClosed: boolean;
    trimConfirmed: boolean;
    print: AfoPrintParams;
    /** Null until the flat-AFO pass stores unwrap settings. Hashed into the shell fingerprint. */
    flatAfo: AfoFlatAfoSettings | null;
    shellReady: boolean;
}

export interface AfoOffsetOptions {
    distanceMm: number;
    /** Voxel cells along the longest AABB axis. */
    resolution?: number;
    onProgress?: (pct: number, stage: string) => void;
}

/**
 * Plantar tripod for the mandatory forefoot plate.
 * The contact plane is the plane through these landmarks. It is never the
 * lowest mesh vertex. The bottom (belt) plane is exactly `thicknessMm` below it.
 */
export interface AfoFlatPlateSpec {
    heel: AfoVec3;
    /** Plantar 1st met head. */
    m1: AfoVec3;
    /** Plantar 5th met head. */
    m5: AfoVec3;
    /** Selected plate / shell thickness. Not a hard-coded 4 mm. */
    thicknessMm: number;
    /**
     * Blend length behind the M1–M5 line, in millimetres.
     * Fixed construction parameter. Not a UI control.
     */
    blendBehindMm?: number;
    /** Preferred up direction. Plantar alignment uses +Z. */
    upHint?: AfoVec3;
}

export interface AfoShellOptions {
    thicknessMm: number;
    edgeMm: number;
    flareMm: number;
    resolution?: number;
    onProgress?: (pct: number, stage: string) => void;
    /**
     * Closed on-surface trim. The inner (skin-side) boundary of the shell.
     * Flare and edge thickness are built outward from this line.
     */
    trimPolygon?: AfoVec3[];
    /** Plantar / heel seed for the kept posterior-leaf region, in mesh millimetres. */
    heelSeed?: AfoVec3;
    /**
     * Forefoot plate. Generate shell always sets this. Primitive shells
     * (a sphere, a trim-only fixture) omit it and keep the plain offset.
     */
    flatPlate?: AfoFlatPlateSpec;
}

export interface TrimLoopValidation {
    ok: boolean;
    reasons: string[];
}

export type ProductType = "insole" | "afo";
