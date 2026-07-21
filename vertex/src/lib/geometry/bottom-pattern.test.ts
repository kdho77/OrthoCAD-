// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import {
    BOTTOM_PATTERN_FALLBACK_SCALE,
    cloneBottomPattern,
    createBottomPatternFromOutline,
    extractBottomMeshOutline,
    getDesignBottomPattern,
    outlineBoundsXY,
    rotateBottomPattern,
    scaleOutlineAboutCentroid,
    seedBottomPatternOutline,
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

/** Synthetic multi-mesh base: top square ±20, bottom flat square ±12 at z≈0. */
function makeMultiMeshBase(topHalf = 20, bottomHalf = 12): BufferGeometry {
    const positions: number[] = [];
    // Top verts (z=5) — a coarse grid
    for (const x of [-topHalf, 0, topHalf]) {
        for (const y of [-topHalf, 0, topHalf]) {
            positions.push(x, y, 5);
        }
    }
    const topCount = positions.length / 3;
    // Bottom verts (z=0) — denser enough for station bins
    for (let i = 0; i <= 10; i++) {
        for (let j = 0; j <= 10; j++) {
            const x = -bottomHalf + (i / 10) * (2 * bottomHalf);
            const y = -bottomHalf + (j / 10) * (2 * bottomHalf);
            positions.push(x, y, 0.05); // slight Z noise — still "flat"
        }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    g.userData = { isMultiMeshBase: true, topVertexCount: topCount, sourceMeshNames: ["Top", "Bottom"] };
    return g;
}

function makeSingleMeshBase(half = 20): BufferGeometry {
    const positions: number[] = [];
    for (let i = 0; i <= 8; i++) {
        for (let j = 0; j <= 8; j++) {
            positions.push(-half + (i / 8) * 2 * half, -half + (j / 8) * 2 * half, 2);
        }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    // No isMultiMeshBase / topVertexCount
    return g;
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

describe("bottomPattern seed from Bottom mesh", () => {
    test("extractBottomMeshOutline matches Bottom XY footprint (not top)", () => {
        const geo = makeMultiMeshBase(20, 12);
        const outline = extractBottomMeshOutline(geo);
        expect(outline).not.toBeNull();
        expect(outline!.points.length).toBeGreaterThanOrEqual(4);
        expect(outline!.points.every((p) => p.z === 0)).toBe(true);

        const b = outlineBoundsXY(outline!);
        // Bottom half=12 → extent ≈ 24; allow station/smoothing slack.
        expect(b.maxX - b.minX).toBeGreaterThan(20);
        expect(b.maxX - b.minX).toBeLessThan(26);
        expect(b.maxY - b.minY).toBeGreaterThan(20);
        expect(b.maxY - b.minY).toBeLessThan(26);
        // Must not match the larger top (±20 → extent 40).
        expect(b.maxX - b.minX).toBeLessThan(35);
    });

    test("seedBottomPatternOutline prefers Bottom mesh over scaled top", () => {
        const geo = makeMultiMeshBase(20, 12);
        const top = squareOutline(20);
        const seeded = seedBottomPatternOutline(geo, top);
        const scaled = scaleOutlineAboutCentroid(top, BOTTOM_PATTERN_FALLBACK_SCALE);
        const seedB = outlineBoundsXY(seeded);
        const scaledB = outlineBoundsXY(scaled);
        // Seed area should track Bottom (~24²), not 0.65× top (~26² but different shape source).
        expect(Math.abs(seedB.area - 24 * 24)).toBeLessThan(Math.abs(scaledB.area - seedB.area) + 80);
        expect(seedB.maxX - seedB.minX).toBeLessThan(scaledB.maxX - scaledB.minX + 1);
    });

    test("single-mesh base falls back to 0.65× scaled top outline", () => {
        const geo = makeSingleMeshBase(20);
        expect(extractBottomMeshOutline(geo)).toBeNull();
        const top = squareOutline(20);
        const seeded = seedBottomPatternOutline(geo, top);
        const expected = scaleOutlineAboutCentroid(top, BOTTOM_PATTERN_FALLBACK_SCALE);
        expect(seeded.points).toHaveLength(expected.points.length);
        expect(seeded.points[0]!.x).toBeCloseTo(expected.points[0]!.x, 5);
        expect(seeded.points[0]!.y).toBeCloseTo(expected.points[0]!.y, 5);
    });

    test("null geometry falls back to 0.65× scaled top", () => {
        const top = squareOutline(30);
        const seeded = seedBottomPatternOutline(null, top);
        const expected = scaleOutlineAboutCentroid(top, 0.65);
        expect(seeded.points[0]!.x).toBeCloseTo(expected.points[0]!.x, 5);
    });
});
