// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { meshYFromAnatomicalLateral } from "@/lib/geometry/handedness";
import type { CameraView } from "@/stores/design-store";
import type { Side } from "@/types";

/**
 * Anatomical side of every side-specific AFO marker.
 * Scan landmarks, design landmarks, and clinical markers that share an id
 * all read this table. Midline markers are absent on purpose.
 */
export const AFO_MARKER_ANATOMICAL_SIDE = {
    m1_mpj: "medial",
    navicular: "medial",
    medial_malleolus: "medial",
    proximal_medial: "medial",
    malleolus_medial: "medial",
    m5_mpj: "lateral",
    fifth_met_base: "lateral",
    lateral_malleolus: "lateral",
    fibular_head: "lateral",
    proximal_lateral: "lateral",
    malleolus_lateral: "lateral",
} as const;

export type AfoSideSpecificMarkerId = keyof typeof AFO_MARKER_ANATOMICAL_SIDE;
export type AfoAnatomicalSide = "medial" | "lateral";

/** Camera presets that are not a medial/lateral side. */
const AFO_MARKER_FIXED_VIEW: Record<string, CameraView> = {
    heel: "bottom",
    m1p: "bottom",
    m5p: "bottom",
    distal: "bottom",
    posterior_calcaneus: "back",
    post_calcaneus: "back",
    tibial_tuberosity: "front",
    distal_crest: "front",
};

export function afoMarkerAnatomicalSide(id: string): AfoAnatomicalSide | null {
    return AFO_MARKER_ANATOMICAL_SIDE[id as AfoSideSpecificMarkerId] ?? null;
}

/**
 * Camera preset that faces one anatomical side of an oriented AFO scan.
 *
 * Oriented mesh: +X anterior, +Z up, medial = {@link meshYFromAnatomicalLateral}
 * of a negative lateral coordinate (the insole rule: left medial is −Y,
 * right medial is +Y). The viewer group is Rx(−90°), so mesh +Y becomes
 * world −Z. Camera "right" sits on world −Z and faces mesh +Y; camera "left"
 * faces mesh −Y.
 */
export function cameraViewForAfoAnatomicalSide(side: Side, anatomical: AfoAnatomicalSide): "left" | "right" {
    const meshY = meshYFromAnatomicalLateral(anatomical === "lateral" ? 1 : -1, side);
    return meshY > 0 ? "right" : "left";
}

/** One placement rule for every AFO marker id. */
export function cameraViewForAfoMarkerId(id: string, side: Side): CameraView {
    const anatomical = afoMarkerAnatomicalSide(id);
    if (anatomical) return cameraViewForAfoAnatomicalSide(side, anatomical);
    return AFO_MARKER_FIXED_VIEW[id] ?? "iso";
}
