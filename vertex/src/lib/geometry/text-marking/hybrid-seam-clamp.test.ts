// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry } from "three";
import { releaseTextHostOnHybridSeamOverlap } from "./apply";
import { HYBRID_SEAM_OVERLAP_MESSAGE, TextMarkingError, textHybridSeamOverlap } from "./errors";
import { nearestClearStation } from "./place";

describe("hybrid seam clamp", () => {
    test("picks the nearest along-wall station that clears", () => {
        const clears = (s: number) => s <= 30 + 1e-6 || s >= 80 - 1e-6;
        expect(nearestClearStation(0, 100, 50, clears, 1)).toBeCloseTo(30, 5);
        expect(nearestClearStation(0, 100, 90, clears, 1)).toBeCloseTo(90, 5);
        expect(nearestClearStation(0, 100, 70, (s) => s >= 70 - 1e-6, 1)).toBeCloseTo(70, 5);
    });

    test("returns null when no station along the wall clears", () => {
        expect(nearestClearStation(0, 100, 40, () => false, 1)).toBeNull();
        expect(nearestClearStation(10, 5, 8, () => true, 1)).toBeNull();
    });

    test("overlap keeps the print solid and carries the panel message", () => {
        const host = new BufferGeometry();
        host.setAttribute("position", new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
        const before = host.getAttribute("position").count;
        const released = releaseTextHostOnHybridSeamOverlap(host, textHybridSeamOverlap());
        expect(released).toBe(host);
        expect((host.userData as { textFitError?: string }).textFitError).toBe(HYBRID_SEAM_OVERLAP_MESSAGE);
        expect(host.getAttribute("position").count).toBe(before);
        expect(
            releaseTextHostOnHybridSeamOverlap(host, new TextMarkingError("boolean", "cut failed")),
        ).toBeNull();
        host.dispose();
    });
});
