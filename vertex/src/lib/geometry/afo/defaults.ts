// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import type { ProductionMethod, Side } from "@/types";
import type {
    AfoCastState,
    AfoClinicalMarkerId,
    AfoCorrections,
    AfoCrestState,
    AfoDesignMarkerId,
    AfoDesignState,
    AfoPrintParams,
    AfoReliefs,
    AfoScanWorkflow,
} from "./types";

/** Plantar / calcaneus Z in the oriented frame (C). */
export const AFO_C_MM = 0;
/** [K] Print wall thickness (mm). */
export const AFO_THICKNESS_MM = 4;
/** [K] Rim blend width (mm). */
export const AFO_EDGE_MM = 2.5;
/** [K] Outward flare at the trim opening (mm). */
export const AFO_FLARE_MM = 2.5;
/** [K] Brace height from plantar origin (mm). */
export const AFO_BRACE_HEIGHT_MM = 220;
/** [K] Taubin smooth iterations. */
export const AFO_SMOOTH_ITERATIONS = 4;
/** [K] Production method for a new AFO case. */
export const AFO_PRODUCTION_METHOD: ProductionMethod = "printing_shell";

export const AFO_FEATHER_MIN_MM = 10;
export const AFO_SLOPE_LIMIT = 0.7;
export const AFO_FEATHER_SLOPE = 2.15;
export const AFO_CREST_BAND_MM = 8;
export const AFO_CREST_SECTION_MM = 5;
export const AFO_CREST_OUTLIER_MM = 6;
export const AFO_CREST_OUTLIER_RATIO = 0.3;
export const AFO_CREST_PEAK_RATIO = 1.5;

/** [K] Canonical 3-point orient targets (heel, medial mal, lateral mal). */
export const AFO_ORIENT_TARGETS_MM: [number, number, number][] = [
    [0, 0, 0],
    [35, 40, 80],
    [-35, 40, 80],
];

export const AFO_THICKNESS_RANGE: [number, number] = [1.2, 12];
export const AFO_THICKNESS_WARN_MM = 2;
export const AFO_EDGE_RANGE: [number, number] = [0.5, 8];
export const AFO_FLARE_RANGE: [number, number] = [0, 8];
/** Frontal (varus/valgus) about the mid-malleolar frontal axis. */
export const AFO_REAR_ROT_RANGE: [number, number] = [-10, 10];
/** Sagittal (PF/DF) about the malleolar axis. */
export const AFO_SIDE_ROT_RANGE: [number, number] = [-5, 10];
export const AFO_HEEL_LIFT_RANGE: [number, number] = [0, 12];
export const AFO_FOOT_LIFT_RANGE: [number, number] = [0, 12];
export const AFO_ARCH_RANGE: [number, number] = [0, 18];
export const AFO_HEEL_WIDTH_RANGE: [number, number] = [-10, 10];
export const AFO_BRACE_HEIGHT_RANGE: [number, number] = [80, 350];
export const AFO_SMOOTH_RANGE: [number, number] = [0, 12];
export const AFO_REMOVE_CAST_RANGE: [number, number] = [-10, 10];
export const AFO_SHIN_OFFSET_RANGE: [number, number] = [-6, 4];
export const AFO_TOE_BOX_PCT_RANGE: [number, number] = [100, 130];
export const AFO_RELIEF_RANGE: [number, number] = [-6, 0];

export const AFO_TRIM_MIN_POINTS = 3;
export const AFO_TRIM_MIN_LENGTH_MM = 20;
export const AFO_TRIM_MIN_AREA_MM2 = 100;

export const AFO_DESIGN_MARKERS = [
    { id: "proximal_medial", label: "Proximal medial", view: "medial" },
    { id: "proximal_lateral", label: "Proximal lateral", view: "lateral" },
    { id: "malleolus_medial", label: "Medial malleolus", view: "medial" },
    { id: "malleolus_lateral", label: "Lateral malleolus", view: "lateral" },
    { id: "distal", label: "Distal / sulcus", view: "bottom" },
] as const;

