// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import * as THREE from "three";
import type { CameraView } from "@/stores/design-store";
import type { Side } from "@/types";
import { INSOLE_LENGTH_MM, sideOffsetX } from "./layout";

/**
 * World-space axis convention after footprint reorientation + viewer Rx(−90°):
 *   +X = heel → toe (anterior)
 *   +Y = plantar → dorsal (superior)
 *   +Z = toward the left instance (right instance at −Z)
 *
 * Camera presets are authored in this world frame (not mesh-local).
 */
export const VIEW_CAMERA_POS: Record<CameraView, [number, number, number]> = {
    iso: [220, 200, 260],
    front: [360, 40, 0],
    back: [-360, 40, 0],
    left: [0, 40, 360],
    right: [0, 40, -360],
    top: [0, 400, 0],
    bottom: [0, -400, 0],
};

/**
 * Up vector for a preset.
 * Top/Bottom use +X so toes sit at screen-top and heel at screen-bottom.
 * Sagittal/coronal/iso use +Y (superior up).
 */
export function viewCameraUp(view: CameraView): [number, number, number] {
    if (view === "top" || view === "bottom") return [1, 0, 0];
    return [0, 1, 0];
}

/** Minimal OrbitControls-like surface used by {@link applyCameraViewPreset}. */
export interface CameraViewControls {
    object: {
        position: THREE.Vector3;
        up: THREE.Vector3;
    };
    target: THREE.Vector3;
    update: () => void;
}

/**
 * Snap camera + orbit target to a named anatomical preset.
 * No-ops safely when controls/camera/target are missing (empty scene / unmounted).
 * Always resets `camera.up` so free-orbit roll cannot leak into the preset.
 */
export function applyCameraViewPreset(
    controls: CameraViewControls | null | undefined,
    view: CameraView,
): boolean {
    if (!controls?.object || !controls.target) return false;
    const pos = VIEW_CAMERA_POS[view];
    if (!pos) return false;
    // Distances are hardcoded (no fit-to-bounds); skip only if a component is non-finite.
    if (!pos.every((n) => Number.isFinite(n))) return false;

    controls.object.position.set(...pos);
    controls.target.set(0, 0, 0);
    controls.object.up.set(...viewCameraUp(view));
    controls.update();
    return true;
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

/** Build a PerspectiveCamera framed to a view preset (shared by projection helpers + tests). */
export function cameraForView(view: CameraView): THREE.PerspectiveCamera {
    const cam = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    cam.position.set(...VIEW_CAMERA_POS[view]);
    cam.up.set(...viewCameraUp(view));
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
    return cam;
}

/** NDC X (−1 screen-left … +1 screen-right) for a world point under a view preset. */
export function projectViewNdcX(view: CameraView, world: THREE.Vector3): number {
    return world.clone().project(cameraForView(view)).x;
}

/** NDC Y (−1 screen-bottom … +1 screen-top) for a world point under a view preset. */
export function projectViewNdcY(view: CameraView, world: THREE.Vector3): number {
    return world.clone().project(cameraForView(view)).y;
}

/** Which side instance projects further screen-left (smaller NDC X). */
export function furtherScreenLeft(view: CameraView): Side | "tied" {
    const lx = projectViewNdcX(view, instanceWorldPosition("left"));
    const rx = projectViewNdcX(view, instanceWorldPosition("right"));
    if (Math.abs(lx - rx) < 1e-6) return "tied";
    return lx < rx ? "left" : "right";
}
