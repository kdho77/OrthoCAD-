// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { cameraDistanceForBounds, type MeshBounds } from "./slicer-mesh";

const insoleBounds: MeshBounds = {
    min: [0, 0, 0],
    max: [185.1, 89.7, 28.7],
    size: [185.1, 89.7, 28.7],
    lengthMm: 185.1,
    widthMm: 89.7,
    heightMm: 28.7,
};

describe("slicer preview camera", () => {
    test("fits tightly to the insole AABB so the model fills most of the view", () => {
        const aspect = 16 / 9;
        const fov = 35;
        const { center, distance } = cameraDistanceForBounds(insoleBounds, fov, aspect, 1.08);
        expect(center[0]).toBeCloseTo(92.55, 5);
        expect(center[1]).toBeCloseTo(44.85, 5);
        expect(center[2]).toBeCloseTo(14.35, 5);
        const radius = Math.hypot(185.1, 89.7, 28.7) / 2;
        const sphereDistance = (radius / Math.sin(((fov / 2) * Math.PI) / 180)) * 1.08;
        expect(distance).toBeLessThan(sphereDistance * 0.85);
        expect(distance).toBeGreaterThan(insoleBounds.widthMm * 0.4);
        expect(distance).toBeLessThan(insoleBounds.lengthMm * 1.6);
    });
});
