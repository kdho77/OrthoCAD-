// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { type Matrix4, Vector3 } from "three";

/** Reduced ambient so directional shading reads on bony relief. */
export const AFO_SCAN_LANDMARK_AMBIENT_INTENSITY = 0.15;

/** Weak sky/ground fill — shadowed sides stay visible, not black. */
export const AFO_SCAN_LANDMARK_HEMISPHERE_INTENSITY = 0.28;

export const AFO_SCAN_LANDMARK_KEY_INTENSITY = 1.05;
export const AFO_SCAN_LANDMARK_FILL_INTENSITY = 0.24;

/** World-mm offset of the key light from the camera (camera-local axes). */
export const AFO_SCAN_LANDMARK_KEY_CAMERA_OFFSET = {
    forward: 180,
    up: 90,
    right: 120,
} as const;

const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _scratch = new Vector3();

/**
 * Key light follows the camera with a fixed offset so every view preset gets raking light
 * instead of a headlight at the lens.
 */
export function afoScanLandmarkKeyLightPosition(
    cameraPosition: Vector3,
    cameraMatrixWorld: Matrix4,
    target = new Vector3(),
): Vector3 {
    _right.setFromMatrixColumn(cameraMatrixWorld, 0);
    _up.setFromMatrixColumn(cameraMatrixWorld, 1);
    _forward.setFromMatrixColumn(cameraMatrixWorld, 2).negate();
    const { forward, up, right } = AFO_SCAN_LANDMARK_KEY_CAMERA_OFFSET;
    return target
        .copy(cameraPosition)
        .add(_scratch.copy(_forward).multiplyScalar(forward))
        .add(_scratch.copy(_up).multiplyScalar(up))
        .add(_scratch.copy(_right).multiplyScalar(right));
}

/** Fill sits on the opposite side of the view axis from the key. */
export function afoScanLandmarkFillLightPosition(
    cameraPosition: Vector3,
    cameraMatrixWorld: Matrix4,
    target = new Vector3(),
): Vector3 {
    _right.setFromMatrixColumn(cameraMatrixWorld, 0);
    _up.setFromMatrixColumn(cameraMatrixWorld, 1);
    _forward.setFromMatrixColumn(cameraMatrixWorld, 2).negate();
    const { forward, up, right } = AFO_SCAN_LANDMARK_KEY_CAMERA_OFFSET;
    return target
        .copy(cameraPosition)
        .add(_scratch.copy(_forward).multiplyScalar(forward * 0.85))
        .add(_scratch.copy(_up).multiplyScalar(up * 0.35))
        .add(_scratch.copy(_right).multiplyScalar(-right * 1.15));
}

/** Perpendicular distance from the key light to the camera view axis (world mm). */
export function afoScanLandmarkKeyLightOffAxisDistanceMm(
    cameraPosition: Vector3,
    viewDirection: Vector3,
    keyLightPosition: Vector3,
): number {
    const toKey = _scratch.copy(keyLightPosition).sub(cameraPosition);
    const along = viewDirection.dot(toKey);
    const parallel = _forward.copy(viewDirection).multiplyScalar(along);
    return toKey.sub(parallel).length();
}
