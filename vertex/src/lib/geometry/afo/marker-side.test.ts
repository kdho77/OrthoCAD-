// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { defaultElementPose } from "@/lib/geometry/elements";
import { medialSign, meshYFromAnatomicalLateral } from "@/lib/geometry/handedness";
import { VIEW_CAMERA_POS } from "@/lib/geometry/viewport-side-layout";
import type { Side } from "@/types";
import {
    AFO_MARKER_ANATOMICAL_SIDE,
    afoMarkerAnatomicalSide,
    cameraViewForAfoAnatomicalSide,
    cameraViewForAfoMarkerId,
} from "./marker-side";

/**
 * Viewer group Rx(−90°): mesh (x, y, z) → world (x, z, −y).
 * The camera faces the side of the origin its position sits on.
 */
function cameraFacesMeshY(view: "left" | "right", meshY: number): boolean {
    const camZ = VIEW_CAMERA_POS[view][2];
    const worldZ = -meshY;
    return worldZ * camZ > 0;
}

describe("AFO marker sides", () => {
    test("each side-specific marker faces its anatomical side on a left and a right scan", () => {
        const sides: Side[] = ["left", "right"];
        for (const [id, anatomical] of Object.entries(AFO_MARKER_ANATOMICAL_SIDE)) {
            expect(afoMarkerAnatomicalSide(id)).toBe(anatomical);
            for (const side of sides) {
                const meshY = meshYFromAnatomicalLateral(anatomical === "lateral" ? 25 : -25, side);
                const oppositeY = meshYFromAnatomicalLateral(anatomical === "lateral" ? -25 : 25, side);
                const view = cameraViewForAfoMarkerId(id, side);
                expect(view === "left" || view === "right").toBe(true);
                if (view !== "left" && view !== "right") continue;
                expect(cameraFacesMeshY(view, meshY)).toBe(true);
                expect(cameraFacesMeshY(view, oppositeY)).toBe(false);
                expect(view).toBe(cameraViewForAfoAnatomicalSide(side, anatomical));
            }
        }
    });

    test("left medial markers face camera left and right medial markers face camera right", () => {
        for (const id of ["navicular", "medial_malleolus", "m1_mpj", "proximal_medial", "malleolus_medial"]) {
            expect(cameraViewForAfoMarkerId(id, "left")).toBe("left");
            expect(cameraViewForAfoMarkerId(id, "right")).toBe("right");
        }
        for (const id of [
            "lateral_malleolus",
            "fifth_met_base",
            "fibular_head",
            "m5_mpj",
            "proximal_lateral",
            "malleolus_lateral",
        ]) {
            expect(cameraViewForAfoMarkerId(id, "left")).toBe("right");
            expect(cameraViewForAfoMarkerId(id, "right")).toBe("left");
        }
    });

    test("midline markers stay on bottom, back, or front", () => {
        expect(cameraViewForAfoMarkerId("heel", "left")).toBe("bottom");
        expect(cameraViewForAfoMarkerId("m1p", "right")).toBe("bottom");
        expect(cameraViewForAfoMarkerId("m5p", "left")).toBe("bottom");
        expect(cameraViewForAfoMarkerId("distal", "right")).toBe("bottom");
        expect(cameraViewForAfoMarkerId("posterior_calcaneus", "left")).toBe("back");
        expect(cameraViewForAfoMarkerId("post_calcaneus", "right")).toBe("back");
        expect(cameraViewForAfoMarkerId("tibial_tuberosity", "left")).toBe("front");
        expect(cameraViewForAfoMarkerId("distal_crest", "right")).toBe("front");
    });
});

describe("insole side rule unchanged", () => {
    test("medialSign and Morton's medial-under-1st-ray stay on the approved sides", () => {
        expect(medialSign("left")).toBe(-1);
        expect(medialSign("right")).toBe(1);
        for (const side of ["left", "right"] as const) {
            expect(meshYFromAnatomicalLateral(-12, side)).toBeCloseTo(medialSign(side) * 12);
            expect(meshYFromAnatomicalLateral(12, side)).toBeCloseTo(-medialSign(side) * 12);
            expect(meshYFromAnatomicalLateral(meshYFromAnatomicalLateral(7.5, side), side)).toBeCloseTo(7.5);
            // Height-field +Y is the left 1st ray. Right mirrors to −Y.
            // This is the approved library pose; the AFO camera fix must not move it.
            const morton = defaultElementPose("mortons_extension", side, 260, 95);
            expect(morton.position.y).toBeCloseTo(side === "left" ? 23.75 : -23.75);
        }
    });
});
