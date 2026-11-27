// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useRef } from "react";
import { type DirectionalLight, type Matrix4, Vector3 } from "three";

/** Lower ambient + stronger key so Print/Export solid contours read clearly. */
export const PRINT_EXPORT_AMBIENT_INTENSITY = 0.32;
export const PRINT_EXPORT_KEY_INTENSITY = 1.38;
export const PRINT_EXPORT_FILL_INTENSITY = 0.22;
export const PRINT_EXPORT_RIM_INTENSITY = 0.16;

/** Camera-local key offset (world mm): upper-left raking, not a headlight. */
export const INSOLE_KEY_CAMERA_OFFSET = {
    forward: 200,
    up: 120,
    right: 150,
} as const;

const _forward = new Vector3();
const _right = new Vector3();
const _up = new Vector3();
const _scratch = new Vector3();

/**
 * Key light follows the camera with a fixed offset so every view gets raking light
 * (crisp top contours, readable bottom engraving) instead of world-fixed +Y only.
 */
export function insoleKeyLightPosition(
    cameraPosition: Vector3,
    cameraMatrixWorld: Matrix4,
    target = new Vector3(),
): Vector3 {
    _right.setFromMatrixColumn(cameraMatrixWorld, 0);
    _up.setFromMatrixColumn(cameraMatrixWorld, 1);
    _forward.setFromMatrixColumn(cameraMatrixWorld, 2).negate();
    const { forward, up, right } = INSOLE_KEY_CAMERA_OFFSET;
    return target
        .copy(cameraPosition)
        .add(_scratch.copy(_forward).multiplyScalar(forward))
        .add(_scratch.copy(_up).multiplyScalar(up))
        .add(_scratch.copy(_right).multiplyScalar(right));
}

/** Fill on the opposite side of the view axis from the key. */
export function insoleFillLightPosition(
    cameraPosition: Vector3,
    cameraMatrixWorld: Matrix4,
    target = new Vector3(),
): Vector3 {
    _right.setFromMatrixColumn(cameraMatrixWorld, 0);
    _up.setFromMatrixColumn(cameraMatrixWorld, 1);
    _forward.setFromMatrixColumn(cameraMatrixWorld, 2).negate();
    const { forward, up, right } = INSOLE_KEY_CAMERA_OFFSET;
    return target
        .copy(cameraPosition)
        .add(_scratch.copy(_forward).multiplyScalar(forward * 0.75))
        .add(_scratch.copy(_up).multiplyScalar(up * 0.35))
        .add(_scratch.copy(_right).multiplyScalar(-right * 1.1));
}

/** Subtle rim behind the subject relative to the view axis. */
export function insoleRimLightPosition(
    cameraPosition: Vector3,
    cameraMatrixWorld: Matrix4,
    target = new Vector3(),
): Vector3 {
    _right.setFromMatrixColumn(cameraMatrixWorld, 0);
    _up.setFromMatrixColumn(cameraMatrixWorld, 1);
    _forward.setFromMatrixColumn(cameraMatrixWorld, 2).negate();
    const { forward, up, right } = INSOLE_KEY_CAMERA_OFFSET;
    return target
        .copy(cameraPosition)
        .add(_scratch.copy(_forward).multiplyScalar(-forward * 0.55))
        .add(_scratch.copy(_up).multiplyScalar(up * 0.25))
        .add(_scratch.copy(_right).multiplyScalar(right * 0.35));
}

/** Perpendicular distance from the key light to the camera view axis (world mm). */
export function insoleKeyLightOffAxisDistanceMm(
    cameraPosition: Vector3,
    viewDirection: Vector3,
    keyLightPosition: Vector3,
): number {
    const toKey = _scratch.copy(keyLightPosition).sub(cameraPosition);
    const along = viewDirection.dot(toKey);
    const parallel = _forward.copy(viewDirection).multiplyScalar(along);
    return toKey.sub(parallel).length();
}

/** Unit vector from a surface point toward the key light (Lambert L). */
export function insoleLightTowardSurface(
    surfacePoint: Vector3,
    lightPosition: Vector3,
    target = new Vector3(),
): Vector3 {
    return target.copy(lightPosition).sub(surfacePoint).normalize();
}

/** Angle in degrees between Lambert L and an outward face normal. */
export function insoleKeyLightAngleFromNormalDeg(
    lightTowardSurface: Vector3,
    outwardNormal: Vector3,
): number {
    const cos = Math.max(-1, Math.min(1, lightTowardSurface.dot(outwardNormal)));
    return (Math.acos(cos) * 180) / Math.PI;
}

type AnchoredLightsProps = {
    keyIntensity: number;
    fillIntensity: number;
    rimIntensity?: number;
};

function CameraAnchoredInsoleLights({ keyIntensity, fillIntensity, rimIntensity }: AnchoredLightsProps) {
    const { camera } = useThree();
    const keyRef = useRef<DirectionalLight>(null);
    const fillRef = useRef<DirectionalLight>(null);
    const rimRef = useRef<DirectionalLight>(null);

    const syncLights = useCallback(() => {
        const key = keyRef.current;
        const fill = fillRef.current;
        const rim = rimRef.current;
        if (!key || !fill) return;
        camera.updateMatrixWorld();
        key.position.copy(insoleKeyLightPosition(camera.position, camera.matrixWorld));
        fill.position.copy(insoleFillLightPosition(camera.position, camera.matrixWorld));
        if (rim && rimIntensity != null) {
            rim.position.copy(insoleRimLightPosition(camera.position, camera.matrixWorld));
        }
    }, [camera, rimIntensity]);

    useLayoutEffect(() => {
        syncLights();
    }, [syncLights]);

    useFrame(() => {
        syncLights();
    });

    return (
        <>
            <directionalLight ref={keyRef} intensity={keyIntensity} />
            <directionalLight ref={fillRef} intensity={fillIntensity} />
            {rimIntensity != null ? <directionalLight ref={rimRef} intensity={rimIntensity} /> : null}
        </>
    );
}

export function InsoleContourLighting() {
    return (
        <>
            <ambientLight intensity={PRINT_EXPORT_AMBIENT_INTENSITY} />
            <CameraAnchoredInsoleLights
                keyIntensity={PRINT_EXPORT_KEY_INTENSITY}
                fillIntensity={PRINT_EXPORT_FILL_INTENSITY}
                rimIntensity={PRINT_EXPORT_RIM_INTENSITY}
            />
        </>
    );
}

export function InsoleStandardLighting() {
    return (
        <>
            <ambientLight intensity={0.6} />
            <CameraAnchoredInsoleLights keyIntensity={1.1} fillIntensity={0.4} />
        </>
    );
}
