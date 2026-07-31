// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import * as THREE from "three";
import { MARKER_DRAG_RADIUS_MM, resolveMarkerPlacementTarget } from "@/lib/geometry/scan-marker-target";
import type { ScanMarkers } from "@/stores/scan-store";

describe("resolveMarkerPlacementTarget", () => {
    test("places next marker even when click is near an earlier marker (mm scan)", () => {
        const markers: ScanMarkers = {
            M1: new THREE.Vector3(0, 0, 0),
            M2: null,
            M3: null,
        };
        // Within 8mm of M1 — must still place M2 while M2 is unplaced.
        const local = new THREE.Vector3(3, 0, 0);
        expect(resolveMarkerPlacementTarget("M2", markers, local, 1)).toBe("M2");
    });

    test("meter-scale scan: click on far met does not steal M1", () => {
        const markers: ScanMarkers = {
            M1: new THREE.Vector3(0, 0, 0),
            M2: null,
            M3: null,
        };
        // ~70mm medial→lateral in meters; old thresh=8 would always hit M1.
        const local = new THREE.Vector3(0, 0.07, 0);
        expect(resolveMarkerPlacementTarget("M2", markers, local, 1000)).toBe("M2");
    });

    test("after all placed, nearby click adjusts the closest marker", () => {
        const markers: ScanMarkers = {
            M1: new THREE.Vector3(0, 0, 0),
            M2: new THREE.Vector3(0, 70, 0),
            M3: new THREE.Vector3(-100, 0, 0),
        };
        const nearM1 = new THREE.Vector3(2, 0, 0);
        expect(resolveMarkerPlacementTarget("M3", markers, nearM1, 1)).toBe("M1");
        const nearM2 = new THREE.Vector3(0, 71, 0);
        expect(resolveMarkerPlacementTarget("M3", markers, nearM2, 1)).toBe("M2");
        const far = new THREE.Vector3(50, 50, 0);
        expect(resolveMarkerPlacementTarget("M3", markers, far, 1)).toBe("M3");
    });

    test("drag radius scales with displayScale", () => {
        const markers: ScanMarkers = {
            M1: new THREE.Vector3(0, 0, 0),
            M2: new THREE.Vector3(1, 0, 0),
            M3: new THREE.Vector3(2, 0, 0),
        };
        // 0.005m = 5mm — inside 8mm radius at ×1000.
        const inside = new THREE.Vector3(MARKER_DRAG_RADIUS_MM / 1000 / 2, 0, 0);
        expect(resolveMarkerPlacementTarget("M3", markers, inside, 1000)).toBe("M1");
        // 0.02m = 20mm — outside 8mm radius at ×1000.
        const outside = new THREE.Vector3(0.02, 0, 0);
        expect(resolveMarkerPlacementTarget("M3", markers, outside, 1000)).toBe("M3");
    });
});