export const AFO_CLINICAL_MARKERS: {
    id: AfoClinicalMarkerId;
    label: string;
    view: "medial" | "lateral" | "front";
}[] = [
    { id: "navicular", label: "Navicular", view: "medial" },
    { id: "fifth_met_base", label: "5th met base", view: "lateral" },
    { id: "post_calcaneus", label: "Post calcaneus", view: "medial" },
    { id: "fibular_head", label: "Fibular head", view: "lateral" },
    { id: "tibial_tuberosity", label: "Tibial tuberosity", view: "front" },
    { id: "distal_crest", label: "Distal crest end", view: "front" },
];

export type { AfoDesignMarkerId };

export function defaultAfoCorrections(): AfoCorrections {
    return {
        legRearDeg: 0,
        legSideDeg: 0,
        heelLiftMm: 0,
        footLiftMedMm: 0,
        footLiftLatMm: 0,
        medialArchMm: 0,
        heelWidthMm: 0,
        braceHeightMm: AFO_BRACE_HEIGHT_MM,
        smoothIterations: AFO_SMOOTH_ITERATIONS,
    };
}

export function defaultAfoReliefs(): AfoReliefs {
    return {
        malleoli: { mm: -3, on: true },
        navicular: { mm: -2, on: false },
        fifthMetBase: { mm: -2, on: false },
        postCalcaneus: { mm: -2, on: false },
        fibularHead: { mm: -2, on: false },
    };
}

export function defaultAfoCrest(): AfoCrestState {
    return {
        points: [],
        outlierRatio: 0,
        peakToMedian: 1,
        lowConfidence: false,
        override: false,
    };
}

export function defaultAfoCast(): AfoCastState {
    return {
        removeCastMm: 0,
        shinOffsetMm: 0,
        insensate: false,
        flattenBottom: false,
        shinBox: { widthMm: 80, depthMm: 70, heightMm: 220, enabled: false },
        toeBox: { widthMm: 80, depthMm: 90, heightMm: 50, heightPct: 100, enabled: false },
        transparent: false,
        show3dModel: true,
        showCorrected: false,
    };
}

export function defaultAfoPrint(): AfoPrintParams {
    return {
        thicknessMm: AFO_THICKNESS_MM,
        edgeMm: AFO_EDGE_MM,
        flareMm: AFO_FLARE_MM,
    };
}

export function defaultAfoScanWorkflow(): AfoScanWorkflow {
    return {
        scanId: null,
        displayScale: 1,
        plantar: {},
        alignmentApplied: false,
        levelToRearfoot: false,
        matrixElements: null,
        landmarks: {},
        skippedLandmarks: [],
        derived: null,
    };
}

export function defaultAfoDesignState(side: Side = "left"): AfoDesignState {
    return {
        side,
        method: AFO_PRODUCTION_METHOD,
        cast: defaultAfoCast(),
        corrections: defaultAfoCorrections(),
        reliefs: defaultAfoReliefs(),
        clinicalMarkers: [],
        crest: defaultAfoCrest(),
        effectiveFeatherMm: AFO_FEATHER_MIN_MM,
        landmarks: [],
        scanWorkflow: defaultAfoScanWorkflow(),
        trimPoints: [],
        trimClosed: false,
        trimConfirmed: false,
        print: defaultAfoPrint(),
        shellReady: false,
    };
}

export function isAfoIdentityCorrections(c: AfoCorrections): boolean {
    return (
        c.legRearDeg === 0 &&
        c.legSideDeg === 0 &&
        c.heelLiftMm === 0 &&
        c.footLiftMedMm === 0 &&
        c.footLiftLatMm === 0 &&
        c.medialArchMm === 0 &&
        c.heelWidthMm === 0 &&
        c.smoothIterations === 0
    );
}
