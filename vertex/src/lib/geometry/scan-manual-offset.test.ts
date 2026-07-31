// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { isNonZeroScanOffset, resolveScanMeshMatrix, ZERO_SCAN_OFFSET } from "@/lib/geometry/scan-display";

describe("scan manual offset", () => {
    test("zero offset leaves registration matrix unchanged", () => {
        const registration = new THREE.Matrix4().makeTranslation(10, 20, 30);
        const withZero = resolveScanMeshMatrix(undefined, registration, ZERO_SCAN_OFFSET);
        const without = resolveScanMeshMatrix(undefined, registration, null);
        for (let i = 0; i < 16; i++) {
            expect(withZero.elements[i]).toBeCloseTo(without.elements[i] ?? 0, 1e-9);
        }
    });

    test("applies post-registration translation without mutating source", () => {
        const registration = new THREE.Matrix4().makeTranslation(10, 20, 30);
        const before = registration.elements.slice();
        const offset = { x: 2, y: -3, z: 0.5 };
        const composed = resolveScanMeshMatrix(undefined, registration, offset);
        const p = new THREE.Vector3(0, 0, 0).applyMatrix4(composed);
        expect(p.x).toBeCloseTo(12, 6);
        expect(p.y).toBeCloseTo(17, 6);
        expect(p.z).toBeCloseTo(30.5, 6);
        for (let i = 0; i < 16; i++) expect(registration.elements[i]).toBe(before[i]);
    });

    test("isNonZeroScanOffset", () => {
        expect(isNonZeroScanOffset(null)).toBe(false);
        expect(isNonZeroScanOffset(ZERO_SCAN_OFFSET)).toBe(false);
        expect(isNonZeroScanOffset({ x: 0.1, y: 0, z: 0 })).toBe(true);
    });
});
