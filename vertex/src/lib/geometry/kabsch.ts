// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * Rigid Kabsch / Horn registration (rotation + translation, no scale).
 *
 * Phase 1D / Amendment H2: pure function only — no UI, store, or geometry-path wiring.
 *
 * Rotation is recovered via Horn's quaternion method (always det(R)=+1).
 * Wrong-foot / mirrored medial-lateral order is rejected by a chirality gate
 * (never silently corrected via an improper orthogonal matrix).
 */

import * as THREE from "three";

export type KabschErrorCode = "wrong_foot_marker_order" | "degenerate_marker_set";

export class KabschError extends Error {
    readonly code: KabschErrorCode;

    constructor(code: KabschErrorCode, message: string) {
        super(message);
        this.name = "KabschError";
        this.code = code;
    }
}

export type KabschResult = {
    /** Proper rotation (det = +1). Column-major THREE.Matrix3. */
    rotation: THREE.Matrix3;
    translation: THREE.Vector3;
    /** Residual RMS in mm after applying R,t (returned; not acted on). */
    residualRmsMm: number;
    /** 4×4 rigid transform: x' = R x + t. */
    matrix: THREE.Matrix4;
};

type V3 = { x: number; y: number; z: number };

function centroid(pts: readonly V3[]): THREE.Vector3 {
    const c = new THREE.Vector3();
    for (const p of pts) c.add(p as THREE.Vector3);
    return c.multiplyScalar(1 / pts.length);
}

function landmarkNormal(heel: V3, medial: V3, lateral: V3): THREE.Vector3 {
    const e1 = new THREE.Vector3(medial.x - heel.x, medial.y - heel.y, medial.z - heel.z);
    const e2 = new THREE.Vector3(lateral.x - heel.x, lateral.y - heel.y, lateral.z - heel.z);
    return new THREE.Vector3().crossVectors(e1, e2);
}

function detMatrix3(m: THREE.Matrix3): number {
    const e = m.elements;
    // THREE.Matrix3 is column-major
    return (
        e[0]! * (e[4]! * e[8]! - e[5]! * e[7]!) -
        e[1]! * (e[3]! * e[8]! - e[5]! * e[6]!) +
        e[2]! * (e[3]! * e[7]! - e[4]! * e[6]!)
    );
}

/** Jacobi eigen-decomposition of a real symmetric n×n (n≤4). Returns eigenvalues + eigenvectors as columns of V (row-major n²). */
function jacobiEigenSymmetric(S: number[], n: number): { values: number[]; V: number[] } {
    const a = S.slice();
    const V = new Array<number>(n * n).fill(0);
    for (let i = 0; i < n; i++) V[i * n + i] = 1;

    const maxIter = n * n * 12;
    for (let iter = 0; iter < maxIter; iter++) {
        let p = 0;
        let q = 1;
        let max = 0;
        for (let i = 0; i < n; i++) {
            for (let j = i + 1; j < n; j++) {
                const m = Math.abs(a[i * n + j]!);
                if (m > max) {
                    max = m;
                    p = i;
                    q = j;
                }
            }
        }
        if (max < 1e-15) break;

        const app = a[p * n + p]!;
        const aqq = a[q * n + q]!;
        const apq = a[p * n + q]!;
        const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(theta);
        const s = Math.sin(theta);

        for (let r = 0; r < n; r++) {
            if (r === p || r === q) continue;
            const arp = a[r * n + p]!;
            const arq = a[r * n + q]!;
            a[r * n + p] = a[p * n + r] = c * arp - s * arq;
            a[r * n + q] = a[q * n + r] = s * arp + c * arq;
        }
        a[p * n + p] = c * c * app - 2 * s * c * apq + s * s * aqq;
        a[q * n + q] = s * s * app + 2 * s * c * apq + c * c * aqq;
        a[p * n + q] = a[q * n + p] = 0;

        for (let r = 0; r < n; r++) {
            const vrp = V[r * n + p]!;
            const vrq = V[r * n + q]!;
            V[r * n + p] = c * vrp - s * vrq;
            V[r * n + q] = s * vrp + c * vrq;
        }
    }

    const values = new Array<number>(n);
    for (let i = 0; i < n; i++) values[i] = a[i * n + i]!;
    return { values, V };
}

/**
 * Horn (1987) unit-quaternion rigid rotation mapping centered `from` → centered `to`.
 * Always returns a proper rotation (SO(3)).
 */
