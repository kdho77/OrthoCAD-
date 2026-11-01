// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { type Matrix4, Vector3 } from "three";
import { kabschRigid } from "@/lib/geometry/kabsch";
import { AFO_ORIENT_TARGETS_MM } from "./defaults";
import { cloneMesh, vertexCount } from "./mesh-ops";
import type { AfoTriMesh, AfoVec3 } from "./types";

export interface AfoOrientResult {
    mesh: AfoTriMesh;
    matrixElements: number[];
    residualRmsMm: number;
}

/**
 * Rigid 3-point orient of a foot+leg scan onto the canonical AFO frame.
 * [K] targets: heel, medial malleolus, lateral malleolus.
 */
export function orientScanThreePoint(
    mesh: AfoTriMesh,
    heel: AfoVec3,
    medialMal: AfoVec3,
    lateralMal: AfoVec3,
): AfoOrientResult {
    const src: [Vector3, Vector3, Vector3] = [
        new Vector3(heel.x, heel.y, heel.z),
        new Vector3(medialMal.x, medialMal.y, medialMal.z),
        new Vector3(lateralMal.x, lateralMal.y, lateralMal.z),
    ];
    const dst: [Vector3, Vector3, Vector3] = [
        new Vector3(...AFO_ORIENT_TARGETS_MM[0]!),
        new Vector3(...AFO_ORIENT_TARGETS_MM[1]!),
        new Vector3(...AFO_ORIENT_TARGETS_MM[2]!),
    ];
    const kabsch = kabschRigid(src, dst);
    const out = cloneMesh(mesh);
    applyMatrix(out, kabsch.matrix);
    return {
        mesh: out,
        matrixElements: kabsch.matrix.elements.slice(),
        residualRmsMm: kabsch.residualRmsMm,
    };
}

export function applyMatrix(mesh: AfoTriMesh, matrix: Matrix4): void {
    const e = matrix.elements;
    const n = vertexCount(mesh);
    for (let i = 0; i < n; i++) {
        const x = mesh.positions[i * 3] ?? 0;
        const y = mesh.positions[i * 3 + 1] ?? 0;
        const z = mesh.positions[i * 3 + 2] ?? 0;
        const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
        const inv = Math.abs(w) > 1e-12 ? 1 / w : 1;
        mesh.positions[i * 3] = (e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) * inv;
        mesh.positions[i * 3 + 1] = (e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) * inv;
        mesh.positions[i * 3 + 2] = (e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * inv;
    }
}
