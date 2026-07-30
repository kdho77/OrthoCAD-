// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { KabschError, kabschRigid } from "@/lib/geometry/kabsch";
import { registerScanToBase } from "@/lib/geometry/registration";

function v(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z);
}

describe("kabschRigid — Phase 1D", () => {
    test("T7 — recovers known rigid transform; zero residual on exact input", () => {
        const fixed: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [v(0, 0, 0), v(10, 0, 1), v(0, 8, 2)];
        const angle = Math.PI / 5;
        const R = new THREE.Matrix3().set(
            Math.cos(angle),
            -Math.sin(angle),
            0,
            Math.sin(angle),
            Math.cos(angle),
            0,
            0,
            0,
            1,
        );
        const t = v(3, -2, 1.5);
        // moving = R^T (fixed - t)  so that fixed = R moving + t
        const Rt = R.clone().transpose();
        const moving = fixed.map((p) => p.clone().sub(t).applyMatrix3(Rt)) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];

        const result = kabschRigid(moving, fixed);
        expect(result.residualRmsMm).toBeLessThan(1e-9);

        for (let i = 0; i < 3; i++) {
            const mapped = moving[i]!.clone().applyMatrix3(result.rotation).add(result.translation);
            expect(mapped.distanceTo(fixed[i]!)).toBeLessThan(1e-9);
        }

        const e = result.rotation.elements;
        const re = R.elements;
        for (let i = 0; i < 9; i++) {
            expect(Math.abs(e[i]! - re[i]!)).toBeLessThan(1e-9);
        }
    });

    test("T8 — scaled input does not absorb scale; residual nonzero; rotation scale-free", () => {
        const fixed: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [v(0, 0, 1), v(20, 0, 2), v(0, 15, 3)];
        const scale = 1.25;
        const moving = fixed.map((p) => p.clone().multiplyScalar(scale)) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];

        const result = kabschRigid(moving, fixed);
        expect(result.residualRmsMm).toBeGreaterThan(0.5);

        const e = result.rotation.elements;
        const c0 = new THREE.Vector3(e[0], e[1], e[2]);
        const c1 = new THREE.Vector3(e[3], e[4], e[5]);
        const c2 = new THREE.Vector3(e[6], e[7], e[8]);
        expect(Math.abs(c0.length() - 1)).toBeLessThan(1e-6);
        expect(Math.abs(c1.length() - 1)).toBeLessThan(1e-6);
        expect(Math.abs(c2.length() - 1)).toBeLessThan(1e-6);
        const det =
            e[0]! * (e[4]! * e[8]! - e[5]! * e[7]!) -
            e[1]! * (e[3]! * e[8]! - e[5]! * e[6]!) +
            e[2]! * (e[3]! * e[7]! - e[4]! * e[6]!);
        expect(Math.abs(det - 1)).toBeLessThan(1e-5);
    });

    test("T9 — reflected marker order returns typed wrong-foot error", () => {
        // Non-coplanar triples with opposite chirality (Y-mirror).
        const fixed: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [v(0, 0, 0), v(10, 0, 1), v(3, 8, 4)];
        const moving: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [v(0, 0, 0), v(10, 0, 1), v(3, -8, 4)];

        expect(() => kabschRigid(moving, fixed)).toThrowError(KabschError);
        try {
            kabschRigid(moving, fixed);
        } catch (e) {
            expect(e).toBeInstanceOf(KabschError);
            expect((e as KabschError).code).toBe("wrong_foot_marker_order");
        }
    });

    test("registerScanToBase is the Kabsch entry point (no scale path)", () => {
        const fixed: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [v(1, 2, 3), v(4, 0, 4), v(1, 5, 6)];
        const moving = fixed.map((p) => p.clone().add(v(2, -1, 0.5))) as [
            THREE.Vector3,
            THREE.Vector3,
            THREE.Vector3,
        ];
        const r = registerScanToBase(moving, fixed);
        expect(r.residualRmsMm).toBeLessThan(1e-9);
        expect(registerScanToBase.length).toBe(2);
    });
});