function hornRotation(fromC: readonly THREE.Vector3[], toC: readonly THREE.Vector3[]): THREE.Matrix3 {
    let Sxx = 0;
    let Sxy = 0;
    let Sxz = 0;
    let Syx = 0;
    let Syy = 0;
    let Syz = 0;
    let Szx = 0;
    let Szy = 0;
    let Szz = 0;
    for (let i = 0; i < fromC.length; i++) {
        const a = fromC[i]!;
        const b = toC[i]!;
        Sxx += a.x * b.x;
        Sxy += a.x * b.y;
        Sxz += a.x * b.z;
        Syx += a.y * b.x;
        Syy += a.y * b.y;
        Syz += a.y * b.z;
        Szx += a.z * b.x;
        Szy += a.z * b.y;
        Szz += a.z * b.z;
    }

    // 4×4 symmetric N matrix (Horn)
    const N = [
        Sxx + Syy + Szz,
        Syz - Szy,
        Szx - Sxz,
        Sxy - Syx,
        Syz - Szy,
        Sxx - Syy - Szz,
        Sxy + Syx,
        Szx + Sxz,
        Szx - Sxz,
        Sxy + Syx,
        -Sxx + Syy - Szz,
        Syz + Szy,
        Sxy - Syx,
        Szx + Sxz,
        Syz + Szy,
        -Sxx - Syy + Szz,
    ];

    const { values, V } = jacobiEigenSymmetric(N, 4);
    let best = 0;
    for (let i = 1; i < 4; i++) {
        if (values[i]! > values[best]!) best = i;
    }
    // Eigenvector column `best` = (w, x, y, z) unit quaternion
    const w = V[0 * 4 + best]!;
    const x = V[1 * 4 + best]!;
    const y = V[2 * 4 + best]!;
    const z = V[3 * 4 + best]!;
    const q = new THREE.Quaternion(x, y, z, w).normalize();
    const m4 = new THREE.Matrix4().makeRotationFromQuaternion(q);
    return new THREE.Matrix3().setFromMatrix4(m4);
}

function residualRmsMm(
    from: readonly V3[],
    to: readonly V3[],
    rotation: THREE.Matrix3,
    translation: THREE.Vector3,
): number {
    let sum = 0;
    for (let i = 0; i < from.length; i++) {
        const p = (from[i] as THREE.Vector3).clone().applyMatrix3(rotation).add(translation);
        sum += p.distanceToSquared(to[i] as THREE.Vector3);
    }
    return Math.sqrt(sum / from.length);
}

/**
 * Rigid Kabsch/Horn: find R,t minimizing ||R·from_i + t − to_i||.
 *
 * - No scale (no flag, no fallback).
 * - Asserts det(R)=+1.
 * - Mirrored landmark chirality → `wrong_foot_marker_order` (never silently corrected).
 * - `residualRmsMm` is returned and not acted on by this module.
 */
export function kabschRigid(from: readonly V3[], to: readonly V3[]): KabschResult {
    if (from.length !== to.length || from.length < 3) {
        throw new KabschError("degenerate_marker_set", "Kabsch requires ≥3 paired landmarks");
    }

    const nFrom = landmarkNormal(from[0]!, from[1]!, from[2]!);
    const nTo = landmarkNormal(to[0]!, to[1]!, to[2]!);
    if (nFrom.lengthSq() < 1e-20 || nTo.lengthSq() < 1e-20) {
        throw new KabschError("degenerate_marker_set", "Landmarks are collinear");
    }

    const cFrom = centroid(from);
    const cTo = centroid(to);
    const fromC = from.map((p) => new THREE.Vector3(p.x - cFrom.x, p.y - cFrom.y, p.z - cFrom.z));
    const toC = to.map((p) => new THREE.Vector3(p.x - cTo.x, p.y - cTo.y, p.z - cTo.z));

    // Footprint-frame chirality gate (Amendment H2 / T9).
    // Three landmarks are always coplanar, so a mirrored triple is still properly
    // congruent in 3D (Horn residual can be ~0 with det(R)=+1). The clinical
    // wrong-foot signal is opposite orientation relative to +Z after
    // reorientToFootprintFrame — never silently corrected via an improper R.
    const chiralityFrom = Math.sign(nFrom.z);
    const chiralityTo = Math.sign(nTo.z);
    if (chiralityFrom !== 0 && chiralityTo !== 0 && chiralityFrom !== chiralityTo) {
        throw new KabschError(
            "wrong_foot_marker_order",
            "Landmark chirality is mirrored about the footprint +Z axis; refusing silent correction",
        );
    }

    const rotation = hornRotation(fromC, toC);
    const d = detMatrix3(rotation);
    if (d < 0 || Math.abs(d - 1) > 1e-5) {
        // Quaternion path must yield SO(3); anything else is degenerate.
        throw new KabschError("degenerate_marker_set", `det(R)=${d} is not +1`);
    }

    const translation = cTo.clone().sub(cFrom.clone().applyMatrix3(rotation));
    const residual = residualRmsMm(from, to, rotation, translation);

    const e = rotation.elements;
    // Matrix3 is column-major: e[0]=n11, e[1]=n21, e[2]=n31, e[3]=n12, ...
    const matrix = new THREE.Matrix4().set(
        e[0]!,
        e[3]!,
        e[6]!,
        translation.x,
        e[1]!,
        e[4]!,
        e[7]!,
        translation.y,
        e[2]!,
        e[5]!,
        e[8]!,
        translation.z,
        0,
        0,
        0,
        1,
    );

    return { rotation, translation, residualRmsMm: residual, matrix };
}
