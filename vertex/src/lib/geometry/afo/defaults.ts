// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { ProductionMethod, Side } from "@/types";
import type {
    AfoCastState,
    AfoCorrections,
    AfoDesignMarkerId,
    AfoDesignState,
    AfoPrintParams,
} from "./types";

/** [K] Print wall thickness (mm). */
export const AFO_THICKNESS_MM = 5;
/** [K] Rim blend width (mm). */
export const AFO_EDGE_MM = 2.5;
/** [K] Outward flare at the trim opening (mm). */
export const AFO_FLARE_MM = 2;
/** [K] Brace height from plantar origin (mm). */
export const AFO_BRACE_HEIGHT_MM = 220;
/** [K] Taubin smooth iterations. */
export const AFO_SMOOTH_ITERATIONS = 4;
/** [K] Production method for a new AFO case. */
export const AFO_PRODUCTION_METHOD: ProductionMethod = "printing_shell";

/** [K] Canonical 3-point orient targets (heel, medial mal, lateral mal). */
export const AFO_ORIENT_TARGETS_MM: [number, number, number][] = [
    [0, 0, 0],
    [35, 40, 80],
    [-35, 40, 80],
];

export const AFO_THICKNESS_RANGE: [number, number] = [1, 12];
export const AFO_EDGE_RANGE: [number, number] = [0.5, 8];
export const AFO_FLARE_RANGE: [number, number] = [0, 8];
export const AFO_REAR_ROT_RANGE: [number, number] = [-20, 20];
export const AFO_SIDE_ROT_RANGE: [number, number] = [-25, 25];
export const AFO_HEEL_LIFT_RANGE: [number, number] = [0, 12];
export const AFO_FOOT_LIFT_RANGE: [number, number] = [0, 12];
export const AFO_TOE_FLOW_RANGE: [number, number] = [0, 16];
export const AFO_ARCH_RANGE: [number, number] = [0, 18];
export const AFO_HEEL_WIDTH_RANGE: [number, number] = [-10, 10];
export const AFO_BRACE_HEIGHT_RANGE: [number, number] = [80, 350];
export const AFO_SMOOTH_RANGE: [number, number] = [0, 12];

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

export type { AfoDesignMarkerId };

export function defaultAfoCorrections(): AfoCorrections {
    return {
        legRearDeg: 0,
        legSideDeg: 0,
        heelLiftMm: 0,
        footLiftMedMm: 0,
        footLiftLatMm: 0,
        toeFlowMm: 0,
        medialArchMm: 0,
        heelWidthMm: 0,
        braceHeightMm: AFO_BRACE_HEIGHT_MM,
        smoothIterations: AFO_SMOOTH_ITERATIONS,
    };
}

export function defaultAfoCast(): AfoCastState {
    return {
        removeCast: false,
        flattenBottom: false,
        shinBox: { widthMm: 80, depthMm: 70, heightMm: 220, enabled: false },
        toeBox: { widthMm: 80, depthMm: 90, heightMm: 50, enabled: false },
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
        hideCast: true,
    };
}

export function defaultAfoDesignState(side: Side = "left"): AfoDesignState {
    return {
        side,
        method: AFO_PRODUCTION_METHOD,
        cast: defaultAfoCast(),
        corrections: defaultAfoCorrections(),
        landmarks: [],
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
        c.toeFlowMm === 0 &&
        c.medialArchMm === 0 &&
        c.heelWidthMm === 0 &&
        c.smoothIterations === 0
    );
}
