// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { Vector3 } from "three";
import {
    cloneBottomPattern,
    createBottomPatternFromOutline,
    getDesignBottomPattern,
    rotateBottomPattern,
    setBottomPatternOutline,
    translateBottomPattern,
    transformedBottomPatternPoints,
    validateBottomPattern,
} from "@/lib/geometry/bottom-pattern";
import { defaultDesign, useDesignStore } from "@/stores/design-store";
import type { DesignState } from "@/types";

function squareOutline(half = 20) {
    return {
        points: [
            new Vector3(-half, -half, 0),
            new Vector3(half, -half, 0),
            new Vector3(half, half, 0),
            new Vector3(-half, half, 0),
        ],
    };
}

describe("bottomPattern entity", () => {
    test("create, translate, rotate independently of top trimline", () => {
        const pattern = createBottomPatternFromOutline(squareOutline(12), 8);
        expect(pattern.depthMm).toBe(8);
        expect(pattern.outline).toHaveLength(4);
        expect(pattern.transform).toEqual({ x: 0, y: 0, rotationDeg: 0 });

        const moved = translateBottomPattern(pattern, 30, -5);
        expect(moved.transform.x).toBe(30);
        expect(moved.transform.y).toBe(-5);
        // Outline points stay in local space — transform is independent.
        expect(moved.outline[0]).toEqual(pattern.outline[0]);

        const spun = rotateBottomPattern(moved, 45);
        expect(spun.transform.rotationDeg).toBe(45);
        expect(spun.transform.x).toBe(30);

        const world = transformedBottomPatternPoints(spun);
        expect(world).toHaveLength(4);
        // First local corner (-12,-12) rotated 45° then translated → (0, -12√2) + (30,-5).
        expect(world[0]!.x).toBeCloseTo(30, 5);
        expect(world[0]!.y).toBeCloseTo(-12 * Math.SQRT2 - 5, 5);
        expect(world[0]!.z).toBe(0);
    });

    test("reshape outline does not alter transform or top trimline state", () => {
        const design: DesignState = {
            ...defaultDesign(),
            trimlines: {
                left: squareOutline(40).points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
            },
        };
        const pattern = createBottomPatternFromOutline(squareOutline(10), 6, {
            x: 5,
            y: 2,
            rotationDeg: 10,
        });
        const reshaped = setBottomPatternOutline(pattern, squareOutline(15));
        expect(reshaped.outline[0]!.x).toBe(-15);
        expect(reshaped.transform).toEqual(pattern.transform);
        expect(reshaped.depthMm).toBe(6);
        // Top trimline untouched.
        expect(design.trimlines!.left![0]!.x).toBe(-40);
        expect(getDesignBottomPattern(design, "left")).toBeNull();
    });

    test("legacy designs without bottomPatterns load unchanged (undefined-safe)", () => {
        const legacy = defaultDesign();
        expect(legacy.bottomPatterns).toBeUndefined();
        expect(getDesignBottomPattern(legacy, "left")).toBeNull();
        expect(getDesignBottomPattern(legacy, "right")).toBeNull();
        expect(validateBottomPattern(undefined)).toEqual([]);
    });

    test("oversized / zero-overlap patterns validate without corrupting data", () => {
        const huge = createBottomPatternFromOutline(squareOutline(500), 4, {
            x: 10_000,
            y: -10_000,
            rotationDeg: 90,
        });
        expect(validateBottomPattern(huge)).toEqual([]);
        const clone = cloneBottomPattern(huge);
        expect(clone).toEqual(huge);
        expect(clone).not.toBe(huge);
        expect(clone.outline).not.toBe(huge.outline);
    });
});

describe("bottomPattern design-store persistence", () => {
    test("setSideBottomPattern writes design JSON without touching trimlines", () => {
        useDesignStore.setState({ design: defaultDesign() });
        const pattern = createBottomPatternFromOutline(squareOutline(12), 7, {
            x: 4,
            y: -2,
            rotationDeg: 15,
        });
        useDesignStore.getState().setSideTrimline("left", squareOutline(40));
        useDesignStore.getState().setSideBottomPattern("left", pattern);

        const design = useDesignStore.getState().design;
        expect(design.trimlines?.left?.[0]?.x).toBe(-40);
        expect(design.bottomPatterns?.left?.depthMm).toBe(7);
        expect(design.bottomPatterns?.left?.transform.rotationDeg).toBe(15);
        expect(getDesignBottomPattern(design, "left")?.outline).toHaveLength(4);

        useDesignStore.getState().clearSideBottomPattern("left");
        expect(useDesignStore.getState().design.bottomPatterns).toBeUndefined();
        expect(useDesignStore.getState().design.trimlines?.left?.[0]?.x).toBe(-40);
    });
});
