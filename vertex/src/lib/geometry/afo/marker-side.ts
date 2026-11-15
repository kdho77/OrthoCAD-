// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Euler, Group, Vector3 } from "three";
import { meshYFromAnatomicalLateral } from "@/lib/geometry/handedness";
import { VIEW_CAMERA_POS } from "@/lib/geometry/viewport-side-layout";
import type { CameraView } from "@/stores/design-store";
import type { Side } from "@/types";
import { transformAfoPoint } from "./landmark-frame";
import type { AfoVec3 } from "./types";

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

/** Oriented-mesh points. Medial is the 1st ray / medial malleolus side. */
export interface AfoOrientedSides {
    medial: AfoVec3;
    lateral: AfoVec3;
}

/** Same Rx(−90°) group as AfoMeshes / AfoScanMarkers. */
export function afoViewerWorld(point: AfoVec3): Vector3 {
    const group = new Group();
    group.rotation.copy(new Euler(-Math.PI / 2, 0, 0));
    group.updateMatrixWorld(true);
    return new Vector3(point.x, point.y, point.z).applyMatrix4(group.matrixWorld);
}

/**
 * Camera preset that faces `near` rather than `far` after the viewer rotation.
 * The preset is chosen by the world direction, not by a second left/right table.
 */
export function cameraViewFacingOriented(nearPoint: AfoVec3, farPoint: AfoVec3): "left" | "right" {
    const direction = afoViewerWorld(nearPoint).sub(afoViewerWorld(farPoint));
    const left = direction.dot(new Vector3(...VIEW_CAMERA_POS.left));
    const right = direction.dot(new Vector3(...VIEW_CAMERA_POS.right));
    return left >= right ? "left" : "right";
}

/** Unoriented plantar clicks → oriented medial/lateral axis. Null before alignment. */
export function orientedPlantarSides(
    matrixElements: number[] | null | undefined,
    m1p: AfoVec3 | undefined,
    m5p: AfoVec3 | undefined,
): AfoOrientedSides | undefined {
    if (!matrixElements || !m1p || !m5p) return undefined;
    return {
        medial: transformAfoPoint(m1p, matrixElements),
        lateral: transformAfoPoint(m5p, matrixElements),
    };
}

/** One placement rule for every AFO marker id. Placed M1/M5 win over `side`. */
export function cameraViewForAfoMarkerId(id: string, side: Side, oriented?: AfoOrientedSides): CameraView {
    const anatomical = afoMarkerAnatomicalSide(id);
    if (anatomical && oriented) {
        const near = anatomical === "medial" ? oriented.medial : oriented.lateral;
        const far = anatomical === "medial" ? oriented.lateral : oriented.medial;
        return cameraViewFacingOriented(near, far);
    }
    if (anatomical) return cameraViewForAfoAnatomicalSide(side, anatomical);
    return AFO_MARKER_FIXED_VIEW[id] ?? "iso";
}
