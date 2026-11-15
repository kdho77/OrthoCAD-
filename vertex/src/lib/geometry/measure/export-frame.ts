// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { Euler, Matrix4, Vector3 } from "three";
import { sideOffsetX } from "@/lib/geometry/layout";
import type { Side } from "@/types";
import type { MeasureDisplayTransform, MeasureTriangleMesh, MeasureVec3 } from "./types";

/**
 * Export-frame undo for the measurement tool.
 *
 * The manufacturing mesh (the STL `buildExportStl` writes) stays in the
 * print frame: insole X = heel→toe, Y = width, Z = height with the plantar
 * floor at z = 0; AFO X = medial-lateral, Y = footplate, Z = height.
 * The viewer does not bake that frame. It only poses the Object3D:
 *
 *   displayed = R · (S · mirror(p) + T)
 *
 *   mirror  optional L/R display reflection (export space, before scale)
 *   S       normalize / fit scale — identity when vertices are already mm
 *   T       centering (−length/2, 0, 0) plus the insole pair Y-shift
 *   R       Euler XYZ. BaseInsoleMesh, InsoleMesh and AfoMeshes use a
 *           parent group Rx(−π/2), which is `rotationEuler.x` here.
 *
 * {@link displayPointToExportMm} is that inverse. Live picks use the mesh
 * `matrixWorld` (the same R·T·S the group graph built) via `worldToLocal`,
 * because geometry attributes are already export-frame millimetres.
 */

/** Parent-group rotation shared by the insole and AFO viewers. */
export const VIEWER_DISPLAY_RX = -Math.PI / 2;

export function vec3(x: number, y: number, z: number): MeasureVec3 {
    return { x, y, z };
}

export function identityDisplayTransform(): MeasureDisplayTransform {
    return {
        scale: vec3(1, 1, 1),
        translation: vec3(0, 0, 0),
        rotationEuler: vec3(0, 0, 0),
        mirror: null,
    };
}

/**
 * Display pose of one insole mesh.
 * Matches `BaseInsoleMesh` / `InsoleMesh`: parent Rx(−π/2), child position
 * `(−length/2, sideOffsetX, 0)`. Scale stays 1 — shoe size is already in the
 * vertices the exporter writes.
 */
export function insoleViewerDisplayTransform(
    side: Side,
    lengthMm: number,
    widthMm: number,
): MeasureDisplayTransform {
    return {
        scale: vec3(1, 1, 1),
        translation: vec3(-lengthMm / 2, sideOffsetX(side, widthMm), 0),
        rotationEuler: vec3(VIEWER_DISPLAY_RX, 0, 0),
        mirror: null,
    };
}

/** AFO shells are exported as stored. The viewer only applies the Rx(−π/2) group. */
export function afoViewerDisplayTransform(): MeasureDisplayTransform {
    return {
        scale: vec3(1, 1, 1),
        translation: vec3(0, 0, 0),
        rotationEuler: vec3(VIEWER_DISPLAY_RX, 0, 0),
        mirror: null,
    };
}

function mirrorPoint(p: MeasureVec3, xf: MeasureDisplayTransform): MeasureVec3 {
    const mirror = xf.mirror;
    if (!mirror) return p;
    const out = { x: p.x, y: p.y, z: p.z };
    const key = mirror.axis === 0 ? "x" : mirror.axis === 1 ? "y" : "z";
    out[key] = 2 * mirror.center - out[key];
    return out;
}

/** R · T · S. Mirror is applied to the point before this matrix. */
export function displayMatrix(xf: MeasureDisplayTransform): Matrix4 {
    const scale = new Matrix4().makeScale(xf.scale.x, xf.scale.y, xf.scale.z);
    const translation = new Matrix4().makeTranslation(xf.translation.x, xf.translation.y, xf.translation.z);
    const rotation = new Matrix4().makeRotationFromEuler(
        new Euler(xf.rotationEuler.x, xf.rotationEuler.y, xf.rotationEuler.z, "XYZ"),
    );
    return new Matrix4().multiply(rotation).multiply(translation).multiply(scale);
}

/** Export millimetres → viewer display coordinates. */
export function exportPointToDisplayMm(point: MeasureVec3, xf: MeasureDisplayTransform): MeasureVec3 {
    const mirrored = mirrorPoint(point, xf);
    const v = new Vector3(mirrored.x, mirrored.y, mirrored.z).applyMatrix4(displayMatrix(xf));
    return { x: v.x, y: v.y, z: v.z };
}

/**
 * Viewer display coordinates → export millimetres.
 * Inverse of {@link exportPointToDisplayMm}: un-rotate, un-translate, un-scale, un-mirror.
 */
export function displayPointToExportMm(point: MeasureVec3, xf: MeasureDisplayTransform): MeasureVec3 {
    const inverse = displayMatrix(xf).invert();
    const v = new Vector3(point.x, point.y, point.z).applyMatrix4(inverse);
    return mirrorPoint({ x: v.x, y: v.y, z: v.z }, xf);
}

function linearDeterminant(xf: MeasureDisplayTransform): number {
    const mirrorSign = xf.mirror ? -1 : 1;
    return xf.scale.x * xf.scale.y * xf.scale.z * mirrorSign;
}

/** Bake a display pose into vertex positions. Reflection reverses winding. */
export function bakeDisplayTransform(
    mesh: MeasureTriangleMesh,
    xf: MeasureDisplayTransform,
): MeasureTriangleMesh {
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const displayed = exportPointToDisplayMm(
            {
                x: mesh.positions[i] ?? 0,
                y: mesh.positions[i + 1] ?? 0,
                z: mesh.positions[i + 2] ?? 0,
            },
            xf,
        );
        positions[i] = displayed.x;
        positions[i + 1] = displayed.y;
        positions[i + 2] = displayed.z;
    }
    const indices = new Uint32Array(mesh.indices);
    if (linearDeterminant(xf) < 0) {
        for (let i = 0; i + 2 < indices.length; i += 3) {
            const tmp = indices[i + 1] ?? 0;
            indices[i + 1] = indices[i + 2] ?? 0;
            indices[i + 2] = tmp;
        }
    }
    return { positions, indices };
}

/** Map a display-baked mesh back to export millimetres. */
export function undoDisplayMesh(mesh: MeasureTriangleMesh, xf: MeasureDisplayTransform): MeasureTriangleMesh {
    const positions = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
        const local = displayPointToExportMm(
            {
                x: mesh.positions[i] ?? 0,
                y: mesh.positions[i + 1] ?? 0,
                z: mesh.positions[i + 2] ?? 0,
            },
            xf,
        );
        positions[i] = local.x;
        positions[i + 1] = local.y;
        positions[i + 2] = local.z;
    }
    const indices = new Uint32Array(mesh.indices);
    if (linearDeterminant(xf) < 0) {
        for (let i = 0; i + 2 < indices.length; i += 3) {
            const tmp = indices[i + 1] ?? 0;
            indices[i + 1] = indices[i + 2] ?? 0;
            indices[i + 2] = tmp;
        }
    }
    return { positions, indices };
}
