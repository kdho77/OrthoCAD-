// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import type { CameraView } from "@/stores/design-store";
import type { Side } from "@/types";
import { INSOLE_LENGTH_MM, sideOffsetX } from "./layout";

/**
 * Camera presets shared with Viewer3D — single source for anatomical L/R layout.
 *
 * After Rx(−90°) placement, feet separate on world Z (left at +Z, right at −Z via
 * {@link sideOffsetX}). Presets below keep the left instance on screen-left for
 * clinical editing — including Bottom (plantar) view, which previously transposed
 * L/R and made Right sliders / eye-toggles appear to act on the contralateral foot.
 */
export const VIEW_CAMERA_POS: Record<CameraView, [number, number, number]> = {
    iso: [220, 200, 260],
    front: [0, 40, 360],
    back: [0, 40, -360],
    left: [360, 40, 0],
    right: [-360, 40, 0],
    top: [0, 400, 0],
    bottom: [0, -400, 0],
};

/**
 * Up vector for a preset.
 * - Top: −X ⇒ heels toward screen-up, left stays screen-left.
 * - Bottom: +X ⇒ looking from below without mirroring L/R (left stays screen-left).
 */
export function viewCameraUp(view: CameraView): [number, number, number] {
    if (view === "top") return [-1, 0, 0];
    if (view === "bottom") return [1, 0, 0];
    return [0, 1, 0];
}

/**
 * World-space origin of a side's insole mesh after the viewer group Rx(−90°)
 * and per-side sideOffsetX placement (matches BaseInsoleMesh / InsoleMesh).
 */
export function instanceWorldPosition(side: Side): THREE.Vector3 {
    const local = new THREE.Vector3(-INSOLE_LENGTH_MM / 2, sideOffsetX(side), 0);
    local.applyEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    return local;
}

/** NDC X (−1 screen-left … +1 screen-right) for a world point under a view preset. */
export function projectViewNdcX(view: CameraView, world: THREE.Vector3): number {
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    cam.position.set(...VIEW_CAMERA_POS[view]);
    cam.up.set(...viewCameraUp(view));
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    return world.clone().project(cam).x;
}

/** Which side instance projects further screen-left (smaller NDC X). */
export function furtherScreenLeft(view: CameraView): Side | "tied" {
    const lx = projectViewNdcX(view, instanceWorldPosition("left"));
    const rx = projectViewNdcX(view, instanceWorldPosition("right"));
    if (Math.abs(lx - rx) < 1e-6) return "tied";
    return lx < rx ? "left" : "right";
}
