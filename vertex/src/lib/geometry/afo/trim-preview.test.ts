// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.

import { describe, expect, test } from "@rstest/core";
import { afoTrimPreview, cursorCrossSegments, fallbackTrimPolyline } from "./trim-preview";
import type { AfoVec3 } from "./types";

const a: AfoVec3 = { x: 0, y: 0, z: 10 };
const b: AfoVec3 = { x: 20, y: 0, z: 12 };
const c: AfoVec3 = { x: 20, y: 30, z: 14 };
const hover: AfoVec3 = { x: 8, y: 4, z: 11 };

describe("AFO trim preview", () => {
    test("starting placement draws a cursor line before any handle exists", () => {
        const preview = afoTrimPreview({ points: [], hover, placing: true });
        expect(preview.marks).toEqual([]);
        expect(preview.stroke).toEqual([]);
        expect(preview.cursor).toEqual(hover);
        const cross = cursorCrossSegments(hover);
        expect(cross).toHaveLength(3);
        expect(cross[0]?.[0].x).toBeLessThan(hover.x);
        expect(cross[0]?.[1].x).toBeGreaterThan(hover.x);
    });

    test("the first point is a mark and the cursor extends it into a segment", () => {
        const preview = afoTrimPreview({ points: [a], hover, placing: true });
        expect(preview.marks).toEqual([a]);
        expect(preview.stroke).toEqual([a, hover]);
    });

    test("an open two-point line stays visible before three vertices and before close", () => {
        const straight = afoTrimPreview({ points: [a, b], placing: true, hover: null });
        expect(straight.stroke).toEqual([a, b]);
        expect(straight.marks).toHaveLength(2);

        const geodesic = [a, { x: 10, y: 0, z: 11 }, b];
        const onMesh = afoTrimPreview({
            points: [a, b],
            placing: true,
            onMesh: geodesic,
            hover: c,
        });
        expect(onMesh.stroke).toEqual([...geodesic, c]);
        expect(fallbackTrimPolyline([], [a, b])).toEqual([a, b]);
        expect(fallbackTrimPolyline(geodesic, [a, b])).toEqual(geodesic);
        const closed = afoTrimPreview({
            points: [a, b, c],
            placing: true,
            closed: true,
            hover,
            onMesh: [a, b, c, a],
        });
        expect(closed.stroke).toEqual([a, b, c, a]);
    });

    test("a fitted curve shows when placement is idle, and a failed geodesic falls back", () => {
        const curve = [a, b, c, a];
        const idle = afoTrimPreview({ points: [a, b, c], curve, placing: false, hover });
        expect(idle.cursor).toBeNull();
        expect(idle.stroke).toEqual(curve);
        expect(fallbackTrimPolyline([{ x: 1, y: 0, z: 0 }], [a, b])).toEqual([a, b]);
    });
});
